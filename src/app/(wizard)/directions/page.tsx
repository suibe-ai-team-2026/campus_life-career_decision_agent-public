import type { Metadata } from "next";
import { DirectionsStep } from "@/components/wizard/DirectionsStep";

export const metadata: Metadata = {
  title: "第 2 步 · 方向认知",
  description: "查看六个方向的牌面、核心技能与准备成本，收藏 2 到 3 个并排比较。"
};

export default function DirectionsPage() {
  return <DirectionsStep />;
}
