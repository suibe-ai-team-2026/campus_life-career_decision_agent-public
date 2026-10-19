"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  RESET_KEEPS,
  RESET_SCOPE,
  resetAllLocalProgress,
  useLocalProgress
} from "@/lib/local-progress/store";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/primitives";

/**
 * "重新开始" with an explicit reset scope and confirmation. Clears only this
 * app's local keys; cloud plans already generated under the anonymous session
 * are not deleted from the server.
 */
export function RestartProgress({
  label = "重新开始",
  variant = "ghost",
  className
}: {
  label?: string;
  variant?: "ghost" | "header";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();
  const { progress } = useLocalProgress();

  function handleConfirm() {
    resetAllLocalProgress();
    setOpen(false);
    setNotice("已重新开始：本设备的向导进度已清除");
    router.push("/");
    window.setTimeout(() => setNotice(null), 6000);
  }

  const classes = [
    variant === "header" ? "btn btn-ghost btn-sm header-reset" : "btn btn-ghost btn-sm",
    className ?? ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <button type="button" className={classes} onClick={() => setOpen(true)}>
        <Icon name="refresh" size={13} />
        {label}
      </button>
      {notice ? (
        <p className="sr-only" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}
      <ConfirmDialog
        open={open}
        title="重新开始五步向导？"
        description="这会清除下列保存在本设备的数据，且无法撤销。"
        confirmLabel="确认清除并重新开始"
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      >
        <div className="reset-scope">
          <p className="reset-scope-heading">将清除</p>
          <ul className="reset-scope-list">
            {RESET_SCOPE.map((item) => (
              <li key={item}>
                <Icon name="cross" size={13} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="reset-scope-heading">会保留</p>
          <ul className="reset-scope-list reset-scope-list-keep">
            {RESET_KEEPS.map((item) => (
              <li key={item}>
                <Icon name="check" size={13} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          {progress ? (
            <p className="reset-current">
              当前已有进度：{progress.profile.school || "未填学校"} · 收藏 {progress.favorites.length} 个方向
              {progress.provisional_direction ? " · 已暂定方向" : ""}
              {progress.exported_at ? " · 已导出过 PDF" : ""}
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
    </>
  );
}
