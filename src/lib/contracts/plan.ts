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

export const PlanEvidenceCourseHintSchema = z.object({
  name: z.string().min(1).max(200),
  citation_no: z.number().int().positive(),
  note: z.string().max(300).default("")
});
export const PlanEvidenceCompetitionHintSchema = z.object({
  name: z.string().min(1).max(200),
  citation_no: z.number().int().positive(),
  note: z.string().max(300).default("")
});
export const PlanAnalysisSchema = z.object({
  overview: z.string(),
  match: z.string(),
  action_rationale: z.array(z.string()).default([]),
  evidence_courses: z.array(PlanEvidenceCourseHintSchema).default([]),
  evidence_competitions: z.array(PlanEvidenceCompetitionHintSchema).default([]),
  risks: z.array(z.string()).default([]),
  next_steps: z.array(z.string()).default([]),
  citation_numbers: z.array(z.number().int().positive()).default([]),
  boundary_note: z.string().default("")
});
export type PlanAnalysis = z.infer<typeof PlanAnalysisSchema>;

export const VerificationLabelSchema = z.enum([
  "known",
  "official_lead",
  "external_reference",
  "pending_verification",
  "data_missing"
]);
export type VerificationLabel = z.infer<typeof VerificationLabelSchema>;

export const PlanPathwaySchema = z.object({
  primary: z.string(),
  label: z.string(),
  rationale: z.array(z.string()).default([]),
  alternatives: z.array(z.string()).default([]),
  excluded: z.array(z.string()).default([])
});
export type PlanPathway = z.infer<typeof PlanPathwaySchema>;

export const SourceFreshnessSchema = z.object({
  verification_status: VerificationLabelSchema,
  last_checked_at: z.string().nullable().default(null),
  valid_until: z.string().nullable().default(null),
  update_frequency: z.string(),
  source_url: z.string().url().nullable().default(null)
});
export type SourceFreshness = z.infer<typeof SourceFreshnessSchema>;

export const PlanLeadSchema = z.object({
  lead_id: z.string(),
  title: z.string(),
  description: z.string(),
  why: z.string(),
  skill_tags: z.array(z.string()).default([]),
  verification_status: VerificationLabelSchema,
  source_label: z.string(),
  source_url: z.string().url().nullable().default(null),
  freshness: SourceFreshnessSchema.nullable().optional()
});
export type PlanLead = z.infer<typeof PlanLeadSchema>;

export const PlanRoadmapStageSchema = z.object({
  stage: z.string(),
  focus: z.string(),
  actions: z.array(z.string()).default([])
});
export type PlanRoadmapStage = z.infer<typeof PlanRoadmapStageSchema>;

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
  analysis: PlanAnalysisSchema.nullable().optional(),
  pathway: PlanPathwaySchema.nullable().optional(),
  course_leads: z.array(PlanLeadSchema).default([]),
  competition_leads: z.array(PlanLeadSchema).default([]),
  campus_resources: z.array(PlanLeadSchema).default([]),
  roadmap: z.array(PlanRoadmapStageSchema).default([]),
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
