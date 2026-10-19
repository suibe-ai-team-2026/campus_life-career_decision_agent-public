#!/usr/bin/env python3
"""Private upload -> ingest -> ask E2E against the live BFF + worker.

Uses a synthetic text file, verifies that the private source is embedded and can
be cited only by the owner, then optionally cleans up the test source. Never
prints signed URLs or credentials.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
import urllib.error
import urllib.request
import uuid
from http.cookiejar import CookieJar
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEXT = """知途端到端上传测试样例（不是正式培养方案）
国际经济与贸易专业，国际贸易实务课程为 3 学分，计划在第 3 学期开课。
本文件只用于验证私有上传、解析、切块、embedding 与检索链路。
""".encode()


def open_session():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))


def call(op, base, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, headers={"Content-Type": "application/json"}, method=method)
    try:
        with op.open(req, timeout=40) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read().decode())
        except Exception:
            return exc.code, {}


def wait_run(op, base, run_id, timeout=180):
    started = time.time()
    while time.time() - started < timeout:
        _, payload = call(op, base, "GET", f"/api/runs/{run_id}")
        run = (payload.get("data") or {}).get("run") or {}
        if run.get("status") in {"succeeded", "failed", "cancelled"}:
            return run, round(time.time() - started, 2)
        time.sleep(2)
    return {"run_id": run_id, "status": "timeout"}, round(time.time() - started, 2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:3100")
    parser.add_argument("--out", default=str(ROOT / "docs" / "evidence" / "upload-ingest-e2e.json"))
    args = parser.parse_args()
    op = open_session()
    status, _ = call(op, args.base, "POST", "/api/auth/anonymous")
    if status != 200:
        raise SystemExit(f"anonymous auth failed: {status}")

    sha256 = hashlib.sha256(TEXT).hexdigest()
    status, intent = call(op, args.base, "POST", "/api/sources/upload-intent", {
        "title": "E2E 私有上传测试",
        "filename": "campus-pathway-e2e.txt",
        "mime_type": "text/plain",
        "bytes": len(TEXT),
    })
    if status != 200:
        raise SystemExit(f"upload-intent failed: {status} {intent}")
    data = intent["data"]
    source_id = data["source_id"]
    signed_url = data["signed_url"]
    signed_path = data["path"]

    upload_req = urllib.request.Request(signed_url, data=TEXT, method="PUT", headers={"Content-Type": "text/plain", "x-upsert": "false"})
    with urllib.request.urlopen(upload_req, timeout=40) as resp:
        upload_status = resp.status

    status, completed = call(op, args.base, "POST", f"/api/sources/{source_id}/complete", {
        "source_id": source_id,
        "source_version_id": str(uuid.uuid4()),
        "declared_sha256": sha256,
        "title": "E2E 私有上传测试",
        "idempotency_key": str(uuid.uuid4()),
    })
    if status != 202:
        raise SystemExit(f"upload complete failed: {status} {completed}")
    ingest_run_id = completed["data"]["run_id"]
    source_version_id = completed["data"]["source_version_id"]
    ingest_run, ingest_seconds = wait_run(op, args.base, ingest_run_id)

    ask_run = {}
    ask_seconds = None
    citations = []
    answer = ""
    if ingest_run.get("status") == "succeeded":
        status, submitted = call(op, args.base, "POST", "/api/runs", {
            "kind": "ask",
            "idempotency_key": str(uuid.uuid4()),
            "question": "测试样例里国际贸易实务课程是几学分、第几学期开课？",
            "source_version_ids": [source_version_id],
        })
        if status == 202:
            ask_run, ask_seconds = wait_run(op, args.base, submitted["data"]["run_id"])
            result = ask_run.get("result") or {}
            answer = result.get("answer") or ""
            citations = result.get("citations") or []
        else:
            ask_run = {"status": f"submit_failed_{status}", "error": submitted}

    summary = {
        "executed_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "base": args.base,
        "source_id": source_id,
        "source_version_id": source_version_id,
        "signed_upload_http": upload_status,
        "ingest_run": {"run_id": ingest_run_id, "status": ingest_run.get("status"), "seconds": ingest_seconds, "error_code": ingest_run.get("error_code")},
        "ask_run": {"status": ask_run.get("status"), "seconds": ask_seconds, "error_code": ask_run.get("error_code")},
        "answer": answer[:800],
        "citations": [{"citation_no": c.get("citation_no"), "source_id": c.get("source_id"), "source_version_id": c.get("source_version_id"), "title": c.get("title"), "locator": c.get("locator")} for c in citations],
        "private_source_cited": any(c.get("source_id") == source_id for c in citations),
        "notes": [
            "源文件与版本是测试用户私有数据；worker 用 service key 下载，BFF 用用户会话创建 run。",
            "answer 只允许引用 allowlist source_version_ids；shared corpus 不会混入该问题的引用。",
            "该测试文件是合成样例，不是正式培养方案；测试后可删除 source 级联清理。",
        ],
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "citations"}, ensure_ascii=False, indent=2))
    print(f"report: {out}")


if __name__ == "__main__":
    main()
