"use client";

import { useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Plan, PlanAction, PlanLead, PlanResult } from "@/lib/contracts/plan";
import type { Citation } from "@/lib/contracts/run";
import type { DirectionId } from "@/lib/contracts/common";
import { PLAN_WINDOW_LABELS, PLAN_WINDOW_ORDER, getDirection } from "@/lib/content";
import { Badge, Button, Callout, Collapse, EmptyState, Icon, formatDateTime, formatDate } from "@/components/ui/primitives";
import { CitationFileList, CitationText } from "@/components/ui/CitationCard";
import {
  buildRuleFallbackAnalysis,
  formatPlanWarning,
  formatPlanWarnings,
  formatRoadmapFocus
} from "@/lib/plan-display";
import { SourceUploadPanel } from "@/components/tools/SourceUploadPanel";
import { ActionCard, type ActionOverrides } from "./PlanActionCard";

type PlanTab = "direction" | "campus" | "semester" | "roadmap" | "sources";

const PLAN_TABS: Array<{ id: PlanTab; label: string }> = [
  { id: "direction", label: "方向与行业" },
  { id: "campus", label: "上经贸现实" },
  { id: "semester", label: "本学期执行" },
  { id: "roadmap", label: "四年路线" },
  { id: "sources", label: "依据" }
];

export function pickCurrentVersion(plan: Plan | null) {
  if (!plan) return null;
  const current = plan.current_version_id
    ? plan.versions.find((version) => version.version_id === plan.current_version_id)
    : undefined;
  if (current) return current;
  return [...plan.versions].sort((a, b) => b.version - a.version)[0] ?? null;
}

export function orderPlanActions(actions: PlanAction[], localOrder: string[]): PlanAction[] {
  const byId = new Map(actions.map((action) => [action.action_id, action]));
  const ordered: PlanAction[] = [];
  for (const id of localOrder) {
    const action = byId.get(id);
    if (action) {
      ordered.push(action);
      byId.delete(id);
    }
  }
  const rest = [...byId.values()].sort((a, b) => {
    const windowDelta = PLAN_WINDOW_ORDER.indexOf(a.window) - PLAN_WINDOW_ORDER.indexOf(b.window);
    if (windowDelta !== 0) return windowDelta;
    return a.title.localeCompare(b.title, "zh-CN");
  });
  return [...ordered, ...rest];
}

function coerceOverrides(value: Record<string, unknown> | undefined): ActionOverrides {
  if (!value) return {};
  const overrides: ActionOverrides = {};
  if (typeof value.title === "string") overrides.title = value.title;
  if (value.window === "current_term" || value.window === "next_term" || value.window === "later") {
    overrides.window = value.window;
  }
  if (typeof value.effort_hours === "number" || value.effort_hours === null) {
    overrides.effort_hours = value.effort_hours as number | null;
  }
  if (typeof value.done === "boolean") overrides.done = value.done;
  if (typeof value.note === "string") overrides.note = value.note;
  return overrides;
}

function planStatusDisplay(status: PlanResult["status"]): { label: string; tone: "ok" | "warn" | "danger" | "muted" } {
  switch (status) {
    case "ok":
      return { label: "方案已生成", tone: "ok" };
    case "partial":
      return { label: "方案已生成", tone: "warn" };
    case "data_unavailable":
      return { label: "补一版资料后生成", tone: "warn" };
    case "unsupported_direction":
      return { label: "换个方向生成", tone: "danger" };
    case "invalid_profile":
      return { label: "完善画像后生成", tone: "danger" };
    default:
      return { label: "方案已就绪", tone: "muted" };
  }
}

function LeadCards({
  title,
  leads,
  empty
}: {
  title: string;
  leads: PlanLead[];
  empty: string;
}) {
  return (
    <Collapse summary={`${title} · ${leads.length} 项`} defaultOpen={false}>
      {leads.length === 0 ? (
        <EmptyState compact icon="database" title="当前没有适用线索" description={empty} />
      ) : (
        <div className="lead-card-grid">
          {leads.map((lead) => {
            return (
              <article className="lead-card" key={lead.lead_id}>
                <header className="lead-card-head">
                  <h3>{lead.title}</h3>
                </header>
                <p className="lead-description">{lead.description}</p>
                <p className="lead-next">
                  <strong>核对方式</strong>
                  {lead.why}
                </p>
                {lead.skill_tags.length > 0 ? (
                  <div className="chip-row lead-tags">
                    {lead.skill_tags.map((tag) => (
                      <span className="chip" key={tag}>{tag}</span>
                    ))}
                  </div>
                ) : null}
                <footer className="lead-source">
                  <span>{lead.source_label}</span>
                  {lead.source_url ? (
                    <a href={lead.source_url} target="_blank" rel="noopener noreferrer">
                      查看入口 <Icon name="external" size={12} />
                    </a>
                  ) : (
                    <span className="lead-source-missing">见来源文件</span>
                  )}
                </footer>
                {lead.freshness ? (
                  <p className="lead-freshness">
                    更新频率：{lead.freshness.update_frequency}
                    {lead.freshness.last_checked_at ? ` · 更新于 ${formatDate(lead.freshness.last_checked_at)}` : ""}
                    {lead.freshness.valid_until ? ` · 有效期至 ${formatDate(lead.freshness.valid_until)}` : ""}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </Collapse>
  );
}

function SemesterLeadShortlist({
  result,
  onViewAll
}: {
  result: PlanResult;
  onViewAll: () => void;
}) {
  const lanes = [
    {
      label: "先选 1 门课",
      hint: "核对开课学期、先修与学分认定",
      leads: result.course_leads.slice(0, 3),
      empty: "先按下方行动清单核对培养方案"
    },
    {
      label: "先核对 1 项竞赛",
      hint: "确认年级资格、报名窗口与加分规则",
      leads: result.competition_leads.slice(0, 2),
      empty: "先按下方行动清单确认报名窗口"
    },
    {
      label: "先关注 2 个入口",
      hint: "把通知来源固定下来，减少漏信息",
      leads: result.campus_resources.slice(0, 2),
      empty: "先看学校官网与学院通知入口"
    }
  ];
  const total = result.course_leads.length + result.competition_leads.length + result.campus_resources.length;
  if (total === 0) return null;

  return (
    <section className="semester-shortlist" aria-labelledby="semester-shortlist-title">
      <div className="semester-shortlist-head">
        <div>
          <p className="eyebrow">不用先看完所有资料</p>
          <h2 id="semester-shortlist-title">这学期先从 {total} 条线索里选 3 步</h2>
          <p className="micro">
            下面的线索都带官方入口：选定后在下方行动清单里逐项确认。
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onViewAll}>
          查看全部线索
          <Icon name="arrow-right" size={13} />
        </Button>
      </div>

      <div className="semester-lead-grid">
        {lanes.map((lane) => (
          <article className="semester-lead-lane" key={lane.label}>
            <header>
              <div>
                <h3>{lane.label}</h3>
                <p>{lane.hint}</p>
              </div>
              <Badge tone="muted">{lane.leads.length} 条</Badge>
            </header>
            {lane.leads.length === 0 ? (
              <p className="panel-note">{lane.empty}</p>
            ) : (
              <ol className="semester-lead-list">
                {lane.leads.map((lead, index) => (
                  <li className="semester-lead-item" key={lead.lead_id}>
                    <span className="semester-lead-index">{index + 1}</span>
                    <div>
                      <h4>{lead.title}</h4>
                      <p>{lead.why}</p>
                      <div className="semester-lead-meta">
                        {lead.source_url ? (
                          <a href={lead.source_url} target="_blank" rel="noopener noreferrer">
                            打开来源 <Icon name="external" size={11} />
                          </a>
                        ) : (
                          <span>{lead.source_label}</span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function Roadmap({ stages, compact = false }: { stages: PlanResult["roadmap"]; compact?: boolean }) {
  if (stages.length === 0) {
    return <EmptyState compact icon="map" title="四年路线待生成" description="提交画像后生成分阶段行动；也可以先按本学期行动清单执行。" />;
  }
  return (
    <ol className={compact ? "roadmap-timeline is-compact" : "roadmap-timeline"}>
      {stages.map((stage, stageIndex) => (
        <li className="roadmap-stage" key={`${stage.stage}-${stageIndex}`}>
          <div className="roadmap-marker">{stageIndex + 1}</div>
          <div className="roadmap-content">
            <p className="roadmap-stage-name">{stage.stage}</p>
            <h3>{formatRoadmapFocus(stage.focus)}</h3>
            <ul>
              {stage.actions.map((action, actionIndex) => (
                <li key={`${stage.stage}-${actionIndex}`}>{action}</li>
              ))}
            </ul>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function PlanDetail({
  plan,
  result,
  directionId,
  localOrder,
  evidence,
  isCached = false,
  cachedAt = null,
  decisionReason = "",
  patchingActionId,
  actionErrors,
  onMoveOrder,
  onPatch,
  onRegenerate,
  regenerating
}: {
  plan: Plan | null;
  result: PlanResult;
  directionId: DirectionId;
  localOrder: string[];
  evidence: Citation[];
  isCached?: boolean;
  cachedAt?: string | null;
  decisionReason?: string;
  patchingActionId: string | null;
  actionErrors: Record<string, string>;
  onMoveOrder: (nextOrder: string[]) => void;
  onPatch: (actionId: string, overrides: ActionOverrides) => void;
  onRegenerate?: () => void;
  regenerating?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<PlanTab>("direction");

  function handleTabKey(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const last = PLAN_TABS.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    const tab = PLAN_TABS[next];
    setActiveTab(tab.id);
    window.requestAnimationFrame(() => document.getElementById(`plan-tab-${tab.id}`)?.focus());
  }
  const version = pickCurrentVersion(plan);
  const overridesMap = (version?.user_overrides ?? {}) as Record<string, Record<string, unknown>>;
  const baselineById = new Map(result.actions.map((action) => [action.action_id, action]));
  const effectiveActions = version && version.actions.length > 0 ? version.actions : result.actions;
  const orderedActions = orderPlanActions(effectiveActions, localOrder);
  const direction = getDirection(directionId);
  const status = planStatusDisplay(result.status);
  const grouped = PLAN_WINDOW_ORDER.map((window) => ({
    window,
    actions: orderedActions.filter((action) => (coerceOverrides(overridesMap[action.action_id]).window ?? action.window) === window)
  })).filter((group) => group.actions.length > 0);

  const displayWarnings = formatPlanWarnings(result.warnings);
  const analysisFallbackWarning = result.warnings.find((warning) =>
    warning.startsWith("plan_analysis_fallback:")
  );
  const displayedAnalysis =
    result.analysis ?? (direction ? buildRuleFallbackAnalysis(direction, result) : null);
  const analysisIsFallback = !result.analysis && Boolean(displayedAnalysis);
  const isDataGapState = result.status === "data_unavailable";
  const topThirty = result.roadmap.find((stage) => stage.stage === "未来 30 天") ?? null;
  const currentStage = result.roadmap.find((stage) => stage.stage !== "未来 30 天") ?? null;
  const priorityItems = topThirty?.actions.slice(0, 3) ?? orderedActions.slice(0, 3).map((action) => action.title);

  function move(action: PlanAction, directionDelta: -1 | 1) {
    const ids = orderedActions.map((item) => item.action_id);
    const index = ids.indexOf(action.action_id);
    const target = index + directionDelta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    onMoveOrder(ids);
  }

  return (
    <div className="plan-detail stack">
      <section className="plan-decision-cockpit" aria-labelledby="plan-decision-title">
        <div className="plan-decision-head">
          <div>
            <h2 id="plan-decision-title">
              {result.pathway?.label ?? "主路线"} · {direction?.title ?? directionId}
            </h2>
          </div>
          {onRegenerate ? (
            <Button variant="secondary" size="md" onClick={onRegenerate} disabled={regenerating}>
              <Icon name="refresh" size={15} />
              {regenerating ? "生成中…" : "重新生成方案"}
            </Button>
          ) : null}
        </div>

        {result.pathway ? (
          <div className="plan-route-row">
            <div className="plan-route-primary">
              <span className="plan-route-label">为什么先走这条路线</span>
              <ul className="recommend-reasons">
                {result.pathway.rationale.slice(0, 3).map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
            <div className="plan-route-side">
              <div>
                <span className="plan-route-label">备选路线</span>
                <p>{result.pathway.alternatives.length > 0 ? result.pathway.alternatives.join("、") : "主路线优先"}</p>
              </div>
              <div>
                <span className="plan-route-label">硬约束排除</span>
                <p>{result.pathway.excluded.length > 0 ? result.pathway.excluded.join("、") : "无"}</p>
              </div>
            </div>
          </div>
        ) : null}

        {decisionReason.trim() ? (
          <div className="plan-user-reason">
            <span className="plan-route-label">你写下的判断依据与未知</span>
            <p>{decisionReason.trim()}</p>
          </div>
        ) : null}

        <div className="plan-priority-grid">
          <div className="plan-priority-card">
            <div className="plan-priority-head">
              <span>未来 30 天</span>
              <Badge tone="accent">先做</Badge>
            </div>
            {priorityItems.length > 0 ? (
              <ol className="plan-priority-list">
                {priorityItems.map((item, index) => (
                  <li key={`${item}-${index}`}><span>{index + 1}</span>{item}</li>
                ))}
              </ol>
            ) : (
              <p className="panel-note">先按下方「下一步核对」固定入口，再回到这里安排行动。</p>
            )}
          </div>
          <div className="plan-priority-card">
            <div className="plan-priority-head">
              <span>{currentStage?.stage ?? "本学期"}</span>
              <Badge tone="muted">
                {currentStage ? formatRoadmapFocus(currentStage.focus) : "形成第一份证据"}
              </Badge>
            </div>
            <ul className="plan-priority-list is-bulleted">
              {(currentStage?.actions ?? orderedActions.slice(0, 3).map((action) => action.title)).slice(0, 3).map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <div className="plan-detail-tabs" role="tablist" aria-label="方案内容">
        {PLAN_TABS.map((tab, index) => (
          <button
            key={tab.id}
            id={`plan-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={activeTab === tab.id ? `plan-panel-${tab.id}` : undefined}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={activeTab === tab.id ? "plan-detail-tab is-active" : "plan-detail-tab"}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => handleTabKey(event, index)}
          >
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {activeTab === "direction" ? (
        <div className="plan-detail-panel" id="plan-panel-direction" role="tabpanel" aria-labelledby="plan-tab-direction">
          {direction ? (
            <section className="direction-context-card">
              <div>
                <h2>{direction.title}</h2>
                <p className="micro">{direction.summary}</p>
              </div>
              <Collapse summary="方向详情：工作内容、能力要求、准备成本">
                <div className="direction-context-grid">
                  <div>
                    <h3>日常工作内容</h3>
                    <ul>{direction.work_content.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                  <div>
                    <h3>需要验证的能力</h3>
                    <ul>{direction.verified_skills.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                  <div>
                    <h3>准备成本与适用范围</h3>
                    <p>{direction.preparation_cost}</p>
                    <p>{direction.applicability}</p>
                  </div>
                </div>
              </Collapse>
            </section>
          ) : null}

          {analysisIsFallback ? (
            <Callout tone="plain" title="方向分析：规则摘要">
              <p className="small-note">
                {analysisFallbackWarning
                  ? formatPlanWarning(analysisFallbackWarning)
                  : "以下内容依据方向卡与规则事实生成，可以直接用于下一步行动。"}
              </p>
            </Callout>
          ) : null}

          {displayedAnalysis ? (
            <Collapse summary={analysisIsFallback ? "方向分析（规则摘要）" : "AI 方向分析"} defaultOpen={analysisIsFallback}>
              <div className="analysis-grid">
                <article className="analysis-card">
                  <h3><Icon name="compass" size={15} /> 方向概览</h3>
                  <div className="analysis-body"><CitationText text={displayedAnalysis.overview} citations={evidence} /></div>
                </article>
                <article className="analysis-card">
                  <h3><Icon name="activity" size={15} /> 画像匹配</h3>
                  <div className="analysis-body"><CitationText text={displayedAnalysis.match} citations={evidence} /></div>
                </article>
              </div>

              {displayedAnalysis.action_rationale.length > 0 ? (
                <div className="analysis-block">
                  <h3><Icon name="list" size={15} /> 每条行动的依据与做法</h3>
                  <ol className="analysis-list">
                    {displayedAnalysis.action_rationale.map((line, index) => (
                      <li key={index}><CitationText text={line} citations={evidence} /></li>
                    ))}
                  </ol>
                </div>
              ) : null}

              {displayedAnalysis.risks.length > 0 ? (
                <div className="analysis-block">
                  <h3><Icon name="compass" size={15} /> 需要跟进的点</h3>
                  <ul className="analysis-list">
                    {displayedAnalysis.risks.map((line, index) => (
                      <li key={index}><CitationText text={line} citations={evidence} /></li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {displayedAnalysis.next_steps.length > 0 ? (
                <div className="analysis-block">
                  <h3><Icon name="arrow-right" size={15} /> 建议的下一步</h3>
                  <ol className="analysis-steps">
                    {displayedAnalysis.next_steps.map((line, index) => (
                      <li key={index}><span className="analysis-step-no">{index + 1}</span><CitationText text={line} citations={evidence} /></li>
                    ))}
                  </ol>
                </div>
              ) : null}

            </Collapse>
          ) : null}

          <Collapse summary="方案说明">
            {result.explanation ? (
              <div className="explanation-text"><CitationText text={result.explanation} citations={evidence} /></div>
            ) : (
              <p className="micro">方案要点见上方方向分析与行动卡片。</p>
            )}
          </Collapse>
        </div>
      ) : null}

      {activeTab === "campus" ? (
        <div className="plan-detail-panel" id="plan-panel-campus" role="tabpanel" aria-labelledby="plan-tab-campus">
          <LeadCards
            title="可优先了解的课程"
            leads={result.course_leads}
            empty="到教务处培养方案检索本专业与年级，就能拿到完整课程清单。"
          />
          <LeadCards
            title="方向与行业（招聘快照）"
            leads={result.industry_leads}
            empty="先看学校就业质量报告，再到招聘平台核对目标岗位的最新要求。"
          />
          <LeadCards
            title="上经贸就业数据"
            leads={result.campus_facts}
            empty="学校就业质量年度报告里有完整的去向数据，可先在资料库检索。"
          />
          <LeadCards
            title="与当前方向相关的竞赛"
            leads={result.competition_leads}
            empty={result.competition_leads.length === 0 ? "你已关闭竞赛选项；开启后就能看到对应竞赛线索。" : "先按行动清单确认报名窗口。"}
          />
          <LeadCards
            title="校内资源从哪里找"
            leads={result.campus_resources}
            empty="学校官网与学院通知是最快的入口，可先从这两处开始。"
          />

          {result.courses.length > 0 || result.competitions.length > 0 ? (
            <Collapse
              summary={`课程与竞赛明细 · ${result.courses.length + result.competitions.length} 项`}
              defaultOpen={false}
            >
              {result.courses.length > 0 ? (
                <div className="verified-data-group">
                  <h3>课程</h3>
                  {result.courses.map((course) => (
                    <p key={course.course_id}>
                      <strong>{course.title}</strong>
                      {" · "}
                      {course.credits === null ? "学分按培养方案" : `${course.credits} 学分`}
                      {course.offered_terms.length > 0 ? ` · ${course.offered_terms.join(" / ")}` : ""}
                    </p>
                  ))}
                </div>
              ) : null}
              {result.competitions.length > 0 ? (
                <div className="verified-data-group">
                  <h3>竞赛</h3>
                  {result.competitions.map((competition) => (
                    <p key={competition.competition_id}>
                      <strong>{competition.title}</strong>
                      {" · "}
                      {competition.window || "时间窗口见竞赛通知"}
                    </p>
                  ))}
                </div>
              ) : null}
            </Collapse>
          ) : null}
        </div>
      ) : null}

      {activeTab === "semester" ? (
        <div className="plan-detail-panel" id="plan-panel-semester" role="tabpanel" aria-labelledby="plan-tab-semester">
          <SemesterLeadShortlist result={result} onViewAll={() => setActiveTab("campus")} />

          {topThirty ? (
            <section className="semester-focus">
              <div className="section-heading-text">
                <h2>{topThirty.stage}：{formatRoadmapFocus(topThirty.focus)}</h2>
              </div>
              <Roadmap stages={[topThirty]} compact />
            </section>
          ) : null}

          <section className="plan-actions-section" aria-labelledby="plan-actions-title">
            <div className="section-heading">
              <div className="section-heading-text">
                <h2 id="plan-actions-title">按当前学期 / 下学期 / 更晚分组</h2>
              </div>
              <Badge tone="muted">{orderedActions.length} 项</Badge>
            </div>

            {currentStage ? (
              <div className="current-stage-strip">
                <Badge tone="accent">{currentStage.stage}</Badge>
                <strong>{formatRoadmapFocus(currentStage.focus)}</strong>
                <span>{currentStage.actions.length} 个关键动作</span>
              </div>
            ) : null}

            {orderedActions.length === 0 ? (
              <EmptyState
                icon="list"
                title="本次没有返回可执行行动"
                description={
                  result.status === "data_unavailable" || result.status === "partial"
                    ? "先上传培养方案或核对入口，再重新生成一版方案。"
                    : "换一个方向重新生成，就能得到对应的行动清单。"
                }
              />
            ) : (
              grouped.map((group) => (
                <div className="action-group" key={group.window}>
                  <div className="action-group-head">
                    <h3>
                      <Icon name="clock" size={15} />
                      {PLAN_WINDOW_LABELS[group.window]}
                    </h3>
                    <span className="action-group-count">{group.actions.length} 项</span>
                  </div>
                  <div className="action-group-list">
                    {group.actions.map((action) => {
                      const baseline = baselineById.get(action.action_id) ?? action;
                      const overrides = coerceOverrides(overridesMap[action.action_id]);
                      const flatIndex = orderedActions.findIndex((item) => item.action_id === action.action_id);
                      return (
                        <ActionCard
                          key={action.action_id}
                          index={flatIndex}
                          machine={baseline}
                          effective={action}
                          overrides={overrides}
                          evidence={evidence}
                          canMoveUp={flatIndex > 0}
                          canMoveDown={flatIndex < orderedActions.length - 1}
                          onMove={(delta) => move(action, delta)}
                          onSave={(nextOverrides) => onPatch(action.action_id, nextOverrides)}
                          onToggleDone={(done) => onPatch(action.action_id, { done })}
                          pending={patchingActionId === action.action_id}
                          error={actionErrors[action.action_id]}
                        />
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      ) : null}

      {activeTab === "roadmap" ? (
        <div className="plan-detail-panel" id="plan-panel-roadmap" role="tabpanel" aria-labelledby="plan-tab-roadmap">
          <h2>四年路线：阶段里程碑与复核点</h2>
          <Roadmap stages={result.roadmap} />
        </div>
      ) : null}

      {activeTab === "sources" ? (
        <div className="plan-detail-panel" id="plan-panel-sources" role="tabpanel" aria-labelledby="plan-tab-sources">
          <section aria-label="证据引用">
            <div className="section-heading">
              <div className="section-heading-text">
                <h2>证据引用</h2>
              </div>
              <Badge tone="muted">{evidence.length} 条</Badge>
            </div>
            <CitationFileList citations={evidence} />
          </section>

          <SourceUploadPanel />

          {result.gaps.length > 0 ? (
            <Collapse summary={`下一步核对 · ${result.gaps.length} 项`} defaultOpen={false}>
              <ul className="gap-card-list">
                {result.gaps.map((gap, index) => (
                  <li className="gap-card" key={`${gap.code}-${index}`}>
                    <Icon name="alert" size={16} />
                    <div>
                      <p className="gap-card-code">{gap.code}{gap.module ? ` · ${gap.module}` : ""}</p>
                      <p className="gap-card-message">{gap.message}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Collapse>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
