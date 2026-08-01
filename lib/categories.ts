// Category normalization across catalogs. ooh.directory uses lowercase slugs
// (e.g. "technology", "ai"), awesome-rss-feeds uses Title Case + country names
// (e.g. "Tech", "Web Development", "India"), and followed sources use a small
// set: world / tech / personal / development. This folds all of them into one
// canonical vocabulary so the discover-ingest category bias matches feeds from
// both catalogs (and so followed-category overlap actually works cross-catalog).

// Country names (awesome-rss-feeds is largely per-country news) → "world".
const COUNTRIES = new Set(
  [
    "india", "philippines", "australia", "mexico", "russia", "ukraine", "italy",
    "south africa", "france", "nigeria", "spain", "canada", "poland",
    "bangladesh", "united states", "usa", "pakistan", "japan", "iran", "brazil",
    "ireland", "hong kong sar china", "germany", "united kingdom", "uk",
    "indonesia", "myanmar (burma)", "countries",
  ]
);

// Explicit remaps to the canonical buckets. Anything not listed (and not a
// country) falls through as its own lowercased slug.
const REMAP: Record<string, string> = {
  technology: "tech",
  tech: "tech",
  ai: "tech",
  apple: "tech",
  android: "tech",
  hardware: "tech",
  internet: "tech",
  cryptocurrency: "tech",
  "cyber security": "tech",
  startups: "tech",
  programming: "development",
  "web development": "development",
  "android development": "development",
  "ios development": "development",
  engineering: "development",
  development: "development",
  news: "world",
  politics: "world",
  world: "world",
  personal: "personal",
};

export function normalizeCategory(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase().trim();
  if (REMAP[s]) return REMAP[s];
  if (COUNTRIES.has(s)) return "world";
  return s;
}
