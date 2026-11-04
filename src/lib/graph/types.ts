/**
 * 知识图谱快照的共享类型。
 *
 * 由 `scripts/build-graph.ts` 从 `worker/app/reference_data/*` 与方向种子生成，
 * 写入 `src/lib/graph/snapshot.json`；页面与 `/api/graph` 只读消费，不在请求时现算。
 */

export type GraphNodeType =
  | "me"
  | "direction"
  | "program"
  | "course"
  | "competition"
  | "job"
  | "resource"
  | "gap";

export type GraphStatus =
  | "verified"
  | "partial"
  | "official_lead"
  | "external_reference"
  | "pending"
  | "unverified";

/** 每句话都必须可以归到「证据 / 推断 / 缺口」三类之一。 */
export type GraphClaimTag = "evidence" | "inference" | "gap";

export type GraphCitation = {
  id: string;
  no: number;
  title: string;
  /** 没有可公开 URL 的（例如团队整理的方向卡）为 null，前端渲染成纯编号。 */
  url: string | null;
  locator: string;
  status: GraphStatus;
};

export type GraphParagraph = {
  tag: GraphClaimTag;
  text: string;
  citations: string[];
};

export type GraphSection = {
  heading: string;
  paragraphs: GraphParagraph[];
};

export type GraphGuide = {
  label: string;
  url: string;
  look: string;
  cadence: string;
  last_checked: string;
};

export type GraphNode = {
  id: string;
  type: GraphNodeType;
  title: string;
  sub: string;
  status: GraphStatus;
  /** 悬停提示里的一句话：为什么这个节点会出现在图里。 */
  why: string;
  wiki: {
    sections: GraphSection[];
    guides: GraphGuide[];
  };
};

export type GraphEdge = {
  source: string;
  target: string;
};

export type GraphSnapshot = {
  version: string;
  built_at: string;
  profile: {
    label: string;
    note: string;
  };
  citations: GraphCitation[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  boundaries: string[];
};
