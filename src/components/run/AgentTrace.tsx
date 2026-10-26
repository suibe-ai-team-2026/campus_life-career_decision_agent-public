"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  formatToolCall,
  type AgentStepPayload,
  type ToolCallPayload,
  type ToolResultPayload,
  type TraceEvent,
  type ValidationPayload,
  type WebPagePreview,
  type WebSearchHit
} from "@/lib/agent-trace";
import { RUN_STAGE_LABELS, safeExternalUrl } from "@/lib/api-client";
import { Icon, formatDate } from "@/components/ui/primitives";

export type AgentTraceProps = {
  /** Sorted trace events (see toTraceEvents in src/lib/agent-trace.ts). */
  events: TraceEvent[];
  /** True while the run is still streaming; switches the title to 实时执行轨迹. */
  running?: boolean;
  /** Raw run status (queued/running/succeeded/...), used for the finished badge. */
  status?: string | null;
  /** Override for the default 实时执行轨迹 / 执行轨迹 title. */
  title?: string;
  /** Copy shown when there are no events yet. */
  emptyHint?: string;
  autoScroll?: boolean;
  className?: string;
};

function stageLabel(type: string): string {
  return RUN_STAGE_LABELS[type] ?? type;
}

function formatMs(ms: number | undefined): string | null {
  if (ms === undefined) return null;
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`;
  } catch {
    return "";
  }
}

function clampText(text: string, lines: number, clampAt: number) {
  const collapsible = text.length > clampAt || text.split("\n").length > lines;
  return collapsible;
}

/** Clamped paragraph with an explicit 展开/收起 control (no layout measurement). */
function ClampText({
  text,
  lines = 3,
  clampAt = 140,
  className
}: {
  text: string;
  lines?: number;
  clampAt?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const collapsible = clampText(text, lines, clampAt);
  const clampStyle = collapsible && !expanded ? ({ "--trace-clamp": String(lines) } as CSSProperties) : undefined;
  return (
    <div className={className ? `trace-clamp ${className}` : "trace-clamp"}>
      <p id={id} className={collapsible && !expanded ? "trace-clamp-text is-clamped" : "trace-clamp-text"} style={clampStyle}>
        {text}
      </p>
      {collapsible ? (
        <button
          type="button"
          className="trace-expand"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : "展开全文"}
          <Icon name={expanded ? "minus" : "plus"} size={12} />
        </button>
      ) : null}
    </div>
  );
}

function LiveUnverifiedTag() {
  return <span className="trace-unverified-tag">实时网页 · 未核验</span>;
}

function CardHead({
  icon,
  tool,
  meta,
  tone = "default",
  extra
}: {
  icon: "globe" | "book" | "database" | "alert" | "activity";
  tool: string;
  meta?: string | null;
  tone?: "default" | "live" | "error";
  extra?: ReactNode;
}) {
  return (
    <div className="trace-card-head">
      <span className={tone === "error" ? "trace-badge is-error" : tone === "live" ? "trace-badge is-live" : "trace-badge"}>
        <Icon name={icon} size={11} />
        {tool}
      </span>
      {meta ? <span className="trace-card-meta">{meta}</span> : null}
      {extra}
    </div>
  );
}

function SearchHitItem({ hit }: { hit: WebSearchHit }) {
  const href = safeExternalUrl(hit.url);
  const domain = domainOf(hit.url);
  return (
    <article className="trace-hit">
      <div className="trace-hit-title-row">
        {href ? (
          <a className="trace-hit-title" href={href} target="_blank" rel="noopener noreferrer" title={hit.url}>
            {hit.title}
            <Icon name="external" size={11} />
          </a>
        ) : (
          <span className="trace-hit-title">{hit.title}</span>
        )}
      </div>
      <p className="trace-hit-meta">
        <span className="trace-domain">{domain}</span>
        {hit.site_name && hit.site_name !== domain ? <span>{hit.site_name}</span> : null}
        {hit.published_at ? <span>{formatDate(hit.published_at)}</span> : null}
        {hit.authority !== null ? <span>权威度 {hit.authority}</span> : null}
        {hit.rerank_score !== null ? <span>排序分 {hit.rerank_score}</span> : null}
      </p>
      {hit.snippet ? <p className="trace-hit-snippet">{hit.snippet}</p> : null}
    </article>
  );
}

function WebSearchResult({ payload }: { payload: ToolResultPayload }) {
  const [expanded, setExpanded] = useState(false);
  const results = payload.results ?? [];
  const count = payload.count ?? results.length;
  const shown = expanded ? results : results.slice(0, 3);
  const ms = formatMs(payload.ms);
  return (
    <div className="trace-card trace-web-card">
      <CardHead
        icon="globe"
        tool="web_search"
        meta={[`${formatNumber(count)} 条结果`, ms, payload.summary].filter(Boolean).join(" · ") || null}
        tone="live"
        extra={<LiveUnverifiedTag />}
      />
      {shown.length > 0 ? (
        <div className="trace-hit-list">
          {shown.map((hit) => (
            <SearchHitItem key={`${hit.url}-${hit.title}`} hit={hit} />
          ))}
        </div>
      ) : (
        <p className="trace-card-empty">
          {count > 0 ? `检索到 ${formatNumber(count)} 条网页结果，但没有返回可展示的摘要。` : "本次检索没有返回网页结果。"}
        </p>
      )}
      {results.length > 3 ? (
        <button type="button" className="trace-expand" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起结果" : `显示全部 ${results.length} 条`}
          <Icon name={expanded ? "minus" : "plus"} size={12} />
        </button>
      ) : null}
    </div>
  );
}

function WebFetchResult({ payload }: { payload: ToolResultPayload }) {
  const page: WebPagePreview | undefined = payload.page;
  if (!page) return <GenericResult payload={payload} />;
  const href = safeExternalUrl(page.url);
  const ms = formatMs(payload.ms);
  return (
    <div className="trace-card trace-page-card">
      <CardHead
        icon="book"
        tool="web_fetch"
        meta={[page.chars > 0 ? `已读 ${formatNumber(page.chars)} 字` : "已读取页面", ms].filter(Boolean).join(" · ") || null}
        tone="live"
        extra={<LiveUnverifiedTag />}
      />
      <p className="trace-page-title">{page.title}</p>
      <p className="trace-page-url">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" title={page.url}>
            <span className="trace-domain">{domainOf(page.url)}</span>
            <span className="trace-path">{pathOf(page.url)}</span>
            <Icon name="external" size={11} />
          </a>
        ) : (
          <span className="trace-domain">{page.url}</span>
        )}
      </p>
      {page.excerpt ? <ClampText text={page.excerpt} lines={4} clampAt={180} className="trace-page-excerpt" /> : null}
    </div>
  );
}

function CorpusResult({ payload }: { payload: ToolResultPayload }) {
  const titles = payload.titles ?? [];
  const hits = payload.hits ?? titles.length;
  const ms = formatMs(payload.ms);
  const overflow = payload.hits !== undefined && titles.length > 0 && payload.hits > titles.length ? payload.hits - titles.length : 0;
  return (
    <div className="trace-card trace-corpus-card">
      <CardHead
        icon="database"
        tool="corpus_search"
        meta={[`${formatNumber(hits)} 条资料命中`, ms].filter(Boolean).join(" · ")}
      />
      {titles.length > 0 ? (
        <ul className="trace-chips">
          {titles.slice(0, 8).map((title, index) => (
            <li key={`${title}-${index}`}>
              <Icon name="book" size={11} />
              <span>{title}</span>
            </li>
          ))}
          {overflow > 0 ? <li className="trace-chip-more">+{formatNumber(overflow)}</li> : null}
        </ul>
      ) : (
        <p className="trace-card-empty">本次资料检索没有返回命中标题。</p>
      )}
    </div>
  );
}

function GenericResult({ payload }: { payload: ToolResultPayload }) {
  const ms = formatMs(payload.ms);
  return (
    <div className="trace-card trace-generic-card">
      <CardHead icon="activity" tool={payload.tool} meta={ms} />
      {payload.summary ? <p className="trace-card-text">{payload.summary}</p> : null}
      {payload.ok === false ? <p className="trace-card-error">{payload.error ?? "工具调用失败，没有返回原因。"}</p> : null}
    </div>
  );
}

function ToolResultRow({ payload }: { payload: ToolResultPayload }) {
  if (!payload.ok) {
    const meta = formatMs(payload.ms);
    return (
      <div className="trace-card trace-error-card">
        <CardHead icon="alert" tool={`${payload.tool} 失败`} meta={meta} tone="error" />
        <p className="trace-card-error">{payload.error ?? payload.summary ?? "工具调用失败，没有返回原因。"}</p>
      </div>
    );
  }
  if (payload.tool === "web_search") return <WebSearchResult payload={payload} />;
  if (payload.tool === "web_fetch") return <WebFetchResult payload={payload} />;
  if (payload.tool === "corpus_search") return <CorpusResult payload={payload} />;
  return <GenericResult payload={payload} />;
}

function ToolCallRow({ event }: { event: TraceEvent }) {
  return (
    <div className="trace-call">
      <span className="trace-prompt" aria-hidden="true">
        $
      </span>
      <code className="trace-call-code">{formatToolCall(event)}</code>
    </div>
  );
}

function AgentStepRow({ payload }: { payload: AgentStepPayload }) {
  return (
    <div className="trace-step">
      <div className="trace-step-head">
        <span className="trace-step-no">{payload.step ?? "·"}</span>
        <p className="trace-step-label">{payload.label}</p>
      </div>
      {payload.thought ? <ClampText text={payload.thought} lines={2} clampAt={120} className="trace-thought" /> : null}
    </div>
  );
}

function ValidationRow({ payload }: { payload: ValidationPayload }) {
  const meta = [
    payload.citations !== undefined ? `${formatNumber(payload.citations)} 条引用` : null,
    payload.web_citations !== undefined ? `${formatNumber(payload.web_citations)} 条实时网页` : null
  ]
    .filter(Boolean)
    .join(" · ");
  const reasons = payload.reasons ?? [];
  return (
    <div className={payload.ok ? "trace-validation is-ok" : "trace-validation is-warn"}>
      <Icon name={payload.ok ? "check" : "alert"} size={15} />
      <div className="trace-validation-body">
        <p className="trace-validation-title">{payload.ok ? "引用校验通过" : "引用校验未通过，已退回保守结果"}</p>
        {meta ? <p className="trace-validation-meta">{meta}</p> : null}
        {reasons.length > 0 ? (
          <ul className="trace-validation-reasons">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
        {payload.note ? <p className="trace-validation-note">{payload.note}</p> : null}
      </div>
    </div>
  );
}

function StageRow({ event }: { event: TraceEvent }) {
  const progress =
    typeof event.payload.progress === "number" ? Math.max(0, Math.min(100, Math.round(event.payload.progress))) : null;
  return (
    <div className="trace-stage-row">
      <span className="trace-stage-dot" aria-hidden="true" />
      <span className="trace-stage-label">{stageLabel(event.raw_type)}</span>
      {progress !== null ? (
        <>
          <span className="trace-stage-meter" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </span>
          <span className="trace-stage-value">{progress}%</span>
        </>
      ) : null}
    </div>
  );
}

function fallbackNoteText(event: TraceEvent): string {
  const progress = event.payload.progress;
  if (typeof progress === "number") return `${stageLabel(event.raw_type)} · ${Math.round(progress)}%`;
  return stageLabel(event.raw_type);
}

function NoteRow({ text }: { text: string }) {
  return (
    <div className="trace-note">
      <span className="trace-prompt" aria-hidden="true">
        ›
      </span>
      <p>{text}</p>
    </div>
  );
}

function TraceRow({ event }: { event: TraceEvent }) {
  switch (event.kind) {
    case "agent_step":
      return <AgentStepRow payload={event.payload as AgentStepPayload} />;
    case "tool_call":
      return <ToolCallRow event={event} />;
    case "tool_result":
      return <ToolResultRow payload={event.payload as ToolResultPayload} />;
    case "validation":
      return <ValidationRow payload={event.payload as ValidationPayload} />;
    case "stage":
      return <StageRow event={event} />;
    default: {
      const text =
        typeof event.payload.text === "string" && event.payload.text.trim() ? event.payload.text : fallbackNoteText(event);
      return <NoteRow text={text} />;
    }
  }
}

type TraceStats = {
  steps: number;
  calls: number;
  webHits: number;
  pages: number;
  corpus: number;
  errors: number;
};

function summarizeTrace(events: TraceEvent[]): TraceStats {
  const stats: TraceStats = { steps: 0, calls: 0, webHits: 0, pages: 0, corpus: 0, errors: 0 };
  for (const event of events) {
    if (event.kind === "agent_step") stats.steps += 1;
    if (event.kind === "tool_call") stats.calls += 1;
    if (event.kind !== "tool_result") continue;
    const payload = event.payload as ToolResultPayload;
    if (!payload.ok) stats.errors += 1;
    if (payload.tool === "web_search") stats.webHits += payload.count ?? payload.results?.length ?? 0;
    if (payload.tool === "web_fetch") stats.pages += 1;
    if (payload.tool === "corpus_search") stats.corpus += payload.hits ?? payload.titles?.length ?? 0;
  }
  return stats;
}

function activityText(events: TraceEvent[]): string {
  const last = events[events.length - 1];
  if (!last) return "连接云端 worker";
  if (last.kind === "tool_call") {
    const payload = last.payload as ToolCallPayload;
    return `调用 ${payload.tool}`;
  }
  if (last.kind === "tool_result") {
    const payload = last.payload as ToolResultPayload;
    if (payload.tool === "web_search") return "整理网页检索结果";
    if (payload.tool === "web_fetch") return "阅读网页正文";
    if (payload.tool === "corpus_search") return "整理资料命中";
    return "读取工具结果";
  }
  if (last.kind === "agent_step") return "思考下一步";
  if (last.kind === "validation") return "校验引用";
  return `推进到「${stageLabel(last.raw_type)}」`;
}

/**
 * Claude-Code-style live activity stream for a run: stages, plan steps, tool
 * calls rendered as pseudo code, tool result cards (web search hits, fetched
 * page excerpts, corpus hits) and citation validation.
 */
export function AgentTrace({
  events,
  running = false,
  status = null,
  title,
  emptyHint,
  autoScroll = true,
  className
}: AgentTraceProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const previousCountRef = useRef(0);

  const stats = useMemo(() => summarizeTrace(events), [events]);
  const heading = title ?? (running ? "实时执行轨迹" : "执行轨迹");
  const statusLabel = running ? "运行中" : status ? stageLabel(status) : events.length > 0 ? "已结束" : "待开始";
  const statLine = [
    stats.steps > 0 ? `${stats.steps} 个步骤` : null,
    stats.calls > 0 ? `${stats.calls} 次工具调用` : null,
    stats.corpus > 0 ? `${formatNumber(stats.corpus)} 条资料命中` : null,
    stats.webHits > 0 ? `${formatNumber(stats.webHits)} 条网页结果` : null,
    stats.pages > 0 ? `${stats.pages} 页正文` : null,
    stats.errors > 0 ? `${stats.errors} 次工具失败` : null
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  useEffect(() => {
    if (!autoScroll) return;
    const element = scrollRef.current;
    if (!element) return;
    const grew = events.length !== previousCountRef.current;
    previousCountRef.current = events.length;
    if (!grew) return;
    if (stickRef.current) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [events.length, autoScroll]);

  function trackScroll() {
    const element = scrollRef.current;
    if (!element) return;
    stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 56;
  }

  return (
    <section className={["agent-trace", running ? "is-running" : "is-finished", className ?? ""].filter(Boolean).join(" ")} aria-label={heading}>
      <header className="agent-trace-head">
        <span className="agent-trace-title">
          <span className={running ? "trace-pulse" : "trace-dot"} aria-hidden="true" />
          <span className="agent-trace-title-text">{heading}</span>
        </span>
        <span className={running ? "agent-trace-status is-live" : "agent-trace-status"}>{statusLabel}</span>
      </header>
      {statLine ? <p className="agent-trace-stats">{statLine}</p> : null}
      <div className="agent-trace-scroll" ref={scrollRef} onScroll={trackScroll} role="log" aria-live="polite" aria-relevant="additions">
        {events.length === 0 ? (
          <div className="agent-trace-empty">
            <span className={running ? "trace-pulse" : "trace-dot"} aria-hidden="true" />
            <p>{running ? emptyHint ?? "正在唤醒云端 worker，等待第一条活动…" : emptyHint ?? "本次运行没有留下可展示的活动记录。"}</p>
            {running ? (
              <div className="agent-trace-skeleton" aria-hidden="true">
                <span className="skeleton-line" />
                <span className="skeleton-line" />
                <span className="skeleton-line skeleton-line-short" />
              </div>
            ) : null}
          </div>
        ) : (
          <ol className="trace-list">
            {events.map((event) => (
              <li className="trace-item" key={event.seq} data-kind={event.kind}>
                <TraceRow event={event} />
              </li>
            ))}
          </ol>
        )}
      </div>
      {running ? (
        <footer className="agent-trace-foot">
          <span className="trace-pulse" aria-hidden="true" />
          <span>后台正在{activityText(events)}…</span>
          <span className="agent-trace-foot-note">页面隐藏时轮询会自动退避</span>
        </footer>
      ) : null}
    </section>
  );
}
