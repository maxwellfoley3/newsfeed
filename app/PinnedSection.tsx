import Link from "next/link";
import type { FeedItem } from "@/lib/db";
import { relativeTime, hostname } from "@/lib/format";
import { ArticleActions } from "./ArticleActions";

// The "Pinned" strip at the top of the Following feed: the latest article from
// each pinned source. Server-rendered (no infinite scroll) — the whole set is
// small (one per pinned source). `now` is the request-time clock for timestamps;
// this renders on the server only, so there's no hydration render to mismatch.
export function PinnedSection({ items, now }: { items: FeedItem[]; now: number }) {
  if (items.length === 0) return null;

  return (
    <section className="mb-8">
      <h2
        className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide"
        style={{ color: "var(--muted)", fontFamily: "system-ui" }}
      >
        <span aria-hidden>📌</span> Pinned
      </h2>

      <ul
        className="flex flex-col gap-3 rounded-2xl border p-4"
        style={{ borderColor: "var(--line)", background: "rgba(0,0,0,0.015)" }}
      >
        {items.map((a) => (
          <li
            key={a.id}
            className="border-b pb-3 last:border-b-0 last:pb-0"
            style={{ borderColor: "var(--line)" }}
          >
            <div
              className="mb-1 flex items-center gap-2 text-xs"
              style={{ color: "var(--muted)", fontFamily: "system-ui" }}
            >
              <Link
                href={`/source/${a.source_id}`}
                className="font-medium hover:underline"
                style={{ color: "var(--accent)" }}
              >
                {a.source_name}
              </Link>
              {a.affiliation && <span className="opacity-70">· {a.affiliation}</span>}
              <span className="opacity-70">· {relativeTime(a.published_at, now)}</span>
            </div>

            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-lg font-semibold leading-snug hover:underline"
              style={{ letterSpacing: "-0.011em" }}
            >
              {a.title}
            </a>

            <div className="mt-2 flex items-center justify-between">
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
    </section>
  );
}
