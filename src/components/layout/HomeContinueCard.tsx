"use client";

import Link from "next/link";
import { getDirection, WIZARD_STEPS } from "@/lib/content";
import {
  isMeaningfulProgress,
  nextStepForProgress,
  progressStepDone,
  useLocalProgress
} from "@/lib/local-progress/store";
import { Badge, Icon, formatDateTime } from "@/components/ui/primitives";
import { RestartProgress } from "./RestartProgress";

/** Home page "继续我的方案" card; hidden until local progress exists. */
export function HomeContinueCard() {
  const { progress, hydrated, resetNotice } = useLocalProgress();
  if (!hydrated || !progress || !isMeaningfulProgress(progress)) return null;

  const next = nextStepForProgress(progress);
  const direction = getDirection(progress.provisional_direction);
  const doneCount = WIZARD_STEPS.filter((step) => progressStepDone(progress, step.index)).length;
  const profileStatus = progress.profile.completed_at
    ? progress.profile.skipped
      ? "已跳过轻测"
      : "已完成轻测"
    : "进行中";

  return (
    <section className="continue-card" aria-labelledby="continue-title">
      <div className="continue-card-head">
        <div>
          <p className="eyebrow">继续上次的进度</p>
          <h2 id="continue-title">
            继续我的方案 <span className="continue-step">第 {next.index} 步 · {next.title}</span>
          </h2>
          <p className="continue-sub">
            本设备已保存 {doneCount} / 5 步进度，最近保存于 {formatDateTime(progress.updated_at)}
          </p>
        </div>
        <Badge tone="accent">{doneCount} / 5 已完成</Badge>
      </div>

      {resetNotice ? (
        <p className="inline-note inline-note-warn">
          检测到旧版本或损坏的本地进度，已重置为空进度，请重新开始。
        </p>
      ) : null}

      <div className="continue-grid">
        <div className="continue-cell">
          <span className="continue-cell-label">学校 / 专业</span>
          <span className="continue-cell-value">
            {progress.profile.school || "未填写"}
            {progress.profile.major ? ` · ${progress.profile.major}` : ""}
          </span>
        </div>
        <div className="continue-cell">
          <span className="continue-cell-label">自我探索</span>
          <span className="continue-cell-value">{profileStatus}</span>
        </div>
        <div className="continue-cell">
          <span className="continue-cell-label">方向收藏</span>
          <span className="continue-cell-value">{progress.favorites.length} / 3 个</span>
        </div>
        <div className="continue-cell">
          <span className="continue-cell-label">暂定方向</span>
          <span className="continue-cell-value">{direction ? direction.short_title : "未选择"}</span>
        </div>
        <div className="continue-cell">
          <span className="continue-cell-label">行动方案</span>
          <span className="continue-cell-value">{progress.plan_id ? "已生成方案" : "待生成"}</span>
        </div>
        <div className="continue-cell">
          <span className="continue-cell-label">导出</span>
          <span className="continue-cell-value">{progress.exported_at ? "已导出 PDF" : "未导出"}</span>
        </div>
      </div>

      <div className="continue-actions">
        <Link href={next.href} className="btn btn-primary btn-lg">
          <Icon name="arrow-right" size={16} />
          继续我的方案
        </Link>
        <Link href="/library" className="btn btn-secondary btn-lg">
          <Icon name="book" size={16} />
          直接查资料
        </Link>
        <RestartProgress label="重新开始" />
      </div>
    </section>
  );
}
