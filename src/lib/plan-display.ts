import type { PlanAction, PlanAnalysis, PlanResult } from "@/lib/contracts/plan";

/**
 * 把 worker 写入的机器可读 warning 翻成用户能看懂的一句中文。
 *
 * 约定：worker 只写短码（如 ``plan_explanation_fallback:validation``），
 * 不写自由文本；未识别的码原样返回，保留可追溯性，不吞掉信息。
 */
const EXPLANATION_FALLBACK_TEXT: Record<string, string> = {
  validation:
    "本次解释已按规则事实重排，引用编号可逐条回溯。行动、课程与学分仍来自规则结果，未做任何修改。",
  model_unavailable: "本次解释由规则事实生成。行动、课程与学分未做修改。",
  model_timeout: "本次解释由规则事实生成。行动、课程与学分未做修改。",
  model_auth_failed: "本次解释由规则事实生成。行动、课程与学分未做修改。",
  model_quota_exceeded: "本次解释由规则事实生成。行动、课程与学分未做修改。",
  budget_exceeded: "本次解释由规则事实生成。行动、课程与学分未做修改。",
  internal_error: "本次解释由规则事实生成。行动、课程与学分未做修改。"
};

const ANALYSIS_FALLBACK_TEXT: Record<string, string> = {
  validation: "本次方向分析采用规则摘要；路线、行动与资料线索保持原样。",
  model_output_invalid: "本次方向分析由规则事实与画像补全；路线、行动与资料线索保持原样。",
  model_unavailable: "本次方向分析由规则事实生成；确定性方案保持不变。",
  model_timeout: "本次方向分析由规则事实生成；确定性方案保持不变。",
  model_auth_failed: "本次方向分析由规则事实生成；确定性方案保持不变。",
  model_quota_exceeded: "本次方向分析由规则事实生成；确定性方案保持不变。",
  budget_exceeded: "本次方向分析由规则事实生成；确定性方案保持不变。",
  internal_error: "本次方向分析由规则事实生成；确定性方案保持不变。"
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
      `本次解释采用规则摘要（${match[1]}）。方案事实未改变。`
  },
  {
    pattern: /^plan_analysis_fallback:(.+)$/,
    render: (match) =>
      ANALYSIS_FALLBACK_TEXT[match[1] ?? ""] ??
      `本次方向分析采用规则摘要（${match[1]}）。确定性方案未改变。`
  },
  {
    pattern: /^boundary_note_dropped_number_mismatch$/,
    render: () => "本次适用范围说明按证据重写，未采用无证据数字。"
  },
  {
    pattern: /^web_research_fallback:(.+)$/,
    render: () =>
      "本次方案依据已收录资料与规则事实生成；联网补充可在资料库单独发起。"
  },
  {
    pattern: /^plan_id_not_found_created_new$/,
    render: () => "旧方案已失效，本次新建了一版方案。"
  },
  { pattern: /^rules_version=(.+)$/, render: (match) => `规则版本：${match[1]}` },
  { pattern: /^as_of=(.+)$/, render: (match) => `规则基准日：${match[1]}` },
  {
    pattern: /^dangling_prerequisite_ids:(.*)$/,
    render: (match) => `先修课程在培养方案里核对：${match[1]}`
  },
  {
    pattern: /^course_credits_missing:(.*)$/,
    render: (match) => `课程学分按培养方案核对：${match[1]}`
  },
  {
    pattern: /^prerequisite_cycle_detected:(.*)$/,
    render: (match) => `先修关系需要人工确认（检测到循环引用）：${match[1]}`
  },
  { pattern: /^profile_invalid:(.*)$/, render: (match) => `画像这几项需要确认：${match[1]}` },
  {
    pattern: /^user_sources_included:(\d+)$/,
    render: (match) =>
      `已把你上传的 ${match[1]} 条资料并入方案证据，引用编号从 1 开始重排。`
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
      `当前方案已按你的暂定方向“${direction.title}”生成可执行路线；先按下方行动执行，用真实反馈校正画像。`,
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
        : ["课程、报名资格与时间安排按学校和学院最新通知确定。"],
    next_steps: nextSteps,
    citation_numbers: [],
    boundary_note: `方向“${direction.title}”的规则化摘要。适用范围：${compactText(
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
    return { value: "未估算", note: `${unknownCount} 项行动的工时可按项填写` };
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
