"""检索服务：查询 embedding → SQL 授权候选 → 融合/配额/预算 → 闸门。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Sequence

from ..config import PROVIDER_NAME, Config
from ..db import SupabaseDb
from ..logging_setup import get_logger, log_event
from ..models import Citation, EmbeddingProfile, ModelUsage
from ..providers.openrouter import OpenRouterClient, embed_query, vector_literal
from .hybrid import (
    Candidate,
    GateResult,
    Selection,
    assemble_evidence,
    evaluate_gate,
    rrf_fuse,
    select_candidates,
)

logger = get_logger("worker.retrieval")

UsageCallback = Callable[[ModelUsage], None]


@dataclass
class RetrievalOutcome:
    evidence: list[dict[str, Any]]
    citations: list[Citation]
    gate: GateResult
    embedding_profile: EmbeddingProfile
    corpus_version: str
    candidate_counts: dict[str, int] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    selection: Selection | None = None


class RetrievalService:
    def __init__(
        self,
        *,
        config: Config,
        db: SupabaseDb,
        provider: OpenRouterClient,
        on_usage: UsageCallback | None = None,
    ) -> None:
        self.config = config
        self.db = db
        self.provider = provider
        self.on_usage: UsageCallback | None = on_usage

    def ensure_profile(self) -> EmbeddingProfile:
        profile = EmbeddingProfile(
            profile_id=self.config.embedding_profile_id,
            provider=PROVIDER_NAME,
            model=self.config.embedding_model,
            dimensions=self.config.embedding_dimensions,
            normalization=self.config.embedding_normalization,
            query_template_version=self.config.embedding_query_template_version,
            splitter_version=self.config.ingest.splitter_version,
            status="building",
            metadata={
                "embedding_instruction_mode": self.config.embedding_instruction_mode,
                "query_instruction_template_version": self.config.embedding_query_template_version,
                "token_estimator_version": self.config.ingest.token_estimator_version,
            },
        )
        return self.db.ensure_embedding_profile(profile)

    def corpus_version(self, profile: EmbeddingProfile | None = None) -> str:
        profile = profile or self.ensure_profile()
        return f"{profile.profile_id}@{profile.splitter_version}"

    def search(
        self,
        *,
        owner_id: str,
        run_id: str,
        question: str,
        source_version_ids: Sequence[str] | None = None,
        candidate_limit: int | None = None,
    ) -> RetrievalOutcome:
        profile = self.ensure_profile()
        question = (question or "").strip()
        query_vector, usage = embed_query(self.config, self.provider, question)
        if usage is not None and self.on_usage is not None:
            self.on_usage(usage)
        limit = candidate_limit or self.config.retrieval.candidate_limit
        rows = self.db.search_chunks(
            owner_id=owner_id,
            profile_id=profile.profile_id,
            query_embedding_text=vector_literal(query_vector),
            query_text=question,
            limit=limit,
        )
        allowlist = {str(item).lower() for item in (source_version_ids or [])}
        candidates: list[Candidate] = []
        for row in rows:
            candidate = Candidate.from_row(row, question=question)
            if allowlist and candidate.source_version_id.lower() not in allowlist:
                continue
            candidates.append(candidate)

        fused = rrf_fuse(candidates, rrf_k=self.config.retrieval.rrf_k, question=question)
        selection = select_candidates(fused, question=question, config=self.config.retrieval)
        neighbors_by_anchor: dict[str, list[dict[str, Any]]] = {}
        if self.config.retrieval.neighbor_expansion and selection.items:
            anchors = [item.candidate.chunk_id for item in selection.items[: self.config.retrieval.max_evidence]]
            neighbor_rows = self.db.chunk_neighbors(chunk_ids=anchors, owner_id=owner_id)
            for row in neighbor_rows:
                anchor = str(row.get("anchor_chunk_id") or "")
                if not anchor:
                    continue
                neighbors_by_anchor.setdefault(anchor, []).append(row)
        bundle = assemble_evidence(
            selection,
            question=question,
            config=self.config.retrieval,
            neighbors_by_anchor=neighbors_by_anchor,
        )
        warnings = list(selection.warnings) + list(bundle.warnings)
        # 邻近块只做上下文；闸门基于带编号证据自身的分数。
        gate = evaluate_gate(bundle.evidence, question=question, config=self.config.retrieval)
        citations = [self._citation(item) for item in bundle.evidence]
        counts = {
            "dense": sum(1 for candidate in candidates if candidate.branch == "dense"),
            "lexical": sum(1 for candidate in candidates if candidate.branch == "lexical"),
            "fused": len(fused),
            "selected": len(selection.items),
        }
        log_event(
            logger,
            "retrieval_done",
            run_id=run_id,
            kind="retrieval",
            candidates=counts,
            evidence=len(bundle.evidence),
            gate_version=gate.version,
            profile_id=profile.profile_id,
        )
        return RetrievalOutcome(
            evidence=bundle.evidence,
            citations=citations,
            gate=gate,
            embedding_profile=profile,
            corpus_version=f"{profile.profile_id}@{profile.splitter_version}",
            candidate_counts=counts,
            warnings=warnings,
            selection=selection,
        )

    @staticmethod
    def _citation(item: dict[str, Any]) -> Citation:
        text = str(item.get("text") or "")
        excerpt = text[:360] + ("…" if len(text) > 360 else "")
        return Citation(
            citation_no=int(item["citation_no"]),
            source_id=str(item.get("source_id") or ""),
            source_version_id=str(item["source_version_id"]),
            chunk_id=str(item["chunk_id"]),
            record_id=None,
            title=str(item.get("title") or ""),
            locator=dict(item.get("locator") or {}),
            excerpt=excerpt,
            verification_status=str(item.get("verification_status") or "unverified"),
            source_scope=str(item.get("source_scope") or ""),
        )


def evidence_text_bundle(evidence: Sequence[dict[str, Any]]) -> str:
    """给数字校验用：所有可引用证据的正文（不含邻近块的是否引用歧义，按全部正文）。"""

    return "\n".join(str(item.get("text") or "") for item in evidence)


def merge_user_evidence(
    primary: RetrievalOutcome,
    extra: RetrievalOutcome,
    *,
    max_evidence: int,
) -> RetrievalOutcome:
    """把用户私有上传的召回结果并入主检索，并重建引用编号。

    - 用户自己的资料排在前面，方便解释直接引用；
    - 主检索原有相对顺序不变；
    - 同一 chunk 只保留一次；总条数受 max_evidence 限制。
    """

    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    limit = max(1, int(max_evidence))
    for item in [*(extra.evidence or []), *(primary.evidence or [])]:
        chunk_id = str(item.get("chunk_id") or "")
        if chunk_id:
            if chunk_id in seen:
                continue
            seen.add(chunk_id)
        merged.append(dict(item))
        if len(merged) >= limit:
            break

    for index, item in enumerate(merged, start=1):
        item["citation_no"] = index

    warnings = list(primary.warnings)
    if extra.evidence:
        warnings.append(f"user_sources_included:{len(extra.evidence)}")
    counts = dict(primary.candidate_counts)
    counts["user_upload_evidence"] = len(extra.evidence)

    return RetrievalOutcome(
        evidence=merged,
        citations=[RetrievalService._citation(item) for item in merged],
        gate=primary.gate,
        embedding_profile=primary.embedding_profile,
        corpus_version=primary.corpus_version,
        candidate_counts=counts,
        warnings=warnings,
        selection=primary.selection,
    )
