import { requireUser } from "@/lib/http/auth";
import { jsonError, jsonOk } from "@/lib/http/respond";
import { dbErrorResponse } from "@/lib/http/rpc";
import { createServerSupabase } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: run, error } = await supabase
    .from("app_runs")
    .select("run_id, kind, status, progress, input, error_code, result_ref, created_at, started_at, finished_at, cancel_requested")
    .eq("run_id", id)
    .maybeSingle();
  if (error) return dbErrorResponse(error);
  if (!run) return jsonError("resource_not_found", "任务不存在或无权访问");

  let result: unknown = null;
  if (run.result_ref) {
    const { data: resultRow } = await supabase
      .from("app_run_results")
      .select("payload")
      .eq("run_id", run.result_ref)
      .maybeSingle();
    result = resultRow?.payload ?? null;
  }

  return jsonOk({ run: { ...run, result } });
}
