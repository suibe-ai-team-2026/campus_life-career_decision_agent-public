"""六类固定图的集成测试（fake DB/provider，不联网）。"""

from __future__ import annotations

import json

from app.config import Config
from app.errors import ModelAuthFailed
from app.graphs.ask import run_ask
from app.graphs.assessment import run_assessment
from app.graphs.compare import run_compare
from app.graphs.ingest import run_ingest
from app.graphs.plan import run_plan
from tests.fakes import (
    FakeDb,
    FakeProvider,
    make_claim,
    make_config,
    make_context,
    load_rules_fixture,
)

OWNER = "11111111-1111-1111-1111-111111111111"
PROFILE_ID = "66666666-6666-6666-6666-666666666666"
SV_ID = "uv-1"
SOURCE_ID = "source-1"


def _profile(**overrides) -> dict:
    profile = {
        "profile_id": PROFILE_ID,
        "owner_id": OWNER,
        "version": 1,
        "school": "上海对外经贸大学",
        "major": "国际经济与贸易",
        "enrollment_year": 2023,
        "current_term": "2025-秋",
        "assessment_version": "career-light-2026-10-19",
        "answers": {"i1": 4, "i2": 5, "a1": 3},
        "scores": {"interest": 3.5, "ability": 4.0, "decision": 2.5},
        "preferences": {"weekly_hours": 8},
        "exploration_status": "completed",
    }
    profile.update(overrides)
    return profile


def _evidence_row(*, chunk_id: str = "88888888-8888-8888-8888-888888888888", text: str, score: float = 0.1) -> dict:
    return {
        "branch": "dense",
        "chunk_id": chunk_id,
        "source_version_id": "77777777-7777-7777-7777-777777777777",
        "source_id": SOURCE_ID,
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


def _plan_context(provider: FakeProvider, *, search_rows: list[dict] | None = None, emits: list | None = None):
    config = make_config()
    db = FakeDb(config=config)
    db.profiles[PROFILE_ID] = _profile()
    db.directions["trade_supply_chain"] = {"direction_id": "trade_supply_chain", "title": "国际贸易与供应链"}
    db.search_rows = search_rows if search_rows is not None else [_evidence_row(text="2024届毕业生去向落实率为95.0%。")]
    job = make_claim({"profile_id": PROFILE_ID, "direction_id": "trade_supply_chain", "plan_id": None}, kind="plan", owner_id=OWNER)
    emit_log = emits if emits is not None else []
    ctx = make_context(config=config, db=db, provider=provider, job=job, rules_data=load_rules_fixture(), emits=emit_log)
    return ctx, db, emit_log


def test_plan_graph_freezes_rule_facts_and_publishes_real_ids():
    config = make_config()
    provider = FakeProvider(
        config,
        chat_responses={
            "chat_plan_explain": [
                json.dumps(
                    {
                        "explanation": "根据已核验资料，先补强国际贸易实务能力，再按规则安排行动[1]。",
                        "cited_action_ids": ["req-REQ001"],
                        "citation_numbers": [1],
                        "boundary_note": "",
                    },
                    ensure_ascii=False,
                )
            ]
        },
    )
    ctx, db, emits = _plan_context(provider)
    payload = run_plan(ctx)

    assert set(payload) == {"plan_id", "version_id", "version", "result"}
    assert payload["plan_id"] == "44444444-4444-4444-4444-444444444444"
    assert payload["version_id"] == "55555555-5555-5555-5555-555555555555"
    assert payload["version"] == 1

    result = payload["result"]
    assert result["status"] == "ok"
    assert result["credits"] == 5.5
    assert [action["action_id"] for action in result["actions"]] == ["req-REQ001", "req-REQ002"]
    assert result["explanation"] is not None and "回退" not in result["explanation"]
    assert len(result["evidence"]) == 1
    assert result["evidence"][0]["citation_no"] == 1

    saved = db.saved_plans[0]
    assert saved["actions"] == result["actions"]
    assert saved["result"] == result
    assert saved["rules_version"] == "career-rules-2026-10-19.1"
    assert saved["profile_id"] == PROFILE_ID
    assert saved["plan_id"] is None or isinstance(saved["plan_id"], str)

    statuses = [status for status, _progress in emits]
    assert statuses[0] in {"retrieving", "planning", "validating"}
    assert "retrieving" in statuses and "planning" in statuses and "validating" in statuses
    assert all(progress < 100 for _, progress in emits)
    assert all(left[1] < right[1] for left, right in zip(emits, emits[1:]))


def test_plan_graph_discards_out_of_bounds_explanation_and_keeps_facts():
    config = make_config()
    provider = FakeProvider(
        config,
        chat_responses={
            "chat_plan_explain": [
                json.dumps(
                    {
                        "explanation": "新增课程《量化交易》，预计获得 9.9 学分[9]。",
                        "cited_action_ids": ["act-not-exist"],
                        "citation_numbers": [9],
                        "boundary_note": "",
                    },
                    ensure_ascii=False,
                )
            ]
        },
    )
    ctx, db, _emits = _plan_context(provider)
    payload = run_plan(ctx)
    result = payload["result"]
    assert "回退" in (result["explanation"] or "")
    assert any("plan_explanation_fallback" in warning for warning in result["warnings"])
    # 规则事实不变：没有《量化交易》，学分仍是 5.5
    assert result["credits"] == 5.5
    assert "量化交易" not in json.dumps(result["courses"], ensure_ascii=False)
    assert db.saved_plans


def test_plan_graph_falls_back_when_model_unavailable():
    config = make_config()
    provider = FakeProvider(config)
    provider.chat_error = ModelAuthFailed("bad key")
    ctx, db, _emits = _plan_context(provider)
    payload = run_plan(ctx)
    assert "回退" in (payload["result"]["explanation"] or "")
    assert db.saved_plans


def test_plan_graph_fails_on_profile_version_mismatch():
    config = make_config()
    provider = FakeProvider(config)
    ctx, db, _emits = _plan_context(provider)
    ctx.job = make_claim(
        {"profile_id": PROFILE_ID, "direction_id": "trade_supply_chain"},
        kind="plan",
        owner_id=OWNER,
    )
    object.__setattr__(ctx.job, "profile_version", 99)
    from app.errors import WorkerError

    try:
        run_plan(ctx)
    except WorkerError as exc:
        assert "版本" in exc.safe_message
    else:  # pragma: no cover
        raise AssertionError("画像版本不一致必须失败")


def test_ask_gate_refusal_does_not_call_chat():
    config = make_config()
    db = FakeDb(config=config)
    provider = FakeProvider(config)
    db.search_rows = []
    job = make_claim({"question": "2024届毕业生就业率是多少？"}, kind="ask", owner_id=OWNER)
    ctx = make_context(config=config, db=db, provider=provider, job=job)
    payload = run_ask(ctx)
    assert payload["refusal"] is True
    assert payload["refusal_reason"] in {"gate_failed", "no_evidence"}
    assert payload["citations"] == []
    assert provider.chat_calls == []


def test_ask_valid_answer_keeps_citations():
    config = make_config()
    db = FakeDb(config=config)
    provider = FakeProvider(
        config,
        chat_responses={
            "chat_ask": [
                json.dumps(
                    {
                        "answer": "报告显示，2024届毕业生去向落实率为95.0%[1]。",
                        "citation_numbers": [1],
                        "no_evidence": False,
                        "boundary_note": "仅覆盖2024届报告口径",
                    },
                    ensure_ascii=False,
                )
            ]
        },
    )
    db.search_rows = [_evidence_row(text="2024届毕业生去向落实率为95.0%。")]
    job = make_claim({"question": "2024届毕业生去向落实率是多少？"}, kind="ask", owner_id=OWNER)
    ctx = make_context(config=config, db=db, provider=provider, job=job)
    payload = run_ask(ctx)
    assert payload["refusal"] is False
    assert "95.0%" in payload["answer"]
    assert len(payload["citations"]) == 1
    assert payload["citations"][0]["citation_no"] == 1
    assert payload["boundary_note"] == "仅覆盖2024届报告口径"


def test_ask_discards_answer_with_invalid_citation():
    config = make_config()
    db = FakeDb(config=config)
    provider = FakeProvider(
        config,
        chat_responses={
            "chat_ask": [
                json.dumps(
                    {
                        "answer": "落实率为99.9%[9]。",
                        "citation_numbers": [9],
                        "no_evidence": False,
                        "boundary_note": "",
                    },
                    ensure_ascii=False,
                )
            ]
        },
    )
    db.search_rows = [_evidence_row(text="2024届毕业生去向落实率为95.0%。")]
    job = make_claim({"question": "落实率是多少？"}, kind="ask", owner_id=OWNER)
    ctx = make_context(config=config, db=db, provider=provider, job=job)
    payload = run_ask(ctx)
    assert payload["refusal"] is True
    assert payload["refusal_reason"] == "explanation_discarded"
    assert payload["citations"] == []


def test_ask_model_no_evidence_results_in_refusal():
    config = make_config()
    db = FakeDb(config=config)
    provider = FakeProvider(
        config,
        chat_responses={
            "chat_ask": [
                json.dumps(
                    {"answer": "资料不足：缺少2020届的可核验资料。", "citation_numbers": [], "no_evidence": True, "boundary_note": ""},
                    ensure_ascii=False,
                )
            ]
        },
    )
    db.search_rows = [_evidence_row(text="2024届毕业生去向落实率为95.0%。")]
    job = make_claim({"question": "2020届毕业生就业率是多少？"}, kind="ask", owner_id=OWNER)
    ctx = make_context(config=config, db=db, provider=provider, job=job)
    payload = run_ask(ctx)
    assert payload["refusal"] is True
    assert payload["refusal_reason"] == "model_no_evidence"


def test_assessment_graph_keeps_system_scores_and_ignores_ai_numbers():
    config = make_config()
    db = FakeDb(config=config)
    db.profiles[PROFILE_ID] = _profile()
    db.assessments["career-light-2026-10-19"] = {
        "version": "career-light-2026-10-19",
        "dimensions": {
            "interest": {"title": "兴趣倾向"},
            "ability": {"title": "能力自评"},
            "decision": {"title": "决策偏好"},
        },
        "questions": [
            {"question_id": "i1", "dimension": "interest"},
            {"question_id": "i2", "dimension": "interest"},
            {"question_id": "i3", "dimension": "interest"},
            {"question_id": "i4", "dimension": "interest"},
            {"question_id": "a1", "dimension": "ability"},
            {"question_id": "a2", "dimension": "ability"},
            {"question_id": "d1", "dimension": "decision"},
            {"question_id": "d2", "dimension": "decision"},
        ],
    }
    provider = FakeProvider(
        config,
        chat_responses={
            "chat_assessment_explain": [
                json.dumps(
                    {
                        "explanation": "以下仅为描述性解释，不是职业判决。",
                        "dimension_notes": [
                            {"dimension": "interest", "score": 1.0, "descriptive": "你可能更喜欢需要主动探索的任务"}
                        ],
                        "boundary_note": "轻测不是专业测评",
                    },
                    ensure_ascii=False,
                )
            ]
        },
    )
    job = make_claim({"profile_id": PROFILE_ID}, kind="assessment_explain", owner_id=OWNER)
    ctx = make_context(config=config, db=db, provider=provider, job=job)
    payload = run_assessment(ctx)
    dimensions = {item["dimension"]: item for item in payload["dimensions"]}
    assert set(dimensions) == {"interest", "ability", "decision"}
    assert dimensions["interest"]["score"] == 3.5  # AI 输出里的 1.0 被忽略
    assert dimensions["interest"]["answered"] == 2
    assert dimensions["interest"]["total"] == 4
    assert dimensions["interest"]["title"] == "兴趣倾向"
    assert "主动探索" in dimensions["interest"]["descriptive"]


def test_compare_graph_uses_citations_and_deterministic_fallback():
    config = make_config()
    db = FakeDb(config=config)
    db.profiles[PROFILE_ID] = _profile()
    db.directions["trade_supply_chain"] = {
        "direction_id": "trade_supply_chain",
        "title": "国际贸易与供应链",
        "description": "围绕进出口业务与物流。",
        "metadata": {"work_content": ["客户跟进"], "verified_skills": ["国际贸易实务"], "data_gaps": ["分方向去向未逐格检索"]},
    }
    db.directions["finance_accounting"] = {
        "direction_id": "finance_accounting",
        "title": "金融与财会",
        "description": "金融与会计岗位族。",
        "metadata": {"work_content": ["财务分析"], "verified_skills": ["会计基础"], "data_gaps": []},
    }
    db.search_rows = [_evidence_row(text="两个方向的工作内容不同，需分别核对资料。")]
    provider = FakeProvider(
        config,
        chat_responses={
            "chat_compare": [
                json.dumps(
                    {"comparison": "两个方向的工作内容与能力要求不同，需要结合证据判断[1]。", "citation_numbers": [1], "boundary_note": ""},
                    ensure_ascii=False,
                )
            ]
        },
    )
    job = make_claim({"profile_id": PROFILE_ID, "direction_ids": ["trade_supply_chain", "finance_accounting"]}, kind="compare", owner_id=OWNER)
    ctx = make_context(config=config, db=db, provider=provider, job=job)
    payload = run_compare(ctx)
    assert payload["direction_ids"] == ["trade_supply_chain", "finance_accounting"]
    assert "工作内容" in payload["comparison"]
    assert len(payload["evidence"]) == 1

    provider.chat_error = ModelAuthFailed("bad key")
    job2 = make_claim({"profile_id": PROFILE_ID, "direction_ids": ["trade_supply_chain", "finance_accounting"]}, kind="compare", owner_id=OWNER)
    ctx2 = make_context(config=config, db=db, provider=provider, job=job2)
    fallback = run_compare(ctx2)
    assert "AI 对比说明暂时不可用" in fallback["comparison"]
    assert "不做排名" in fallback["comparison"]


def test_ingest_graph_parses_chunks_embeds_and_updates_source_version():
    import hashlib

    config = make_config()
    db = FakeDb(config=config)
    content = (
        "# 第一章 培养方案\n\n"
        "本专业培养方案包含国际贸易实务等课程，具体学分以教务系统为准。\n\n"
        "## 1.1 就业资料\n\n"
        "2024届毕业生去向落实率为95.0%，数据来自学校报告。\n\n"
        "| 课程 | 学分 |\n| --- | --- |\n| 国际贸易实务 | 3 |\n"
    ).encode("utf-8")
    sv_id = "77777777-7777-7777-7777-777777777777"
    storage_path = f"{OWNER}/{sv_id}/source.md"
    db.source_versions[sv_id] = {
        "source_version_id": sv_id,
        "source_id": SOURCE_ID,
        "visibility": "private",
        "owner_id": OWNER,
        "content_sha256": hashlib.sha256(content).hexdigest(),
        "storage_path": storage_path,
        "metadata": {"mime_type": "text/markdown"},
        "extraction_status": "pending",
    }
    db.sources[SOURCE_ID] = {"source_id": SOURCE_ID, "title": "测试来源", "metadata": {}}
    db.storage_objects[(config.source_files_bucket, storage_path)] = content
    provider = FakeProvider(config)
    job = make_claim({"source_version_id": sv_id}, kind="ingest", owner_id=OWNER)
    emits: list[tuple[str, int]] = []
    ctx = make_context(config=config, db=db, provider=provider, job=job, emits=emits)
    payload = run_ingest(ctx)

    assert set(payload) == {"source_id", "source_version_id", "chunks", "documents", "parser_version", "extraction_status"}
    assert payload["source_id"] == SOURCE_ID
    assert payload["source_version_id"] == sv_id
    assert payload["documents"] == 1
    assert payload["chunks"] == len(db.inserted_chunks) > 0
    assert payload["extraction_status"] in {"parsed", "partial", "ocr"}
    assert len(db.inserted_embeddings) == payload["chunks"]
    assert all(row["embedding"].startswith("[") for row in db.inserted_embeddings)
    assert db.deleted_chunks and db.deleted_chunks[0][0] == sv_id
    assert db.updated_source_versions[-1][1]["extraction_status"] in {"parsed", "partial", "ocr"}
    statuses = [status for status, _ in emits]
    assert statuses[0] == "parsing"
    assert "embedding" in statuses and "validating" in statuses
    assert all(progress < 100 for _, progress in emits)
    assert provider.chat_calls == []

def test_plan_graph_without_verified_rule_data_returns_data_unavailable():
    config = make_config()
    db = FakeDb(config=config)
    db.profiles[PROFILE_ID] = _profile()
    db.directions["trade_supply_chain"] = {"direction_id": "trade_supply_chain", "title": "国际贸易与供应链"}
    db.search_rows = [_evidence_row(text="当前语料没有该专业培养方案的结构化数据。")]
    provider = FakeProvider(config)
    job = make_claim({"profile_id": PROFILE_ID, "direction_id": "trade_supply_chain"}, kind="plan", owner_id=OWNER)
    ctx = make_context(config=config, db=db, provider=provider, job=job, rules_data={}, emits=[])
    payload = run_plan(ctx)
    result = payload["result"]
    assert result["status"] == "data_unavailable"
    assert result["credits"] is None
    codes = {gap["code"] for gap in result["gaps"]}
    assert {"curriculum_unavailable", "credit_rules_unavailable", "competitions_unavailable"} <= codes
    assert result["courses"] == [] and result["competitions"] == []
    assert all(action["status"] == "pending_verification" for action in result["actions"])
    assert "回退" in (result["explanation"] or "")
    assert db.saved_plans and db.saved_plans[0]["result"]["credits"] is None
