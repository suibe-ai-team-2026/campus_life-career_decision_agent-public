"""表达层（Voice & Confidence）测试：确定语气、去 AI 味、引用不被破坏。

覆盖：
- 所有确定性兜底文案 ``find_hedges() == []``；
- 每个 system prompt 都拼入 ``VOICE_CONTRACT``；
- ``sanitize_prose`` 清理 AI 腔但保留 ``[n]`` 引用与数字；
- 生成侧：模型 answer 命中自我削弱表达时走 voice 修复，修复失败改为确定性自信文案。
"""

from __future__ import annotations

import json

from app.graphs.ask import run_ask
from app.prompts import career, validate
from app.prompts import voice as prompt_voice
from tests.fakes import FakeDb, FakeProvider, make_claim, make_config, make_context

OWNER = "11111111-1111-1111-1111-111111111111"


def _evidence_row(*, text: str, score: float = 0.1) -> dict:
    return {
        "branch": "dense",
        "chunk_id": "88888888-8888-8888-8888-888888888888",
        "source_version_id": "77777777-7777-7777-7777-777777777777",
        "source_id": "source-1",
        "title": "合成测试来源：就业质量报告样例",
        "publisher": "上海对外经贸大学",
        "canonical_url": "https://official.example/report",
        "verification_status": "verified",
        "source_scope": "official",
        "owner_id": None,
        "ordinal": 0,
        "text": text,
        "locator": {"kind": "page_range", "page_start": 12, "page_end": 12},
        "heading_path": "第一章 就业概况",
        "score": score,
    }


def _ask_context(provider: FakeProvider, *, traces: list) -> tuple:
    config = make_config()
    db = FakeDb(config=config)
    db.search_rows = [_evidence_row(text="2024届毕业生去向落实率为95.0%。")]
    job = make_claim({"question": "2024届毕业生去向落实率是多少？"}, kind="ask", owner_id=OWNER)
    ctx = make_context(
        config=config, db=db, provider=provider, job=job, traces=traces
    )
    return ctx, db


# ---------------------------------------------------------------------------
# 提示词与确定性文案
# ---------------------------------------------------------------------------


def test_all_system_prompts_embed_voice_contract():
    system_prompts = {
        "ask": career.ASK_SYSTEM_PROMPT,
        "plan": career.PLAN_SYSTEM_PROMPT,
        "plan_analysis": career.PLAN_ANALYSIS_SYSTEM_PROMPT,
        "assessment": career.ASSESSMENT_SYSTEM_PROMPT,
        "compare": career.COMPARE_SYSTEM_PROMPT,
    }
    for name, prompt in system_prompts.items():
        assert career.VOICE_CONTRACT in prompt, name
        # 表达契约本身会列出禁用词；除契约外，场景指令不再要求模型写这些词。
        scenario = prompt.replace(career.VOICE_CONTRACT, "")
        assert "待核验" not in scenario, name
        assert "未核验" not in scenario, name
        assert "资料缺口" not in scenario, name


def test_evidence_block_does_not_expose_verification_status():
    block = career._evidence_block(
        {
            "citation_no": 1,
            "title": "学校就业质量报告",
            "source_type": "web",
            "locator": {"kind": "page", "page": 3},
            "source_id": "src-1",
            "verification_status": "unverified",
            "context": "2024届毕业生去向落实率为95.0%。",
        }
    )
    assert "[1]" in block
    assert "实时网页" in block
    assert "核验" not in block


def test_deterministic_fallback_texts_have_no_hedges():
    texts = [
        validate.build_refusal_text(
            "2024届毕业生的就业率是多少？",
            evidence=[{"title": "就业质量报告"}],
            reason="gate_failed",
        ),
        validate.build_refusal_text("学校食堂几点开门？", evidence=[]),
        validate.deterministic_plan_explanation(
            status="data_unavailable", gap_codes=["curriculum_unavailable"]
        ),
        validate.deterministic_plan_explanation(status="partial", gap_codes=["credits_unavailable"]),
        validate.deterministic_plan_explanation(status="ok", gap_codes=[]),
        validate.deterministic_assessment_explanation(),
        validate.deterministic_compare_text(
            [{"direction_id": "trade_supply_chain", "title": "国际贸易与供应链"}]
        ),
    ]
    for text in texts:
        assert text.strip()
        assert prompt_voice.find_hedges(text) == [], text
        assert "资料不足" not in text


def test_refusal_text_is_actionable_not_apologetic():
    text = validate.build_refusal_text("2024届毕业生的就业率是多少？")
    assert "2024" in text
    assert "到哪查" in text
    assert "适用范围：" in text
    assert prompt_voice.find_hedges(text) == []


# ---------------------------------------------------------------------------
# 后处理：去 AI 味、保留引用
# ---------------------------------------------------------------------------


def test_sanitize_prose_removes_slop_and_keeps_citations():
    text = "需要说明的是，2024届落实率为95.0%[1]。综上所述，先做这一步。"
    cleaned = prompt_voice.sanitize_prose(text)
    assert "[1]" in cleaned
    assert "95.0%" in cleaned
    assert "需要说明的是" not in cleaned
    assert "综上所述" not in cleaned
    assert prompt_voice.find_slop(cleaned) == []


def test_scrub_hedges_drops_weak_sentences_but_keeps_facts():
    text = "2024届落实率为95.0%[1]。资料不足，暂不提供结论。"
    cleaned = prompt_voice.scrub_hedges(text)
    assert "95.0%[1]" in cleaned
    assert prompt_voice.find_hedges(cleaned) == []


def test_parse_ask_output_sanitizes_prose_but_keeps_citations():
    parsed = validate.parse_ask_output(
        json.dumps(
            {
                "answer": "需要说明的是，2024届落实率为95.0%[1]。",
                "citation_numbers": [1],
                "no_evidence": False,
                "boundary_note": "综上所述，仅覆盖2024届。",
            },
            ensure_ascii=False,
        ),
        valid_citations={1},
        evidence_texts=["2024届落实率为95.0%。"],
    )
    assert parsed.validation_reasons == []
    assert "[1]" in parsed.answer
    assert "95.0%" in parsed.answer
    assert "需要说明的是" not in parsed.answer
    assert "综上所述" not in parsed.boundary_note


def test_parse_plan_analysis_drops_hedged_lines():
    raw = json.dumps(
        {
            "overview": "需要说明的是，这个方向围绕跨境业务与平台运营。",
            "match": "你的沟通自评与岗位要求更相关，先补数据能力。",
            "action_rationale": ["先做一门课程作业，形成可展示的样例。"],
            "evidence_courses": [],
            "evidence_competitions": [],
            "risks": ["资料不足：课程目录未接入。", "课程安排到教务处核对开课学期。"],
            "next_steps": ["到教务系统核对培养方案课程。"],
            "citation_numbers": [],
            "boundary_note": "",
        },
        ensure_ascii=False,
    )
    parsed = validate.parse_plan_analysis(
        raw, valid_citations=set(), allowed_texts=["跨境业务与平台运营"]
    )
    assert parsed.validation_reasons == []
    assert prompt_voice.find_hedges(parsed.overview) == []
    assert "需要说明的是" not in parsed.overview
    assert [line for line in parsed.risks if prompt_voice.find_hedges(line)] == []
    assert any("教务处" in line for line in parsed.risks)


# ---------------------------------------------------------------------------
# 生成侧兜底：voice 修复（先重写，再删句，最后确定性文案）
# ---------------------------------------------------------------------------


def test_ask_voice_repair_rewrites_hedged_answer():
    hedged = json.dumps(
        {
            "answer": "报告显示，2024届毕业生去向落实率为95.0%[1]；资料不足，部分数据待核验。",
            "citation_numbers": [1],
            "no_evidence": False,
            "boundary_note": "",
        },
        ensure_ascii=False,
    )
    repaired = json.dumps(
        {
            "answer": "报告显示，2024届毕业生去向落实率为95.0%[1]。适用范围：报告原文口径。",
            "citation_numbers": [1],
            "no_evidence": False,
            "boundary_note": "",
        },
        ensure_ascii=False,
    )
    config = make_config()
    provider = FakeProvider(
        config,
        chat_responses={"chat_ask": [hedged], "chat_ask_voice_repair": [repaired]},
    )
    traces: list[dict] = []
    ctx, _db = _ask_context(provider, traces=traces)

    payload = run_ask(ctx)

    assert payload["refusal"] is False
    assert prompt_voice.find_hedges(payload["answer"]) == []
    assert "95.0%" in payload["answer"]
    assert any(
        event["type"] == "voice_repair"
        and event["payload"].get("resolved") == "rewritten"
        for event in traces
    )


def test_ask_voice_repair_falls_back_to_deterministic_text():
    hedged = json.dumps(
        {
            "answer": "资料不足：缺少2020届的可核验资料。",
            "citation_numbers": [],
            "no_evidence": True,
            "boundary_note": "",
        },
        ensure_ascii=False,
    )
    config = make_config()
    provider = FakeProvider(
        config,
        chat_responses={"chat_ask": [hedged], "chat_ask_voice_repair": [hedged]},
    )
    traces: list[dict] = []
    ctx, _db = _ask_context(provider, traces=traces)

    payload = run_ask(ctx)

    assert prompt_voice.find_hedges(payload["answer"]) == []
    assert "到哪查" in payload["answer"]
    assert any(
        event["type"] == "voice_repair"
        and event["payload"].get("resolved") == "deterministic"
        for event in traces
    )

def test_planning_blueprint_user_copy_has_no_hedges():
    """方案页/PDF 第 7 节直接展示这些字段：课程、竞赛、资源、就业事实与路线。"""

    from app.planning import build_planning_blueprint

    profile = {
        "school": "上海对外经贸大学",
        "major": "国际经济与贸易",
        "enrollment_year": 2026,
        "current_term": "2026-秋",
        "scores": {"ability_research": 0.8, "ability_data": 0.5, "interest_e": 0.9},
        "preferences": {"weekly_hours": 8, "pathway": {"primary": "undergraduate_employment"}},
    }
    blueprint = build_planning_blueprint(profile, "trade_supply_chain")
    texts = [
        *blueprint.pathway.rationale,
        *(stage.focus for stage in blueprint.roadmap),
        *(action for stage in blueprint.roadmap for action in stage.actions),
    ]
    for lead in [
        *blueprint.course_leads,
        *blueprint.competition_leads,
        *blueprint.campus_resources,
        *blueprint.campus_facts,
        *blueprint.industry_leads,
    ]:
        texts.extend([lead.title, lead.description, lead.why, lead.source_label])
    for text in texts:
        assert prompt_voice.find_hedges(text) == [], text


def test_sanitize_prose_drops_internal_bracket_ids():
    text = "先到团委核对 [competition-lead-trade_supply_chain-1][competition-lead-trade_supply_chain-2]。数据见[1][2，3]。"
    cleaned = prompt_voice.sanitize_prose(text)
    assert "[1]" in cleaned
    assert "[2，3]" in cleaned
    assert "competition-lead" not in cleaned
    assert "规则事实" not in cleaned


def test_apply_scope_line_keeps_single_scope_line():
    body = "结论先行，先做这一步。[1]\n适用范围：旧的一句话。"
    result = prompt_voice.apply_scope_line(body, "2026 年秋季学期口径，最终以学校当年文件为准。")
    assert result.count("适用范围：") == 1
    assert "最终以学校当年文件为准" in result
    assert "旧的一句话" not in result


def test_sanitize_prose_removes_internal_action_ids_and_field_codes():
    text = "本学期先做 verify-curriculum，并核对 credit_rules_unavailable 这条缺口。"
    cleaned = prompt_voice.sanitize_prose(text)
    assert "verify-curriculum" not in cleaned
    assert "credit_rules_unavailable" not in cleaned
    assert prompt_voice.find_hedges(cleaned) == []
