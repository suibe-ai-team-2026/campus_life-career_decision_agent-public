import type { PostgrestError } from "@supabase/supabase-js";
import type { ErrorCode } from "@/lib/contracts/common";
import { jsonError } from "./respond";

/** Map PostgREST/RPC errors to our public error codes without leaking SQL text. */
export function mapDbError(error: PostgrestError | null): { code: ErrorCode; message: string } {
  if (!error) return { code: "internal_error", message: "服务暂时不可用" };
  const raw = `${error.message ?? ""} ${error.details ?? ""}`;
  if (raw.includes("authentication_required")) {
    return { code: "authentication_required", message: "请先登录后再操作" };
  }
  if (raw.includes("idempotency_conflict")) {
    return { code: "idempotency_conflict", message: "同一幂等键对应了不同的请求内容，请刷新后重试" };
  }
  if (raw.includes("version_conflict")) {
    return { code: "version_conflict", message: "数据版本已变化，请刷新后重试" };
  }
  if (raw.includes("resource_not_found")) {
    return { code: "resource_not_found", message: "资源不存在或无权访问" };
  }
  if (raw.includes("stale_lease")) {
    return { code: "version_conflict", message: "任务已被新的 worker 接管" };
  }
  if (raw.includes("bad_request")) {
    return { code: "bad_request", message: "请求不合法" };
  }
  return { code: "internal_error", message: "数据库操作失败" };
}

export function dbErrorResponse(error: PostgrestError | null) {
  const mapped = mapDbError(error);
  return jsonError(mapped.code, mapped.message);
}
