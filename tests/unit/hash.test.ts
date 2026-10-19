import { describe, expect, it } from "vitest";
import { inputHash, stableStringify } from "@/lib/runs/hash";

describe("idempotency hashing", () => {
  it("is stable across object key order", () => {
    const a = { kind: "plan", profile_id: "p", nested: { b: 2, a: 1 } };
    const b = { nested: { a: 1, b: 2 }, profile_id: "p", kind: "plan" };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(inputHash(a)).toBe(inputHash(b));
  });

  it("changes when the logical input changes", () => {
    const base = { kind: "plan", direction_id: "trade_supply_chain" };
    expect(inputHash(base)).not.toBe(inputHash({ ...base, direction_id: "finance_accounting" }));
  });

  it("returns a sha256 hex digest", () => {
    expect(inputHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});
