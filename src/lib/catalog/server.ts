import { createAdminSupabase } from "@/lib/supabase/admin";
import { supabaseAdminConfigured } from "@/lib/env";
import { seedAssessment, seedDirections } from "./seed";
import { AssessmentSchema, type Assessment, type DirectionsResponse } from "@/lib/contracts/catalog";

export async function loadCurrentAssessment(): Promise<Assessment> {
  const fallback = seedAssessment();
  if (!supabaseAdminConfigured()) return fallback;
  try {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("app_assessments")
      .select("version, questions, scoring_spec, methodology_sources")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return fallback;
    // 题库版本由代码发布：数据库里的 active 行必须与随代码发布的版本一致，
    // 否则回退到随代码携带的 seed，避免线上出现「新版代码 + 旧版题目」。
    if (data.version !== fallback.version) return fallback;
    const parsed = AssessmentSchema.safeParse({
      version: data.version,
      title: fallback.title,
      disclaimer: fallback.disclaimer,
      methodology_sources: data.methodology_sources ?? fallback.methodology_sources,
      dimensions: fallback.dimensions,
      questions: data.questions,
      reverse_scored: fallback.reverse_scored
    });
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export async function loadDirections(): Promise<DirectionsResponse> {
  return seedDirections();
}
