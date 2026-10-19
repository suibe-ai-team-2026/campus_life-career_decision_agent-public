/**
 * Build the worker embedding corpus from the same authorised research snapshot.
 *
 * Usage:
 *   npx tsx scripts/build-corpus.ts
 *   npx tsx scripts/build-corpus.ts --source-root ../smart-campus-career/data/research
 *   npx tsx scripts/build-corpus.ts --out-dir data/import/out
 *
 * Outputs (gitignored):
 *   data/import/out/corpus.jsonl
 *   data/import/out/corpus-meta.json
 *
 * Admission rules and exclusions are documented in docs/data-dictionary.md and
 * repeated in corpus-meta.json. Every chunk is ≤ 1200 characters.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { buildImportPlan } from "./import/plan";
import { findRepoRoot } from "./import/snapshot";
import { buildCorpus } from "./import/corpus";
import { fatalFailureIds, hasFatalFailures } from "./import/report";
import { MAX_CHUNK_CHARS, type CorpusResult } from "./import/corpus";

function usage(): string {
  return [
    "用法：npx tsx scripts/build-corpus.ts [选项]",
    "",
    "  --source-root <path>  研究快照根目录，默认 ../smart-campus-career/data/research",
    "  --source-commit <c>   覆盖记录的源仓库 commit",
    "  --out-dir <path>      输出目录，默认 data/import/out（gitignored）",
    "  --help                显示本帮助"
  ].join("\n");
}

function printStats(result: CorpusResult, outDir: string): void {
  const { meta } = result;
  const counts = meta.counts;
  console.log("知途（Campus Pathway）· corpus 清单");
  console.log(`版本：${meta.corpus_version}`);
  console.log(`快照：${meta.snapshot.unified_snapshot_dir} · ${meta.snapshot.snapshot_hash.slice(0, 16)}…`);
  console.log("");
  console.log(`chunks：${counts.chunks}；chars：${counts.chars}；documents：${counts.documents}（其中有正文 ${counts.body_documents}）`);
  console.log(`chunk 长度：min ${counts.min_chunk_chars} / mean ${counts.mean_chunk_chars} / max ${counts.max_chunk_chars}（上限 ${MAX_CHUNK_CHARS}）`);
  console.log("按 chunk 类型：");
  for (const [kind, value] of Object.entries(counts.chunks_by_kind).sort()) {
    console.log(`  ${kind.padEnd(24)} ${value}`);
  }
  console.log("按来源类型（chunks / documents）：");
  for (const [scope, value] of Object.entries(counts.chunks_by_source_scope).sort()) {
    console.log(`  ${scope.padEnd(42)} ${value} / ${counts.documents_by_source_scope[scope] ?? 0}`);
  }
  console.log("按核验分级：");
  for (const [status, value] of Object.entries(counts.verification_class_counts).sort()) {
    console.log(`  ${status.padEnd(12)} ${value}`);
  }
  console.log(
    `去重：删除重复正文块 ${counts.deduplicated_chunks}；过短块 ${counts.dropped_short_chunks}。`
  );
  console.log("");
  console.log("没有可发布正文的来源：");
  console.log(`  ${meta.sources_without_publishable_body.note}`);
  for (const group of meta.sources_without_publishable_body.groups) {
    console.log(`  - ${group.reason}：${group.count} 个来源`);
  }
  console.log("");
  console.log("corpus-only 来源（embed 前需登记，见 corpus-meta.source_registry_extra）：");
  for (const extra of meta.source_registry_extra) {
    const chunks = result.lines.filter((line) => line.source_id === extra.source_id).length;
    console.log(`  ${extra.source_id.padEnd(44)} ${extra.source_scope.padEnd(40)} ${chunks} chunks`);
  }
  console.log("");
  console.log("排除清单（节选）：");
  for (const exclusion of meta.excluded.slice(0, 6)) {
    console.log(`  - ${exclusion.item}：${exclusion.reason}`);
  }
  console.log("");
  console.log(`输出：${join(outDir, "corpus.jsonl")}`);
  console.log(`统计：${join(outDir, "corpus-meta.json")}`);
  console.log(`sha256：${meta.corpus_sha256}`);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      "source-root": { type: "string" },
      "source-commit": { type: "string" },
      "out-dir": { type: "string" },
      help: { type: "boolean", short: "h", default: false }
    },
    allowPositionals: false
  });
  if (values.help) {
    console.log(usage());
    return 0;
  }
  const repoRoot = findRepoRoot();
  const outDirRelative = values["out-dir"] ?? "data/import/out";
  const plan = buildImportPlan({
    repoRoot,
    sourceRoot: values["source-root"],
    sourceCommit: values["source-commit"]
  });
  if (hasFatalFailures(plan)) {
    console.error(`导入计划致命校验未通过，拒绝生成 corpus：${fatalFailureIds(plan).join(", ")}`);
    return 1;
  }

  const result = buildCorpus(plan);
  const outDirAbsolute = join(repoRoot, outDirRelative);
  mkdirSync(outDirAbsolute, { recursive: true });
  const jsonl = `${result.lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
  writeFileSync(join(outDirAbsolute, "corpus.jsonl"), jsonl, "utf8");
  writeFileSync(
    join(outDirAbsolute, "corpus-meta.json"),
    `${JSON.stringify(result.meta, null, 2)}\n`,
    "utf8"
  );
  printStats(result, outDirRelative);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`corpus 构建失败：${message}`);
    process.exitCode = 2;
  });
