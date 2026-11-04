import snapshotJson from "./snapshot.json";
import type { GraphNode, GraphSnapshot } from "./types";
import { buildAdjacency, buildDegree } from "./utils";

export { buildAdjacency, buildDegree } from "./utils";

/**
 * 客户端与服务端共用的图谱只读快照。
 *
 * 快照由 `scripts/build-graph.ts` 生成；页面在构建期引入，不在请求时现算。
 * 数据来源见生成器文件头部的注释。
 */
export const graphSnapshot = snapshotJson as unknown as GraphSnapshot;

export const graphNodeById: ReadonlyMap<string, GraphNode> = new Map(
  graphSnapshot.nodes.map((node) => [node.id, node])
);

export const graphAdjacency = buildAdjacency(graphSnapshot.edges);
export const graphDegree = buildDegree(graphSnapshot.edges);
