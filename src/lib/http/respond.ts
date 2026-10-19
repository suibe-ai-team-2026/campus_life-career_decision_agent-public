import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HTTP_STATUS_BY_ERROR, type ErrorCode } from "@/lib/contracts/common";

export function requestId(): string {
  return `req_${crypto.randomUUID()}`;
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ request_id: requestId(), data }, init);
}

export function jsonError(code: ErrorCode, message: string, details?: unknown): NextResponse {
  const rid = requestId();
  return NextResponse.json(
    { error: { code, message, request_id: rid, ...(details === undefined ? {} : { details }) } },
    { status: HTTP_STATUS_BY_ERROR[code] }
  );
}

export function zodError(err: ZodError): NextResponse {
  return jsonError("bad_request", "请求参数不合法", err.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
}

export function errorFromUnknown(err: unknown): NextResponse {
  // Never leak upstream SQL/driver messages or secrets to the browser.
  console.error("[bff] unhandled", err instanceof Error ? err.message : typeof err);
  return jsonError("internal_error", "服务暂时不可用，请稍后重试");
}
