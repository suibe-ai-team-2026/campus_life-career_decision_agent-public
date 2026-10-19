/**
 * Research snapshot → Supabase `app_` tables.
 *
 * Usage:
 *   npx tsx scripts/import-research.ts --dry-run                 # default, read-only
 *   npx tsx scripts/import-research.ts --apply                   # needs SUPABASE_URL + SUPABASE_SECRET_KEY
 *   npx tsx scripts/import-research.ts --dry-run --source-root ../smart-campus-career/data/research
 *   npx tsx scripts/import-research.ts --dry-run --emit-manifest # write data/import/manifest.json
 *
 * Exit codes: 0 ok, 1 fatal validation failure, 2 usage/config/IO error.
 */
import { parseArgs } from "node:util";

import { findRepoRoot } from "./import/snapshot";
import { buildImportPlan } from "./import/plan";
import {
  APPLY_REPORT_PATH,
  DRY_RUN_REPORT_PATH,
  MANIFEST_PATH,
  buildReport,
  fatalFailureIds,
  hasFatalFailures,
  printSummary,
  sha256OfManifest,
  writeJsonFile
} from "./import/report";
import { ApplyConfigError, applyPlan, resolveCredentials } from "./import/apply";

function usage(): string {
  return [
    "用法：npx tsx scripts/import-research.ts [--dry-run|--apply] [选项]",
    "",
    "  --dry-run                 只读预演（默认）；不联网、不写数据库，生成 data/import/out/import-report.json",
    "  --apply                   写 Supabase；需要环境变量 SUPABASE_URL + SUPABASE_SECRET_KEY",
    "  --source-root <path>      研究快照根目录，默认 ../smart-campus-career/data/research",
    "  --source-commit <commit>  覆盖记录的源仓库 commit（默认 ba2794b / 本地 git 解析）",
    "  --report <path>           覆盖报告输出路径（默认 data/import/out/import-report.json 或 apply-report.json）",
    "  --emit-manifest           同时写入 data/import/manifest.json（可审计 manifest）",
    "  --help                    显示本帮助",
    "",
    "安全：不执行旧 01-import.sql；不导入真实学生个人信息；不把密钥写入文件或打印。"
  ].join("\n");
}

function fail(message: string, exitCode: number): never {
  console.error(message);
  process.exit(exitCode);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      "source-root": { type: "string" },
      "source-commit": { type: "string" },
      report: { type: "string" },
      "emit-manifest": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false }
    },
    allowPositionals: false
  });

  if (values.help) {
    console.log(usage());
    return 0;
  }
  if (values.apply && values["dry-run"]) {
    return fail("--apply 与 --dry-run 不能同时使用。", 2);
  }
  const mode: "dry-run" | "apply" = values.apply ? "apply" : "dry-run";
  const repoRoot = findRepoRoot();

  // Fail fast on missing service credentials: never write a partial report that
  // claims an apply happened when it could not even start.
  if (mode === "apply") {
    try {
      resolveCredentials();
    } catch (error) {
      if (error instanceof ApplyConfigError) return fail(error.message, 2);
      throw error;
    }
  }

  const plan = buildImportPlan({
    repoRoot,
    sourceRoot: values["source-root"],
    sourceCommit: values["source-commit"]
  });

  const report = buildReport(plan, mode, MANIFEST_PATH);
  const reportPath = values.report ?? (mode === "apply" ? APPLY_REPORT_PATH : DRY_RUN_REPORT_PATH);

  if (hasFatalFailures(plan)) {
    report.apply = undefined;
    writeJsonFile(repoRoot, reportPath, report);
    if (values["emit-manifest"]) {
      writeJsonFile(repoRoot, MANIFEST_PATH, {
        ...plan.manifest,
        manifest_sha256: sha256OfManifest(plan.manifest)
      });
    }
    printSummary(report, plan);
    console.error(`\n致命校验未通过，${mode === "apply" ? "拒绝写入数据库" : "dry-run 失败"}：${fatalFailureIds(plan).join(", ")}`);
    return 1;
  }

  if (values["emit-manifest"]) {
    writeJsonFile(repoRoot, MANIFEST_PATH, {
      ...plan.manifest,
      manifest_sha256: sha256OfManifest(plan.manifest)
    });
  }

  if (mode === "apply") {
    const outcome = await applyPlan(plan);
    report.apply = outcome;
    writeJsonFile(repoRoot, reportPath, report);
    printSummary(report, plan);
    console.log(`\napply 报告：${reportPath}`);
    return outcome.status === "succeeded" ? 0 : 1;
  }

  writeJsonFile(repoRoot, reportPath, report);
  printSummary(report, plan);
  console.log(`\n报告：${reportPath}`);
  if (values["emit-manifest"]) console.log(`manifest：${MANIFEST_PATH}`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`导入脚本失败：${message}`);
    process.exitCode = 2;
  });
