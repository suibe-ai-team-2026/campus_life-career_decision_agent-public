"""混合检索的纯逻辑层：RRF / 多样性上限 / 来源类型配额 / 邻近扩展 / 字符预算 / 闸门。

这一层不访问网络、不读写数据库，全部是纯函数，便于离线单测；输入来自
``public.worker_search_chunks``（已在 SQL 内做授权过滤）与 ``worker_chunk_neighbors``。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

import jieba

from ..config import RetrievalConfig

CJK_RUN_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+")

SOURCE_TYPES = ("policy", "job", "plan", "case", "catalog", "official", "research", "other")

# 问题里出现这些词时，要求配额里保留对应来源类型的最少段数。
TYPE_TRIGGERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "policy",
        ("政策", "通知", "意见", "办法", "规定", "部署", "举措", "文件", "沪教委", "教育部"),
    ),
    (
        "job",
        ("招聘", "岗位", "jd", "要求", "技能", "证书", "实习", "求职", "就业市场", "任职", "职责"),
    ),
    (
        "plan",
        ("怎么准备", "如何准备", "下一步", "行动", "路线", "规划", "准备什么", "做什么", "建议", "提升"),
    ),
    (
        "case",
        ("学长", "学姐", "案例", "经历", "自述", "转行", "求职故事", "前人", "毕业生说"),
    ),
    (
        "catalog",
        ("哪些学校", "哪些高校", "目录", "培养方案", "课程表", "信息公开", "招生", "专业设置"),
    ),
)

_SCOPE_ALIASES = {
    "policy": "policy",
    "policy_document": "policy",
    "regulation": "policy",
    "job": "job",
    "job_posting": "job",
    "jd": "job",
    "recruitment": "job",
    "plan": "plan",
    "action_plan": "plan",
    "guidance": "plan",
    "case": "case",
    "case_study": "case",
    "graduate_case": "case",
    "catalog": "catalog",
    "curriculum": "catalog",
    "directory": "catalog",
    "official": "official",
    "official_observation": "official",
    "research": "research",
    "research_claim": "research",
}


def tokenize_for_overlap(text: str) -> set[str]:
    """问题/片段的关键词集合：jieba 词 + 中文二元字（长度≥2）。"""

    tokens: set[str] = set()
    for term in jieba.lcut(text or ""):
        term = term.strip()
        if len(term) >= 2:
            tokens.add(term.lower())
    for run in CJK_RUN_RE.findall(text or ""):
        if len(run) < 2:
            continue
        for index in range(len(run) - 1):
            tokens.add(run[index : index + 2])
    return tokens


def keyword_overlap(question_terms: set[str], text: str) -> int:
    return len(question_terms & tokenize_for_overlap(text))


def requested_types(question: str, config: RetrievalConfig) -> tuple[str, ...]:
    lowered = (question or "").lower()
    requested: list[str] = []
    for source_type, triggers in TYPE_TRIGGERS:
        if any(trigger in lowered for trigger in triggers):
            requested.append(source_type)
    # 只保留配置里登记了配额的来源类型（policy/job/plan/case/catalog）。
    quota_types = {source_type for source_type, _ in config.type_quota}
    return tuple(item for item in requested if item in quota_types)


def classify_source_type(row: dict[str, Any], question: str = "") -> str:
    scope = str(row.get("source_scope") or "").strip().lower()
    if scope in _SCOPE_ALIASES:
        return _SCOPE_ALIASES[scope]
    title = str(row.get("title") or "")
    lowered = title.lower()
    if any(word in lowered for word in ("政策", "通知", "意见", "办法", "规定", "部署")):
        return "policy"
    if any(word in lowered for word in ("招聘", "岗位", "职位", "jd", "任职要求")):
        return "job"
    if any(word in lowered for word in ("培养方案", "课程表", "教学计划", "专业目录", "信息公开")):
        return "catalog"
    if any(word in lowered for word in ("案例", "访谈", "自述", "经验分享", "毕业生说")):
        return "case"
    if any(word in lowered for word in ("行动方案", "准备路线", "规划建议", "如何准备")):
        return "plan"
    if any(word in lowered for word in ("就业质量报告", "指标", "统计", "公报")):
        return "official"
    if any(word in lowered for word in ("研究", "观察", "归纳", "分析报告")):
        return "research"
    return "other"


@dataclass
class Candidate:
    branch: str
    chunk_id: str
    source_version_id: str
    source_id: str
    title: str
    publisher: str
    canonical_url: str
    verification_status: str
    source_scope: str
    owner_id: str | None
    ordinal: int
    text: str
    locator: dict[str, Any]
    heading_path: str
    score: float
    source_type: str = "other"

    @classmethod
    def from_row(cls, row: dict[str, Any], *, question: str = "") -> "Candidate":
        return cls(
            branch=str(row.get("branch") or ""),
            chunk_id=str(row["chunk_id"]),
            source_version_id=str(row["source_version_id"]),
            source_id=str(row.get("source_id") or ""),
            title=str(row.get("title") or ""),
            publisher=str(row.get("publisher") or ""),
            canonical_url=str(row.get("canonical_url") or ""),
            verification_status=str(row.get("verification_status") or "unverified"),
            source_scope=str(row.get("source_scope") or ""),
            owner_id=None if row.get("owner_id") is None else str(row["owner_id"]),
            ordinal=int(row.get("ordinal") or 0),
            text=str(row.get("text") or ""),
            locator=dict(row.get("locator") or {}),
            heading_path=str(row.get("heading_path") or ""),
            score=float(row.get("score") or 0.0),
            source_type=classify_source_type(row, question),
        )


@dataclass
class FusedCandidate:
    candidate: Candidate
    rrf: float
    dense_rank: int | None = None
    lexical_rank: int | None = None
    dense_similarity: float | None = None
    lexical_score: float | None = None
    keyword_overlap: int = 0

    @property
    def chunk_id(self) -> str:
        return self.candidate.chunk_id


def _branch_rankings(candidates: Iterable[Candidate]) -> dict[str, list[tuple[int, Candidate]]]:
    dense: list[Candidate] = []
    lexical: list[Candidate] = []
    for candidate in candidates:
        if candidate.branch == "dense":
            dense.append(candidate)
        elif candidate.branch == "lexical":
            lexical.append(candidate)
    # dense 分支的 score 是 cosine 距离（越小越相似）；lexical 是 ts_rank（越大越好）。
    dense_sorted = sorted(dense, key=lambda item: (item.score, item.chunk_id))
    lexical_sorted = sorted(lexical, key=lambda item: (-item.score, item.chunk_id))
    return {
        "dense": list(enumerate(dense_sorted, start=1)),
        "lexical": list(enumerate(lexical_sorted, start=1)),
    }


def rrf_fuse(candidates: Iterable[Candidate], *, rrf_k: int = 60, question: str = "") -> dict[str, FusedCandidate]:
    """RRF(k) 融合 dense/lexical 两个分支；同一 chunk 在两个分支出现则分数相加。"""

    candidate_list = list(candidates)
    fused: dict[str, FusedCandidate] = {}
    rankings = _branch_rankings(candidate_list)
    for branch, ranked in rankings.items():
        for rank, candidate in ranked:
            item = fused.get(candidate.chunk_id)
            if item is None:
                item = FusedCandidate(candidate=candidate, rrf=0.0)
                fused[candidate.chunk_id] = item
            item.rrf += 1.0 / (rrf_k + rank)
            if branch == "dense":
                item.dense_rank = rank
                # 余弦距离 → 相似度；用于闸门，不展示给用户。
                item.dense_similarity = 1.0 - candidate.score
            else:
                item.lexical_rank = rank
                item.lexical_score = candidate.score
    question_terms = tokenize_for_overlap(question)
    for item in fused.values():
        item.keyword_overlap = keyword_overlap(question_terms, item.candidate.text)
        if item.candidate.source_type == "other":
            item.candidate.source_type = classify_source_type(
                {
                    "title": item.candidate.title,
                    "source_scope": item.candidate.source_scope,
                },
                question,
            )
    return fused


def _ranked(fused: dict[str, FusedCandidate]) -> list[FusedCandidate]:
    """稳定排序：RRF 降序，同分按 chunk_id，保证同输入同结果。"""

    return sorted(fused.values(), key=lambda item: (-round(item.rrf, 12), item.chunk_id))


@dataclass
class Selection:
    items: list[FusedCandidate]
    requested_types: tuple[str, ...]
    warnings: list[str] = field(default_factory=list)


def select_candidates(
    fused: dict[str, FusedCandidate],
    *,
    question: str,
    config: RetrievalConfig,
) -> Selection:
    """多样性上限 + 来源类型配额，选出 8–12 段。"""

    ordered = _ranked(fused)
    quotas = dict(config.type_quota)
    wanted = requested_types(question, config)
    selected: dict[str, FusedCandidate] = {}
    per_document: dict[str, int] = {}
    per_source: dict[str, int] = {}

    def can_add(item: FusedCandidate) -> bool:
        candidate = item.candidate
        if candidate.chunk_id in selected:
            return False
        if per_document.get(candidate.source_version_id, 0) >= config.max_per_document:
            return False
        if per_source.get(candidate.source_id, 0) >= config.max_per_source:
            return False
        return True

    def add(item: FusedCandidate) -> None:
        selected[item.chunk_id] = item
        per_document[item.candidate.source_version_id] = per_document.get(item.candidate.source_version_id, 0) + 1
        per_source[item.candidate.source_id] = per_source.get(item.candidate.source_id, 0) + 1

    # 1) 配额预留：问题提到某类资料时，先保底该类最少段数。
    for source_type in wanted:
        quota = quotas.get(source_type, 0)
        if quota <= 0:
            continue
        have = sum(1 for item in selected.values() if item.candidate.source_type == source_type)
        if have >= quota:
            continue
        for item in ordered:
            if have >= quota:
                break
            if item.candidate.source_type != source_type or not can_add(item):
                continue
            add(item)
            have += 1

    # 2) 按 RRF 填充到上限。
    for item in ordered:
        if len(selected) >= config.max_evidence:
            break
        if can_add(item):
            add(item)

    items = sorted(selected.values(), key=lambda item: (-round(item.rrf, 12), item.chunk_id))
    warnings: list[str] = []
    if len(items) < config.min_evidence:
        warnings.append("evidence_below_min")
    return Selection(items=items, requested_types=wanted, warnings=warnings)


@dataclass
class EvidenceBundle:
    evidence: list[dict[str, Any]]
    warnings: list[str]
    char_count: int


def _neighbor_context(anchor: dict[str, Any], neighbors: Sequence[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    if not neighbors:
        return anchor["text"], []
    parts = [anchor["text"]]
    used: list[dict[str, Any]] = []
    for neighbor in neighbors:
        locator = neighbor.get("locator") or {}
        parts.append(f"\n[邻近块 {locator}]\n{neighbor.get('text', '')}")
        used.append({"chunk_id": neighbor.get("chunk_id"), "locator": locator, "text": neighbor.get("text", "")})
    return "\n".join(parts), used


def assemble_evidence(
    selection: Selection,
    *,
    question: str,
    config: RetrievalConfig,
    neighbors_by_anchor: dict[str, list[dict[str, Any]]] | None = None,
    char_budget: int | None = None,
) -> EvidenceBundle:
    """把选中的段组装成带编号的证据；邻近块只做上下文，不增加引用编号。"""

    budget = char_budget if char_budget is not None else config.evidence_char_budget
    neighbors_map = neighbors_by_anchor or {}
    evidence: list[dict[str, Any]] = []
    warnings: list[str] = []
    used_chars = 0
    used_chunk_ids: set[str] = set()
    citation_no = 0
    for item in selection.items:
        candidate = item.candidate
        neighbors = [
            neighbor
            for neighbor in neighbors_map.get(candidate.chunk_id, [])
            if str(neighbor.get("chunk_id")) not in used_chunk_ids
        ]
        context, used_neighbors = _neighbor_context(
            {
                "text": candidate.text,
                "chunk_id": candidate.chunk_id,
            },
            neighbors,
        )
        cost = len(context)
        if evidence and used_chars + cost > budget:
            continue
        if not evidence and cost > budget:
            # 至少保留一段（软预算），截断只在上下文展示层，不改变数据库原文。
            context = context[:budget]
            cost = len(context)
            warnings.append("evidence_truncated_to_budget")
        citation_no += 1
        used_chars += cost
        used_chunk_ids.add(candidate.chunk_id)
        for neighbor in used_neighbors:
            used_chunk_ids.add(str(neighbor.get("chunk_id")))
        evidence.append(
            {
                "citation_no": citation_no,
                "chunk_id": candidate.chunk_id,
                "source_version_id": candidate.source_version_id,
                "source_id": candidate.source_id,
                "title": candidate.title,
                "publisher": candidate.publisher,
                "canonical_url": candidate.canonical_url,
                "verification_status": candidate.verification_status,
                "source_scope": candidate.source_scope,
                "source_type": candidate.source_type,
                "ordinal": candidate.ordinal,
                "text": candidate.text,
                "context": context,
                "locator": candidate.locator,
                "heading_path": candidate.heading_path,
                "neighbors": used_neighbors,
                "scores": {
                    "rrf": round(item.rrf, 8),
                    "dense_similarity": None if item.dense_similarity is None else round(item.dense_similarity, 6),
                    "lexical": None if item.lexical_score is None else round(item.lexical_score, 6),
                    "keyword_overlap": item.keyword_overlap,
                },
            }
        )
    if used_chars and used_chars > budget:
        warnings.append("evidence_char_budget_soft_exceeded")
    return EvidenceBundle(evidence=evidence, warnings=warnings, char_count=used_chars)


@dataclass
class GateResult:
    passed: bool
    dense_top: float
    lexical_top: float
    keyword_overlap: int
    thresholds: dict[str, Any]
    version: str
    reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "dense_top": round(self.dense_top, 6),
            "lexical_top": round(self.lexical_top, 6),
            "keyword_overlap": self.keyword_overlap,
            "thresholds": dict(self.thresholds),
            "gate_version": self.version,
            "reason": self.reason,
        }


def evaluate_gate(
    evidence: Sequence[dict[str, Any]],
    *,
    question: str,
    config: RetrievalConfig,
) -> GateResult:
    """拒答闸门：阈值/版本来自配置；不过闸门时不调用生成模型。"""

    thresholds = {
        "dense_min_similarity": config.dense_min_similarity,
        "lexical_min_score": config.lexical_min_score,
        "keyword_overlap_min": config.keyword_overlap_min,
        "gate_version": config.gate_version,
    }
    if not evidence:
        return GateResult(False, 0.0, 0.0, 0, thresholds, config.gate_version, "no_evidence")
    dense_top = max(float(item["scores"].get("dense_similarity") or 0.0) for item in evidence)
    lexical_top = max(float(item["scores"].get("lexical") or 0.0) for item in evidence)
    overlap_top = max(int(item["scores"].get("keyword_overlap") or 0) for item in evidence)
    passed = (
        dense_top >= config.dense_min_similarity
        or (lexical_top >= config.lexical_min_score and overlap_top >= config.keyword_overlap_min)
        or overlap_top >= config.keyword_overlap_min + 2
    )
    reason = None if passed else "below_threshold"
    return GateResult(passed, dense_top, lexical_top, overlap_top, thresholds, config.gate_version, reason)
