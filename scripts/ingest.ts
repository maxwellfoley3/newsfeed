/**
 * Ingest job — poll every source's RSS feed, parse, dedup, store.
 * Run: npm run ingest   (later: on a schedule / cron)
 */
import Parser from "rss-parser";
import { db } from "../lib/db";

const parser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": "newsfeed/0.1 (+personal reader)" },
});

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

async function main() {
  const database = db();
  const sources = database
    .prepare("SELECT id, name, url FROM sources")
    .all() as Array<{ id: string; name: string; url: string }>;

  const upsertArticle = database.prepare(`
    INSERT INTO articles (source_id, guid, title, url, author, summary, published_at, fetched_at)
    VALUES (@source_id, @guid, @title, @url, @author, @summary, @published_at, @fetched_at)
    ON CONFLICT(source_id, guid) DO NOTHING
  `);

  const now = Math.floor(Date.now() / 1000);
  let totalNew = 0;

  for (const source of sources) {
    try {
      const feed = await parser.parseURL(source.url);
      const insertMany = database.transaction((items: Parser.Item[]) => {
        let added = 0;
        for (const item of items) {
          const url = item.link?.trim();
          const title = item.title?.trim();
          if (!url || !title) continue;
          const guid = (item.guid || item.link || url).trim();
          const summary =
            clean((item as { contentSnippet?: string }).contentSnippet) ??
            clean(item.content);
          const info = upsertArticle.run({
            source_id: source.id,
            guid,
            title,
            url,
            author: item.creator ?? (item as { author?: string }).author ?? null,
            summary,
            published_at: toEpochSeconds(item.isoDate),
            fetched_at: now,
          });
          added += info.changes;
        }
        return added;
      });
      const added = insertMany(feed.items ?? []);
      totalNew += added;
      console.log(`  ✓ ${source.name.padEnd(18)} +${added} new (${feed.items?.length ?? 0} in feed)`);
    } catch (err) {
      console.log(`  ✗ ${source.name.padEnd(18)} FAILED: ${(err as Error).message}`);
    }
  }

  console.log(`\nDone. ${totalNew} new articles across ${sources.length} sources.`);
}

main();
