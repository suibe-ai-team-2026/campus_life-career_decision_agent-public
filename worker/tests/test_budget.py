"""预算闸门测试：未配置 fail closed、超额拒绝、未知成本预留、记账。"""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.budget import BudgetGuard, utc_month_start
from app.errors import BudgetExceeded


def test_unset_budget_fails_closed():
    guard = BudgetGuard(None)
    assert guard.configured is False
    with pytest.raises(BudgetExceeded) as excinfo:
        guard.assert_can_spend(None, operation="embedding")
    assert "MODEL_MONTHLY_BUDGET_USD" in str(excinfo.value)


def test_spend_within_budget_and_over_budget():
    guard = BudgetGuard(Decimal("1.00"), spent_usd=Decimal("0.10"))
    guard.assert_can_spend(Decimal("0.80"), operation="chat")
    with pytest.raises(BudgetExceeded):
        guard.assert_can_spend(Decimal("0.95"), operation="chat")


def test_unknown_cost_usage_reserved_conservatively():
    guard = BudgetGuard(Decimal("1.00"), unknown_usage_reserve_usd=Decimal("0.20"), unknown_cost_usage_count=3)
    assert guard.reserved_for_unknown_usd() == Decimal("0.60")
    with pytest.raises(BudgetExceeded):
        guard.assert_can_spend(Decimal("0.50"), operation="chat")  # 0.6 + 0.5 > 1.0


def test_commit_tracks_known_and_unknown_cost():
    guard = BudgetGuard(Decimal("1.00"))
    guard.commit(Decimal("0.25"))
    assert guard.spent_usd == Decimal("0.25")
    assert guard.unknown_cost_usage_count == 0
    # 成本未知（None）时按未知条数预留，不当作 0 花费
    guard.commit(None)
    assert guard.unknown_cost_usage_count == 1
    assert guard.reserved_for_unknown_usd() == guard._unknown_reserve  # noqa: SLF001


def test_refresh_replaces_spend_and_unknown_count():
    guard = BudgetGuard(Decimal("5.00"))
    guard.refresh(spent_usd=Decimal("1.25"), unknown_cost_usage_count=2)
    assert guard.spent_usd == Decimal("1.25")
    assert guard.unknown_cost_usage_count == 2
    assert guard.remaining_usd() is not None


def test_month_start_is_utc_first_day():
    start = utc_month_start()
    assert start.day == 1 and start.hour == 0 and start.minute == 0


def test_estimate_tokens_positive():
    guard = BudgetGuard(Decimal("1.00"))
    assert guard.estimate_tokens("") >= 1
    assert guard.estimate_tokens("国际贸易实务") >= 2

def test_zero_budget_blocks_even_free_looking_calls():
    guard = BudgetGuard(Decimal("0"))
    with pytest.raises(BudgetExceeded):
        guard.assert_can_spend(None, operation="embedding")
