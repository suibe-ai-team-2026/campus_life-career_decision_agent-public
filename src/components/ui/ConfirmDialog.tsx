"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "./primitives";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible confirmation dialog. Focus starts on "取消" (safe default), Escape
 * closes, backdrop click closes, and body scroll is locked while open.
 *
 * Focus is trapped inside the dialog while it is open; a busy dialog cannot be
 * dismissed by Escape or a backdrop click, and focus returns to the element
 * that opened it.
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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => cancelRef.current?.focus(), 30);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (busyRef.current) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus?.();
      previousFocusRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-busy={busy || undefined}
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
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-ghost btn-md"
            onClick={onCancel}
            disabled={busy}
          >
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
