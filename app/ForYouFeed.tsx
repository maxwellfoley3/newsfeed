"use client";

import { useEffect, useRef, useState } from "react";
import type { FeedItem } from "@/lib/db";
import { FeedList } from "./FeedList";
import { loadMoreDiscoverArticles } from "./actions";
import { useAdminMode } from "./AdminMode";
import { FEED_PAGE_SIZE } from "./feed-config";

// For You feed wrapper. In admin mode it shows a checkbox to filter the feed to
// only sources you don't follow (an inspection aid for the discover pool). The
// server renders the unfiltered first page; toggling the box refetches page 0
// with the filter and hands FeedList a fresh list + a filter-aware loader.
export function ForYouFeed({
  initialItems,
  now,
}: {
  initialItems: FeedItem[];
  now: number;
}) {
  const admin = useAdminMode();
  const [onlyUnfollowed, setOnlyUnfollowed] = useState(false);
  const [items, setItems] = useState(initialItems);
  const didMount = useRef(false);

  // Refetch page 0 when the filter flips. Skip the first run so the initial
  // (unfiltered) server render isn't immediately re-fetched.
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    let cancelled = false;
    (async () => {
      const first = await loadMoreDiscoverArticles(0, FEED_PAGE_SIZE, onlyUnfollowed);
      if (!cancelled) setItems(first);
    })();
    return () => {
      cancelled = true;
    };
  }, [onlyUnfollowed]);

  // If admin mode is turned off while the filter is on, revert to the full feed.
  useEffect(() => {
    if (!admin && onlyUnfollowed) setOnlyUnfollowed(false);
  }, [admin, onlyUnfollowed]);

  return (
    <>
      {admin && (
        <label
          className="mb-6 flex select-none items-center gap-2 rounded-lg border p-3 text-sm"
          style={{ borderColor: "var(--line)", fontFamily: "system-ui" }}
        >
          <input
            type="checkbox"
            checked={onlyUnfollowed}
            onChange={(e) => setOnlyUnfollowed(e.target.checked)}
          />
          Only show sources I&apos;m not following
        </label>
      )}

      <FeedList
        items={items}
        now={now}
        loadMore={(offset, limit) => loadMoreDiscoverArticles(offset, limit, onlyUnfollowed)}
      />
    </>
  );
}
