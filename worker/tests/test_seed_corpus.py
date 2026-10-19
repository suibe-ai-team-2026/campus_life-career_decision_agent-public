"""corpus seed 测试：dry-run 计划、source_version 解析、ordinal/幂等、profile 冲突、维度校验。"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import replace
from decimal import Decimal
from pathlib import Path
from typing import Any, Sequence

import pytest

from app.budget import BudgetGuard
from app.config import PROVIDER_NAME
from app.corpus.seed import (
    SEED_PARSER_VERSION,
    CorpusSeedError,
    CorpusSeedService,
    build_dry_run_plan,
    load_seed_package,
)
from app.errors import BudgetExceeded, ConfigError
from app.models import EmbeddingProfile, UsageTotals
from app.providers.openrouter import EmbeddingResponse
from tests.fakes import FakeProvider, make_config

PROFILE_ID = "career-qwen-4096-v1"
BATCH = 16


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _version_id(source_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"seed-test/version/{source_id}"))


def _chunk_row(
    *,
    source_id: str,
    source_title: str,
    version_id: str,
    ordinal: int,
    scope: str = "official_context_page",
    verification: str = "partial",
    kind: str = "evidence_record",
    registry_extra_source: bool = False,
) -> dict[str, Any]:
    text = f"{source_id} 第{ordinal}段正文：国际贸易与就业资料。" + "课程与岗位信息" * (4 + ordinal)
    return {
        "chunk_id": f"chunk_{_sha256(f'{source_id}-{ordinal}'.encode())[:20]}",
        "source_id": source_id,
        "source_version_id": version_id,
        "source_title": source_title,
        "source_scope": scope,
        "verification_status": verification,
        "verification_status_raw": "测试数据，不是真实资料",
        "visibility": "approved_reference",
        "chunk_kind": kind,
        "record_id": None,
        "record_type": "source",
        "chunk_text": text,
        "locator": {"kind": "line_range", "line_start": ordinal * 10 + 1, "line_end": ordinal * 10 + 5},
        "heading_path": f"测试章节/{ordinal}",
        "search_terms": text.lower(),
        "chars": len(text),
        "sha256": _sha256(text.encode()),
        # 刻意全部写 0：corpus 的 ordinal 不可靠，seed 必须按 source_version 内文件顺序重排。
        "ordinal": 0,
        "corpus_only_source": registry_extra_source,
    }


def build_corpus_files(
    tmp_path: Path,
    *,
    existing_sources: Sequence[str] = ("src_aaa", "src_bbb"),
    corpus_only_sources: Sequence[str] = ("src_ccc",),
    chunks_per_source: int = 2,
    corpus_version: str = "career-corpus-test-2026-10-19.1",
    splitter_version: str = "career-corpus-splitter-v1",
) -> tuple[Path, Path, list[dict[str, Any]], dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    registry_extra: list[dict[str, Any]] = []
    titles: dict[str, str] = {}
    for source_id in [*existing_sources, *corpus_only_sources]:
        version_id = _version_id(source_id)
        title = f"测试来源 {source_id}"
        titles[source_id] = title
        for ordinal in range(chunks_per_source):
            rows.append(
                _chunk_row(
                    source_id=source_id,
                    source_title=title,
                    version_id=version_id,
                    ordinal=ordinal,
                    registry_extra_source=source_id in corpus_only_sources,
                )
            )
        if source_id in corpus_only_sources:
            content_sha = _sha256(f"content/{source_id}".encode())
            registry_extra.append(
                {
                    "source_id": source_id,
                    "title": title,
                    "publisher": "测试出版社",
                    "source_scope": "official_context_page",
                    "canonical_url": None,
                    "verification_status": "partial",
                    "verification_status_raw": "测试数据",
                    "visibility": "approved_reference",
                    "source_version": {
                        "source_version_id": version_id,
                        "content_sha256": content_sha,
                        "content_sha256_kind": "test",
                        "extraction_status": "partial",
                        "retrieved_at": "2026-10-19T00:00:00.000Z",
                        "storage_path": None,
                        "metadata": {"corpus_only": True, "repo_path": "tests/fixture"},
                    },
                }
            )
    jsonl = "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n"
    corpus_bytes = jsonl.encode("utf-8")
    meta = {
        "schema_version": "career-corpus-meta-v1",
        "corpus_version": corpus_version,
        "splitter": {"version": splitter_version},
        "generated_at": "2026-10-19T00:00:00.000Z",
        "counts": {
            "chunks": len(rows),
            "chars": sum(row["chars"] for row in rows),
            "documents": len(existing_sources) + len(corpus_only_sources),
            "body_documents": len(corpus_only_sources),
        },
        "documents": [
            {"source_id": source_id, "title": titles[source_id], "source_scope": "official_context_page", "chunks": chunks_per_source}
            for source_id in [*existing_sources, *corpus_only_sources]
        ],
        "source_registry_extra": registry_extra,
        "corpus_sha256": _sha256(corpus_bytes),
        "corpus_bytes": len(corpus_bytes),
    }
    corpus_path = tmp_path / "corpus.jsonl"
    meta_path = tmp_path / "corpus-meta.json"
    corpus_path.write_bytes(corpus_bytes)
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return corpus_path, meta_path, rows, meta


class FakeSeedDb:
    """实现 CorpusSeedService 需要的 DB 子集（内存版）。"""

    def __init__(self) -> None:
        self.versions: dict[str, dict[str, Any]] = {}
        self.sources: dict[str, dict[str, Any]] = {}
        self.profiles: dict[str, EmbeddingProfile] = {}
        self.chunks: dict[tuple[str, int], dict[str, Any]] = {}
        self.embeddings: set[tuple[str, str]] = set()
        self.embedding_rows: list[dict[str, Any]] = []
        self.updated_versions: list[tuple[str, dict[str, Any]]] = []
        self.usage_rows: list[dict[str, Any]] = []
        self._seq = 0
        self.hide_chunks_on_list = 0
        self.hide_embeddings_on_list = 0

    # -- source versions ---------------------------------------------
    def add_existing_version(self, source_id: str, version_id: str, *, metadata: dict[str, Any] | None = None) -> None:
        self.versions[version_id] = {
            "source_id": source_id,
            "source_version_id": version_id,
            "content_sha256": _sha256(f"content/{source_id}".encode()),
            "extraction_status": "pending",
            "parser_version": None,
            "metadata": dict(metadata or {}),
        }

    def list_all_source_versions(self) -> list[dict[str, Any]]:
        return [dict(row) for row in self.versions.values()]

    def upsert(self, table: str, rows: Sequence[dict[str, Any]], *, on_conflict: str, returning: bool = False) -> list[dict[str, Any]]:
        stored: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            if table == "app_sources":
                self.sources[str(item["source_id"])] = item
            elif table == "app_source_versions":
                self.versions[str(item["source_version_id"])] = item
            else:
                raise AssertionError(f"unexpected upsert table: {table}")
            stored.append(item)
        return stored if returning else []

    def update_source_version(self, source_version_id: str, values: dict[str, Any]) -> None:
        self.updated_versions.append((source_version_id, dict(values)))
        self.versions.setdefault(source_version_id, {}).update(values)

    # -- profiles -----------------------------------------------------
    def get_embedding_profile(self, profile_id: str) -> EmbeddingProfile | None:
        return self.profiles.get(profile_id)

    def get_active_embedding_profile(self) -> EmbeddingProfile | None:
        for profile in self.profiles.values():
            if profile.status == "active":
                return profile
        return None

    def create_embedding_profile(self, profile: EmbeddingProfile) -> EmbeddingProfile:
        self.profiles[profile.profile_id] = profile
        return profile

    def update_embedding_profile(self, profile_id: str, values: dict[str, Any]) -> None:
        profile = self.profiles[profile_id]
        self.profiles[profile_id] = replace(
            profile,
            status=str(values.get("status", profile.status)),
            metadata=dict(values.get("metadata", profile.metadata)),
        )

    # -- chunks -------------------------------------------------------
    def list_chunks_by_splitter(self, splitter_version: str) -> list[dict[str, Any]]:
        rows = [
            dict(row)
            for row in self.chunks.values()
            if str(row.get("splitter_version")) == splitter_version
        ]
        rows.sort(key=lambda row: (str(row["source_version_id"]), int(row["ordinal"])))
        if self.hide_chunks_on_list:
            rows = rows[: -self.hide_chunks_on_list]
        return rows

    def insert_chunks(self, rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
        inserted: list[dict[str, Any]] = []
        for row in rows:
            self._seq += 1
            item = dict(row)
            item["chunk_id"] = f"chunk-{self._seq:04d}"
            self.chunks[(str(item["source_version_id"]), int(item["ordinal"]))] = item
            inserted.append(item)
        return inserted

    def list_chunk_embeddings_for_profile(self, profile_id: str) -> list[dict[str, Any]]:
        rows = [{"chunk_id": chunk_id} for chunk_id, pid in sorted(self.embeddings) if pid == profile_id]
        if self.hide_embeddings_on_list:
            rows = rows[: -self.hide_embeddings_on_list]
        return rows

    def insert_chunk_embeddings(self, rows: Sequence[dict[str, Any]]) -> None:
        for row in rows:
            self.embedding_rows.append(dict(row))
            self.embeddings.add((str(row["chunk_id"]), str(row["profile_id"])))

    def record_usage(self, **kwargs: Any) -> None:
        self.usage_rows.append(dict(kwargs))

    def usage_since(self, *, since: Any) -> UsageTotals:
        return UsageTotals(spent_usd=Decimal(0), unknown_cost_usage_count=0)


class BadDimensionProvider(FakeProvider):
    def embed_texts(self, texts: Sequence[str], *, operation: str = "embedding") -> EmbeddingResponse:
        response = super().embed_texts(texts, operation=operation)
        return EmbeddingResponse(
            vectors=[[0.1] * 512 for _ in texts],
            usage=response.usage,
            latency_ms=1,
            model=response.model,
            request_count=1,
        )


def _load(tmp_path: Path, **kwargs: Any):
    corpus_path, meta_path, rows, meta = build_corpus_files(tmp_path, **kwargs)
    package = load_seed_package(corpus_path, meta_path)
    return package, rows, meta, corpus_path, meta_path


def _make_service(
    package,
    db: FakeSeedDb,
    provider: FakeProvider | None = None,
    *,
    config=None,
    budget: BudgetGuard | None = None,
    profile_id: str = PROFILE_ID,
    batch_size: int = BATCH,
) -> CorpusSeedService:
    config = config or make_config()
    provider = provider or FakeProvider(config)
    return CorpusSeedService(
        config=config,
        db=db,  # type: ignore[arg-type]
        provider=provider,  # type: ignore[arg-type]
        budget=budget or BudgetGuard(Decimal("5.00")),
        package=package,
        profile_id=profile_id,
        batch_size=batch_size,
    )


def _prepare_existing(db: FakeSeedDb, package) -> None:
    for source_id, source in package.sources.items():
        if source.corpus_only:
            continue
        db.add_existing_version(source_id, source.source_version_id)


# ---------------------------------------------------------------------------
# dry-run
# ---------------------------------------------------------------------------


def test_dry_run_plan_counts_and_no_network(tmp_path: Path):
    package, rows, _meta, _corpus, _meta_path = _load(tmp_path)
    plan = build_dry_run_plan(package, profile_id=PROFILE_ID, batch_size=16)
    assert plan["ok"] is True
    assert plan["mode"] == "dry-run"
    assert plan["wrote_database"] is False
    assert plan["network_calls"] == 0
    assert plan["corpus"]["sha256"] == package.corpus_sha256
    assert plan["plan"]["sources_total"] == 3
    assert plan["plan"]["sources_corpus_only"] == 1
    assert plan["plan"]["sources_existing_assumed"] == 2
    assert plan["plan"]["chunks_total"] == len(rows) == 6
    assert plan["plan"]["embedding_batch_size"] == 16
    assert plan["plan"]["embedding_batches"] == 1
    assert plan["plan"]["estimated_embedding_tokens"] > 0
    assert plan["profile"]["dimensions"] == 4096


def test_dry_run_cli_prints_json_and_rejects_corrupt_corpus(tmp_path: Path, capsys):
    from scripts.seed_corpus import main as seed_main

    corpus_path, meta_path, _rows, _meta = build_corpus_files(tmp_path)
    code = seed_main(["--dry-run", "--corpus", str(corpus_path), "--meta", str(meta_path)])
    assert code == 0
    output = json.loads(capsys.readouterr().out)
    assert output["ok"] is True and output["mode"] == "dry-run"
    assert "corpus.jsonl" in output["corpus"]["path"]

    # 破坏 corpus 内容但保留旧 meta：sha256 校验必须失败
    corpus_path.write_text(corpus_path.read_text(encoding="utf-8") + '{"broken": true}\n', encoding="utf-8")
    code = seed_main(["--dry-run", "--corpus", str(corpus_path), "--meta", str(meta_path)])
    assert code == 1
    failed = json.loads(capsys.readouterr().out)
    assert failed["ok"] is False
    assert any("corpus.sha256" in error for error in failed["errors"])


def test_loader_groups_sources_by_file_order_and_ignores_bogus_corpus_ordinal(tmp_path: Path):
    package, _rows, _meta, _corpus, _meta_path = _load(tmp_path)
    assert list(package.sources) == ["src_aaa", "src_bbb", "src_ccc"]
    for source in package.sources.values():
        assert [chunk.file_order for chunk in source.chunks] == sorted(chunk.file_order for chunk in source.chunks)
    # corpus 的 ordinal 全为 0，不能被使用；apply 必须按 0..n-1 写 ordinal
    assert all(chunk.file_order > 0 for chunk in package.chunks)
    assert len(package.corpus_only_sources) == 1
    assert package.registry_extra["src_ccc"]["source_version"]["source_version_id"] == package.sources["src_ccc"].source_version_id


# ---------------------------------------------------------------------------
# apply：正常写入与幂等
# ---------------------------------------------------------------------------


def test_apply_writes_sources_versions_chunks_embeddings_and_activates_profile(tmp_path: Path):
    package, rows, _meta, _corpus, _meta_path = _load(tmp_path)
    db = FakeSeedDb()
    _prepare_existing(db, package)
    provider = FakeProvider(make_config())
    service = _make_service(package, db, provider)
    result = service.apply()

    assert result["ok"] is True
    assert result["mode"] == "apply"
    assert result["profile_status"] == "active"
    assert result["counts"]["chunks_inserted"] == len(rows) == 6
    assert result["counts"]["embeddings_inserted"] == 6
    assert result["counts"]["model_batches"] == 1
    assert len(db.chunks) == 6
    assert len(db.embeddings) == 6
    assert db.profiles[PROFILE_ID].status == "active"
    assert db.profiles[PROFILE_ID].metadata["corpus_sha256"] == package.corpus_sha256
    assert db.profiles[PROFILE_ID].metadata["corpus_counts"]["chunks"] == 6
    # corpus-only 来源：visibility=approved_reference、owner=NULL、verification 用 corpus 值
    source_row = db.sources["src_ccc"]
    assert source_row["visibility"] == "approved_reference"
    assert source_row["owner_id"] is None
    assert source_row["verification_status"] == "partial"
    version_row = db.versions[package.sources["src_ccc"].source_version_id]
    assert version_row["extraction_status"] == "parsed"
    assert version_row["parser_version"] == SEED_PARSER_VERSION
    assert version_row["metadata"]["corpus_seed"]["corpus_only"] is True
    # 已有 source_version 被更新
    assert len(db.updated_versions) == 3
    # ordinal 按 source_version 内文件顺序分配
    for source in package.sources.values():
        ordinals = sorted(
            ordinal for (version_id, ordinal) in db.chunks if version_id == source.source_version_id
        )
        assert ordinals == list(range(len(source.chunks)))
    # embedding 以 pgvector 文本 "[...]" 写入
    assert len(db.embedding_rows) == len(rows)
    assert all(str(row["embedding"]).startswith("[") and str(row["embedding"]).endswith("]") for row in db.embedding_rows)
    assert all(pid == PROFILE_ID for _chunk_id, pid in db.embeddings)


def test_apply_is_idempotent_second_run_does_not_write_or_embed_again(tmp_path: Path):
    package, rows, _meta, _corpus, _meta_path = _load(tmp_path)
    db = FakeSeedDb()
    _prepare_existing(db, package)
    config = make_config()
    provider = FakeProvider(config)
    first = _make_service(package, db, provider).apply()
    embed_calls_after_first = len(provider.embed_calls)
    chunk_ids_after_first = set(db.chunks)
    second = _make_service(package, db, provider).apply()

    assert second["counts"]["chunks_inserted"] == 0
    assert second["counts"]["embeddings_inserted"] == 0
    assert second["counts"]["model_batches"] == 0
    assert second["counts"]["chunks_reused"] == len(rows)
    assert len(provider.embed_calls) == embed_calls_after_first
    assert set(db.chunks) == chunk_ids_after_first
    assert first["counts"]["chunks_inserted"] == len(rows)
    assert db.profiles[PROFILE_ID].status == "active"


def test_apply_resumes_missing_chunk_and_embeddings(tmp_path: Path):
    package, rows, _meta, _corpus, _meta_path = _load(tmp_path)
    db = FakeSeedDb()
    _prepare_existing(db, package)
    provider = FakeProvider(make_config())
    _make_service(package, db, provider).apply()
    # 模拟崩溃：删掉一个 chunk 和全部 embedding
    first_source = next(iter(package.sources.values()))
    removed_key = (first_source.source_version_id, 0)
    removed = db.chunks.pop(removed_key)
    db.embeddings = {item for item in db.embeddings if item[0] != removed["chunk_id"]}
    db.embeddings.clear()
    provider.embed_calls.clear()
    result = _make_service(package, db, provider).apply()
    assert result["counts"]["chunks_inserted"] == 1
    assert result["counts"]["embeddings_inserted"] == len(rows)
    assert len(db.chunks) == len(rows)
    assert len(db.embeddings) == len(rows)
    assert len(provider.embed_calls) == 1


# ---------------------------------------------------------------------------
# abort / fail-closed 场景
# ---------------------------------------------------------------------------


def test_apply_aborts_when_other_active_profile_exists(tmp_path: Path):
    package, _rows, _meta, _corpus, _meta_path = _load(tmp_path)
    db = FakeSeedDb()
    _prepare_existing(db, package)
    db.profiles["other-profile"] = EmbeddingProfile(
        profile_id="other-profile",
        provider=PROVIDER_NAME,
        model="qwen/qwen3-embedding-8b",
        dimensions=4096,
        normalization="l2",
        query_template_version="career-qwen-v1",
        splitter_version="career-splitter-2026-10-19.1",
        status="active",
        metadata={"corpus_sha256": "b" * 64},
    )
    with pytest.raises(ConfigError) as excinfo:
        _make_service(package, db).apply()
    assert "active embedding profile" in str(excinfo.value)
    assert not db.chunks
    assert PROFILE_ID not in db.profiles


def test_apply_aborts_on_profile_config_mismatch(tmp_path: Path):
    package, _rows, _meta, _corpus, _meta_path = _load(tmp_path)
    db = FakeSeedDb()
    _prepare_existing(db, package)
    db.profiles[PROFILE_ID] = EmbeddingProfile(
        profile_id=PROFILE_ID,
        provider=PROVIDER_NAME,
        model="BAAI/bge-small-zh-v1.5",  # 不允许混用旧 bge
        dimensions=512,
        normalization="l2",
        query_template_version="career-qwen-v1",
        splitter_version="career-splitter-2026-10-19.1",
        status="building",
        metadata={},
    )
    with pytest.raises(ConfigError) as excinfo:
        _make_service(package, db).apply()
    assert "不一致" in str(excinfo.value)
    assert not db.chunks


def test_apply_aborts_when_profile_bound_to_different_corpus(tmp_path: Path):
    package, _rows, _meta, _corpus, _meta_path = _load(tmp_path)
    db = FakeSeedDb()
    _prepare_existing(db, package)
    db.profiles[PROFILE_ID] = EmbeddingProfile(
        profile_id=PROFILE_ID,
        provider=PROVIDER_NAME,
        model="qwen/qwen3-embedding-8b",
        dimensions=4096,
        normalization="l2",
        query_template_version="career-qwen-v1",
        splitter_version="career-splitter-2026-10-19.1",
        status="building",
        metadata={"corpus_sha256": "c" * 64},
    )
    with pytest.raises(ConfigError) as excinfo:
        _make_service(package, db).apply()
    assert "混语料" in str(excinfo.value)
    assert not db.chunks


def test_apply_rejects_unset_budget_before_any_write(tmp_path: Path):
    package, _rows, _meta, _corpus, _meta_path = _load(tmp_path)
    db = FakeSeedDb()
    _prepare_existing(db, package)
    with pytest.raises(BudgetExceeded):
        _make_service(package, db, budget=BudgetGuard(None)).apply()  # type: ignore[arg-type]
    assert not db.profiles and not db.chunks and not db.updated_versions


def test_apply_rejects_wrong_embedding_dimensions(tmp_path: Path):
    package, _rows, _meta, _corpus, _meta_path = _load(tmp_path)
    db = FakeSeedDb()
    _prepare_existing(db, package)
    config = make_config()
    service = _make_service(package, db, BadDimensionProvider(config))
    with pytest.raises(CorpusSeedError) as excinfo:
        service.apply()
    assert "维度" in str(excinfo.value)
    assert db.profiles[PROFILE_ID].status == "building"
    assert db.chunks  # 已写入的 chunk 保留，下一次可续跑 embedding


def test_apply_aborts_on_chunk_sha_mismatch(tmp_path: Path):
    package, _rows, _meta, _corpus, _meta_path = _load(tmp_path)
    db = FakeSeedDb()
    _prepare_existing(db, package)
    _make_service(package, db).apply()
    first_key = next(iter(db.chunks))
    db.chunks[first_key]["text_sha256"] = "f" * 64
    with pytest.raises(CorpusSeedError) as excinfo:
        _make_service(package, db).apply()
    assert "text_sha256" in str(excinfo.value)


def test_apply_aborts_when_verified_counts_mismatch(tmp_path: Path):
    package, _rows, _meta, _corpus, _meta_path = _load(tmp_path)
    db = FakeSeedDb()
    _prepare_existing(db, package)
    _make_service(package, db).apply()
    # 模拟 DB 丢失 embedding 行：apply 会尝试补写，但最终计数校验必须失败
    db.hide_embeddings_on_list = 1
    with pytest.raises(CorpusSeedError) as excinfo:
        _make_service(package, db).apply()
    assert "embedding 数量校验失败" in str(excinfo.value)
    assert db.profiles[PROFILE_ID].status == "active"  # 上一轮已 active，本轮失败不降级


def test_apply_aborts_when_corpus_source_missing_from_db_and_registry(tmp_path: Path):
    package, _rows, _meta, _corpus, _meta_path = _load(tmp_path)
    db = FakeSeedDb()
    # 只登记一个已有来源；另一个来源既不在 DB 也不在 registry_extra
    first = next(iter(package.sources.values()))
    db.add_existing_version(first.source_id, first.source_version_id)
    with pytest.raises(ConfigError) as excinfo:
        _make_service(package, db).apply()
    assert "source_registry_extra" in str(excinfo.value)
    assert not db.chunks


def test_apply_cli_requires_budget(tmp_path: Path, monkeypatch, capsys):
    from scripts.seed_corpus import main as seed_main

    corpus_path, meta_path, _rows, _meta = build_corpus_files(tmp_path)
    for key, value in {
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_SECRET_KEY": "sb_secret_test_value_123456",
        "OPENROUTER_API_KEY": "sk-or-test-value-123456",
    }.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("MODEL_MONTHLY_BUDGET_USD", raising=False)
    code = seed_main(["--apply", "--corpus", str(corpus_path), "--meta", str(meta_path)])
    assert code == 2
    output = json.loads(capsys.readouterr().out)
    assert output["ok"] is False
    assert output["error"]["code"] == "budget_exceeded"
