/**
 * 方向推荐（确定性规则，不调用 AI/网络）。
 *
 * 设计边界（见 `/tmp/specs/career-planning-optimization-plan.md` 第二、六、七章）：
 * - 只使用已作答信号；漏答保持「未知」，不按 0 分参与加权。
 * - 兴趣只表示「当前更愿意投入」，能力只表示自评，经历只表示「用户提供了相关经历」。
 * - 展示的是「值得比较的方向」，不展示匹配百分比或适配率，也不做职业判决。
 * - 同输入同输出：排序 = 兴趣加权平均与能力加权平均的组合分降序，同分按
 *   `DIRECTIONS` 的 seed 顺序；不依赖时间、随机数或 AI。
 * - 无法给出至少 2 条可解释理由的方向不进入推荐（缺依据时不作确定性推荐）。
 */
import {
  ABILITY_SIGNALS,
  ABILITY_TITLES,
  INTEREST_SIGNALS,
  INTEREST_TITLES,
  type AbilityKey,
  type AssessmentAbility,
  type AssessmentInterest,
  type AssessmentResult,
  type AssessmentValue,
  type AssessmentWorkStyle,
  type InterestKey
} from "@/lib/assessment/scoring";
import type { DirectionId } from "@/lib/contracts/common";
import type { PathwayPreference } from "@/lib/contracts/profile";
import { DIRECTIONS, getDirection, type SeedDirection } from "@/lib/content";
import {
  DIRECTION_FIT_RULES,
  DIRECTION_FIT_RULES_VERSION,
  type DirectionFitRule
} from "./direction-fit";
import { excludedDirectionReasons, isDirectionAllowed } from "./pathway";

export type DirectionConfidence = "high" | "medium" | "low";

export type DirectionRecommendation = {
  directionId: DirectionId;
  /** 只描述「这条建议有多少已答信号支撑」，不是适配概率。 */
  confidence: DirectionConfidence;
  /** 2–4 条「相符之处」：每条都同时引用用户已答信号与方向卡真实字段。 */
  reasons: string[];
  /** 0–3 条「待补足」：自评不足 / 仅有自评 / 未知。 */
  gaps: string[];
  matchedSignals: {
    interests: string[];
    abilities: string[];
    values: string[];
    evidence: string[];
  };
  boundaries: string[];
};

export type DirectionRecommendationOptions = {
  /** 默认 3；最多 6（方向总数）。 */
  limit?: number;
  /** 用户明确的路线、行业与方向硬约束。 */
  pathwayPreference?: PathwayPreference;
};

export type DirectionRecommendationResult = {
  recommendations: DirectionRecommendation[];
  /** `!result.hasSignals`：由 UI 提示补答，不返回任何方向。 */
  insufficientSignals: boolean;
  rulesVersion: string;
  /** 被硬约束过滤、因此不参与推荐的方向。 */
  excludedDirectionIds: DirectionId[];
};

export const DEFAULT_RECOMMENDATION_LIMIT = 3;

/** 兴趣/能力进入「相符」列表的最低自评分（0–1）：需高于 3/5，即 4/5 及以上。 */
const SIGNAL_MATCH_THRESHOLD = 0.5;
/** 组合分中兴趣与能力的固定权重（兴趣只表示当前投入意愿，权重略高）。 */
const INTEREST_COMPONENT_WEIGHT = 0.6;
const ABILITY_COMPONENT_WEIGHT = 0.4;
const MAX_REASONS = 4;
const MIN_REASONS = 2;
const MAX_GAPS = 3;

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_RECOMMENDATION_LIMIT;
  const rounded = Math.floor(limit);
  if (rounded < 1) return 1;
  return Math.min(rounded, DIRECTIONS.length);
}

function weightedAverage(
  entries: { weight: number; score: number | null }[]
): number | null {
  let weighted = 0;
  let weightSum = 0;
  for (const entry of entries) {
    if (entry.weight <= 0 || entry.score === null) continue;
    weighted += entry.weight * entry.score;
    weightSum += entry.weight;
  }
  if (weightSum === 0) return null;
  return round3(weighted / weightSum);
}

type MatchedSignalsInternal = {
  interests: InterestKey[];
  abilities: AbilityKey[];
  values: AssessmentValue[];
  workStyles: AssessmentWorkStyle[];
  evidence: AssessmentAbility[];
};

function matchInterests(
  result: AssessmentResult,
  rule: DirectionFitRule,
  interestByKey: Map<InterestKey, AssessmentInterest>
): InterestKey[] {
  return INTEREST_SIGNALS.filter((key) => (rule.interests[key] ?? 0) > 0)
    .map((key) => {
      const interest = interestByKey.get(key);
      return {
        key,
        weight: rule.interests[key] ?? 0,
        score: interest?.score ?? null,
        order: INTEREST_SIGNALS.indexOf(key)
      };
    })
    .filter(
      (entry) =>
        entry.score !== null && entry.score > SIGNAL_MATCH_THRESHOLD
    )
    .sort(
      (a, b) => b.weight - a.weight || (b.score ?? 0) - (a.score ?? 0) || a.order - b.order
    )
    .map((entry) => entry.key);
}

function matchAbilities(
  result: AssessmentResult,
  rule: DirectionFitRule,
  abilityByKey: Map<AbilityKey, AssessmentAbility>
): AbilityKey[] {
  return ABILITY_SIGNALS.filter((key) => (rule.abilities[key] ?? 0) > 0)
    .map((key) => {
      const ability = abilityByKey.get(key);
      return {
        key,
        weight: rule.abilities[key] ?? 0,
        score: ability?.score ?? null,
        order: ABILITY_SIGNALS.indexOf(key)
      };
    })
    .filter(
      (entry) => entry.score !== null && entry.score > SIGNAL_MATCH_THRESHOLD
    )
    .sort(
      (a, b) => b.weight - a.weight || (b.score ?? 0) - (a.score ?? 0) || a.order - b.order
    )
    .map((entry) => entry.key);
}

function matchValues(result: AssessmentResult, rule: DirectionFitRule): AssessmentValue[] {
  return result.values.filter((value) => rule.values.includes(value.key)).slice(0, 3);
}

function matchWorkStyles(
  result: AssessmentResult,
  rule: DirectionFitRule
): AssessmentWorkStyle[] {
  return result.workStyles.filter(
    (style) =>
      rule.workStyles.approach.includes(style.option) ||
      rule.workStyles.team.includes(style.option)
  );
}

function matchEvidence(
  result: AssessmentResult,
  rule: DirectionFitRule
): AssessmentAbility[] {
  return result.ability.filter(
    (ability) =>
      ability.evidence === "supported" &&
      ((rule.abilities[ability.key] ?? 0) > 0 ||
        rule.keyEvidenceAbilities.includes(ability.key))
  );
}

function buildReasons(
  rule: DirectionFitRule,
  matched: MatchedSignalsInternal,
  abilityByKey: Map<AbilityKey, AssessmentAbility>
): string[] {
  const interestReasons = matched.interests.slice(0, 2).flatMap((key) => {
    const link = rule.interestLinks[key];
    if (!link) return [];
    return [
      `你当前更愿意投入${INTEREST_TITLES[key]}类活动（兴趣只表示当前偏好）；方向卡的日常工作包含「${link}」，与该信号相符。`
    ];
  });

  const seenAbilityLinks = new Set<string>();
  const abilityReasons = matched.abilities.slice(0, 2).flatMap((key) => {
    const link = rule.abilityLinks[key];
    const ability = abilityByKey.get(key);
    if (!link || !ability || seenAbilityLinks.has(link)) return [];
    seenAbilityLinks.add(link);
    if (ability.evidence === "supported") {
      return [
        `你在${ABILITY_TITLES[key]}上的自评较高，且补充的经历覆盖了这类能力（仅表示你提供了相关经历）；方向卡「已核技能」中的「${link}」与之相关。`
      ];
    }
    return [
      `你在${ABILITY_TITLES[key]}上的自评较高（仍属自评，尚无经历证据）；方向卡「已核技能」中的「${link}」与之相关。`
    ];
  });

  const valueReasons = matched.values.slice(0, 1).flatMap((value) => {
    const link = rule.valueLinks[value.key];
    if (!link) return [];
    return [
      `你把「${value.label}」列为更看重的工作条件；方向卡的工作内容包含「${link}」，可作为比较时的环境偏好参考。`
    ];
  });

  const styleReasons = matched.workStyles.slice(0, 1).flatMap((style) => {
    const link = rule.workStyleLinks[style.option];
    if (!link) return [];
    return [
      `你更愿意「${style.label}」；方向卡的工作内容「${link}」包含这类任务方式。`
    ];
  });

  // 交错排列，避免连续 4 条都只讲兴趣或只讲能力；最多 4 条。
  return [
    interestReasons[0],
    abilityReasons[0],
    interestReasons[1],
    abilityReasons[1],
    valueReasons[0],
    styleReasons[0]
  ]
    .filter((reason): reason is string => Boolean(reason))
    .slice(0, MAX_REASONS);
}

function buildGaps(
  rule: DirectionFitRule,
  abilityByKey: Map<AbilityKey, AssessmentAbility>
): string[] {
  const selfRatedLow: string[] = [];
  const selfOnly: string[] = [];
  const unknown: string[] = [];

  for (const key of rule.keyEvidenceAbilities) {
    const ability = abilityByKey.get(key);
    const link = rule.abilityLinks[key];
    const linkSuffix = link ? `方向卡把它对应到「${link}」，` : "";
    if (!ability || !ability.answered || ability.score === null) {
      unknown.push(`方向重点能力「${ABILITY_TITLES[key]}」尚未作答，保持未知；补答后比较会更可靠。`);
      continue;
    }
    if (ability.score < SIGNAL_MATCH_THRESHOLD) {
      selfRatedLow.push(
        `方向重点能力「${ABILITY_TITLES[key]}」你目前自评偏低；${linkSuffix}可先通过课程或小项目补足，再回来比较。`
      );
      continue;
    }
    if (ability.evidence === "self_only") {
      selfOnly.push(
        `方向重点能力「${ABILITY_TITLES[key]}」目前只有自评，还没有经历证据；可结合课程作业、社团或实践补充后再比较。`
      );
    }
  }

  // 依次覆盖「自评不足 / 仅有自评 / 未知」，先各取 1 条再补齐，避免 3 条同类。
  const buckets = [selfRatedLow, selfOnly, unknown];
  const gaps: string[] = [];
  for (const bucket of buckets) {
    if (gaps.length >= MAX_GAPS) break;
    const next = bucket.shift();
    if (next) gaps.push(next);
  }
  for (const bucket of buckets) {
    for (const gap of bucket) {
      if (gaps.length >= MAX_GAPS) break;
      gaps.push(gap);
    }
  }
  return gaps;
}

function buildBoundaries(card: SeedDirection): string[] {
  return [
    `规则版本 ${DIRECTION_FIT_RULES_VERSION}：依据方向卡「工作内容」「已核技能」「准备成本」的产品映射，表示值得比较，不是匹配打分或职业判决。`,
    `方向卡自述 ${card.data_gaps.length} 项数据缺口；具体资料边界以方向卡为准。`,
    "兴趣只表示当前更愿意投入；能力只表示自评；经历只表示你提供了相关经历，未经第三方验证。"
  ];
}

function confidenceOf(
  score: number,
  matched: MatchedSignalsInternal,
  rule: DirectionFitRule,
  abilityByKey: Map<AbilityKey, AssessmentAbility>
): DirectionConfidence {
  const breadth =
    matched.interests.length +
    matched.abilities.length +
    matched.values.length +
    matched.workStyles.length;
  const keyEvidenceSupported = rule.keyEvidenceAbilities.some(
    (key) => abilityByKey.get(key)?.evidence === "supported"
  );
  if (
    score >= 0.65 &&
    matched.interests.length >= 2 &&
    matched.abilities.length >= 1 &&
    (keyEvidenceSupported || breadth >= 4)
  ) {
    return "high";
  }
  if (
    score >= 0.4 &&
    matched.interests.length + matched.abilities.length >= 2
  ) {
    return "medium";
  }
  return "low";
}

/**
 * 依据已作答画像计算 2–3 个值得比较的方向（默认 3 个）。
 *
 * 只使用 `result` 里已作答的信号：漏答的兴趣/能力不写入 `scores`，本函数也
 * 不会把未知当 0 分。没有足够信号时返回空推荐并置 `insufficientSignals`。
 */
export function recommendDirections(
  result: AssessmentResult,
  options?: DirectionRecommendationOptions
): DirectionRecommendationResult {
  if (!result.hasSignals) {
    return {
      recommendations: [],
      insufficientSignals: true,
      rulesVersion: DIRECTION_FIT_RULES_VERSION,
      excludedDirectionIds: options?.pathwayPreference
        ? (Object.keys(excludedDirectionReasons(options.pathwayPreference)) as DirectionId[])
        : []
    };
  }

  const limit = normalizeLimit(options?.limit);
  const interestByKey = new Map<InterestKey, AssessmentInterest>(
    result.interest.map((interest) => [interest.key, interest])
  );
  const abilityByKey = new Map<AbilityKey, AssessmentAbility>(
    result.ability.map((ability) => [ability.key, ability])
  );

  const scored: { score: number; recommendation: DirectionRecommendation }[] = [];

  const excludedReasons = options?.pathwayPreference
    ? excludedDirectionReasons(options.pathwayPreference)
    : {};
  for (const card of DIRECTIONS) {
    if (
      options?.pathwayPreference &&
      !isDirectionAllowed(card.direction_id, options.pathwayPreference)
    ) {
      continue;
    }
    const rule = DIRECTION_FIT_RULES[card.direction_id];

    const interestFit = weightedAverage(
      INTEREST_SIGNALS.map((key) => ({
        weight: rule.interests[key] ?? 0,
        score: interestByKey.get(key)?.score ?? null
      }))
    );
    const abilityFit = weightedAverage(
      ABILITY_SIGNALS.map((key) => ({
        weight: rule.abilities[key] ?? 0,
        score: abilityByKey.get(key)?.score ?? null
      }))
    );

    // 两个维度都没有可用信号时不作推荐（不把未知当 0 分）。
    const components: { value: number; weight: number }[] = [];
    if (interestFit !== null) {
      components.push({ value: interestFit, weight: INTEREST_COMPONENT_WEIGHT });
    }
    if (abilityFit !== null) {
      components.push({ value: abilityFit, weight: ABILITY_COMPONENT_WEIGHT });
    }
    if (components.length === 0) continue;

    const weightSum = components.reduce((sum, item) => sum + item.weight, 0);
    const score = round3(
      components.reduce((sum, item) => sum + item.value * item.weight, 0) / weightSum
    );
    // 全部为最低自评时没有可解释的「相符之处」，不进入推荐。
    if (score <= 0) continue;

    const matchedInterests = matchInterests(result, rule, interestByKey);
    const matchedAbilities = matchAbilities(result, rule, abilityByKey);
    const matchedValues = matchValues(result, rule);
    const matchedWorkStyles = matchWorkStyles(result, rule);
    const matched: MatchedSignalsInternal = {
      interests: matchedInterests,
      abilities: matchedAbilities,
      values: matchedValues,
      workStyles: matchedWorkStyles,
      evidence: matchEvidence(result, rule)
    };

    const reasons = buildReasons(rule, matched, abilityByKey);
    if (reasons.length < MIN_REASONS) continue;

    scored.push({
      score,
      recommendation: {
        directionId: card.direction_id,
        confidence: confidenceOf(score, matched, rule, abilityByKey),
        reasons,
        gaps: buildGaps(rule, abilityByKey),
        matchedSignals: {
          interests: matched.interests.map((key) => INTEREST_TITLES[key]),
          abilities: matched.abilities.map((key) => ABILITY_TITLES[key]),
          values: matched.values.map((value) => value.label),
          evidence: matched.evidence.map((ability) => ABILITY_TITLES[ability.key])
        },
        boundaries: buildBoundaries(card)
      }
    });
  }

  const seedOrder = new Map<DirectionId, number>(
    DIRECTIONS.map((card, index) => [card.direction_id, index])
  );
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (seedOrder.get(a.recommendation.directionId) ?? 0) -
        (seedOrder.get(b.recommendation.directionId) ?? 0)
  );

  return {
    recommendations: scored.slice(0, limit).map((entry) => entry.recommendation),
    insufficientSignals: false,
    rulesVersion: DIRECTION_FIT_RULES_VERSION,
    excludedDirectionIds: Object.keys(excludedReasons) as DirectionId[]
  };
}

/** 供其他模块复用：只取规则版本，避免重复导入。 */
export { DIRECTION_FIT_RULES_VERSION };

/** 方向卡内容边界：建议用于 UI 的「来源/边界」提示，不含任何外部事实。 */
export function recommendationSourceNote(directionId: DirectionId): string {
  const card = getDirection(directionId);
  if (!card) return "方向卡未载入。";
  return `依据方向卡「${card.short_title}」的工作内容与已核技能字段；具体资料缺口见方向卡。`;
}
