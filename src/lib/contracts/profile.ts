import { z } from "zod";
import { DIRECTION_IDS } from "./common";

export const ExplorationStatusSchema = z.enum(["completed", "skipped"]);
export type ExplorationStatus = z.infer<typeof ExplorationStatusSchema>;

/**
 * 单项作答值：
 * - `number`：Likert / 准备度单题的 1–5 分；
 * - `string[]`：价值排序（按重要程度）或单题选项 id；
 * - `string`：折线之外的短文本选项 id（保留兼容旧数据）；
 * - `{ text, tags }`：可选经历补充，tags 为能力维度键。
 */
export const AnswerValueSchema = z.union([
  z.number().int().min(1).max(5),
  // 允许空数组：取消排序选择时可能是空状态，加载时按「未作答」处理，不因此重置本地进度。
  z.array(z.string().min(1).max(80)).max(10),
  z.string().min(1).max(1000),
  z
    // 允许空对象：清空经历补充时按「未作答」处理。
    .object({
      text: z.string().trim().max(300).default(""),
      tags: z.array(z.string().min(1).max(60)).max(6).default([])
    })
]);
export type AnswerValue = z.infer<typeof AnswerValueSchema>;

export const AnswersSchema = z.record(z.string().min(1).max(40), AnswerValueSchema);
export type Answers = z.infer<typeof AnswersSchema>;

/** 画像分数只保存可计算的数值信号；未知维度直接缺省，不写 0。 */
export const ScoresSchema = z.record(z.string().min(1).max(40), z.number());
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
      notes: z.string().trim().max(500).optional(),
      pathway: z
        .object({
          primary: z
            .enum([
              "undergraduate_employment",
              "domestic_postgraduate",
              "overseas_study",
              "public_exam",
              "undetermined"
            ])
            .default("undetermined"),
          alternatives: z
            .array(
              z.enum([
                "undergraduate_employment",
                "domestic_postgraduate",
                "overseas_study",
                "public_exam",
                "undetermined"
              ])
            )
            .max(4)
            .default([]),
          excluded_directions: z.array(z.enum(DIRECTION_IDS)).max(DIRECTION_IDS.length).default([]),
          excluded_sectors: z
            .array(z.enum(["public_sector", "finance", "data", "further_study", "international_business"]))
            .max(8)
            .default([]),
          target_cities: z.array(z.string().trim().min(1).max(40)).max(5).default([]),
          practice_orientation: z.enum(["practice", "research", "undecided"]).default("undecided"),
          accepts_cross_major: z.boolean().default(true),
          accepts_certificate: z.boolean().default(true),
          accepts_competition: z.boolean().default(true),
          accepts_long_internship: z.boolean().default(true)
        })
        .default({
          primary: "undetermined",
          alternatives: [],
          excluded_directions: [],
          excluded_sectors: [],
          target_cities: [],
          practice_orientation: "undecided",
          accepts_cross_major: true,
          accepts_certificate: true,
          accepts_competition: true,
          accepts_long_internship: true
        })
    })
    .default({
      pathway: {
        primary: "undetermined",
        alternatives: [],
        excluded_directions: [],
        excluded_sectors: [],
        target_cities: [],
        practice_orientation: "undecided",
        accepts_cross_major: true,
        accepts_certificate: true,
        accepts_competition: true,
        accepts_long_internship: true
      }
    })
});
export type ProfileInput = z.infer<typeof ProfileInputSchema>;
export type PathwayPreference = ProfileInput["preferences"]["pathway"];

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
