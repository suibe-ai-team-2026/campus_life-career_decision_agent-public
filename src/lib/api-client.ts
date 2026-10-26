"use client";

/**
 * Same-origin BFF client.
 *
 * - Parses the shared envelope `{ request_id, data }` / `{ error: { code, message, request_id } }`.
 * - Throws `ApiError` with a stable code; UI maps codes to curated Chinese copy and
 *   never renders upstream error text or tokens.
 * - Polling supports AbortController and backs off while the page is hidden.
 */
import {
  DIRECTION_IDS,
  ERROR_CODES,
  type DirectionId,
  type ErrorCode
} from "@/lib/contracts/common";
import type { Assessment, DirectionCard } from "@/lib/contracts/catalog";
import type { Plan, PlanAction, PlanResult } from "@/lib/contracts/plan";
import type { Profile, ProfileInput } from "@/lib/contracts/profile";
import type { Citation, Run, RunSubmit } from "@/lib/contracts/run";
import type { Source, UploadIntent } from "@/lib/contracts/source";

/**
 * Local type for run events. The frozen contracts expose only
 * `RunEventSchema` (not its inferred type), so the client derives the shape here.
 */
export type RunEvent = {
  run_id: string;
  seq: number;
  event_type: string;
  safe_payload: Record<string, unknown> | null;
  created_at: string;
};

/* ------------------------------------------------------------------ */
/* Cloud configuration (public values only)                            */
/* ------------------------------------------------------------------ */

const PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const PUBLIC_SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/**
 * Cloud generation is enabled only when both public Supabase values exist.
 * No secret is ever read here; the browser never sees service keys.
 */
export function cloudConfigured(): boolean {
  return Boolean(PUBLIC_SUPABASE_URL.trim() && PUBLIC_SUPABASE_KEY.trim());
}

export const LOCAL_DEMO_BANNER =
  "本地演示模式：仅本地进度，云端生成未启用";

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type ClientErrorCode =
  | ErrorCode
  | "not_configured"
  | "network_error"
  | "unexpected_response"
  | "aborted"
  | "timeout";

const ERROR_MESSAGES: Record<ClientErrorCode, string> = {
  authentication_required: "登录状态已失效，请刷新页面后重试",
  resource_not_found: "没有找到对应资源，可能已被清理",
  version_conflict: "数据版本已变化，请刷新后再修改",
  idempotency_conflict: "重复提交了不同的内容，请重新发起",
  upload_too_large: "文件超过大小限制",
  invalid_profile: "画像资料不完整或不合法，请回到自我探索补充",
  unsupported_direction: "该方向暂不支持生成",
  rate_limited: "操作太频繁，请稍后再试",
  budget_exceeded: "本月 AI 预算已用尽，暂时不能发起新的生成任务",
  model_auth_failed: "模型服务鉴权失败，请联系管理员",
  model_quota_exceeded: "模型额度已用尽，请稍后再试",
  model_timeout: "模型响应超时，请稍后重试",
  model_unavailable: "云端生成暂不可用，请稍后重试或查看本地已保存内容",
  bad_request: "请求内容不合法，请检查后重试",
  internal_error: "服务暂时不可用，请稍后重试",
  not_configured: "云端生成未启用：当前为本地演示模式",
  network_error: "网络连接失败，请检查网络后重试",
  unexpected_response: "服务返回了无法识别的内容，请稍后重试",
  aborted: "操作已停止",
  timeout: "等待时间过长，请稍后重试"
};

export class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  readonly requestId: string | null;

  constructor(code: ClientErrorCode, options?: { status?: number; requestId?: string | null }) {
    super(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.internal_error);
    this.name = "ApiError";
    this.code = code;
    this.status = options?.status ?? 0;
    this.requestId = options?.requestId ?? null;
  }
}

export function errorCodeOf(error: unknown): ClientErrorCode {
  if (error instanceof ApiError) return error.code;
  return "internal_error";
}

/** Curated, safe copy for the UI. Upstream `message` is intentionally ignored. */
export function friendlyErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return ERROR_MESSAGES[error.code] ?? ERROR_MESSAGES.internal_error;
  if (error instanceof Error && error.name === "AbortError") return ERROR_MESSAGES.aborted;
  return ERROR_MESSAGES.internal_error;
}

function isKnownErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ */
/* Small runtime guards + normalisers                                  */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function intOrNull(value: unknown): number | null {
  const n = numOrNull(value);
  return n === null ? null : Math.round(n);
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isDirectionId(value: unknown): value is DirectionId {
  return typeof value === "string" && (DIRECTION_IDS as readonly string[]).includes(value);
}

function normalizeAction(raw: unknown): PlanAction | null {
  if (!isRecord(raw)) return null;
  const actionId = str(raw.action_id);
  if (!actionId) return null;
  const effortRaw = recordOrEmpty(raw.effort);
  const basis = ["official_requirement", "team_estimate", "user_estimate", "unknown"].includes(
    str(effortRaw.basis)
  )
    ? (str(effortRaw.basis) as PlanAction["effort"]["basis"])
    : "unknown";
  const window = ["current_term", "next_term", "later"].includes(str(raw.window))
    ? (str(raw.window) as PlanAction["window"])
    : "later";
  const status = ["suggested", "pending_verification", "verified", "user_modified"].includes(
    str(raw.status)
  )
    ? (str(raw.status) as PlanAction["status"])
    : "suggested";
  return {
    action_id: actionId,
    title: str(raw.title, "未命名行动"),
    direction_id: isDirectionId(raw.direction_id) ? raw.direction_id : "trade_supply_chain",
    window,
    effort: {
      hours: numOrNull(effortRaw.hours),
      basis,
      ...(strOrNull(effortRaw.note) ? { note: strOrNull(effortRaw.note) as string } : {})
    },
    prerequisites: strArray(raw.prerequisites),
    evidence_ids: strArray(raw.evidence_ids),
    rule_id: strOrNull(raw.rule_id),
    rules_version: str(raw.rules_version),
    status,
    user_adjusted: raw.user_adjusted === true
  };
}

export function normalizeCitation(raw: unknown, index: number): Citation | null {
  if (!isRecord(raw)) return null;
  const sourceId = str(raw.source_id);
  const title = str(raw.title);
  if (!sourceId && !title) return null;
  const locator = isRecord(raw.locator) ? raw.locator : {};
  return {
    citation_no: intOrNull(raw.citation_no) ?? index + 1,
    source_id: sourceId,
    source_version_id: str(raw.source_version_id),
    chunk_id: str(raw.chunk_id),
    record_id: strOrNull(raw.record_id),
    title: title || sourceId,
    locator,
    excerpt: str(raw.excerpt),
    verification_status: str(raw.verification_status, "unverified"),
    source_scope: str(raw.source_scope)
  };
}

export function normalizeCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => normalizeCitation(item, index))
    .filter((item): item is Citation => item !== null);
}

function normalizeGaps(value: unknown): PlanResult["gaps"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((gap) => {
      const moduleName = ["courses", "competitions", "credits", "evidence", "profile"].includes(
        str(gap.module)
      )
        ? (str(gap.module) as NonNullable<PlanResult["gaps"][number]["module"]>)
        : undefined;
      return { code: str(gap.code, "data_gap"), message: str(gap.message, "资料缺失"), ...(moduleName ? { module: moduleName } : {}) };
    });
}

function normalizeCourses(value: unknown): PlanResult["courses"] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((course) => ({
    course_id: str(course.course_id, str(course.title)),
    title: str(course.title, "未命名课程"),
    credits: numOrNull(course.credits),
    offered_terms: strArray(course.offered_terms),
    prerequisites: strArray(course.prerequisites),
    verification_status: str(course.verification_status, "unverified")
  }));
}

function normalizeCompetitions(value: unknown): PlanResult["competitions"] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((competition) => ({
    competition_id: str(competition.competition_id, str(competition.title)),
    title: str(competition.title, "未命名竞赛"),
    window: strOrNull(competition.window),
    verification_status: str(competition.verification_status, "unverified")
  }));
}

export function normalizePlanAnalysis(raw: unknown): PlanResult["analysis"] {
  if (!isRecord(raw)) return null;
  return {
    overview: str(raw.overview),
    match: str(raw.match),
    action_rationale: strArray(raw.action_rationale),
    evidence_courses: Array.isArray(raw.evidence_courses)
      ? raw.evidence_courses
          .filter(isRecord)
          .map((item) => ({
            name: str(item.name),
            citation_no: intOrNull(item.citation_no) ?? 1,
            note: str(item.note)
          }))
      : [],
    evidence_competitions: Array.isArray(raw.evidence_competitions)
      ? raw.evidence_competitions
          .filter(isRecord)
          .map((item) => ({
            name: str(item.name),
            citation_no: intOrNull(item.citation_no) ?? 1,
            note: str(item.note)
          }))
      : [],
    risks: strArray(raw.risks),
    next_steps: strArray(raw.next_steps),
    citation_numbers: Array.isArray(raw.citation_numbers)
      ? raw.citation_numbers.map((value) => intOrNull(value)).filter((value): value is number => value !== null)
      : [],
    boundary_note: str(raw.boundary_note)
  };
}

function normalizePlanResult(raw: unknown): PlanResult | null {
  if (!isRecord(raw)) return null;
  const actions = Array.isArray(raw.actions)
    ? raw.actions.map(normalizeAction).filter((action): action is PlanAction => action !== null)
    : [];
  const direction = isDirectionId(raw.direction_id) ? raw.direction_id : "trade_supply_chain";
  const status = ["ok", "partial", "data_unavailable", "unsupported_direction", "invalid_profile"].includes(
    str(raw.status)
  )
    ? (str(raw.status) as PlanResult["status"])
    : "partial";
  return {
    status,
    rules_version: str(raw.rules_version),
    profile_version: intOrNull(raw.profile_version) ?? 1,
    direction_id: direction,
    actions,
    courses: normalizeCourses(raw.courses),
    competitions: normalizeCompetitions(raw.competitions),
    credits: numOrNull(raw.credits),
    gaps: normalizeGaps(raw.gaps),
    evidence: normalizeCitations(raw.evidence),
    explanation: strOrNull(raw.explanation),
    analysis: normalizePlanAnalysis(raw.analysis),
    warnings: strArray(raw.warnings)
  };
}

export function normalizeRun(raw: unknown): Run {
  if (!isRecord(raw) || !str(raw.run_id)) {
    throw new ApiError("unexpected_response");
  }
  const progress = intOrNull(raw.progress);
  return {
    run_id: str(raw.run_id),
    kind: (["assessment_explain", "compare", "plan", "ask", "export", "ingest"].includes(str(raw.kind))
      ? str(raw.kind)
      : "plan") as Run["kind"],
    status: (str(raw.status, "queued") || "queued") as Run["status"],
    progress: progress === null ? 0 : Math.max(0, Math.min(100, progress)),
    input: recordOrEmpty(raw.input),
    error_code: strOrNull(raw.error_code),
    result: raw.result ?? null,
    created_at: str(raw.created_at, new Date().toISOString()),
    started_at: strOrNull(raw.started_at),
    finished_at: strOrNull(raw.finished_at)
  };
}

function normalizeRunEvent(raw: unknown): RunEvent | null {
  if (!isRecord(raw)) return null;
  const seq = intOrNull(raw.seq);
  if (seq === null) return null;
  return {
    run_id: str(raw.run_id),
    seq,
    event_type: str(raw.event_type, "progress"),
    safe_payload: isRecord(raw.safe_payload) ? raw.safe_payload : null,
    created_at: str(raw.created_at)
  };
}

function normalizePlanVersion(raw: unknown): Plan["versions"][number] | null {
  if (!isRecord(raw)) return null;
  const versionId = str(raw.version_id);
  if (!versionId) return null;
  const actions = Array.isArray(raw.actions)
    ? raw.actions.map(normalizeAction).filter((action): action is PlanAction => action !== null)
    : [];
  return {
    version_id: versionId,
    plan_id: str(raw.plan_id),
    version: intOrNull(raw.version) ?? 1,
    profile_version: intOrNull(raw.profile_version) ?? 1,
    rules_version: str(raw.rules_version),
    corpus_version: strOrNull(raw.corpus_version),
    embedding_profile_id: strOrNull(raw.embedding_profile_id),
    status: str(raw.status, "active"),
    actions,
    user_overrides: recordOrEmpty(raw.user_overrides),
    warnings: strArray(raw.warnings),
    result: raw.result ? normalizePlanResult(raw.result) : null,
    created_at: str(raw.created_at)
  };
}

export function normalizePlan(raw: unknown): Plan {
  if (!isRecord(raw) || !str(raw.plan_id)) throw new ApiError("unexpected_response");
  const versions = Array.isArray(raw.versions)
    ? raw.versions
        .map(normalizePlanVersion)
        .filter((version): version is Plan["versions"][number] => version !== null)
    : [];
  return {
    plan_id: str(raw.plan_id),
    profile_id: str(raw.profile_id),
    direction_id: isDirectionId(raw.direction_id) ? raw.direction_id : "trade_supply_chain",
    current_version_id: strOrNull(raw.current_version_id),
    versions
  };
}

function normalizeProfile(raw: unknown): Profile | null {
  if (!isRecord(raw)) return null;
  const profileId = str(raw.profile_id);
  if (!profileId) return null;
  const preferencesRaw = recordOrEmpty(raw.preferences);
  return {
    profile_id: profileId,
    version: intOrNull(raw.version) ?? 1,
    school: str(raw.school),
    major: str(raw.major),
    enrollment_year: intOrNull(raw.enrollment_year) ?? new Date().getFullYear() - 1,
    current_term: str(raw.current_term),
    assessment_version: str(raw.assessment_version),
    exploration_status: raw.exploration_status === "skipped" ? "skipped" : "completed",
    answers: recordOrEmpty(raw.answers) as Profile["answers"],
    scores: recordOrEmpty(raw.scores) as Profile["scores"],
    preferences: {
      ...(numOrNull(preferencesRaw.weekly_hours) !== null
        ? { weekly_hours: numOrNull(preferencesRaw.weekly_hours) as number }
        : {}),
      ...(numOrNull(preferencesRaw.monthly_budget_cny) !== null
        ? { monthly_budget_cny: numOrNull(preferencesRaw.monthly_budget_cny) as number }
        : {}),
      ...(strOrNull(preferencesRaw.notes) ? { notes: strOrNull(preferencesRaw.notes) as string } : {})
    },
    created_at: str(raw.created_at),
    updated_at: str(raw.updated_at)
  };
}

function normalizeDirectionCard(raw: unknown): DirectionCard | null {
  if (!isRecord(raw) || !isDirectionId(raw.direction_id)) return null;
  const coverageRaw = recordOrEmpty(raw.coverage);
  return {
    direction_id: raw.direction_id,
    title: str(raw.title),
    short_title: str(raw.short_title, str(raw.title)),
    summary: str(raw.summary),
    work_content: strArray(raw.work_content),
    verified_skills: strArray(raw.verified_skills),
    preparation_cost: str(raw.preparation_cost),
    applicability: str(raw.applicability),
    data_gaps: strArray(raw.data_gaps),
    coverage: {
      exact_major_records: intOrNull(coverageRaw.exact_major_records) ?? 0,
      official_records: intOrNull(coverageRaw.official_records) ?? 0,
      job_requirements: intOrNull(coverageRaw.job_requirements) ?? 0,
      label: str(coverageRaw.label)
    },
    source_ids: strArray(raw.source_ids)
  };
}

/* ------------------------------------------------------------------ */
/* Envelope fetch                                                      */
/* ------------------------------------------------------------------ */

type FetchOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;

async function envelopeFetch(path: string, options: FetchOptions = {}): Promise<unknown> {
  if (!cloudConfigured()) throw new ApiError("not_configured");

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const external = options.signal;
  const onAbort = () => controller.abort();
  if (external) {
    if (external.aborted) {
      clearTimeout(timer);
      throw new ApiError("aborted");
    }
    external.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    const hasBody = options.body !== undefined;
    if (hasBody) headers["Content-Type"] = "application/json";
    const response = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const errorObject = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
      const rawCode = errorObject ? str(errorObject.code) : "";
      const code: ClientErrorCode = isKnownErrorCode(rawCode) ? rawCode : "internal_error";
      throw new ApiError(code, {
        status: response.status,
        requestId: errorObject ? strOrNull(errorObject.request_id) : null
      });
    }

    if (!isRecord(payload) || !("data" in payload)) {
      throw new ApiError("unexpected_response", { status: response.status });
    }
    return payload.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) {
      throw new ApiError(timedOut ? "timeout" : "aborted");
    }
    throw new ApiError("network_error");
  } finally {
    clearTimeout(timer);
    if (external) external.removeEventListener("abort", onAbort);
  }
}

/* ------------------------------------------------------------------ */
/* BFF endpoints                                                       */
/* ------------------------------------------------------------------ */

export type AnonymousSession = { userId: string | null; created: boolean | null };

export async function createAnonymousSession(signal?: AbortSignal): Promise<AnonymousSession> {
  const data = await envelopeFetch("/api/auth/anonymous", { method: "POST", body: {}, signal });
  const record = recordOrEmpty(data);
  return {
    userId: strOrNull(record.user_id),
    created: typeof record.created === "boolean" ? record.created : null
  };
}

export type SavedProfile = { profile: Profile; scoring: Record<string, number> | null };

export async function saveProfile(input: ProfileInput, signal?: AbortSignal): Promise<SavedProfile> {
  const data = await envelopeFetch("/api/profiles", { method: "POST", body: input, signal });
  const record = recordOrEmpty(data);
  const profile = normalizeProfile(record.profile ?? record);
  if (!profile) throw new ApiError("unexpected_response");
  const scoringRaw = record.scoring;
  const scoring = isRecord(scoringRaw)
    ? Object.fromEntries(
        Object.entries(scoringRaw).filter((entry): entry is [string, number] => typeof entry[1] === "number")
      )
    : null;
  return { profile, scoring };
}

export type RunSubmitAck = {
  runId: string;
  status: string;
  statusUrl: string | null;
  eventsUrl: string | null;
};

export async function submitRun(input: RunSubmit, signal?: AbortSignal): Promise<RunSubmitAck> {
  const data = await envelopeFetch("/api/runs", { method: "POST", body: input, signal });
  const record = recordOrEmpty(data);
  const runId = str(record.run_id);
  if (!runId) throw new ApiError("unexpected_response");
  return {
    runId,
    status: str(record.status, "queued"),
    statusUrl: strOrNull(record.status_url),
    eventsUrl: strOrNull(record.events_url)
  };
}

export async function getRun(runId: string, signal?: AbortSignal): Promise<Run> {
  const data = await envelopeFetch(`/api/runs/${encodeURIComponent(runId)}`, { signal });
  const record = recordOrEmpty(data);
  return normalizeRun(record.run ?? record);
}

export type WakeRunResult = { runId: string; workerWake: string };

/**
 * Ask the BFF to wake the worker VM for a queued run. Used by the polling loop
 * as a retry path when the first wake (on submit) did not get the VM running.
 */
export async function wakeRun(runId: string, signal?: AbortSignal): Promise<WakeRunResult> {
  const data = await envelopeFetch(`/api/runs/${encodeURIComponent(runId)}/wake`, {
    method: "POST",
    signal,
    timeoutMs: 30_000
  });
  const record = recordOrEmpty(data);
  return { runId: str(record.run_id) || runId, workerWake: str(record.worker_wake) || "unknown" };
}

export async function getRunEvents(
  runId: string,
  afterSeq: number,
  signal?: AbortSignal
): Promise<RunEvent[]> {
  const data = await envelopeFetch(
    `/api/runs/${encodeURIComponent(runId)}/events?after=${encodeURIComponent(String(afterSeq))}`,
    { signal }
  );
  const record = recordOrEmpty(data);
  const eventsRaw = Array.isArray(record.events) ? record.events : Array.isArray(data) ? data : [];
  return eventsRaw
    .map(normalizeRunEvent)
    .filter((event): event is RunEvent => event !== null)
    .sort((a, b) => a.seq - b.seq);
}

export async function getPlan(planId: string, signal?: AbortSignal): Promise<Plan> {
  const data = await envelopeFetch(`/api/plans/${encodeURIComponent(planId)}`, { signal });
  const record = recordOrEmpty(data);
  return normalizePlan(record.plan ?? record);
}

export type ActionPatchInput = {
  expected_version: number;
  user_overrides: {
    title?: string;
    window?: "current_term" | "next_term" | "later";
    effort_hours?: number | null;
    done?: boolean;
    note?: string;
  };
};

export type ActionPatchResult = {
  planId: string | null;
  versionId: string | null;
  version: number | null;
  actions: PlanAction[];
  userOverrides: Record<string, unknown>;
};

export async function patchPlanAction(
  planId: string,
  actionId: string,
  input: ActionPatchInput,
  signal?: AbortSignal
): Promise<ActionPatchResult> {
  const data = await envelopeFetch(
    `/api/plans/${encodeURIComponent(planId)}/actions/${encodeURIComponent(actionId)}`,
    { method: "PATCH", body: input, signal }
  );
  const record = recordOrEmpty(data);
  const actions = Array.isArray(record.actions)
    ? record.actions.map(normalizeAction).filter((action): action is PlanAction => action !== null)
    : [];
  return {
    planId: strOrNull(record.plan_id),
    versionId: strOrNull(record.version_id),
    version: intOrNull(record.version),
    actions,
    userOverrides: recordOrEmpty(record.user_overrides)
  };
}

export async function cancelRun(runId: string, signal?: AbortSignal): Promise<void> {
  await envelopeFetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST", body: {}, signal });
}

/* ------------------------------------------------------------------ */
/* 用户资料上传（培养方案等）                                          */
/* ------------------------------------------------------------------ */

export type SourceUploadIntent = {
  sourceId: string;
  signedUrl: string;
  maxBytes: number;
};

/** 第一步：登记来源并取得 Supabase Storage 签名上传地址。 */
export async function requestSourceUpload(
  input: UploadIntent,
  signal?: AbortSignal
): Promise<SourceUploadIntent> {
  const data = await envelopeFetch("/api/sources/upload-intent", {
    method: "POST",
    body: input,
    signal
  });
  const record = recordOrEmpty(data);
  const sourceId = str(record.source_id);
  const signedUrl = str(record.signed_url);
  if (!sourceId || !/^https?:\/\//i.test(signedUrl)) throw new ApiError("unexpected_response");
  const maxBytes = intOrNull(record.max_bytes) ?? 20 * 1024 * 1024;
  return { sourceId, signedUrl, maxBytes };
}

/**
 * 第二步：把文件直接 PUT 到签名地址。这条请求不经过 BFF，因此不走 envelopeFetch；
 * 失败不携带上游原文，只保留状态码。
 */
export async function putSourceFile(signedUrl: string, file: Blob): Promise<void> {
  let response: Response;
  try {
    response = await fetch(signedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": (file as File).type || "application/octet-stream",
        "cache-control": "3600",
        "x-upsert": "false"
      },
      body: file
    });
  } catch {
    throw new ApiError("network_error");
  }
  if (!response.ok) throw new ApiError("internal_error", { status: response.status });
}

export type SourceUploadComplete = { runId: string; status: string; sourceVersionId: string };

/** 第三步：提交入库，服务端校验 sha256 并创建 ingest run。 */
export async function completeSourceUpload(
  input: { source_id: string; declared_sha256: string; title: string; idempotency_key: string },
  signal?: AbortSignal
): Promise<SourceUploadComplete> {
  const data = await envelopeFetch(
    `/api/sources/${encodeURIComponent(input.source_id)}/complete`,
    { method: "POST", body: input, signal }
  );
  const record = recordOrEmpty(data);
  const runId = str(record.run_id);
  const sourceVersionId = str(record.source_version_id);
  if (!runId || !sourceVersionId) throw new ApiError("unexpected_response");
  return { runId, status: str(record.status, "queued"), sourceVersionId };
}

export type ArtifactDownload = { url: string; expiresInSeconds: number | null };

export async function getArtifactDownload(
  artifactId: string,
  signal?: AbortSignal
): Promise<ArtifactDownload> {
  const data = await envelopeFetch(
    `/api/artifacts/${encodeURIComponent(artifactId)}/download`,
    { signal }
  );
  const record = recordOrEmpty(data);
  const url = str(record.url);
  if (!/^https?:\/\//i.test(url)) throw new ApiError("unexpected_response");
  return { url, expiresInSeconds: intOrNull(record.expires_in) };
}

export type DirectionsCatalog = {
  mode: string;
  categoryVersion: string;
  disclaimer: string;
  directions: DirectionCard[];
};

export async function fetchDirections(signal?: AbortSignal): Promise<DirectionsCatalog> {
  const data = await envelopeFetch("/api/catalog/directions", { signal });
  const record = recordOrEmpty(data);
  const directions = Array.isArray(record.directions)
    ? record.directions
        .map(normalizeDirectionCard)
        .filter((card): card is DirectionCard => card !== null)
    : [];
  return {
    mode: str(record.mode, "database"),
    categoryVersion: str(record.category_version),
    disclaimer: str(record.disclaimer),
    directions
  };
}

export type AssessmentCatalog = { assessment: Assessment; mode: string };

export async function fetchAssessment(signal?: AbortSignal): Promise<AssessmentCatalog> {
  const data = await envelopeFetch("/api/assessments/current", { signal });
  const record = recordOrEmpty(data);
  const assessmentRaw = record.assessment ?? record;
  // The BFF returns the frozen DTO shape; validated with the shared schema
  // lazily to keep this module free of a hard failure on optional fields.
  if (!isRecord(assessmentRaw) || !Array.isArray(assessmentRaw.questions)) {
    throw new ApiError("unexpected_response");
  }
  const { AssessmentSchema } = await import("@/lib/contracts/catalog");
  const parsed = AssessmentSchema.safeParse(assessmentRaw);
  if (!parsed.success) throw new ApiError("unexpected_response");
  return { assessment: parsed.data, mode: str(record.mode, "database") };
}

export async function fetchSources(signal?: AbortSignal): Promise<Source[]> {
  const data = await envelopeFetch("/api/sources", { signal });
  const record = recordOrEmpty(data);
  const raw = Array.isArray(record.sources) ? record.sources : Array.isArray(data) ? data : [];
  return raw
    .filter(isRecord)
    .map((source) => ({
      source_id: str(source.source_id),
      title: str(source.title, "未命名来源"),
      publisher: strOrNull(source.publisher),
      canonical_url: strOrNull(source.canonical_url),
      source_scope: strOrNull(source.source_scope),
      visibility: source.visibility === "private" ? ("private" as const) : ("approved_reference" as const),
      verification_status: str(source.verification_status, "unverified"),
      versions: Array.isArray(source.versions)
        ? source.versions.filter(isRecord).map((version) => ({
            source_version_id: str(version.source_version_id),
            published_at: strOrNull(version.published_at),
            retrieved_at: strOrNull(version.retrieved_at),
            extraction_status: str(version.extraction_status, "pending"),
            parser_version: strOrNull(version.parser_version)
          }))
        : []
    }))
    .filter((source) => Boolean(source.source_id));
}

/* ------------------------------------------------------------------ */
/* Run outcome parsers (server `result` payloads are `unknown`)        */
/* ------------------------------------------------------------------ */

export type PlanRunOutcome = {
  planId: string;
  planVersionId: string | null;
  version: number | null;
  result: PlanResult;
};

export function parsePlanRunResult(run: Run): PlanRunOutcome | null {
  const raw = run.result;
  if (!isRecord(raw)) return null;
  const nested = isRecord(raw.result) ? raw.result : null;
  const result = normalizePlanResult(nested ?? raw);
  if (!result) return null;
  const planId =
    strOrNull(raw.plan_id) ?? strOrNull(run.input.plan_id) ?? null;
  if (!planId) return null;
  return {
    planId,
    planVersionId: strOrNull(raw.version_id),
    version: intOrNull(raw.version),
    result
  };
}

export type AskOutcome = {
  answer: string;
  citations: Citation[];
  refused: boolean;
  refusalReason: string | null;
  boundaryNote: string | null;
};

export function parseAskResult(run: Run): AskOutcome | null {
  const raw = run.result;
  if (!isRecord(raw)) return null;
  const answer = str(raw.answer, str(raw.content, str(raw.text)));
  if (!answer) return null;
  const citations = normalizeCitations(raw.citations ?? raw.evidence);
  const refused =
    raw.refusal === true ||
    raw.refused === true ||
    (citations.length === 0 && str(raw.status) === "refused");
  return {
    answer,
    citations,
    refused,
    refusalReason: strOrNull(raw.refusal_reason) ?? strOrNull(raw.reason),
    boundaryNote: strOrNull(raw.boundary_note)
  };
}

export type CompareOutcome = {
  comparison: string;
  directionIds: DirectionId[];
  citations: Citation[];
};

export function parseCompareResult(run: Run): CompareOutcome | null {
  const raw = run.result;
  if (!isRecord(raw)) return null;
  const comparison = str(raw.comparison, str(raw.answer, str(raw.explanation)));
  if (!comparison) return null;
  const directionIds = Array.isArray(raw.direction_ids)
    ? raw.direction_ids.filter(isDirectionId)
    : [];
  return { comparison, directionIds, citations: normalizeCitations(raw.evidence ?? raw.citations) };
}

export type ExportRunOutcome = {
  artifactId: string;
  planId: string | null;
  planVersionId: string | null;
  artifact: { bytes: number | null; sha256: string | null; expiresAt: string | null } | null;
};

export function parseExportResult(run: Run): ExportRunOutcome | null {
  const raw = run.result;
  if (!isRecord(raw)) return null;
  const artifactRaw = isRecord(raw.artifact) ? raw.artifact : null;
  const artifactId = strOrNull(raw.artifact_id) ?? strOrNull(artifactRaw?.artifact_id);
  if (!artifactId) return null;
  return {
    artifactId,
    planId: strOrNull(raw.plan_id),
    planVersionId: strOrNull(raw.plan_version_id),
    artifact: artifactRaw
      ? {
          bytes: numOrNull(artifactRaw.bytes),
          sha256: strOrNull(artifactRaw.sha256),
          expiresAt: strOrNull(artifactRaw.expires_at)
        }
      : null
  };
}

/* ------------------------------------------------------------------ */
/* Run status helpers                                                  */
/* ------------------------------------------------------------------ */

export const TERMINAL_RUN_STATUSES = ["succeeded", "failed", "cancelled"] as const;

export function isTerminalRunStatus(status: string): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

export const RUN_STAGE_LABELS: Record<string, string> = {
  queued: "排队中",
  running: "执行中",
  parsing: "解析资料",
  embedding: "生成向量",
  retrieving: "检索证据",
  planning: "生成方案",
  rendering: "渲染文件",
  validating: "校验结果",
  succeeded: "已完成",
  failed: "生成失败",
  cancel_requested: "正在取消",
  cancelled: "已取消",
  progress: "执行中"
};

export function runStageLabel(status: string): string {
  return RUN_STAGE_LABELS[status] ?? status;
}

export function runFailureMessage(run: Run): string {
  if (run.status === "cancelled") return "任务已取消，没有生成结果";
  const code = run.error_code ?? "";
  const known = ERROR_CODES as readonly string[];
  const safeCode = known.includes(code) ? (code as ErrorCode) : "internal_error";
  return `生成失败：${ERROR_MESSAGES[safeCode] ?? ERROR_MESSAGES.internal_error}`;
}

/* ------------------------------------------------------------------ */
/* Run polling with hidden-page backoff                                */
/* ------------------------------------------------------------------ */

type SleepHelper = (ms: number, signal?: AbortSignal) => Promise<void>;

function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ApiError("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type PollRunOptions = {
  signal?: AbortSignal;
  intervalMs?: number;
  hiddenIntervalMs?: number;
  timeoutMs?: number;
  onUpdate?: (run: Run, events: RunEvent[]) => void;
};

export type PollRunResult = { run: Run; events: RunEvent[] };

/**
 * Poll `GET /api/runs/:id` plus incremental events. While the page is hidden the
 * interval backs off to `hiddenIntervalMs` (default 10s) instead of 2.5s.
 */
export async function pollRunUntilDone(
  runId: string,
  options: PollRunOptions = {}
): Promise<PollRunResult> {
  const intervalMs = options.intervalMs ?? 2500;
  const hiddenIntervalMs = options.hiddenIntervalMs ?? 10000;
  const timeoutMs = options.timeoutMs ?? 8 * 60 * 1000;
  const startedAt = Date.now();
  let afterSeq = 0;
  let lastWakeAt = startedAt;
  const events: RunEvent[] = [];

  for (;;) {
    if (options.signal?.aborted) throw new ApiError("aborted");
    const run = await getRun(runId, options.signal);

    let fresh: RunEvent[] = [];
    try {
      fresh = await getRunEvents(runId, afterSeq, options.signal);
    } catch (error) {
      if (error instanceof ApiError && (error.code === "aborted" || error.code === "not_configured")) {
        throw error;
      }
      // Events are an enhancement; status polling remains authoritative.
      fresh = [];
    }
    for (const event of fresh) {
      if (event.seq > afterSeq) {
        afterSeq = event.seq;
        events.push(event);
      }
    }
    options.onUpdate?.(run, events.slice());

    if (isTerminalRunStatus(run.status)) return { run, events };
    if (Date.now() - startedAt > timeoutMs) throw new ApiError("timeout");

    // A queued run means the worker VM is still waking up. The submit path
    // already tried once; retry here at most every 30s so a slow cold start
    // does not leave the user staring at a spinner.
    if (run.status === "queued" && Date.now() - startedAt > 20_000 && Date.now() - lastWakeAt > 30_000) {
      lastWakeAt = Date.now();
      void wakeRun(runId, options.signal).catch(() => undefined);
    }

    const hidden = typeof document !== "undefined" && document.hidden;
    await sleepWithSignal(hidden ? hiddenIntervalMs : intervalMs, options.signal);
  }
}

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

export function newIdempotencyKey(): string {
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Deterministic fingerprint so the same profile is not re-created needlessly. */
export function profileFingerprint(input: ProfileInput): string {
  const answers = Object.entries(input.answers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`);
  const payload = [
    input.school,
    input.major,
    input.enrollment_year,
    input.current_term,
    input.assessment_version,
    input.exploration_status,
    answers.join(","),
    input.preferences.weekly_hours ?? "",
    input.preferences.monthly_budget_cny ?? "",
    input.preferences.notes ?? ""
  ].join("|");
  return fnv1a(payload);
}

/** Only ever render URLs the server explicitly returned; no fabricated links. */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
  } catch {
    return null;
  }
  return null;
}

export type { Citation, Plan, PlanAction, PlanResult, Profile, ProfileInput, Run };
