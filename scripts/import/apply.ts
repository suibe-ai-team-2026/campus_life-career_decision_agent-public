/**
 * `--apply` writer: upserts the deterministic plan through the Supabase service
 * client. The service/secret key is only ever read from the environment; it is
 * never written to disk, printed, or embedded in error messages.
 *
 * Idempotency: every row is upserted on its primary/unique key, and
 * `app_source_versions.source_version_id` is a deterministic UUIDv5, so reruns
 * update the same rows and never grow the tables.
 */
import type { ImportPlan } from "./types";
import { sha256OfManifest, type ApplyOutcome } from "./report";

export class ApplyConfigError extends Error {}

interface TableSpec {
  table: string;
  onConflict: string;
  keys: string[];
  rows: Record<string, unknown>[];
}

interface Credentials {
  url: string;
  key: string;
  keyVariable: string;
}

const CHUNK_SIZE = 400;

function tableSpecs(plan: ImportPlan): TableSpec[] {
  return [
    {
      table: "app_directions",
      onConflict: "direction_id",
      keys: ["direction_id"],
      rows: plan.rows.directions as unknown as Record<string, unknown>[]
    },
    {
      table: "app_assessments",
      onConflict: "version",
      keys: ["version"],
      rows: plan.rows.assessments as unknown as Record<string, unknown>[]
    },
    {
      table: "app_sources",
      onConflict: "source_id",
      keys: ["source_id"],
      rows: plan.rows.sources as unknown as Record<string, unknown>[]
    },
    {
      table: "app_source_versions",
      onConflict: "source_version_id",
      keys: ["source_version_id"],
      rows: plan.rows.versions as unknown as Record<string, unknown>[]
    },
    {
      table: "app_evidence_records",
      onConflict: "record_id",
      keys: ["record_id"],
      rows: plan.rows.evidence as unknown as Record<string, unknown>[]
    },
    {
      table: "app_direction_requirements",
      onConflict: "requirement_id",
      keys: ["requirement_id"],
      rows: plan.rows.requirements as unknown as Record<string, unknown>[]
    },
    {
      table: "app_source_aliases",
      onConflict: "batch_id,legacy_id,entity_type",
      keys: ["batch_id", "legacy_id", "entity_type"],
      rows: plan.rows.aliases as unknown as Record<string, unknown>[]
    }
  ];
}

function rowKey(row: Record<string, unknown>, keys: string[]): string {
  return keys.map((key) => String(row[key] ?? "")).join("|");
}

function chunk<T>(items: readonly T[], size = CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

/** Require service credentials from the environment. Values are never logged. */
export function resolveCredentials(env: NodeJS.ProcessEnv = process.env): Credentials {
  const url = (env.SUPABASE_URL ?? "").trim();
  const secret = (env.SUPABASE_SECRET_KEY ?? "").trim();
  const legacy = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const key = secret !== "" ? secret : legacy;
  const keyVariable = secret !== "" ? "SUPABASE_SECRET_KEY" : "SUPABASE_SERVICE_ROLE_KEY";
  if (url === "" || key === "") {
    throw new ApplyConfigError(
      "--apply 需要环境变量 SUPABASE_URL 与 SUPABASE_SECRET_KEY（只从环境读取，不写入文件）。缺少凭据时未执行任何写操作。"
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ApplyConfigError("SUPABASE_URL 不是合法 URL。");
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new ApplyConfigError("SUPABASE_URL 必须是 https://（本地测试允许 localhost/127.0.0.1）。");
  }
  return { url, key, keyVariable };
}

function sanitize(message: string, secrets: readonly string[]): string {
  let safe = message;
  for (const secret of secrets) {
    if (secret !== "" && safe.includes(secret)) safe = safe.split(secret).join("***");
  }
  return safe;
}

async function withRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError;
}

async function loadExistingKeys(
  client: Awaited<ReturnType<typeof createServiceClient>>,
  specs: TableSpec[]
): Promise<Map<string, Set<string>>> {
  const existing = new Map<string, Set<string>>();
  for (const spec of specs) {
    const keys = new Set<string>();
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await client
        .from(spec.table)
        .select(spec.keys.join(","))
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`读取 ${spec.table} 现有主键失败：${error.message}`);
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      for (const row of rows) keys.add(rowKey(row, spec.keys));
      if (rows.length < pageSize) break;
    }
    existing.set(spec.table, keys);
  }
  return existing;
}

async function createServiceClient(url: string, key: string) {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

async function upsertBatchTable(
  client: ServiceClient,
  spec: TableSpec
): Promise<number> {
  for (const rows of chunk(spec.rows)) {
    await withRetry(async () => {
      const { error } = await client.from(spec.table).upsert(rows, { onConflict: spec.onConflict });
      if (error) throw new Error(`${spec.table} upsert 失败：${error.message}`);
    });
  }
  return spec.rows.length;
}

async function countRows(client: ServiceClient, table: string): Promise<number | null> {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
  if (error) return null;
  return count ?? null;
}

/** Create/refresh the batch row with status=running when the run starts. */
async function startBatch(client: ServiceClient, plan: ImportPlan): Promise<void> {
  const record = {
    batch_id: plan.batchId,
    source_repo: `${plan.manifest.repositories.source_repo}@${plan.sourceCommit}`,
    source_commit: plan.sourceCommit,
    manifest_sha256: sha256OfManifest(plan.manifest),
    counts: plan.counts,
    status: "running" as const,
    started_at: new Date().toISOString()
  };
  const { error } = await client
    .from("app_import_batches")
    .upsert(record, { onConflict: "batch_id" });
  if (error) throw new Error(`app_import_batches 写入失败：${error.message}`);
}

/**
 * Finish the batch row. Uses UPDATE so the recorded `started_at` is preserved;
 * falls back to an insert if the running row is missing (e.g. failure before it
 * was written).
 */
async function finishBatch(
  client: ServiceClient,
  plan: ImportPlan,
  status: "succeeded" | "failed" | "rolled_back",
  errorCode: string | null
): Promise<void> {
  const patch = { status, finished_at: new Date().toISOString(), error_code: errorCode };
  const { data, error } = await client
    .from("app_import_batches")
    .update(patch)
    .eq("batch_id", plan.batchId)
    .select("batch_id");
  if (error) throw new Error(`app_import_batches 状态更新失败：${error.message}`);
  if (Array.isArray(data) && data.length > 0) return;
  const record = {
    batch_id: plan.batchId,
    source_repo: `${plan.manifest.repositories.source_repo}@${plan.sourceCommit}`,
    source_commit: plan.sourceCommit,
    manifest_sha256: sha256OfManifest(plan.manifest),
    counts: plan.counts,
    started_at: new Date().toISOString(),
    ...patch
  };
  const { error: insertError } = await client
    .from("app_import_batches")
    .upsert(record, { onConflict: "batch_id" });
  if (insertError) throw new Error(`app_import_batches 写入失败：${insertError.message}`);
}

async function rollbackInsertedRows(
  client: ServiceClient,
  specs: TableSpec[],
  existing: Map<string, Set<string>>
): Promise<{ removed: number; errors: string[] }> {
  const errors: string[] = [];
  let removed = 0;
  // Reverse dependency order: children first.
  for (const spec of [...specs].reverse()) {
    const before = existing.get(spec.table) ?? new Set<string>();
    const inserted = spec.rows
      .map((row) => rowKey(row, spec.keys))
      .filter((key) => !before.has(key));
    if (inserted.length === 0) continue;
    try {
      if (spec.keys.length === 1) {
        for (const keys of chunk(inserted)) {
          const { data, error } = await client
            .from(spec.table)
            .delete()
            .in(spec.keys[0], keys)
            .select(spec.keys[0]);
          if (error) throw new Error(error.message);
          removed += ((data ?? []) as unknown[]).length;
        }
      } else {
        // Composite primary key: delete exactly the rows this run inserted via
        // an explicit match per row (small row counts, rollback path only).
        const rowByKey = new Map(spec.rows.map((row) => [rowKey(row, spec.keys), row]));
        for (const key of inserted) {
          const row = rowByKey.get(key);
          if (!row) continue;
          const match: Record<string, unknown> = {};
          for (const column of spec.keys) match[column] = row[column];
          const { data, error } = await client
            .from(spec.table)
            .delete()
            .match(match)
            .select(spec.keys[0]);
          if (error) throw new Error(error.message);
          removed += ((data ?? []) as unknown[]).length;
        }
      }
    } catch (error) {
      errors.push(`${spec.table} 回滚删除失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { removed, errors };
}

/**
 * Apply the plan. On failure, best-effort rollback removes rows that did not
 * exist before this run (by primary key diff); rows that only got updated are
 * not reverted, because the schema has no import-batch column on data tables.
 */
export async function applyPlan(plan: ImportPlan): Promise<ApplyOutcome> {
  const credentials = resolveCredentials();
  const secrets = [credentials.key];
  let client: ServiceClient | null = null;
  const batchesWritten: { table: string; rows: number }[] = [];
  const specs = tableSpecs(plan);
  let existing: Map<string, Set<string>> | null = null;
  let rollbackAttempted = false;
  let removedRows = 0;
  const rollbackErrors: string[] = [];
  const notes: string[] = [
    `service 凭据来源：${credentials.keyVariable}（值不落盘、不打印）。`,
    "schema 没有 batch_id 列：失败回滚按导入前主键快照删除“仅本次新增”的行，不还原被更新的既有行；复合主键表无法按批次精确回滚。"
  ];

  try {
    client = await createServiceClient(credentials.url, credentials.key);
    existing = await loadExistingKeys(client, specs);
    await startBatch(client, plan);
    for (const spec of specs) {
      const rows = await upsertBatchTable(client, spec);
      batchesWritten.push({ table: spec.table, rows });
    }
    await finishBatch(client, plan, "succeeded", null);

    const actualCounts: Record<string, number | null> = {};
    for (const spec of specs) actualCounts[spec.table] = await countRows(client, spec.table);
    actualCounts.app_import_batches = await countRows(client, "app_import_batches");

    return {
      status: "succeeded",
      batch_id: plan.batchId,
      batches_written: batchesWritten,
      actual_counts: actualCounts,
      rollback: { attempted: false, removed_rows: 0, errors: [] },
      error_code: null,
      error_message: null,
      notes: [
        ...notes,
        `需人工核对（非致命）：unified 319 来源中的 34 份原件 storage_path=NULL；13 个来源的文件哈希来自变体元数据。`
      ]
    };
  } catch (error) {
    rollbackAttempted = true;
    const reason = error instanceof Error ? error.message : String(error);
    const message = sanitize(reason, secrets);
    if (client && existing) {
      const result = await rollbackInsertedRows(client, specs, existing);
      removedRows = result.removed;
      rollbackErrors.push(...result.errors.map((item) => sanitize(item, secrets)));
    }
    const rolledBack = rollbackErrors.length === 0;
    if (client) {
      try {
        await finishBatch(
          client,
          plan,
          rolledBack ? "rolled_back" : "failed",
          rolledBack ? "apply_failed_rolled_back" : "apply_failed_partial_rollback"
        );
      } catch (batchError) {
        rollbackErrors.push(
          sanitize(
            `app_import_batches 状态更新失败：${batchError instanceof Error ? batchError.message : String(batchError)}`,
            secrets
          )
        );
      }
    }
    return {
      status: rollbackErrors.length === 0 ? "rolled_back" : "failed",
      batch_id: plan.batchId,
      batches_written: batchesWritten,
      actual_counts: {},
      rollback: { attempted: rollbackAttempted, removed_rows: removedRows, errors: rollbackErrors },
      error_code: "apply_failed",
      error_message: message,
      notes
    };
  }
}
