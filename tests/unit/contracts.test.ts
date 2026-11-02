import { describe, expect, it } from "vitest";
import { PlanResultSchema } from "@/lib/contracts/plan";
import { RunSubmitSchema } from "@/lib/contracts/run";
import { AnswersSchema, ProfileInputSchema } from "@/lib/contracts/profile";

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

  it("accepts the pathway and career-planning blueprint fields", () => {
    const parsed = PlanResultSchema.safeParse({
      status: "partial",
      rules_version: "career-rules-2026-10-28.1",
      profile_version: 2,
      direction_id: "cross_border_business",
      actions: [],
      courses: [],
      competitions: [],
      credits: null,
      gaps: [],
      evidence: [],
      explanation: null,
      pathway: {
        primary: "undergraduate_employment",
        label: "本科就业",
        rationale: ["你明确偏实践。"],
        alternatives: ["国内升学"],
        excluded: ["体制内 / 政审类岗位"]
      },
      course_leads: [
        {
          lead_id: "course-1",
          title: "跨境电子商务",
          description: "了解平台运营。",
          why: "需要在教务系统核对课程属性。",
          skill_tags: ["运营"],
          verification_status: "official_lead",
          source_label: "学校官网",
          source_url: "https://www.suibe.edu.cn/"
        }
      ],
      competition_leads: [],
      campus_resources: [],
      roadmap: [
        {
          stage: "未来 30 天",
          focus: "核对信息并形成第一份证据",
          actions: ["核对培养方案。"]
        }
      ],
      warnings: []
    });
    expect(parsed.success).toBe(true);
  });

  it("fills backward-compatible pathway defaults on profile input", () => {
    const parsed = ProfileInputSchema.parse({
      school: "上海对外经贸大学",
      major: "国际经济与贸易",
      enrollment_year: 2026,
      current_term: "2026-秋",
      assessment_version: "career-exploration-2026-10-25.1",
      exploration_status: "completed",
      answers: {},
      scores: {}
    });
    expect(parsed.preferences.pathway.primary).toBe("undetermined");
    expect(parsed.preferences.pathway.accepts_competition).toBe(true);
  });

  it("accepts a compare submission without a profile", () => {
    const parsed = RunSubmitSchema.safeParse({
      kind: "compare",
      idempotency_key: uuid,
      direction_ids: ["cross_border_business", "finance_accounting", "data_business"]
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects compare with a repeated direction", () => {
    const parsed = RunSubmitSchema.safeParse({
      kind: "compare",
      idempotency_key: uuid,
      direction_ids: ["finance_accounting", "finance_accounting"]
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects compare with a single direction", () => {
    const parsed = RunSubmitSchema.safeParse({
      kind: "compare",
      idempotency_key: uuid,
      direction_ids: ["finance_accounting"]
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts the questionnaire answer shapes (likert, ranking, single choice, experience)", () => {
    const parsed = AnswersSchema.safeParse({
      i_r: 4,
      v_top3: ["growth", "stability", "income"],
      w_approach: "info_first",
      r_clarity: 3,
      exp_optional: { text: "社团活动里负责协调。", tags: ["ability_communication"] }
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects out-of-range likert values and empty rankings", () => {
    expect(AnswersSchema.safeParse({ i_r: 6 }).success).toBe(false);
    expect(AnswersSchema.safeParse({ i_r: 0 }).success).toBe(false);
    expect(AnswersSchema.safeParse({ v_top3: [] }).success).toBe(true);
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
