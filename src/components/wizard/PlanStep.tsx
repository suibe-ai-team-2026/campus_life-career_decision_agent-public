"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DirectionId } from "@/lib/contracts/common";
import type { Plan, PlanResult } from "@/lib/contracts/plan";
import type { ProfileInput } from "@/lib/contracts/profile";
import type { Run } from "@/lib/contracts/run";
import { scoreAssessment } from "@/lib/assessment/scoring";
import { excludedDirectionReasons, isDirectionAllowed } from "@/lib/career/pathway";
import { ASSESSMENT, ASSESSMENT_VERSION, DIRECTIONS, getDirection } from "@/lib/content";
import {
  cloudConfigured,
  createAnonymousSession,
  errorCodeOf,
  friendlyErrorMessage,
  getPlan,
  newIdempotencyKey,
  parsePlanRunResult,
  patchPlanAction,
  pollRunUntilDone,
  profileFingerprint,
  runFailureMessage,
  saveProfile,
  submitRun,
  cancelRun,
  type ActionPatchInput,
  type PlanRunOutcome,
  type RunEvent
} from "@/lib/api-client";
import {
  readChoiceDetail,
  readCloudProfile,
  readExplorePrefs,
  readLocalProgress,
  readPlanCache,
  readPlanOrder,
  pushStaleChoiceHistory,
  updateLocalProgress,
  useLocalProgress,
  usePlanCache,
  writeCloudProfile,
  writePlanCache,
  writePlanOrder,
  type CachedPlan,
  type LocalProgressV1
} from "@/lib/local-progress/store";
import { toTraceEvents } from "@/lib/agent-trace";
import { Badge, Button, Callout, EmptyState, Icon, RunStatus, formatDateTime } from "@/components/ui/primitives";
import { AgentTrace } from "@/components/run/AgentTrace";
import { ResearchToggle } from "@/components/run/ResearchToggle";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PlanDetail, pickCurrentVersion } from "./PlanDetail";
import type { ActionOverrides } from "./PlanActionCard";

type Phase = "boot" | "blocked" | "local" | "generating" | "ready" | "error";
type Stage = "session" | "profile" | "submit" | "polling" | "loading";

const PENDING_PLAN_RUN_KEY = "campus-pathway:pending-plan-run:v1";

const STAGE_LABELS: Record<Stage, string> = {
  session: "正在唤醒执行环境",
  profile: "正在保存画像",
  submit: "正在提交规划任务",
  polling: "正在生成方案",
  loading: "正在整理依据"
};

const RESEARCH_TOGGLE_DESCRIPTION = "默认关闭；开启后会检索外部网页，结果未经核验，只作补充线索。";

type PendingPlanRun = { run_id: string; direction_id: DirectionId; started_at: string };

function readPendingPlanRun(): PendingPlanRun | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_PLAN_RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingPlanRun>;
    if (typeof parsed.run_id === "string" && typeof parsed.direction_id === "string") {
      return {
        run_id: parsed.run_id,
        direction_id: parsed.direction_id as DirectionId,
        started_at: typeof parsed.started_at === "string" ? parsed.started_at : new Date().toISOString()
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writePendingPlanRun(value: PendingPlanRun | null) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(PENDING_PLAN_RUN_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(PENDING_PLAN_RUN_KEY);
  } catch {
    // sessionStorage can be unavailable; the flow still works without resume.
  }
}

function hasCloudProfile(progress: LocalProgressV1): boolean {
  return Boolean(
    progress.profile.school.trim().length >= 2 &&
      progress.profile.major.trim().length >= 2 &&
      progress.profile.enrollment_year &&
      progress.profile.current_term.length >= 2 &&
      progress.profile.completed_at
  );
}

function buildProfileInput(progress: LocalProgressV1): ProfileInput {
  const prefs = readExplorePrefs();
  const scored = scoreAssessment(ASSESSMENT, progress.profile.answers);
  return {
    school: progress.profile.school.trim(),
    major: progress.profile.major.trim(),
    enrollment_year: progress.profile.enrollment_year ?? new Date().getFullYear() - 1,
    current_term: progress.profile.current_term,
    assessment_version: ASSESSMENT_VERSION,
    exploration_status: progress.profile.skipped ? "skipped" : "completed",
    answers: progress.profile.answers,
    scores: scored.scores,
    preferences: {
      ...(prefs.weekly_hours !== null ? { weekly_hours: prefs.weekly_hours } : {}),
      ...(prefs.monthly_budget_cny !== null ? { monthly_budget_cny: prefs.monthly_budget_cny } : {}),
      ...(progress.reason_summary.trim() ? { decision_reason: progress.reason_summary.trim() } : {}),
      pathway: prefs.pathway
    }
  };
}

function planFromCache(cache: CachedPlan): Plan {
  const versionId = cache.current_version_id ?? `${cache.plan_id}-cache`;
  return {
    plan_id: cache.plan_id,
    profile_id: "",
    direction_id: cache.direction_id,
    current_version_id: versionId,
    versions: [
      {
        version_id: versionId,
        plan_id: cache.plan_id,
        version: cache.version ?? 1,
        profile_version: cache.profile_version ?? 1,
        rules_version: cache.rules_version ?? "",
        corpus_version: cache.corpus_version,
        embedding_profile_id: null,
        status: cache.version_status ?? "active",
        actions: cache.actions,
        user_overrides: cache.user_overrides ?? {},
        warnings: [],
        result: cache.result,
        created_at: cache.fetched_at
      }
    ]
  };
}

function cacheFromPlan(
  planArg: Plan | null,
  result: PlanResult,
  directionId: DirectionId,
  outcome?: PlanRunOutcome | null
): CachedPlan {
  const version = pickCurrentVersion(planArg);
  const planId = planArg?.plan_id ?? outcome?.planId ?? "";
  if (!planId) throw new Error("cached_plan_requires_plan_id");
  return {
    plan_id: planId,
    direction_id: directionId,
    current_version_id: planArg?.current_version_id ?? version?.version_id ?? outcome?.planVersionId ?? null,
    version: version?.version ?? outcome?.version ?? null,
    version_status: version?.status ?? "active",
    profile_version: version?.profile_version ?? result.profile_version ?? null,
    rules_version: version?.rules_version ?? result.rules_version ?? null,
    corpus_version: version?.corpus_version ?? null,
    fetched_at: new Date().toISOString(),
    result,
    actions: version && version.actions.length > 0 ? version.actions : result.actions,
    user_overrides: (version?.user_overrides ?? {}) as Record<string, Record<string, unknown>>,
    versions: planArg
      ? planArg.versions.map((item) => ({
          version_id: item.version_id,
          version: item.version,
          status: item.status,
          created_at: item.created_at
        }))
      : []
  };
}

export function PlanStep() {
  const router = useRouter();
  const cloud = cloudConfigured();
  const { progress, hydrated } = useLocalProgress();
  const { cache, hydrated: cacheHydrated } = usePlanCache();
  const [phase, setPhase] = useState<Phase>("boot");
  const [stage, setStage] = useState<Stage>("session");
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [webSupplement, setWebSupplement] = useState(false);
  const [runWebSupplement, setRunWebSupplement] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [viewIsCached, setViewIsCached] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [localOrder, setLocalOrder] = useState<string[]>([]);
  const [patchingActionId, setPatchingActionId] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [switchTarget, setSwitchTarget] = useState<DirectionId | null>(null);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [showCached, setShowCached] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const bootStartedRef = useRef(false);
  const autoRunRef = useRef(false);
  const phaseRef = useRef<Phase>("boot");
  phaseRef.current = phase;

  const direction = progress?.provisional_direction ?? null;
  const directionInfo = getDirection(direction);
  const backupDirectionInfo = getDirection(progress?.backup_direction ?? null);
  const favoriteDirections = useMemo(
    () => DIRECTIONS.filter((item) => (progress?.favorites ?? []).includes(item.direction_id)),
    [progress?.favorites]
  );
  const switchOptions = useMemo(() => {
    const base = favoriteDirections.length > 0 ? favoriteDirections : DIRECTIONS;
    const current = direction ? getDirection(direction) : null;
    if (current && !base.some((item) => item.direction_id === current.direction_id)) {
      return [current, ...base];
    }
    return base;
  }, [favoriteDirections, direction]);
  const profileReady = progress ? hasCloudProfile(progress) : false;
  const cacheMatches = Boolean(cache && direction && cache.direction_id === direction);
  const traceEvents = useMemo(() => toTraceEvents(events), [events]);

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
    const timer = window.setInterval(() => {
      setElapsed(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  function persistPlanView(planArg: Plan | null, planResult: PlanResult, directionId: DirectionId, cached: boolean, fetchedAt: string | null) {
    setPlan(planArg);
    setResult(planResult);
    setViewIsCached(cached);
    setCachedAt(fetchedAt);
    if (planArg) {
      setLocalOrder(readPlanOrder(planArg.plan_id));
    }
  }

  function applyLoadedPlan(loaded: Plan, fallbackResult: PlanResult | null, directionId: DirectionId) {
    const version = pickCurrentVersion(loaded);
    const planResult = version?.result ?? fallbackResult;
    if (!planResult) {
      setError({
        message: "方案版本缺少结果字段，无法展示课程与学分。可以重新生成方案，或到资料库查看引用。"
      });
      setPhase("error");
      return;
    }
    persistPlanView(loaded, planResult, directionId, false, null);
    setPhase("ready");
    try {
      const cacheValue = cacheFromPlan(loaded, planResult, directionId);
      writePlanCache(cacheValue);
      updateLocalProgress((draft) => {
        const versionId = loaded.current_version_id ?? version?.version_id ?? null;
        if (draft.plan_id !== loaded.plan_id) draft.exported_at = null;
        draft.plan_id = loaded.plan_id;
        draft.plan_version_id = versionId;
        draft.provisional_direction = directionId;
        return draft;
      });
    } catch {
      // Cache is a convenience; a write failure must not hide a valid plan.
    }
  }

  function showCachedPlan(message: string) {
    if (!cache) return;
    persistPlanView(planFromCache(cache), cache.result, cache.direction_id, true, cache.fetched_at);
    setNotice(message);
    setPhase("ready");
  }

  async function generatePlan(options: { directionId: DirectionId; existingPlanId: string | null }) {
    setError(null);
    setNotice(null);
    setPhase("generating");
    setStage("session");
    setRun(null);
    setEvents([]);
    setRunWebSupplement(webSupplement);
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    try {
      const current = readLocalProgress();
      if (!current) {
        setError({ message: "本地还没有可用的画像资料，请先完成自我探索。" });
        setPhase("error");
        return;
      }
      if (!hasCloudProfile(current)) {
        setPhase("blocked");
        return;
      }
      const pathwayPreference = readExplorePrefs().pathway;
      if (!isDirectionAllowed(options.directionId, pathwayPreference)) {
        setError({
          message:
            excludedDirectionReasons(pathwayPreference)[options.directionId] ??
            "当前方向已被你的硬约束排除，请回第 3 步重新选择。"
        });
        setPhase("error");
        return;
      }

      await createAnonymousSession(controller.signal);

      const input = buildProfileInput(current);
      const fingerprint = profileFingerprint(input);
      const cachedProfile = readCloudProfile();
      let profileId: string;
      let profileVersion: number;
      if (cachedProfile && cachedProfile.fingerprint === fingerprint) {
        profileId = cachedProfile.profile_id;
        profileVersion = cachedProfile.version;
      } else {
        setStage("profile");
        const saved = await saveProfile(input, controller.signal);
        profileId = saved.profile.profile_id;
        profileVersion = saved.profile.version;
        writeCloudProfile({
          profile_id: profileId,
          version: profileVersion,
          fingerprint,
          assessment_version: ASSESSMENT_VERSION,
          saved_at: new Date().toISOString()
        });
      }

      setStage("submit");
      const ack = await submitRun(
        {
          kind: "plan",
          idempotency_key: newIdempotencyKey(),
          profile_id: profileId,
          profile_version: profileVersion,
          direction_id: options.directionId,
          web_search: webSupplement,
          ...(options.existingPlanId ? { plan_id: options.existingPlanId } : {})
        },
        controller.signal
      );
      activeRunIdRef.current = ack.runId;
      writePendingPlanRun({ run_id: ack.runId, direction_id: options.directionId, started_at: new Date().toISOString() });
      setStage("polling");

      const { run: finalRun, events: finalEvents } = await pollRunUntilDone(ack.runId, {
        signal: controller.signal,
        onUpdate: (nextRun, nextEvents) => {
          setRun(nextRun);
          setEvents(nextEvents);
        }
      });
      writePendingPlanRun(null);
      activeRunIdRef.current = null;
      setEvents(finalEvents);

      if (finalRun.status !== "succeeded") {
        setError({ message: runFailureMessage(finalRun), code: finalRun.error_code ?? undefined });
        setPhase("error");
        return;
      }
      const outcome = parsePlanRunResult(finalRun);
      if (!outcome) {
        setError({
          message: "任务成功，但结果缺少方案编号，无法加载详情。请重新生成方案；如果问题持续，请把该情况反馈给管理员。"
        });
        setPhase("error");
        return;
      }

      setStage("loading");
      try {
        const loaded = await getPlan(outcome.planId, controller.signal);
        applyLoadedPlan(loaded, outcome.result, options.directionId);
      } catch (loadError) {
        if (loadError instanceof Error && loadError.name === "ApiError" && (loadError as { code?: string }).code === "aborted") {
          return;
        }
        // The run result already contains the plan payload; use it directly.
        persistPlanView(null, outcome.result, options.directionId, false, null);
        setPhase("ready");
        try {
          writePlanCache(cacheFromPlan(null, outcome.result, options.directionId, outcome));
          updateLocalProgress((draft) => {
            draft.plan_id = outcome.planId;
            draft.plan_version_id = outcome.planVersionId ?? null;
            draft.exported_at = null;
            return draft;
          });
        } catch {
          // ignore cache failures
        }
        setNotice("方案已生成；方案详情接口暂时不可用，当前展示的是本次生成结果。");
      }
      setNotice((previous) =>
        previous ??
        (options.existingPlanId ? "已生成新版本；旧版本会保留并标记 stale。" : null)
      );
    } catch (caught) {
      writePendingPlanRun(null);
      activeRunIdRef.current = null;
      const code = errorCodeOf(caught);
      if (code === "aborted") {
        // 只有仍属于本次生成的请求才需要收尾：用户点「停止等待」或切换方向时，
        // 调用方已经接管状态，不能覆盖。开发模式热更新等外部中断则避免卡在「生成中」。
        if (abortRef.current === controller) {
          abortRef.current = null;
          const hasPlan = Boolean(readLocalProgress()?.plan_id);
          setPhase(hasPlan ? "ready" : "blocked");
          setNotice("生成已中断，没有产生新方案。可以重新点「生成方案」。");
        }
        return;
      }
      setError({ message: friendlyErrorMessage(caught), code });
      setPhase("error");
    }
  }

  async function resumePendingRun(pending: PendingPlanRun, current: LocalProgressV1) {
    setPhase("generating");
    setStage("polling");
    setNotice("检测到上次未完成的生成任务，正在恢复等待。");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { run: finalRun } = await pollRunUntilDone(pending.run_id, {
        signal: controller.signal,
        onUpdate: (nextRun, nextEvents) => {
          setRun(nextRun);
          setEvents(nextEvents);
        }
      });
      writePendingPlanRun(null);
      if (finalRun.status !== "succeeded") {
        setError({ message: runFailureMessage(finalRun) });
        setPhase("error");
        return;
      }
      const outcome = parsePlanRunResult(finalRun);
      if (!outcome) {
        setError({ message: "恢复的任务已完成，但结果缺少方案编号。请重新生成。" });
        setPhase("error");
        return;
      }
      setStage("loading");
      try {
        const loaded = await getPlan(outcome.planId, controller.signal);
        applyLoadedPlan(loaded, outcome.result, pending.direction_id);
      } catch {
        persistPlanView(null, outcome.result, pending.direction_id, false, null);
        setPhase("ready");
      }
    } catch (caught) {
      const code = errorCodeOf(caught);
      if (code === "aborted") return;
      setError({ message: friendlyErrorMessage(caught), code });
      setPhase("error");
    }
  }

  async function bootstrap() {
    const current = readLocalProgress();
    if (!cloud) {
      setPhase("local");
      return;
    }
    if (!current || !hasCloudProfile(current)) {
      setPhase("blocked");
      return;
    }
    const chosen = current.provisional_direction;
    if (!chosen) {
      setPhase("blocked");
      return;
    }
    if (!isDirectionAllowed(chosen, readExplorePrefs().pathway)) {
      setError({
        message:
          excludedDirectionReasons(readExplorePrefs().pathway)[chosen] ??
          "当前暂定方向已被你的硬约束排除。"
      });
      setPhase("error");
      return;
    }

    const pending = readPendingPlanRun();
    if (pending && pending.direction_id === chosen) {
      await resumePendingRun(pending, current);
      return;
    }
    if (pending) writePendingPlanRun(null);

    if (current.plan_id) {
      setPhase("generating");
      setStage("loading");
      try {
        const loaded = await getPlan(current.plan_id);
        const cachedForPlan = readPlanCache();
        const fallbackResult =
          cachedForPlan && cachedForPlan.plan_id === loaded.plan_id ? cachedForPlan.result : null;
        applyLoadedPlan(loaded, fallbackResult, chosen);
        return;
      } catch (caught) {
        const code = errorCodeOf(caught);
        if (cacheMatches && cache) {
          showCachedPlan(`云端方案暂时无法加载（${friendlyErrorMessage(caught)}）。已展示本设备缓存。`);
          return;
        }
        setError({ message: friendlyErrorMessage(caught), code });
        setPhase("error");
        return;
      }
    }

    if (autoRunRef.current) return;
    autoRunRef.current = true;
    await generatePlan({ directionId: chosen, existingPlanId: null });
  }

  async function refreshPlan() {
    const planId = plan?.plan_id ?? progress?.plan_id;
    if (!planId) return;
    setRefreshing(true);
    setNotice(null);
    try {
      const loaded = await getPlan(planId);
      const version = pickCurrentVersion(loaded);
      applyLoadedPlan(loaded, version?.result ?? result, loaded.direction_id);
      setNotice("方案已刷新。");
    } catch (caught) {
      setNotice(`刷新失败：${friendlyErrorMessage(caught)}。当前展示的仍是上次加载的版本。`);
    } finally {
      setRefreshing(false);
    }
  }

  async function handlePatch(actionId: string, overrides: ActionOverrides) {
    const planId = plan?.plan_id ?? progress?.plan_id;
    const version = pickCurrentVersion(plan);
    if (!cloud) {
      setActionErrors((current) => ({ ...current, [actionId]: "云端未启用：本地演示模式下无法提交调整。" }));
      return;
    }
    if (!planId || !version) {
      setActionErrors((current) => ({ ...current, [actionId]: "方案版本尚未加载，请先刷新方案。" }));
      return;
    }
    const payload: ActionPatchInput["user_overrides"] = {};
    if (overrides.title !== undefined) payload.title = overrides.title;
    if (overrides.window !== undefined) payload.window = overrides.window;
    if (overrides.effort_hours !== undefined) payload.effort_hours = overrides.effort_hours;
    if (overrides.done !== undefined) payload.done = overrides.done;
    if (overrides.note !== undefined) payload.note = overrides.note;

    setPatchingActionId(actionId);
    setActionErrors((current) => {
      const next = { ...current };
      delete next[actionId];
      return next;
    });
    try {
      await patchPlanAction(planId, actionId, {
        expected_version: version.version,
        user_overrides: payload
      });
      const loaded = await getPlan(planId);
      const latestVersion = pickCurrentVersion(loaded);
      applyLoadedPlan(loaded, latestVersion?.result ?? result, loaded.direction_id);
      setNotice("调整已保存到方案新版本；机器建议与数字没有被修改。");
    } catch (caught) {
      const code = errorCodeOf(caught);
      if (code === "version_conflict") {
        try {
          const loaded = await getPlan(planId);
          const latestVersion = pickCurrentVersion(loaded);
          applyLoadedPlan(loaded, latestVersion?.result ?? result, loaded.direction_id);
        } catch {
          // fall through to the error message
        }
        setActionErrors((current) => ({
          ...current,
          [actionId]: "方案版本已变化，已为你刷新最新版本；请确认后重新保存。"
        }));
      } else {
        setActionErrors((current) => ({ ...current, [actionId]: friendlyErrorMessage(caught) }));
      }
    } finally {
      setPatchingActionId(null);
    }
  }

  function handleMoveOrder(nextOrder: string[]) {
    setLocalOrder(nextOrder);
    const planId = plan?.plan_id ?? progress?.plan_id;
    if (planId) writePlanOrder(planId, nextOrder);
  }

  function handleStopWaiting() {
    const runId = activeRunIdRef.current;
    abortRef.current?.abort();
    // 置空后再 abort，让 generatePlan 的 aborted 分支知道这次中断由用户主动发起。
    abortRef.current = null;
    writePendingPlanRun(null);
    activeRunIdRef.current = null;
    if (runId && cloud) {
      void cancelRun(runId).catch(() => {
        // Cancelling is best-effort; the UI already stopped polling.
      });
    }
    setError({ message: "已停止等待。任务可能仍在服务端运行；稍后可以点「刷新方案」查看是否已有结果。" });
    setPhase("error");
  }

  function handleRetry() {
    const current = readLocalProgress();
    if (!current?.provisional_direction || !cloud) {
      void bootstrap();
      return;
    }
    setError(null);
    autoRunRef.current = true;
    void generatePlan({ directionId: current.provisional_direction, existingPlanId: current.plan_id });
  }

  function confirmSwitchDirection() {
    if (!switchTarget) return;
    const target = switchTarget;
    setSwitchTarget(null);
    const previous = readLocalProgress();
    if (previous?.provisional_direction && previous.provisional_direction !== target) {
      pushStaleChoiceHistory({
        direction_id: previous.provisional_direction,
        why: previous.reason_summary,
        unknowns: readChoiceDetail().unknowns,
        revisit_on: previous.revisit_on,
        plan_id: previous.plan_id,
        plan_version_id: previous.plan_version_id
      });
    }
    updateLocalProgress((draft) => {
      draft.provisional_direction = target;
      draft.plan_id = null;
      draft.plan_version_id = null;
      draft.exported_at = null;
      return draft;
    });
    setPlan(null);
    setResult(null);
    setViewIsCached(false);
    void generatePlan({ directionId: target, existingPlanId: null });
  }

  function confirmRegenerate() {
    setRegenerateOpen(false);
    const current = readLocalProgress();
    if (!current?.provisional_direction) {
      void bootstrap();
      return;
    }
    void generatePlan({
      directionId: current.provisional_direction,
      existingPlanId: current.plan_id ?? plan?.plan_id ?? null
    });
  }

  const effectiveDirection = direction ?? plan?.direction_id ?? null;
  const cloudRunActive = phase === "generating";
  const cachedPlanAvailable = cacheMatches && cache !== null;

  function renderGenerating() {
    return (
      <section className="panel stack" aria-label="方案生成状态">
        <div className="row">
          <RunStatus state="running" label={STAGE_LABELS[stage]} detail={`${elapsed} 秒`} />
          <Button variant="ghost" size="sm" onClick={handleStopWaiting}>
            停止等待
          </Button>
        </div>
        <p className="micro">
          联网补充调研：{runWebSupplement ? "开启" : "关闭"}
          {runWebSupplement ? " · 结果未核验" : ""}
        </p>
        <AgentTrace
          events={traceEvents}
          running
          status={run?.status ?? null}
          emptyHint="正在唤醒执行环境，首次约 30 到 90 秒…"
        />
      </section>
    );
  }

  function renderFinishedTrace() {
    if (events.length === 0) return null;
    return <AgentTrace events={traceEvents} running={false} status={run?.status ?? null} />;
  }

  function renderLocalMode() {
    return (
      <div className="plan-state-stack">
        <Callout tone="warn" title="本地演示模式：云端生成未启用">
          <p className="micro">可完成第 1 到 3 步并查看导出空态，不会伪造方案。</p>
        </Callout>
        <section className="panel" aria-labelledby="local-plan-title">
          <div className="panel-head">
            <div>
              <h2 id="local-plan-title">本设备上的画像与暂定方向</h2>
            </div>
            <Badge tone="muted">仅本地</Badge>
          </div>
          {progress ? (
            <ul className="kv-list kv-list-lg">
              <li>
                <span>学校 / 专业</span>
                <strong>
                  {progress.profile.school || "未填写"}
                  {progress.profile.major ? ` · ${progress.profile.major}` : ""}
                </strong>
              </li>
              <li>
                <span>当前学期</span>
                <strong>{progress.profile.current_term || "未选择"}</strong>
              </li>
              <li>
                <span>自我探索</span>
                <strong>
                  {progress.profile.completed_at
                    ? progress.profile.skipped
                      ? "已跳过问卷（画像保持未知）"
                      : "已完成职业探索问卷（本地计分）"
                    : "未完成"}
                </strong>
              </li>
              <li>
                <span>暂定方向</span>
                <strong>{directionInfo?.title ?? "未选择"}</strong>
              </li>
              <li>
                <span>备选方向</span>
                <strong>{backupDirectionInfo?.title ?? "未选择（可选）"}</strong>
              </li>
              <li>
                <span>收藏方向</span>
                <strong>{progress.favorites.length} 个</strong>
              </li>
            </ul>
          ) : (
            <EmptyState compact title="还没有本地进度" description="先完成第 1 步自我探索，再回到这里。" />
          )}
          <div className="local-actions">
            <Button variant="secondary" size="md" onClick={() => router.push("/choice")}>
              回去修改暂定方向
            </Button>
            <Button variant="ghost" size="md" onClick={() => router.push("/explore")}>
              补齐自我探索
            </Button>
            <Button variant="ghost" size="md" onClick={() => router.push("/export")}>
              查看导出空态
            </Button>
          </div>
        </section>

        {cachedPlanAvailable && cache ? (
          <section aria-labelledby="cached-plan-title">
            <div className="panel-head">
              <div>
                <h2 id="cached-plan-title">上次缓存的方案</h2>
              </div>
              <Badge tone="warn">缓存 {formatDateTime(cache.fetched_at)}</Badge>
            </div>
            <PlanDetail
              plan={planFromCache(cache)}
              result={cache.result}
              directionId={cache.direction_id}
              localOrder={localOrder}
              evidence={cache.result.evidence}
              isCached
              cachedAt={cache.fetched_at}
              decisionReason={progress?.reason_summary ?? ""}
              patchingActionId={null}
              actionErrors={{}}
              onMoveOrder={(nextOrder) => {
                setLocalOrder(nextOrder);
                writePlanOrder(cache.plan_id, nextOrder);
              }}
              onPatch={handlePatch}
            />
          </section>
        ) : null}
      </div>
    );
  }

  function renderBlocked() {
    const missing: string[] = [];
    if (!hydrated) missing.push("正在读取本地进度…");
    else if (!progress) missing.push("还没有本地进度");
    else {
      if (progress.profile.school.trim().length < 2) missing.push("学校");
      if (progress.profile.major.trim().length < 2) missing.push("专业");
      if (!progress.profile.enrollment_year) missing.push("入学年份");
      if (progress.profile.current_term.length < 2) missing.push("当前学期");
      if (!progress.profile.completed_at) missing.push("完成或跳过自我探索");
      if (!progress.provisional_direction) missing.push("暂定方向");
      else if (
        !isDirectionAllowed(progress.provisional_direction, readExplorePrefs().pathway)
      ) {
        missing.push("重新选择未被硬约束排除的方向");
      }
    }
    return (
      <section className="panel blocked-panel" aria-labelledby="blocked-title">
        <div className="panel-head">
          <div>
            <h2 id="blocked-title">先补齐这几项</h2>
          </div>
          <Badge tone="warn">{missing.length} 项待补</Badge>
        </div>
        <EmptyState
          compact
          icon="flag"
          title={missing.length > 0 ? `还缺：${missing.join(" / ")}` : "正在准备…"}
        />
        <div className="local-actions">
          <Button variant="primary" size="md" onClick={() => router.push("/explore")}>
            去第 1 步自我探索
            <Icon name="arrow-right" size={14} />
          </Button>
          <Button variant="secondary" size="md" onClick={() => router.push("/choice")}>
            去第 3 步暂定方向
          </Button>
          <Button variant="ghost" size="md" onClick={() => router.push("/directions")}>
            看方向牌面
          </Button>
        </div>
      </section>
    );
  }

  function renderError() {
    return (
      <div className="plan-state-stack">
        <Callout tone="danger" title="生成失败" icon="alert">
          <p>{error?.message ?? "未知错误"}</p>
          {error?.code ? <p className="run-error-code">错误码：{error.code}</p> : null}
        </Callout>
        {renderFinishedTrace()}
        <ResearchToggle
          checked={webSupplement}
          onChange={setWebSupplement}
          disabled={!cloud}
          label="联网补充调研"
          description={RESEARCH_TOGGLE_DESCRIPTION}
          className="plan-research-toggle"
        />
        <div className="local-actions">
          <Button variant="primary" size="md" onClick={handleRetry}>
            <Icon name="refresh" size={14} /> 重试生成
          </Button>
          {progress?.plan_id ? (
            <Button variant="secondary" size="md" onClick={refreshPlan} disabled={refreshing}>
              {refreshing ? "刷新中…" : "刷新已有方案"}
            </Button>
          ) : null}
          <Button variant="ghost" size="md" onClick={() => router.push("/choice")}>
            回到暂定方向
          </Button>
          {cachedPlanAvailable && cache ? (
            <Button variant="ghost" size="md" onClick={() => setShowCached((value) => !value)}>
              {showCached ? "收起本设备缓存" : "查看本设备缓存"}
            </Button>
          ) : null}
        </div>
        {showCached && cache ? (
          <PlanDetail
            plan={planFromCache(cache)}
            result={cache.result}
            directionId={cache.direction_id}
            localOrder={localOrder}
            evidence={cache.result.evidence}
            isCached
            cachedAt={cache.fetched_at}
            decisionReason={progress?.reason_summary ?? ""}
            patchingActionId={null}
            actionErrors={{}}
            onMoveOrder={(nextOrder) => {
              setLocalOrder(nextOrder);
              writePlanOrder(cache.plan_id, nextOrder);
            }}
            onPatch={handlePatch}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <h1>第 4 步 · 行动方案</h1>
          <p className="screen-sub">按学期分组的可调整行动；勾选、改时间与工时都会留存。</p>
        </div>
        <div className="row">
          <Button variant="ghost" size="md" onClick={() => router.push("/export")}>
            跳过这一步
          </Button>
          {phase === "ready" && progress?.plan_id ? (
            <Link href="/export" className="btn btn-primary btn-md">
              <Icon name="download" size={15} />
              去导出 PDF
            </Link>
          ) : (
            <Button variant="primary" size="md" disabled title="生成方案后可导出">
              <Icon name="download" size={15} />
              去导出 PDF
            </Button>
          )}
        </div>
      </header>

      <p className="micro">
        {directionInfo ? `暂定：${directionInfo.short_title}` : "尚未暂定方向"}
        {backupDirectionInfo ? ` · 备选：${backupDirectionInfo.short_title}` : ""}
        {` · ${cloud ? "云端生成" : "本地演示"}`}
        {phase === "ready" && result ? ` · ${result.actions.length} 项行动` : ""}
      </p>

      {notice ? <p className="inline-note">{notice}</p> : null}

      {phase === "boot" ? (
        <section className="panel" aria-live="polite">
          <RunStatus state="running" label="正在读取本设备的进度与方案" />
        </section>
      ) : null}
      {phase === "generating" ? renderGenerating() : null}
      {phase === "blocked" ? renderBlocked() : null}
      {phase === "local" ? renderLocalMode() : null}
      {phase === "error" ? renderError() : null}

      {phase === "ready" && result ? (
        <div className="plan-ready">
          <RunStatus
            state="done"
            label={
              <>
                <span aria-hidden="true">✓ </span>方案已生成
              </>
            }
            detail={`${result.actions.length} 项行动 · 规则 ${result.rules_version || "未提供"}`}
          />
          <ResearchToggle
            checked={webSupplement}
            onChange={setWebSupplement}
            disabled={cloudRunActive || !cloud}
            label="联网补充调研"
            description={RESEARCH_TOGGLE_DESCRIPTION}
            className="plan-research-toggle"
          />
          <div className="plan-toolbar">
            <div className="plan-toolbar-group">
              <label className="micro" htmlFor="plan-direction-switch">
                当前方向
              </label>
              <select
                id="plan-direction-switch"
                className="select select-sm"
                value={effectiveDirection ?? ""}
                onChange={(event) => {
                  const value = event.target.value as DirectionId;
                  if (value && value !== effectiveDirection) setSwitchTarget(value);
                }}
                disabled={cloudRunActive}
              >
                {switchOptions.map((item) => (
                  <option value={item.direction_id} key={item.direction_id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="plan-toolbar-group">
              <Button variant="ghost" size="sm" onClick={refreshPlan} disabled={refreshing || cloudRunActive}>
                <Icon name="refresh" size={13} />
                {refreshing ? "刷新中…" : "刷新方案"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRegenerateOpen(true)} disabled={cloudRunActive || !cloud}>
                <Icon name="sparkles" size={13} />
                重新生成方案
              </Button>
              <Button variant="ghost" size="sm" onClick={() => router.push("/choice")} disabled={cloudRunActive}>
                修改暂定方向
              </Button>
            </div>
            <Badge tone={result.status === "ok" ? "ok" : "warn"}>
              {plan ? `方案 v${pickCurrentVersion(plan)?.version ?? "?"}` : "本次生成结果"}
            </Badge>
          </div>

          {renderFinishedTrace()}

          <PlanDetail
            plan={plan}
            result={result}
            directionId={effectiveDirection ?? "trade_supply_chain"}
            localOrder={localOrder}
            evidence={result.evidence}
            isCached={viewIsCached}
            cachedAt={cachedAt}
            decisionReason={progress?.reason_summary ?? ""}
            patchingActionId={patchingActionId}
            actionErrors={actionErrors}
            onMoveOrder={handleMoveOrder}
            onPatch={handlePatch}
            onRegenerate={() => setRegenerateOpen(true)}
            regenerating={cloudRunActive}
          />

          <div className="step-footer-bar">
            <div className="step-footer-note">
              <span className="micro">方案已保存在本设备，刷新不会丢失。</span>
            </div>
            <div className="step-footer-actions">
              <Button variant="secondary" size="md" onClick={() => router.push("/library")}>
                <Icon name="book" size={14} />
                去资料库核对来源
              </Button>
              <Link href="/export" className="btn btn-primary btn-md">
                <Icon name="download" size={15} />
                去导出 PDF
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {phase === "ready" && viewIsCached && !cloud ? (
        <Callout tone="warn" title="云端不可用">
          <p className="micro">当前是本设备缓存，调整无法提交到云端。</p>
        </Callout>
      ) : null}

      <ConfirmDialog
        open={switchTarget !== null}
        title="切换方向并重新生成？"
        description="旧方向的方案版本会保留并标记 stale。"
        confirmLabel="切换并生成"
        tone="primary"
        onConfirm={confirmSwitchDirection}
        onCancel={() => setSwitchTarget(null)}
      >
        {directionInfo && switchTarget ? (
          <div className="reset-scope">
            <p className="reset-scope-heading">从</p>
            <p className="reset-scope-value">{directionInfo.title}</p>
            <p className="reset-scope-heading">切换到</p>
            <p className="reset-scope-value">{getDirection(switchTarget)?.title}</p>
          </div>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={regenerateOpen}
        title="重新生成方案？"
        description="会创建新版本；旧版本保留并标记 stale。"
        confirmLabel="重新生成"
        tone="primary"
        onConfirm={confirmRegenerate}
        onCancel={() => setRegenerateOpen(false)}
      />

      {cacheHydrated && !cloud && cachedPlanAvailable && phase !== "local" ? (
        <p className="micro">本设备存有一份缓存方案，可在「本地演示模式」区块查看。</p>
      ) : null}
    </div>
  );
}
