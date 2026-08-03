"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { followFeedByUrl } from "./actions";

// Paste an RSS feed URL to follow it. On success the source is created (if new),
// subscribed, and ingested; we refresh so it appears in the list below.
export function AddFeedForm() {
  const [url, setUrl] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || pending) return;
    setNote(null);
    setIsError(false);
    start(async () => {
      const res = await followFeedByUrl(url);
      if (res.ok) {
        setNote(
          `Followed${res.name ? ` ${res.name}` : ""}${res.added ? ` · ${res.added} new` : ""}`
        );
        setUrl("");
        router.refresh();
      } else {
        setIsError(true);
        setNote(res.error ?? "Couldn't follow that feed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="mb-6">
      <div className="flex gap-2">
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste an RSS feed URL to follow…"
          disabled={pending}
          className="min-w-0 flex-1 rounded-full border px-4 py-2 text-sm outline-none disabled:opacity-50"
          style={{ borderColor: "var(--line)", background: "transparent", color: "var(--ink)" }}
        />
        <button
          type="submit"
          disabled={pending || !url.trim()}
          className="shrink-0 rounded-full px-4 py-2 text-[0.8rem] font-semibold text-white transition-colors disabled:opacity-50"
          style={{ background: "var(--accent)" }}
        >
          {pending ? "Following…" : "Follow"}
        </button>
      </div>
      {note && (
        <p
          className="mt-2 text-xs"
          style={{ color: isError ? "#c0392b" : "var(--muted)", fontFamily: "system-ui" }}
        >
          {note}
        </p>
      )}
    </form>
  );
}
