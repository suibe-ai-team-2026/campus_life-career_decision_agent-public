import { requireUser } from "@/lib/http/auth";
import { jsonError, jsonOk, zodError } from "@/lib/http/respond";
import { dbErrorResponse } from "@/lib/http/rpc";
import { createServerSupabase } from "@/lib/supabase/server";
import { ActionPatchSchema } from "@/lib/contracts/plan";

type Params = { params: Promise<{ id: string; actionId: string }> };

/**
 * Persists user edits separately from machine-generated action fields.
 * expected_version makes concurrent edits a 409 instead of a silent overwrite.
 */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id, actionId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("bad_request", "请求体必须是 JSON");
  }
  const parsed = ActionPatchSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);
  const { expected_version, user_overrides } = parsed.data;

  const supabase = await createServerSupabase();
  const { data: existing, error: readError } = await supabase
    .from("app_plan_versions")
    .select("version_id, version, actions, user_overrides, plan_id")
    .eq("plan_id", id)
    .eq("version", expected_version)
    .maybeSingle();
  if (readError) return dbErrorResponse(readError);
  if (!existing) return jsonError("version_conflict", "方案版本已变化，请刷新后重试");

  const previous = (existing.user_overrides ?? {}) as Record<string, unknown>;
  const merged = { ...previous, [actionId]: { ...(previous[actionId] as Record<string, unknown> | undefined), ...user_overrides } };

  const { data: updated, error } = await supabase
    .from("app_plan_versions")
    .update({ user_overrides: merged })
    .eq("plan_id", id)
    .eq("version", expected_version)
    .select("plan_id, version_id, version, actions, user_overrides")
    .maybeSingle();
  if (error) return dbErrorResponse(error);
  if (!updated) return jsonError("version_conflict", "方案版本已变化，请刷新后重试");

  return jsonOk({
    plan_id: updated.plan_id,
    version_id: updated.version_id,
    version: updated.version,
    actions: updated.actions ?? [],
    user_overrides: updated.user_overrides ?? {}
  });
}
