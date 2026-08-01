import Link from "next/link";
import {
  getFeed,
  getFollowedCount,
  getPinnedFeedItems,
  type FeedItem,
} from "@/lib/db";
import { refreshStaleInBackground } from "@/lib/ingest";
import { FeedList } from "./FeedList";
import { PinnedSection } from "./PinnedSection";
import { FEED_PAGE_SIZE } from "./feed-config";

// Always render fresh from the DB — this is the reader, it should reflect ingest.
export const dynamic = "force-dynamic";

export default function FollowingPage() {
  // Kick a background refresh of any stale followed feeds (not awaited): this
  // load serves what's already in SQLite; fresh rows land for the next one.
  refreshStaleInBackground();

  // First screen only; FeedList infinite-scrolls the rest in FEED_PAGE_SIZE batches.
  const items: FeedItem[] = getFeed({ limit: FEED_PAGE_SIZE });
  const followedCount = getFollowedCount();
  const pinnedItems: FeedItem[] = getPinnedFeedItems();
  const now = Math.floor(Date.now() / 1000);

  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <header className="mb-8 border-b pb-5" style={{ borderColor: "var(--line)" }}>
        <h1 className="text-4xl font-semibold" style={{ letterSpacing: "-0.021em" }}>
          Following
        </h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
          Newest first, from the sources you follow. No algorithm.
        </p>
        <Link
          href="/following-list"
          className="mt-3 inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium transition-colors hover:bg-black/[0.03]"
          style={{ borderColor: "var(--line)", color: "var(--muted)", fontFamily: "system-ui" }}
        >
          Following {followedCount}
          <span aria-hidden>›</span>
        </Link>
      </header>

      <PinnedSection items={pinnedItems} now={now} />

      <FeedList items={items} now={now} />
    </main>
  );
}
