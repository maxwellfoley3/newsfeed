// NOTE: server-side only. Imported by RSC/server actions and the ingest script.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

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
  _db = database;
  return _db;
}

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      url         TEXT NOT NULL,
      homepage    TEXT,
      category    TEXT,
      affiliation TEXT,
      note        TEXT
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id   TEXT NOT NULL,
      source_id TEXT NOT NULL,
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
  `);
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

// ---- Reads ----------------------------------------------------------------

export type FeedItem = {
  id: number;
  title: string;
  url: string;
  summary: string | null;
  published_at: number | null;
  source_id: string;
  source_name: string;
  affiliation: string | null;
  signal: number | null; // 1 like, -1 dislike, null none
};

// The Following feed: articles from subscribed sources, newest first.
// Pass a sourceId to restrict to a single source.
export function getFeed(opts: { sourceId?: string; limit?: number } = {}): FeedItem[] {
  const { sourceId = null, limit = 150 } = opts;
  return db()
    .prepare(
      `SELECT a.id, a.title, a.url, a.summary, a.published_at,
              s.id AS source_id, s.name AS source_name, s.affiliation,
              sig.value AS signal
         FROM articles a
         JOIN sources s ON s.id = a.source_id
         JOIN subscriptions sub
           ON sub.source_id = a.source_id AND sub.user_id = @user
         LEFT JOIN signals sig
           ON sig.article_id = a.id AND sig.user_id = @user
        WHERE (@sourceId IS NULL OR a.source_id = @sourceId)
        ORDER BY (a.published_at IS NULL), a.published_at DESC, a.id DESC
        LIMIT @limit`
    )
    .all({ user: USER_ID, sourceId, limit }) as FeedItem[];
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

// ---- Writes ---------------------------------------------------------------

// Toggle like/dislike. Clicking the active value again clears it.
export function setSignal(articleId: number, value: 1 | -1) {
  const d = db();
  const existing = d
    .prepare(
      "SELECT value FROM signals WHERE user_id = ? AND article_id = ?"
    )
    .get(USER_ID, articleId) as { value: number } | undefined;

  if (existing?.value === value) {
    d.prepare(
      "DELETE FROM signals WHERE user_id = ? AND article_id = ?"
    ).run(USER_ID, articleId);
    return;
  }
  d.prepare(
    `INSERT INTO signals (user_id, article_id, value, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, article_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`
  ).run(USER_ID, articleId, value, Math.floor(Date.now() / 1000));
}
