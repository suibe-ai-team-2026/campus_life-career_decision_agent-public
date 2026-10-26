/**
 * Static product content shared by the home page, the five-step wizard and the
 * library tools. Everything here is either committed product copy or the
 * authorised seed snapshots under `data/import/seed/`; it never contains
 * unverified statistics. Cloud catalogs (if configured) are merged on top at
 * runtime, but the local seed remains the offline source of truth.
 */
import directionsSeed from "../../../data/import/seed/directions.json";
import assessmentSeed from "../../../data/import/seed/assessment.json";
import {
  AssessmentSchema,
  type Assessment,
  type DirectionCard
} from "@/lib/contracts/catalog";
import { DirectionIdSchema, type DirectionId } from "@/lib/contracts/common";

export type SeedDirection = {
  direction_id: DirectionId;
  title: string;
  short_title: string;
  summary: string;
  work_content: string[];
  verified_skills: string[];
  preparation_cost: string;
  applicability: string;
  data_gaps: string[];
  source_ids: string[];
};

type DirectionSeedFile = {
  category_version: string;
  disclaimer: string;
  directions: Omit<SeedDirection, "direction_id"> & { direction_id: string }[];
};

const typedDirectionsSeed = directionsSeed as unknown as {
  category_version: string;
  disclaimer: string;
  directions: unknown[];
};

export const DIRECTIONS_CATEGORY_VERSION = typedDirectionsSeed.category_version;
export const DIRECTIONS_DISCLAIMER = typedDirectionsSeed.disclaimer;

export const DIRECTIONS: SeedDirection[] = typedDirectionsSeed.directions
  .map((raw) => {
    const item = raw as Omit<SeedDirection, "direction_id"> & { direction_id: string };
    return { ...item, direction_id: DirectionIdSchema.parse(item.direction_id) };
  })
  .sort((a, b) => {
    // Keep the order authored in the seed snapshot.
    const order = (typedDirectionsSeed.directions as { direction_id?: string }[]).map(
      (entry) => entry.direction_id
    );
    return order.indexOf(a.direction_id) - order.indexOf(b.direction_id);
  });

export const DIRECTION_BY_ID: Record<DirectionId, SeedDirection> = DIRECTIONS.reduce(
  (acc, direction) => {
    acc[direction.direction_id] = direction;
    return acc;
  },
  {} as Record<DirectionId, SeedDirection>
);

export function getDirection(directionId: DirectionId | null | undefined): SeedDirection | null {
  if (!directionId) return null;
  return DIRECTION_BY_ID[directionId] ?? null;
}

/** Seed light assessment. Local scoring uses the frozen `scoreAssessment`. */
export const ASSESSMENT: Assessment = AssessmentSchema.parse(assessmentSeed);
export const ASSESSMENT_VERSION = ASSESSMENT.version;

export const DIMENSION_ORDER = ["interest", "ability", "decision"] as const;

export const COVERAGE_PENDING_LABEL = "待载入";
export const COVERAGE_LOCAL_LABEL = "云端证据未载入";

export type DirectionCoverageView = {
  pending: boolean;
  /** Short status shown inside a badge (must not contain a full sentence). */
  badgeLabel: string;
  /** Long data-boundary sentence; rendered once, never inside a nowrap badge. */
  label: string;
  exactMajorRecords: number | null;
  officialRecords: number | null;
  jobRequirements: number | null;
  sourceCount: number;
};

/**
 * Never invent coverage numbers. When the cloud catalog is unavailable (or the
 * returned coverage carries no verified records) we show the unloaded label and
 * hide the counts entirely.
 */
export function directionCoverage(
  direction: SeedDirection,
  cloud?: DirectionCard["coverage"] | null
): DirectionCoverageView {
  const hasRecords =
    cloud &&
    (cloud.exact_major_records > 0 || cloud.official_records > 0 || cloud.job_requirements > 0);
  if (!cloud) {
    return {
      pending: true,
      badgeLabel: COVERAGE_LOCAL_LABEL,
      label: COVERAGE_LOCAL_LABEL,
      exactMajorRecords: null,
      officialRecords: null,
      jobRequirements: null,
      sourceCount: direction.source_ids.length
    };
  }
  return {
    pending: !hasRecords,
    badgeLabel: hasRecords ? "云端证据已载入" : COVERAGE_PENDING_LABEL,
    label: cloud.label || (hasRecords ? "云端证据已载入" : COVERAGE_PENDING_LABEL),
    exactMajorRecords: hasRecords ? cloud.exact_major_records : null,
    officialRecords: hasRecords ? cloud.official_records : null,
    jobRequirements: hasRecords ? cloud.job_requirements : null,
    sourceCount: direction.source_ids.length
  };
}

export type WizardStep = {
  index: number;
  href: string;
  title: string;
  shortTitle: string;
  description: string;
  estimate: string;
};

/** Five wizard steps; the home page is step 0 and does not count. */
export const WIZARD_STEPS: WizardStep[] = [
  {
    index: 1,
    href: "/explore",
    title: "自我探索",
    shortTitle: "探索",
    description: "补齐学校与专业，用 10 道自编轻测形成描述性画像；每题都可跳过。",
    estimate: "约 3 分钟"
  },
  {
    index: 2,
    href: "/directions",
    title: "方向认知",
    shortTitle: "方向",
    description: "查看六个方向的牌面、已核技能、准备成本与数据缺口，收藏 2–3 个。",
    estimate: "约 2 分钟"
  },
  {
    index: 3,
    href: "/choice",
    title: "暂定方向",
    shortTitle: "暂定",
    description: "从收藏中选 1 个暂定方向，写下理由、未知与下次复核时间；随时可改。",
    estimate: "约 1 分钟"
  },
  {
    index: 4,
    href: "/plan",
    title: "行动方案",
    shortTitle: "方案",
    description: "按证据生成可调整的行动、课程、竞赛与缺口说明；数字来自规则而非 AI。",
    estimate: "约 2 分钟"
  },
  {
    index: 5,
    href: "/export",
    title: "导出分享",
    shortTitle: "导出",
    description: "生成带引用与资料版本的 PDF，明确这是自编轻测与自评，不是就业承诺。",
    estimate: "约 1 分钟"
  }
];

export const HOME_BOUNDARIES = [
  {
    title: "AI 不替你做决定",
    body: "系统提供牌面、证据与可调整路径。暂定哪个方向、是否行动，始终由你决定。"
  },
  {
    title: "AI 不算数",
    body: "学分、规则与行动来自确定性规则和已核验资料；AI 只负责组织解释，不改动数字。"
  },
  {
    title: "AI 不编造",
    body: "资料缺失时明确显示「资料未就绪」或「数据缺口」，不用看起来合理的数字填空。"
  }
] as const;

export const DATA_SOURCES = [
  "授权整理的培养方案、竞赛目录与素拓认定材料",
  "学校公开的就业质量报告与就业指导资料",
  "学生手册 / 常见问题等公开制度材料",
  "已归档的招聘要求研究快照（按方向汇总，非历史去向）"
] as const;

export const RESOURCE_BOUNDARIES = [
  "数据覆盖以快照与授权材料为限；未载入处显示数据缺口，不展示未核证的通过率、薪资、录取概率或报考资格。",
  "六个方向是产品导航分类，不是学校官方就业分类；同一岗位可映射到多个方向。",
  "培养方案 PDF 不等于结构化课程表；17/600 的精确格不代表其余格为零。",
  "轻测是产品自编的轻量探索题，不是心理学验证的专业测评，也不是职业判决。"
] as const;

export type LibraryCategory = {
  id: string;
  label: string;
  keywords: string[];
  description: string;
};

/** Only career-related material categories; no office/podcast/video tools. */
export const LIBRARY_CATEGORIES: LibraryCategory[] = [
  {
    id: "employment-report",
    label: "就业质量报告",
    keywords: ["就业质量", "毕业生", "就业报告"],
    description: "学校公开的就业质量与去向统计；只在已载入且核验后展示引用。"
  },
  {
    id: "curriculum",
    label: "培养方案",
    keywords: ["培养方案", "课程", "学分", "教学计划"],
    description: "专业培养方案与课程结构；当前结构化课程表仍待载入。"
  },
  {
    id: "competition",
    label: "竞赛目录",
    keywords: ["竞赛", "素拓", "认定", "创新创业"],
    description: "竞赛目录与素质拓展认定口径；用于解释准备成本与认定规则。"
  },
  {
    id: "handbook",
    label: "学生手册 / FAQ",
    keywords: ["学生手册", "FAQ", "学籍", "制度", "常见问题"],
    description: "学籍、选课与日常事务的公开制度说明。"
  },
  {
    id: "recruiting",
    label: "招聘要求",
    keywords: ["招聘", "岗位", "要求", "JD"],
    description: "已归档的招聘要求快照，按方向汇总；不代表本校历史去向。"
  },
  {
    id: "research",
    label: "研究快照",
    keywords: ["研究", "快照", "unified"],
    description: "研究阶段的来源与记录快照；引用时区分记录与人数。"
  }
];

export const LIBRARY_DISCLAIMER =
  "资料问答只使用已载入且允许展示的生涯资料，回答必须带引用；没有证据时明确拒答，不编造来源，也不访问互联网。";

export const LIBRARY_ASK_BOUNDARY =
  "问题不超过 1000 字，对话历史最多保留 4 条（约 2 轮问答）。回答中的引用编号对应下方引用卡，不生成外部链接。";

export const LIBRARY_EXAMPLE_QUESTIONS = [
  "本专业的培养方案里有哪些与国际贸易相关的课程？",
  "学校公开的就业质量报告里如何描述毕业生去向？",
  "参加学科竞赛可以认定哪些素质拓展学分？",
  "学生手册里关于选课和重修是怎么规定的？"
];

export type PlanWindow = "current_term" | "next_term" | "later";

export const PLAN_WINDOW_LABELS: Record<PlanWindow, string> = {
  current_term: "当前学期",
  next_term: "下学期",
  later: "更晚一些"
};

export const PLAN_WINDOW_ORDER: PlanWindow[] = ["current_term", "next_term", "later"];

export type TermOption = { value: string; label: string };

function gradeLabel(enrollmentYear: number, academicYearStart: number): string {
  const index = academicYearStart - enrollmentYear;
  if (index <= 0) return "大一";
  if (index === 1) return "大二";
  if (index === 2) return "大三";
  if (index === 3) return "大四";
  return `第 ${index + 1} 年`;
}

/** Academic terms from enrollment to +5 years, formatted `YYYY-秋 / YYYY-春`. */
export function buildTermOptions(enrollmentYear: number | null | undefined): TermOption[] {
  const start = enrollmentYear && enrollmentYear >= 2010 ? enrollmentYear : new Date().getFullYear() - 1;
  const options: TermOption[] = [];
  for (let year = start; year <= start + 5; year += 1) {
    const grade = gradeLabel(start, year);
    options.push({ value: `${year}-秋`, label: `${year} 秋 · ${grade}上` });
    options.push({ value: `${year}-春`, label: `${year} 春 · ${grade}下` });
  }
  return options;
}

export function currentTermValue(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 8) return `${year}-秋`;
  if (month <= 1) return `${year - 1}-秋`;
  return `${year}-春`;
}

export function defaultEnrollmentYear(now: Date = new Date()): number {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // Most first/second-year users: assume enrolled last September unless it is
  // already the autumn term, in which case the current cohort is plausible.
  return month >= 8 ? year : year - 1;
}

export function windowLabel(window: PlanWindow | string): string {
  return PLAN_WINDOW_LABELS[window as PlanWindow] ?? window;
}

export const SEASON_LABEL: Record<string, string> = { 春: "春季", 秋: "秋季" };
