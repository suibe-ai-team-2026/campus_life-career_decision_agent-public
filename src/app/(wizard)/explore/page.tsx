import type { Metadata } from "next";
import { ExploreStep } from "@/components/wizard/ExploreStep";

export const metadata: Metadata = {
  title: "第 1 步 · 自我探索",
  description: "补齐学校专业信息，用 16 项职业探索自我画像问卷形成描述性画像；不确定的题目可跳过，未答保持未知。"
};

export default function ExplorePage() {
  return <ExploreStep />;
}
