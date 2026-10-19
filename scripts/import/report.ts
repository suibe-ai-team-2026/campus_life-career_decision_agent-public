/** JSON report / console summary writer for the import pipeline (out/ is gitignored). */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { sha256Hex, stableStringify } from "./hash";
import type { CheckResult, Exclusion, ImportManifest, ImportPlan } from "./types";

export const REPORT_VERSION = "career-import-report-v1";
export const DRY_RUN_REPORT_PATH = "data/import/out/import-report.json";
export const APPLY_REPORT_PATH = "data/import/out/apply-report.json";
export const MANIFEST_PATH = "data/import/manifest.json";

export interface ApplyOutcome {
  status: "succeeded" | "failed" | "rolled_back";
  batch_id: string;
  batches_written: { table: string; rows: number }[];
  actual_counts: Record<string, number | null>;
  rollback: {
    attempted: boolean;
    removed_rows: number;
    errors: string[];
  };
  error_code: string | null;
  error_message: string | null;
  notes: string[];
}

export interface ImportReport {
  schema_version: string;
  mode: "dry-run" | "apply";
  generated_at: string;
  batch_id: string;
  checkout: {
    source_root: string;
    unified_snapshot_dir: string;
    snapshot_date: string;
    snapshot_schema_version: string;
    snapshot_hash: string;
    validation_file_sha256: string;
    validation_counts: Record<string, number>;
    product_commit_recorded: string;
    product_commit_detected: string | null;
    source_commit_recorded: string;
    source_commit_resolved: string;
    source_commit_detected: string | null;
    validation_baseline_commit: string | null;
    validation_baseline_branch: string | null;
  };
  counts: ImportPlan["counts"];
  checks: {
    total: number;
    passed: number;
    failed: number;
    fatal_failed: number;
    failed_ids: string[];
    items: CheckResult[];
  };
  warnings: string[];
  pilot: {
    sources: ImportPlan["pilot"]["sources"];
    records: ImportPlan["pilot"]["records"];
    duplicate_rows: number;
    alias_rows: number;
  };
  not_imported: Exclusion[];
  manifest: {
    path: string;
    sha256: string;
    entity_sets: ImportManifest["entity_sets"];
    exclusions: number;
  };
  /** Present only when `--apply` ran. */
  apply?: ApplyOutcome;
}

export function sha256OfManifest(manifest: ImportManifest): string {
  return sha256Hex(stableStringify(manifest));
}

export function buildReport(
  plan: ImportPlan,
  mode: "dry-run" | "apply",
  manifestPath = MANIFEST_PATH
): ImportReport {
  const failed = plan.checks.filter((check) => !check.ok);
  const fatalFailed = failed.filter((check) => check.fatal);
  return {
    schema_version: REPORT_VERSION,
    mode,
    generated_at: new Date().toISOString(),
    batch_id: plan.batchId,
    checkout: {
      source_root: plan.snapshot.sourceRootRelative,
      unified_snapshot_dir: "unified-2026-10-19",
      snapshot_date: plan.snapshot.snapshotDate,
      snapshot_schema_version: plan.snapshot.schemaVersion,
      snapshot_hash: plan.snapshot.snapshotHash,
      validation_file_sha256: plan.snapshot.validationSha256,
      validation_counts: plan.snapshot.validation.counts as unknown as Record<string, number>,
      product_commit_recorded: plan.snapshot.commits.productRecorded,
      product_commit_detected: plan.snapshot.commits.productDetected,
      source_commit_recorded: plan.snapshot.commits.sourceRecorded,
      source_commit_resolved: plan.sourceCommit,
      source_commit_detected: plan.snapshot.commits.sourceDetected,
      validation_baseline_commit:
        (plan.snapshot.validation.baseline_commit as string | undefined) ?? null,
      validation_baseline_branch:
        (plan.snapshot.validation.baseline_branch as string | undefined) ?? null
    },
    counts: plan.counts,
    checks: {
      total: plan.checks.length,
      passed: plan.checks.length - failed.length,
      failed: failed.length,
      fatal_failed: fatalFailed.length,
      failed_ids: failed.map((check) => check.id),
      items: plan.checks
    },
    warnings: plan.warnings,
    pilot: {
      sources: plan.pilot.sources,
      records: plan.pilot.records,
      duplicate_rows: plan.pilot.duplicate_rows,
      alias_rows: plan.pilot.alias_rows
    },
    not_imported: plan.exclusions,
    manifest: {
      path: manifestPath,
      sha256: sha256OfManifest(plan.manifest),
      entity_sets: plan.manifest.entity_sets,
      exclusions: plan.exclusions.length
    }
  };
}

export function writeJsonFile(repoRoot: string, relativePath: string, value: unknown): string {
  const absolute = join(repoRoot, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return relativePath;
}

function percent(part: number, total: number): string {
  if (total === 0) return "0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

/** Human-readable dry-run summary printed to stdout (Chinese, matching repo docs). */
export function printSummary(report: ImportReport, plan: ImportPlan): void {
  const counts = report.counts;
  const lines: string[] = [];
  lines.push("知途（Campus Pathway）· 研究快照导入");
  lines.push(`模式：${report.mode}${report.mode === "dry-run" ? "（只读，不联网，不写数据库）" : ""}`);
  lines.push(`批次：${report.batch_id}`);
  lines.push(`快照：${report.checkout.unified_snapshot_dir} · 快照日 ${report.checkout.snapshot_date}`);
  lines.push(`快照哈希：${report.checkout.snapshot_hash.slice(0, 16)}…（validation.json sha256 ${report.checkout.validation_file_sha256.slice(0, 16)}…）`);
  lines.push("");
  lines.push("将导入行数（全部按主键/唯一键 upsert，可重复执行）：");
  lines.push(`  app_directions              ${counts.directions}`);
  lines.push(`  app_assessments             ${counts.assessments}`);
  lines.push(`  app_sources                 ${counts.sources}`);
  lines.push(
    `  app_source_versions         ${counts.source_versions}（原件哈希 ${counts.source_versions_file_hash} / 快照引用哈希 ${counts.source_versions_reference_hash}）`
  );
  lines.push(`  app_evidence_records        ${counts.evidence_records}`);
  for (const [type, value] of Object.entries(counts.evidence_records_by_type).sort()) {
    lines.push(`      · ${type.padEnd(28)} ${value}`);
  }
  lines.push(`  app_direction_requirements  ${counts.direction_requirements}（全部 status=unverified）`);
  for (const [direction, value] of Object.entries(counts.direction_requirements_by_direction).sort()) {
    lines.push(`      · ${direction.padEnd(24)} ${value}`);
  }
  lines.push(
    `      级别：required ${counts.direction_requirements_by_level.required ?? 0} / preferred ${
      counts.direction_requirements_by_level.preferred ?? 0
    } / mentioned ${counts.direction_requirements_by_level.mentioned ?? 0}`
  );
  lines.push(`  app_source_aliases          ${counts.aliases}（含 pilot M001–M007 的 7 条别名）`);
  lines.push(`  documents（元数据）         ${counts.documents}（嵌入 source_versions，不解析正文）`);
  lines.push("");
  lines.push(`试导入复用：来源 ${counts.pilot_sources} 个 + 指标 ${counts.pilot_metrics} 条（不重复计数，pilot 别名行 ${report.pilot.alias_rows}）`);
  lines.push(
    `校验：${report.checks.passed}/${report.checks.total} 通过，失败 ${report.checks.failed}，致命失败 ${report.checks.fatal_failed}`
  );
  if (report.checks.failed_ids.length > 0) {
    lines.push(`  失败项：${report.checks.failed_ids.join(", ")}`);
  }
  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("缺口与提醒：");
    for (const warning of report.warnings) lines.push(`  - ${warning}`);
  }
  lines.push("");
  lines.push("不导入清单（节选，完整见报告 JSON）：");
  for (const exclusion of report.not_imported.slice(0, 8)) {
    lines.push(`  - ${exclusion.item}：${exclusion.reason}`);
  }
  if (report.not_imported.length > 8) lines.push(`  … 其余 ${report.not_imported.length - 8} 项见 ${DRY_RUN_REPORT_PATH}`);
  lines.push("");
  if (report.apply) {
    lines.push(`--apply 结果：${report.apply.status}（batch=${report.apply.batch_id}）`);
    if (report.apply.error_message) lines.push(`  错误：${report.apply.error_code} ${report.apply.error_message}`);
    lines.push(
      `  回滚：attempted=${report.apply.rollback.attempted} removed_rows=${report.apply.rollback.removed_rows}`
    );
    for (const note of report.apply.notes) lines.push(`  说明：${note}`);
    for (const rollbackError of report.apply.rollback.errors) lines.push(`  回滚问题：${rollbackError}`);
  } else {
    lines.push("报告：data/import/out/import-report.json（--apply 未执行，等待 SUPABASE_URL + SUPABASE_SECRET_KEY）");
  }
  lines.push("");
  lines.push(`入库率取样：243 条记录 ≠ 243 名毕业生；17/600 精确格 ≠ 600 格全完成；PDF ≠ 结构化课程表。`);
  lines.push(`快照统计：来源 ${percent(counts.sources, counts.sources)}（319/319），行数总计 ${sumRows(counts)}。`);
  console.log(lines.join("\n"));
  void plan;
}

function sumRows(counts: ImportPlan["counts"]): number {
  return (
    counts.directions +
    counts.assessments +
    counts.sources +
    counts.source_versions +
    counts.evidence_records +
    counts.direction_requirements +
    counts.aliases
  );
}

export function hasFatalFailures(plan: ImportPlan): boolean {
  return plan.checks.some((check) => check.fatal && !check.ok);
}

export function fatalFailureIds(plan: ImportPlan): string[] {
  return plan.checks.filter((check) => check.fatal && !check.ok).map((check) => check.id);
}
