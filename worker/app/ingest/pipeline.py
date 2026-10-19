"""ingest 流水线：单个 source_version 的完整入库。

状态机：
``load → parse_and_chunk → embed → persist``

每一步都可以单独调用，便于 LangGraph 在节点之间更新 run 进度、检查 cancel；
失败不会自动切换语料/模型，只会把 run 标成 failed 或按 DB 的 attempts 重试。
"""

from __future__ import annotations

import hashlib
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from ..config import PROVIDER_NAME, Config
from ..db import SupabaseDb
from ..errors import IngestError, ResourceNotFound
from ..logging_setup import get_logger, log_event
from ..models import EmbeddingProfile, IngestRunResult, ModelUsage
from ..providers.openrouter import OpenRouterClient, vector_literal
from .chunking import ChunkDraft, chunk_sections
from .parsers import ParseResult, parse_document

logger = get_logger("worker.ingest.pipeline")

StageCallback = Callable[[str, int], None]
UsageCallback = Callable[[ModelUsage], None]


@dataclass
class IngestSourceInfo:
    owner_id: str
    run_id: str
    source_version_id: str
    source_id: str
    version: dict[str, Any]
    source: dict[str, Any] | None
    content: bytes
    suffix: str


@dataclass
class IngestParsed:
    parse: ParseResult
    chunks: list[ChunkDraft]

    @property
    def parser_version(self) -> str:
        return self.parse.parser_version

    @property
    def extraction_status(self) -> str:
        return self.parse.extraction_status


@dataclass
class IngestEmbedded:
    profile: EmbeddingProfile
    vectors: list[list[float]]
    usage: ModelUsage | None


class IngestPipeline:
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
        self._on_usage = on_usage

    # ------------------------------------------------------------------
    # 0. profile
    # ------------------------------------------------------------------
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
                "embedding_batch_size": self.config.embedding_batch_size,
                "query_instruction_template_version": self.config.embedding_query_template_version,
                "token_estimator_version": self.config.ingest.token_estimator_version,
                "splitter_version": self.config.ingest.splitter_version,
            },
        )
        # 不把原始 instruction 模板写进 metadata（可能被 UI 展示），只写版本号。
        return self.db.ensure_embedding_profile(profile)

    # ------------------------------------------------------------------
    # 1. load
    # ------------------------------------------------------------------
    def load(self, source_version_id: str, *, owner_id: str, run_id: str) -> IngestSourceInfo:
        version = self.db.get_source_version(source_version_id)
        visibility = str(version.get("visibility") or "approved_reference")
        version_owner = version.get("owner_id")
        if visibility == "private":
            if not version_owner or str(version_owner).lower() != str(owner_id).lower():
                raise ResourceNotFound("私有来源不属于当前 run 的 owner")
        source_id = str(version["source_id"])
        source = self.db.get_source(source_id)
        storage_path = str(version.get("storage_path") or "")
        if not storage_path:
            raise IngestError("source_version 缺少 storage_path")
        suffix = Path(storage_path).suffix.lower()
        mime = ""
        for metadata in (version.get("metadata") or {}, (source or {}).get("metadata") or {}):
            if isinstance(metadata, dict) and metadata.get("mime_type"):
                mime = str(metadata["mime_type"])
                break
        if not suffix:
            suffix = {
                "application/pdf": ".pdf",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
                "text/markdown": ".md",
                "text/plain": ".txt",
            }.get(mime, ".bin")
        content = self.db.storage_download(self.config.source_files_bucket, storage_path)
        expected_sha = str(version.get("content_sha256") or "")
        actual_sha = hashlib.sha256(content).hexdigest()
        if expected_sha and expected_sha != actual_sha:
            raise IngestError("下载文件内容的 sha256 与 source_version 记录不一致")
        log_event(
            logger,
            "ingest_loaded",
            run_id=run_id,
            source_version_id=source_version_id,
            source_id=source_id,
            bytes=len(content),
        )
        return IngestSourceInfo(
            owner_id=owner_id,
            run_id=run_id,
            source_version_id=source_version_id,
            source_id=source_id,
            version=version,
            source=source,
            content=content,
            suffix=suffix,
        )

    # ------------------------------------------------------------------
    # 2. parse + chunk
    # ------------------------------------------------------------------
    def parse_and_chunk(self, info: IngestSourceInfo) -> IngestParsed:
        mime = ""
        for metadata in (info.version.get("metadata") or {}, (info.source or {}).get("metadata") or {}):
            if isinstance(metadata, dict) and metadata.get("mime_type"):
                mime = str(metadata["mime_type"])
                break
        try:
            with tempfile.TemporaryDirectory(prefix="campus-pathway-ingest-") as tmpdir:
                path = Path(tmpdir) / f"source{info.suffix}"
                path.write_bytes(info.content)
                parse = parse_document(path, mime_type=mime or None)
        except IngestError:
            self._mark_failed(info, "unsupported_or_empty_document")
            raise
        except Exception:
            self._mark_failed(info, "parse_failed")
            raise
        if not parse.sections:
            self._mark_failed(info, "no_extractable_text")
            raise IngestError("文件中没有可提取文本（可能是扫描件，需要 OCR/Docling 支持）")
        chunks = chunk_sections(parse.sections, config=self.config.ingest, document_title=str((info.source or {}).get("title") or ""))
        if not chunks:
            self._mark_failed(info, "chunking_empty")
            raise IngestError("切块结果为空，拒绝写入空语料")
        if len(chunks) > self.config.ingest.max_chunks:
            self._mark_failed(info, "too_many_chunks")
            raise IngestError(f"文件切块数超过上限（{self.config.ingest.max_chunks}），请先拆分或联系运维")
        if parse.extraction_status == "failed":
            self._mark_failed(info, "parse_failed")
            raise IngestError("解析失败，未产生可用文本")
        self.db.update_source_version(
            info.source_version_id,
            {
                "parser_version": parse.parser_version,
                # 写入中间状态，最终状态在 persist 时再落一次。
                "extraction_status": "partial" if parse.extraction_status == "failed" else parse.extraction_status,
            },
        )
        log_event(
            logger,
            "ingest_parsed",
            run_id=info.run_id,
            source_version_id=info.source_version_id,
            parser_version=parse.parser_version,
            extraction_status=parse.extraction_status,
            chunks=len(chunks),
        )
        return IngestParsed(parse=parse, chunks=chunks)

    # ------------------------------------------------------------------
    # 3. embed
    # ------------------------------------------------------------------
    def embed(self, parsed: IngestParsed, *, emit: StageCallback | None = None) -> IngestEmbedded:
        profile = self.ensure_profile()
        if emit:
            emit("embedding", 40)
        response = self.provider.embed_texts([chunk.text for chunk in parsed.chunks], operation="embedding_ingest")
        if len(response.vectors) != len(parsed.chunks):
            raise IngestError("embedding 条数与切块数不一致")
        for vector in response.vectors:
            if len(vector) != self.config.embedding_dimensions:
                raise IngestError("embedding 维度与配置不一致")
        if response.usage is not None and self._on_usage is not None:
            self._on_usage(response.usage)
        if emit:
            emit("embedding", 72)
        log_event(
            logger,
            "ingest_embedded",
            chunks=len(parsed.chunks),
            model=self.config.embedding_model,
            duration_ms=response.latency_ms,
            input_tokens=response.usage.input_tokens if response.usage else None,
        )
        return IngestEmbedded(profile=profile, vectors=response.vectors, usage=response.usage)

    # ------------------------------------------------------------------
    # 4. persist
    # ------------------------------------------------------------------
    def persist(self, info: IngestSourceInfo, parsed: IngestParsed, embedded: IngestEmbedded, *, emit: StageCallback | None = None) -> IngestRunResult:
        version = info.version
        visibility = str(version.get("visibility") or "approved_reference")
        chunk_owner = version.get("owner_id") if visibility == "private" else None
        # 幂等：同一个 version + splitter_version 的旧 chunks 先删（cascade 删 embeddings）。
        self.db.delete_chunks_for_version(info.source_version_id, self.config.ingest.splitter_version)
        rows = [
            chunk.to_row(
                source_version_id=info.source_version_id,
                owner_id=chunk_owner,
                visibility=visibility,
                splitter_version=self.config.ingest.splitter_version,
            )
            for chunk in parsed.chunks
        ]
        inserted = self.db.insert_chunks(rows)
        by_ordinal = {int(row["ordinal"]): row for row in inserted if "ordinal" in row and "chunk_id" in row}
        if len(by_ordinal) != len(parsed.chunks):
            raise IngestError("数据库返回的 chunk 数量与预期不一致")
        embedding_rows: list[dict[str, Any]] = []
        for chunk, vector in zip(parsed.chunks, embedded.vectors):
            chunk_row = by_ordinal[chunk.ordinal]
            embedding_rows.append(
                {
                    "chunk_id": str(chunk_row["chunk_id"]),
                    "profile_id": embedded.profile.profile_id,
                    # pgvector 列要求文本 "[...]"，不走 JSON 数组。
                    "embedding": vector_literal(vector),
                }
            )
        # 分批写 embeddings，避免单次请求体过大（4096 维 × 每行约 40KB 文本）。
        batch = 20
        for start in range(0, len(embedding_rows), batch):
            self.db.insert_chunk_embeddings(embedding_rows[start : start + batch])
        if emit:
            emit("validating", 88)

        metadata = dict(version.get("metadata") or {})
        metadata.update(
            {
                "parser_warnings": list(parsed.parse.warnings),
                "page_count": parsed.parse.pages_total,
                "empty_pages": list(parsed.parse.pages_empty),
                "chunk_count": len(parsed.chunks),
                "splitter_version": self.config.ingest.splitter_version,
                "embedding_profile_id": embedded.profile.profile_id,
                "token_estimator_version": self.config.ingest.token_estimator_version,
            }
        )
        self.db.update_source_version(
            info.source_version_id,
            {
                "extraction_status": parsed.parse.extraction_status,
                "parser_version": parsed.parse.parser_version,
                "metadata": metadata,
            },
        )
        result = IngestRunResult(
            source_id=info.source_id,
            source_version_id=info.source_version_id,
            chunks=len(parsed.chunks),
            documents=1,
            parser_version=parsed.parse.parser_version,
            extraction_status=parsed.parse.extraction_status,
        )
        log_event(
            logger,
            "ingest_persisted",
            run_id=info.run_id,
            source_version_id=info.source_version_id,
            chunks=len(parsed.chunks),
            parser_version=parsed.parse.parser_version,
            extraction_status=parsed.parse.extraction_status,
        )
        return result

    # ------------------------------------------------------------------
    # 便捷入口（测试/一次性 ingest 使用）
    # ------------------------------------------------------------------
    def run(
        self,
        source_version_ids: list[str],
        *,
        owner_id: str,
        run_id: str,
        emit: StageCallback | None = None,
    ) -> IngestRunResult:
        if not source_version_ids:
            raise IngestError("ingest 缺少 source_version_id")
        first_result: IngestRunResult | None = None
        for index, version_id in enumerate(source_version_ids):
            if emit:
                emit("parsing", min(30, 10 + index * 5))
            info = self.load(version_id, owner_id=owner_id, run_id=run_id)
            if emit:
                emit("parsing", min(38, 20 + index * 5))
            parsed = self.parse_and_chunk(info)
            embedded = self.embed(parsed, emit=emit)
            result = self.persist(info, parsed, embedded, emit=emit)
            if first_result is None:
                first_result = result
            else:
                first_result = IngestRunResult(
                    source_id=first_result.source_id,
                    source_version_id=first_result.source_version_id,
                    chunks=first_result.chunks + result.chunks,
                    documents=first_result.documents + result.documents,
                    parser_version=first_result.parser_version,
                    extraction_status=result.extraction_status,
                )
        assert first_result is not None
        return first_result

    # ------------------------------------------------------------------
    # 失败标记
    # ------------------------------------------------------------------
    def _mark_failed(self, info: IngestSourceInfo, error_code: str) -> None:
        try:
            metadata = dict(info.version.get("metadata") or {})
            metadata["ingest_error_code"] = error_code
            self.db.update_source_version(
                info.source_version_id,
                {"extraction_status": "failed", "metadata": metadata},
            )
        except Exception:  # noqa: BLE001 - 失败标记失败不能掩盖原始异常
            logger.warning("ingest_mark_failed_failed source_version_id=%s", info.source_version_id)
