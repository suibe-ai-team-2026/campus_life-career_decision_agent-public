import { z } from "zod";
import { DirectionIdSchema } from "@/lib/contracts/common";
import { AnswersSchema } from "@/lib/contracts/profile";

export const LOCAL_PROGRESS_SCHEMA_VERSION = 1 as const;

export const LocalProgressV1Schema = z.object({
  schema_version: z.literal(LOCAL_PROGRESS_SCHEMA_VERSION),
  profile: z
    .object({
      school: z.string().max(80).default(""),
      major: z.string().max(120).default(""),
      enrollment_year: z.number().int().min(2010).max(2035).nullable().default(null),
      current_term: z.string().max(20).default(""),
      answers: AnswersSchema.default({}),
      skipped: z.boolean().default(false),
      completed_at: z.string().nullable().default(null)
    })
    .default({
      school: "",
      major: "",
      enrollment_year: null,
      current_term: "",
      answers: {},
      skipped: false,
      completed_at: null
    }),
  favorites: z.array(DirectionIdSchema).max(6).default([]),
  provisional_direction: DirectionIdSchema.nullable().default(null),
  reason_summary: z.string().max(1000).default(""),
  revisit_on: z.string().max(20).nullable().default(null),
  plan_id: z.string().uuid().nullable().default(null),
  plan_version_id: z.string().uuid().nullable().default(null),
  exported_at: z.string().nullable().default(null),
  updated_at: z.string()
});
export type LocalProgressV1 = z.infer<typeof LocalProgressV1Schema>;

export function emptyProgress(): LocalProgressV1 {
  return LocalProgressV1Schema.parse({
    schema_version: LOCAL_PROGRESS_SCHEMA_VERSION,
    updated_at: new Date().toISOString()
  });
}

/**
 * Versioned migration. Unknown or broken payloads are discarded rather than
 * silently half-read; the caller must tell the user that progress was reset.
 */
export function migrateProgress(raw: unknown): { progress: LocalProgressV1; reset: boolean } {
  if (!raw || typeof raw !== "object") return { progress: emptyProgress(), reset: true };
  const record = raw as Record<string, unknown>;
  if (record.schema_version === LOCAL_PROGRESS_SCHEMA_VERSION) {
    const parsed = LocalProgressV1Schema.safeParse(record);
    if (parsed.success) return { progress: parsed.data, reset: false };
  }
  return { progress: emptyProgress(), reset: true };
}
