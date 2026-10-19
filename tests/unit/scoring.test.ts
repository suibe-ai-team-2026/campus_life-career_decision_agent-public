import { describe, expect, it } from "vitest";
import { isAssessmentComplete, scoreAssessment } from "@/lib/assessment/scoring";
import assessmentJson from "../../data/import/seed/assessment.json";
import { AssessmentSchema } from "@/lib/contracts/catalog";

const assessment = AssessmentSchema.parse(assessmentJson);

describe("assessment scoring", () => {
  it("does not treat unanswered questions as zero", () => {
    const result = scoreAssessment(assessment, {});
    expect(result.answered).toBe(0);
    expect(result.dimensions.every((dimension) => dimension.score === null)).toBe(true);
    expect(result.dimensions.every((dimension) => dimension.descriptive.includes("未知"))).toBe(true);
  });

  it("reverse-scores i3 (a high raw answer lowers that item)", () => {
    const low = scoreAssessment(assessment, { i3: 1 });
    const high = scoreAssessment(assessment, { i3: 5 });
    const lowInterest = low.dimensions.find((dimension) => dimension.dimension === "interest")?.score ?? 0;
    const highInterest = high.dimensions.find((dimension) => dimension.dimension === "interest")?.score ?? 0;
    expect(lowInterest).toBeGreaterThan(highInterest);
  });

  it("scores answered dimensions in 0..1 and keeps unknown dimensions null", () => {
    const result = scoreAssessment(assessment, { i1: 4, i2: 3, a1: 5, d1: 2 });
    for (const dimension of result.dimensions) {
      if (dimension.score !== null) {
        expect(dimension.score).toBeGreaterThanOrEqual(0);
        expect(dimension.score).toBeLessThanOrEqual(1);
      }
    }
    expect(result.dimensions.find((dimension) => dimension.dimension === "ability")?.score).toBe(1);
    expect(result.dimensions.find((dimension) => dimension.dimension === "decision")?.score).toBe(0.25);
  });

  it("requires all non-optional questions for completion", () => {
    const answers: Record<string, number> = {};
    for (const question of assessment.questions.filter((item) => !item.optional)) answers[question.question_id] = 3;
    expect(isAssessmentComplete(answers, assessment)).toBe(true);
    delete answers[assessment.questions.find((item) => !item.optional)!.question_id];
    expect(isAssessmentComplete(answers, assessment)).toBe(false);
  });
});
