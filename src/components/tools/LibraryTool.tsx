"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Citation } from "@/lib/contracts/run";
import type { Source } from "@/lib/contracts/source";
import {
  cloudConfigured,
  createAnonymousSession,
  fetchSources,
  friendlyErrorMessage,
  newIdempotencyKey,
  parseAskResult,
  pollRunUntilDone,
  runFailureMessage,
  runStageLabel,
  safeExternalUrl,
  submitRun
} from "@/lib/api-client";
import {
  DATA_SOURCES,
  LIBRARY_ASK_BOUNDARY,
  LIBRARY_CATEGORIES,
  LIBRARY_DISCLAIMER,
  LIBRARY_EXAMPLE_QUESTIONS,
  RESOURCE_BOUNDARIES
} from "@/lib/content";
import { Badge, Button, Callout, EmptyState, Icon, ListBlock, ProgressBar, formatDateTime } from "@/components/ui/primitives";
import { CitationList, verificationDisplay } from "@/components/ui/CitationCard";
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
};

type AskStage = { label: string; progress: number };

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
  const [askStage, setAskStage] = useState<AskStage | null>(null);
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
    setAskStage({ label: "提交问题", progress: 8 });
    const controller = new AbortController();
    abortRef.current = controller;
    const askedAt = Date.now();
    try {
      await createAnonymousSession(controller.signal);
      const ack = await submitRun(
        {
          kind: "ask",
          idempotency_key: newIdempotencyKey(),
          question: text,
          ...(history.length > 0 ? { history } : {})
        },
        controller.signal
      );
      const { run } = await pollRunUntilDone(ack.runId, {
        signal: controller.signal,
        onUpdate: (nextRun) => {
          // A paused Freestyle VM has to boot before it can claim the run; the
          // status stays "queued" meanwhile. Say what is actually happening
          // instead of an opaque "排队中".
          const queuedFor = Date.now() - askedAt;
          const label =
            nextRun.status === "queued"
              ? queuedFor > 20_000
                ? "云端 worker 正在唤醒（首次约 30–90 秒）"
                : "排队中，等待云端 worker"
              : runStageLabel(nextRun.status);
          setAskStage({
            label,
            progress: Math.max(nextRun.progress, 15)
          });
        }
      });
      if (run.status !== "succeeded") {
        setMessages((current) => [
          ...current,
          { id: messageId(), role: "assistant", content: runFailureMessage(run), isError: true }
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
            isError: true
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
          boundaryNote: outcome.boundaryNote
        }
      ]);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "aborted") return;
      setMessages((current) => [
        ...current,
        { id: messageId(), role: "assistant", content: friendlyErrorMessage(error), isError: true }
      ]);
    } finally {
      setAsking(false);
      setAskStage(null);
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
                title="只回答与生涯资料有关的问题"
                description="资料问答只使用已载入且允许展示的生涯资料，回答必须带引用；没有证据时会明确拒答。它不联网、不编造来源，也不做通用办公或闲聊。"
              />
              <div className="example-questions">
                <p className="panel-title">
                  <Icon name="sparkles" size={15} /> 可以这样问
                </p>
                <div className="example-question-list">
                  {LIBRARY_EXAMPLE_QUESTIONS.map((example) => (
                    <button
                      type="button"
                      key={example}
                      className="example-question"
                      onClick={() => setQuestion(example)}
                      disabled={!cloud}
                    >
                      {example}
                      <Icon name="chevron-right" size={13} />
                    </button>
                  ))}
                </div>
              </div>
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
                        可能原因：资料库中没有足够证据，或问题超出了已载入的生涯资料范围。可以换一个与培养方案、就业报告、竞赛目录、学生手册或招聘要求相关的问题。
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
                </li>
              ))}
              {asking ? (
                <li className="message is-assistant">
                  <div className="message-head">
                    <span className="message-role">知途资料助手</span>
                  </div>
                  <div className="message-thinking">
                    <ProgressBar value={askStage?.progress ?? 8} label={askStage?.label ?? "检索资料"} />
                    <span>正在检索已载入资料并生成带引用的回答…</span>
                  </div>
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
          <textarea
            id="library-question"
            className="textarea composer-textarea"
            rows={3}
            maxLength={1000}
            value={question}
            placeholder={
              cloud
                ? "问一个与生涯资料有关的问题，例如：培养方案里有哪些相关课程？"
                : "云端知识库未启用：当前为本地演示模式，不能发起资料问答。"
            }
            onChange={(event) => {
              setQuestion(event.target.value);
              setComposerError(null);
            }}
            disabled={!cloud || asking}
            aria-describedby="library-composer-hint"
          />
          <div className="composer-foot">
            <div className="composer-hint" id="library-composer-hint">
              <span>{question.length} / 1000 字</span>
              <span>历史最多 4 条（约 2 轮）</span>
            </div>
            <Button variant="primary" size="md" type="submit" disabled={!cloud || asking || question.trim().length < 2}>
              <Icon name="sparkles" size={15} />
              {asking ? "回答中…" : "提问"}
            </Button>
          </div>
          {composerError ? (
            <p className="field-error" role="alert">
              {composerError}
            </p>
          ) : null}
          {!cloud ? (
            <p className="composer-disabled-note">
              <Icon name="database" size={13} />
              本地演示模式：资料问答需要云端知识库与检索服务，当前不会调用 AI，也不会返回伪造引用。
            </p>
          ) : null}
          <p className="composer-disclaimer">{LIBRARY_ASK_BOUNDARY}</p>
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
            <p>
              本地演示模式下没有云端来源目录，因此不能展示来源条目或引用。下面是产品计划支持的生涯资料类型与当前状态；未载入不等于没有，也不代表可以用其他数字代替。
            </p>
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
            title={activeFilter ? `「${activeFilter.label}」暂无已载入来源` : "来源目录为空"}
            description={
              cloud
                ? "云端来源目录没有返回条目。未载入不代表资料不存在；系统不会用其他来源替代，也不会编造引用。"
                : "本地演示模式下不展示来源条目。配置云端并完成资料导入后，这里会展示已核验的来源、版本与解析状态。"
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
          <p className="eyebrow">
            <Icon name="book" size={14} /> 资料库 · 生涯资料问答
          </p>
          <h1>先把资料来源看清楚，再谈结论</h1>
          <p className="library-lead">
            {LIBRARY_DISCLAIMER} 这里只保留与生涯相关的资料问答、来源查看与官方报告筛选，不做通用办公、播客或视频工具。
          </p>
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
          <div className="panel">
            <p className="panel-title">
              <Icon name="shield" size={15} /> 资料边界
            </p>
            <ul className="boundary-list">
              {RESOURCE_BOUNDARIES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="panel">
            <p className="panel-title">
              <Icon name="database" size={15} /> 计划中的数据来源
            </p>
            <ListBlock items={DATA_SOURCES.slice()} />
            <p className="panel-note">未授权或未载入的资料不会进入问答；不做联网抓取。</p>
          </div>
          <div className="panel">
            <p className="panel-title">
              <Icon name="list" size={15} /> 当前状态
            </p>
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
                <strong>{messages.filter((message) => !message.isError).length} 条（最多带 4 条给模型）</strong>
              </li>
              <li>
                <span>页面状态</span>
                <strong>{hydrated ? "就绪" : "加载中"}</strong>
              </li>
            </ul>
          </div>
          <div className="panel">
            <p className="panel-title">
              <Icon name="alert" size={15} /> 引用与拒答
            </p>
            <p className="panel-note">
              回答中的引用编号由服务端分配，对应消息下方的引用卡；不生成外部链接。没有证据时会明确拒答，而不是给一个听起来合理的答案。
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
