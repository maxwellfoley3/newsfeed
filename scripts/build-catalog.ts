/**
 * Build the discovery catalog — the candidate pool the For You page draws from.
 *
 * Sources (both expose plain OPML):
 *   - awesome-rss-feeds (github.com/plenaryapp/awesome-rss-feeds): flat category
 *     OPML under recommended/without_category and countries/without_category.
 *   - ooh.directory: per-category OPML export, discovered by crawling /blogs/.
 *
 * Output: data/catalog.json (committed). Run manually, like ingest:
 *   npx tsx scripts/build-catalog.ts
 *
 * Feeds are NOT liveness-checked here (thousands of them) — dead ones fail
 * gracefully when someone actually follows them (fetch-on-follow ingest).
 */
import fs from "node:fs";
import path from "node:path";

const AWESOME_REPO = "plenaryapp/awesome-rss-feeds";
const AWESOME_DIRS = ["recommended/without_category", "countries/without_category"];
const OOH_ORIGIN = "https://ooh.directory";
const OOH_MAX_PAGES = 80; // crawl safety cap

type CatalogFeed = {
  id: string;
  title: string;
  url: string; // xmlUrl (the RSS/Atom feed)
  homepage: string | null;
  category: string;
  description: string | null;
  provenance: "awesome-rss-feeds" | "ooh.directory";
  sort_key: number; // stable pseudo-random order for the shuffled browse
};

// ---- tiny helpers ---------------------------------------------------------

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": "newsfeed-catalog/0.1 (+personal reader)", ...init?.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "feed";
}

// djb2 → base36, used for both the id suffix and the sort_key.
function hash32(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return h >>> 0;
}
const hash6 = (s: string) => hash32(s).toString(36).slice(0, 6).padStart(6, "0");
const sortKey = (id: string) => hash32("sk:" + id) / 0x100000000; // [0,1)

// Normalize a feed URL for dedup: drop scheme, lowercase host, strip trailing slash.
function feedKey(url: string): string {
  try {
    const u = new URL(url);
    return (u.host + u.pathname + u.search).toLowerCase().replace(/\/+$/, "");
  } catch {
    return url.toLowerCase().replace(/\/+$/, "");
  }
}

// Pull every <outline> that carries an xmlUrl (container outlines are skipped).
function parseOpml(
  xml: string
): Array<{ title: string; url: string; homepage: string | null; description: string | null }> {
  const out: Array<{ title: string; url: string; homepage: string | null; description: string | null }> = [];
  const outlineRe = /<outline\b([^>]*?)\/?>/gi;
  const attrRe = /([\w:]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = outlineRe.exec(xml))) {
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(m[1]))) attrs[a[1].toLowerCase()] = a[2];
    const url = attrs["xmlurl"];
    if (!url) continue;
    const title = decodeEntities(attrs["title"] || attrs["text"] || "");
    if (!title) continue;
    const desc = attrs["description"] ? decodeEntities(attrs["description"]) : null;
    out.push({
      title,
      url: decodeEntities(url),
      homepage: attrs["htmlurl"] ? decodeEntities(attrs["htmlurl"]) : null,
      description: desc && desc.length > 300 ? desc.slice(0, 297) + "…" : desc || null,
    });
  }
  return out;
}

// ---- source: awesome-rss-feeds -------------------------------------------

async function collectAwesome(): Promise<Array<Omit<CatalogFeed, "id" | "sort_key">>> {
  const feeds: Array<Omit<CatalogFeed, "id" | "sort_key">> = [];
  for (const dir of AWESOME_DIRS) {
    const listing = JSON.parse(
      await fetchText(`https://api.github.com/repos/${AWESOME_REPO}/contents/${dir}`)
    ) as Array<{ name: string; download_url: string }>;
    for (const file of listing) {
      if (!file.name.endsWith(".opml")) continue;
      const category = file.name.replace(/\.opml$/, "");
      try {
        const xml = await fetchText(file.download_url);
        for (const e of parseOpml(xml)) {
          feeds.push({ ...e, category, provenance: "awesome-rss-feeds" });
        }
      } catch (err) {
        console.warn(`  ! awesome ${file.name}: ${(err as Error).message}`);
      }
    }
  }
  return feeds;
}

// ---- source: ooh.directory (crawl /blogs/ for OPML export links) ----------

async function collectOoh(): Promise<Array<Omit<CatalogFeed, "id" | "sort_key">>> {
  const feeds: Array<Omit<CatalogFeed, "id" | "sort_key">> = [];
  const seenPages = new Set<string>();
  const opmlLinks = new Map<string, string>(); // opmlUrl -> category slug
  const queue: string[] = [`${OOH_ORIGIN}/`];

  while (queue.length && seenPages.size < OOH_MAX_PAGES) {
    const page = queue.shift()!;
    if (seenPages.has(page)) continue;
    seenPages.add(page);
    let html: string;
    try {
      html = await fetchText(page);
    } catch {
      continue;
    }
    // OPML export links on this page: /feeds/cats/<id>/opml/<slug>.xml
    for (const mm of html.matchAll(/href="(\/feeds\/cats\/[^"]+\/opml\/([a-z0-9-]+)\.xml)"/gi)) {
      opmlLinks.set(OOH_ORIGIN + mm[1], mm[2]);
    }
    // Enqueue more category / subcategory pages, one graph, capped.
    for (const mm of html.matchAll(/href="(\/blogs\/[a-z0-9-]+\/(?:[a-z0-9-]+\/)?)"/gi)) {
      const next = OOH_ORIGIN + mm[1];
      if (!seenPages.has(next)) queue.push(next);
    }
  }

  for (const [opmlUrl, category] of opmlLinks) {
    try {
      const xml = await fetchText(opmlUrl);
      for (const e of parseOpml(xml)) {
        feeds.push({ ...e, category, provenance: "ooh.directory" });
      }
    } catch (err) {
      console.warn(`  ! ooh ${opmlUrl}: ${(err as Error).message}`);
    }
  }
  console.log(`  ooh.directory: crawled ${seenPages.size} pages, ${opmlLinks.size} OPML exports`);
  return feeds;
}

// ---- compile --------------------------------------------------------------

async function main() {
  console.log("Building discovery catalog…");
  const awesome = await collectAwesome();
  console.log(`  awesome-rss-feeds: ${awesome.length} raw entries`);
  const ooh = await collectOoh();
  console.log(`  ooh.directory: ${ooh.length} raw entries`);

  // Dedup by normalized feed URL — awesome wins ties (curated categories).
  const byKey = new Map<string, Omit<CatalogFeed, "id" | "sort_key">>();
  for (const e of [...awesome, ...ooh]) {
    if (!/^https?:\/\//i.test(e.url)) continue; // drop non-http feeds
    const key = feedKey(e.url);
    if (!byKey.has(key)) byKey.set(key, e);
  }

  // Assign ids; a second guard keeps ids unique if two titles+urls collide.
  const usedIds = new Set<string>();
  const feeds: CatalogFeed[] = [];
  for (const e of byKey.values()) {
    let id = `${slug(e.title)}-${hash6(e.url)}`;
    while (usedIds.has(id)) id = `${id}-x`;
    usedIds.add(id);
    feeds.push({ ...e, id, sort_key: sortKey(id) });
  }
  feeds.sort((a, b) => a.sort_key - b.sort_key);

  const outPath = path.join(process.cwd(), "data", "catalog.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        count: feeds.length,
        sources: ["awesome-rss-feeds", "ooh.directory"],
        feeds,
      },
      null,
      2
    )
  );

  const byProv = feeds.reduce<Record<string, number>>((acc, f) => {
    acc[f.provenance] = (acc[f.provenance] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\nWrote ${feeds.length} unique feeds → data/catalog.json`);
  console.log(`  by provenance: ${JSON.stringify(byProv)}`);
  console.log(`  categories: ${new Set(feeds.map((f) => f.category)).size}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
