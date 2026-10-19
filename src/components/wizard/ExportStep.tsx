"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PlanResult } from "@/lib/contracts/plan";
import type { Run } from "@/lib/contracts/run";
import type { DirectionId } from "@/lib/contracts/common";
import { getDirection } from "@/lib/content";
import {
  cloudConfigured,
  createAnonymousSession,
  friendlyErrorMessage,
  errorCodeOf,
  getArtifactDownload,
  getPlan,
  newIdempotencyKey,
  parseExportResult,
  pollRunUntilDone,
  runFailureMessage,
  runStageLabel,
  submitRun,
  type ExportRunOutcome
} from "@/lib/api-client";
import {
  readCloudProfile,
  readLocalProgress,
  readPlanCache,
  updateLocalProgress,
  useLocalProgress,
  type CachedPlan
} from "@/lib/local-progress/store";
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Icon,
  ListBlock,
  ProgressBar,
  formatDateTime,
  formatDate
} from "@/components/ui/primitives";
import { CitationList } from "@/components/ui/CitationCard";
import { RestartProgress } from "@/components/layout/RestartProgress";
import { PlanDetail, pickCurrentVersion } from "./PlanDetail";
import { StepHeader } from "./StepHeader";

type Phase = "boot" | "blocked" | "local" | "generating" | "ready" | "error";
type Stage = "session" | "submit" | "polling" | "download";

const PENDING_EXPORT_RUN_KEY = "campus-pathway:pending-export-run:v1";

const STAGE_LABELS: Record<Stage, string> = {
  session: "确认匿名会话",
  submit: "提交导出任务",
  polling: "渲染 PDF",
  download: "获取短期下载链接"
};

const STAGE_PROGRESS: Record<Stage, number> = {
  session: 5,
  submit: 12,
  polling: 45,
  download: 90
};

type CachedPlanMeta = {
  directionId: string | null;
  version: number | null;
  planVersionId: string | null;
  rulesVersion: string | null;
  profileVersion: number | null;
  corpusVersion: string | null;
};

function readPendingExport(): { run_id: string; plan_id: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_EXPORT_RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { run_id?: unknown; plan_id?: unknown };
    if (typeof parsed.run_id === "string" && typeof parsed.plan_id === "string") {
      return { run_id: parsed.run_id, plan_id: parsed.plan_id };
    }
    return null;
  } catch {
    return null;
  }
}

function writePendingExport(value: { run_id: string; plan_id: string } | null) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(PENDING_EXPORT_RUN_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(PENDING_EXPORT_RUN_KEY);
  } catch {
    // ignore
  }
}

function findSourcesCutoff(result: PlanResult | null, rawRunResult: unknown): string | null {
  const candidates: unknown[] = [];
  if (result) {
    const record = result as unknown as Record<string, unknown>;
    candidates.push(record.sources_cutoff, record.data_cutoff, record.corpus_cutoff, record.sources_through);
  }
  if (rawRunResult && typeof rawRunResult === "object") {
    const record = rawRunResult as Record<string, unknown>;
    candidates.push(record.sources_cutoff, record.data_cutoff, record.corpus_cutoff, record.sources_through);
  }
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") return formatDate(candidate);
  }
  if (result) {
    for (const citation of result.evidence) {
      const locator = citation.locator ?? {};
      for (const key of ["statistical_cutoff", "retrieved_at", "retrieved", "extracted_at", "published_at"]) {
        const value = locator[key];
        if (typeof value === "string" && value.trim() !== "") return `${formatDate(value)}（来自引用条目 ${key}）`;
      }
    }
  }
  return null;
}

export function ExportStep() {
  const router = useRouter();
  const cloud = cloudConfigured();
  const { progress, hydrated } = useLocalProgress();
  const [phase, setPhase] = useState<Phase>("boot");
  const [stage, setStage] = useState<Stage>("session");
  const [run, setRun] = useState<Run | null>(null);
  const [rawResult, setRawResult] = useState<unknown>(null);
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [meta, setMeta] = useState<CachedPlanMeta>({
    directionId: null,
    version: null,
    planVersionId: null,
    rulesVersion: null,
    profileVersion: null,
    corpusVersion: null
  });
  const [cachedPlan, setCachedPlan] = useState<CachedPlan | null>(null);
  const [artifact, setArtifact] = useState<ExportRunOutcome | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const [urlFetchedAt, setUrlFetchedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [exportedAt, setExportedAt] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bootStartedRef = useRef(false);
  const autoExportRef = useRef(false);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  useEffect(() => {
    if (!hydrated || bootStartedRef.current) return;
    bootStartedRef.current = true;
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  useEffect(() => {
    if (phase !== "generating") {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  function applyCachedMeta(cache: CachedPlan) {
    setMeta({
      directionId: cache.direction_id,
      version: cache.version,
      planVersionId: cache.current_version_id,
      rulesVersion: cache.rules_version,
      profileVersion: cache.profile_version,
      corpusVersion: cache.corpus_version
    });
  }

  async function bootstrap() {
    const current = readLocalProgress();
    const cache = readPlanCache();
    if (cache) setCachedPlan(cache);
    if (cache && current?.plan_id && cache.plan_id === current.plan_id) {
      setPlanResult(cache.result);
      applyCachedMeta(cache);
    }

    if (!current) {
      setPhase("blocked");
      return;
    }
    if (!cloud) {
      setPhase("local");
      return;
    }
    let planId = current.plan_id;
    if (!planId && cache) planId = cache.plan_id;
    if (!planId) {
      setPhase("blocked");
      return;
    }
    let resolvedVersionId: string | null = cache?.current_version_id ?? meta.planVersionId;

    const pending = readPendingExport();
    if (pending && pending.plan_id === planId) {
      await resumePendingExport(pending.run_id, planId);
      return;
    }

    if (!planResult) {
      try {
        const loaded = await getPlan(planId);
        const version = pickCurrentVersion(loaded);
        if (version?.result) {
          resolvedVersionId = version.version_id;
          setPlanResult(version.result);
          setMeta({
            directionId: loaded.direction_id,
            version: version.version,
            planVersionId: version.version_id,
            rulesVersion: version.rules_version,
            profileVersion: version.profile_version,
            corpusVersion: version.corpus_version
          });
        } else if (!cache?.result) {
          setPhase("blocked");
          setNotice("方案详情暂时没有返回完整结果，先回到第 4 步刷新方案，再导出。");
          return;
        }
      } catch (caught) {
        if (!cache?.result) {
          setError(friendlyErrorMessage(caught));
          setPhase("error");
          return;
        }
      }
    }

    if (autoExportRef.current) return;
    autoExportRef.current = true;
    await startExport(planId, resolvedVersionId);
  }

  async function resumePendingExport(runId: string, planId: string) {
    setPhase("generating");
    setStage("polling");
    setNotice("检测到上次未完成的导出任务，正在恢复等待。");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { run: finalRun } = await pollRunUntilDone(runId, {
        signal: controller.signal,
        onUpdate: (nextRun) => setRun(nextRun)
      });
      writePendingExport(null);
      if (finalRun.status !== "succeeded") {
        setError(runFailureMessage(finalRun));
        setPhase("error");
        return;
      }
      setRawResult(finalRun.result);
      const outcome = parseExportResult(finalRun);
      if (!outcome) {
        setError("导出任务已完成，但没有返回可下载的 PDF 编号。请重试。");
        setPhase("error");
        return;
      }
      await finishExport(outcome, planId, controller.signal);
    } catch (caught) {
      const code = errorCodeOf(caught);
      if (code === "aborted") return;
      setError(friendlyErrorMessage(caught));
      setPhase("error");
    }
  }

  async function startExport(planId: string, planVersionId: string | null = meta.planVersionId) {
    setError(null);
    setPhase("generating");
    setStage("session");
    setRun(null);
    setArtifact(null);
    setDownloadUrl(null);
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    try {
      await createAnonymousSession(controller.signal);
      setStage("submit");
      const cloudProfile = readCloudProfile();
      const ack = await submitRun(
        {
          kind: "export",
          idempotency_key: newIdempotencyKey(),
          plan_id: planId,
          ...(planVersionId ? { plan_version_id: planVersionId } : {}),
          ...(cloudProfile
            ? { profile_id: cloudProfile.profile_id, profile_version: cloudProfile.version }
            : {})
        },
        controller.signal
      );
      writePendingExport({ run_id: ack.runId, plan_id: planId });
      setStage("polling");
      const { run: finalRun } = await pollRunUntilDone(ack.runId, {
        signal: controller.signal,
        onUpdate: (nextRun) => setRun(nextRun)
      });
      writePendingExport(null);
      if (finalRun.status !== "succeeded") {
        setError(runFailureMessage(finalRun));
        setPhase("error");
        return;
      }
      setRawResult(finalRun.result);
      const outcome = parseExportResult(finalRun);
      if (!outcome) {
        setError("导出任务已完成，但没有返回可下载的 PDF 编号。请重试。");
        setPhase("error");
        return;
      }
      await finishExport(outcome, planId, controller.signal);
    } catch (caught) {
      writePendingExport(null);
      const code = errorCodeOf(caught);
      if (code === "aborted") return;
      setError(friendlyErrorMessage(caught));
      setPhase("error");
    }
  }

  async function finishExport(outcome: ExportRunOutcome, planId: string, signal: AbortSignal) {
    setArtifact(outcome);
    setStage("download");
    const download = await getArtifactDownload(outcome.artifactId, signal);
    setDownloadUrl(download.url);
    setExpiresIn(download.expiresInSeconds);
    setUrlFetchedAt(Date.now());
    const exportedIso = new Date().toISOString();
    setExportedAt(exportedIso);
    updateLocalProgress((draft) => {
      if (draft.plan_id === planId || !draft.plan_id) {
        draft.plan_id = planId;
        draft.exported_at = exportedIso;
      }
      return draft;
    });
    setPhase("ready");
  }

  async function refreshDownloadUrl() {
    if (!artifact) return;
    try {
      const download = await getArtifactDownload(artifact.artifactId);
      setDownloadUrl(download.url);
      setExpiresIn(download.expiresInSeconds);
      setUrlFetchedAt(Date.now());
      setNotice("已刷新短期下载链接。链接只在短时间内有效，请尽快下载。");
    } catch (caught) {
      setError(friendlyErrorMessage(caught));
    }
  }

  function handleRetry() {
    const current = readLocalProgress();
    const cache = readPlanCache();
    const planId = current?.plan_id ?? cache?.plan_id;
    if (!planId || !cloud) {
      void bootstrap();
      return;
    }
    autoExportRef.current = true;
    void startExport(planId);
  }

  function renderGenerating() {
    const progressValue = run ? Math.max(run.progress, STAGE_PROGRESS.polling) : STAGE_PROGRESS[stage];
    return (
      <section className="panel run-panel" aria-labelledby="export-run-title" aria-live="polite">
        <div className="panel-head">
          <div>
            <p className="eyebrow">导出中</p>
            <h2 id="export-run-title">{STAGE_LABELS[stage]}</h2>
          </div>
          <Badge tone="accent">{run ? runStageLabel(run.status) : STAGE_LABELS[stage]}</Badge>
        </div>
        <ProgressBar value={progressValue} label="导出进度" />
        <div className="run-meta">
          <span>
            <Icon name="clock" size={13} /> 已等待 {elapsed} 秒
          </span>
          <span>PDF 在服务端渲染完成后，会返回约 60 秒有效的短期签名链接。</span>
        </div>
        <p className="panel-note">
          流程：确认匿名会话 → 提交 kind=export 任务 → 轮询任务状态 → 服务端验权后签发下载地址。页面不会显示或记录签名链接。
        </p>
      </section>
    );
  }

  function renderSummary() {
    const directionInfo = getDirection((meta.directionId as DirectionId | null) ?? null);
    const cutoff = findSourcesCutoff(planResult, rawResult);
    const pendingActions = planResult?.actions.filter((action) => action.status === "pending_verification") ?? [];
    return (
      <>
        <section className="panel export-hero" aria-labelledby="export-hero-title">
          <div className="export-hero-main">
            <p className="eyebrow">第 5 步 · 导出分享</p>
            <h2 id="export-hero-title">
              {downloadUrl ? "你的方案 PDF 已准备好" : "方案已就绪，可以生成 PDF"}
            </h2>
            <p className="panel-note">
              这份 PDF 会带上引用编号、规则版本、资料版本与待核验项；它明确写明这是<strong>自编轻测与自评</strong>，不是正式测评或就业承诺。
            </p>
            <div className="export-actions">
              {downloadUrl ? (
                <a
                  className="btn btn-primary btn-lg"
                  href={downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="download" size={17} />
                  下载 PDF
                </a>
              ) : (
                <Button variant="primary" size="lg" onClick={handleRetry} disabled={!cloud}>
                  <Icon name="download" size={17} />
                  {cloud ? "生成 PDF" : "云端未启用"}
                </Button>
              )}
              {downloadUrl ? (
                <Button variant="secondary" size="lg" onClick={refreshDownloadUrl}>
                  <Icon name="refresh" size={15} />
                  刷新下载链接
                </Button>
              ) : null}
              <Button variant="ghost" size="lg" onClick={() => router.push("/plan")}>
                回到行动方案
              </Button>
            </div>
            {downloadUrl ? (
              <p className="export-expiry">
                <Icon name="clock" size={13} />
                下载链接短期有效{expiresIn ? `（约 ${expiresIn} 秒）` : ""}，过期后点「刷新下载链接」重新获取；页面不会展示链接内容或 token。
                {urlFetchedAt ? ` 获取于 ${formatDateTime(new Date(urlFetchedAt).toISOString())}` : ""}
              </p>
            ) : null}
            {exportedAt ? (
              <p className="panel-note">
                导出完成时间：{formatDateTime(exportedAt)}
                {artifact?.artifact
                  ? ` · 文件大小 ${artifact.artifact.bytes !== null ? `${Math.round((artifact.artifact.bytes / 1024) * 10) / 10} KB` : "未知"}`
                  : ""}
              </p>
            ) : null}
            {artifact?.artifact?.sha256 ? (
              <p className="panel-note mono-note">文件校验 SHA-256：{artifact.artifact.sha256.slice(0, 24)}…（完整值不在页面展示）</p>
            ) : null}
          </div>
          <div className="export-hero-side">
            <div className="export-side-block">
              <span className="export-side-label">方向</span>
              <strong>{directionInfo?.title ?? meta.directionId ?? "未提供"}</strong>
            </div>
            <div className="export-side-block">
              <span className="export-side-label">方案版本</span>
              <strong>{meta.version !== null ? `v${meta.version}` : "未提供"}</strong>
            </div>
            <div className="export-side-block">
              <span className="export-side-label">规则版本</span>
              <strong>{meta.rulesVersion ?? "未提供"}</strong>
            </div>
            <div className="export-side-block">
              <span className="export-side-label">资料截止日</span>
              <strong>{cutoff ?? "未提供（以引用条目的检索时间为准）"}</strong>
            </div>
            <div className="export-side-block">
              <span className="export-side-label">画像版本</span>
              <strong>{meta.profileVersion !== null ? `v${meta.profileVersion}` : "未提供"}</strong>
            </div>
            <div className="export-side-block">
              <span className="export-side-label">资料版本</span>
              <strong>{meta.corpusVersion ?? "未提供"}</strong>
            </div>
          </div>
        </section>

        <div className="export-two-col">
          <section className="panel" aria-labelledby="export-contains-title">
            <div className="panel-head">
              <div>
                <p className="eyebrow">PDF 内容</p>
                <h2 id="export-contains-title">这份 PDF 会包含</h2>
              </div>
            </div>
            <ListBlock
              items={[
                "你的暂定方向、理由、未知与下次复核时间（来自本设备记录）",
                "描述性画像与自编轻测说明（明确是自评，不是专业测评）",
                "按当前学期 / 下学期 / 更晚分组的行动清单，区分机器建议与我的调整",
                "课程、竞赛、学分与数据缺口；缺失处显示资料未就绪",
                "引用条目：编号、标题、定位、摘录与核验状态",
                `规则版本 ${meta.rulesVersion ?? "—"} · 资料版本 ${meta.corpusVersion ?? "—"}`
              ]}
            />
          </section>
          <section className="panel" aria-labelledby="export-not-title">
            <div className="panel-head">
              <div>
                <p className="eyebrow">边界</p>
                <h2 id="export-not-title">这份 PDF 不是什么</h2>
              </div>
            </div>
            <ListBlock
              tone="warn"
              items={[
                "不是正式心理测评、职业能力测评或就业承诺",
                "不包含就业率、薪资、录取概率或报考资格结论",
                "不代表学校官方就业分类；六个方向是产品导航分类",
                "资料未载入处不会用看起来合理的数字补齐"
              ]}
            />
          </section>
        </div>

        <section className="panel" aria-labelledby="export-pending-title">
          <div className="panel-head">
            <div>
              <p className="eyebrow">待核验项</p>
              <h2 id="export-pending-title">导出前请留意</h2>
            </div>
            <Badge tone={pendingActions.length > 0 ? "warn" : "ok"}>{pendingActions.length} 项待核验行动</Badge>
          </div>
          {planResult && planResult.gaps.length > 0 ? (
            <div className="export-gaps">
              <p className="panel-title">
                <Icon name="alert" size={15} /> 数据缺口
              </p>
              <ul className="gap-card-list">
                {planResult.gaps.map((gap, index) => (
                  <li className="gap-card" key={`${gap.code}-${index}`}>
                    <Icon name="alert" size={15} />
                    <div>
                      <p className="gap-card-code">{gap.code}</p>
                      <p className="gap-card-message">{gap.message}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {pendingActions.length > 0 ? (
            <ul className="export-pending-list">
              {pendingActions.map((action) => (
                <li key={action.action_id}>
                  <Badge tone="warn">待核验</Badge>
                  <span>{action.title}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="panel-note">本次没有标记为待核验的行动；仍建议按引用条目逐项核对官方资料。</p>
          )}
          {planResult && planResult.warnings.length > 0 ? (
            <ul className="callout-list">
              {planResult.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="panel" aria-labelledby="export-citations-title">
          <div className="panel-head">
            <div>
              <p className="eyebrow">引用</p>
              <h2 id="export-citations-title">PDF 中引用的来源</h2>
            </div>
            <Badge tone="muted">{planResult?.evidence.length ?? 0} 条</Badge>
          </div>
          {planResult ? (
            <CitationList citations={planResult.evidence} />
          ) : (
            <EmptyState compact title="引用未载入" description="方案结果中没有可展示的引用条目。" />
          )}
        </section>

        <section className="export-done" aria-labelledby="export-done-title">
          <div>
            <p className="eyebrow">接下来</p>
            <h2 id="export-done-title">带着可核对的方案继续走</h2>
            <p>你可以回到行动方案勾选完成、修改时间，或者重新开始一次新的探索；资料库随时可以查来源。</p>
          </div>
          <div className="export-done-actions">
            <Link href="/plan" className="btn btn-primary btn-md">
              <Icon name="flag" size={15} /> 继续我的方案
            </Link>
            <Link href="/library" className="btn btn-secondary btn-md">
              <Icon name="book" size={15} /> 查资料
            </Link>
            <RestartProgress label="重新开始" />
          </div>
        </section>
      </>
    );
  }

  function renderLocalMode() {
    const directionInfo = getDirection(
      (meta.directionId as DirectionId | null) ?? progress?.provisional_direction ?? null
    );
    return (
      <div className="plan-state-stack">
        <Callout tone="warn" title="本地演示模式：导出空态">
          <p>
            当前未配置云端，因此不能生成 PDF。页面不会提供伪造的下载按钮或虚构的文件。完成 Step 1–3 的本地进度后，这里会显示导出空态说明；配置云端并生成方案后即可下载带引用的 PDF。
          </p>
        </Callout>
        <section className="panel" aria-labelledby="export-local-title">
          <div className="panel-head">
            <div>
              <p className="eyebrow">导出空态</p>
              <h2 id="export-local-title">本设备已保存的内容</h2>
            </div>
            <Badge tone="muted">仅本地</Badge>
          </div>
          {progress ? (
            <ul className="kv-list kv-list-lg">
              <li>
                <span>暂定方向</span>
                <strong>{directionInfo?.title ?? "未选择"}</strong>
              </li>
              <li>
                <span>行动方案</span>
                <strong>{progress.plan_id ? "已生成（云端）" : "尚未生成"}</strong>
              </li>
              <li>
                <span>上次导出</span>
                <strong>{progress.exported_at ? formatDateTime(progress.exported_at) : "未导出"}</strong>
              </li>
              <li>
                <span>PDF 状态</span>
                <strong>云端未启用，无法渲染</strong>
              </li>
            </ul>
          ) : (
            <EmptyState compact title="还没有本地进度" description="先完成第 1 步与第 3 步，再回来查看导出空态。" />
          )}
          <div className="export-actions">
            <Button variant="primary" size="md" onClick={() => router.push("/explore")}>
              先做自我探索
            </Button>
            <Button variant="secondary" size="md" onClick={() => router.push("/choice")}>
              设置暂定方向
            </Button>
            <Button variant="ghost" size="md" onClick={() => router.push("/library")}>
              去资料库
            </Button>
          </div>
        </section>
        {cachedPlan ? (
          <div className="plan-state-stack">
            <Callout tone="plain" title="检测到本设备缓存方案">
              <p>这是上次成功加载的方案（缓存于 {formatDateTime(cachedPlan.fetched_at)}）。云端未启用时无法重新渲染 PDF，但可以回看内容。</p>
            </Callout>
            <PlanDetail
              plan={null}
              result={cachedPlan.result}
              directionId={cachedPlan.direction_id}
              localOrder={[]}
              evidence={cachedPlan.result.evidence}
              isCached
              cachedAt={cachedPlan.fetched_at}
              patchingActionId={null}
              actionErrors={{}}
              onMoveOrder={() => undefined}
              onPatch={() => undefined}
            />
          </div>
        ) : null}
      </div>
    );
  }

  function renderBlocked() {
    return (
      <section className="panel blocked-panel" aria-labelledby="export-blocked-title">
        <div className="panel-head">
          <div>
            <p className="eyebrow">还不能导出</p>
            <h2 id="export-blocked-title">先完成行动方案</h2>
          </div>
          <Badge tone="warn">缺少方案</Badge>
        </div>
        <EmptyState
          icon="download"
          title="还没有可导出的方案"
          description="导出 PDF 需要先在第 4 步生成行动方案。没有方案时不会生成空 PDF，也不会编造内容。"
        />
        <div className="local-actions">
          <Button variant="primary" size="md" onClick={() => router.push("/plan")}>
            去第 4 步生成方案
            <Icon name="arrow-right" size={14} />
          </Button>
          <Button variant="ghost" size="md" onClick={() => router.push("/library")}>
            先去资料库查资料
          </Button>
        </div>
        {notice ? <p className="panel-note">{notice}</p> : null}
      </section>
    );
  }

  function renderError() {
    return (
      <div className="plan-state-stack">
        <Callout tone="danger" title="导出没有完成" icon="alert">
          <p>{error}</p>
          <p>没有生成可下载文件，也不会展示伪造链接。你可以重试，或先回行动方案确认内容。</p>
        </Callout>
        <div className="local-actions">
          <Button variant="primary" size="md" onClick={handleRetry} disabled={!cloud}>
            <Icon name="refresh" size={14} /> 重试导出
          </Button>
          <Button variant="secondary" size="md" onClick={() => router.push("/plan")}>
            回到行动方案
          </Button>
          <Button variant="ghost" size="md" onClick={() => router.push("/library")}>
            去资料库
          </Button>
        </div>
        {planResult ? <section className="export-summary-lite">{renderSummaryLite()}</section> : null}
      </div>
    );
  }

  function renderSummaryLite() {
    if (!planResult) return null;
    return (
      <section className="panel" aria-labelledby="export-lite-title">
        <div className="panel-head">
          <div>
            <p className="eyebrow">本地已保存的方案内容</p>
            <h2 id="export-lite-title">导出失败，但方案内容仍在</h2>
          </div>
          <Badge tone="muted">{planResult.actions.length} 项行动</Badge>
        </div>
        <ul className="kv-list">
          <li>
            <span>规则版本</span>
            <strong>{planResult.rules_version || "未提供"}</strong>
          </li>
          <li>
            <span>学分</span>
            <strong>{planResult.credits === null ? "资料未就绪" : `${planResult.credits} 学分`}</strong>
          </li>
          <li>
            <span>引用</span>
            <strong>{planResult.evidence.length} 条</strong>
          </li>
        </ul>
        <CitationList citations={planResult.evidence} dense />
      </section>
    );
  }

  return (
    <div className="step-page">
      <StepHeader
        index={5}
        title="带走一份可核对的方案 PDF"
        description={
          <>
            PDF 会带上引用、资料版本、规则版本与待核验项，并写明这是<strong>自编轻测与自评</strong>，不是正式测评或就业承诺。下载链接短期有效，不会在页面显示 token。
          </>
        }
        actions={
          <>
            <Button variant="ghost" size="md" onClick={() => router.push("/plan")}>
              返回行动方案
            </Button>
            {progress?.exported_at ? (
              <Badge tone="ok">已导出过</Badge>
            ) : (
              <Badge tone="muted">导出前请核对引用</Badge>
            )}
          </>
        }
        meta={
          <span className="step-meta-row">
            <span className="step-meta-item">
              <Icon name="flag" size={13} /> {getDirection(progress?.provisional_direction ?? null)?.short_title ?? "未暂定方向"}
            </span>
            <span className="step-meta-item">
              <Icon name="database" size={13} /> {cloud ? "云端导出已启用" : "本地演示模式"}
            </span>
            {progress?.exported_at ? (
              <span className="step-meta-item">
                <Icon name="check" size={13} /> 上次导出 {formatDateTime(progress.exported_at)}
              </span>
            ) : null}
          </span>
        }
      />

      {notice ? <p className="inline-note">{notice}</p> : null}

      {phase === "boot" ? (
        <section className="panel run-panel" aria-hidden="true">
          <div className="skeleton-line" />
          <div className="skeleton-line skeleton-line-short" />
        </section>
      ) : null}
      {phase === "generating" ? renderGenerating() : null}
      {phase === "ready" ? renderSummary() : null}
      {phase === "local" ? renderLocalMode() : null}
      {phase === "blocked" ? renderBlocked() : null}
      {phase === "error" ? renderError() : null}

      {phase !== "ready" ? (
        <p className="panel-note export-disclaimer">
          <Icon name="info" size={13} />
          提示：即使没有云端导出，你也可以回到行动方案查看本设备保存的内容；资料库可以查看来源与引用规则。
        </p>
      ) : null}
    </div>
  );
}
