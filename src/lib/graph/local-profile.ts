import type { GraphNode, GraphSection, GraphSnapshot } from "./types";
import type { LocalProgress } from "@/lib/local-progress/schema";
import { ASSESSMENT } from "@/lib/content";

/**
 * 图谱里的「你」节点默认来自静态快照（团队演示画像）。评委/用户点开图谱时，
 * 右栏画像会和本次问卷不一致，造成解释成本。这里在客户端把本设备最新进度
 * 合并进快照：只替换画像节点，其余方向/课程/竞赛节点仍来自团队快照。
 */

const PATHWAY_LABELS: Record<string, string> = {
  undergraduate_employment: "本科就业",
  domestic_postgraduate: "国内升学",
  overseas_study: "境外升学",
  public_exam: "公考 / 编制",
  undetermined: "仍不确定"
};

/** 入学年份 → 年级；9 月起算新学年。 */
export function gradeLabelFor(enrollmentYear: number | null | undefined, now = new Date()): string {
  if (!enrollmentYear) return "";
  const currentAcademicYear = now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  const index = currentAcademicYear - enrollmentYear;
  if (index <= 0) return "大一";
  if (index === 1) return "大二";
  if (index === 2) return "大三";
  if (index === 3) return "大四";
  return `第 ${index + 1} 年`;
}

/** `2026-秋` → `2026 秋`；其它形态原样返回。 */
export function termLabel(term: string | null | undefined): string {
  const value = (term ?? "").trim();
  if (!value) return "";
  return value.replace(/-秋$/, " 秋").replace(/-春$/, " 春");
}

export type LocalProfileOptions = {
  pathwayPrimary?: string | null;
  now?: Date;
};

export function withLocalProfile(
  snapshot: GraphSnapshot,
  progress: LocalProgress | null,
  hydrated: boolean,
  options: LocalProfileOptions = {}
): GraphSnapshot {
  if (!hydrated || !progress) return snapshot;
  const { school, major, enrollment_year, current_term, answers } = progress.profile;
  if (!school.trim() && !major.trim()) return snapshot;

  const me = snapshot.nodes.find((node) => node.type === "me");
  if (!me) return snapshot;

  const grade = gradeLabelFor(enrollment_year, options.now ?? new Date());
  const term = termLabel(current_term);
  // 分母用问卷必答题数；answers 里还可能包含可选的经历题，不能直接数 key。
  const requiredQuestionIds = new Set(
    ASSESSMENT.questions.filter((question) => !question.optional).map((question) => question.question_id)
  );
  const answered = Object.keys(answers ?? {}).filter((key) => requiredQuestionIds.has(key)).length;
  const requiredTotal = requiredQuestionIds.size;
  const pathway = options.pathwayPrimary ? PATHWAY_LABELS[options.pathwayPrimary] ?? "" : "";
  const who = major.trim() || "本专业";
  const title = `你（${who}${grade ? ` · ${grade}` : ""}）`;
  const sub = [school.trim(), major.trim(), term].filter(Boolean).join(" · ");
  const why = `画像来自你本设备的最新作答：已完成 ${answered}/${requiredTotal} 题${pathway ? `，主路线是「${pathway}」` : ""}；图谱其余节点来自团队快照。`;

  const profileSection: GraphSection = {
    heading: "你的画像",
    paragraphs: [
      { tag: "evidence", text: `${sub}。`, citations: [] },
      { tag: "inference", text: why, citations: [] }
    ]
  };

  const sections = [...me.wiki.sections];
  const index = sections.findIndex((section) => section.heading === "你的画像");
  if (index >= 0) sections[index] = profileSection;
  else sections.unshift(profileSection);

  const nextMe: GraphNode = {
    ...me,
    title,
    sub,
    why,
    wiki: { ...me.wiki, sections }
  };

  return {
    ...snapshot,
    profile: { label: title, note: "画像读取自本设备最新进度；其余节点来自团队快照。" },
    nodes: snapshot.nodes.map((node) => (node.type === "me" ? nextMe : node))
  };
}
