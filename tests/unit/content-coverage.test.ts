import { describe, expect, it } from "vitest";
import { COVERAGE_LOCAL_LABEL, DIRECTIONS, directionCoverage } from "@/lib/content";

const direction = DIRECTIONS[0];
const longBoundary =
  "官方/市级记录与专业×届别×学历组合为全库计数，不表示某一方向成功率；17 个精确同专业证据格仅覆盖部分组合，其余缺口不代表为零";

describe("directionCoverage", () => {
  it("没有云端数据时不编造数字，badge 只放短状态", () => {
    const view = directionCoverage(direction, null);
    expect(view.pending).toBe(true);
    expect(view.badgeLabel).toBe(COVERAGE_LOCAL_LABEL);
    expect(view.exactMajorRecords).toBeNull();
    expect(view.officialRecords).toBeNull();
    expect(view.jobRequirements).toBeNull();
  });

  it("云端口径长句与 badge 状态分开：badge 不会被长句撑开", () => {
    const view = directionCoverage(direction, {
      exact_major_records: 51,
      official_records: 74,
      job_requirements: 30,
      label: longBoundary
    });
    expect(view.pending).toBe(false);
    expect(view.label).toBe(longBoundary);
    expect(view.badgeLabel).toBe("云端证据已载入");
    expect(view.badgeLabel.length).toBeLessThan(12);
    expect(view.badgeLabel).not.toContain("；");
  });

  it("云端返回 0 条记录时保持待载入，不显示 0 覆盖", () => {
    const view = directionCoverage(direction, {
      exact_major_records: 0,
      official_records: 0,
      job_requirements: 0,
      label: longBoundary
    });
    expect(view.pending).toBe(true);
    expect(view.badgeLabel).toBe("待载入");
    expect(view.exactMajorRecords).toBeNull();
  });
});
