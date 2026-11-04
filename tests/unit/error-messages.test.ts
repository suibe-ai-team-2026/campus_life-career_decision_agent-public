import { describe, expect, it } from "vitest";
import { runFailureMessage } from "@/lib/api-client";
import { ERROR_CODES, HTTP_STATUS_BY_ERROR } from "@/lib/contracts/common";
import type { PostgrestError } from "@supabase/supabase-js";
import { mapDbError } from "@/lib/http/rpc";
import type { Run } from "@/lib/contracts/run";

function failedRun(errorCode: string | null): Run {
  return {
    run_id: "3f1f9c3a-6d1e-4d4e-9a4e-2b2a7c9e1a11",
    kind: "ask",
    status: "failed",
    progress: 38,
    input: {},
    error_code: errorCode,
    result: null,
    created_at: "2026-11-02T10:10:21.000Z"
  } as Run;
}

describe("runFailureMessage", () => {
  it("把 DB 租约回收写入的 lease_expired 翻成可操作提示", () => {
    const text = runFailureMessage(failedRun("lease_expired"));
    expect(text).toContain("生成失败");
    expect(text).toContain("重新发起");
    expect(text).not.toContain("服务暂时不可用");
  });

  it("契约内的 internal_error 仍显示通用提示", () => {
    expect(runFailureMessage(failedRun("internal_error"))).toContain("服务暂时不可用");
  });

  it("未知错误码回退到通用提示，不泄露内部码", () => {
    const text = runFailureMessage(failedRun("weird_db_code"));
    expect(text).toContain("服务暂时不可用");
    expect(text).not.toContain("weird_db_code");
  });

  it("取消的任务给出取消说明", () => {
    const run = { ...failedRun(null), status: "cancelled" } as Run;
    expect(runFailureMessage(run)).toContain("已取消");
  });
});

describe("lease_expired 契约", () => {
  it("共享契约包含 lease_expired 且映射为 409", () => {
    expect(ERROR_CODES).toContain("lease_expired");
    expect(HTTP_STATUS_BY_ERROR.lease_expired).toBe(409);
  });

  it("mapDbError 把 DB 租约回收错误映射为可读提示，而不是数据库操作失败", () => {
    const error = {
      message: "lease_expired",
      details: "",
      hint: "",
      code: "P0001",
      name: "PostgrestError"
    } as PostgrestError;
    const mapped = mapDbError(error);
    expect(mapped.code).toBe("lease_expired");
    expect(mapped.message).toContain("重新发起");
  });
});
