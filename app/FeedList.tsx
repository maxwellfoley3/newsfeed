import Link from "next/link";
import type { FeedItem } from "@/lib/db";
import { ArticleActions } from "./ArticleActions";

// Only show feed images the source advertises as wider than this. Applied at
// display time (not ingest) so the threshold can change without re-ingesting.
const MIN_IMAGE_WIDTH = 500;

function relativeTime(epoch: number | null): string {
  if (!epoch) return "";
  const diff = Math.floor(Date.now() / 1000) - epoch;
  if (diff < 60) return "just now";
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(epoch * 1000).toLocaleDateString();
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// linkSource: render each source name as a link to its own feed.
// Off on the single-source page (you're already there).
export function FeedList({
  items,
  linkSource = true,
}: {
  items: FeedItem[];
  linkSource?: boolean;
}) {
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
            <span className="opacity-70">· {relativeTime(a.published_at)}</span>
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
  );
}
