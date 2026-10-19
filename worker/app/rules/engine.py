"""确定性规则引擎。

接口：``RulesEngine.query(direction_id, profile, rules_version) -> PlanResult``

约定：
- 所有数字用 ``Decimal`` 计算，最后按契约输出为 number；资料缺失时 ``credits=null``，绝不写 0。
- 只使用 verified 数据；课程/学分/竞赛/方向要求缺失时返回 ``data_unavailable`` 或
  ``partial``，并给出 gap code 与待核验行动，不编造课程、学分、开课学期或竞赛加分。
- 同输入同版本结果完全确定：输出全部排序，``as_of`` 从 rules_version 的日期推导。
- 模型永远不能改这些事实；它只能解释 action_id / course_id / competition_id 与引用。
"""

from __future__ import annotations

import re
from datetime import date
from decimal import Decimal
from hashlib import sha256
from typing import Any, Mapping, Sequence

from ..config import RULES_VERSION
from ..logging_setup import get_logger, log_event
from ..models import (
    DIRECTION_IDS,
    PlanAction,
    PlanCompetition,
    PlanCourse,
    PlanEffort,
    PlanGap,
    PlanResult,
)
from .repository import RulesRepository, RulesSnapshot

logger = get_logger("worker.rules")

DATE_IN_VERSION_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")
DEFAULT_AS_OF = date(2026, 10, 19)  # rules_version 未带日期时的冻结基准日，保证确定性。
MAX_ACTION_ID = 80
MAX_ACTION_TITLE = 200

LEVEL_LABELS = {
    "required": "必需",
    "preferred": "优先",
    "mentioned": "提及",
}
LEVEL_WINDOWS = {
    "required": "current_term",
    "preferred": "next_term",
    "mentioned": "later",
}


def as_of_from_rules_version(rules_version: str) -> date:
    match = DATE_IN_VERSION_RE.search(rules_version or "")
    if match:
        try:
            return date.fromisoformat(match.group(1))
        except ValueError:
            pass
    return DEFAULT_AS_OF


def _stable_action_id(prefix: str, key: str) -> str:
    candidate = f"{prefix}-{key}"
    if len(candidate) <= MAX_ACTION_ID:
        return candidate
    digest = sha256(key.encode("utf-8")).hexdigest()[:10]
    return f"{prefix}-{digest}"


def _truncate(text: str, limit: int = MAX_ACTION_TITLE) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _decimal_to_number(value: Decimal | None) -> float | None:
    if value is None:
        return None
    # Decimal → float 只发生在契约输出边界；计算过程始终是 Decimal。
    return float(value)


def _safe_profile_version(profile: Mapping[str, Any]) -> int:
    raw = profile.get("version", profile.get("profile_version"))
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return 1
    return value if value >= 1 else 1


def validate_profile(profile: Mapping[str, Any]) -> list[str]:
    reasons: list[str] = []
    if not isinstance(profile, Mapping):
        return ["profile_not_object"]
    if not str(profile.get("school") or "").strip():
        reasons.append("missing_school")
    if not str(profile.get("major") or "").strip():
        reasons.append("missing_major")
    try:
        year = int(profile.get("enrollment_year"))
    except (TypeError, ValueError):
        year = 0
    if not (2010 <= year <= 2035):
        reasons.append("invalid_enrollment_year")
    if not str(profile.get("current_term") or "").strip():
        reasons.append("missing_current_term")
    return reasons


class RulesEngine:
    def __init__(self, repository: RulesRepository, *, rules_version: str = RULES_VERSION) -> None:
        self.repository = repository
        self.rules_version = rules_version

    def query(
        self,
        direction_id: str,
        profile: Mapping[str, Any],
        rules_version: str | None = None,
    ) -> PlanResult:
        version = rules_version or self.rules_version
        as_of = as_of_from_rules_version(version)
        profile_version = _safe_profile_version(profile)
        invalid = validate_profile(profile)
        if invalid:
            return PlanResult(
                status="invalid_profile",
                rules_version=version,
                profile_version=profile_version,
                direction_id=direction_id if direction_id in DIRECTION_IDS else DIRECTION_IDS[0],
                actions=[],
                courses=[],
                competitions=[],
                credits=None,
                gaps=[PlanGap(code="invalid_profile", message="画像字段不完整，规则引擎无法计算", module="profile")],
                evidence=[],
                explanation=None,
                warnings=["profile_invalid:" + ",".join(invalid), f"rules_version={version}", f"as_of={as_of.isoformat()}"],
            )
        if direction_id not in DIRECTION_IDS:
            return PlanResult(
                status="unsupported_direction",
                rules_version=version,
                profile_version=profile_version,
                direction_id=DIRECTION_IDS[0],
                actions=[],
                courses=[],
                competitions=[],
                credits=None,
                gaps=[PlanGap(code="unsupported_direction", message="方向不在产品导航分类内", module="profile")],
                evidence=[],
                explanation=None,
                warnings=[f"unsupported_direction={direction_id}", f"rules_version={version}"],
            )

        snapshot = self.repository.load(
            school=str(profile.get("school") or "").strip(),
            major=str(profile.get("major") or "").strip(),
            enrollment_year=int(profile.get("enrollment_year")),
            direction_id=direction_id,
            rules_version=version,
            as_of=as_of,
        )
        gaps: list[PlanGap] = []
        warnings: list[str] = [f"rules_version={version}", f"as_of={as_of.isoformat()}"]

        courses = list(snapshot.courses)
        competitions = list(snapshot.competitions)
        requirements = list(snapshot.requirements)

        # 先修课程必须指向已核验课程；悬空引用只记录缺口，不补造课程。
        verified_course_ids = {course.course_id for course in courses}
        dangling_prerequisites = sorted(
            {
                prerequisite_id
                for course in courses
                for prerequisite_id in course.prerequisites
                if prerequisite_id not in verified_course_ids
            }
        )
        if dangling_prerequisites:
            gaps.append(
                PlanGap(
                    code="prerequisite_incomplete",
                    message="部分先修课程指向未核验课程：" + "、".join(dangling_prerequisites[:8]),
                    module="courses",
                )
            )
            warnings.append("dangling_prerequisite_ids:" + ",".join(dangling_prerequisites[:8]))

        credits: Decimal | None = None
        missing_credit_courses = sorted(course.course_id for course in courses if course.credits is None)
        if courses and not missing_credit_courses:
            credits = sum((course.credits for course in courses if course.credits is not None), start=Decimal(0))
        elif missing_credit_courses:
            gaps.append(
                PlanGap(
                    code="credits_unavailable",
                    message="已核验课程中仍有学分缺失，无法给出可信的学分合计",
                    module="credits",
                )
            )
            warnings.append("course_credits_missing:" + ",".join(missing_credit_courses[:8]))

        if not courses:
            gaps.append(
                PlanGap(
                    code="curriculum_unavailable",
                    message="尚未取得适用年级的结构化培养方案（课程/学分/开课学期）",
                    module="courses",
                )
            )
        if not snapshot.credit_rules:
            gaps.append(
                PlanGap(
                    code="credit_rules_unavailable",
                    message="尚未核验学分认定规则，不给出可认定学分",
                    module="credits",
                )
            )
        if not competitions:
            gaps.append(
                PlanGap(
                    code="competitions_unavailable",
                    message="尚未核验适用校级竞赛目录与加分认定规则",
                    module="competitions",
                )
            )
        if not requirements:
            gaps.append(
                PlanGap(
                    code="direction_requirements_unavailable",
                    message="尚未核验该方向的能力要求与对应证据来源",
                    module="evidence",
                )
            )

        cycle_nodes = find_prerequisite_cycles(courses)
        if cycle_nodes:
            gaps.append(
                PlanGap(
                    code="prerequisite_cycle",
                    message="先修关系存在环，已按稳定顺序输出并标记待核验",
                    module="courses",
                )
            )
            warnings.append("prerequisite_cycle_detected:" + ",".join(cycle_nodes))

        if not snapshot.has_any_rules:
            status = "data_unavailable"
        elif courses and credits is not None and competitions and requirements:
            status = "ok"
        else:
            status = "partial"
        if status == "ok" and (dangling_prerequisites or cycle_nodes):
            # 先修数据有缺口时最多算 partial，避免把不完整数据当完整结论。
            status = "partial"

        actions = build_actions(
            snapshot=snapshot,
            direction_id=direction_id,
            gaps=gaps,
            rules_version=version,
        )
        if not actions and status != "data_unavailable":
            # 有资料但没有任何可执行项也不应静默空结果。
            gaps.append(
                PlanGap(
                    code="actions_unavailable",
                    message="当前规则版本没有可映射到行动的能力要求",
                    module="evidence",
                )
            )
            status = "partial"

        result = PlanResult(
            status=status,
            rules_version=version,
            profile_version=profile_version,
            direction_id=direction_id,
            actions=actions,
            courses=[
                PlanCourse(
                    course_id=course.course_id,
                    title=course.title,
                    credits=_decimal_to_number(course.credits),
                    offered_terms=list(course.offered_terms),
                    prerequisites=list(course.prerequisites),
                    verification_status=course.verification_status,
                )
                for course in courses
            ],
            competitions=[
                PlanCompetition(
                    competition_id=competition.competition_id,
                    title=competition.title,
                    window=competition.window,
                    verification_status=competition.verification_status,
                )
                for competition in competitions
            ],
            credits=_decimal_to_number(credits),
            gaps=gaps,
            evidence=[],
            explanation=None,
            warnings=warnings,
        )
        log_event(
            logger,
            "rules_query",
            rules_version=version,
            status=status,
            profile_id=None,
        )
        return result


# ---------------------------------------------------------------------------
# 行动生成（确定性、可审计）
# ---------------------------------------------------------------------------


def build_actions(
    *,
    snapshot: RulesSnapshot,
    direction_id: str,
    gaps: Sequence[PlanGap],
    rules_version: str,
) -> list[PlanAction]:
    actions: dict[str, PlanAction] = {}

    # 1) 来自已验证方向要求的能力补强行动。
    for requirement in snapshot.requirements:
        level = requirement.requirement_level if requirement.requirement_level in LEVEL_LABELS else "preferred"
        label = requirement.skill_label or requirement.skill_id
        action_id = _stable_action_id("req", requirement.requirement_id)
        actions[action_id] = PlanAction(
            action_id=action_id,
            title=_truncate(f"补强方向能力：{label}（要求等级：{LEVEL_LABELS[level]}）"),
            direction_id=direction_id,  # type: ignore[arg-type]
            window=LEVEL_WINDOWS[level],  # type: ignore[arg-type]
            effort=PlanEffort(hours=None, basis="unknown"),
            prerequisites=[],
            evidence_ids=[],
            rule_id="career-rule-direction-requirement",
            rules_version=rules_version,
            status="pending_verification",
            user_adjusted=False,
        )

    # 2) 资料缺口对应的核对行动（绝不编造课程/学分/竞赛）。
    gap_actions: dict[str, tuple[str, str, str]] = {
        "curriculum_unavailable": (
            "verify-curriculum",
            "向学院教务核对本专业培养方案（课程、学分与开课学期）",
            "current_term",
        ),
        "credits_unavailable": (
            "verify-credits",
            "核对已修课程学分与学分认定规则",
            "current_term",
        ),
        "credit_rules_unavailable": (
            "verify-credits",
            "核对已修课程学分与学分认定规则",
            "current_term",
        ),
        "competitions_unavailable": (
            "verify-competitions",
            "核对适用的校级竞赛目录与加分认定规则",
            "next_term",
        ),
        "direction_requirements_unavailable": (
            "verify-requirements",
            "核对暂定方向的能力要求与对应证据来源",
            "next_term",
        ),
        "prerequisite_incomplete": (
            "verify-prerequisites",
            "核对先修课程关系与开课顺序",
            "current_term",
        ),
        "prerequisite_cycle": (
            "verify-prerequisites",
            "核对先修课程关系与开课顺序",
            "current_term",
        ),
        "actions_unavailable": (
            "verify-requirements",
            "核对暂定方向的能力要求与对应证据来源",
            "next_term",
        ),
    }
    for gap in gaps:
        mapping = gap_actions.get(gap.code)
        if mapping is None:
            continue
        action_id, title, window = mapping
        if action_id in actions:
            continue
        actions[action_id] = PlanAction(
            action_id=action_id,
            title=title,
            direction_id=direction_id,  # type: ignore[arg-type]
            window=window,  # type: ignore[arg-type]
            effort=PlanEffort(hours=None, basis="unknown"),
            prerequisites=[],
            evidence_ids=[],
            rule_id="career-rule-verify-data",
            rules_version=rules_version,
            status="pending_verification",
            user_adjusted=False,
        )
    return [actions[key] for key in sorted(actions)]


# ---------------------------------------------------------------------------
# 先修环检测
# ---------------------------------------------------------------------------


def find_prerequisite_cycles(courses: Sequence[Any]) -> list[str]:
    """返回处于环上的课程 ID（排序）。用颜色标记 DFS，避免无限递归。"""

    graph: dict[str, list[str]] = {}
    nodes: set[str] = {str(course.course_id) for course in courses}
    for course in courses:
        course_id = str(course.course_id)
        graph[course_id] = sorted({str(item) for item in course.prerequisites if str(item) in nodes})
    color: dict[str, int] = {node: 0 for node in nodes}
    cycle_nodes: set[str] = set()
    stack: list[str] = []

    def visit(node: str) -> None:
        color[node] = 1
        stack.append(node)
        for neighbor in graph.get(node, []):
            if color.get(neighbor, 0) == 0:
                visit(neighbor)
            elif color.get(neighbor) == 1:
                # 找到环：把栈中从 neighbor 开始的部分都标成环上节点。
                try:
                    start = stack.index(neighbor)
                except ValueError:
                    start = 0
                cycle_nodes.update(stack[start:])
        stack.pop()
        color[node] = 2

    for node in sorted(nodes):
        if color.get(node, 0) == 0:
            visit(node)
    return sorted(cycle_nodes)


def plan_result_to_query_dict(result: PlanResult) -> dict[str, Any]:
    """规则引擎的调试视图：``sources`` 与 ``evidence`` 同义（证据由检索层填充）。"""

    from ..models import plan_result_payload

    payload = plan_result_payload(result)
    payload["sources"] = list(payload["evidence"])
    return payload


__all__ = [
    "RulesEngine",
    "as_of_from_rules_version",
    "build_actions",
    "find_prerequisite_cycles",
    "plan_result_to_query_dict",
    "validate_profile",
]
