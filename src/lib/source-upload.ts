import type { UploadIntent } from "@/lib/contracts/source";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export type AcceptedMime =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "text/plain"
  | "text/markdown";

export const ACCEPTED_UPLOAD_MIME: Record<string, AcceptedMime> = {
  "application/pdf": "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain": "text/plain",
  "text/markdown": "text/markdown"
};

const MIME_BY_EXTENSION: Record<string, AcceptedMime> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown"
};

export const UPLOAD_ACCEPT_ATTR = ".pdf,.docx,.txt,.md";

/** 上传后用于检索的常见缺口资料，写进 UI 帮助用户知道该传什么。 */
export const UPLOAD_KIND_HINTS = [
  "本专业培养方案（课程、学分、开课学期）",
  "学分认定规则、学生手册相关章节",
  "学校认可的竞赛目录与加分认定办法",
  "近三届就业质量报告"
];

export type UploadFileLike = { name: string; size: number; type: string };

export type UploadValidation =
  | { ok: true; mimeType: AcceptedMime }
  | { ok: false; reason: string };

/**
 * 校验待上传文件。浏览器对 .md / .txt 给出的 mime 不稳定（常见空串），
 * 所以 mime 不匹配时按扩展名兜底，仍不匹配才拒绝。
 */
export function validateUploadFile(file: UploadFileLike): UploadValidation {
  const name = (file.name ?? "").trim();
  if (!name) return { ok: false, reason: "请选择要上传的文件" };
  if (file.size <= 0) return { ok: false, reason: "文件是空的" };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, reason: "文件超过 20MB 上限" };

  const declared = (file.type ?? "").toLowerCase();
  const known = ACCEPTED_UPLOAD_MIME[declared];
  if (known) return { ok: true, mimeType: known };

  const extension = name.toLowerCase().split(".").pop() ?? "";
  const guessed = MIME_BY_EXTENSION[extension];
  if (guessed) return { ok: true, mimeType: guessed };

  return { ok: false, reason: "只支持 PDF、DOCX、TXT、Markdown 四种格式" };
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

export type UploadIntentAck = { source_id: string; signed_url: string; max_bytes: number };
export type UploadCompleteAck = { run_id: string; status: string; source_version_id: string };

export type UploadDeps = {
  sha256Hex: (data: ArrayBuffer) => Promise<string>;
  requestIntent: (input: UploadIntent) => Promise<UploadIntentAck>;
  putFile: (signedUrl: string, file: Blob) => Promise<void>;
  complete: (input: {
    source_id: string;
    declared_sha256: string;
    title: string;
    idempotency_key: string;
  }) => Promise<UploadCompleteAck>;
  uuid: () => string;
};

export type UploadStep = "validating" | "hashing" | "requesting" | "uploading" | "completing" | "done";

export const UPLOAD_STEP_LABELS: Record<UploadStep, string> = {
  validating: "检查文件",
  hashing: "计算指纹",
  requesting: "申请上传地址",
  uploading: "上传文件",
  completing: "提交入库",
  done: "已提交，等待解析"
};

export type UploadResult = {
  sourceId: string;
  sourceVersionId: string;
  runId: string;
  status: string;
};

/**
 * 完整的上传编排：校验 → 计算 sha256 → 申请签名地址 → 直传 → 提交入库。
 *
 * 依赖全部注入，便于在不发真实请求的情况下验证调用顺序与失败短路。
 */
export async function uploadSourceFile(
  file: File & UploadFileLike,
  deps: UploadDeps,
  options: { title?: string; onStep?: (step: UploadStep) => void } = {}
): Promise<UploadResult> {
  options.onStep?.("validating");
  const validation = validateUploadFile(file);
  if (!validation.ok) throw new UploadError(validation.reason);

  options.onStep?.("hashing");
  const digest = await deps.sha256Hex(await file.arrayBuffer());
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new UploadError("文件指纹计算失败，请重试");

  options.onStep?.("requesting");
  const title = (options.title ?? "").trim() || file.name;
  const intent = await deps.requestIntent({
    filename: file.name,
    mime_type: validation.mimeType,
    bytes: file.size,
    title
  });
  if (intent.max_bytes > 0 && file.size > intent.max_bytes) {
    throw new UploadError("文件超过服务端允许的大小");
  }

  options.onStep?.("uploading");
  await deps.putFile(intent.signed_url, file);

  options.onStep?.("completing");
  const ack = await deps.complete({
    source_id: intent.source_id,
    declared_sha256: digest,
    title,
    idempotency_key: deps.uuid()
  });

  options.onStep?.("done");
  return {
    sourceId: intent.source_id,
    sourceVersionId: ack.source_version_id,
    runId: ack.run_id,
    status: ack.status
  };
}

/** 浏览器端 sha256：用 Web Crypto，不引第三方依赖。 */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
