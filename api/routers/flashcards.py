"""Genote: Flashcard API router - CRUD + SM-2 spaced repetition scheduling."""

from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, HTTPException, Query

from api.models import (
    FlashcardCreate,
    FlashcardDeckCreate,
    FlashcardDeckResponse,
    FlashcardGrade,
    FlashcardResponse,
)
from open_notebook.database.repository import ensure_record_id, repo_query

router = APIRouter()

# SM-2 algorithm: mapping grade → ease adjustment & interval multiplier
SM2_PARAMS = {
    "again": {"ease_delta": -0.20, "interval_mult": 0, "min_interval": 0},
    "hard":  {"ease_delta": -0.15, "interval_mult": 1.2, "min_interval": 1},
    "good":  {"ease_delta": 0.0,   "interval_mult": 2.5, "min_interval": 1},
    "easy":  {"ease_delta": 0.15,  "interval_mult": 2.5, "min_interval": 4},
}


# ─── Decks ────────────────────────────────────────────────────────────

@router.get("/flashcards/decks", response_model=List[FlashcardDeckResponse])
async def list_decks():
    result = await repo_query("""
        SELECT *
        FROM flashcard_deck ORDER BY updated DESC
    """)
    decks = []
    for d in result:
        deck_id = ensure_record_id(d["id"])
        cards = await repo_query(
            "SELECT count() as c FROM flashcard WHERE deck = $id GROUP ALL",
            {"id": deck_id},
        )
        due = await repo_query(
            """
            SELECT count() as c
            FROM flashcard
            WHERE deck = $id AND next_review <= time::now()
            GROUP ALL
            """,
            {"id": deck_id},
        )
        card_count = cards[0]["c"] if cards else 0
        due_count = due[0]["c"] if due else 0
        decks.append(FlashcardDeckResponse(
            id=str(d["id"]),
            name=d.get("name", ""),
            description=d.get("description", ""),
            notebook_id=str(d["notebook_id"]) if d.get("notebook_id") else None,
            card_count=card_count,
            due_count=due_count,
            created=str(d.get("created", "")),
            updated=str(d.get("updated", "")),
        ))
    return decks


@router.post("/flashcards/decks", response_model=FlashcardDeckResponse)
async def create_deck(body: FlashcardDeckCreate):
    data = {"name": body.name, "description": body.description}
    if body.notebook_id:
        data["notebook_id"] = ensure_record_id(body.notebook_id)
    result = await repo_query("CREATE flashcard_deck CONTENT $data RETURN AFTER", {"data": data})
    d = result[0] if result else {}
    return FlashcardDeckResponse(
        id=str(d.get("id", "")),
        name=d.get("name", ""),
        description=d.get("description", ""),
        notebook_id=str(d["notebook_id"]) if d.get("notebook_id") else None,
        card_count=0, due_count=0,
        created=str(d.get("created", "")),
        updated=str(d.get("updated", "")),
    )


# ─── Cards ────────────────────────────────────────────────────────────

@router.get("/flashcards/cards/due", response_model=List[FlashcardResponse])
async def list_due_cards(
    limit: int = Query(50, ge=1, le=200, description="Maximum cards to return"),
):
    result = await repo_query(
        """
        SELECT *
        FROM flashcard
        WHERE next_review <= time::now()
        ORDER BY next_review ASC
        LIMIT $limit
        """,
        {"limit": limit},
    )
    return [_card_response(r) for r in result]


@router.get("/flashcards/decks/{deck_id}/cards", response_model=List[FlashcardResponse])
async def list_cards(
    deck_id: str,
    due_only: bool = Query(False, description="Only return cards due for review"),
):
    deck_record_id = await _get_deck_id(deck_id)
    where = "deck = $deck_id"
    if due_only:
        where += " AND next_review <= time::now()"
    result = await repo_query(
        f"SELECT * FROM flashcard WHERE {where} ORDER BY next_review ASC",
        {"deck_id": deck_record_id},
    )
    return [_card_response(r) for r in result]


@router.post("/flashcards/decks/{deck_id}/cards", response_model=FlashcardResponse)
async def create_card(deck_id: str, body: FlashcardCreate):
    deck_record_id = await _get_deck_id(deck_id)
    if body.deck_id:
        try:
            body_deck_id = ensure_record_id(body.deck_id)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Invalid body deck_id") from exc
        if str(body_deck_id) != str(deck_record_id):
            raise HTTPException(status_code=400, detail="Body deck_id does not match route")

    now = datetime.now(timezone.utc)
    data = {
        "question": body.question,
        "answer": body.answer,
        "source_ref": body.source_ref,
        "deck": deck_record_id,
        "ease_factor": 2.5,
        "interval_days": 0,
        "repetitions": 0,
        "next_review": now,
        "created": now,
        "updated": now,
    }
    result = await repo_query("CREATE flashcard CONTENT $data RETURN AFTER", {"data": data})
    if not result:
        raise HTTPException(status_code=500, detail="Failed to create flashcard")
    return _card_response(result[0])


@router.post("/flashcards/cards/{card_id}/grade", response_model=FlashcardResponse)
async def grade_card(card_id: str, body: FlashcardGrade):
    card_result = await repo_query("SELECT * FROM $id", {"id": ensure_record_id(card_id)})
    if not card_result:
        raise HTTPException(status_code=404, detail="Card not found")
    card = card_result[0]

    params = SM2_PARAMS[body.grade]
    ease = max(1.3, card.get("ease_factor", 2.5) + params["ease_delta"])
    reps = card.get("repetitions", 0) + 1 if body.grade != "again" else 0

    if body.grade == "again":
        interval = 0
    elif reps == 1:
        interval = 1
    elif reps == 2:
        interval = 6
    else:
        interval = round(card.get("interval_days", 1) * params["interval_mult"])

    interval = max(interval, params["min_interval"])
    now = datetime.now(timezone.utc)
    next_review = now + timedelta(days=interval)

    update = {
        "ease_factor": ease,
        "interval_days": interval,
        "repetitions": reps,
        "next_review": next_review,
        "last_review": now,
        "updated": now,
    }
    await repo_query("UPDATE $id MERGE $data", {"id": ensure_record_id(card_id), "data": update})
    updated = await repo_query("SELECT * FROM $id", {"id": ensure_record_id(card_id)})
    if not updated:
        raise HTTPException(status_code=404, detail="Card not found")
    return _card_response(updated[0])


def _card_response(card: dict) -> FlashcardResponse:
    return FlashcardResponse(
        id=str(card["id"]),
        question=card.get("question", ""),
        answer=card.get("answer", ""),
        source_ref=card.get("source_ref"),
        deck_id=str(card["deck"]),
        ease_factor=float(card.get("ease_factor", 2.5)),
        interval_days=int(card.get("interval_days", 0)),
        repetitions=int(card.get("repetitions", 0)),
        next_review=str(card.get("next_review", "")),
        last_review=str(card.get("last_review", "")) if card.get("last_review") else None,
        created=str(card.get("created", "")),
        updated=str(card.get("updated", "")),
    )


async def _get_deck_id(deck_id: str):
    try:
        deck_record_id = ensure_record_id(deck_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid deck_id") from exc
    result = await repo_query("SELECT id FROM $id", {"id": deck_record_id})
    if not result:
        raise HTTPException(status_code=404, detail="Deck not found")
    return deck_record_id
