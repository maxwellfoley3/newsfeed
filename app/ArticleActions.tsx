"use client";

import { useState, useTransition } from "react";
import { submitSignal } from "./actions";

const SIGNAL_MAX = 50;
const clamp = (n: number) => Math.max(-SIGNAL_MAX, Math.min(SIGNAL_MAX, n));

export function ArticleActions({
  articleId,
  signal,
}: {
  articleId: number;
  signal: number | null;
}) {
  const [count, setCount] = useState(signal ?? 0);
  const [, start] = useTransition();

  // The client owns the counter: bump it instantly, then push the new absolute
  // value to the server. Rapid clicks are last-write-wins, so no need to block.
  function nudge(delta: 1 | -1) {
    const next = clamp(count + delta);
    if (next === count) return; // at the ±50 rail
    setCount(next);
    start(() => {
      submitSignal(articleId, next);
    });
  }

  const base =
    "text-[0.8rem] font-medium px-3 py-1 rounded-full transition-colors disabled:opacity-40 disabled:cursor-default";
  const liked = count > 0;
  const disliked = count < 0;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => nudge(1)}
        disabled={count >= SIGNAL_MAX}
        aria-label="Like"
        className={base}
        style={{
          color: liked ? "#ffffff" : "var(--muted)",
          background: liked ? "var(--accent)" : "rgba(0,0,0,0.05)",
        }}
      >
        ▲ Like
      </button>

      <span
        aria-live="polite"
        className="min-w-[2.5ch] text-center text-[0.8rem] font-semibold tabular-nums"
        style={{
          color:
            count > 0 ? "var(--accent)" : count < 0 ? "#c0392b" : "var(--muted)",
        }}
      >
        {count > 0 ? `+${count}` : count}
      </span>

      <button
        onClick={() => nudge(-1)}
        disabled={count <= -SIGNAL_MAX}
        aria-label="Less"
        className={base}
        style={{
          color: disliked ? "#ffffff" : "var(--muted)",
          background: disliked ? "var(--accent)" : "rgba(0,0,0,0.05)",
        }}
      >
        ▼ Less
      </button>
    </div>
  );
}
