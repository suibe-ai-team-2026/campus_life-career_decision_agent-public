/** DeepSeek 官方 chat 探针：模型、JSON 模式、延迟与 token；不打印 key。 */
import { loadLocalEnv, redact, requireVar } from "./lib/env";

const BASE = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
const MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-flash";

async function main() {
  loadLocalEnv();
  const key = requireVar("DEEPSEEK_API_KEY");
  const started = Date.now();
  const response = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: "只输出 JSON，不要额外文字。" },
        { role: "user", content: '返回 {"ok":true,"model":"deepseek-flash"}' }
      ],
      response_format: { type: "json_object" },
      max_tokens: 400,
      temperature: 0.1
    })
  });
  const latencyMs = Date.now() - started;
  const text = await response.text();
  if (!response.ok) {
    console.error(JSON.stringify({ ok: false, status: response.status, body: text.slice(0, 300) }));
    process.exit(1);
  }
  const payload = JSON.parse(text) as { model?: string; choices?: Array<{ message?: { content?: string } }>; usage?: unknown };
  const content = payload.choices?.[0]?.message?.content ?? "";
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = null;
  }
  console.log(JSON.stringify({
    ok: Boolean(parsed),
    provider: "deepseek-official",
    base: BASE,
    model_requested: MODEL,
    model_returned: payload.model ?? null,
    latency_ms: latencyMs,
    usage: payload.usage ?? null,
    content_preview: content.slice(0, 120),
    key: redact(key)
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "probe failed");
  process.exit(1);
});
