import type { Assessment, AssessmentQuestion } from "@/lib/contracts/catalog";
import type { Answers, Scores } from "@/lib/contracts/profile";

export type DimensionScore = {
  dimension: string;
  title: string;
  /** 0..1, null when every question in the dimension was skipped. */
  score: number | null;
  answered: number;
  total: number;
  descriptive: string;
};

export type AssessmentResult = {
  version: string;
  scores: Scores;
  dimensions: DimensionScore[];
  answered: number;
  total: number;
  skipped_questions: string[];
};

const DESCRIPTIVE: Record<string, [string, string, string]> = {
  interest: ["探索意愿偏低或仍在观望", "有初步兴趣但还不稳定", "兴趣线索比较清晰"],
  ability: ["自评能力仍在起步", "自评能力在积累中", "自评能力已有较多积累"],
  decision: ["更依赖外部确定答案", "愿意比较但仍需确认", "接受证据与可调整路径"]
};

function describe(dimension: string, score: number | null): string {
  if (score === null) return "本维度未作答，保持未知，不按 0 分处理";
  const labels = DESCRIPTIVE[dimension] ?? ["未知", "部分", "较清晰"];
  if (score < 0.34) return labels[0];
  if (score < 0.67) return labels[1];
  return labels[2];
}

function effectiveValue(question: AssessmentQuestion, raw: number): number {
  const bounded = Math.min(5, Math.max(1, raw));
  return question.reverse ? 6 - bounded : bounded;
}

export function scoreAssessment(assessment: Assessment, answers: Answers): AssessmentResult {
  const byDimension = new Map<string, { total: number; count: number; answered: number; totalQuestions: number }>();
  const skipped: string[] = [];
  let answered = 0;

  for (const question of assessment.questions) {
    const bucket =
      byDimension.get(question.dimension) ??
      { total: 0, count: 0, answered: 0, totalQuestions: 0 };
    bucket.totalQuestions += 1;
    const raw = answers[question.question_id];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      bucket.total += effectiveValue(question, raw);
      bucket.count += 1;
      bucket.answered += 1;
      answered += 1;
    } else {
      skipped.push(question.question_id);
    }
    byDimension.set(question.dimension, bucket);
  }

  const scores: Scores = {};
  const dimensions: DimensionScore[] = [];
  for (const [dimension, bucket] of byDimension.entries()) {
    const score = bucket.count === 0 ? null : (bucket.total / bucket.count - 1) / 4;
    const rounded = score === null ? null : Math.round(score * 1000) / 1000;
    scores[dimension] = rounded ?? 0;
    dimensions.push({
      dimension,
      title: assessment.dimensions[dimension]?.title ?? dimension,
      score: rounded,
      answered: bucket.answered,
      total: bucket.totalQuestions,
      descriptive: describe(dimension, rounded)
    });
  }

  return {
    version: assessment.version,
    scores,
    dimensions,
    answered,
    total: assessment.questions.length,
    skipped_questions: skipped
  };
}

export function isAssessmentComplete(answers: Answers, assessment: Assessment): boolean {
  return assessment.questions
    .filter((question) => !question.optional)
    .every((question) => typeof answers[question.question_id] === "number");
}
