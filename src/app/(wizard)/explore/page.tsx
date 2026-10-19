import type { Metadata } from "next";
import { ExploreStep } from "@/components/wizard/ExploreStep";

export const metadata: Metadata = {
  title: "第 1 步 · 自我探索",
  description: "补齐学校专业信息，用 10 道自编轻测形成描述性画像；每题可跳过，未答保持未知。"
};

export default function ExplorePage() {
  return <ExploreStep />;
}
