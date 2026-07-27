import Link from "next/link";
import { notFound } from "next/navigation";
import { getFeed, getSource, type FeedItem } from "@/lib/db";
import { FeedList } from "../../FeedList";
import { FEED_PAGE_SIZE } from "../../feed-config";

export const dynamic = "force-dynamic";

export default async function SourcePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const source = getSource(id);
  if (!source) notFound();

  const items: FeedItem[] = getFeed({ sourceId: id, limit: FEED_PAGE_SIZE });

  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <header className="mb-8 border-b pb-5" style={{ borderColor: "var(--line)" }}>
        <Link
          href="/"
          className="text-sm hover:underline"
          style={{ color: "var(--muted)", fontFamily: "system-ui" }}
        >
          ← Following
        </Link>
        <h1 className="mt-2 text-4xl font-semibold" style={{ letterSpacing: "-0.021em" }}>
          {source.name}
        </h1>
        <p
          className="mt-1.5 flex flex-wrap items-center gap-2 text-sm"
          style={{ color: "var(--muted)" }}
        >
          {source.affiliation && <span>{source.affiliation}</span>}
          {source.homepage && (
            <>
              <span className="opacity-50">·</span>
              <a
                href={source.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                website ↗
              </a>
            </>
          )}
        </p>
      </header>

      <FeedList items={items} sourceId={id} linkSource={false} />
    </main>
  );
}
