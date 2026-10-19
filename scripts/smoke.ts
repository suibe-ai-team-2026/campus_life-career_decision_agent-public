/** Same-origin smoke check for a deployed or local preview. Never prints secrets. */
import { loadLocalEnv } from "./lib/env";

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000";

async function check(path: string, expect: number[]) {
  const started = Date.now();
  const response = await fetch(new URL(path, BASE), { redirect: "manual" });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON body is reported by length only
  }
  return {
    path,
    status: response.status,
    ok: expect.includes(response.status),
    latency_ms: Date.now() - started,
    body: json ?? { text_length: text.length }
  };
}

async function main() {
  loadLocalEnv();
  const results = [];
  results.push(await check("/api/health", [200]));
  results.push(await check("/api/catalog/directions", [200]));
  results.push(await check("/api/assessments/current", [200]));
  results.push(await check("/api/runs", [405, 401, 503]));
  console.log(JSON.stringify({ base: BASE, results, ok: results.every((row) => row.ok) }, null, 2));
  if (!results.every((row) => row.ok)) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "smoke failed");
  process.exit(1);
});
