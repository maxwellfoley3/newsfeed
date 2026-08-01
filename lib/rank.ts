// R1 v0 — TasteMatch only. Pure, dependency-free TF-IDF cosine between a
// candidate article's text (title + summary) and a "taste vector" built from
// the articles you've liked/marked-less. No embeddings, no LLM, no new tables.
// Cold-start (no signal): the scorer reports hasTaste=false and callers fall
// back to recency, so an empty signals table still yields a sensible feed.

const STOPWORDS = new Set(
  ("the a an and or but of to in on for with at by from as is are was were be " +
    "been being this that these those it its into over after about new says said " +
    "has have had will would can could you your they their we our not no")
    .split(" ")
);

export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g);
  if (!matches) return [];
  return matches.filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

type Vec = Map<string, number>;

function termFreq(tokens: string[]): Vec {
  const m: Vec = new Map();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

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

export type Labeled = { title: string; summary: string | null; signal: number };

// Build a scorer over a fixed corpus: candidate texts + labeled texts share one
// IDF so term weights are comparable. `score(text)` returns cosine similarity in
// [-1, 1] to the taste vector (negative = resembles things you marked "less").
export function buildTasteScorer(
  candidateTexts: string[],
  labeled: Labeled[]
): { hasTaste: boolean; explain: (text: string) => { score: number; terms: string[] } } {
  const labeledTexts = labeled.map((l) => `${l.title} ${l.summary ?? ""}`);
  const corpus = [...candidateTexts, ...labeledTexts].map(tokenize);
  const N = corpus.length || 1;

  const df: Map<string, number> = new Map();
  for (const toks of corpus) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = (t: string) => Math.log(N / (1 + (df.get(t) ?? 0))) + 1;

  function tfidf(tokens: string[]): Vec {
    const v: Vec = new Map();
    for (const [t, c] of termFreq(tokens)) v.set(t, c * idf(t));
    return v;
  }

  // Taste vector = Σ (signal · tfidf(labeled)). Stronger signals (±50 running
  // score) weigh more; "less" (negative) pushes the vector away from that topic.
  const taste: Vec = new Map();
  for (const l of labeled) {
    const v = tfidf(tokenize(`${l.title} ${l.summary ?? ""}`));
    for (const [t, w] of v) taste.set(t, (taste.get(t) ?? 0) + l.signal * w);
  }
  const tasteNorm = norm(taste);
  const hasTaste = tasteNorm > 0;

  return {
    hasTaste,
    // Cosine score plus the terms that contributed most to it (the "why"),
    // for the admin-mode debug badge. Terms are ranked by their share of the
    // dot product (candidate weight × taste weight), positive contributors only.
    explain: (text: string): { score: number; terms: string[] } => {
      if (!hasTaste) return { score: 0, terms: [] };
      const v = tfidf(tokenize(text));
      const n = norm(v);
      if (n === 0) return { score: 0, terms: [] };
      const score = dot(v, taste) / (n * tasteNorm);
      const contrib: Array<[string, number]> = [];
      for (const [t, w] of v) {
        const tw = taste.get(t);
        if (tw && tw > 0) contrib.push([t, w * tw]);
      }
      contrib.sort((a, b) => b[1] - a[1]);
      return { score, terms: contrib.slice(0, 3).map((c) => c[0]) };
    },
  };
}
