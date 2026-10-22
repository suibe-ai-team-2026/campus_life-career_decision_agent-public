import type { PlanAction } from "@/lib/contracts/plan";

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
    pattern: /^boundary_note_dropped_number_mismatch$/,
    render: () => "资料边界说明里出现了证据中没有的数字，已丢弃该说明。"
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
  { pattern: /^profile_invalid:(.*)$/, render: (match) => `画像字段不完整：${match[1]}` }
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
