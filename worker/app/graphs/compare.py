"""compare 图：对比 2–6 个方向；只解释方向卡与证据，不排名、不替用户决定。

payload 严格符合 lead 补充契约：
``{ comparison, direction_ids, evidence?: Citation[] }``
"""

from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from ..errors import BadRequest, ModelOutputInvalid, OutputValidationError, WorkerError
from ..models import DIRECTION_IDS, CompareInput, CompareRunResult, citation_payload
from ..prompts import career as prompts
from ..prompts import validate as prompt_validate
from .common import JobContext, direction_title, generate_validated_json, profile_summary


class CompareState(TypedDict, total=False):
    run_input: dict[str, Any]
    profile: dict[str, Any] | None
    cards: list[dict[str, Any]]
    retrieval: Any
    result: dict[str, Any]


def _parse_input(ctx: JobContext) -> CompareInput:
    try:
        run_input = CompareInput.model_validate(ctx.job.input)
    except Exception as exc:  # noqa: BLE001
        raise BadRequest("compare 输入结构不合法") from exc
    ids = list(dict.fromkeys(str(item) for item in (run_input.direction_ids or [])))
    if not 2 <= len(ids) <= 6:
        raise BadRequest("compare 需要 2–6 个不重复方向")
    unknown = [item for item in ids if item not in DIRECTION_IDS]
    if unknown:
        raise BadRequest("compare 含未知方向：" + ",".join(unknown))
    run_input.direction_ids = ids
    return run_input


def build_compare_graph(ctx: JobContext):
    graph = StateGraph(CompareState)

    def validate_node(state: CompareState) -> CompareState:
        ctx.check_cancel()
        ctx.emit("retrieving", 14)
        run_input = _parse_input(ctx)
        profile = None
        if run_input.profile_id:
            profile = ctx.db.get_profile(ctx.job.owner_id, run_input.profile_id)
        rows = ctx.db.list_directions(run_input.direction_ids)
        by_id = {str(row.get("direction_id")): row for row in rows}
        cards: list[dict[str, Any]] = []
        for direction_id in run_input.direction_ids:
            row = by_id.get(direction_id)
            metadata = dict((row or {}).get("metadata") or {}) if isinstance((row or {}).get("metadata"), dict) else {}
            cards.append(
                {
                    "direction_id": direction_id,
                    "title": direction_title(direction_id, row),
                    "summary": str((row or {}).get("description") or metadata.get("summary") or ""),
                    "work_content": list(metadata.get("work_content") or []),
                    "verified_skills": list(metadata.get("verified_skills") or []),
                    "data_gaps": list(metadata.get("data_gaps") or []),
                }
            )
        return {"run_input": run_input.model_dump(), "profile": profile, "cards": cards}

    def retrieve_node(state: CompareState) -> CompareState:
        ctx.check_cancel()
        ctx.emit("retrieving", 26)
        cards = state["cards"]
        question = " ".join([str(card["title"]) for card in cards] + ["工作内容 能力要求 课程 资料缺口"])
        outcome = ctx.retrieval.search(
            owner_id=ctx.job.owner_id,
            run_id=ctx.job.run_id,
            question=question,
        )
        ctx.emit("retrieving", 38)
        return {"retrieval": outcome}

    def explain_node(state: CompareState) -> CompareState:
        ctx.check_cancel()
        ctx.emit("planning", 55)
        run_input = state["run_input"]
        retrieval = state["retrieval"]
        cards = state["cards"]
        citations = list(retrieval.citations)
        comparison = ""
        if retrieval.evidence and retrieval.gate.passed:
            messages = prompts.build_compare_messages(
                direction_ids=list(run_input["direction_ids"]),
                direction_cards=cards,
                profile_summary=profile_summary(state.get("profile")),
                evidence=retrieval.evidence,
            )
            def validator(raw: str):
                return prompt_validate.parse_compare_explanation(
                    raw,
                    valid_citations={item["citation_no"] for item in retrieval.evidence},
                    allowed_texts=[str(item.get("text") or "") for item in retrieval.evidence]
                    + [str(card) for card in cards],
                )

            try:
                parsed = generate_validated_json(
                    ctx, messages, operation="chat_compare", validator=validator, max_attempts=2
                )
                if parsed.validation_reasons:
                    raise OutputValidationError("compare 输出越界", reasons=parsed.validation_reasons)
                comparison = parsed.comparison
            except (WorkerError, OutputValidationError, ModelOutputInvalid) as exc:
                ctx.logger.error("compare_failed code=%s", getattr(exc, "code", type(exc).__name__))
                comparison = prompt_validate.deterministic_compare_text(cards)
        else:
            comparison = prompt_validate.deterministic_compare_text(cards)
        payload = CompareRunResult(
            comparison=comparison,
            direction_ids=[str(item) for item in run_input["direction_ids"]],
            evidence=[citation_payload(citation) for citation in citations],
        )
        ctx.emit("validating", 86)
        return {"result": payload.model_dump(mode="json")}

    graph.add_node("validate", validate_node)
    graph.add_node("retrieve", retrieve_node)
    graph.add_node("explain", explain_node)
    graph.add_edge(START, "validate")
    graph.add_edge("validate", "retrieve")
    graph.add_edge("retrieve", "explain")
    graph.add_edge("explain", END)
    return graph.compile()


def run_compare(ctx: JobContext) -> dict[str, Any]:
    final_state = build_compare_graph(ctx).invoke({})
    payload = final_state.get("result")
    if not isinstance(payload, dict):
        raise BadRequest("compare 图没有产出结果")
    return payload
