import { requireUser } from "@/lib/http/auth";
import { jsonError, jsonOk } from "@/lib/http/respond";
import { dbErrorResponse } from "@/lib/http/rpc";
import { createServerSupabase } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const supabase = await createServerSupabase();

  const { data: plan, error } = await supabase
    .from("app_plans")
    .select("plan_id, profile_id, direction_id, current_version_id, created_at")
    .eq("plan_id", id)
    .maybeSingle();
  if (error) return dbErrorResponse(error);
  if (!plan) return jsonError("resource_not_found", "方案不存在或无权访问");

  const { data: versions, error: versionError } = await supabase
    .from("app_plan_versions")
    .select("version_id, plan_id, version, profile_version, rules_version, corpus_version, embedding_profile_id, actions, user_overrides, warnings, status, result, created_at")
    .eq("plan_id", id)
    .order("version", { ascending: false });
  if (versionError) return dbErrorResponse(versionError);

  return jsonOk({ plan: { ...plan, versions: versions ?? [] } });
}
