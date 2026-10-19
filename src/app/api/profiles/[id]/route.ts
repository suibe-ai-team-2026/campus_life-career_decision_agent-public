import { requireUser } from "@/lib/http/auth";
import { jsonError, jsonOk, zodError } from "@/lib/http/respond";
import { dbErrorResponse } from "@/lib/http/rpc";
import { createServerSupabase } from "@/lib/supabase/server";
import { ProfileInputSchema } from "@/lib/contracts/profile";
import { loadCurrentAssessment } from "@/lib/catalog/server";
import { scoreAssessment } from "@/lib/assessment/scoring";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("app_profiles")
    .select("profile_id, version, school, major, enrollment_year, current_term, answers, scores, preferences, assessment_version, exploration_status, created_at, updated_at")
    .eq("profile_id", id)
    .maybeSingle();
  if (error) return dbErrorResponse(error);
  if (!data) return jsonError("resource_not_found", "画像不存在或无权访问");
  return jsonOk({ profile: data });
}

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("bad_request", "请求体必须是 JSON");
  }
  const expectedVersion = (body as { expected_version?: unknown })?.expected_version;
  if (typeof expectedVersion !== "number") return jsonError("bad_request", "缺少 expected_version");
  const parsed = ProfileInputSchema.safeParse((body as { profile?: unknown })?.profile);
  if (!parsed.success) return zodError(parsed.error);

  const assessment = await loadCurrentAssessment();
  if (assessment.version !== parsed.data.assessment_version) {
    return jsonError("invalid_profile", "测评版本已更新，请刷新页面后重新作答");
  }
  const result = scoreAssessment(assessment, parsed.data.answers);

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("app_profiles")
    .update({
      school: parsed.data.school,
      major: parsed.data.major,
      enrollment_year: parsed.data.enrollment_year,
      current_term: parsed.data.current_term,
      answers: parsed.data.answers,
      scores: result.scores,
      preferences: parsed.data.preferences,
      assessment_version: assessment.version,
      exploration_status: parsed.data.exploration_status,
      version: expectedVersion + 1,
      updated_at: new Date().toISOString()
    })
    .eq("profile_id", id)
    .eq("version", expectedVersion)
    .select("profile_id, version, school, major, enrollment_year, current_term, answers, scores, preferences, assessment_version, exploration_status, created_at, updated_at")
    .maybeSingle();
  if (error) return dbErrorResponse(error);
  if (!data) return jsonError("version_conflict", "画像已被其他操作更新，请刷新后重试");
  return jsonOk({ profile: data, scoring: result });
}
