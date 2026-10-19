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
