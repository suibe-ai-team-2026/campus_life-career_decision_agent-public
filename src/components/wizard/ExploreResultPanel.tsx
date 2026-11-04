"use client";

import type { AssessmentResult, EvidenceStatus } from "@/lib/assessment/scoring";
import { Badge, Collapse, RunStatus, type BadgeTone } from "@/components/ui/primitives";

/**
 * 右栏画像结果面板。
 *
 * 只展示 `scoreAssessment` 已经算好的描述性结果：兴趣 1–5 分、能力自评与
 * 证据标签、工作价值排序、探索准备度。方法学与边界说明不在界面重复。
 */

type ExploreResultPanelProps = {
  result: AssessmentResult;
  progress: { answered: number; total: number };
  experienceAnswered: boolean;
};

const EVIDENCE_META: Record<EvidenceStatus, { label: string; tone: BadgeTone }> = {
  supported: { label: "有经历支持", tone: "ok" },
  self_only: { label: "仅有自评", tone: "muted" },
  unknown: { label: "未知", tone: "muted" }
};

const WORK_STYLE_TITLES: Record<string, string> = {
  work_style_approach: "接到新任务时",
  work_style_team: "做小组任务时"
};

/** 0..1 的归一化分数还原成题目原本的 1–5 分展示。 */
function toLikert(score: number): number {
  return Math.round(score * 4) + 1;
}

export function ExploreResultPanel({ result, progress, experienceAnswered }: ExploreResultPanelProps) {
  const answeredInterest = result.interest.filter((item) => item.answered).length;
  const answeredAbility = result.ability.filter((item) => item.answered).length;
  const isComplete = progress.answered >= progress.total;

  const interestTopText =
    result.interestTop.length === 0
      ? null
      : `较愿意投入：${result.interestTop.map((item) => item.title).join("、")}`;

  return (
    <aside className="panel explore-result-panel" aria-labelledby="explore-result-title">
      <div className="panel-head">
        <h2 id="explore-result-title">你的描述性画像</h2>
        <Badge tone={isComplete ? "ok" : "muted"}>{isComplete ? "必答已完成" : "仍可继续"}</Badge>
      </div>

      <RunStatus
        state={isComplete ? "done" : "running"}
        label={`已作答 ${progress.answered} / ${progress.total}`}
        detail={experienceAnswered ? "含 1 项可选经历" : undefined}
      />

      {interestTopText ? <p className="panel-note">{interestTopText}</p> : null}

      <div className="result-block">
        <h3 className="panel-title">
          <span>活动兴趣</span>
          <Badge tone="muted">
            {answeredInterest} / {result.interest.length} 已答
          </Badge>
        </h3>
        <ul className="dimension-list">
          {result.interest.map((item) => (
            <li className="dimension-item" key={item.key}>
              <div className="dimension-head">
                <span className="dimension-title">{item.title}</span>
                <span className="dimension-count">
                  {item.score === null ? "未知" : `${toLikert(item.score)} / 5`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="result-block">
        <h3 className="panel-title">
          <span>能力自评</span>
          <Badge tone="muted">
            {answeredAbility} / {result.ability.length} 已答
          </Badge>
        </h3>
        <ul className="dimension-list">
          {result.ability.map((item) => {
            const evidence = EVIDENCE_META[item.evidence];
            return (
              <li className="dimension-item" key={item.key}>
                <div className="dimension-head">
                  <span className="row">
                    <span className="dimension-title">{item.title}</span>
                    <Badge tone={evidence.tone}>{evidence.label}</Badge>
                  </span>
                  <span className="dimension-count">
                    {item.score === null ? "未知" : `${toLikert(item.score)} / 5`}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="result-block">
        <div className="dimension-head">
          <span className="dimension-title">探索准备度</span>
          <Badge
            tone={
              result.readiness.band === "targeted"
                ? "ok"
                : result.readiness.band === "comparing"
                  ? "accent"
                  : "muted"
            }
          >
            {result.readiness.label}
          </Badge>
        </div>
      </div>

      <Collapse summary="工作价值与工作方式">
        <div className="result-block">
          <h3 className="panel-title">
            <span>工作价值 · 优先次序</span>
          </h3>
          {result.values.length > 0 ? (
            <ol className="dimension-list value-rank-list">
              {result.values.map((value, index) => (
                <li className="dimension-head value-rank-item" key={value.key}>
                  <span className="value-rank-index" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="dimension-title">{value.label}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="panel-note">未作答</p>
          )}
        </div>

        <div className="result-block">
          <h3 className="panel-title">
            <span>工作方式 · 偏好原文</span>
          </h3>
          {result.workStyles.length > 0 ? (
            <ul className="dimension-list">
              {result.workStyles.map((item) => (
                <li className="dimension-item" key={item.questionId}>
                  <div className="dimension-head">
                    <span className="dimension-title">{WORK_STYLE_TITLES[item.dimension] ?? "工作方式"}</span>
                  </div>
                  <div className="chip-row">
                    <span className="chip chip-amber">{item.label}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="panel-note">未作答</p>
          )}
        </div>
      </Collapse>
    </aside>
  );
}
