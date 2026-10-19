import { z } from "zod";
import { DirectionIdSchema } from "./common";

export const ExplorationStatusSchema = z.enum(["completed", "skipped"]);
export type ExplorationStatus = z.infer<typeof ExplorationStatusSchema>;

export const AnswersSchema = z.record(z.string().min(1).max(40), z.number().int().min(1).max(5));
export type Answers = z.infer<typeof AnswersSchema>;

export const ScoresSchema = z.record(z.string().min(1).max(40), z.number().min(0));
export type Scores = z.infer<typeof ScoresSchema>;

export const ProfileInputSchema = z.object({
  school: z.string().trim().min(2).max(80),
  major: z.string().trim().min(2).max(120),
  enrollment_year: z.number().int().min(2010).max(2035),
  current_term: z.string().trim().min(2).max(20),
  assessment_version: z.string().trim().min(1).max(40),
  exploration_status: ExplorationStatusSchema,
  answers: AnswersSchema.default({}),
  scores: ScoresSchema.default({}),
  preferences: z
    .object({
      weekly_hours: z.number().int().min(1).max(80).optional(),
      monthly_budget_cny: z.number().int().min(0).max(10000).optional(),
      notes: z.string().trim().max(500).optional()
    })
    .default({})
});
export type ProfileInput = z.infer<typeof ProfileInputSchema>;

export const ProfileSchema = ProfileInputSchema.extend({
  profile_id: z.string().uuid(),
  version: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string()
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfilePatchSchema = z.object({
  expected_version: z.number().int().positive(),
  profile: ProfileInputSchema
});
