"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DirectionCard } from "@/lib/contracts/catalog";
import type { DirectionId } from "@/lib/contracts/common";
import type { Run } from "@/lib/contracts/run";
import {
  ApiError,
  cancelRun,
  cloudConfigured,
  createAnonymousSession,
  friendlyErrorMessage,
  newIdempotencyKey,
  parseCompareResult,
  pollRunUntilDone,
  runFailureMessage,
  runStageLabel,
  submitRun,
  type CompareOutcome
} from "@/lib/api-client";
import {
  ASSESSMENT,
  ASSESSMENT_VERSION,
  DIRECTIONS,
  DIRECTIONS_CATEGORY_VERSION,
  DIRECTIONS_DISCLAIMER,
  directionCoverage,
  getDirection
} from "@/lib/content";
import { scoreAssessment } from "@/lib/assessment/scoring";
import { recommendDirections, type DirectionConfidence } from "@/lib/career/recommend";
import {
  excludedDirectionReasons,
  isDirectionAllowed,
  recommendPathway,
  type PathwayDecision
} from "@/lib/career/pathway";
import {
  DEFAULT_PATHWAY_PREFERENCE,
  readLocalProgress,
  readExplorePrefs,
  updateLocalProgress,
  useLocalProgress,
  type LocalProgressV1
} from "@/lib/local-progress/store";
import { Badge, Button, Callout, Icon, ListBlock, ProgressBar, SectionHeading } from "@/components/ui/primitives";
import { CitationList } from "@/components/ui/CitationCard";
import { isDeterministicCompareFallback } from "@/lib/compare-display";
import { StepHeader } from "./StepHeader";

type CoverageMap = Partial<Record<DirectionId, DirectionCard["coverage"]>>;

/** 置信度标签描述「已答信号是否集中」，不是适配程度或概率。 */
const RECOMMEND_CONFIDENCE_LABELS: Record<DirectionConfidence, string> = {
  high: "已答信号较集中",
  medium: "值得比较",
  low: "先作探索线索"
};

const RECOMMEND_CONFIDENCE_TONES: Record<DirectionConfidence, "ok" | "accent" | "muted"> = {
  high: "ok",
  medium: "accent",
  low: "muted"
};

export function DirectionsStep() {
  const router = useRouter();
  const { progress, hydrated } = useLocalProgress();
  const pathwayPreference = hydrated
    ? readExplorePrefs().pathway
    : DEFAULT_PATHWAY_PREFERENCE;
  const excludedDirections = useMemo(
    () => excludedDirectionReasons(pathwayPreference),
    [pathwayPreference]
  );
  const favoriteIds = useMemo(
    () => (progress?.favorites ?? []) as DirectionId[],
    [progress?.favorites]
  );
  const favorites = useMemo(
    () => favoriteIds.filter((directionId) => isDirectionAllowed(directionId, pathwayPreference)),
    [favoriteIds, pathwayPreference]
  );
  const hiddenFavoriteCount = favoriteIds.length - favorites.length;
  const answers = progress?.profile.answers;
  const pathwayDecision = useMemo<PathwayDecision | null>(() => {
    if (!answers) return null;
    return recommendPathway(scoreAssessment(ASSESSMENT, answers), pathwayPreference);
  }, [answers, pathwayPreference]);
  const recommendationResult = useMemo(() => {
    if (!answers) return null;
    return recommendDirections(scoreAssessment(ASSESSMENT, answers), {
      pathwayPreference
    });
  }, [answers, pathwayPreference]);
  const answersVersionStale = Boolean(
    progress?.profile.assessment_version &&
      progress.profile.assessment_version !== ASSESSMENT_VERSION
  );
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [continueError, setContinueError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<CoverageMap>({});
  const [catalogMode, setCatalogMode] = useState<"seed" | "database" | null>(null);
  const [catalogState, setCatalogState] = useState<"idle" | "loading" | "ready" | "error">(
    cloudConfigured() ? "loading" : "idle"
  );
  const [aiState, setAiState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [aiRun, setAiRun] = useState<Run | null>(null);
  const [aiResult, setAiResult] = useState<CompareOutcome | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiRequestId, setAiRequestId] = useState<string | null>(null);
  const [aiSlow, setAiSlow] = useState(false);
  const [aiDegraded, setAiDegraded] = useState(false);
  const aiAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!cloudConfigured()) return;
    const controller = new AbortController();
    setCatalogState("loading");
    import("@/lib/api-client")
      .then(({ fetchDirections }) => fetchDirections(controller.signal))
      .then((catalog) => {
        if (controller.signal.aborted) return;
        const next: CoverageMap = {};
        for (const card of catalog.directions) next[card.direction_id] = card.coverage;
        setCoverage(next);
        setCatalogMode(catalog.mode === "seed" ? "seed" : "database");
        setCatalogState("ready");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setCatalogState("error");
      });
    return () => controller.abort();
  }, []);

  useEffect(
    () => () => {
      aiAbort.current?.abort();
    },
    []
  );

  // 检索偶尔会很慢（历史上出现过数分钟），超过一分钟就给出提示，避免用户以为卡死。
  useEffect(() => {
    if (aiState !== "running") return;
    const timer = setTimeout(() => setAiSlow(true), 60_000);
    return () => clearTimeout(timer);
  }, [aiState]);

  const favoriteDirections = useMemo(
    () => favorites.map((id) => DIRECTIONS.find((direction) => direction.direction_id === id)).filter((item): item is (typeof DIRECTIONS)[number] => Boolean(item)),
    [favorites]
  );

  function toggleFavorite(directionId: DirectionId) {
    setFavoriteError(null);
    if (!isDirectionAllowed(directionId, pathwayPreference)) {
      setFavoriteError(
        excludedDirections[directionId] ??
          "该方向已被你的硬约束排除，不能加入比较。"
      );
      return;
    }
    const current = readLocalProgress() ?? ({} as LocalProgressV1);
    const currentFavorites = (current.favorites ?? []) as DirectionId[];
    if (!currentFavorites.includes(directionId) && currentFavorites.length >= 3) {
      setFavoriteError("最多收藏 3 个方向。先取消一个，再收藏新的方向。");
      return;
    }
    updateLocalProgress((draft) => {
      const index = draft.favorites.indexOf(directionId);
      if (index >= 0) {
        draft.favorites.splice(index, 1);
      } else if (draft.favorites.length < 3) {
        draft.favorites.push(directionId);
      }
      return draft;
    });
  }

  function handleContinue() {
    if (favorites.length < 2) {
      setContinueError("请先收藏至少 2 个方向做并排比较；如果暂时不想比较，也可以点「跳过这一步」。");
      return;
    }
    setContinueError(null);
    router.push("/choice");
  }

  async function handleAiCompare() {
    if (!cloudConfigured()) return;
    if (favorites.length < 2) {
      setAiError("至少收藏 2 个方向后才能发起 AI 对比。");
      setAiState("error");
      return;
    }
    aiAbort.current?.abort();
    const controller = new AbortController();
    aiAbort.current = controller;
    setAiState("running");
    setAiRun(null);
    setAiResult(null);
    setAiError(null);
    setAiRequestId(null);
    setAiSlow(false);
    setAiDegraded(false);
    try {
      // compare 不要求画像，但 /api/runs 与轮询接口都要求登录态；这里先建立匿名会话，
      // 否则从「方向」这一步直接点对比的新访客会收到 401。
      await createAnonymousSession(controller.signal);
      const directionIds = favorites.slice(0, 3);
      const ack = await submitRun(
        {
          kind: "compare",
          direction_ids: directionIds,
          idempotency_key: newIdempotencyKey()
        },
        controller.signal
      );
      const { run } = await pollRunUntilDone(ack.runId, {
        signal: controller.signal,
        // 检索偶发变慢时，默认 8 分钟会卡在超时边缘；对比任务放宽到 15 分钟，
        // 用户可以随时点「停止」。超时后仍可重试。
        timeoutMs: 15 * 60 * 1000,
        onUpdate: (nextRun) => setAiRun(nextRun)
      });
      if (run.status !== "succeeded") {
        setAiError(runFailureMessage(run));
        setAiState("error");
        return;
      }
      const parsed = parseCompareResult(run);
      if (!parsed) {
        setAiError("AI 对比已返回，但结果格式无法识别；请改为查看上方资料并排对比。");
        setAiState("error");
        return;
      }
      setAiResult(parsed);
      setAiDegraded(isDeterministicCompareFallback(parsed.comparison));
      setAiState("done");
    } catch (error) {
      // 用户主动停止或离开页面时，由调用方负责状态，不显示错误。
      if (controller.signal.aborted) return;
      setAiError(friendlyErrorMessage(error));
      if (error instanceof ApiError) setAiRequestId(error.requestId);
      setAiState("error");
    }
  }

  /** 停止本地等待并尽力取消服务端任务；取消失败不阻塞用户。 */
  async function handleStopAiCompare() {
    const runId = aiRun?.run_id ?? null;
    aiAbort.current?.abort();
    aiAbort.current = null;
    setAiState("idle");
    setAiRun(null);
    if (!runId) return;
    try {
      await cancelRun(runId);
    } catch {
      // 任务可能已结束；本地已经停止展示，不需要再打扰用户。
    }
  }

  const ready = hydrated && progress !== null;
  // The long data-boundary sentence returned by the catalog is identical for
  // every card. Render it once below the grid so it never stretches a nowrap
  // badge (which used to force the whole page into horizontal scroll).
  const coverageFootnote = useMemo(() => {
    if (catalogState !== "ready") return null;
    const first = DIRECTIONS.map((direction) => coverage[direction.direction_id]).find(Boolean);
    return first?.label ?? null;
  }, [catalogState, coverage]);

  return (
    <div className="step-page">
      <StepHeader
        index={2}
        title="先看清六个方向的牌面"
        description={
          <>
            每张方向卡都写清<strong>工作内容、已核技能、准备成本、适用范围与数据缺口</strong>。收藏 2–3 个方向，可以并排比较；这里不提供排名、通过率或薪资结论。
          </>
        }
        actions={
          <>
            <Button variant="ghost" size="md" onClick={() => router.push("/choice")}>
              跳过这一步
            </Button>
            <Button variant="primary" size="md" onClick={handleContinue}>
              进入暂定方向
              <Icon name="arrow-right" size={15} />
            </Button>
          </>
        }
        meta={
          <span className="step-meta-row">
            <span className="step-meta-item">
              <Icon name="list" size={13} /> 分类版本 {DIRECTIONS_CATEGORY_VERSION}
            </span>
            <span className="step-meta-item">
              <Icon name="database" size={13} />
              {catalogState === "ready" && catalogMode
                ? `云端目录已载入（${catalogMode === "seed" ? "seed 回退" : "database"}）`
                : catalogState === "loading"
                  ? "正在载入云端目录…"
                  : "云端证据未载入"}
            </span>
            <span className="step-meta-item">
              <Icon name="heart" size={13} /> 已收藏 {favorites.length} / 3
            </span>
          </span>
        }
      />

      <Callout tone="plain" icon="info" title="六个方向是产品导航分类，不是学校官方就业分类">
        <p>{DIRECTIONS_DISCLAIMER}</p>
      </Callout>

      {!ready ? (
        <div className="skeleton-grid" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div className="skeleton-card" key={index} />
          ))}
        </div>
      ) : (
        <>
          {pathwayDecision ? (
            <section className="panel pathway-panel" aria-labelledby="pathway-title">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">第一步 · 先选现实路线</p>
                  <h2 id="pathway-title">先比较本科就业、升学与公考，再进入职业方向</h2>
                  <p className="panel-subtitle">
                    硬排除条件先于兴趣和能力信号生效；路线建议只用于安排准备顺序，不做录取、考试或就业承诺。
                  </p>
                </div>
                <Badge tone="accent">规则版本 {pathwayDecision.rulesVersion}</Badge>
              </div>
              {hiddenFavoriteCount > 0 ? (
                <Callout tone="warn" title="有收藏方向与硬约束冲突">
                  <p>
                    你此前收藏的 {hiddenFavoriteCount} 个方向已被当前约束排除，不再进入推荐、比较或暂定。若要重新考虑，请回自我探索修改约束。
                  </p>
                </Callout>
              ) : null}
              <div className="pathway-summary">
                <div className="pathway-leading">
                  <p className="direction-label">当前较优先比较</p>
                  <h3>{pathwayDecision.leading?.label ?? "需要补充约束"}</h3>
                  <ul className="recommend-reasons">
                    {(pathwayDecision.leading?.reasons ?? pathwayDecision.explanation).slice(0, 3).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  {pathwayDecision.leading ? (
                    <p className="panel-note">
                      <Icon name="clock" size={13} /> {pathwayDecision.leading.preparationCost}
                    </p>
                  ) : null}
                </div>
                <div className="pathway-alternatives">
                  <p className="direction-label">备选路线</p>
                  {pathwayDecision.alternatives.length > 0 ? (
                    <ul className="pathway-alternative-list">
                      {pathwayDecision.alternatives.map((route) => (
                        <li key={route.pathwayId}>
                          <strong>{route.label}</strong>
                          <span>{route.reasons[0]}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="panel-note">当前没有其他可比较路线；请检查是否一次排除了太多选项。</p>
                  )}
                  {pathwayDecision.excluded.length > 0 ? (
                    <p className="panel-note pathway-excluded-note">
                      <Icon name="shield" size={13} /> 已按硬约束排除：
                      {pathwayDecision.excluded.map((item) => item.reason.split("你")[1] ?? item.reason).join("；")}
                    </p>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          <section className="panel recommend-panel" aria-labelledby="recommend-title">
            <div className="panel-head">
              <div>
                <p className="eyebrow">基于你的画像</p>
                <h2 id="recommend-title">基于你的画像的待比较方向</h2>
                <p className="panel-subtitle">
                  由程序规则从已答信号中挑出，排序不是匹配打分；兴趣只表示当前更愿意投入，能力只表示自评，经历只表示你提供了相关经历。
                </p>
              </div>
              {recommendationResult && recommendationResult.recommendations.length > 0 ? (
                <Badge tone="accent">待比较 {recommendationResult.recommendations.length} 个</Badge>
              ) : null}
            </div>

            {answersVersionStale ? (
              <Callout tone="warn" icon="refresh" title="问卷版本已更新">
                <p>你保存的画像来自旧版问卷，旧答案不再参与方向推荐。先回第 1 步确认画像，再回来比较方向。</p>
                <div className="recommend-empty-actions">
                  <Button variant="secondary" size="sm" href="/explore">
                    去重新确认画像
                    <Icon name="arrow-right" size={14} />
                  </Button>
                </div>
              </Callout>
            ) : !recommendationResult || recommendationResult.insufficientSignals ? (
              <Callout tone="plain" icon="compass" title="画像信号还不够">
                <p>
                  方向推荐至少需要 3 个兴趣或 3 个能力信号。先回第 1 步补答几道题；也可以直接浏览下方完整目录，自己收藏方向。
                </p>
                <div className="recommend-empty-actions">
                  <Button variant="secondary" size="sm" href="/explore">
                    去补答
                    <Icon name="arrow-right" size={14} />
                  </Button>
                </div>
              </Callout>
            ) : recommendationResult.recommendations.length === 0 ? (
              <Callout tone="plain" icon="compass" title="当前画像还不足以给出待比较方向">
                <p>
                  已答信号与方向卡的工作内容对应不够明确。可以先浏览下方完整目录，或回第 1 步补充能力自评与经历后再比较。
                </p>
                <div className="recommend-empty-actions">
                  <Button variant="secondary" size="sm" href="/explore">
                    回第 1 步补画像
                    <Icon name="arrow-right" size={14} />
                  </Button>
                </div>
              </Callout>
            ) : (
              <>
                {favorites.length >= 3 ? (
                  <p className="panel-note">
                    比较位已满（3 / 3）：先移除一个已收藏方向，再加入新的推荐方向。已收藏的方向不会因为换推荐而消失。
                  </p>
                ) : null}
                <div className="recommend-grid">
                  {recommendationResult.recommendations.map((recommendation) => {
                    const direction = getDirection(recommendation.directionId);
                    if (!direction) return null;
                    const isFavorite = favorites.includes(recommendation.directionId);
                    const limitReached = !isFavorite && favorites.length >= 3;
                    return (
                      <article className="recommend-card" key={recommendation.directionId}>
                        <header className="recommend-card-head">
                          <div>
                            <p className="direction-kicker">{direction.short_title}</p>
                            <h3>{direction.title}</h3>
                          </div>
                          <Badge tone={RECOMMEND_CONFIDENCE_TONES[recommendation.confidence]}>
                            {RECOMMEND_CONFIDENCE_LABELS[recommendation.confidence]}
                          </Badge>
                        </header>
                        <div className="direction-block">
                          <p className="direction-label">相符之处</p>
                          <ul className="recommend-reasons">
                            {recommendation.reasons.slice(0, 3).map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        </div>
                        {recommendation.gaps.length > 0 ? (
                          <div className="direction-block">
                            <p className="direction-label">
                              <Icon name="alert" size={13} /> 待补足
                            </p>
                            <ul className="gap-list recommend-gaps">
                              {recommendation.gaps.map((gap) => (
                                <li key={gap}>{gap}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {recommendation.matchedSignals.evidence.length > 0 ? (
                          <p className="panel-note recommend-evidence">
                            <Icon name="check" size={13} /> 你提供过相关经历：
                            {recommendation.matchedSignals.evidence.join("、")}（仅表示你提供了经历，未经第三方验证）
                          </p>
                        ) : null}
                        <p className="recommend-boundary">
                          <Icon name="info" size={13} /> {recommendation.boundaries[2]}
                        </p>
                        <p className="recommend-boundary">
                          <Icon name="database" size={13} /> {recommendation.boundaries[1]}
                        </p>
                        <div className="recommend-card-actions">
                          <Button
                            variant={isFavorite ? "ghost" : "primary"}
                            size="sm"
                            onClick={() => toggleFavorite(recommendation.directionId)}
                            disabled={limitReached}
                            ariaLabel={
                              isFavorite
                                ? `移出比较：${direction.title}`
                                : `加入比较：${direction.title}`
                            }
                            title={limitReached ? "比较位已满，先移除一个已收藏方向" : undefined}
                          >
                            <Icon name={isFavorite ? "check" : "plus"} size={14} />
                            {isFavorite ? "已收藏，点此移除" : limitReached ? "比较位已满" : "加入比较"}
                          </Button>
                          <Button variant="ghost" size="sm" href="/explore">
                            调整画像
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
                <p className="coverage-footnote recommend-rule-note">
                  <Icon name="database" size={13} /> 推荐规则版本 {recommendationResult.rulesVersion} · 方向卡分类版本{" "}
                  {DIRECTIONS_CATEGORY_VERSION}；依据方向卡「工作内容」「已核技能」字段，不是匹配打分。
                </p>
              </>
            )}
          </section>

          <section aria-labelledby="direction-cards-title">
            <SectionHeading
              eyebrow="方向牌面"
              title={<span id="direction-cards-title">六个方向，逐张核对</span>}
              description="点右上角收藏；收藏后可在下方并排比较。卡片不展示未核证的就业率、薪资或录取概率。"
              actions={
                favorites.length > 0 ? <Badge tone="accent">已收藏 {favorites.length} 个</Badge> : <Badge tone="muted">尚未收藏</Badge>
              }
            />
            <div className="direction-grid">
              {DIRECTIONS.map((direction) => {
                const isFavorite = favorites.includes(direction.direction_id);
                const exclusionReason = excludedDirections[direction.direction_id];
                const excluded = Boolean(exclusionReason);
                const coverageView = directionCoverage(direction, coverage[direction.direction_id] ?? null);
                const coverageBadge = catalogState === "loading" ? "云端证据载入中" : coverageView.badgeLabel;
                return (
                  <article
                    className={
                      excluded
                        ? "direction-card is-excluded"
                        : isFavorite
                          ? "direction-card is-favorite"
                          : "direction-card"
                    }
                    key={direction.direction_id}
                  >
                    <header className="direction-card-head">
                      <div>
                        <p className="direction-kicker">{direction.short_title}</p>
                        <h3>{direction.title}</h3>
                      </div>
                      {excluded ? (
                        <Badge tone="danger">硬约束排除</Badge>
                      ) : (
                        <button
                          type="button"
                          className={isFavorite ? "favorite-button is-active" : "favorite-button"}
                          onClick={() => toggleFavorite(direction.direction_id)}
                          aria-pressed={isFavorite}
                          aria-label={isFavorite ? `取消收藏 ${direction.title}` : `收藏 ${direction.title}`}
                        >
                          <Icon name="heart" size={15} />
                          {isFavorite ? "已收藏" : "收藏"}
                        </button>
                      )}
                    </header>
                    <p className="direction-summary">{direction.summary}</p>
                    {excluded ? (
                      <Callout tone="warn" title="此方向不会进入推荐或方案">
                        <p>{exclusionReason}。如需重新比较，请回自我探索修改硬约束。</p>
                      </Callout>
                    ) : null}

                    <div className="direction-block">
                      <p className="direction-label">日常工作内容</p>
                      <div className="chip-row">
                        {direction.work_content.map((item) => (
                          <span className="chip" key={item}>
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="direction-block">
                      <p className="direction-label">已核技能</p>
                      <div className="chip-row">
                        {direction.verified_skills.map((item) => (
                          <span className="chip chip-amber" key={item}>
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="direction-block">
                      <p className="direction-label">准备成本</p>
                      <p className="direction-text">{direction.preparation_cost}</p>
                    </div>
                    <div className="direction-block">
                      <p className="direction-label">适用范围</p>
                      <p className="direction-text">{direction.applicability}</p>
                    </div>
                    <div className="direction-block direction-block-gap">
                      <p className="direction-label">
                        <Icon name="alert" size={13} /> 数据缺口
                      </p>
                      <ul className="gap-list">
                        {direction.data_gaps.map((gap) => (
                          <li key={gap}>{gap}</li>
                        ))}
                      </ul>
                    </div>
                    <footer className="direction-card-foot">
                      <div className="coverage-line">
                        <Badge tone={coverageView.pending || catalogState !== "ready" ? "warn" : "ok"}>{coverageBadge}</Badge>
                        {!coverageView.pending && catalogState === "ready" ? (
                          <span className="coverage-counts">
                            同专业精确记录 {coverageView.exactMajorRecords} · 官方记录 {coverageView.officialRecords} · 招聘要求{" "}
                            {coverageView.jobRequirements}
                          </span>
                        ) : (
                          <span className="coverage-counts">不展示数字，避免把缺口误读为 0</span>
                        )}
                      </div>
                      <span className="source-count">来源条目 {direction.source_ids.length}</span>
                    </footer>
                  </article>
                );
              })}
            </div>
            {coverageFootnote ? (
              <p className="coverage-footnote">
                <Icon name="database" size={13} /> 数据覆盖口径：{coverageFootnote}
              </p>
            ) : null}
          </section>

          {favoriteError ? (
            <Callout tone="warn" title="收藏数量已达上限">
              <p>{favoriteError}</p>
            </Callout>
          ) : null}
          {continueError ? (
            <Callout tone="warn" title="还差一点">
              <p>{continueError}</p>
            </Callout>
          ) : null}

          <section className="panel favorites-panel" aria-labelledby="favorites-title">
            <div className="panel-head">
              <div>
                <p className="eyebrow">我的收藏</p>
                <h2 id="favorites-title">
                  已收藏 {favorites.length} / 3 个方向
                </h2>
              </div>
              <div className="favorites-actions">
                <Button variant="primary" size="sm" onClick={handleContinue} disabled={favorites.length < 2}>
                  进入暂定方向
                </Button>
                <Button variant="ghost" size="sm" onClick={() => router.push("/choice")}>
                  跳过这一步
                </Button>
              </div>
            </div>
            {favorites.length === 0 ? (
              <p className="panel-note">还没有收藏。从上面的六张卡里选 2–3 个你愿意进一步了解的方向。</p>
            ) : (
              <div className="favorite-chip-row">
                {favoriteDirections.map((direction) => (
                  <span className="favorite-chip" key={direction.direction_id}>
                    {direction.title}
                    <button
                      type="button"
                      className="favorite-chip-remove"
                      onClick={() => toggleFavorite(direction.direction_id)}
                      aria-label={`取消收藏 ${direction.title}`}
                    >
                      <Icon name="cross" size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="panel-note">
              收藏只保存在本设备；之后可以随时取消或增加（上限 3 个）。收藏本身不是承诺，也不会自动生成方案。
            </p>
          </section>

          {favoriteDirections.length >= 2 ? (
            <section className="panel compare-panel" aria-labelledby="compare-title">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">并排对比</p>
                  <h2 id="compare-title">把 {favoriteDirections.length} 个收藏放在同一张桌上</h2>
                  <p className="panel-subtitle">对比的是已归档资料中的牌面，不是预测谁更容易成功。</p>
                </div>
              </div>
              <div className="compare-scroll">
                <table className="compare-table">
                  <caption className="sr-only">已收藏方向的资料并排对比</caption>
                  <thead>
                    <tr>
                      <th scope="col">维度</th>
                      {favoriteDirections.map((direction) => (
                        <th scope="col" key={direction.direction_id}>
                          <span className="compare-col-title">{direction.title}</span>
                          <span className="compare-col-sub">{direction.short_title}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">工作内容</th>
                      {favoriteDirections.map((direction) => (
                        <td key={direction.direction_id}>
                          <ul className="compare-list">
                            {direction.work_content.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">已核技能</th>
                      {favoriteDirections.map((direction) => (
                        <td key={direction.direction_id}>
                          <div className="chip-row">
                            {direction.verified_skills.map((item) => (
                              <span className="chip chip-amber" key={item}>
                                {item}
                              </span>
                            ))}
                          </div>
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">准备成本</th>
                      {favoriteDirections.map((direction) => (
                        <td key={direction.direction_id}>{direction.preparation_cost}</td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">适用范围</th>
                      {favoriteDirections.map((direction) => (
                        <td key={direction.direction_id}>{direction.applicability}</td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">数据缺口</th>
                      {favoriteDirections.map((direction) => (
                        <td key={direction.direction_id}>
                          <ul className="compare-list compare-list-warn">
                            {direction.data_gaps.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">数据覆盖</th>
                      {favoriteDirections.map((direction) => {
                        const view = directionCoverage(direction, coverage[direction.direction_id] ?? null);
                        return (
                          <td key={direction.direction_id}>
                            <Badge tone={view.pending ? "warn" : "ok"}>{catalogState === "loading" ? "载入中" : view.badgeLabel}</Badge>
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="ai-compare">
                <div className="ai-compare-copy">
                  <p className="panel-title">
                    <Icon name="sparkles" size={15} /> AI 对比解释
                  </p>
                  <p className="panel-note">
                    AI 只解释差异，不改写资料事实。它会把 {favoriteDirections.length} 个已收藏方向提交为一次 compare 任务；引用由服务端分配编号。
                  </p>
                </div>
                {cloudConfigured() ? (
                  <Button variant="secondary" size="md" onClick={handleAiCompare} disabled={aiState === "running"}>
                    <Icon name="sparkles" size={15} />
                    {aiState === "running" ? "生成中…" : "生成 AI 对比解释"}
                  </Button>
                ) : (
                  <div className="ai-compare-disabled">
                    <Button variant="secondary" size="md" disabled title="云端生成未启用">
                      <Icon name="sparkles" size={15} /> AI 对比解释
                    </Button>
                    <p className="panel-note">
                      云端生成未启用：本地演示模式下不调用 AI。上方资料并排对比可以完整使用。
                    </p>
                  </div>
                )}
              </div>

              {aiState === "running" ? (
                <div className="ai-running">
                  <div className="ai-running-head">
                    <ProgressBar value={aiRun?.progress ?? 0} label={`AI 对比 · ${runStageLabel(aiRun?.status ?? "queued")}`} />
                    <Button variant="ghost" size="sm" onClick={handleStopAiCompare}>
                      停止
                    </Button>
                  </div>
                  <p className="panel-note">任务运行中。页面隐藏时轮询会自动放慢，避免浪费资源。</p>
                  {aiSlow ? (
                    <p className="panel-note">
                      资料检索比平时慢（偶发时可能持续几分钟）。可以继续等待，或先看上方并排对比；点「停止」不会影响已收藏的方向。
                    </p>
                  ) : null}
                </div>
              ) : null}
              {aiState === "error" && aiError ? (
                <Callout tone="warn" title="AI 对比暂不可用">
                  <p>{aiError}</p>
                  <p>可以继续使用上方的资料并排对比；它不依赖云端。</p>
                  {aiRequestId ? <p className="panel-note">问题编号：{aiRequestId}（反馈时附上可帮助定位）</p> : null}
                  <div className="ai-error-actions">
                    <Button variant="secondary" size="sm" onClick={handleAiCompare}>
                      <Icon name="sparkles" size={14} /> 重试生成
                    </Button>
                  </div>
                </Callout>
              ) : null}
              {aiState === "done" && aiResult ? (
                <div className="ai-result">
                  <p className="panel-title">
                    <Icon name="sparkles" size={15} /> AI 对比解释
                  </p>
                  {aiDegraded ? (
                    <Callout tone="plain" icon="info" title="本次为确定性回退说明">
                      <p>
                        AI 解释未通过引用/数字校验，系统已回退为资料说明；方向卡与下方引用没有改变。可以重试生成，或直接使用上方的并排对比。
                      </p>
                      <div className="ai-error-actions">
                        <Button variant="secondary" size="sm" onClick={handleAiCompare}>
                          <Icon name="sparkles" size={14} /> 重试生成
                        </Button>
                      </div>
                    </Callout>
                  ) : null}
                  <div className="explanation-text">{aiResult.comparison}</div>
                  {aiResult.directionIds.length > 0 ? (
                    <p className="panel-note">
                      本次对比方向：
                      {aiResult.directionIds
                        .map((id) => DIRECTIONS.find((direction) => direction.direction_id === id)?.title ?? id)
                        .join(" / ")}
                    </p>
                  ) : null}
                  <CitationList citations={aiResult.citations} dense />
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="panel boundary-panel" aria-labelledby="directions-boundary-title">
            <div className="panel-head">
              <div>
                <p className="eyebrow">资料覆盖说明</p>
                <h2 id="directions-boundary-title">哪些数字缺席，以及为什么缺席</h2>
              </div>
            </div>
            <div className="boundary-columns">
              <ListBlock
                items={[
                  "方向卡展示的是产品导航分类下的岗位族，不是官方就业分类。",
                  "数据覆盖数字只在云端返回已核验记录时显示；否则显示「未载入 / 待载入」。",
                  "不展示就业率、薪资、录取概率、报考资格结论或院校排名。",
                  "工作内容与技能来自已归档资料；具体企业招聘偏好仍需你按招聘快照核对。"
                ]}
                tone="warn"
              />
              <div className="boundary-note">
                <p className="panel-title">
                  <Icon name="database" size={15} /> 当前数据状态
                </p>
                <ul className="kv-list">
                  <li>
                    <span>分类版本</span>
                    <strong>{DIRECTIONS_CATEGORY_VERSION}</strong>
                  </li>
                  <li>
                    <span>本地牌面</span>
                    <strong>已载入 seed 快照</strong>
                  </li>
                  <li>
                    <span>云端覆盖</span>
                    <strong>
                      {catalogState === "ready"
                        ? catalogMode === "seed"
                          ? "云端返回 seed 回退"
                          : "云端数据库目录"
                        : catalogState === "loading"
                          ? "载入中"
                          : "未载入"}
                    </strong>
                  </li>
                </ul>
              </div>
            </div>
          </section>
        </>
      )}

      <div className="step-footer-bar">
        <div className="step-footer-note">
          <Icon name="info" size={14} />
          <span>已收藏 {favorites.length} 个方向；至少 2 个可以并排比较。下一步从收藏中选择 1 个暂定，随时可改。</span>
        </div>
        <div className="step-footer-actions">
          <Button variant="ghost" size="md" onClick={() => router.push("/choice")}>
            跳过这一步
          </Button>
          <Button variant="primary" size="md" onClick={handleContinue}>
            进入暂定方向
            <Icon name="arrow-right" size={15} />
          </Button>
        </div>
      </div>

      <p className="step-back-strip">
        想先回去补画像？
        <button type="button" className="link-inline" onClick={() => router.push("/explore")}>
          返回第 1 步
          <Icon name="chevron-right" size={13} />
        </button>
        <span className="step-back-sep">·</span>
        <button type="button" className="link-inline" onClick={() => router.push("/library")}>
          去资料库查看来源
          <Icon name="chevron-right" size={13} />
        </button>
      </p>
    </div>
  );
}
