"""worker 配置：全部来自环境变量，绝不打印密钥。

约束（来自任务与 docs/architecture/overview.md §6）：
- embedding 模型、4096 维、L2 归一化、查询模板版本都是一次性冻结的「profile」；
  改任何一项都必须新建 profile 并重建语料，不能混用。
- ``MODEL_MONTHLY_BUDGET_USD`` 未设置时，worker 拒绝调用任何模型（fail closed），
  不把「未设置」解释成「无限预算」。
"""

from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Mapping

from .errors import ConfigError

# ---------------------------------------------------------------------------
# 版本常量：写进数据库 metadata / 结果的版本标识
# ---------------------------------------------------------------------------

EMBEDDING_QUERY_TEMPLATE_VERSION = "career-qwen-v1"
# 逐字来自任务说明；文档片段不加 instruction。
EMBEDDING_QUERY_TEMPLATE = (
    "Instruct: Given a campus career planning question, retrieve relevant passages from "
    "authorized university documents and verified career evidence.\n"
    "Query: {question}"
)
QUERY_TEMPLATE_VERSIONS = {EMBEDDING_QUERY_TEMPLATE_VERSION: EMBEDDING_QUERY_TEMPLATE}

SPLITTER_VERSION = "career-splitter-2026-10-19.1"
TOKEN_ESTIMATOR_VERSION = "career-cjk-estimator-v1"
RULES_VERSION = "career-rules-2026-10-19.1"
GATE_VERSION = "career-gate-2026-10-19.1"
PROMPT_VERSION = "career-prompts-2026-10-19.1"
PROVIDER_NAME = "openrouter"

SOURCE_FILES_BUCKET = "career-source-files"
ARTIFACTS_BUCKET = "career-artifacts"

KNOWN_DIRECTIONS = (
    "trade_supply_chain",
    "cross_border_business",
    "finance_accounting",
    "data_business",
    "public_service",
    "further_study",
)

_TRUE = {"1", "true", "yes", "on", "y"}
_FALSE = {"0", "false", "no", "off", "n", ""}


def _env(environ: Mapping[str, str], name: str, default: str | None = None) -> str | None:
    value = environ.get(name)
    if value is None:
        return default
    value = value.strip()
    return value if value != "" else default


def _require(environ: Mapping[str, str], name: str) -> str:
    value = _env(environ, name)
    if not value:
        raise ConfigError(f"缺少必需环境变量 {name}")
    return value


def _int(environ: Mapping[str, str], name: str, default: int, *, minimum: int | None = None, maximum: int | None = None) -> int:
    raw = _env(environ, name)
    try:
        value = int(raw) if raw is not None else default
    except ValueError as exc:
        raise ConfigError(f"{name} 必须是整数") from exc
    if minimum is not None and value < minimum:
        raise ConfigError(f"{name} 不能小于 {minimum}")
    if maximum is not None and value > maximum:
        raise ConfigError(f"{name} 不能大于 {maximum}")
    return value


def _float(environ: Mapping[str, str], name: str, default: float, *, minimum: float | None = None) -> float:
    raw = _env(environ, name)
    try:
        value = float(raw) if raw is not None else default
    except ValueError as exc:
        raise ConfigError(f"{name} 必须是数字") from exc
    if minimum is not None and value < minimum:
        raise ConfigError(f"{name} 不能小于 {minimum}")
    return value


def _decimal(
    environ: Mapping[str, str],
    name: str,
    default: Decimal | None = None,
    *,
    minimum: Decimal | None = None,
) -> Decimal | None:
    raw = _env(environ, name)
    if raw is None:
        return default
    try:
        value = Decimal(raw)
    except InvalidOperation as exc:
        raise ConfigError(f"{name} 必须是十进制数字") from exc
    if not value.is_finite():
        raise ConfigError(f"{name} 必须是有限数字")
    if minimum is not None and value < minimum:
        raise ConfigError(f"{name} 不能小于 {minimum}")
    return value


def _bool(environ: Mapping[str, str], name: str, default: bool) -> bool:
    raw = environ.get(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in _TRUE:
        return True
    if value in _FALSE:
        return False
    raise ConfigError(f"{name} 必须是 true/false")


def _choice(environ: Mapping[str, str], name: str, default: str, allowed: set[str]) -> str:
    raw = _env(environ, name, default)
    assert raw is not None
    if raw not in allowed:
        raise ConfigError(f"{name} 只能是 {sorted(allowed)}")
    return raw


def _validate_url(name: str, value: str) -> str:
    if not re.match(r"^https?://[^\s/]+", value):
        raise ConfigError(f"{name} 必须是 http(s) URL")
    return value.rstrip("/")


@dataclass(frozen=True)
class ModelPricing:
    """每百万 token 的美元价格；未知（None）时不估算成本，只记 NULL。"""

    input_usd_per_mtok: Decimal | None = None
    output_usd_per_mtok: Decimal | None = None

    def estimate(self, *, input_tokens: int | None = None, output_tokens: int | None = None) -> Decimal | None:
        if input_tokens is None and output_tokens is None:
            return None
        total = Decimal(0)
        if input_tokens is not None:
            if self.input_usd_per_mtok is None:
                return None
            total += self.input_usd_per_mtok * Decimal(input_tokens) / Decimal(1_000_000)
        if output_tokens is not None:
            if self.output_usd_per_mtok is None:
                return None
            total += self.output_usd_per_mtok * Decimal(output_tokens) / Decimal(1_000_000)
        return total


@dataclass(frozen=True)
class RetrievalConfig:
    # 混合检索：候选 → RRF → 多样性上限 → 来源类型配额 → 邻近扩展 → 字符预算。
    rrf_k: int = 60
    candidate_limit: int = 64
    min_evidence: int = 8
    max_evidence: int = 12
    max_per_document: int = 3
    max_per_source: int = 4
    evidence_char_budget: int = 7000
    neighbor_expansion: bool = True
    # 拒答闸门：阈值必须与 gate_version 一起冻结，不允许直接照抄旧 bge 的 0.52。
    dense_min_similarity: float = 0.60
    lexical_min_score: float = 0.08
    keyword_overlap_min: int = 3
    gate_version: str = GATE_VERSION
    # 类型配额：问题触发某类关键词时，至少保留的段数（RRF 排序后重新插回）。
    type_quota: tuple[tuple[str, int], ...] = (
        ("policy", 2),
        ("job", 2),
        ("plan", 1),
        ("case", 1),
        ("catalog", 2),
    )

    def as_dict(self) -> dict[str, object]:
        return {
            "rrf_k": self.rrf_k,
            "candidate_limit": self.candidate_limit,
            "min_evidence": self.min_evidence,
            "max_evidence": self.max_evidence,
            "max_per_document": self.max_per_document,
            "max_per_source": self.max_per_source,
            "evidence_char_budget": self.evidence_char_budget,
            "neighbor_expansion": self.neighbor_expansion,
            "dense_min_similarity": self.dense_min_similarity,
            "lexical_min_score": self.lexical_min_score,
            "keyword_overlap_min": self.keyword_overlap_min,
            "gate_version": self.gate_version,
            "type_quota": dict(self.type_quota),
        }


@dataclass(frozen=True)
class IngestConfig:
    target_tokens: int = 600
    overlap_tokens: int = 80
    min_chunk_chars: int = 40
    max_table_tokens: int = 1200
    max_chunks: int = 4000
    splitter_version: str = SPLITTER_VERSION
    token_estimator_version: str = TOKEN_ESTIMATOR_VERSION


@dataclass(frozen=True)
class Config:
    # 外部服务
    supabase_url: str
    supabase_secret_key: str = field(repr=False)
    openrouter_api_key: str = field(repr=False)
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    # embedding profile
    embedding_model: str = "qwen/qwen3-embedding-8b"
    embedding_dimensions: int = 4096
    embedding_normalization: str = "l2"
    embedding_query_template_version: str = EMBEDDING_QUERY_TEMPLATE_VERSION
    embedding_instruction_mode: str = "explicit_template"
    embedding_profile_id: str = "career-qwen3-embedding-8b-4096-career-qwen-v1"
    embedding_batch_size: int = 16
    # chat: DeepSeek 官方 API（与 embedding 的 OpenRouter 账号分离）
    chat_provider: str = "deepseek"
    chat_api_key: str = field(default="", repr=False)
    chat_base_url: str = "https://api.deepseek.com"
    chat_model: str = "deepseek-flash"
    chat_temperature: float = 0.1
    chat_max_tokens: int = 1600
    chat_json_mode: str = "auto"
    chat_reasoning_effort: str | None = None
    # 运行时
    worker_concurrency: int = 1
    run_max_attempts: int = 3
    model_request_timeout_seconds: float = 60.0
    model_monthly_budget_usd: Decimal | None = None
    unknown_usage_reserve_usd: Decimal = Decimal("0.02")
    model_pricing: ModelPricing = field(default_factory=ModelPricing)
    embedding_pricing: ModelPricing = field(default_factory=ModelPricing)
    max_model_retries: int = 3
    worker_id: str | None = None
    log_level: str = "INFO"
    poll_interval_seconds: float = 5.0
    heartbeat_interval_seconds: float = 30.0
    lease_seconds: int = 120
    shutdown_grace_seconds: float = 30.0
    # Freestyle：空闲时主动 pause，BFF 在用户提交任务前 start/resume。
    freestyle_api_key: str | None = field(default=None, repr=False)
    freestyle_vm_id: str | None = None
    freestyle_base_url: str = "https://api.freestyle.sh"
    idle_pause_seconds: float = 120.0
    # 检索 / 切块 / 规则
    retrieval: RetrievalConfig = field(default_factory=RetrievalConfig)
    ingest: IngestConfig = field(default_factory=IngestConfig)
    rules_version: str = RULES_VERSION
    prompt_version: str = PROMPT_VERSION
    docling_enabled: bool = True
    # 存储桶固定名，避免部署时拼错
    source_files_bucket: str = SOURCE_FILES_BUCKET
    artifacts_bucket: str = ARTIFACTS_BUCKET

    # -- 安全展示 ---------------------------------------------------------
    def __repr__(self) -> str:  # pragma: no cover - 仅用于人工排查
        return f"Config({self.safe_summary()})"

    def safe_summary(self) -> dict[str, object]:
        return {
            "supabase_url": self.supabase_url,
            "has_supabase_secret_key": bool(self.supabase_secret_key),
            "has_openrouter_api_key": bool(self.openrouter_api_key),
            "has_chat_api_key": bool(self.chat_api_key),
            "openrouter_base_url": self.openrouter_base_url,
            "chat_provider": self.chat_provider,
            "chat_base_url": self.chat_base_url,
            "embedding_model": self.embedding_model,
            "embedding_dimensions": self.embedding_dimensions,
            "embedding_profile_id": self.embedding_profile_id,
            "embedding_query_template_version": self.embedding_query_template_version,
            "chat_model": self.chat_model,
            "chat_reasoning_effort": self.chat_reasoning_effort,
            "freestyle_vm_id": self.freestyle_vm_id,
            "idle_pause_seconds": self.idle_pause_seconds,
            "worker_concurrency": self.worker_concurrency,
            "budget": "unset" if self.model_monthly_budget_usd is None else str(self.model_monthly_budget_usd),
            "gate_version": self.retrieval.gate_version,
            "rules_version": self.rules_version,
            "splitter_version": self.ingest.splitter_version,
        }

    def secret_values(self) -> tuple[str, ...]:
        secrets = [self.supabase_secret_key, self.openrouter_api_key, self.chat_api_key]
        if self.freestyle_api_key:
            secrets.append(self.freestyle_api_key)
        return tuple(secrets)

    def query_template(self) -> str:
        try:
            return QUERY_TEMPLATE_VERSIONS[self.embedding_query_template_version]
        except KeyError as exc:  # pragma: no cover - 由 from_env 拦截
            raise ConfigError("未知的 EMBEDDING_QUERY_TEMPLATE_VERSION") from exc

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "Config":
        env: Mapping[str, str] = os.environ if environ is None else environ

        supabase_url = _validate_url("SUPABASE_URL", _require(env, "SUPABASE_URL"))
        supabase_secret_key = _require(env, "SUPABASE_SECRET_KEY")
        openrouter_api_key = _require(env, "OPENROUTER_API_KEY")
        base_url = _validate_url("OPENROUTER_BASE_URL", _env(env, "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1") or "")

        embedding_model = _env(env, "OPENROUTER_EMBEDDING_MODEL", "qwen/qwen3-embedding-8b") or ""
        dimensions = _int(env, "EMBEDDING_DIMENSIONS", 4096, minimum=1, maximum=4096)
        if dimensions != 4096:
            # 数据库 app_chunk_embeddings.embedding 是 vector(4096)；其他维度必须新建表/列，不能静默混用。
            raise ConfigError("EMBEDDING_DIMENSIONS 必须是 4096（与 app_chunk_embeddings.embedding 列一致）")
        normalization = _choice(env, "EMBEDDING_NORMALIZATION", "l2", {"l2"})
        template_version = _env(env, "EMBEDDING_QUERY_TEMPLATE_VERSION", EMBEDDING_QUERY_TEMPLATE_VERSION) or ""
        if template_version not in QUERY_TEMPLATE_VERSIONS:
            raise ConfigError(
                "EMBEDDING_QUERY_TEMPLATE_VERSION 必须是已登记版本 "
                f"{sorted(QUERY_TEMPLATE_VERSIONS)}；新模板需要同时新建 embedding profile"
            )
        instruction_mode = _choice(
            env, "EMBEDDING_INSTRUCTION_MODE", "explicit_template", {"explicit_template", "provider_auto"}
        )
        model_slug = embedding_model.rsplit("/", 1)[-1].lower()
        default_profile_id = "career-" + re.sub(r"[^a-z0-9]+", "-", model_slug).strip("-") + f"-{dimensions}-{template_version}"
        embedding_profile_id = _env(env, "EMBEDDING_PROFILE_ID", default_profile_id) or default_profile_id

        chat_provider = _choice(env, "CHAT_PROVIDER", "deepseek", {"deepseek", "openrouter"})
        if chat_provider == "openrouter":
            # 兼容旧部署；本任务默认使用 DeepSeek 官方 API。
            chat_api_key = openrouter_api_key
            chat_base_url = base_url
            chat_model = _env(env, "OPENROUTER_CHAT_MODEL", "deepseek/deepseek-chat") or "deepseek/deepseek-chat"
        else:
            chat_api_key = _env(env, "DEEPSEEK_API_KEY", openrouter_api_key) or openrouter_api_key
            chat_base_url = _validate_url(
                "DEEPSEEK_BASE_URL", _env(env, "DEEPSEEK_BASE_URL", "https://api.deepseek.com") or "https://api.deepseek.com"
            )
            chat_model = _env(env, "DEEPSEEK_CHAT_MODEL", "deepseek-flash") or "deepseek-flash"
        chat_json_mode = _choice(env, "CHAT_JSON_MODE", "auto", {"auto", "on", "off"})
        chat_reasoning_effort = _env(env, "DEEPSEEK_REASONING_EFFORT", "low")
        if chat_reasoning_effort not in (None, "low", "high", "max"):
            raise ConfigError("DEEPSEEK_REASONING_EFFORT 只能是 low/high/max 或留空")
        worker_concurrency = _int(env, "WORKER_CONCURRENCY", 1, minimum=1, maximum=1)
        run_max_attempts = _int(env, "RUN_MAX_ATTEMPTS", 3, minimum=1, maximum=10)
        timeout = _float(env, "MODEL_REQUEST_TIMEOUT_SECONDS", 60.0, minimum=1.0)
        budget = _decimal(env, "MODEL_MONTHLY_BUDGET_USD", None, minimum=Decimal("0"))
        unknown_reserve = _decimal(env, "UNKNOWN_USAGE_RESERVE_USD", Decimal("0.02"), minimum=Decimal("0"))
        assert unknown_reserve is not None

        input_price = _decimal(env, "MODEL_INPUT_PRICE_USD_PER_MTOK", None, minimum=Decimal("0"))
        output_price = _decimal(env, "MODEL_OUTPUT_PRICE_USD_PER_MTOK", None, minimum=Decimal("0"))
        embedding_price = _decimal(env, "EMBEDDING_PRICE_USD_PER_MTOK", None, minimum=Decimal("0"))
        # chat 与 embedding 的价格分开配置；未配置时成本写 NULL，不伪造价格。
        chat_pricing = ModelPricing(input_usd_per_mtok=input_price, output_usd_per_mtok=output_price)
        embedding_pricing = ModelPricing(input_usd_per_mtok=embedding_price, output_usd_per_mtok=None)

        retrieval = RetrievalConfig(
            candidate_limit=_int(env, "RETRIEVAL_CANDIDATE_LIMIT", 64, minimum=8, maximum=200),
            min_evidence=_int(env, "RETRIEVAL_MIN_EVIDENCE", 8, minimum=1, maximum=12),
            max_evidence=_int(env, "RETRIEVAL_MAX_EVIDENCE", 12, minimum=1, maximum=20),
            max_per_document=_int(env, "RETRIEVAL_MAX_PER_DOCUMENT", 3, minimum=1, maximum=5),
            max_per_source=_int(env, "RETRIEVAL_MAX_PER_SOURCE", 4, minimum=1, maximum=8),
            evidence_char_budget=_int(env, "RETRIEVAL_CHAR_BUDGET", 7000, minimum=1000, maximum=40000),
            neighbor_expansion=_bool(env, "RETRIEVAL_NEIGHBOR_EXPANSION", True),
            dense_min_similarity=_float(env, "GATE_DENSE_MIN_SIMILARITY", 0.60),
            lexical_min_score=_float(env, "GATE_LEXICAL_MIN_SCORE", 0.08),
            keyword_overlap_min=_int(env, "GATE_KEYWORD_OVERLAP_MIN", 3, minimum=1, maximum=20),
            gate_version=_env(env, "RETRIEVAL_GATE_VERSION", GATE_VERSION) or GATE_VERSION,
        )
        if retrieval.max_evidence < retrieval.min_evidence:
            raise ConfigError("RETRIEVAL_MAX_EVIDENCE 不能小于 RETRIEVAL_MIN_EVIDENCE")
        ingest = IngestConfig(
            target_tokens=_int(env, "CHUNK_TARGET_TOKENS", 600, minimum=100, maximum=4000),
            overlap_tokens=_int(env, "CHUNK_OVERLAP_TOKENS", 80, minimum=0, maximum=1000),
            min_chunk_chars=_int(env, "CHUNK_MIN_CHARS", 40, minimum=1, maximum=1000),
            max_table_tokens=_int(env, "CHUNK_MAX_TABLE_TOKENS", 1200, minimum=100, maximum=8000),
            max_chunks=_int(env, "INGEST_MAX_CHUNKS", 4000, minimum=1, maximum=20000),
        )
        if ingest.overlap_tokens >= ingest.target_tokens:
            raise ConfigError("CHUNK_OVERLAP_TOKENS 必须小于 CHUNK_TARGET_TOKENS")

        return cls(
            supabase_url=supabase_url,
            supabase_secret_key=supabase_secret_key,
            openrouter_api_key=openrouter_api_key,
            openrouter_base_url=base_url,
            embedding_model=embedding_model,
            embedding_dimensions=dimensions,
            embedding_normalization=normalization,
            embedding_query_template_version=template_version,
            embedding_instruction_mode=instruction_mode,
            embedding_profile_id=embedding_profile_id,
            embedding_batch_size=_int(env, "EMBEDDING_BATCH_SIZE", 16, minimum=1, maximum=16),
            chat_provider=chat_provider,
            chat_api_key=chat_api_key,
            chat_base_url=chat_base_url,
            chat_model=chat_model,
            chat_temperature=_float(env, "CHAT_TEMPERATURE", _float(env, "OPENROUTER_CHAT_TEMPERATURE", 0.1, minimum=0.0), minimum=0.0),
            chat_max_tokens=_int(env, "CHAT_MAX_TOKENS", _int(env, "OPENROUTER_CHAT_MAX_TOKENS", 1600, minimum=64, maximum=8192), minimum=64, maximum=8192),
            chat_json_mode=chat_json_mode,
            chat_reasoning_effort=chat_reasoning_effort,
            worker_concurrency=worker_concurrency,
            run_max_attempts=run_max_attempts,
            model_request_timeout_seconds=timeout,
            model_monthly_budget_usd=budget,
            unknown_usage_reserve_usd=unknown_reserve,
            model_pricing=chat_pricing,
            embedding_pricing=embedding_pricing,
            max_model_retries=_int(env, "MODEL_MAX_RETRIES", 3, minimum=0, maximum=5),
            worker_id=_env(env, "WORKER_ID"),
            log_level=(_env(env, "WORKER_LOG_LEVEL", "INFO") or "INFO").upper(),
            poll_interval_seconds=_float(env, "WORKER_POLL_INTERVAL_SECONDS", 5.0, minimum=0.2),
            heartbeat_interval_seconds=_float(env, "WORKER_HEARTBEAT_SECONDS", 30.0, minimum=1.0),
            lease_seconds=_int(env, "WORKER_LEASE_SECONDS", 120, minimum=30, maximum=600),
            shutdown_grace_seconds=_float(env, "WORKER_SHUTDOWN_GRACE_SECONDS", 30.0, minimum=1.0),
            freestyle_api_key=_env(env, "FREESTYLE_API_KEY"),
            freestyle_vm_id=_env(env, "FREESTYLE_VM_ID"),
            freestyle_base_url=_validate_url("FREESTYLE_API_BASE", _env(env, "FREESTYLE_API_BASE", "https://api.freestyle.sh") or "https://api.freestyle.sh"),
            idle_pause_seconds=_float(env, "WORKER_IDLE_PAUSE_SECONDS", 120.0, minimum=30.0),
            retrieval=retrieval,
            ingest=ingest,
            rules_version=_env(env, "CAREER_RULES_VERSION", RULES_VERSION) or RULES_VERSION,
            prompt_version=_env(env, "CAREER_PROMPT_VERSION", PROMPT_VERSION) or PROMPT_VERSION,
            docling_enabled=_bool(env, "DOCLING_ENABLED", True),
        )


def profile_fingerprint(config: Config) -> str:
    """embedding profile 指纹：模型+维度+归一化+模板版本，用于防止混用向量。"""

    raw = "|".join(
        [
            PROVIDER_NAME,
            config.embedding_model,
            str(config.embedding_dimensions),
            config.embedding_normalization,
            config.embedding_query_template_version,
            config.ingest.splitter_version,
        ]
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
