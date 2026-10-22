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
        # 数字白名单必须包含 prompt 里实际注入的 context（锚点正文 + 邻近块），
        # 否则模型合法引用相邻段落里的数字也会被判为越界。
        evidence_texts = [
            str(item.get("text") or "") + "\n" + str(item.get("context") or "")
            for item in retrieval.evidence
        ]
        last_parsed: dict[str, Any] = {}

        def validator(raw: str):
            parsed = prompt_validate.parse_ask_output(
                raw,
                valid_citations={item["citation_no"] for item in retrieval.evidence},
                evidence_texts=evidence_texts,
                allowed_urls=allowed_urls,
            )
            last_parsed["value"] = parsed
            if parsed.validation_reasons:
                # 交给 generate_validated_json 带反馈重试；仍不合规时由调用方决定
                # 硬拒（编造引用编号）还是降级（数字/引用格式瑕疵）。
                raise OutputValidationError("模型输出未通过校验", reasons=list(parsed.validation_reasons))
            return parsed, []

        soft_note = ""
        try:
            parsed, _reasons = generate_validated_json(
                ctx, messages, operation="chat_ask", validator=validator, max_attempts=2
            )
        except OutputValidationError as exc:
            fallback = last_parsed.get("value")
            hard_failures = [reason for reason in exc.reasons if reason.startswith("invalid_citation_numbers")]
            if fallback is None or hard_failures or not str(fallback.answer or "").strip():
                answer = prompt_validate.build_refusal_text(
                    question, evidence=retrieval.evidence, reason="invalid_model_output"
                )
                boundary = prompt_validate.build_boundary_note(question, gate_version=retrieval.gate.version)
                ctx.emit("validating", 82)
                return {"result": _refusal_payload(answer, "explanation_discarded", boundary_note=boundary)}
            # 校验瑕疵降级：保留有证据支撑的回答，只提示需人工核对，不再整段丢弃。
            parsed = fallback
            soft_note = "校验提示：个别数字或引用标注未与证据逐字一致，请以引用卡原文为准。"
        except ModelOutputInvalid:
            answer = prompt_validate.build_refusal_text(question, evidence=retrieval.evidence, reason="invalid_model_output")
            boundary = prompt_validate.build_boundary_note(question, gate_version=retrieval.gate.version)
            ctx.emit("validating", 82)
            return {"result": _refusal_payload(answer, "explanation_discarded", boundary_note=boundary)}

        boundary = parsed.boundary_note or prompt_validate.build_boundary_note(
            question, gate_version=retrieval.gate.version
        )
        if parsed.no_evidence and retrieval.gate.passed and retrieval.gate.dense_top >= 0.70 and retrieval.gate.keyword_overlap >= 5 and len(retrieval.evidence) >= 3:
            # The model occasionally reports no_evidence even though high-scoring
            # evidence exists (e.g. an exact official rate chunk). Retry once with
            # an explicit coverage hint instead of silently discarding the sources.
            retry_messages = [
                *messages,
                {
                    "role": "user",
                    "content": (
                        "补充核对要求：以上证据中确实存在与问题相关的内容（例如 [1]）。"
                        "请先逐条核对证据，只回答证据明确写出的部分；"
                        "只有证据完全没有覆盖问题时才把 no_evidence 设为 true。"
                    ),
                },
            ]
            try:
                parsed_retry, _ = generate_validated_json(
                    ctx,
                    retry_messages,
                    operation="chat_ask_coverage_retry",
                    validator=validator,
                    max_attempts=1,
                )
                if not parsed_retry.no_evidence:
                    parsed = parsed_retry
            except OutputValidationError as exc:
                fallback = last_parsed.get("value")
                hard_failures = [
                    reason for reason in exc.reasons if reason.startswith("invalid_citation_numbers")
                ]
                if fallback is not None and not hard_failures and not fallback.no_evidence:
                    parsed = fallback
                    soft_note = soft_note or (
                        "校验提示：个别数字或引用标注未与证据逐字一致，请以引用卡原文为准。"
                    )
            except ModelOutputInvalid:
                # Keep the original refusal if the retry is still invalid.
                pass

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

            if cited_numbers and cited_numbers <= valid_numbers and not soft_note:
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
        if soft_note:
            boundary = f"{boundary}；{soft_note}" if boundary else soft_note

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
