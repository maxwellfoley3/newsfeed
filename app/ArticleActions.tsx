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
    "text-sm px-2 py-0.5 rounded-md border transition-colors disabled:opacity-50";
  const liked = signal === 1;
  const disliked = signal === -1;

  return (
    <div className="flex items-center gap-2" style={{ fontFamily: "system-ui" }}>
      <button
        onClick={() => vote(1)}
        disabled={pending}
        aria-pressed={liked}
        className={base}
        style={{
          borderColor: liked ? "var(--accent)" : "var(--line)",
          color: liked ? "var(--accent)" : "var(--muted)",
          background: "transparent",
        }}
      >
        ▲ like
      </button>
      <button
        onClick={() => vote(-1)}
        disabled={pending}
        aria-pressed={disliked}
        className={base}
        style={{
          borderColor: disliked ? "var(--accent)" : "var(--line)",
          color: disliked ? "var(--accent)" : "var(--muted)",
          background: "transparent",
        }}
      >
        ▼ less
      </button>
    </div>
  );
}
