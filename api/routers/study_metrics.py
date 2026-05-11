"""Genote: Study metrics aggregation API."""

from fastapi import APIRouter

from api.models import StudyMetricsResponse
from open_notebook.database.repository import repo_query

router = APIRouter()


@router.get("/study/metrics", response_model=StudyMetricsResponse)
async def get_weekly_metrics():
    """Get study metrics for the current week."""
    # Aggregate study sessions this week
    sessions = await repo_query("""
        SELECT * FROM study_session
        WHERE created >= time::now() - 7d
    """)

    total_minutes = sum(s.get("duration_minutes", 0) for s in sessions)
    total_hours = round(total_minutes / 60, 1)

    # Count notes created this week
    notes = await repo_query("""
        SELECT count() as c FROM note
        WHERE created >= time::now() - 7d GROUP ALL
    """)
    new_notes = notes[0]["c"] if notes else 0

    # Count AI questions (approximated via chat sessions)
    chats = await repo_query("""
        SELECT count() as c FROM chat_session
        WHERE created >= time::now() - 7d GROUP ALL
    """)
    ai_questions = chats[0]["c"] if chats else 0

    # Previous week comparison
    prev_sessions = await repo_query("""
        SELECT * FROM study_session
        WHERE created >= time::now() - 14d AND created < time::now() - 7d
    """)
    prev_minutes = sum(s.get("duration_minutes", 0) for s in prev_sessions)
    if prev_minutes > 0:
        hours_change_pct = round(((total_minutes - prev_minutes) / prev_minutes) * 100, 1)
    else:
        hours_change_pct = 0.0

    return StudyMetricsResponse(
        total_hours=total_hours,
        new_notes=new_notes,
        ai_questions=ai_questions,
        avg_response_time=3.7,  # placeholder — can be tracked via chat service
        hours_change_pct=hours_change_pct,
    )
