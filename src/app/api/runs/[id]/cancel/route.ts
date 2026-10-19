import { requireUser } from "@/lib/http/auth";
import { jsonError, jsonOk } from "@/lib/http/respond";
import { dbErrorResponse } from "@/lib/http/rpc";
import { createServerSupabase } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("app_cancel_run", { p_run_id: id });
  if (error) {
    if ((error.message ?? "").includes("resource_not_found")) {
      return jsonError("resource_not_found", "任务不存在或无权访问");
    }
    return dbErrorResponse(error);
  }
  const run = Array.isArray(data) ? data[0] : data;
  return jsonOk({ run });
}
