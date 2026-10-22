"use client";

import type { Plan, PlanAction, PlanResult } from "@/lib/contracts/plan";
import type { Citation } from "@/lib/contracts/run";
import type { DirectionId } from "@/lib/contracts/common";
import { PLAN_WINDOW_LABELS, PLAN_WINDOW_ORDER, getDirection, windowLabel } from "@/lib/content";
import { Badge, Button, Callout, EmptyState, Icon, formatDateTime, formatDate } from "@/components/ui/primitives";
import { CitationList } from "@/components/ui/CitationCard";
import { formatPlanWarnings, summarizeDataGaps, summarizeEffort } from "@/lib/plan-display";
import { SourceUploadPanel } from "@/components/tools/SourceUploadPanel";
import { ActionCard, type ActionOverrides } from "./PlanActionCard";

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

      <section className="plan-summary" aria-labelledby="plan-summary-title">
        <div className="plan-summary-head">
          <div>
            <p className="eyebrow">行动方案 · {direction?.title ?? directionId}</p>
            <h2 id="plan-summary-title">
              {grouped.reduce((sum, group) => sum + group.actions.length, 0)} 项行动，按时间窗分组
            </h2>
            <p className="plan-summary-meta">
              <Badge tone={status.tone}>{status.label}</Badge>
              <span>规则版本 {result.rules_version || "未提供"}</span>
              <span>画像版本 {result.profile_version}</span>
              {version ? <span>方案版本 v{version.version}</span> : null}
              {version?.corpus_version ? <span>资料版本 {version.corpus_version}</span> : null}
              <span>生成于 {version ? formatDateTime(version.created_at) : "—"}</span>
            </p>
          </div>
          {onRegenerate ? (
            <Button variant="secondary" size="md" onClick={onRegenerate} disabled={regenerating}>
              <Icon name="refresh" size={15} />
              {regenerating ? "生成中…" : "重新生成方案"}
            </Button>
          ) : null}
        </div>
        <div className="plan-facts">
          <div className="plan-fact">
            <span className="plan-fact-label">学分</span>
            <span className={result.credits === null ? "plan-fact-value is-missing" : "plan-fact-value"}>
              {result.credits === null ? "资料未就绪" : `${result.credits} 学分`}
            </span>
            <span className="plan-fact-note">{result.credits === null ? "不显示 0，避免把缺失当作零学分" : "来自已载入的规则与资料"}</span>
          </div>
          <div className="plan-fact">
            <span className="plan-fact-label">预计投入</span>
            <span className={effort.value === "未估算" ? "plan-fact-value is-missing" : "plan-fact-value"}>
              {effort.value}
            </span>
            <span className="plan-fact-note">{effort.note}</span>
          </div>
          <div className="plan-fact">
            <span className="plan-fact-label">待核验</span>
            <span className="plan-fact-value">{pendingVerification.length} 项</span>
            <span className="plan-fact-note">标为待核验的行动需要按官方资料确认</span>
          </div>
          <div className="plan-fact">
            <span className="plan-fact-label">证据引用</span>
            <span className="plan-fact-value">{evidence.length} 条</span>
            <span className="plan-fact-note">引用编号由服务端分配，不生成外部链接</span>
          </div>
        </div>
      </section>

      {displayWarnings.length > 0 ? (
        <Callout tone="warn" title="生成时提示">
          <ul className="callout-list">
            {displayWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      {isDataGapState ? (
        <section className="plan-gap-panel" aria-labelledby="plan-gap-title">
          <Callout tone="warn" title="这次没有你的专业资料，所以只生成了核对清单">
            <p>
              规则引擎只使用已核验的资料。对你填写的学校、专业与年级，当前还没有核验过的培养方案、
              学分认定规则、竞赛目录与方向要求，因此<strong>不会生成课程和学分数</strong>。
              下面这 {gapSummary.verifyCount} 项是「去核对什么」，不是「你要上什么课」。
            </p>
            {gapSummary.titles.length > 0 ? (
              <ul className="callout-list">
                {gapSummary.titles.map((title) => (
                  <li key={title}>{title}</li>
                ))}
              </ul>
            ) : null}
            <p>
              补齐资料后重新生成，才会出现课程、学分与竞赛。核对任务不需要你估工时，
              如果你也想记录，可以在下方按项填写。
            </p>
          </Callout>
          <SourceUploadPanel />
        </section>
      ) : result.status !== "ok" ? (
        <Callout
          tone={result.status === "unsupported_direction" || result.status === "invalid_profile" ? "danger" : "warn"}
          title="这是部分结果"
        >
          <p>
            方案状态为「{status.label}」：缺失的资料不会被补成虚构数字。请阅读下方数据缺口与待核验项，或在补齐资料后重新生成。
          </p>
        </Callout>
      ) : null}

      <section className="explanation-panel" aria-labelledby="plan-explanation-title">
        <div className="panel-head">
          <div>
            <p className="eyebrow">AI 解释</p>
            <h2 id="plan-explanation-title">解释不改动规则与数字</h2>
          </div>
          <Badge tone="muted">LLM 只做解释</Badge>
        </div>
        {result.explanation ? (
          <div className="explanation-text">{result.explanation}</div>
        ) : (
          <EmptyState
            compact
            icon="sparkles"
            title="本次没有生成解释"
            description="解释字段为空。行动、课程与学分仍来自规则结果，不因解释缺失而改变。"
          />
        )}
        {onRegenerate ? (
          <div className="explanation-actions">
            <Button variant="ghost" size="sm" onClick={onRegenerate} disabled={regenerating}>
              <Icon name="refresh" size={13} />
              重新生成解释（会创建新方案版本）
            </Button>
            <span className="panel-note">旧版本会保留并标记 stale；新版本会成为当前方案。</span>
          </div>
        ) : null}
      </section>

      <section className="plan-actions-section" aria-labelledby="plan-actions-title">
        <div className="section-heading">
          <div className="section-heading-text">
            <p className="eyebrow">行动清单</p>
            <h2 id="plan-actions-title">按当前学期 / 下学期 / 更晚分组</h2>
            <p className="section-description">
              每项行动都分开显示「机器建议」与「我的调整」。修改时间、工时、备注或勾选完成会调用 PATCH 接口并生成新版本；拖动排序只保存在本设备。
            </p>
          </div>
          <Badge tone="muted">{orderedActions.length} 项</Badge>
        </div>

        {orderedActions.length === 0 ? (
          <EmptyState
            icon="list"
            title="本次没有返回行动项"
            description={
              result.status === "data_unavailable" || result.status === "partial"
                ? "资料或规则尚不足以生成行动，系统不会用通用模板凑数。请查看数据缺口，补齐资料后重新生成。"
                : "规则结果中没有匹配到行动项。可以查看数据缺口，或换一个方向重新生成。"
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
        <p className="panel-note">
          排序为本设备本地记录，不会同步到云端；PATCH 调整与勾选完成会同步到当前方案版本。
        </p>
      </section>

      <div className="plan-two-col">
        <section className="panel" aria-labelledby="plan-courses-title">
          <div className="panel-head">
            <div>
              <p className="eyebrow">课程</p>
              <h2 id="plan-courses-title">相关课程</h2>
            </div>
            <Badge tone="muted">{result.courses.length} 门</Badge>
          </div>
          {result.courses.length === 0 ? (
            <EmptyState
              compact
              icon="book"
              title="课程资料未就绪"
              description="尚未取得适用年级的结构化培养方案，因此不展示课程与学分推断。培养方案 PDF 不等于结构化课程表。"
            />
          ) : (
            <ul className="course-list">
              {result.courses.map((course) => (
                <li className="course-item" key={course.course_id}>
                  <div className="course-main">
                    <span className="course-title">{course.title}</span>
                    <span className="course-meta">
                      {course.credits === null ? "学分未知" : `${course.credits} 学分`}
                      {course.offered_terms.length > 0 ? ` · 开课 ${course.offered_terms.join(" / ")}` : " · 开课学期未知"}
                    </span>
                  </div>
                  <Badge tone={course.verification_status === "verified" ? "ok" : "warn"}>
                    {course.verification_status === "verified" ? "已核验" : "待核验"}
                  </Badge>
                  {course.prerequisites.length > 0 ? (
                    <p className="course-prereq">前置：{course.prerequisites.join("、")}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel" aria-labelledby="plan-competitions-title">
          <div className="panel-head">
            <div>
              <p className="eyebrow">竞赛</p>
              <h2 id="plan-competitions-title">相关竞赛</h2>
            </div>
            <Badge tone="muted">{result.competitions.length} 项</Badge>
          </div>
          {result.competitions.length === 0 ? (
            <EmptyState
              compact
              icon="flag"
              title="竞赛目录未载入"
              description="尚未取得竞赛目录或素拓认定口径，因此不推测可参加的竞赛与认定学分。"
            />
          ) : (
            <ul className="competition-list">
              {result.competitions.map((competition) => (
                <li className="competition-item" key={competition.competition_id}>
                  <span className="competition-title">{competition.title}</span>
                  <span className="competition-meta">{competition.window ? `窗口：${competition.window}` : "时间窗口未知"}</span>
                  <Badge tone={competition.verification_status === "verified" ? "ok" : "warn"}>
                    {competition.verification_status === "verified" ? "已核验" : "待核验"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel" aria-labelledby="plan-gaps-title">
        <div className="panel-head">
          <div>
            <p className="eyebrow">数据缺口</p>
            <h2 id="plan-gaps-title">哪些资料还没就绪</h2>
          </div>
          <Badge tone={result.gaps.length > 0 ? "warn" : "ok"}>{result.gaps.length} 项</Badge>
        </div>
        {result.gaps.length === 0 ? (
          <p className="panel-note">本次结果没有报告数据缺口；仍请按引用条目逐项核验。</p>
        ) : (
          <ul className="gap-card-list">
            {result.gaps.map((gap, index) => (
              <li className="gap-card" key={`${gap.code}-${index}`}>
                <Icon name="alert" size={16} />
                <div>
                  <p className="gap-card-code">
                    {gap.code}
                    {gap.module ? ` · ${gap.module}` : ""}
                  </p>
                  <p className="gap-card-message">{gap.message}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" aria-labelledby="plan-evidence-title">
        <div className="panel-head">
          <div>
            <p className="eyebrow">证据与引用</p>
            <h2 id="plan-evidence-title">每条结论都应对应来源</h2>
          </div>
          <Badge tone="muted">{evidence.length} 条</Badge>
        </div>
        <CitationList citations={evidence} />
      </section>

      {plan && plan.versions.length > 0 ? (
        <section className="panel" aria-labelledby="plan-versions-title">
          <div className="panel-head">
            <div>
              <p className="eyebrow">版本历史</p>
              <h2 id="plan-versions-title">旧版本会保留并标记 stale</h2>
            </div>
            <Badge tone="muted">{plan.versions.length} 个版本</Badge>
          </div>
          <ul className="version-list">
            {[...plan.versions]
              .sort((a, b) => b.version - a.version)
              .map((item) => (
                <li className={item.version_id === plan.current_version_id ? "version-item is-current" : "version-item"} key={item.version_id}>
                  <span className="version-no">v{item.version}</span>
                  <span className="version-status">
                    {item.version_id === plan.current_version_id ? "当前版本" : item.status === "stale" ? "stale（已过期）" : item.status}
                  </span>
                  <span className="version-meta">
                    规则 {item.rules_version || "—"} · 画像 v{item.profile_version} · {formatDate(item.created_at)}
                  </span>
                </li>
              ))}
          </ul>
          <p className="panel-note">切换方向或重新生成时，旧版本不会被删除；服务端会把旧版本标记为 stale，供你回看。</p>
        </section>
      ) : null}

      <p className="panel-note plan-disclaimer">
        <Icon name="info" size={13} />
        以上数字与行动来自服务端规则与已载入资料；AI 只解释，不改动实体和数字。资料缺失处显示「资料未就绪」，不显示 0 或猜测值。
      </p>
    </div>
  );
}
