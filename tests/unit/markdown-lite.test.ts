import { describe, expect, it } from "vitest";
import { parseInlineMarkdown, parseMarkdownBlocks } from "@/lib/markdown-lite";

describe("parseMarkdownBlocks", () => {
  it("把标题、粗体段落、无序/有序列表拆成块", () => {
    const blocks = parseMarkdownBlocks(
      [
        "### 一、核心课程",
        "",
        "**国际经济与贸易**专业核心课程如下：",
        "",
        "- 国际贸易实务",
        "- 国际金融",
        "",
        "1. 第一项",
        "2. 第二项"
      ].join("\n")
    );

    expect(blocks).toEqual([
      { type: "heading", level: 3, text: "一、核心课程" },
      { type: "paragraph", text: "**国际经济与贸易**专业核心课程如下：" },
      { type: "list", ordered: false, start: 1, items: ["国际贸易实务", "国际金融"] },
      { type: "list", ordered: true, start: 1, items: ["第一项", "第二项"] }
    ]);
  });

  it("有序列表保留起始序号", () => {
    const blocks = parseMarkdownBlocks("3. 第三项\n4. 第四项");
    expect(blocks).toEqual([{ type: "list", ordered: true, start: 3, items: ["第三项", "第四项"] }]);
  });

  it("围栏代码、引用和分隔线不会混进段落", () => {
    const blocks = parseMarkdownBlocks("说明\n\n```\nconst a = 1;\n```\n\n> 引用一行\n\n---");

    expect(blocks).toEqual([
      { type: "paragraph", text: "说明" },
      { type: "code", text: "const a = 1;" },
      { type: "quote", text: "引用一行" },
      { type: "divider" }
    ]);
  });

  it("纯文本保持原来的段落与换行结构", () => {
    const blocks = parseMarkdownBlocks("第一段第一行\n第一段第二行\n\n第二段");
    expect(blocks).toEqual([
      { type: "paragraph", text: "第一段第一行\n第一段第二行" },
      { type: "paragraph", text: "第二段" }
    ]);
  });
});

describe("parseInlineMarkdown", () => {
  it("解析粗体、行内代码与引用编号", () => {
    const tokens = parseInlineMarkdown("**核心课程**与`代码` [1][2]");
    expect(tokens).toEqual([
      { type: "strong", tokens: [{ type: "text", text: "核心课程" }] },
      { type: "text", text: "与" },
      { type: "code", text: "代码" },
      { type: "text", text: " " },
      { type: "citation", raw: "[1]", numbers: [1] },
      { type: "citation", raw: "[2]", numbers: [2] }
    ]);
  });

  it("解析 Markdown 链接，纯 URL 保持文本", () => {
    const tokens = parseInlineMarkdown("见[教务处](https://jwc.suibe.edu.cn/)与 https://example.com");
    expect(tokens[1]).toEqual({ type: "link", label: "教务处", url: "https://jwc.suibe.edu.cn/" });
    expect(tokens[2]).toEqual({ type: "text", text: "与 https://example.com" });
  });

  it("中文括号引用与多编号引用也能识别", () => {
    const tokens = parseInlineMarkdown("数据【1，2】");
    expect(tokens).toEqual([
      { type: "text", text: "数据" },
      { type: "citation", raw: "【1，2】", numbers: [1, 2] }
    ]);
  });
});
