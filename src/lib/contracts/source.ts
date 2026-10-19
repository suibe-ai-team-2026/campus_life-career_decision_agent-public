import { z } from "zod";

export const SourceSchema = z.object({
  source_id: z.string(),
  title: z.string(),
  publisher: z.string().nullable().optional(),
  canonical_url: z.string().nullable().optional(),
  source_scope: z.string().nullable().optional(),
  visibility: z.enum(["approved_reference", "private"]),
  verification_status: z.string(),
  versions: z
    .array(
      z.object({
        source_version_id: z.string().uuid(),
        published_at: z.string().nullable().optional(),
        retrieved_at: z.string().nullable().optional(),
        extraction_status: z.string(),
        parser_version: z.string().nullable().optional()
      })
    )
    .default([])
});
export type Source = z.infer<typeof SourceSchema>;

export const UploadIntentSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  mime_type: z.enum([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown"
  ]),
  bytes: z.number().int().positive().max(20 * 1024 * 1024)
});
export type UploadIntent = z.infer<typeof UploadIntentSchema>;

export const UploadCompleteSchema = z.object({
  source_id: z.string().regex(/^user_[0-9a-f-]{8,}$/),
  source_version_id: z.string().uuid(),
  declared_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  title: z.string().trim().min(1).max(200),
  idempotency_key: z.string().uuid()
});

export const ArtifactSchema = z.object({
  artifact_id: z.string().uuid(),
  kind: z.enum(["plan_pdf", "plan_json", "citation_snapshot"]),
  bytes: z.number().int().nonnegative(),
  sha256: z.string(),
  created_at: z.string(),
  expires_at: z.string().nullable().optional()
});
