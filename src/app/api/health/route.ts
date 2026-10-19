import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { supabaseAdminConfigured, supabaseConfigured } from "@/lib/env";
import { requestId } from "@/lib/http/respond";

export const dynamic = "force-dynamic";

export async function GET() {
  const rid = requestId();
  const payload: Record<string, unknown> = {
    ok: true,
    status: "ok",
    configured: supabaseConfigured(),
    anonymous_auth: true,
    worker: "queue_polling",
    checked_at: new Date().toISOString()
  };

  if (supabaseAdminConfigured()) {
    try {
      const admin = createAdminSupabase();
      const [sources, chunks, directions, profiles, activeProfile] = await Promise.all([
        admin.from("app_sources").select("*", { count: "exact", head: true }),
        admin.from("app_chunks").select("*", { count: "exact", head: true }),
        admin.from("app_directions").select("*", { count: "exact", head: true }),
        admin.from("app_profiles").select("*", { count: "exact", head: true }),
        admin.from("app_embedding_profiles").select("profile_id, provider, model, dimensions, status").eq("status", "active").maybeSingle()
      ]);
      const reachable = !sources.error;
      payload.status = reachable ? "ok" : "degraded";
      payload.ok = reachable;
      payload.database = {
        reachable,
        sources: sources.count ?? null,
        chunks: chunks.count ?? null,
        directions: directions.count ?? null,
        profiles: profiles.count ?? null
      };
      payload.embedding = activeProfile.data ?? null;
    } catch {
      payload.status = "degraded";
      payload.ok = false;
      payload.database = { reachable: false };
    }
  } else {
    payload.status = "unconfigured";
    payload.database = { reachable: false };
  }

  return NextResponse.json({ request_id: rid, data: payload }, { status: 200 });
}
