import { requireUser } from "@/lib/http/auth";
import { jsonOk } from "@/lib/http/respond";
import { dbErrorResponse } from "@/lib/http/rpc";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("app_sources")
    .select("source_id, title, publisher, canonical_url, source_scope, visibility, verification_status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return dbErrorResponse(error);
  return jsonOk({ sources: data ?? [] });
}
