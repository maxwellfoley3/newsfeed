// NOTE: server-side only. Imported by RSC/server actions and the ingest script.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { buildTasteScorer } from "./rank";
import { buildSourceAffinity, type FeedDoc } from "./affinity";

// v1.0 is single-user. Everything is scoped to this constant so the schema
// is already multi-user-shaped when we need it.
export const USER_ID = "me";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "newsfeed.db");

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const database = new Database(DB_PATH);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  migrate(database);
  seedSources(database);
  seedCatalog(database);
  _db = database;
  return _db;
}

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      url            TEXT NOT NULL,
      homepage       TEXT,
      category       TEXT,
      affiliation    TEXT,
      note           TEXT,
      last_polled_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id   TEXT NOT NULL,
      source_id TEXT NOT NULL,
      PRIMARY KEY (user_id, source_id),
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    );

    -- Pinned sources: the latest article from each surfaces in a "Pinned"
    -- section atop the Following feed.
    CREATE TABLE IF NOT EXISTS pins (
      user_id    TEXT NOT NULL,
      source_id  TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, source_id),
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS articles (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id    TEXT NOT NULL,
      guid         TEXT NOT NULL,
      title        TEXT NOT NULL,
      url          TEXT NOT NULL,
      author       TEXT,
      summary      TEXT,
      image_url    TEXT,
      image_width  INTEGER,
      published_at INTEGER,
      fetched_at   INTEGER NOT NULL,
      UNIQUE (source_id, guid),
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);

    -- like (1) / dislike (-1). Collected now; feeds the future For You page.
    CREATE TABLE IF NOT EXISTS signals (
      user_id    TEXT NOT NULL,
      article_id INTEGER NOT NULL,
      value      INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, article_id),
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
    );

    -- Small key/value store (e.g. which catalog version has been seeded).
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- The discovery pool the For You page draws from. Kept SEPARATE from the
    -- sources table on purpose: ingest only polls sources, so the thousands of
    -- catalog feeds are never fetched until someone follows one (which copies
    -- the row into sources). sort_key gives a stable shuffled browse order.
    CREATE TABLE IF NOT EXISTS catalog (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      url         TEXT NOT NULL,
      homepage    TEXT,
      category    TEXT,
      description TEXT,
      provenance  TEXT,
      sort_key    REAL NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_catalog_sortkey ON catalog(sort_key);
    CREATE INDEX IF NOT EXISTS idx_catalog_url ON catalog(url);
  `);

  // Backfill columns on pre-existing DBs (CREATE TABLE IF NOT EXISTS won't add them).
  const cols = d.prepare("PRAGMA table_info(articles)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "image_url")) {
    d.exec("ALTER TABLE articles ADD COLUMN image_url TEXT");
  }
  if (!cols.some((c) => c.name === "image_width")) {
    d.exec("ALTER TABLE articles ADD COLUMN image_width INTEGER");
  }

  const srcCols = d.prepare("PRAGMA table_info(sources)").all() as Array<{ name: string }>;
  if (!srcCols.some((c) => c.name === "last_polled_at")) {
    d.exec("ALTER TABLE sources ADD COLUMN last_polled_at INTEGER");
  }
  // RSS-declared feed language (e.g. "en-us", "it-it"), lowercased, or NULL when
  // the feed doesn't declare one. Populated on each poll (see ingestSource).
  if (!srcCols.some((c) => c.name === "language")) {
    d.exec("ALTER TABLE sources ADD COLUMN language TEXT");
  }
}

type Seed = {
  sources: Array<{
    id: string;
    name: string;
    url: string;
    homepage?: string;
    category?: string;
    affiliation?: string;
    note?: string;
    follow_by_default?: boolean;
  }>;
};

// Idempotent: upsert seed sources and the initial Following set on every boot.
function seedSources(d: Database.Database) {
  const seedPath = path.join(process.cwd(), "seeds.json");
  if (!fs.existsSync(seedPath)) return;
  const seed = JSON.parse(fs.readFileSync(seedPath, "utf8")) as Seed;

  const upsertSource = d.prepare(`
    INSERT INTO sources (id, name, url, homepage, category, affiliation, note)
    VALUES (@id, @name, @url, @homepage, @category, @affiliation, @note)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, url=excluded.url, homepage=excluded.homepage,
      category=excluded.category, affiliation=excluded.affiliation, note=excluded.note
  `);
  const subscribe = d.prepare(`
    INSERT OR IGNORE INTO subscriptions (user_id, source_id) VALUES (?, ?)
  `);

  const tx = d.transaction(() => {
    for (const s of seed.sources) {
      upsertSource.run({
        id: s.id,
        name: s.name,
        url: s.url,
        homepage: s.homepage ?? null,
        category: s.category ?? null,
        affiliation: s.affiliation ?? null,
        note: s.note ?? null,
      });
      if (s.follow_by_default) subscribe.run(USER_ID, s.id);
    }
  });
  tx();
}

type Catalog = {
  generated_at: string;
  feeds: Array<{
    id: string;
    title: string;
    url: string;
    homepage: string | null;
    category: string;
    description: string | null;
    provenance: string;
    sort_key: number;
  }>;
};

// Idempotent: load data/catalog.json into the `catalog` table. Guarded by the
// file's generated_at stamp so it only re-imports when the catalog changes.
function seedCatalog(d: Database.Database) {
  const catalogPath = path.join(process.cwd(), "data", "catalog.json");
  if (!fs.existsSync(catalogPath)) return;
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as Catalog;

  const STAMP = "catalog_generated_at";
  const current = d.prepare("SELECT value FROM meta WHERE key = ?").get(STAMP) as
    | { value: string }
    | undefined;
  if (current?.value === catalog.generated_at) return;

  const upsert = d.prepare(`
    INSERT INTO catalog (id, title, url, homepage, category, description, provenance, sort_key)
    VALUES (@id, @title, @url, @homepage, @category, @description, @provenance, @sort_key)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, url=excluded.url, homepage=excluded.homepage,
      category=excluded.category, description=excluded.description,
      provenance=excluded.provenance, sort_key=excluded.sort_key
  `);
  const setMeta = d.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  );

  const tx = d.transaction(() => {
    for (const f of catalog.feeds) {
      upsert.run({
        id: f.id,
        title: f.title,
        url: f.url,
        homepage: f.homepage ?? null,
        category: f.category ?? null,
        description: f.description ?? null,
        provenance: f.provenance ?? null,
        sort_key: f.sort_key,
      });
    }
    setMeta.run(STAMP, catalog.generated_at);
  });
  tx();
}

// ---- Reads ----------------------------------------------------------------

export type FeedItem = {
  id: number;
  title: string;
  url: string;
  summary: string | null;
  image_url: string | null;
  image_width: number | null;
  published_at: number | null;
  source_id: string;
  source_name: string;
  affiliation: string | null;
  signal: number | null; // 1 like, -1 dislike, null none
  // Attached only by getRankedDiscoverArticles for the admin-mode debug badge:
  // combined score plus its TasteMatch/SourceAffinity components and top terms.
  // `explore` marks a random serendipity pick injected outside the ranking.
  rank?: { score: number; taste: number; affinity: number; terms: string[]; explore?: boolean };
};

// The Following feed: articles from subscribed sources, newest first. Pass a
// sourceId to restrict to a single source — in that case the subscription
// filter is dropped, so a source's own page shows its articles whether or not
// you currently follow it (the main aggregate feed stays subscription-gated).
export function getFeed(
  opts: { sourceId?: string; limit?: number; offset?: number } = {}
): FeedItem[] {
  const { sourceId = null, limit = 150, offset = 0 } = opts;
  return db()
    .prepare(
      `SELECT a.id, a.title, a.url, a.summary, a.image_url, a.image_width, a.published_at,
              s.id AS source_id, s.name AS source_name, s.affiliation,
              sig.value AS signal
         FROM articles a
         JOIN sources s ON s.id = a.source_id
         LEFT JOIN signals sig
           ON sig.article_id = a.id AND sig.user_id = @user
        WHERE (@sourceId IS NULL OR a.source_id = @sourceId)
          AND (@sourceId IS NOT NULL
               OR EXISTS (SELECT 1 FROM subscriptions sub
                           WHERE sub.source_id = a.source_id AND sub.user_id = @user))
        ORDER BY (a.published_at IS NULL), a.published_at DESC, a.id DESC
        LIMIT @limit OFFSET @offset`
    )
    .all({ user: USER_ID, sourceId, limit, offset }) as FeedItem[];
}

// The latest article from each pinned source, newest first. Backs the "Pinned"
// section at the top of the Following feed. Sources with no fetched articles
// yet are simply omitted (nothing to show). Shares the FeedItem shape so it can
// render with the same card as the feed.
export function getPinnedFeedItems(): FeedItem[] {
  return db()
    .prepare(
      `SELECT a.id, a.title, a.url, a.summary, a.image_url, a.image_width, a.published_at,
              s.id AS source_id, s.name AS source_name, s.affiliation,
              sig.value AS signal
         FROM pins p
         JOIN sources s ON s.id = p.source_id
         JOIN articles a ON a.id = (
              SELECT a2.id FROM articles a2
               WHERE a2.source_id = p.source_id
               ORDER BY (a2.published_at IS NULL), a2.published_at DESC, a2.id DESC
               LIMIT 1
            )
         LEFT JOIN signals sig ON sig.article_id = a.id AND sig.user_id = @user
        WHERE p.user_id = @user
        ORDER BY (a.published_at IS NULL), a.published_at DESC, a.id DESC`
    )
    .all({ user: USER_ID }) as FeedItem[];
}

// The For You article pool: articles from ALL known sources — followed
// (exploit) and unfollowed (explore) blended together — newest first for now.
// This is the pre-ranking order; R1 will later sort by score, which is what
// actually interleaves taste-matched followed posts with exploratory unfollowed
// ones. Unfollowed articles exist because the discover-ingest job copies sampled
// catalog feeds into `sources` (without subscribing) and fetches their articles.
export function getDiscoverArticles(
  opts: { limit?: number; offset?: number; onlyUnfollowed?: boolean } = {}
): FeedItem[] {
  const { limit = 150, offset = 0, onlyUnfollowed = false } = opts;
  return db()
    .prepare(
      `SELECT a.id, a.title, a.url, a.summary, a.image_url, a.image_width, a.published_at,
              s.id AS source_id, s.name AS source_name, s.affiliation,
              sig.value AS signal
         FROM articles a
         JOIN sources s ON s.id = a.source_id
         LEFT JOIN signals sig ON sig.article_id = a.id AND sig.user_id = @user
        WHERE (@onlyUnfollowed = 0 OR NOT EXISTS (
                SELECT 1 FROM subscriptions sub
                 WHERE sub.source_id = a.source_id AND sub.user_id = @user
              ))
          -- English only: keep English-declared feeds and undeclared ones,
          -- drop feeds that explicitly declare a non-English language.
          AND (s.language IS NULL OR s.language LIKE 'en%')
        ORDER BY (a.published_at IS NULL), a.published_at DESC, a.id DESC
        LIMIT @limit OFFSET @offset`
    )
    .all({ user: USER_ID, limit, offset, onlyUnfollowed: onlyUnfollowed ? 1 : 0 }) as FeedItem[];
}

// R1 v0: rank the For You pool by TasteMatch (TF-IDF cosine vs your like/less
// vector) + SourceAffinity (how close a candidate's feed is to the feeds you
// follow), newest-first as the tiebreak. Ranks a bounded window of the most
// recent candidates (POOL_CAP) so cost stays flat; when neither signal exists it
// falls back to pure recency. Pagination slices the deterministic ranking, so
// successive loadMore calls stay stable. Weights are the tuning knobs.
const RANK_POOL_CAP = 500;
const W_TASTE = 1.0;
const W_AFFINITY = 0.6;
// Cap how many articles a single feed can contribute to the ranked list, so one
// high-volume source (e.g. a news megafeed) can't flood For You — affinity is
// per-feed, so without this all of a feed's articles tie and cluster together.
const MAX_PER_SOURCE = 3;
// How many completely-random unfollowed articles to sprinkle into the top of For
// You (the ε-greedy Explore arm — serendipity independent of taste/affinity).
const EXPLORE_COUNT = 3;
// Recent articles per feed folded into its similarity profile — a single poll's
// worth is plenty (see RECS: breadth over depth).
const PROFILE_ITEMS_PER_FEED = 30;

export function getRankedDiscoverArticles(
  opts: { limit?: number; offset?: number; onlyUnfollowed?: boolean } = {}
): FeedItem[] {
  const { limit = 150, offset = 0, onlyUnfollowed = false } = opts;
  const d = db();

  const pool = getDiscoverArticles({ limit: RANK_POOL_CAP, offset: 0, onlyUnfollowed });

  // --- TasteMatch ---
  const labeled = d
    .prepare(
      `SELECT a.title, a.summary, sig.value AS signal
         FROM signals sig
         JOIN articles a ON a.id = sig.article_id
        WHERE sig.user_id = ? AND sig.value != 0`
    )
    .all(USER_ID) as Array<{ title: string; summary: string | null; signal: number }>;
  const scorer = buildTasteScorer(
    pool.map((a) => `${a.title} ${a.summary ?? ""}`),
    labeled
  );

  // --- SourceAffinity: profile the followed feeds + the pool's candidate feeds ---
  const followed = new Set(
    (d.prepare("SELECT source_id FROM subscriptions WHERE user_id = ?").all(USER_ID) as Array<{
      source_id: string;
    }>).map((r) => r.source_id)
  );
  const feedIds = Array.from(new Set([...pool.map((a) => a.source_id), ...followed]));
  const affinity = buildSourceAffinity(feedIds.length ? feedDocs(d, feedIds, followed) : []);

  // First page gets a few random explore picks sprinkled in; later pages don't
  // (keeps offset pagination stable — FeedList dedupes any later overlap by id).
  const withExplore = (page: FeedItem[]) =>
    offset === 0 ? injectRandomExplore(d, page, limit) : page;

  // Cold-start on both signals → keep recency order.
  if (!scorer.hasTaste && !affinity.hasFollowedProfile) {
    return withExplore(pool.slice(offset, offset + limit));
  }

  const ranked = pool
    .map((a, i) => {
      const e = scorer.explain(`${a.title} ${a.summary ?? ""}`);
      // SourceAffinity only applies to UNFOLLOWED candidates — it's there to
      // decide which feeds you don't follow are worth surfacing. Applying it to
      // followed feeds would just reward them for being in their own centroid,
      // burying all exploration (they'd always win). Followed articles rank on
      // TasteMatch alone.
      const aff = followed.has(a.source_id) ? 0 : affinity.affinity(a.source_id);
      return { a, i, taste: e.score, aff, terms: e.terms, score: W_TASTE * e.score + W_AFFINITY * aff };
    })
    .sort((x, y) => y.score - x.score || x.i - y.i)
    .map((r) => ({
      ...r.a,
      rank: { score: r.score, taste: r.taste, affinity: r.aff, terms: r.terms },
    }));

  // Per-source cap: keep at most MAX_PER_SOURCE from any one feed so a single
  // high-volume source can't flood the list. Applied to the full ranking before
  // pagination so offset/limit slices stay consistent across loadMore calls.
  const perSource = new Map<string, number>();
  const capped = ranked.filter((a) => {
    const n = perSource.get(a.source_id) ?? 0;
    if (n >= MAX_PER_SOURCE) return false;
    perSource.set(a.source_id, n + 1);
    return true;
  });

  return withExplore(capped.slice(offset, offset + limit));
}

// Pull EXPLORE_COUNT random unfollowed articles (excluding ids already on the
// page) as FeedItems tagged rank.explore, for the serendipity injection.
function randomExploreArticles(
  d: Database.Database,
  exclude: Set<number>,
  n: number
): FeedItem[] {
  const rows = d
    .prepare(
      `SELECT a.id, a.title, a.url, a.summary, a.image_url, a.image_width, a.published_at,
              s.id AS source_id, s.name AS source_name, s.affiliation,
              sig.value AS signal
         FROM articles a
         JOIN sources s ON s.id = a.source_id
         LEFT JOIN signals sig ON sig.article_id = a.id AND sig.user_id = @user
        WHERE NOT EXISTS (
                SELECT 1 FROM subscriptions sub
                 WHERE sub.source_id = a.source_id AND sub.user_id = @user
              )
          AND (s.language IS NULL OR s.language LIKE 'en%')
        ORDER BY RANDOM()
        LIMIT @take`
    )
    .all({ user: USER_ID, take: n * 4 }) as FeedItem[];

  const picks: FeedItem[] = [];
  for (const r of rows) {
    if (exclude.has(r.id)) continue;
    picks.push({ ...r, rank: { score: 0, taste: 0, affinity: 0, terms: [], explore: true } });
    if (picks.length >= n) break;
  }
  return picks;
}

// Splice random explore picks into a page at spaced positions near the top.
function injectRandomExplore(
  d: Database.Database,
  page: FeedItem[],
  limit: number
): FeedItem[] {
  const exclude = new Set(page.map((a) => a.id));
  const randoms = randomExploreArticles(d, exclude, EXPLORE_COUNT);
  if (randoms.length === 0) return page;
  const result = [...page];
  const step = Math.max(1, Math.floor(limit / (EXPLORE_COUNT + 1)));
  randoms.forEach((r, i) => {
    const idx = Math.min(result.length, (i + 1) * step + i);
    result.splice(idx, 0, r);
  });
  return result;
}

// Build per-feed profile documents (concatenated title+summary over each feed's
// most recent PROFILE_ITEMS_PER_FEED articles) for the given source ids.
function feedDocs(
  d: Database.Database,
  feedIds: string[],
  followed: Set<string>
): FeedDoc[] {
  const placeholders = feedIds.map(() => "?").join(",");
  const rows = d
    .prepare(
      `SELECT a.source_id, a.title, a.summary, s.category
         FROM articles a
         JOIN sources s ON s.id = a.source_id
        WHERE a.source_id IN (${placeholders})
        ORDER BY (a.published_at IS NULL), a.published_at DESC, a.id DESC`
    )
    .all(...feedIds) as Array<{
    source_id: string;
    title: string;
    summary: string | null;
    category: string | null;
  }>;

  const byFeed = new Map<string, { texts: string[]; category: string | null }>();
  for (const r of rows) {
    let entry = byFeed.get(r.source_id);
    if (!entry) {
      entry = { texts: [], category: r.category };
      byFeed.set(r.source_id, entry);
    }
    if (entry.texts.length < PROFILE_ITEMS_PER_FEED) {
      entry.texts.push(`${r.title} ${r.summary ?? ""}`);
    }
  }

  return Array.from(byFeed, ([sourceId, e]) => ({
    sourceId,
    text: e.texts.join(" "),
    category: e.category,
    followed: followed.has(sourceId),
  }));
}

export type Source = {
  id: string;
  name: string;
  homepage: string | null;
  category: string | null;
  affiliation: string | null;
};

export function getSource(id: string): Source | undefined {
  return db()
    .prepare(
      "SELECT id, name, homepage, category, affiliation FROM sources WHERE id = ?"
    )
    .get(id) as Source | undefined;
}

// How many sources the user currently subscribes to (the "Following N" count).
export function getFollowedCount(): number {
  const row = db()
    .prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?")
    .get(USER_ID) as { n: number };
  return row.n;
}

// Whether the user follows this source (drives the source page's follow toggle).
export function isFollowing(sourceId: string): boolean {
  const row = db()
    .prepare("SELECT 1 AS x FROM subscriptions WHERE user_id = ? AND source_id = ?")
    .get(USER_ID, sourceId);
  return !!row;
}

// Whether the user has pinned this source (drives the source page's Pin button).
export function isPinned(sourceId: string): boolean {
  const row = db()
    .prepare("SELECT 1 AS x FROM pins WHERE user_id = ? AND source_id = ?")
    .get(USER_ID, sourceId);
  return !!row;
}

export type FollowedSource = Source & { pinned: boolean };

// Every source the user follows, alphabetically, each flagged with whether it's
// pinned. Backs the /following-list page (Pin + Unfollow controls per row).
export function getFollowedSources(): FollowedSource[] {
  const rows = db()
    .prepare(
      `SELECT s.id, s.name, s.homepage, s.category, s.affiliation,
              (p.source_id IS NOT NULL) AS pinned
         FROM sources s
         JOIN subscriptions sub ON sub.source_id = s.id AND sub.user_id = @user
         LEFT JOIN pins p ON p.source_id = s.id AND p.user_id = @user
        ORDER BY s.name COLLATE NOCASE ASC`
    )
    .all({ user: USER_ID }) as Array<Source & { pinned: number }>;
  // SQLite returns the boolean expression as 0/1 — normalize to a real boolean.
  return rows.map((r) => ({ ...r, pinned: !!r.pinned }));
}

export type DiscoverFeed = {
  id: string;
  title: string;
  url: string;
  homepage: string | null;
  category: string | null;
  description: string | null;
  provenance: string | null;
  sort_key: number;
};

// The For You pool: catalog feeds the user does NOT already follow, in stable
// shuffled order. Keyset-paginated by sort_key (pass the last row's sort_key as
// `afterKey`) so following feeds mid-scroll never shifts or duplicates a page.
export function getDiscoverFeeds(
  opts: { limit?: number; afterKey?: number | null } = {}
): DiscoverFeed[] {
  const { limit = 15, afterKey = null } = opts;
  return db()
    .prepare(
      `SELECT c.id, c.title, c.url, c.homepage, c.category, c.description, c.provenance, c.sort_key
         FROM catalog c
        WHERE (@afterKey IS NULL OR c.sort_key > @afterKey)
          AND c.url NOT IN (
                SELECT s.url FROM sources s
                  JOIN subscriptions sub ON sub.source_id = s.id AND sub.user_id = @user
              )
        ORDER BY c.sort_key ASC, c.id ASC
        LIMIT @limit`
    )
    .all({ user: USER_ID, afterKey, limit }) as DiscoverFeed[];
}

// ---- Writes ---------------------------------------------------------------

// Signal is a running score in [-50, 50] (Like nudges up, Less nudges down).
// The client owns the counter and pushes the desired absolute value here, so
// rapid repeated clicks are just last-write-wins. A value of 0 clears the row.
export const SIGNAL_MAX = 50;

export function setSignal(articleId: number, value: number): number {
  const clamped = Math.max(-SIGNAL_MAX, Math.min(SIGNAL_MAX, Math.trunc(value)));
  const d = db();

  if (clamped === 0) {
    d.prepare("DELETE FROM signals WHERE user_id = ? AND article_id = ?").run(
      USER_ID,
      articleId
    );
    return 0;
  }
  d.prepare(
    `INSERT INTO signals (user_id, article_id, value, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, article_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`
  ).run(USER_ID, articleId, clamped, Math.floor(Date.now() / 1000));
  return clamped;
}

// Follow a catalog feed: copy it into `sources` (so ingest will poll it) and
// subscribe. Returns {id,name,url} so the caller can fetch it immediately.
export function followFromCatalog(
  catalogId: string
): { id: string; name: string; url: string } | null {
  const d = db();
  const c = d
    .prepare(
      "SELECT id, title, url, homepage, category, provenance FROM catalog WHERE id = ?"
    )
    .get(catalogId) as
    | {
        id: string;
        title: string;
        url: string;
        homepage: string | null;
        category: string | null;
        provenance: string | null;
      }
    | undefined;
  if (!c) return null;

  const tx = d.transaction(() => {
    d.prepare(
      `INSERT INTO sources (id, name, url, homepage, category, affiliation, note)
       VALUES (@id, @name, @url, @homepage, @category, @affiliation, NULL)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, url=excluded.url, homepage=excluded.homepage,
         category=excluded.category, affiliation=excluded.affiliation`
    ).run({
      id: c.id,
      name: c.title,
      url: c.url,
      homepage: c.homepage,
      category: c.category,
      affiliation: c.provenance,
    });
    d.prepare(
      "INSERT OR IGNORE INTO subscriptions (user_id, source_id) VALUES (?, ?)"
    ).run(USER_ID, c.id);
  });
  tx();

  return { id: c.id, name: c.title, url: c.url };
}

// Unfollow: drop the subscription. The source row and any fetched articles
// stay (ingest only polls subscribed sources, so it simply stops updating).
export function unfollowSource(sourceId: string) {
  db()
    .prepare("DELETE FROM subscriptions WHERE user_id = ? AND source_id = ?")
    .run(USER_ID, sourceId);
}

// Re-follow a source already present in the sources table (e.g. after unfollow
// on its own page). Its previously-fetched articles become visible again.
export function subscribe(sourceId: string) {
  db()
    .prepare("INSERT OR IGNORE INTO subscriptions (user_id, source_id) VALUES (?, ?)")
    .run(USER_ID, sourceId);
}

// Pin / unpin a source. Idempotent either way.
export function setPin(sourceId: string, pinned: boolean) {
  const d = db();
  if (pinned) {
    d.prepare(
      "INSERT OR IGNORE INTO pins (user_id, source_id, created_at) VALUES (?, ?, ?)"
    ).run(USER_ID, sourceId, Math.floor(Date.now() / 1000));
  } else {
    d.prepare("DELETE FROM pins WHERE user_id = ? AND source_id = ?").run(
      USER_ID,
      sourceId
    );
  }
}
