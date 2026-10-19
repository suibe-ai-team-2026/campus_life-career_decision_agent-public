"""规则数据读取：只使用 ``status='verified'`` 的行。

两条实现：
- ``SupabaseRulesRepository``：正式部署，读 app_courses / app_prerequisites /
  app_credit_rules / app_competitions / app_direction_requirements（按 run owner 无关，
  规则数据是共享只读参考数据）；
- ``StaticRulesRepository``：测试用合成 fixture（只放 worker/tests/fixtures，不进正式库）。

没有 verified 数据时返回空快照，由引擎输出 ``data_unavailable`` 与 gap code，
绝不回退到模型知识或编造课程/学分。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping, Protocol

from ..db import SupabaseDb


@dataclass(frozen=True)
class RuleCourse:
    course_id: str
    title: str
    credits: Decimal | None
    offered_terms: tuple[str, ...]
    prerequisites: tuple[str, ...]
    verification_status: str = "verified"


@dataclass(frozen=True)
class RuleCompetition:
    competition_id: str
    title: str
    window: str | None
    verification_status: str = "verified"


@dataclass(frozen=True)
class RuleCreditRule:
    rule_id: str
    category: str
    cap: Decimal | None
    valid_from: date | None
    valid_to: date | None
    status: str = "verified"


@dataclass(frozen=True)
class RuleRequirement:
    requirement_id: str
    direction_id: str
    skill_id: str
    skill_label: str
    requirement_level: str
    verification_status: str = "verified"


@dataclass(frozen=True)
class RulesSnapshot:
    rules_version: str
    as_of: date
    school: str
    major: str
    enrollment_year: int
    courses: tuple[RuleCourse, ...] = ()
    competitions: tuple[RuleCompetition, ...] = ()
    credit_rules: tuple[RuleCreditRule, ...] = ()
    requirements: tuple[RuleRequirement, ...] = ()
    requirement_actions: Mapping[str, tuple[str, ...]] = field(default_factory=dict)

    @property
    def has_any_rules(self) -> bool:
        return bool(self.courses or self.competitions or self.credit_rules or self.requirements)


class RulesRepository(Protocol):
    def load(
        self,
        *,
        school: str,
        major: str,
        enrollment_year: int,
        direction_id: str,
        rules_version: str,
        as_of: date,
    ) -> RulesSnapshot: ...


def _decimal_or_none(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _date_or_none(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


class SupabaseRulesRepository:
    def __init__(self, db: SupabaseDb) -> None:
        self.db = db

    def load(
        self,
        *,
        school: str,
        major: str,
        enrollment_year: int,
        direction_id: str,
        rules_version: str,
        as_of: date,
    ) -> RulesSnapshot:
        course_rows = self.db.list_verified_courses(school=school, major=major, enrollment_year=enrollment_year)
        course_ids = [str(row["course_id"]) for row in course_rows if row.get("course_id")]
        prerequisite_rows = self.db.list_verified_prerequisites(course_ids, rules_version=rules_version) if course_ids else []
        competitions = self.db.list_verified_competitions()
        credit_rules = self.db.list_verified_credit_rules(school=school, enrollment_year=enrollment_year)
        requirement_rows = self.db.list_verified_direction_requirements(direction_id)
        requirement_ids = [str(row["requirement_id"]) for row in requirement_rows if row.get("requirement_id")]
        action_rows = self.db.list_verified_requirement_actions(requirement_ids) if requirement_ids else []
        return build_snapshot(
            rules_version=rules_version,
            as_of=as_of,
            school=school,
            major=major,
            enrollment_year=enrollment_year,
            course_rows=course_rows,
            prerequisite_rows=prerequisite_rows,
            competition_rows=competitions,
            credit_rule_rows=credit_rules,
            requirement_rows=requirement_rows,
            requirement_action_rows=action_rows,
        )


class StaticRulesRepository:
    """测试夹具仓库：输入与数据库行同形，只按 status 过滤。"""

    def __init__(self, data: Mapping[str, Any]) -> None:
        self.data = dict(data)

    def load(
        self,
        *,
        school: str,
        major: str,
        enrollment_year: int,
        direction_id: str,
        rules_version: str,
        as_of: date,
    ) -> RulesSnapshot:
        course_rows = [
            row
            for row in self.data.get("courses", [])
            if row.get("school") == school
            and row.get("major") == major
            and int(row.get("enrollment_year") or 0) == int(enrollment_year)
        ]
        course_ids = {str(row["course_id"]) for row in course_rows if row.get("course_id")}
        prerequisite_rows = [
            row
            for row in self.data.get("prerequisites", [])
            if str(row.get("course_id")) in course_ids and str(row.get("rule_version")) == rules_version
        ]
        competition_rows = list(self.data.get("competitions", []))
        credit_rule_rows = [
            row
            for row in self.data.get("credit_rules", [])
            if row.get("school") == school and int(row.get("enrollment_year") or 0) == int(enrollment_year)
        ]
        requirement_rows = [
            row for row in self.data.get("direction_requirements", []) if row.get("direction_id") == direction_id
        ]
        requirement_ids = {str(row["requirement_id"]) for row in requirement_rows if row.get("requirement_id")}
        action_rows = [
            row
            for row in self.data.get("requirement_actions", [])
            if str(row.get("requirement_id")) in requirement_ids
        ]
        return build_snapshot(
            rules_version=rules_version,
            as_of=as_of,
            school=school,
            major=major,
            enrollment_year=enrollment_year,
            course_rows=course_rows,
            prerequisite_rows=prerequisite_rows,
            competition_rows=competition_rows,
            credit_rule_rows=credit_rule_rows,
            requirement_rows=requirement_rows,
            requirement_action_rows=action_rows,
        )


def build_snapshot(
    *,
    rules_version: str,
    as_of: date,
    school: str,
    major: str,
    enrollment_year: int,
    course_rows: list[dict[str, Any]],
    prerequisite_rows: list[dict[str, Any]],
    competition_rows: list[dict[str, Any]],
    credit_rule_rows: list[dict[str, Any]],
    requirement_rows: list[dict[str, Any]],
    requirement_action_rows: list[dict[str, Any]],
) -> RulesSnapshot:
    verified_courses = [row for row in course_rows if str(row.get("status") or "") == "verified"]
    prerequisites: dict[str, list[str]] = {}
    for row in prerequisite_rows:
        if str(row.get("status") or "verified") not in ("verified", ""):
            # app_prerequisites 没有 status 列；未知状态按未核验处理，避免误用。
            continue
        course_id = str(row.get("course_id") or "")
        prerequisite_id = str(row.get("prerequisite_id") or "")
        if not course_id or not prerequisite_id:
            continue
        prerequisites.setdefault(course_id, []).append(prerequisite_id)

    courses = tuple(
        RuleCourse(
            course_id=str(row["course_id"]),
            title=str(row.get("title") or ""),
            credits=_decimal_or_none(row.get("credits")),
            offered_terms=tuple(str(term) for term in (row.get("offered_terms") or [])),
            prerequisites=tuple(sorted(set(prerequisites.get(str(row["course_id"]), [])))),
            verification_status="verified",
        )
        for row in sorted(verified_courses, key=lambda item: str(item.get("course_id")))
        if row.get("course_id")
    )
    competitions = tuple(
        RuleCompetition(
            competition_id=str(row["competition_id"]),
            title=str(row.get("title") or ""),
            window=None if row.get("application_window") is None else str(row.get("application_window")),
            verification_status="verified",
        )
        for row in sorted(competition_rows, key=lambda item: str(item.get("competition_id")))
        if str(row.get("status") or "") == "verified" and row.get("competition_id")
    )
    credit_rules = tuple(
        RuleCreditRule(
            rule_id=str(row["rule_id"]),
            category=str(row.get("category") or ""),
            cap=_decimal_or_none(row.get("cap")),
            valid_from=_date_or_none(row.get("valid_from")),
            valid_to=_date_or_none(row.get("valid_to")),
            status="verified",
        )
        for row in sorted(credit_rule_rows, key=lambda item: str(item.get("rule_id")))
        if str(row.get("status") or "") == "verified"
        and row.get("rule_id")
        and _valid_on(row, as_of)
    )
    requirements = tuple(
        RuleRequirement(
            requirement_id=str(row["requirement_id"]),
            direction_id=str(row.get("direction_id") or ""),
            skill_id=str(row.get("skill_id") or ""),
            skill_label=str(row.get("skill_label") or ""),
            requirement_level=str(row.get("requirement_level") or "preferred"),
            verification_status="verified",
        )
        for row in sorted(requirement_rows, key=lambda item: str(item.get("requirement_id")))
        if str(row.get("status") or "") == "verified" and row.get("requirement_id")
    )
    action_map: dict[str, list[str]] = {}
    for row in requirement_action_rows:
        if str(row.get("mapping_status") or "") != "verified":
            continue
        requirement_id = str(row.get("requirement_id") or "")
        action_id = str(row.get("action_id") or "")
        if requirement_id and action_id:
            action_map.setdefault(requirement_id, []).append(action_id)
    requirement_actions = {key: tuple(sorted(set(value))) for key, value in sorted(action_map.items())}
    return RulesSnapshot(
        rules_version=rules_version,
        as_of=as_of,
        school=school,
        major=major,
        enrollment_year=enrollment_year,
        courses=courses,
        competitions=competitions,
        credit_rules=credit_rules,
        requirements=requirements,
        requirement_actions=requirement_actions,
    )


def _valid_on(row: dict[str, Any], as_of: date) -> bool:
    valid_from = _date_or_none(row.get("valid_from"))
    valid_to = _date_or_none(row.get("valid_to"))
    if valid_from is not None and as_of < valid_from:
        return False
    if valid_to is not None and as_of > valid_to:
        return False
    return True
