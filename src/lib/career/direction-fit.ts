/**
 * 方向 ↔ 画像信号映射（产品规则，版本化）。
 *
 * 这里是**产品规则**，不是外部事实：
 * - 权重只依据方向卡 `work_content` / `verified_skills` / `preparation_cost`
 *   的字面语义，表示「该方向的工作任务与这类活动偏好的相关程度」，
 *   不表示任何人的胜任概率，也不引用就业率、薪资或通过率。
 * - `interestLinks` / `abilityLinks` / `valueLinks` / `workStyleLinks` 的值
 *   必须逐字取自对应方向卡的 `work_content` 或 `verified_skills`，用于让
 *   推荐理由可以回指到真实字段；由 `tests/unit/recommend.test.ts` 校验。
 * - 规则变更时同步递增 `DIRECTION_FIT_RULES_VERSION`，并保留旧版本可追溯。
 *
 * 计分权重含义（0–2）：
 * - 0：方向卡没有对应任务/技能线索；
 * - 1：方向卡有间接或部分相关线索；
 * - 2：方向卡把这类任务/技能列为直接工作内容或已核技能。
 */
import type { AbilityKey, InterestKey } from "@/lib/assessment/scoring";
import type { DirectionId } from "@/lib/contracts/common";
import { DIRECTION_IDS } from "@/lib/contracts/common";

export const DIRECTION_FIT_RULES_VERSION = "direction-fit-2026-10-27";

/** 版本化映射的公开说明（UI 可直接展示）。 */
export const DIRECTION_FIT_METHOD =
  "映射依据方向卡的工作内容、已核技能与准备成本字段：兴趣权重 0–2 表示该方向任务与活动偏好的相关程度，能力权重 0–2 表示该方向已核技能与自评维度的相关程度。它只用于挑选值得比较的方向，不做匹配打分。";

export type DirectionFitWeight = 0 | 1 | 2;

export type DirectionFitRule = {
  directionId: DirectionId;
  /** 0–2 的兴趣权重，只对应已作答的兴趣信号；未知不按 0 计。 */
  interests: Partial<Record<InterestKey, DirectionFitWeight>>;
  /** 0–2 的能力权重，只对应已完成的能力自评；未知不按 0 计。 */
  abilities: Partial<Record<AbilityKey, DirectionFitWeight>>;
  /** 方向卡语义对应的偏好价值（只用于解释环境偏好，不参与排序）。 */
  values: string[];
  /** 方向卡语义对应的工作方式选项（只用于解释任务偏好，不参与排序）。 */
  workStyles: {
    /** w_approach 的选项 id。 */
    approach: string[];
    /** w_team 的选项 id。 */
    team: string[];
  };
  /** 该方向最需要在推荐里说明证据状态的能力（用于生成「待补足」）。 */
  keyEvidenceAbilities: AbilityKey[];
  /** 兴趣 key → 方向卡 `work_content` 原文。 */
  interestLinks: Partial<Record<InterestKey, string>>;
  /** 能力 key → 方向卡 `verified_skills` 原文。 */
  abilityLinks: Partial<Record<AbilityKey, string>>;
  /** 价值 key → 方向卡 `work_content` 原文。 */
  valueLinks: Record<string, string>;
  /** 工作方式选项 id → 方向卡 `work_content` 原文。 */
  workStyleLinks: Record<string, string>;
  /** 映射说明（供评审与页面解释使用，不是外部事实）。 */
  basisNote: string;
};

const RULES: Record<DirectionId, DirectionFitRule> = {
  trade_supply_chain: {
    directionId: "trade_supply_chain",
    // 客户跟进、单证、物流关务与库存协同：社会/企业/常规信号最强，
    // 「操作或改进具体流程」对应实践信号。
    interests: { r: 1, i: 1, s: 2, e: 2, c: 2 },
    abilities: {
      research: 1,
      data: 1,
      writing: 1,
      communication: 2,
      execution: 2,
      digital: 1
    },
    values: ["stability", "collaboration", "growth"],
    workStyles: {
      approach: ["info_first", "clear_process"],
      team: ["coordinate", "communicate", "follow_process"]
    },
    keyEvidenceAbilities: ["communication", "execution"],
    interestLinks: {
      r: "国际物流与关务协调",
      i: "供应商与库存协同",
      s: "客户与订单跟进",
      e: "国际物流与关务协调",
      c: "报价、合同与单证"
    },
    abilityLinks: {
      research: "国际贸易实务",
      data: "Excel 数据处理",
      writing: "英语读写与商务沟通",
      communication: "英语读写与商务沟通",
      execution: "单证与流程意识",
      digital: "Excel 数据处理"
    },
    valueLinks: {
      stability: "报价、合同与单证",
      collaboration: "供应商与库存协同",
      growth: "客户与订单跟进"
    },
    workStyleLinks: {
      info_first: "报价、合同与单证",
      clear_process: "报价、合同与单证",
      coordinate: "国际物流与关务协调",
      communicate: "客户与订单跟进",
      follow_process: "报价、合同与单证",
      research: "供应商与库存协同"
    },
    basisNote:
      "依据方向卡的客户跟进、单证合同、物流关务与供应商协同任务，以及「英语读写与商务沟通」「单证与流程意识」「Excel 数据处理」等已核技能。"
  },
  cross_border_business: {
    directionId: "cross_border_business",
    // 平台运营与内容优化：创意/企业/研究信号为主，广告复盘对应常规信号。
    interests: { i: 2, a: 2, s: 1, e: 2, c: 1 },
    abilities: {
      research: 2,
      data: 2,
      writing: 2,
      communication: 1,
      execution: 1,
      digital: 1
    },
    values: ["growth", "autonomy", "collaboration"],
    workStyles: {
      approach: ["try_first", "info_first"],
      team: ["create", "communicate", "research"]
    },
    keyEvidenceAbilities: ["data", "writing"],
    interestLinks: {
      i: "选品与市场调研",
      a: "listing 与内容优化",
      s: "跨境平台店铺运营",
      e: "跨境平台店铺运营",
      c: "广告投放与数据复盘"
    },
    abilityLinks: {
      research: "平台规则理解",
      data: "数据分析基础",
      writing: "英文产品文案",
      communication: "跨部门沟通",
      execution: "平台规则理解",
      digital: "数据分析基础"
    },
    valueLinks: {
      growth: "选品与市场调研",
      autonomy: "跨境平台店铺运营",
      collaboration: "广告投放与数据复盘"
    },
    workStyleLinks: {
      try_first: "广告投放与数据复盘",
      info_first: "选品与市场调研",
      create: "listing 与内容优化",
      communicate: "listing 与内容优化",
      research: "选品与市场调研",
      coordinate: "跨境平台店铺运营"
    },
    basisNote:
      "依据方向卡的平台运营、选品调研、listing 内容与广告复盘任务，以及「平台规则理解」「英文产品文案」「数据分析基础」「跨部门沟通」等已核技能。"
  },
  finance_accounting: {
    directionId: "finance_accounting",
    // 核算、审计内控、客户服务与风险控制：常规/研究信号为主，服务与推动为辅。
    interests: { i: 2, s: 1, e: 1, c: 2 },
    abilities: {
      research: 1,
      data: 2,
      writing: 1,
      communication: 1,
      execution: 2,
      digital: 1
    },
    values: ["stability", "growth", "collaboration"],
    workStyles: {
      approach: ["info_first", "clear_process"],
      team: ["research", "follow_process", "coordinate"]
    },
    keyEvidenceAbilities: ["data", "execution"],
    interestLinks: {
      i: "数据分析与风险控制",
      s: "金融产品与客户服务",
      e: "金融产品与客户服务",
      c: "财务核算与报表"
    },
    abilityLinks: {
      research: "会计与财务基础",
      data: "Excel/数据处理",
      writing: "沟通与书面表达",
      communication: "沟通与书面表达",
      execution: "严谨与合规意识",
      digital: "Excel/数据处理"
    },
    valueLinks: {
      stability: "审计与内控",
      growth: "财务核算与报表",
      collaboration: "金融产品与客户服务"
    },
    workStyleLinks: {
      info_first: "财务核算与报表",
      clear_process: "审计与内控",
      research: "数据分析与风险控制",
      communicate: "金融产品与客户服务",
      coordinate: "审计与内控",
      follow_process: "审计与内控"
    },
    basisNote:
      "依据方向卡的核算报表、审计内控、客户服务与风险控制任务，以及「会计与财务基础」「Excel/数据处理」「严谨与合规意识」「沟通与书面表达」等已核技能。"
  },
  data_business: {
    directionId: "data_business",
    // 取数清洗、实验评估与可视化：研究/常规最强，创意与企业/社会信号用于表达与决策支持。
    interests: { r: 1, i: 2, a: 1, s: 1, e: 1, c: 2 },
    abilities: {
      research: 2,
      data: 2,
      writing: 1,
      communication: 1,
      execution: 1,
      digital: 2
    },
    values: ["growth", "autonomy", "influence"],
    workStyles: {
      approach: ["info_first", "try_first"],
      team: ["research", "communicate", "create"]
    },
    keyEvidenceAbilities: ["data", "digital"],
    interestLinks: {
      r: "SQL 取数与清洗",
      i: "业务分析与实验评估",
      a: "可视化与汇报",
      s: "可视化与汇报",
      e: "业务分析与实验评估",
      c: "指标与报表设计"
    },
    abilityLinks: {
      research: "业务理解与表达",
      data: "统计与概率基础",
      writing: "业务理解与表达",
      communication: "业务理解与表达",
      execution: "SQL",
      digital: "Excel/可视化"
    },
    valueLinks: {
      growth: "业务分析与实验评估",
      autonomy: "指标与报表设计",
      influence: "可视化与汇报"
    },
    workStyleLinks: {
      info_first: "业务分析与实验评估",
      try_first: "SQL 取数与清洗",
      research: "指标与报表设计",
      communicate: "可视化与汇报",
      create: "指标与报表设计",
      coordinate: "SQL 取数与清洗"
    },
    basisNote:
      "依据方向卡的指标报表、SQL 取数清洗、业务分析与可视化汇报任务，以及「SQL」「统计与概率基础」「Excel/可视化」「业务理解与表达」等已核技能。"
  },
  public_service: {
    directionId: "public_service",
    // 政策执行、基层治理与文字材料：社会/常规最强，企业信号对应项目协调。
    interests: { i: 1, s: 2, e: 1, c: 2 },
    abilities: {
      research: 1,
      writing: 2,
      communication: 2,
      execution: 2
    },
    values: ["stability", "collaboration", "influence"],
    workStyles: {
      approach: ["info_first", "clear_process"],
      team: ["coordinate", "communicate", "follow_process"]
    },
    keyEvidenceAbilities: ["writing", "communication", "execution"],
    interestLinks: {
      i: "公共事务与政策执行",
      s: "基层服务与治理",
      e: "公共服务项目管理",
      c: "文字材料与沟通协调"
    },
    abilityLinks: {
      research: "公共事务基础",
      writing: "政策理解与文字表达",
      communication: "组织协调",
      execution: "组织协调"
    },
    valueLinks: {
      stability: "公共事务与政策执行",
      collaboration: "基层服务与治理",
      influence: "公共服务项目管理"
    },
    workStyleLinks: {
      info_first: "公共事务与政策执行",
      clear_process: "公共事务与政策执行",
      discuss_first: "文字材料与沟通协调",
      coordinate: "公共服务项目管理",
      communicate: "文字材料与沟通协调",
      follow_process: "公共服务项目管理",
      research: "公共事务与政策执行"
    },
    basisNote:
      "依据方向卡的公共事务与政策执行、基层服务、文字材料与项目管理任务，以及「政策理解与文字表达」「公共事务基础」「组织协调」等已核技能。"
  },
  further_study: {
    directionId: "further_study",
    // 科研训练、课程绩点与申请材料：研究/创意最强，材料管理对应常规信号。
    interests: { i: 2, a: 1, s: 1, c: 1 },
    abilities: {
      research: 2,
      data: 1,
      writing: 2,
      communication: 1,
      execution: 1
    },
    values: ["growth", "autonomy", "influence"],
    workStyles: {
      approach: ["info_first", "discuss_first"],
      team: ["research", "communicate"]
    },
    keyEvidenceAbilities: ["research", "writing"],
    interestLinks: {
      i: "科研/项目训练",
      a: "科研/项目训练",
      s: "导师与项目匹配",
      c: "语言考试与申请材料"
    },
    abilityLinks: {
      research: "研究或项目经历",
      data: "专业基础",
      writing: "学术阅读与写作",
      execution: "时间与材料管理"
    },
    valueLinks: {
      growth: "科研/项目训练",
      autonomy: "课程与绩点管理",
      influence: "导师与项目匹配"
    },
    workStyleLinks: {
      info_first: "科研/项目训练",
      discuss_first: "导师与项目匹配",
      research: "课程与绩点管理",
      communicate: "语言考试与申请材料",
      follow_process: "语言考试与申请材料"
    },
    basisNote:
      "依据方向卡的科研项目训练、课程绩点管理、语言考试与申请材料、导师匹配任务，以及「专业基础」「学术阅读与写作」「研究或项目经历」「时间与材料管理」等已核技能。"
  }
};

/** 按方向卡 seed 顺序排列的规则列表（排序稳定性依赖这个顺序）。 */
export const DIRECTION_FIT_RULE_LIST: DirectionFitRule[] = DIRECTION_IDS.map(
  (directionId) => RULES[directionId]
);

export const DIRECTION_FIT_RULES: Readonly<Record<DirectionId, DirectionFitRule>> = RULES;

export function getDirectionFitRule(directionId: DirectionId): DirectionFitRule {
  return RULES[directionId];
}

/** 兴趣 key 的稳定顺序，供排序与去重使用（与问卷 order 一致）。 */
export const FIT_INTEREST_ORDER: readonly InterestKey[] = ["r", "i", "a", "s", "e", "c"];
