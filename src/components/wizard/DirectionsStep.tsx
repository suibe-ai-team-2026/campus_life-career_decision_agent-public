"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DirectionCard } from "@/lib/contracts/catalog";
import type { DirectionId } from "@/lib/contracts/common";
import type { Run } from "@/lib/contracts/run";
import {
  cloudConfigured,
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
  COVERAGE_LOCAL_LABEL,
  DIRECTIONS,
  DIRECTIONS_CATEGORY_VERSION,
  DIRECTIONS_DISCLAIMER,
  directionCoverage
} from "@/lib/content";
import {
  readLocalProgress,
  updateLocalProgress,
  useLocalProgress,
  type LocalProgressV1
} from "@/lib/local-progress/store";
import { Badge, Button, Callout, Icon, ListBlock, ProgressBar, SectionHeading } from "@/components/ui/primitives";
import { CitationList } from "@/components/ui/CitationCard";
import { StepHeader } from "./StepHeader";

type CoverageMap = Partial<Record<DirectionId, DirectionCard["coverage"]>>;

export function DirectionsStep() {
  const router = useRouter();
  const { progress, hydrated } = useLocalProgress();
  const favorites = useMemo(() => (progress?.favorites ?? []) as DirectionId[], [progress?.favorites]);
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

  const favoriteDirections = useMemo(
    () => favorites.map((id) => DIRECTIONS.find((direction) => direction.direction_id === id)).filter((item): item is (typeof DIRECTIONS)[number] => Boolean(item)),
    [favorites]
  );

  function toggleFavorite(directionId: DirectionId) {
    setFavoriteError(null);
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
    try {
      const directionIds = favorites.slice(0, 3);
      const ack = await submitRun({
        kind: "compare",
        direction_ids: directionIds,
        idempotency_key: newIdempotencyKey()
      });
      const { run } = await pollRunUntilDone(ack.runId, {
        signal: controller.signal,
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
      setAiState("done");
    } catch (error) {
      setAiError(friendlyErrorMessage(error));
      setAiState("error");
    }
  }

  const ready = hydrated && progress !== null;

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
                const coverageView = directionCoverage(direction, coverage[direction.direction_id] ?? null);
                const coverageLabel =
                  catalogState === "loading" ? "云端证据载入中" : catalogState === "error" ? COVERAGE_LOCAL_LABEL : coverageView.label;
                return (
                  <article className={isFavorite ? "direction-card is-favorite" : "direction-card"} key={direction.direction_id}>
                    <header className="direction-card-head">
                      <div>
                        <p className="direction-kicker">{direction.short_title}</p>
                        <h3>{direction.title}</h3>
                      </div>
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
                    </header>
                    <p className="direction-summary">{direction.summary}</p>

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
                        <Badge tone={coverageView.pending || catalogState !== "ready" ? "warn" : "ok"}>{coverageLabel}</Badge>
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
                            <Badge tone={view.pending ? "warn" : "ok"}>{catalogState === "loading" ? "载入中" : view.label}</Badge>
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
                  <ProgressBar value={aiRun?.progress ?? 0} label={`AI 对比 · ${runStageLabel(aiRun?.status ?? "queued")}`} />
                  <p className="panel-note">任务运行中。页面隐藏时轮询会自动放慢，避免浪费资源。</p>
                </div>
              ) : null}
              {aiState === "error" && aiError ? (
                <Callout tone="warn" title="AI 对比暂不可用">
                  <p>{aiError}</p>
                  <p>可以继续使用上方的资料并排对比；它不依赖云端。</p>
                </Callout>
              ) : null}
              {aiState === "done" && aiResult ? (
                <div className="ai-result">
                  <p className="panel-title">
                    <Icon name="sparkles" size={15} /> AI 对比解释
                  </p>
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
