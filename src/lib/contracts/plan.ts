import { z } from "zod";
import { DirectionIdSchema } from "./common";
import { CitationSchema } from "./run";

export const PlanStatusSchema = z.enum(["ok", "partial", "data_unavailable", "unsupported_direction", "invalid_profile"]);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const TimeWindowSchema = z.enum(["current_term", "next_term", "later"]);
export type TimeWindow = z.infer<typeof TimeWindowSchema>;

export const EffortBasisSchema = z.enum(["official_requirement", "team_estimate", "user_estimate", "unknown"]);
export type EffortBasis = z.infer<typeof EffortBasisSchema>;

export const PlanActionSchema = z.object({
  action_id: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  direction_id: DirectionIdSchema,
  window: TimeWindowSchema,
  effort: z.object({
    hours: z.number().positive().nullable(),
    basis: EffortBasisSchema,
    note: z.string().max(300).optional()
  }),
  prerequisites: z.array(z.string().max(300)).default([]),
  evidence_ids: z.array(z.string()).default([]),
  rule_id: z.string().nullable().optional(),
  rules_version: z.string(),
  status: z.enum(["suggested", "pending_verification", "verified", "user_modified"]),
  user_adjusted: z.boolean().default(false)
});
export type PlanAction = z.infer<typeof PlanActionSchema>;

export const PlanCourseSchema = z.object({
  course_id: z.string(),
  title: z.string(),
  credits: z.number().nullable(),
  offered_terms: z.array(z.string()).default([]),
  prerequisites: z.array(z.string()).default([]),
  verification_status: z.string()
});

export const PlanCompetitionSchema = z.object({
  competition_id: z.string(),
  title: z.string(),
  window: z.string().nullable(),
  verification_status: z.string()
});

export const PlanGapSchema = z.object({
  code: z.string(),
  message: z.string(),
  module: z.enum(["courses", "competitions", "credits", "evidence", "profile"]).optional()
});

export const PlanResultSchema = z.object({
  status: PlanStatusSchema,
  rules_version: z.string(),
  profile_version: z.number().int(),
  direction_id: DirectionIdSchema,
  actions: z.array(PlanActionSchema),
  courses: z.array(PlanCourseSchema),
  competitions: z.array(PlanCompetitionSchema).default([]),
  credits: z.number().nullable(),
  gaps: z.array(PlanGapSchema),
  evidence: z.array(CitationSchema),
  explanation: z.string().nullable(),
  warnings: z.array(z.string()).default([])
});
export type PlanResult = z.infer<typeof PlanResultSchema>;

export const PlanVersionSchema = z.object({
  version_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  version: z.number().int().positive(),
  profile_version: z.number().int(),
  rules_version: z.string(),
  corpus_version: z.string().nullable(),
  embedding_profile_id: z.string().nullable(),
  status: z.string(),
  actions: z.array(PlanActionSchema),
  user_overrides: z.record(z.string(), z.unknown()).default({}),
  warnings: z.array(z.string()).default([]),
  result: PlanResultSchema.nullable().optional(),
  created_at: z.string()
});
export type PlanVersion = z.infer<typeof PlanVersionSchema>;

export const PlanSchema = z.object({
  plan_id: z.string().uuid(),
  profile_id: z.string().uuid(),
  direction_id: DirectionIdSchema,
  current_version_id: z.string().uuid().nullable(),
  versions: z.array(PlanVersionSchema)
});
export type Plan = z.infer<typeof PlanSchema>;

export const ActionPatchSchema = z.object({
  expected_version: z.number().int().positive(),
  user_overrides: z
    .object({
      title: z.string().max(200).optional(),
      window: TimeWindowSchema.optional(),
      effort_hours: z.number().positive().max(2000).nullable().optional(),
      done: z.boolean().optional(),
      note: z.string().max(500).optional()
    })
    .strict()
});
