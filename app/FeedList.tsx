"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { FeedItem } from "@/lib/db";
import { relativeTime, hostname } from "@/lib/format";
import { ArticleActions } from "./ArticleActions";
import { useAdminMode } from "./AdminMode";
import { loadMoreFeed } from "./actions";
import { FEED_PAGE_SIZE } from "./feed-config";

// Only show feed images the source advertises as wider than this. Applied at
// display time (not ingest) so the threshold can change without re-ingesting.
const MIN_IMAGE_WIDTH = 500;

// linkSource: render each source name as a link to its own feed.
// Off on the single-source page (you're already there).
//
// Infinite scroll: renders `initialItems`, then loads FEED_PAGE_SIZE more at a
// time whenever the sentinel comes within one screen-height of the viewport.
// The feed is finite and chronological — a short batch means we've hit the
// bottom, so loading stops (no endless loop, per SCOPE's anti-compulsion rule).
export function FeedList({
  items: initialItems,
  sourceId,
  linkSource = true,
  now,
  loadMore: loadMoreProp,
}: {
  items: FeedItem[];
  sourceId?: string;
  linkSource?: boolean;
  // Request-time clock (epoch seconds) from the server. Shared by SSR and the
  // first client render so relative timestamps hydrate cleanly.
  now: number;
  // How to fetch the next page, given the current offset (and optional count).
  // Defaults to the Following-feed loader; the For You page injects the
  // unfollowed-articles loader instead.
  loadMore?: (offset: number, limit?: number) => Promise<FeedItem[]>;
}) {
  const fetchPage = loadMoreProp ?? ((offset, limit) => loadMoreFeed(offset, sourceId, limit));
  const admin = useAdminMode();
  const [items, setItems] = useState<FeedItem[]>(initialItems);
  // Start from the server's `now` (so the first client render matches the SSR
  // HTML), then switch to the real client clock after mount and keep it ticking
  // so timestamps stay accurate — including items fetched later by infinite scroll.
  const [nowSec, setNowSec] = useState(now);
  useEffect(() => {
    setNowSec(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(id);
  }, []);
  const [loading, setLoading] = useState(false);
  // If the first render already came up short, there's nothing more to fetch.
  const [done, setDone] = useState(initialItems.length < FEED_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Scroll-restoration state, persisted per-page in sessionStorage (per-tab,
  // ephemeral — the right store for a scroll offset). Keyed by pathname so the
  // Following feed and each source page restore independently.
  const pathname = usePathname();
  const storageKey = `feed-scroll:${pathname}`;
  // How many items are currently loaded — read inside the throttled scroll
  // handler without making it a dependency (which would re-bind on every batch).
  const countRef = useRef(items.length);
  countRef.current = items.length;
  const didMountRef = useRef(false);

  // Reset when the underlying list identity changes (e.g. a fresh RSC payload
  // after ingest). Skipped on first mount so it can't clobber a restore.
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    setItems(initialItems);
    setDone(initialItems.length < FEED_PAGE_SIZE);
    setLoading(false);
  }, [initialItems]);

  const loadMore = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchPage(items.length);
      if (next.length < FEED_PAGE_SIZE) setDone(true);
      if (next.length > 0) {
        setItems((prev) => {
          const seen = new Set(prev.map((a) => a.id));
          return [...prev, ...next.filter((a) => !seen.has(a.id))];
        });
      }
    } finally {
      setLoading(false);
    }
  }, [items.length, sourceId]);

  // Persist { count, scrollY } as the user scrolls (throttled to one write per
  // frame), and take over scroll restoration so the browser's native attempt —
  // which fires before our extra items exist — doesn't fight us.
  useEffect(() => {
    const prevRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";

    let raf = 0;
    const save = () => {
      raf = 0;
      try {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({ count: countRef.current, scrollY: window.scrollY })
        );
      } catch {
        // sessionStorage can throw (private mode / quota) — scroll memory is
        // a nicety, not worth crashing the feed over.
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(save);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      history.scrollRestoration = prevRestoration;
    };
  }, [storageKey]);

  // On mount, rebuild the previously-loaded page (one fetch for all the missing
  // items) and jump back to where the user was.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(storageKey);
    } catch {
      return;
    }
    if (!raw) return;

    let saved: { count?: number; scrollY?: number };
    try {
      saved = JSON.parse(raw);
    } catch {
      return;
    }
    const targetCount = saved.count ?? 0;
    const scrollY = saved.scrollY ?? 0;

    let cancelled = false;
    const restoreScroll = () =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!cancelled) window.scrollTo(0, scrollY);
        })
      );

    const missing = targetCount - initialItems.length;
    if (missing <= 0) {
      if (scrollY > 0) restoreScroll();
      return;
    }

    (async () => {
      // One fetch for the whole gap, so restoration isn't 15-at-a-time.
      const rest = await fetchPage(initialItems.length, missing);
      if (cancelled) return;
      if (rest.length < missing) setDone(true);
      if (rest.length > 0) {
        setItems((prev) => {
          const seen = new Set(prev.map((a) => a.id));
          return [...prev, ...rest.filter((a) => !seen.has(a.id))];
        });
      }
      restoreScroll();
    })();

    return () => {
      cancelled = true;
    };
    // Mount-only: initialItems / sourceId / storageKey are fixed for this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || done) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading) loadMore();
      },
      // Start fetching while the sentinel is still one full viewport-height
      // below the fold, so the next batch is usually ready before you arrive.
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
        <p>No articles yet.</p>
        <p className="mt-2 text-sm">
          Run <code className="rounded bg-black/5 px-1 py-0.5">npm run ingest</code> to pull the feeds.
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="flex flex-col">
        {items.map((a) => (
          <li key={a.id} className="border-b py-5" style={{ borderColor: "var(--line)" }}>
            <div
              className="mb-1 flex items-center gap-2 text-xs"
              style={{ color: "var(--muted)", fontFamily: "system-ui" }}
            >
              {linkSource ? (
                <Link
                  href={`/source/${a.source_id}`}
                  className="font-medium hover:underline"
                  style={{ color: "var(--accent)" }}
                >
                  {a.source_name}
                </Link>
              ) : (
                <span className="font-medium" style={{ color: "var(--accent)" }}>
                  {a.source_name}
                </span>
              )}
              {a.affiliation && <span className="opacity-70">· {a.affiliation}</span>}
              <span className="opacity-70">· {relativeTime(a.published_at, nowSec)}</span>
              {admin && a.rank && (
                a.rank.explore ? (
                  <span
                    className="rounded-full px-1.5 py-0.5 font-semibold"
                    style={{ background: "#7d3c98", color: "#ffffff" }}
                    title="random explore pick (serendipity injection)"
                  >
                    🎲 random
                  </span>
                ) : (
                  <span
                    className="rounded-full px-1.5 py-0.5 font-semibold"
                    style={{ background: "#c0392b", color: "#ffffff" }}
                    title={`taste ${a.rank.taste.toFixed(2)} · affinity ${a.rank.affinity.toFixed(2)}${
                      a.rank.terms.length ? ` · matched: ${a.rank.terms.join(", ")}` : ""
                    }`}
                  >
                    {a.rank.score.toFixed(2)} · t{a.rank.taste.toFixed(2)} a{a.rank.affinity.toFixed(2)}
                    {a.rank.terms.length > 0 && ` · ${a.rank.terms.join(", ")}`}
                  </span>
                )
              )}
            </div>

            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xl font-semibold leading-snug hover:underline"
              style={{ letterSpacing: "-0.011em" }}
            >
              {a.title}
            </a>

            {a.summary && (
              <p className="mt-1.5 text-[0.95rem] leading-relaxed" style={{ color: "var(--muted)" }}>
                {a.summary}
              </p>
            )}

            {a.image_url && (a.image_width ?? 0) > MIN_IMAGE_WIDTH && (
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 block overflow-hidden rounded-xl border"
                style={{ borderColor: "var(--line)" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.image_url}
                  alt=""
                  loading="lazy"
                  className="aspect-[16/9] w-full object-cover"
                  style={{ background: "var(--line)" }}
                />
              </a>
            )}

            <div className="mt-3 flex items-center justify-between">
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs hover:underline"
                style={{ color: "var(--muted)", fontFamily: "system-ui" }}
              >
                {hostname(a.url)} ↗
              </a>
              <ArticleActions articleId={a.id} signal={a.signal} />
            </div>
          </li>
        ))}
      </ul>

      {/* Sentinel: crossing into view (one screen early) triggers the next batch. */}
      {!done && <div ref={sentinelRef} aria-hidden className="h-px" />}

      <div
        className="py-8 text-center text-sm"
        style={{ color: "var(--muted)", fontFamily: "system-ui" }}
      >
        {loading ? "Loading…" : done ? "You're all caught up." : ""}
      </div>
    </>
  );
}
