import { z } from "zod";
import { DirectionIdSchema } from "./common";

export const DirectionCardSchema = z.object({
  direction_id: DirectionIdSchema,
  title: z.string(),
  short_title: z.string(),
  summary: z.string(),
  work_content: z.array(z.string()).default([]),
  verified_skills: z.array(z.string()).default([]),
  preparation_cost: z.string(),
  applicability: z.string(),
  data_gaps: z.array(z.string()).default([]),
  coverage: z.object({
    exact_major_records: z.number().int().nonnegative(),
    official_records: z.number().int().nonnegative(),
    job_requirements: z.number().int().nonnegative(),
    label: z.string()
  }),
  source_ids: z.array(z.string()).default([])
});
export type DirectionCard = z.infer<typeof DirectionCardSchema>;

export const DirectionsResponseSchema = z.object({
  category_version: z.string(),
  disclaimer: z.string(),
  directions: z.array(DirectionCardSchema)
});

export const AssessmentQuestionSchema = z.object({
  question_id: z.string(),
  dimension: z.enum(["interest", "ability", "decision"]),
  prompt: z.string(),
  options: z.array(
    z.object({
      value: z.number().int().min(1).max(5),
      label: z.string()
    })
  ),
  reverse: z.boolean().default(false),
  optional: z.boolean().default(false)
});
export type AssessmentQuestion = z.infer<typeof AssessmentQuestionSchema>;

export const AssessmentSchema = z.object({
  version: z.string(),
  title: z.string(),
  disclaimer: z.string(),
  methodology_sources: z.array(z.string()),
  dimensions: z.record(z.string(), z.object({ title: z.string(), description: z.string() })),
  questions: z.array(AssessmentQuestionSchema).min(8).max(14),
  reverse_scored: z.array(z.string()).default([])
});
export type Assessment = z.infer<typeof AssessmentSchema>;
