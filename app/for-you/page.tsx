import { getDiscoverFeeds, type DiscoverFeed } from "@/lib/db";
import { DiscoverList } from "../DiscoverList";
import { FEED_PAGE_SIZE } from "../feed-config";

// Reflect follows immediately — followed feeds drop out of the pool.
export const dynamic = "force-dynamic";

export default function ForYouPage() {
  // First screen only; DiscoverList infinite-scrolls the rest.
  const items: DiscoverFeed[] = getDiscoverFeeds({ limit: FEED_PAGE_SIZE });

  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <header className="mb-8 border-b pb-5" style={{ borderColor: "var(--line)" }}>
        <h1 className="text-4xl font-semibold" style={{ letterSpacing: "-0.021em" }}>
          For You
        </h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
          Feeds worth trying, from sources you don&apos;t follow yet. Follow one and its
          articles join your Following feed.
        </p>
      </header>

      <DiscoverList items={items} />

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
