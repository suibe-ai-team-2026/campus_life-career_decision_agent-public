"use client";

/**
 * Browser-local progress for the five-step wizard.
 *
 * The canonical payload is `LocalProgressV1` from `./schema` and stays exactly
 * as frozen. Auxiliary records (choice detail, stale choice history, last
 * generated plan, local-only ordering, cloud profile pointer) live in separate
 * versioned keys so the frozen schema is never extended. Every key is prefixed
 * with `campus-pathway:` so "重新开始" can clear exactly this app's data.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { DirectionId } from "@/lib/contracts/common";
import type { PlanAction, PlanResult } from "@/lib/contracts/plan";
import {
  emptyProgress,
  migrateProgress,
  LOCAL_PROGRESS_SCHEMA_VERSION,
  type LocalProgressV1
} from "./schema";

export const STORAGE_PREFIX = "campus-pathway:";

export const STORAGE_KEYS = {
  progress: `${STORAGE_PREFIX}progress:v1`,
  choiceDetail: `${STORAGE_PREFIX}choice-detail:v1`,
  choiceHistory: `${STORAGE_PREFIX}choice-history:v1`,
  planCache: `${STORAGE_PREFIX}plan-cache:v1`,
  planOrder: `${STORAGE_PREFIX}plan-order:v1`,
  cloudProfile: `${STORAGE_PREFIX}cloud-profile:v1`,
  explorePrefs: `${STORAGE_PREFIX}explore-prefs:v1`
} as const;

/** Optional weekly-time / budget preferences. The frozen progress schema has no
 * preferences field, so they live in their own versioned key. */
export type ExplorePrefs = {
  weekly_hours: number | null;
  monthly_budget_cny: number | null;
  updated_at: string;
};

export type ChoiceDetail = {
  why: string;
  unknowns: string;
  updated_at: string;
};

export type ChoiceHistoryEntry = {
  direction_id: DirectionId;
  why: string;
  unknowns: string;
  revisit_on: string | null;
  created_at: string;
  stale_at: string | null;
  plan_id: string | null;
  plan_version_id: string | null;
};

export type CloudProfileCache = {
  profile_id: string;
  version: number;
  fingerprint: string;
  assessment_version: string;
  saved_at: string;
};

export type CachedPlanVersionMeta = {
  version_id: string;
  version: number;
  status: string;
  created_at: string;
};

/** Last successfully loaded cloud plan, kept so the user still sees saved
 * content when the cloud is temporarily unavailable. Never fabricated. */
export type CachedPlan = {
  plan_id: string;
  direction_id: DirectionId;
  current_version_id: string | null;
  version: number | null;
  version_status: string | null;
  profile_version: number | null;
  rules_version: string | null;
  corpus_version: string | null;
  fetched_at: string;
  result: PlanResult;
  actions: PlanAction[];
  user_overrides: Record<string, Record<string, unknown>>;
  versions: CachedPlanVersionMeta[];
};

export type PlanOrderMap = Record<string, string[]>;

export type NextStep = { href: string; index: number; title: string };

const EMPTY_CHOICE_DETAIL: ChoiceDetail = { why: "", unknowns: "", updated_at: "" };
const EMPTY_PLAN_ORDER: PlanOrderMap = {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------------------ */
/* Cross-tab listeners                                                 */
/* ------------------------------------------------------------------ */

type Listener = () => void;

const allListeners = new Set<Listener>();
let storageListenerAttached = false;

function ensureStorageListener() {
  if (storageListenerAttached || typeof window === "undefined") return;
  storageListenerAttached = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== null && !event.key.startsWith(STORAGE_PREFIX)) return;
    for (const listener of allListeners) listener();
  });
}

function notifyAll() {
  for (const listener of allListeners) listener();
}

function subscribeAll(listener: Listener): () => void {
  ensureStorageListener();
  allListeners.add(listener);
  return () => {
    allListeners.delete(listener);
  };
}

/** True after the first client mount; safe for SSR (server renders `false`). */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return hydrated;
}

/* ------------------------------------------------------------------ */
/* Canonical progress (nullable snapshot until hydration)              */
/* ------------------------------------------------------------------ */

let progressResetNotice = false;
let progressCached: LocalProgressV1 | null = null;
let progressSerialized: string | null = null;
let progressLoaded = false;

function readProgressSnapshot(): LocalProgressV1 | null {
  if (typeof window === "undefined") return null;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEYS.progress);
  } catch {
    stored = null;
  }
  if (progressLoaded && stored === progressSerialized) return progressCached;
  if (stored === null) {
    progressCached = emptyProgress();
  } else {
    try {
      const { progress, reset } = migrateProgress(JSON.parse(stored));
      if (reset) progressResetNotice = true;
      progressCached = progress;
    } catch {
      progressResetNotice = true;
      progressCached = emptyProgress();
    }
  }
  progressSerialized = stored;
  progressLoaded = true;
  return progressCached;
}

export function readLocalProgress(): LocalProgressV1 | null {
  return readProgressSnapshot();
}

export function saveLocalProgress(progress: LocalProgressV1): LocalProgressV1 {
  const clean: LocalProgressV1 = {
    ...progress,
    schema_version: LOCAL_PROGRESS_SCHEMA_VERSION,
    updated_at: new Date().toISOString()
  };
  progressCached = clean;
  progressLoaded = true;
  if (typeof window !== "undefined") {
    try {
      const nextSerialized = JSON.stringify(clean);
      window.localStorage.setItem(STORAGE_KEYS.progress, nextSerialized);
      progressSerialized = nextSerialized;
    } catch {
      progressSerialized = null;
    }
  }
  notifyAll();
  return clean;
}

export function updateLocalProgress(
  mutator: (draft: LocalProgressV1) => LocalProgressV1
): LocalProgressV1 {
  const current = readProgressSnapshot() ?? emptyProgress();
  const draft = JSON.parse(JSON.stringify(current)) as LocalProgressV1;
  return saveLocalProgress(mutator(draft));
}

export function clearLocalProgress() {
  progressCached = emptyProgress();
  progressLoaded = true;
  progressSerialized = null;
  progressResetNotice = false;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEYS.progress);
    } catch {
      // ignore
    }
  }
  notifyAll();
}

export function isMeaningfulProgress(progress: LocalProgressV1): boolean {
  const p = progress.profile;
  return Boolean(
    p.school ||
      p.major ||
      p.enrollment_year ||
      p.current_term ||
      p.completed_at ||
      p.skipped ||
      Object.keys(p.answers).length > 0 ||
      progress.favorites.length > 0 ||
      progress.provisional_direction ||
      progress.reason_summary ||
      progress.plan_id ||
      progress.exported_at
  );
}

/** Where "继续我的方案" should land, based on what is already saved locally. */
export function nextStepForProgress(progress: LocalProgressV1): NextStep {
  if (!progress.profile.completed_at) return { href: "/explore", index: 1, title: "自我探索" };
  if (progress.favorites.length === 0) return { href: "/directions", index: 2, title: "方向认知" };
  if (!progress.provisional_direction) return { href: "/choice", index: 3, title: "暂定方向" };
  if (!progress.plan_id) return { href: "/plan", index: 4, title: "行动方案" };
  return { href: "/export", index: 5, title: "导出分享" };
}

export function progressStepDone(progress: LocalProgressV1, index: number): boolean {
  switch (index) {
    case 1:
      return Boolean(progress.profile.completed_at);
    case 2:
      return progress.favorites.length >= 2;
    case 3:
      return Boolean(progress.provisional_direction && progress.reason_summary);
    case 4:
      return Boolean(progress.plan_id);
    case 5:
      return Boolean(progress.exported_at);
    default:
      return false;
  }
}

export function useLocalProgress(): {
  progress: LocalProgressV1 | null;
  hydrated: boolean;
  reset: typeof clearLocalProgress;
  resetNotice: boolean;
} {
  const progress = useSyncExternalStore(
    subscribeAll,
    readProgressSnapshot,
    () => null
  );
  return {
    progress,
    hydrated: progress !== null,
    reset: clearLocalProgress,
    resetNotice: progressResetNotice
  };
}

/* ------------------------------------------------------------------ */
/* Generic JSON stores (non-null payloads)                             */
/* ------------------------------------------------------------------ */

type JsonStore<T> = {
  key: string;
  read: () => T;
  write: (value: T) => T;
  clear: () => void;
  subscribe: (listener: Listener) => () => void;
  serverValue: T;
};

function createStore<T>(options: {
  key: string;
  parse: (raw: unknown) => T | null;
  makeDefault: () => T;
}): JsonStore<T> {
  const { key, parse, makeDefault } = options;
  const serverValue = makeDefault();
  let cached: T | null = null;
  let serialized: string | null = null;

  function read(): T {
    if (typeof window === "undefined") return serverValue;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(key);
    } catch {
      stored = null;
    }
    if (cached !== null && stored === serialized) return cached;
    if (stored === null) {
      cached = makeDefault();
      serialized = null;
      return cached;
    }
    try {
      const parsed = parse(JSON.parse(stored));
      cached = parsed === null ? makeDefault() : parsed;
    } catch {
      cached = makeDefault();
    }
    serialized = stored;
    return cached;
  }

  function write(value: T): T {
    if (typeof window !== "undefined") {
      try {
        const nextSerialized = JSON.stringify(value);
        window.localStorage.setItem(key, nextSerialized);
        cached = value;
        serialized = nextSerialized;
      } catch {
        cached = value;
        serialized = null;
      }
    } else {
      cached = value;
    }
    notifyAll();
    return value;
  }

  function clear() {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
    cached = makeDefault();
    serialized = null;
    notifyAll();
  }

  return { key, read, write, clear, subscribe: subscribeAll, serverValue };
}

/* ------------------------------------------------------------------ */
/* Choice detail + stale history                                       */
/* ------------------------------------------------------------------ */

const choiceDetailStore = createStore<ChoiceDetail>({
  key: STORAGE_KEYS.choiceDetail,
  parse: (raw) => {
    if (!isRecord(raw)) return null;
    return {
      why: typeof raw.why === "string" ? raw.why.slice(0, 1000) : "",
      unknowns: typeof raw.unknowns === "string" ? raw.unknowns.slice(0, 1000) : "",
      updated_at: typeof raw.updated_at === "string" ? raw.updated_at : ""
    };
  },
  makeDefault: () => ({ ...EMPTY_CHOICE_DETAIL })
});

export function readChoiceDetail(): ChoiceDetail {
  return choiceDetailStore.read();
}

export function writeChoiceDetail(detail: Omit<ChoiceDetail, "updated_at">): ChoiceDetail {
  return choiceDetailStore.write({ ...detail, updated_at: new Date().toISOString() });
}

const choiceHistoryStore = createStore<ChoiceHistoryEntry[]>({
  key: STORAGE_KEYS.choiceHistory,
  parse: (raw) => {
    if (!Array.isArray(raw)) return null;
    const entries = raw
      .filter(isRecord)
      .map((entry) => ({
        direction_id: entry.direction_id as DirectionId,
        why: typeof entry.why === "string" ? entry.why.slice(0, 1000) : "",
        unknowns: typeof entry.unknowns === "string" ? entry.unknowns.slice(0, 1000) : "",
        revisit_on: typeof entry.revisit_on === "string" ? entry.revisit_on : null,
        created_at: typeof entry.created_at === "string" ? entry.created_at : "",
        stale_at: typeof entry.stale_at === "string" ? entry.stale_at : null,
        plan_id: typeof entry.plan_id === "string" ? entry.plan_id : null,
        plan_version_id: typeof entry.plan_version_id === "string" ? entry.plan_version_id : null
      }))
      .filter((entry) => Boolean(entry.direction_id));
    return entries.slice(-8);
  },
  makeDefault: () => []
});

export function readChoiceHistory(): ChoiceHistoryEntry[] {
  return choiceHistoryStore.read();
}

/** Append the current provisional choice to history and mark older ones stale. */
export function pushChoiceHistory(
  entry: Omit<ChoiceHistoryEntry, "created_at" | "stale_at">
): ChoiceHistoryEntry[] {
  const now = new Date().toISOString();
  const previous = choiceHistoryStore.read().map((item) =>
    item.stale_at ? item : { ...item, stale_at: now }
  );
  return choiceHistoryStore.write([...previous, { ...entry, created_at: now, stale_at: null }].slice(-8));
}

/**
 * Record a direction that has just been replaced by a new provisional choice.
 * The entry is immediately marked stale; previous active entries are also
 * marked stale so only the newest stale record carries the transition.
 */
export function pushStaleChoiceHistory(
  entry: Omit<ChoiceHistoryEntry, "created_at" | "stale_at">
): ChoiceHistoryEntry[] {
  const now = new Date().toISOString();
  const previous = choiceHistoryStore.read().map((item) =>
    item.stale_at ? item : { ...item, stale_at: now }
  );
  return choiceHistoryStore.write([...previous, { ...entry, created_at: now, stale_at: now }].slice(-8));
}

export function clearChoiceHistory() {
  choiceHistoryStore.clear();
}

export function useChoiceDetail(): {
  detail: ChoiceDetail;
  hydrated: boolean;
  save: (detail: Omit<ChoiceDetail, "updated_at">) => void;
} {
  const detail = useSyncExternalStore(
    choiceDetailStore.subscribe,
    choiceDetailStore.read,
    () => choiceDetailStore.serverValue
  );
  const hydrated = useHydrated();
  return {
    detail,
    hydrated,
    save: (next) => {
      writeChoiceDetail(next);
    }
  };
}

export function useChoiceHistory(): ChoiceHistoryEntry[] {
  return useSyncExternalStore(
    choiceHistoryStore.subscribe,
    choiceHistoryStore.read,
    () => choiceHistoryStore.serverValue
  );
}

/* ------------------------------------------------------------------ */
/* Plan cache (read-only fallback when cloud is down)                  */
/* ------------------------------------------------------------------ */

function parseCachedPlan(raw: unknown): CachedPlan | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.plan_id !== "string" || !isRecord(raw.result)) return null;
  const result = raw.result as unknown as PlanResult;
  if (!Array.isArray(result.actions) || typeof result.rules_version !== "string") return null;
  if (!Array.isArray(raw.actions)) return null;
  const userOverrides: Record<string, Record<string, unknown>> = {};
  if (isRecord(raw.user_overrides)) {
    for (const [actionId, value] of Object.entries(raw.user_overrides)) {
      if (isRecord(value)) userOverrides[actionId] = value;
    }
  }
  return { ...(raw as unknown as CachedPlan), user_overrides: userOverrides };
}

const planCacheStore = createStore<CachedPlan | null>({
  key: STORAGE_KEYS.planCache,
  parse: parseCachedPlan,
  makeDefault: () => null
});

export function readPlanCache(): CachedPlan | null {
  return planCacheStore.read();
}

export function writePlanCache(cache: CachedPlan) {
  planCacheStore.write(cache);
}

export function clearPlanCache() {
  planCacheStore.clear();
}

export function usePlanCache(): { cache: CachedPlan | null; hydrated: boolean } {
  const cache = useSyncExternalStore(
    planCacheStore.subscribe,
    planCacheStore.read,
    () => null
  );
  return { cache, hydrated: useHydrated() };
}

/* ------------------------------------------------------------------ */
/* Local-only action ordering                                          */
/* ------------------------------------------------------------------ */

const planOrderStore = createStore<PlanOrderMap>({
  key: STORAGE_KEYS.planOrder,
  parse: (raw) => {
    if (!isRecord(raw)) return null;
    const clean: PlanOrderMap = {};
    for (const [planId, order] of Object.entries(raw)) {
      if (Array.isArray(order)) {
        clean[planId] = order.filter((id): id is string => typeof id === "string");
      }
    }
    return clean;
  },
  makeDefault: () => ({ ...EMPTY_PLAN_ORDER })
});

export function readPlanOrder(planId: string): string[] {
  return planOrderStore.read()[planId] ?? [];
}

export function writePlanOrder(planId: string, order: string[]) {
  const current = planOrderStore.read();
  planOrderStore.write({ ...current, [planId]: order });
}

/* ------------------------------------------------------------------ */
/* Optional explore preferences (weekly time / budget)                 */
/* ------------------------------------------------------------------ */

const explorePrefsStore = createStore<ExplorePrefs>({
  key: STORAGE_KEYS.explorePrefs,
  parse: (raw) => {
    if (!isRecord(raw)) return null;
    const hours = raw.weekly_hours;
    const budget = raw.monthly_budget_cny;
    return {
      weekly_hours: typeof hours === "number" && Number.isFinite(hours) ? hours : null,
      monthly_budget_cny: typeof budget === "number" && Number.isFinite(budget) ? budget : null,
      updated_at: typeof raw.updated_at === "string" ? raw.updated_at : ""
    };
  },
  makeDefault: () => ({ weekly_hours: null, monthly_budget_cny: null, updated_at: "" })
});

export function readExplorePrefs(): ExplorePrefs {
  return explorePrefsStore.read();
}

export function writeExplorePrefs(prefs: Omit<ExplorePrefs, "updated_at">): ExplorePrefs {
  return explorePrefsStore.write({ ...prefs, updated_at: new Date().toISOString() });
}

/* ------------------------------------------------------------------ */
/* Cloud profile pointer                                               */
/* ------------------------------------------------------------------ */

const cloudProfileStore = createStore<CloudProfileCache | null>({
  key: STORAGE_KEYS.cloudProfile,
  parse: (raw) => {
    if (!isRecord(raw)) return null;
    if (typeof raw.profile_id !== "string") return null;
    return {
      profile_id: raw.profile_id,
      version: typeof raw.version === "number" ? raw.version : 1,
      fingerprint: typeof raw.fingerprint === "string" ? raw.fingerprint : "",
      assessment_version: typeof raw.assessment_version === "string" ? raw.assessment_version : "",
      saved_at: typeof raw.saved_at === "string" ? raw.saved_at : ""
    };
  },
  makeDefault: () => null
});

export function readCloudProfile(): CloudProfileCache | null {
  return cloudProfileStore.read();
}

export function writeCloudProfile(cache: CloudProfileCache) {
  cloudProfileStore.write(cache);
}

export function clearCloudProfile() {
  cloudProfileStore.clear();
}

/* ------------------------------------------------------------------ */
/* Reset                                                               */
/* ------------------------------------------------------------------ */

export const RESET_SCOPE = [
  "学校、专业、入学年份、当前学期与每周时间/预算偏好",
  "10 道轻测的作答、跳过标记与本地画像",
  "方向收藏、暂定方向、理由、未知与复核时间（含历史版本提示）",
  "本设备缓存的上一次行动方案、本地排序与勾选记录",
  "导出完成标记",
  "本次浏览器保存的云端画像指针与匿名会话引用"
] as const;

export const RESET_KEEPS = [
  "云端已生成的方案与引用快照仍保留在服务器上（匿名会话内），本操作不删除云端数据",
  "资料库的问答记录只存在于当前页面，不会写入本地",
  "云端账号、密钥等配置不受影响"
] as const;

/** Clear every key this app owns, in every tab. */
export function resetAllLocalProgress(): void {
  if (typeof window !== "undefined") {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith(STORAGE_PREFIX)) keysToRemove.push(key);
      }
      for (const key of keysToRemove) window.localStorage.removeItem(key);
    } catch {
      for (const key of Object.values(STORAGE_KEYS)) {
        try {
          window.localStorage.removeItem(key);
        } catch {
          // ignore
        }
      }
    }
  }
  progressResetNotice = false;
  progressCached = emptyProgress();
  progressLoaded = true;
  progressSerialized = null;
  choiceDetailStore.clear();
  choiceHistoryStore.clear();
  planCacheStore.clear();
  planOrderStore.clear();
  explorePrefsStore.clear();
  cloudProfileStore.clear();
  notifyAll();
}

export type { LocalProgressV1 };
