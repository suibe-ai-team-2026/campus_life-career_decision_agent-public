from app.models import EmbeddingProfile
from app.retrieval.hybrid import GateResult
from app.retrieval.service import RetrievalOutcome, merge_user_evidence


def _profile() -> EmbeddingProfile:
    return EmbeddingProfile(
        profile_id="p1",
        provider="openrouter",
        model="m",
        dimensions=8,
        normalization="l2",
        query_template_version="q1",
        splitter_version="s1",
        status="ready",
    )


def _gate() -> GateResult:
    return GateResult(
        passed=True, dense_top=0.9, lexical_top=0.5, keyword_overlap=2, thresholds={}, version="g1"
    )


def _item(no: int, chunk_id: str, *, scope: str = "approved_reference", text: str = "正文") -> dict:
    return {
        "citation_no": no,
        "chunk_id": chunk_id,
        "source_id": f"src_{chunk_id}",
        "source_version_id": f"ver_{chunk_id}",
        "title": f"来源 {chunk_id}",
        "publisher": None,
        "canonical_url": None,
        "verification_status": "unverified",
        "source_scope": scope,
        "source_type": "text",
        "ordinal": 1,
        "text": text,
        "context": text,
        "locator": {},
    }


def _outcome(evidence: list[dict], warnings: list[str] | None = None) -> RetrievalOutcome:
    return RetrievalOutcome(
        evidence=evidence,
        citations=[],
        gate=_gate(),
        embedding_profile=_profile(),
        corpus_version="corpus-v1",
        warnings=list(warnings or []),
    )


def test_user_evidence_goes_first_and_citations_are_renumbered():
    primary = _outcome([_item(1, "a"), _item(2, "b")])
    extra = _outcome([_item(1, "mine")])

    merged = merge_user_evidence(primary, extra, max_evidence=10)

    assert [item["chunk_id"] for item in merged.evidence] == ["mine", "a", "b"]
    assert [item["citation_no"] for item in merged.evidence] == [1, 2, 3]
    assert [citation.citation_no for citation in merged.citations] == [1, 2, 3]
    assert "user_sources_included:1" in merged.warnings
    assert merged.candidate_counts["user_upload_evidence"] == 1


def test_duplicate_chunks_are_removed_once():
    primary = _outcome([_item(1, "a"), _item(2, "b")])
    extra = _outcome([_item(1, "a"), _item(2, "mine")])

    merged = merge_user_evidence(primary, extra, max_evidence=10)

    assert [item["chunk_id"] for item in merged.evidence] == ["a", "mine", "b"]


def test_max_evidence_caps_total():
    primary = _outcome([_item(1, "a"), _item(2, "b"), _item(3, "c")])
    extra = _outcome([_item(1, "mine")])

    merged = merge_user_evidence(primary, extra, max_evidence=2)

    assert [item["chunk_id"] for item in merged.evidence] == ["mine", "a"]


def test_no_user_evidence_keeps_primary_untouched():
    primary = _outcome([_item(1, "a")], warnings=["w1"])
    merged = merge_user_evidence(primary, _outcome([]), max_evidence=5)

    assert [item["chunk_id"] for item in merged.evidence] == ["a"]
    assert merged.warnings == ["w1"]
    assert merged.candidate_counts["user_upload_evidence"] == 0
