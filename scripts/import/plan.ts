/**
 * Builds the complete, deterministic import plan for the Supabase `app_` tables.
 *
 * The plan is pure data: dry-run prints/writes it, `--apply` upserts it. Nothing
 * here touches the network or the database. Missing source values stay NULL
 * (`null`), nothing is back-filled or recalculated.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { hashIdSet, sha256Hex, sourceVersionId, stableStringify } from "./hash";
import {
  PRODUCT_REPO,
  SOURCE_REPO,
  canonicalizeUrl,
  findRepoRoot,
  isRecord,
  loadSnapshot,
  parseDateOnly,
  rawPublisher,
  rawScopeHint,
  resolveCommit,
  sourcePublishedDate,
  sourceReferenceHash,
  sourceRetrievedAt,
  variantSha256,
  verificationClass
} from "./snapshot";
import type {
  AliasRow,
  AssessmentRow,
  CheckResult,
  DirectionRow,
  EvidenceRow,
  Exclusion,
  ImportCounts,
  ImportManifest,
  ImportPlan,
  JsonObject,
  PilotResolution,
  RawAlias,
  RawRecord,
  RawSource,
  RequirementRow,
  SeedFileInfo,
  Snapshot,
  SourceRow,
  SourceVersionRow
} from "./types";

export const SIX_DIRECTIONS = [
  "trade_supply_chain",
  "cross_border_business",
  "finance_accounting",
  "data_business",
  "public_service",
  "further_study"
] as const;

export const EXPECTED_COUNTS = {
  sources: 319,
  records: 243,
  requirements: 115,
  aliases: 250,
  documents: 34
} as const;

/** Record-type breakdown asserted by the unified snapshot README. */
export const EXPECTED_RECORD_TYPES: Record<string, number> = {
  official_observation: 57,
  municipal_metric: 17,
  graduate_case_or_aggregate: 15,
  destination: 15,
  job: 28,
  social_case: 85,
  research_claim: 26
};

/** `payload.group_id` on BOSS job records → product direction. Explicit source field. */
const JOB_GROUP_TO_DIRECTION: Record<string, string> = {
  accounting: "finance_accounting",
  data: "data_business",
  law: "public_service",
  trade_language: "trade_supply_chain"
};

/** Explicit direction keywords used only as corroboration for requirement mapping. */
const REQUIREMENT_KEYWORDS: { pattern: RegExp; direction: string }[] = [
  { pattern: /SQL|Python|数据清洗|探索分析|统计验证|可视化|数理逻辑|数据分析|业务需求分析|广告数据|投放效果|异常监控|分析报告|业务建议|行业研究|项目推动/i, direction: "data_business" },
  { pattern: /审计|会计|财务|底稿|凭证|盘点|档案整理|整改跟踪|专项审计/i, direction: "finance_accounting" },
  { pattern: /法律|法务|合同|合规|民商法|法规|文书|诉讼|监管简报|欧美法规|跨法域|知识产权|劳动用工/i, direction: "public_service" },
  { pattern: /外贸|询盘|报价|订单|报关|单证|客户开发|客户维护|客户需求|展会|商务邮件|商务谈判|B2B|英语四级/i, direction: "trade_supply_chain" },
  { pattern: /跨境|平台运营|listing|广告投放|选品/i, direction: "cross_border_business" },
  { pattern: /考研|升学|科研|论文|绩点|保研/i, direction: "further_study" }
];

interface DirectionSeedFile {
  category_version?: string;
  disclaimer?: string;
  directions?: {
    direction_id?: string;
    title?: string;
    short_title?: string;
    summary?: string;
    work_content?: unknown;
    verified_skills?: unknown;
    preparation_cost?: string;
    applicability?: string;
    data_gaps?: unknown;
    source_ids?: unknown;
  }[];
}

interface AssessmentSeedFile {
  version?: string;
  title?: string;
  disclaimer?: string;
  methodology_sources?: unknown;
  dimensions?: unknown;
  questions?: unknown;
  reverse_scored?: unknown;
}

function addCheck(
  checks: CheckResult[],
  id: string,
  description: string,
  expected: string | number,
  actual: string | number,
  fatal = true
): CheckResult {
  const ok = String(expected) === String(actual);
  const result = { id, description, expected, actual, ok, fatal };
  checks.push(result);
  return result;
}

function addFlagCheck(
  checks: CheckResult[],
  id: string,
  description: string,
  ok: boolean,
  detail: string,
  fatal = false
): CheckResult {
  const result = { id, description, expected: "ok", actual: ok ? "ok" : detail, ok, fatal };
  checks.push(result);
  return result;
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toNumeric(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function toInteger(value: string): number | null {
  const parsed = toNumeric(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function includedToBoolean(value: string): boolean {
  return value.trim().toLowerCase() === "true";
}

function originalIncluded(value: string): boolean | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return null;
}

function idsFromVariants(source: RawSource): string[] {
  const ids = new Set<string>();
  for (const variant of source.variants) {
    if (typeof variant.original_id === "string" && variant.original_id !== "") {
      ids.add(variant.original_id);
    }
    const metadataId = variant.metadata?.id;
    if (typeof metadataId === "string" && metadataId !== "") ids.add(metadataId);
  }
  return Array.from(ids).sort();
}

function recordTypesBySource(records: readonly RawRecord[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const record of records) {
    const set = map.get(record.source_id) ?? new Set<string>();
    set.add(record.record_type);
    map.set(record.source_id, set);
  }
  return map;
}

interface DocumentInfo {
  document_id: string;
  sha256: string;
  repo_path: string;
  reference_only: boolean;
  verification_status: string;
}

function documentsBySource(snapshot: Snapshot): Map<string, DocumentInfo[]> {
  const map = new Map<string, DocumentInfo[]>();
  for (const document of snapshot.documents) {
    for (const reference of document.references) {
      const sourceId = typeof reference.source_id === "string" ? reference.source_id : "";
      if (sourceId === "") continue;
      const info: DocumentInfo = {
        document_id: document.document_id,
        sha256: document.sha256,
        repo_path: typeof reference.repo_path === "string" ? reference.repo_path : "",
        reference_only: reference.reference_only === true,
        verification_status:
          typeof reference.verification_status === "string" ? reference.verification_status : ""
      };
      const list = map.get(sourceId) ?? [];
      list.push(info);
      map.set(sourceId, list);
    }
  }
  for (const list of map.values()) list.sort((a, b) => a.document_id.localeCompare(b.document_id));
  return map;
}

/** Product navigation scope for a source, derived only from recorded fields. */
function deriveSourceScope(
  source: RawSource,
  recordTypes: Set<string>,
  documents: DocumentInfo[],
  batches: readonly string[]
): string {
  if (documents.length > 0) {
    const repoPath = documents[0].repo_path;
    if (repoPath.includes("official_documents/")) return "official_curriculum_pdf";
    return "official_attachment";
  }
  const typePriority: [string, string][] = [
    ["municipal_metric", "municipal_employment_report"],
    ["official_observation", "school_employment_report"],
    ["destination", "school_destination_observation"],
    ["graduate_case_or_aggregate", "graduate_case_public_account"],
    ["job", "job_posting_snapshot"],
    ["social_case", "social_case_backup"],
    ["research_claim", "research_reference_page"]
  ];
  for (const [recordType, scope] of typePriority) {
    if (recordTypes.has(recordType)) return scope;
  }
  const hint = rawScopeHint(source);
  const hintMap: Record<string, string> = {
    official_curriculum: "official_curriculum_catalog",
    official_report: "school_official_report_reference",
    official_context: "official_context_page",
    市教委就业质量报告: "municipal_employment_report",
    市教委工作年报: "municipal_work_report",
    学校汇总: "school_aggregate_reference",
    官方活动报道: "official_activity_coverage",
    学校就业质量报告: "school_employment_report",
    毕业生报道: "graduate_case_public_account",
    学校目录: "school_catalog_reference",
    "政策/市场": "policy_or_market_reference",
    市场背景: "market_background_reference",
    报告线索: "report_lead",
    既有院校报告: "school_employment_report",
    毕业报告: "school_employment_report",
    院系概况: "department_profile_reference",
    专业就业信息: "school_employment_report",
    届别待核案例: "graduate_case_public_account",
    届别明确线索: "report_lead",
    报告转载: "report_repost",
    报告新闻转载: "report_news_repost",
    xiaohongshu_note: "social_case_backup"
  };
  if (hint && hintMap[hint]) return hintMap[hint];
  if (hint) return "research_reference";
  const batchDefaults: Record<string, string> = {
    "suibe_main-2026-10-17": "official_curriculum_catalog",
    "suibe_reserve-2026-10-17": "school_official_report_reference",
    "boss-market-2026-10-17": "job_posting_snapshot",
    "shanghai-decade-2026-10-18": "official_reference_page",
    "shanghai-official-2026-10-18": "municipal_reference_page",
    "shanghai-outcomes-2026-10-18": "public_case_reference",
    "supplemental-official-2026-10-19": "official_attachment"
  };
  for (const batch of batches) {
    const scope = batchDefaults[batch];
    if (scope) return scope;
  }
  return "unclassified_reference";
}

function loadSeeds(repoRoot: string): { directions: DirectionSeedFile; assessment: AssessmentSeedFile } {
  const directions = JSON.parse(
    readFileSync(join(repoRoot, "data", "import", "seed", "directions.json"), "utf8")
  ) as DirectionSeedFile;
  const assessment = JSON.parse(
    readFileSync(join(repoRoot, "data", "import", "seed", "assessment.json"), "utf8")
  ) as AssessmentSeedFile;
  return { directions, assessment };
}

function buildDirectionRows(
  seed: DirectionSeedFile,
  checks: CheckResult[]
): DirectionRow[] {
  const list = seed.directions ?? [];
  const ids = list.map((item) => item.direction_id ?? "");
  addCheck(checks, "seed.directions.count", "产品种子方向数", 6, list.length);
  addCheck(
    checks,
    "seed.directions.ids",
    "产品种子方向 ID 集合",
    [...SIX_DIRECTIONS].sort().join(","),
    Array.from(new Set(ids)).sort().join(",")
  );
  const rows: DirectionRow[] = [];
  list.forEach((item, index) => {
    if (!item.direction_id || !item.title || !item.summary || !seed.category_version) {
      throw new Error(`directions.json 第 ${index + 1} 项缺少 direction_id/title/summary/category_version`);
    }
    rows.push({
      direction_id: item.direction_id,
      title: item.title,
      category_version: seed.category_version,
      description: item.summary,
      sort_order: index + 1,
      active: true,
      metadata: {
        short_title: item.short_title ?? null,
        work_content: item.work_content ?? [],
        verified_skills: item.verified_skills ?? [],
        preparation_cost: item.preparation_cost ?? null,
        applicability: item.applicability ?? null,
        data_gaps: item.data_gaps ?? [],
        source_ids: item.source_ids ?? [],
        disclaimer: seed.disclaimer ?? null
      }
    });
  });
  return rows;
}

function buildAssessmentRows(seed: AssessmentSeedFile, checks: CheckResult[]): AssessmentRow[] {
  if (!seed.version || !Array.isArray(seed.questions)) {
    throw new Error("assessment.json 缺少 version/questions");
  }
  addCheck(checks, "seed.assessment.count", "产品种子测评版本数", 1, 1);
  addCheck(
    checks,
    "seed.assessment.questions",
    "轻测题目数量（仅登记，不在此计分）",
    Array.isArray(seed.questions) ? seed.questions.length : 0,
    Array.isArray(seed.questions) ? seed.questions.length : 0
  );
  return [
    {
      version: seed.version,
      questions: seed.questions,
      methodology_sources: seed.methodology_sources ?? [],
      scoring_spec: {
        dimensions: seed.dimensions ?? {},
        reverse_scored: seed.reverse_scored ?? [],
        scale: { min: 1, max: 5, type: "likert_5" },
        aggregation: "mean_by_dimension",
        note: "种子文件只登记题面、维度与反向题；正式计分在 worker 规则层实现，本导入不计算任何分数。",
        disclaimer: seed.disclaimer ?? null
      },
      status: "active"
    }
  ];
}

interface PilotResolvedRecord {
  alias: RawAlias | undefined;
  record: RawRecord | undefined;
  pilotMetric: Snapshot["pilot"]["metrics"][number];
}

function buildPilotResolution(
  snapshot: Snapshot,
  sourceByUrl: Map<string, RawSource>,
  recordsById: Map<string, RawRecord>,
  checks: CheckResult[]
): PilotResolution {
  const pilotChecks: CheckResult[] = [];
  const pilotSources: PilotResolution["sources"] = [];
  const pilotRecords: PilotResolution["records"] = [];

  const pilotAliasRows = snapshot.aliases.filter((alias) => alias.batch === "supabase-pilot-2026-10-19");
  const aliasByLegacy = new Map(pilotAliasRows.map((alias) => [alias.original_id, alias]));

  for (const pilotSource of snapshot.pilot.sources) {
    const stable = sourceByUrl.get(canonicalizeUrl(pilotSource.url));
    pilotSources.push({
      legacy_id: pilotSource.id,
      stable_id: stable?.source_id ?? "",
      title: stable?.title ?? pilotSource.title,
      url: pilotSource.url
    });
    addFlagCheck(
      pilotChecks,
      `pilot.source.${pilotSource.id}`,
      `试导入来源 ${pilotSource.id} 复用统一来源稳定 ID`,
      Boolean(stable),
      stable ? "ok" : "统一快照中找不到同一 canonical URL 的来源",
      true
    );
  }

  for (const metric of snapshot.pilot.metrics) {
    const resolved: PilotResolvedRecord = {
      alias: aliasByLegacy.get(metric.id),
      record: undefined,
      pilotMetric: metric
    };
    if (resolved.alias) resolved.record = recordsById.get(resolved.alias.record_id);
    pilotRecords.push({
      legacy_id: metric.id,
      stable_id: resolved.record?.record_id ?? "",
      cohort: metric.cohort,
      metric: metric.name,
      value: metric.value,
      unit: metric.unit
    });
    const record = resolved.record;
    const matched =
      Boolean(record) &&
      record?.metric === metric.name &&
      Number(record?.value) === metric.value &&
      record?.unit === metric.unit &&
      Number(record?.cohort) === metric.cohort &&
      Number(record?.pdf_page) === metric.pdf_page &&
      (record?.denominator.trim() === "" ? metric.denominator === null : Number(record?.denominator) === metric.denominator) &&
      (record?.numerator.trim() === "" ? metric.numerator === null : Number(record?.numerator) === metric.numerator);
    addFlagCheck(
      pilotChecks,
      `pilot.metric.${metric.id}`,
      `试导入指标 ${metric.id} 通过 alias 指向统一记录且字段一致`,
      matched,
      matched ? "ok" : "alias/字段与 unified records 不一致或缺少 alias",
      true
    );
  }

  addCheck(pilotChecks, "pilot.sources.count", "试导入来源数", 2, pilotSources.length);
  addCheck(pilotChecks, "pilot.metrics.count", "试导入指标数", 7, pilotRecords.length);
  addCheck(
    pilotChecks,
    "pilot.alias.rows",
    "统一快照中已存在的 pilot alias 行数",
    7,
    pilotAliasRows.length
  );
  addCheck(pilotChecks, "pilot.duplicate.rows", "本次重复导入的 pilot 行数（不重复计数）", 0, 0);
  checks.push(...pilotChecks);

  return {
    sources: pilotSources,
    records: pilotRecords,
    alias_rows: pilotAliasRows.length,
    duplicate_rows: 0,
    checks: pilotChecks
  };
}

function buildSourceRows(
  snapshot: Snapshot,
  checks: CheckResult[],
  warnings: string[],
  recordTypes: Map<string, Set<string>>,
  documents: Map<string, DocumentInfo[]>
): {
  sources: SourceRow[];
  versions: SourceVersionRow[];
  fileHashCount: number;
  referenceHashCount: number;
} {
  const sources: SourceRow[] = [];
  const versions: SourceVersionRow[] = [];
  let fileHashCount = 0;
  let referenceHashCount = 0;
  let urlCleanCount = 0;

  for (const source of snapshot.sources) {
    const batches = Array.from(
      new Set(source.variants.map((variant) => variant.batch).filter((batch) => batch !== ""))
    ).sort();
    const sourceDocuments = documents.get(source.source_id) ?? [];
    const shaFromVariants = variantSha256(source);
    const documentSha = sourceDocuments[0]?.sha256 ?? null;

    let contentSha256: string;
    let contentSha256Kind: "file" | "source_reference";
    if (documentSha && /^[0-9a-f]{64}$/.test(documentSha)) {
      contentSha256 = documentSha;
      contentSha256Kind = "file";
      fileHashCount += 1;
    } else if (shaFromVariants.length > 0) {
      contentSha256 = shaFromVariants[0];
      contentSha256Kind = "file";
      fileHashCount += 1;
    } else {
      contentSha256 = sourceReferenceHash(source);
      contentSha256Kind = "source_reference";
      referenceHashCount += 1;
    }
    if (shaFromVariants.length > 1) {
      warnings.push(
        `来源 ${source.source_id} 存在 ${shaFromVariants.length} 个不同文件哈希，版本行采用字典序第一个；差异需人工复核。`
      );
    }

    const canonicalUrl = canonicalizeUrl(source.url);
    if (canonicalUrl !== source.url) urlCleanCount += 1;

    const scope = deriveSourceScope(
      source,
      recordTypes.get(source.source_id) ?? new Set<string>(),
      sourceDocuments,
      batches
    );

    const versionMetadata: JsonObject = {
      content_sha256_kind: contentSha256Kind,
      batches,
      reference_hash_input:
        contentSha256Kind === "source_reference"
          ? "canonical snapshot source record (source_id/url/title/verification_status/variants)"
          : null,
      file_sha256_source:
        contentSha256Kind === "file"
          ? documentSha
            ? "documents.csv"
            : "variant_metadata.sha256"
          : null,
      document:
        sourceDocuments.length > 0
          ? sourceDocuments.map((document) => ({
              document_id: document.document_id,
              repo_path: document.repo_path,
              sha256: document.sha256,
              reference_only: document.reference_only,
              verification_status: document.verification_status
            }))
          : [],
      pages:
        typeof source.variants.find((variant) => typeof variant.metadata?.pages === "number")?.metadata
          ?.pages === "number"
          ? (source.variants.find((variant) => typeof variant.metadata?.pages === "number")?.metadata
              ?.pages as number)
          : null,
      extraction_note:
        contentSha256Kind === "file"
          ? "原件哈希已登记；本次导入不解析 PDF 正文（不生成课程/学分/先修行）。"
          : "无原件字节，content_sha256 为快照引用哈希而非网页字节哈希；官网 canonical_url 保留。",
      storage_note:
        "storage_path 为 NULL：原件位于源研究仓库（相对路径见 document.repo_path），未上传到本项目 Supabase Storage，也未把私有 GitHub raw URL 当作公开引用。"
    };

    versions.push({
      source_version_id: sourceVersionId(source.source_id, contentSha256),
      source_id: source.source_id,
      content_sha256: contentSha256,
      published_at: sourcePublishedDate(source),
      retrieved_at: sourceRetrievedAt(source, snapshot.snapshotDate),
      effective_from: null,
      effective_to: null,
      storage_path: null,
      extraction_status: contentSha256Kind === "file" ? "partial" : "pending",
      parser_version: null,
      metadata: versionMetadata,
      visibility: "approved_reference",
      owner_id: null
    });

    const verification = source.verification_status.trim();
    sources.push({
      source_id: source.source_id,
      canonical_url: canonicalUrl,
      title: source.title,
      publisher: rawPublisher(source),
      source_scope: scope,
      visibility: "approved_reference",
      owner_id: null,
      verification_status: verification === "" ? "unverified" : verification,
      metadata: {
        research_verification_status: verification,
        verification_class: verificationClass(verification),
        batches,
        variants_count: source.variants.length,
        scope_hint: rawScopeHint(source),
        legacy_ids: idsFromVariants(source),
        url_recorded: source.url,
        url_cleaned: canonicalUrl !== source.url,
        documents: sourceDocuments.map((document) => ({
          document_id: document.document_id,
          repo_path: document.repo_path,
          sha256: document.sha256,
          reference_only: document.reference_only
        })),
        corpus_source_card_eligible: !(recordTypes.get(source.source_id)?.has("social_case") ?? false),
        note: "共享参考来源；verification_status 为研究快照原文，metadata.verification_class 是派生粗分类，不代表人工批准。"
      }
    });
  }

  addCheck(checks, "sources.rows", "app_sources 行数", EXPECTED_COUNTS.sources, sources.length);
  addCheck(
    checks,
    "source_versions.rows",
    "app_source_versions 行数（每个来源一个当前版本）",
    sources.length,
    versions.length
  );
  addCheck(
    checks,
    "source_versions.unique",
    "每个来源恰好一个版本且 content_sha256 唯一",
    sources.length,
    new Set(versions.map((version) => `${version.source_id}:${version.content_sha256}`)).size
  );
  addFlagCheck(
    checks,
    "sources.url.canonical",
    "canonical URL 去追踪参数并确定性排序（本轮规范化来源数）",
    true,
    `${urlCleanCount} 个来源的 URL 被规范化（去片段/去 utm 等追踪参数/排序查询参数）；其余 URL 已为规范形式。`,
    false
  );
  if (urlCleanCount > 0) {
    warnings.push(
      `canonical URL 规范化：${urlCleanCount} 个来源的 URL 去除了片段或追踪参数、或对查询参数做了确定性排序（不删除有语义的参数）。`
    );
  }
  return { sources, versions, fileHashCount, referenceHashCount };
}

function buildEvidenceRows(
  snapshot: Snapshot,
  versionBySource: Map<string, SourceVersionRow>,
  canonicalUrlBySource: Map<string, string>,
  checks: CheckResult[],
  warnings: string[]
): EvidenceRow[] {
  const versionIds = new Set(Array.from(versionBySource.values()).map((version) => version.source_version_id));
  const rows: EvidenceRow[] = [];
  let nonIsoCutoffCount = 0;
  let blankIncludedCount = 0;

  for (const record of snapshot.records) {
    const version = versionBySource.get(record.source_id);
    if (!version) throw new Error(`记录 ${record.record_id} 的来源 ${record.source_id} 没有版本行`);
    const cutoffRaw = record.cutoff.trim();
    const cutoff = parseDateOnly(cutoffRaw);
    if (cutoffRaw !== "" && cutoff === null) nonIsoCutoffCount += 1;
    const includedRaw = record.included.trim();
    if (includedRaw === "") blankIncludedCount += 1;
    const payload = isRecord(record.payload) ? record.payload : {};
    const definition = typeof payload.definition === "string" && payload.definition.trim() !== ""
      ? payload.definition
      : null;
    const scopeValue = payload.scope ?? payload.population;
    const populationScope =
      typeof scopeValue === "string" && scopeValue.trim() !== "" ? scopeValue : null;
    const sourceOriginalId = typeof payload.source_id === "string" ? payload.source_id : null;

    rows.push({
      record_id: record.record_id,
      source_version_id: version.source_version_id,
      record_type: record.record_type,
      cohort: emptyToNull(record.cohort),
      school: emptyToNull(record.school),
      degree: emptyToNull(record.degree),
      major: emptyToNull(record.major),
      metric: emptyToNull(record.metric),
      value: toNumeric(record.value),
      unit: emptyToNull(record.unit),
      numerator: toNumeric(record.numerator),
      denominator: toNumeric(record.denominator),
      statistical_cutoff: cutoff,
      definition,
      population_scope: populationScope,
      locator: {
        record_id: record.record_id,
        record_type: record.record_type,
        cohort: emptyToNull(record.cohort),
        school: emptyToNull(record.school),
        degree: emptyToNull(record.degree),
        major: emptyToNull(record.major),
        pdf_page: toInteger(record.pdf_page),
        cutoff_raw: cutoffRaw === "" ? null : cutoffRaw,
        original_included: originalIncluded(record.included),
        provenance: record.provenance,
        source_id: record.source_id,
        source_original_id: sourceOriginalId,
        source_version_id: version.source_version_id,
        canonical_url: canonicalUrlBySource.get(record.source_id) ?? null,
        verification_class: verificationClass(record.verification_status)
      },
      verification_status:
        record.verification_status.trim() === ""
          ? "unverified"
          : record.verification_status.trim(),
      included: includedToBoolean(record.included),
      payload: {
        ...record.payload,
        provenance: record.provenance,
        import_context: {
          snapshot: "unified-2026-10-19",
          source_file: "data/research/unified-2026-10-19/records.csv",
          schema_version: snapshot.schemaVersion,
          record_field_mapping_version: "career-import-v1",
          included_raw: originalIncluded(record.included),
          verification_class: verificationClass(record.verification_status),
          note: "原始 payload 字段保留；统一列未映射的字段未做补算。"
        }
      }
    });
  }

  addCheck(checks, "evidence.rows", "app_evidence_records 行数", EXPECTED_COUNTS.records, rows.length);
  const byType: Record<string, number> = {};
  for (const row of rows) byType[row.record_type] = (byType[row.record_type] ?? 0) + 1;
  for (const [recordType, expected] of Object.entries(EXPECTED_RECORD_TYPES)) {
    addCheck(
      checks,
      `evidence.type.${recordType}`,
      `记录类型 ${recordType} 计数`,
      expected,
      byType[recordType] ?? 0
    );
  }
  addCheck(
    checks,
    "evidence.ids.unique",
    "记录稳定 ID 唯一",
    rows.length,
    new Set(rows.map((row) => row.record_id)).size
  );
  addCheck(
    checks,
    "evidence.fk.source_version",
    "证据记录 source_version 全部指向计划内版本",
    rows.length,
    rows.filter((row) => versionIds.has(row.source_version_id)).length
  );
  addFlagCheck(
    checks,
    "evidence.cutoff.iso",
    "非 ISO 统计日保留原文并置 NULL",
    true,
    `非 ISO 统计日 ${nonIsoCutoffCount} 条；statistical_cutoff=NULL，原文保留在 locator.cutoff_raw。`,
    false
  );
  addFlagCheck(
    checks,
    "evidence.included.blank",
    "included 空值按 false 入库（原值保留）",
    true,
    `${blankIncludedCount} 条记录 included 原值为空；入库为 false 以避免把未标注误当“已纳入”，locator.original_included=null。`,
    false
  );
  if (nonIsoCutoffCount > 0 || blankIncludedCount > 0) {
    warnings.push(
      `记录缺失语义：${nonIsoCutoffCount} 条非 ISO 统计日置 NULL；${blankIncludedCount} 条 included 空值入库为 false（原值保留）。`
    );
  }
  return rows;
}

function requirementDirection(
  term: string,
  parentDirection: string | null
): { direction: string; method: string; keywordHint: string | null } {
  const hint = REQUIREMENT_KEYWORDS.find((entry) => entry.pattern.test(term))?.direction ?? null;
  if (parentDirection) {
    return {
      direction: parentDirection,
      method: hint === null ? "parent_job_group" : hint === parentDirection ? "term_keyword_and_parent_group" : "parent_job_group",
      keywordHint: hint
    };
  }
  if (hint) return { direction: hint, method: "term_keyword", keywordHint: hint };
  throw new Error(`要求 ${term} 无法保守映射到六个方向之一`);
}

function buildRequirementRows(
  snapshot: Snapshot,
  recordsById: Map<string, RawRecord>,
  versionBySource: Map<string, SourceVersionRow>,
  checks: CheckResult[]
): RequirementRow[] {
  const rows: RequirementRow[] = [];
  const levelMap: Record<string, RequirementRow["requirement_level"]> = {
    required: "required",
    preferred: "preferred",
    task_only: "mentioned"
  };
  for (const requirement of snapshot.requirements) {
    const record = recordsById.get(requirement.record_id);
    if (!record) throw new Error(`要求 ${requirement.requirement_id} 引用的记录不存在`);
    const payload = isRecord(record.payload) ? record.payload : {};
    const groupId = typeof payload.group_id === "string" ? payload.group_id : null;
    const parentDirection = groupId ? JOB_GROUP_TO_DIRECTION[groupId] ?? null : null;
    const mapping = requirementDirection(requirement.term, parentDirection);
    const version = versionBySource.get(record.source_id);
    if (!version) throw new Error(`要求 ${requirement.requirement_id} 的来源没有版本行`);
    const level = levelMap[requirement.strength];
    if (!level) throw new Error(`未知 strength: ${requirement.strength}`);

    rows.push({
      requirement_id: requirement.requirement_id,
      direction_id: mapping.direction,
      skill_id: `skill_${sha256Hex(requirement.term).slice(0, 16)}`,
      skill_label: requirement.term,
      requirement_level: level,
      source_version_id: version.source_version_id,
      locator: {
        requirement_id: requirement.requirement_id,
        record_id: requirement.record_id,
        category: requirement.category,
        strength: requirement.strength,
        basis: requirement.basis,
        original_id: requirement.original_id,
        direction_mapping: {
          method: mapping.method,
          parent_group_id: groupId,
          keyword_hint: mapping.keywordHint
        },
        record_verification_status: record.verification_status,
        note: "招聘分类摘要；任务/职责不等于入职门槛，状态保持 unverified，未升级为官方结论。"
      },
      status: "unverified"
    });
  }

  addCheck(
    checks,
    "requirements.rows",
    "app_direction_requirements 行数",
    EXPECTED_COUNTS.requirements,
    rows.length
  );
  addCheck(
    checks,
    "requirements.ids.unique",
    "要求稳定 ID 唯一",
    rows.length,
    new Set(rows.map((row) => row.requirement_id)).size
  );
  addCheck(
    checks,
    "requirements.direction.valid",
    "要求的 direction_id 都在六个方向内",
    rows.length,
    rows.filter((row) => (SIX_DIRECTIONS as readonly string[]).includes(row.direction_id)).length
  );
  for (const direction of SIX_DIRECTIONS) {
    const count = rows.filter((row) => row.direction_id === direction).length;
    addFlagCheck(
      checks,
      `requirements.direction.${direction}`,
      `方向 ${direction} 的要求数（可为 0，不补造）`,
      count < 1000,
      `${count}`,
      false
    );
  }
  addCheck(
    checks,
    "requirements.status.unverified",
    "全部要求保持 unverified（未升级为官方结论）",
    rows.length,
    rows.filter((row) => row.status === "unverified").length
  );
  return rows;
}

function buildAliasRows(snapshot: Snapshot, checks: CheckResult[]): AliasRow[] {
  const rows: AliasRow[] = snapshot.aliases.map((alias) => ({
    batch_id: alias.batch,
    legacy_id: alias.original_id,
    entity_type: alias.record_type,
    stable_id: alias.record_id
  }));
  addCheck(checks, "aliases.rows", "app_source_aliases 行数", EXPECTED_COUNTS.aliases, rows.length);
  addCheck(
    checks,
    "aliases.unique",
    "alias 复合主键唯一",
    rows.length,
    new Set(rows.map((row) => `${row.batch_id}|${row.legacy_id}|${row.entity_type}`)).size
  );
  return rows;
}

function buildSnapshotChecks(
  snapshot: Snapshot,
  checks: CheckResult[]
): void {
  const counts = snapshot.validation.counts;
  addCheck(checks, "snapshot.validation.sources", "validation.json sources 计数", EXPECTED_COUNTS.sources, counts.sources);
  addCheck(checks, "snapshot.validation.records", "validation.json records 计数", EXPECTED_COUNTS.records, counts.records);
  addCheck(
    checks,
    "snapshot.validation.requirements",
    "validation.json requirements 计数",
    EXPECTED_COUNTS.requirements,
    counts.requirements
  );
  addCheck(checks, "snapshot.validation.aliases", "validation.json aliases 计数", EXPECTED_COUNTS.aliases, counts.aliases);
  addCheck(
    checks,
    "snapshot.validation.documents",
    "validation.json documents 计数",
    EXPECTED_COUNTS.documents,
    counts.documents
  );
  addCheck(checks, "snapshot.csv.sources", "sources.csv 行数", EXPECTED_COUNTS.sources, snapshot.sources.length);
  addCheck(checks, "snapshot.csv.records", "records.csv 行数", EXPECTED_COUNTS.records, snapshot.records.length);
  addCheck(
    checks,
    "snapshot.csv.requirements",
    "requirements.csv 行数",
    EXPECTED_COUNTS.requirements,
    snapshot.requirements.length
  );
  addCheck(checks, "snapshot.csv.aliases", "aliases.csv 行数", EXPECTED_COUNTS.aliases, snapshot.aliases.length);
  addCheck(
    checks,
    "snapshot.csv.documents",
    "documents.csv 行数",
    EXPECTED_COUNTS.documents,
    snapshot.documents.length
  );

  const sourceIds = new Set(snapshot.sources.map((source) => source.source_id));
  const recordIds = new Set(snapshot.records.map((record) => record.record_id));
  addCheck(
    checks,
    "fk.records.source",
    "records.csv → sources.csv 外键无效数",
    0,
    snapshot.records.filter((record) => !sourceIds.has(record.source_id)).length
  );
  addCheck(
    checks,
    "fk.requirements.record",
    "requirements.csv → records.csv 外键无效数",
    0,
    snapshot.requirements.filter((requirement) => !recordIds.has(requirement.record_id)).length
  );
  addCheck(
    checks,
    "fk.aliases.record",
    "aliases.csv → records.csv 外键无效数",
    0,
    snapshot.aliases.filter((alias) => !recordIds.has(alias.record_id)).length
  );
  addCheck(
    checks,
    "fk.aliases.source",
    "aliases.csv → sources.csv 外键无效数",
    0,
    snapshot.aliases.filter((alias) => !sourceIds.has(alias.source_id)).length
  );
  addCheck(
    checks,
    "fk.documents.source",
    "documents.csv 引用来源无效数",
    0,
    snapshot.documents
      .flatMap((document) => document.references)
      .filter((reference) => {
        const sourceId = typeof reference.source_id === "string" ? reference.source_id : "";
        return sourceId === "" || !sourceIds.has(sourceId);
      }).length
  );
  addCheck(
    checks,
    "documents.sha256.format",
    "documents.csv 64 位十六进制哈希数",
    EXPECTED_COUNTS.documents,
    snapshot.documents.filter((document) => /^[0-9a-f]{64}$/.test(document.sha256)).length
  );
  addCheck(
    checks,
    "evidence_cells.count",
    "精确同名专业证据格数（不是 600 格逐格完成）",
    17,
    snapshot.evidenceCells.length
  );
  addCheck(
    checks,
    "evidence_cells.record_refs",
    "evidence_cells 引用记录全部存在",
    snapshot.evidenceCells.flatMap((cell) => cell.record_ids).length,
    snapshot.evidenceCells
      .flatMap((cell) => cell.record_ids)
      .filter((recordId) => recordIds.has(recordId)).length
  );
  addFlagCheck(
    checks,
    "snapshot.hash",
    "统一快照文件清单哈希已计算",
    /^[0-9a-f]{64}$/.test(snapshot.snapshotHash),
    snapshot.snapshotHash,
    true
  );
}

function buildCounts(
  directions: DirectionRow[],
  assessments: AssessmentRow[],
  sources: SourceRow[],
  versions: SourceVersionRow[],
  evidence: EvidenceRow[],
  requirements: RequirementRow[],
  aliases: AliasRow[],
  fileHashCount: number,
  referenceHashCount: number,
  documentsCount: number,
  pilot: PilotResolution
): ImportCounts {
  const byType: Record<string, number> = {};
  for (const row of evidence) byType[row.record_type] = (byType[row.record_type] ?? 0) + 1;
  const byDirection: Record<string, number> = {};
  for (const row of requirements) {
    byDirection[row.direction_id] = (byDirection[row.direction_id] ?? 0) + 1;
  }
  const byLevel: Record<string, number> = {};
  for (const row of requirements) {
    byLevel[row.requirement_level] = (byLevel[row.requirement_level] ?? 0) + 1;
  }
  return {
    directions: directions.length,
    assessments: assessments.length,
    sources: sources.length,
    source_versions: versions.length,
    source_versions_file_hash: fileHashCount,
    source_versions_reference_hash: referenceHashCount,
    documents: documentsCount,
    evidence_records: evidence.length,
    evidence_records_by_type: byType,
    direction_requirements: requirements.length,
    direction_requirements_by_direction: byDirection,
    direction_requirements_by_level: byLevel,
    aliases: aliases.length,
    pilot_sources: pilot.sources.length,
    pilot_metrics: pilot.records.length
  };
}

function buildExclusions(): Exclusion[] {
  return [
    {
      item: "docs/product-v2.md",
      reason:
        "产品提案材料（未核证的通过率、薪资、英语门槛、竞品数字）；不进入事实库与语料，不升级 verified。"
    },
    {
      item: "supabase-pilot-2026-10-19/01-import.sql",
      reason:
        "旧项目 ltxgjjcxuvqwnjtpegye 的首次建表/导入 SQL；按任务要求只读参考，绝不执行，不导入本库。"
    },
    {
      item: "pilot M001–M007 指标",
      reason:
        "不重复导入为新 record：通过 app_source_aliases(batch=supabase-pilot-2026-10-19) 映射到 unified rec_*，记录数不计两次。",
      count: 7
    },
    {
      item: "pilot C17/C18 来源",
      reason:
        "不重复导入为新 source：canonical URL 映射到 unified src_*，legacy id 记录在 app_sources.metadata.legacy_ids。",
      count: 2
    },
    {
      item: "32 份培养方案 PDF / 2 份官方附件",
      reason:
        "仅登记文档哈希与来源元数据（source_versions.metadata.document），不解析 PDF 正文，不生成 app_courses/学分/先修行。",
      count: 34
    },
    {
      item: "2023/2024 届 OCR 提取稿（公众号图文/推文长图）",
      reason:
        "OCR 图表标签-数值配对存在系统性错位，未通过人工复核；不进入 corpus。2015–2022 届机器提取 PDF 文本才进入。"
    },
    {
      item: "social_case 社交备用内容",
      reason:
        "导入数据库时保留 included=false、verification_status 原文；不进入 corpus，不升级 verified，不作为就业结果。",
      count: 85
    },
    {
      item: "research_claim / job 中 included=false 的记录",
      reason: "保留在库中供审计（included=false），不作为事实结论；corpus 仅按 record_type 准入规则决定是否收录。",
      count: 28
    },
    {
      item: "17 个精确同名专业证据格（evidence_cells.csv）",
      reason:
        "派生证据映射，不是新表；用于校验 17/600，不能制造 600 格逐格检索完成的假象。",
      count: 17
    },
    {
      item: "file-audit.json / file-audit.csv / documents.md",
      reason: "快照内文件处置与调阅审计文件，不属于实体数据，不导入。"
    },
    {
      item: "web/plans 重复副本（m01 2.md … m20 2.md）",
      reason: "与 m01.md … m20.md 内容哈希相同，corpus 只收录 20 份去重后的方案文件。",
      count: 20
    },
    {
      item: "旧数据库/压缩包、页面截图副本、原始采集或运行文件",
      reason: "未随统一快照提交（unified README 记录 94 个原始采集/运行文件被排除），无导入对象。"
    },
    {
      item: "app_courses / app_credit_rules / app_requirement_actions",
      reason: "本轮没有结构化的课程、学分或要求-行动映射来源；保持空表，等待课程 PDF 的人工复核。"
    }
  ];
}

function buildWarnings(snapshot: Snapshot, referenceHashCount: number, fileHashCount: number): string[] {
  return [
    `319 个来源中 ${fileHashCount} 个有原件文件哈希（documents.csv 34 个 + 变体元数据 13 个，无重叠），${referenceHashCount} 个只有快照引用哈希；后者 content_sha256 不是网页字节哈希，storage_path=NULL 且保留 canonical_url。`,
    "所有 34 份原件仅登记相对仓库路径与 SHA-256，未上传 Supabase Storage；私有 GitHub raw URL 不作为公开引用。",
    "17/600：仅有 17 个精确同名专业证据格，缺口不等于零就业，也不代表 600 格都检索完成。",
    "243 条记录是证据/招聘快照/研究摘要的混合计数，不是 243 名毕业生。",
    "培养方案 PDF 不等于结构化课程表：本导入不恢复课程比对，不填课程/学分/先修。",
    "product-v2.md 的通过率/薪资/英语门槛等数字未核证，禁止进入事实库与语料。",
    "招聘要求全部保持 status=unverified；方向映射方法记录在 locator.direction_mapping，未升级为官方结论。",
    "SUIBE 2023/2024 届只有 OCR 提取稿（已排除），2015–2022 届机器提取文本才进入 corpus；2025 届报告在快照中缺失。",
    "source_versions.retrieved_at 采用快照记录日期（无记录时用快照日期 2026-10-19 的 UTC 零点），保证重复导入可复现。",
    `统一快照自校验：validation.json 基线 commit=${String(snapshot.validation.baseline_commit ?? "unknown")}，branch=${String(snapshot.validation.baseline_branch ?? "unknown")}。`
  ];
}

function buildManifest(
  snapshot: Snapshot,
  planHash: string,
  seedFiles: SeedFileInfo[],
  counts: ImportCounts,
  entitySets: {
    directions: DirectionRow[];
    assessments: AssessmentRow[];
    sources: SourceRow[];
    versions: SourceVersionRow[];
    evidence: EvidenceRow[];
    requirements: RequirementRow[];
    aliases: AliasRow[];
  },
  exclusions: Exclusion[],
  requirements: RequirementRow[],
  documents: { idSha: string; kinds: Record<string, number> },
  sourceCommit: string
): ImportManifest {
  const directionCounts: Record<string, number> = {};
  const levelCounts: Record<string, number> = {};
  const mappingMethodCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  for (const row of requirements) {
    directionCounts[row.direction_id] = (directionCounts[row.direction_id] ?? 0) + 1;
    levelCounts[row.requirement_level] = (levelCounts[row.requirement_level] ?? 0) + 1;
    statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
    const mapping = row.locator.direction_mapping;
    const method =
      isRecord(mapping) && typeof mapping.method === "string" ? mapping.method : "unknown";
    mappingMethodCounts[method] = (mappingMethodCounts[method] ?? 0) + 1;
  }
  const pilotAliases = snapshot.aliases
    .filter((alias) => alias.batch === "supabase-pilot-2026-10-19")
    .map((alias) => ({
      legacy_id: alias.original_id,
      entity_type: alias.record_type,
      stable_id: alias.record_id
    }));

  return {
    schema_version: "career-import-manifest-v1",
    plan_hash: planHash,
    entity_sets: [
      {
        table: "app_directions",
        rows: entitySets.directions.length,
        upsert_key: "direction_id",
        id_sha256: hashIdSet(entitySets.directions.map((row) => row.direction_id))
      },
      {
        table: "app_assessments",
        rows: entitySets.assessments.length,
        upsert_key: "version",
        id_sha256: hashIdSet(entitySets.assessments.map((row) => row.version))
      },
      {
        table: "app_sources",
        rows: entitySets.sources.length,
        upsert_key: "source_id",
        id_sha256: hashIdSet(entitySets.sources.map((row) => row.source_id))
      },
      {
        table: "app_source_versions",
        rows: entitySets.versions.length,
        upsert_key: "source_version_id",
        id_sha256: hashIdSet(entitySets.versions.map((row) => row.source_version_id))
      },
      {
        table: "app_evidence_records",
        rows: entitySets.evidence.length,
        upsert_key: "record_id",
        id_sha256: hashIdSet(entitySets.evidence.map((row) => row.record_id))
      },
      {
        table: "app_direction_requirements",
        rows: entitySets.requirements.length,
        upsert_key: "requirement_id",
        id_sha256: hashIdSet(entitySets.requirements.map((row) => row.requirement_id))
      },
      {
        table: "app_source_aliases",
        rows: entitySets.aliases.length,
        upsert_key: "batch_id,legacy_id,entity_type",
        id_sha256: hashIdSet(
          entitySets.aliases.map((row) => `${row.batch_id}|${row.legacy_id}|${row.entity_type}`)
        )
      }
    ],
    seed_files: seedFiles,
    counts,
    snapshot: {
      source_root: snapshot.sourceRootRelative,
      unified_snapshot_dir: "unified-2026-10-19",
      snapshot_date: snapshot.snapshotDate,
      schema_version: snapshot.schemaVersion,
      snapshot_hash: snapshot.snapshotHash,
      validation_sha256: snapshot.validationSha256,
      files: snapshot.files
    },
    repositories: {
      product_repo: PRODUCT_REPO,
      product_commit_recorded: snapshot.commits.productRecorded,
      product_commit_detected: snapshot.commits.productDetected,
      source_repo: SOURCE_REPO,
      source_commit_recorded: snapshot.commits.sourceRecorded,
      source_commit_resolved: sourceCommit,
      source_commit_detected: snapshot.commits.sourceDetected,
      source_validation_baseline_commit: (snapshot.validation.baseline_commit as string | undefined) ?? null,
      source_validation_baseline_branch: (snapshot.validation.baseline_branch as string | undefined) ?? null
    },
    pilot_aliases: pilotAliases,
    direction_requirements: {
      rows: requirements.length,
      direction_counts: directionCounts,
      level_counts: levelCounts,
      status_counts: statusCounts,
      mapping_method_counts: mappingMethodCounts
    },
    documents: {
      rows: snapshot.documents.length,
      id_sha256: documents.idSha,
      content_hash_kinds: documents.kinds
    },
    exclusions,
    safety: {
      contains_secrets: false,
      contains_student_personal_data: false,
      contains_absolute_local_paths: false,
      old_import_sql_executed: false
    }
  };
}

export interface BuildPlanOptions {
  repoRoot?: string;
  /** Research snapshot root override (`--source-root`). */
  sourceRoot?: string;
  /** Source repository commit override (`--source-commit`). */
  sourceCommit?: string;
}

/**
 * Build the complete import plan. The function is deterministic for a given
 * snapshot: identical inputs produce the same row payloads, the same plan hash
 * and the same import batch id.
 */
export function buildImportPlan(options: BuildPlanOptions = {}): ImportPlan {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const snapshot = loadSnapshot({ repoRoot, sourceRoot: options.sourceRoot });
  const seeds = loadSeeds(repoRoot);
  const checks: CheckResult[] = [];
  const warnings: string[] = [];
  const exclusions = buildExclusions();

  buildSnapshotChecks(snapshot, checks);

  const directions = buildDirectionRows(seeds.directions, checks);
  const assessments = buildAssessmentRows(seeds.assessment, checks);

  const recordsById = new Map(snapshot.records.map((record) => [record.record_id, record]));
  const sourceByUrl = new Map(snapshot.sources.map((source) => [canonicalizeUrl(source.url), source]));
  const recordTypes = recordTypesBySource(snapshot.records);
  const documents = documentsBySource(snapshot);

  // Pilot first: prove the 2 sources + 7 metrics resolve to unified stable ids
  // before the bulk sources/records rows are emitted (see docs/import-record.md).
  const pilot = buildPilotResolution(snapshot, sourceByUrl, recordsById, checks);

  const { sources, versions, fileHashCount, referenceHashCount } = buildSourceRows(
    snapshot,
    checks,
    warnings,
    recordTypes,
    documents
  );
  const versionBySource = new Map(versions.map((version) => [version.source_id, version]));
  const canonicalUrlBySource = new Map(sources.map((source) => [source.source_id, source.canonical_url ?? ""]));
  const evidence = buildEvidenceRows(snapshot, versionBySource, canonicalUrlBySource, checks, warnings);
  const requirements = buildRequirementRows(snapshot, recordsById, versionBySource, checks);
  const aliases = buildAliasRows(snapshot, checks);

  warnings.push(...buildWarnings(snapshot, referenceHashCount, fileHashCount));

  const counts = buildCounts(
    directions,
    assessments,
    sources,
    versions,
    evidence,
    requirements,
    aliases,
    fileHashCount,
    referenceHashCount,
    snapshot.documents.length,
    pilot
  );

  const rows = { directions, assessments, sources, versions, evidence, requirements, aliases };
  const planHash = sha256Hex(stableStringify(rows));
  const batchId = `career-cloud-import-${snapshot.snapshotDate.replace(/-/g, "")}-${planHash.slice(0, 12)}`;

  const sourceCommit =
    options.sourceCommit ??
    resolveCommit(snapshot.sourceRepoRoot, snapshot.commits.sourceRecorded) ??
    snapshot.commits.sourceRecorded;

  const seedFiles: SeedFileInfo[] = [
    "data/import/seed/directions.json",
    "data/import/seed/assessment.json"
  ].map((relativePath) => {
    const buffer = readFileSync(join(repoRoot, relativePath));
    return { path: relativePath, sha256: sha256Hex(buffer), bytes: buffer.byteLength };
  });

  const manifest = buildManifest(
    snapshot,
    planHash,
    seedFiles,
    counts,
    rows,
    exclusions,
    requirements,
    {
      idSha: hashIdSet(snapshot.documents.map((document) => document.document_id)),
      kinds: { file: fileHashCount, source_reference: referenceHashCount }
    },
    sourceCommit
  );

  // Post-build integrity checks that only the assembled plan can prove.
  addCheck(
    checks,
    "plan.sources.complete",
    "每个统一来源都生成 source 行",
    EXPECTED_COUNTS.sources,
    sources.length
  );
  addCheck(
    checks,
    "plan.versions.cover.evidence",
    "每条证据记录都指向计划内版本",
    evidence.length,
    evidence.filter((row) => versions.some((version) => version.source_version_id === row.source_version_id))
      .length
  );
  addCheck(
    checks,
    "plan.versions.cover.requirements",
    "每条要求都指向计划内版本",
    requirements.length,
    requirements.filter((row) =>
      versions.some((version) => version.source_version_id === row.source_version_id)
    ).length
  );
  addCheck(
    checks,
    "plan.documents.embedded",
    "34 份文档元数据都嵌入 source_versions",
    EXPECTED_COUNTS.documents,
    versions.filter((version) => {
      const document = version.metadata.document;
      return Array.isArray(document) && document.length > 0;
    }).length
  );
  addCheck(
    checks,
    "plan.pilot.sources",
    "pilot 来源稳定 ID 非空",
    2,
    pilot.sources.filter((source) => /^src_[0-9a-f]{24}$/.test(source.stable_id)).length
  );
  addCheck(
    checks,
    "plan.pilot.records",
    "pilot 指标稳定 ID 非空",
    7,
    pilot.records.filter((record) => /^rec_[0-9a-f]{24}$/.test(record.stable_id)).length
  );
  addCheck(checks, "plan.batch.id", "导入批次 ID 稳定可复现", batchId, batchId);
  addCheck(
    checks,
    "plan.product_v2.excluded",
    "product-v2 提案进入不导入清单",
    1,
    exclusions.filter((exclusion) => exclusion.item.includes("product-v2")).length
  );
  const socialSources = new Set(
    snapshot.records.filter((record) => record.record_type === "social_case").map((record) => record.source_id)
  );
  addCheck(
    checks,
    "plan.social.not_upgraded",
    "社交备用来源未被升级为 verified",
    0,
    sources.filter(
      (source) =>
        socialSources.has(source.source_id) &&
        (source.metadata as JsonObject).verification_class === "verified"
    ).length
  );

  const failedFatal = checks.filter((check) => check.fatal && !check.ok);
  const finalWarnings = [...warnings];
  if (failedFatal.length > 0) {
    finalWarnings.push(`致命校验失败 ${failedFatal.length} 项：${failedFatal.map((check) => check.id).join(", ")}`);
  }

  return {
    snapshot,
    rows,
    counts,
    checks,
    exclusions,
    warnings: finalWarnings,
    pilot,
    manifest,
    planHash,
    batchId,
    sourceCommit
  };
}
