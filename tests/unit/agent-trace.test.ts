import { describe, expect, it } from "vitest";
import { formatToolCall, toTraceEvent, toTraceEvents } from "@/lib/agent-trace";

type RawEvent = Parameters<typeof toTraceEvent>[0];

function runEvent(overrides: Partial<RawEvent> & Pick<RawEvent, "seq" | "event_type">): RawEvent {
  return {
    run_id: "00000000-0000-4000-8000-000000000000",
    seq: overrides.seq,
    event_type: overrides.event_type,
    safe_payload: overrides.safe_payload === undefined ? {} : overrides.safe_payload,
    created_at: overrides.created_at ?? "2026-10-26T10:00:00.000Z"
  };
}

function traceEvent(eventType: string, safePayload: Record<string, unknown> | null, seq = 1) {
  return toTraceEvent(runEvent({ seq, event_type: eventType, safe_payload: safePayload }));
}

function toolCallTrace(tool: string, input: Record<string, unknown>) {
  return traceEvent("tool_call", { tool, input });
}

describe("toTraceEvent · stage", () => {
  it("把运行状态事件映射为 stage 并保留 progress", () => {
    const event = traceEvent("retrieving", { progress: 15 });
    expect(event.kind).toBe("stage");
    expect(event.raw_type).toBe("retrieving");
    expect(event.payload).toEqual({ progress: 15 });
  });

  it("终态也属于 stage", () => {
    expect(traceEvent("succeeded", {}).kind).toBe("stage");
    expect(traceEvent("failed", {}).kind).toBe("stage");
  });

  it("未知事件类型退化为 agent_note，但保留原始类型", () => {
    const event = traceEvent("some_future_event", { progress: 42 });
    expect(event.kind).toBe("agent_note");
    expect(event.raw_type).toBe("some_future_event");
    expect(event.payload).toEqual({ progress: 42 });
  });

  it("safe_payload 为 null 时不报错", () => {
    const event = traceEvent("agent_note", null);
    expect(event.payload).toEqual({ text: "" });
  });
});

describe("toTraceEvent · agent_step", () => {
  it("保留 step、label 与 thought", () => {
    const event = traceEvent("agent_step", {
      step: 1,
      label: "拆解问题并规划检索词",
      thought: "先找学校官方就业质量报告"
    });
    expect(event.kind).toBe("agent_step");
    expect(event.payload).toEqual({
      step: 1,
      label: "拆解问题并规划检索词",
      thought: "先找学校官方就业质量报告"
    });
  });

  it("缺省 label 时给出可读占位，step 非数字则丢弃", () => {
    const event = traceEvent("agent_step", { step: "2", label: 42 });
    expect(event.payload).toEqual({ step: undefined, label: "思考下一步", thought: undefined });
  });
});

describe("toTraceEvent · tool_call", () => {
  it("归一化 tool 与 input", () => {
    const event = toolCallTrace("web_search", { query: "上海对外经贸大学 2024 就业质量报告", site: "edu.cn" });
    expect(event.kind).toBe("tool_call");
    expect(event.payload).toEqual({
      step: undefined,
      tool: "web_search",
      input: { query: "上海对外经贸大学 2024 就业质量报告", site: "edu.cn" }
    });
  });

  it("tool 缺失时用 tool 占位，input 非对象时为空对象", () => {
    const event = traceEvent("tool_call", { tool: 7, input: ["x"] });
    expect(event.payload).toEqual({ step: undefined, tool: "tool", input: {} });
  });
});

describe("toTraceEvent · tool_result", () => {
  it("web_search 结果过滤掉没有 url 的条目并补默认值", () => {
    const event = traceEvent("tool_result", {
      step: 1,
      tool: "web_search",
      ok: true,
      ms: 623,
      count: 3,
      results: [
        {
          title: "上海对外经贸大学2024届毕业生就业质量报告",
          url: "https://www.suibe.edu.cn/job/report.pdf",
          site_name: "上海对外经贸大学",
          published_at: "2024-05-01T00:00:00Z",
          snippet: "本科毕业去向落实率…",
          authority: 3,
          rerank_score: 1.8
        },
        { title: "缺少 URL 的条目" },
        "not-an-object",
        { url: "https://example.edu.cn/a" }
      ]
    });
    expect(event.kind).toBe("tool_result");
    const payload = event.payload as {
      results: unknown[];
      ok: boolean;
      ms: number;
      count: number;
      page?: unknown;
    };
    expect(payload.ok).toBe(true);
    expect(payload.ms).toBe(623);
    expect(payload.count).toBe(3);
    expect(payload.page).toBeUndefined();
    expect(payload.results).toHaveLength(2);
    expect(payload.results[0]).toEqual({
      title: "上海对外经贸大学2024届毕业生就业质量报告",
      url: "https://www.suibe.edu.cn/job/report.pdf",
      site_name: "上海对外经贸大学",
      published_at: "2024-05-01T00:00:00Z",
      snippet: "本科毕业去向落实率…",
      authority: 3,
      rerank_score: 1.8
    });
    expect(payload.results[1]).toEqual({
      title: "https://example.edu.cn/a",
      url: "https://example.edu.cn/a",
      site_name: null,
      published_at: null,
      snippet: "",
      authority: null,
      rerank_score: null
    });
  });

  it("web_fetch 页面缺少 url 时不保留 page", () => {
    const withPage = traceEvent("tool_result", {
      tool: "web_fetch",
      ok: true,
      ms: 812,
      page: { title: "就业质量报告", url: "https://www.suibe.edu.cn/report", chars: 9821, excerpt: "正文摘录" }
    });
    expect((withPage.payload as { page?: unknown }).page).toEqual({
      title: "就业质量报告",
      url: "https://www.suibe.edu.cn/report",
      chars: 9821,
      excerpt: "正文摘录"
    });

    const withoutUrl = traceEvent("tool_result", { tool: "web_fetch", page: { title: "只有标题" } });
    expect((withoutUrl.payload as { page?: unknown }).page).toBeUndefined();
  });

  it("失败结果保留 ok=false 与 error", () => {
    const event = traceEvent("tool_result", {
      tool: "web_fetch",
      ok: false,
      ms: 120,
      error: "403 Forbidden"
    });
    expect(event.payload).toMatchObject({ ok: false, error: "403 Forbidden" });
  });

  it("corpus_search 保留 hits 与 titles，并过滤非字符串标题", () => {
    const event = traceEvent("tool_result", {
      tool: "corpus_search",
      ok: true,
      hits: 8,
      titles: ["培养方案", 3, "学生手册"]
    });
    expect(event.payload).toMatchObject({ hits: 8, titles: ["培养方案", "学生手册"] });
  });

  it("ok 缺省视为成功（worker 只会在失败时显式写 false）", () => {
    const event = traceEvent("tool_result", { tool: "corpus_search", hits: 0 });
    expect((event.payload as { ok: boolean }).ok).toBe(true);
  });
});

describe("toTraceEvent · validation 与 agent_note", () => {
  it("validation 保留引用统计与原因，并过滤非字符串原因", () => {
    const event = traceEvent("validation", {
      ok: false,
      citations: 6,
      web_citations: 2,
      reasons: ["存在无引用结论", 9],
      note: "已退回确定性结果"
    });
    expect(event.kind).toBe("validation");
    expect(event.payload).toEqual({
      ok: false,
      citations: 6,
      web_citations: 2,
      reasons: ["存在无引用结论"],
      note: "已退回确定性结果"
    });
  });

  it("agent_note 保留文本，非字符串文本视为空", () => {
    expect(traceEvent("agent_note", { text: "已找到官方报告，开始生成带引用回答" }).payload).toEqual({
      text: "已找到官方报告，开始生成带引用回答"
    });
    expect(traceEvent("agent_note", { text: 123 }).payload).toEqual({ text: "" });
  });
});

describe("toTraceEvents", () => {
  it("按 seq 升序排序且不丢弃事件", () => {
    const events = [
      runEvent({ seq: 3, event_type: "agent_note", safe_payload: { text: "三" } }),
      runEvent({ seq: 1, event_type: "tool_call", safe_payload: { tool: "corpus_search", input: { query: "a" } } }),
      runEvent({ seq: 2, event_type: "retrieving", safe_payload: { progress: 15 } })
    ];
    const trace = toTraceEvents(events);
    expect(trace.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(trace.map((event) => event.kind)).toEqual(["tool_call", "stage", "agent_note"]);
  });

  it("空数组返回空数组", () => {
    expect(toTraceEvents([])).toEqual([]);
  });
});

describe("formatToolCall", () => {
  it("渲染 web_search，带 site 时追加参数", () => {
    expect(formatToolCall(toolCallTrace("web_search", { query: "上海对外经贸大学 2024 就业质量报告", site: "edu.cn" }))).toBe(
      'web_search(query="上海对外经贸大学 2024 就业质量报告", site="edu.cn")'
    );
    expect(formatToolCall(toolCallTrace("web_search", { query: "培养方案" }))).toBe('web_search(query="培养方案")');
  });

  it("渲染 web_fetch 与 corpus_search", () => {
    expect(formatToolCall(toolCallTrace("web_fetch", { url: "https://www.suibe.edu.cn/report" }))).toBe(
      'web_fetch(url="https://www.suibe.edu.cn/report")'
    );
    expect(formatToolCall(toolCallTrace("corpus_search", { query: "重修 规定" }))).toBe('corpus_search(query="重修 规定")');
  });

  it("finish_research 不带参数", () => {
    expect(formatToolCall(toolCallTrace("finish_research", {}))).toBe("finish_research()");
  });

  it("未知工具把 input 序列化出来，便于排查", () => {
    expect(formatToolCall(toolCallTrace("custom_tool", { a: 1, b: "x" }))).toBe('custom_tool({"a":1,"b":"x"})');
  });

  it("缺字段时输出空值而不是报错", () => {
    expect(formatToolCall(toolCallTrace("web_search", {}))).toBe('web_search(query="")');
    expect(formatToolCall(toolCallTrace("web_fetch", {}))).toBe('web_fetch(url="")');
  });
});
