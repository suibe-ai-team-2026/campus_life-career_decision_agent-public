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
    const [directions, requirements] = await Promise.all([
      admin.from("app_directions").select("direction_id, title, description, active").eq("active", true),
      admin.from("app_direction_requirements").select("direction_id, requirement_level")
    ]);

    if (directions.error || requirements.error) {
      return jsonOk({ ...base, mode: "seed" });
    }

    const activeIds = new Set((directions.data ?? []).map((row) => row.direction_id as string));
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
          // Evidence records are not mapped to product directions. Reusing a
          // library-wide count on every card would read like a direction fit
          // score, so direction coverage remains null until a per-direction
          // mapping is verified.
          exact_major_records: null,
          official_records: null,
          job_requirements: requirementCounts.get(card.direction_id) ?? 0,
          label:
            "仅统计与当前方向明确关联的要求；历史去向与官方记录尚未按方向完成归属，因此不展示全库数字"
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
