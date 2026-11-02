/**
 * 主路线建议：本科就业、国内升学、境外升学、公考/编制或仍不确定。
 *
 * 该模块只做确定性比较，不使用 AI。用户的硬排除条件先于兴趣和能力信号：
 * 一旦某方向被明确排除，它不会进入主路线或职业方向推荐。
 */
import type { AssessmentResult } from "@/lib/assessment/scoring";
import type { DirectionId } from "@/lib/contracts/common";
import type { PathwayPreference } from "@/lib/contracts/profile";

export const PATHWAY_IDS = [
  "undergraduate_employment",
  "domestic_postgraduate",
  "overseas_study",
  "public_exam",
  "undetermined"
] as const;
export type PathwayId = (typeof PATHWAY_IDS)[number];

export const PATHWAY_LABELS: Record<PathwayId, string> = {
  undergraduate_employment: "本科就业",
  domestic_postgraduate: "国内升学",
  overseas_study: "境外升学",
  public_exam: "公考 / 编制",
  undetermined: "仍不确定"
};

export type PathwayRecommendation = {
  pathwayId: PathwayId;
  label: string;
  status: "leading" | "alternative" | "constraint_excluded" | "needs_more_signals";
  reasons: string[];
  risks: string[];
  preparationCost: string;
};

export type PathwayDecision = {
  leading: PathwayRecommendation | null;
  alternatives: PathwayRecommendation[];
  excluded: Array<{ pathwayId: PathwayId; reason: string }>;
  explanation: string[];
  rulesVersion: string;
};

export const PATHWAY_RULES_VERSION = "pathway-fit-2026-10-28.1";

const PREFERENCE_EXCLUDES_PUBLIC = new Set([
  "public_sector"
]);

function answeredScore(result: AssessmentResult, dimension: string): number | null {
  return result.scores[dimension] ?? null;
}

function average(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0) / known.length;
}

function directionExplicitlyExcluded(
  directionId: DirectionId,
  preference: PathwayPreference
): boolean {
  if (preference.excluded_directions.includes(directionId)) return true;
  if (
    directionId === "public_service" &&
    preference.excluded_sectors.some((item) => PREFERENCE_EXCLUDES_PUBLIC.has(item))
  ) {
    return true;
  }
  if (
    directionId === "further_study" &&
    preference.excluded_sectors.includes("further_study")
  ) {
    return true;
  }
  if (
    (directionId === "finance_accounting" || directionId === "data_business") &&
    preference.excluded_sectors.includes("finance") &&
    directionId === "finance_accounting"
  ) {
    return true;
  }
  if (directionId === "data_business" && preference.excluded_sectors.includes("data")) {
    return true;
  }
  if (
    (directionId === "trade_supply_chain" || directionId === "cross_border_business") &&
    preference.excluded_sectors.includes("international_business")
  ) {
    return true;
  }
  return false;
}

export function excludedDirectionReasons(
  preference: PathwayPreference
): Partial<Record<DirectionId, string>> {
  const reasons: Partial<Record<DirectionId, string>> = {};
  for (const directionId of ["trade_supply_chain", "cross_border_business", "finance_accounting", "data_business", "public_service", "further_study"] as const) {
    if (!directionExplicitlyExcluded(directionId, preference)) continue;
    reasons[directionId] =
      directionId === "public_service"
        ? "你在约束中明确排除了体制内 / 公考路线"
        : "该方向命中你设置的硬排除条件";
  }
  return reasons;
}

export function isDirectionAllowed(
  directionId: DirectionId,
  preference: PathwayPreference
): boolean {
  return !directionExplicitlyExcluded(directionId, preference);
}

/**
 * 判断路线。没有足够画像信号时仍会尊重用户已选主路线，但不会伪造排序。
 */
export function recommendPathway(
  result: AssessmentResult,
  preference: PathwayPreference
): PathwayDecision {
  const excluded: PathwayDecision["excluded"] = [];
  const publicExcluded =
    preference.excluded_sectors.includes("public_sector") ||
    preference.excluded_directions.includes("public_service");
  if (publicExcluded) {
    excluded.push({
      pathwayId: "public_exam",
      reason: "你已明确排除体制内政审类岗位或公考路线"
    });
  }
  if (preference.excluded_sectors.includes("further_study")) {
    excluded.push(
      { pathwayId: "domestic_postgraduate", reason: "你已排除继续升学路线" },
      { pathwayId: "overseas_study", reason: "你已排除继续升学路线" }
    );
  }

  const excludedIds = new Set(excluded.map((item) => item.pathwayId));
  const practice = average([
    answeredScore(result, "ability_communication"),
    answeredScore(result, "ability_execution"),
    answeredScore(result, "interest_e"),
    answeredScore(result, "interest_s")
  ]);
  const research = average([
    answeredScore(result, "ability_research"),
    answeredScore(result, "ability_writing"),
    answeredScore(result, "interest_i"),
    answeredScore(result, "interest_c")
  ]);
  const data = average([
    answeredScore(result, "ability_data"),
    answeredScore(result, "ability_digital")
  ]);

  const candidates: PathwayRecommendation[] = [];
  const userPractice = preference.practice_orientation;
  const readiness = result.readiness.band;

  if (!excludedIds.has("undergraduate_employment")) {
    const reasons: string[] = [];
    if (practice !== null) {
      reasons.push(
        practice >= 0.5
          ? "沟通协作、组织执行或推动落地的信号相对更集中，适合先用真实岗位、实习和课程项目检验。"
          : "当前实践信号不算突出，但本科就业仍可通过小规模实践继续验证，不必过早排除。"
      );
    }
    if (userPractice === "practice") {
      reasons.push("你明确表示更愿意先积累实践经历，本科就业与兼职、实习和项目反馈可以直接衔接。");
    }
    if (preference.accepts_long_internship) {
      reasons.push("你接受较长实习周期，这为本科阶段通过连续实践校正方向提供了空间。");
    }
    reasons.push("该路线能较早获得岗位反馈，并可根据反馈调整技能组合，但仍需核验目标岗位的学历门槛。");
    candidates.push({
      pathwayId: "undergraduate_employment",
      label: PATHWAY_LABELS.undergraduate_employment,
      status: "alternative",
      reasons,
      risks: ["部分岗位可能要求硕士学历或特定证书，必须按具体方向核验。", "过早定型可能压缩试错空间。"],
      preparationCost: "核心成本是持续实习、作品/项目证据和求职时间；无需为统一考试预留整段备考周期。"
    });
  }

  if (!excludedIds.has("domestic_postgraduate")) {
    const reasons: string[] = [];
    if (research !== null) {
      reasons.push(
        research >= 0.5
          ? "研究、写作或理解规则的信号可作为国内升学的比较依据，但仍需核验目标专业与考试科目。"
          : "国内升学可保留为备选，但当前研究与写作信号尚不足以支持单一路线判断。"
      );
    }
    if (userPractice === "research") reasons.push("你表示更愿意先做研究，该路线与继续学习和研究训练直接衔接。");
    reasons.push("升学能延长专业训练和进入部分学历门槛较高岗位的时间，但准备成本和机会成本较高。");
    candidates.push({
      pathwayId: "domestic_postgraduate",
      label: PATHWAY_LABELS.domestic_postgraduate,
      status: "alternative",
      reasons,
      risks: ["目标院校、专业、考试科目与招生要求逐年变化，不能以通用建议代替核验。", "需要评估数学、英语和专业课基础。"],
      preparationCost: "通常需要长期安排英语、数学/专业课复习；具体周期取决于目标院校和专业。"
    });
  }

  if (!excludedIds.has("overseas_study")) {
    const reasons: string[] = [];
    if ((answeredScore(result, "ability_writing") ?? 0) >= 0.5) {
      reasons.push("写作与英语相关信号可作为境外申请材料的起点，但仍需核验语言、预算和项目要求。");
    }
    if (preference.target_cities.length > 0) {
      reasons.push(`你填写的城市约束是「${preference.target_cities.join("、")}」，需要同时比较境外学习后的回流地点与岗位机会。`);
    }
    reasons.push("该路线需要更早核对语言考试、费用、项目资格和录取要求，当前只能作为待确认备选。");
    candidates.push({
      pathwayId: "overseas_study",
      label: PATHWAY_LABELS.overseas_study,
      status: "alternative",
      reasons,
      risks: ["费用、签证和项目资格变化较大。", "需要核实目标地区与院校的官方要求。"],
      preparationCost: "通常包括语言考试、课程匹配、申请材料与财务准备；首版不提供录取概率。"
    });
  }

  if (!excludedIds.has("public_exam")) {
    const reasons: string[] = [];
    if ((answeredScore(result, "ability_execution") ?? 0) >= 0.5) {
      reasons.push("组织执行与规则性任务的自评可作为了解公共事务工作的一个线索。");
    }
    reasons.push("只有在用户未排除体制内方向时才保留该路线；具体岗位必须核对专业、地区和政审要求。");
    candidates.push({
      pathwayId: "public_exam",
      label: PATHWAY_LABELS.public_exam,
      status: "alternative",
      reasons,
      risks: ["岗位资格、专业目录和竞争条件逐年变化，不能使用通用结论代替公告核验。"],
      preparationCost: "需要按目标地区和岗位长期准备公共科目与面试，具体规则以当年公告为准。"
    });
  }

  if (candidates.length === 0) {
    return {
      leading: null,
      alternatives: [],
      excluded,
      explanation: ["当前约束同时排除了所有可用主路线，请回到自我探索重新确认至少一条可接受路线。"],
      rulesVersion: PATHWAY_RULES_VERSION
    };
  }

  const preferencePrimary = candidates.find((item) => item.pathwayId === preference.primary);
  const scored = candidates
    .map((candidate, index) => {
      let score = 0;
      if (candidate.pathwayId === "undergraduate_employment") {
        score += practice ?? 0.35;
        if (userPractice === "practice") score += 0.35;
        if (readiness !== "exploring") score += 0.1;
      }
      if (candidate.pathwayId === "domestic_postgraduate") {
        score += research ?? 0.3;
        if (userPractice === "research") score += 0.35;
      }
      if (candidate.pathwayId === "overseas_study") {
        score += answeredScore(result, "ability_writing") ?? 0.3;
        score += preference.target_cities.length > 0 ? 0.05 : 0;
      }
      if (candidate.pathwayId === "public_exam") {
        score += answeredScore(result, "ability_execution") ?? 0.3;
      }
      if (preferencePrimary?.pathwayId === candidate.pathwayId) score += 0.45;
      if (preference.alternatives.includes(candidate.pathwayId)) score += 0.15;
      return { candidate, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const leading = { ...scored[0].candidate, status: "leading" as const };
  const alternatives = scored.slice(1, 3).map((entry) => ({
    ...entry.candidate,
    status: "alternative" as const
  }));
  const explanation = [
    `主路线先由你的明确约束过滤，再比较兴趣、能力自评、实践偏好与准备成本；规则版本 ${PATHWAY_RULES_VERSION}。`,
    preference.primary === "undetermined"
      ? "你暂时选择“仍不确定”，所以系统先给出比较顺序，并把下一步限定为低成本的核验动作。"
      : `你填写的主路线为「${PATHWAY_LABELS[preference.primary]}」；系统会把它作为比较起点，但仍保留可调整的备选路线。`,
    "路线建议不是录取、考试或就业承诺；学历门槛、预算和考试要求仍需按官方资料核验。"
  ];

  return {
    leading,
    alternatives,
    excluded,
    explanation,
    rulesVersion: PATHWAY_RULES_VERSION
  };
}
