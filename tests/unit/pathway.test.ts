import { describe, expect, it } from "vitest";
import { scoreAssessment } from "@/lib/assessment/scoring";
import {
  excludedDirectionReasons,
  recommendPathway
} from "@/lib/career/pathway";
import type { Answers, PathwayPreference } from "@/lib/contracts/profile";
import { ASSESSMENT } from "@/lib/content";

/** 仅用于规则测试的虚构画像，不对应任何真实学生。 */
const PRACTICE_PROFILE: Answers = {
  i_r: 4,
  i_i: 2,
  i_a: 3,
  i_s: 5,
  i_e: 4,
  i_c: 3,
  v_top3: ["growth", "collaboration", "income"],
  a_info: 3,
  a_data: 2,
  a_writing: 4,
  a_communication: 5,
  a_execution: 5,
  a_digital: 2,
  w_approach: "discuss_first",
  w_team: "coordinate",
  r_clarity: 3
};

const RESEARCH_PROFILE: Answers = {
  ...PRACTICE_PROFILE,
  i_i: 5,
  i_s: 2,
  i_e: 2,
  a_data: 4,
  a_writing: 5,
  a_communication: 3,
  a_execution: 3,
  w_approach: "info_first",
  w_team: "research"
};

const PREFERENCE: PathwayPreference = {
  primary: "undetermined",
  alternatives: [],
  excluded_directions: [],
  excluded_sectors: [],
  target_cities: ["上海"],
  practice_orientation: "practice",
  accepts_cross_major: true,
  accepts_certificate: true,
  accepts_competition: true,
  accepts_long_internship: true
};

describe("career pathway constraints", () => {
  it("applies a public-sector hard constraint before interest and ability signals", () => {
    const preference: PathwayPreference = {
      ...PREFERENCE,
      excluded_sectors: ["public_sector"]
    };
    const decision = recommendPathway(scoreAssessment(ASSESSMENT, PRACTICE_PROFILE), preference);

    expect(decision.leading?.pathwayId).toBe("undergraduate_employment");
    expect(decision.alternatives.map((item) => item.pathwayId)).not.toContain("public_exam");
    expect(decision.excluded.map((item) => item.pathwayId)).toContain("public_exam");
    expect(excludedDirectionReasons(preference)).toHaveProperty("public_service");
  });

  it("prioritises undergraduate employment for a practice-oriented profile", () => {
    const decision = recommendPathway(scoreAssessment(ASSESSMENT, PRACTICE_PROFILE), PREFERENCE);
    expect(decision.leading?.pathwayId).toBe("undergraduate_employment");
    expect(decision.rulesVersion).toBe("pathway-fit-2026-10-28.1");
  });

  it("can compare domestic postgraduate study for a research-oriented profile", () => {
    const preference: PathwayPreference = {
      ...PREFERENCE,
      primary: "domestic_postgraduate",
      practice_orientation: "research"
    };
    const decision = recommendPathway(scoreAssessment(ASSESSMENT, RESEARCH_PROFILE), preference);

    expect(decision.leading?.pathwayId).toBe("domestic_postgraduate");
    expect(decision.alternatives.length).toBeGreaterThan(0);
  });

  it("excludes both further-study pathways when the constraint says so", () => {
    const preference: PathwayPreference = {
      ...PREFERENCE,
      excluded_sectors: ["further_study"]
    };
    const decision = recommendPathway(scoreAssessment(ASSESSMENT, RESEARCH_PROFILE), preference);
    const excludedIds = decision.excluded.map((item) => item.pathwayId);

    expect(excludedIds).toEqual(
      expect.arrayContaining(["domestic_postgraduate", "overseas_study"])
    );
    expect(decision.leading?.pathwayId).not.toBe("domestic_postgraduate");
    expect(decision.leading?.pathwayId).not.toBe("overseas_study");
  });
});
