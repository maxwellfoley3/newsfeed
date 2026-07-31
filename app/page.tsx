import { getFeed, type FeedItem } from "@/lib/db";
import { refreshStaleInBackground } from "@/lib/ingest";
import { FeedList } from "./FeedList";
import { FEED_PAGE_SIZE } from "./feed-config";

// Always render fresh from the DB — this is the reader, it should reflect ingest.
export const dynamic = "force-dynamic";

export default function FollowingPage() {
  // Kick a background refresh of any stale followed feeds (not awaited): this
  // load serves what's already in SQLite; fresh rows land for the next one.
  refreshStaleInBackground();

  // First screen only; FeedList infinite-scrolls the rest in FEED_PAGE_SIZE batches.
  const items: FeedItem[] = getFeed({ limit: FEED_PAGE_SIZE });

  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <header className="mb-8 border-b pb-5" style={{ borderColor: "var(--line)" }}>
        <h1 className="text-4xl font-semibold" style={{ letterSpacing: "-0.021em" }}>
          Following
        </h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
          Newest first, from the sources you follow. No algorithm.
        </p>
      </header>

      <FeedList items={items} />
    </main>
  );
}
