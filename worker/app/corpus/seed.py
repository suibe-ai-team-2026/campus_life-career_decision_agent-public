"""corpus seed：把 data-dev 生成的 corpus.jsonl 写入 Supabase 并建立 Qwen3 embedding profile。

设计目标：
- **默认 dry-run**：只读本地 corpus/meta，校验完整性并打印计划计数，不联网、不写库。
- **--apply 幂等**：按 `(source_version_id, splitter_version, ordinal)` 复用 chunk；
  已有 embedding 不重复调用模型；profile 由 building 完成后再置 active。
- **不混语料**：profile 已有 corpus sha 且与本次不同 → abort；已存在别的 active
  profile → abort 并提示人工切换；chunk 文本 sha 不一致 → abort（不静默覆盖）。
- **预算 fail closed**：`--apply` 需要 `MODEL_MONTHLY_BUDGET_USD` 已配置；
  每次模型调用都走 BudgetGuard 与 app_usage 记账。

本模块不直接 argparse；CLI 在 ``worker/scripts/seed_corpus.py``。
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from ..budget import MONTHLY_BUDGET_UNSET_MESSAGE, BudgetGuard, utc_month_start
from ..config import (
    EMBEDDING_QUERY_TEMPLATE_VERSION,
    PROVIDER_NAME,
    SPLITTER_VERSION,
    Config,
)
from ..db import SupabaseDb
from ..errors import BudgetExceeded, ConfigError, WorkerError
from ..ingest.chunking import estimate_tokens
from ..logging_setup import get_logger, log_event
from ..models import EmbeddingProfile
from ..providers.openrouter import OpenRouterClient, vector_literal

logger = get_logger("worker.corpus.seed")

SEED_SCRIPT_VERSION = "worker-corpus-seed-2026-10-19.1"
SEED_PARSER_VERSION = "worker-corpus-seed-2026-10-19.1"
SEED_OPERATION = "embedding_corpus_seed"
DEFAULT_PROFILE_ID = "career-qwen-4096-v1"
DEFAULT_BATCH_SIZE = 16
MAX_BATCH_SIZE = 16
CHUNK_INSERT_BATCH = 200
EMBEDDING_INSERT_BATCH = 20
DEFAULT_PROGRESS_EVERY = 10

REQUIRED_CHUNK_FIELDS = (
    "chunk_id",
    "source_id",
    "source_version_id",
    "source_title",
    "source_scope",
    "verification_status",
    "visibility",
    "chunk_text",
    "locator",
    "heading_path",
    "search_terms",
    "sha256",
    "chars",
)
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
PROFILE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:\-]{2,99}$")


class CorpusSeedError(WorkerError):
    """corpus seed 的不可重试错误（数据/配置/状态不一致），保留安全短消息。"""

    code = "internal_error"
    retryable = False


class CorpusSeedValidationError(CorpusSeedError):
    code = "bad_request"


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CorpusChunk:
    chunk_key: str
    source_id: str
    source_version_id: str
    source_title: str
    source_scope: str
    verification_status: str
    verification_status_raw: str
    visibility: str
    chunk_kind: str
    record_id: str | None
    record_type: str | None
    text: str
    locator: dict[str, Any]
    heading_path: str
    search_terms: str
    sha256: str
    chars: int
    file_order: int


@dataclass(frozen=True)
class CorpusSource:
    source_id: str
    source_title: str
    source_scope: str
    source_version_id: str
    chunks: tuple[CorpusChunk, ...]
    registry_extra: dict[str, Any] | None

    @property
    def corpus_only(self) -> bool:
        return self.registry_extra is not None


@dataclass(frozen=True)
class SeedPackage:
    corpus_path: Path
    meta_path: Path
    corpus_version: str
    corpus_sha256: str
    corpus_bytes: int
    corpus_splitter_version: str
    meta_counts: dict[str, Any]
    sources: dict[str, CorpusSource]
    registry_extra: dict[str, dict[str, Any]]
    checks: tuple[dict[str, Any], ...]
    errors: tuple[str, ...]
    warnings: tuple[str, ...]
    meta: dict[str, Any] = field(repr=False, default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.errors

    @property
    def chunks(self) -> list[CorpusChunk]:
        return [chunk for source in self.sources.values() for chunk in source.chunks]

    @property
    def corpus_only_sources(self) -> list[CorpusSource]:
        return [source for source in self.sources.values() if source.corpus_only]


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _as_pos_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


# ---------------------------------------------------------------------------
# 读取与校验
# ---------------------------------------------------------------------------


def load_seed_package(corpus_path: Path, meta_path: Path) -> SeedPackage:
    """读取 corpus.jsonl + corpus-meta.json 并做完整性校验（不联网）。"""

    checks: list[dict[str, Any]] = []
    errors: list[str] = []
    warnings: list[str] = []

    def check(check_id: str, ok: bool, detail: str = "", *, fatal: bool = True) -> None:
        checks.append({"id": check_id, "ok": bool(ok), "detail": detail, "fatal": fatal})
        if not ok:
            if fatal:
                errors.append(f"{check_id}: {detail}" if detail else check_id)
            else:
                warnings.append(f"{check_id}: {detail}" if detail else check_id)

    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CorpusSeedValidationError(f"无法读取 corpus-meta：{meta_path.name}（{type(exc).__name__}）") from exc
    if not isinstance(meta, dict):
        raise CorpusSeedValidationError("corpus-meta.json 顶层必须是对象")
    try:
        raw = corpus_path.read_bytes()
    except OSError as exc:
        raise CorpusSeedValidationError(f"无法读取 corpus：{corpus_path.name}（{type(exc).__name__}）") from exc

    actual_sha = _sha256_bytes(raw)
    expected_sha = str(meta.get("corpus_sha256") or "")
    expected_bytes = _as_pos_int(meta.get("corpus_bytes"))
    check("corpus.sha256", bool(expected_sha) and actual_sha == expected_sha, f"实际 {actual_sha[:16]}… / meta {expected_sha[:16] if expected_sha else '缺失'}")
    check("corpus.bytes", expected_bytes is not None and expected_bytes == len(raw), f"实际 {len(raw)} / meta {expected_bytes}")

    schema = str(meta.get("schema_version") or "")
    check("meta.schema_version", schema in ("career-corpus-meta-v1", ""), f"schema_version={schema or '缺失'}", fatal=False)

    splitter = meta.get("splitter") if isinstance(meta.get("splitter"), dict) else {}
    corpus_splitter_version = str(splitter.get("version") or "")
    check(
        "corpus.splitter_version",
        True,
        f"corpus splitter={corpus_splitter_version or '未记录'}；worker 常量={SPLITTER_VERSION}（DB 使用 worker 常量，corpus 版本写入 metadata）",
        fatal=False,
    )

    lines: list[str] = raw.decode("utf-8", errors="replace").splitlines()
    parsed_chunks: list[CorpusChunk] = []
    seen_chunk_keys: set[str] = set()
    bad_hashes = 0
    bad_chars = 0
    non_approved = 0
    duplicate_keys = 0
    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            errors.append(f"corpus.jsonl:{line_number}: JSON 解析失败")
            continue
        if not isinstance(row, dict):
            errors.append(f"corpus.jsonl:{line_number}: 不是对象")
            continue
        missing = [key for key in REQUIRED_CHUNK_FIELDS if key not in row]
        if missing:
            errors.append(f"corpus.jsonl:{line_number}: 缺少字段 {','.join(missing)}")
            continue
        text = row.get("chunk_text")
        if not isinstance(text, str) or not text.strip():
            errors.append(f"corpus.jsonl:{line_number}: chunk_text 为空")
            continue
        chunk_key = str(row.get("chunk_id") or "")
        source_id = str(row.get("source_id") or "")
        source_version_id = str(row.get("source_version_id") or "")
        if not chunk_key:
            errors.append(f"corpus.jsonl:{line_number}: chunk_id 为空")
            continue
        if not source_id.startswith("src_"):
            errors.append(f"corpus.jsonl:{line_number}: source_id 非法")
            continue
        if not UUID_RE.match(source_version_id):
            errors.append(f"corpus.jsonl:{line_number}: source_version_id 不是 UUID")
            continue
        locator = row.get("locator")
        if not isinstance(locator, dict):
            errors.append(f"corpus.jsonl:{line_number}: locator 必须是对象")
            continue
        visibility = str(row.get("visibility") or "")
        if visibility != "approved_reference":
            non_approved += 1
        expected_text_sha = str(row.get("sha256") or "")
        if not SHA256_RE.match(expected_text_sha) or _sha256_text(text) != expected_text_sha:
            bad_hashes += 1
        expected_chars = _as_pos_int(row.get("chars"))
        if expected_chars is not None and expected_chars != len(text):
            bad_chars += 1
        if chunk_key in seen_chunk_keys:
            duplicate_keys += 1
            continue
        seen_chunk_keys.add(chunk_key)
        parsed_chunks.append(
            CorpusChunk(
                chunk_key=chunk_key,
                source_id=source_id,
                source_version_id=source_version_id,
                source_title=str(row.get("source_title") or ""),
                source_scope=str(row.get("source_scope") or ""),
                verification_status=str(row.get("verification_status") or "unverified"),
                verification_status_raw=str(row.get("verification_status_raw") or ""),
                visibility=visibility,
                chunk_kind=str(row.get("chunk_kind") or ""),
                record_id=None if row.get("record_id") is None else str(row.get("record_id")),
                record_type=None if row.get("record_type") is None else str(row.get("record_type")),
                text=text,
                locator=locator,
                heading_path=str(row.get("heading_path") or ""),
                search_terms=str(row.get("search_terms") or ""),
                sha256=expected_text_sha,
                chars=len(text),
                file_order=line_number,
            )
        )

    check("chunks.nonempty", bool(parsed_chunks), "corpus 为空，拒绝 seed")
    check("chunks.text_sha256", bad_hashes == 0, f"不匹配 {bad_hashes} 条")
    check("chunks.chars", bad_chars == 0, f"不匹配 {bad_chars} 条")
    check("chunks.visibility", non_approved == 0, f"非 approved_reference 记录 {non_approved} 条")
    check("chunks.chunk_id_unique", duplicate_keys == 0, f"重复 chunk_id {duplicate_keys} 条（已跳过）", fatal=False)

    # 按 source 分组，并保证一个 source 只有一个 source_version_id。
    sources: dict[str, CorpusSource] = {}
    version_by_source: dict[str, str] = {}
    for chunk in parsed_chunks:
        if chunk.source_id in version_by_source and version_by_source[chunk.source_id] != chunk.source_version_id:
            errors.append(f"来源 {chunk.source_id} 在 corpus 中有多个 source_version_id")
            continue
        version_by_source[chunk.source_id] = chunk.source_version_id
        existing = sources.get(chunk.source_id)
        if existing is None:
            sources[chunk.source_id] = CorpusSource(
                source_id=chunk.source_id,
                source_title=chunk.source_title,
                source_scope=chunk.source_scope,
                source_version_id=chunk.source_version_id,
                chunks=(chunk,),
                registry_extra=None,
            )
        else:
            sources[chunk.source_id] = CorpusSource(
                source_id=existing.source_id,
                source_title=existing.source_title,
                source_scope=existing.source_scope,
                source_version_id=existing.source_version_id,
                chunks=existing.chunks + (chunk,),
                registry_extra=None,
            )

    counts = meta.get("counts") if isinstance(meta.get("counts"), dict) else {}
    expected_chunks = _as_pos_int(counts.get("chunks"))
    check("meta.counts.chunks", expected_chunks is not None and expected_chunks == len(parsed_chunks), f"实际 {len(parsed_chunks)} / meta {expected_chunks}")
    expected_documents = _as_pos_int(counts.get("documents"))
    check("meta.counts.documents", expected_documents is not None and expected_documents == len(sources), f"实际 {len(sources)} / meta {expected_documents}", fatal=False)

    # corpus-only 来源登记（32 个）：必须在 corpus 中出现，版本与内容哈希必须确定。
    registry_extra: dict[str, dict[str, Any]] = {}
    raw_extra = meta.get("source_registry_extra")
    if not isinstance(raw_extra, list):
        errors.append("meta.source_registry_extra 必须是数组")
        raw_extra = []
    extra_version_mismatch = 0
    extra_not_in_corpus = 0
    extra_bad_sha = 0
    for item in raw_extra:
        if not isinstance(item, dict):
            errors.append("source_registry_extra 含非对象项")
            continue
        source_id = str(item.get("source_id") or "")
        version = item.get("source_version") if isinstance(item.get("source_version"), dict) else {}
        version_id = str(version.get("source_version_id") or "")
        content_sha = str(version.get("content_sha256") or "")
        if not source_id:
            errors.append("source_registry_extra 缺少 source_id")
            continue
        if not UUID_RE.match(version_id):
            errors.append(f"source_registry_extra[{source_id}].source_version_id 非法")
            continue
        if not SHA256_RE.match(content_sha):
            extra_bad_sha += 1
        source = sources.get(source_id)
        if source is None:
            extra_not_in_corpus += 1
            continue
        if source.source_version_id != version_id:
            extra_version_mismatch += 1
        registry_extra[source_id] = item
    check("registry_extra.ids_in_corpus", extra_not_in_corpus == 0, f"不在 corpus 中 {extra_not_in_corpus} 个")
    check("registry_extra.versions", extra_version_mismatch == 0, f"版本不一致 {extra_version_mismatch} 个")
    check("registry_extra.content_sha256", extra_bad_sha == 0, f"非法 sha256 {extra_bad_sha} 个")
    if len(registry_extra) != len(raw_extra):
        errors.append(f"source_registry_extra 有 {len(raw_extra) - len(registry_extra)} 个条目未被 corpus 使用")
    # 重新生成 sources（带上 registry_extra 标记），保持原文件顺序。
    if sources:
        ordered_sources: dict[str, CorpusSource] = {}
        for source_id, source in sources.items():
            ordered_sources[source_id] = CorpusSource(
                source_id=source.source_id,
                source_title=source.source_title,
                source_scope=source.source_scope,
                source_version_id=source.source_version_id,
                chunks=source.chunks,
                registry_extra=registry_extra.get(source_id),
            )
        sources = ordered_sources

    corpus_version = str(meta.get("corpus_version") or "")
    check("meta.corpus_version", bool(corpus_version), "缺失 corpus_version", fatal=False)
    check(
        "corpus_only.detected",
        True,
        f"corpus-only 来源 {len(registry_extra)} 个；预计已在库来源 {len(sources) - len(registry_extra)} 个（apply 时以 DB 校验）",
        fatal=False,
    )

    return SeedPackage(
        corpus_path=corpus_path,
        meta_path=meta_path,
        corpus_version=corpus_version,
        corpus_sha256=expected_sha or actual_sha,
        corpus_bytes=len(raw),
        corpus_splitter_version=corpus_splitter_version,
        meta_counts=dict(counts),
        sources=sources,
        registry_extra=registry_extra,
        checks=tuple(checks),
        errors=tuple(errors),
        warnings=tuple(warnings),
        meta=meta,
    )


# ---------------------------------------------------------------------------
# dry-run 计划
# ---------------------------------------------------------------------------


def build_profile_spec(*, config: Config, profile_id: str, package: SeedPackage) -> EmbeddingProfile:
    metadata = {
        "created_by": "worker-corpus-seed",
        "script_version": SEED_SCRIPT_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "corpus_version": package.corpus_version,
        "corpus_sha256": package.corpus_sha256,
        "corpus_splitter_version": package.corpus_splitter_version,
        "corpus_counts": {
            "sources": len(package.sources),
            "corpus_only_sources": len(package.registry_extra),
            "chunks": len(package.chunks),
        },
        "embedding_instruction_mode": config.embedding_instruction_mode,
        "query_template_version": config.embedding_query_template_version,
    }
    return EmbeddingProfile(
        profile_id=profile_id,
        provider=PROVIDER_NAME,
        model=config.embedding_model,
        dimensions=config.embedding_dimensions,
        normalization=config.embedding_normalization,
        query_template_version=config.embedding_query_template_version,
        splitter_version=config.ingest.splitter_version,
        status="building",
        metadata=metadata,
    )


def build_dry_run_plan(
    package: SeedPackage,
    *,
    profile_id: str,
    batch_size: int = DEFAULT_BATCH_SIZE,
    embedding_model: str = "qwen/qwen3-embedding-8b",
    embedding_dimensions: int = 4096,
    embedding_normalization: str = "l2",
    query_template_version: str = EMBEDDING_QUERY_TEMPLATE_VERSION,
    splitter_version: str = SPLITTER_VERSION,
    apply_command: str | None = None,
) -> dict[str, Any]:
    """纯本地计划：不联网、不读写 DB；返回可直接 JSON 打印的安全 dict。"""

    if not 1 <= int(batch_size) <= MAX_BATCH_SIZE:
        raise CorpusSeedValidationError(f"--batch-size 必须在 1..{MAX_BATCH_SIZE}")
    chunks = package.chunks
    chunks_by_kind: dict[str, int] = {}
    chunks_by_scope: dict[str, int] = {}
    verification: dict[str, int] = {}
    token_estimate = 0
    for chunk in chunks:
        chunks_by_kind[chunk.chunk_kind] = chunks_by_kind.get(chunk.chunk_kind, 0) + 1
        chunks_by_scope[chunk.source_scope] = chunks_by_scope.get(chunk.source_scope, 0) + 1
        verification[chunk.verification_status] = verification.get(chunk.verification_status, 0) + 1
        token_estimate += estimate_tokens(chunk.text)
    embedding_batches = math.ceil(len(chunks) / batch_size) if chunks else 0
    corpus_only = len(package.registry_extra)
    plan = {
        "ok": package.ok,
        "mode": "dry-run",
        "wrote_database": False,
        "network_calls": 0,
        "corpus": {
            "path": str(package.corpus_path),
            "meta_path": str(package.meta_path),
            "version": package.corpus_version,
            "sha256": package.corpus_sha256,
            "bytes": package.corpus_bytes,
            "splitter_version_in_corpus": package.corpus_splitter_version,
        },
        "profile": {
            "profile_id": profile_id,
            "provider": PROVIDER_NAME,
            "model": embedding_model,
            "dimensions": embedding_dimensions,
            "normalization": embedding_normalization,
            "query_template_version": query_template_version,
            "splitter_version": splitter_version,
        },
        "plan": {
            "sources_total": len(package.sources),
            "sources_corpus_only": corpus_only,
            "sources_existing_assumed": len(package.sources) - corpus_only,
            "chunks_total": len(chunks),
            "chars_total": sum(chunk.chars for chunk in chunks),
            "chunks_by_kind": dict(sorted(chunks_by_kind.items())),
            "chunks_by_source_scope": dict(sorted(chunks_by_scope.items())),
            "verification_status_counts": dict(sorted(verification.items())),
            "embedding_batch_size": int(batch_size),
            "embedding_batches": embedding_batches,
            "embedding_requests": embedding_batches,
            "estimated_embedding_tokens": token_estimate,
        },
        "checks": list(package.checks),
        "warnings": list(package.warnings),
        "errors": list(package.errors),
    }
    if apply_command:
        plan["apply_command"] = apply_command
    return plan



# ---------------------------------------------------------------------------
# apply
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SourceVersionAssignment:
    source: CorpusSource
    source_version_id: str
    corpus_only: bool
    registry_extra: dict[str, Any] | None = None
    existing_version: dict[str, Any] | None = None


@dataclass
class ApplyCounts:
    sources_total: int = 0
    sources_corpus_only: int = 0
    chunks_total: int = 0
    chunks_inserted: int = 0
    chunks_reused: int = 0
    embeddings_inserted: int = 0
    embeddings_reused: int = 0
    model_batches: int = 0
    model_requests: int = 0
    usage_input_tokens: int | None = None
    estimated_tokens: int = 0


class CorpusSeedService:
    """把 SeedPackage 幂等写入 Supabase 并完成 embedding profile 激活。"""

    def __init__(
        self,
        *,
        config: Config,
        db: SupabaseDb,
        provider: OpenRouterClient,
        budget: BudgetGuard,
        package: SeedPackage,
        profile_id: str,
        batch_size: int = DEFAULT_BATCH_SIZE,
        progress_every: int = DEFAULT_PROGRESS_EVERY,
        logger_override=None,
    ) -> None:
        if not PROFILE_ID_RE.match(profile_id):
            raise CorpusSeedValidationError("--profile-id 只允许字母数字与 ._:-，长度 3–100")
        if not 1 <= int(batch_size) <= MAX_BATCH_SIZE:
            raise CorpusSeedValidationError(f"--batch-size 必须在 1..{MAX_BATCH_SIZE}")
        if not package.ok:
            raise CorpusSeedValidationError("corpus 校验未通过，拒绝写入：" + "; ".join(package.errors[:5]))
        self.config = config
        self.db = db
        self.provider = provider
        self.budget = budget
        self.package = package
        self.profile_id = profile_id
        self.batch_size = int(batch_size)
        self.progress_every = max(1, int(progress_every))
        self.logger = logger_override or logger
        self.now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)
        self.counts = ApplyCounts(
            sources_total=len(package.sources),
            sources_corpus_only=len(package.registry_extra),
            chunks_total=len(package.chunks),
            estimated_tokens=sum(estimate_tokens(chunk.text) for chunk in package.chunks),
        )

    # -- profile ------------------------------------------------------
    def _assert_profile_compatible(self, existing: EmbeddingProfile, wanted: EmbeddingProfile) -> None:
        fields = ("provider", "model", "dimensions", "normalization", "query_template_version", "splitter_version")
        mismatched = [
            f"{name}={getattr(existing, name)}!={getattr(wanted, name)}"
            for name in fields
            if getattr(existing, name) != getattr(wanted, name)
        ]
        if mismatched:
            raise ConfigError("已有 embedding profile 与 seed 配置不一致：" + "; ".join(mismatched))

    def ensure_profile(self) -> EmbeddingProfile:
        wanted = build_profile_spec(config=self.config, profile_id=self.profile_id, package=self.package)
        existing = self.db.get_embedding_profile(self.profile_id)
        if existing is not None:
            self._assert_profile_compatible(existing, wanted)
            previous_sha = str(existing.metadata.get("corpus_sha256") or "")
            if previous_sha and previous_sha != self.package.corpus_sha256:
                raise ConfigError(
                    f"profile {self.profile_id} 已绑定 corpus {previous_sha[:16]}…，"
                    f"与本次 {self.package.corpus_sha256[:16]}… 不同；禁止混语料，请新建 --profile-id 或人工清理"
                )
            self.logger.info("seed_profile_reused profile_id=%s status=%s", existing.profile_id, existing.status)
            return existing
        active = self.db.get_active_embedding_profile()
        if active is not None:
            raise ConfigError(
                f"已存在 active embedding profile {active.profile_id}；为避免混用向量，seed 不自动覆盖，"
                "请人工切换或清理后再运行"
            )
        created = self.db.create_embedding_profile(wanted)
        self.logger.info("seed_profile_created profile_id=%s status=building", created.profile_id)
        return created

    # -- source versions ---------------------------------------------
    def resolve_assignments(self) -> list[SourceVersionAssignment]:
        rows = self.db.list_all_source_versions()
        by_source: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            source_id = str(row.get("source_id") or "")
            if source_id:
                by_source.setdefault(source_id, []).append(row)
        assignments: list[SourceVersionAssignment] = []
        for source in self.package.sources.values():
            candidates = by_source.get(source.source_id, [])
            registry_extra = self.package.registry_extra.get(source.source_id)
            if len(candidates) == 1:
                row = candidates[0]
                if str(row.get("source_version_id")) != source.source_version_id:
                    raise ConfigError(
                        f"来源 {source.source_id} 在库版本 {row.get('source_version_id')} 与 corpus 版本 "
                        f"{source.source_version_id} 不一致；corpus 与 DB 快照不同步，禁止混语料"
                    )
                assignments.append(
                    SourceVersionAssignment(
                        source=source,
                        source_version_id=source.source_version_id,
                        corpus_only=registry_extra is not None,
                        registry_extra=registry_extra,
                        existing_version=row,
                    )
                )
            elif len(candidates) > 1:
                matched = [row for row in candidates if str(row.get("source_version_id")) == source.source_version_id]
                if len(matched) != 1:
                    raise ConfigError(f"来源 {source.source_id} 在库有多个版本且无法唯一匹配 corpus 版本，需人工处理")
                assignments.append(
                    SourceVersionAssignment(
                        source=source,
                        source_version_id=source.source_version_id,
                        corpus_only=registry_extra is not None,
                        registry_extra=registry_extra,
                        existing_version=matched[0],
                    )
                )
            else:
                if registry_extra is None:
                    raise ConfigError(
                        f"corpus 来源 {source.source_id} 在 app_source_versions 不存在，且 meta.source_registry_extra 未登记"
                    )
                assignments.append(
                    SourceVersionAssignment(
                        source=source,
                        source_version_id=source.source_version_id,
                        corpus_only=True,
                        registry_extra=registry_extra,
                    )
                )
        return assignments

    def _upsert_corpus_only_sources(self, assignments: Sequence[SourceVersionAssignment], profile: EmbeddingProfile) -> None:
        sources_payload: list[dict[str, Any]] = []
        versions_payload: list[dict[str, Any]] = []
        seeded_at = self.now().isoformat()
        for assignment in assignments:
            if not assignment.corpus_only:
                continue
            extra = assignment.registry_extra or {}
            version_extra = extra.get("source_version") if isinstance(extra.get("source_version"), dict) else {}
            source_id = assignment.source.source_id
            version_id = assignment.source_version_id
            sources_payload.append(
                {
                    "source_id": source_id,
                    "canonical_url": extra.get("canonical_url"),
                    "title": str(extra.get("title") or assignment.source.source_title or source_id),
                    "publisher": extra.get("publisher"),
                    "source_scope": extra.get("source_scope") or assignment.source.source_scope or None,
                    "visibility": "approved_reference",
                    "owner_id": None,
                    "verification_status": str(extra.get("verification_status") or "unverified"),
                    "metadata": {
                        "corpus_only": True,
                        "seeded_by": SEED_SCRIPT_VERSION,
                        "corpus_version": self.package.corpus_version,
                        "corpus_sha256": self.package.corpus_sha256,
                        "verification_status_raw": extra.get("verification_status_raw"),
                    },
                }
            )
            base_metadata = dict(version_extra.get("metadata") or {}) if isinstance(version_extra.get("metadata"), dict) else {}
            base_metadata["corpus_seed"] = {
                "corpus_version": self.package.corpus_version,
                "corpus_sha256": self.package.corpus_sha256,
                "corpus_splitter_version": self.package.corpus_splitter_version,
                "splitter_version": profile.splitter_version,
                "embedding_profile_id": profile.profile_id,
                "chunk_count": len(assignment.source.chunks),
                "parser_version": SEED_PARSER_VERSION,
                "seeded_at": seeded_at,
                "corpus_only": True,
                "corpus_meta_extraction_status": version_extra.get("extraction_status"),
            }
            versions_payload.append(
                {
                    "source_version_id": version_id,
                    "source_id": source_id,
                    "content_sha256": str(version_extra.get("content_sha256") or ""),
                    "published_at": None,
                    "retrieved_at": version_extra.get("retrieved_at") or seeded_at,
                    "effective_from": None,
                    "effective_to": None,
                    "storage_path": version_extra.get("storage_path"),
                    "extraction_status": "parsed",
                    "parser_version": SEED_PARSER_VERSION,
                    "metadata": base_metadata,
                    "visibility": "approved_reference",
                    "owner_id": None,
                }
            )
        if sources_payload:
            self.db.upsert("app_sources", sources_payload, on_conflict="source_id")
        if versions_payload:
            self.db.upsert("app_source_versions", versions_payload, on_conflict="source_version_id")
        if sources_payload:
            self.logger.info("seed_corpus_only_sources_upserted count=%s", len(sources_payload))

    # -- chunks -------------------------------------------------------
    @staticmethod
    def _expected_ordinals(chunks: Sequence[CorpusChunk]) -> list[tuple[int, CorpusChunk]]:
        return list(enumerate(chunks))

    def _load_existing_chunks(self, assignments: Sequence[SourceVersionAssignment]) -> dict[str, dict[int, dict[str, Any]]]:
        expected_versions = {assignment.source_version_id for assignment in assignments}
        rows = self.db.list_chunks_by_splitter(self.config.ingest.splitter_version)
        existing: dict[str, dict[int, dict[str, Any]]] = {}
        for row in rows:
            version_id = str(row.get("source_version_id") or "")
            if version_id not in expected_versions:
                continue
            ordinal = row.get("ordinal")
            if not isinstance(ordinal, int):
                raise CorpusSeedError(f"库中 chunk ordinal 非法：{version_id}")
            existing.setdefault(version_id, {})[ordinal] = row
        return existing

    def _insert_missing_chunks(
        self,
        assignments: Sequence[SourceVersionAssignment],
        existing: Mapping[str, Mapping[int, dict[str, Any]]],
    ) -> tuple[dict[str, dict[int, str]], list[CorpusChunk]]:
        """返回 {version_id: {ordinal: chunk_id}} 与本次新插入的 chunk 列表。"""

        chunk_ids: dict[str, dict[int, str]] = {}
        missing_rows: list[dict[str, Any]] = []
        missing_chunks: list[CorpusChunk] = []
        for assignment in assignments:
            source = assignment.source
            existing_for_version = existing.get(assignment.source_version_id, {})
            expected_count = len(source.chunks)
            for ordinal, row in existing_for_version.items():
                if ordinal >= expected_count:
                    raise CorpusSeedError(
                        f"来源 {source.source_id} 版本 {assignment.source_version_id} 在库中有多余 ordinal={ordinal}，"
                        "corpus 可能已变更；请新建 profile/splitter 或人工清理"
                    )
            chunk_ids[assignment.source_version_id] = {}
            for ordinal, chunk in self._expected_ordinals(source.chunks):
                row = existing_for_version.get(ordinal)
                if row is not None:
                    if str(row.get("text_sha256")) != chunk.sha256:
                        raise CorpusSeedError(
                            f"来源 {source.source_id} 版本 {assignment.source_version_id} ordinal={ordinal} "
                            "的 text_sha256 与 corpus 不一致；禁止静默覆盖，请人工核对后使用新 profile"
                        )
                    chunk_ids[assignment.source_version_id][ordinal] = str(row["chunk_id"])
                    continue
                missing_rows.append(
                    {
                        "source_version_id": assignment.source_version_id,
                        "owner_id": None,
                        "splitter_version": self.config.ingest.splitter_version,
                        "ordinal": ordinal,
                        "text": chunk.text,
                        "text_sha256": chunk.sha256,
                        "locator": chunk.locator,
                        "heading_path": chunk.heading_path or None,
                        "search_terms": chunk.search_terms,
                        "verification_status": chunk.verification_status,
                        "visibility": "approved_reference",
                    }
                )
                missing_chunks.append(chunk)
        for start in range(0, len(missing_rows), CHUNK_INSERT_BATCH):
            batch = missing_rows[start : start + CHUNK_INSERT_BATCH]
            inserted = self.db.insert_chunks(batch)
            if len(inserted) != len(batch):
                raise CorpusSeedError(f"chunk 插入返回行数不符：期望 {len(batch)}，实际 {len(inserted)}")
            for row in inserted:
                version_id = str(row.get("source_version_id"))
                ordinal = row.get("ordinal")
                if not isinstance(ordinal, int) or not row.get("chunk_id"):
                    raise CorpusSeedError("chunk 插入返回结构异常")
                chunk_ids.setdefault(version_id, {})[ordinal] = str(row["chunk_id"])
        self.counts.chunks_inserted = len(missing_rows)
        self.counts.chunks_reused = self.counts.chunks_total - len(missing_rows)
        if missing_rows:
            self.logger.info("seed_chunks_inserted count=%s", len(missing_rows))
        return chunk_ids, missing_chunks

    # -- embeddings ---------------------------------------------------
    def _load_existing_embeddings(self) -> set[str]:
        rows = self.db.list_chunk_embeddings_for_profile(self.profile_id)
        return {str(row.get("chunk_id")) for row in rows if row.get("chunk_id")}

    def _embed_missing(
        self,
        *,
        chunk_ids: Mapping[str, Mapping[int, str]],
        chunks_by_version: Mapping[str, Sequence[CorpusChunk]],
        profile: EmbeddingProfile,
    ) -> None:
        existing = self._load_existing_embeddings()
        expected_chunk_ids: list[str] = []
        expected_chunks: list[CorpusChunk] = []
        for version_id in chunks_by_version:
            for ordinal, chunk in enumerate(chunks_by_version[version_id]):
                chunk_id = chunk_ids.get(version_id, {}).get(ordinal)
                if chunk_id is None:
                    raise CorpusSeedError(f"缺少 chunk_id 映射：{version_id}/{ordinal}")
                expected_chunk_ids.append(chunk_id)
                expected_chunks.append(chunk)
        unexpected = existing - set(expected_chunk_ids)
        if unexpected:
            raise CorpusSeedError(
                f"profile {self.profile_id} 已有 {len(unexpected)} 条不属于本次 corpus 的 embedding；"
                "疑似混语料，请人工清理或换 profile"
            )
        missing = [(chunk_id, chunk) for chunk_id, chunk in zip(expected_chunk_ids, expected_chunks) if chunk_id not in existing]
        self.counts.embeddings_reused = len(expected_chunk_ids) - len(missing)
        if not missing:
            self.logger.info("seed_embeddings_reused count=%s", len(expected_chunk_ids))
            return
        total_batches = math.ceil(len(missing) / self.batch_size)
        inserted = 0
        usage_tokens = 0
        usage_tokens_known = True
        for batch_index in range(total_batches):
            batch = missing[batch_index * self.batch_size : (batch_index + 1) * self.batch_size]
            texts = [chunk.text for _chunk_id, chunk in batch]
            response = self.provider.embed_texts(texts, operation=SEED_OPERATION)
            self.counts.model_batches += 1
            self.counts.model_requests += int(response.request_count or 0)
            if len(response.vectors) != len(batch):
                raise CorpusSeedError(f"embedding 条数不符：期望 {len(batch)}，实际 {len(response.vectors)}")
            for vector in response.vectors:
                if len(vector) != profile.dimensions:
                    raise CorpusSeedError(
                        f"embedding 维度不符：期望 {profile.dimensions}，实际 {len(vector)}"
                    )
            if response.usage is not None:
                self.db.record_usage(
                    owner_id=None,
                    run_id=None,
                    provider=response.usage.provider,
                    model=response.usage.model,
                    operation=SEED_OPERATION,
                    input_tokens=response.usage.input_tokens,
                    output_tokens=response.usage.output_tokens,
                    estimated_cost=response.usage.estimated_cost,
                    currency=response.usage.currency,
                    pricing_snapshot_at=response.usage.pricing_snapshot_at,
                )
                self.budget.commit(response.usage.estimated_cost)
                if response.usage.input_tokens is None:
                    usage_tokens_known = False
                else:
                    usage_tokens += response.usage.input_tokens
            rows = [
                {
                    "chunk_id": chunk_id,
                    "profile_id": self.profile_id,
                    "embedding": vector_literal(vector),
                }
                for (chunk_id, _chunk), vector in zip(batch, response.vectors)
            ]
            for start in range(0, len(rows), EMBEDDING_INSERT_BATCH):
                self.db.insert_chunk_embeddings(rows[start : start + EMBEDDING_INSERT_BATCH])
            inserted += len(batch)
            if (batch_index + 1) % self.progress_every == 0 or batch_index + 1 == total_batches:
                log_event(
                    self.logger,
                    "seed_progress",
                    embedded=inserted,
                    chunks=len(missing),
                    model_batches=self.counts.model_batches,
                    profile_id=self.profile_id,
                )
        self.counts.embeddings_inserted = inserted
        self.counts.usage_input_tokens = usage_tokens if usage_tokens_known else None
        if inserted:
            self.logger.info("seed_embeddings_inserted count=%s", inserted)

    # -- 校验与收尾 ---------------------------------------------------
    def _verify_counts(self, assignments: Sequence[SourceVersionAssignment]) -> None:
        expected_versions = {assignment.source_version_id for assignment in assignments}
        expected_chunks = sum(len(assignment.source.chunks) for assignment in assignments)
        rows = self.db.list_chunks_by_splitter(self.config.ingest.splitter_version)
        rows = [row for row in rows if str(row.get("source_version_id")) in expected_versions]
        if len(rows) != expected_chunks:
            raise CorpusSeedError(f"chunk 数量校验失败：期望 {expected_chunks}，实际 {len(rows)}")
        by_version: dict[str, dict[int, str]] = {}
        for row in rows:
            by_version.setdefault(str(row["source_version_id"]), {})[int(row["ordinal"])] = str(row.get("text_sha256"))
        for assignment in assignments:
            expected = assignment.source.chunks
            actual = by_version.get(assignment.source_version_id, {})
            if sorted(actual) != list(range(len(expected))):
                raise CorpusSeedError(f"来源 {assignment.source.source_id} ordinal 序列不完整")
            for ordinal, chunk in enumerate(expected):
                if actual[ordinal] != chunk.sha256:
                    raise CorpusSeedError(f"来源 {assignment.source.source_id} ordinal={ordinal} text_sha256 校验失败")
        embeddings = self._load_existing_embeddings()
        expected_embedding_count = expected_chunks
        if len(embeddings) != expected_embedding_count:
            raise CorpusSeedError(
                f"embedding 数量校验失败：期望 {expected_embedding_count}，实际 {len(embeddings)}"
            )
        self.logger.info(
            "seed_counts_verified chunks=%s embeddings=%s profile_id=%s",
            expected_chunks,
            len(embeddings),
            self.profile_id,
        )

    def _update_source_versions(
        self,
        assignments: Sequence[SourceVersionAssignment],
        profile: EmbeddingProfile,
    ) -> None:
        seeded_at = self.now().isoformat()
        for assignment in assignments:
            version = assignment.existing_version or {}
            if assignment.existing_version is not None:
                metadata = dict(version.get("metadata") or {})
            elif assignment.registry_extra:
                raw_version = assignment.registry_extra.get("source_version")
                raw_version = raw_version if isinstance(raw_version, dict) else {}
                metadata = dict(raw_version.get("metadata") or {}) if isinstance(raw_version.get("metadata"), dict) else {}
            else:
                metadata = {}
            metadata["corpus_seed"] = {
                "corpus_version": self.package.corpus_version,
                "corpus_sha256": self.package.corpus_sha256,
                "corpus_splitter_version": self.package.corpus_splitter_version,
                "splitter_version": profile.splitter_version,
                "embedding_profile_id": profile.profile_id,
                "chunk_count": len(assignment.source.chunks),
                "parser_version": SEED_PARSER_VERSION,
                "seeded_at": seeded_at,
                "corpus_only": assignment.corpus_only,
                "extraction_status_before": version.get("extraction_status"),
            }
            self.db.update_source_version(
                assignment.source_version_id,
                {
                    "extraction_status": "parsed",
                    "parser_version": SEED_PARSER_VERSION,
                    "metadata": metadata,
                },
            )
        self.logger.info("seed_source_versions_updated count=%s", len(assignments))

    def _finalize_profile(self, profile: EmbeddingProfile) -> str:
        active = self.db.get_active_embedding_profile()
        if active is not None and active.profile_id != profile.profile_id:
            raise ConfigError(
                f"已存在其他 active embedding profile {active.profile_id}；本次语料已写入但 "
                f"profile {profile.profile_id} 保持 building，需人工切换后再启用检索"
            )
        metadata = dict(profile.metadata)
        metadata.update(
            {
                "corpus_sha256": self.package.corpus_sha256,
                "corpus_version": self.package.corpus_version,
                "corpus_splitter_version": self.package.corpus_splitter_version,
                "corpus_counts": {
                    "sources": len(self.package.sources),
                    "corpus_only_sources": len(self.package.registry_extra),
                    "chunks": len(self.package.chunks),
                },
                "embedded_chunks": len(self.package.chunks),
                "completed_at": self.now().isoformat(),
            }
        )
        values: dict[str, Any] = {"metadata": metadata}
        if profile.status != "active":
            values["status"] = "active"
        self.db.update_embedding_profile(profile.profile_id, values)
        self.logger.info("seed_profile_finalized profile_id=%s status=active", profile.profile_id)
        return "active"

    # -- 主流程 -------------------------------------------------------
    def apply(self) -> dict[str, Any]:
        if not self.budget.configured:
            raise BudgetExceeded(MONTHLY_BUDGET_UNSET_MESSAGE, detail="corpus_seed")
        started = time.monotonic()
        totals = self.db.usage_since(since=utc_month_start())
        self.budget.refresh(
            spent_usd=totals.spent_usd,
            unknown_cost_usage_count=totals.unknown_cost_usage_count,
        )
        assignments = self.resolve_assignments()
        profile = self.ensure_profile()
        self._upsert_corpus_only_sources(assignments, profile)
        existing_chunks = self._load_existing_chunks(assignments)
        chunk_ids, _new_chunks = self._insert_missing_chunks(assignments, existing_chunks)
        chunks_by_version = {assignment.source_version_id: assignment.source.chunks for assignment in assignments}
        self._embed_missing(chunk_ids=chunk_ids, chunks_by_version=chunks_by_version, profile=profile)
        self._verify_counts(assignments)
        self._update_source_versions(assignments, profile)
        profile_status = self._finalize_profile(profile)
        result = {
            "ok": True,
            "mode": "apply",
            "profile_id": self.profile_id,
            "profile_status": profile_status,
            "corpus": {
                "version": self.package.corpus_version,
                "sha256": self.package.corpus_sha256,
                "splitter_version_in_corpus": self.package.corpus_splitter_version,
            },
            "counts": {
                "sources_total": self.counts.sources_total,
                "sources_corpus_only": self.counts.sources_corpus_only,
                "chunks_total": self.counts.chunks_total,
                "chunks_inserted": self.counts.chunks_inserted,
                "chunks_reused": self.counts.chunks_reused,
                "embeddings_inserted": self.counts.embeddings_inserted,
                "embeddings_reused": self.counts.embeddings_reused,
                "model_batches": self.counts.model_batches,
                "model_requests": self.counts.model_requests,
                "usage_input_tokens": self.counts.usage_input_tokens,
                "estimated_embedding_tokens": self.counts.estimated_tokens,
            },
            "duration_ms": int((time.monotonic() - started) * 1000),
        }
        return result


# ---------------------------------------------------------------------------
# CLI 辅助
# ---------------------------------------------------------------------------


def apply_command_hint(*, corpus: Path, meta: Path, profile_id: str, batch_size: int) -> str:
    return (
        f"uv run --python 3.12 python scripts/seed_corpus.py --apply "
        f"--corpus {corpus} --meta {meta} --profile-id {profile_id} --batch-size {batch_size}"
    )
