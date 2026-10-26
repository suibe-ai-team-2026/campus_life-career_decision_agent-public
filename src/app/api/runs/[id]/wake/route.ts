import { requireUser } from "@/lib/http/auth";
import { jsonError, jsonOk } from "@/lib/http/respond";
import { dbErrorResponse } from "@/lib/http/rpc";
import { createServerSupabase } from "@/lib/supabase/server";
import { wakeWorker } from "@/lib/freestyle/vm";

type Params = { params: Promise<{ id: string }> };

/**
 * Client-triggered wake for a run that has been queued for a while.
 *
 * The first wake attempt happens when the run is submitted; if the VM was in a
 * slow transition (`starting`) that attempt may return without the worker
 * actually polling yet. The client then retries this endpoint while the run is
 * still queued, so a cold VM cannot leave the user waiting for 8 minutes.
 */
export async function POST(_request: Request, { params }: Params) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: run, error } = await supabase
    .from("app_runs")
    .select("run_id, status")
    .eq("run_id", id)
    .maybeSingle();
  if (error) return dbErrorResponse(error);
  if (!run) return jsonError("resource_not_found", "任务不存在或无权访问");
  if (run.status !== "queued") return jsonOk({ run_id: run.run_id, worker_wake: "not_needed" });
  const workerWake = await wakeWorker();
  return jsonOk({ run_id: run.run_id, worker_wake: workerWake });
}
