"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unfollowFeed } from "./actions";

// Unfollow control for a row on /following-list. Clicking opens a confirmation
// modal ("Are you sure?"); confirming calls the unfollow action and refreshes
// the server-rendered list so the row disappears.
export function UnfollowButton({
  sourceId,
  sourceName,
}: {
  sourceId: string;
  sourceName: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  // Close on Escape while the modal is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, pending]);

  function confirm() {
    start(async () => {
      await unfollowFeed(sourceId);
      setOpen(false);
      router.refresh(); // re-render the server list without the unfollowed row
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-full px-4 py-1.5 text-[0.8rem] font-semibold transition-colors"
        style={{ color: "var(--muted)", background: "rgba(0,0,0,0.05)" }}
      >
        Unfollow
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Unfollow ${sourceName}`}
          className="fixed inset-0 z-50 flex items-center justify-center p-5"
          onClick={() => !pending && setOpen(false)}
        >
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.4)" }} />
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm rounded-2xl border p-6 shadow-xl"
            style={{ background: "var(--bg)", borderColor: "var(--line)" }}
          >
            <h2 className="text-lg font-semibold" style={{ letterSpacing: "-0.011em" }}>
              Are you sure?
            </h2>
            <p className="mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
              Unfollow <span style={{ color: "var(--ink)" }}>{sourceName}</span>? It will
              stop appearing in your Following feed.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-full px-4 py-1.5 text-[0.8rem] font-semibold transition-colors disabled:opacity-50"
                style={{ color: "var(--muted)", background: "rgba(0,0,0,0.05)" }}
              >
                Cancel
              </button>
              <button
                onClick={confirm}
                disabled={pending}
                className="rounded-full px-4 py-1.5 text-[0.8rem] font-semibold text-white transition-colors disabled:opacity-50"
                style={{ background: "#c0392b" }}
              >
                {pending ? "Unfollowing…" : "Unfollow"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
