import type { GraphNodeType, GraphStatus } from "./types";

/**
 * 莫兰迪色系：低饱和、带灰调，不抢正文信息。
 * 颜色只表达「节点类型」，大小只表达「连接度」——两者都有图例说明。
 * 具体色值定义在 `src/app/graph.css`（浅色/深色各一套），这里只引用 CSS 变量。
 */
export const GRAPH_TYPE_META: Record<GraphNodeType, { label: string; colorVar: string }> = {
  me: { label: "你的画像", colorVar: "var(--graph-me)" },
  direction: { label: "方向", colorVar: "var(--graph-direction)" },
  program: { label: "培养方案", colorVar: "var(--graph-program)" },
  course: { label: "课程", colorVar: "var(--graph-course)" },
  competition: { label: "竞赛", colorVar: "var(--graph-competition)" },
  job: { label: "岗位族", colorVar: "var(--graph-job)" },
  resource: { label: "查证入口", colorVar: "var(--graph-resource)" },
  gap: { label: "数据缺口", colorVar: "var(--graph-gap)" }
};

export const GRAPH_STATUS_LABEL: Record<GraphStatus, string> = {
  verified: "已核验",
  partial: "部分核验",
  official_lead: "官方线索",
  external_reference: "外部参考",
  pending: "待核验",
  unverified: "未核验"
};

export const GRAPH_CLAIM_LABEL = {
  evidence: "证据",
  inference: "推断",
  gap: "缺口"
} as const;
