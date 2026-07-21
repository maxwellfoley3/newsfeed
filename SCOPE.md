# Scope — RSS News Feed (working title)

_Status: draft v0.1 — scoping in progress. Not a spec yet._

## One-liner
A Twitter-style reading app for RSS: a For You page, a Following feed, and
like/dislike signals that train a recommender — built to replace social-media
addiction with actual news reading.

## Problem & thesis
People want to be informed but get trapped in engagement-optimized social feeds
that reward outrage and infinite novelty. RSS has the clean, self-owned content —
but its readers feel like spreadsheets, so nobody uses them.

**Thesis:** Give RSS the *interaction model* people are addicted to (feed, likes,
"for you"), but point the algorithm at a different objective: **"was this worth
your time,"** not **"did this keep you scrolling."** That inverted objective is
the actual product, not the feed UI.

**Design consequence:** the north star should *kill* features, not just add them.
Anything that manufactures compulsion (streaks, red badges, endless auto-refresh,
outrage amplification) is out by principle, even when it would boost "engagement."

## Target user
- **v1 first user:** Maxwell — works if it's great for ~one person's set of feeds.
- **Eventual:** a stranger can sign up and get value with zero setup.
- Consequence: v1 can hardcode/curate rather than build self-serve onboarding,
  but the data model shouldn't *assume* single-user.

## The one job v1 must nail
> Open the app, and within 30 seconds be reading something worth reading —
> without a compulsion loop pulling me back in.

Everything below is judged against that sentence.

## Core flows (v1)
1. **Read the For You feed** — ranked mix of articles, incl. from sources I don't
   follow (discovery). Tap → read full article in-app.
2. **Read the Following feed** — pure chronological, only sources I follow. The
   "trust anchor": no algorithm touches it.
3. **Signal** — like / dislike an article; this reweights For You.
4. **Follow / unfollow a source** — from the seeded catalog, or from a discovered
   article's byline.
5. **Browse the catalog** — see available seeded sources, subscribe.

## In scope — v1
- Seeded catalog of RSS sources (curated by us, not user-added at first).
- Two feeds: For You (algorithmic) + Following (chronological).
- In-app reader view (full article text).
- Like / dislike, persisted, feeding the recommender.
- Discovery: For You can surface sources the user doesn't follow.
- Single account (me), but multi-user-shaped schema.

## Out of scope — v1 (explicit)
- User-submitted / arbitrary RSS URLs (catalog is curated).
- Social features: comments, sharing, followers, DMs.
- Notifications / push / email digests.
- Mobile native app (web first).
- Offline / save-for-later / highlights.
- Any streak / badge / compulsion mechanic (out by *principle*, not just time).
- Multi-device sync guarantees.

## Key entities (first pass — will firm up after flows)
- **Source** — an RSS feed (title, url, category, active?).
- **Article** — fetched item (source_id, title, author, url, published_at,
  content, fetched_at). Dedup key needed.
- **User** — even if just me at first.
- **Subscription** — user ↔ source (the Following set).
- **Signal** — user ↔ article, {like | dislike}, timestamp.
- **(later) FeedRank** — cached For You ordering / scores per user.

## Hard problems / risks — flag now, don't solve yet
1. **Full text read-in-app.** Many RSS feeds ship only summaries, not full
   articles. Getting full text means article-extraction (readability-style
   scraping) — and raises **copyright/ToS** questions for reproducing publisher
   content in-app. *This is the biggest technical + legal risk in your four
   choices.* May force a v1 compromise (reader view only for feeds that provide
   full content; bounce-out for the rest).
2. **Discovery cold-start.** A recommender that surfaces un-followed sources needs
   both a content pool and a signal. With one user and few likes, "For You" is
   guessing. v1 algorithm is probably simple (recency + category affinity +
   like/dislike keyword/source weighting), not ML.
3. **Catalog seeding is manual labor.** Someone curates the source list. Small at
   first (~20–50 quality feeds) — that's fine and on-thesis (quality over infinite).
4. **Fetch/ingest pipeline.** Polling feeds, dedup, storing content — a real
   backend job, needs a schedule.

## DECIDED — v1.0 scope (2026-07-21)
Stripped to the wedge. **v1.0 = a basic chronological RSS reader:**
- Seeded catalog + seeded initial follows (curated, not user-added).
- **Following feed only** — chronological, no algorithm.
- **No read-in-app** — tapping an article opens the publisher's site (new tab).
- Like/dislike: capturing the signal is optional here but cheap to store; it does
  nothing yet (no FYP to feed).
- Deferred: For You / discovery (v1.1+), in-app reader (later or never).

Rationale: no extraction, no copyright wall, no cold-start problem. Already a
better-feeling RSS reader than what exists, and it starts producing the signal
(follows, clicks, likes) a future FYP will need.

## Suggested v1 cut (my recommendation — for discussion)
You picked all three heavy options. If it were me sequencing for "livable daily
in ~a month," I'd ship in this order and stop when it's genuinely usable:

- **v1.0 (the wedge):** Seeded catalog + Following feed (chronological) + in-app
  reader for feeds that already provide full text + like/dislike stored.
  → This is *already a better RSS reader than exists* and validates read-in-app.
- **v1.1:** For You ranking over followed sources only (rerank, no discovery yet).
- **v1.2:** Discovery — For You surfaces un-followed catalog sources.

Discovery (#2 of your answers) is the magic but also the part most likely to feel
bad with one user and no signal. Earning it in v1.1→v1.2 de-risks the whole thing.

## Decisions log
- **Stack (2026-07-21):** Next 16 + React 19 + better-sqlite3 + Tailwind 4 + TS —
  matches PIS so no context-switch, and supports future FYP interactivity. Raw
  better-sqlite3 (not Drizzle) for v1 transparency.
- **No category filter in v1.0 (2026-07-21):** category is stored on sources but
  not a user-facing filter yet.
- **"Less" not "dislike" in UI:** the button downweights (future), it is not a
  hide-forever. Stored as signal value -1.

## Open questions
- Working name / brand? (folder + package still "newsfeed")
- Article content storage once in-app reader returns — full text in DB, or
  fetch-on-read + cache?
- Ingest schedule — cron? on-demand? interval? (currently manual `npm run ingest`)
