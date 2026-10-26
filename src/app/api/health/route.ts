import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { supabaseAdminConfigured, supabaseConfigured } from "@/lib/env";
import { getWorkerVmState } from "@/lib/freestyle/vm";
import { requestId } from "@/lib/http/respond";

export const dynamic = "force-dynamic";

export async function GET() {
  const rid = requestId();
  const payload: Record<string, unknown> = {
    ok: true,
    status: "ok",
    configured: supabaseConfigured(),
    anonymous_auth: true,
    checked_at: new Date().toISOString()
  };

  if (supabaseAdminConfigured()) {
    try {
      const admin = createAdminSupabase();
      const [sources, chunks, directions, profiles, activeProfile, queued, running] = await Promise.all([
        admin.from("app_sources").select("*", { count: "exact", head: true }),
        admin.from("app_chunks").select("*", { count: "exact", head: true }),
        admin.from("app_directions").select("*", { count: "exact", head: true }),
        admin.from("app_profiles").select("*", { count: "exact", head: true }),
        admin.from("app_embedding_profiles").select("profile_id, provider, model, dimensions, status").eq("status", "active").maybeSingle(),
        admin.from("app_runs").select("*", { count: "exact", head: true }).eq("status", "queued"),
        admin.from("app_runs").select("*", { count: "exact", head: true }).in("status", ["running", "parsing", "embedding", "retrieving", "planning", "rendering", "validating"])
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
      // "queue_polling" used to be hardcoded, so a paused worker still looked
      // healthy. Report the real VM state plus the queue depth instead.
      const vm = await getWorkerVmState();
      payload.worker = {
        state: vm.state,
        queue_backend: "supabase_queue",
        queued_runs: queued.count ?? null,
        running_runs: running.count ?? null,
        checked_at: vm.checked_at
      };
    } catch {
      payload.status = "degraded";
      payload.ok = false;
      payload.database = { reachable: false };
      payload.worker = { state: "unknown", queued_runs: null, running_runs: null };
    }
  } else {
    payload.status = "unconfigured";
    payload.database = { reachable: false };
    payload.worker = { state: "not_configured", queued_runs: null, running_runs: null };
  }

  return NextResponse.json({ request_id: rid, data: payload }, { status: 200 });
}
