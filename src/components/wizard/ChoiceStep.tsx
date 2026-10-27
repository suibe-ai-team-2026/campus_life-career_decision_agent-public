"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { DirectionId } from "@/lib/contracts/common";
import { ASSESSMENT, DIRECTIONS, getDirection } from "@/lib/content";
import { scoreAssessment } from "@/lib/assessment/scoring";
import { recommendDirections } from "@/lib/career/recommend";
import {
  readChoiceDetail,
  readLocalProgress,
  updateLocalProgress,
  useChoiceHistory,
  useLocalProgress,
  pushStaleChoiceHistory,
  writeChoiceDetail
} from "@/lib/local-progress/store";
import { Badge, Button, Callout, Icon, formatDate, daysUntil } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StepHeader } from "./StepHeader";

/** Fixed time zone so SSR and hydration agree on "today". */
function dateValue(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function defaultRevisitDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 28);
  return dateValue(date);
}

function todayValue(): string {
  return dateValue(new Date());
}

export function ChoiceStep() {
  const router = useRouter();
  const { progress, hydrated } = useLocalProgress();
  const history = useChoiceHistory();
  const [initialized, setInitialized] = useState(false);
  const [selected, setSelected] = useState<DirectionId | null>(null);
  const [why, setWhy] = useState("");
  const [unknowns, setUnknowns] = useState("");
  const [revisitOn, setRevisitOn] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [switchTarget, setSwitchTarget] = useState<DirectionId | null>(null);
  const [backup, setBackup] = useState<DirectionId | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated || initialized) return;
    const stored = readLocalProgress();
    const detail = readChoiceDetail();
    const storedMain = stored?.provisional_direction ?? null;
    setSelected(storedMain);
    setBackup(
      stored?.backup_direction && stored.backup_direction !== storedMain
        ? stored.backup_direction
        : null
    );
    setWhy(stored?.reason_summary ?? detail.why ?? "");
    setUnknowns(detail.unknowns ?? "");
    setRevisitOn(stored?.revisit_on ?? defaultRevisitDate());
    setInitialized(true);
  }, [hydrated, initialized]);

  const favorites = useMemo(() => (progress?.favorites ?? []) as DirectionId[], [progress?.favorites]);
  const favoriteDirections = useMemo(
    () => DIRECTIONS.filter((direction) => favorites.includes(direction.direction_id)),
    [favorites]
  );
  const selectableDirections = favoriteDirections.length > 0 ? favoriteDirections : DIRECTIONS;
  const backupOptions = useMemo(() => {
    const items = favoriteDirections.filter((direction) => direction.direction_id !== selected);
    if (backup && backup !== selected) {
      const current = getDirection(backup);
      if (current && !items.some((direction) => direction.direction_id === backup)) {
        items.push(current);
      }
    }
    return items;
  }, [favoriteDirections, selected, backup]);
  const answers = progress?.profile.answers;
  const localRecommendations = useMemo(() => {
    if (!answers) return null;
    const result = scoreAssessment(ASSESSMENT, answers);
    if (!result.hasSignals) return null;
    return recommendDirections(result);
  }, [answers]);
  const selectedRecommendation = useMemo(
    () =>
      selected && localRecommendations
        ? (localRecommendations.recommendations.find(
            (recommendation) => recommendation.directionId === selected
          ) ?? null)
        : null,
    [selected, localRecommendations]
  );
  const existingDirection = progress?.provisional_direction ?? null;
  const existingDirectionInfo = getDirection(existingDirection);
  const selectedDirection = getDirection(selected);
  const backupDirection = getDirection(backup);

  function saveDraft(nextSelected: DirectionId | null, nextWhy: string, nextUnknowns: string, nextRevisit: string) {
    writeChoiceDetail({ why: nextWhy.slice(0, 1000), unknowns: nextUnknowns.slice(0, 1000) });
    if (nextSelected) {
      updateLocalProgress((draft) => {
        draft.provisional_direction = nextSelected;
        draft.reason_summary = nextWhy.slice(0, 1000);
        draft.revisit_on = nextRevisit || null;
        return draft;
      });
    } else {
      updateLocalProgress((draft) => {
        draft.reason_summary = nextWhy.slice(0, 1000);
        draft.revisit_on = nextRevisit || null;
        return draft;
      });
    }
    setSavedNote("草稿已保存到本设备");
    window.setTimeout(() => setSavedNote(null), 2200);
  }

  /** 备选方向可选；主方向改变时自动清掉冲突的备选，保证两者不同。 */
  function handleBackupChange(next: DirectionId | null) {
    const value = next && next !== selected ? next : null;
    setBackup(value);
    updateLocalProgress((draft) => {
      draft.backup_direction = value;
      return draft;
    });
  }

  function clearBackupIfConflicts(nextMain: DirectionId | null) {
    if (nextMain && backup === nextMain) handleBackupChange(null);
  }

  function handleSelect(directionId: DirectionId) {
    if (directionId === selected) return;
    if (existingDirection && existingDirection !== directionId) {
      // 先弹确认框；用户取消时不能动已有的备选方向。
      setSwitchTarget(directionId);
      return;
    }
    setSelected(directionId);
    clearBackupIfConflicts(directionId);
    saveDraft(directionId, why, unknowns, revisitOn);
  }

  function confirmSwitch() {
    if (!switchTarget) return;
    clearBackupIfConflicts(switchTarget);
    const previous = readLocalProgress();
    if (previous?.provisional_direction && previous.provisional_direction !== switchTarget) {
      pushStaleChoiceHistory({
        direction_id: previous.provisional_direction,
        why: previous.reason_summary,
        unknowns: readChoiceDetail().unknowns,
        revisit_on: previous.revisit_on,
        plan_id: previous.plan_id,
        plan_version_id: previous.plan_version_id
      });
      updateLocalProgress((draft) => {
        draft.provisional_direction = switchTarget;
        draft.plan_id = null;
        draft.plan_version_id = null;
        draft.exported_at = null;
        return draft;
      });
    }
    setSelected(switchTarget);
    saveDraft(switchTarget, why, unknowns, revisitOn);
    setSwitchTarget(null);
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!selected) next.direction = "请选择一个暂定方向";
    if (why.trim().length < 5) next.why = "请写至少 5 个字：为什么考虑这个方向";
    if (!revisitOn) next.revisit = "请选择下次复核时间";
    else if (revisitOn < todayValue()) next.revisit = "复核时间需要在今天之后（或今天）";
    return next;
  }

  function handleContinue() {
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    if (!selected) return;
    const previous = readLocalProgress();
    if (previous?.provisional_direction && previous.provisional_direction !== selected) {
      pushStaleChoiceHistory({
        direction_id: previous.provisional_direction,
        why: previous.reason_summary,
        unknowns: readChoiceDetail().unknowns,
        revisit_on: previous.revisit_on,
        plan_id: previous.plan_id,
        plan_version_id: previous.plan_version_id
      });
    }
    const switched = Boolean(previous?.provisional_direction && previous.provisional_direction !== selected);
    updateLocalProgress((draft) => {
      draft.provisional_direction = selected;
      draft.backup_direction = backup && backup !== selected ? backup : null;
      draft.reason_summary = why.trim().slice(0, 1000);
      draft.revisit_on = revisitOn;
      if (switched) {
        draft.plan_id = null;
        draft.plan_version_id = null;
        draft.exported_at = null;
      }
      return draft;
    });
    writeChoiceDetail({ why: why.trim(), unknowns: unknowns.trim() });
    router.push("/plan");
  }

  const revisitDays = revisitOn ? daysUntil(revisitOn) : null;

  return (
    <div className="step-page">
      <StepHeader
        index={3}
        title="暂定一个方向，而不是一次定死"
        description={
          <>
            从收藏中选 1 个<strong>主方向</strong>，必要时再留 1 个<strong>备选方向</strong>；写清为什么考虑、还有哪些未知、下次什么时候复核。你可以随时回来修改；切换时旧方案会标记 stale 并保留历史版本提示。
          </>
        }
        actions={
          <>
            <Button variant="ghost" size="md" onClick={() => router.push("/plan")}>
              跳过这一步
            </Button>
            <Button variant="primary" size="md" onClick={handleContinue}>
              保存暂定，进入行动方案
              <Icon name="arrow-right" size={15} />
            </Button>
          </>
        }
        meta={
          <span className="step-meta-row">
            <span className="step-meta-item">
              <Icon name="heart" size={13} /> 收藏 {favorites.length} 个
            </span>
            <span className="step-meta-item">
              <Icon name="flag" size={13} />
              {existingDirectionInfo ? `主方向：${existingDirectionInfo.short_title}` : "尚未暂定主方向"}
            </span>
            <span className="step-meta-item">
              <Icon name="list" size={13} />
              {backupDirection ? `备选：${backupDirection.short_title}` : "备选：未设置"}
            </span>
            {savedNote ? (
              <span className="step-meta-item step-meta-saved">
                <Icon name="check" size={13} /> {savedNote}
              </span>
            ) : null}
          </span>
        }
      />

      <Callout tone="plain" icon="compass" title="暂定 ≠ 承诺">
        <p>
          这是一次「当前较合理的选择」，不是职业判决。方向可以随证据、课程体验与实习反馈调整；本产品不会因为你暂定了某个方向就认定你适合它。
        </p>
      </Callout>

      {existingDirection && selected && existingDirection !== selected ? (
        <Callout tone="warn" title="你正在切换暂定方向">
          <p>
            保存后，原方向「{existingDirectionInfo?.title}」会被标记为 <Badge tone="muted">stale</Badge>
            ，原方案（如果已生成）在本设备不再作为当前方案；历史版本提示会保留在下方。
          </p>
        </Callout>
      ) : null}

      <div className="choice-grid">
        <section className="panel choice-select-panel" aria-labelledby="choice-select-title">
          <div className="panel-head">
            <div>
              <p className="eyebrow">第 1 件事</p>
              <h2 id="choice-select-title">你要暂定哪个方向？</h2>
            </div>
            {favorites.length === 0 ? <Badge tone="warn">还没有收藏方向</Badge> : null}
          </div>
          {favorites.length === 0 ? (
            <p className="panel-note">
              你还没有收藏方向，因此这里展示全部六个方向。更好的做法是先回
              <Link href="/directions" className="link-inline"> 方向认知 </Link>
              收藏 2–3 个再比较；直接选择也可以继续。
            </p>
          ) : null}
          <div className="choice-options" role="radiogroup" aria-label="暂定方向">
            {selectableDirections.map((direction) => {
              const checked = selected === direction.direction_id;
              return (
                <label className={checked ? "choice-option is-selected" : "choice-option"} key={direction.direction_id}>
                  <input
                    type="radio"
                    name="provisional-direction"
                    value={direction.direction_id}
                    checked={checked}
                    onChange={() => handleSelect(direction.direction_id)}
                  />
                  <span className="choice-option-main">
                    <span className="choice-option-title">{direction.title}</span>
                    <span className="choice-option-desc">{direction.summary}</span>
                  </span>
                  <span className={checked ? "choice-option-mark is-on" : "choice-option-mark"} aria-hidden="true">
                    {checked ? <Icon name="check" size={13} /> : null}
                  </span>
                </label>
              );
            })}
          </div>
          {errors.direction ? (
            <p className="field-error" role="alert">
              {errors.direction}
            </p>
          ) : null}

          {selected && selectedRecommendation ? (
            <div className="choice-recommend-basis">
              <p className="panel-title">
                <Icon name="sparkles" size={15} /> 系统给出的推荐依据
              </p>
              <p className="panel-note">
                来自本地程序规则（{localRecommendations?.rulesVersion}），不是匹配打分；只解释相符之处与待补足，不替你决定。
              </p>
              <div className="direction-block">
                <p className="direction-label">相符之处</p>
                <ul className="recommend-reasons">
                  {selectedRecommendation.reasons.slice(0, 2).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
              {selectedRecommendation.gaps.length > 0 ? (
                <div className="direction-block">
                  <p className="direction-label">
                    <Icon name="alert" size={13} /> 待补足
                  </p>
                  <ul className="gap-list">
                    {selectedRecommendation.gaps.slice(0, 1).map((gap) => (
                      <li key={gap}>{gap}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="panel choice-form-panel" aria-labelledby="choice-form-title">
          <div className="panel-head">
            <div>
              <p className="eyebrow">第 2 件事</p>
              <h2 id="choice-form-title">把理由、未知与复核时间写下来</h2>
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="choice-why">
              为什么考虑这个方向？<span className="field-required" aria-hidden="true"> *</span>
            </label>
            <textarea
              id="choice-why"
              className={errors.why ? "textarea input-error" : "textarea"}
              rows={4}
              maxLength={1000}
              value={why}
              placeholder="例如：我喜欢和海外客户打交道，也愿意先做单证与跟单；但我还没接触过真实的跨境平台运营。"
              onChange={(event) => {
                setWhy(event.target.value);
                setErrors((current) => {
                  const next = { ...current };
                  delete next.why;
                  return next;
                });
                saveDraft(selected, event.target.value, unknowns, revisitOn);
              }}
              aria-invalid={Boolean(errors.why)}
              aria-describedby="choice-why-hint"
            />
            <p className="field-hint" id="choice-why-hint">
              {why.length} / 1000 字。这是写给你自己看的依据，不会作为「适合度」评分。
            </p>
            {errors.why ? (
              <p className="field-error" role="alert">
                {errors.why}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label className="field-label" htmlFor="choice-unknowns">
              还有哪些未知？
            </label>
            <textarea
              id="choice-unknowns"
              className="textarea"
              rows={4}
              maxLength={1000}
              value={unknowns}
              placeholder="例如：不清楚本校培养方案里相关课程安排；不知道实习要求；还没有核验招聘要求。"
              onChange={(event) => {
                setUnknowns(event.target.value);
                saveDraft(selected, why, event.target.value, revisitOn);
              }}
            />
            <p className="field-hint">
              不确定是正常的：把未知写下来，下一步的方案会为它们留出核对任务；未载入的资料不会被编造。
            </p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="choice-revisit">
              下次复核时间<span className="field-required" aria-hidden="true"> *</span>
            </label>
            <input
              id="choice-revisit"
              className={errors.revisit ? "input input-error" : "input"}
              type="date"
              min={todayValue()}
              value={revisitOn}
              onChange={(event) => {
                setRevisitOn(event.target.value);
                setErrors((current) => {
                  const next = { ...current };
                  delete next.revisit;
                  return next;
                });
                saveDraft(selected, why, unknowns, event.target.value);
              }}
              aria-invalid={Boolean(errors.revisit)}
            />
            <p className="field-hint">
              {revisitDays !== null && revisitDays >= 0
                ? `还有 ${revisitDays} 天复核；到时建议重新看一眼方向卡与方案里的待核验项。`
                : "建议在一个月内复核一次；方向变化时随时可以回来修改。"}
            </p>
            {errors.revisit ? (
              <p className="field-error" role="alert">
                {errors.revisit}
              </p>
            ) : null}
          </div>

          <div className="choice-preview">
            <p className="panel-title">
              <Icon name="flag" size={15} /> 这次暂定会记录为
            </p>
            <ul className="kv-list">
              <li>
                <span>主方向</span>
                <strong>{selectedDirection ? selectedDirection.title : "尚未选择"}</strong>
              </li>
              <li>
                <span>备选方向</span>
                <strong>{backupDirection ? backupDirection.title : "暂不设备选"}</strong>
              </li>
              <li>
                <span>复核时间</span>
                <strong>{revisitOn ? formatDate(revisitOn) : "未设置"}</strong>
              </li>
              <li>
                <span>状态</span>
                <strong>{existingDirection === selected && selected ? "保持当前暂定" : "新的暂定"}</strong>
              </li>
            </ul>
            <p className="panel-note">保存后进入第 4 步；在那里可以生成可调整的行动方案。</p>
          </div>

          <div className="choice-actions">
            <Button variant="primary" size="lg" onClick={handleContinue}>
              保存暂定，进入行动方案
              <Icon name="arrow-right" size={16} />
            </Button>
            <Button variant="ghost" size="lg" onClick={() => router.push("/plan")}>
              先跳过
            </Button>
          </div>
        </section>
      </div>

      <section className="panel choice-backup-panel" aria-labelledby="choice-backup-title">
        <div className="panel-head">
          <div>
            <p className="eyebrow">第 3 件事（可选）</p>
            <h2 id="choice-backup-title">要不要再留一个备选方向？</h2>
            <p className="panel-subtitle">
              备选方向必须和主方向不同；它不会自动生成方案，只作为下次复核时的比较对象。你可以随时清除。
            </p>
          </div>
          <Badge tone={backupDirection ? "accent" : "muted"}>
            {backupDirection ? "已设置备选" : "暂不设备选"}
          </Badge>
        </div>
        {favorites.length === 0 ? (
          <p className="panel-note">
            还没有收藏方向，暂时无法设置备选。可以先回
            <Link href="/directions" className="link-inline"> 方向认知 </Link>
            收藏 2 个以上方向，再回来设置主方向与备选。
          </p>
        ) : (
          <>
            <div className="choice-options" role="radiogroup" aria-label="备选方向（可选）">
              <label className={backup === null ? "choice-option is-selected" : "choice-option"}>
                <input
                  type="radio"
                  name="backup-direction"
                  value=""
                  checked={backup === null}
                  onChange={() => handleBackupChange(null)}
                />
                <span className="choice-option-main">
                  <span className="choice-option-title">暂不设备选</span>
                  <span className="choice-option-desc">只保留一个暂定主方向，等下次复核时再比较。</span>
                </span>
                <span className={backup === null ? "choice-option-mark is-on" : "choice-option-mark"} aria-hidden="true">
                  {backup === null ? <Icon name="check" size={13} /> : null}
                </span>
              </label>
              {backupOptions.map((direction) => {
                const checked = backup === direction.direction_id;
                return (
                  <label className={checked ? "choice-option is-selected" : "choice-option"} key={direction.direction_id}>
                    <input
                      type="radio"
                      name="backup-direction"
                      value={direction.direction_id}
                      checked={checked}
                      onChange={() => handleBackupChange(direction.direction_id)}
                    />
                    <span className="choice-option-main">
                      <span className="choice-option-title">{direction.title}</span>
                      <span className="choice-option-desc">{direction.summary}</span>
                    </span>
                    <span className={checked ? "choice-option-mark is-on" : "choice-option-mark"} aria-hidden="true">
                      {checked ? <Icon name="check" size={13} /> : null}
                    </span>
                  </label>
                );
              })}
            </div>
            {selected ? null : (
              <p className="panel-note">先在上方选择主方向后，备选选项会自动排除主方向。</p>
            )}
            {backup && !favorites.includes(backup) ? (
              <p className="panel-note">
                当前备选方向已不在收藏中；可以改选其他方向，或点「暂不设备选」清除。
              </p>
            ) : null}
            <p className="panel-note">
              主方向与备选方向都只保存在本设备；方案仍以主方向为准，备选方向用于下次复核时提醒你比较。
            </p>
          </>
        )}
      </section>

      <section className="panel history-panel" aria-labelledby="choice-history-title">
        <div className="panel-head">
          <div>
            <p className="eyebrow">历史版本提示</p>
            <h2 id="choice-history-title">切换过的暂定方向会保留记录</h2>
          </div>
          <Badge tone="muted">{history.length} 条</Badge>
        </div>
        {history.length === 0 ? (
          <p className="panel-note">还没有切换记录。第一次暂定后，如果你改了方向，旧方向会在这里显示为 stale。</p>
        ) : (
          <ul className="history-list">
            {history
              .slice()
              .reverse()
              .map((entry) => {
                const direction = getDirection(entry.direction_id);
                return (
                  <li className="history-item" key={`${entry.direction_id}-${entry.created_at}`}>
                    <div className="history-head">
                      <span className="history-direction">{direction?.title ?? entry.direction_id}</span>
                      <Badge tone={entry.stale_at ? "muted" : "accent"}>{entry.stale_at ? "stale" : "当前"}</Badge>
                      <span className="history-date">{formatDate(entry.created_at)}</span>
                    </div>
                    {entry.why ? <p className="history-why">{entry.why}</p> : null}
                    {entry.unknowns ? <p className="history-unknowns">未知：{entry.unknowns}</p> : null}
                    <p className="history-meta">
                      复核时间：{entry.revisit_on ? formatDate(entry.revisit_on) : "未设置"}
                      {entry.plan_id ? ` · 旧方案引用：${entry.plan_id.slice(0, 8)}…（本设备不再作为当前方案）` : " · 未生成方案"}
                    </p>
                  </li>
                );
              })}
          </ul>
        )}
        <p className="panel-note">
          标记 stale 不代表记录被删除：它只表示这个版本已被新的暂定方向取代。云端方案版本由服务端保留，旧版本不会再被当作当前方案。
        </p>
      </section>

      <div className="step-footer-bar">
        <div className="step-footer-note">
          <Icon name="info" size={14} />
          <span>随时可以修改暂定方向；修改后本设备会保留旧方向的历史提示。</span>
        </div>
        <div className="step-footer-actions">
          <Button variant="ghost" size="md" onClick={() => router.push("/plan")}>
            跳过这一步
          </Button>
          <Button variant="primary" size="md" onClick={handleContinue}>
            保存暂定，进入行动方案
            <Icon name="arrow-right" size={15} />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={switchTarget !== null}
        title="切换暂定方向？"
        description="保存新方向会把旧方向标记为 stale，并保留它的理由、未知与复核时间作为历史版本提示。"
        confirmLabel="确认切换"
        tone="primary"
        onConfirm={confirmSwitch}
        onCancel={() => setSwitchTarget(null)}
      >
        {existingDirectionInfo && switchTarget ? (
          <div className="reset-scope">
            <p className="reset-scope-heading">从</p>
            <p className="reset-scope-value">{existingDirectionInfo.title}</p>
            <p className="reset-scope-heading">切换到</p>
            <p className="reset-scope-value">{getDirection(switchTarget)?.title}</p>
            <p className="panel-note">
              旧方向已生成的方案版本会保留在服务端历史中（如已生成），本设备不再将它作为当前方案；重新生成方案前需要先完成第 4 步。
            </p>
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
