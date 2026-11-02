"""PDF 导出测试：中文 PDF 结构、导出图 payload、storage 路径与 artifact 登记。"""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

from pypdf import PdfReader

from app.export.pdf import render_plan_pdf
from app.graphs.export import run_export
from tests.fakes import FIXTURES, FakeDb, FakeProvider, make_claim, make_config, make_context

OWNER = "11111111-1111-1111-1111-111111111111"
PLAN_ID = "44444444-4444-4444-4444-444444444444"
VERSION_ID = "55555555-5555-5555-5555-555555555555"
PROFILE_ID = "66666666-6666-6666-6666-666666666666"


def _plan_result() -> dict:
    return json.loads((FIXTURES / "plan_result.json").read_text(encoding="utf-8"))


def _plan_result_with_blueprint() -> dict:
    result = _plan_result()
    result.update(
        {
            "pathway": {
                "primary": "undergraduate_employment",
                "label": "本科就业",
                "rationale": ["你明确偏实践，先通过课程项目与实习获得真实反馈。"],
                "alternatives": ["国内升学"],
                "excluded": ["体制内 / 政审类岗位"],
            },
            "course_leads": [
                {
                    "lead_id": "course-1",
                    "title": "跨境电子商务",
                    "description": "理解平台运营与履约流程。",
                    "why": "课程属性需要在教务系统核对。",
                    "skill_tags": ["运营"],
                    "verification_status": "official_lead",
                    "source_label": "学校官网入口",
                    "source_url": "https://www.suibe.edu.cn/",
                }
            ],
            "competition_leads": [],
            "campus_resources": [],
            "roadmap": [
                {
                    "stage": "未来 30 天",
                    "focus": "核对信息并形成第一份证据",
                    "actions": ["核对 3 门课程的学分与开课学期。"],
                },
                {
                    "stage": "大一上",
                    "focus": "完成本学期可交付成果",
                    "actions": ["选择 1 项竞赛核对当年资格。"],
                },
            ],
            "analysis": {
                "overview": "该方向围绕跨境业务、平台运营与商业沟通。",
                "match": "沟通与执行自评可以支撑业务协作，但数据能力仍需通过课程作业补证据。",
                "action_rationale": [],
                "evidence_courses": [],
                "evidence_competitions": [],
                "risks": ["课程与竞赛资格仍需官方核验。"],
                "next_steps": ["先核对培养方案。"],
                "citation_numbers": [1],
                "boundary_note": "方向为暂定比较项。",
            },
        }
    )
    return result


def _plan_version() -> dict:
    return {
        "version_id": VERSION_ID,
        "plan_id": PLAN_ID,
        "version": 1,
        "profile_version": 1,
        "rules_version": "career-rules-2026-10-19.1",
        "corpus_version": "career-qwen3-embedding-8b-4096-career-qwen-v1@career-splitter-2026-10-19.1",
        "embedding_profile_id": "career-qwen3-embedding-8b-4096-career-qwen-v1",
        "status": "active",
        "created_at": "2026-10-19T10:00:00+00:00",
        "result": _plan_result(),
    }


def test_render_plan_pdf_returns_readable_pdf_bytes():
    result = _plan_result_with_blueprint()
    data = render_plan_pdf(
        plan_result=result,
        plan_version=_plan_version(),
        profile={
            "school": "上海对外经贸大学",
            "major": "国际经济与贸易",
            "enrollment_year": 2023,
            "current_term": "2025-秋",
        },
        direction_title="国际贸易与供应链",
    )
    assert data.startswith(b"%PDF")
    assert len(data) > 2000
    # 中文字体通过 CID 字体嵌入：PDF 资源里应能看到 STSong-Light
    assert b"STSong-Light" in data
    assert b"%%EOF" in data
    text = "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(data)).pages)
    assert "本科就业" in text
    assert "未来 30 天" in text
    assert "跨境电子商务" in text
    assert "官方线索" in text


def test_export_graph_registers_artifact_and_returns_contract_payload(tmp_path: Path):
    config = make_config()
    db = FakeDb(config=config)
    profile = {
        "profile_id": PROFILE_ID,
        "owner_id": OWNER,
        "version": 1,
        "school": "上海对外经贸大学",
        "major": "国际经济与贸易",
        "enrollment_year": 2023,
        "current_term": "2025-秋",
    }
    db.profiles[PROFILE_ID] = profile
    db.plans[PLAN_ID] = {
        "plan_id": PLAN_ID,
        "owner_id": OWNER,
        "profile_id": PROFILE_ID,
        "direction_id": "trade_supply_chain",
        "current_version_id": VERSION_ID,
    }
    db.plan_versions[VERSION_ID] = _plan_version()
    db.directions["trade_supply_chain"] = {"direction_id": "trade_supply_chain", "title": "国际贸易与供应链"}
    provider = FakeProvider(config)
    job = make_claim({"plan_id": PLAN_ID, "plan_version_id": VERSION_ID}, kind="export", owner_id=OWNER)
    emits: list[tuple[str, int]] = []
    ctx = make_context(config=config, db=db, provider=provider, job=job, emits=emits)
    payload = run_export(ctx)

    assert set(payload) == {"artifact_id", "plan_id", "plan_version_id", "artifact"}
    assert payload["plan_id"] == PLAN_ID
    assert payload["plan_version_id"] == VERSION_ID
    artifact = payload["artifact"]
    assert artifact["artifact_id"] == payload["artifact_id"]
    assert artifact["bytes"] > 2000
    assert payload["artifact_id"] in db.artifacts
    # storage 路径必须是 {owner_id}/{run_id}/{artifact_id}.pdf
    bucket, path, data, content_type = db.uploads[0]
    assert bucket == config.artifacts_bucket
    assert path == f"{OWNER}/{job.run_id}/{payload['artifact_id']}.pdf"
    assert content_type == "application/pdf"
    assert hashlib.sha256(data).hexdigest() == artifact["sha256"]
    assert artifact["sha256"] == artifact["sha256"].lower()
    # 进度：rendering → validating，递增且 <100
    statuses = [status for status, _progress in emits]
    assert "rendering" in statuses and "validating" in statuses
    assert all(progress < 100 for _, progress in emits)
    assert all(left[1] < right[1] for left, right in zip(emits, emits[1:]))


def test_export_graph_rejects_missing_plan_result():
    config = make_config()
    db = FakeDb(config=config)
    profile = {"profile_id": PROFILE_ID, "owner_id": OWNER, "version": 1, "school": "上海对外经贸大学", "major": "国际经济与贸易", "enrollment_year": 2023, "current_term": "2025-秋"}
    db.profiles[PROFILE_ID] = profile
    db.plans[PLAN_ID] = {"plan_id": PLAN_ID, "owner_id": OWNER, "profile_id": PROFILE_ID, "direction_id": "trade_supply_chain", "current_version_id": VERSION_ID}
    version = _plan_version()
    version["result"] = None
    db.plan_versions[VERSION_ID] = version
    job = make_claim({"plan_id": PLAN_ID}, kind="export", owner_id=OWNER)
    ctx = make_context(config=config, db=db, provider=FakeProvider(config), job=job)
    from app.errors import WorkerError

    try:
        run_export(ctx)
    except WorkerError as exc:
        assert "result" in exc.safe_message
    else:  # pragma: no cover
        raise AssertionError("缺少 result 时必须报错")
