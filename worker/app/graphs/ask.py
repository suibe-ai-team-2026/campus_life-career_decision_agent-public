"""ask 图（固定流程）：validate → retrieve → 闸门/生成 → finalize。

拒答规则：
- 检索闸门不通过：不调用 chat，直接返回说明缺哪类/哪届资料的拒答文案；
- 模型输出越界（引用编号不存在、数字与证据不一致、出现证据外 URL）：
  丢弃解释，回退为确定性拒答/边界说明；
- 模型网络/鉴权/限流错误：向上抛，由 worker_fail_job 决定是否重试。
"""

from __future__ import annotations

import re
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from ..errors import BadRequest, ModelOutputInvalid, OutputValidationError
from ..models import AskInput, AskRunResult
from ..prompts import career as prompts
from ..prompts import validate as prompt_validate
from .common import JobContext, generate_validated_json, profile_summary


class AskState(TypedDict, total=False):
    run_input: dict[str, Any]
    profile: dict[str, Any] | None
    retrieval: Any
    result: dict[str, Any]


def _parse_input(ctx: JobContext) -> AskInput:
    try:
        parsed = AskInput.model_validate(ctx.job.input)
    except Exception as exc:  # noqa: BLE001
        raise BadRequest("ask 输入结构不合法") from exc
    parsed.question = parsed.question.strip()
    if len(parsed.question) < 2:
        raise BadRequest("question 不能为空且至少 2 个字符")
    if len(parsed.history or []) > 4:
        raise BadRequest("history 最多 4 轮")
    return parsed


def _refusal_payload(answer: str, reason: str, *, boundary_note: str = "") -> dict[str, Any]:
    return AskRunResult(
        answer=answer,
        citations=[],
        refusal=True,
        refusal_reason=reason,
        boundary_note=boundary_note or None,
    ).model_dump(mode="json", exclude_none=True)


def build_ask_graph(ctx: JobContext):
    graph = StateGraph(AskState)

    def validate_node(state: AskState) -> AskState:
        ctx.check_cancel()
        ctx.emit("retrieving", 15)
        run_input = _parse_input(ctx)
        profile = None
        if run_input.profile_id:
            profile = ctx.db.get_profile(ctx.job.owner_id, run_input.profile_id)
        return {"run_input": run_input.model_dump(), "profile": profile}

    def retrieve_node(state: AskState) -> AskState:
        ctx.check_cancel()
        ctx.emit("retrieving", 25)
        run_input = state["run_input"]
        outcome = ctx.retrieval.search(
            owner_id=ctx.job.owner_id,
            run_id=ctx.job.run_id,
            question=str(run_input["question"]),
            source_version_ids=run_input.get("source_version_ids") or None,
        )
        ctx.emit("retrieving", 38)
        return {"retrieval": outcome}

    def answer_node(state: AskState) -> AskState:
        ctx.check_cancel()
        run_input = state["run_input"]
        retrieval = state["retrieval"]
        question = str(run_input["question"])
        # 1) 闸门拒答：不调生成模型。
        if not retrieval.evidence or not retrieval.gate.passed:
            answer = prompt_validate.build_refusal_text(
                question,
                evidence=retrieval.evidence,
                reason="gate_failed" if retrieval.evidence else "no_candidates",
            )
            boundary = prompt_validate.build_boundary_note(question, gate_version=retrieval.gate.version)
            ctx.emit("validating", 82)
            return {
                "result": _refusal_payload(
                    answer,
                    "gate_failed" if retrieval.evidence else "no_evidence",
                    boundary_note=boundary,
                )
            }

        ctx.emit("planning", 55)
        messages = prompts.build_ask_messages(
            question=question,
            history=run_input.get("history") or [],
            evidence=retrieval.evidence,
        )
        allowed_urls = [str(item.get("canonical_url") or "") for item in retrieval.evidence if item.get("canonical_url")]
        evidence_texts = [str(item.get("text") or "") for item in retrieval.evidence]

        def validator(raw: str):
            parsed = prompt_validate.parse_ask_output(
                raw,
                valid_citations={item["citation_no"] for item in retrieval.evidence},
                evidence_texts=evidence_texts,
                allowed_urls=allowed_urls,
            )
            new_reasons = list(parsed.validation_reasons)
            return parsed, new_reasons

        try:
            parsed, reasons = generate_validated_json(
                ctx, messages, operation="chat_ask", validator=validator, max_attempts=2
            )
        except (OutputValidationError, ModelOutputInvalid):
            answer = prompt_validate.build_refusal_text(question, evidence=retrieval.evidence, reason="invalid_model_output")
            boundary = prompt_validate.build_boundary_note(question, gate_version=retrieval.gate.version)
            ctx.emit("validating", 82)
            return {"result": _refusal_payload(answer, "explanation_discarded", boundary_note=boundary)}

        boundary = parsed.boundary_note or prompt_validate.build_boundary_note(
            question, gate_version=retrieval.gate.version
        )
        if parsed.no_evidence:
            # The model may set no_evidence=true while still giving a useful partial
            # answer that cites evidence ("only 2022 data is available"). If every
            # cited number is valid and no validation reason fired, keep it as a
            # normal answer with sources instead of discarding the citations.
            cited_numbers = {int(match) for match in re.findall(r"\[(\d+)\]", parsed.answer or "")}
            valid_numbers = {item["citation_no"] for item in retrieval.evidence}

            def citation_no(citation: Any) -> int | None:
                if isinstance(citation, dict):
                    value = citation.get("citation_no")
                else:
                    value = getattr(citation, "citation_no", None)
                return int(value) if value is not None else None

            if cited_numbers and cited_numbers <= valid_numbers and not reasons:
                result = AskRunResult(
                    answer=parsed.answer,
                    citations=[
                        citation
                        for citation in retrieval.citations
                        if citation_no(citation) in cited_numbers
                    ],
                    refusal=False,
                    boundary_note=boundary or None,
                ).model_dump(mode="json", exclude_none=True)
                ctx.emit("validating", 86)
                return {"result": result}
            answer = parsed.answer or prompt_validate.build_refusal_text(
                question, evidence=retrieval.evidence, reason="model_no_evidence"
            )
            ctx.emit("validating", 82)
            return {"result": _refusal_payload(answer, "model_no_evidence", boundary_note=boundary)}
        if reasons:
            answer = prompt_validate.build_refusal_text(question, evidence=retrieval.evidence, reason="validation_failed")
            ctx.emit("validating", 82)
            return {"result": _refusal_payload(answer, "explanation_discarded", boundary_note=boundary)}

        result = AskRunResult(
            answer=parsed.answer,
            citations=retrieval.citations,
            refusal=False,
            boundary_note=boundary or None,
        ).model_dump(mode="json", exclude_none=True)
        ctx.emit("validating", 86)
        return {"result": result}

    graph.add_node("validate", validate_node)
    graph.add_node("retrieve", retrieve_node)
    graph.add_node("answer", answer_node)
    graph.add_edge(START, "validate")
    graph.add_edge("validate", "retrieve")
    graph.add_edge("retrieve", "answer")
    graph.add_edge("answer", END)
    return graph.compile()


def run_ask(ctx: JobContext) -> dict[str, Any]:
    final_state = build_ask_graph(ctx).invoke({})
    payload = final_state.get("result")
    if not isinstance(payload, dict):
        raise BadRequest("ask 图没有产出结果")
    return payload
