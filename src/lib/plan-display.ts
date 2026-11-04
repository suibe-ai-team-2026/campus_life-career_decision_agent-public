import type { PlanAction, PlanAnalysis, PlanResult } from "@/lib/contracts/plan";

/**
 * 把 worker 写入的机器可读 warning 翻成用户能看懂的一句中文。
 *
 * 约定：worker 只写短码（如 ``plan_explanation_fallback:validation``），
 * 不写自由文本；未识别的码原样返回，保留可追溯性，不吞掉信息。
 */
const EXPLANATION_FALLBACK_TEXT: Record<string, string> = {
  validation:
    "AI 解释未通过引用/数字校验，已回退为确定性说明。行动、课程与学分仍来自规则结果，未做任何修改。",
  model_unavailable: "生成解释时模型暂时不可用，已回退为确定性说明。方案事实未改变。",
  model_timeout: "生成解释时模型超时，已回退为确定性说明。方案事实未改变。",
  model_auth_failed: "模型凭证不可用，本次跳过解释；方案事实未改变。",
  model_quota_exceeded: "模型额度已用尽，本次跳过解释；方案事实未改变。",
  budget_exceeded: "本次运行预算已用尽，已跳过解释；方案事实未改变。",
  internal_error: "生成解释时发生未预期的异常，已回退为确定性说明。方案事实未改变。"
};

const ANALYSIS_FALLBACK_TEXT: Record<string, string> = {
  validation: "AI 方向分析未通过引用/数字校验，已跳过该部分；路线、行动和资料线索未改变。",
  model_unavailable: "生成方向分析时模型暂时不可用，已跳过该部分；确定性方案未改变。",
  model_timeout: "生成方向分析时模型超时，已跳过该部分；确定性方案未改变。",
  model_auth_failed: "模型凭证不可用，本次跳过方向分析；确定性方案未改变。",
  model_quota_exceeded: "模型额度已用尽，本次跳过方向分析；确定性方案未改变。",
  budget_exceeded: "本次运行预算已用尽，已跳过方向分析；确定性方案未改变。",
  internal_error: "生成方向分析时发生未预期的异常，已跳过该部分；确定性方案未改变。"
};

type WarningRule = {
  pattern: RegExp;
  render: (match: RegExpMatchArray) => string;
};

const WARNING_RULES: WarningRule[] = [
  {
    pattern: /^plan_explanation_fallback:(.+)$/,
    render: (match) =>
      EXPLANATION_FALLBACK_TEXT[match[1] ?? ""] ??
      `生成解释失败（${match[1]}），已回退为确定性说明。方案事实未改变。`
  },
  {
    pattern: /^plan_analysis_fallback:(.+)$/,
    render: (match) =>
      ANALYSIS_FALLBACK_TEXT[match[1] ?? ""] ??
      `生成方向分析失败（${match[1]}），已跳过该部分。确定性方案未改变。`
  },
  {
    pattern: /^boundary_note_dropped_number_mismatch$/,
    render: () => "资料边界说明里出现了证据中没有的数字，已丢弃该说明。"
  },
  {
    pattern: /^plan_id_not_found_created_new$/,
    render: () => "本地记录里的旧方案已不存在，已改为新建方案版本；旧方案不会恢复。"
  },
  { pattern: /^rules_version=(.+)$/, render: (match) => `规则版本：${match[1]}` },
  { pattern: /^as_of=(.+)$/, render: (match) => `规则基准日：${match[1]}` },
  {
    pattern: /^dangling_prerequisite_ids:(.*)$/,
    render: (match) => `先修课程引用了未核验的课程：${match[1]}`
  },
  {
    pattern: /^course_credits_missing:(.*)$/,
    render: (match) => `部分已核验课程缺学分：${match[1]}`
  },
  {
    pattern: /^prerequisite_cycle_detected:(.*)$/,
    render: (match) => `先修关系出现环，已标记待核验：${match[1]}`
  },
  { pattern: /^profile_invalid:(.*)$/, render: (match) => `画像字段不完整：${match[1]}` },
  {
    pattern: /^user_sources_included:(\d+)$/,
    render: (match) =>
      `已把你上传的 ${match[1]} 条资料并入方案证据，引用编号从 1 开始重排；这些资料标注为待核验来源。`
  }
];

export function formatPlanWarning(warning: string): string {
  const text = warning.trim();
  if (!text) return "";
  for (const rule of WARNING_RULES) {
    const match = text.match(rule.pattern);
    if (match) return rule.render(match);
  }
  return text;
}

export function formatPlanWarnings(warnings: readonly string[]): string[] {
  const seen = new Set<string>();
  const formatted: string[] = [];
  for (const warning of warnings) {
    const text = formatPlanWarning(warning);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    formatted.push(text);
  }
  return formatted;
}

/**
 * Worker 的路线焦点应使用路线标签，但旧结果会把“仍不确定”直接嵌入
 * “完成申请或求职证据链”的句式，读起来像已经确定了兑现方式。
 */
export function formatRoadmapFocus(focus: string): string {
  const text = focus.trim();
  if (
    text === "围绕「仍不确定」完成申请或求职证据链" ||
    text === "围绕「undetermined」完成申请或求职证据链"
  ) {
    return "先比较路线，再准备申请或求职证据";
  }
  return text;
}

type FallbackDirection = {
  title: string;
  summary: string;
  work_content: string[];
  verified_skills: string[];
  preparation_cost: string;
  applicability: string;
};

const INLINE_WINDOW_LABELS: Record<PlanAction["window"], string> = {
  current_term: "当前学期",
  next_term: "下学期",
  later: "更晚阶段"
};

function compactText(value: string | null | undefined, maxLength: number): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).replace(/[，；、。\s]+$/, "")}…`;
}

/**
 * When the worker cannot safely return its richer AI analysis, keep the panel
 * useful with facts the plan already contains. This is deliberately labelled
 * as a rules fallback and never invents a profile match.
 */
export function buildRuleFallbackAnalysis(
  direction: FallbackDirection,
  result: Pick<PlanResult, "actions" | "gaps" | "explanation" | "roadmap">
): PlanAnalysis {
  const actions = result.actions.slice(0, 6);
  const overviewParts = [
    `当前方向是“${direction.title}”。`,
    direction.summary,
    direction.work_content.length > 0 ? `常见工作包括：${direction.work_content.slice(0, 4).join("、")}。` : "",
    direction.verified_skills.length > 0
      ? `可以先验证的能力：${direction.verified_skills.slice(0, 4).join("、")}。`
      : ""
  ];
  const ruleExplanation = compactText(result.explanation, 420);
  const gapRisks = result.gaps.map((gap) => gap.message).filter(Boolean).slice(0, 4);
  const topActions = result.roadmap.find((stage) => stage.stage === "未来 30 天")?.actions ?? [];
  const nextSteps = (topActions.length > 0 ? topActions : actions.map((action) => action.title))
    .filter(Boolean)
    .slice(0, 4);

  return {
    overview: overviewParts.filter(Boolean).join(" "),
    match:
      ruleExplanation ||
      `当前方案已按你的暂定方向“${direction.title}”生成可执行路线。本次没有可安全展示的画像匹配文本，因此不补写推断结论；请先通过下方行动收集自己的真实反馈。`,
    action_rationale: actions.map((action) => {
      const prerequisites =
        action.prerequisites.length > 0
          ? ` 开始前先核对：${action.prerequisites.slice(0, 2).join("；")}。`
          : "";
      return `“${action.title}”安排在${INLINE_WINDOW_LABELS[action.window]}；${prerequisites || "执行后保留课程作业、项目记录或反馈作为复核依据。"}`;
    }),
    evidence_courses: [],
    evidence_competitions: [],
    risks:
      gapRisks.length > 0
        ? gapRisks
        : ["本次结构化资料有限，课程、报名资格与时间安排仍需以学校和官方最新通知核对。"],
    next_steps: nextSteps,
    citation_numbers: [],
    boundary_note: `以上为方向“${direction.title}”的规则化摘要，不是 AI 画像匹配结论；准备成本与适用范围：${compactText(
      direction.preparation_cost || direction.applicability,
      180
    )}`
  };
}

/** 规则引擎在"资料缺口"时生成的核对行动；它们不是课程，也不带工时。 */
export const VERIFY_DATA_RULE_ID = "career-rule-verify-data";

export function isVerifyDataAction(action: Pick<PlanAction, "rule_id">): boolean {
  return action.rule_id === VERIFY_DATA_RULE_ID;
}

export type EffortSummary = { value: string; note: string };

/**
 * 汇总预计投入。全部工时未知时显示"未估算"而不是 0——把"不知道"显示成
 * 0 小时会被读成"这件事不花时间"。
 */
export function summarizeEffort(actions: readonly Pick<PlanAction, "effort">[]): EffortSummary {
  if (actions.length === 0) return { value: "—", note: "本次没有行动项" };
  const known = actions.reduce((sum, action) => sum + (action.effort.hours ?? 0), 0);
  const unknownCount = actions.filter((action) => action.effort.hours === null).length;
  if (known === 0 && unknownCount > 0) {
    return { value: "未估算", note: `${unknownCount} 项行动的工时未知，待按项填写` };
  }
  const rounded = Math.round(known * 10) / 10;
  return {
    value: `${rounded} 小时`,
    note: unknownCount > 0 ? `另有 ${unknownCount} 项工时未知，未计入总数` : "机器估计，可在下方按项修改"
  };
}

/** 资料缺口行动按时间窗去重后的台账，用于空态展示。 */
export function summarizeDataGaps(
  actions: readonly Pick<PlanAction, "action_id" | "title" | "rule_id" | "window">[]
): { total: number; verifyCount: number; titles: string[] } {
  const verify = actions.filter(isVerifyDataAction);
  return {
    total: actions.length,
    verifyCount: verify.length,
    titles: verify.map((action) => action.title)
  };
}
