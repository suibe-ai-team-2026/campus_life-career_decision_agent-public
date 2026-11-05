import type { Metadata } from "next";
import { LibraryTool } from "@/components/tools/LibraryTool";

export const metadata: Metadata = {
  title: "资料库 · 生涯资料问答",
  description: "基于已收录的生涯资料回答问题，回答带引用，可直接回到来源核对。"
};

export default function LibraryPage() {
  return <LibraryTool />;
}
