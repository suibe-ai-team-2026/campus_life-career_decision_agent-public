import { describe, expect, it } from "vitest";
import { emptyProgress, migrateProgress } from "@/lib/local-progress/schema";

describe("local progress migration", () => {
  it("parses the current schema", () => {
    const progress = emptyProgress();
    const migrated = migrateProgress(progress);
    expect(migrated.reset).toBe(false);
    expect(migrated.progress.favorites).toEqual([]);
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
