import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/runs 的“提交”层回归测试。
 *
 * 背景：compare 曾被当成 plan 一样强制要求 profile_id，而方向页在生成方案之前
 * 不会保存云端画像，于是每次点「生成 AI 对比解释」都收到 400 bad_request。
 * 这里锁住三条边界：compare 可以不带画像；带了画像要校验归属；plan 仍然必须带画像。
 */

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  loadOwnedProfile: vi.fn(),
  checkMonthlyBudget: vi.fn(),
  checkRateLimit: vi.fn(),
  directionExists: vi.fn(),
  loadOwnedPlan: vi.fn(),
  wakeWorker: vi.fn(),
  rpc: vi.fn()
}));

vi.mock("@/lib/http/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/runs/guards", () => ({
  checkMonthlyBudget: mocks.checkMonthlyBudget,
  checkRateLimit: mocks.checkRateLimit,
  directionExists: mocks.directionExists,
  loadOwnedPlan: mocks.loadOwnedPlan,
  loadOwnedProfile: mocks.loadOwnedProfile
}));
vi.mock("@/lib/freestyle/vm", () => ({ wakeWorker: mocks.wakeWorker }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({ rpc: mocks.rpc })
}));

import { POST } from "@/app/api/runs/route";

const runId = "9f3c2b6e-8c1d-4d5f-9a7b-2c4e6f8a0b1c";
const profileId = "3f1f9c3a-6d1e-4d4e-9a4e-2b2a7c9e1a11";
const idempotencyKey = "11111111-1111-4111-8111-111111111111";

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("POST /api/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ user: { id: "user-1", isAnonymous: true, email: null } });
    mocks.checkMonthlyBudget.mockResolvedValue(null);
    mocks.checkRateLimit.mockReturnValue(null);
    mocks.directionExists.mockResolvedValue({ exists: true });
    mocks.loadOwnedPlan.mockResolvedValue({ plan: null });
    mocks.loadOwnedProfile.mockResolvedValue({ profile: { profile_id: profileId, version: 3 } });
    mocks.wakeWorker.mockResolvedValue("already_running");
    mocks.rpc.mockResolvedValue({ data: [{ run_id: runId, status: "queued" }], error: null });
  });

  it("accepts compare without a profile (direction page has not saved one yet)", async () => {
    const response = await post({
      kind: "compare",
      direction_ids: ["cross_border_business", "finance_accounting"],
      idempotency_key: idempotencyKey
    });

    expect(response.status).toBe(202);
    expect(mocks.loadOwnedProfile).not.toHaveBeenCalled();
    const [, rpcArgs] = mocks.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(rpcArgs.p_input).toEqual({
      profile_id: null,
      direction_ids: ["cross_border_business", "finance_accounting"]
    });
    expect(rpcArgs.p_profile_version).toBeNull();
  });

  it("still validates an explicitly attached profile for compare", async () => {
    const response = await post({
      kind: "compare",
      profile_id: profileId,
      direction_ids: ["cross_border_business", "finance_accounting", "data_business"],
      idempotency_key: idempotencyKey
    });

    expect(response.status).toBe(202);
    expect(mocks.loadOwnedProfile).toHaveBeenCalledWith(profileId);
    const [, rpcArgs] = mocks.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(rpcArgs.p_profile_version).toBe(3);
  });

  it("rejects a compare profile owned by someone else", async () => {
    mocks.loadOwnedProfile.mockResolvedValue({ profile: null });

    const response = await post({
      kind: "compare",
      profile_id: profileId,
      direction_ids: ["cross_border_business", "finance_accounting"],
      idempotency_key: idempotencyKey
    });

    expect(response.status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects compare with fewer than two directions", async () => {
    const response = await post({
      kind: "compare",
      direction_ids: ["cross_border_business"],
      idempotency_key: idempotencyKey
    });

    expect(response.status).toBe(400);
    const body = await bodyOf(response);
    expect((body.error as { code: string }).code).toBe("bad_request");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps requiring profile_id for plan submissions", async () => {
    const response = await post({
      kind: "plan",
      direction_id: "trade_supply_chain",
      idempotency_key: idempotencyKey
    });

    expect(response.status).toBe(400);
    const body = await bodyOf(response);
    expect((body.error as { code: string }).code).toBe("bad_request");
  });
});
