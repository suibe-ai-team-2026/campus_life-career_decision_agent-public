import { z } from "zod";
import { DirectionIdSchema, RunKindSchema, RunStatusSchema } from "./common";
import { AnswersSchema, ScoresSchema } from "./profile";

export const IdempotencyKeySchema = z.string().uuid();

export const RunSubmitSchema = z
  .object({
    kind: RunKindSchema,
    idempotency_key: IdempotencyKeySchema,
    profile_id: z.string().uuid().optional(),
    profile_version: z.number().int().positive().optional(),
    direction_id: DirectionIdSchema.optional(),
    direction_ids: z.array(DirectionIdSchema).min(2).max(3).optional(),
    plan_id: z.string().uuid().optional(),
    plan_version_id: z.string().uuid().optional(),
    source_version_ids: z.array(z.string().uuid()).max(20).optional(),
    web_search: z.boolean().optional(),
    question: z.string().trim().min(2).max(1000).optional(),
    history: z
      .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(1000) }))
      .max(4)
      .optional(),
    profile: z
      .object({
        school: z.string(),
        major: z.string(),
        enrollment_year: z.number().int(),
        current_term: z.string(),
        assessment_version: z.string(),
        exploration_status: z.enum(["completed", "skipped"]),
        answers: AnswersSchema,
        scores: ScoresSchema,
        preferences: z.record(z.string(), z.unknown())
      })
      .optional()
  })
  .superRefine((value, ctx) => {
    if (value.kind === "plan" && (!value.profile_id || !value.direction_id)) {
      ctx.addIssue({ code: "custom", message: "plan 需要 profile_id 与 direction_id" });
    }
    if (value.kind === "ask" && !value.question) {
      ctx.addIssue({ code: "custom", message: "ask 需要 question" });
    }
    if (value.kind === "export" && !value.plan_id) {
      ctx.addIssue({ code: "custom", message: "export 需要 plan_id" });
    }
    if (value.kind === "compare") {
      const ids = value.direction_ids ?? (value.direction_id ? [value.direction_id] : []);
      if (ids.length < 2) {
        ctx.addIssue({ code: "custom", message: "compare 需要 2–3 个方向的对比集合", path: ["direction_ids"] });
      } else if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: "custom", message: "compare 方向不能重复", path: ["direction_ids"] });
      }
    }
  });
export type RunSubmit = z.infer<typeof RunSubmitSchema>;

export const RunSchema = z.object({
  run_id: z.string().uuid(),
  kind: RunKindSchema,
  status: RunStatusSchema,
  progress: z.number().int().min(0).max(100),
  input: z.record(z.string(), z.unknown()),
  error_code: z.string().nullable().optional(),
  result: z.unknown().nullable().optional(),
  created_at: z.string(),
  started_at: z.string().nullable().optional(),
  finished_at: z.string().nullable().optional()
});
export type Run = z.infer<typeof RunSchema>;

export const RunEventSchema = z.object({
  run_id: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  event_type: z.string(),
  safe_payload: z.record(z.string(), z.unknown()).nullable().optional(),
  created_at: z.string()
});
export type RunEvent = z.infer<typeof RunEventSchema>;

export const CitationSchema = z.object({
  citation_no: z.number().int().positive(),
  source_id: z.string(),
  source_version_id: z.string().uuid(),
  chunk_id: z.string().uuid(),
  record_id: z.string().nullable().optional(),
  title: z.string(),
  locator: z.record(z.string(), z.unknown()).default({}),
  excerpt: z.string(),
  verification_status: z.string(),
  source_scope: z.string()
});
export type Citation = z.infer<typeof CitationSchema>;
