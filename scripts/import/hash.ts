/** Deterministic hashing / stable-ID helpers shared by the import and corpus scripts. */
import { createHash } from "node:crypto";

/** SHA-256 of a string (UTF-8) or byte buffer, lowercase hex. */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Short hash prefix used inside human-readable stable ids. */
export function shortHash(input: string, length = 12): string {
  return sha256Hex(input).slice(0, length);
}

/**
 * JSON.stringify with object keys sorted recursively, so hashes are stable across
 * runs and across Node versions. Arrays keep their original order.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = sortValue(record[key]);
    return sorted;
  }
  return value;
}

/** Stable hash of a list of ids: sorted, de-duplicated, joined with newlines. */
export function hashIdSet(ids: readonly string[]): string {
  const unique = Array.from(new Set(ids)).sort();
  return sha256Hex(unique.join("\n"));
}

/** Fixed DNS namespace for UUIDv5 derivation (RFC 4122 well-known namespace). */
const UUID_NAMESPACE_DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`invalid uuid: ${uuid}`);
  return Buffer.from(hex, "hex");
}

/**
 * RFC 4122 version-5 UUID over a fixed DNS namespace. Used to derive stable
 * `app_source_versions.source_version_id` values, because the table's default
 * gen_random_uuid() would otherwise change on every import run.
 */
export function uuidv5(name: string): string {
  const namespace = uuidToBytes(UUID_NAMESPACE_DNS);
  const digest = createHash("sha1").update(namespace).update(Buffer.from(name, "utf8")).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Stable source-version id derived from source id + content hash. */
export function sourceVersionId(sourceId: string, contentSha256: string): string {
  return uuidv5(`career-pathway/source-version/${sourceId}/${contentSha256}`);
}

/** Stable chunk id for corpus lines derived from content hash. */
export function corpusChunkId(parts: readonly string[]): string {
  return `chunk_${sha256Hex(parts.join("\u0000")).slice(0, 20)}`;
}
