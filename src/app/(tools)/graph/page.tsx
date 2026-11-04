import type { Metadata } from "next";
import { GraphExplorer } from "@/components/graph/GraphExplorer";
import { graphSnapshot } from "@/lib/graph";

export const metadata: Metadata = {
  title: "知识图谱 · 生涯知识网络",
  description:
    "像 Obsidian 一样浏览生涯知识：方向、课程、竞赛、岗位与查证入口连成一张可点击的图；每个节点都有带引用的 Wiki 页与「去哪查」。"
};

export default function GraphPage() {
  return <GraphExplorer snapshot={graphSnapshot} />;
}
