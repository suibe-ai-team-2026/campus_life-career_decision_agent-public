"use client";

import { useId, useState } from "react";
import type { Citation } from "@/lib/contracts/run";
import { Badge, Icon, type BadgeTone } from "./primitives";

export function verificationDisplay(status: string): { label: string; tone: BadgeTone } {
  switch (status) {
    case "verified":
    case "official":
      return { label: "已核验", tone: "ok" };
    case "partial":
      return { label: "部分核验", tone: "warn" };
    case "historical":
      return { label: "历史口径", tone: "muted" };
    case "excluded":
      return { label: "已排除", tone: "danger" };
    default:
      return { label: "待核验", tone: "warn" };
  }
}

const LOCATOR_KEYS: [string, string][] = [
  ["page", "页"],
  ["page_no", "页"],
  ["section", "章节"],
  ["heading", "标题"],
  ["sheet", "工作表"],
  ["row", "行"],
  ["cell", "单元格"],
  ["slide", "幻灯片"],
  ["paragraph", "段落"],
  ["timestamp", "时间戳"],
  ["record_id", "记录"]
];

/** Human-readable locator summary. Never renders a URL or token. */
export function locatorSummary(locator: Record<string, unknown> | null | undefined): string {
  if (!locator) return "定位信息未提供";
  const parts: string[] = [];
  for (const [key, label] of LOCATOR_KEYS) {
    const value = locator[key];
    if (typeof value === "string" || typeof value === "number") {
      parts.push(`${label} ${value}`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : "定位信息未提供";
}

export function CitationCard({ citation, dense = false }: { citation: Citation; dense?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const verification = verificationDisplay(citation.verification_status);
  const excerpt = citation.excerpt?.trim() ?? "";
  const longExcerpt = excerpt.length > 160;

  return (
    <article className={dense ? "citation-card citation-card-dense" : "citation-card"}>
      <header className="citation-head">
        <span className="citation-no">[{citation.citation_no}]</span>
        <div className="citation-title-block">
          <p className="citation-title">{citation.title}</p>
          <p className="citation-meta">
            {citation.source_scope ? <span>{citation.source_scope}</span> : null}
            <span>{locatorSummary(citation.locator)}</span>
          </p>
        </div>
        <Badge tone={verification.tone}>{verification.label}</Badge>
      </header>
      {excerpt ? (
        <div className="citation-excerpt-wrap">
          <blockquote id={`${id}-excerpt`} className={!expanded && longExcerpt ? "citation-excerpt is-clamped" : "citation-excerpt"}>
            {excerpt}
          </blockquote>
          {longExcerpt ? (
            <button
              type="button"
              className="link-button"
              aria-expanded={expanded}
              aria-controls={`${id}-excerpt`}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "收起摘录" : "展开摘录"}
              <Icon name={expanded ? "minus" : "plus"} size={13} />
            </button>
          ) : null}
        </div>
      ) : (
        <p className="citation-empty">该引用未提供摘录，请以来源条目为准。</p>
      )}
      <p className="citation-footnote">
        引用编号与定位由服务端分配，本页面不拼接外部链接。
      </p>
    </article>
  );
}

export function CitationList({ citations, dense }: { citations: Citation[]; dense?: boolean }) {
  if (citations.length === 0) {
    return (
      <div className="citation-list-empty">
        <Icon name="info" size={16} />
        <span>本次结果没有返回引用条目；没有证据支持的结论不会被展示为事实。</span>
      </div>
    );
  }
  return (
    <div className="citation-list">
      {citations.map((citation) => (
        <CitationCard key={`${citation.citation_no}-${citation.source_id}-${citation.chunk_id}`} citation={citation} dense={dense} />
      ))}
    </div>
  );
}
