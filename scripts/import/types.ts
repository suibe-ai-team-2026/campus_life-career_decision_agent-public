/** Shared types for the research-snapshot → Supabase import pipeline. */

export type JsonObject = Record<string, unknown>;

export interface SnapshotFileInfo {
  /** Path relative to the source research repository root. */
  path: string;
  sha256: string;
  bytes: number;
}

export interface SourceVariant {
  batch: string;
  original_id?: string;
  status?: string;
  title?: string;
  metadata?: JsonObject;
}

export interface RawSource {
  source_id: string;
  url: string;
  title: string;
  verification_status: string;
  variants: SourceVariant[];
}

export interface RawRecord {
  record_id: string;
  record_type: string;
  source_id: string;
  cohort: string;
  school: string;
  degree: string;
  major: string;
  metric: string;
  value: string;
  unit: string;
  denominator: string;
  numerator: string;
  cutoff: string;
  pdf_page: string;
  verification_status: string;
  included: string;
  payload: JsonObject;
  provenance: unknown[];
}

export interface RawRequirement {
  requirement_id: string;
  record_id: string;
  category: string;
  term: string;
  strength: string;
  basis: string;
  original_id: string;
}

export interface RawAlias {
  batch: string;
  original_id: string;
  record_type: string;
  record_id: string;
  source_id: string;
}

export interface RawDocumentReference {
  document_id?: string;
  original_id?: string;
  reference_only?: boolean;
  repo_path?: string;
  sha256?: string;
  source_id?: string;
  verification_status?: string;
  [key: string]: unknown;
}

export interface RawDocument {
  document_id: string;
  sha256: string;
  references: RawDocumentReference[];
}

export interface EvidenceCell {
  major_id: string;
  major: string;
  cohort: string;
  degree: string;
  record_ids: string[];
  evidence_state: string;
}

export interface PilotSource {
  id: string;
  title: string;
  url: string;
  kind: string;
  read_status: string;
  retrieved: string;
  publisher: string;
  sha256: string;
  local_file: string;
  pages: number;
}

export interface PilotMetric {
  id: string;
  source_id: string;
  cohort: number;
  name: string;
  value: number;
  unit: string;
  denominator: number | null;
  numerator: number | null;
  cutoff: string;
  pdf_page: number;
  definition: string;
  status: string;
  scope: string;
}

export interface PilotData {
  sources: PilotSource[];
  metrics: PilotMetric[];
}

export interface ValidationCounts {
  sources: number;
  records: number;
  documents: number;
  requirements: number;
  aliases: number;
}

export interface ValidationJson {
  counts: ValidationCounts;
  merged_aliases?: number;
  removed_private_fields?: number;
  cleaned_url_count?: number;
  sqlite_integrity?: string;
  foreign_key_errors?: number;
  local_files_audited?: number;
  baseline_branch?: string;
  baseline_commit?: string;
  remote_branch_verified?: string;
  scope?: string;
  [key: string]: unknown;
}

export interface SuibeTextFile {
  /** Path relative to the source research repository root. */
  path: string;
  sha256: string;
  bytes: number;
  content: string;
  /** 届别, from the file name (e.g. "2015"). */
  year: string;
  /** Version suffix for the 2016 A/B reports ("A" | "B" | ""). */
  edition: string;
  /** SHA-256 of the source PDF registered in `checksums.sha256`, if present. */
  pdf_sha256: string | null;
  /** Path of the source PDF relative to the source repository root, if registered. */
  pdf_path: string | null;
}

export interface TextDocument {
  /** Path relative to the source research repository root. */
  path: string;
  sha256: string;
  bytes: number;
  content: string;
}

export interface SnapshotCommits {
  /** Source research repository commit recorded by the task hand-off. */
  sourceRecorded: string;
  /** Source research repository commit detected with `git rev-parse HEAD` (read-only). */
  sourceDetected: string | null;
  /** Product repository commit recorded by the task hand-off. */
  productRecorded: string;
  /** Product repository commit detected with `git rev-parse HEAD` (read-only). */
  productDetected: string | null;
}

export interface Snapshot {
  /** Path relative to the product repository root (recorded in reports/manifest). */
  sourceRootRelative: string;
  sourceRoot: string;
  unifiedDir: string;
  pilotDir: string;
  suibeDir: string;
  /** Repository root of the source research repository (holds `web/plans`). */
  sourceRepoRoot: string;
  schemaVersion: string;
  snapshotDate: string;
  validation: ValidationJson;
  validationSha256: string;
  sources: RawSource[];
  records: RawRecord[];
  requirements: RawRequirement[];
  aliases: RawAlias[];
  documents: RawDocument[];
  evidenceCells: EvidenceCell[];
  pilot: PilotData;
  suibe: { checksums: Record<string, string>; texts: SuibeTextFile[] };
  reports: TextDocument[];
  plans: TextDocument[];
  productV2Path: string | null;
  productV2Sha256: string | null;
  files: SnapshotFileInfo[];
  snapshotHash: string;
  commits: SnapshotCommits;
}

// ---------------------------------------------------------------------------
// Target rows (column names match supabase/migrations/20261019000100_*.sql)
// ---------------------------------------------------------------------------

export interface DirectionRow {
  direction_id: string;
  title: string;
  category_version: string;
  description: string;
  sort_order: number;
  active: boolean;
  metadata: JsonObject;
}

export interface AssessmentRow {
  version: string;
  questions: unknown;
  scoring_spec: JsonObject;
  methodology_sources: unknown;
  status: "active";
}

export interface SourceRow {
  source_id: string;
  canonical_url: string | null;
  title: string;
  publisher: string | null;
  source_scope: string;
  visibility: "approved_reference";
  owner_id: null;
  verification_status: string;
  metadata: JsonObject;
}

export interface SourceVersionRow {
  source_version_id: string;
  source_id: string;
  content_sha256: string;
  published_at: string | null;
  retrieved_at: string;
  effective_from: null;
  effective_to: null;
  storage_path: null;
  extraction_status: "pending" | "partial";
  parser_version: null;
  metadata: JsonObject;
  visibility: "approved_reference";
  owner_id: null;
}

export interface EvidenceRow {
  record_id: string;
  source_version_id: string;
  record_type: string;
  cohort: string | null;
  school: string | null;
  degree: string | null;
  major: string | null;
  metric: string | null;
  value: number | null;
  unit: string | null;
  numerator: number | null;
  denominator: number | null;
  statistical_cutoff: string | null;
  definition: string | null;
  population_scope: string | null;
  locator: JsonObject;
  verification_status: string;
  included: boolean;
  payload: JsonObject;
}

export interface RequirementRow {
  requirement_id: string;
  direction_id: string;
  skill_id: string;
  skill_label: string;
  requirement_level: "required" | "preferred" | "mentioned";
  source_version_id: string;
  locator: JsonObject;
  status: "unverified";
}

export interface AliasRow {
  batch_id: string;
  legacy_id: string;
  entity_type: string;
  stable_id: string;
}

export interface CheckResult {
  id: string;
  description: string;
  expected: string | number;
  actual: string | number;
  ok: boolean;
  /** A fatal check blocks `--apply`; non-fatal checks are reported as warnings. */
  fatal: boolean;
}

export interface Exclusion {
  item: string;
  reason: string;
  count?: number;
}

export interface PilotResolution {
  sources: {
    legacy_id: string;
    stable_id: string;
    title: string;
    url: string;
  }[];
  records: {
    legacy_id: string;
    stable_id: string;
    cohort: number;
    metric: string;
    value: number;
    unit: string;
  }[];
  /** Aliases read from the unified snapshot that already map pilot ids. */
  alias_rows: number;
  duplicate_rows: number;
  checks: CheckResult[];
}

export interface ImportCounts {
  directions: number;
  assessments: number;
  sources: number;
  source_versions: number;
  source_versions_file_hash: number;
  source_versions_reference_hash: number;
  documents: number;
  evidence_records: number;
  evidence_records_by_type: Record<string, number>;
  direction_requirements: number;
  direction_requirements_by_direction: Record<string, number>;
  direction_requirements_by_level: Record<string, number>;
  aliases: number;
  pilot_sources: number;
  pilot_metrics: number;
}

export interface EntitySet {
  table: string;
  rows: number;
  upsert_key: string;
  /** SHA-256 over the sorted primary-key values (audit anchor, no row dumps). */
  id_sha256: string;
}

export interface SeedFileInfo {
  /** Path relative to the product repository root. */
  path: string;
  sha256: string;
  bytes: number;
}

export interface ImportManifest {
  schema_version: string;
  plan_hash: string;
  entity_sets: EntitySet[];
  seed_files: SeedFileInfo[];
  counts: ImportCounts;
  snapshot: {
    source_root: string;
    unified_snapshot_dir: string;
    snapshot_date: string;
    schema_version: string;
    snapshot_hash: string;
    validation_sha256: string;
    files: SnapshotFileInfo[];
  };
  repositories: {
    product_repo: string;
    product_commit_recorded: string;
    product_commit_detected: string | null;
    source_repo: string;
    source_commit_recorded: string;
    source_commit_resolved: string;
    source_commit_detected: string | null;
    source_validation_baseline_commit: string | null;
    source_validation_baseline_branch: string | null;
  };
  pilot_aliases: { legacy_id: string; entity_type: string; stable_id: string }[];
  direction_requirements: {
    rows: number;
    direction_counts: Record<string, number>;
    level_counts: Record<string, number>;
    status_counts: Record<string, number>;
    mapping_method_counts: Record<string, number>;
  };
  documents: {
    rows: number;
    id_sha256: string;
    content_hash_kinds: Record<string, number>;
  };
  exclusions: Exclusion[];
  safety: {
    contains_secrets: false;
    contains_student_personal_data: false;
    contains_absolute_local_paths: false;
    old_import_sql_executed: false;
  };
}

export interface ImportPlan {
  snapshot: Snapshot;
  rows: {
    directions: DirectionRow[];
    assessments: AssessmentRow[];
    sources: SourceRow[];
    versions: SourceVersionRow[];
    evidence: EvidenceRow[];
    requirements: RequirementRow[];
    aliases: AliasRow[];
  };
  counts: ImportCounts;
  checks: CheckResult[];
  exclusions: Exclusion[];
  warnings: string[];
  pilot: PilotResolution;
  manifest: ImportManifest;
  planHash: string;
  batchId: string;
  sourceCommit: string;
}
