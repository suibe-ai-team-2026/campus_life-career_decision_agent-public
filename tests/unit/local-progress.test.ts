import { describe, expect, it } from "vitest";
import { emptyProgress, migrateProgress } from "@/lib/local-progress/schema";

describe("local progress migration", () => {
  it("parses the current v2 schema", () => {
    const progress = emptyProgress();
    const migrated = migrateProgress(progress);
    expect(migrated.reset).toBe(false);
    expect(migrated.answersReset).toBe(false);
    expect(migrated.progress.favorites).toEqual([]);
    expect(migrated.progress.backup_direction).toBeNull();
    expect(migrated.progress.profile.assessment_version).toBeNull();
  });

  it("migrates v1 progress by keeping identity/selection fields and clearing old quiz answers", () => {
    const migrated = migrateProgress({
      schema_version: 1,
      profile: {
        school: "上海对外经贸大学",
        major: "国际经济与贸易",
        enrollment_year: 2024,
        current_term: "2026-秋",
        answers: { i1: 4, a1: 3 },
        skipped: false,
        completed_at: "2026-10-20T00:00:00.000Z"
      },
      favorites: ["finance_accounting", "data_business"],
      provisional_direction: "finance_accounting",
      reason_summary: "想先核对财会方向",
      revisit_on: "2026-11-24",
      plan_id: null,
      plan_version_id: null,
      exported_at: null,
      updated_at: "2026-10-20T00:00:00.000Z"
    });
    expect(migrated.reset).toBe(false);
    expect(migrated.answersReset).toBe(true);
    expect(migrated.progress.schema_version).toBe(2);
    expect(migrated.progress.profile.school).toBe("上海对外经贸大学");
    expect(migrated.progress.profile.answers).toEqual({});
    expect(migrated.progress.profile.completed_at).toBeNull();
    expect(migrated.progress.favorites).toEqual(["finance_accounting", "data_business"]);
    expect(migrated.progress.provisional_direction).toBe("finance_accounting");
    expect(migrated.progress.reason_summary).toBe("想先核对财会方向");
    expect(migrated.progress.backup_direction).toBeNull();
  });

  it("discards unknown schema versions instead of half-reading them", () => {
    const migrated = migrateProgress({ schema_version: 99, favorites: ["finance_accounting"] });
    expect(migrated.reset).toBe(true);
    expect(migrated.progress.favorites).toEqual([]);
  });

  it("discards malformed payloads", () => {
    expect(migrateProgress({ schema_version: 1, favorites: "not-an-array" }).reset).toBe(true);
    expect(migrateProgress(null).reset).toBe(true);
  });
});
