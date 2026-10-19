"""Supabase 数据访问层测试：RPC 参数、fencing 错误映射、owner 过滤、脱敏、storage、usage。"""

from __future__ import annotations

import json
from decimal import Decimal

import httpx
import pytest

from app.db import SupabaseDb
from app.errors import BadRequest, DatabaseError, ResourceNotFound, StaleLeaseError
from app.models import ClaimedJob
from tests.fakes import BASE_ENV, make_config


class Router:
    def __init__(self, routes) -> None:
        self.routes = routes
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        for pattern, response in self.routes:
            if pattern in path:
                if callable(response):
                    return response(request)
                return response
        return httpx.Response(404, json={"message": f"no route for {path}"})


def _db(routes) -> tuple[SupabaseDb, Router]:
    config = make_config()
    router = Router(routes)
    client = httpx.Client(transport=httpx.MockTransport(router))
    return SupabaseDb(config, http_client=client), router


def _json(payload, status: int = 200) -> httpx.Response:
    return httpx.Response(status, json=payload)


def test_rpc_sends_secret_headers_and_returns_claim():
    row = {
        "job_id": "job-1",
        "run_id": "run-1",
        "owner_id": "owner-1",
        "kind": "ask",
        "input": {"question": "q"},
        "profile_version": 1,
        "attempts": 1,
        "max_attempts": 3,
        "lease_epoch": 2,
    }
    db, router = _db([("rpc/worker_claim_job", _json([row]))])
    job = db.claim_job("worker-1", 120)
    assert isinstance(job, ClaimedJob)
    assert job.lease_epoch == 2
    request = router.requests[0]
    assert request.headers["apikey"] == BASE_ENV["SUPABASE_SECRET_KEY"]
    assert request.headers["authorization"] == f"Bearer {BASE_ENV['SUPABASE_SECRET_KEY']}"
    body = json.loads(request.content)
    assert body == {"p_worker_id": "worker-1", "p_lease_seconds": 120}


def test_complete_job_null_result_means_stale_lease():
    db, _router = _db([("rpc/worker_complete_job", _json(None))])
    with pytest.raises(StaleLeaseError):
        db.complete_job("job", "worker", 1, {"a": 1})


def test_sql_raised_stale_lease_is_mapped():
    db, _router = _db(
        [("rpc/worker_save_plan", _json({"code": "P0001", "message": "stale_lease"}, status=400))]
    )
    with pytest.raises(StaleLeaseError):
        db.save_plan(
            job_id="job",
            worker_id="worker",
            lease_epoch=1,
            plan_id=None,
            profile_id="p",
            direction_id="trade_supply_chain",
            rules_version="v",
            corpus_version=None,
            embedding_profile_id=None,
            actions=[],
            result={},
            warnings=[],
        )


def test_owner_filter_is_enforced_even_with_service_role():
    other_owner = "22222222-2222-2222-2222-222222222222"
    row = {"profile_id": "p", "owner_id": other_owner, "version": 1}
    db, router = _db([("app_profiles", _json([row]))])
    with pytest.raises(ResourceNotFound):
        db.get_profile("11111111-1111-1111-1111-111111111111", "p")
    # 过滤条件本身也带上 owner_id=eq.<run owner>
    query = router.requests[0].url.query.decode()
    assert "owner_id=eq.11111111-1111-1111-1111-111111111111" in query


def test_error_messages_are_sanitized():
    leak = f"upstream said apikey={BASE_ENV['SUPABASE_SECRET_KEY']}"
    db, _router = _db([("app_profiles", _json({"message": leak}, status=500))])
    with pytest.raises(DatabaseError) as excinfo:
        db.select("app_profiles", filters=[("profile_id", "eq.p")])
    assert BASE_ENV["SUPABASE_SECRET_KEY"] not in excinfo.value.safe_message
    assert "[redacted]" in excinfo.value.safe_message


def test_pgrst116_maps_to_resource_not_found():
    db, _router = _db([("app_profiles", _json({"code": "PGRST116", "message": "no rows"}, status=406))])
    with pytest.raises(ResourceNotFound):
        db.select_maybe_one("app_profiles", filters=[("profile_id", "eq.p")])


def test_storage_rejects_path_traversal_without_request():
    db, router = _db([])
    with pytest.raises(BadRequest):
        db.storage_download("career-source-files", "../etc/passwd")
    assert router.requests == []


def test_record_usage_writes_null_tokens_not_zero():
    captured: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(json.loads(request.content))
        return httpx.Response(204)

    db, _router = _db([("app_usage", handler)])
    db.record_usage(
        owner_id="owner",
        run_id="run",
        provider="openrouter",
        model="deepseek/deepseek-chat",
        operation="chat_ask",
        input_tokens=None,
        output_tokens=None,
        estimated_cost=None,
        currency="USD",
        pricing_snapshot_at=None,
    )
    assert captured[0][0]["input_tokens"] is None
    assert captured[0][0]["output_tokens"] is None
    assert captured[0][0]["estimated_cost"] is None


def test_usage_since_sums_costs_and_counts_unknown_rows():
    rows = [{"estimated_cost": "0.50"}, {"estimated_cost": None}, {"estimated_cost": "0.25"}]
    db, _router = _db([("app_usage", _json(rows))])
    totals = db.usage_since(since=__import__("datetime").datetime(2026, 10, 1, tzinfo=__import__("datetime").timezone.utc))
    assert totals.spent_usd == Decimal("0.75")
    assert totals.unknown_cost_usage_count == 1


def test_search_chunks_passes_pgvector_text_and_limit():
    captured: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(json.loads(request.content))
        return _json([])

    db, _router = _db([("rpc/worker_search_chunks", handler)])
    db.search_chunks(owner_id="o", profile_id="p", query_embedding_text="[0.5,0.25]", query_text="q", limit=48)
    body = captured[0]
    assert body["p_query_embedding"] == "[0.5,0.25]"
    assert body["p_limit"] == 48
    assert body["p_owner"] == "o"
