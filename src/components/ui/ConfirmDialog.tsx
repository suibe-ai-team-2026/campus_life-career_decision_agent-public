"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "./primitives";

/**
 * Accessible confirmation dialog. Focus starts on "取消" (safe default), Escape
 * closes, backdrop click closes, and body scroll is locked while open.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "取消",
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
  children
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const [previousFocus, setPreviousFocus] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setPreviousFocus(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const timer = window.setTimeout(() => cancelRef.current?.focus(), 30);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onCancel]);

  useEffect(() => {
    if (!open && previousFocus) {
      previousFocus.focus?.();
      setPreviousFocus(null);
    }
  }, [open, previousFocus]);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={description ? "confirm-dialog-description" : undefined}
      >
        <h2 className="dialog-title" id="confirm-dialog-title">
          {title}
        </h2>
        {description ? (
          <div className="dialog-description" id="confirm-dialog-description">
            {description}
          </div>
        ) : null}
        {children ? <div className="dialog-content">{children}</div> : null}
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="btn btn-ghost btn-md" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <Button variant={tone} onClick={onConfirm} disabled={busy}>
            {busy ? "处理中…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
