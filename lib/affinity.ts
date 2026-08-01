// R1 — SourceAffinity: the content/metadata "feed network". Each feed is
// profiled by a TF-IDF vector over its articles' text (treating each feed as one
// document); a candidate feed's affinity is the cosine of its profile to the
// centroid of the feeds you follow, nudged up when its normalized category
// overlaps a followed category. This gives the ranker feed-to-feed proximity
// without collaborative filtering, embeddings, or new infra. Cold-start-proof:
// it keys off *follows*, so it works before any like/less exists.
import { tokenize } from "./rank";
import { normalizeCategory } from "./categories";

type Vec = Map<string, number>;

function dot(a: Vec, b: Vec): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let s = 0;
  for (const [k, v] of small) {
    const w = large.get(k);
    if (w) s += v * w;
  }
  return s;
}

function norm(a: Vec): number {
  let s = 0;
  for (const v of a.values()) s += v * v;
  return Math.sqrt(s);
}

// Small bump when a candidate feed shares a (normalized) category with any
// followed feed — the category co-membership prior.
const CATEGORY_BONUS = 0.15;

export type FeedDoc = {
  sourceId: string;
  text: string; // concatenated title+summary across the feed's recent articles
  category: string | null;
  followed: boolean;
};

export function buildSourceAffinity(docs: FeedDoc[]): {
  affinity: (sourceId: string) => number;
  hasFollowedProfile: boolean;
} {
  // IDF is over feeds (document = feed), so terms common to many feeds count little.
  const tokensBySource = new Map<string, string[]>();
  for (const d of docs) tokensBySource.set(d.sourceId, tokenize(d.text));
  const nFeeds = tokensBySource.size || 1;

  const df = new Map<string, number>();
  for (const toks of tokensBySource.values())
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(nFeeds / (1 + (df.get(t) ?? 0))) + 1;

  const vecBySource = new Map<string, Vec>();
  for (const [sid, toks] of tokensBySource) {
    const counts = new Map<string, number>();
    for (const t of toks) counts.set(t, (counts.get(t) ?? 0) + 1);
    const v: Vec = new Map();
    for (const [t, c] of counts) v.set(t, c * idf(t));
    vecBySource.set(sid, v);
  }

  // Centroid of followed feeds + their normalized categories.
  const centroid: Vec = new Map();
  const followedCats = new Set<string>();
  for (const d of docs) {
    if (!d.followed) continue;
    const nc = normalizeCategory(d.category);
    if (nc) followedCats.add(nc);
    const v = vecBySource.get(d.sourceId);
    if (v) for (const [t, w] of v) centroid.set(t, (centroid.get(t) ?? 0) + w);
  }
  const centroidNorm = norm(centroid);
  const hasFollowedProfile = centroidNorm > 0;

  const catBySource = new Map(
    docs.map((d) => [d.sourceId, normalizeCategory(d.category)] as const)
  );

  return {
    hasFollowedProfile,
    affinity: (sourceId: string) => {
      let a = 0;
      const v = vecBySource.get(sourceId);
      if (v && hasFollowedProfile) {
        const n = norm(v);
        if (n > 0) a = dot(v, centroid) / (n * centroidNorm);
      }
      if (a < 0) a = 0;
      const nc = catBySource.get(sourceId);
      if (nc && followedCats.has(nc)) a = Math.min(1, a + CATEGORY_BONUS);
      return a;
    },
  };
}
