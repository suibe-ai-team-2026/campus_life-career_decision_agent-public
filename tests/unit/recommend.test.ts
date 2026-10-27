import { describe, expect, it } from "vitest";
import { scoreAssessment } from "@/lib/assessment/scoring";
import { recommendDirections } from "@/lib/career/recommend";
import {
  DIRECTION_FIT_RULE_LIST,
  DIRECTION_FIT_RULES_VERSION,
  getDirectionFitRule
} from "@/lib/career/direction-fit";
import type { Answers } from "@/lib/contracts/profile";
import { ASSESSMENT, DIRECTIONS, DIRECTIONS_CATEGORY_VERSION, getDirection } from "@/lib/content";

/** 研究/数据倾向的虚构画像（仅测试用，不对应真实学生）。 */
const RESEARCH_PROFILE: Answers = {
  i_r: 2,
  i_i: 5,
  i_a: 2,
  i_s: 2,
  i_e: 2,
  i_c: 4,
  v_top3: ["growth", "autonomy", "influence"],
  a_info: 5,
  a_data: 5,
  a_writing: 3,
  a_communication: 3,
  a_execution: 3,
  a_digital: 4,
  w_approach: "info_first",
  w_team: "research",
  r_clarity: 3,
  exp_optional: {
    text: "课程小组的数据整理作业",
    tags: ["ability_data", "ability_research"]
  }
};

/** 人际/组织倾向的虚构画像（仅测试用，不对应真实学生）。 */
const PEOPLE_PROFILE: Answers = {
  i_r: 2,
  i_i: 2,
  i_a: 3,
  i_s: 5,
  i_e: 4,
  i_c: 4,
  v_top3: ["collaboration", "stability", "growth"],
  a_info: 3,
  a_data: 2,
  a_writing: 4,
  a_communication: 5,
  a_execution: 5,
  a_digital: 2,
  w_approach: "clear_process",
  w_team: "coordinate",
  r_clarity: 2,
  exp_optional: {
    text: "社团活动组织与对外沟通",
    tags: ["ability_communication", "ability_execution"]
  }
};

/** 只答了部分题目的画像：用于验证「未知」与「仅有自评」。 */
const SPARSE_PROFILE: Answers = {
  i_i: 4,
  i_c: 4,
  i_s: 3,
  a_info: 4,
  a_data: 4,
  a_writing: 3
};

function recommend(answers: Answers, options?: { limit?: number }) {
  return recommendDirections(scoreAssessment(ASSESSMENT, answers), options);
}

describe("recommendDirections", () => {
  it("returns identical output for identical input (deterministic ordering)", () => {
    const first = recommend(RESEARCH_PROFILE);
    const second = recommend(RESEARCH_PROFILE);
    expect(second).toEqual(first);
    expect(first.insufficientSignals).toBe(false);
    expect(first.rulesVersion).toBe(DIRECTION_FIT_RULES_VERSION);
    expect(first.recommendations.length).toBeGreaterThanOrEqual(2);
    expect(first.recommendations.length).toBeLessThanOrEqual(3);

    // 作答键的插入顺序不影响结果（同一组信号 → 同一排序）。
    const reversed = Object.fromEntries(
      Object.entries(RESEARCH_PROFILE).reverse()
    ) as Answers;
    expect(recommend(reversed)).toEqual(first);

    // 默认 limit 为 3；显式 limit 只截断，不改变前几位顺序。
    const limited = recommend(RESEARCH_PROFILE, { limit: 2 });
    expect(limited.recommendations).toHaveLength(2);
    expect(limited.recommendations[0]).toEqual(first.recommendations[0]);
    expect(limited.recommendations[1]).toEqual(first.recommendations[1]);
  });

  it("returns an empty, flagged result when there are not enough signals", () => {
    const empty = recommend({});
    expect(empty.insufficientSignals).toBe(true);
    expect(empty.recommendations).toEqual([]);
    expect(empty.rulesVersion).toBe(DIRECTION_FIT_RULES_VERSION);

    // 2 个兴趣 + 2 个能力仍未达到 hasSignals（需要任一侧至少 3 个）。
    const partial = recommend({
      i_i: 5,
      i_c: 4,
      a_info: 5,
      a_data: 5
    });
    expect(partial.insufficientSignals).toBe(true);
    expect(partial.recommendations).toEqual([]);
  });

  it("produces gaps for unknown signals and self-only abilities", () => {
    const sparse = recommend(SPARSE_PROFILE);
    expect(sparse.insufficientSignals).toBe(false);
    const dataBusiness = sparse.recommendations.find(
      (item) => item.directionId === "data_business"
    );
    expect(dataBusiness).toBeDefined();
    const gapText = dataBusiness?.gaps.join(" / ") ?? "";
    // 未作答的重点能力保持「未知」，未补经历的自评标为「只有自评」。
    expect(gapText).toContain("未知");
    expect(gapText).toContain("只有自评");
    expect(dataBusiness?.gaps.length).toBeLessThanOrEqual(3);

    // 自评偏低的能力会进入「自评不足」类待补足项。
    const people = recommend(PEOPLE_PROFILE);
    const allGaps = people.recommendations.flatMap((item) => item.gaps).join(" / ");
    expect(allGaps).toContain("自评偏低");
  });

  it("never uses percentages or适配率-like conclusions in reasons/gaps/boundaries", () => {
    const forbidden = /[%％]|适配率|最适合|最热门|就业率|薪资|通过率/;
    for (const answers of [RESEARCH_PROFILE, PEOPLE_PROFILE, SPARSE_PROFILE]) {
      const result = recommend(answers);
      for (const item of result.recommendations) {
        expect(item.reasons.length).toBeGreaterThanOrEqual(2);
        expect(item.reasons.length).toBeLessThanOrEqual(4);
        for (const reason of item.reasons) {
          expect(reason).not.toMatch(forbidden);
          // 每条理由都同时引用「你」的已答信号与方向卡字段。
          expect(reason.startsWith("你")).toBe(true);
          expect(reason).toContain("方向卡");
        }
        for (const gap of item.gaps) expect(gap).not.toMatch(forbidden);
        for (const boundary of item.boundaries) expect(boundary).not.toMatch(forbidden);
        expect(item.gaps.length).toBeLessThanOrEqual(3);
        expect(item.confidence).toMatch(/^(high|medium|low)$/);
        expect(item.boundaries.length).toBeGreaterThan(0);
      }
    }
  });

  it("ranks different profiles to different first directions", () => {
    const research = recommend(RESEARCH_PROFILE);
    const people = recommend(PEOPLE_PROFILE);
    expect(research.recommendations[0].directionId).not.toBe(
      people.recommendations[0].directionId
    );
    // 规则版本变更时可以同步更新这两条期望（排序是确定性产品规则）。
    expect(research.recommendations[0].directionId).toBe("finance_accounting");
    expect(people.recommendations[0].directionId).toBe("public_service");
    // 两张画像的前三位推荐都必须是合法方向 id。
    const ids = new Set<string>(DIRECTIONS.map((item) => item.direction_id));
    for (const item of [...research.recommendations, ...people.recommendations]) {
      expect(ids.has(item.directionId)).toBe(true);
    }
  });

  it("keeps the versioned mapping explainable and tied to real direction-card fields", () => {
    expect(DIRECTION_FIT_RULES_VERSION.length).toBeGreaterThan(0);
    expect(DIRECTION_FIT_RULE_LIST).toHaveLength(DIRECTIONS.length);
    for (const rule of DIRECTION_FIT_RULE_LIST) {
      const card = getDirection(rule.directionId);
      expect(card, `missing card for ${rule.directionId}`).not.toBeNull();
      if (!card) continue;
      expect(getDirectionFitRule(rule.directionId)).toBe(rule);
      expect(rule.basisNote.length).toBeGreaterThan(0);

      for (const weight of Object.values(rule.interests)) {
        expect(weight).toBeGreaterThanOrEqual(0);
        expect(weight).toBeLessThanOrEqual(2);
      }
      for (const weight of Object.values(rule.abilities)) {
        expect(weight).toBeGreaterThanOrEqual(0);
        expect(weight).toBeLessThanOrEqual(2);
      }
      // 映射的「依据」必须是方向卡真实字段原文，不能是编造的工作内容。
      for (const text of Object.values(rule.interestLinks)) {
        expect(card.work_content).toContain(text);
      }
      for (const text of Object.values(rule.abilityLinks)) {
        expect(card.verified_skills).toContain(text);
      }
      for (const text of Object.values(rule.valueLinks)) {
        expect(card.work_content).toContain(text);
      }
      for (const text of Object.values(rule.workStyleLinks)) {
        expect(card.work_content).toContain(text);
      }
      for (const key of rule.keyEvidenceAbilities) {
        expect(rule.abilities[key]).toBeGreaterThan(0);
      }
    }
    // 分类版本只用于展示，不参与推荐（仍断言它存在，避免静默丢失）。
    expect(DIRECTIONS_CATEGORY_VERSION.length).toBeGreaterThan(0);
  });
});
