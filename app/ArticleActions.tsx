"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { submitSignal } from "./actions";

const SIGNAL_MAX = 50;
const clamp = (n: number) => Math.max(-SIGNAL_MAX, Math.min(SIGNAL_MAX, n));

// Press-and-hold tuning: wait this long before auto-repeat kicks in, then
// fire this often while the button stays held.
const HOLD_DELAY_MS = 1000;
const REPEAT_MS = 50;

export function ArticleActions({
  articleId,
  signal,
}: {
  articleId: number;
  signal: number | null;
}) {
  const [count, setCount] = useState(signal ?? 0);
  const [, start] = useTransition();

  // The interval callback below closes over state, so mirror the live count in
  // a ref to avoid reading a stale value on each repeat tick.
  const countRef = useRef(count);
  countRef.current = count;

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // The client owns the counter: bump it instantly, then push the new absolute
  // value to the server. Rapid clicks are last-write-wins, so no need to block.
  // Returns false when we're already at the ±50 rail (nothing changed).
  function nudge(delta: 1 | -1): boolean {
    const next = clamp(countRef.current + delta);
    if (next === countRef.current) return false; // at the ±50 rail
    countRef.current = next;
    setCount(next);
    start(() => {
      submitSignal(articleId, next);
    });
    return true;
  }

  function stopHold() {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (repeatTimer.current) {
      clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
  }

  // Press: nudge once immediately, then after a pause begin auto-repeating
  // until the pointer is released, leaves the button, or hits the rail.
  function startHold(delta: 1 | -1) {
    stopHold();
    nudge(delta);
    holdTimer.current = setTimeout(() => {
      repeatTimer.current = setInterval(() => {
        if (!nudge(delta)) stopHold();
      }, REPEAT_MS);
    }, HOLD_DELAY_MS);
  }

  // Belt-and-suspenders: clear any pending timers if this unmounts mid-hold.
  useEffect(() => stopHold, []);

  const base =
    "text-[0.8rem] font-medium px-3 py-1 rounded-full transition-colors disabled:opacity-40 disabled:cursor-default select-none touch-none";
  const liked = count > 0;
  const disliked = count < 0;

  return (
    <div className="flex items-center gap-2">
      <button
        onPointerDown={(e) => {
          e.preventDefault();
          startHold(1);
        }}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
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
        onPointerDown={(e) => {
          e.preventDefault();
          startHold(-1);
        }}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
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
