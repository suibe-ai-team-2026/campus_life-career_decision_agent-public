import { requireUser } from "@/lib/http/auth";
import { jsonError, jsonOk } from "@/lib/http/respond";
import { dbErrorResponse } from "@/lib/http/rpc";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const supabase = await createServerSupabase();
  const { data: artifact, error } = await supabase
    .from("app_artifacts")
    .select("artifact_id, owner_id, storage_path, kind, sha256, bytes")
    .eq("artifact_id", id)
    .maybeSingle();
  if (error) return dbErrorResponse(error);
  if (!artifact) return jsonError("resource_not_found", "文件不存在或无权访问");

  const admin = createAdminSupabase();
  const { data: signed, error: signError } = await admin.storage
    .from("career-artifacts")
    .createSignedUrl(artifact.storage_path, 60);
  if (signError || !signed) return jsonError("internal_error", "下载地址生成失败");

  return jsonOk({
    artifact_id: artifact.artifact_id,
    kind: artifact.kind,
    sha256: artifact.sha256,
    bytes: artifact.bytes,
    url: signed.signedUrl,
    expires_in: 60
  });
}
