"use client";

import type { AssessmentQuestion, AssessmentSection } from "@/lib/contracts/catalog";
import type { Answers, AnswerValue } from "@/lib/contracts/profile";
import { ABILITY_DIMENSIONS, ABILITY_SIGNALS, ABILITY_TITLES } from "@/lib/assessment/scoring";
import { ASSESSMENT, ASSESSMENT_SECTION_ESTIMATES, ASSESSMENT_SECTION_ORDER } from "@/lib/content";
import { Badge } from "@/components/ui/primitives";

/**
 * 16 项职业探索自我画像的作答区。
 *
 * 只负责渲染题目与收集作答，计分、持久化与结果解释都在上层：
 * - likert：1–5 单选（复用 `.option-row` / `.option` 样式）；
 * - rank：按点击顺序记录 string[]，再次点击取消，最多 `max_selections` 项；
 * - single：单选，`option.value` 可能是 number（准备度）或 string（工作方式）；
 * - text：可选经历补充，`{ text, tags }`，标签来自 `question.evidence_tags`。
 *
 * 未作答不写入任何占位值：清空即删除该题答案，让计分保持「未知」。
 */

export type AnswerChangeHandler = (questionId: string, value: AnswerValue | null) => void;

type QuestionProps = {
  question: AssessmentQuestion;
  index: number | null;
  answers: Answers;
  onAnswer: AnswerChangeHandler;
};

const SECTION_QUESTIONS: Map<AssessmentSection, AssessmentQuestion[]> = new Map(
  ASSESSMENT_SECTION_ORDER.map((section) => [
    section,
    ASSESSMENT.questions.filter((question) => question.section === section)
  ])
);

/** 必答题的全局序号（可选经历不占序号）。 */
const REQUIRED_QUESTION_INDEX = (() => {
  const index = new Map<string, number>();
  let counter = 0;
  for (const section of ASSESSMENT_SECTION_ORDER) {
    for (const question of SECTION_QUESTIONS.get(section) ?? []) {
      if (question.optional) continue;
      counter += 1;
      index.set(question.question_id, counter);
    }
  }
  return index;
})();

const EVIDENCE_TAG_LABELS: Record<string, string> = ABILITY_SIGNALS.reduce<Record<string, string>>(
  (labels, key) => {
    labels[ABILITY_DIMENSIONS[key]] = ABILITY_TITLES[key];
    return labels;
  },
  {}
);

function asNumber(value: AnswerValue | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function asSingleValue(value: AnswerValue | undefined): string | number | null {
  if (typeof value === "string" || typeof value === "number") return value;
  return null;
}

function asStringArray(value: AnswerValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asExperience(value: AnswerValue | undefined): { text: string; tags: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { text: "", tags: [] };
  }
  return {
    text: typeof value.text === "string" ? value.text : "",
    tags: Array.isArray(value.tags)
      ? value.tags.filter((tag): tag is string => typeof tag === "string")
      : []
  };
}

function QuestionHead({
  question,
  index,
  hasAnswer,
  onClear
}: {
  question: AssessmentQuestion;
  index: number | null;
  hasAnswer: boolean;
  onClear: () => void;
}) {
  return (
    <div className="question-head">
      {index === null ? null : (
        <span className="question-index" aria-hidden="true">
          {index}
        </span>
      )}
      <p className="question-prompt">{question.prompt}</p>
      {question.optional ? <Badge tone="muted">可选</Badge> : null}
      {hasAnswer ? (
        <button type="button" className="link-button" onClick={onClear}>
          清除作答
        </button>
      ) : null}
    </div>
  );
}

function LikertQuestion({ question, index, answers, onAnswer }: QuestionProps) {
  const selected = asNumber(answers[question.question_id]);
  return (
    <div className={selected === null ? "question" : "question is-answered"}>
      <QuestionHead
        question={question}
        index={index}
        hasAnswer={selected !== null}
        onClear={() => onAnswer(question.question_id, null)}
      />
      <div className="option-row" role="radiogroup" aria-label={question.prompt}>
        {question.options.map((option) => {
          const value = typeof option.value === "number" ? option.value : Number(option.value);
          const isSelected = selected !== null && selected === value;
          return (
            <label className={isSelected ? "option is-selected" : "option"} key={String(option.value)}>
              <input
                type="radio"
                name={question.question_id}
                value={value}
                checked={isSelected}
                onChange={() => onAnswer(question.question_id, value)}
              />
              <span className="option-value" aria-hidden="true">
                {value}
              </span>
              <span className="option-label">{option.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function SingleQuestion({ question, index, answers, onAnswer }: QuestionProps) {
  const selected = asSingleValue(answers[question.question_id]);
  return (
    <div className={selected === null ? "question" : "question is-answered"}>
      <QuestionHead
        question={question}
        index={index}
        hasAnswer={selected !== null}
        onClear={() => onAnswer(question.question_id, null)}
      />
      {question.hint ? <p className="field-hint">{question.hint}</p> : null}
      <div className="option-row option-row-single" role="radiogroup" aria-label={question.prompt}>
        {question.options.map((option) => {
          const isSelected = selected !== null && String(selected) === String(option.value);
          return (
            <label className={isSelected ? "option is-selected" : "option"} key={String(option.value)}>
              <input
                type="radio"
                name={question.question_id}
                value={String(option.value)}
                checked={isSelected}
                onChange={() => onAnswer(question.question_id, option.value)}
              />
              {typeof option.value === "number" ? (
                <span className="option-value" aria-hidden="true">
                  {option.value}
                </span>
              ) : null}
              <span className="option-label">{option.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function RankQuestion({ question, index, answers, onAnswer }: QuestionProps) {
  const selected = asStringArray(answers[question.question_id]);
  const maxSelections = question.max_selections ?? 3;
  const limitReached = selected.length >= maxSelections;

  function toggle(value: string) {
    const current = asStringArray(answers[question.question_id]);
    if (current.includes(value)) {
      const next = current.filter((item) => item !== value);
      onAnswer(question.question_id, next.length > 0 ? next : null);
      return;
    }
    if (current.length >= maxSelections) return;
    onAnswer(question.question_id, [...current, value]);
  }

  return (
    <div className={selected.length === 0 ? "question" : "question is-answered"}>
      <QuestionHead
        question={question}
        index={index}
        hasAnswer={selected.length > 0}
        onClear={() => onAnswer(question.question_id, null)}
      />
      <p className="field-hint">
        {question.hint ?? "选择顺序即重要程度；再次点击可取消。"} 已选 {selected.length} / {maxSelections}
        {limitReached ? "，已选满；再次点击已选项可取消。" : "。"}
      </p>
      <div className="dimension-list rank-list" role="group" aria-label={question.prompt}>
        {question.options.map((option) => {
          const value = String(option.value);
          const position = selected.indexOf(value);
          const isSelected = position >= 0;
          return (
            <button
              key={value}
              type="button"
              className={isSelected ? "option rank-option is-selected" : "option rank-option"}
              aria-pressed={isSelected}
              aria-label={isSelected ? `${option.label}（第 ${position + 1} 位，再次点击取消）` : option.label}
              disabled={!isSelected && limitReached}
              onClick={() => toggle(value)}
            >
              <span className="option-value rank-option-index" aria-hidden="true">
                {isSelected ? position + 1 : "+"}
              </span>
              <span className="option-label">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TextQuestion({ question, index, answers, onAnswer }: QuestionProps) {
  const experience = asExperience(answers[question.question_id]);
  const hasAnswer = experience.text.trim().length > 0 || experience.tags.length > 0;
  const textareaId = `explore-${question.question_id}`;
  const tagOptions = question.evidence_tags ?? [];

  function emit(nextText: string, nextTags: string[]) {
    const text = nextText.slice(0, 300);
    if (text.trim().length === 0 && nextTags.length === 0) {
      onAnswer(question.question_id, null);
      return;
    }
    onAnswer(question.question_id, { text, tags: nextTags.slice(0, 6) });
  }

  function toggleTag(tag: string) {
    const nextTags = experience.tags.includes(tag)
      ? experience.tags.filter((item) => item !== tag)
      : [...experience.tags, tag];
    emit(experience.text, nextTags);
  }

  return (
    <div className={hasAnswer ? "question is-answered" : "question"}>
      <QuestionHead
        question={question}
        index={index}
        hasAnswer={hasAnswer}
        onClear={() => onAnswer(question.question_id, null)}
      />
      <div className="text-answer">
        <textarea
          id={textareaId}
          className="textarea"
          rows={4}
          maxLength={300}
          value={experience.text}
          placeholder="例如：在课程小组作业中负责资料搜集与汇报，最后和队友一起完成了展示。"
          aria-label={question.prompt}
          onChange={(event) => emit(event.target.value, experience.tags)}
        />
        <div className="chip-row text-answer-meta">
          <span className="question-count">{experience.text.length} / 300 字</span>
          <span className="question-count">不填写也可以跳过</span>
        </div>
      </div>
      {tagOptions.length > 0 ? (
        <div className="tag-picker" role="group" aria-label="这段经历支持哪些能力">
          <p className="field-hint">能力标签（可多选）</p>
          <div className="chip-row">
            {tagOptions.map((tag) => {
              const active = experience.tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className={active ? "filter-chip is-active" : "filter-chip"}
                  aria-pressed={active}
                  onClick={() => toggleTag(tag)}
                >
                  {EVIDENCE_TAG_LABELS[tag] ?? tag}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {question.hint ? <p className="field-hint">{question.hint}</p> : null}
    </div>
  );
}

export function ExploreQuestionnaire({ answers, onAnswer }: { answers: Answers; onAnswer: AnswerChangeHandler }) {
  return (
    <section className="question-section" aria-labelledby="questions-title">
      <div className="section-heading">
        <div className="section-heading-text">
          <p className="eyebrow">职业探索自我画像 · 自编短版</p>
          <h2 id="questions-title">16 项必答，另有 1 项可选经历</h2>
          <p className="section-description">
            请按「目前的真实情况」作答，不需要猜测系统期待的答案。1–5 分表示程度递增；不确定的题目可以跳过，漏答会保留为「未知」，不按
            0 分处理，也不补成中间值。
          </p>
        </div>
      </div>

      {ASSESSMENT_SECTION_ORDER.map((section) => {
        const dimension = ASSESSMENT.dimensions[section];
        const questions = SECTION_QUESTIONS.get(section) ?? [];
        if (!dimension || questions.length === 0) return null;
        const required = questions.filter((question) => !question.optional);
        const answered = required.filter((question) => answers[question.question_id] !== undefined).length;
        return (
          <fieldset className="question-group" key={section}>
            <legend>
              <span className="question-group-title">{dimension.title}</span>
              <span className="question-group-desc">{dimension.description}</span>
              <span className="question-count">
                已答 {answered} / {required.length}
              </span>
              <Badge tone="muted">{ASSESSMENT_SECTION_ESTIMATES[section]}</Badge>
            </legend>
            {questions.map((question) => {
              const index = REQUIRED_QUESTION_INDEX.get(question.question_id) ?? null;
              if (question.kind === "rank") {
                return (
                  <RankQuestion
                    key={question.question_id}
                    question={question}
                    index={index}
                    answers={answers}
                    onAnswer={onAnswer}
                  />
                );
              }
              if (question.kind === "single") {
                return (
                  <SingleQuestion
                    key={question.question_id}
                    question={question}
                    index={index}
                    answers={answers}
                    onAnswer={onAnswer}
                  />
                );
              }
              if (question.kind === "text") {
                return (
                  <TextQuestion
                    key={question.question_id}
                    question={question}
                    index={index}
                    answers={answers}
                    onAnswer={onAnswer}
                  />
                );
              }
              return (
                <LikertQuestion
                  key={question.question_id}
                  question={question}
                  index={index}
                  answers={answers}
                  onAnswer={onAnswer}
                />
              );
            })}
          </fieldset>
        );
      })}
    </section>
  );
}
