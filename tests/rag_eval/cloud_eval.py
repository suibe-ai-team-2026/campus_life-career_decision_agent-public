#!/usr/bin/env python3
"""Run the 38-question regression against the live BFF + cloud worker."""
from __future__ import annotations

import argparse
import json
import statistics
import time
import urllib.error
import urllib.request
import uuid
from http.cookiejar import CookieJar
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_QUESTIONS = Path(__file__).with_name("cloud_questions.json")
DEFAULT_OUT = ROOT / "docs" / "evidence" / "rag-eval-cloud.json"


def opener():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))


def call(op, base, method, path, body=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, headers={"Content-Type": "application/json"}, method=method)
    try:
        with op.open(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read().decode())
        except Exception:
            return exc.code, {}


def wait_run(op, base, run_id, timeout=150):
    started = time.time()
    while time.time() - started < timeout:
        status, payload = call(op, base, "GET", f"/api/runs/{run_id}")
        run = (payload.get("data") or {}).get("run") or {}
        if run.get("status") in {"succeeded", "failed", "cancelled"}:
            return run, time.time() - started
        time.sleep(2)
    return {"run_id": run_id, "status": "timeout"}, time.time() - started


def percentile(values, p):
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((p / 100) * (len(ordered) - 1))))
    return round(ordered[index], 1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:3100")
    parser.add_argument("--questions", default=str(DEFAULT_QUESTIONS))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    questions = json.loads(Path(args.questions).read_text())
    if args.limit:
        questions = questions[: args.limit]
    op = opener()
    status, _ = call(op, args.base, "POST", "/api/auth/anonymous")
    if status != 200:
        raise SystemExit(f"anonymous auth failed: {status}")

    rows = []
    for item in questions:
        started = time.time()
        status, payload = call(
            op,
            args.base,
            "POST",
            "/api/runs",
            {
                "kind": "ask",
                "idempotency_key": str(uuid.uuid4()),
                "question": item["question"],
            },
        )
        run = {}
        latency = None
        if status == 202:
            run_id = (payload.get("data") or {}).get("run_id")
            run, latency = wait_run(op, args.base, run_id)
        result = run.get("result") or {}
        citations = result.get("citations") or []
        source_ids = {str(c.get("source_id")) for c in citations if c.get("source_id")}
        expected = set(item.get("expected_source_ids") or [])
        expected_behavior = item.get("expected_behavior", "answer")
        refusal = bool(result.get("refusal"))
        row = {
            "id": item["id"],
            "category": item.get("category"),
            "question": item["question"],
            "expected_behavior": expected_behavior,
            "expected_source_ids": sorted(expected),
            "status": run.get("status", "submit_failed"),
            "error_code": run.get("error_code"),
            "refusal": refusal,
            "citation_count": len(citations),
            "citation_source_ids": sorted(source_ids),
            "expected_source_hit": bool(expected & source_ids),
            "min_citations_met": len(citations) >= int(item.get("min_citations") or 0),
            "answer": (result.get("answer") or "")[:1200],
            "boundary_note": result.get("boundary_note"),
            "latency_ms": int((latency if latency is not None else time.time() - started) * 1000),
        }
        rows.append(row)
        print(f"{row['id']} {row['status']} refusal={refusal} cites={row['citation_count']} hit={row['expected_source_hit']} {row['latency_ms']}ms", flush=True)

    answered_expected = [r for r in rows if r["expected_behavior"] == "answer"]
    refused_expected = [r for r in rows if r["expected_behavior"] == "refuse"]
    latencies = [r["latency_ms"] for r in rows if r["status"] == "succeeded"]
    summary = {
        "executed_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "base": args.base,
        "questions": len(rows),
        "succeeded": sum(1 for r in rows if r["status"] == "succeeded"),
        "failed": sum(1 for r in rows if r["status"] != "succeeded"),
        "expected_answer": len(answered_expected),
        "expected_refuse": len(refused_expected),
        "answered": sum(1 for r in rows if not r["refusal"] and r["status"] == "succeeded"),
        "refused": sum(1 for r in rows if r["refusal"]),
        "source_hit": sum(1 for r in rows if r["expected_source_hit"]),
        "source_hit_rate": round(sum(1 for r in rows if r["expected_source_hit"]) / len(rows), 3) if rows else None,
        "false_refusal": sum(1 for r in answered_expected if r["refusal"]),
        "missed_refusal": sum(1 for r in refused_expected if not r["refusal"]),
        "citation_count_total": sum(r["citation_count"] for r in rows),
        "latency_ms": {
            "avg": round(statistics.mean(latencies), 1) if latencies else None,
            "p50": percentile(latencies, 50),
            "p95": percentile(latencies, 95),
        },
        "notes": [
            "旧 PR #7 的 38/38 只是该 PR 快照的回归数字，不作为本版准确率或 SLA 承诺。",
            "expected_source_hit 只验证引用 source_id 是否命中，不等于人工确认引用支持关系。",
            "未做 10 条人工引用支持关系抽检时，本报告不宣称事实准确性。",
        ],
        "rows": rows,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "rows"}, ensure_ascii=False, indent=2))
    print(f"report: {out}")


if __name__ == "__main__":
    main()
