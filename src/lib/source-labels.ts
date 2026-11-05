/**
 * Human labels for machine values that reach the UI.
 *
 * Sources, versions and parsing runs are stored with stable English codes
 * (`official_curriculum_catalog`, `user_upload`, `pending`, …). Showing those
 * codes to students mixes scripts mid-sentence and reads like leaked internals,
 * so every surface renders a Chinese label and keeps the raw code only in
 * attributes when it is genuinely useful.
 */

const SOURCE_SCOPE_EXACT: Record<string, string> = {
  reference_data: "团队参考数据",
  official: "官方材料",
  public: "公开资料",
  internal: "内部材料",
  external: "外部资料",
  web: "实时网页",
  user_upload: "本人上传"
};

const SOURCE_SCOPE_PREFIX: Array<[string, string]> = [
  ["official_", "官方材料"],
  ["campus_", "学校材料"],
  ["school_", "学校材料"],
  ["job_", "招聘快照"],
  ["recruit_", "招聘快照"],
  ["research_", "研究参考"],
  ["reference_", "参考材料"],
  ["web_", "实时网页"]
];

const EXTRACTION_STATUS: Record<string, string> = {
  pending: "待解析",
  queued: "排队中",
  running: "解析中",
  processing: "解析中",
  parsed: "已解析",
  complete: "已解析",
  completed: "已解析",
  partial: "部分解析",
  ocr: "OCR 识别",
  failed: "解析失败",
  error: "解析失败"
};

const RUN_STATUS: Record<string, string> = {
  queued: "已排队",
  created: "已创建",
  uploaded: "已上传",
  pending: "处理中",
  running: "处理中",
  processing: "解析中",
  done: "已就绪",
  ready: "已就绪",
  succeeded: "已完成",
  success: "已完成",
  failed: "失败",
  error: "失败",
  cancelled: "已取消"
};

function hasCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function fromMap(map: Record<string, string>, value: string): string | null {
  const key = value.trim().toLowerCase();
  return map[key] ?? null;
}

export function sourceScopeLabel(scope: string | null | undefined): string | null {
  if (!scope || !scope.trim()) return null;
  if (hasCjk(scope)) return scope;
  const exact = fromMap(SOURCE_SCOPE_EXACT, scope);
  if (exact) return exact;
  const normalized = scope.trim().toLowerCase();
  const prefix = SOURCE_SCOPE_PREFIX.find(([key]) => normalized.startsWith(key));
  if (prefix) return prefix[1];
  return "参考材料";
}

export function extractionStatusLabel(status: string | null | undefined): string {
  if (!status || !status.trim()) return "已收录";
  if (hasCjk(status)) return status;
  return fromMap(EXTRACTION_STATUS, status) ?? "已收录";
}

export function parsingRunStatusLabel(status: string | null | undefined): string {
  if (!status || !status.trim()) return "处理中";
  if (hasCjk(status)) return status;
  return fromMap(RUN_STATUS, status) ?? "处理中";
}
