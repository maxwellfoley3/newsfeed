# RECS — the recommendations engine

_Status: design doc v0.1 — direction, not a spec. Companion to SCOPE.md._

## Why this exists
The reader half of newsfeed is done: Following (chronological) + For You
(Discover — browse a 2,528-feed catalog and follow sources). Discover is useful
but dumb: it shows *feeds*, not *the right articles*, and it knows nothing about
you. This doc designs the part that makes newsfeed itself — a small
recommendations engine that (R1) ranks **articles** into For You, and (R2) links
articles to relevant **Polymarket / Kalshi prediction markets**.

The engine is the product. Everything below is judged against SCOPE's sentence:
**"was this worth your time," not "did this keep you scrolling."**

## The decision that shapes everything: the objective function
A recommender optimizes a target. The default target — clicks / dwell time —
**is banned here**, because it rebuilds the engagement-bait feed newsfeed exists
to replace. Clickbait wins on clicks; outrage wins on dwell. Optimizing those
betrays the thesis.

So the training target is the **explicit "worth it" signal** (the like / "less"
buttons — which today persist to `signals` but train nothing), backed by
**content-quality priors** and, later, an **LLM's judgment of substance**. We do
**not** train on behavioral engagement. Consequences:
- Collaborative filtering is out — no behavioral data, and only one user anyway.
- This is a **content-based** recommender with light personalization, in a
  permanent **cold-start** regime (signal is deliberately sparse + high-quality).
- Quality is a first-class ranking feature, not an afterthought. The engine
  should *demote* engagement-bait even when it matches your topics.

## Two recommenders, one shape
- **R1 — article ranking.** Populate For You with the articles most worth your
  time, from followed sources + exploratory picks from unfollowed ones.
- **R2 — market linking.** For a story in the feed, surface the prediction
  markets it bears on, with current probabilities. Turns "here's news" into
  "here's the uncertain future this describes, priced."

**Unifying insight:** the Discover page we already shipped is not a separate
feature — it's the **exploration arm of R1**. A recommender is exploitation
(matches your taste) + exploration (things it's unsure about, incl. new
sources). For You = taste-ranked articles blended with discovery injections. We
generalize what exists rather than replacing it.

## Data we have (and don't)
- **Have:** `articles` (title, short summary, source, published_at, image),
  `signals` (like +1 / less −1, explicit), `sources` + categories, `catalog`
  (2,528 feeds w/ categories).
- **Don't have:** article full text (titles + ~300-char summaries only), any
  embeddings, click/read/dwell events. **And we deliberately won't add dwell
  tracking** (wrong objective). We *may* add a lightweight post-read "worth it?"
  affordance to grow the explicit signal — but that's a SCOPE-level choice.

## Recorded decision: build R1 first, R2 later
We build **R1 (article ranking) first** and ship it before touching **R2 (market
linking)**. R2 is genuinely exciting and demo-worthy, but it's a distraction
until the core loop — rank the articles you actually want — works. R2 stays fully
designed here but explicitly deferred; don't start it until R1 v0 is live and
useful.

## Recorded decision: must work with almost no user input
The algorithm has to be **good on day one, before you've liked a single
article** — and stay useful for a user who almost never touches the buttons. We
optimize for the near-zero-input case, not the data-rich one:
- **Strong priors carry cold-start.** Quality (anti-clickbait) + freshness +
  source/topic diversity + light exploration must produce a genuinely good feed
  with an empty `signals` table. Personalization is a bonus layer on top, not a
  prerequisite.
- **Every label is precious, so spend it well.** With sparse input, a single
  like/less should move the feed noticeably (high learning rate on a small
  content-based profile) — while diversity + exploration guard against
  overreacting to one signal.
- **Passive-friendly.** A user who only ever scrolls should still get better
  results over time from implicit *followed-source* and *topic* structure, never
  from dwell/click tracking (banned — wrong objective).
- Consequence: never gate the experience on "train it first." No cold-start
  empty states, no "like 10 things to begin."

## Recorded decision: lexical first, LLM as upgrade
Ship **dependency-free, content-based** versions first (TF-IDF / BM25 /
heuristics). Add an **LLM re-rank / matcher (Claude Haiku)** as a clearly-scoped
v1 once the loop works. Rationale:
- Keeps the engine small and debuggable; no first-day API dependency, cost, or
  latency.
- **Skip an embeddings service entirely.** Anthropic has no embeddings API
  (they point to Voyage); adding Voyage/OpenAI/local infra is exactly the weight
  we're avoiding. Lexical retrieval + (later) LLM re-rank on a shortlist gets
  most of the value with zero new infrastructure.
- The LLM, when added, judges **substance / worth-your-time** and returns a
  **reason** — which classic scoring can't. That's the differentiator, so it's
  worth doing, just not first.

## Architecture
A scoring job that runs right after `ingest` (mirrors the existing job shape):

```
candidate generation → scoring → diversification → cache ranked list → serve
```

- **New tables (sketch):**
  - `article_terms` — cached TF-IDF term weights per article (or computed on the
    fly at this scale; measure first).
  - `markets` — synced Polymarket/Kalshi markets `{id, platform, question, url,
    close_time, probability, category, fetched_at}`.
  - `article_market_links` — `{article_id, market_id, score}` above a threshold.
  - optionally `recs_cache` — the materialized For You ranking per user.
- **Jobs:** `score` (R1, after ingest), `sync-markets` (R2, daily),
  `link-markets` (R2, after ingest). All thin CLI wrappers over `lib/` cores,
  same pattern as `lib/ingest.ts`.
- **Serve:** For You reads the cached R1 ranking (blended exploit+explore); a
  "Markets in the news" module / per-article chip reads `article_market_links`.

## R1 — article ranking
**v0 (lexical, no deps).** Per candidate article:

```
score = w1·TasteMatch + w2·Quality + w3·Freshness − w4·Redundancy
        + w5·SourceAffinity + ε·Explore
```

- **TasteMatch** — TF-IDF vectors over title+summary. Taste vector =
  Σ(signal · article_vector) over labeled articles (like +1, less −1),
  normalized. `cosine(candidate, taste)`. Cold-start → ≈0, degrades gracefully
  to the other terms.
- **Quality prior** — source reputation + **anti-clickbait title heuristics**
  (ALL-CAPS ratio, "you won't believe", "N things", excess punctuation/emoji).
  Encodes the thesis directly: bait is demoted even on-topic.
- **Freshness** — recency decay.
- **Redundancy** — down-weight near-duplicate stories (same wire copy across
  sources) via title similarity, so the feed isn't ten takes on one event.
- **SourceAffinity** — how close a candidate's *feed* is to the ones you
  already follow, giving the recommender the feed-to-feed "network" sense that
  pure article-text matching lacks (see the feed-similarity graph below). Works
  from follows alone, so it carries cold-start before any like/less exists.
- **Explore** — ε-greedy injection of unfollowed-source articles. This *is*
  Discover, folded in as the exploration arm.

### Feed-similarity graph + SourceAffinity (planned addition)
Pure article-text TF-IDF has no notion of feed-to-feed relatedness, so it can't
surface sources *proximal* to the ones you follow. A **true** co-follow network
("people who follow X also follow Y") needs multi-user data we don't have
(single user) — so we derive proximity from **content + metadata** instead. No
collaborative filtering, no embeddings, no new infrastructure:

- **Feed profile.** Aggregate a feed's ingested items (title + summary) into one
  feed-level TF-IDF vector — the feed's characteristic vocabulary.
- **Similarity graph.** feed↔feed cosine over those profiles, blended with
  normalized-category co-membership (see `lib/categories.ts`) as a prior =
  weighted edges. "Proximal" = high similarity to your followed set.
- **SourceAffinity term.** Score a candidate article by its feed's affinity to
  the centroid of your followed feeds' profiles → the `+ w5·SourceAffinity`
  term above. Because it keys off *follows*, not likes, it makes recommendations
  useful on day one (fixes TasteMatch's cold-start).
- **Caveat.** This is content/category proximity, not social co-follow
  proximity; the richer version needs multiple users.

**How much of each feed must we ingest to build this?** Breadth, not depth. A
feed-level TF-IDF profile is stable with even ~10–30 items — i.e. a *single
poll's worth* (RSS feeds advertise ~10–50 recent items, and we only have
titles + ~300-char summaries anyway, not full text). So the existing
discover-ingest (one poll per sampled feed) already yields enough text to place
a feed in the graph; repeated polls only sharpen the profile over time. The real
cost is polling *enough distinct feeds* of the 2,528, not fetching each deeply —
no full-text fetch or historical backfill required.

**v1 (LLM re-rank).** Lexical score shortlists ~30 → one batched Haiku call:
"here are headlines this user liked / marked less; rank these candidates by how
worth-their-time they are; penalize engagement-bait; return id, score, one-line
reason." Show the reason as "why recommended." Cheap, explainable, on-thesis.

## R2 — market linking
- **sync-markets** — pull active markets from Polymarket Gamma
  (`gamma-api.polymarket.com`) + Kalshi (`api.elections.kalshi.com`) into
  `markets`; refresh daily; drop closed/expired.
- **match** — article (title+summary) ↔ market question.
  - v0: keyword / entity overlap (BM25) with a **precision-biased threshold**.
  - v1: the same Haiku pass — "which of these markets does this story relate
    to, if any?" — returning only confident links.
  - **Precision ≫ recall.** One great match beats five loose ones; a dumb match
    ("Fed article" → "snow in Miami") destroys trust. Better to show nothing.
- **serve** — "Markets in the news" module or a chip under matched articles:
  *question · current probability · link*.

R2 is the most novel and demo-worthy slice ("a reader that turns headlines into
calibrated forecasts") and is largely **independent of R1** — it can be built in
parallel or first if impact is the priority.

## Phased roadmap (decided)
**R1 first, R2 later** — not just an ordering preference, a commitment (see
recorded decision above).
1. **R1 v0** — lexical article ranker; strong cold-start priors so it's good
   with an empty `signals` table; make like/less matter; Discover becomes the
   explore arm. No deps. Proves the loop.
2. **R1 v1** — Haiku re-rank on the shortlist, with reasons.
3. **R2 (later)** — market sync + lexical match, then Haiku match. Deferred
   until R1 is live and useful; do not start early.

## Honest risks / open questions
- **Signal starvation.** Until enough like/less labels exist, R1 runs on
  quality+freshness+diversity priors only. Step zero may be *using the app and
  generating labels* — and making the buttons feel worth pressing. Do we add a
  gentle "worth it?" prompt after opening an article? (SCOPE call — it must not
  become a compulsion nag.)
- **Match precision (R2)** is the whole ballgame; needs a real eval, even if
  it's just a hand-labeled set of 30 article→market pairs.
- **Cost/latency** of the LLM passes — negligible with Haiku + batching +
  per-article caching, but it's the project's first LLM dependency; gate it
  behind a clear v1 boundary.
- **Diversity vs. taste** — a pure taste-max feed narrows into a bubble;
  the explore term and redundancy penalty are the guardrails. Tune, don't skip.

## Success criteria
- For You beats chronological on a simple offline check: articles you later like
  rank higher than ones you mark "less."
- R2 links are things you'd actually click — precision on a hand-labeled set
  high enough that a shown market rarely feels wrong.
- The whole engine stays small: no embeddings service, jobs run in seconds,
  every score is explainable in one sentence.
