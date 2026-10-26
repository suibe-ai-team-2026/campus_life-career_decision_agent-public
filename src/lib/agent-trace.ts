import type { RunEvent } from "@/lib/contracts/run";

/**
 * Live agent trace shared by the library Q&A and plan generation views.
 *
 * The worker appends rows to `app_run_events`; `pollRunUntilDone` already
 * returns them incrementally, so the UI does not need a new transport. Existing
 * progress events keep `event_type` = a run status ("retrieving", "planning"…)
 * with `{ progress }`; the richer events below carry the Claude-Code-style
 * activity stream (tool calls, search results, fetched pages, validation).
 */

export type TraceEventKind =
  | "stage"
  | "agent_step"
  | "tool_call"
  | "tool_result"
  | "agent_note"
  | "validation";

export type TraceEvent = {
  seq: number;
  kind: TraceEventKind;
  created_at: string;
  /** Raw event type as stored in the DB (useful for debugging / "raw" toggle). */
  raw_type: string;
  payload: Record<string, unknown>;
};

export type WebSearchHit = {
  title: string;
  url: string;
  site_name: string | null;
  published_at: string | null;
  snippet: string;
  authority: number | null;
  rerank_score: number | null;
};

export type WebPagePreview = {
  title: string;
  url: string;
  chars: number;
  excerpt: string;
};

export type TraceToolName = "web_search" | "web_fetch" | "corpus_search" | "finish_research" | string;

export type ToolCallPayload = {
  step?: number;
  tool: TraceToolName;
  input: Record<string, unknown>;
};

export type ToolResultPayload = {
  step?: number;
  tool: TraceToolName;
  ok: boolean;
  ms?: number;
  summary?: string;
  count?: number;
  results?: WebSearchHit[];
  page?: WebPagePreview;
  hits?: number;
  titles?: string[];
  error?: string;
};

export type AgentStepPayload = {
  step?: number;
  label: string;
  thought?: string;
};

export type ValidationPayload = {
  ok: boolean;
  citations?: number;
  web_citations?: number;
  reasons?: string[];
  note?: string;
};

const STAGE_TYPES = new Set([
  "queued",
  "running",
  "parsing",
  "embedding",
  "retrieving",
  "planning",
  "rendering",
  "validating",
  "succeeded",
  "failed",
  "cancelled"
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeHit(raw: unknown): WebSearchHit | null {
  const item = asRecord(raw);
  if (!item || typeof item.url !== "string" || !item.url) return null;
  return {
    title: typeof item.title === "string" ? item.title : item.url,
    url: item.url,
    site_name: typeof item.site_name === "string" ? item.site_name : null,
    published_at: typeof item.published_at === "string" ? item.published_at : null,
    snippet: typeof item.snippet === "string" ? item.snippet : "",
    authority: typeof item.authority === "number" ? item.authority : null,
    rerank_score: typeof item.rerank_score === "number" ? item.rerank_score : null
  };
}

function normalizePage(raw: unknown): WebPagePreview | null {
  const item = asRecord(raw);
  if (!item || typeof item.url !== "string" || !item.url) return null;
  return {
    title: typeof item.title === "string" ? item.title : item.url,
    url: item.url,
    chars: typeof item.chars === "number" ? item.chars : 0,
    excerpt: typeof item.excerpt === "string" ? item.excerpt : ""
  };
}

/** Convert one raw run event into a typed trace event. Unknown types are kept as agent_note. */
export function toTraceEvent(event: RunEvent): TraceEvent {
  const payload = asRecord(event.safe_payload) ?? {};
  const raw = event.event_type;
  if (raw === "agent_step") {
    return {
      seq: event.seq,
      kind: "agent_step",
      created_at: event.created_at,
      raw_type: raw,
      payload: {
        step: typeof payload.step === "number" ? payload.step : undefined,
        label: typeof payload.label === "string" ? payload.label : "思考下一步",
        thought: typeof payload.thought === "string" ? payload.thought : undefined
      } satisfies AgentStepPayload
    };
  }
  if (raw === "tool_call") {
    return {
      seq: event.seq,
      kind: "tool_call",
      created_at: event.created_at,
      raw_type: raw,
      payload: {
        step: typeof payload.step === "number" ? payload.step : undefined,
        tool: typeof payload.tool === "string" ? payload.tool : "tool",
        input: asRecord(payload.input) ?? {}
      } satisfies ToolCallPayload
    };
  }
  if (raw === "tool_result") {
    const results = Array.isArray(payload.results)
      ? payload.results.map(normalizeHit).filter((hit): hit is WebSearchHit => hit !== null)
      : undefined;
    const page = normalizePage(payload.page);
    return {
      seq: event.seq,
      kind: "tool_result",
      created_at: event.created_at,
      raw_type: raw,
      payload: {
        step: typeof payload.step === "number" ? payload.step : undefined,
        tool: typeof payload.tool === "string" ? payload.tool : "tool",
        ok: payload.ok !== false,
        ms: typeof payload.ms === "number" ? payload.ms : undefined,
        summary: typeof payload.summary === "string" ? payload.summary : undefined,
        count: typeof payload.count === "number" ? payload.count : undefined,
        results,
        page: page ?? undefined,
        hits: typeof payload.hits === "number" ? payload.hits : undefined,
        titles: Array.isArray(payload.titles)
          ? payload.titles.filter((title): title is string => typeof title === "string")
          : undefined,
        error: typeof payload.error === "string" ? payload.error : undefined
      } satisfies ToolResultPayload
    };
  }
  if (raw === "validation") {
    return {
      seq: event.seq,
      kind: "validation",
      created_at: event.created_at,
      raw_type: raw,
      payload: {
        ok: payload.ok !== false,
        citations: typeof payload.citations === "number" ? payload.citations : undefined,
        web_citations: typeof payload.web_citations === "number" ? payload.web_citations : undefined,
        reasons: Array.isArray(payload.reasons)
          ? payload.reasons.filter((reason): reason is string => typeof reason === "string")
          : undefined,
        note: typeof payload.note === "string" ? payload.note : undefined
      } satisfies ValidationPayload
    };
  }
  if (raw === "agent_note") {
    return {
      seq: event.seq,
      kind: "agent_note",
      created_at: event.created_at,
      raw_type: raw,
      payload: { text: typeof payload.text === "string" ? payload.text : "" }
    };
  }
  if (STAGE_TYPES.has(raw)) {
    return {
      seq: event.seq,
      kind: "stage",
      created_at: event.created_at,
      raw_type: raw,
      payload
    };
  }
  return { seq: event.seq, kind: "agent_note", created_at: event.created_at, raw_type: raw, payload };
}

export function toTraceEvents(events: RunEvent[]): TraceEvent[] {
  return events.map(toTraceEvent).sort((a, b) => a.seq - b.seq);
}

/** Render a tool call as the one-line pseudo-code shown in the trace (Claude-Code style). */
export function formatToolCall(event: TraceEvent): string {
  const payload = event.payload as ToolCallPayload;
  const tool = payload.tool ?? "tool";
  const input = payload.input ?? {};
  if (tool === "web_search") {
    const query = typeof input.query === "string" ? input.query : "";
    const site = typeof input.site === "string" && input.site ? `, site="${input.site}"` : "";
    return `web_search(query="${query}"${site})`;
  }
  if (tool === "web_fetch") {
    const url = typeof input.url === "string" ? input.url : "";
    return `web_fetch(url="${url}")`;
  }
  if (tool === "corpus_search") {
    const query = typeof input.query === "string" ? input.query : "";
    return `corpus_search(query="${query}")`;
  }
  if (tool === "finish_research") {
    return "finish_research()";
  }
  return `${tool}(${JSON.stringify(input)})`;
}
