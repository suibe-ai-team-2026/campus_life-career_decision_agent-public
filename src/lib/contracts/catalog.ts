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
    /** null 表示该方向的精确同专业覆盖尚未逐格计算，不展示全库数字。 */
    exact_major_records: z.number().int().nonnegative().nullable(),
    /** null 表示官方记录尚未按方向完成归属，不能把全库计数复制给每张卡。 */
    official_records: z.number().int().nonnegative().nullable(),
    job_requirements: z.number().int().nonnegative(),
    label: z.string()
  }),
  source_ids: z.array(z.string()).default([])
});
export type DirectionCard = z.infer<typeof DirectionCardSchema>;

export const DirectionsResponseSchema = z.object({
  mode: z.enum(["seed", "database"]).optional(),
  category_version: z.string(),
  disclaimer: z.string(),
  directions: z.array(DirectionCardSchema)
});

/* ------------------------------------------------------------------ */
/* 职业探索自我画像问卷（短版）                                        */
/* ------------------------------------------------------------------ */

/**
 * 问卷分区。顺序即呈现顺序；`dimensions` 用同一组 key 存放分区标题与说明。
 * 由 `docs/career-assessment-questionnaire` 的评审稿（v0.1）确定。
 */
export const ASSESSMENT_SECTIONS = [
  "interest",
  "values",
  "ability",
  "work_style",
  "readiness",
  "experience"
] as const;
export const AssessmentSectionSchema = z.enum(ASSESSMENT_SECTIONS);
export type AssessmentSection = z.infer<typeof AssessmentSectionSchema>;

export const ASSESSMENT_QUESTION_KINDS = ["likert", "rank", "single", "text"] as const;
export const AssessmentQuestionKindSchema = z.enum(ASSESSMENT_QUESTION_KINDS);
export type AssessmentQuestionKind = z.infer<typeof AssessmentQuestionKindSchema>;

/**
 * `value` 可能是 1–5 的数字（Likert / 准备度单题）或字符串 id（价值排序、
 * 工作方式单题）。文本题没有选项。
 */
export const AssessmentOptionSchema = z.object({
  value: z.union([z.number().int().min(1).max(5), z.string().min(1).max(80)]),
  label: z.string().min(1).max(240)
});
export type AssessmentOption = z.infer<typeof AssessmentOptionSchema>;

export const AssessmentQuestionSchema = z.object({
  question_id: z.string().min(1).max(40),
  section: AssessmentSectionSchema,
  /** 计分/聚合键，例如 interest_r、ability_data、readiness。文本题为 experience。 */
  dimension: z.string().min(1).max(60),
  prompt: z.string().min(1).max(600),
  kind: AssessmentQuestionKindSchema.default("likert"),
  options: z.array(AssessmentOptionSchema).default([]),
  /** rank 题最多可选几项（按顺序记录，不换算为 1–5 分）。 */
  max_selections: z.number().int().min(1).max(6).optional(),
  reverse: z.boolean().default(false),
  optional: z.boolean().default(false),
  hint: z.string().max(400).optional(),
  /** 经历补充题可勾选的能力标签（ability_* 维度键）。 */
  evidence_tags: z.array(z.string().min(1).max(60)).optional()
});
export type AssessmentQuestion = z.infer<typeof AssessmentQuestionSchema>;

export const AssessmentSchema = z.object({
  version: z.string(),
  title: z.string(),
  disclaimer: z.string(),
  methodology_sources: z.array(z.string()),
  /** key 为分区 id，供 UI 展示标题与说明。 */
  dimensions: z.record(z.string(), z.object({ title: z.string(), description: z.string() })),
  questions: z.array(AssessmentQuestionSchema).min(1).max(40),
  reverse_scored: z.array(z.string()).default([])
});
export type Assessment = z.infer<typeof AssessmentSchema>;

export type DirectionsResponse = z.infer<typeof DirectionsResponseSchema>;
