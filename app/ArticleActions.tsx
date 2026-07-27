"use client";

import { useTransition } from "react";
import { submitSignal } from "./actions";

export function ArticleActions({
  articleId,
  signal,
}: {
  articleId: number;
  signal: number | null;
}) {
  const [pending, start] = useTransition();

  function vote(value: 1 | -1) {
    start(() => {
      submitSignal(articleId, value);
    });
  }

  const base =
    "text-[0.8rem] font-medium px-3 py-1 rounded-full transition-colors disabled:opacity-50";
  const liked = signal === 1;
  const disliked = signal === -1;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => vote(1)}
        disabled={pending}
        aria-pressed={liked}
        className={base}
        style={{
          color: liked ? "#ffffff" : "var(--muted)",
          background: liked ? "var(--accent)" : "rgba(0,0,0,0.05)",
        }}
      >
        ▲ Like
      </button>
      <button
        onClick={() => vote(-1)}
        disabled={pending}
        aria-pressed={disliked}
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
