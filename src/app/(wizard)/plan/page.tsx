import type { Metadata } from "next";
import { PlanStep } from "@/components/wizard/PlanStep";

export const metadata: Metadata = {
  title: "第 4 步 · 行动方案",
  description: "生成按当前学期/下学期/更晚分组的可调整行动方案，展示课程、竞赛、学分、缺口与证据引用。"
};

export default function PlanPage() {
  return <PlanStep />;
}
