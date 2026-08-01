"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unfollowFeed, followSource } from "./actions";
import { ConfirmModal } from "./ConfirmModal";

// Follow/unfollow toggle for a source page, sitting next to the Pin button.
// When following, it reads "Following" and turns into a red "Unfollow" on hover;
// clicking asks for confirmation before unfollowing. When not following, it's a
// plain "Follow" button that re-subscribes (no confirmation needed).
export function SourceFollowButton({
  sourceId,
  sourceName,
  following: initialFollowing,
}: {
  sourceId: string;
  sourceName: string;
  following: boolean;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function confirmUnfollow() {
    start(async () => {
      await unfollowFeed(sourceId);
      setFollowing(false);
      setConfirming(false);
      router.refresh();
    });
  }

  function follow() {
    setFollowing(true); // optimistic
    start(async () => {
      await followSource(sourceId);
      router.refresh();
    });
  }

  if (!following) {
    return (
      <button
        onClick={follow}
        disabled={pending}
        aria-pressed={false}
        className="shrink-0 rounded-full px-4 py-1.5 text-[0.8rem] font-semibold text-white transition-colors disabled:opacity-50"
        style={{ background: "var(--accent)" }}
      >
        Follow
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        disabled={pending}
        aria-pressed
        aria-label={`Following ${sourceName} — click to unfollow`}
        className="group shrink-0 rounded-full px-4 py-1.5 text-[0.8rem] font-semibold transition-colors bg-black/5 text-[var(--muted)] hover:bg-[#c0392b] hover:text-white disabled:opacity-50"
      >
        <span className="group-hover:hidden">Following</span>
        <span className="hidden group-hover:inline">Unfollow</span>
      </button>

      <ConfirmModal
        open={confirming}
        title="Are you sure?"
        confirmLabel="Unfollow"
        pendingLabel="Unfollowing…"
        ariaLabel={`Unfollow ${sourceName}`}
        pending={pending}
        onConfirm={confirmUnfollow}
        onCancel={() => setConfirming(false)}
      >
        Unfollow <span style={{ color: "var(--ink)" }}>{sourceName}</span>? It will stop
        appearing in your Following feed.
      </ConfirmModal>
    </>
  );
}
