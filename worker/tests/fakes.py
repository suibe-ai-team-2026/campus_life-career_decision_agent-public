"""测试夹具：离线 fake DB / fake provider / 配置 / 上下文。

只用于 pytest；不联网、不读写真实 Supabase。
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable, Sequence

import httpx

from app.budget import BudgetGuard
from app.config import PROVIDER_NAME, Config
from app.models import Citation, ClaimedJob, EmbeddingProfile, ModelUsage, UsageTotals
from app.providers.openrouter import ChatResponse, EmbeddingResponse
from app.retrieval.service import RetrievalService
from app.rules.engine import RulesEngine
from app.rules.repository import StaticRulesRepository

FIXTURES = Path(__file__).parent / "fixtures"

BASE_ENV = {
    "SUPABASE_URL": "https://example.supabase.co",
    "SUPABASE_SECRET_KEY": "sb_secret_test_key_do_not_use",
    "OPENROUTER_API_KEY": "sk-or-test-key-do-not-use",
    "MODEL_MONTHLY_BUDGET_USD": "5.00",
    "WORKER_CONCURRENCY": "1",
    "MODEL_INPUT_PRICE_USD_PER_MTOK": "0.10",
    "MODEL_OUTPUT_PRICE_USD_PER_MTOK": "0.20",
}


def make_config(**overrides: str) -> Config:
    env = dict(BASE_ENV)
    env.update({key: str(value) for key, value in overrides.items()})
    return Config.from_env(env)


def load_rules_fixture(name: str = "rules_trade.json") -> dict[str, Any]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def make_rules_engine(data: dict[str, Any] | None = None, *, rules_version: str = "career-rules-2026-10-19.1") -> RulesEngine:
    return RulesEngine(StaticRulesRepository(data if data is not None else load_rules_fixture()), rules_version=rules_version)


def fake_vector(text: str, dimensions: int = 4096) -> list[float]:
    """确定性的单位向量：位置由文本哈希决定，其余为 0。"""

    vector = [0.0] * dimensions
    index = abs(hash(text)) % dimensions
    vector[index] = 1.0
    return vector


def make_claim(job_input: dict[str, Any], *, kind: str, owner_id: str = "11111111-1111-1111-1111-111111111111") -> ClaimedJob:
    return ClaimedJob(
        job_id="22222222-2222-2222-2222-222222222222",
        run_id="33333333-3333-3333-3333-333333333333",
        owner_id=owner_id,
        kind=kind,
        input=job_input,
        profile_version=1,
        attempts=1,
        max_attempts=3,
        lease_epoch=1,
    )


class FakeProvider:
    """不走网络的 provider；记录所有调用。"""

    def __init__(self, config: Config, *, chat_responses: dict[str, list[str]] | None = None) -> None:
        self.config = config
        self.chat_responses = {key: list(value) for key, value in (chat_responses or {}).items()}
        self.embed_calls: list[tuple[str, list[str]]] = []
        self.chat_calls: list[tuple[str, list[dict[str, str]]]] = []
        self.embed_error: Exception | None = None
        self.chat_error: Exception | None = None

    def embed_texts(self, texts: Sequence[str], *, operation: str = "embedding") -> EmbeddingResponse:
        if self.embed_error is not None:
            raise self.embed_error
        self.embed_calls.append((operation, list(texts)))
        return EmbeddingResponse(
            vectors=[fake_vector(text, self.config.embedding_dimensions) for text in texts],
            usage=ModelUsage(
                provider=PROVIDER_NAME,
                model=self.config.embedding_model,
                operation=operation,
                input_tokens=len(texts) * 3,
                output_tokens=None,
                latency_ms=5,
                estimated_cost=Decimal("0.0001"),
                pricing_snapshot_at=datetime.now(timezone.utc),
            ),
            latency_ms=5,
            model=self.config.embedding_model,
            request_count=1,
        )

    def chat(self, messages: Sequence[dict[str, str]], *, operation: str, temperature=None, max_tokens=None) -> ChatResponse:
        if self.chat_error is not None:
            raise self.chat_error
        self.chat_calls.append((operation, list(messages)))
        queue = self.chat_responses.get(operation) or []
        content = queue.pop(0) if queue else '{"answer":"资料不足","citation_numbers":[],"no_evidence":true,"boundary_note":""}'
        return ChatResponse(
            content=content,
            usage=ModelUsage(
                provider=PROVIDER_NAME,
                model=self.config.chat_model,
                operation=operation,
                input_tokens=100,
                output_tokens=50,
                latency_ms=8,
                estimated_cost=Decimal("0.00002"),
                pricing_snapshot_at=datetime.now(timezone.utc),
            ),
            latency_ms=8,
            model=self.config.chat_model,
            finish_reason="stop",
            json_mode_used=True,
        )

    def close(self) -> None:
        return None


class FakeDb:
    """实现 worker/graph 需要的 DB 方法；全部记录调用，便于断言。"""

    def __init__(self, *, config: Config) -> None:
        self.config = config
        self.profiles: dict[str, dict[str, Any]] = {}
        self.plans: dict[str, dict[str, Any]] = {}
        self.plan_versions: dict[str, dict[str, Any]] = {}
        # 传入这些 plan_id 时 save_plan 抛 ResourceNotFound，用于测试"旧方案已被清理"。
        self.missing_plan_ids: set[str] = set()
        # 用户私有上传（已解析）的来源版本；默认空，个别用例按需填充。
        self.owner_upload_versions: list[dict[str, Any]] = []
        self.directions: dict[str, dict[str, Any]] = {}
        self.assessments: dict[str, dict[str, Any]] = {}
        self.source_versions: dict[str, dict[str, Any]] = {}
        self.sources: dict[str, dict[str, Any]] = {}
        self.storage_objects: dict[tuple[str, str], bytes] = {}
        self.search_rows: list[dict[str, Any]] = []
        self.neighbor_rows: list[dict[str, Any]] = []
        self.uploads: list[tuple[str, str, bytes, str]] = []
        self.progress_calls: list[tuple[str, int, str, int]] = []
        self.completed: list[dict[str, Any]] = []
        self.fail_calls: list[tuple[str, bool, str]] = []
        self.claim_queue: list[ClaimedJob] = []
        self.usage_rows: list[dict[str, Any]] = []
        self.saved_plans: list[dict[str, Any]] = []
        self.artifacts: dict[str, dict[str, Any]] = {}
        self.updated_source_versions: list[tuple[str, dict[str, Any]]] = []
        self.inserted_chunks: list[dict[str, Any]] = []
        self.inserted_embeddings: list[dict[str, Any]] = []
        self.deleted_chunks: list[tuple[str, str]] = []
        self.cancel_requested = False
        self.heartbeat_response = True
        self.heartbeat_errors: list[Exception] = []
        self.heartbeat_calls = 0
        self._chunk_counter = 0

    # -- 队列 ---------------------------------------------------------
    def claim_job(self, worker_id: str, lease_seconds: int) -> ClaimedJob | None:
        return self.claim_queue.pop(0) if self.claim_queue else None

    def heartbeat(self, job_id: str, worker_id: str, lease_epoch: int, lease_seconds: int) -> bool:
        self.heartbeat_calls += 1
        if self.heartbeat_errors:
            raise self.heartbeat_errors.pop(0)
        return self.heartbeat_response

    def set_progress(self, job_id: str, worker_id: str, lease_epoch: int, status: str, progress: int) -> bool:
        self.progress_calls.append((job_id, lease_epoch, status, progress))
        return True

    def complete_job(self, job_id: str, worker_id: str, lease_epoch: int, result: dict[str, Any]) -> str | None:
        self.completed.append(result)
        return "33333333-3333-3333-3333-333333333333"

    def fail_job(self, job_id: str, worker_id: str, lease_epoch: int, error_code: str, retryable: bool) -> str:
        self.fail_calls.append((error_code, retryable, str(lease_epoch)))
        return "retry" if retryable else "failed"

    # -- 产品数据 -----------------------------------------------------
    def get_profile(self, owner_id: str, profile_id: str) -> dict[str, Any]:
        profile = self.profiles.get(profile_id)
        if profile is None or str(profile.get("owner_id")) != owner_id:
            from app.errors import ResourceNotFound

            raise ResourceNotFound("画像不存在")
        return profile

    def get_plan(self, owner_id: str, plan_id: str) -> dict[str, Any]:
        plan = self.plans.get(plan_id)
        if plan is None or str(plan.get("owner_id")) != owner_id:
            from app.errors import ResourceNotFound

            raise ResourceNotFound("方案不存在")
        return plan

    def get_plan_version(self, owner_id: str, version_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
        version = self.plan_versions.get(version_id)
        if version is None:
            from app.errors import ResourceNotFound

            raise ResourceNotFound("方案版本不存在")
        plan = self.get_plan(owner_id, str(version["plan_id"]))
        return plan, version

    def get_direction(self, direction_id: str) -> dict[str, Any] | None:
        return self.directions.get(direction_id)

    def list_directions(self, direction_ids: Sequence[str] | None = None) -> list[dict[str, Any]]:
        if not direction_ids:
            return list(self.directions.values())
        return [self.directions[item] for item in direction_ids if item in self.directions]

    def get_assessment(self, version: str) -> dict[str, Any] | None:
        return self.assessments.get(version)

    def get_artifact(self, owner_id: str, artifact_id: str) -> dict[str, Any]:
        return self.artifacts.get(artifact_id) or {"artifact_id": artifact_id, "expires_at": "2026-10-26T00:00:00+00:00"}

    def get_run_cancel_requested(self, run_id: str) -> bool:
        return self.cancel_requested

    # -- worker 发布 ---------------------------------------------------
    def list_owner_upload_versions(self, owner_id: str) -> list[dict[str, Any]]:
        return list(self.owner_upload_versions)

    def save_plan(self, **kwargs: Any) -> tuple[str, str, int]:
        requested = kwargs.get("plan_id")
        if requested and requested in self.missing_plan_ids:
            from app.errors import ResourceNotFound

            raise ResourceNotFound("方案不存在或不属于当前会话")
        self.saved_plans.append(kwargs)
        plan_id = requested or "44444444-4444-4444-4444-444444444444"
        return plan_id, "55555555-5555-5555-5555-555555555555", 1

    def register_artifact(self, **kwargs: Any) -> str:
        artifact_id = kwargs["artifact_id"]
        self.artifacts[artifact_id] = {"artifact_id": artifact_id, "expires_at": "2026-10-26T00:00:00+00:00"}
        return artifact_id

    def storage_upload(self, bucket: str, path: str, data: bytes, *, content_type: str) -> None:
        self.uploads.append((bucket, path, data, content_type))
        self.storage_objects[(bucket, path)] = data

    def storage_download(self, bucket: str, path: str) -> bytes:
        try:
            return self.storage_objects[(bucket, path)]
        except KeyError as exc:
            from app.errors import ResourceNotFound

            raise ResourceNotFound("源文件不存在") from exc

    # -- 检索 ---------------------------------------------------------
    def search_chunks(self, **kwargs: Any) -> list[dict[str, Any]]:
        return list(self.search_rows)

    def chunk_neighbors(self, *, chunk_ids: Any, owner_id: str) -> list[dict[str, Any]]:
        return list(self.neighbor_rows)

    # -- usage --------------------------------------------------------
    def record_usage(self, **kwargs: Any) -> None:
        self.usage_rows.append(kwargs)

    def usage_since(self, *, since: datetime) -> UsageTotals:
        return UsageTotals(spent_usd=Decimal(0), unknown_cost_usage_count=0)

    # -- embedding profile -------------------------------------------
    def ensure_embedding_profile(self, profile: EmbeddingProfile) -> EmbeddingProfile:
        return profile

    # -- ingest -------------------------------------------------------
    def get_source_version(self, source_version_id: str) -> dict[str, Any]:
        try:
            return self.source_versions[source_version_id]
        except KeyError as exc:
            from app.errors import ResourceNotFound

            raise ResourceNotFound("来源版本不存在") from exc

    def get_source(self, source_id: str) -> dict[str, Any] | None:
        return self.sources.get(source_id)

    def update_source_version(self, source_version_id: str, values: dict[str, Any]) -> None:
        self.updated_source_versions.append((source_version_id, values))

    def delete_chunks_for_version(self, source_version_id: str, splitter_version: str) -> None:
        self.deleted_chunks.append((source_version_id, splitter_version))

    def insert_chunks(self, rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
        inserted: list[dict[str, Any]] = []
        for row in rows:
            self._chunk_counter += 1
            item = dict(row)
            item["chunk_id"] = f"chunk-{self._chunk_counter:04d}"
            inserted.append(item)
            self.inserted_chunks.append(item)
        return inserted

    def insert_chunk_embeddings(self, rows: Sequence[dict[str, Any]]) -> None:
        self.inserted_embeddings.extend(dict(row) for row in rows)

    def close(self) -> None:
        return None


def make_context(
    *,
    config: Config,
    db: FakeDb,
    provider: FakeProvider,
    job: ClaimedJob,
    rules_data: dict[str, Any] | None = None,
    emits: list[tuple[str, int]] | None = None,
    budget: BudgetGuard | None = None,
):
    from app.graphs.common import JobContext
    import logging

    emit_log = emits if emits is not None else []
    retrieval = RetrievalService(config=config, db=db, provider=provider)  # type: ignore[arg-type]
    return JobContext(
        config=config,
        db=db,  # type: ignore[arg-type]
        provider=provider,  # type: ignore[arg-type]
        retrieval=retrieval,
        rules_engine=make_rules_engine(rules_data),
        job=job,
        worker_id="test-worker",
        emit_progress=lambda status, progress: emit_log.append((status, progress)),
        cancel_check=lambda: None,
        logger=logging.getLogger("test.worker"),
        budget=budget,
    )


@dataclass
class CapturedRequest:
    method: str
    url: str
    json_body: dict[str, Any] | None
    headers: dict[str, str]


def make_mock_http(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def embedding_payload(vectors: list[list[float]], indexes: list[int] | None = None, *, tokens: int | None = 12) -> dict[str, Any]:
    data = []
    for position, vector in enumerate(vectors):
        index = indexes[position] if indexes is not None else position
        data.append({"index": index, "embedding": vector})
    payload: dict[str, Any] = {"data": data, "model": "qwen/qwen3-embedding-8b"}
    if tokens is not None:
        payload["usage"] = {"prompt_tokens": tokens, "total_tokens": tokens}
    return payload


def unit_vector(dimensions: int = 4096, *, at: int = 0) -> list[float]:
    vector = [0.0] * dimensions
    vector[at % dimensions] = 1.0
    return vector


def chat_payload(content: str, *, prompt_tokens: int = 100, completion_tokens: int = 40) -> dict[str, Any]:
    return {
        "choices": [{"message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens, "total_tokens": prompt_tokens + completion_tokens},
        "model": "deepseek/deepseek-chat",
    }


def approx(value: float, expected: float, tolerance: float = 1e-6) -> bool:
    return math.isclose(value, expected, rel_tol=tolerance, abs_tol=tolerance)
