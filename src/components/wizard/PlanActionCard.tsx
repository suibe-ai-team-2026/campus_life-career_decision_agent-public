"use client";

import { useEffect, useMemo, useState } from "react";
import type { Citation } from "@/lib/contracts/run";
import type { PlanAction } from "@/lib/contracts/plan";
import { PLAN_WINDOW_LABELS, PLAN_WINDOW_ORDER, windowLabel } from "@/lib/content";
import { Badge, Button, Icon } from "@/components/ui/primitives";

const BASIS_LABELS: Record<PlanAction["effort"]["basis"], string> = {
  official_requirement: "官方要求",
  team_estimate: "团队估计",
  user_estimate: "我的估计",
  unknown: "未估计"
};

const STATUS_LABELS: Record<PlanAction["status"], { label: string; tone: "neutral" | "warn" | "ok" | "accent" }> = {
  suggested: { label: "建议", tone: "neutral" },
  pending_verification: { label: "待核验", tone: "warn" },
  verified: { label: "已核验", tone: "ok" },
  user_modified: { label: "我已调整", tone: "accent" }
};

export type ActionOverrides = {
  title?: string;
  window?: PlanAction["window"];
  effort_hours?: number | null;
  done?: boolean;
  note?: string;
};

export function ActionCard({
  index,
  machine,
  effective,
  overrides,
  evidence,
  canMoveUp,
  canMoveDown,
  onMove,
  onSave,
  onToggleDone,
  pending,
  error
}: {
  index: number;
  machine: PlanAction;
  effective: PlanAction;
  overrides: ActionOverrides;
  evidence: Citation[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  onSave: (overrides: ActionOverrides) => void;
  onToggleDone: (done: boolean) => void;
  pending: boolean;
  error?: string;
}) {
  const hasOverrides = Object.keys(overrides).length > 0;
  const effectiveHours = overrides.effort_hours !== undefined ? overrides.effort_hours : effective.effort.hours;
  const effectiveWindow = overrides.window ?? effective.window;
  const done = overrides.done === true;
  const effectiveTitle = typeof overrides.title === "string" ? overrides.title : effective.title;

  const [windowDraft, setWindowDraft] = useState<PlanAction["window"]>(effectiveWindow);
  const [hoursDraft, setHoursDraft] = useState(effectiveHours === null ? "" : String(effectiveHours));
  const [noteDraft, setNoteDraft] = useState(typeof overrides.note === "string" ? overrides.note : "");
  const [validationError, setValidationError] = useState<string | null>(null);

  // Reset drafts whenever the authoritative version changes (e.g. after PATCH).
  useEffect(() => {
    setWindowDraft(effectiveWindow);
    setHoursDraft(effectiveHours === null ? "" : String(effectiveHours));
    setNoteDraft(typeof overrides.note === "string" ? overrides.note : "");
    setValidationError(null);
  }, [effectiveWindow, effectiveHours, overrides.note]);

  const dirty =
    windowDraft !== effectiveWindow ||
    (hoursDraft === "" ? effectiveHours !== null : Number(hoursDraft) !== effectiveHours) ||
    noteDraft !== (typeof overrides.note === "string" ? overrides.note : "");

  const matchedEvidence = useMemo(() => {
    const ids = new Set(effective.evidence_ids);
    return evidence.filter(
      (citation) =>
        ids.has(String(citation.citation_no)) ||
        ids.has(citation.source_id) ||
        ids.has(citation.chunk_id) ||
        (citation.record_id ? ids.has(citation.record_id) : false)
    );
  }, [effective.evidence_ids, evidence]);

  const status = STATUS_LABELS[effective.status] ?? STATUS_LABELS.suggested;
  const baselineLine = `${windowLabel(machine.window)} · ${
    machine.effort.hours === null ? "工时未估计" : `约 ${machine.effort.hours} 小时`
  }（${BASIS_LABELS[machine.effort.basis]}）`;

  function handleSave() {
    setValidationError(null);
    let hours: number | null = null;
    if (hoursDraft.trim() !== "") {
      const parsed = Number(hoursDraft);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 2000) {
        setValidationError("预计工时请填 0–2000 之间的数字，或留空表示未知");
        return;
      }
      hours = parsed;
    }
    onSave({
      window: windowDraft,
      effort_hours: hours,
      note: noteDraft.trim().slice(0, 500),
      ...(overrides.done !== undefined ? { done: overrides.done } : {})
    });
  }

  return (
    <article className={pending ? "action-card is-pending" : "action-card"}>
      <header className="action-card-head">
        <div className="action-order" aria-hidden="true">
          <span className="action-index">{String(index + 1).padStart(2, "0")}</span>
          <div className="action-move">
            <button
              type="button"
              className="icon-button"
              onClick={() => onMove(-1)}
              disabled={!canMoveUp || pending}
              aria-label="上移这项行动（仅本设备排序）"
              title="上移（本地排序）"
            >
              <Icon name="chevron-down" size={13} className="rotate-180" />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => onMove(1)}
              disabled={!canMoveDown || pending}
              aria-label="下移这项行动（仅本设备排序）"
              title="下移（本地排序）"
            >
              <Icon name="chevron-down" size={13} />
            </button>
          </div>
        </div>
        <div className="action-title-block">
          <h4 className="action-title">{effectiveTitle}</h4>
          <p className="action-machine">
            <span className="action-machine-tag">机器建议</span>
            {baselineLine}
            {machine.rule_id ? ` · 规则 ${machine.rule_id}` : ""}
            {machine.status === "pending_verification" ? " · 待核验" : ""}
          </p>
        </div>
        <div className="action-badges">
          <Badge tone="muted">{windowLabel(effectiveWindow)}</Badge>
          <Badge tone={status.tone}>{status.label}</Badge>
          {done ? <Badge tone="ok">已完成</Badge> : null}
        </div>
      </header>

      {effective.prerequisites.length > 0 ? (
        <div className="action-prereq">
          <span className="action-section-label">前置条件</span>
          <ul>
            {effective.prerequisites.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasOverrides ? (
        <div className="action-overrides">
          <span className="action-section-label">我的调整</span>
          <ul>
            {overrides.window ? <li>时间窗改为 {windowLabel(overrides.window)}</li> : null}
            {overrides.effort_hours !== undefined ? (
              <li>工时改为 {overrides.effort_hours === null ? "未知" : `${overrides.effort_hours} 小时`}</li>
            ) : null}
            {typeof overrides.note === "string" && overrides.note ? <li>备注：{overrides.note}</li> : null}
            {overrides.done !== undefined ? <li>{overrides.done ? "我的清单：已完成" : "我的清单：未完成"}</li> : null}
          </ul>
        </div>
      ) : null}

      {matchedEvidence.length > 0 ? (
        <div className="action-evidence">
          <span className="action-section-label">证据引用</span>
          <div className="chip-row">
            {matchedEvidence.map((citation) => (
              <span className="chip chip-ghost" key={`${citation.citation_no}-${citation.chunk_id}`}>
                [{citation.citation_no}] {citation.title}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="action-edit">
        <div className="action-edit-field">
          <label className="action-edit-label" htmlFor={`action-window-${effective.action_id}`}>
            时间窗
          </label>
          <select
            id={`action-window-${effective.action_id}`}
            className="select select-sm"
            value={windowDraft}
            onChange={(event) => setWindowDraft(event.target.value as PlanAction["window"])}
            disabled={pending}
          >
            {PLAN_WINDOW_ORDER.map((window) => (
              <option value={window} key={window}>
                {PLAN_WINDOW_LABELS[window]}
              </option>
            ))}
          </select>
        </div>
        <div className="action-edit-field">
          <label className="action-edit-label" htmlFor={`action-hours-${effective.action_id}`}>
            预计工时
          </label>
          <div className="input-suffix-wrap">
            <input
              id={`action-hours-${effective.action_id}`}
              className="input input-sm"
              type="number"
              inputMode="decimal"
              min={0}
              step={0.5}
              placeholder="未知"
              value={hoursDraft}
              onChange={(event) => setHoursDraft(event.target.value)}
              disabled={pending}
            />
            <span className="input-suffix">小时</span>
          </div>
        </div>
        <div className="action-edit-field action-edit-note">
          <label className="action-edit-label" htmlFor={`action-note-${effective.action_id}`}>
            备注
          </label>
          <input
            id={`action-note-${effective.action_id}`}
            className="input input-sm"
            type="text"
            maxLength={500}
            placeholder="写一句给自己的提醒（可选）"
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            disabled={pending}
          />
        </div>
      </div>

      {validationError ? (
        <p className="field-error" role="alert">
          {validationError}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}

      <footer className="action-card-foot">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={done}
            onChange={(event) => onToggleDone(event.target.checked)}
            disabled={pending}
          />
          <span>标记完成（只影响我的清单，不修改机器字段与依据）</span>
        </label>
        <div className="action-card-actions">
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setWindowDraft(effectiveWindow);
              setHoursDraft(effectiveHours === null ? "" : String(effectiveHours));
              setNoteDraft(typeof overrides.note === "string" ? overrides.note : "");
              setValidationError(null);
            }}
            disabled={!dirty || pending}
          >
            重置
          </button>
          <Button variant="secondary" size="sm" onClick={handleSave} disabled={!dirty || pending}>
            {pending ? "保存中…" : "保存我的调整"}
          </Button>
        </div>
      </footer>
      {pending ? <span className="action-pending-hint">正在提交 PATCH 调整并同步版本…</span> : null}
    </article>
  );
}
