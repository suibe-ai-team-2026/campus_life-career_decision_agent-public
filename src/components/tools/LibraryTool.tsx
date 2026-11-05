"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Citation } from "@/lib/contracts/run";
import type { Source } from "@/lib/contracts/source";
import { toTraceEvents, type TraceEvent } from "@/lib/agent-trace";
import {
  cloudConfigured,
  createAnonymousSession,
  fetchSources,
  friendlyErrorMessage,
  newIdempotencyKey,
  parseAskResult,
  pollRunUntilDone,
  runFailureMessage,
  safeExternalUrl,
  submitRun,
  type RunEvent
} from "@/lib/api-client";
import { LIBRARY_CATEGORIES, LIBRARY_EXAMPLE_QUESTIONS } from "@/lib/content";
import {
  Badge,
  Button,
  Callout,
  Collapse,
  EmptyState,
  Icon,
  RunStatus,
  formatDateTime
} from "@/components/ui/primitives";
import { CitationText } from "@/components/ui/CitationCard";
import { AgentTrace } from "@/components/run/AgentTrace";
import { ResearchToggle } from "@/components/run/ResearchToggle";
import { useHydrated } from "@/lib/local-progress/store";
import { parsingRunStatusLabel, sourceScopeLabel } from "@/lib/source-labels";

type TabId = "ask" | "sources" | "reports";

type AskMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  refused?: boolean;
  boundaryNote?: string | null;
  isError?: boolean;
  /** Finished run trace attached to the answer so it stays readable afterwards. */
  trace?: TraceEvent[];
  traceStatus?: string | null;
};

function messageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const TAB_ITEMS: { id: TabId; label: string }[] = [
  { id: "ask", label: "资料问答" },
  { id: "sources", label: "来源查看" },
  { id: "reports", label: "官方报告筛选" }
];

export function LibraryTool() {
  const cloud = cloudConfigured();
  const hydrated = useHydrated();
  const [activeTab, setActiveTab] = useState<TabId>("ask");

  function handleTabKey(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const last = TAB_ITEMS.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    const tab = TAB_ITEMS[next];
    setActiveTab(tab.id);
    window.requestAnimationFrame(() => document.getElementById(`library-tab-${tab.id}`)?.focus());
  }
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [askEvents, setAskEvents] = useState<RunEvent[]>([]);
  const [askRunStatus, setAskRunStatus] = useState<string | null>(null);
  const [webSupplement, setWebSupplement] = useState(false);
  const [sources, setSources] = useState<Source[] | null>(null);
  const [sourcesState, setSourcesState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [filterId, setFilterId] = useState<string>("all");
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sourcesRequestRef = useRef<AbortController | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      sourcesRequestRef.current?.abort();
    },
    []
  );

  // Source catalog loading is deliberately NOT cancelled when the user switches
  // tabs. It used to be: switching away aborted the in-flight request but left
  // sourcesState at "loading", and the guard below then refused to ever fetch
  // again, so the 来源查看 tab showed its skeleton forever (no error, no retry).
  const loadSources = useCallback(async () => {
    if (sourcesRequestRef.current) return;
    const controller = new AbortController();
    sourcesRequestRef.current = controller;
    setSourcesState("loading");
    setSourcesError(null);
    try {
      // /api/sources requires an authenticated identity (anonymous counts).
      // The ask flow creates one before submitting; this tab must do the same,
      // otherwise a first-time or expired-session visitor only ever sees
      // authentication_required and the retry button can never succeed.
      await createAnonymousSession(controller.signal);
      const next = await fetchSources(controller.signal);
      if (controller.signal.aborted) return;
      setSources(next);
      setSourcesState("ready");
    } catch (error) {
      if (controller.signal.aborted) return;
      if ((error as { code?: string })?.code === "aborted") return;
      setSourcesError(friendlyErrorMessage(error));
      setSourcesState("error");
    } finally {
      if (sourcesRequestRef.current === controller) sourcesRequestRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!cloud) {
      setSourcesState("ready");
      return;
    }
    // Start only from a clean "idle": "error" waits for the explicit retry.
    if (activeTab === "ask" || sourcesState !== "idle") return;
    void loadSources();
  }, [activeTab, cloud, sourcesState, loadSources]);

  function reloadSources() {
    setSourcesError(null);
    setSourcesState("idle");
  }

  useEffect(() => {
    if (!asking) return;
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [asking, messages.length]);

  const activeFilter = LIBRARY_CATEGORIES.find((category) => category.id === filterId) ?? null;
  const filteredSources = useMemo(() => {
    if (!sources) return [];
    if (!activeFilter) return sources;
    return sources.filter((source) => {
      const haystack = `${source.title} ${source.source_scope ?? ""} ${source.publisher ?? ""}`;
      return activeFilter.keywords.some((keyword) => haystack.includes(keyword));
    });
  }, [sources, activeFilter]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const category of LIBRARY_CATEGORIES) {
      counts[category.id] =
        sources?.filter((source) => {
          const haystack = `${source.title} ${source.source_scope ?? ""}`;
          return category.keywords.some((keyword) => haystack.includes(keyword));
        }).length ?? 0;
    }
    return counts;
  }, [sources]);

  const askTrace = useMemo(() => toTraceEvents(askEvents), [askEvents]);
  const knowledgeBaseStatus = !cloud
    ? "本地演示模式"
    : sourcesState === "error"
      ? "云端知识库连接中断"
      : "云端知识库已连接";

  async function handleAsk(preset?: string) {
    const text = (preset ?? question).trim();
    if (asking) return;
    if (text.length < 2) {
      setComposerError("问题至少需要 2 个字。");
      return;
    }
    if (text.length > 1000) {
      setComposerError("问题不能超过 1000 字。");
      return;
    }
    if (!cloud) {
      setComposerError("本地演示模式：连接云端知识库后即可提问。");
      return;
    }
    const history = messages
      .filter((message) => !message.isError)
      .slice(-4)
      .map((message) => ({ role: message.role, content: message.content.slice(0, 1000) }));
    setMessages((current) => [...current, { id: messageId(), role: "user", content: text }]);
    setQuestion("");
    setComposerError(null);
    setAsking(true);
    setAskEvents([]);
    setAskRunStatus(null);
    const controller = new AbortController();
    abortRef.current = controller;
    let latestEvents: RunEvent[] = [];
    try {
      await createAnonymousSession(controller.signal);
      const ack = await submitRun(
        {
          kind: "ask",
          idempotency_key: newIdempotencyKey(),
          question: text,
          web_search: webSupplement,
          ...(history.length > 0 ? { history } : {})
        },
        controller.signal
      );
      const { run, events: finalEvents } = await pollRunUntilDone(ack.runId, {
        signal: controller.signal,
        onUpdate: (nextRun, nextEvents) => {
          latestEvents = nextEvents;
          setAskRunStatus(nextRun.status);
          setAskEvents(nextEvents);
        }
      });
      const finishedTrace = toTraceEvents(finalEvents);
      if (run.status !== "succeeded") {
        setMessages((current) => [
          ...current,
          {
            id: messageId(),
            role: "assistant",
            content: runFailureMessage(run),
            isError: true,
            trace: finishedTrace,
            traceStatus: run.status
          }
        ]);
        return;
      }
      const outcome = parseAskResult(run);
      if (!outcome) {
        setMessages((current) => [
          ...current,
          {
            id: messageId(),
            role: "assistant",
            content: "这次回答没有附上引用，已按资料库规则不当作事实展示。换个问法再试一次。",
            isError: true,
            trace: finishedTrace,
            traceStatus: run.status
          }
        ]);
        return;
      }
      const refused = outcome.refused || outcome.citations.length === 0;
      setMessages((current) => [
        ...current,
        {
          id: messageId(),
          role: "assistant",
          content: outcome.answer,
          citations: outcome.citations,
          refused,
          boundaryNote: outcome.boundaryNote,
          trace: finishedTrace,
          traceStatus: run.status
        }
      ]);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "aborted") return;
      setMessages((current) => [
        ...current,
        {
          id: messageId(),
          role: "assistant",
          content: friendlyErrorMessage(error),
          isError: true,
          trace: toTraceEvents(latestEvents),
          traceStatus: "failed"
        }
      ]);
    } finally {
      setAsking(false);
      setAskEvents([]);
      setAskRunStatus(null);
    }
  }

  function renderAskTab() {
    return (
      <div className="library-ask">
        <div className="library-conversation" aria-live="polite">
          {messages.length === 0 ? (
            <div className="library-ask-empty">
              <EmptyState icon="book" compact title="问一个与生涯资料有关的问题" />
              <Collapse summary="示例问题" tone="quiet">
                <div className="prompt-chips">
                  {LIBRARY_EXAMPLE_QUESTIONS.map((example) => (
                    <button
                      type="button"
                      key={example}
                      className="prompt-chip"
                      onClick={() => setQuestion(example)}
                      disabled={!cloud}
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </Collapse>
            </div>
          ) : (
            <ul className="message-list">
              {messages.map((message) => (
                <li className={message.role === "user" ? "message is-user" : "message is-assistant"} key={message.id}>
                  <div className="message-head">
                    <span className="message-role">
                      {message.role === "user" ? "你" : message.isError ? "系统" : "知途资料助手"}
                    </span>
                  </div>
                  {message.isError ? (
                    <div className="message-error">
                      <Icon name="alert" size={15} />
                      <span>{message.content}</span>
                    </div>
                  ) : message.refused ? (
                    <div className="message-refusal">
                      <p className="message-refusal-title">
                        <Icon name="shield" size={15} /> 这个问题可以这样查
                      </p>
                      <p>{message.content}</p>
                      {message.boundaryNote ? <p className="message-boundary">{message.boundaryNote}</p> : null}
                      <p className="message-boundary">
                        培养方案、就业质量报告、竞赛目录、学生手册与招聘要求都在资料库里。
                      </p>
                    </div>
                  ) : (
                    <div className="message-content">
                      <div className="message-answer">
                        <CitationText text={message.content} citations={message.citations} />
                      </div>
                    </div>
                  )}
                  {message.trace && message.trace.length > 0 ? (
                    <AgentTrace events={message.trace} running={false} status={message.traceStatus ?? null} />
                  ) : null}
                </li>
              ))}
              {asking ? (
                <li className="message is-assistant">
                  <div className="message-head">
                    <span className="message-role">知途资料助手</span>
                  </div>
                  <RunStatus label="正在生成回答" detail="首次唤醒约 30 到 90 秒" />
                  <AgentTrace events={askTrace} running status={askRunStatus} />
                </li>
              ) : null}
            </ul>
          )}
          <div ref={messageEndRef} />
        </div>

        <form
          className="library-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void handleAsk();
          }}
        >
          <label className="sr-only" htmlFor="library-question">
            输入资料问题
          </label>
          <ResearchToggle
            checked={webSupplement}
            onChange={setWebSupplement}
            disabled={!cloud || asking}
            label="联网补充"
            className="composer-options"
          />
          <div className="chat-composer">
            <textarea
              id="library-question"
              className="textarea"
              rows={1}
              maxLength={1000}
              value={question}
              placeholder={
                cloud
                  ? "问一个与生涯资料有关的问题…"
                  : "本地演示模式：连接云端知识库后即可提问。"
              }
              onChange={(event) => {
                setQuestion(event.target.value);
                setComposerError(null);
              }}
              disabled={!cloud || asking}
              aria-describedby="library-composer-hint"
            />
            <Button variant="primary" size="md" type="submit" disabled={!cloud || asking || question.trim().length < 2}>
              <Icon name="sparkles" size={15} />
              {asking ? "回答中…" : "提问"}
            </Button>
          </div>
          <p className="composer-hint micro" id="library-composer-hint">
            <span>{question.length} / 1000 字</span>
          </p>
          {composerError ? (
            <p className="field-error" role="alert">
              {composerError}
            </p>
          ) : null}
          {!cloud ? (
            <p className="composer-disabled-note micro">
              <Icon name="database" size={13} />
              本地演示模式：资料问答需要云端知识库与检索服务。
            </p>
          ) : null}
        </form>
      </div>
    );
  }

  function sourceLine(source: Source) {
    const officialUrl = safeExternalUrl(source.canonical_url);
    const open = openSourceId === source.source_id;
    const latestVersion = source.versions[0];
    const scopeLabel = sourceScopeLabel(source.source_scope) ?? "参考材料";
    const versionLabel =
      source.versions.length > 0
        ? `${source.versions.length} 个版本 · 最近${parsingRunStatusLabel(latestVersion?.extraction_status)}`
        : "已收录";
    return (
      <li className="source-line" key={source.source_id}>
        <button
          type="button"
          className="source-line-toggle"
          aria-expanded={open}
          aria-controls={`source-detail-${source.source_id}`}
          onClick={() => setOpenSourceId(open ? null : source.source_id)}
        >
          <span className="source-line-title" title={source.title}>
            {source.title}
          </span>
          <Icon name={open ? "minus" : "plus"} size={13} />
        </button>
        {open ? (
          <div className="source-line-detail" id={`source-detail-${source.source_id}`}>
            <dl>
              <div>
                <dt>资料类型</dt>
                <dd>{scopeLabel}</dd>
              </div>
              <div>
                <dt>发布方</dt>
                <dd>{source.publisher || "学校官方来源"}</dd>
              </div>
              <div>
                <dt>版本</dt>
                <dd>{versionLabel}</dd>
              </div>
              {latestVersion?.published_at ? (
                <div>
                  <dt>发布时间</dt>
                  <dd>{formatDateTime(latestVersion.published_at)}</dd>
                </div>
              ) : null}
            </dl>
            {officialUrl ? (
              <a className="source-line-link" href={officialUrl} target="_blank" rel="noopener noreferrer">
                打开原文
                <Icon name="external" size={12} />
              </a>
            ) : (
              <span className="micro">该来源没有公开链接；引用时按标题与定位对照原文。</span>
            )}
          </div>
        ) : null}
      </li>
    );
  }

  function renderSourcesTab(reportMode: boolean) {
    return (
      <div className="library-sources">
        <div className="filter-row" role="group" aria-label="按资料类型筛选">
          <button
            type="button"
            className={filterId === "all" ? "filter-chip is-active" : "filter-chip"}
            onClick={() => setFilterId("all")}
            aria-pressed={filterId === "all"}
          >
            全部
          </button>
          {LIBRARY_CATEGORIES.map((category) => (
            <button
              type="button"
              key={category.id}
              className={filterId === category.id ? "filter-chip is-active" : "filter-chip"}
              onClick={() => setFilterId(category.id)}
              aria-pressed={filterId === category.id}
            >
              {category.label}
              <span className="filter-count">{categoryCounts[category.id] ?? 0}</span>
            </button>
          ))}
        </div>

        {!cloud ? (
          <Callout tone="warn" title="本地演示模式">
            <p className="micro">连接云端后，这里会列出已收录的来源条目；下面是产品支持的资料类型。</p>
          </Callout>
        ) : null}

        {cloud && sourcesState === "loading" ? (
          <div className="source-skeleton">
            <div className="skeleton-line" />
            <div className="skeleton-line" />
            <div className="skeleton-line skeleton-line-short" />
          </div>
        ) : null}
        {cloud && sourcesState === "error" ? (
          <Callout tone="danger" title="来源目录连接中断">
            <p>{sourcesError ?? "请稍后重试。"}</p>
            <Button variant="secondary" size="sm" onClick={reloadSources}>
              重新加载
            </Button>
          </Callout>
        ) : null}

        {reportMode ? (
          <div className="report-categories">
            {LIBRARY_CATEGORIES.map((category) => (
              <article className="report-card" key={category.id}>
                <div className="report-card-head">
                  <h3>{category.label}</h3>
                  <Badge tone={categoryCounts[category.id] > 0 ? "ok" : "muted"}>
                    {categoryCounts[category.id] > 0
                      ? `${categoryCounts[category.id]} 条来源`
                      : sourcesState === "error"
                        ? "加载失败"
                        : sourcesState === "ready"
                          ? "来源入口"
                          : "加载中"}
                  </Badge>
                </div>
                <p>{category.description}</p>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setFilterId(category.id);
                    setActiveTab("sources");
                  }}
                >
                  查看该类型来源
                  <Icon name="chevron-right" size={13} />
                </button>
              </article>
            ))}
          </div>
        ) : null}

        {filteredSources.length > 0 ? (
          <ul className="source-line-list">{filteredSources.map(sourceLine)}</ul>
        ) : sourcesState === "ready" ? (
          <EmptyState
            icon="database"
            compact
            title={activeFilter ? `「${activeFilter.label}」的来源会显示在这里` : "来源目录已就绪"}
            description={
              cloud
                ? "知识库已连接，可以直接发起资料问答。"
                : "本地演示模式展示资料类型；连接云端后查看来源条目。"
            }
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="library-page">
      <header className="library-header">
        <div>
          <h1>资料库</h1>
        </div>
        <Badge tone={cloud && sourcesState !== "error" ? "ok" : "warn"}>{knowledgeBaseStatus}</Badge>
      </header>

      <div className="library-layout">
        <div className="library-main">
          <div className="tab-list" role="tablist" aria-label="资料库功能">
            {TAB_ITEMS.map((tab, index) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`library-tab-${tab.id}`}
                aria-selected={activeTab === tab.id}
                aria-controls={activeTab === tab.id ? `library-panel-${tab.id}` : undefined}
                tabIndex={activeTab === tab.id ? 0 : -1}
                className={activeTab === tab.id ? "tab-button is-active" : "tab-button"}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => handleTabKey(event, index)}
              >
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          <section
            className="library-panel"
            id={`library-panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`library-tab-${activeTab}`}
            tabIndex={0}
          >
            {activeTab === "ask" ? renderAskTab() : null}
            {activeTab === "sources" ? renderSourcesTab(false) : null}
            {activeTab === "reports" ? renderSourcesTab(true) : null}
          </section>
        </div>

      </div>
    </div>
  );
}
