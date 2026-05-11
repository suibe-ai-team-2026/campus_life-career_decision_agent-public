"""Genote: Study streaks and check-in API."""

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter

from api.models import CheckinResponse, StreakStatusResponse
from open_notebook.database.repository import repo_query

router = APIRouter()


@router.get("/study/streak", response_model=StreakStatusResponse)
async def get_streak_status():
    """Get current study streak status."""
    checkins = await repo_query(
        "SELECT * FROM study_checkin ORDER BY date DESC"
    )
    if not checkins:
        return StreakStatusResponse(
            streak_days=0,
            checked_in_today=False,
            days_until_reward=7,
            total_xp=0,
        )

    today = datetime.now(timezone.utc).date()
    checkin_dates = {
        checkin_date
        for checkin in checkins
        if (checkin_date := _coerce_date(checkin.get("date"))) is not None
    }
    checked_in_today = today in checkin_dates
    cursor = today if checked_in_today else today - timedelta(days=1)
    streak_days = 0

    while cursor in checkin_dates:
        streak_days += 1
        cursor -= timedelta(days=1)

    days_until_reward = 7 if streak_days == 0 else (7 - streak_days % 7) % 7
    total_xp = sum(c.get("xp_earned", 0) for c in checkins)

    return StreakStatusResponse(
        streak_days=streak_days,
        checked_in_today=checked_in_today,
        days_until_reward=days_until_reward,
        total_xp=total_xp,
    )


@router.post("/study/checkin", response_model=CheckinResponse)
async def do_checkin():
    """Perform daily check-in."""
    status = await get_streak_status()

    if status.checked_in_today:
        return CheckinResponse(
            checked_in=False,
            streak_days=status.streak_days,
            xp_earned=0,
            message="今日已签到，明天再来吧！",
        )

    streak_days = status.streak_days + 1
    xp = 10 if streak_days % 7 == 0 else 2
    now = datetime.now(timezone.utc)

    await repo_query(
        "CREATE study_checkin CONTENT $data",
        {"data": {
            "date": now,
            "streak_days": streak_days,
            "xp_earned": xp,
            "created": now,
        }},
    )

    msg = f"签到成功！连胜 {streak_days} 天"
    if streak_days % 7 == 0:
        msg += " - 达成 7 天奖励！+10 经验"

    return CheckinResponse(
        checked_in=True,
        streak_days=streak_days,
        xp_earned=xp,
        message=msg,
    )


def _coerce_date(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
        except ValueError:
            return None
    return None
