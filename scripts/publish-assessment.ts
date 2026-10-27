/**
 * 把随代码发布的职业探索问卷写入 Supabase `app_assessments`。
 *
 * 线上读取规则：BFF 只接受与代码内 seed 版本一致的 active 行，否则回退 seed；
 * 因此发布顺序不影响可用性，但保存云端画像要求对应版本行存在（app_profiles 外键）。
 *
 * Usage:
 *   npx tsx scripts/publish-assessment.ts                 # 默认 dry-run，只校验并打印计划
 *   npx tsx scripts/publish-assessment.ts --apply         # 需要 NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY
 *
 * Exit codes: 0 ok, 1 validation failure, 2 usage/config/IO error.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";

import { AssessmentSchema } from "../src/lib/contracts/catalog";

const SEED_PATH = fileURLToPath(new URL("../data/import/seed/assessment.json", import.meta.url));

function usage(): string {
  return [
    "用法：npx tsx scripts/publish-assessment.ts [--dry-run|--apply]",
    "",
    "  --dry-run   只校验题库并打印发布计划（默认）",
    "  --apply     写入 Supabase：新版本置为 active，其余版本置为 retired",
    "  --help      显示帮助",
    "",
    "安全：不打印密钥；题库内容随代码发布，数据库只保存同一份结构。"
  ].join("\n");
}

function exitWith(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

function scoringSpec(assessment: ReturnType<typeof AssessmentSchema.parse>) {
  return {
    version: assessment.version,
    sections: Object.keys(assessment.dimensions),
    rules: [
      "likert 单题 1–5 分归一到 0–1；reverse 题反向计分",
      "漏答保持未知：不写入 scores，不按 0 分，不补中间值",
      "rank 题只记录顺序与状态，不换算分数",
      "single 题记录选项原文，不按高低计分",
      "readiness 只影响引导颗粒度，不进入方向匹配",
      "经历补充只标注 evidence 状态，不伪造能力分数"
    ],
    notice: "极短筛查，非信效度验证量表，不构成职业判决"
  };
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false }
    }
  });
  if (values.help) {
    console.log(usage());
    return 0;
  }
  if (values.apply && values["dry-run"]) exitWith("--apply 与 --dry-run 不能同时使用", 2);

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(SEED_PATH, "utf8"));
  } catch (error) {
    exitWith(`读取题库失败：${error instanceof Error ? error.message : "unknown"}`, 2);
  }
  const parsed = AssessmentSchema.safeParse(raw);
  if (!parsed.success) {
    exitWith(
      "题库校验失败：\n" + parsed.error.issues.map((issue) => `- ${issue.path.join(".")}: ${issue.message}`).join("\n"),
      1
    );
  }
  const assessment = parsed.data;
  const required = assessment.questions.filter((question) => !question.optional);
  console.log(`题库版本：${assessment.version}`);
  console.log(`题目数量：${assessment.questions.length}（必答 ${required.length}，可选 ${assessment.questions.length - required.length}）`);
  console.log(`分区：${Object.keys(assessment.dimensions).join(" / ")}`);

  if (!values.apply) {
    console.log("\n[dry-run] 未写入数据库。确认后运行 --apply。");
    return 0;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secret) {
    exitWith("缺少环境变量 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SECRET_KEY", 2);
  }
  const supabase = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });

  const { data: existing, error: readError } = await supabase
    .from("app_assessments")
    .select("version, status")
    .order("created_at", { ascending: false });
  if (readError) exitWith(`读取 app_assessments 失败：${readError.message}`, 2);
  console.log(`已有版本：${(existing ?? []).map((row) => `${row.version}(${row.status})`).join(", ") || "无"}`);

  const { error: upsertError } = await supabase.from("app_assessments").upsert(
    {
      version: assessment.version,
      questions: assessment.questions,
      scoring_spec: scoringSpec(assessment),
      methodology_sources: assessment.methodology_sources,
      status: "active"
    },
    { onConflict: "version" }
  );
  if (upsertError) exitWith(`写入 ${assessment.version} 失败：${upsertError.message}`, 2);

  const { error: retireError } = await supabase
    .from("app_assessments")
    .update({ status: "retired" })
    .neq("version", assessment.version);
  if (retireError) exitWith(`退役旧版本失败：${retireError.message}`, 2);

  console.log(`\n[applied] ${assessment.version} → active，其余版本 → retired`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "unknown error");
    process.exit(2);
  });
