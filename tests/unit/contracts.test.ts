import { describe, expect, it } from "vitest";
import { PlanResultSchema } from "@/lib/contracts/plan";
import { RunSubmitSchema } from "@/lib/contracts/run";
import { ProfileInputSchema } from "@/lib/contracts/profile";

const uuid = "3f1f9c3a-6d1e-4d4e-9a4e-2b2a7c9e1a11";

describe("API contracts", () => {
  it("rejects plan submissions without a profile", () => {
    const parsed = RunSubmitSchema.safeParse({ kind: "plan", idempotency_key: uuid, direction_id: "trade_supply_chain" });
    expect(parsed.success).toBe(false);
  });

  it("accepts a well-formed plan submission", () => {
    const parsed = RunSubmitSchema.safeParse({
      kind: "plan",
      idempotency_key: uuid,
      profile_id: uuid,
      profile_version: 2,
      direction_id: "trade_supply_chain"
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a 7th direction id", () => {
    const parsed = RunSubmitSchema.safeParse({
      kind: "plan",
      idempotency_key: uuid,
      profile_id: uuid,
      direction_id: "not_a_direction"
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts credits=null as data_unavailable", () => {
    const parsed = PlanResultSchema.safeParse({
      status: "data_unavailable",
      rules_version: "career-rules-2026-10-19.1",
      profile_version: 1,
      direction_id: "trade_supply_chain",
      actions: [],
      courses: [],
      competitions: [],
      credits: null,
      gaps: [{ code: "curriculum_unavailable", message: "尚未取得结构化培养方案" }],
      evidence: [],
      explanation: null,
      warnings: []
    });
    expect(parsed.success).toBe(true);
  });

  it("requires a versioned assessment in profile input", () => {
    const parsed = ProfileInputSchema.safeParse({
      school: "上海对外经贸大学",
      major: "国际经济与贸易",
      enrollment_year: 2025,
      current_term: "2026-秋",
      exploration_status: "completed",
      answers: {},
      scores: {}
    });
    expect(parsed.success).toBe(false);
  });
});
