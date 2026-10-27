import { createAdminSupabase } from "@/lib/supabase/admin";
import { supabaseAdminConfigured } from "@/lib/env";
import { seedAssessment } from "@/lib/catalog/seed";
import { jsonOk } from "@/lib/http/respond";
import { AssessmentSchema } from "@/lib/contracts/catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  const fallback = seedAssessment();
  if (!supabaseAdminConfigured()) {
    return jsonOk({ assessment: fallback, mode: "seed" });
  }
  try {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("app_assessments")
      .select("version, questions, scoring_spec, methodology_sources")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return jsonOk({ assessment: fallback, mode: "seed" });
    if (data.version !== fallback.version) return jsonOk({ assessment: fallback, mode: "seed" });
    const parsed = AssessmentSchema.safeParse({
      version: data.version,
      title: fallback.title,
      disclaimer: fallback.disclaimer,
      methodology_sources: data.methodology_sources ?? fallback.methodology_sources,
      dimensions: fallback.dimensions,
      questions: data.questions,
      reverse_scored: fallback.reverse_scored
    });
    return jsonOk({ assessment: parsed.success ? parsed.data : fallback, mode: parsed.success ? "database" : "seed" });
  } catch {
    return jsonOk({ assessment: fallback, mode: "seed" });
  }
}
