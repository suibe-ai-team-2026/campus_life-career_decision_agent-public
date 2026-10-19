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
        .select("record_id, record_type, major, cohort, degree, included, verification_status"),
      admin.from("app_direction_requirements").select("direction_id, requirement_level")
    ]);

    if (directions.error || records.error || requirements.error) {
      return jsonOk({ ...base, mode: "seed" });
    }

    const activeIds = new Set((directions.data ?? []).map((row) => row.direction_id as string));
    const officialTypes = new Set(["official_observation", "municipal_metric"]);
    const officialRows = (records.data ?? []).filter((row) => officialTypes.has(String(row.record_type)));
    const officialRecords = officialRows.length;
    // "Exact" here means a distinct major x cohort x degree combination with an
    // official observation, not the 17-cell Shanghai matrix and not a success rate.
    const exactCombos = new Set(
      officialRows
        .filter((row) => row.major)
        .map((row) => `${String(row.major)}|${String(row.cohort ?? "")}|${String(row.degree ?? "")}`)
    ).size;
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
          exact_major_records: exactCombos,
          official_records: officialRecords,
          job_requirements: requirementCounts.get(card.direction_id) ?? 0,
          label:
            "官方/市级记录与专业×届别×学历组合为全库计数，不表示某一方向成功率；17 个精确同专业证据格仅覆盖部分组合，其余缺口不代表为零"
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
