import Link from "next/link";
import { getFollowedSources, type Source } from "@/lib/db";

export const dynamic = "force-dynamic";

function hostname(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// The full list of sources the user follows. Reached from the "Following N"
// chip on the feed header. Each row links to that source's own feed page.
export default function FollowingListPage() {
  const sources: Source[] = getFollowedSources();

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
          Following {sources.length}
        </h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
          Every source in your feed.
        </p>
      </header>

      {sources.length === 0 ? (
        <div
          className="rounded-lg border p-6 text-center"
          style={{ borderColor: "var(--line)", color: "var(--muted)", fontFamily: "system-ui" }}
        >
          <p>
            You don&apos;t follow any feeds yet.{" "}
            <Link href="/for-you" className="hover:underline" style={{ color: "var(--accent)" }}>
              Discover some →
            </Link>
          </p>
        </div>
      ) : (
        <ul className="flex flex-col">
          {sources.map((s) => (
            <li key={s.id} className="border-b py-4" style={{ borderColor: "var(--line)" }}>
              <Link
                href={`/source/${s.id}`}
                className="block text-lg font-semibold leading-snug hover:underline"
                style={{ letterSpacing: "-0.011em" }}
              >
                {s.name}
              </Link>
              <div
                className="mt-0.5 flex flex-wrap items-center gap-2 text-sm"
                style={{ color: "var(--muted)" }}
              >
                {s.affiliation && <span>{s.affiliation}</span>}
                {s.affiliation && s.homepage && <span className="opacity-50">·</span>}
                {s.homepage && (
                  <a
                    href={s.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {hostname(s.homepage)} ↗
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
