import type { Metadata } from "next";
import { ExploreStep } from "@/components/wizard/ExploreStep";

export const metadata: Metadata = {
  title: "第 1 步 · 自我探索",
  description: "补齐学校专业信息，用 16 项职业探索问卷形成描述性画像；不确定的题目可跳过。"
};

export default function ExplorePage() {
  return <ExploreStep />;
}
