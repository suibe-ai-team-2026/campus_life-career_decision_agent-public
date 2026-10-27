import { z } from "zod";
import { DirectionIdSchema } from "@/lib/contracts/common";
import { AnswersSchema } from "@/lib/contracts/profile";

export const LOCAL_PROGRESS_SCHEMA_VERSION = 2 as const;

/**
 * v2 变更（2026-10-27）：
 * - 问卷从 10 题三维轻测换成 16 项职业探索自我画像（PR #20 评审稿）；
 * - `profile.answers` 支持排序数组、单题选项与经历补充对象；
 * - 新增 `profile.assessment_version`，题库版本变化时可判断旧答案是否过期；
 * - 新增 `backup_direction`，支持「主方向 + 备选方向」。
 */
export const LocalProgressSchema = z.object({
  schema_version: z.literal(LOCAL_PROGRESS_SCHEMA_VERSION),
  profile: z
    .object({
      school: z.string().max(80).default(""),
      major: z.string().max(120).default(""),
      enrollment_year: z.number().int().min(2010).max(2035).nullable().default(null),
      current_term: z.string().max(20).default(""),
      answers: AnswersSchema.default({}),
      assessment_version: z.string().max(40).nullable().default(null),
      skipped: z.boolean().default(false),
      completed_at: z.string().nullable().default(null)
    })
    .default({
      school: "",
      major: "",
      enrollment_year: null,
      current_term: "",
      answers: {},
      assessment_version: null,
      skipped: false,
      completed_at: null
    }),
  favorites: z.array(DirectionIdSchema).max(6).default([]),
  provisional_direction: DirectionIdSchema.nullable().default(null),
  backup_direction: DirectionIdSchema.nullable().default(null),
  reason_summary: z.string().max(1000).default(""),
  revisit_on: z.string().max(20).nullable().default(null),
  plan_id: z.string().uuid().nullable().default(null),
  plan_version_id: z.string().uuid().nullable().default(null),
  exported_at: z.string().nullable().default(null),
  updated_at: z.string()
});
export type LocalProgress = z.infer<typeof LocalProgressSchema>;
/** @deprecated 兼容旧命名；等价于 `LocalProgress`。 */
export type LocalProgressV1 = LocalProgress;

export function emptyProgress(): LocalProgress {
  return LocalProgressSchema.parse({
    schema_version: LOCAL_PROGRESS_SCHEMA_VERSION,
    updated_at: new Date().toISOString()
  });
}

/**
 * v1（10 题轻测）的宽松读取结构。旧答案的 question_id 与新题库不兼容，
 * 迁移时丢弃答案并把 `completed_at` 清空，其余本地进度保留。
 */
const LegacyProgressV1Schema = z.object({
  schema_version: z.literal(1),
  profile: z
    .object({
      school: z.string().max(80).default(""),
      major: z.string().max(120).default(""),
      enrollment_year: z.number().int().min(2010).max(2035).nullable().default(null),
      current_term: z.string().max(20).default(""),
      skipped: z.boolean().default(false)
    })
    .optional(),
  favorites: z.array(DirectionIdSchema).max(6).default([]),
  provisional_direction: DirectionIdSchema.nullable().default(null),
  reason_summary: z.string().max(1000).default(""),
  revisit_on: z.string().max(20).nullable().default(null),
  plan_id: z.string().uuid().nullable().default(null),
  plan_version_id: z.string().uuid().nullable().default(null),
  exported_at: z.string().nullable().default(null),
  updated_at: z.string().default("")
});

/**
 * Versioned migration. Unknown or broken payloads are discarded rather than
 * silently half-read; the caller must tell the user that progress was reset.
 */
export function migrateProgress(raw: unknown): {
  progress: LocalProgress;
  reset: boolean;
  /** v1 → v2 时旧问卷答案被清空（题库版本已变化）。 */
  answersReset: boolean;
} {
  if (!raw || typeof raw !== "object") {
    return { progress: emptyProgress(), reset: true, answersReset: false };
  }
  const record = raw as Record<string, unknown>;
  if (record.schema_version === LOCAL_PROGRESS_SCHEMA_VERSION) {
    const parsed = LocalProgressSchema.safeParse(record);
    if (parsed.success) return { progress: parsed.data, reset: false, answersReset: false };
    return { progress: emptyProgress(), reset: true, answersReset: false };
  }
  if (record.schema_version === 1) {
    const legacy = LegacyProgressV1Schema.safeParse(record);
    if (!legacy.success) return { progress: emptyProgress(), reset: true, answersReset: false };
    const old = legacy.data;
    const progress = LocalProgressSchema.parse({
      schema_version: LOCAL_PROGRESS_SCHEMA_VERSION,
      profile: {
        school: old.profile?.school ?? "",
        major: old.profile?.major ?? "",
        enrollment_year: old.profile?.enrollment_year ?? null,
        current_term: old.profile?.current_term ?? "",
        answers: {},
        assessment_version: null,
        skipped: old.profile?.skipped ?? false,
        completed_at: null
      },
      favorites: old.favorites,
      provisional_direction: old.provisional_direction,
      backup_direction: null,
      reason_summary: old.reason_summary,
      revisit_on: old.revisit_on,
      plan_id: old.plan_id,
      plan_version_id: old.plan_version_id,
      exported_at: old.exported_at,
      updated_at: old.updated_at || new Date().toISOString()
    });
    return { progress, reset: false, answersReset: true };
  }
  return { progress: emptyProgress(), reset: true, answersReset: false };
}
