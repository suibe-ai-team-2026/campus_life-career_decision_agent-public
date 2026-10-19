import type { Metadata } from "next";
import { ExportStep } from "@/components/wizard/ExportStep";

export const metadata: Metadata = {
  title: "第 5 步 · 导出分享",
  description: "生成带引用、资料版本与待核验项的 PDF，并明确这是自编轻测与自评，不是就业承诺。"
};

export default function ExportPage() {
  return <ExportStep />;
}
