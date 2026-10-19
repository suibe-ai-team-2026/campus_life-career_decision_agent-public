import type { Metadata } from "next";
import { ChoiceStep } from "@/components/wizard/ChoiceStep";

export const metadata: Metadata = {
  title: "第 3 步 · 暂定方向",
  description: "从收藏中选 1 个暂定方向，写下理由、未知与下次复核时间；随时可改。"
};

export default function ChoicePage() {
  return <ChoiceStep />;
}
