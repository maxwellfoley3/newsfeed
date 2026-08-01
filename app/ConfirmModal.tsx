"use client";

import { useEffect, type ReactNode } from "react";

// A small centered confirmation dialog. Dismisses on Cancel, backdrop click, or
// Escape (all disabled while `pending`). The confirm button is styled as a
// destructive action by default.
export function ConfirmModal({
  open,
  title,
  children,
  confirmLabel,
  pendingLabel,
  onConfirm,
  onCancel,
  pending = false,
  ariaLabel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
  ariaLabel?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, pending, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? title}
      className="fixed inset-0 z-50 flex items-center justify-center p-5"
      onClick={() => !pending && onCancel()}
    >
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.4)" }} />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm rounded-2xl border p-6 shadow-xl"
        style={{ background: "var(--bg)", borderColor: "var(--line)" }}
      >
        <h2 className="text-lg font-semibold" style={{ letterSpacing: "-0.011em" }}>
          {title}
        </h2>
        <p className="mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
          {children}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={pending}
            className="rounded-full px-4 py-1.5 text-[0.8rem] font-semibold transition-colors disabled:opacity-50"
            style={{ color: "var(--muted)", background: "rgba(0,0,0,0.05)" }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="rounded-full px-4 py-1.5 text-[0.8rem] font-semibold text-white transition-colors disabled:opacity-50"
            style={{ background: "#c0392b" }}
          >
            {pending ? pendingLabel ?? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
