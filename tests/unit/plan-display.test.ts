import { describe, expect, it } from "vitest";
import {
  formatPlanWarning,
  formatPlanWarnings,
  isVerifyDataAction,
  summarizeDataGaps,
  summarizeEffort
} from "@/lib/plan-display";
import type { PlanAction } from "@/lib/contracts/plan";

function action(overrides: Partial<PlanAction> & Pick<PlanAction, "action_id">): PlanAction {
  return {
    action_id: overrides.action_id,
    title: overrides.title ?? "示例行动",
    direction_id: "trade_supply_chain",
    window: overrides.window ?? "current_term",
    effort: overrides.effort ?? { hours: null, basis: "unknown" },
    prerequisites: [],
    evidence_ids: [],
    rule_id: overrides.rule_id ?? null,
    rules_version: overrides.rules_version ?? "rules-2026-10-19",
    status: overrides.status ?? "suggested",
    user_adjusted: false
  } as PlanAction;
}

describe("formatPlanWarning", () => {
  it("把校验型回退翻成中文，不再显示 internal_error", () => {
    const text = formatPlanWarning("plan_explanation_fallback:validation");
    expect(text).toContain("未通过引用/数字校验");
    expect(text).not.toContain("internal_error");
  });

  it("区分模型不可用与校验失败", () => {
    expect(formatPlanWarning("plan_explanation_fallback:model_unavailable")).toContain("模型暂时不可用");
    expect(formatPlanWarning("plan_explanation_fallback:validation")).toContain("回退为确定性说明");
  });

  it("未知回退码保留原码，方便排查", () => {
    expect(formatPlanWarning("plan_explanation_fallback:weird_code")).toContain("weird_code");
  });

  it("翻译规则版本与缺口码", () => {
    expect(formatPlanWarning("rules_version=rules-2026-10-19")).toBe("规则版本：rules-2026-10-19");
    expect(formatPlanWarning("as_of=2026-10-19")).toBe("规则基准日：2026-10-19");
    expect(formatPlanWarning("course_credits_missing=c1,c2")).toContain("c1,c2");
  });

  it("未识别的普通文本原样返回", () => {
    expect(formatPlanWarning("something else")).toBe("something else");
  });
});

describe("formatPlanWarnings", () => {
  it("按翻译结果去重并丢弃空串", () => {
    const result = formatPlanWarnings([
      "plan_explanation_fallback:validation",
      "plan_explanation_fallback:validation",
      "  ",
      "rules_version=v1"
    ]);
    expect(result).toHaveLength(2);
    expect(result[1]).toBe("规则版本：v1");
  });
});

describe("summarizeEffort", () => {
  it("没有行动项时显示短横线", () => {
    expect(summarizeEffort([]).value).toBe("—");
  });

  it("工时全部未知时显示未估算，而不是 0 小时", () => {
    const summary = summarizeEffort([
      action({ action_id: "a1" }),
      action({ action_id: "a2" })
    ]);
    expect(summary.value).toBe("未估算");
    expect(summary.value).not.toContain("0 小时");
    expect(summary.note).toContain("2 项");
  });

  it("已知工时求和，并说明未知项未计入", () => {
    const summary = summarizeEffort([
      action({ action_id: "a1", effort: { hours: 3, basis: "team_estimate" } }),
      action({ action_id: "a2", effort: { hours: 4.5, basis: "team_estimate" } }),
      action({ action_id: "a3" })
    ]);
    expect(summary.value).toBe("7.5 小时");
    expect(summary.note).toContain("1 项");
  });

  it("全部已知时不提示未知项", () => {
    const summary = summarizeEffort([action({ action_id: "a1", effort: { hours: 2, basis: "team_estimate" } })]);
    expect(summary.value).toBe("2 小时");
    expect(summary.note).not.toContain("未知");
  });
});

describe("资料缺口行动", () => {
  it("按 rule_id 识别核对行动", () => {
    expect(isVerifyDataAction(action({ action_id: "verify-curriculum", rule_id: "career-rule-verify-data" }))).toBe(
      true
    );
    expect(isVerifyDataAction(action({ action_id: "req-1", rule_id: "career-rule-direction-requirement" }))).toBe(
      false
    );
  });

  it("统计缺口行动数量与标题", () => {
    const summary = summarizeDataGaps([
      action({ action_id: "v1", rule_id: "career-rule-verify-data", title: "核对培养方案" }),
      action({ action_id: "v2", rule_id: "career-rule-verify-data", title: "核对竞赛目录" }),
      action({ action_id: "r1", rule_id: "career-rule-direction-requirement", title: "补强能力：数据分析" })
    ]);
    expect(summary.total).toBe(3);
    expect(summary.verifyCount).toBe(2);
    expect(summary.titles).toEqual(["核对培养方案", "核对竞赛目录"]);
  });
});
