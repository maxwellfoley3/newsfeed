// Ingest core — parse one feed (or all followed feeds) and store articles.
// Server-only (uses rss-parser + the sqlite db). Shared by:
//   - scripts/ingest.ts   (the `npm run ingest` batch job)
//   - app/actions.ts      (fetch-on-follow, so a just-followed feed fills in now)
import Parser from "rss-parser";
import { db, USER_ID } from "./db";
import { normalizeCategory } from "./categories";

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

  // Stamp the poll attempt regardless of outcome, so a dead or slow feed isn't
  // retried on every single page load — staleness is measured from the attempt.
  database
    .prepare("UPDATE sources SET last_polled_at = ? WHERE id = ?")
    .run(now, source.id);

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

// Discover (For You) ingest: sample UNFOLLOWED catalog feeds, copy each into
// `sources` (without subscribing, so it stays in the discover pool), and fetch
// its articles. Selection = the "what to ingest" heuristic: bias toward
// categories you already follow, then never-polled feeds, then the
// least-recently polled — so coverage of the 2.5k-feed catalog grows over time
// without re-hammering the same feeds. Never throws per feed (ingestSource
// swallows errors); returns the same shape as ingestAll.
export async function ingestDiscover(
  limit = 60,
  onResult?: (r: IngestResult) => void,
  concurrency = 8
): Promise<{ results: IngestResult[]; totalNew: number }> {
  const d = db();

  type CatalogFeed = {
    id: string;
    name: string;
    url: string;
    homepage: string | null;
    category: string | null;
    provenance: string | null;
  };
  type Candidate = CatalogFeed & { last_polled_at: number | null; sort_key: number };

  // The categories the user follows, normalized to the shared vocabulary so the
  // match works across catalogs (ooh.directory slugs vs awesome-rss-feeds
  // Title Case + country names). See lib/categories.ts.
  const followedCats = new Set(
    (
      d
        .prepare(
          `SELECT DISTINCT s.category
             FROM sources s
             JOIN subscriptions sub ON sub.source_id = s.id AND sub.user_id = ?
            WHERE s.category IS NOT NULL`
        )
        .all(USER_ID) as Array<{ category: string }>
    )
      .map((r) => normalizeCategory(r.category))
      .filter((c): c is string => c !== null)
  );

  // All catalog feeds the user doesn't follow, with each feed's last poll time.
  // Prioritization (category bias → never-polled → oldest → sort_key) is done in
  // JS below so the category match can run through normalizeCategory, which raw
  // SQL string equality can't.
  const candidates = d
    .prepare(
      `SELECT c.id, c.title AS name, c.url, c.homepage, c.category, c.provenance,
              c.sort_key AS sort_key, src.last_polled_at AS last_polled_at
         FROM catalog c
         LEFT JOIN sources src ON src.id = c.id
        WHERE c.url NOT IN (
                SELECT s.url FROM sources s
                  JOIN subscriptions sub ON sub.source_id = s.id AND sub.user_id = @user
              )`
    )
    .all({ user: USER_ID }) as Candidate[];

  const matchesFollowedCategory = (cat: string | null): boolean => {
    const nc = normalizeCategory(cat);
    return nc !== null && followedCats.has(nc);
  };

  const feeds: CatalogFeed[] = candidates
    .sort((a, b) => {
      // 1. Feeds in a followed (normalized) category first.
      const am = matchesFollowedCategory(a.category) ? 0 : 1;
      const bm = matchesFollowedCategory(b.category) ? 0 : 1;
      if (am !== bm) return am - bm;
      // 2. Never-polled before already-polled.
      const an = a.last_polled_at === null ? 0 : 1;
      const bn = b.last_polled_at === null ? 0 : 1;
      if (an !== bn) return an - bn;
      // 3. Least-recently polled first (among polled).
      if (a.last_polled_at !== null && b.last_polled_at !== null && a.last_polled_at !== b.last_polled_at) {
        return a.last_polled_at - b.last_polled_at;
      }
      // 4. Stable browse order.
      return a.sort_key - b.sort_key;
    })
    .slice(0, limit);

  // Copy a sampled catalog feed into `sources` (no subscription) so its articles
  // have a valid source_id to hang off of. Mirrors followFromCatalog's mapping
  // (affiliation = provenance) minus the subscribe.
  const upsertSource = d.prepare(`
    INSERT INTO sources (id, name, url, homepage, category, affiliation, note)
    VALUES (@id, @name, @url, @homepage, @category, @affiliation, NULL)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, url=excluded.url, homepage=excluded.homepage,
      category=excluded.category, affiliation=excluded.affiliation
  `);

  const results: IngestResult[] = [];
  let next = 0;
  async function worker() {
    while (next < feeds.length) {
      const f = feeds[next++];
      upsertSource.run({
        id: f.id,
        name: f.name,
        url: f.url,
        homepage: f.homepage,
        category: f.category,
        affiliation: f.provenance,
      });
      const r = await ingestSource({ id: f.id, name: f.name, url: f.url });
      results.push(r);
      onResult?.(r);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, feeds.length) }, () => worker())
  );

  const totalNew = results.reduce((sum, r) => sum + r.added, 0);
  return { results, totalNew };
}

// How old a source's last poll must be before a page load will refresh it.
const STALE_AFTER_MS = 15 * 60 * 1000;

// One refresh in flight at a time per process — concurrent page loads share it
// instead of each kicking off their own overlapping sweep.
let refreshInFlight: Promise<void> | null = null;

// Fire-and-forget refresh for the reader pages: poll only the SUBSCRIBED
// sources whose last poll is older than STALE_AFTER_MS (or never polled).
// Returns immediately if nothing is stale or a refresh is already running, so
// it's cheap to call on every render. Callers should NOT await this — the
// current request serves whatever is already in SQLite; fresh rows land for
// the next load. Never throws.
export function refreshStaleInBackground(): void {
  if (refreshInFlight) return;

  const cutoff = Math.floor((Date.now() - STALE_AFTER_MS) / 1000);
  const stale = db()
    .prepare(
      `SELECT s.id, s.name, s.url
         FROM sources s
         JOIN subscriptions sub ON sub.source_id = s.id AND sub.user_id = ?
        WHERE s.last_polled_at IS NULL OR s.last_polled_at < ?
        ORDER BY s.last_polled_at IS NOT NULL, s.last_polled_at ASC`
    )
    .all(USER_ID, cutoff) as Source[];

  if (stale.length === 0) return;

  // Worker pool over just the stale set. ingestSource never throws and stamps
  // last_polled_at up front, so this can't hammer a dead feed each load.
  let next = 0;
  const concurrency = Math.min(8, stale.length);
  async function worker() {
    while (next < stale.length) {
      await ingestSource(stale[next++]);
    }
  }
  refreshInFlight = Promise.all(Array.from({ length: concurrency }, () => worker()))
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      refreshInFlight = null;
    });
}
