"""OpenRouter 模型调用：embedding + chat。

对上游的所有调用都必须：
- 使用配置里唯一的模型名，**绝不静默换模型或降级到本地模型**；
- 429 / 5xx / 超时最多重试 3 次（尊重 ``Retry-After`` 与指数退避）；
- 401 / 402 不重试，分别映射 ``model_auth_failed`` / ``model_quota_exceeded``；
- embedding 响应逐项校验（条数、index、维度、有限、非零），按 index 排序后 L2 归一化；
- token 未知时保持 ``None``（写库为 NULL，不写 0）。
"""

from __future__ import annotations

import json
import math
import random
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from email.utils import parsedate_to_datetime
from typing import Any, Callable, Sequence

import httpx

from ..budget import BudgetGuard
from ..config import PROVIDER_NAME, Config
from ..errors import (
    ModelAuthFailed,
    ModelOutputInvalid,
    ModelQuotaExceeded,
    ModelTimeout,
    ModelUnavailable,
    redact,
)
from ..logging_setup import get_logger, log_event
from ..models import ModelUsage

logger = get_logger("worker.openrouter")

SleepFn = Callable[[float], None]


# ---------------------------------------------------------------------------
# 输入构造（查询模板是版本化契约的一部分）
# ---------------------------------------------------------------------------


def build_query_embedding_input(config: Config, question: str) -> str:
    """查询输入：默认使用版本化 instruction 模板；文档片段不加 instruction。"""

    text = (question or "").strip()
    if config.embedding_instruction_mode == "provider_auto":
        # 若探针确认提供方会自动加 instruction，则只传原始问题，避免重复。
        return text
    return config.query_template().format(question=text)


def build_document_embedding_input(text: str) -> str:
    """文档片段不加 instruction，只做首尾空白归一化。"""

    return (text or "").strip()


def normalize_l2(vector: Sequence[float]) -> list[float]:
    norm = math.sqrt(sum(float(value) * float(value) for value in vector))
    if norm <= 1e-12 or not math.isfinite(norm):
        raise ModelOutputInvalid("embedding 向量为零向量或非有限值")
    return [float(value) / norm for value in vector]


def vector_literal(vector: Sequence[float]) -> str:
    """Postgres pgvector 文本形式：``[0.1,0.2,...]``（不经过 JSON 数字格式化）。"""

    if not vector:
        raise ModelOutputInvalid("空向量不能写入数据库")
    return "[" + ",".join(format(float(value), ".9g") for value in vector) + "]"


# ---------------------------------------------------------------------------
# 响应结构
# ---------------------------------------------------------------------------


@dataclass
class EmbeddingResponse:
    vectors: list[list[float]]
    usage: ModelUsage | None
    latency_ms: int
    model: str
    request_count: int


@dataclass
class ChatResponse:
    content: str
    usage: ModelUsage | None
    latency_ms: int
    model: str
    finish_reason: str | None = None
    json_mode_used: bool = False


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and item.get("type") in (None, "text"):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    return "" if content is None else str(content)


class OpenRouterClient:
    """同步 httpx 客户端；由 worker 单线程/单任务使用。"""

    def __init__(
        self,
        config: Config,
        *,
        budget: BudgetGuard | None = None,
        http_client: httpx.Client | None = None,
        sleep: SleepFn | None = None,
        logger_override=None,
    ) -> None:
        self.config = config
        self._budget = budget
        self._sleep = sleep or time.sleep
        self._logger = logger_override or logger
        self._client = http_client or httpx.Client(
            timeout=httpx.Timeout(config.model_request_timeout_seconds, connect=15.0),
            limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
        )
        self._owns_client = http_client is None
        self._json_mode_supported = config.chat_json_mode in ("auto", "on")
        self._json_mode_locked_off = config.chat_json_mode == "off"
        self._rng = random.Random(20261019)
        self._secrets = config.secret_values()

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    # ------------------------------------------------------------------
    # HTTP / 重试
    # ------------------------------------------------------------------
    def _url(self, path: str) -> str:
        return f"{self.config.openrouter_base_url.rstrip('/')}{path}"

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.config.openrouter_api_key}",
            "Content-Type": "application/json",
            "X-Title": "campus-pathway-worker",
        }

    def _retry_after_seconds(self, response: httpx.Response) -> float | None:
        raw = response.headers.get("retry-after")
        if not raw:
            return None
        try:
            return max(0.0, min(60.0, float(raw)))
        except ValueError:
            pass
        try:
            when = parsedate_to_datetime(raw)
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
            return max(0.0, min(60.0, (when - datetime.now(timezone.utc)).total_seconds()))
        except (TypeError, ValueError):
            return None

    def _backoff_seconds(self, attempt: int, retry_after: float | None) -> float:
        if retry_after is not None:
            return retry_after
        # attempt 从 0 开始：0.5s, 1s, 2s … 加小抖动，避免同时重试。
        return min(30.0, 0.5 * (2 ** attempt)) + self._rng.uniform(0.0, 0.25)

    def _error_from_response(self, response: httpx.Response, *, operation: str) -> Exception:
        status = response.status_code
        message = ""
        try:
            payload = response.json()
            if isinstance(payload, dict):
                error = payload.get("error")
                if isinstance(error, dict):
                    message = str(error.get("message") or error.get("type") or "")
                message = message or str(payload.get("message") or "")
        except (json.JSONDecodeError, ValueError):
            message = response.text[:200]
        safe = redact(message, self._secrets, limit=240)
        if status in (401, 403):
            return ModelAuthFailed(f"模型鉴权失败（HTTP {status}）", detail=operation)
        if status == 402:
            return ModelQuotaExceeded("模型账户余额/配额不足（HTTP 402）", detail=operation)
        if status == 408:
            return ModelTimeout("模型请求超时（HTTP 408）", detail=operation)
        if status == 429:
            return ModelUnavailable("模型服务限流（HTTP 429）", detail=operation)
        if status >= 500:
            return ModelUnavailable(f"模型服务暂时不可用（HTTP {status}）", detail=operation)
        if status == 400 and ("response_format" in safe.lower() or "json" in safe.lower()):
            return ModelUnavailable(f"上游不支持当前请求格式：{safe}", detail="response_format_unsupported")
        return ModelUnavailable(f"模型请求被拒绝（HTTP {status}）：{safe}", detail=operation)

    def _post_json(
        self,
        path: str,
        body: dict[str, Any],
        *,
        operation: str,
        estimated_cost: Decimal | None,
        allow_response_format_retry: bool = False,
    ) -> tuple[dict[str, Any], int]:
        max_attempts = 1 + int(self.config.max_model_retries)
        last_error: Exception | None = None
        attempt = 0
        while attempt < max_attempts:
            if self._budget is not None:
                # 未配置预算时这里会 fail closed（budget_exceeded）。
                self._budget.assert_can_spend(estimated_cost, operation=operation)
            started = time.monotonic()
            try:
                response = self._client.post(self._url(path), json=body, headers=self._headers())
            except httpx.TimeoutException as exc:
                last_error = ModelTimeout("模型请求超时", detail=operation)
                latency_ms = int((time.monotonic() - started) * 1000)
                log_event(
                    self._logger,
                    "model_timeout",
                    level=30,
                    model=body.get("model"),
                    operation=operation,
                    duration_ms=latency_ms,
                    attempt=attempt + 1,
                )
                if attempt >= max_attempts - 1:
                    raise last_error from exc
                self._sleep(self._backoff_seconds(attempt, None))
                attempt += 1
                continue
            except httpx.HTTPError as exc:
                last_error = ModelUnavailable("模型网络错误", detail=operation)
                if attempt >= max_attempts - 1:
                    raise last_error from exc
                self._sleep(self._backoff_seconds(attempt, None))
                attempt += 1
                continue

            if response.status_code == 400 and allow_response_format_retry and "response_format" in body:
                # 供应商可能不支持 json_object：关闭后立即重试一次，不占用 429/5xx 的重试预算。
                error = self._error_from_response(response, operation="response_format_probe")
                log_event(
                    self._logger,
                    "response_format_unsupported",
                    level=30,
                    model=body.get("model"),
                    operation=operation,
                    status=response.status_code,
                )
                self._json_mode_supported = False
                retry_body = dict(body)
                retry_body.pop("response_format", None)
                response = self._client.post(self._url(path), json=retry_body, headers=self._headers())
                if response.status_code >= 400:
                    raise self._error_from_response(response, operation=operation) from error
                try:
                    payload = response.json()
                except ValueError as exc:
                    raise ModelOutputInvalid("模型返回非 JSON") from exc
                return payload, int((time.monotonic() - started) * 1000)

            if response.status_code >= 400:
                error = self._error_from_response(response, operation=operation)
                retryable = isinstance(error, (ModelTimeout, ModelUnavailable))
                log_event(
                    self._logger,
                    "model_request_failed",
                    level=30 if retryable else 40,
                    model=body.get("model"),
                    operation=operation,
                    status=response.status_code,
                    error_code=getattr(error, "code", "model_unavailable"),
                    attempt=attempt + 1,
                )
                if not retryable or attempt >= max_attempts - 1:
                    raise error
                delay = self._backoff_seconds(attempt, self._retry_after_seconds(response))
                self._sleep(delay)
                attempt += 1
                continue

            try:
                payload = response.json()
            except ValueError as exc:
                raise ModelOutputInvalid("模型返回非 JSON 响应") from exc
            return payload, int((time.monotonic() - started) * 1000)

        raise last_error or ModelUnavailable("模型调用失败", detail=operation)

    # ------------------------------------------------------------------
    # Embedding
    # ------------------------------------------------------------------
    def embed_texts(
        self,
        texts: Sequence[str],
        *,
        operation: str = "embedding",
    ) -> EmbeddingResponse:
        """按配置批量（默认 16）调用 /embeddings，返回已排序、L2 归一化的向量。"""

        if not texts:
            return EmbeddingResponse(vectors=[], usage=None, latency_ms=0, model=self.config.embedding_model, request_count=0)
        batch_size = max(1, min(16, int(self.config.embedding_batch_size)))
        vectors: list[list[float]] = []
        usage_total: ModelUsage | None = None
        total_latency = 0
        request_count = 0
        for start in range(0, len(texts), batch_size):
            batch = [build_document_embedding_input(text) for text in texts[start : start + batch_size]]
            if any(not item for item in batch):
                raise ModelOutputInvalid("embedding 输入包含空文本")
            estimated_tokens = sum(max(1, len(item) // 2) for item in batch)
            estimated_cost = self.config.embedding_pricing.estimate(input_tokens=estimated_tokens)
            body: dict[str, Any] = {
                "model": self.config.embedding_model,
                "input": batch,
                "encoding_format": "float",
            }
            payload, latency_ms = self._post_json(
                "/embeddings",
                body,
                operation=operation,
                estimated_cost=estimated_cost,
            )
            total_latency += latency_ms
            request_count += 1
            parsed, usage = self._parse_embedding_response(payload, expected=len(batch))
            vectors.extend(parsed)
            if usage is not None:
                usage_total = usage if usage_total is None else _merge_usage(usage_total, usage, model=self.config.embedding_model, operation=operation)
        return EmbeddingResponse(
            vectors=vectors,
            usage=usage_total,
            latency_ms=total_latency,
            model=self.config.embedding_model,
            request_count=request_count,
        )

    def _parse_embedding_response(self, payload: dict[str, Any], *, expected: int) -> tuple[list[list[float]], ModelUsage | None]:
        data = payload.get("data")
        if not isinstance(data, list):
            raise ModelOutputInvalid("embedding 响应缺少 data 数组")
        if len(data) != expected:
            raise ModelOutputInvalid(f"embedding 条数不符：期望 {expected}，实际 {len(data)}")
        dimensions = int(self.config.embedding_dimensions)
        indexed: dict[int, list[float]] = {}
        for item in data:
            if not isinstance(item, dict):
                raise ModelOutputInvalid("embedding 响应项不是对象")
            index = item.get("index")
            if not isinstance(index, int) or index < 0 or index >= expected:
                raise ModelOutputInvalid("embedding 响应的 index 非法")
            if index in indexed:
                raise ModelOutputInvalid("embedding 响应的 index 重复")
            raw_vector = item.get("embedding")
            if not isinstance(raw_vector, list):
                raise ModelOutputInvalid("embedding 向量不是数组")
            if len(raw_vector) != dimensions:
                raise ModelOutputInvalid(f"embedding 维度不符：期望 {dimensions}，实际 {len(raw_vector)}")
            values: list[float] = []
            for value in raw_vector:
                if not isinstance(value, (int, float)) or isinstance(value, bool):
                    raise ModelOutputInvalid("embedding 含非数值元素")
                number = float(value)
                if not math.isfinite(number):
                    raise ModelOutputInvalid("embedding 含 NaN/Inf")
                values.append(number)
            indexed[index] = normalize_l2(values)
        if set(indexed) != set(range(expected)):
            raise ModelOutputInvalid("embedding 响应的 index 集合与输入不一致")

        usage_info = payload.get("usage") or {}
        input_tokens: int | None = None
        if isinstance(usage_info, dict):
            raw_tokens = usage_info.get("prompt_tokens", usage_info.get("total_tokens"))
            if isinstance(raw_tokens, int) and not isinstance(raw_tokens, bool) and raw_tokens >= 0:
                input_tokens = raw_tokens
        estimated_cost = self.config.embedding_pricing.estimate(input_tokens=input_tokens) if input_tokens is not None else None
        usage = ModelUsage(
            provider=PROVIDER_NAME,
            model=self.config.embedding_model,
            operation="embedding",
            input_tokens=input_tokens,
            output_tokens=None,
            latency_ms=0,
            estimated_cost=estimated_cost,
            pricing_snapshot_at=datetime.now(timezone.utc) if estimated_cost is not None else None,
        )
        return [indexed[index] for index in range(expected)], usage

    # ------------------------------------------------------------------
    # Chat
    # ------------------------------------------------------------------
    def chat(
        self,
        messages: Sequence[dict[str, str]],
        *,
        operation: str,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> ChatResponse:
        body: dict[str, Any] = {
            "model": self.config.chat_model,
            "messages": list(messages),
            "temperature": self.config.chat_temperature if temperature is None else temperature,
            "max_tokens": self.config.chat_max_tokens if max_tokens is None else max_tokens,
        }
        json_mode = (not self._json_mode_locked_off) and self._json_mode_supported
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        input_chars = sum(len(message.get("content", "")) for message in messages)
        estimated_cost = self.config.model_pricing.estimate(
            input_tokens=max(1, input_chars // 2),
            output_tokens=int(body["max_tokens"]),
        )
        payload, latency_ms = self._post_json(
            "/chat/completions",
            body,
            operation=operation,
            estimated_cost=estimated_cost,
            allow_response_format_retry=(json_mode and self.config.chat_json_mode == "auto"),
        )
        return self._parse_chat_response(payload, operation=operation, latency_ms=latency_ms, json_mode=json_mode)

    def _parse_chat_response(
        self,
        payload: dict[str, Any],
        *,
        operation: str,
        latency_ms: int,
        json_mode: bool,
    ) -> ChatResponse:
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices:
            raise ModelOutputInvalid("chat 响应缺少 choices")
        first = choices[0]
        if not isinstance(first, dict):
            raise ModelOutputInvalid("chat 响应 choice 结构异常")
        message = first.get("message")
        if not isinstance(message, dict):
            raise ModelOutputInvalid("chat 响应缺少 message")
        content = _content_to_text(message.get("content")).strip()
        if not content:
            raise ModelOutputInvalid("模型返回了空内容")
        usage_info = payload.get("usage") or {}
        input_tokens: int | None = None
        output_tokens: int | None = None
        if isinstance(usage_info, dict):
            raw_in = usage_info.get("prompt_tokens")
            raw_out = usage_info.get("completion_tokens")
            if isinstance(raw_in, int) and not isinstance(raw_in, bool) and raw_in >= 0:
                input_tokens = raw_in
            if isinstance(raw_out, int) and not isinstance(raw_out, bool) and raw_out >= 0:
                output_tokens = raw_out
        estimated_cost = self.config.model_pricing.estimate(input_tokens=input_tokens, output_tokens=output_tokens) if (
            input_tokens is not None or output_tokens is not None
        ) else None
        usage = ModelUsage(
            provider=PROVIDER_NAME,
            model=self.config.chat_model,
            operation=operation,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=latency_ms,
            estimated_cost=estimated_cost,
            pricing_snapshot_at=datetime.now(timezone.utc) if estimated_cost is not None else None,
        )
        finish_reason = first.get("finish_reason")
        return ChatResponse(
            content=content,
            usage=usage,
            latency_ms=latency_ms,
            model=self.config.chat_model,
            finish_reason=str(finish_reason) if finish_reason is not None else None,
            json_mode_used=json_mode,
        )


def _merge_usage(first: ModelUsage, second: ModelUsage, *, model: str, operation: str) -> ModelUsage:
    def _add(left: int | None, right: int | None) -> int | None:
        if left is None and right is None:
            return None
        # 任意一批 token 未知时，总数也只能是未知（不把未知当 0）。
        if left is None or right is None:
            return None
        return left + right

    cost: Decimal | None = None
    if first.estimated_cost is not None and second.estimated_cost is not None:
        cost = first.estimated_cost + second.estimated_cost
    return ModelUsage(
        provider=PROVIDER_NAME,
        model=model,
        operation=operation,
        input_tokens=_add(first.input_tokens, second.input_tokens),
        output_tokens=_add(first.output_tokens, second.output_tokens),
        latency_ms=first.latency_ms + second.latency_ms,
        estimated_cost=cost,
        pricing_snapshot_at=second.pricing_snapshot_at,
    )


def embed_query(config: Config, client: OpenRouterClient, question: str) -> tuple[list[float], ModelUsage | None]:
    """查询 embedding（带版本化 instruction），供检索层使用。"""

    response = client.embed_texts([build_query_embedding_input(config, question)], operation="embedding_query")
    if len(response.vectors) != 1:
        raise ModelOutputInvalid("查询 embedding 返回条数异常")
    return response.vectors[0], response.usage
