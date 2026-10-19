import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { ErrorCode } from "@/lib/contracts/common";

export type GuardFailure = { code: ErrorCode; message: string };

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX_RUNS = 20;
const buckets = new Map<string, number[]>();

/**
 * Per-instance rate limit. Serverless instances do not share this map, so it is
 * a best-effort abuse guard, not a distributed quota. Budget checks below are
 * DB-backed and remain authoritative across instances.
 */
export function checkRateLimit(ownerId: string): GuardFailure | null {
  const now = Date.now();
  const recent = (buckets.get(ownerId) ?? []).filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_RUNS) {
    return { code: "rate_limited", message: "操作过于频繁，请稍后再试" };
  }
  recent.push(now);
  buckets.set(ownerId, recent);
  return null;
}

export async function checkMonthlyBudget(ownerId: string): Promise<GuardFailure | null> {
  const budgetRaw = process.env.MODEL_MONTHLY_BUDGET_USD;
  if (!budgetRaw || budgetRaw.trim() === "") return null; // unset = not configured, not infinite
  const budget = Number(budgetRaw);
  if (!Number.isFinite(budget) || budget <= 0) return null;

  const admin = createAdminSupabase();
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);
  const { data, error } = await admin
    .from("app_usage")
    .select("estimated_cost")
    .eq("owner_id", ownerId)
    .gte("created_at", startOfMonth.toISOString());
  if (error) return null; // do not block on observability table read failure
  const spent = (data ?? []).reduce((sum, row) => sum + Number((row as { estimated_cost: number | null }).estimated_cost ?? 0), 0);
  if (spent >= budget) return { code: "budget_exceeded", message: "本月模型预算已用尽，暂时不能发起新的 AI 任务" };
  return null;
}

export async function loadOwnedProfile(profileId: string) {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("app_profiles")
    .select("profile_id, owner_id, version, school, major, enrollment_year, current_term, answers, scores, preferences, assessment_version, exploration_status, updated_at")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) return { error };
  return { profile: data };
}

export async function loadOwnedPlan(planId: string) {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("app_plans")
    .select("plan_id, owner_id, profile_id, direction_id, current_version_id, created_at")
    .eq("plan_id", planId)
    .maybeSingle();
  if (error) return { error };
  return { plan: data };
}

export async function directionExists(directionId: string) {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("app_directions")
    .select("direction_id")
    .eq("direction_id", directionId)
    .eq("active", true)
    .maybeSingle();
  if (error) return { error };
  return { exists: Boolean(data) };
}
