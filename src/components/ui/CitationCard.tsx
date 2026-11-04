"use client";

import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Citation } from "@/lib/contracts/run";
import { safeExternalUrl } from "@/lib/api-client";
import { Badge, Icon, type BadgeTone } from "./primitives";
import { sourceScopeLabel } from "@/lib/source-labels";

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

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function CitationCard({ citation, dense = false }: { citation: Citation; dense?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const verification = verificationDisplay(citation.verification_status);
  const excerpt = citation.excerpt?.trim() ?? "";
  const longExcerpt = excerpt.length > 160;
  // Only http(s) locator URLs become links; anything else keeps the old
  // "locator shows text, never a URL" behaviour.
  const rawWebUrl = typeof citation.locator?.url === "string" ? citation.locator.url : null;
  const webUrl = rawWebUrl ? safeExternalUrl(rawWebUrl) : null;

  return (
    <article className={dense ? "citation-card citation-card-dense" : "citation-card"}>
      <header className="citation-head">
        <span className="citation-no">[{citation.citation_no}]</span>
        <div className="citation-title-block">
          <p className="citation-title">{citation.title}</p>
          <p className="citation-meta micro">
            {citation.source_scope ? <span>{sourceScopeLabel(citation.source_scope)}</span> : null}
            <span>{locatorSummary(citation.locator)}</span>
          </p>
        </div>
        <Badge tone={verification.tone}>{verification.label}</Badge>
      </header>
      {webUrl ? (
        <div className="citation-web-row">
          <Badge tone="info">实时网页 · 未核验</Badge>
          <a className="citation-web-link" href={webUrl} target="_blank" rel="noopener noreferrer" title={webUrl}>
            <span className="citation-domain">{domainOf(webUrl)}</span>
            <span>打开网页</span>
            <Icon name="external" size={12} />
          </a>
        </div>
      ) : null}
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
        <p className="citation-empty micro">未提供摘录，以来源条目为准。</p>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Inline citations                                                    */
/*                                                                     */
/* The long "引用（n 条）" card list at the end of an answer was too    */
/* tall, so the body text now carries a small gray number bubble that  */
/* reveals the source on hover, focus or tap. The bubble CSS lives in  */
/* src/app/ui-fixes.css (the Lead owns it) — these components only     */
/* emit the matching markup.                                           */
/* ------------------------------------------------------------------ */

/** [1], [2][3], [1,2], [1，2], [1、2] and full-width brackets. */
const CITATION_MARK_PATTERN = "[[【](\\d{1,3}(?:\\s*[,，、]\\s*\\d{1,3})*)[\\]】]";
const POPOVER_EXCERPT_MAX = 200;

/** Build a citation_no → Citation lookup so [n] markers can be resolved. */
export function citationIndex(citations: Citation[] | null | undefined): Map<number, Citation> {
  const byNo = new Map<number, Citation>();
  for (const citation of citations ?? []) byNo.set(citation.citation_no, citation);
  return byNo;
}

/** True when the text carries at least one [n] marker that resolves to `citations`. */
export function hasCitationMarkers(text: string | null | undefined, citations?: Citation[] | null): boolean {
  if (!text) return false;
  const byNo = citationIndex(citations);
  const pattern = new RegExp(CITATION_MARK_PATTERN, "g");
  let match = pattern.exec(text);
  while (match) {
    const numbers = match[1]
      .split(/[,，、]/)
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value));
    if (numbers.length > 0 && numbers.every((value) => byNo.has(value))) return true;
    match = pattern.exec(text);
  }
  return false;
}

/** Single-line, length-capped excerpt for the popover. */
function popoverExcerpt(excerpt: string): string {
  const text = excerpt.replace(/\s+/g, " ").trim();
  if (text.length <= POPOVER_EXCERPT_MAX) return text;
  return `${text.slice(0, POPOVER_EXCERPT_MAX).trimEnd()}…`;
}

function popoverMeta(citation: Citation): string {
  const parts: string[] = [];
  const scope = citation.source_scope ? sourceScopeLabel(citation.source_scope) : null;
  if (scope) parts.push(scope);
  const locator = locatorSummary(citation.locator);
  if (locator && locator !== "定位信息未提供") parts.push(locator);
  return parts.length > 0 ? parts.join(" · ") : "来源条目";
}

/**
 * Gray [n] bubble rendered inline in answer / analysis text. It is a real
 * button so keyboard users can reach it: focus opens the popover, Enter/Space
 * pins it and Escape closes it. On touch a tap toggles the popover.
 */
export function CitationRef({ citation }: { citation: Citation }) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [placement, setPlacement] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const popRef = useRef<HTMLSpanElement | null>(null);
  const popId = useId();
  const verification = verificationDisplay(citation.verification_status);
  const excerpt = popoverExcerpt(citation.excerpt ?? "");
  const open = pinned || hovered || focused;

  // The popover is rendered in a portal (position: fixed) because the answer
  // body scrolls inside .library-conversation{overflow-y:auto}; an absolutely
  // positioned bubble would be clipped at the top/right edge of that scroller.
  useEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    function place() {
      const anchor = wrapRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(340, window.innerWidth * 0.84);
      const center = rect.left + rect.width / 2;
      const left = Math.min(Math.max(center, width / 2 + 8), window.innerWidth - width / 2 - 8);
      const above = rect.top > 200;
      setPlacement({ left, top: above ? rect.top - 8 : rect.bottom + 8, above });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // A tapped bubble stays open; tapping anywhere outside closes it.
  useEffect(() => {
    if (!pinned) return;
    function handlePointerDown(event: PointerEvent) {
      const wrap = wrapRef.current;
      const pop = popRef.current;
      const target = event.target as Node;
      if (wrap?.contains(target) || pop?.contains(target)) return;
      setPinned(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [pinned]);

  return (
    <span
      className="cite-wrap"
      ref={wrapRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocused(false);
          setPinned(false);
        }
      }}
    >
      <button
        type="button"
        className="cite-ref"
        aria-label={`引用 ${citation.citation_no}：${citation.title}`}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={(event) => {
          const next = !pinned;
          setPinned(next);
          if (!next && event.detail > 0) event.currentTarget.blur();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setPinned(false);
            setFocused(false);
            event.currentTarget.blur();
          }
        }}
      >
        {citation.citation_no}
      </button>
      {open && placement && typeof document !== "undefined"
        ? createPortal(
            <span
              className="cite-pop is-open"
              id={popId}
              role="tooltip"
              ref={popRef}
              style={{
                position: "fixed",
                left: `${placement.left}px`,
                top: `${placement.top}px`,
                bottom: "auto",
                right: "auto",
                transform: placement.above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
                zIndex: 220
              }}
            >
              <span className="cite-pop-title">{citation.title}</span>
              <span className="cite-pop-meta">{popoverMeta(citation)}</span>
              <span className="cite-pop-excerpt">
                {excerpt || "未提供摘录，以来源条目为准。"}
              </span>
              <span className="cite-pop-ref">出处 · {verification.label}</span>
            </span>,
            document.body
          )
        : null}
    </span>
  );
}

/** Resolve [n] markers inside one line of text, keeping unknown ones as text. */
function renderCitationMarkers(text: string, byNo: Map<number, Citation>, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(CITATION_MARK_PATTERN, "g");
  let lastIndex = 0;
  let match = pattern.exec(text);
  while (match) {
    const marker = match;
    const numbers = marker[1]
      .split(/[,，、]/)
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value));
    // A marker whose numbers are not all known citations is left untouched.
    if (numbers.length > 0 && numbers.every((value) => byNo.has(value))) {
      if (marker.index > lastIndex) nodes.push(text.slice(lastIndex, marker.index));
      numbers.forEach((value, index) => {
        const citation = byNo.get(value);
        if (citation) {
          nodes.push(<CitationRef key={`${keyPrefix}-${marker.index}-${index}`} citation={citation} />);
        }
      });
      lastIndex = marker.index + marker[0].length;
    }
    match = pattern.exec(text);
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/**
 * Render free text with its [n] citation markers replaced by inline bubbles.
 * Paragraph breaks become <p>, single line breaks <br>. Text without any
 * resolvable marker renders unchanged (brackets stay visible).
 */
export function CitationText({
  text,
  citations
}: {
  text: string | null | undefined;
  citations?: Citation[] | null;
}) {
  if (!text || !text.trim()) return null;
  const byNo = citationIndex(citations);
  const paragraphs = text.split(/\n{2,}/).filter((paragraph) => paragraph.trim().length > 0);
  return (
    <>
      {paragraphs.map((paragraph, paragraphIndex) => {
        const lines = paragraph.split("\n");
        return (
          <p key={`cite-p-${paragraphIndex}`}>
            {lines.map((line, lineIndex) => (
              <Fragment key={`cite-l-${paragraphIndex}-${lineIndex}`}>
                {lineIndex > 0 ? <br /> : null}
                {renderCitationMarkers(line, byNo, `${paragraphIndex}-${lineIndex}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

/** Compact row of [n] bubbles, used when a screen still needs a source index. */
export function CitationChips({ citations, className }: { citations: Citation[]; className?: string }) {
  if (citations.length === 0) return <p className="micro">没有返回引用条目。</p>;
  return (
    <div className={["chip-row", className].filter(Boolean).join(" ")}>
      {citations.map((citation) => (
        <CitationRef key={`${citation.citation_no}-${citation.source_id}-${citation.chunk_id}`} citation={citation} />
      ))}
    </div>
  );
}

/** Full "sources" view: one filename per line, not a stack of cards. */
export function CitationFileList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return <p className="micro">没有返回引用条目。</p>;
  return (
    <ul className="citation-file-list">
      {citations.map((citation) => (
        <li key={`${citation.citation_no}-${citation.source_id}-${citation.chunk_id}`}>
          <span className="citation-file-no">[{citation.citation_no}]</span>
          <span className="citation-file-name" title={citation.title}>
            {citation.title}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CitationList({ citations, dense }: { citations: Citation[]; dense?: boolean }) {
  if (citations.length === 0) {
    return (
      <div className="citation-list-empty micro">
        <Icon name="info" size={16} />
        <span>没有返回引用条目。</span>
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
