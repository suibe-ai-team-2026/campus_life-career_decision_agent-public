"""assessment_explain 图：AI 只解释冻结的维度分数，不修改分数。

payload 严格符合 lead 补充契约：
``{ explanation, dimensions: [{dimension,title,score,answered,total,descriptive}] }``
"""

from __future__ import annotations

import math
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from ..errors import BadRequest, InvalidProfile, ModelOutputInvalid, OutputValidationError, WorkerError
from ..models import AssessmentDimension, AssessmentInput, AssessmentRunResult
from ..prompts import career as prompts
from ..prompts import validate as prompt_validate
from .common import JobContext, generate_validated_json, profile_summary


class AssessmentState(TypedDict, total=False):
    run_input: dict[str, Any]
    profile: dict[str, Any]
    dimensions: list[dict[str, Any]]
    result: dict[str, Any]


def compute_dimensions(profile: dict[str, Any], assessment: dict[str, Any] | None) -> list[dict[str, Any]]:
    """从画像与测评题计算维度聚合；分数完全来自 profile.scores，AI 不得修改。"""

    answers = profile.get("answers") if isinstance(profile.get("answers"), dict) else {}
    scores = profile.get("scores") if isinstance(profile.get("scores"), dict) else {}
    questions = list(assessment.get("questions") or []) if isinstance(assessment, dict) else []
    dimensions_meta = assessment.get("dimensions") if isinstance(assessment, dict) else {}
    if not isinstance(dimensions_meta, dict):
        dimensions_meta = {}
    dimension_ids = set(str(key) for key in dimensions_meta.keys()) | set(str(key) for key in scores.keys())
    dimensions: list[dict[str, Any]] = []
    for dimension in sorted(dimension_ids):
        dimension_questions = [q for q in questions if str(q.get("dimension") or "") == dimension]
        total = len(dimension_questions)
        answered = sum(1 for q in dimension_questions if str(q.get("question_id")) in answers)
        raw_score = scores.get(dimension)
        score: float | None = None
        if isinstance(raw_score, (int, float)) and not isinstance(raw_score, bool) and math.isfinite(float(raw_score)):
            score = float(raw_score)
        title = str((dimensions_meta.get(dimension) or {}).get("title") or dimension)
        dimensions.append(
            {
                "dimension": dimension,
                "title": title,
                "score": score,
                "answered": int(answered),
                "total": int(total),
                "descriptive": "",
            }
        )
    return dimensions


def build_assessment_graph(ctx: JobContext):
    graph = StateGraph(AssessmentState)

    def validate_node(state: AssessmentState) -> AssessmentState:
        ctx.check_cancel()
        ctx.emit("planning", 14)
        try:
            run_input = AssessmentInput.model_validate(ctx.job.input)
        except Exception as exc:  # noqa: BLE001
            raise BadRequest("assessment_explain 输入结构不合法") from exc
        if not run_input.profile_id:
            raise BadRequest("assessment_explain 需要 profile_id")
        profile = ctx.db.get_profile(ctx.job.owner_id, run_input.profile_id)
        assessment_version = profile.get("assessment_version")
        assessment = ctx.db.get_assessment(str(assessment_version)) if assessment_version else None
        dimensions = compute_dimensions(profile, assessment)
        if not dimensions:
            raise InvalidProfile("画像没有可解释的测评维度")
        return {"run_input": run_input.model_dump(), "profile": profile, "dimensions": dimensions}

    def explain_node(state: AssessmentState) -> AssessmentState:
        ctx.check_cancel()
        ctx.emit("planning", 40)
        dimensions = state["dimensions"]
        messages = prompts.build_assessment_messages(
            dimensions=[{key: item[key] for key in ("dimension", "title", "score", "answered", "total")} for item in dimensions],
            profile_summary=profile_summary(state["profile"]),
        )
        valid_dimensions = {str(item["dimension"]) for item in dimensions}
        notes: dict[str, str] = {}
        explanation = ""
        try:
            parsed = generate_validated_json(
                ctx,
                messages,
                operation="chat_assessment_explain",
                validator=lambda raw: prompt_validate.parse_assessment_explanation(raw, valid_dimensions=valid_dimensions),
                max_attempts=2,
            )
            # 只取模型对维度的描述；分数与答题数量一律使用系统计算值。
            notes = dict(parsed.dimension_notes)
            explanation = parsed.explanation or prompt_validate.deterministic_assessment_explanation()
        except (WorkerError, OutputValidationError, ModelOutputInvalid) as exc:
            ctx.logger.error("assessment_explain_failed code=%s", getattr(exc, "code", type(exc).__name__))
            explanation = prompt_validate.deterministic_assessment_explanation()
            notes = {}
        final_dimensions = [
            AssessmentDimension(
                dimension=str(item["dimension"]),
                title=str(item["title"]),
                score=item["score"],
                answered=int(item["answered"]),
                total=int(item["total"]),
                descriptive=notes.get(str(item["dimension"]), ""),
            )
            for item in dimensions
        ]
        result = AssessmentRunResult(explanation=explanation, dimensions=final_dimensions)
        ctx.emit("validating", 86)
        return {"result": result.model_dump(mode="json")}

    graph.add_node("validate", validate_node)
    graph.add_node("explain", explain_node)
    graph.add_edge(START, "validate")
    graph.add_edge("validate", "explain")
    graph.add_edge("explain", END)
    return graph.compile()


def run_assessment(ctx: JobContext) -> dict[str, Any]:
    final_state = build_assessment_graph(ctx).invoke({})
    payload = final_state.get("result")
    if not isinstance(payload, dict):
        raise BadRequest("assessment_explain 图没有产出结果")
    return payload
