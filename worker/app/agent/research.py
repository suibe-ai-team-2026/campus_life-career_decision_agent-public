"""有界网页调研（bounded web research）。

用 DeepSeek 的 function calling 跑一个受限循环：模型规划检索 → 调 ``web_search`` /
``web_fetch`` → 观察结果 → 再规划，直到调用 ``finish_research`` 或触达上限。
每一步都通过 ``ctx.trace`` 写前端可见的轨迹事件。

设计约束（与产品边界一致）：
- 只做“找证据”，不在这里回答用户问题；最终答案仍由 ask/plan 图的解释步骤生成；
- web_fetch 的 url 必须来自 web_search 返回结果，防止模型编造 URL；
- 结果统一转成 Citation（``verification_status=web_unverified``、``source_scope=实时网页``），
  复用现有引用校验与前端引用卡；
- 有硬上限：步数 / 搜索数 / 抓取数 / 总时长，超限就带着已找到的证据结束。
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

from ..config import Config
from ..errors import ModelUnavailable
from ..models import Citation
from ..providers.deepseek_search import DeepSeekSearchClient, SearchBudget, WebPage, WebSearchHit
from ..providers.openrouter import OpenRouterClient, ToolCall
from ._prompt import RESEARCH_SYSTEM_PROMPT, tool_specs


@dataclass
class WebSource:
    url: str
    title: str
    site_name: str | None = None
    published_at: str | None = None
    fetched_at: str | None = None
    kind: str = "search"
    snippet: str = ""
    summary: str = ""
    content: str = ""
    authority: int | None = None
    rerank_score: float | None = None


@dataclass
class WebResearchResult:
    sources: list[WebSource] = field(default_factory=list)
    citations: list[Citation] = field(default_factory=list)
    evidence: list[dict[str, Any]] = field(default_factory=list)
    search_calls: int = 0
    fetch_calls: int = 0
    steps: int = 0
    note: str = ""


def _host(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def _excerpt(source: WebSource) -> str:
    text = source.content or source.summary or source.snippet or ""
    return text.strip()[:600]


def _to_citation(source: WebSource, citation_no: int) -> Citation:
    url = source.url
    return Citation(
        citation_no=citation_no,
        source_id=f"web:{_host(url)}",
        source_version_id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"{url}#version")),
        chunk_id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"{url}#chunk")),
        title=source.title or url,
        locator={
            "url": url,
            "site_name": source.site_name,
            "published_at": source.published_at,
            "fetched_at": source.fetched_at,
            "source": source.kind,
        },
        excerpt=_excerpt(source),
        verification_status="web_unverified",
        source_scope="实时网页",
    )


def _to_evidence(source: WebSource, citation_no: int) -> dict[str, Any]:
    return {
        "citation_no": citation_no,
        "source_id": f"web:{_host(source.url)}",
        "source_type": "web",
        "verification_status": "web_unverified",
        "source_scope": "实时网页",
        "title": source.title or source.url,
        "text": (source.content or source.summary or source.snippet or "").strip()[:12000],
        "context": source.snippet or "",
        "locator": {
            "url": source.url,
            "site_name": source.site_name,
            "published_at": source.published_at,
            "fetched_at": source.fetched_at,
            "source": source.kind,
        },
        "heading_path": "",
        "canonical_url": source.url,
        "neighbors": [],
    }


def _hit_payload(hit: WebSearchHit) -> dict[str, Any]:
    return {
        "title": hit.title,
        "url": hit.url,
        "site_name": hit.site_name,
        "published_at": hit.published_at,
        "snippet": hit.snippet[:300],
        "authority": hit.authority,
        "rerank_score": hit.rerank_score,
    }


def run_web_research(
    ctx: Any,
    *,
    question: str,
    site_hint: str | None = None,
    numbering_start: int = 1,
) -> WebResearchResult:
    """执行一次有界网页调研；返回编号从 ``numbering_start`` 起的引用/证据。"""

    config: Config = ctx.config
    provider: OpenRouterClient = ctx.provider
    result = WebResearchResult()
    if not config.web_search_enabled:
        result.note = "联网搜索未启用"
        return result

    budget = SearchBudget(
        max_searches=config.web_search_max_searches,
        max_fetches=config.web_search_max_fetches,
        max_steps=config.web_search_max_steps,
        deadline_seconds=config.web_search_deadline_seconds,
    )
    client = DeepSeekSearchClient(config)
    try:
        sources: dict[str, WebSource] = {}
        order: list[str] = []

        def add_hit(hit: WebSearchHit) -> None:
            if hit.url in sources:
                return
            source = WebSource(
                url=hit.url,
                title=hit.title,
                site_name=hit.site_name,
                published_at=hit.published_at,
                fetched_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                kind="search",
                snippet=hit.snippet,
                summary=hit.summary,
                authority=hit.authority,
                rerank_score=hit.rerank_score,
            )
            sources[hit.url] = source
            order.append(hit.url)

        ctx.trace("agent_step", {"step": 1, "label": "拆解问题并规划检索", "thought": "优先检索官方来源（edu.cn / gov.cn / 学校官网 / 招聘官网）"})

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": RESEARCH_SYSTEM_PROMPT},
            {"role": "user", "content": f"【调研问题】\n{question}" + (f"\n【优先站点】\n{site_hint}" if site_hint else "")},
        ]

        while budget.can_step():
            budget.steps += 1
            try:
                response = provider.chat_with_tools(messages, tool_specs(), operation="chat_research_plan", max_tokens=800)
            except ModelUnavailable as exc:
                ctx.trace("agent_note", {"text": f"调研规划模型暂不可用：{getattr(exc, 'detail', '') or 'model_unavailable'}"})
                break
            ctx.record_usage(response.usage)
            if not response.tool_calls:
                ctx.trace("agent_note", {"text": "模型未请求更多工具，结束调研"})
                break

            tool_messages: list[dict[str, Any]] = []
            for call in response.tool_calls:
                ctx.trace("tool_call", {"step": budget.steps, "tool": call.name, "input": call.arguments})
                tool_messages.append(
                    {
                        "role": "assistant",
                        "tool_calls": [{"id": call.id, "type": "function", "function": {"name": call.name, "arguments": call.raw_arguments or "{}"}}],
                    }
                )
                outcome = _execute_tool(ctx, client, budget, call, sources, order)
                tool_messages.append({"role": "tool", "tool_call_id": call.id, "content": outcome["content"]})
                if outcome.get("finish"):
                    break

            messages.extend(tool_messages)
            if any(msg.get("role") == "tool" for msg in tool_messages) and not any(msg.get("role") == "tool" and msg.get("content", "").startswith('{"finish":true') for msg in tool_messages):
                pass
            # 若本步触发了 finish 或已达上限，结束循环
            if _finished_this_step(tool_messages) or not budget.can_step():
                break

        result.search_calls = budget.searches
        result.fetch_calls = budget.fetches
        result.steps = budget.steps
        result.sources = [sources[url] for url in order]

        for index, source in enumerate(result.sources):
            citation_no = numbering_start + index
            result.citations.append(_to_citation(source, citation_no))
            result.evidence.append(_to_evidence(source, citation_no))

        if result.sources:
            result.note = (
                f"本次回答引用了 {len(result.sources)} 条实时网页（未核验），"
                f"检索时间 {time.strftime('%Y-%m-%dT%H:%MZ', time.gmtime())}；网页内容可能已经变化。"
            )
        else:
            result.note = "未找到可用的实时网页证据。"
        return result
    finally:
        client.close()


def _finished_this_step(tool_messages: list[dict[str, Any]]) -> bool:
    for msg in tool_messages:
        if msg.get("role") == "tool" and str(msg.get("content", "")).startswith('{"finish":true'):
            return True
    return False


def _execute_tool(
    ctx: Any,
    client: DeepSeekSearchClient,
    budget: SearchBudget,
    call: ToolCall,
    sources: dict[str, WebSource],
    order: list[str],
) -> dict[str, Any]:
    """执行一次工具调用并写轨迹事件；返回给模型的 tool 消息内容。"""

    name = call.name
    started = time.monotonic()

    if name == "finish_research":
        reason = str(call.arguments.get("reason") or "").strip()[:200]
        ctx.trace("tool_result", {"step": budget.steps, "tool": "finish_research", "ok": True, "ms": 0, "summary": reason})
        return {"content": '{"finish":true,"reason":' + __import__("json").dumps(reason, ensure_ascii=False) + "}", "finish": True}

    if name == "web_search":
        if not budget.can_search():
            ctx.trace("tool_result", {"step": budget.steps, "tool": "web_search", "ok": False, "error": "已达搜索次数上限"})
            return {"content": '{"error":"search limit reached"}'}
        budget.searches += 1
        query = str(call.arguments.get("query") or "").strip()
        site = str(call.arguments.get("site") or "").strip() or None
        if not query:
            ctx.trace("tool_result", {"step": budget.steps, "tool": "web_search", "ok": False, "error": "query 为空"})
            return {"content": '{"error":"empty query"}'}
        try:
            hits = client.search(query, count=8, site=site)
        except Exception as exc:  # noqa: BLE001
            ctx.trace("tool_result", {"step": budget.steps, "tool": "web_search", "ok": False, "error": str(exc)[:200]})
            return {"content": '{"error":"search failed"}'}
        for hit in hits:
            if hit.url not in sources:
                sources[hit.url] = WebSource(
                    url=hit.url, title=hit.title, site_name=hit.site_name, published_at=hit.published_at,
                    fetched_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), kind="search",
                    snippet=hit.snippet, summary=hit.summary, authority=hit.authority, rerank_score=hit.rerank_score,
                )
                order.append(hit.url)
        ms = int((time.monotonic() - started) * 1000)
        ctx.trace(
            "tool_result",
            {"step": budget.steps, "tool": "web_search", "ok": True, "ms": ms, "count": len(hits), "results": [_hit_payload(h) for h in hits]},
        )
        content_rows = [{"title": h.title, "url": h.url, "snippet": h.snippet[:200]} for h in hits]
        return {"content": __import__("json").dumps(content_rows, ensure_ascii=False)[:4000]}

    if name == "web_fetch":
        if not budget.can_fetch():
            ctx.trace("tool_result", {"step": budget.steps, "tool": "web_fetch", "ok": False, "error": "已达抓取次数上限"})
            return {"content": '{"error":"fetch limit reached"}'}
        budget.fetches += 1
        url = str(call.arguments.get("url") or "").strip()
        if not url:
            ctx.trace("tool_result", {"step": budget.steps, "tool": "web_fetch", "ok": False, "error": "url 为空"})
            return {"content": '{"error":"empty url"}'}
        if url not in sources:
            ctx.trace("tool_result", {"step": budget.steps, "tool": "web_fetch", "ok": False, "error": "url 必须来自 web_search 结果"})
            return {"content": '{"error":"url must come from search results"}'}
        try:
            page: WebPage = client.fetch(url)
        except Exception as exc:  # noqa: BLE001
            ctx.trace("tool_result", {"step": budget.steps, "tool": "web_fetch", "ok": False, "error": str(exc)[:200]})
            return {"content": '{"error":"fetch failed"}'}
        content = page.content[:12000]
        source = sources[url]
        source.content = content
        source.title = page.title or source.title
        source.kind = "fetch"
        source.fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        ms = int((time.monotonic() - started) * 1000)
        ctx.trace(
            "tool_result",
            {"step": budget.steps, "tool": "web_fetch", "ok": True, "ms": ms, "page": {"title": page.title, "url": url, "chars": len(content), "excerpt": content[:600]}},
        )
        return {"content": content[:4000]}

    ctx.trace("tool_result", {"step": budget.steps, "tool": name, "ok": False, "error": "未知工具"})
    return {"content": '{"error":"unknown tool"}'}
