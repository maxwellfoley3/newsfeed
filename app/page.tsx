import { getFeed, type FeedItem } from "@/lib/db";
import { FeedList } from "./FeedList";

// Always render fresh from the DB — this is the reader, it should reflect ingest.
export const dynamic = "force-dynamic";

export default function FollowingPage() {
  const items: FeedItem[] = getFeed();

  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <header className="mb-8 border-b pb-5" style={{ borderColor: "var(--line)" }}>
        <h1 className="text-3xl font-bold tracking-tight">Following</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)", fontFamily: "system-ui" }}>
          Newest first, from the sources you follow. No algorithm.
        </p>
      </header>

      <FeedList items={items} />
    </main>
  );
}
