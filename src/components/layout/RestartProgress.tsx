"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { resetAllLocalProgress } from "@/lib/local-progress/store";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/primitives";

/**
 * "重新开始" clears only this app's local keys; cloud plans already generated
 * under the anonymous session are not deleted from the server.
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
        description="会清除本设备保存的进度与作答，且无法撤销；已生成的方案保留在云端。"
        confirmLabel="确认清除并重新开始"
        onConfirm={handleConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
