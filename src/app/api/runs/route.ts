import { requireUser } from "@/lib/http/auth";
import { jsonError, jsonOk, zodError } from "@/lib/http/respond";
import { dbErrorResponse } from "@/lib/http/rpc";
import { createServerSupabase } from "@/lib/supabase/server";
import { RunSubmitSchema } from "@/lib/contracts/run";
import { inputHash } from "@/lib/runs/hash";
import { checkMonthlyBudget, checkRateLimit, directionExists, loadOwnedPlan, loadOwnedProfile } from "@/lib/runs/guards";

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("bad_request", "请求体必须是 JSON");
  }
  const parsed = RunSubmitSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);
  const submit = parsed.data;

  const budget = await checkMonthlyBudget(auth.user.id);
  if (budget) return jsonError(budget.code, budget.message);
  const limited = checkRateLimit(auth.user.id);
  if (limited) return jsonError(limited.code, limited.message);

  let input: Record<string, unknown>;
  let profileVersion: number | null = submit.profile_version ?? null;

  if (submit.kind === "plan" || submit.kind === "assessment_explain" || submit.kind === "compare") {
    if (!submit.profile_id) return jsonError("bad_request", "缺少 profile_id");
    const loaded = await loadOwnedProfile(submit.profile_id);
    if (loaded.error) return dbErrorResponse(loaded.error);
    if (!loaded.profile) return jsonError("resource_not_found", "画像不存在或无权访问");
    if (submit.profile_version && loaded.profile.version !== submit.profile_version) {
      return jsonError("version_conflict", "画像已更新，请刷新后重试");
    }
    profileVersion = loaded.profile.version;
  }

  if (submit.direction_id) {
    const direction = await directionExists(submit.direction_id);
    if (direction.error) return dbErrorResponse(direction.error);
    if (!direction.exists) return jsonError("unsupported_direction", "不支持的方向 ID");
  }

  if (submit.kind === "plan") {
    input = {
      profile_id: submit.profile_id,
      direction_id: submit.direction_id,
      plan_id: submit.plan_id ?? null
    };
  } else if (submit.kind === "export") {
    if (!submit.plan_id) return jsonError("bad_request", "缺少 plan_id");
    const loaded = await loadOwnedPlan(submit.plan_id);
    if (loaded.error) return dbErrorResponse(loaded.error);
    if (!loaded.plan) return jsonError("resource_not_found", "方案不存在或无权访问");
    input = {
      plan_id: submit.plan_id,
      plan_version_id: submit.plan_version_id ?? loaded.plan.current_version_id,
      direction_id: loaded.plan.direction_id
    };
  } else if (submit.kind === "ask") {
    input = {
      question: submit.question,
      history: submit.history ?? [],
      source_version_ids: submit.source_version_ids ?? [],
      profile_id: submit.profile_id ?? null
    };
  } else if (submit.kind === "compare") {
    input = {
      profile_id: submit.profile_id,
      direction_ids: submit.direction_ids ?? (submit.direction_id ? [submit.direction_id] : [])
    };
  } else {
    input = { profile_id: submit.profile_id };
  }

  const hash = inputHash(input);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("app_submit_run", {
    p_kind: submit.kind,
    p_idempotency_key: submit.idempotency_key,
    p_input: input,
    p_input_hash: hash,
    p_profile_version: profileVersion
  });
  if (error) return dbErrorResponse(error);
  const run = Array.isArray(data) ? data[0] : data;
  if (!run) return jsonError("internal_error", "任务创建失败");
  return jsonOk(
    {
      run_id: run.run_id,
      status: run.status,
      status_url: `/api/runs/${run.run_id}`,
      events_url: `/api/runs/${run.run_id}/events`
    },
    { status: 202 }
  );
}
