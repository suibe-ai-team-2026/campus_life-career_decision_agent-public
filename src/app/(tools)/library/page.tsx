import type { Metadata } from "next";
import { LibraryTool } from "@/components/tools/LibraryTool";

export const metadata: Metadata = {
  title: "资料库 · 生涯资料问答",
  description: "仅基于已载入的生涯资料回答问题，回答必须带引用；没有证据时明确拒答。"
};

export default function LibraryPage() {
  return <LibraryTool />;
}
