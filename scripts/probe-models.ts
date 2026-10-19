/** Checks that the configured embedding/chat model ids are advertised by OpenRouter. */
import { loadLocalEnv } from "./lib/env";

const BASE = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const EMBEDDING = process.env.OPENROUTER_EMBEDDING_MODEL ?? "qwen/qwen3-embedding-8b";
const CHAT = process.env.OPENROUTER_CHAT_MODEL ?? "deepseek/deepseek-chat";

async function getJson(path: string, key?: string) {
  const response = await fetch(`${BASE}${path}`, {
    headers: key ? { Authorization: `Bearer ${key}` } : undefined
  });
  return { status: response.status, body: await response.text() };
}

async function main() {
  loadLocalEnv();
  const key = process.env.OPENROUTER_API_KEY;
  const [models, embeddingModels, chatModel] = await Promise.all([
    getJson("/models", key),
    getJson("/embeddings/models", key),
    getJson(`/models/${CHAT}/endpoints`, key)
  ]);
  const embeddingList = embeddingModels.status === 200 ? JSON.parse(embeddingModels.body) : null;
  const ids: string[] = Array.isArray(embeddingList?.data)
    ? embeddingList.data.map((row: { id?: string }) => row.id).filter(Boolean)
    : [];
  const summary = {
    base: BASE,
    embedding_model: EMBEDDING,
    embedding_catalog_status: embeddingModels.status,
    embedding_advertised: ids.includes(EMBEDDING),
    embedding_catalog_sample: ids.slice(0, 10),
    chat_model: CHAT,
    chat_endpoints_status: chatModel.status,
    chat_advertised: chatModel.status === 200,
    models_status: models.status
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.embedding_advertised || !summary.chat_advertised) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "probe failed");
  process.exit(1);
});
