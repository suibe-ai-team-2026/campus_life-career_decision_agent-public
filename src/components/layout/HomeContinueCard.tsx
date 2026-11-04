"use client";

import Link from "next/link";
import { getDirection } from "@/lib/content";
import {
  isMeaningfulProgress,
  nextStepForProgress,
  progressStepDone,
  useLocalProgress
} from "@/lib/local-progress/store";
import { RestartProgress } from "./RestartProgress";

/** Home page "continue" row; hidden until meaningful local progress exists. */
export function HomeContinueCard() {
  const { progress, hydrated, resetNotice } = useLocalProgress();
  if (!hydrated || !progress || !isMeaningfulProgress(progress)) return null;

  const next = nextStepForProgress(progress);
  const direction = getDirection(progress.provisional_direction);
  const doneCount = [1, 2, 3, 4, 5].filter((index) => progressStepDone(progress, index)).length;

  return (
    <div className="continue-card">
      <div>
        <h2>
          继续：第 {next.index} 步 · {next.title}
        </h2>
        <p className="continue-sub">
          {doneCount} / 5 已完成
          {direction ? ` · ${direction.short_title}` : ""}
        </p>
        {resetNotice ? <p className="inline-note inline-note-warn">进度版本已更新，请重新开始。</p> : null}
      </div>
      <div className="continue-actions">
        <Link href={next.href} className="btn btn-primary btn-sm">
          继续
        </Link>
        <RestartProgress label="重新开始" />
      </div>
    </div>
  );
}
