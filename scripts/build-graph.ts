/**
 * 生成知识图谱快照。
 *
 * 数据来源（全部在本仓，可回溯）：
 * - data/import/seed/directions.json        方向卡
 * - worker/app/reference_data/curriculum.json   培养方案课程
 * - worker/app/reference_data/competitions.json 竞赛目录 + 校内 A/B/C
 * - worker/app/reference_data/resources.json    校内/外部查证入口
 * - worker/app/reference_data/employment.json   就业质量报告事实
 * - worker/app/reference_data/industry.json     招聘快照
 *
 * 产出：src/lib/graph/snapshot.json
 *
 * 用法：npm run graph:build
 */
import fs from "node:fs";
import path from "node:path";
import type {
  GraphCitation,
  GraphEdge,
  GraphGuide,
  GraphNode,
  GraphParagraph,
  GraphSection,
  GraphSnapshot,
  GraphStatus,
  GraphNodeType
} from "../src/lib/graph/types";

const ROOT = process.cwd();
const BUILT_AT = new Date().toISOString();
const SNAPSHOT_DATE = BUILT_AT.slice(0, 10);

type DirectionSeed = {
  direction_id: string;
  title: string;
  short_title: string;
  summary: string;
  work_content: string[];
  verified_skills: string[];
  preparation_cost: string;
  applicability: string;
  data_gaps: string[];
};

type Course = {
  course_id: string;
  name: string;
  credits: number | null;
  terms: string[];
  nature: string;
  prerequisites: string[];
  skills: string[];
  direction_ids: string[];
};

type CurriculumMajor = {
  major_name: string;
  cohort_year: number;
  degree?: string;
  source: { title: string; url: string; locator: string };
  verification_status: string;
  courses: Course[];
};

type Competition = {
  competition_id: string;
  name: string;
  organizer: string;
  level_label: string;
  timing: string;
  official_url: string;
  direction_ids: string[];
  skill_tags: string[];
  verification_status: string;
  source_title?: string;
  school_recognition: { official_level: string | null; note?: string; source_title?: string };
};

type Resource = {
  resource_id: string;
  name: string;
  category: string;
  description: string;
  url: string;
  verification_status: string;
  source_title: string;
};

type EmploymentFact = {
  fact_id: string;
  cohort: string;
  metric_name: string;
  value: number | null;
  unit: string;
  source_title: string;
  source_url: string;
  locator: string;
  verification_status: string;
};

type IndustryGroup = {
  group_id: string;
  major_group: string;
  direction_ids: string[];
  sample_size: number;
  status: string;
  top_terms: { term: string; count: number }[];
  salary_snapshot: string[];
  job_families: string[];
  requirement_categories: Record<string, Record<string, number>>;
  note: string;
};

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8")) as T;
}

function must<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) throw new Error(message);
  return value;
}

const directionsSeed = readJson<{ directions: DirectionSeed[] }>("data/import/seed/directions.json");
const curriculum = readJson<{ majors: CurriculumMajor[] }>("worker/app/reference_data/curriculum.json");
const competitionsData = readJson<{ competitions: Competition[]; official_list_source: string }>(
  "worker/app/reference_data/competitions.json"
);
const resourcesData = readJson<{ resources: Resource[] }>("worker/app/reference_data/resources.json");
const employment = readJson<{ facts: EmploymentFact[] }>("worker/app/reference_data/employment.json");
const industry = readJson<{
  source: { title: string; url: string; date: string; note: string };
  groups: IndustryGroup[];
}>("worker/app/reference_data/industry.json");

const DIRECTION_IDS = directionsSeed.directions.map((d) => d.direction_id);
const MAJOR = must(
  curriculum.majors.find((m) => m.major_name === "国际经济与贸易" && m.cohort_year === 2024),
  "找不到 国际经济与贸易 2024 级培养方案"
);

/* ------------------------------------------------------------------ */
/* 引用                                                               */
/* ------------------------------------------------------------------ */

const citations: GraphCitation[] = [];
const citationByKey = new Map<string, string>();

function addCitation(
  key: string,
  title: string,
  url: string | null,
  locator: string,
  status: GraphStatus
): string {
  const existing = citationByKey.get(key);
  if (existing) return existing;
  const id = key;
  citations.push({ id, no: citations.length + 1, title, url, locator, status });
  citationByKey.set(key, id);
  return id;
}

const citeCurriculum = addCitation(
  "curriculum-2024",
  MAJOR.source.title,
  MAJOR.source.url,
  MAJOR.source.locator,
  "official_lead"
);
const citeDirectionCard = addCitation(
  "direction-card",
  "方向卡（团队整理）",
  null,
  "data/import/seed/directions.json",
  "partial"
);
const citeCompetitionList = addCitation(
  "competition-list",
  competitionsData.official_list_source,
  "https://www.suibe.edu.cn/xsc/",
  "A/B/C 学校奖励等级；具体加分与素拓折算以当年学院、团委文件为准",
  "official_lead"
);
const citeIndustry = addCitation(
  "industry-snapshot",
  industry.source.title,
  industry.source.url,
  `采集 ${industry.source.date}；${industry.source.note}`,
  "external_reference"
);

function employmentCitation(fact: EmploymentFact, key: string): string {
  return addCitation(key, fact.source_title, fact.source_url, fact.locator, "pending");
}

const rate2021 = employment.facts.find((f) => f.fact_id === "suibe-2021-employment_rate");
const rate2022 = employment.facts.find((f) => f.fact_id === "suibe-2022-employment_rate");
const shanghai2021 = employment.facts.find((f) => f.fact_id === "suibe-2021-shanghai_share-本科");
const citeEmployment2021 = rate2021 ? employmentCitation(rate2021, "employment-2021") : null;
const citeEmployment2022 = rate2022 ? employmentCitation(rate2022, "employment-2022") : null;

/* ------------------------------------------------------------------ */
/* 节点 / 边                                                          */
/* ------------------------------------------------------------------ */

const nodes: GraphNode[] = [];
const nodeIds = new Set<string>();
const edges: GraphEdge[] = [];
const edgeKeys = new Set<string>();

function addNode(node: GraphNode) {
  if (nodeIds.has(node.id)) return;
  nodeIds.add(node.id);
  nodes.push(node);
}

function addEdge(source: string, target: string) {
  if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) return;
  const key = [source, target].sort().join("→");
  if (edgeKeys.has(key)) return;
  edgeKeys.add(key);
  edges.push({ source, target });
}

function evidence(text: string, cited: string[] = []): GraphParagraph {
  return { tag: "evidence", text, citations: cited.filter((c) => citationByKey.has(c)) };
}
function inference(text: string): GraphParagraph {
  return { tag: "inference", text, citations: [] };
}
function gap(text: string): GraphParagraph {
  return { tag: "gap", text, citations: [] };
}
function section(heading: string, paragraphs: GraphParagraph[]): GraphSection {
  return { heading, paragraphs };
}
function guide(label: string, url: string, look: string, cadence: string): GraphGuide {
  return { label, url, look, cadence, last_checked: SNAPSHOT_DATE };
}

function typeLabelOf(type: GraphNodeType): string {
  switch (type) {
    case "direction":
      return "方向";
    case "program":
      return "培养方案";
    case "course":
      return "课程";
    case "competition":
      return "竞赛";
    case "job":
      return "岗位族";
    case "resource":
      return "查证入口";
    case "gap":
      return "数据缺口";
    default:
      return "画像";
  }
}

/* -------------------------- 课程选择 -------------------------- */

/** 每个方向挑 2 门最相关的课程：方向关键词优先，其次必修/学分。 */
const COURSE_KEYWORDS: Record<string, string[]> = {
  trade_supply_chain: ["国际贸易实务", "国际商法", "贸易", "国际商务", "单证"],
  cross_border_business: ["跨境", "电商", "商务谈判", "国际商务", "网络"],
  finance_accounting: ["会计", "财务", "金融", "货币", "投资"],
  data_business: ["计量", "统计", "Python", "数据", "量化"],
  public_service: ["政治经济", "公共", "政策", "论文", "写作"],
  further_study: ["计量", "统计", "论文", "研究方法", "经济学"]
};

function courseScore(course: Course, directionId: string): number {
  const keywords = COURSE_KEYWORDS[directionId] ?? [];
  let score = course.nature === "必修" ? 1 : 0;
  score += (course.credits ?? 0) * 0.2;
  for (const keyword of keywords) {
    if (course.name.includes(keyword)) score += 4;
  }
  return score;
}

const selectedCourses: Course[] = [];
for (const directionId of DIRECTION_IDS) {
  const candidates = MAJOR.courses
    .filter((course) => course.direction_ids.includes(directionId))
    .sort(
      (a, b) =>
        courseScore(b, directionId) - courseScore(a, directionId) ||
        (b.credits ?? 0) - (a.credits ?? 0) ||
        a.name.localeCompare(b.name, "zh")
    );
  for (const course of candidates.slice(0, 2)) {
    if (!selectedCourses.some((existing) => existing.course_id === course.course_id)) {
      selectedCourses.push(course);
    }
  }
}

/* -------------------------- 竞赛选择 -------------------------- */

/** 每个方向挑 2 个最相关的赛事：方向关键词优先，其次校内等级。 */
const COMPETITION_KEYWORDS: Record<string, string[]> = {
  trade_supply_chain: ["贸易", "商务", "谈判", "经贸", "商科", "英语"],
  cross_border_business: ["电商", "跨境", "创新", "创业", "商务", "英语"],
  finance_accounting: ["金融", "会计", "财会", "市场调查", "投资"],
  data_business: ["统计", "数据", "建模", "计算机", "软件", "市场调查"],
  public_service: ["公共", "管理", "案例", "模拟", "职业规划", "辩论"],
  further_study: ["数学建模", "统计", "挑战杯", "研究", "学术"]
};

function competitionLevelScore(competition: Competition): number {
  const level = competition.school_recognition.official_level;
  if (level === "A") return 3;
  if (level === "B") return 2;
  if (level === "C") return 1;
  return 0;
}

function competitionScore(competition: Competition, directionId: string): number {
  const keywords = COMPETITION_KEYWORDS[directionId] ?? [];
  let score = competitionLevelScore(competition);
  if (competition.official_url) score += 0.5;
  const haystack = `${competition.name} ${competition.skill_tags.join(" ")}`;
  for (const keyword of keywords) {
    if (haystack.includes(keyword)) score += 4;
  }
  return score;
}

const UNDERGRAD_YEARS = new Set(["大一", "大二", "大三", "大四", "本科"]);

function isUndergradCompetition(competition: Competition): boolean {
  if (competition.name.includes("研究生")) return false;
  const years = competition.eligible_years ?? [];
  if (years.length === 0) return true;
  return years.some((year) => UNDERGRAD_YEARS.has(year));
}

const selectedCompetitions: Competition[] = [];
for (const directionId of DIRECTION_IDS) {
  const candidates = competitionsData.competitions
    .filter((competition) => competition.direction_ids.includes(directionId) && isUndergradCompetition(competition))
    .sort(
      (a, b) =>
        competitionScore(b, directionId) - competitionScore(a, directionId) ||
        competitionLevelScore(b) - competitionLevelScore(a) ||
        a.name.localeCompare(b.name, "zh")
    );
  for (const competition of candidates.slice(0, 2)) {
    const duplicated = selectedCompetitions.some(
      (existing) => existing.competition_id === competition.competition_id || existing.name === competition.name
    );
    if (!duplicated) selectedCompetitions.push(competition);
  }
}

const selectedCompetitionsCapped = selectedCompetitions.slice(0, 10);

/* -------------------------- 资源选择 -------------------------- */

const RESOURCE_DIRECTIONS: Record<string, string[]> = {
  "suibe-jwc": DIRECTION_IDS,
  "suibe-job": ["trade_supply_chain", "finance_accounting", "data_business", "public_service", "further_study"],
  "suibe-tw": ["cross_border_business", "public_service"],
  "suibe-lib": ["finance_accounting", "data_business", "further_study"],
  "xz-chsi": ["data_business", "further_study"]
};

const selectedResources = resourcesData.resources.filter((resource) =>
  Object.keys(RESOURCE_DIRECTIONS).includes(resource.resource_id)
);

/* -------------------------- 缺口定义 -------------------------- */

type GapSeed = { id: string; title: string; dirs: string[]; basis: string; guides: GraphGuide[] };

const gapSeeds: GapSeed[] = [
  {
    id: "gap-employment",
    title: "2023–2025 届去向数据",
    dirs: ["trade_supply_chain", "data_business", "further_study"],
    basis:
      "语料里的就业质量报告只覆盖 2021/2022 届；2023–2025 届该专业/该方向的去向、行业与薪资没有收录，不能据此推断趋势。",
    guides: [
      guide("学生就业信息网 · 就业质量报告栏目", "https://job.suibe.edu.cn/", "报告 PDF 中的分专业/分学院去向、主要就业行业、在沪就业比例", "每年 12 月前后发布上一届报告"),
      guide("学校信息公开网", "https://www.suibe.edu.cn/", "按年份与栏目核对就业质量年度报告原文", "每年更新")
    ]
  },
  {
    id: "gap-certificate",
    title: "证书与实习门槛",
    dirs: ["finance_accounting"],
    basis:
      "金融与财会方向的证书要求（初级会计、CPA、CFA 等）没有进入语料；招聘快照中的金融岗位样本为 0，无法给出录取或门槛判断。",
    guides: [
      guide("财政部会计资格评价中心", "https://kzp.mof.gov.cn/", "初级/中级会计资格考试报名条件与时间", "每年更新"),
      guide("学生就业信息网 · 实习信息", "https://job.suibe.edu.cn/", "本校发布的实习岗位与要求", "按学期更新")
    ]
  },
  {
    id: "gap-platform",
    title: "跨境电商平台规则",
    dirs: ["cross_border_business"],
    basis:
      "平台入驻、佣金、合规与账号规则变化快，且语料没有本校在该方向的直接就业样本，不能把平台规则写成固定结论。",
    guides: [
      guide("跨境电商平台官方规则中心", "https://www.amazon.com/", "以平台官方卖家规则中心为准，按站点分别核对", "持续更新"),
      guide("教务处 · 创新创业栏目", "https://jwc.suibe.edu.cn/18805/list.htm", "校内跨境电商相关课程、项目与赛事通知", "按学期更新")
    ]
  },
  {
    id: "gap-public-exam",
    title: "招录条件与考试科目",
    dirs: ["public_service"],
    basis:
      "公务员/事业单位的岗位表、专业限制、基层经历要求与考试科目逐年变化，未进入语料；本页面不展示任何未经核对的招录结论。",
    guides: [
      guide("国家公务员局 · 考试录用专题", "http://www.scs.gov.cn/", "当年岗位表、专业限制、报名条件与考试科目", "每年公告发布时更新"),
      guide("学校学生就业信息网", "https://job.suibe.edu.cn/", "校内选调、基层项目与就业指导通知", "按学期更新")
    ]
  }
];

/* ------------------------------------------------------------------ */
/* 节点：画像 / 方向 / 培养方案                                        */
/* ------------------------------------------------------------------ */

addNode({
  id: "me",
  type: "me",
  title: "你（国贸 · 大一）",
  sub: "上经贸 · 国际经济与贸易",
  status: "verified",
  why: "图谱的起点：画像来自 16 题问卷与本地进度（快照里用摘要代替）。",
  wiki: {
    sections: [
      section("你的画像", [
        inference(
          "上经贸 · 国际经济与贸易 · 大一；优势是写作、数据分析与英语；待补足的是外贸实操、客户沟通经历与一个可展示的成果。正式实现会读取问卷与本地进度，这里以摘要代替。"
        )
      ]),
      section("怎么用这张图", [
        inference(
          "点击任一节点打开它的 Wiki 页：先看「本校口径」，再看「数据缺口」与「去哪查」；缺口节点只给入口，不给结论。"
        )
      ])
    ],
    guides: [
      guide("教务处 · 培养方案", "https://jwc.suibe.edu.cn/", "本专业教学计划表：课程与学分", "每年 5–7 月更新"),
      guide("学职平台", "https://xz.chsi.com.cn/", "职业兴趣与能力测评参考（非本校口径）", "随时可用")
    ]
  }
});

const directionWiki = (direction: DirectionSeed): GraphNode["wiki"] => {
  const dirCourses = selectedCourses.filter((course) => course.direction_ids.includes(direction.direction_id));
  const dirCompetitions = selectedCompetitionsCapped.filter((competition) =>
    competition.direction_ids.includes(direction.direction_id)
  );
  const industryGroup = industry.groups.find((group) => group.direction_ids.includes(direction.direction_id));
  const employmentParas: GraphParagraph[] = [];
  if (rate2021) {
    employmentParas.push(
      evidence(
        `2021 届毕业生毕业去向落实率 ${rate2021.value}%（本科口径见报告）；${shanghai2021 ? `本科在沪就业比例 ${shanghai2021.value}%` : "在沪就业比例未收录"}。`,
        citeEmployment2021 ? [citeEmployment2021] : []
      )
    );
  }
  if (rate2022) {
    employmentParas.push(
      evidence(`2022 届毕业去向落实率 ${rate2022.value}%。`, citeEmployment2022 ? [citeEmployment2022] : [])
    );
  }
  employmentParas.push(gap("2023–2025 届就业质量报告尚未收进语料，不能据此推断趋势，也不做跨届相减。"));
  if (industryGroup && industryGroup.sample_size > 0) {
    const topTerms = industryGroup.top_terms
      .slice(0, 4)
      .map((item) => `${item.term}（${item.count} 次）`)
      .join("、");
    employmentParas.push(
      evidence(
        `BOSS 直聘实习岗位快照（${industry.source.date}）中「${industryGroup.major_group}」岗位族有 ${industryGroup.sample_size} 条样本；高频要求：${topTerms || "未提取到"}；广告薪资：${industryGroup.salary_snapshot.join(" / ") || "未提供"}。该样本为非代表性目的抽样，未提及不等于不需要。`,
        [citeIndustry]
      )
    );
  } else if (industryGroup) {
    employmentParas.push(
      gap(`「${industryGroup.major_group}」岗位族没有可用招聘样本（采集过程因环境风险中止），不能给出要求或薪资判断。`)
    );
  }

  const guides: GraphGuide[] = [
    guide("学生就业信息网 · 就业质量报告", "https://job.suibe.edu.cn/", "毕业去向落实率、主要就业行业、在沪就业比例", "每年 12 月前后发布上一届报告"),
    guide("教务处 · 培养方案与教学计划", "https://jwc.suibe.edu.cn/", "课程、学分、开课学期与选课资格", "每年 5–7 月更新"),
    guide("党委学工部 · 竞赛奖励清单", "https://www.suibe.edu.cn/xsc/", "《竞赛奖励项目清单》A/B/C 等级与加分口径", "每学年更新")
  ];
  if (direction.direction_id === "cross_border_business" || direction.direction_id === "public_service") {
    guides.push(guide("团委 · 第二课堂与素拓", "https://www.suibe.edu.cn/tw/", "素拓活动与竞赛认定通知", "按学期更新"));
  }

  return {
    sections: [
      section("这是什么", [
        evidence(direction.summary, [citeDirectionCard]),
        inference(`核心能力：${direction.verified_skills.join("、")}。适用专业：${direction.applicability}`)
      ]),
      section("本校口径", employmentParas),
      section("门槛与投入", [
        evidence(
          `培养方案（2024 级）中与本方向相关的课程：${dirCourses
            .map((course) => `《${course.name}》（${course.credits ?? "?"} 学分）`)
            .join("、")}。`,
          [citeCurriculum]
        ),
        evidence(
          `校内竞赛奖励清单中与本方向相关的赛事：${dirCompetitions
            .map((competition) => `${competition.name}（${competition.school_recognition.official_level ?? "等级待核"} 级）`)
            .join("、")}。A/B/C 为学校奖励等级，具体加分/素拓折算以当年学院与团委文件为准。`,
          [citeCompetitionList]
        ),
        inference(`准备方式：${direction.preparation_cost}`)
      ]),
      section("与你的画像", [
        inference(
          "以「国贸 · 大一」画像为例：写作、数据分析与英语是优势；需要补足的是对应方向的实操经历与一个能展示的成果。正式实现会读取问卷分数。"
        )
      ]),
      section("行动清单", [
        inference(
          `本学期：选一门方向课（如 ${dirCourses[0]?.name ?? "培养方案中的方向课"}），报名一个校内可认定的赛事；30 天：到「去哪查」的官方入口核对课程与竞赛口径，并把核对日期记录下来。`
        )
      ]),
      section("数据缺口", [gap(`${direction.data_gaps.join("；")}。这些缺口不会用推测填充，页面只展示已有证据。`)])
    ],
    guides
  };
};

for (const direction of directionsSeed.directions) {
  const status: GraphStatus =
    direction.direction_id === "public_service"
      ? "pending"
      : direction.direction_id === "data_business"
        ? "official_lead"
        : "partial";
  addNode({
    id: direction.direction_id,
    type: "direction",
    title: direction.title,
    sub: direction.short_title,
    status,
    why: `方向卡来自团队整理；相关课程与竞赛取自本校培养方案与竞赛清单，去向数据只覆盖 2021/2022 届。`,
    wiki: directionWiki(direction)
  });
}

const requiredCourses = MAJOR.courses.filter((course) => course.nature === "必修");
addNode({
  id: "program-2024",
  type: "program",
  title: "国际经济与贸易培养方案（2024 级）",
  sub: `${MAJOR.courses.length} 门课 · 必修 ${requiredCourses.length} 门`,
  status: "official_lead",
  why: "课程证据的总入口：所有课程节点都从这份培养方案的教学计划表取数。",
  wiki: {
    sections: [
      section("培养方案", [
        evidence(
          `2024 级国际经济与贸易专业培养方案共 ${MAJOR.courses.length} 门课、其中必修 ${requiredCourses.length} 门；学分、开课学期与选课资格以教务处当年方案与选课系统为准。`,
          [citeCurriculum]
        ),
        evidence(
          `图谱中收录了与本专业 6 个方向相关的 ${selectedCourses.length} 门课程：${selectedCourses
            .map((course) => `《${course.name}》`)
            .join("、")}。`,
          [citeCurriculum]
        ),
        gap("课程为机器提取，学分、先修与开课学期未逐条人工复核；选课前必须回到教务处方案核对。")
      ])
    ],
    guides: [
      guide("教务处 · 培养方案", "https://jwc.suibe.edu.cn/", "教学计划表：课程、学分、开课学期、先修要求", "每年 5–7 月更新"),
      guide("教务处 · 选课通知", "https://jwc.suibe.edu.cn/", "选课时间、容量与资格限制", "每学期")
    ]
  }
});

/* ------------------------------------------------------------------ */
/* 节点：课程 / 竞赛 / 岗位族 / 入口 / 缺口                            */
/* ------------------------------------------------------------------ */

for (const course of selectedCourses) {
  const directionTitles = course.direction_ids
    .map((id) => directionsSeed.directions.find((direction) => direction.direction_id === id)?.title)
    .filter((title): title is string => Boolean(title));
  addNode({
    id: `course-${course.course_id}`,
    type: "course",
    title: course.name,
    sub: `${course.credits ?? "?"} 学分 · ${course.terms.length > 0 ? course.terms.join(" / ") : "学期待核"} · ${course.nature}`,
    status: "official_lead",
    why: `培养方案课程，关联 ${directionTitles.length} 个方向。`,
    wiki: {
      sections: [
        section("课程信息", [
          evidence(
            `《${course.name}》（${course.credits ?? "?"} 学分，${course.terms.length > 0 ? course.terms.join(" / ") : "学期待核"}，${course.nature}）。技能标签：${course.skills.length > 0 ? course.skills.join("、") : "未标注"}。学分与学期为机器提取，最终以教务处当年方案与选课系统为准。`,
            [citeCurriculum]
          )
        ]),
        section("关联方向", [
          inference(`直接关联：${directionTitles.join("、") || "—"}。课程覆盖方向所需的部分能力，但课程本身不等于录用资格。`)
        ])
      ],
      guides: [
        guide("教务处 · 培养方案", "https://jwc.suibe.edu.cn/", "课程学分、开课学期、先修要求", "每年 5–7 月更新")
      ]
    }
  });
}

for (const competition of selectedCompetitionsCapped) {
  const directionTitles = competition.direction_ids
    .map((id) => directionsSeed.directions.find((direction) => direction.direction_id === id)?.title)
    .filter((title): title is string => Boolean(title));
  const officialLevel = competition.school_recognition.official_level;
  addNode({
    id: `competition-${competition.competition_id}`,
    type: "competition",
    title: competition.name,
    sub: `${competition.level_label}${officialLevel ? ` · 校内 ${officialLevel} 级` : " · 校内等级待核"}`,
    status: officialLevel ? "official_lead" : "unverified",
    why: `校园竞赛目录中的赛事，关联 ${directionTitles.length} 个方向。`,
    wiki: {
      sections: [
        section("赛事信息", [
          evidence(
            `${competition.name}，${competition.level_label}，主办方：${competition.organizer || "未标注"}。时间：${competition.timing || "以当年通知为准"}。`,
            [addCitation(`competition-${competition.competition_id}`, competition.source_title ?? competition.name, competition.official_url || null, "官方赛事页面 / 通知", "official_lead")]
          ),
          officialLevel
            ? evidence(
                `校内奖励等级：${officialLevel} 级（《上海对外经贸大学竞赛奖励项目清单》）。具体加分与素拓折算以当年学院、团委文件为准。`,
                [citeCompetitionList]
              )
            : gap("校内奖励等级尚未在清单中确认，不能据此判断加分。")
        ]),
        section("关联方向", [inference(`可以支撑：${directionTitles.join("、") || "—"}。赛事可以作为能力证据，但不是录用保证。`)])
      ],
      guides: [
        guide("学校竞赛奖励清单", "https://www.suibe.edu.cn/xsc/", "赛事等级（A/B/C）与加分口径", "每学年更新"),
        guide("教务处 · 创新创业栏目", "https://jwc.suibe.edu.cn/18805/list.htm", "校内选拔通知与报名入口", "按赛事更新"),
        competition.official_url
          ? guide("官方赛事页面", competition.official_url, "报名时间、资格与赛制", "按赛事更新")
          : guide("学校竞赛通知", "https://www.suibe.edu.cn/xsc/", "校内通知与报名方式", "按赛事更新")
      ]
    }
  });
}

for (const group of industry.groups) {
  const dirs = group.direction_ids.filter((id) => DIRECTION_IDS.includes(id));
  if (dirs.length === 0) continue;
  const title = `${group.job_families[0] ?? group.major_group}（岗位族）`;
  const hasSample = group.sample_size > 0;
  addNode({
    id: `job-${group.group_id}`,
    type: "job",
    title,
    sub: hasSample ? `招聘快照 ${group.sample_size} 条 · 非代表性` : "招聘快照无样本",
    status: hasSample ? "external_reference" : "pending",
    why: hasSample
      ? `来自 BOSS 直聘实习岗位快照，关联 ${dirs.length} 个方向。`
      : "该岗位族没有可用招聘样本，因此是待核验节点。",
    wiki: {
      sections: [
        section("招聘快照", [
          hasSample
            ? evidence(
                `BOSS 直聘实习岗位快照（${industry.source.date}）中「${group.major_group}」岗位族有 ${group.sample_size} 条样本；高频要求：${group.top_terms
                  .slice(0, 4)
                  .map((item) => `${item.term}（${item.count} 次）`)
                  .join("、")}；广告薪资：${group.salary_snapshot.join(" / ") || "未提供"}。非代表性目的抽样，未提及不等于不需要。`,
                [citeIndustry]
              )
            : gap("该岗位族没有可用招聘样本（采集过程因环境风险中止），不能给出要求或薪资判断。"),
          inference("把高频要求当成「要补的能力清单」，而不是「录用概率」；样本不能外推到整个行业。")
        ]),
        section("关联方向", [
          inference(
            `对应方向：${dirs
              .map((id) => directionsSeed.directions.find((direction) => direction.direction_id === id)?.title)
              .filter(Boolean)
              .join("、")}。`
          )
        ])
      ],
      guides: [
        guide("国家大学生就业服务平台", "https://cxcy.ncss.cn/", "同类岗位的完整 JD 与行业分布", "持续更新"),
        guide("学生就业信息网", "https://job.suibe.edu.cn/", "校招与实习信息", "按学期更新")
      ]
    }
  });
}

addNode({
  id: "job-further-study",
  type: "job",
  title: "研究助理 / 研究生（路径）",
  sub: "升学不是岗位族，是路径",
  status: "partial",
  why: "升学路径的关键事实（推免细则、各学院名额）未收进语料。",
  wiki: {
    sections: [
      section("路径说明", [
        inference("国内考研、出国（境）深造与研究型岗位属于路径而非岗位族；关键门槛是成绩排名、科研/竞赛经历与学院推免细则。"),
        gap("推免细则各学院不同、C 级竞赛未在计分表中；语料未收录各学院当年文件。")
      ]),
      section("与你的画像", [inference("国贸·大一可以先补数学/计量与学术写作，再决定是否走研究路径。")])
    ],
    guides: [
      guide("学校研究生院 / 学院官网", "https://www.suibe.edu.cn/", "推免办法、名额、公示与培养方案", "每年更新"),
      guide("图书馆 · 文献检索", "https://lib.suibe.edu.cn/", "文献检索与研究入门", "按需")
    ]
  }
});

for (const resource of selectedResources) {
  const dirs = RESOURCE_DIRECTIONS[resource.resource_id] ?? [];
  addNode({
    id: `resource-${resource.resource_id}`,
    type: "resource",
    title: resource.name,
    sub: resource.category,
    status: resource.category.includes("校内") ? "official_lead" : "external_reference",
    why: `查证入口，共用于 ${dirs.length} 个方向。`,
    wiki: {
      sections: [
        section("入口说明", [
          evidence(
            `${resource.name}：${resource.description}`,
            [addCitation(`resource-${resource.resource_id}`, resource.source_title, resource.url, resource.description, "official_lead")]
          ),
          inference("优先核对与本方向直接相关的栏目与字段（见「去哪查」），并把核对日期记录下来。")
        ])
      ],
      guides: [guide(resource.name, resource.url, resource.description, "以栏目更新为准")]
    }
  });
}

for (const gapSeed of gapSeeds) {
  addNode({
    id: gapSeed.id,
    type: "gap",
    title: gapSeed.title,
    sub: "数据缺口 · 待查",
    status: "pending",
    why: "这一步没有可用数据：只提供查证入口，不给结论。",
    wiki: {
      sections: [
        section("缺什么", [gap(gapSeed.basis)]),
        section("为什么不能猜", [
          inference(
            "缺口不进入结论：页面上不写没有来源的数字，也不用其它学校/其它届的数据替代。缺口的价值是给你下一步动作，而不是一个看起来完整的答案。"
          )
        ])
      ],
      guides: gapSeed.guides
    }
  });
}

/* ------------------------------------------------------------------ */
/* 边                                                                  */
/* ------------------------------------------------------------------ */

for (const direction of directionsSeed.directions) {
  addEdge("me", direction.direction_id);
  addEdge("program-2024", direction.direction_id);
}

for (const course of selectedCourses) {
  addEdge("program-2024", `course-${course.course_id}`);
  for (const directionId of course.direction_ids) {
    addEdge(directionId, `course-${course.course_id}`);
  }
}

for (const competition of selectedCompetitionsCapped) {
  for (const directionId of competition.direction_ids) {
    addEdge(directionId, `competition-${competition.competition_id}`);
  }
}

for (const group of industry.groups) {
  for (const directionId of group.direction_ids) {
    addEdge(directionId, `job-${group.group_id}`);
  }
}
addEdge("further_study", "job-further-study");

for (const resource of selectedResources) {
  for (const directionId of RESOURCE_DIRECTIONS[resource.resource_id] ?? []) {
    addEdge(directionId, `resource-${resource.resource_id}`);
  }
}

for (const gapSeed of gapSeeds) {
  for (const directionId of gapSeed.dirs) {
    addEdge(directionId, gapSeed.id);
  }
}

/* ------------------------------------------------------------------ */
/* 快照                                                                */
/* ------------------------------------------------------------------ */

const snapshot: GraphSnapshot = {
  version: `graph-${SNAPSHOT_DATE}.1`,
  built_at: BUILT_AT,
  profile: {
    label: "上经贸 · 国际经济与贸易 · 大一",
    note: "演示画像：写作 / 数据分析 / 英语。正式实现读取 16 题问卷与本地进度。"
  },
  citations,
  nodes,
  edges,
  boundaries: [
    "方向卡是团队整理；课程来自培养方案机器提取，未逐条人工复核。",
    "就业事实只覆盖 2021/2022 届，且为 pending；不展示未核验的就业率、薪资或通过率。",
    "招聘快照为非代表性目的抽样，未提及不等于不需要，不能外推行业。",
    "图谱只做导航与引用，不替代官方文件；所有数字都应回到来源核对。"
  ]
};

const outputPath = path.join(ROOT, "src/lib/graph/snapshot.json");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

const degrees = new Map<string, number>();
for (const edge of edges) {
  degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
  degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
}

const typeCounts: Record<string, number> = {};
for (const node of nodes) typeCounts[node.type] = (typeCounts[node.type] ?? 0) + 1;

console.log(
  `graph snapshot written: ${outputPath}\n` +
    `  nodes: ${nodes.length} (${Object.entries(typeCounts).map(([type, count]) => `${type}:${count}`).join(", ")})\n` +
    `  edges: ${edges.length}\n` +
    `  citations: ${citations.length}\n` +
    `  degree range: ${Math.min(...degrees.values())}–${Math.max(...degrees.values())}`
);
