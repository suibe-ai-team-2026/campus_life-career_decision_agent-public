import { describe, expect, it } from "vitest";
import {
  extractionStatusLabel,
  parsingRunStatusLabel,
  sourceScopeLabel
} from "../../src/lib/source-labels";

describe("source labels", () => {
  it("maps known scopes and underscore codes to Chinese labels", () => {
    expect(sourceScopeLabel("reference_data")).toBe("团队参考数据");
    expect(sourceScopeLabel("official")).toBe("官方材料");
    expect(sourceScopeLabel("official_curriculum_catalog")).toBe("官方材料");
    expect(sourceScopeLabel("campus_resource")).toBe("学校材料");
    expect(sourceScopeLabel("user_upload")).toBe("本人上传");
    expect(sourceScopeLabel("job_snapshot")).toBe("招聘快照");
  });

  it("keeps Chinese values and never echoes unknown English codes", () => {
    expect(sourceScopeLabel("校内资源")).toBe("校内资源");
    expect(sourceScopeLabel("mystery_scope")).toBe("参考材料");
    expect(sourceScopeLabel(null)).toBeNull();
  });

  it("maps extraction and run statuses", () => {
    expect(extractionStatusLabel("pending")).toBe("待解析");
    expect(extractionStatusLabel("parsed")).toBe("已解析");
    expect(extractionStatusLabel("partial")).toBe("部分解析");
    expect(extractionStatusLabel("failed")).toBe("解析失败");
    expect(extractionStatusLabel("weird")).toBe("待核验");
    expect(parsingRunStatusLabel("queued")).toBe("已排队");
    expect(parsingRunStatusLabel("running")).toBe("处理中");
    expect(parsingRunStatusLabel("succeeded")).toBe("已完成");
    expect(parsingRunStatusLabel(undefined)).toBe("处理中");
  });
});
