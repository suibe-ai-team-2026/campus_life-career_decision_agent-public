"use client";

import { useState } from "react";
import type { Plan, PlanAction, PlanLead, PlanResult, VerificationLabel } from "@/lib/contracts/plan";
import type { Citation } from "@/lib/contracts/run";
import type { DirectionId } from "@/lib/contracts/common";
import { PLAN_WINDOW_LABELS, PLAN_WINDOW_ORDER, getDirection } from "@/lib/content";
import { Badge, Button, Callout, EmptyState, Icon, formatDateTime, formatDate } from "@/components/ui/primitives";
import { CitationList } from "@/components/ui/CitationCard";
import { formatPlanWarnings, summarizeDataGaps, summarizeEffort } from "@/lib/plan-display";
import { SourceUploadPanel } from "@/components/tools/SourceUploadPanel";
import { ActionCard, type ActionOverrides } from "./PlanActionCard";

type PlanTab = "direction" | "campus" | "semester" | "roadmap" | "sources";

const PLAN_TABS: Array<{ id: PlanTab; label: string; hint: string }> = [
  { id: "direction", label: "方向与行业", hint: "路线、方向与画像解释" },
  { id: "campus", label: "上经贸现实", hint: "课程、竞赛与校内资源" },
  { id: "semester", label: "本学期执行", hint: "30 天与本学期动作" },
  { id: "roadmap", label: "四年路线", hint: "阶段里程碑与复核点" },
  { id: "sources", label: "依据与边界", hint: "来源、缺口与版本" }
];

const VERIFICATION_LABELS: Record<VerificationLabel, string> = {
  known: "已知",
  official_lead: "官方线索",
  external_reference: "外部参考",
  pending_verification: "待核验",
  data_missing: "资料缺失"
};

const VERIFICATION_TONES: Record<VerificationLabel, "ok" | "accent" | "warn" | "muted"> = {
  known: "ok",
  official_lead: "accent",
  external_reference: "muted",
  pending_verification: "warn",
  data_missing: "warn"
};

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
      return { label: "部分资料缺失", tone: "warn" };
    case "data_unavailable":
      return { label: "资料未就绪", tone: "warn" };
    case "unsupported_direction":
      return { label: "方向暂不支持", tone: "danger" };
    case "invalid_profile":
      return { label: "画像需补充", tone: "danger" };
    default:
      return { label: "状态未知", tone: "muted" };
  }
}

function LeadCards({
  eyebrow,
  title,
  leads,
  empty
}: {
  eyebrow: string;
  title: string;
  leads: PlanLead[];
  empty: string;
}) {
  return (
    <section className="lead-section" aria-label={title}>
      <div className="section-heading">
        <div className="section-heading-text">
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <Badge tone="muted">{leads.length} 项</Badge>
      </div>
      {leads.length === 0 ? (
        <EmptyState compact icon="database" title="当前没有适用线索" description={empty} />
      ) : (
        <div className="lead-card-grid">
          {leads.map((lead) => {
            const status = VERIFICATION_LABELS[lead.verification_status];
            return (
              <article className="lead-card" key={lead.lead_id}>
                <header className="lead-card-head">
                  <h3>{lead.title}</h3>
                  <Badge tone={VERIFICATION_TONES[lead.verification_status]}>{status}</Badge>
                </header>
                <p className="lead-description">{lead.description}</p>
                <p className="lead-next">
                  <strong>核验方式</strong>
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
                    <span className="lead-source-missing">暂无可验证直达链接</span>
                  )}
                </footer>
                {lead.freshness ? (
                  <p className="lead-freshness">
                    更新频率：{lead.freshness.update_frequency}
                    {lead.freshness.last_checked_at ? ` · 最近核验 ${formatDate(lead.freshness.last_checked_at)}` : " · 尚未完成人工核验"}
                    {lead.freshness.valid_until ? ` · 有效期至 ${formatDate(lead.freshness.valid_until)}` : ""}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Roadmap({ stages, compact = false }: { stages: PlanResult["roadmap"]; compact?: boolean }) {
  if (stages.length === 0) {
    return <EmptyState compact icon="map" title="路线蓝图未生成" description="当前结果没有返回分阶段行动，请补充画像或重新生成方案。" />;
  }
  return (
    <ol className={compact ? "roadmap-timeline is-compact" : "roadmap-timeline"}>
      {stages.map((stage, stageIndex) => (
        <li className="roadmap-stage" key={`${stage.stage}-${stageIndex}`}>
          <div className="roadmap-marker">{stageIndex + 1}</div>
          <div className="roadmap-content">
            <p className="roadmap-stage-name">{stage.stage}</p>
            <h3>{stage.focus}</h3>
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
  patchingActionId: string | null;
  actionErrors: Record<string, string>;
  onMoveOrder: (nextOrder: string[]) => void;
  onPatch: (actionId: string, overrides: ActionOverrides) => void;
  onRegenerate?: () => void;
  regenerating?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<PlanTab>("direction");
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

  const pendingVerification = result.actions.filter((action) => action.status === "pending_verification");
  const effort = summarizeEffort(result.actions);
  const gapSummary = summarizeDataGaps(result.actions);
  const displayWarnings = formatPlanWarnings(result.warnings);
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
    <div className="plan-detail">
      {isCached ? (
        <Callout tone="warn" title="这是本设备缓存的方案">
          <p>
            云端当前不可用，因此展示上次成功加载的版本（缓存于 {formatDateTime(cachedAt)}）。它不会被当作新生成的方案，也不会覆盖云端数据。
          </p>
        </Callout>
      ) : null}

      <section className="plan-decision-cockpit" aria-labelledby="plan-decision-title">
        <div className="plan-decision-head">
          <div>
            <p className="eyebrow">决策驾驶舱</p>
            <h2 id="plan-decision-title">
              当前主线：{result.pathway?.label ?? "路线待补充"} · 当前方向：{direction?.title ?? directionId}
            </h2>
            <div className="plan-summary-meta">
              <Badge tone={status.tone}>{status.label}</Badge>
              <span>未来 30 天优先做 {priorityItems.length} 件事</span>
              <span>{pendingVerification.length + result.gaps.length} 项资料或资格待核验</span>
            </div>
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
                <p>{result.pathway.alternatives.length > 0 ? result.pathway.alternatives.join("、") : "暂未选择"}</p>
              </div>
              <div>
                <span className="plan-route-label">硬约束排除</span>
                <p>{result.pathway.excluded.length > 0 ? result.pathway.excluded.join("、") : "无"}</p>
              </div>
            </div>
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
              <p className="panel-note">当前没有可执行动作，请查看“依据与边界”中的数据缺口。</p>
            )}
          </div>
          <div className="plan-priority-card">
            <div className="plan-priority-head">
              <span>{currentStage?.stage ?? "本学期"}</span>
              <Badge tone="muted">{currentStage?.focus ?? "形成第一份证据"}</Badge>
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
        {PLAN_TABS.map((tab) => (
          <button
            key={tab.id}
            id={`plan-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`plan-panel-${tab.id}`}
            className={activeTab === tab.id ? "plan-detail-tab is-active" : "plan-detail-tab"}
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{tab.label}</span>
            <small>{tab.hint}</small>
          </button>
        ))}
      </div>

      {activeTab === "direction" ? (
        <div className="plan-detail-panel" id="plan-panel-direction" role="tabpanel" aria-labelledby="plan-tab-direction">
          {direction ? (
            <section className="direction-context-card">
              <div>
                <p className="eyebrow">当前职业方向</p>
                <h2>{direction.title}</h2>
                <p>{direction.summary}</p>
              </div>
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
            </section>
          ) : null}

          {result.analysis ? (
            <section className="plan-analysis" aria-labelledby="plan-analysis-title">
              <div className="section-heading">
                <div className="section-heading-text">
                  <p className="eyebrow">AI 方向分析</p>
                  <h2 id="plan-analysis-title">用你的画像解释这个方向，而不是复述测试题</h2>
                  <p className="section-description">
                    路线约束由程序先执行，AI 只负责把画像信号、规则事实与证据组织成可读解释。
                  </p>
                </div>
                <Badge tone="accent">AI 解释</Badge>
              </div>

              <div className="analysis-grid">
                <article className="analysis-card">
                  <h3><Icon name="compass" size={15} /> 方向概览</h3>
                  <p className="analysis-body">{result.analysis.overview}</p>
                </article>
                <article className="analysis-card">
                  <h3><Icon name="activity" size={15} /> 画像匹配</h3>
                  <p className="analysis-body">{result.analysis.match}</p>
                </article>
              </div>

              {result.analysis.action_rationale.length > 0 ? (
                <div className="analysis-block">
                  <h3><Icon name="list" size={15} /> 每条行动的依据与做法</h3>
                  <ol className="analysis-list">
                    {result.analysis.action_rationale.map((line, index) => <li key={index}>{line}</li>)}
                  </ol>
                </div>
              ) : null}

              {result.analysis.risks.length > 0 ? (
                <div className="analysis-block">
                  <h3><Icon name="alert" size={15} /> 风险与未知</h3>
                  <ul className="analysis-list">
                    {result.analysis.risks.map((line, index) => <li key={index}>{line}</li>)}
                  </ul>
                </div>
              ) : null}

              {result.analysis.next_steps.length > 0 ? (
                <div className="analysis-block">
                  <h3><Icon name="arrow-right" size={15} /> 建议的下一步</h3>
                  <ol className="analysis-steps">
                    {result.analysis.next_steps.map((line, index) => (
                      <li key={index}><span className="analysis-step-no">{index + 1}</span>{line}</li>
                    ))}
                  </ol>
                </div>
              ) : null}

              {result.analysis.boundary_note ? (
                <p className="panel-note plan-analysis-boundary">
                  <Icon name="info" size={13} /> {result.analysis.boundary_note}
                </p>
              ) : null}
            </section>
          ) : (
            <EmptyState icon="sparkles" title="方向分析暂未生成" description="确定性路线和行动仍可查看；AI 解释失败不会改动规则事实。" />
          )}

          <section className="explanation-panel" aria-labelledby="plan-explanation-title">
            <div className="panel-head">
              <div>
                <p className="eyebrow">方案说明</p>
                <h2 id="plan-explanation-title">AI 不修改路线、事实与数字</h2>
              </div>
              <Badge tone="muted">可追溯</Badge>
            </div>
            {result.explanation ? (
              <div className="explanation-text">{result.explanation}</div>
            ) : (
              <EmptyState compact icon="sparkles" title="本次没有生成解释" description="行动与资料状态仍来自确定性结果。" />
            )}
          </section>
        </div>
      ) : null}

      {activeTab === "campus" ? (
        <div className="plan-detail-panel" id="plan-panel-campus" role="tabpanel" aria-labelledby="plan-tab-campus">
          <Callout tone="plain" icon="shield" title="这些是待核对的学校资料线索">
            <p>
              课程名称、竞赛名称和校内入口用于帮助你开始核对。学分、先修、开课学期、报名资格与校内认定必须以教务处、学院或当年官方通知为准。
            </p>
          </Callout>
          <LeadCards
            eyebrow="课程"
            title="国贸专业可优先了解的课程"
            leads={result.course_leads}
            empty="当前专业尚未配置课程线索；请在教务处培养方案中检索专业与年级。"
          />
          <LeadCards
            eyebrow="竞赛"
            title="与当前方向相关的竞赛线索"
            leads={result.competition_leads}
            empty={result.competition_leads.length === 0 ? "你已关闭竞赛选项，或当前方向尚未配置竞赛线索。" : "暂未匹配到竞赛线索。"}
          />
          <LeadCards
            eyebrow="校内资源"
            title="课程、实习、竞赛与第二课堂从哪里找"
            leads={result.campus_resources}
            empty="当前学校尚未配置校内资源卡；可先从学校官网与学院通知入口开始。"
          />

          {result.courses.length > 0 || result.competitions.length > 0 ? (
            <section className="verified-data-panel">
              <div className="section-heading-text">
                <p className="eyebrow">已核验结构化数据</p>
                <h2>可以直接进入规则计算的事实</h2>
                <p className="section-description">只有来源和适用年级完成核验的课程、竞赛才进入这里。</p>
              </div>
              {result.courses.length > 0 ? (
                <div className="verified-data-group">
                  <h3>课程</h3>
                  {result.courses.map((course) => (
                    <p key={course.course_id}>
                      <strong>{course.title}</strong>
                      {" · "}
                      {course.credits === null ? "学分未知" : `${course.credits} 学分`}
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
                      {competition.window || "时间窗口未知"}
                    </p>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}

      {activeTab === "semester" ? (
        <div className="plan-detail-panel" id="plan-panel-semester" role="tabpanel" aria-labelledby="plan-tab-semester">
          {topThirty ? (
            <section className="semester-focus">
              <div className="section-heading-text">
                <p className="eyebrow">先完成这段</p>
                <h2>{topThirty.stage}：{topThirty.focus}</h2>
                <p className="section-description">每项都包含“核对什么、做什么、用什么证据复核”，不把核对任务伪装成已经完成的计划。</p>
              </div>
              <Roadmap stages={[topThirty]} compact />
            </section>
          ) : null}

          <section className="plan-actions-section" aria-labelledby="plan-actions-title">
            <div className="section-heading">
              <div className="section-heading-text">
                <p className="eyebrow">行动清单</p>
                <h2 id="plan-actions-title">按当前学期 / 下学期 / 更晚分组</h2>
                <p className="section-description">
                  修改时间、工时、备注或勾选完成会同步到方案版本；拖动排序只保存在本设备。
                </p>
              </div>
              <Badge tone="muted">{orderedActions.length} 项</Badge>
            </div>

            {currentStage ? (
              <div className="current-stage-strip">
                <Badge tone="accent">{currentStage.stage}</Badge>
                <strong>{currentStage.focus}</strong>
                <span>{currentStage.actions.length} 个关键动作</span>
              </div>
            ) : null}

            {orderedActions.length === 0 ? (
              <EmptyState
                icon="list"
                title="本次没有返回可执行行动"
                description={
                  result.status === "data_unavailable" || result.status === "partial"
                    ? "资料尚不足以生成规则行动；请查看数据缺口或上传自己的资料后重新生成。"
                    : "规则结果中没有匹配到行动项。可以换一个方向重新生成。"
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
            <p className="panel-note">排序为本设备本地记录；行动调整与完成状态会同步到当前方案版本。</p>
          </section>
        </div>
      ) : null}

      {activeTab === "roadmap" ? (
        <div className="plan-detail-panel" id="plan-panel-roadmap" role="tabpanel" aria-labelledby="plan-tab-roadmap">
          <div className="section-heading-text">
            <p className="eyebrow">四年路线</p>
            <h2>把“先比较主线”拆成每一阶段的证据与复核点</h2>
            <p className="section-description">
              路线可以随课程、实践和实习反馈调整。每次调整后，应重新核对准备成本与硬性资格。
            </p>
          </div>
          <Roadmap stages={result.roadmap} />
        </div>
      ) : null}

      {activeTab === "sources" ? (
        <div className="plan-detail-panel" id="plan-panel-sources" role="tabpanel" aria-labelledby="plan-tab-sources">
          <section className="plan-facts" aria-label="方案资料状态">
            <div className="plan-fact">
              <span className="plan-fact-label">学分</span>
              <span className={result.credits === null ? "plan-fact-value is-missing" : "plan-fact-value"}>
                {result.credits === null ? "资料未就绪" : `${result.credits} 学分`}
              </span>
              <span className="plan-fact-note">{result.credits === null ? "缺失不写成 0" : "仅来自已核验规则"}</span>
            </div>
            <div className="plan-fact">
              <span className="plan-fact-label">预计投入</span>
              <span className={effort.value === "未估算" ? "plan-fact-value is-missing" : "plan-fact-value"}>{effort.value}</span>
              <span className="plan-fact-note">{effort.note}</span>
            </div>
            <div className="plan-fact">
              <span className="plan-fact-label">待核验</span>
              <span className="plan-fact-value">{pendingVerification.length + result.gaps.length} 项</span>
              <span className="plan-fact-note">含行动资格与资料缺口</span>
            </div>
            <div className="plan-fact">
              <span className="plan-fact-label">证据引用</span>
              <span className="plan-fact-value">{evidence.length} 条</span>
              <span className="plan-fact-note">编号由服务端分配</span>
            </div>
          </section>

          {displayWarnings.length > 0 ? (
            <Callout tone="warn" title="生成时提示">
              <ul className="callout-list">
                {displayWarnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </Callout>
          ) : null}

          {isDataGapState ? (
            <Callout tone="warn" title="这次主要输出的是核对清单">
              <p>
                当前没有足够完整的专业事实来完成课程与学分推断。下面 {gapSummary.verifyCount} 项是“去核对什么”，不是已经确定的课程要求。
              </p>
              {gapSummary.titles.length > 0 ? (
                <ul className="callout-list">
                  {gapSummary.titles.map((title) => <li key={title}>{title}</li>)}
                </ul>
              ) : null}
            </Callout>
          ) : result.status !== "ok" ? (
            <Callout tone={result.status === "unsupported_direction" || result.status === "invalid_profile" ? "danger" : "warn"} title="这是部分结果">
              <p>缺失的资料不会被补成虚构数字。完成核验或上传自己的资料后，可以重新生成方案。</p>
            </Callout>
          ) : null}

          <section className="panel" aria-labelledby="plan-gaps-title">
            <div className="panel-head">
              <div>
                <p className="eyebrow">数据缺口</p>
                <h2 id="plan-gaps-title">哪些资料还没就绪</h2>
              </div>
              <Badge tone={result.gaps.length > 0 ? "warn" : "ok"}>{result.gaps.length} 项</Badge>
            </div>
            {result.gaps.length === 0 ? (
              <p className="panel-note">本次没有报告数据缺口；仍应按来源与核验状态逐项确认。</p>
            ) : (
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
            )}
          </section>

          <SourceUploadPanel />

          <details className="plan-disclosure">
            <summary>
              <span><Icon name="database" size={15} /> 查看证据与引用（{evidence.length} 条）</span>
              <Icon name="chevron-down" size={15} />
            </summary>
            <div className="plan-disclosure-body">
              <CitationList citations={evidence} />
            </div>
          </details>

          {plan && plan.versions.length > 0 ? (
            <details className="plan-disclosure">
              <summary>
                <span><Icon name="refresh" size={15} /> 查看版本元数据（{plan.versions.length} 个版本）</span>
                <Icon name="chevron-down" size={15} />
              </summary>
              <div className="plan-disclosure-body">
                <p className="version-meta">
                  规则 {result.rules_version || "未提供"} · 画像 v{result.profile_version}
                  {version ? ` · 方案 v${version.version} · ${formatDateTime(version.created_at)}` : ""}
                </p>
                <ul className="version-list">
                  {[...plan.versions]
                    .sort((a, b) => b.version - a.version)
                    .map((item) => (
                      <li className={item.version_id === plan.current_version_id ? "version-item is-current" : "version-item"} key={item.version_id}>
                        <span className="version-no">v{item.version}</span>
                        <span className="version-status">
                          {item.version_id === plan.current_version_id ? "当前版本" : item.status === "stale" ? "已过期" : item.status}
                        </span>
                        <span className="version-meta">
                          规则 {item.rules_version || "—"} · 画像 v{item.profile_version} · {formatDate(item.created_at)}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            </details>
          ) : null}

          <details className="plan-disclosure">
            <summary>
              <span><Icon name="info" size={15} /> 资料边界与责任说明</span>
              <Icon name="chevron-down" size={15} />
            </summary>
            <div className="plan-disclosure-body">
              <p className="panel-note">
                本方案用于生涯规划辅助，不构成就业、录取、考试或学分认定承诺。规则与 AI 都不会替你做最终决定。
                课程、学分、先修、竞赛资格、校内认定和毕业要求，一律以教务处、学院与当年官方通知为准。
                AI 只解释已提供的画像与规则事实，不改动硬排除条件、方向排序、课程资格或数字。
              </p>
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}
