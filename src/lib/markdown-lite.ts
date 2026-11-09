/**
 * Small Markdown subset used by ask answers.
 *
 * The worker's chat answers arrive as plain text that already uses light
 * Markdown (`**bold**`, `- bullet`, `1. item`, `### heading`, fenced code).
 * Rendering it as raw text leaked the markers into the UI, so this module
 * converts that subset into blocks / inline tokens. It deliberately does not
 * support raw HTML or images: answer text is model output and must stay text.
 */

export type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; start: number; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; text: string }
  | { type: "divider" };

export type InlineToken =
  | { type: "text"; text: string }
  | { type: "strong"; tokens: InlineToken[] }
  | { type: "code"; text: string }
  | { type: "link"; label: string; url: string }
  | { type: "citation"; numbers: number[]; raw: string };

/** [1], [2][3], [1,2], [1，2], [1、2] and full-width brackets. */
const CITATION_PATTERN = /^[[【](\d{1,3}(?:\s*[,，、]\s*\d{1,3})*)[\]】]/;

const HEADING_PATTERN = /^(#{1,6})\s+(.*\S)\s*$/;
const DIVIDER_PATTERN = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE_PATTERN = /^\s{0,3}>\s?(.*)$/;
const UNORDERED_ITEM_PATTERN = /^\s{0,3}[-*+]\s+(.*\S)\s*$/;
const ORDERED_ITEM_PATTERN = /^\s{0,3}(\d{1,3})[.)]\s+(.*\S)\s*$/;
const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})\s*[A-Za-z0-9_+-]*\s*$/;

function isBlockStart(line: string): boolean {
  return (
    HEADING_PATTERN.test(line) ||
    DIVIDER_PATTERN.test(line) ||
    QUOTE_PATTERN.test(line) ||
    UNORDERED_ITEM_PATTERN.test(line) ||
    ORDERED_ITEM_PATTERN.test(line) ||
    FENCE_PATTERN.test(line)
  );
}

/** Split free text into the small set of Markdown blocks the answers use. */
export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = FENCE_PATTERN.exec(line);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      index += 1;
      while (index < lines.length) {
        const current = lines[index];
        if (current.trim().startsWith(marker)) {
          index += 1;
          break;
        }
        body.push(current);
        index += 1;
      }
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }

    const heading = HEADING_PATTERN.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (DIVIDER_PATTERN.test(line)) {
      blocks.push({ type: "divider" });
      index += 1;
      continue;
    }

    if (QUOTE_PATTERN.test(line)) {
      const quote: string[] = [];
      while (index < lines.length) {
        const match = QUOTE_PATTERN.exec(lines[index]);
        if (!match) break;
        quote.push(match[1].trim());
        index += 1;
      }
      blocks.push({ type: "quote", text: quote.join("\n") });
      continue;
    }

    const firstUnordered = UNORDERED_ITEM_PATTERN.exec(line);
    const firstOrdered = ORDERED_ITEM_PATTERN.exec(line);
    if (firstUnordered || firstOrdered) {
      const ordered = Boolean(firstOrdered);
      const items: string[] = [];
      let start = 1;
      if (firstOrdered) start = Number.parseInt(firstOrdered[1], 10) || 1;
      while (index < lines.length) {
        const match = ordered ? ORDERED_ITEM_PATTERN.exec(lines[index]) : UNORDERED_ITEM_PATTERN.exec(lines[index]);
        if (!match) break;
        items.push((ordered ? match[2] : match[1]).trim());
        index += 1;
      }
      blocks.push({ type: "list", ordered, start, items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      if (!current.trim()) break;
      if (paragraph.length > 0 && isBlockStart(current)) break;
      paragraph.push(current.trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
  }

  return blocks;
}

function pushText(tokens: InlineToken[], text: string): void {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last && last.type === "text") {
    last.text += text;
    return;
  }
  tokens.push({ type: "text", text });
}

function citationNumbers(raw: string): number[] {
  const match = CITATION_PATTERN.exec(raw);
  if (!match) return [];
  return match[1]
    .split(/[,，、]/)
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value));
}

function findClosing(text: string, from: number, token: string): number {
  const index = text.indexOf(token, from);
  return index === -1 ? -1 : index;
}

function parseInline(text: string, depth = 0): InlineToken[] {
  const tokens: InlineToken[] = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (char === "`") {
      const end = findClosing(text, index + 1, "`");
      if (end > index + 1) {
        tokens.push({ type: "code", text: text.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    if (char === "*" && text[index + 1] === "*") {
      const end = findClosing(text, index + 2, "**");
      if (end > index + 2) {
        const inner = text.slice(index + 2, end);
        tokens.push({ type: "strong", tokens: depth < 3 ? parseInline(inner, depth + 1) : [{ type: "text", text: inner }] });
        index = end + 2;
        continue;
      }
    }

    if (char === "[") {
      const link = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/.exec(text.slice(index));
      if (link) {
        tokens.push({ type: "link", label: link[1], url: link[2] });
        index += link[0].length;
        continue;
      }
      const citation = CITATION_PATTERN.exec(text.slice(index));
      if (citation) {
        const raw = citation[0];
        tokens.push({ type: "citation", raw, numbers: citationNumbers(raw) });
        index += raw.length;
        continue;
      }
    }

    if (char === "【") {
      const citation = CITATION_PATTERN.exec(text.slice(index));
      if (citation) {
        const raw = citation[0];
        tokens.push({ type: "citation", raw, numbers: citationNumbers(raw) });
        index += raw.length;
        continue;
      }
    }

    let next = index + 1;
    while (next < text.length && !["`", "*", "[", "【"].includes(text[next])) next += 1;
    pushText(tokens, text.slice(index, next));
    index = next;
  }

  return tokens;
}

/** Inline tokens for one line of text (bold, code, links, citation markers). */
export function parseInlineMarkdown(text: string): InlineToken[] {
  return parseInline(text);
}
