"""与 TypeScript 契约对齐的 Pydantic 模型。

事实（规则引擎输出）与解释（模型输出）严格分离：
- ``PlanResult`` 的课程/学分/竞赛/行动只能由规则引擎生成，模型不得新增或改数；
- ``Citation`` 的编号由服务端分配，模型只能引用已有编号。

契约来源：``src/lib/contracts/{common,run,plan}.ts``。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

DIRECTION_IDS = (
    "trade_supply_chain",
    "cross_border_business",
    "finance_accounting",
    "data_business",
    "public_service",
    "further_study",
)
DirectionId = Literal[
    "trade_supply_chain",
    "cross_border_business",
    "finance_accounting",
    "data_business",
    "public_service",
    "further_study",
]
PlanStatus = Literal["ok", "partial", "data_unavailable", "unsupported_direction", "invalid_profile"]
TimeWindow = Literal["current_term", "next_term", "later"]
EffortBasis = Literal["official_requirement", "team_estimate", "user_estimate", "unknown"]
ActionStatus = Literal["suggested", "pending_verification", "verified", "user_modified"]
RunKind = Literal["assessment_explain", "compare", "plan", "ask", "export", "ingest"]

RUN_KINDS: tuple[str, ...] = ("assessment_explain", "compare", "plan", "ask", "export", "ingest")


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Citation(ContractModel):
    citation_no: int = Field(gt=0)
    source_id: str
    source_version_id: str
    chunk_id: str
    record_id: str | None = None
    title: str
    locator: dict[str, Any] = Field(default_factory=dict)
    excerpt: str
    verification_status: str
    source_scope: str


class PlanEffort(ContractModel):
    hours: float | None = None
    basis: EffortBasis = "unknown"
    note: str | None = Field(default=None, max_length=300)

    @field_validator("hours")
    @classmethod
    def _hours_positive(cls, value: float | None) -> float | None:
        if value is not None and value <= 0:
            raise ValueError("effort.hours 必须为正数或 null")
        return value


class PlanAction(ContractModel):
    action_id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=200)
    direction_id: DirectionId
    window: TimeWindow
    effort: PlanEffort
    prerequisites: list[str] = Field(default_factory=list, max_length=50)
    evidence_ids: list[str] = Field(default_factory=list, max_length=50)
    rule_id: str | None = None
    rules_version: str
    status: ActionStatus = "suggested"
    user_adjusted: bool = False


class PlanCourse(ContractModel):
    course_id: str
    title: str
    credits: float | None = None
    offered_terms: list[str] = Field(default_factory=list)
    prerequisites: list[str] = Field(default_factory=list)
    verification_status: str


class PlanCompetition(ContractModel):
    competition_id: str
    title: str
    window: str | None = None
    verification_status: str


class PlanGap(ContractModel):
    code: str
    message: str
    module: Literal["courses", "competitions", "credits", "evidence", "profile"] | None = None


class PlanResult(ContractModel):
    status: PlanStatus
    rules_version: str
    profile_version: int = Field(ge=1)
    direction_id: DirectionId
    actions: list[PlanAction] = Field(default_factory=list)
    courses: list[PlanCourse] = Field(default_factory=list)
    competitions: list[PlanCompetition] = Field(default_factory=list)
    credits: float | None = None
    gaps: list[PlanGap] = Field(default_factory=list)
    evidence: list[Citation] = Field(default_factory=list)
    explanation: str | None = None
    warnings: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# 契约序列化：显式控制 null / 缺省，避免把 TS 的 optional 写成 null 触发前端校验失败
# ---------------------------------------------------------------------------


def citation_payload(citation: Citation) -> dict[str, Any]:
    return {
        "citation_no": citation.citation_no,
        "source_id": citation.source_id,
        "source_version_id": citation.source_version_id,
        "chunk_id": citation.chunk_id,
        "record_id": citation.record_id,
        "title": citation.title,
        "locator": citation.locator,
        "excerpt": citation.excerpt,
        "verification_status": citation.verification_status,
        "source_scope": citation.source_scope,
    }


def action_payload(action: PlanAction) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "action_id": action.action_id,
        "title": action.title,
        "direction_id": action.direction_id,
        "window": action.window,
        "effort": {"hours": action.effort.hours, "basis": action.effort.basis},
        "prerequisites": list(action.prerequisites),
        "evidence_ids": list(action.evidence_ids),
        "rules_version": action.rules_version,
        "status": action.status,
        "user_adjusted": bool(action.user_adjusted),
    }
    if action.rule_id is not None:
        payload["rule_id"] = action.rule_id
    if action.effort.note is not None:
        payload["effort"]["note"] = action.effort.note
    return payload


def plan_result_payload(result: PlanResult) -> dict[str, Any]:
    """生成严格符合 ``PlanResultSchema`` 的 JSON（含必要 null 键）。"""

    return {
        "status": result.status,
        "rules_version": result.rules_version,
        "profile_version": result.profile_version,
        "direction_id": result.direction_id,
        "actions": [action_payload(action) for action in result.actions],
        "courses": [
            {
                "course_id": course.course_id,
                "title": course.title,
                "credits": course.credits,
                "offered_terms": list(course.offered_terms),
                "prerequisites": list(course.prerequisites),
                "verification_status": course.verification_status,
            }
            for course in result.courses
        ],
        "competitions": [
            {
                "competition_id": competition.competition_id,
                "title": competition.title,
                "window": competition.window,
                "verification_status": competition.verification_status,
            }
            for competition in result.competitions
        ],
        "credits": result.credits,
        "gaps": [
            (
                {"code": gap.code, "message": gap.message}
                if gap.module is None
                else {"code": gap.code, "message": gap.message, "module": gap.module}
            )
            for gap in result.gaps
        ],
        "evidence": [citation_payload(citation) for citation in result.evidence],
        "explanation": result.explanation,
        "warnings": list(result.warnings),
    }


# ---------------------------------------------------------------------------
# run.input（由 BFF 写入）
# ---------------------------------------------------------------------------


class RunInputBase(ContractModel):
    profile_id: str | None = None
    direction_id: str | None = None
    plan_id: str | None = None


class PlanInput(RunInputBase):
    pass


class AskInput(RunInputBase):
    question: str = Field(min_length=2, max_length=1000)
    history: list[dict[str, str]] = Field(default_factory=list, max_length=4)
    source_version_ids: list[str] | None = Field(default=None, max_length=20)


class ExportInput(RunInputBase):
    plan_version_id: str | None = None


class CompareInput(RunInputBase):
    direction_ids: list[str] = Field(default_factory=list, max_length=6)


class AssessmentInput(RunInputBase):
    pass


class IngestInput(RunInputBase):
    source_version_id: str | None = None
    source_version_ids: list[str] | None = None

    def version_ids(self) -> list[str]:
        if self.source_version_ids:
            return list(self.source_version_ids)
        return [self.source_version_id] if self.source_version_id else []


# ---------------------------------------------------------------------------
# app_run_results.payload（lead 补充契约，前端按此实现）
# ---------------------------------------------------------------------------


class PlanRunResult(ContractModel):
    plan_id: str
    version_id: str
    version: int
    result: PlanResult


class AskRunResult(ContractModel):
    answer: str
    citations: list[Citation] = Field(default_factory=list)
    refusal: bool = False
    refusal_reason: str | None = None
    boundary_note: str | None = None


class ArtifactInfo(ContractModel):
    artifact_id: str
    bytes: int
    sha256: str
    expires_at: str | None = None


class ExportRunResult(ContractModel):
    artifact_id: str
    plan_id: str
    plan_version_id: str
    artifact: ArtifactInfo


class AssessmentDimension(ContractModel):
    dimension: str
    title: str
    score: float | None
    answered: int
    total: int
    descriptive: str = ""


class AssessmentRunResult(ContractModel):
    explanation: str
    dimensions: list[AssessmentDimension] = Field(default_factory=list)


class CompareRunResult(ContractModel):
    comparison: str
    direction_ids: list[str] = Field(default_factory=list)
    evidence: list[Citation] | None = None


class IngestRunResult(ContractModel):
    source_id: str
    source_version_id: str
    chunks: int
    documents: int
    parser_version: str
    extraction_status: str


# ---------------------------------------------------------------------------
# 内部数据结构
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ClaimedJob:
    job_id: str
    run_id: str
    owner_id: str
    kind: str
    input: dict[str, Any]
    profile_version: int | None
    attempts: int
    max_attempts: int
    lease_epoch: int

    @classmethod
    def from_rpc_row(cls, row: dict[str, Any]) -> "ClaimedJob":
        return cls(
            job_id=str(row["job_id"]),
            run_id=str(row["run_id"]),
            owner_id=str(row["owner_id"]),
            kind=str(row["kind"]),
            input=dict(row.get("input") or {}),
            profile_version=row.get("profile_version"),
            attempts=int(row.get("attempts") or 0),
            max_attempts=int(row.get("max_attempts") or 3),
            lease_epoch=int(row.get("lease_epoch") or 0),
        )


@dataclass(frozen=True)
class ModelUsage:
    provider: str
    model: str
    operation: str
    input_tokens: int | None
    output_tokens: int | None
    latency_ms: int
    estimated_cost: Decimal | None = None
    currency: str = "USD"
    pricing_snapshot_at: datetime | None = None

    def as_app_usage_row(self, *, owner_id: str | None, run_id: str | None) -> dict[str, Any]:
        return {
            "owner_id": owner_id,
            "run_id": run_id,
            "provider": self.provider,
            "model": self.model,
            "operation": self.operation,
            # token 未知写 NULL，不写 0。
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "estimated_cost": None if self.estimated_cost is None else str(self.estimated_cost),
            "currency": self.currency,
            "pricing_snapshot_at": self.pricing_snapshot_at.isoformat() if self.pricing_snapshot_at else None,
        }


@dataclass(frozen=True)
class EmbeddingProfile:
    profile_id: str
    provider: str
    model: str
    dimensions: int
    normalization: str
    query_template_version: str
    splitter_version: str
    status: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class UsageTotals:
    spent_usd: Decimal | None
    unknown_cost_usage_count: int


def new_uuid() -> str:
    return str(uuid.uuid4())
