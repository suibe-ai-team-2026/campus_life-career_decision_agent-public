import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/http/auth";
import { jsonError, jsonOk, zodError } from "@/lib/http/respond";
import { dbErrorResponse } from "@/lib/http/rpc";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { UploadIntentSchema } from "@/lib/contracts/source";

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "text/markdown": "md"
};

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("bad_request", "请求体必须是 JSON");
  }
  const parsed = UploadIntentSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  const sourceId = `user_${randomUUID()}`;
  const extension = MIME_EXT[parsed.data.mime_type] ?? "bin";
  const safeName = parsed.data.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const objectPath = `${auth.user.id}/${sourceId}/${randomUUID()}-${safeName || `upload.${extension}`}`;

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("app_sources").insert({
    source_id: sourceId,
    owner_id: auth.user.id,
    title: parsed.data.title ?? parsed.data.filename,
    visibility: "private",
    verification_status: "unverified",
    source_scope: "user_upload",
    metadata: {
      upload_path: objectPath,
      mime_type: parsed.data.mime_type,
      declared_bytes: parsed.data.bytes,
      original_filename: parsed.data.filename
    }
  });
  if (error) return dbErrorResponse(error);

  const admin = createAdminSupabase();
  const { data: signed, error: signError } = await admin.storage
    .from("career-source-files")
    .createSignedUploadUrl(objectPath);
  if (signError || !signed) {
    return jsonError("internal_error", "上传地址生成失败");
  }

  return jsonOk({
    source_id: sourceId,
    path: signed.path,
    token: signed.token,
    signed_url: signed.signedUrl,
    bucket: "career-source-files",
    max_bytes: 20 * 1024 * 1024
  });
}
