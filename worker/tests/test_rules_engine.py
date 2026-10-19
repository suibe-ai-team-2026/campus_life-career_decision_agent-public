"""规则引擎测试：确定性、verified-only、缺数据 credits=null、先修环、方向校验。"""

from __future__ import annotations

import copy
import json

from app.models import plan_result_payload
from app.rules.engine import RulesEngine, find_prerequisite_cycles, plan_result_to_query_dict
from app.rules.repository import RuleCourse, StaticRulesRepository
from tests.fakes import load_rules_fixture, make_rules_engine

PROFILE = {
    "version": 1,
    "school": "上海对外经贸大学",
    "major": "国际经济与贸易",
    "enrollment_year": 2023,
    "current_term": "2025-秋",
}


def _engine_with(data: dict) -> RulesEngine:
    return RulesEngine(StaticRulesRepository(data), rules_version="career-rules-2026-10-19.1")


def test_no_verified_data_returns_data_unavailable_and_null_credits():
    engine = _engine_with({})
    result = engine.query("trade_supply_chain", PROFILE)
    assert result.status == "data_unavailable"
    assert result.credits is None
    codes = {gap.code for gap in result.gaps}
    assert "curriculum_unavailable" in codes
    assert "credit_rules_unavailable" in codes
    assert "competitions_unavailable" in codes
    assert "direction_requirements_unavailable" in codes
    # 只给出“去核对”的动作，不编造课程/学分
    assert all(action.status == "pending_verification" for action in result.actions)
    assert result.courses == []
    assert result.competitions == []


def test_happy_path_uses_verified_rows_only_and_decimal_credits():
    engine = make_rules_engine()
    result = engine.query("trade_supply_chain", PROFILE)
    assert result.status == "ok"
    assert result.credits == 5.5  # 3.0 + 2.5，Decimal 求和后序列化
    assert [course.course_id for course in result.courses] == ["CUR001", "CUR002"]
    assert [competition.competition_id for competition in result.competitions] == ["COMP001"]
    assert len(result.actions) == 2
    assert all(action.action_id.startswith("req-") for action in result.actions)
    # partial 状态的课程/未核验竞赛/未核验要求都不应出现
    assert all(course.verification_status == "verified" for course in result.courses)
    assert "REQ003" not in {action.action_id for action in result.actions}
    assert not result.gaps or all(gap.code not in {"curriculum_unavailable"} for gap in result.gaps)


def test_missing_credit_course_forces_null_credits_and_gap():
    data = load_rules_fixture()
    for course in data["courses"]:
        if course["course_id"] == "CUR002":
            course["credits"] = None
    result = _engine_with(data).query("trade_supply_chain", PROFILE)
    assert result.credits is None
    assert "credits_unavailable" in {gap.code for gap in result.gaps}
    assert result.status in {"partial", "data_unavailable"}


def test_result_is_deterministic_for_same_input_and_version():
    engine = make_rules_engine()
    first = plan_result_payload(engine.query("trade_supply_chain", PROFILE))
    second = plan_result_payload(engine.query("trade_supply_chain", PROFILE))
    assert first == second
    assert first["actions"] == sorted(first["actions"], key=lambda action: action["action_id"])


def test_prerequisite_cycle_is_detected_without_infinite_recursion():
    data = load_rules_fixture()
    data["prerequisites"].append(
        {
            "course_id": "CUR001",
            "prerequisite_id": "CUR002",
            "relation_type": "required",
            "rule_version": "career-rules-2026-10-19.1",
        }
    )
    result = _engine_with(data).query("trade_supply_chain", PROFILE)
    codes = {gap.code for gap in result.gaps}
    assert "prerequisite_cycle" in codes
    assert result.status == "partial"
    assert any("prerequisite_cycle_detected" in warning for warning in result.warnings)

    courses = [
        RuleCourse(course_id="A", title="A", credits=None, offered_terms=(), prerequisites=("B",)),
        RuleCourse(course_id="B", title="B", credits=None, offered_terms=(), prerequisites=("A",)),
    ]
    assert find_prerequisite_cycles(courses) == ["A", "B"]


def test_credit_rule_validity_follows_rules_version_date():
    data = load_rules_fixture()
    for rule in data["credit_rules"]:
        if rule["rule_id"] == "CR001":
            rule["valid_to"] = "2026-12-31"
    result = _engine_with(data).query(
        "trade_supply_chain",
        PROFILE,
        rules_version="career-rules-2027-03-01.1",
    )
    assert result.rules_version == "career-rules-2027-03-01.1"
    assert "credit_rules_unavailable" in {gap.code for gap in result.gaps}


def test_unsupported_direction_and_invalid_profile_statuses():
    engine = make_rules_engine()
    assert engine.query("unknown_direction", PROFILE).status == "unsupported_direction"
    bad_profile = {"school": "", "major": "", "enrollment_year": 1900, "current_term": ""}
    result = engine.query("trade_supply_chain", bad_profile)
    assert result.status == "invalid_profile"
    assert result.credits is None
    assert result.profile_version >= 1

def test_query_dict_exposes_sources_alias_for_debugging():
    result = make_rules_engine().query("trade_supply_chain", PROFILE)
    payload = plan_result_to_query_dict(result)
    assert payload["sources"] == payload["evidence"]
    assert payload["status"] == "ok"
