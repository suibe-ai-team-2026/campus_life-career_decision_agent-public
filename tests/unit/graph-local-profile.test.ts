import { describe, expect, it } from "vitest";
import { gradeLabelFor, termLabel, withLocalProfile } from "../../src/lib/graph/local-profile";
import { graphSnapshot } from "../../src/lib/graph";
import type { LocalProgress } from "../../src/lib/local-progress/schema";

const NOW = new Date("2026-11-05T12:00:00+08:00");

function progress(overrides: Partial<LocalProgress["profile"]> = {}): LocalProgress {
  return {
    schema_version: 2,
    profile: {
      school: "上海对外经贸大学",
      major: "国际经济与贸易（全英）",
      enrollment_year: 2025,
      current_term: "2026-秋",
      answers: { i_r: 5, i_i: 5, a_info: 4 },
      assessment_version: "career-explore-2026-10-27",
      skipped: false,
      completed_at: "2026-11-05T10:00:00+08:00",
      ...overrides
    },
    favorites: [],
    provisional_direction: "trade_supply_chain",
    backup_direction: null,
    reason_summary: "",
    revisit_on: null,
    plan_id: null,
    plan_version_id: null,
    exported_at: null,
    updated_at: "2026-11-05T10:00:00+08:00"
  };
}

describe("graph local profile", () => {
  it("derives grade and term labels", () => {
    expect(gradeLabelFor(2026, NOW)).toBe("大一");
    expect(gradeLabelFor(2025, NOW)).toBe("大二");
    expect(gradeLabelFor(2023, NOW)).toBe("大四");
    expect(gradeLabelFor(null, NOW)).toBe("");
    expect(termLabel("2026-秋")).toBe("2026 秋");
    expect(termLabel("2027-春")).toBe("2027 春");
    expect(termLabel("")).toBe("");
  });

  it("replaces only the me node with the visitor's latest progress", () => {
    const active = withLocalProfile(graphSnapshot, progress(), true, {
      pathwayPrimary: "undergraduate_employment",
      now: NOW
    });
    const me = active.nodes.find((node) => node.type === "me");
    expect(me?.title).toContain("国际经济与贸易（全英）");
    expect(me?.title).toContain("大二");
    expect(me?.sub).toContain("上海对外经贸大学");
    expect(me?.why).toContain("已完成 3/16 题");

    const withOptional = withLocalProfile(
      graphSnapshot,
      progress({ answers: { i_r: 5, i_i: 5, a_info: 4, exp_optional: { text: "社团经历", tags: [] } } }),
      true,
      { now: NOW }
    );
    expect(withOptional.nodes.find((node) => node.type === "me")?.why).toContain("已完成 3/16 题");
    expect(me?.why).toContain("主路线是「本科就业」");
    const profileSection = me?.wiki.sections.find((section) => section.heading === "你的画像");
    expect(profileSection?.paragraphs[0]?.text).toContain("上海对外经贸大学");
    // 其它节点保持快照原样
    const direction = active.nodes.find((node) => node.type === "direction");
    const originalDirection = graphSnapshot.nodes.find((node) => node.type === "direction");
    expect(direction?.title).toBe(originalDirection?.title);
  });

  it("keeps the snapshot when progress is missing or not hydrated", () => {
    expect(withLocalProfile(graphSnapshot, null, true)).toBe(graphSnapshot);
    expect(withLocalProfile(graphSnapshot, progress(), false)).toBe(graphSnapshot);
    expect(
      withLocalProfile(graphSnapshot, progress({ school: "", major: "", completed_at: null }), true)
    ).toBe(graphSnapshot);
  });
});
