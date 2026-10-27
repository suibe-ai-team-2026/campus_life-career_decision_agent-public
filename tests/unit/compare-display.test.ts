import { describe, expect, it } from "vitest";
import { COMPARE_FALLBACK_MARKER, isDeterministicCompareFallback } from "@/lib/compare-display";

describe("compare display", () => {
  it("detects the worker deterministic fallback so the UI can offer a retry", () => {
    const text = `${COMPARE_FALLBACK_MARKER}。当前可对比的方向为：国际贸易与供应链、跨境电商与国际业务。`;
    expect(isDeterministicCompareFallback(text)).toBe(true);
    expect(isDeterministicCompareFallback(`  ${text}`)).toBe(true);
  });

  it("does not flag a normal AI comparison as fallback", () => {
    const text = "三个方向的工作内容与能力要求对比如下（依据方向卡与培养方案证据）：1. 工作内容……";
    expect(isDeterministicCompareFallback(text)).toBe(false);
    expect(isDeterministicCompareFallback("")).toBe(false);
  });
});
