// Ingest core — parse one feed (or all followed feeds) and store articles.
// Server-only (uses rss-parser + the sqlite db). Shared by:
//   - scripts/ingest.ts   (the `npm run ingest` batch job)
//   - app/actions.ts      (fetch-on-follow, so a just-followed feed fills in now)
import Parser from "rss-parser";
import { db, USER_ID } from "./db";

type MediaNode = { $?: { url?: string; medium?: string; type?: string; width?: string } };

const parser: Parser<unknown, { "media:content"?: MediaNode | MediaNode[]; "media:thumbnail"?: MediaNode | MediaNode[] }> =
  new Parser({
    timeout: 15000,
    headers: { "User-Agent": "newsfeed/0.1 (+personal reader)" },
    customFields: {
      item: [
        ["media:content", "media:content", { keepArray: true }],
        ["media:thumbnail", "media:thumbnail", { keepArray: true }],
      ],
    },
  });

// Collect image candidates (url + declared width) from a media node/array.
// Skips non-image media (e.g. video enclosures) and any node without a
// numeric width, since the width is what the display rule keys off of.
function collectImages(node?: MediaNode | MediaNode[]): Array<{ url: string; width: number }> {
  if (!node) return [];
  const list = Array.isArray(node) ? node : [node];
  const out: Array<{ url: string; width: number }> = [];
  for (const n of list) {
    const url = n?.$?.url;
    if (!url) continue;
    const { medium, type, width } = n.$ ?? {};
    if (medium && medium !== "image") continue;
    if (type && !type.startsWith("image")) continue;
    const w = width ? parseInt(width, 10) : NaN;
    if (!Number.isFinite(w)) continue;
    out.push({ url, width: w });
  }
  return out;
}

// Pick the largest image variant the feed offers, returning its url + width.
// No width threshold here — that gate is applied at display time so it can be
// tuned without re-ingesting. Returns null when the item has no sized image.
function extractImage(item: {
  "media:content"?: MediaNode | MediaNode[];
  "media:thumbnail"?: MediaNode | MediaNode[];
}): { url: string; width: number } | null {
  const candidates = [
    ...collectImages(item["media:content"]),
    ...collectImages(item["media:thumbnail"]),
  ];
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.width - a.width);
  return candidates[0];
}

function toEpochSeconds(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

function clean(html?: string): string | null {
  if (!html) return null;
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > 400 ? text.slice(0, 397) + "…" : text;
}

export type Source = { id: string; name: string; url: string };
export type IngestResult = { source: Source; added: number; error?: string };

// Hard ceiling per feed. rss-parser's own `timeout` covers the request, but a
// hung DNS lookup or a slow trickle can slip past it — this guarantees no
// single feed can stall a batch (which matters as the follow-set grows).
const HARD_TIMEOUT_MS = 20000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    // Node timers keep the event loop alive; unref so a stray timer can't do so.
    if (typeof timer.unref === "function") timer.unref();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
    void label;
  });
}

// Fetch + store one source's feed. Never throws — a bad feed returns
// { added: 0, error } so batch runs and follow-time fetches can carry on.
export async function ingestSource(source: Source): Promise<IngestResult> {
  const database = db();
  const now = Math.floor(Date.now() / 1000);

  const upsertArticle = database.prepare(`
    INSERT INTO articles (source_id, guid, title, url, author, summary, image_url, image_width, published_at, fetched_at)
    VALUES (@source_id, @guid, @title, @url, @author, @summary, @image_url, @image_width, @published_at, @fetched_at)
    ON CONFLICT(source_id, guid) DO UPDATE SET
      image_url = excluded.image_url,
      image_width = excluded.image_width
      WHERE articles.image_url IS NULL AND excluded.image_url IS NOT NULL
  `);

  type FeedEntry = Parser.Item & {
    "media:content"?: MediaNode | MediaNode[];
    "media:thumbnail"?: MediaNode | MediaNode[];
  };

  try {
    const feed = await withTimeout(parser.parseURL(source.url), HARD_TIMEOUT_MS, source.name);
    const insertMany = database.transaction((items: FeedEntry[]) => {
      let added = 0;
      for (const item of items) {
        const url = item.link?.trim();
        const title = item.title?.trim();
        if (!url || !title) continue;
        const guid = (item.guid || item.link || url).trim();
        const summary =
          clean((item as { contentSnippet?: string }).contentSnippet) ?? clean(item.content);
        const image = extractImage(item);
        const info = upsertArticle.run({
          source_id: source.id,
          guid,
          title,
          url,
          author: item.creator ?? (item as { author?: string }).author ?? null,
          summary,
          image_url: image?.url ?? null,
          image_width: image?.width ?? null,
          published_at: toEpochSeconds(item.isoDate),
          fetched_at: now,
        });
        added += info.changes;
      }
      return added;
    });
    const added = insertMany(feed.items ?? []);
    return { source, added };
  } catch (err) {
    return { source, added: 0, error: (err as Error).message };
  }
}

// Poll every SUBSCRIBED source (not the whole catalog). Runs feeds
// concurrently in small batches. onResult lets callers log progress.
export async function ingestAll(
  onResult?: (r: IngestResult) => void,
  concurrency = 8
): Promise<{ results: IngestResult[]; totalNew: number }> {
  const sources = db()
    .prepare(
      `SELECT s.id, s.name, s.url
         FROM sources s
         JOIN subscriptions sub ON sub.source_id = s.id AND sub.user_id = ?
        ORDER BY s.id`
    )
    .all(USER_ID) as Source[];

  // Worker pool: keep `concurrency` feeds in flight, and report each the moment
  // it settles (a slow feed no longer holds back the others' progress logs).
  const results: IngestResult[] = [];
  let next = 0;
  async function worker() {
    while (next < sources.length) {
      const source = sources[next++];
      const r = await ingestSource(source);
      results.push(r);
      onResult?.(r);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, sources.length) }, () => worker())
  );

  const totalNew = results.reduce((sum, r) => sum + r.added, 0);
  return { results, totalNew };
}
