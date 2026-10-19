"""检索纯逻辑测试：RRF、距离转相似度、多样性上限、来源类型配额、邻近扩展、字符预算、闸门。"""

from __future__ import annotations

from app.config import RetrievalConfig
from app.retrieval.hybrid import (
    Candidate,
    assemble_evidence,
    evaluate_gate,
    rrf_fuse,
    select_candidates,
)

CONFIG = RetrievalConfig()


def _row(
    chunk_id: str,
    *,
    branch: str = "dense",
    score: float = 0.2,
    source_version: str = "sv1",
    source_id: str = "src1",
    source_scope: str = "official",
    title: str | None = None,
    ordinal: int = 0,
    text: str = "",
) -> dict:
    return {
        "branch": branch,
        "chunk_id": chunk_id,
        "source_version_id": source_version,
        "source_id": source_id,
        "title": title or f"来源 {source_id}",
        "publisher": "测试出版社",
        "canonical_url": None,
        "verification_status": "verified",
        "source_scope": source_scope,
        "owner_id": None,
        "ordinal": ordinal,
        "text": text or f"片段正文 {chunk_id}",
        "locator": {"kind": "page", "page": ordinal + 1},
        "heading_path": "第一章",
        "score": score,
    }


def _candidates(rows: list[dict]) -> list[Candidate]:
    return [Candidate.from_row(row) for row in rows]


def test_rrf_fuses_both_branches_and_dense_distance_became_similarity():
    rows = [
        _row("A", branch="dense", score=0.2),
        _row("A", branch="lexical", score=5.0),
        _row("B", branch="dense", score=0.4),
    ]
    fused = rrf_fuse(_candidates(rows), rrf_k=60)
    assert fused["A"].dense_similarity == 0.8
    assert fused["B"].dense_similarity == 0.6
    # A 在两个分支都是 rank1：1/61 + 1/61；B 只有 dense rank2：1/62
    assert fused["A"].rrf > fused["B"].rrf
    assert fused["A"].rrf == 1 / 61 + 1 / 61


def test_select_respects_per_document_and_per_source_limits():
    rows = []
    for index in range(6):
        rows.append(_row(f"same-doc-{index}", source_version="sv-same", source_id=f"src-{index}", score=0.1 + index * 0.01))
    for index in range(8):
        rows.append(_row(f"other-{index}", source_version=f"sv-{index}", source_id=f"src-x-{index}", score=0.5 + index * 0.01))
    selected = select_candidates(rrf_fuse(_candidates(rows), rrf_k=60), question="就业方向", config=CONFIG)
    same_doc = [item for item in selected.items if item.candidate.source_version_id == "sv-same"]
    assert len(same_doc) <= CONFIG.max_per_document
    per_source: dict[str, int] = {}
    for item in selected.items:
        per_source[item.candidate.source_id] = per_source.get(item.candidate.source_id, 0) + 1
    assert all(count <= CONFIG.max_per_source for count in per_source.values())


def test_source_type_quota_reserves_policy_and_job_evidence():
    rows = [
        _row("job-1", source_scope="job", score=0.05),
        _row("job-2", source_scope="job", score=0.06),
        _row("job-3", source_scope="job", score=0.07),
        _row("policy-1", source_scope="policy", score=0.30),
        _row("plan-1", source_scope="plan", score=0.40),
    ]
    fused = rrf_fuse(_candidates(rows), rrf_k=60, question="2026年招聘岗位要求有哪些政策变化？")
    selection = select_candidates(fused, question="2026年招聘岗位要求有哪些政策变化？", config=CONFIG)
    types = {item.candidate.source_type for item in selection.items}
    assert "policy" in types
    assert "job" in types
    assert set(selection.requested_types) == {"policy", "job"}


def test_selection_is_deterministic():
    rows = [_row(f"c{index}", score=0.1 * index, source_version=f"sv{index}") for index in range(20)]
    first = select_candidates(rrf_fuse(_candidates(rows)), question="国贸就业", config=CONFIG)
    second = select_candidates(rrf_fuse(_candidates(rows)), question="国贸就业", config=CONFIG)
    assert [item.chunk_id for item in first.items] == [item.chunk_id for item in second.items]
    assert len(first.items) <= CONFIG.max_evidence


def test_neighbor_expansion_is_context_only_and_budget_limits_evidence():
    rows = [_row("a", text="甲" * 4000, score=0.1), _row("b", source_version="sv2", source_id="src2", text="乙" * 4000, score=0.2)]
    fused = rrf_fuse(_candidates(rows))
    selection = select_candidates(fused, question="国贸就业", config=CONFIG)
    neighbors = {"a": [{"chunk_id": "a-neighbor", "text": "邻里正文" * 50, "locator": {"kind": "page", "page": 2}}]}
    bundle = assemble_evidence(selection, question="国贸就业", config=CONFIG, neighbors_by_anchor=neighbors)
    assert len(bundle.evidence) == 1  # 第二段超出 7000 字符预算被跳过
    assert bundle.evidence[0]["citation_no"] == 1
    assert "邻里正文" in bundle.evidence[0]["context"]
    assert bundle.char_count <= CONFIG.evidence_char_budget


def test_gate_thresholds_and_version_are_configurable():
    rows = [_row("high", score=0.1)]  # similarity 0.9
    fused = rrf_fuse(_candidates(rows), question="上海对外经贸大学2024届毕业生去向")
    selection = select_candidates(fused, question="上海对外经贸大学2024届毕业生去向", config=CONFIG)
    bundle = assemble_evidence(selection, question="上海对外经贸大学2024届毕业生去向", config=CONFIG)
    gate = evaluate_gate(bundle.evidence, question="上海对外经贸大学2024届毕业生去向", config=CONFIG)
    assert gate.passed is True
    assert gate.version == CONFIG.gate_version
    assert gate.thresholds["dense_min_similarity"] == CONFIG.dense_min_similarity

    low_rows = [
        _row("low", score=0.55, text="完全不相关的文本内容"),
    ]
    low_fused = rrf_fuse(_candidates(low_rows), question="量子计算芯片制造")
    low_selection = select_candidates(low_fused, question="量子计算芯片制造", config=CONFIG)
    low_bundle = assemble_evidence(low_selection, question="量子计算芯片制造", config=CONFIG)
    low_gate = evaluate_gate(low_bundle.evidence, question="量子计算芯片制造", config=CONFIG)
    assert low_gate.passed is False
    assert low_gate.reason == "below_threshold"


def test_empty_evidence_gate_fails():
    gate = evaluate_gate([], question="任意问题", config=CONFIG)
    assert gate.passed is False
    assert gate.reason == "no_evidence"
