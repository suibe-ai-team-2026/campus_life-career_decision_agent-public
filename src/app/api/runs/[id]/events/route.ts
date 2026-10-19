import { requireUser } from "@/lib/http/auth";
import { jsonOk } from "@/lib/http/respond";
import { dbErrorResponse } from "@/lib/http/rpc";
import { createServerSupabase } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const url = new URL(request.url);
  const afterRaw = Number(url.searchParams.get("after") ?? "0");
  const after = Number.isFinite(afterRaw) && afterRaw > 0 ? Math.floor(afterRaw) : 0;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("app_run_events")
    .select("run_id, seq, event_type, safe_payload, created_at")
    .eq("run_id", id)
    .gt("seq", after)
    .order("seq", { ascending: true })
    .limit(100);
  if (error) return dbErrorResponse(error);
  return jsonOk({ events: data ?? [] });
}
