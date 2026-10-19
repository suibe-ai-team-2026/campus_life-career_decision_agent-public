import { createAdminSupabase } from "@/lib/supabase/admin";
import { supabaseAdminConfigured } from "@/lib/env";
import { seedDirections } from "@/lib/catalog/seed";
import { jsonOk } from "@/lib/http/respond";
import type { DirectionCard } from "@/lib/contracts/catalog";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const base = seedDirections();
  if (!supabaseAdminConfigured()) {
    return jsonOk({ ...base, mode: "seed" });
  }

  try {
    const admin = createAdminSupabase();
    const [directions, records, requirements] = await Promise.all([
      admin.from("app_directions").select("direction_id, title, description, active").eq("active", true),
      admin
        .from("app_evidence_records")
        .select("record_id, record_type, major, included, verification_status")
        .eq("included", true),
      admin.from("app_direction_requirements").select("direction_id, requirement_level")
    ]);

    if (directions.error || records.error || requirements.error) {
      return jsonOk({ ...base, mode: "seed" });
    }

    const activeIds = new Set((directions.data ?? []).map((row) => row.direction_id as string));
    const officialTypes = new Set(["official_observation", "municipal_metric"]);
    const officialRecords = (records.data ?? []).filter((row) => officialTypes.has(String(row.record_type))).length;
    const exactRecords = (records.data ?? []).filter((row) => Boolean(row.major)).length;
    const requirementCounts = new Map<string, number>();
    for (const row of requirements.data ?? []) {
      const id = String(row.direction_id);
      requirementCounts.set(id, (requirementCounts.get(id) ?? 0) + 1);
    }

    const cards: DirectionCard[] = base.directions
      .filter((card) => activeIds.size === 0 || activeIds.has(card.direction_id))
      .map((card) => ({
        ...card,
        coverage: {
          exact_major_records: exactRecords,
          official_records: officialRecords,
          job_requirements: requirementCounts.get(card.direction_id) ?? 0,
          label:
            "官方/市级记录为全库计数，不表示某一方向成功率；精确同专业证据按届别/学历/专业分别核验"
        }
      }));

    return jsonOk({
      ...base,
      mode: "database",
      directions: cards
    });
  } catch {
    return jsonOk({ ...base, mode: "seed" });
  }
}
