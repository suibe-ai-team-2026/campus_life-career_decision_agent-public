/**
 * Corpus admission + chunking for the worker's embedding pipeline.
 *
 * Admitted content (see docs/data-dictionary.md §corpus):
 *   1. unified evidence records (structured evidence; social_case backup excluded)
 *   2. official source title / verification cards (no fabricated body text)
 *   3. SUIBE 2015–2022 machine-extracted employment-report text (`extracted/pdf-text/*.txt`)
 *   4. research synthesis REPORT.md files
 *   5. the 115 direction requirements (job snapshot only)
 *   6. the 20 `web/plans/*.md` preparation plans (suggestions only)
 *
 * Every chunk is ≤ 1200 characters, carries a locator and a sha256. Text bodies
 * are never invented: source cards only restate recorded title/status metadata.
 */
import {
  corpusChunkId,
  sha256Hex,
  sourceVersionId,
  stableStringify
} from "./hash";
import { verificationClass } from "./snapshot";
import type {
  ImportPlan,
  JsonObject,
  RawRecord,
  RequirementRow,
  SourceRow,
  SourceVersionRow,
  SuibeTextFile,
  TextDocument
} from "./types";

export const CORPUS_VERSION = "career-corpus-2026-10-19.1";
export const SPLITTER_VERSION = "career-corpus-splitter-v1";
export const MAX_CHUNK_CHARS = 1200;

const CHUNK_KIND_ORDER = [
  "suibe_report_text",
  "research_synthesis",
  "plan_suggestion",
  "evidence_record",
  "job_requirement",
  "source_card"
] as const;

export type ChunkKind = (typeof CHUNK_KIND_ORDER)[number];

export interface CorpusLine {
  chunk_id: string;
  source_id: string;
  source_version_id: string;
  source_title: string;
  source_scope: string;
  verification_status: string;
  verification_status_raw: string;
  visibility: "approved_reference";
  chunk_kind: ChunkKind;
  record_id: string | null;
  record_type: string;
  chunk_text: string;
  locator: JsonObject;
  heading_path: string | null;
  search_terms: string;
  chars: number;
  sha256: string;
  ordinal: number;
}

export interface CorpusDocumentStat {
  source_id: string;
  title: string;
  source_scope: string;
  chunks: number;
  chars: number;
}

export interface CorpusExtraSource {
  source_id: string;
  title: string;
  publisher: string | null;
  source_scope: string;
  canonical_url: string | null;
  verification_status: string;
  verification_status_raw: string;
  visibility: "approved_reference";
  source_version: {
    source_version_id: string;
    content_sha256: string;
    content_sha256_kind: string;
    extraction_status: "partial";
    retrieved_at: string;
    storage_path: null;
    metadata: JsonObject;
  };
}

export interface CorpusExclusion {
  item: string;
  reason: string;
  count?: number;
}

export interface CorpusMeta {
  schema_version: string;
  corpus_version: string;
  splitter: { version: string; max_chunk_chars: number; boundary: string };
  generated_at: string;
  snapshot: {
    source_root: string;
    unified_snapshot_dir: string;
    snapshot_date: string;
    snapshot_hash: string;
    validation_file_sha256: string;
  };
  paths: { corpus: string; meta: string };
  counts: {
    chunks: number;
    chars: number;
    documents: number;
    body_documents: number;
    max_chunk_chars: number;
    min_chunk_chars: number;
    mean_chunk_chars: number;
    chunks_by_kind: Record<string, number>;
    chunks_by_source_scope: Record<string, number>;
    documents_by_source_scope: Record<string, number>;
    verification_class_counts: Record<string, number>;
    deduplicated_chunks: number;
    dropped_short_chunks: number;
  };
  documents: CorpusDocumentStat[];
  sources_without_publishable_body: {
    count: number;
    note: string;
    groups: { reason: string; count: number; source_ids: string[] }[];
  };
  excluded: CorpusExclusion[];
  source_registry_extra: CorpusExtraSource[];
  corpus_sha256: string | null;
  corpus_bytes: number | null;
}

export interface CorpusResult {
  lines: CorpusLine[];
  meta: CorpusMeta;
}

interface ChunkSeed {
  kind: ChunkKind;
  source_id: string;
  source_version_id: string;
  source_title: string;
  source_scope: string;
  verification_status: string;
  verification_status_raw: string;
  record_id: string | null;
  record_type: string;
  text: string;
  locator: JsonObject;
  heading_path: string | null;
  ordinal: number;
}

const RECORD_TYPE_LABELS: Record<string, string> = {
  official_observation: "官方就业观察",
  municipal_metric: "市级汇总指标",
  destination: "毕业去向观察",
  graduate_case_or_aggregate: "毕业生个案/研究生汇总",
  job: "招聘快照",
  research_claim: "研究摘要",
  social_case: "社交备用"
};

function compact(lines: (string | null | undefined | false)[]): string[] {
  return lines.filter((line): line is string => typeof line === "string" && line.trim() !== "");
}

function joinNonEmpty(parts: string[], separator = "；"): string {
  return parts.map((part) => part.trim()).filter((part) => part !== "").join(separator);
}

function numberText(value: number | null): string | null {
  if (value === null) return null;
  return Number.isInteger(value) ? String(value) : String(value);
}

function withUnit(value: number | null, unit: string | null): string | null {
  const text = numberText(value);
  if (text === null) return null;
  return unit ? `${text}${unit}` : text;
}

/** Read a string field from an original research payload without inventing values. */
function payloadString(record: RawRecord, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record.payload[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function numericValue(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function evidenceText(record: RawRecord, sourceTitle: string): string {
  const label = RECORD_TYPE_LABELS[record.record_type] ?? record.record_type;
  const headParts = [
    record.school,
    record.cohort ? `${record.cohort}届` : "",
    record.degree,
    record.major,
    record.metric
  ];
  const head = joinNonEmpty(headParts, " · ");
  const valueText = withUnit(numericValue(record.value), record.unit);
  const firstLine =
    head !== "" && valueText !== null
      ? `【${label}】${head}：${valueText}`
      : head !== ""
        ? `【${label}】${head}`
        : valueText !== null
          ? `【${label}】${valueText}`
          : `【${label}】记录 ${record.record_id}`;
  const lines: string[] = [firstLine];
  const countBits = compact([
    record.denominator.trim() !== "" ? `分母 ${record.denominator.trim()}` : null,
    record.numerator.trim() !== "" ? `分子 ${record.numerator.trim()}` : null,
    record.cutoff.trim() !== "" ? `统计日 ${record.cutoff.trim()}` : null,
    record.pdf_page.trim() !== "" ? `PDF 第 ${record.pdf_page.trim()} 页` : null
  ]);
  if (countBits.length > 0) lines.push(joinNonEmpty(countBits));

  const claimSummary = payloadString(record, ["claim_summary"]);
  const extra = compact([
    claimSummary,
    payloadString(record, ["outcome"]),
    payloadString(record, ["kind"]) ? `类型：${payloadString(record, ["kind"])}` : null,
    payloadString(record, ["outcome_stage"]) ? `阶段：${payloadString(record, ["outcome_stage"])}` : null,
    payloadString(record, ["company", "company_display_name"])
      ? `单位/公司：${payloadString(record, ["company", "company_display_name"])}`
      : null,
    payloadString(record, ["count"]) ? `人数：${payloadString(record, ["count"])}` : null,
    payloadString(record, ["job_title", "title"]) ? `岗位：${payloadString(record, ["job_title", "title"])}` : null,
    payloadString(record, ["skills", "skills_required", "task_skills"])
      ? `能力/任务：${payloadString(record, ["skills", "skills_required", "task_skills"])}`
      : null,
    payloadString(record, ["definition"]) ? `定义：${payloadString(record, ["definition"])}` : null,
    payloadString(record, ["scope", "population"]) ? `总体范围：${payloadString(record, ["scope", "population"])}` : null
  ]);
  for (const line of extra) lines.push(line);
  const caveat = payloadString(record, ["limit", "limitation"]);
  if (caveat) lines.push(`口径边界：${caveat}`);
  lines.push(`来源：${sourceTitle}`);
  lines.push(`核验状态：${record.verification_status.trim() || "未标注"}`);
  return lines.join("\n");
}

function requirementText(
  requirement: RequirementRow,
  directionTitle: string,
  record: RawRecord | undefined,
  sourceTitle: string
): string {
  const mapping = requirement.locator.direction_mapping;
  const method = mapping && typeof mapping === "object" && "method" in mapping
    ? String((mapping as JsonObject).method)
    : "unknown";
  const jobTitle = record ? payloadString(record, ["job_title", "title"]) : null;
  const company = record ? payloadString(record, ["company", "company_display_name"]) : null;
  const group = record ? payloadString(record, ["major_group", "group_id"]) : null;
  const lines = [
    `【招聘要求｜仅快照】${directionTitle} · ${requirement.skill_label}（级别 ${requirement.requirement_level}）`,
    compact([
      jobTitle ? `来源岗位：${jobTitle}` : null,
      company ? `公司（平台展示名）：${company}` : null,
      group ? `专业组：${group}` : null
    ]).join("；"),
    `分类依据：${String((requirement.locator as JsonObject).basis ?? "")}`,
    `方向映射方法：${method}；招聘分类摘要与职责不等于入职门槛，状态 unverified，不构成官方资格结论。`,
    `来源：${sourceTitle}`
  ];
  return joinNonEmpty(lines, "\n");
}

function sourceCardText(source: SourceRow): string {
  const metadata = source.metadata as JsonObject;
  const batches = Array.isArray(metadata.batches) ? (metadata.batches as string[]).join(" / ") : "";
  const lines = [
    `【来源登记】${source.title}`,
    compact([
      source.publisher ? `发布方：${source.publisher}` : null,
      `来源类型：${source.source_scope}`,
      batches ? `采集批次：${batches}` : null
    ]).join("；"),
    `核验状态（研究快照原文）：${source.verification_status}`,
    "说明：本卡片只登记来源标题与口径，不包含网页正文；引用数字请回到 canonical URL 或已登记原件核对。",
    source.canonical_url ? `URL：${source.canonical_url}` : "URL：快照未登记可公开 URL。"
  ];
  return lines.join("\n");
}

function paymentBreak(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];
  const parts: string[] = [];
  for (let index = 0; index < text.length; index += MAX_CHUNK_CHARS) {
    parts.push(text.slice(index, index + MAX_CHUNK_CHARS));
  }
  return parts;
}

/** Greedy line packer used for plain-text (machine-extracted) documents. */
interface PackedDocumentChunk {
  text: string;
  headingPath: string | null;
  lineStart: number;
  lineEnd: number;
}

/**
 * Greedy packer that fills chunks up to MAX_CHUNK_CHARS across section
 * boundaries (no forced flush per heading), so reports do not explode into
 * many tiny chunks. The heading path of the chunk start is kept for context.
 */
function packDocumentLines(
  lines: { text: string; path: string | null; line: number }[]
): PackedDocumentChunk[] {
  const chunks: PackedDocumentChunk[] = [];
  let current: string[] = [];
  let currentChars = 0;
  let chunkPath: string | null = null;
  let lastPath: string | null = null;
  let lineStart = 0;
  let lineEnd = 0;
  const flush = () => {
    const text = current.join("\n").trim();
    if (text !== "") chunks.push({ text, headingPath: chunkPath, lineStart, lineEnd });
    current = [];
    currentChars = 0;
  };
  for (const item of lines) {
    if (item.path !== null) lastPath = item.path;
    const pieces =
      item.text.length > MAX_CHUNK_CHARS
        ? [item.text.slice(0, MAX_CHUNK_CHARS), ...paymentBreak(item.text.slice(MAX_CHUNK_CHARS))]
        : [item.text];
    for (const piece of pieces) {
      const addition = piece.length + (current.length > 0 ? 1 : 0);
      if (currentChars + addition > MAX_CHUNK_CHARS && current.length > 0) flush();
      if (current.length === 0) {
        chunkPath = item.path ?? lastPath;
        lineStart = item.line;
      }
      current.push(piece);
      currentChars += addition;
      lineEnd = item.line;
    }
  }
  flush();
  // Merge a tiny trailing fragment into the previous chunk when it still fits.
  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1];
    const previous = chunks[chunks.length - 2];
    if (last.text.length < 40 && previous.text.length + last.text.length + 1 <= MAX_CHUNK_CHARS) {
      previous.text = `${previous.text}\n${last.text}`;
      previous.lineEnd = last.lineEnd;
      chunks.pop();
    }
  }
  return chunks;
}

function markdownDocumentLines(content: string): { text: string; path: string | null; line: number }[] {
  const stack: { level: number; title: string }[] = [];
  const items: { text: string; path: string | null; line: number }[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    const match = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    if (match) {
      const level = match[1].length;
      const title = match[2].trim();
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title });
    }
    items.push({
      text: line,
      path: stack.length > 0 ? stack.map((entry) => entry.title).join(" > ") : null,
      line: index + 1
    });
  });
  return items;
}

function markdownChunks(doc: TextDocument): PackedDocumentChunk[] {
  return packDocumentLines(markdownDocumentLines(doc.content));
}

const HEADING_PATTERNS = [
  /^第[一二三四五六七八九十百]+[篇章节]/,
  /^[一二三四五六七八九十]+[、.．]/,
  /^（[一二三四五六七八九十]+）/,
  /^附录/,
  /^目\s*录/
];

/** Machine-extracted SUIBE report text: line-based locators, no page numbers. */
function suibeChunks(doc: SuibeTextFile): PackedDocumentChunk[] {
  const items: { text: string; path: string | null; line: number }[] = [];
  let heading: string | null = null;
  doc.content.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed !== "" && HEADING_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      heading = trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
    }
    items.push({
      text: line,
      path: heading === null ? null : `${doc.year}届就业质量报告 > ${heading}`,
      line: index + 1
    });
  });
  return packDocumentLines(items);
}

function buildSearchTerms(text: string, context: string[]): string {
  const terms = new Set<string>();
  for (const item of context) {
    if (item.trim() !== "") terms.add(item.trim());
  }
  const ascii = text.match(/[A-Za-z][A-Za-z0-9+#./_-]{1,30}/g) ?? [];
  for (const token of ascii.slice(0, 24)) terms.add(token);
  const chinese = text.replace(/[^\u4e00-\u9fff]/g, " ").split(/\s+/).filter((token) => token.length >= 2);
  for (const token of chinese.slice(0, 30)) {
    if (token.length > 6) terms.add(token.slice(0, 6));
    else terms.add(token);
  }
  return Array.from(terms).join(" ").slice(0, 600);
}

function extraSourceId(prefix: string, key: string): string {
  return `src_${prefix}_${key}`;
}

function reportSlug(path: string): string {
  const match = /data\/research\/([^/]+)\/REPORT\.md$/.exec(path);
  return (match?.[1] ?? path).replace(/-2026-\d{2}-\d{2}$/, "").replace(/-/g, "_");
}

function planSlug(path: string): string {
  return /web\/plans\/(m\d{2})\.md$/.exec(path)?.[1] ?? path;
}

function reportTitle(doc: TextDocument): string {
  const firstHeading = doc.content.split(/\r?\n/).find((line) => line.trim().startsWith("# "));
  return firstHeading ? firstHeading.replace(/^#\s+/, "").trim() : doc.path;
}

interface ExtraSourceSeed {
  source: CorpusExtraSource;
  ref: SourceVersionRow;
}

function extraSources(plan: ImportPlan): ExtraSourceSeed[] {
  const extras: ExtraSourceSeed[] = [];
  const snapshotDate = plan.snapshot.snapshotDate;
  const retrievedAt = `${snapshotDate}T00:00:00.000Z`;

  const pushExtra = (options: {
    source_id: string;
    title: string;
    publisher: string | null;
    source_scope: string;
    canonical_url: string | null;
    verification_status: string;
    verification_status_raw: string;
    content_sha256: string;
    content_sha256_kind: string;
    repo_path: string;
    source_page_url?: string | null;
    extra_metadata?: JsonObject;
  }) => {
    const sourceVersionIdValue = sourceVersionId(options.source_id, options.content_sha256);
    const source: CorpusExtraSource = {
      source_id: options.source_id,
      title: options.title,
      publisher: options.publisher,
      source_scope: options.source_scope,
      canonical_url: options.canonical_url,
      verification_status: options.verification_status,
      verification_status_raw: options.verification_status_raw,
      visibility: "approved_reference",
      source_version: {
        source_version_id: sourceVersionIdValue,
        content_sha256: options.content_sha256,
        content_sha256_kind: options.content_sha256_kind,
        extraction_status: "partial",
        retrieved_at: retrievedAt,
        storage_path: null,
        metadata: {
          repo_path: options.repo_path,
          source_page_url: options.source_page_url ?? null,
          corpus_only: true,
          note: "corpus-only 来源，不在 unified 319 来源导入清单内；由 worker 在 embed 前登记（或后续单独迁移）。",
          ...(options.extra_metadata ?? {})
        }
      }
    };
    const ref: SourceVersionRow = {
      source_version_id: sourceVersionIdValue,
      source_id: options.source_id,
      content_sha256: options.content_sha256,
      published_at: null,
      retrieved_at: retrievedAt,
      effective_from: null,
      effective_to: null,
      storage_path: null,
      extraction_status: "partial",
      parser_version: null,
      metadata: { repo_path: options.repo_path, corpus_only: true },
      visibility: "approved_reference",
      owner_id: null
    };
    extras.push({ source, ref });
  };

  for (const doc of plan.snapshot.suibe.texts) {
    const edition = doc.edition.toLowerCase();
    const title = `上海对外经贸大学${doc.year}届毕业生就业质量年度报告${edition ? `（${doc.edition} 版）` : ""}（机器提取文本）`;
    pushExtra({
      source_id: extraSourceId("suibe_employment_report", `${doc.year}${edition}`),
      title,
      publisher: "上海对外经贸大学",
      source_scope: "school_employment_report_machine_text",
      canonical_url: null,
      verification_status: "partial",
      verification_status_raw:
        "机器从官方 PDF 提取文本；提取文本存在断句/页眉页脚混入，未逐条人工复核；无页码。",
      content_sha256: doc.pdf_sha256 ?? doc.sha256,
      content_sha256_kind: doc.pdf_sha256 ? "pdf-file" : "extracted-text",
      repo_path: doc.path,
      source_page_url: "https://www.suibe.edu.cn/xxgk/1267/list.htm",
      extra_metadata: {
        extracted_text_path: doc.path,
        extracted_text_sha256: doc.sha256,
        source_pdf_path: doc.pdf_path,
        source_pdf_sha256: doc.pdf_sha256,
        year: doc.year,
        edition: doc.edition || null
      }
    });
  }

  for (const doc of plan.snapshot.reports) {
    pushExtra({
      source_id: extraSourceId("research_synthesis", reportSlug(doc.path)),
      title: reportTitle(doc),
      publisher: "团队研究归纳（基于已登记来源）",
      source_scope: "research_synthesis",
      canonical_url: null,
      verification_status: "partial",
      verification_status_raw:
        "研究归纳文档（research_synthesis），不是一手官方数据；引用其中的数字必须回到其列出的原始来源。",
      content_sha256: doc.sha256,
      content_sha256_kind: "repo-file",
      repo_path: doc.path,
      extra_metadata: { report_path: doc.path }
    });
  }

  for (const doc of plan.snapshot.plans) {
    pushExtra({
      source_id: extraSourceId("plan_suggestion", planSlug(doc.path)),
      title: reportTitle(doc),
      publisher: "团队研究归纳（基于已登记来源）",
      source_scope: "plan_suggestion",
      canonical_url: null,
      verification_status: "unverified",
      verification_status_raw:
        "能力准备路线为研究建议（plan_suggestion），仅作规划参考，不构成岗位要求、录用概率或官方课程结论。",
      content_sha256: doc.sha256,
      content_sha256_kind: "repo-file",
      repo_path: doc.path,
      extra_metadata: { plan_path: doc.path }
    });
  }

  return extras;
}

export function buildCorpus(plan: ImportPlan): CorpusResult {
  const sourceById = new Map(plan.rows.sources.map((source) => [source.source_id, source]));
  const versionById = new Map(plan.rows.versions.map((version) => [version.source_version_id, version]));
  const recordsById = new Map(plan.snapshot.records.map((record) => [record.record_id, record]));
  const recordTypesBySource = new Map<string, Set<string>>();
  for (const record of plan.snapshot.records) {
    const set = recordTypesBySource.get(record.source_id) ?? new Set<string>();
    set.add(record.record_type);
    recordTypesBySource.set(record.source_id, set);
  }
  const directionTitleById = new Map(plan.rows.directions.map((direction) => [direction.direction_id, direction.title]));
  const extras = extraSources(plan);
  const extraBySourceId = new Map(extras.map((extra) => [extra.source.source_id, extra]));

  const seeds: ChunkSeed[] = [];

  const pushSeed = (options: {
    kind: ChunkKind;
    source_id: string;
    source_version_id: string;
    source_title: string;
    source_scope: string;
    verification_status: string;
    verification_status_raw: string;
    record_id: string | null;
    record_type: string;
    text: string;
    locator: JsonObject;
    heading_path: string | null;
    ordinal: number;
  }) => {
    for (const [index, part] of paymentBreak(options.text.trim()).entries()) {
      if (part.trim() === "") continue;
      seeds.push({ ...options, text: part, ordinal: options.ordinal + index });
    }
  };

  // 1) SUIBE 2015–2022 machine-extracted report text (body text).
  for (const extra of extras.filter((item) => item.source.source_scope === "school_employment_report_machine_text")) {
    const doc = plan.snapshot.suibe.texts.find(
      (text) => extraSourceId("suibe_employment_report", `${text.year}${text.edition.toLowerCase()}`) === extra.source.source_id
    );
    if (!doc) continue;
    for (const chunk of suibeChunks(doc)) {
      pushSeed({
        kind: "suibe_report_text",
        source_id: extra.source.source_id,
        source_version_id: extra.ref.source_version_id,
        source_title: extra.source.title,
        source_scope: extra.source.source_scope,
        verification_status: extra.source.verification_status,
        verification_status_raw: extra.source.verification_status_raw,
        record_id: doc.pdf_path,
        record_type: "official_report_text",
        text: chunk.text,
        locator: {
          kind: "pdf_text_extraction",
          file: doc.path,
          line_start: chunk.lineStart,
          line_end: chunk.lineEnd,
          page: null,
          page_note: "机器提取文本行号定位；提取文本没有可靠页码，禁止伪造页码。",
          source_pdf: doc.pdf_path,
          source_pdf_sha256: doc.pdf_sha256
        },
        heading_path: chunk.headingPath,
        ordinal: 0
      });
    }
  }

  // 2) Research synthesis REPORT.md files.
  for (const doc of plan.snapshot.reports) {
    const extra = extras.find(
      (item) => item.source.source_scope === "research_synthesis" && item.source.source_version.metadata.repo_path === doc.path
    );
    if (!extra) continue;
    let synthesisOrdinal = 0;
    for (const chunk of markdownChunks(doc)) {
      pushSeed({
        kind: "research_synthesis",
        source_id: extra.source.source_id,
        source_version_id: extra.ref.source_version_id,
        source_title: extra.source.title,
        source_scope: extra.source.source_scope,
        verification_status: extra.source.verification_status,
        verification_status_raw: extra.source.verification_status_raw,
        record_id: doc.path,
        record_type: "research_synthesis",
        text: chunk.text,
        locator: {
          kind: "research_report",
          file: doc.path,
          section: chunk.headingPath,
          line_start: chunk.lineStart,
          line_end: chunk.lineEnd
        },
        heading_path: chunk.headingPath,
        ordinal: synthesisOrdinal
      });
      synthesisOrdinal += 1;
    }
  }

  // 3) Preparation plans (suggestions only).
  for (const doc of plan.snapshot.plans) {
    const extra = extras.find(
      (item) => item.source.source_scope === "plan_suggestion" && item.source.source_version.metadata.repo_path === doc.path
    );
    if (!extra) continue;
    let planOrdinal = 0;
    for (const chunk of markdownChunks(doc)) {
      pushSeed({
        kind: "plan_suggestion",
        source_id: extra.source.source_id,
        source_version_id: extra.ref.source_version_id,
        source_title: extra.source.title,
        source_scope: extra.source.source_scope,
        verification_status: extra.source.verification_status,
        verification_status_raw: extra.source.verification_status_raw,
        record_id: doc.path,
        record_type: "plan_suggestion",
        text: chunk.text,
        locator: {
          kind: "plan_suggestion",
          file: doc.path,
          section: chunk.headingPath,
          line_start: chunk.lineStart,
          line_end: chunk.lineEnd
        },
        heading_path: chunk.headingPath,
        ordinal: planOrdinal
      });
      planOrdinal += 1;
    }
  }

  // 4) Structured evidence records (social_case backup excluded, see meta.excluded).
  // A record whose source also carries social_case rows stays out of the corpus:
  // 未核社交备用 must not be promoted by a different record_type label.
  for (const record of plan.snapshot.records) {
    if (record.record_type === "social_case") continue;
    if (recordTypesBySource.get(record.source_id)?.has("social_case")) continue;
    const source = sourceById.get(record.source_id);
    const version = plan.rows.versions.find((row) => row.source_id === record.source_id);
    if (!source || !version) continue;
    pushSeed({
      kind: "evidence_record",
      source_id: source.source_id,
      source_version_id: version.source_version_id,
      source_title: source.title,
      source_scope: source.source_scope,
      verification_status: verificationClass(record.verification_status),
      verification_status_raw: record.verification_status,
      record_id: record.record_id,
      record_type: record.record_type,
      text: evidenceText(record, source.title),
      locator: {
        kind: "evidence_record",
        record_id: record.record_id,
        record_type: record.record_type,
        cohort: record.cohort || null,
        school: record.school || null,
        degree: record.degree || null,
        major: record.major || null,
        pdf_page: record.pdf_page === "" ? null : Number(record.pdf_page),
        cutoff_raw: record.cutoff || null,
        original_included: record.included === "" ? null : record.included === "True",
        source_id: source.source_id,
        provenance: record.provenance
      },
      heading_path: `结构化证据/${record.record_type}`,
      ordinal: 0
    });
  }

  // 5) Direction requirements (job snapshot only).
  for (const requirement of plan.rows.requirements) {
    const version = versionById.get(requirement.source_version_id);
    if (!version) continue;
    const source = sourceById.get(version.source_id);
    if (!source) continue;
    const mapping = requirement.locator.direction_mapping as JsonObject | undefined;
    const parentRecordId =
      mapping && typeof mapping === "object"
        ? String((requirement.locator as JsonObject).record_id ?? "")
        : "";
    const record = recordsById.get(parentRecordId);
    pushSeed({
      kind: "job_requirement",
      source_id: source.source_id,
      source_version_id: requirement.source_version_id,
      source_title: source.title,
      source_scope: source.source_scope,
      verification_status: "unverified",
      verification_status_raw: "招聘分类摘要，未独立核验；不代表官方资格结论。",
      record_id: requirement.requirement_id,
      record_type: "job_requirement",
      text: requirementText(
        requirement,
        directionTitleById.get(requirement.direction_id) ?? requirement.direction_id,
        record,
        source.title
      ),
      locator: {
        kind: "job_requirement",
        requirement_id: requirement.requirement_id,
        record_id: parentRecordId || null,
        direction_id: requirement.direction_id,
        skill_label: requirement.skill_label,
        requirement_level: requirement.requirement_level,
        source_id: source.source_id
      },
      heading_path: `方向要求/${directionTitleById.get(requirement.direction_id) ?? requirement.direction_id}`,
      ordinal: 0
    });
  }

  // 6) Official source cards (title + recorded verification; no body text).
  const cardSources = plan.rows.sources.filter((source) => {
    const types = recordTypesBySource.get(source.source_id) ?? new Set<string>();
    // 未核社交备用来源（无论是否混有其他记录）不进入 corpus：不升级、不当作事实。
    return !types.has("social_case");
  });
  for (const source of cardSources) {
    const version = plan.rows.versions.find((row) => row.source_id === source.source_id);
    if (!version) continue;
    pushSeed({
      kind: "source_card",
      source_id: source.source_id,
      source_version_id: version.source_version_id,
      source_title: source.title,
      source_scope: source.source_scope,
      verification_status: verificationClass(source.verification_status),
      verification_status_raw: source.verification_status,
      record_id: null,
      record_type: "source",
      text: sourceCardText(source),
      locator: {
        kind: "source_catalog",
        source_id: source.source_id,
        canonical_url: source.canonical_url,
        source_scope: source.source_scope,
        batches: Array.isArray((source.metadata as JsonObject).batches)
          ? (source.metadata as JsonObject).batches
          : []
      },
      heading_path: `来源目录/${source.source_scope}`,
      ordinal: 0
    });
  }

  // Deterministic order, ordinal per (kind, source), content-hash de-duplication.
  const kindIndex = new Map<string, number>(CHUNK_KIND_ORDER.map((kind, index) => [kind, index]));
  seeds.sort((a, b) => {
    const kindDiff = (kindIndex.get(a.kind) ?? 99) - (kindIndex.get(b.kind) ?? 99);
    if (kindDiff !== 0) return kindDiff;
    if (a.source_id !== b.source_id) return a.source_id.localeCompare(b.source_id);
    if (a.ordinal !== b.ordinal) return a.ordinal - b.ordinal;
    return a.text.localeCompare(b.text);
  });

  const seen = new Set<string>();
  let deduplicated = 0;
  let droppedShort = 0;
  const lines: CorpusLine[] = [];
  for (const seed of seeds) {
    const text = seed.text.trim();
    if (text.length < 40) {
      droppedShort += 1;
      continue;
    }
    const textSha = sha256Hex(text);
    if (seen.has(textSha)) {
      deduplicated += 1;
      continue;
    }
    seen.add(textSha);
    if (text.length > MAX_CHUNK_CHARS) {
      throw new Error(`corpus chunk 超过 ${MAX_CHUNK_CHARS} 字符：${seed.source_id} ${seed.kind}`);
    }
    const chunkId = corpusChunkId([seed.kind, seed.source_id, seed.source_version_id, textSha]);
    lines.push({
      chunk_id: chunkId,
      source_id: seed.source_id,
      source_version_id: seed.source_version_id,
      source_title: seed.source_title,
      source_scope: seed.source_scope,
      verification_status: seed.verification_status,
      verification_status_raw: seed.verification_status_raw,
      visibility: "approved_reference",
      chunk_kind: seed.kind,
      record_id: seed.record_id,
      record_type: seed.record_type,
      chunk_text: text,
      locator: seed.locator,
      heading_path: seed.heading_path,
      search_terms: buildSearchTerms(text, [
        seed.source_title,
        seed.source_scope,
        seed.record_type,
        seed.heading_path ?? ""
      ]),
      chars: text.length,
      sha256: textSha,
      ordinal: seed.ordinal
    });
  }

  // --- meta statistics ------------------------------------------------------
  const chunksByKind: Record<string, number> = {};
  const chunksByScope: Record<string, number> = {};
  const verificationCounts: Record<string, number> = {};
  const docMap = new Map<string, CorpusDocumentStat>();
  let totalChars = 0;
  for (const line of lines) {
    totalChars += line.chars;
    chunksByKind[line.chunk_kind] = (chunksByKind[line.chunk_kind] ?? 0) + 1;
    chunksByScope[line.source_scope] = (chunksByScope[line.source_scope] ?? 0) + 1;
    verificationCounts[line.verification_status] = (verificationCounts[line.verification_status] ?? 0) + 1;
    const stat = docMap.get(line.source_id) ?? {
      source_id: line.source_id,
      title: line.source_title,
      source_scope: line.source_scope,
      chunks: 0,
      chars: 0
    };
    stat.chunks += 1;
    stat.chars += line.chars;
    docMap.set(line.source_id, stat);
  }
  const documents = Array.from(docMap.values()).sort((a, b) => a.source_id.localeCompare(b.source_id));
  const documentsByScope: Record<string, number> = {};
  for (const document of documents) {
    documentsByScope[document.source_scope] = (documentsByScope[document.source_scope] ?? 0) + 1;
  }
  const bodyDocumentIds = new Set(
    lines
      .filter((line) => ["suibe_report_text", "research_synthesis", "plan_suggestion"].includes(line.chunk_kind))
      .map((line) => line.source_id)
  );

  const sourceIdsWithBody = new Set(bodyDocumentIds);
  const noBodyGroups = new Map<string, string[]>();
  for (const source of plan.rows.sources) {
    if (sourceIdsWithBody.has(source.source_id)) continue;
    const types = recordTypesBySource.get(source.source_id) ?? new Set<string>();
    const nonSocial = Array.from(types).filter((type) => type !== "social_case");
    const reason =
      nonSocial.length > 0
        ? "只有结构化证据记录与来源标题，没有已清理的网页/PDF 正文"
        : types.size > 0
          ? "社交备用来源：不进入 corpus"
          : "只有来源标题/口径登记，没有正文";
    const list = noBodyGroups.get(reason) ?? [];
    list.push(source.source_id);
    noBodyGroups.set(reason, list);
  }

  const excluded: CorpusExclusion[] = [
    {
      item: "docs/product-v2.md",
      reason:
        "产品提案材料，通过率/薪资/英语门槛/竞品数字未核证；不进入事实库与语料。",
      count: 1
    },
    {
      item: "unified social_case 社交备用记录",
      reason: "未核验社交/自述内容（included=false），属于备用层，不进入语料；不升级 verified。",
      count: plan.snapshot.records.filter((record) => record.record_type === "social_case").length
    },
    {
      item: "来自社交/小红书来源的 research_claim 记录",
      reason:
        "这些记录（14 条）虽标为 research_claim，但来源同时承载 social_case 备用内容；按未核社交备用处理，不进入语料，仅保留在数据库供审计。",
      count: plan.snapshot.records.filter(
        (record) =>
          record.record_type !== "social_case" &&
          recordTypesBySource.get(record.source_id)?.has("social_case")
      ).length
    },
    {
      item: "suibe-2026-10-18/extracted/2023…OCR提取稿、2024…OCR提取稿",
      reason:
        "OCR 图表标签-数值配对存在系统性错位，未人工复核；不进入语料（仅登记在来源说明中）。",
      count: 2
    },
    {
      item: "web/plans 重复副本（m01 2.md … m20 2.md）",
      reason: "与 m01.md … m20.md 内容 SHA-256 相同，只收录去重后的 20 份。",
      count: 20
    },
    {
      item: "32 份培养方案 PDF / 2 份官方附件",
      reason: "只登记哈希与来源元数据，不解析正文；PDF 不等于结构化课程表。",
      count: 34
    },
    {
      item: "原始采集/运行文件、旧数据库与压缩包、页面截图副本",
      reason: "未随统一快照提交（unified README 已排除），无内容可导入。",
      count: 0
    },
    {
      item: "17 个精确同名专业证据格（evidence_cells.csv）",
      reason: "派生证据映射视图，不是独立正文；数字已在结构化证据中。",
      count: 17
    },
    {
      item: "file-audit.json / file-audit.csv / documents.md",
      reason: "审计元数据，不是内容正文。"
    }
  ];

  const meta: CorpusMeta = {
    schema_version: "career-corpus-meta-v1",
    corpus_version: CORPUS_VERSION,
    splitter: {
      version: SPLITTER_VERSION,
      max_chunk_chars: MAX_CHUNK_CHARS,
      boundary: "line/paragraph boundary for extracted text; markdown heading sections for reports/plans"
    },
    generated_at: new Date().toISOString(),
    snapshot: {
      source_root: plan.snapshot.sourceRootRelative,
      unified_snapshot_dir: "unified-2026-10-19",
      snapshot_date: plan.snapshot.snapshotDate,
      snapshot_hash: plan.snapshot.snapshotHash,
      validation_file_sha256: plan.snapshot.validationSha256
    },
    paths: { corpus: "data/import/out/corpus.jsonl", meta: "data/import/out/corpus-meta.json" },
    counts: {
      chunks: lines.length,
      chars: totalChars,
      documents: documents.length,
      body_documents: bodyDocumentIds.size,
      max_chunk_chars: Math.max(...lines.map((line) => line.chars)),
      min_chunk_chars: Math.min(...lines.map((line) => line.chars)),
      mean_chunk_chars: Math.round((totalChars / Math.max(lines.length, 1)) * 10) / 10,
      chunks_by_kind: chunksByKind,
      chunks_by_source_scope: chunksByScope,
      documents_by_source_scope: documentsByScope,
      verification_class_counts: verificationCounts,
      deduplicated_chunks: deduplicated,
      dropped_short_chunks: droppedShort
    },
    documents,
    sources_without_publishable_body: {
      count: plan.rows.sources.length - sourceIdsWithBody.size,
      note: "统一快照 319 个来源均无可直接发布的正文：34 份原件未解析，其余只有标题/口径与结构化证据。正文语料来自 9 份 SUIBE 机器提取报告、3 份研究归纳与 20 份方向方案（均为 corpus-only 来源，见 source_registry_extra）。",
      groups: Array.from(noBodyGroups.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([reason, ids]) => ({ reason, count: ids.length, source_ids: ids.sort() }))
    },
    excluded,
    source_registry_extra: extras.map((extra) => extra.source),
    corpus_sha256: null,
    corpus_bytes: null
  };

  const serialized = lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
  meta.corpus_sha256 = sha256Hex(serialized);
  meta.corpus_bytes = Buffer.byteLength(serialized, "utf8");
  void extraBySourceId;
  void stableStringify;
  void versionById;
  return { lines, meta };
}
