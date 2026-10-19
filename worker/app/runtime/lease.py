"""租约与心跳：worker 处理 job 期间每 30s 续租一次。

``(worker_id, lease_epoch)`` 是 SQL 侧的 fencing：
- 心跳返回 false 表示 epoch 已被其他 worker 拿走 → 本 worker 立即放弃发布；
- 心跳连续失败（数据库不可达）超过半个租约时长时，保守地视为租约可能已失效。
"""

from __future__ import annotations

import threading
from typing import Any

from ..db import SupabaseDb
from ..logging_setup import get_logger, log_event

logger = get_logger("worker.lease")


class LeaseGuard:
    def __init__(
        self,
        *,
        db: SupabaseDb,
        job_id: str,
        worker_id: str,
        lease_epoch: int,
        interval_seconds: float = 30.0,
        lease_seconds: int = 120,
        thread_factory=None,
    ) -> None:
        self.db = db
        self.job_id = job_id
        self.worker_id = worker_id
        self.lease_epoch = lease_epoch
        self.interval_seconds = max(1.0, float(interval_seconds))
        self.lease_seconds = max(30, int(lease_seconds))
        self._stop = threading.Event()
        self._lost = threading.Event()
        self._thread: Any = None
        self._thread_factory = thread_factory or threading.Thread
        self._consecutive_errors = 0

    # -- 状态 -------------------------------------------------------------
    @property
    def lost(self) -> bool:
        return self._lost.is_set()

    def assert_alive(self) -> None:
        if self._lost.is_set():
            from ..errors import LeaseLostError

            raise LeaseLostError("租约已被其他 worker 接管")

    def mark_lost(self) -> None:
        self._lost.set()

    # -- 生命周期 ---------------------------------------------------------
    def start(self) -> "LeaseGuard":
        self._thread = self._thread_factory(target=self._run, name=f"lease-{self.job_id[:8]}", daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=max(2.0, self.interval_seconds + 1.0))

    def _run(self) -> None:
        while not self._stop.wait(self.interval_seconds):
            try:
                self.heartbeat_once()
            except Exception as exc:  # noqa: BLE001 - 心跳异常不能杀死 worker，但要留日志
                log_event(
                    logger,
                    "heartbeat_failed",
                    level=30,
                    job_id=self.job_id,
                    error_code=type(exc).__name__,
                )
            if self._lost.is_set():
                return

    def heartbeat_once(self) -> bool:
        """执行一次心跳；返回是否仍然持有租约。测试可直接调用。"""

        from ..errors import DatabaseError

        try:
            ok = self.db.heartbeat(self.job_id, self.worker_id, self.lease_epoch, self.lease_seconds)
        except DatabaseError:
            self._consecutive_errors += 1
            # 连续失败累计超过租约时长 → 保守地认为租约可能已被回收。
            if self._consecutive_errors * self.interval_seconds >= self.lease_seconds:
                self._lost.set()
                log_event(
                    logger,
                    "lease_assumed_lost",
                    level=40,
                    job_id=self.job_id,
                    attempt=self._consecutive_errors,
                )
            raise
        self._consecutive_errors = 0
        if not ok:
            self._lost.set()
            log_event(logger, "lease_lost", level=40, job_id=self.job_id, lease_epoch=self.lease_epoch)
        return ok
