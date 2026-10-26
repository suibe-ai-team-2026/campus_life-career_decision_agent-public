"""DeepSeek Search / Fetch API 客户端。

只做读操作：`POST /v1/tools/search` 按 query 搜网页，`POST /v1/tools/fetch`
抓取单个网页返回 Markdown。计费按成功请求次数（见 docs），不在这里记账，
但遵守 429/5xx 退避与 402 直接失败。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Sequence
from urllib.parse import urlparse

import httpx

from ..config import Config
from ..errors import ModelQuotaExceeded, ModelTimeout, ModelUnavailable, redact
from ..logging_setup import get_logger, log_event

logger = get_logger("worker.deepseek_search")


@dataclass
class WebSearchHit:
    title: str
    url: str
    site_name: str | None = None
    published_at: str | None = None
    snippet: str = ""
    summary: str = ""
    authority: int | None = None
    rerank_score: float | None = None


@dataclass
class WebPage:
    title: str
    url: str
    content: str


@dataclass
class SearchBudget:
    """一次 research 的上限，由 run 配置 + 运行时计数共同约束。"""

    max_searches: int = 4
    max_fetches: int = 3
    max_steps: int = 6
    deadline_seconds: float = 75.0
    searches: int = 0
    fetches: int = 0
    steps: int = 0
    started_at: float = field(default_factory=time.monotonic)

    def can_search(self) -> bool:
        return self.searches < self.max_searches and not self.expired()

    def can_fetch(self) -> bool:
        return self.fetches < self.max_fetches and not self.expired()

    def can_step(self) -> bool:
        return self.steps < self.max_steps and not self.expired()

    def expired(self) -> bool:
        return time.monotonic() - self.started_at > self.deadline_seconds


_PRIVATE_HOST_MARKERS = ("localhost", "127.", "10.", "192.168.", "169.254.", "0.0.0.0", "::1", "[::1]")


def _is_public_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False
    if not parsed.hostname:
        return False
    if parsed.username or parsed.password:
        return False
    host = parsed.hostname.lower()
    return not any(host == marker.rstrip(".") or host.startswith(marker) for marker in _PRIVATE_HOST_MARKERS)


class DeepSeekSearchClient:
    """同步客户端；worker 单线程使用。"""

    def __init__(self, config: Config, *, http_client: httpx.Client | None = None):
        self.config = config
        self._base = config.web_search_base_url.rstrip("/")
        self._key = config.chat_api_key
        self._secrets = config.secret_values()
        self._client = http_client or httpx.Client(
            timeout=httpx.Timeout(20.0, connect=8.0),
            limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
        )
        self._owns = http_client is None

    def close(self) -> None:
        if self._owns:
            self._client.close()

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._key}", "Content-Type": "application/json", "Accept": "application/json"}

    def _post(self, path: str, body: dict[str, Any], *, operation: str) -> dict[str, Any]:
        max_attempts = 1 + int(self.config.max_model_retries)
        last_error: Exception | None = None
        for attempt in range(max_attempts):
            started = time.monotonic()
            try:
                response = self._client.post(f"{self._base}{path}", json=body, headers=self._headers())
            except httpx.TimeoutException as exc:
                last_error = ModelTimeout("网页请求超时", detail=operation)
                log_event(logger, "web_request_timeout", level=30, operation=operation, attempt=attempt + 1)
                if attempt >= max_attempts - 1:
                    raise last_error from exc
                time.sleep(min(2.0, 0.5 * (2**attempt)))
                continue
            except httpx.HTTPError as exc:
                last_error = ModelUnavailable("网页请求网络错误", detail=operation)
                if attempt >= max_attempts - 1:
                    raise last_error from exc
                time.sleep(min(2.0, 0.5 * (2**attempt)))
                continue
            if response.status_code == 402:
                raise ModelQuotaExceeded("DeepSeek 账户余额/配额不足（HTTP 402）", detail=operation)
            if response.status_code in (401, 403):
                raise ModelUnavailable("网页搜索鉴权失败", detail=operation)
            if response.status_code == 429:
                last_error = ModelUnavailable("网页搜索限流（HTTP 429）", detail=operation)
                retry_after = response.headers.get("retry-after")
                delay = min(5.0, float(retry_after) if retry_after and retry_after.isdigit() else 1.0)
                if attempt >= max_attempts - 1:
                    raise last_error
                time.sleep(delay)
                continue
            if response.status_code >= 500:
                last_error = ModelUnavailable(f"网页搜索服务暂时不可用（HTTP {response.status_code}）", detail=operation)
                if attempt >= max_attempts - 1:
                    raise last_error
                time.sleep(min(2.0, 0.5 * (2**attempt)))
                continue
            if response.status_code >= 400:
                safe = redact(response.text[:200], self._secrets, limit=200)
                raise ModelUnavailable(f"网页搜索请求被拒绝（HTTP {response.status_code}）：{safe}", detail=operation)
            try:
                return response.json()
            except ValueError as exc:
                raise ModelUnavailable("网页搜索返回了非 JSON", detail=operation) from exc
        raise last_error or ModelUnavailable("网页请求失败", detail=operation)

    def search(self, query: str, *, count: int = 8, site: str | None = None, ori_question: str | None = None) -> list[WebSearchHit]:
        if not query.strip():
            return []
        q = query.strip()[:128]
        if site:
            q = f"site:{site} {q}"[:128]
        body: dict[str, Any] = {"query": q, "count": max(1, min(50, int(count)))}
        if ori_question:
            body["ori_question"] = ori_question.strip()[:128]
        payload = self._post("/v1/tools/search", body, operation="web_search")
        results = payload.get("results") if isinstance(payload, dict) else None
        hits: list[WebSearchHit] = []
        if isinstance(results, list):
            for row in results:
                if not isinstance(row, dict):
                    continue
                url = str(row.get("url") or "").strip()
                if not _is_public_url(url):
                    continue
                hits.append(
                    WebSearchHit(
                        title=str(row.get("title") or url).strip(),
                        url=url,
                        site_name=str(row.get("site_name") or "") or None,
                        published_at=str(row.get("date") or "") or None,
                        snippet=str(row.get("snippet") or "").strip(),
                        summary=str(row.get("summary") or "").strip(),
                        authority=row.get("authority") if isinstance(row.get("authority"), int) else None,
                        rerank_score=row.get("rerank_score") if isinstance(row.get("rerank_score"), (int, float)) else None,
                    )
                )
        return hits

    def fetch(self, url: str) -> WebPage:
        if not _is_public_url(url):
            raise ModelUnavailable("目标 URL 不合法或不是公网地址", detail="web_fetch")
        payload = self._post("/v1/tools/fetch", {"url": url[:8192]}, operation="web_fetch")
        title = str(payload.get("title") or url).strip() if isinstance(payload, dict) else url
        content = str(payload.get("content") or "").strip() if isinstance(payload, dict) else ""
        return WebPage(title=title, url=url, content=content)
