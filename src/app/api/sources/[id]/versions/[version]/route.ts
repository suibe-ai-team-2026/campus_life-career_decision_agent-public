import { requireUser } from "@/lib/http/auth";
import { jsonError, jsonOk } from "@/lib/http/respond";
import { dbErrorResponse } from "@/lib/http/rpc";
import { createServerSupabase } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string; version: string }> };

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id, version } = await params;
  const supabase = await createServerSupabase();

  const { data: sourceRow, error: sourceError } = await supabase
    .from("app_sources")
    .select("source_id, title, publisher, canonical_url, source_scope, visibility, verification_status")
    .eq("source_id", id)
    .maybeSingle();
  if (sourceError) return dbErrorResponse(sourceError);
  if (!sourceRow) return jsonError("resource_not_found", "来源不存在或无权访问");

  const { data: versionRow, error } = await supabase
    .from("app_source_versions")
    .select("source_version_id, content_sha256, published_at, retrieved_at, extraction_status, parser_version, metadata, storage_path")
    .eq("source_version_id", version)
    .eq("source_id", id)
    .maybeSingle();
  if (error) return dbErrorResponse(error);
  if (!versionRow) return jsonError("resource_not_found", "版本不存在或无权访问");

  // Never expose a storage path or signed URL here; citations return only a locator.
  const { storage_path: _storagePath, ...safeVersion } = versionRow;
  return jsonOk({
    source: sourceRow,
    version: { ...safeVersion, has_original: Boolean(_storagePath) }
  });
}
