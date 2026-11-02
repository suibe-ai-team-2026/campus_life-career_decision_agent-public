"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  DATA_SOURCES,
  LIBRARY_CATEGORIES,
  LIBRARY_EXAMPLE_QUESTIONS,
  RESOURCE_BOUNDARIES
} from "@/lib/content";
import {
  Badge,
  Button,
  Callout,
  Collapse,
  EmptyState,
  Icon,
  ListBlock,
  RunStatus,
  formatDateTime
} from "@/components/ui/primitives";
import { CitationList, verificationDisplay } from "@/components/ui/CitationCard";
import { AgentTrace } from "@/components/run/AgentTrace";
import { ResearchToggle } from "@/components/run/ResearchToggle";
import { useHydrated } from "@/lib/local-progress/store";

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

const TAB_ITEMS: { id: TabId; label: string; hint: string }[] = [
  { id: "ask", label: "资料问答", hint: "只用已载入的生涯资料回答，必须带引用" },
  { id: "sources", label: "来源查看", hint: "查看来源元数据、核验状态与版本" },
  { id: "reports", label: "官方报告筛选", hint: "按资料类型筛选已载入的官方材料" }
];

export function LibraryTool() {
  const cloud = cloudConfigured();
  const hydrated = useHydrated();
  const [activeTab, setActiveTab] = useState<TabId>("ask");
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
  const abortRef = useRef<AbortController | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  useEffect(() => {
    if (activeTab === "ask") return;
    if (sources !== null || sourcesState === "loading") return;
    if (!cloud) {
      setSourcesState("ready");
      return;
    }
    const controller = new AbortController();
    setSourcesState("loading");
    setSourcesError(null);
    fetchSources(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setSources(next);
        setSourcesState("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setSourcesError(friendlyErrorMessage(error));
        setSourcesState("error");
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, cloud]);

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
      setComposerError("云端知识库未启用：本地演示模式下不能发起资料问答。");
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
            content: "回答已返回，但格式无法识别。没有生成引用时系统不会把内容当作事实展示，请稍后重试或换一个问法。",
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
              <EmptyState
                icon="book"
                compact
                title="只回答与生涯资料有关的问题"
                description="只用已载入的生涯资料回答，必须带引用。"
              />
              <Collapse summary={<>示例问题</>}>
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
                        <Icon name="shield" size={15} /> 这个问题暂时不能回答
                      </p>
                      <p>{message.content}</p>
                      {message.boundaryNote ? <p className="message-boundary">{message.boundaryNote}</p> : null}
                      <p className="message-boundary">
                        可换成与培养方案、就业报告、竞赛目录、学生手册或招聘要求相关的问题。
                      </p>
                    </div>
                  ) : (
                    <div className="message-content">
                      <div className="message-answer">{message.content}</div>
                      {message.citations && message.citations.length > 0 ? (
                        <div className="message-citations">
                          <p className="panel-title">
                            <Icon name="list" size={14} /> 引用（{message.citations.length} 条）
                          </p>
                          <CitationList citations={message.citations} dense />
                        </div>
                      ) : null}
                    </div>
                  )}
                  {message.trace && message.trace.length > 0 ? (
                    <Collapse
                      summary={
                        <>
                          <Icon name="activity" size={13} />
                          执行轨迹
                          <span className="message-trace-meta">
                            {message.traceStatus === "succeeded" ? "已完成" : message.traceStatus === "failed" ? "失败" : "已结束"} ·{" "}
                            {message.trace.length} 条活动
                          </span>
                        </>
                      }
                    >
                      <AgentTrace events={message.trace} running={false} status={message.traceStatus ?? null} />
                    </Collapse>
                  ) : null}
                </li>
              ))}
              {asking ? (
                <li className="message is-assistant">
                  <div className="message-head">
                    <span className="message-role">知途资料助手</span>
                  </div>
                  <RunStatus label="正在生成回答" detail="首次唤醒约 30 到 90 秒" />
                  <Collapse summary={<>执行轨迹（进行中）</>}>
                    <AgentTrace events={askTrace} running status={askRunStatus} />
                  </Collapse>
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
            description="检索实时网页，结果未核验并单独标注；默认只用已载入资料。"
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
                  : "云端知识库未启用：本地演示模式不能发起资料问答。"
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

  function sourceCard(source: Source) {
    const verification = verificationDisplay(source.verification_status);
    const officialUrl = safeExternalUrl(source.canonical_url);
    return (
      <article className="source-card" key={source.source_id}>
        <header className="source-head">
          <div>
            <h3>{source.title}</h3>
            <p className="source-meta">
              {source.publisher ? <span>{source.publisher}</span> : null}
              {source.source_scope ? <span>{source.source_scope}</span> : null}
              <span>{source.source_id}</span>
            </p>
          </div>
          <div className="source-badges">
            <Badge tone={source.visibility === "approved_reference" ? "ok" : "muted"}>
              {source.visibility === "approved_reference" ? "共享参考" : "私有来源"}
            </Badge>
            <Badge tone={verification.tone}>{verification.label}</Badge>
          </div>
        </header>
        {source.versions.length > 0 ? (
          <ul className="source-versions">
            {source.versions.map((version) => (
              <li key={version.source_version_id}>
                <span className="source-version-id">{version.source_version_id.slice(0, 8)}…</span>
                <span>解析状态：{version.extraction_status}</span>
                <span>检索：{version.retrieved_at ? formatDateTime(version.retrieved_at) : "未提供"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="panel-note">该来源暂无版本元数据。</p>
        )}
        {officialUrl ? (
          <a className="link-inline" href={officialUrl} target="_blank" rel="noopener noreferrer">
            官方链接（由服务端返回）
            <Icon name="external" size={13} />
          </a>
        ) : (
          <p className="panel-note">服务端未提供可安全展示的官方链接；本页面不会拼接 URL。</p>
        )}
      </article>
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
          <Callout tone="warn" title="云端资料未载入">
            <p className="micro">本地演示模式没有云端来源目录，下列仅为产品支持的资料类型。</p>
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
          <Callout tone="danger" title="来源目录加载失败">
            <p>{sourcesError ?? "请稍后重试。"}</p>
            <Button variant="secondary" size="sm" onClick={() => setSourcesState("idle")}>
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
                    {categoryCounts[category.id] > 0 ? `${categoryCounts[category.id]} 条来源` : "待载入"}
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
          <div className="source-list">{filteredSources.map(sourceCard)}</div>
        ) : sourcesState === "ready" ? (
          <EmptyState
            icon="database"
            compact
            title={activeFilter ? `「${activeFilter.label}」暂无已载入来源` : "来源目录为空"}
            description={cloud ? "云端来源目录没有返回条目。" : "本地演示模式不展示来源条目。"}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="library-page">
      <header className="library-header">
        <div>
          <h1>先把资料来源看清楚，再谈结论</h1>
          <p className="library-lead micro">只做生涯资料问答、来源查看与官方报告筛选。</p>
        </div>
        <Badge tone={cloud ? "ok" : "warn"}>{cloud ? "云端知识库已启用" : "本地演示模式"}</Badge>
      </header>

      <div className="library-layout">
        <div className="library-main">
          <div className="tab-list" role="tablist" aria-label="资料库功能">
            {TAB_ITEMS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`library-tab-${tab.id}`}
                aria-selected={activeTab === tab.id}
                aria-controls={`library-panel-${tab.id}`}
                className={activeTab === tab.id ? "tab-button is-active" : "tab-button"}
                onClick={() => setActiveTab(tab.id)}
              >
                <span>{tab.label}</span>
                <small>{tab.hint}</small>
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

        <aside className="library-aside" aria-label="资料库说明">
          <Collapse summary={<><Icon name="shield" size={15} /> 数据与引用边界</>}>
            <ul className="boundary-list">
              {RESOURCE_BOUNDARIES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="micro">引用编号由服务端分配；联网补充的结果标注「未核验」。</p>
          </Collapse>
          <Collapse summary={<><Icon name="database" size={15} /> 计划中的数据来源</>}>
            <ListBlock items={DATA_SOURCES.slice()} />
          </Collapse>
          <Collapse summary={<><Icon name="list" size={15} /> 当前状态</>}>
            <ul className="kv-list">
              <li>
                <span>知识库</span>
                <strong>{cloud ? "云端已配置" : "本地演示模式"}</strong>
              </li>
              <li>
                <span>来源条目</span>
                <strong>{sources ? `${sources.length} 条` : cloud ? "尚未加载" : "云端未载入"}</strong>
              </li>
              <li>
                <span>问答历史</span>
                <strong>{messages.filter((message) => !message.isError).length} 条</strong>
              </li>
              <li>
                <span>联网补充</span>
                <strong>{webSupplement ? "开启" : "关闭"}</strong>
              </li>
              <li>
                <span>页面状态</span>
                <strong>{hydrated ? "就绪" : "加载中"}</strong>
              </li>
            </ul>
          </Collapse>
        </aside>
      </div>
    </div>
  );
}
