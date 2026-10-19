"""PDF 导出测试：中文 PDF 结构、导出图 payload、storage 路径与 artifact 登记。"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from app.export.pdf import render_plan_pdf
from app.graphs.export import run_export
from tests.fakes import FIXTURES, FakeDb, FakeProvider, make_claim, make_config, make_context

OWNER = "11111111-1111-1111-1111-111111111111"
PLAN_ID = "44444444-4444-4444-4444-444444444444"
VERSION_ID = "55555555-5555-5555-5555-555555555555"
PROFILE_ID = "66666666-6666-6666-6666-666666666666"


def _plan_result() -> dict:
    return json.loads((FIXTURES / "plan_result.json").read_text(encoding="utf-8"))


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
    data = render_plan_pdf(
        plan_result=_plan_result(),
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
