"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DiscoverFeed } from "@/lib/db";
import { FollowButton } from "./FollowButton";
import { loadMoreDiscover } from "./actions";
import { FEED_PAGE_SIZE } from "./feed-config";

function hostname(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// The For You list: catalog feeds you don't follow yet, infinite-scrolled in
// FEED_PAGE_SIZE batches. Same IntersectionObserver pattern as FeedList, but
// keyset-paginated by sort_key (the pool changes as you follow, so an offset
// would drift). A short batch means the pool is exhausted.
export function DiscoverList({ items: initialItems }: { items: DiscoverFeed[] }) {
  const [items, setItems] = useState<DiscoverFeed[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initialItems.length < FEED_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(async () => {
    setLoading(true);
    try {
      const afterKey = items.length ? items[items.length - 1].sort_key : null;
      const next = await loadMoreDiscover(afterKey);
      if (next.length < FEED_PAGE_SIZE) setDone(true);
      if (next.length > 0) {
        setItems((prev) => {
          const seen = new Set(prev.map((f) => f.id));
          return [...prev, ...next.filter((f) => !seen.has(f.id))];
        });
      }
    } finally {
      setLoading(false);
    }
  }, [items]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || done) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading) loadMore();
      },
      { rootMargin: "0px 0px 100% 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, loading, done]);

  if (items.length === 0) {
    return (
      <div
        className="rounded-lg border p-6 text-center"
        style={{ borderColor: "var(--line)", color: "var(--muted)", fontFamily: "system-ui" }}
      >
        <p>Nothing left to discover — you follow everything in the catalog.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="flex flex-col">
        {items.map((f) => (
          <li key={f.id} className="border-b py-5" style={{ borderColor: "var(--line)" }}>
            <div
              className="mb-1 flex flex-wrap items-center gap-2 text-xs"
              style={{ color: "var(--muted)", fontFamily: "system-ui" }}
            >
              {f.category && (
                <span
                  className="rounded-full px-2 py-0.5"
                  style={{ background: "rgba(0,0,0,0.05)", color: "var(--muted)" }}
                >
                  {f.category}
                </span>
              )}
              {f.homepage && <span className="opacity-70">{hostname(f.homepage)}</span>}
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <a
                  href={f.homepage ?? f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-lg font-semibold leading-snug hover:underline"
                  style={{ letterSpacing: "-0.011em" }}
                >
                  {f.title}
                </a>
                {f.description && (
                  <p className="mt-1 text-[0.95rem] leading-relaxed" style={{ color: "var(--muted)" }}>
                    {f.description}
                  </p>
                )}
              </div>
              <div className="shrink-0 pt-0.5">
                <FollowButton catalogId={f.id} />
              </div>
            </div>
          </li>
        ))}
      </ul>

      {!done && <div ref={sentinelRef} aria-hidden className="h-px" />}

      <div
        className="py-8 text-center text-sm"
        style={{ color: "var(--muted)", fontFamily: "system-ui" }}
      >
        {loading ? "Loading…" : done ? "That's the whole pool." : ""}
      </div>
    </>
  );
}
