"""LangGraph 公共上下文：进度、取消检查、模型调用与用量记录。"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Sequence, TypeVar

from ..budget import BudgetGuard
from ..config import Config
from ..db import SupabaseDb
from ..errors import ModelOutputInvalid, OutputValidationError
from ..models import ClaimedJob, ModelUsage
from ..providers.openrouter import OpenRouterClient
from ..retrieval.service import RetrievalService
from ..rules.engine import RulesEngine

T = TypeVar("T")

DIRECTION_TITLE_FALLBACK = {
    "trade_supply_chain": "国际贸易与供应链",
    "cross_border_business": "跨境电商与国际业务",
    "finance_accounting": "金融与财会",
    "data_business": "数据分析与商业分析",
    "public_service": "公共部门与公共服务",
    "further_study": "升学与研究",
}

PROGRESS_MAX_BEFORE_COMPLETE = 99

INTEREST_LABELS = {
    "r": "实践",
    "i": "研究",
    "a": "创意",
    "s": "社会",
    "e": "企业",
    "c": "常规",
}
ABILITY_LABELS = {
    "research": "信息搜集与研究",
    "data": "数据理解与分析",
    "writing": "写作表达",
    "communication": "沟通协作",
    "execution": "组织执行",
    "digital": "数字工具应用",
}
VALUE_LABELS = {
    "growth": "成长与成就",
    "autonomy": "自主性",
    "collaboration": "合作与影响",
    "stability": "稳定与保障",
    "income": "收入回报",
    "influence": "影响他人与社会",
}
WORK_STYLE_LABELS = {
    "info_first": "先搜集资料再形成步骤",
    "try_first": "先做一个版本再迭代",
    "clear_process": "希望目标与流程清楚",
    "discuss_first": "先和团队讨论再推进",
    "coordinate": "偏好统筹分工与排期",
    "communicate": "偏好在沟通中推进",
    "research": "偏好独立研究与比较",
    "create": "偏好共同创意与表达",
    "follow_process": "偏好按既定流程执行",
}
EXPECTED_REQUIRED_ANSWERS = 16


@dataclass
class JobContext:
    """一次 job 的运行上下文；由 runtime 组装，图节点只通过它访问外部。"""

    config: Config
    db: SupabaseDb
    provider: OpenRouterClient
    retrieval: RetrievalService
    rules_engine: RulesEngine
    job: ClaimedJob
    worker_id: str
    emit_progress: Callable[[str, int], None]
    cancel_check: Callable[[], None]
    logger: logging.Logger
    budget: BudgetGuard | None = None
    emit_trace: Callable[[str, dict[str, Any]], None] = field(default=lambda _type, _payload: None)
    _last_progress: int = field(default=0, repr=False)

    # -- 进度 ---------------------------------------------------------
    def emit(self, status: str, progress: int) -> None:
        value = max(0, min(PROGRESS_MAX_BEFORE_COMPLETE, int(progress)))
        if value <= self._last_progress:
            # 契约要求进度递增且不到 100 就 complete；重复阶段自动 +1。
            value = min(PROGRESS_MAX_BEFORE_COMPLETE, self._last_progress + 1)
        self._last_progress = value
        self.emit_progress(status, value)

    # -- 轨迹事件（只展示，不影响进度/结果） ---------------------------
    def trace(self, event_type: str, payload: dict[str, Any] | None = None) -> None:
        self.emit_trace(event_type, payload or {})

    # -- 取消 ---------------------------------------------------------
    def check_cancel(self) -> None:
        self.cancel_check()

    # -- 用量 ---------------------------------------------------------
    def record_usage(self, usage: ModelUsage | None) -> None:
        if usage is None:
            return
        self.db.record_usage(
            owner_id=self.job.owner_id,
            run_id=self.job.run_id,
            provider=usage.provider,
            model=usage.model,
            operation=usage.operation,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            estimated_cost=usage.estimated_cost,
            currency=usage.currency,
            pricing_snapshot_at=usage.pricing_snapshot_at,
        )
        if self.budget is not None:
            self.budget.commit(usage.estimated_cost)


def generate_validated_json(
    ctx: JobContext,
    messages: Sequence[dict[str, str]],
    *,
    operation: str,
    validator: Callable[[str], T],
    max_attempts: int = 2,
    max_tokens: int | None = None,
    model: str | None = None,
    reasoning_effort: str | None = None,
) -> T:
    """调用 chat 并把输出交给 validator；只对 JSON/格式/越界校验失败重试一次。

    网络/鉴权/限流/超时错误直接抛出，交由 runtime 的 worker_fail_job 决定是否重试。
    """

    last_error: Exception | None = None
    attempt_messages = list(messages)
    for attempt in range(max(1, max_attempts)):
        response = ctx.provider.chat(
            attempt_messages,
            operation=operation,
            max_tokens=max_tokens,
            model=model,
            reasoning_effort=reasoning_effort,
        )
        ctx.record_usage(response.usage)
        try:
            return validator(response.content)
        except (ModelOutputInvalid, OutputValidationError) as exc:
            last_error = exc
            if attempt + 1 < max_attempts:
                reasons = [str(reason) for reason in getattr(exc, "reasons", []) if str(reason).strip()]
                if any(reason.startswith("invalid_citation_numbers") for reason in reasons):
                    # 编造引用编号属于硬失败，直接丢弃，不用第二次模型调用掩盖。
                    raise
                if reasons:
                    # 把校验失败原因回传给模型，让它修正而不是用完全相同的输入重试。
                    attempt_messages = [
                        *attempt_messages,
                        {
                            "role": "user",
                            "content": (
                                "上一次输出未通过程序校验：" + "；".join(reasons[:5]) + "。"
                                "请逐条核对证据后重新输出完整 JSON；引用编号只能来自给定证据，"
                                "数字必须逐字出现在证据中，每个含数字的事实句都要带 [n]。"
                            ),
                        },
                    ]
                continue
            raise
    raise last_error or ModelOutputInvalid("模型输出校验失败")


def direction_title(direction_id: str, row: Mapping[str, Any] | None = None) -> str:
    if row and str(row.get("title") or "").strip():
        return str(row["title"])
    return DIRECTION_TITLE_FALLBACK.get(direction_id, direction_id)


def profile_summary(profile: Mapping[str, Any] | None) -> dict[str, Any]:
    """把已保存画像整理成模型可读的信号，不做推断或数字换算。

    Profile rows previously exposed only school/major/term/preferences, so plan
    prompts correctly concluded that interests and abilities were missing even
    after the user answered all questions. Keep the raw answers/scores for
    auditability and add labelled views so the model cannot silently drop the
    questionnaire payload.
    """

    if not profile:
        return {}
    preferences = profile.get("preferences") if isinstance(profile.get("preferences"), dict) else {}
    answers = profile.get("answers") if isinstance(profile.get("answers"), dict) else {}
    scores = profile.get("scores") if isinstance(profile.get("scores"), dict) else {}

    interests = []
    for key, label in INTEREST_LABELS.items():
        raw = scores.get(f"interest_{key}")
        if raw is None:
            continue
        try:
            normalized = float(raw)
        except (TypeError, ValueError):
            continue
        interests.append(
            {
                "key": key,
                "label": label,
                "score_1_to_5": round(1 + max(0.0, min(1.0, normalized)) * 4, 2),
            }
        )
    interests.sort(key=lambda item: (-float(item["score_1_to_5"]), item["key"]))

    evidence_tags = []
    experience = answers.get("exp_optional")
    if isinstance(experience, dict):
        raw_tags = experience.get("tags")
        if isinstance(raw_tags, list):
            evidence_tags = [str(tag) for tag in raw_tags if str(tag).startswith("ability_")]

    abilities = []
    for key, label in ABILITY_LABELS.items():
        dimension = f"ability_{key}"
        raw = scores.get(dimension)
        if raw is None:
            continue
        try:
            normalized = float(raw)
        except (TypeError, ValueError):
            continue
        abilities.append(
            {
                "key": key,
                "label": label,
                "score_1_to_5": round(1 + max(0.0, min(1.0, normalized)) * 4, 2),
                "evidence": "supported" if dimension in evidence_tags else "self_only",
            }
        )
    abilities.sort(key=lambda item: (-float(item["score_1_to_5"]), item["key"]))

    values = []
    ranked_values = answers.get("v_top3")
    if isinstance(ranked_values, list):
        for item in ranked_values:
            key = str(item)
            values.append({"key": key, "label": VALUE_LABELS.get(key, key)})

    work_styles = []
    for answer_key, title in (
        ("w_approach", "接到新任务时"),
        ("w_team", "做小组任务时"),
    ):
        option = str(answers.get(answer_key) or "")
        if option:
            work_styles.append(
                {
                    "question": title,
                    "option": option,
                    "label": WORK_STYLE_LABELS.get(option, option),
                }
            )

    summary: dict[str, Any] = {
        "school": profile.get("school"),
        "major": profile.get("major"),
        "enrollment_year": profile.get("enrollment_year"),
        "current_term": profile.get("current_term"),
        "profile_version": profile.get("version"),
        "exploration_status": profile.get("exploration_status"),
        "assessment_version": profile.get("assessment_version"),
        "answers": answers,
        "scores": scores,
        "profile_signals": {
            "answered_question_count": len(answers),
            "interests_ranked": interests,
            "abilities_ranked": abilities,
            "values_ranked": values,
            "work_styles": work_styles,
            "experience": experience if isinstance(experience, dict) else None,
        },
    }
    if preferences:
        summary["preferences"] = {key: preferences[key] for key in sorted(preferences)}
    return summary


def profile_context_coverage(profile: Mapping[str, Any] | None) -> dict[str, Any]:
    """Return a data-driven coverage check used before model generation."""

    if not profile:
        return {
            "answered_question_count": 0,
            "interest_dimension_count": 0,
            "ability_dimension_count": 0,
            "signal_dimension_count": 0,
        }
    answers = profile.get("answers") if isinstance(profile.get("answers"), dict) else {}
    scores = profile.get("scores") if isinstance(profile.get("scores"), dict) else {}
    interest_dimensions = {key for key in scores if str(key).startswith("interest_")}
    ability_dimensions = {key for key in scores if str(key).startswith("ability_")}
    return {
        "answered_question_count": len(answers),
        "interest_dimension_count": len(interest_dimensions),
        "ability_dimension_count": len(ability_dimensions),
        "signal_dimension_count": len(interest_dimensions | ability_dimensions),
    }


def validate_profile_context(profile: Mapping[str, Any] | None) -> None:
    """Reject impossible "画像未提供" contexts before the model is called.

    A completed 16-item profile must carry both answers and computed
    interest/ability dimensions. This catches the exact regression observed in
    production where ``profile_summary`` dropped the questionnaire payload.
    """

    coverage = profile_context_coverage(profile)
    if coverage["answered_question_count"] < EXPECTED_REQUIRED_ANSWERS:
        return
    if (
        coverage["interest_dimension_count"] > 0
        and coverage["ability_dimension_count"] > 0
    ):
        return
    raise OutputValidationError(
        "画像上下文不完整",
        reasons=["profile_context_missing_interest_or_ability_dimensions"],
    )


def evidence_allowed_urls(evidence: Sequence[Mapping[str, Any]]) -> list[str]:
    return [str(item.get("canonical_url") or "") for item in evidence if item.get("canonical_url")]


def evidence_texts(evidence: Sequence[Mapping[str, Any]]) -> list[str]:
    return [str(item.get("text") or "") for item in evidence]


def require_no_validation_reasons(reasons: Sequence[str], *, what: str) -> None:
    if reasons:
        raise OutputValidationError(f"{what}未通过程序校验", reasons=list(reasons))
