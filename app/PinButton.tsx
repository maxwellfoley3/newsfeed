"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { togglePin } from "./actions";

// Pin/unpin toggle for a source page. Optimistic: flips immediately, then calls
// the action and refreshes so the Following page's "Pinned" section updates.
export function PinButton({
  sourceId,
  pinned: initialPinned,
}: {
  sourceId: string;
  pinned: boolean;
}) {
  const [pinned, setPinned] = useState(initialPinned);
  const [saving, start] = useTransition();
  const router = useRouter();

  function toggle() {
    const next = !pinned;
    setPinned(next); // optimistic
    start(async () => {
      await togglePin(sourceId, next);
      router.refresh();
    });
  }

  return (
    <button
      onClick={toggle}
      disabled={saving}
      aria-pressed={pinned}
      className="shrink-0 rounded-full px-4 py-1.5 text-[0.8rem] font-semibold transition-colors disabled:opacity-50"
      style={
        pinned
          ? { color: "#ffffff", background: "var(--accent)" }
          : { color: "var(--muted)", background: "rgba(0,0,0,0.05)" }
      }
    >
      {pinned ? "📌 Pinned" : "📌 Pin"}
    </button>
  );
}
