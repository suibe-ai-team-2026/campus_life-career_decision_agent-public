"use client";

import { useState } from "react";
import type { AssessmentResult, EvidenceStatus } from "@/lib/assessment/scoring";
import { ASSESSMENT } from "@/lib/content";
import { Badge, Button, ProgressBar, type BadgeTone } from "@/components/ui/primitives";

/**
 * 右栏画像结果面板。
 *
 * 只展示 `scoreAssessment` 已经算好的描述性结果：
 * - 兴趣 6 类的 1–5 分与「探索线索」措辞（不称人格类型 / 适配度）；
 * - 工作价值的优先次序（不换算综合分）；
 * - 能力自评 6 项 + 经历证据状态（有经历支持 / 仅有自评 / 未知）；
 * - 工作方式偏好原文 chips、探索准备度 label + guidance；
 * - 边界说明与题库方法，且不复述任何逐题答案。
 *
 * 面板默认展开，可手动收起；展开状态只影响需要滚动阅读的明细区块。
 */

type ExploreResultPanelProps = {
  result: AssessmentResult;
  progress: { answered: number; total: number };
  experienceAnswered: boolean;
};

const EVIDENCE_META: Record<EvidenceStatus, { label: string; tone: BadgeTone; note: string }> = {
  supported: {
    label: "有经历支持",
    tone: "ok",
    note: "你在可选经历里勾选了这项能力；只表示提供了相关经历，未经第三方核验。"
  },
  self_only: {
    label: "仅有自评",
    tone: "muted",
    note: "目前只有自评分数；可以在课程或实践里补一段经历，再回来复核。"
  },
  unknown: {
    label: "未知",
    tone: "muted",
    note: "本题未作答，保持未知，不按 0 分处理。"
  }
};

const WORK_STYLE_TITLES: Record<string, string> = {
  work_style_approach: "接到新任务时",
  work_style_team: "做小组任务时"
};

/** 0..1 的归一化分数还原成题目原本的 1–5 分展示。 */
function toLikert(score: number): number {
  return Math.round(score * 4) + 1;
}

function barWidth(score: number | null): string {
  return `${score === null ? 0 : Math.round(score * 100)}%`;
}

export function ExploreResultPanel({ result, progress, experienceAnswered }: ExploreResultPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const answeredInterest = result.interest.filter((item) => item.answered).length;
  const answeredAbility = result.ability.filter((item) => item.answered).length;
  const isComplete = progress.answered >= progress.total;

  const interestTopText =
    result.interestTop.length === 0
      ? "尚未作答兴趣题：兴趣线索保持未知。"
      : `当前较愿意投入的活动：${result.interestTop.map((item) => item.title).join("、")}（探索线索，需要结合后续经历复核）。`;

  return (
    <aside className="panel explore-result-panel" aria-labelledby="explore-result-title">
      <div className="panel-head">
        <div>
          <p className="eyebrow">自我画像 · 探索线索</p>
          <h2 id="explore-result-title">你的描述性画像</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((value) => !value)}
          ariaLabel={expanded ? "收起画像明细" : "展开画像明细"}
        >
          {expanded ? "收起" : "展开"}
        </Button>
      </div>

      <ProgressBar
        value={progress.total > 0 ? (progress.answered / progress.total) * 100 : 0}
        label={`已作答 ${progress.answered} / ${progress.total}`}
      />
      <p className="dimension-desc">
        另有 1 项可选经历：{experienceAnswered ? "已填写（不计分，只标注经历支持）" : "未填写"}
      </p>
      <p className="panel-note">
        {isComplete
          ? "16 项必答已完成；结果仍只是探索线索，不是职业判决。"
          : "还没答完也可以继续：未作答的维度会保留「未知」，不会被按 0 分处理。"}
      </p>

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
              <div className="dimension-bar" aria-hidden="true">
                <span
                  className={item.score === null ? "dimension-fill is-unknown" : "dimension-fill"}
                  style={{ width: barWidth(item.score) }}
                />
              </div>
              <p className="dimension-desc">
                {item.score === null
                  ? "本题未作答，保持未知，不按 0 分处理。"
                  : `探索线索：${item.description}。`}
              </p>
            </li>
          ))}
        </ul>
        <p className="dimension-desc">{interestTopText}</p>
      </div>

      {expanded ? (
        <>
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
              <p className="dimension-desc">未作答，保持未知；不会用默认价值补齐。</p>
            )}
            {result.values.length > 0 && result.values.length < 3 ? (
              <p className="dimension-desc">已选 {result.values.length} / 3 项，可以继续补充排序。</p>
            ) : null}
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
                      <span className="dimension-title">{item.title}</span>
                      <span className="dimension-count">
                        {item.score === null ? "未知" : `${toLikert(item.score)} / 5`}
                      </span>
                    </div>
                    <div className="dimension-bar" aria-hidden="true">
                      <span
                        className={item.score === null ? "dimension-fill is-unknown" : "dimension-fill"}
                        style={{ width: barWidth(item.score) }}
                      />
                    </div>
                    <div className="chip-row evidence-line">
                      <Badge tone={evidence.tone}>{evidence.label}</Badge>
                      <span className="dimension-desc">{evidence.note}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
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
                      <span className="dimension-title">
                        {WORK_STYLE_TITLES[item.dimension] ?? "工作方式"}
                      </span>
                    </div>
                    <div className="chip-row">
                      <span className="chip chip-amber">{item.label}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dimension-desc">未作答，保持未知；不按高低计分，也不做性格定型。</p>
            )}
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
            <p className="dimension-desc">{result.readiness.guidance}</p>
            <p className="dimension-desc">准备度只影响下一步引导的颗粒度，不进入方向匹配排序。</p>
          </div>

          <div className="profile-detail">
            <h3 className="panel-title">这份画像的边界</h3>
            <ul className="boundary-list">
              <li>这是产品自编的短版筛查，没有经过信效度验证，不是标准化心理测验或能力测验。</li>
              <li>漏答保留为「未知」，不按 0 分处理，也不补成中间值。</li>
              <li>兴趣与能力是自评与偏好信号，不是人格类型、能力认证或职业适配度结论。</li>
              <li>结果页只呈现分数、排序与证据状态，不复述你的逐题答案。</li>
              <li>
                程序负责计分、排序与证据状态；AI 只负责组织解释，不改动分数，也不会把你自述的经历验证成客观能力。
              </li>
              <li>可选经历里填写的内容不会被当成第三方核验过的能力证明，也不会展示给其他学生。</li>
            </ul>
            <details className="details-block">
              <summary>题库版本与方法说明</summary>
              <p>{ASSESSMENT.disclaimer}</p>
              <ul>
                {ASSESSMENT.methodology_sources.map((source) => (
                  <li key={source}>{source}</li>
                ))}
              </ul>
              <p>
                题库版本：{ASSESSMENT.version}；必答未作答：{Math.max(0, progress.total - progress.answered)} 项。
              </p>
            </details>
          </div>
        </>
      ) : null}
    </aside>
  );
}
