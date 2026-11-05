import type { Metadata } from "next";
import { ExportStep } from "@/components/wizard/ExportStep";

export const metadata: Metadata = {
  title: "第 5 步 · 导出分享",
  description: "生成带引用与资料版本的方案 PDF，可随时带走、随时回看。"
};

export default function ExportPage() {
  return <ExportStep />;
}
