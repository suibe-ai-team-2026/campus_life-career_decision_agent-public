"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  assessmentProgress,
  isAssessmentComplete,
  scoreAssessment
} from "@/lib/assessment/scoring";
import type { ReadinessBand } from "@/lib/assessment/scoring";
import type { AnswerValue, Answers, PathwayPreference } from "@/lib/contracts/profile";
import {
  ASSESSMENT,
  buildTermOptions,
  currentTermValue,
  defaultEnrollmentYear
} from "@/lib/content";
import {
  readExplorePrefs,
  DEFAULT_PATHWAY_PREFERENCE,
  readLocalProgress,
  updateLocalProgress,
  useLocalProgress,
  writeExplorePrefs
} from "@/lib/local-progress/store";
import { Badge, Button, Callout, Field, Icon } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StepHeader } from "./StepHeader";
import { ExploreQuestionnaire } from "./ExploreQuestionnaire";
import { ExploreResultPanel } from "./ExploreResultPanel";

const YEAR_OPTIONS = (() => {
  const current = new Date().getFullYear();
  const years: number[] = [];
  for (let year = current; year >= 2014; year -= 1) years.push(year);
  return years;
})();

/** 结局页主按钮文案由探索准备度决定；`/directions` 始终是下一步。 */
const READINESS_CTA: Record<ReadinessBand, string> = {
  exploring: "完成探索，先看方向入门",
  comparing: "完成探索，进入方向比较",
  targeted: "完成探索，进入方向与规划",
  unknown: "完成探索，进入方向认知"
};

const EXPERIENCE_QUESTION_ID =
  ASSESSMENT.questions.find((question) => question.section === "experience")?.question_id ?? null;

type FormState = {
  school: string;
  major: string;
  enrollmentYear: number | null;
  currentTerm: string;
  weeklyHours: string;
  monthlyBudget: string;
  pathway: PathwayPreference;
};

const EMPTY_FORM: FormState = {
  school: "",
  major: "",
  enrollmentYear: null,
  currentTerm: "",
  weeklyHours: "",
  monthlyBudget: "",
  pathway: DEFAULT_PATHWAY_PREFERENCE
};

const PATHWAY_OPTIONS: Array<{ value: PathwayPreference["primary"]; label: string; hint: string }> = [
  { value: "undergraduate_employment", label: "本科就业", hint: "更早进入岗位，用实习与项目反馈校正方向" },
  { value: "domestic_postgraduate", label: "国内升学", hint: "继续读研，准备初试、复试与专业积累" },
  { value: "overseas_study", label: "境外升学", hint: "准备语言、项目匹配、申请材料与预算" },
  { value: "public_exam", label: "公考 / 编制", hint: "按目标地区与岗位准备公共科目和面试" },
  { value: "undetermined", label: "仍不确定", hint: "先比较路线，不急着替自己定型" }
];

const EXCLUSION_OPTIONS: Array<{
  value: PathwayPreference["excluded_sectors"][number];
  label: string;
}> = [
  { value: "public_sector", label: "体制内 / 政审类岗位" },
  { value: "finance", label: "金融财会" },
  { value: "data", label: "纯数据分析" },
  { value: "further_study", label: "继续升学" },
  { value: "international_business", label: "外贸 / 跨境业务" }
];

function parseOptionalInt(value: string, min: number, max: number): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
}

function isEmptyAnswer(value: AnswerValue): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    return value.text.trim().length === 0 && value.tags.length === 0;
  }
  return false;
}

export function ExploreStep() {
  const router = useRouter();
  const { hydrated } = useLocalProgress();
  const [initialized, setInitialized] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [skippedBefore, setSkippedBefore] = useState(false);
  const [skipDialogOpen, setSkipDialogOpen] = useState(false);
  const [versionResetNotice, setVersionResetNotice] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const savedTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!hydrated || initialized) return;
    const stored = readLocalProgress();
    const prefs = readExplorePrefs();
    const enrollmentYear = stored?.profile.enrollment_year ?? defaultEnrollmentYear();
    const term = stored?.profile.current_term || currentTermValue();
    setForm({
      school: stored?.profile.school ?? "",
      major: stored?.profile.major ?? "",
      enrollmentYear,
      currentTerm: term,
      weeklyHours: prefs.weekly_hours !== null ? String(prefs.weekly_hours) : "",
      monthlyBudget: prefs.monthly_budget_cny !== null ? String(prefs.monthly_budget_cny) : "",
      pathway: prefs.pathway
    });

    // 题库版本变化时旧答案不可复用：清空作答并明确提示重答，不静默沿用。
    // 旧版页面写入的答案没有 assessment_version，同样按过期处理。
    const storedAnswers: Answers = stored?.profile.answers ?? {};
    const storedVersion = stored?.profile.assessment_version ?? null;
    const versionMismatch = storedVersion !== null && storedVersion !== ASSESSMENT.version;
    const unversionedAnswers = storedVersion === null && Object.keys(storedAnswers).length > 0;
    if (versionMismatch || unversionedAnswers) {
      setAnswers({});
      setVersionResetNotice(true);
      updateLocalProgress((draft) => {
        draft.profile.answers = {};
        draft.profile.assessment_version = ASSESSMENT.version;
        // 与 v1 → v2 迁移一致：旧题库的「已完成」不再成立，需重新作答后才会重新标记。
        draft.profile.completed_at = null;
        return draft;
      });
    } else {
      setAnswers(storedAnswers);
    }

    setSkippedBefore(Boolean(stored?.profile.skipped));
    setInitialized(true);
  }, [hydrated, initialized]);

  useEffect(
    () => () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    },
    []
  );

  const termOptions = useMemo(() => buildTermOptions(form.enrollmentYear), [form.enrollmentYear]);
  const result = useMemo(() => scoreAssessment(ASSESSMENT, answers), [answers]);
  const progress = useMemo(() => assessmentProgress(answers, ASSESSMENT), [answers]);
  const complete = isAssessmentComplete(answers, ASSESSMENT);
  const remaining = Math.max(0, progress.total - progress.answered);
  const experienceAnswered = EXPERIENCE_QUESTION_ID !== null && answers[EXPERIENCE_QUESTION_ID] !== undefined;
  const ctaLabel = READINESS_CTA[result.readiness.band];

  function persist(nextForm: FormState, nextAnswers: Answers, options?: { skipped?: boolean; completed?: boolean }) {
    updateLocalProgress((draft) => {
      draft.profile.school = nextForm.school.trim();
      draft.profile.major = nextForm.major.trim();
      draft.profile.enrollment_year = nextForm.enrollmentYear;
      draft.profile.current_term = nextForm.currentTerm;
      draft.profile.answers = nextAnswers;
      draft.profile.assessment_version = ASSESSMENT.version;
      if (options?.skipped !== undefined) draft.profile.skipped = options.skipped;
      if (options?.completed) draft.profile.completed_at = new Date().toISOString();
      return draft;
    });
    writeExplorePrefs({
      weekly_hours: parseOptionalInt(nextForm.weeklyHours, 1, 80),
      monthly_budget_cny: parseOptionalInt(nextForm.monthlyBudget, 0, 10000),
      pathway: nextForm.pathway
    });
    setSavedAt(new Date().toISOString());
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSavedAt(null), 2500);
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    const nextForm = { ...form, [key]: value };
    if (key === "enrollmentYear") {
      const options = buildTermOptions(value as number | null);
      if (!options.some((option) => option.value === nextForm.currentTerm)) {
        const fallback = currentTermValue();
        nextForm.currentTerm = options.some((option) => option.value === fallback)
          ? fallback
          : (options[0]?.value ?? "");
      }
    }
    setForm(nextForm);
    setErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
    persist(nextForm, answers);
  }

  function updatePathway(patch: Partial<PathwayPreference>) {
    const nextForm = {
      ...form,
      pathway: {
        ...form.pathway,
        ...patch
      }
    };
    setForm(nextForm);
    persist(nextForm, answers);
  }

  function toggleAlternative(pathway: PathwayPreference["primary"]) {
    if (pathway === form.pathway.primary || pathway === "undetermined") return;
    const alternatives = form.pathway.alternatives.includes(pathway)
      ? form.pathway.alternatives.filter((item) => item !== pathway)
      : [...form.pathway.alternatives, pathway].slice(0, 3);
    updatePathway({ alternatives });
  }

  function toggleExcludedSector(value: PathwayPreference["excluded_sectors"][number]) {
    const excluded_sectors = form.pathway.excluded_sectors.includes(value)
      ? form.pathway.excluded_sectors.filter((item) => item !== value)
      : [...form.pathway.excluded_sectors, value];
    updatePathway({ excluded_sectors });
  }

  function handleAnswer(questionId: string, value: AnswerValue | null) {
    const nextAnswers: Answers = { ...answers };
    if (value === null || isEmptyAnswer(value)) {
      delete nextAnswers[questionId];
    } else {
      nextAnswers[questionId] = value;
    }
    setAnswers(nextAnswers);
    persist(form, nextAnswers);
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (form.school.trim().length < 2) next.school = "请填写学校名称（至少 2 个字）";
    if (form.major.trim().length < 2) next.major = "请填写专业名称（至少 2 个字）";
    if (!form.enrollmentYear) next.enrollmentYear = "请选择入学年份";
    if (!form.currentTerm) next.currentTerm = "请选择当前学期";
    const hours = form.weeklyHours.trim();
    if (hours !== "" && parseOptionalInt(hours, 1, 80) === null) next.weeklyHours = "每周时间请填 1–80 之间的整数";
    const budget = form.monthlyBudget.trim();
    if (budget !== "" && parseOptionalInt(budget, 0, 10000) === null) next.monthlyBudget = "预算请填 0–10000 之间的整数";
    return next;
  }

  function handleComplete() {
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const firstKey = Object.keys(nextErrors)[0];
      document.getElementById(`explore-${firstKey}`)?.focus();
      return;
    }
    persist(form, answers, { completed: true, skipped: false });
    setSkippedBefore(false);
    router.push("/directions");
  }

  function handleSkipStep() {
    persist(form, answers, { completed: true, skipped: true });
    setSkippedBefore(false);
    setSkipDialogOpen(false);
    router.push("/directions");
  }

  return (
    <div className="step-page">
      <StepHeader
        index={1}
        title="先把你自己的牌面摊开"
        description={
          <>
            16 项 / 约 4 分钟 / 六类信号：活动兴趣、工作价值、能力自评、工作方式、探索准备度与可选经历。题目是产品自编的短版筛查，只生成
            <strong>描述性画像</strong>；未作答的维度保持「未知」，不按 0 分处理，也不给你贴人格标签。
          </>
        }
        actions={
          <>
            <Button variant="ghost" size="md" onClick={() => setSkipDialogOpen(true)}>
              跳过这一步
            </Button>
            <Button variant="primary" size="md" onClick={handleComplete}>
              {ctaLabel}
              <Icon name="arrow-right" size={15} />
            </Button>
          </>
        }
        meta={
          <span className="autosave-note">
            <Icon name="clock" size={13} />
            {savedAt
              ? `已自动保存到本设备 · ${new Date(savedAt).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Asia/Shanghai"
                })}`
              : "作答与资料会自动保存到本设备"}
          </span>
        }
      />

      {versionResetNotice ? (
        <Callout tone="warn" title="题库已更新，请重新作答" icon="refresh">
          <p>
            旧版问卷的作答与新题库不兼容，已清除旧答案；学校、专业等基础资料与时间/预算偏好保留。请按新题目重新作答，未作答的维度会保持「未知」。
          </p>
        </Callout>
      ) : null}

      {skippedBefore ? (
        <Callout tone="warn" title="你之前跳过了这一步">
          <p>
            现在可以随时补答。跳过状态下的画像保持空白：系统不会用默认值或虚构倾向补足。补答完成后记得点「完成探索」。
          </p>
        </Callout>
      ) : null}

      <div className="explore-grid">
        <section className="panel explore-profile-panel" aria-labelledby="explore-profile-title">
          <div className="panel-head">
            <div>
              <p className="eyebrow">基础资料</p>
              <h2 id="explore-profile-title">先确认你现在的坐标</h2>
            </div>
            <Badge tone="muted">必填 4 项</Badge>
          </div>
          <div className="form-grid">
            <Field label="学校" htmlFor="explore-school" required error={errors.school} hint="例如：上海对外经贸大学">
              <input
                id="explore-school"
                className={errors.school ? "input input-error" : "input"}
                type="text"
                value={form.school}
                maxLength={80}
                placeholder="填写学校名称"
                onChange={(event) => updateField("school", event.target.value)}
                aria-invalid={Boolean(errors.school)}
              />
            </Field>
            <Field label="专业" htmlFor="explore-major" required error={errors.major} hint="例如：国际经济与贸易（全英）">
              <input
                id="explore-major"
                className={errors.major ? "input input-error" : "input"}
                type="text"
                value={form.major}
                maxLength={120}
                placeholder="填写专业名称"
                onChange={(event) => updateField("major", event.target.value)}
                aria-invalid={Boolean(errors.major)}
              />
            </Field>
            <Field label="入学年份" htmlFor="explore-enrollmentYear" required error={errors.enrollmentYear}>
              <select
                id="explore-enrollmentYear"
                className={errors.enrollmentYear ? "select input-error" : "select"}
                value={form.enrollmentYear ?? ""}
                onChange={(event) => updateField("enrollmentYear", event.target.value ? Number(event.target.value) : null)}
                aria-invalid={Boolean(errors.enrollmentYear)}
              >
                <option value="">请选择</option>
                {YEAR_OPTIONS.map((year) => (
                  <option value={year} key={year}>
                    {year} 年
                  </option>
                ))}
              </select>
            </Field>
            <Field label="当前学期" htmlFor="explore-currentTerm" required error={errors.currentTerm} hint="用于判断行动落在当前学期还是下学期">
              <select
                id="explore-currentTerm"
                className={errors.currentTerm ? "select input-error" : "select"}
                value={form.currentTerm}
                onChange={(event) => updateField("currentTerm", event.target.value)}
                aria-invalid={Boolean(errors.currentTerm)}
              >
                <option value="">请选择</option>
                {termOptions.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="pathway-editor">
              <div className="pathway-editor-head">
                <div>
                  <p className="eyebrow">路线偏好与硬约束</p>
                  <h3>先选现实路线，再看职业方向</h3>
                  <p className="field-hint">
                    这些条件会先于兴趣和能力信号生效。例如排除“体制内 / 政审类岗位”后，系统不会再把公共部门作为候选方向。
                  </p>
                </div>
                <Badge tone="accent">会约束后续推荐</Badge>
              </div>

              <div className="pathway-control-grid">
                <Field label="主路线" htmlFor="explore-pathway-primary" hint="可以选择“仍不确定”，系统会先给比较顺序">
                  <select
                    id="explore-pathway-primary"
                    className="select"
                    value={form.pathway.primary}
                    onChange={(event) =>
                      updatePathway({
                        primary: event.target.value as PathwayPreference["primary"],
                        alternatives: form.pathway.alternatives.filter(
                          (item) => item !== event.target.value
                        )
                      })
                    }
                  >
                    {PATHWAY_OPTIONS.map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label} · {option.hint}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="偏实践还是偏研究" htmlFor="explore-practice-orientation">
                  <select
                    id="explore-practice-orientation"
                    className="select"
                    value={form.pathway.practice_orientation}
                    onChange={(event) =>
                      updatePathway({
                        practice_orientation: event.target.value as PathwayPreference["practice_orientation"]
                      })
                    }
                  >
                    <option value="undecided">尚未决定，想同时比较</option>
                    <option value="practice">更偏实践、实习和业务结果</option>
                    <option value="research">更偏研究、阅读和继续学习</option>
                  </select>
                </Field>

                <Field label="希望工作的城市" htmlFor="explore-target-cities" hint="多个城市用逗号分隔；最多 5 个">
                  <input
                    id="explore-target-cities"
                    className="input"
                    type="text"
                    value={form.pathway.target_cities.join("，")}
                    placeholder="例如：上海，杭州"
                    onChange={(event) =>
                      updatePathway({
                        target_cities: event.target.value
                          .split(/[,，]/)
                          .map((item) => item.trim())
                          .filter(Boolean)
                          .slice(0, 5)
                      })
                    }
                  />
                </Field>
              </div>

              <div className="pathway-choice-block">
                <span className="direction-label">可接受备选路线</span>
                <div className="chip-row">
                  {PATHWAY_OPTIONS.filter(
                    (option) => option.value !== "undetermined" && option.value !== form.pathway.primary
                  ).map((option) => {
                    const active = form.pathway.alternatives.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={active ? "filter-chip is-active" : "filter-chip"}
                        aria-pressed={active}
                        onClick={() => toggleAlternative(option.value)}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pathway-choice-block">
                <span className="direction-label">明确排除</span>
                <div className="chip-row">
                  {EXCLUSION_OPTIONS.map((option) => {
                    const active = form.pathway.excluded_sectors.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={active ? "filter-chip is-active exclusion-chip" : "filter-chip"}
                        aria-pressed={active}
                        onClick={() => toggleExcludedSector(option.value)}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pathway-choice-block">
                <span className="direction-label">我愿意考虑</span>
                <div className="chip-row">
                  {[
                    ["accepts_cross_major", "跨专业能力"],
                    ["accepts_certificate", "证书"],
                    ["accepts_competition", "竞赛"],
                    ["accepts_long_internship", "长期实习"]
                  ].map(([key, label]) => {
                    const typedKey = key as
                      | "accepts_cross_major"
                      | "accepts_certificate"
                      | "accepts_competition"
                      | "accepts_long_internship";
                    const active = form.pathway[typedKey];
                    return (
                      <button
                        key={key}
                        type="button"
                        className={active ? "filter-chip is-active" : "filter-chip"}
                        aria-pressed={active}
                        onClick={() => updatePathway({ [typedKey]: !active })}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <Field
              label="每周可投入时间（可选）"
              htmlFor="explore-weeklyHours"
              error={errors.weeklyHours}
              hint="只用于方案里的时间估计参考，可随时修改"
            >
              <div className="input-suffix-wrap">
                <input
                  id="explore-weeklyHours"
                  className={errors.weeklyHours ? "input input-error" : "input"}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={80}
                  value={form.weeklyHours}
                  placeholder="例如 6"
                  onChange={(event) => updateField("weeklyHours", event.target.value)}
                  aria-invalid={Boolean(errors.weeklyHours)}
                />
                <span className="input-suffix">小时</span>
              </div>
            </Field>
            <Field
              label="每月预算（可选）"
              htmlFor="explore-monthlyBudget"
              error={errors.monthlyBudget}
              hint="例如证书、培训、语言考试等自费预算；按人民币填"
            >
              <div className="input-suffix-wrap">
                <input
                  id="explore-monthlyBudget"
                  className={errors.monthlyBudget ? "input input-error" : "input"}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={10000}
                  value={form.monthlyBudget}
                  placeholder="例如 300"
                  onChange={(event) => updateField("monthlyBudget", event.target.value)}
                  aria-invalid={Boolean(errors.monthlyBudget)}
                />
                <span className="input-suffix">元 / 月</span>
              </div>
            </Field>
          </div>
          <p className="panel-note">
            <Icon name="shield" size={13} />
            不需要上传成绩单、学号或任何身份信息；这些内容只保存在当前浏览器。
          </p>
        </section>

        <ExploreResultPanel result={result} progress={progress} experienceAnswered={experienceAnswered} />
      </div>

      <ExploreQuestionnaire answers={answers} onAnswer={handleAnswer} />

      <div className="step-footer-bar">
        <div className="step-footer-note">
          <Icon name="info" size={14} />
          <span>
            {complete
              ? "16 项必答已完成，可以进入下一步。"
              : `还有 ${remaining} 项必答未作答：画像会保留「未知」，不按 0 分处理；也可以先跳过整步，稍后补答。`}
          </span>
        </div>
        <div className="step-footer-actions">
          <Button variant="ghost" size="md" onClick={() => setSkipDialogOpen(true)}>
            跳过这一步
          </Button>
          <Button variant="primary" size="md" onClick={handleComplete}>
            {ctaLabel}
            <Icon name="arrow-right" size={15} />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={skipDialogOpen}
        title="跳过自我探索？"
        description="整步跳过不会生成画像，也不会用虚构数据补足。你仍然可以浏览方向、收藏与暂定；但如果之后要生成云端方案，需要先补齐画像。"
        confirmLabel="跳过这一步"
        cancelLabel="继续作答"
        tone="primary"
        onConfirm={handleSkipStep}
        onCancel={() => setSkipDialogOpen(false)}
      >
        <div className="reset-scope">
          <p className="reset-scope-heading">跳过会保存</p>
          <ul className="reset-scope-list reset-scope-list-keep">
            <li>
              <Icon name="check" size={13} />
              <span>当前已填的学校、专业等基础资料（不会填写的内容不会编造）</span>
            </li>
            <li>
              <Icon name="check" size={13} />
              <span>已作答的题目会保留，未作答维度保持未知</span>
            </li>
          </ul>
          <p className="reset-scope-heading">之后可以</p>
          <ul className="reset-scope-list">
            <li>
              <Icon name="refresh" size={13} />
              <span>回到本页补答：再次点「完成探索」会取消跳过标记</span>
            </li>
          </ul>
        </div>
      </ConfirmDialog>

      <p className="step-back-strip">
        <Link href="/library" className="link-inline">
          先去资料库查一查？
          <Icon name="chevron-right" size={13} />
        </Link>
      </p>
    </div>
  );
}
