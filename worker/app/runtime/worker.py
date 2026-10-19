"""常驻 worker：claim → 分派固定图 → 心跳续租 → complete / fail。

- ``WORKER_CONCURRENCY=1``：一次只处理一个大任务，常驻循环单线程；
- 心跳线程每 30s 续租；租约丢失后不再尝试发布结果（SQL fencing 兜底）；
- SIGTERM/SIGINT 触发优雅退出：不再 claim 新任务，当前任务跑完后退出；
- 异常不吞：每个 job 的异常都会映射成 run.error_code 写入 worker_fail_job，
  并留下单行安全日志（run_id/job_id/model/耗时/token/error_code）。
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import sys
import threading
import time
import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from ..budget import BudgetGuard, utc_month_start
from ..config import Config
from ..db import SupabaseDb
from ..errors import (
    ConfigError,
    DatabaseError,
    LeaseLostError,
    RunCancelledError,
    StaleLeaseError,
    WorkerError,
    classify,
    redact,
)
from ..graphs import dispatch
from ..logging_setup import configure_logging, get_logger, log_event
from ..models import ClaimedJob
from ..providers.openrouter import OpenRouterClient
from ..retrieval.service import RetrievalService
from ..rules.engine import RulesEngine
from ..graphs.common import JobContext
from ..rules.repository import SupabaseRulesRepository

logger = get_logger("worker.runtime")


def generate_worker_id() -> str:
    host = socket.gethostname().split(".")[0][:40]
    return f"{host}-{os.getpid()}-{uuid.uuid4().hex[:6]}"


@dataclass
class WorkerDeps:
    config: Config
    db: SupabaseDb
    provider: OpenRouterClient
    retrieval: RetrievalService
    rules_engine: RulesEngine
    budget: BudgetGuard
    worker_id: str


def build_deps(config: Config) -> WorkerDeps:
    budget = BudgetGuard(
        config.model_monthly_budget_usd,
        unknown_usage_reserve_usd=config.unknown_usage_reserve_usd,
        logger=logger,
    )
    db = SupabaseDb(config)
    provider = OpenRouterClient(config, budget=budget)
    retrieval = RetrievalService(config=config, db=db, provider=provider)
    rules_engine = RulesEngine(SupabaseRulesRepository(db), rules_version=config.rules_version)
    worker_id = config.worker_id or generate_worker_id()
    return WorkerDeps(
        config=config,
        db=db,
        provider=provider,
        retrieval=retrieval,
        rules_engine=rules_engine,
        budget=budget,
        worker_id=worker_id,
    )


class Worker:
    def __init__(self, deps: WorkerDeps, *, logger_override=None) -> None:
        self.deps = deps
        self.config = deps.config
        self.logger = logger_override or logger
        self.shutdown_event = threading.Event()

    # ------------------------------------------------------------------
    # 生命周期
    # ------------------------------------------------------------------
    def request_shutdown(self, signum: int | None = None) -> None:
        if not self.shutdown_event.is_set():
            log_event(self.logger, "worker_shutdown_requested", level=30, worker_id=self.deps.worker_id)
        self.shutdown_event.set()

    def run_forever(self) -> None:
        log_event(
            self.logger,
            "worker_started",
            worker_id=self.deps.worker_id,
            status="ready",
            budget_state="unset" if self.deps.budget.budget_usd is None else "configured",
        )
        backoff = max(1.0, self.config.poll_interval_seconds)
        while not self.shutdown_event.is_set():
            try:
                job = self.deps.db.claim_job(self.deps.worker_id, self.config.lease_seconds)
            except Exception as exc:  # noqa: BLE001 - 数据库暂时不可用不能杀进程
                log_event(
                    self.logger,
                    "claim_failed",
                    level=40,
                    worker_id=self.deps.worker_id,
                    error_code=type(exc).__name__,
                )
                self.shutdown_event.wait(backoff)
                backoff = min(60.0, backoff * 2)
                continue
            backoff = max(1.0, self.config.poll_interval_seconds)
            if job is None:
                self.shutdown_event.wait(self.config.poll_interval_seconds)
                continue
            self.process_job(job)
        log_event(self.logger, "worker_stopped", worker_id=self.deps.worker_id, status="stopped")
        self.close()

    def run_once(self) -> bool:
        """claim 并处理一个 job；返回是否处理了任务（便于本地冒烟测试）。"""

        job = self.deps.db.claim_job(self.deps.worker_id, self.config.lease_seconds)
        if job is None:
            return False
        self.process_job(job)
        return True

    def close(self) -> None:
        for closable in (self.deps.provider, self.deps.db):
            try:
                closable.close()
            except Exception:  # noqa: BLE001 - 关闭失败不影响退出
                pass

    # ------------------------------------------------------------------
    # 单个 job
    # ------------------------------------------------------------------
    def process_job(self, job: ClaimedJob) -> None:
        started = time.monotonic()
        log_event(
            self.logger,
            "job_claimed",
            job_id=job.job_id,
            run_id=job.run_id,
            kind=job.kind,
            attempt=job.attempts,
            max_attempts=job.max_attempts,
            worker_id=self.deps.worker_id,
        )
        from .lease import LeaseGuard

        lease = LeaseGuard(
            db=self.deps.db,
            job_id=job.job_id,
            worker_id=self.deps.worker_id,
            lease_epoch=job.lease_epoch,
            interval_seconds=self.config.heartbeat_interval_seconds,
            lease_seconds=self.config.lease_seconds,
        ).start()
        ctx = JobContext(
            config=self.config,
            db=self.deps.db,
            provider=self.deps.provider,
            retrieval=self.deps.retrieval,
            rules_engine=self.deps.rules_engine,
            job=job,
            worker_id=self.deps.worker_id,
            emit_progress=lambda status, progress: self._emit_progress(job, lease, status, progress),
            cancel_check=lambda: self._check_cancel(job, lease),
            logger=self.logger,
            budget=self.deps.budget,
        )
        # 检索服务是共享实例（并发=1），把本次 job 的用量记录器接到 ctx 上。
        self.deps.retrieval.on_usage = ctx.record_usage
        try:
            self._refresh_budget()
            payload = dispatch(ctx)
            if not isinstance(payload, dict):
                raise WorkerError("图没有返回 JSON 对象结果")
            self.deps.db.complete_job(job.job_id, self.deps.worker_id, job.lease_epoch, payload)
            log_event(
                self.logger,
                "job_succeeded",
                job_id=job.job_id,
                run_id=job.run_id,
                kind=job.kind,
                duration_ms=int((time.monotonic() - started) * 1000),
                status="succeeded",
            )
        except RunCancelledError:
            outcome = self._safe_fail(job, "cancelled", retryable=False)
            log_event(self.logger, "job_cancelled", level=30, job_id=job.job_id, run_id=job.run_id, kind=job.kind, status=outcome)
        except (LeaseLostError, StaleLeaseError):
            # 租约丢失时 SQL 已经拒绝写入；不要再用 fail_job 覆盖别的 worker 的结果。
            log_event(self.logger, "job_lease_lost", level=40, job_id=job.job_id, run_id=job.run_id, kind=job.kind)
        except WorkerError as exc:
            outcome = self._safe_fail(job, exc.code, retryable=exc.retryable)
            log_event(
                self.logger,
                "job_failed",
                level=40,
                job_id=job.job_id,
                run_id=job.run_id,
                kind=job.kind,
                error_code=exc.code,
                retryable=exc.retryable,
                status=outcome,
                duration_ms=int((time.monotonic() - started) * 1000),
            )
        except Exception as exc:  # noqa: BLE001 - 未知异常必须上报并交给 DB 重试策略
            code, retryable = classify(exc)
            outcome = self._safe_fail(job, code, retryable=retryable)
            log_event(
                self.logger,
                "job_crashed",
                level=40,
                job_id=job.job_id,
                run_id=job.run_id,
                kind=job.kind,
                error_code=redact(type(exc).__name__, limit=80),
                retryable=retryable,
                status=outcome,
                duration_ms=int((time.monotonic() - started) * 1000),
            )
            # 只记录异常类型；SafeFormatter 会额外写脱敏后的 error_message，不输出请求体/密钥。
            self.logger.error("unhandled exception type=%s", type(exc).__name__)
        finally:
            lease.stop()

    # ------------------------------------------------------------------
    # 内部
    # ------------------------------------------------------------------
    def _emit_progress(self, job: ClaimedJob, lease, status: str, progress: int) -> None:
        lease.assert_alive()
        ok = self.deps.db.set_progress(job.job_id, self.deps.worker_id, job.lease_epoch, status, progress)
        if not ok:
            lease.mark_lost()
            raise LeaseLostError("worker_set_progress 被 fencing 拒绝")

    def _check_cancel(self, job: ClaimedJob, lease) -> None:
        lease.assert_alive()
        if self.deps.db.get_run_cancel_requested(job.run_id):
            raise RunCancelledError("run 已请求取消")

    def _refresh_budget(self) -> None:
        if self.deps.budget.budget_usd is None:
            # 未配置预算时 provider 会 fail closed；这里只留一条可见告警。
            log_event(self.logger, "budget_unset", level=30, budget_state="unset")
            return
        try:
            totals = self.deps.db.usage_since(since=utc_month_start())
            self.deps.budget.refresh(
                spent_usd=totals.spent_usd or Decimal(0),
                unknown_cost_usage_count=totals.unknown_cost_usage_count,
            )
        except DatabaseError:
            # 查不到当月用量时不要放行（宁可不调用模型），预算闸门会按本地已花费判断。
            log_event(self.logger, "budget_refresh_failed", level=40, budget_state="unknown")

    def _safe_fail(self, job: ClaimedJob, error_code: str, *, retryable: bool) -> str:
        try:
            outcome = self.deps.db.fail_job(
                job.job_id,
                self.deps.worker_id,
                job.lease_epoch,
                error_code,
                retryable,
            )
            return str(outcome)
        except Exception as exc:  # noqa: BLE001 - 上报失败只记录，不再抛
            log_event(
                self.logger,
                "fail_job_report_failed",
                level=40,
                job_id=job.job_id,
                run_id=job.run_id,
                error_code=type(exc).__name__,
            )
            return "report_failed"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _safe_print(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="知途（Campus Pathway）Python worker")
    parser.add_argument("--once", action="store_true", help="处理一个 job 后退出（冒烟测试）")
    parser.add_argument("--check", action="store_true", help="只校验配置，不连接数据库/模型")
    parser.add_argument("--version", action="store_true", help="打印 worker 版本")
    args = parser.parse_args(argv)
    if args.version:
        from .. import __version__

        print(f"campus-pathway-worker {__version__}")
        return 0
    try:
        config = Config.from_env()
    except ConfigError as exc:
        print(f"配置错误：{exc.safe_message}", file=sys.stderr)
        return 2
    configure_logging(config.log_level)
    if args.check:
        _safe_print(
            {
                "ok": config.model_monthly_budget_usd is not None,
                "config": config.safe_summary(),
                "warnings": [] if config.model_monthly_budget_usd is not None else ["MODEL_MONTHLY_BUDGET_USD 未设置：模型调用会被拒绝"],
            }
        )
        return 0 if config.model_monthly_budget_usd is not None else 2
    deps = build_deps(config)
    worker = Worker(deps)
    if args.once:
        worker.run_once()
        worker.close()
        return 0

    def _handle(signum, _frame):  # noqa: ANN001
        worker.request_shutdown(signum)

    signal.signal(signal.SIGTERM, _handle)
    signal.signal(signal.SIGINT, _handle)
    try:
        worker.run_forever()
    except KeyboardInterrupt:  # pragma: no cover
        worker.request_shutdown()
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
