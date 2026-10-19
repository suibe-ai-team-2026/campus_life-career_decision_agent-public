"""运行时测试：claim→dispatch→complete/fail、fencing、取消、优雅退出、心跳、进度单调。"""

from __future__ import annotations

import time
from decimal import Decimal

import pytest

from app.budget import BudgetGuard
from app.errors import LeaseLostError, ModelAuthFailed, RunCancelledError, StaleLeaseError
from app.models import ClaimedJob, ModelUsage
from app.providers.openrouter import ChatResponse
from app.retrieval.service import RetrievalService
from app.runtime.lease import LeaseGuard
from app.runtime.worker import Worker, WorkerDeps
from tests.fakes import FakeDb, FakeProvider, make_claim, make_config, make_context, make_rules_engine

OWNER = "11111111-1111-1111-1111-111111111111"


def _deps(config, db, provider) -> WorkerDeps:
    return WorkerDeps(
        config=config,
        db=db,  # type: ignore[arg-type]
        provider=provider,  # type: ignore[arg-type]
        retrieval=RetrievalService(config=config, db=db, provider=provider),  # type: ignore[arg-type]
        rules_engine=make_rules_engine(),
        budget=BudgetGuard(Decimal("10.00")),
        worker_id="test-worker",
    )


def _worker(monkeypatch, *, dispatch_fn) -> tuple[Worker, FakeDb, FakeProvider]:
    config = make_config()
    db = FakeDb(config=config)
    provider = FakeProvider(config)
    worker = Worker(_deps(config, db, provider))
    monkeypatch.setattr("app.runtime.worker.dispatch", dispatch_fn)
    return worker, db, provider


def test_run_once_completes_job_with_payload(monkeypatch):
    worker, db, _provider = _worker(monkeypatch, dispatch_fn=lambda ctx: {"answer": "ok"})
    db.claim_queue.append(make_claim({"question": "q"}, kind="ask", owner_id=OWNER))
    assert worker.run_once() is True
    assert db.completed == [{"answer": "ok"}]


def test_run_once_returns_false_when_no_job(monkeypatch):
    worker, db, _provider = _worker(monkeypatch, dispatch_fn=lambda ctx: {})
    assert worker.run_once() is False
    assert db.completed == []


def test_worker_error_is_reported_with_retryable_flag(monkeypatch):
    def crash(ctx):
        raise ModelAuthFailed("bad key")

    worker, db, _provider = _worker(monkeypatch, dispatch_fn=crash)
    db.claim_queue.append(make_claim({}, kind="ask", owner_id=OWNER))
    assert worker.run_once() is True
    assert db.completed == []
    assert db.fail_calls == [("model_auth_failed", False, "1")]


def test_unexpected_exception_mapped_to_internal_error_retryable(monkeypatch):
    def crash(ctx):
        raise RuntimeError("boom")

    worker, db, _provider = _worker(monkeypatch, dispatch_fn=crash)
    db.claim_queue.append(make_claim({}, kind="ask", owner_id=OWNER))
    worker.run_once()
    assert db.fail_calls == [("internal_error", True, "1")]


def test_cancelled_run_is_failed_as_cancelled(monkeypatch):
    def cancel(ctx):
        raise RunCancelledError("cancel requested")

    worker, db, _provider = _worker(monkeypatch, dispatch_fn=cancel)
    db.claim_queue.append(make_claim({}, kind="ask", owner_id=OWNER))
    worker.run_once()
    assert db.fail_calls == [("cancelled", False, "1")]


def test_stale_lease_does_not_overwrite_result(monkeypatch):
    worker, db, _provider = _worker(monkeypatch, dispatch_fn=lambda ctx: {"answer": "late"})

    def stale_complete(*_args, **_kwargs):
        raise StaleLeaseError("lease gone")

    db.complete_job = stale_complete  # type: ignore[assignment]
    db.claim_queue.append(make_claim({}, kind="ask", owner_id=OWNER))
    worker.run_once()
    assert db.fail_calls == []  # 旧 worker 不允许再写 fail_job 覆盖别人的结果
    assert db.completed == []


def test_graceful_shutdown_exits_without_claiming(monkeypatch):
    worker, db, _provider = _worker(monkeypatch, dispatch_fn=lambda ctx: {})
    called: list[str] = []
    db.claim_job = lambda *args, **kwargs: called.append("claim")  # type: ignore[assignment]
    worker.shutdown_event.set()
    worker.run_forever()
    assert called == []


def test_claim_failure_is_logged_and_loop_can_stop(monkeypatch):
    worker, db, _provider = _worker(monkeypatch, dispatch_fn=lambda ctx: {})

    def flaky_claim(*_args, **_kwargs):
        worker.shutdown_event.set()
        raise RuntimeError("db down")

    db.claim_job = flaky_claim  # type: ignore[assignment]
    started = time.monotonic()
    worker.run_forever()
    assert time.monotonic() - started < 5


def test_job_context_progress_is_monotonic_below_100():
    config = make_config()
    db = FakeDb(config=config)
    provider = FakeProvider(config)
    emits: list[tuple[str, int]] = []
    from tests.fakes import make_context

    ctx = make_context(config=config, db=db, provider=provider, job=make_claim({}, kind="ask"), emits=emits)
    ctx.emit("planning", 20)
    ctx.emit("planning", 20)  # 同阶段重复自动 +1
    ctx.emit("validating", 95)
    ctx.emit("validating", 99)  # 不允许到 100
    assert emits[0] == ("planning", 20)
    assert emits[1] == ("planning", 21)
    assert all(progress < 100 for _, progress in emits)
    assert all(left[1] < right[1] for left, right in zip(emits, emits[1:]))


def test_job_context_records_usage_and_commits_budget():
    config = make_config()
    db = FakeDb(config=config)
    provider = FakeProvider(config)
    budget = BudgetGuard(Decimal("10.00"))
    from tests.fakes import make_context

    ctx = make_context(config=config, db=db, provider=provider, job=make_claim({}, kind="ask"), budget=budget)
    usage = ModelUsage(
        provider="openrouter",
        model=config.chat_model,
        operation="chat_ask",
        input_tokens=10,
        output_tokens=5,
        latency_ms=3,
        estimated_cost=Decimal("0.001"),
    )
    ctx.record_usage(usage)
    assert len(db.usage_rows) == 1
    assert db.usage_rows[0]["input_tokens"] == 10
    assert budget.spent_usd == Decimal("0.001")
    # 未知 token 必须保持 None，不能写 0
    ctx.record_usage(
        ModelUsage(provider="openrouter", model=config.chat_model, operation="chat_ask", input_tokens=None, output_tokens=None, latency_ms=3, estimated_cost=None)
    )
    assert db.usage_rows[1]["input_tokens"] is None
    assert db.usage_rows[1]["estimated_cost"] is None


def test_lease_guard_detects_lost_lease_and_heartbeat_errors():
    config = make_config()
    db = FakeDb(config=config)
    db.heartbeat_response = False
    guard = LeaseGuard(db=db, job_id="job", worker_id="w", lease_epoch=1, interval_seconds=1, lease_seconds=30)  # type: ignore[arg-type]
    assert guard.heartbeat_once() is False
    assert guard.lost is True
    with pytest.raises(LeaseLostError):
        guard.assert_alive()

    db2 = FakeDb(config=config)
    from app.errors import DatabaseError as _DatabaseError

    db2.heartbeat_errors = [_DatabaseError("db down") for _ in range(3)]
    guard2 = LeaseGuard(db=db2, job_id="job", worker_id="w", lease_epoch=1, interval_seconds=10, lease_seconds=30)  # type: ignore[arg-type]
    from app.errors import DatabaseError

    for _ in range(3):
        with pytest.raises(DatabaseError):
            guard2.heartbeat_once()
    assert guard2.lost is True
    guard2.mark_lost()
    assert guard2.lost is True


def test_lease_guard_success_resets_error_counter():
    config = make_config()
    db = FakeDb(config=config)
    guard = LeaseGuard(db=db, job_id="job", worker_id="w", lease_epoch=1, interval_seconds=1, lease_seconds=30)  # type: ignore[arg-type]
    assert guard.heartbeat_once() is True
    assert guard.lost is False
