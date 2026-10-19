import { createHash, randomUUID } from "node:crypto";
import { requireUser } from "@/lib/http/auth";
import { jsonError, jsonOk, zodError } from "@/lib/http/respond";
import { dbErrorResponse } from "@/lib/http/rpc";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { UploadCompleteSchema } from "@/lib/contracts/source";
import { inputHash } from "@/lib/runs/hash";
import { wakeWorker } from "@/lib/freestyle/vm";

type Params = { params: Promise<{ id: string }> };

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request, { params }: Params) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("bad_request", "请求体必须是 JSON");
  }
  const parsed = UploadCompleteSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);
  if (parsed.data.source_id !== id) return jsonError("bad_request", "source_id 与路径不一致");

  const supabase = await createServerSupabase();
  const { data: source, error: sourceError } = await supabase
    .from("app_sources")
    .select("source_id, owner_id, visibility, title, metadata")
    .eq("source_id", id)
    .maybeSingle();
  if (sourceError) return dbErrorResponse(sourceError);
  if (!source) return jsonError("resource_not_found", "来源不存在或无权访问");
  if (source.visibility !== "private") return jsonError("bad_request", "只有私有上传可以提交入库");

  const metadata = (source.metadata ?? {}) as Record<string, unknown>;
  const objectPath = typeof metadata.upload_path === "string" ? metadata.upload_path : null;
  if (!objectPath) return jsonError("resource_not_found", "未找到上传记录");

  const admin = createAdminSupabase();
  const { data: blob, error: downloadError } = await admin.storage.from("career-source-files").download(objectPath);
  if (downloadError || !blob) return jsonError("resource_not_found", "上传文件不存在或尚未完成上传");

  const bytes = Buffer.from(await blob.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return jsonError("upload_too_large", "文件超过 20MB 限制");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== parsed.data.declared_sha256) {
    return jsonError("bad_request", "文件内容与声明的 sha256 不一致");
  }

  // Reuse the version when the same source already has this content hash.
  const { data: existingVersion, error: versionReadError } = await supabase
    .from("app_source_versions")
    .select("source_version_id, extraction_status")
    .eq("source_id", id)
    .eq("content_sha256", sha256)
    .maybeSingle();
  if (versionReadError) return dbErrorResponse(versionReadError);

  let sourceVersionId = existingVersion?.source_version_id ?? null;
  if (!sourceVersionId) {
    const { data: inserted, error: insertError } = await supabase
      .from("app_source_versions")
      .insert({
        source_id: id,
        content_sha256: sha256,
        storage_path: objectPath,
        extraction_status: "pending",
        visibility: "private",
        owner_id: auth.user.id,
        metadata: { bytes: bytes.byteLength, mime_type: metadata.mime_type ?? null }
      })
      .select("source_version_id")
      .single();
    if (insertError) return dbErrorResponse(insertError);
    sourceVersionId = inserted.source_version_id;
  }

  const input = { source_id: id, source_version_id: sourceVersionId };
  const hash = inputHash(input);
  const runId = randomUUID();
  const { data: existingRun, error: runReadError } = await admin
    .from("app_runs")
    .select("run_id, status")
    .eq("owner_id", auth.user.id)
    .eq("kind", "ingest")
    .eq("idempotency_key", parsed.data.idempotency_key)
    .maybeSingle();
  if (runReadError) return jsonError("internal_error", "任务创建失败");
  if (existingRun) {
    return jsonOk({ run_id: existingRun.run_id, status: existingRun.status, source_version_id: sourceVersionId }, { status: 202 });
  }

  const { data: run, error: runError } = await admin
    .from("app_runs")
    .insert({
      run_id: runId,
      owner_id: auth.user.id,
      kind: "ingest",
      input,
      input_hash: hash,
      idempotency_key: parsed.data.idempotency_key
    })
    .select("run_id, status")
    .single();
  if (runError) return jsonError("internal_error", "任务创建失败");
  const workerWake = await wakeWorker();
  return jsonOk({ run_id: run.run_id, status: run.status, source_version_id: sourceVersionId, worker_wake: workerWake }, { status: 202 });
}
