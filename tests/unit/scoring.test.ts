import { describe, expect, it } from "vitest";
import { assessmentProgress, isAssessmentComplete, scoreAssessment } from "@/lib/assessment/scoring";
import assessmentJson from "../../data/import/seed/assessment.json";
import { AssessmentSchema } from "@/lib/contracts/catalog";
import type { Answers } from "@/lib/contracts/profile";

const assessment = AssessmentSchema.parse(assessmentJson);

function completeAnswers(): Answers {
  const answers: Answers = {};
  for (const question of assessment.questions) {
    if (question.optional) continue;
    if (question.kind === "likert") answers[question.question_id] = 3;
    else if (question.kind === "rank")
      answers[question.question_id] = question.options.slice(0, 3).map((option) => String(option.value));
    else if (question.section === "readiness") answers[question.question_id] = 3;
    else if (question.kind === "single") answers[question.question_id] = String(question.options[0]?.value ?? "");
  }
  return answers;
}

describe("assessment scoring (职业探索自我画像 v0.1)", () => {
  it("keeps unanswered signals unknown instead of zero", () => {
    const result = scoreAssessment(assessment, {});
    expect(result.answered).toBe(0);
    expect(result.total).toBe(16);
    expect(result.interest.every((item) => item.score === null)).toBe(true);
    expect(result.ability.every((item) => item.score === null)).toBe(true);
    expect(result.ability.every((item) => item.evidence === "unknown")).toBe(true);
    expect(result.scores).toEqual({});
    expect(result.hasSignals).toBe(false);
    expect(result.readiness.band).toBe("unknown");
  });

  it("normalises interest and ability self-ratings into 0..1 without inventing values", () => {
    const result = scoreAssessment(assessment, { i_r: 5, i_s: 1, a_data: 5 });
    expect(result.scores.interest_r).toBe(1);
    expect(result.scores.interest_s).toBe(0);
    expect(result.scores.ability_data).toBe(1);
    expect(result.scores.interest_i).toBeUndefined();
    expect(result.interestTop[0]?.key).toBe("r");
    expect(result.interestTop.map((item) => item.key)).not.toContain("i");
    expect(result.answered).toBe(3);
  });

  it("applies reverse scoring when a question is marked reverse", () => {
    const reversed = {
      ...assessment,
      questions: assessment.questions.map((question) =>
        question.question_id === "i_r" ? { ...question, reverse: true } : question
      )
    };
    const low = scoreAssessment(reversed, { i_r: 1 });
    const high = scoreAssessment(reversed, { i_r: 5 });
    expect(low.scores.interest_r).toBe(1);
    expect(high.scores.interest_r).toBe(0);
  });

  it("keeps value ranking order and never converts it into a score", () => {
    const result = scoreAssessment(assessment, {
      v_top3: ["growth", "stability", "income"]
    });
    expect(result.values.map((item) => item.key)).toEqual(["growth", "stability", "income"]);
    expect(result.values[0]?.label).toContain("成长");
    expect(Object.keys(result.scores).some((key) => key.startsWith("values"))).toBe(false);
  });

  it("records work style preferences as plain labels", () => {
    const result = scoreAssessment(assessment, {
      w_approach: "info_first",
      w_team: "coordinate"
    });
    expect(result.workStyles).toHaveLength(2);
    expect(result.workStyles[0]?.label).toContain("先找资料");
    expect(result.workStyles[1]?.label).toContain("分工");
  });

  it("derives readiness band only for guidance, not for matching scores", () => {
    const exploring = scoreAssessment(assessment, { r_clarity: 1 });
    const targeted = scoreAssessment(assessment, { r_clarity: 5 });
    expect(exploring.readiness.band).toBe("exploring");
    expect(exploring.readiness.guidance).toContain("方向入门");
    expect(targeted.readiness.band).toBe("targeted");
    expect(targeted.readiness.guidance).toContain("课程");
    // readiness 进入 scores 供云端画像保存；推荐排序由 recommend 引擎决定，不读 readiness。
    expect(exploring.scores.readiness).toBe(0);
  });

  it("marks evidence support separately from self-rating", () => {
    const result = scoreAssessment(assessment, {
      a_communication: 4,
      exp_optional: { text: "在社团里负责对外联络和活动协调。", tags: ["ability_communication"] }
    });
    const communication = result.ability.find((item) => item.key === "communication");
    const data = result.ability.find((item) => item.key === "data");
    expect(communication?.evidence).toBe("supported");
    expect(communication?.score).toBe(0.75);
    expect(data?.evidence).toBe("unknown");
    expect(result.evidenceSupportedAbilities).toEqual(["ability_communication"]);
    expect(result.experience?.text).toContain("社团");
  });

  it("requires every non-optional item for completion and ignores the optional experience", () => {
    const answers = completeAnswers();
    expect(assessmentProgress(answers, assessment)).toEqual({ answered: 16, total: 16 });
    expect(isAssessmentComplete(answers, assessment)).toBe(true);

    delete answers.i_c;
    expect(assessmentProgress(answers, assessment)).toEqual({ answered: 15, total: 16 });
    expect(isAssessmentComplete(answers, assessment)).toBe(false);

    // 可选经历补充不参与完成度判断。
    const withoutExperience = completeAnswers();
    delete withoutExperience.exp_optional;
    expect(isAssessmentComplete(withoutExperience, assessment)).toBe(true);
  });
});
