/**
 * Real OpenRouter probe for qwen/qwen3-embedding-8b (4096 dims, L2 normalized).
 * Costs a tiny amount of credit. Never prints the API key.
 *
 *   npx tsx scripts/probe-embedding.ts
 */
import { loadLocalEnv, redact, requireVar } from "./lib/env";

const BASE = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const MODEL = process.env.OPENROUTER_EMBEDDING_MODEL ?? "qwen/qwen3-embedding-8b";
const EXPECTED_DIMS = Number(process.env.EMBEDDING_DIMENSIONS ?? 4096);
const QUERY_TEMPLATE =
  "Instruct: Given a campus career planning question, retrieve relevant passages from authorized university documents and verified career evidence.\nQuery: ";
const QUERY = "上海对外经贸大学 国际经济与贸易 2024届 就业质量报告 去向";

function l2(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0));
  return vec.map((value) => value / norm);
}

async function embed(inputs: string[], key: string) {
  const started = Date.now();
  const response = await fetch(`${BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000",
      "X-Title": "Campus Pathway embedding probe"
    },
    body: JSON.stringify({ model: MODEL, input: inputs, encoding_format: "float" })
  });
  const elapsedMs = Date.now() - started;
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`embeddings HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return { payload: JSON.parse(text) as { data?: Array<{ index?: number; embedding?: number[] }>; usage?: unknown }, elapsedMs };
}

async function main() {
  loadLocalEnv();
  const key = requireVar("OPENROUTER_API_KEY");
  console.log(JSON.stringify({ phase: "start", base: BASE, model: MODEL, expected_dims: EXPECTED_DIMS, key: redact(key) }));

  const single = await embed([`${QUERY_TEMPLATE}${QUERY}`], key);
  const rows = single.payload.data ?? [];
  const first = rows[0]?.embedding ?? [];
  const finite = first.every((value) => Number.isFinite(value));
  const nonzero = first.some((value) => value !== 0);
  const normalized = l2(first);
  const norm = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0));

  const batchInputs = [
    `${QUERY_TEMPLATE}${QUERY}`,
    "文档：2024届本科毕业生去向落实率为示例。",
    "文档：国际经济与贸易专业课程包含国际贸易实务。"
  ];
  const batch = await embed(batchInputs, key);
  const ordered = [...(batch.payload.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const dims = ordered.map((row) => row.embedding?.length ?? 0);

  const summary = {
    phase: "result",
    model_requested: MODEL,
    single: {
      count: rows.length,
      dims: first.length,
      finite,
      nonzero,
      raw_norm: Number(norm.toFixed(6)),
      normalized_norm: Number(Math.sqrt(normalized.reduce((sum, value) => sum + value * value, 0)).toFixed(6)),
      latency_ms: single.elapsedMs
    },
    batch: {
      requested: batchInputs.length,
      count: ordered.length,
      dims,
      indexes: ordered.map((row) => row.index),
      latency_ms: batch.elapsedMs,
      all_4096: dims.every((value) => value === EXPECTED_DIMS)
    },
    usage: single.payload.usage ?? batch.payload.usage ?? null,
    ok: rows.length === 1 && first.length === EXPECTED_DIMS && finite && nonzero && dims.every((value) => value === EXPECTED_DIMS)
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ phase: "error", message: error instanceof Error ? error.message : "unknown" }));
  process.exit(1);
});
