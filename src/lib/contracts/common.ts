import { z } from "zod";

/** Stable product navigation categories. Not an official school major taxonomy. */
export const DIRECTION_IDS = [
  "trade_supply_chain",
  "cross_border_business",
  "finance_accounting",
  "data_business",
  "public_service",
  "further_study"
] as const;

export const DirectionIdSchema = z.enum(DIRECTION_IDS);
export type DirectionId = z.infer<typeof DirectionIdSchema>;

export const RUN_KINDS = [
  "assessment_explain",
  "compare",
  "plan",
  "ask",
  "export",
  "ingest"
] as const;
export const RunKindSchema = z.enum(RUN_KINDS);
export type RunKind = z.infer<typeof RunKindSchema>;

export const RUN_STATUSES = [
  "queued",
  "running",
  "parsing",
  "embedding",
  "retrieving",
  "planning",
  "rendering",
  "validating",
  "succeeded",
  "failed",
  "cancel_requested",
  "cancelled"
] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RUN_STATUSES>;

export const RUN_EVENT_TYPES = [
  "queued",
  "running",
  "parsing",
  "embedding",
  "retrieving",
  "planning",
  "rendering",
  "validating",
  "succeeded",
  "failed",
  "cancel_requested",
  "cancelled",
  "progress"
] as const;
export const RunEventTypeSchema = z.enum(RUN_EVENT_TYPES);

export const ERROR_CODES = [
  "authentication_required",
  "resource_not_found",
  "version_conflict",
  "idempotency_conflict",
  "upload_too_large",
  "invalid_profile",
  "unsupported_direction",
  "rate_limited",
  "budget_exceeded",
  "model_auth_failed",
  "model_quota_exceeded",
  "model_timeout",
  "model_unavailable",
  "bad_request",
  "internal_error"
] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const HTTP_STATUS_BY_ERROR: Record<ErrorCode, number> = {
  authentication_required: 401,
  resource_not_found: 404,
  version_conflict: 409,
  idempotency_conflict: 409,
  upload_too_large: 413,
  invalid_profile: 422,
  unsupported_direction: 422,
  rate_limited: 429,
  budget_exceeded: 429,
  model_auth_failed: 502,
  model_quota_exceeded: 502,
  model_timeout: 504,
  model_unavailable: 503,
  bad_request: 400,
  internal_error: 500
};

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    request_id: z.string(),
    details: z.unknown().optional()
  })
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const SchoolSchema = z.string().trim().min(2).max(80);
export const MajorSchema = z.string().trim().min(2).max(120);
export const TermSchema = z.string().regex(/^\d{4}-(春|秋|春季|秋季|fall|spring)$/i).or(z.string().trim().min(2).max(20));
