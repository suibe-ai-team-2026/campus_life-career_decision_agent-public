"""确定性规划蓝图测试：路线硬约束、学校试点线索与四年路线。"""

from __future__ import annotations

import pytest

from app.errors import OutputValidationError
from app.graphs.common import profile_summary, validate_profile_context
from app.planning import (
    build_planning_blueprint,
    build_roadmap,
    direction_exclusion_reason,
)


def _profile(**overrides):
    values = {
        "version": 1,
        "school": "上海对外经贸大学",
        "major": "国际经济与贸易",
        "enrollment_year": 2026,
        "current_term": "2026-秋",
        "answers": {
            "i_r": 4,
            "i_i": 2,
            "i_a": 3,
            "v_top3": ["growth", "collaboration"],
            "a_communication": 5,
            "w_approach": "discuss_first",
            "exp_optional": {"text": "合成经历", "tags": ["ability_communication"]},
        },
        "scores": {
            "interest_r": 0.8,
            "interest_i": 0.2,
            "ability_communication": 0.9,
            "ability_execution": 0.8,
            "ability_data": 0.25,
        },
        "preferences": {
            "pathway": {
                "primary": "undergraduate_employment",
                "alternatives": ["domestic_postgraduate"],
                "excluded_directions": ["public_service"],
                "excluded_sectors": ["public_sector"],
                "target_cities": ["上海"],
                "practice_orientation": "practice",
                "accepts_cross_major": True,
                "accepts_certificate": True,
                "accepts_competition": True,
                "accepts_long_internship": True,
            }
        },
    }
    values.update(overrides)
    return values


def test_profile_summary_keeps_signals_and_experience_tags():
    summary = profile_summary(_profile())

    assert summary["answers"]["a_communication"] == 5
    assert summary["scores"]["ability_communication"] == 0.9
    assert summary["profile_signals"]["interests_ranked"][0]["key"] == "r"
    assert summary["profile_signals"]["abilities_ranked"][0]["key"] == "communication"
    assert summary["profile_signals"]["abilities_ranked"][0]["evidence"] == "supported"
    assert summary["profile_signals"]["experience"]["tags"] == ["ability_communication"]


def test_completed_questionnaire_without_dimension_scores_is_rejected():
    profile = _profile(
        answers={f"q{index}": 3 for index in range(16)},
        scores={},
    )
    with pytest.raises(OutputValidationError) as exc:
        validate_profile_context(profile)
    assert "profile_context_missing_interest_or_ability_dimensions" in exc.value.reasons


def test_direction_exclusion_respects_explicit_profile_constraint():
    assert "排除" in (direction_exclusion_reason("public_service", _profile()) or "")
    assert direction_exclusion_reason("cross_border_business", _profile()) is None


def test_planning_blueprint_is_deterministic_and_complete_for_suibe_trade_pilot():
    profile = _profile()
    first = build_planning_blueprint(profile, "trade_supply_chain")
    second = build_planning_blueprint(profile, "trade_supply_chain")

    assert first == second
    assert first.pathway.primary == "undergraduate_employment"
    assert first.pathway.label == "本科就业"
    assert "体制内 / 政审类岗位" in first.pathway.excluded
    assert len(first.course_leads) >= 3
    assert len(first.competition_leads) >= 3
    assert len(first.campus_resources) >= 5
    assert first.roadmap[0].stage == "未来 30 天"
    assert {lead.verification_status for lead in first.course_leads} == {"official_lead"}
    assert "上经贸第二学堂" in {lead.title for lead in first.campus_resources}


def test_competing_and_long_internship_constraints_change_plan_actions():
    profile = _profile()
    prefs = dict(profile["preferences"])
    pathway = dict(prefs["pathway"])
    pathway.update({"accepts_competition": False, "accepts_long_internship": False})
    prefs["pathway"] = pathway
    profile["preferences"] = prefs

    blueprint = build_planning_blueprint(profile, "trade_supply_chain")
    assert blueprint.competition_leads == ()
    assert any("不接受长期实习" in action for action in blueprint.roadmap[1].actions)


def test_excluded_primary_pathway_falls_back_without_presenting_it_as_leading():
    profile = _profile()
    prefs = dict(profile["preferences"])
    pathway = dict(prefs["pathway"])
    pathway["primary"] = "public_exam"
    prefs["pathway"] = pathway
    profile["preferences"] = prefs

    blueprint = build_planning_blueprint(profile, "trade_supply_chain")
    assert blueprint.pathway.primary == "undergraduate_employment"
    assert blueprint.pathway.label == "本科就业"
    assert "体制内 / 政审类岗位" in blueprint.pathway.excluded


def test_roadmap_uses_grade_and_weakest_ability():
    stages = build_roadmap("trade_supply_chain", _profile())
    first_30_days = stages[0]
    assert first_30_days.stage == "未来 30 天"
    assert any("沟通协作" in action for action in first_30_days.actions)
    assert any("数据理解与分析" in action for action in first_30_days.actions)
