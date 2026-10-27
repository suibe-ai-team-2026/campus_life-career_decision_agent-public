import type { Assessment, AssessmentQuestion } from "@/lib/contracts/catalog";
import type { Answers, AnswerValue, Scores } from "@/lib/contracts/profile";

/**
 * 职业探索自我画像（短版）计分。
 *
 * 规则来自 PR #20 的评审稿 `docs/assessment-questionnaire-v0.1.md`：
 * - 兴趣（RIASEC 参考）与能力自评均为单题 1–5 分，归一到 0–1；
 * - 漏答保持「未知」：不写入 scores，不按 0 分，不补成中间值；
 * - 价值排序只记录顺序，不换算为分数；
 * - 工作方式与准备度不进入方向匹配排序（准备度只影响引导颗粒度）；
 * - 经历补充只标注「有经历支持 / 仅有自评 / 未提供」，不伪造能力分数。
 *
 * 这里是**极短筛查**，不是经过信效度验证的标准化测验。
 */

export const INTEREST_SIGNALS = ["r", "i", "a", "s", "e", "c"] as const;
export type InterestKey = (typeof INTEREST_SIGNALS)[number];

export const INTEREST_TITLES: Record<InterestKey, string> = {
  r: "实践",
  i: "研究",
  a: "创意",
  s: "社会",
  e: "企业",
  c: "常规"
};

export const INTEREST_DESCRIPTIONS: Record<InterestKey, string> = {
  r: "动手搭建、操作或改进具体产品或流程",
  i: "搜集资料、比较证据、弄清问题为什么发生",
  a: "提出新点子并设计有吸引力的表达",
  s: "解释复杂信息、帮助他人、组织协作",
  e: "说服他人、协调资源、推动想法落地",
  c: "整理数据、核对细节、让工作按规则准确完成"
};

export const ABILITY_SIGNALS = [
  "research",
  "data",
  "writing",
  "communication",
  "execution",
  "digital"
] as const;
export type AbilityKey = (typeof ABILITY_SIGNALS)[number];

export const ABILITY_TITLES: Record<AbilityKey, string> = {
  research: "信息搜集与研究",
  data: "数据理解与分析",
  writing: "写作表达",
  communication: "沟通协作",
  execution: "组织执行",
  digital: "数字工具应用"
};

export const ABILITY_DIMENSIONS: Record<AbilityKey, string> = {
  research: "ability_research",
  data: "ability_data",
  writing: "ability_writing",
  communication: "ability_communication",
  execution: "ability_execution",
  digital: "ability_digital"
};

export type EvidenceStatus = "supported" | "self_only" | "unknown";

export type AssessmentInterest = {
  key: InterestKey;
  dimension: string;
  title: string;
  description: string;
  /** 0..1；未作答为 null，保持未知。 */
  score: number | null;
  answered: boolean;
};

export type AssessmentAbility = {
  key: AbilityKey;
  dimension: string;
  title: string;
  score: number | null;
  answered: boolean;
  evidence: EvidenceStatus;
};

export type AssessmentValue = { key: string; label: string };

export type AssessmentWorkStyle = {
  questionId: string;
  dimension: string;
  title: string;
  option: string;
  label: string;
};

export type ReadinessBand = "unknown" | "exploring" | "comparing" | "targeted";

export type AssessmentReadiness = {
  score: number | null;
  band: ReadinessBand;
  label: string;
  guidance: string;
};

export type AssessmentExperience = { text: string; tags: string[] } | null;

export type AssessmentResult = {
  version: string;
  /** 只保存可计算的数值信号；未知维度缺省，不写 0。 */
  scores: Scores;
  answered: number;
  total: number;
  skippedQuestions: string[];
  interest: AssessmentInterest[];
  /** 已作答的兴趣信号，按分数从高到低；并列保持稳定顺序。 */
  interestTop: AssessmentInterest[];
  ability: AssessmentAbility[];
  values: AssessmentValue[];
  workStyles: AssessmentWorkStyle[];
  readiness: AssessmentReadiness;
  experience: AssessmentExperience;
  /** 有经历标签支持的能力维度键（ability_*）。 */
  evidenceSupportedAbilities: string[];
  /** 是否至少有 3 个兴趣或 3 个能力信号，可用于方向比较。 */
  hasSignals: boolean;
};

const READINESS_LABELS: Record<Exclude<ReadinessBand, "unknown">, { label: string; guidance: string }> = {
  exploring: {
    label: "还在找线索",
    guidance: "下一步先看方向入门与工作内容，再做 2–3 个方向的并排比较，不必急着定方向。"
  },
  comparing: {
    label: "正在比较候选方向",
    guidance: "下一步优先比较各方向的工作内容、能力要求与资料缺口，再决定暂定方向。"
  },
  targeted: {
    label: "已有较明确倾向",
    guidance: "下一步可以直接核对能力要求、课程与竞赛准备路径，并把阶段安排写进方案。"
  }
};

function clampLikert(raw: number): number {
  return Math.min(5, Math.max(1, raw));
}

function normalizedValue(question: AssessmentQuestion, raw: number): number {
  const bounded = clampLikert(raw);
  const effective = question.reverse ? 6 - bounded : bounded;
  return (effective - 1) / 4;
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function findDimensionQuestion(
  assessment: Assessment,
  dimension: string
): AssessmentQuestion | undefined {
  return assessment.questions.find((question) => question.dimension === dimension);
}

function singleAnswer(answers: Answers, questionId: string): string | number | null {
  const raw = answers[questionId];
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return raw;
  return null;
}

function optionLabel(question: AssessmentQuestion | undefined, value: string | number): string | null {
  if (!question) return null;
  const match = question.options.find((option) => String(option.value) === String(value));
  return match?.label ?? null;
}

function experienceAnswer(answers: Answers, questionId: string): AssessmentExperience {
  const raw = answers[questionId];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    const tags = Array.isArray(raw.tags)
      ? raw.tags.filter((tag): tag is string => typeof tag === "string")
      : [];
    if (!text && tags.length === 0) return null;
    return { text: text.slice(0, 300), tags: tags.slice(0, 6) };
  }
  return null;
}

export function scoreAssessment(assessment: Assessment, answers: Answers): AssessmentResult {
  const scores: Scores = {};
  const skippedQuestions: string[] = [];
  let answered = 0;

  for (const question of assessment.questions) {
    if (question.kind === "likert") {
      const raw = answers[question.question_id];
      if (typeof raw === "number" && Number.isFinite(raw)) {
        scores[question.dimension] = roundScore(normalizedValue(question, raw));
        answered += 1;
      } else {
        skippedQuestions.push(question.question_id);
      }
      continue;
    }
    if (question.kind === "single" && question.section === "readiness") {
      const raw = answers[question.question_id];
      if (typeof raw === "number" && Number.isFinite(raw)) {
        scores[question.dimension] = roundScore(normalizedValue(question, raw));
        answered += 1;
      } else {
        skippedQuestions.push(question.question_id);
      }
      continue;
    }
    // rank / single(work_style) / text：非数值信号，不进入 scores，但计入完成度。
    const raw: AnswerValue | undefined = answers[question.question_id];
    if (raw === undefined) {
      skippedQuestions.push(question.question_id);
      continue;
    }
    if (!question.optional) answered += 1;
  }

  const total = assessment.questions.filter((question) => !question.optional).length;

  const experience =
    experienceAnswer(
      answers,
      assessment.questions.find((question) => question.section === "experience")?.question_id ?? "exp_optional"
    ) ?? null;

  const abilityDimensionSet = new Set<string>(
    ABILITY_SIGNALS.map((key) => ABILITY_DIMENSIONS[key])
  );
  const evidenceSupportedAbilities = experience
    ? experience.tags.filter((tag) => abilityDimensionSet.has(tag))
    : [];

  const interest: AssessmentInterest[] = INTEREST_SIGNALS.map((key) => {
    const dimension = `interest_${key}`;
    return {
      key,
      dimension,
      title: INTEREST_TITLES[key],
      description: INTEREST_DESCRIPTIONS[key],
      score: scores[dimension] ?? null,
      answered: scores[dimension] !== undefined
    };
  });
  const interestTop = interest
    .filter((item): item is AssessmentInterest & { score: number } => item.score !== null)
    .sort((a, b) => b.score - a.score || INTEREST_SIGNALS.indexOf(a.key) - INTEREST_SIGNALS.indexOf(b.key))
    .slice(0, 3);

  const ability: AssessmentAbility[] = ABILITY_SIGNALS.map((key) => {
    const dimension = ABILITY_DIMENSIONS[key];
    const isAnswered = scores[dimension] !== undefined;
    const supported = evidenceSupportedAbilities.includes(dimension);
    return {
      key,
      dimension,
      title: ABILITY_TITLES[key],
      score: isAnswered ? scores[dimension] : null,
      answered: isAnswered,
      evidence: supported ? "supported" : isAnswered ? "self_only" : "unknown"
    };
  });

  const values: AssessmentValue[] = [];
  const valueQuestion = assessment.questions.find((question) => question.kind === "rank");
  const valueAnswer = valueQuestion ? answers[valueQuestion.question_id] : undefined;
  if (valueQuestion && Array.isArray(valueAnswer)) {
    for (const raw of valueAnswer) {
      const key = String(raw);
      const matched = valueQuestion.options.find((option) => String(option.value) === key);
      if (matched) values.push({ key, label: matched.label });
    }
  }

  const workStyles: AssessmentWorkStyle[] = assessment.questions
    .filter((question) => question.kind === "single" && question.section === "work_style")
    .flatMap((question) => {
      const raw = singleAnswer(answers, question.question_id);
      if (raw === null) return [];
      const label = optionLabel(question, raw);
      if (!label) return [];
      return [
        {
          questionId: question.question_id,
          dimension: question.dimension,
          title: assessment.dimensions.work_style?.title ?? "工作方式",
          option: String(raw),
          label
        }
      ];
    });

  const readinessQuestion = findDimensionQuestion(assessment, "readiness");
  const readinessRaw = readinessQuestion ? singleAnswer(answers, readinessQuestion.question_id) : null;
  const readinessScore =
    readinessQuestion && typeof readinessRaw === "number"
      ? roundScore(normalizedValue(readinessQuestion, readinessRaw))
      : null;
  const readinessBand: ReadinessBand =
    typeof readinessRaw === "number"
      ? readinessRaw <= 2
        ? "exploring"
        : readinessRaw === 3
          ? "comparing"
          : "targeted"
      : "unknown";
  const readinessMeta = readinessBand === "unknown" ? null : READINESS_LABELS[readinessBand];
  const readiness: AssessmentReadiness = {
    score: readinessScore,
    band: readinessBand,
    label: readinessMeta?.label ?? "未作答，保持未知",
    guidance:
      readinessMeta?.guidance ??
      "准备度未作答：下一步可以先补这一题，或直接浏览方向再决定比较顺序。"
  };

  const interestAnswered = interest.filter((item) => item.answered).length;
  const abilityAnswered = ability.filter((item) => item.answered).length;

  return {
    version: assessment.version,
    scores,
    answered,
    total,
    skippedQuestions,
    interest,
    interestTop,
    ability,
    values,
    workStyles,
    readiness,
    experience,
    evidenceSupportedAbilities,
    hasSignals: interestAnswered >= 3 || abilityAnswered >= 3
  };
}

export function isAssessmentComplete(answers: Answers, assessment: Assessment): boolean {
  return assessment.questions
    .filter((question) => !question.optional)
    .every((question) => {
      const raw: AnswerValue | undefined = answers[question.question_id];
      if (question.kind === "likert") return typeof raw === "number" && Number.isFinite(raw);
      if (question.kind === "rank") return Array.isArray(raw) && raw.length > 0;
      if (question.kind === "single") {
        if (question.section === "readiness") return typeof raw === "number";
        return typeof raw === "string" || typeof raw === "number";
      }
      return Boolean(raw);
    });
}

export function assessmentProgress(
  answers: Answers,
  assessment: Assessment
): { answered: number; total: number } {
  const required = assessment.questions.filter((question) => !question.optional);
  const answered = required.filter((question) => answers[question.question_id] !== undefined).length;
  return { answered, total: required.length };
}
