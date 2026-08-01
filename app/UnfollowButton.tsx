"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unfollowFeed } from "./actions";
import { ConfirmModal } from "./ConfirmModal";

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

      <ConfirmModal
        open={open}
        title="Are you sure?"
        confirmLabel="Unfollow"
        pendingLabel="Unfollowing…"
        ariaLabel={`Unfollow ${sourceName}`}
        pending={pending}
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      >
        Unfollow <span style={{ color: "var(--ink)" }}>{sourceName}</span>? It will stop
        appearing in your Following feed.
      </ConfirmModal>
    </>
  );
}
