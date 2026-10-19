/**
 * Read-only loader for the authorised research snapshot.
 *
 * Everything in this module reads local files only: no network access, no
 * database access. The snapshot's own `validation.json` remains the authority
 * for headline counts; this loader fails loudly when the CSVs disagree with it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { sha256Hex, stableStringify } from "./hash";
import { parseCsv } from "./csv";
import type {
  EvidenceCell,
  JsonObject,
  PilotData,
  RawAlias,
  RawDocument,
  RawDocumentReference,
  RawRecord,
  RawRequirement,
  RawSource,
  Snapshot,
  SnapshotFileInfo,
  SourceVariant,
  SuibeTextFile,
  TextDocument,
  ValidationJson
} from "./types";

export const PRODUCT_REPO = "suibe-ai-team-2026/campus_life-career_decision_agent";
export const SOURCE_REPO = "suibe-ai-team-2026/smart-campus-career";
/** Commit recorded by the task hand-off for the source research repository. */
export const SOURCE_COMMIT_RECORDED = "ba2794b";
/** Commit recorded by the task hand-off for the product repository. */
export const PRODUCT_COMMIT_RECORDED = "8c72ad4";

const SNAPSHOT_DATE_FALLBACK = "2026-10-19";

/** Locate the product repository root by walking up from the current directory. */
export function findRepoRoot(start = process.cwd()): string {
  let current = resolve(start);
  for (let depth = 0; depth < 12; depth += 1) {
    const packageJson = join(current, "package.json");
    if (existsSync(packageJson)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJson, "utf8")) as { name?: string };
        if (pkg.name === "campus-pathway-career") return current;
      } catch {
        // keep walking
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("无法定位产品仓库根目录（找不到 name=campus-pathway-career 的 package.json）");
}

/** Default snapshot root: sibling `smart-campus-career/data/research` checkout. */
export function defaultSourceRoot(repoRoot: string): string {
  return resolve(repoRoot, "..", "smart-campus-career", "data", "research");
}

/** Forward-slashed path relative to a base directory (for committed artifacts). */
export function toPosixRelative(base: string, target: string): string {
  return relative(base, target).split(sep).join("/");
}

function gitOutput(cwd: string, args: string[]): string | null {
  try {
    const output = execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return output === "" ? null : output;
  } catch {
    return null;
  }
}

function detectCommit(cwd: string, ref?: string): string | null {
  const args = ref ? ["rev-parse", ref] : ["rev-parse", "HEAD"];
  return gitOutput(cwd, args);
}

/**
 * Canonicalise a recorded URL: drop fragments and known tracking parameters,
 * keep every other query parameter untouched (some official pages use
 * meaningful query strings such as `classid` / `type`).
 */
export function canonicalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  url.hash = "";
  const tracking = [
    /^utm_/i,
    /^gclid$/i,
    /^fbclid$/i,
    /^spm$/i,
    /^scm$/i,
    /^share_/i,
    /^_hsenc$/i,
    /^_hsmi$/i,
    /^mc_cid$/i,
    /^mc_eid$/i
  ];
  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams.entries()) {
    if (tracking.some((pattern) => pattern.test(key))) continue;
    kept.append(key, value);
  }
  kept.sort();
  const query = kept.toString();
  url.search = query === "" ? "" : `?${query}`;
  return url.toString();
}

/** Parse a recorded date into a `YYYY-MM-DD` string, or null when not a full date. */
export function parseDateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return null;
  return `${year}-${month}-${day}`;
}

/** Parse a recorded retrieval date into an ISO timestamp at UTC midnight. */
export function parseTimestamp(value: unknown): string | null {
  const date = parseDateOnly(value);
  return date ? `${date}T00:00:00.000Z` : null;
}

function requireFile(path: string): Buffer {
  if (!existsSync(path)) throw new Error(`快照文件缺失：${path}`);
  if (!statSync(path).isFile()) throw new Error(`快照路径不是文件：${path}`);
  return readFileSync(path);
}

function readCsvRows<T>(path: string): T[] {
  const buffer = requireFile(path);
  return parseCsv(buffer.toString("utf8")).rows as unknown as T[];
}

function readJson<T>(path: string): T {
  return JSON.parse(requireFile(path).toString("utf8")) as T;
}

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeSource(raw: Record<string, string>): RawSource {
  let variants: SourceVariant[] = [];
  try {
    const parsed = JSON.parse(raw.variants || "[]") as unknown;
    if (Array.isArray(parsed)) {
      variants = parsed.filter(isRecord).map((variant) => ({
        batch: asString(variant.batch),
        original_id: typeof variant.original_id === "string" ? variant.original_id : undefined,
        status: typeof variant.status === "string" ? variant.status : undefined,
        title: typeof variant.title === "string" ? variant.title : undefined,
        metadata: isRecord(variant.metadata) ? variant.metadata : {}
      }));
    }
  } catch {
    variants = [];
  }
  return {
    source_id: raw.source_id ?? "",
    url: raw.url ?? "",
    title: raw.title ?? "",
    verification_status: raw.verification_status ?? "",
    variants
  };
}

function normalizeRecord(raw: Record<string, string>): RawRecord {
  let payload: JsonObject = {};
  try {
    const parsed: unknown = JSON.parse(raw.payload || "{}");
    if (isRecord(parsed)) payload = parsed;
  } catch {
    payload = {};
  }
  let provenance: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(raw.provenance || "[]");
    if (Array.isArray(parsed)) provenance = parsed;
  } catch {
    provenance = [];
  }
  return {
    record_id: raw.record_id ?? "",
    record_type: raw.record_type ?? "",
    source_id: raw.source_id ?? "",
    cohort: raw.cohort ?? "",
    school: raw.school ?? "",
    degree: raw.degree ?? "",
    major: raw.major ?? "",
    metric: raw.metric ?? "",
    value: raw.value ?? "",
    unit: raw.unit ?? "",
    denominator: raw.denominator ?? "",
    numerator: raw.numerator ?? "",
    cutoff: raw.cutoff ?? "",
    pdf_page: raw.pdf_page ?? "",
    verification_status: raw.verification_status ?? "",
    included: raw.included ?? "",
    payload,
    provenance
  };
}

function normalizeDocument(raw: Record<string, string>): RawDocument {
  let references: RawDocumentReference[] = [];
  try {
    const parsed: unknown = JSON.parse(raw.references || "[]");
    if (Array.isArray(parsed)) {
      references = parsed.filter(isRecord) as RawDocumentReference[];
    }
  } catch {
    references = [];
  }
  return {
    document_id: raw.document_id ?? "",
    sha256: raw.sha256 ?? "",
    references
  };
}

function splitIds(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function normalizeEvidenceCell(raw: Record<string, string>): EvidenceCell {
  return {
    major_id: raw.major_id ?? "",
    major: raw.major ?? "",
    cohort: raw.cohort ?? "",
    degree: raw.degree ?? "",
    record_ids: splitIds(raw.record_ids ?? ""),
    evidence_state: raw.evidence_state ?? ""
  };
}

/** All unique variant metadata sha256 values for a source, sorted. */
export function variantSha256(source: RawSource): string[] {
  const hashes = new Set<string>();
  for (const variant of source.variants) {
    const sha = variant.metadata?.sha256;
    if (typeof sha === "string" && /^[0-9a-f]{64}$/.test(sha)) hashes.add(sha);
  }
  return Array.from(hashes).sort();
}

/** Batches that contributed variants for a source, sorted. */
export function variantBatches(source: RawSource): string[] {
  return Array.from(
    new Set(source.variants.map((variant) => variant.batch).filter((batch) => batch !== ""))
  ).sort();
}

/** First non-empty raw scope hint from variant metadata (`source_kind` / `source_type` / `kind`). */
export function rawScopeHint(source: RawSource): string | null {
  for (const variant of source.variants) {
    const metadata = variant.metadata ?? {};
    for (const key of ["source_kind", "source_type", "kind"]) {
      const value = metadata[key];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
    }
  }
  return null;
}

/** First non-empty publisher recorded in variant metadata. */
export function rawPublisher(source: RawSource): string | null {
  for (const variant of source.variants) {
    const value = variant.metadata?.publisher;
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

/** Latest recorded `published` / `published_at` full date across variants. */
export function sourcePublishedDate(source: RawSource): string | null {
  let latest: string | null = null;
  for (const variant of source.variants) {
    for (const key of ["published", "published_at"]) {
      const date = parseDateOnly(variant.metadata?.[key]);
      if (date && (latest === null || date > latest)) latest = date;
    }
  }
  return latest;
}

/** Latest recorded `retrieved` / `retrieved_at` timestamp across variants. */
export function sourceRetrievedAt(source: RawSource, fallbackDate: string): string {
  let latest: string | null = null;
  for (const variant of source.variants) {
    for (const key of ["retrieved", "retrieved_at"]) {
      const timestamp = parseTimestamp(variant.metadata?.[key]);
      if (timestamp && (latest === null || timestamp > latest)) latest = timestamp;
    }
  }
  return latest ?? `${fallbackDate}T00:00:00.000Z`;
}

/**
 * Reference hash used as `app_source_versions.content_sha256` when no original
 * file bytes are available. It hashes the canonical snapshot record (ids, URL,
 * title, status, variants) — NOT the live web page. The kind is recorded in
 * version metadata as `source_reference`, so nobody mistakes it for a file hash.
 */
export function sourceReferenceHash(source: RawSource): string {
  const variants = source.variants
    .map((variant) => ({
      batch: variant.batch,
      metadata: variant.metadata ?? {},
      original_id: variant.original_id ?? null,
      status: variant.status ?? null,
      title: variant.title ?? null
    }))
    .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  return sha256Hex(
    stableStringify({
      source_id: source.source_id,
      canonical_url: canonicalizeUrl(source.url),
      title: source.title,
      verification_status: source.verification_status,
      variants
    })
  );
}

const UNVERIFIED_PATTERNS = [
  /unverified/i,
  /未独立核验/,
  /未另核/,
  /待.{0,6}(核|复核)/,
  /public_self_report/,
  /public_content_unverified/,
  /promotional/i,
  /promotion/i,
  /thin_opinion/,
  /satire/i,
  /submission_unverified/,
  /repost_unverified/,
  /媒体转引/,
  /反推/,
  /自述\/转述/,
  /广告/,
  /推广/
];

const VERIFIED_PATTERNS = [
  /官方PDF已下载并核对指定页/,
  /official_attachment_retrieved/,
  /本地解析及关键表格图像已核/,
  /official_reported_visual_checked/,
  /official_article_checked/,
  /官方报告原值/,
  /官方正文已读/,
  /^正文已读$/,
  /Harness HTTP原文全文核对/
];

/**
 * Derive a coarse, auditable verification class from the free-text research
 * status. Never used to upgrade excluded/social/product-v2 material: those
 * always stay `unverified`, and the raw status is preserved on every row.
 */
export function verificationClass(status: string): "verified" | "partial" | "unverified" {
  const text = status.trim();
  if (text === "") return "unverified";
  if (UNVERIFIED_PATTERNS.some((pattern) => pattern.test(text))) return "unverified";
  if (VERIFIED_PATTERNS.some((pattern) => pattern.test(text))) return "verified";
  return "partial";
}

function loadValidation(unifiedDir: string): { validation: ValidationJson; sha256: string } {
  const path = join(unifiedDir, "validation.json");
  const buffer = requireFile(path);
  const validation = JSON.parse(buffer.toString("utf8")) as ValidationJson;
  return { validation, sha256: sha256Hex(buffer) };
}

function listSuibeTexts(sourceRepoRoot: string, suibeDir: string): SuibeTextFile[] {
  const textDir = join(suibeDir, "extracted", "pdf-text");
  if (!existsSync(textDir)) return [];
  const checksumsPath = join(suibeDir, "checksums.sha256");
  const checksums = new Map<string, { sha256: string; path: string }>();
  if (existsSync(checksumsPath)) {
    const lines = readFileSync(checksumsPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const match = /^([0-9a-f]{64})\s{2}(.+)$/.exec(line.trim());
      if (!match) continue;
      checksums.set(basename(match[2]), {
        sha256: match[1],
        path: toPosixRelative(sourceRepoRoot, resolve(suibeDir, match[2]))
      });
    }
  }
  const files = readdirSync(textDir)
    .filter((name) => name.endsWith(".txt") && name !== ".DS_Store")
    .sort();
  return files.map((name) => {
    const absolute = join(textDir, name);
    const buffer = readFileSync(absolute);
    const content = buffer.toString("utf8");
    const reportBase = name.replace(/-提取全文\.txt$/, "");
    const report = reportBase.replace(/([AB])版$/, "$1");
    const year = /(\d{4})届/.exec(report)?.[1] ?? "";
    const edition = /([AB])$/.exec(report)?.[1] ?? "";
    const pdfName = `${report}.pdf`;
    const pdf = checksums.get(pdfName) ?? null;
    return {
      path: toPosixRelative(sourceRepoRoot, absolute),
      sha256: sha256Hex(buffer),
      bytes: buffer.byteLength,
      content,
      year,
      edition,
      pdf_sha256: pdf?.sha256 ?? null,
      pdf_path: pdf?.path ?? null
    } satisfies SuibeTextFile;
  });
}

function loadTextDocuments(paths: string[], sourceRepoRoot: string): TextDocument[] {
  return paths.map((absolute) => {
    const buffer = readFileSync(absolute);
    return {
      path: toPosixRelative(sourceRepoRoot, absolute),
      sha256: sha256Hex(buffer),
      bytes: buffer.byteLength,
      content: buffer.toString("utf8")
    };
  });
}

export interface LoadSnapshotOptions {
  /** Research snapshot root (`.../smart-campus-career/data/research`). */
  sourceRoot?: string;
  /** Product repository root; defaults to walking up from the CWD. */
  repoRoot?: string;
}

/**
 * Load and validate the snapshot layout:
 *   <sourceRoot>/unified-2026-10-19, supabase-pilot-2026-10-19, suibe-2026-10-18
 *   <sourceRepoRoot>/web/plans, <sourceRepoRoot>/docs/product-v2.md
 */
export function loadSnapshot(options: LoadSnapshotOptions = {}): Snapshot {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const sourceRoot = resolve(options.sourceRoot ?? defaultSourceRoot(repoRoot));
  const sourceRepoRoot = resolve(sourceRoot, "..", "..");
  const unifiedDir = join(sourceRoot, "unified-2026-10-19");
  const pilotDir = join(sourceRoot, "supabase-pilot-2026-10-19");
  const suibeDir = join(sourceRoot, "suibe-2026-10-18");

  if (!existsSync(unifiedDir)) throw new Error(`统一快照目录不存在：${unifiedDir}`);
  if (!existsSync(pilotDir)) throw new Error(`首批试导入快照目录不存在：${pilotDir}`);
  if (!existsSync(suibeDir)) throw new Error(`SUIBE 快照目录不存在：${suibeDir}`);

  const { validation, sha256: validationSha256 } = loadValidation(unifiedDir);
  const datasetMeta = readJson<{ schema_version?: string; snapshot_date?: string }>(
    join(unifiedDir, "dataset.json")
  );
  const suibeTexts = listSuibeTexts(sourceRepoRoot, suibeDir);

  const sources = readCsvRows<Record<string, string>>(join(unifiedDir, "sources.csv")).map(normalizeSource);
  const records = readCsvRows<Record<string, string>>(join(unifiedDir, "records.csv")).map(normalizeRecord);
  const requirements = readCsvRows<RawRequirement>(join(unifiedDir, "requirements.csv"));
  const aliases = readCsvRows<RawAlias>(join(unifiedDir, "aliases.csv"));
  const documents = readCsvRows<Record<string, string>>(join(unifiedDir, "documents.csv")).map(
    normalizeDocument
  );
  const evidenceCells = readCsvRows<Record<string, string>>(
    join(unifiedDir, "evidence_cells.csv")
  ).map(normalizeEvidenceCell);

  const pilot = readJson<PilotData>(join(pilotDir, "pilot-data.json"));

  const reports = loadTextDocuments(
    [
      join(sourceRoot, "boss-market-2026-10-17", "REPORT.md"),
      join(sourceRoot, "shanghai-decade-2026-10-18", "REPORT.md"),
      join(sourceRoot, "shanghai-official-2026-10-18", "REPORT.md")
    ],
    sourceRepoRoot
  );

  const plansDir = join(sourceRepoRoot, "web", "plans");
  if (!existsSync(plansDir)) throw new Error(`web/plans 目录不存在：${plansDir}`);
  const planPaths = readdirSync(plansDir)
    .filter((name) => /^m\d{2}\.md$/.test(name))
    .sort()
    .map((name) => join(plansDir, name));
  const plans = loadTextDocuments(planPaths, sourceRepoRoot);

  const productV2Absolute = join(sourceRepoRoot, "docs", "product-v2.md");
  const productV2 = existsSync(productV2Absolute) ? readFileSync(productV2Absolute) : null;

  // --- audited file manifest -------------------------------------------------
  const auditedFiles: SnapshotFileInfo[] = [];
  const recordFile = (absolute: string) => {
    const buffer = readFileSync(absolute);
    auditedFiles.push({
      path: toPosixRelative(sourceRepoRoot, absolute),
      sha256: sha256Hex(buffer),
      bytes: buffer.byteLength
    });
  };
  const unifiedFiles = [
    "README.md",
    "dataset.json",
    "sources.csv",
    "records.csv",
    "requirements.csv",
    "aliases.csv",
    "documents.csv",
    "evidence_cells.csv",
    "validation.json",
    "archive.sqlite",
    "documents.md"
  ];
  for (const name of unifiedFiles) recordFile(join(unifiedDir, name));
  for (const name of ["README.md", "pilot-data.json", "sources.csv", "metrics.csv", "01-import.sql"]) {
    recordFile(join(pilotDir, name));
  }
  for (const name of ["README.md", "checksums.sha256"]) recordFile(join(suibeDir, name));
  for (const text of suibeTexts) {
    recordFile(join(sourceRepoRoot, text.path));
  }
  for (const name of [
    "2023届-就业质量年度报告-公众号图文-OCR提取稿.md",
    "2024届-毕业生去哪儿了-推文长图-OCR提取稿.md"
  ]) {
    const absolute = join(suibeDir, "extracted", name);
    if (existsSync(absolute)) recordFile(absolute);
  }
  for (const report of reports) recordFile(join(sourceRepoRoot, report.path));
  for (const plan of plans) recordFile(join(sourceRepoRoot, plan.path));
  if (productV2) recordFile(productV2Absolute);

  auditedFiles.sort((a, b) => a.path.localeCompare(b.path));
  const snapshotHash = sha256Hex(
    auditedFiles.map((file) => `${file.path}:${file.sha256}`).join("\n")
  );

  return {
    sourceRootRelative: toPosixRelative(repoRoot, sourceRoot),
    sourceRoot,
    unifiedDir,
    pilotDir,
    suibeDir,
    sourceRepoRoot,
    schemaVersion:
      typeof datasetMeta.schema_version === "string" ? datasetMeta.schema_version : "unknown",
    snapshotDate:
      typeof datasetMeta.snapshot_date === "string" ? datasetMeta.snapshot_date : SNAPSHOT_DATE_FALLBACK,
    validation,
    validationSha256,
    sources,
    records,
    requirements,
    aliases,
    documents,
    evidenceCells,
    pilot,
    suibe: {
      checksums: Object.fromEntries(
        (() => {
          const map = new Map<string, string>();
          const lines = readFileSync(join(suibeDir, "checksums.sha256"), "utf8").split(/\r?\n/);
          for (const line of lines) {
            const match = /^([0-9a-f]{64})\s{2}(.+)$/.exec(line.trim());
            if (match) map.set(basename(match[2]), match[1]);
          }
          return map.entries();
        })()
      ),
      texts: suibeTexts
    },
    reports,
    plans,
    productV2Path: productV2 ? toPosixRelative(sourceRepoRoot, productV2Absolute) : null,
    productV2Sha256: productV2 ? sha256Hex(productV2) : null,
    files: auditedFiles,
    snapshotHash,
    commits: {
      sourceRecorded: SOURCE_COMMIT_RECORDED,
      sourceDetected: detectCommit(sourceRepoRoot, "HEAD"),
      productRecorded: PRODUCT_COMMIT_RECORDED,
      productDetected: detectCommit(repoRoot, "HEAD")
    }
  };
}

/** Full commit hash for a recorded short ref, when the local clone knows it. */
export function resolveCommit(repoRoot: string, ref: string): string | null {
  return detectCommit(repoRoot, ref);
}
