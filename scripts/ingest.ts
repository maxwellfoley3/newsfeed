/**
 * Ingest job — poll every source's RSS feed, parse, dedup, store.
 * Run: npm run ingest   (later: on a schedule / cron)
 */
import Parser from "rss-parser";
import { db } from "../lib/db";

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

async function main() {
  const database = db();
  const sources = database
    .prepare("SELECT id, name, url FROM sources")
    .all() as Array<{ id: string; name: string; url: string }>;

  const upsertArticle = database.prepare(`
    INSERT INTO articles (source_id, guid, title, url, author, summary, image_url, image_width, published_at, fetched_at)
    VALUES (@source_id, @guid, @title, @url, @author, @summary, @image_url, @image_width, @published_at, @fetched_at)
    ON CONFLICT(source_id, guid) DO UPDATE SET
      image_url = excluded.image_url,
      image_width = excluded.image_width
      WHERE articles.image_url IS NULL AND excluded.image_url IS NOT NULL
  `);

  const now = Math.floor(Date.now() / 1000);
  let totalNew = 0;

  for (const source of sources) {
    try {
      const feed = await parser.parseURL(source.url);
      type FeedEntry = Parser.Item & {
        "media:content"?: MediaNode | MediaNode[];
        "media:thumbnail"?: MediaNode | MediaNode[];
      };
      const insertMany = database.transaction((items: FeedEntry[]) => {
        let added = 0;
        for (const item of items) {
          const url = item.link?.trim();
          const title = item.title?.trim();
          if (!url || !title) continue;
          const guid = (item.guid || item.link || url).trim();
          const summary =
            clean((item as { contentSnippet?: string }).contentSnippet) ??
            clean(item.content);
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
      totalNew += added;
      console.log(`  ✓ ${source.name.padEnd(18)} +${added} new (${feed.items?.length ?? 0} in feed)`);
    } catch (err) {
      console.log(`  ✗ ${source.name.padEnd(18)} FAILED: ${(err as Error).message}`);
    }
  }

  console.log(`\nDone. ${totalNew} new articles across ${sources.length} sources.`);
}

main();
