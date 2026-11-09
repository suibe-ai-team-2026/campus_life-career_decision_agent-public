import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CitationText } from "@/components/ui/CitationCard";
import type { Citation } from "@/lib/contracts/run";

const citation: Citation = {
  citation_no: 1,
  source_id: "src_suibe_employment_report_2022",
  source_version_id: "6d5e3d1a-2f8a-4e2b-9b7e-0e6f3f2a1c11",
  chunk_id: "8f2f4e6a-1c3d-4b5a-9e7f-2a4b6c8d0e12",
  title: "上海对外经贸大学2022届毕业生就业质量年度报告",
  locator: { page: 11 },
  excerpt: "本科毕业生毕业去向落实率为 90.99%",
  verification_status: "partial",
  source_scope: "school_employment_report"
};

const citations = [citation];

function render(text: string, markdown = true): string {
  return renderToStaticMarkup(createElement(CitationText, { text, citations, markdown }));
}

describe("CitationText markdown rendering", () => {
  it("把 ** 和 - 渲染成粗体与列表，不再输出字面标记", () => {
    const html = render("**一、核心课程**\n\n- 国际贸易实务 [1]\n- 国际金融 [1]");

    expect(html).toContain("<strong>一、核心课程</strong>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>国际贸易实务");
    expect(html).not.toContain("**");
    // The citation marker still becomes a clickable bubble inside list items.
    expect(html).toContain('class="cite-ref"');
  });

  it("有序列表、标题与代码块按块渲染", () => {
    const html = render("### 查找路径\n\n1. 到教务处查培养方案 [1]\n2. 核对学分\n\n```\njwc.suibe.edu.cn\n```");

    expect(html).toContain("<h4>查找路径</h4>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<pre><code>jwc.suibe.edu.cn</code></pre>");
  });

  it("未匹配到引用的 [9] 保持原文，不会变成空按钮", () => {
    const html = render("证据没有编号 [9] 的引用");
    expect(html).toContain("[9]");
    expect(html).not.toContain('class="cite-ref"');
  });

  it("markdown=false 时保持旧行为，不解析标记", () => {
    const html = render("**旧文本** - 未开启 markdown", false);
    expect(html).toContain("**旧文本**");
    expect(html).not.toContain("<ul>");
  });
});
