"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { isAssessmentComplete, scoreAssessment } from "@/lib/assessment/scoring";
import type { Answers } from "@/lib/contracts/profile";
import {
  ASSESSMENT,
  DIMENSION_ORDER,
  buildTermOptions,
  currentTermValue,
  defaultEnrollmentYear
} from "@/lib/content";
import {
  readExplorePrefs,
  readLocalProgress,
  updateLocalProgress,
  useLocalProgress,
  writeExplorePrefs
} from "@/lib/local-progress/store";
import { Badge, Button, Callout, Field, Icon, ProgressBar } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StepHeader } from "./StepHeader";

const YEAR_OPTIONS = (() => {
  const current = new Date().getFullYear();
  const years: number[] = [];
  for (let year = current; year >= 2014; year -= 1) years.push(year);
  return years;
})();

type FormState = {
  school: string;
  major: string;
  enrollmentYear: number | null;
  currentTerm: string;
  weeklyHours: string;
  monthlyBudget: string;
};

const EMPTY_FORM: FormState = {
  school: "",
  major: "",
  enrollmentYear: null,
  currentTerm: "",
  weeklyHours: "",
  monthlyBudget: ""
};

function parseOptionalInt(value: string, min: number, max: number): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
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
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
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
      monthlyBudget: prefs.monthly_budget_cny !== null ? String(prefs.monthly_budget_cny) : ""
    });
    setAnswers(stored?.profile.answers ?? {});
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
  const answeredCount = result.answered;
  const totalQuestions = result.total;
  const complete = isAssessmentComplete(answers, ASSESSMENT);
  const missingDimensions = result.dimensions.filter((dimension) => dimension.answered === 0).length;

  function persist(nextForm: FormState, nextAnswers: Answers, options?: { skipped?: boolean; completed?: boolean }) {
    updateLocalProgress((draft) => {
      draft.profile.school = nextForm.school.trim();
      draft.profile.major = nextForm.major.trim();
      draft.profile.enrollment_year = nextForm.enrollmentYear;
      draft.profile.current_term = nextForm.currentTerm;
      draft.profile.answers = nextAnswers;
      if (options?.skipped !== undefined) draft.profile.skipped = options.skipped;
      if (options?.completed) draft.profile.completed_at = new Date().toISOString();
      return draft;
    });
    writeExplorePrefs({
      weekly_hours: parseOptionalInt(nextForm.weeklyHours, 1, 80),
      monthly_budget_cny: parseOptionalInt(nextForm.monthlyBudget, 0, 10000)
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

  function setAnswer(questionId: string, value: number) {
    const nextAnswers: Answers = { ...answers, [questionId]: value };
    setAnswers(nextAnswers);
    persist(form, nextAnswers);
  }

  function clearAnswer(questionId: string) {
    const nextAnswers: Answers = { ...answers };
    delete nextAnswers[questionId];
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
            轻测只有 10 道，分兴趣、能力自评、决策偏好三组，每题都可跳过。它不会给你贴职业标签，只生成一份
            <strong>描述性画像</strong>；未作答的维度保持未知，不按 0 分处理。
          </>
        }
        actions={
          <>
            <Button variant="ghost" size="md" onClick={() => setSkipDialogOpen(true)}>
              跳过这一步
            </Button>
            <Button variant="primary" size="md" onClick={handleComplete}>
              完成探索，进入方向认知
              <Icon name="arrow-right" size={15} />
            </Button>
          </>
        }
        meta={
          <span className="autosave-note">
            <Icon name="clock" size={13} />
            {savedAt ? `已自动保存到本设备 · ${new Date(savedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" })}` : "作答与资料会自动保存到本设备"}
          </span>
        }
      />

      {skippedBefore ? (
        <Callout tone="warn" title="你之前跳过了轻测">
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

        <aside className="panel explore-result-panel" aria-labelledby="explore-result-title">
          <div className="panel-head">
            <div>
              <p className="eyebrow">轻测画像</p>
              <h2 id="explore-result-title">你的描述性画像</h2>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowProfile((value) => !value)} ariaLabel={showProfile ? "收起画像" : "展开画像"}>
              {showProfile ? "收起" : "展开"}
            </Button>
          </div>
          <ProgressBar value={(answeredCount / totalQuestions) * 100} label={`已作答 ${answeredCount} / ${totalQuestions}`} />
          <ul className="dimension-list">
            {result.dimensions.map((dimension) => (
              <li key={dimension.dimension} className="dimension-item">
                <div className="dimension-head">
                  <span className="dimension-title">{dimension.title}</span>
                  <span className="dimension-count">
                    {dimension.answered} / {dimension.total} 题
                  </span>
                </div>
                <div className="dimension-bar" aria-hidden="true">
                  <span
                    className={dimension.score === null ? "dimension-fill is-unknown" : "dimension-fill"}
                    style={{ width: `${dimension.score === null ? 0 : Math.round(dimension.score * 100)}%` }}
                  />
                </div>
                <p className="dimension-desc">
                  {dimension.score === null ? "本维度未作答，保持未知" : dimension.descriptive}
                </p>
              </li>
            ))}
          </ul>
          {showProfile ? (
            <div className="profile-detail">
              <p>
                画像来自 <strong>{ASSESSMENT.version}</strong> 版本自编轻测。它是自我描述，不是能力测评，也不是职业判决；未作答的题目不参与计分，也不会被补成中间值。
              </p>
              <p>完成全部必答题：{complete ? "是" : `否（还差 ${ASSESSMENT.questions.filter((q) => !q.optional && typeof answers[q.question_id] !== "number").length} 道必答题）`}</p>
              <details className="details-block">
                <summary>题目与方法说明</summary>
                <p>{ASSESSMENT.disclaimer}</p>
                <ul>
                  {ASSESSMENT.methodology_sources.map((source) => (
                    <li key={source}>{source}</li>
                  ))}
                </ul>
              </details>
            </div>
          ) : null}
          <div className="result-actions">
            <Button variant="secondary" size="sm" onClick={() => setShowProfile(true)}>
              查看完整画像说明
            </Button>
          </div>
        </aside>
      </div>

      <section className="question-section" aria-labelledby="questions-title">
        <div className="section-heading">
          <div className="section-heading-text">
            <p className="eyebrow">生涯轻探索 · 自编轻测</p>
            <h2 id="questions-title">10 道题，按三组维度记录你的自评</h2>
            <p className="section-description">
              每题 5 个选项，可以跳过任意一题，也可以整步跳过。节奏由你决定，约 3 分钟。
            </p>
          </div>
          <div className="section-heading-actions">
            <span className="question-count">
              已答 {answeredCount} / {totalQuestions}
              {missingDimensions > 0 ? ` · ${missingDimensions} 个维度未作答` : ""}
            </span>
          </div>
        </div>

        {DIMENSION_ORDER.map((dimensionId) => {
          const dimension = ASSESSMENT.dimensions[dimensionId];
          const questions = ASSESSMENT.questions.filter((question) => question.dimension === dimensionId);
          if (!dimension) return null;
          return (
            <fieldset className="question-group" key={dimensionId}>
              <legend>
                <span className="question-group-title">{dimension.title}</span>
                <span className="question-group-desc">{dimension.description}</span>
              </legend>
              {questions.map((question, questionIndex) => {
                const selected = answers[question.question_id];
                const isAnswered = typeof selected === "number";
                return (
                  <div className={isAnswered ? "question is-answered" : "question"} key={question.question_id}>
                    <div className="question-head">
                      <span className="question-index" aria-hidden="true">
                        {questionIndex + 1}
                      </span>
                      <p className="question-prompt">{question.prompt}</p>
                      {question.optional ? <Badge tone="muted">可选</Badge> : null}
                      {isAnswered ? (
                        <button type="button" className="link-button" onClick={() => clearAnswer(question.question_id)}>
                          跳过此题
                        </button>
                      ) : null}
                    </div>
                    <div className="option-row" role="radiogroup" aria-label={question.prompt}>
                      {question.options.map((option) => {
                        const isSelected = selected === option.value;
                        return (
                          <label className={isSelected ? "option is-selected" : "option"} key={option.value}>
                            <input
                              type="radio"
                              name={question.question_id}
                              value={option.value}
                              checked={isSelected}
                              onChange={() => setAnswer(question.question_id, option.value)}
                            />
                            <span className="option-value" aria-hidden="true">
                              {option.value}
                            </span>
                            <span className="option-label">{option.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </fieldset>
          );
        })}
      </section>

      <div className="step-footer-bar">
        <div className="step-footer-note">
          <Icon name="info" size={14} />
          <span>
            {complete
              ? "必答题已全部完成，可以进入下一步。"
              : "还有题目未作答：画像会保留未知；也可以先跳过整步，稍后补答。"}
          </span>
        </div>
        <div className="step-footer-actions">
          <Button variant="ghost" size="md" onClick={() => setSkipDialogOpen(true)}>
            跳过这一步
          </Button>
          <Button variant="primary" size="md" onClick={handleComplete}>
            完成探索，进入方向认知
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
