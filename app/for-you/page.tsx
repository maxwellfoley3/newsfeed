import { getRankedDiscoverArticles, type FeedItem } from "@/lib/db";
import { ForYouFeed } from "../ForYouFeed";
import { FEED_PAGE_SIZE } from "../feed-config";

// Reflect follows immediately — followed sources drop out of the pool.
export const dynamic = "force-dynamic";

export default function ForYouPage() {
  // Articles from sources you don't follow yet, newest first (pre-ranking).
  const items: FeedItem[] = getRankedDiscoverArticles({ limit: FEED_PAGE_SIZE });
  const now = Math.floor(Date.now() / 1000);

  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <header className="mb-8 border-b pb-5" style={{ borderColor: "var(--line)" }}>
        <h1 className="text-4xl font-semibold" style={{ letterSpacing: "-0.021em" }}>
          For You
        </h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
          A mix of posts from sources you follow and ones you don&apos;t yet. Open any
          source to follow or unfollow it.
        </p>
      </header>

      <ForYouFeed initialItems={items} now={now} />

      <footer
        className="mt-6 border-t pt-5 text-xs"
        style={{ borderColor: "var(--line)", color: "var(--muted)", fontFamily: "system-ui" }}
      >
        Catalog compiled from{" "}
        <a
          href="https://github.com/plenaryapp/awesome-rss-feeds"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          awesome-rss-feeds
        </a>{" "}
        and{" "}
        <a
          href="https://ooh.directory"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          ooh.directory
        </a>
        .
      </footer>
    </main>
  );
}
