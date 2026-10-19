import { requireUser } from "@/lib/http/auth";
import { jsonError, jsonOk, zodError } from "@/lib/http/respond";
import { dbErrorResponse } from "@/lib/http/rpc";
import { createServerSupabase } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/env";
import { ProfileInputSchema } from "@/lib/contracts/profile";
import { loadCurrentAssessment } from "@/lib/catalog/server";
import { scoreAssessment } from "@/lib/assessment/scoring";

export async function POST(request: Request) {
  if (!supabaseConfigured()) return jsonError("model_unavailable", "云端后端尚未配置");
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("bad_request", "请求体必须是 JSON");
  }
  const parsed = ProfileInputSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  const assessment = await loadCurrentAssessment();
  if (assessment.version !== parsed.data.assessment_version) {
    return jsonError("invalid_profile", "测评版本已更新，请刷新页面后重新作答");
  }

  // Scores are always recomputed on the server; client-supplied scores are ignored.
  const result = scoreAssessment(assessment, parsed.data.answers);
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("app_profiles")
    .insert({
      owner_id: auth.user.id,
      school: parsed.data.school,
      major: parsed.data.major,
      enrollment_year: parsed.data.enrollment_year,
      current_term: parsed.data.current_term,
      answers: parsed.data.answers,
      scores: result.scores,
      preferences: parsed.data.preferences,
      assessment_version: assessment.version,
      exploration_status: parsed.data.exploration_status
    })
    .select("profile_id, version, school, major, enrollment_year, current_term, answers, scores, preferences, assessment_version, exploration_status, created_at, updated_at")
    .single();

  if (error) return dbErrorResponse(error);
  return jsonOk({ profile: data, scoring: result }, { status: 201 });
}
