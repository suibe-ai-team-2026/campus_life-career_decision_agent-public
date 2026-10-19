"""月度模型预算闸门。

设计要点：
- ``MODEL_MONTHLY_BUDGET_USD`` 未设置（None）时**fail closed**：任何模型调用直接
  以 ``budget_exceeded`` 拒绝，绝不把「未配置」当成「无限预算」。
- 已花费金额来自 ``app_usage.estimated_cost`` 的当月汇总；成本未知的行
  （token 未知、价格未知）按 ``UNKNOWN_USAGE_RESERVE_USD`` 逐条预留，避免把
  未知成本当成 0。
- 每次请求前用输入长度/最大输出 token 做保守预估；请求后按实际 token 记账。
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from decimal import Decimal

from .errors import BudgetExceeded

MONTHLY_BUDGET_UNSET_MESSAGE = (
    "MODEL_MONTHLY_BUDGET_USD 未设置：worker 拒绝在无月度预算上限时调用模型。"
    "请在部署环境变量中配置预算后重启。"
)


def utc_month_start(now: datetime | None = None) -> datetime:
    current = now or datetime.now(timezone.utc)
    return current.astimezone(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)


class BudgetGuard:
    """按自然月（UTC）追踪已花费金额，并在模型请求前做保守检查。"""

    def __init__(
        self,
        monthly_budget_usd: Decimal | None,
        *,
        unknown_usage_reserve_usd: Decimal = Decimal("0.02"),
        spent_usd: Decimal | None = None,
        unknown_cost_usage_count: int = 0,
        logger=None,
    ) -> None:
        self._budget = monthly_budget_usd
        self._unknown_reserve = unknown_usage_reserve_usd
        self._spent = spent_usd if spent_usd is not None else Decimal(0)
        self._unknown_count = max(0, int(unknown_cost_usage_count))
        self._lock = threading.Lock()
        self._logger = logger
        self._calls_reserved = 0

    # -- 查询 -------------------------------------------------------------
    @property
    def configured(self) -> bool:
        return self._budget is not None

    @property
    def budget_usd(self) -> Decimal | None:
        return self._budget

    @property
    def spent_usd(self) -> Decimal:
        with self._lock:
            return self._spent

    @property
    def unknown_cost_usage_count(self) -> int:
        with self._lock:
            return self._unknown_count

    def reserved_for_unknown_usd(self) -> Decimal:
        with self._lock:
            return self._unknown_reserve * Decimal(self._unknown_count)

    def remaining_usd(self) -> Decimal | None:
        if self._budget is None:
            return None
        with self._lock:
            return self._budget - self._spent - self._unknown_reserve * Decimal(self._unknown_count)

    # -- 状态同步 ---------------------------------------------------------
    def refresh(self, *, spent_usd: Decimal | None, unknown_cost_usage_count: int) -> None:
        """从数据库刷新当月花费；未知行数用于保守预留。"""

        with self._lock:
            if spent_usd is not None:
                self._spent = spent_usd
            self._unknown_count = max(0, int(unknown_cost_usage_count))

    # -- 闸门 -------------------------------------------------------------
    def assert_can_spend(self, estimated_usd: Decimal | None, *, operation: str = "model_call") -> None:
        budget = self._budget
        if budget is None:
            raise BudgetExceeded(MONTHLY_BUDGET_UNSET_MESSAGE, detail=operation)
        if budget <= 0:
            raise BudgetExceeded(f"当月模型预算为 {budget}，拒绝任何模型调用", detail=operation)
        estimate = estimated_usd if estimated_usd is not None else Decimal(0)
        with self._lock:
            committed = self._spent + self._unknown_reserve * Decimal(self._unknown_count) + estimate
            if committed > budget:
                raise BudgetExceeded(
                    f"当月模型预算不足：已花费/预留 {committed:.6f} USD，预算 {budget:.6f} USD",
                    detail=operation,
                )

    def commit(self, actual_usd: Decimal | None) -> None:
        """请求成功后按实际成本记账；``None`` 表示成本未知，按预留值计入。"""

        with self._lock:
            if actual_usd is None:
                self._unknown_count += 1
            else:
                self._spent += actual_usd

    def estimate_tokens(self, text: str) -> int:
        """请求前 token 粗估（偏保守），只用于预算，不写入任何结果。"""

        chars = len(text or "")
        return max(1, chars // 2)
