"""参考数据完整性 + 规划覆盖测试。

目标：只要用户是上经贸常见专业，方案里就有课程/竞赛/校内资源/就业数据，
不出现「没有对应专业的资料」的空结果；所有事实都必须带来源与核验状态。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app import reference
from app.graphs.ask import numbered_reference_hits
from app.planning import build_planning_blueprint

DATA_DIR = Path(__file__).resolve().parents[1] / "app" / "reference_data"
REQUIRED_FILES = ("schools.json", "employment.json", "curriculum.json", "competitions.json", "major-map.json", "resources.json")
DATA_READY = all((DATA_DIR / name).exists() for name in REQUIRED_FILES)

pytestmark = pytest.mark.skipif(not DATA_READY, reason="reference data files are not ready yet")


def _load(name: str) -> dict[str, Any]:
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


def _profile(major: str, *, year: int = 2026, term: str = "2026-秋", skills: dict[str, float] | None = None) -> dict[str, Any]:
    return {
        "version": 1,
        "school": "上海对外经贸大学",
        "major": major,
        "enrollment_year": year,
        "current_term": term,
        "answers": {
            "i_r": 4,
            "i_i": 3,
            "v_top3": ["growth", "collaboration"],
            "a_communication": 4,
            "w_approach": "discuss_first",
            "exp_optional": {"text": "课程小组项目", "tags": ["ability_communication", "ability_execution"]},
        },
        "scores": skills or {
            "ability_research": 0.6,
            "ability_data": 0.5,
            "ability_writing": 0.5,
            "ability_communication": 0.8,
            "ability_execution": 0.7,
            "ability_digital": 0.4,
        },
        "preferences": {
            "pathway": {
                "primary": "undergraduate_employment",
                "alternatives": ["domestic_postgraduate"],
                "accepts_competition": True,
                "accepts_certificate": True,
                "accepts_long_internship": True,
                "target_cities": ["上海"],
            }
        },
    }


MAJORS = [
    "国际经济与贸易（全英语）",
    "金融学",
    "会计学",
    "财务管理",
    "审计学",
    "电子商务",
    "工商管理",
    "法学",
    "商务英语",
    "数据科学与大数据技术",
    "投资学",
    "经济学",
    "旅游管理",
    "文化产业管理",
    "国际政治",
    "会展经济与管理",
]

DIRECTIONS = [
    "trade_supply_chain",
    "cross_border_business",
    "finance_accounting",
    "data_business",
    "public_service",
    "further_study",
]


def test_reference_files_parse_and_have_provenance():
    for name in REQUIRED_FILES:
        data = _load(name)
        assert isinstance(data, dict), name
    facts = _load("employment.json")["facts"]
    assert facts, "employment facts must not be empty"
    for fact in facts:
        assert fact.get("metric_name") and fact.get("cohort")
        assert fact.get("source_title")
        assert fact.get("quote"), f"fact {fact.get('fact_id')} missing quote"
        assert fact.get("verification_status") in {"pending", "official_lead", "external_reference"}

    competitions = _load("competitions.json")["competitions"]
    assert len(competitions) >= 20
    ids = [item.get("competition_id") for item in competitions]
    assert len(ids) == len(set(ids)), "competition_id must be unique"
    official = [item for item in competitions if (item.get("school_recognition") or {}).get("status") == "official_lead"]
    assert len(official) >= 20, "official SUIBE reward list should be merged"
    for item in official:
        level = (item.get("school_recognition") or {}).get("official_level")
        assert level in {"A", "B", "C", None}

    curricula = _load("curriculum.json")["majors"]
    assert len(curricula) >= 8, "curriculum should cover common SUIBE majors"
    for entry in curricula:
        assert entry.get("courses"), f"{entry.get('major_key')} has no courses"

    resources = _load("resources.json")["resources"]
    assert len(resources) >= 8
    for item in resources:
        assert str(item.get("url") or "").startswith("http")


@pytest.mark.parametrize("major", MAJORS)
@pytest.mark.parametrize("direction", DIRECTIONS)
def test_planning_never_returns_empty_leads_for_suibe_majors(major: str, direction: str):
    profile = _profile(major)
    blueprint = build_planning_blueprint(profile, direction)
    assert blueprint.course_leads, f"{major}/{direction} course leads empty"
    assert blueprint.competition_leads, f"{major}/{direction} competition leads empty"
    assert blueprint.campus_resources, f"{major}/{direction} campus resources empty"
    assert blueprint.campus_facts, f"{major}/{direction} campus facts empty"
    for lead in [*blueprint.course_leads, *blueprint.competition_leads, *blueprint.campus_resources, *blueprint.campus_facts]:
        assert lead.title.strip()
        assert lead.source_label.strip()
        assert lead.verification_status in {"known", "official_lead", "external_reference", "pending_verification", "data_missing"}
        if lead.source_url:
            assert lead.source_url.startswith("http")


def test_competition_recommendations_are_major_and_direction_aware():
    trade = build_planning_blueprint(_profile("国际经济与贸易（全英语）"), "trade_supply_chain")
    finance = build_planning_blueprint(_profile("金融学"), "finance_accounting")
    assert trade.competition_leads and finance.competition_leads
    trade_ids = {lead.title for lead in trade.competition_leads}
    finance_ids = {lead.title for lead in finance.competition_leads}
    assert trade_ids != finance_ids


def test_reference_search_answers_common_intents():
    competition_hits = reference.search("有哪些适合国贸专业参加的竞赛？", limit=4)
    assert competition_hits
    assert any("竞赛" in str(item.get("text")) or "赛" in str(item.get("title")) for item in competition_hits)

    course_hits = reference.search("国际经济与贸易专业的培养方案有哪些课程？", limit=4)
    assert course_hits

    employment_hits = reference.search("上经贸2024届毕业生就业去向怎么样？", limit=4)
    assert employment_hits


def test_reference_hits_become_citations():
    hits = reference.search("有哪些竞赛可以加分？", limit=3)
    assert hits
    evidence, citations = numbered_reference_hits(hits, start_no=5)
    assert evidence and citations
    assert evidence[0]["citation_no"] == 5
    assert citations[0].citation_no == 5
    assert citations[0].source_scope == "reference_data"
    assert citations[0].title


def test_graduate_recommendation_rules_are_available():
    doc = _load("graduate_recommendation.json")
    assert doc.get("competition_points")
    assert len(doc.get("academic_rank_points") or []) >= 6
    hits = reference.search("保研竞赛加分怎么算？", limit=4)
    assert any(item["kind"] == "recommendation" for item in hits), hits
    hint = reference.competition_points_hint("A")
    assert "推免" in hint and "20" in hint


def test_competition_leads_mention_recommendation_points():
    blueprint = build_planning_blueprint(_profile("金融学"), "finance_accounting")
    leads = list(blueprint.competition_leads)
    assert leads
    assert any("推免" in (lead.description or "") for lead in leads), [lead.description for lead in leads[:3]]
