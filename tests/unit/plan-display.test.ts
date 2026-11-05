import { describe, expect, it } from "vitest";
import {
  buildRuleFallbackAnalysis,
  formatPlanWarning,
  formatPlanWarnings,
  formatRoadmapFocus,
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
    expect(text).toContain("规则事实重排");
    expect(text).toContain("可逐条回溯");
    expect(text).not.toContain("internal_error");
  });

  it("区分模型不可用与校验失败", () => {
    expect(formatPlanWarning("plan_explanation_fallback:model_unavailable")).toContain("规则事实生成");
    expect(formatPlanWarning("plan_explanation_fallback:validation")).toContain("规则事实重排");
    expect(formatPlanWarning("plan_analysis_fallback:validation")).toContain("方向分析采用规则摘要");
  });

  it("未知回退码保留原码，方便排查", () => {
    expect(formatPlanWarning("plan_explanation_fallback:weird_code")).toContain("weird_code");
  });

  it("翻译规则版本与核对项", () => {
    expect(formatPlanWarning("rules_version=rules-2026-10-19")).toBe("规则版本：rules-2026-10-19");
    expect(formatPlanWarning("as_of=2026-10-19")).toBe("规则基准日：2026-10-19");
    expect(formatPlanWarning("course_credits_missing=c1,c2")).toContain("c1,c2");
  });

  it("旧方案 id 失效时给出可读说明", () => {
    expect(formatPlanWarning("plan_id_not_found_created_new")).toContain("新建了一版方案");
  });

  it("联网补充未启用时给出说明，不显示机器码", () => {
    const text = formatPlanWarning("web_research_fallback:model_timeout");
    expect(text).toContain("已收录资料与规则事实");
    expect(text).not.toContain("model_timeout");
  });

  it("用户上传资料并入证据时不再原样显示机器码", () => {
    const text = formatPlanWarning("user_sources_included:1");
    expect(text).toContain("你上传的 1 条资料");
    expect(text).not.toContain("user_sources_included");
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

describe("formatRoadmapFocus", () => {
  it("不把仍不确定写成已经确定的路线兑现方式", () => {
    expect(formatRoadmapFocus("围绕「仍不确定」完成申请或求职证据链")).toBe(
      "先比较路线，再准备申请或求职证据"
    );
    expect(formatRoadmapFocus("围绕「undetermined」完成申请或求职证据链")).toBe(
      "先比较路线，再准备申请或求职证据"
    );
  });

  it("保留已经明确的路线文案", () => {
    expect(formatRoadmapFocus("围绕「本科就业」完成申请或求职证据链")).toBe(
      "围绕「本科就业」完成申请或求职证据链"
    );
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

describe("核对入口行动", () => {
  it("按 rule_id 识别核对行动", () => {
    expect(isVerifyDataAction(action({ action_id: "verify-curriculum", rule_id: "career-rule-verify-data" }))).toBe(
      true
    );
    expect(isVerifyDataAction(action({ action_id: "req-1", rule_id: "career-rule-direction-requirement" }))).toBe(
      false
    );
  });

  it("统计核对行动数量与标题", () => {
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

describe("方向分析规则回退", () => {
  it("AI 分析缺失时仍给出方向、行动依据与下一步", () => {
    const fallback = buildRuleFallbackAnalysis(
      {
        title: "国际贸易与供应链",
        summary: "围绕进出口业务、国际采购、物流与关务的岗位族。",
        work_content: ["客户与订单跟进", "国际物流协调"],
        verified_skills: ["国际贸易实务", "英语沟通"],
        preparation_cost: "以课程与实习为主。",
        applicability: "经贸相关专业可直接探索。"
      },
      {
        actions: [
          action({
            action_id: "a1",
            title: "核对培养方案",
            status: "pending_verification",
            prerequisites: ["教务系统"]
          })
        ],
        gaps: [{ code: "course_catalog_missing", message: "培养方案全文按课程条目读取。", module: "courses" }],
        explanation: null,
        roadmap: [
          {
            stage: "未来 30 天",
            focus: "先核对",
            actions: ["从教务处确认课程", "记录岗位要求"]
          }
        ]
      }
    );

    expect(fallback.overview).toContain("国际贸易与供应链");
    expect(fallback.match).toContain("用真实反馈校正画像");
    expect(fallback.action_rationale[0]).toContain("核对培养方案");
    expect(fallback.risks).toContain("培养方案全文按课程条目读取。");
    expect(fallback.next_steps).toEqual(["从教务处确认课程", "记录岗位要求"]);
    expect(fallback.boundary_note).toContain("适用范围");
  });
});
