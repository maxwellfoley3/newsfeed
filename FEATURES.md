# Feature List — newsfeed

_Status: draft v0.1 — ideation. Bouncing ideas, not a spec. Nothing here is committed._

Purpose of this doc: capture candidate features with enough concrete shape
(data model, APIs, delivery, effort) to decide **build / defer / kill** — judged
against SCOPE.md's north star: **"was this worth your time," not "did this keep
you scrolling."** Any feature that manufactures compulsion is out by principle,
even here.

Portfolio context: this project doubles as GitHub evidence of recent, real dev
work (see [[fde-goal]] / [[entrepreneur-path]]). Features should read well in a
diff and tell a coherent product story, not just pad a commit graph.

---

## Feature 1 — Sharp-move alerts (stocks & prediction markets)

**One-liner:** Watch a curated set of tickers and prediction-market contracts;
when one makes a *sharp, statistically unusual* move, surface it as a high-signal
card in the feed (and later, a real notification).

### Why it fits the thesis (the part that could go wrong)
A market move that is genuinely unusual *is* a "worth your time" signal — the
market just told you something material happened. That's the good version.

The bad version is a real-time ticker that pulls you back every few minutes to
watch numbers wiggle — i.e. exactly the compulsion loop SCOPE.md says to kill.

**Design guardrails to stay on the right side:**
- Alert on **unusual** moves, not every move (threshold + volatility-relative, so
  a jumpy asset doesn't spam).
- **Digest, not stream** by default — batch alerts into the feed; no live-updating
  price widget in v1.
- Rate-limit per entity (one alert per asset per cooldown window).
- Best version: pair a move with a **related headline already in the feed** →
  "TSLA -9% today" next to the article explaining why. That's the demo moment.

### API feasibility (researched 2026-07-23)

**Prediction markets — strong, free, low-friction:**
- **Polymarket** — *recommended primary.* Market data is fully public: no API key,
  no auth, no wallet. Gamma API (`gamma-api.polymarket.com`, markets/events),
  Data API (`data-api.polymarket.com`), and public CLOB read endpoints
  (`clob.polymarket.com`, prices/order book/price history). Prices are already
  probabilities (0–1) → a "sharp move" is just a probability delta. REST is
  enough; websockets exist if wanted.
- **Kalshi** — *good secondary.* Regulated US exchange (credibility angle). Market
  data publicly readable; only trading needs signed keys. Public websocket
  channels (`ticker`, `trade`) for real-time. Slightly more auth ceremony.

**Stocks:**
- **Finnhub** — *recommended primary.* Free tier: 60 REST calls/min **and** free
  websocket streaming for up to **50 symbols**. A ≤50-ticker watchlist fits the
  free tier exactly. Only needs a free API key.
- **Alpha Vantage** — ⚠️ avoid. Free tier cut to **25 requests/day** — unusable
  for a live scanner. EOD pulls only.
- **Alpaca** (free IEX feed) — backup if we outgrow Finnhub's 50-symbol cap.

**Consequence:** prediction markets move slowly enough that **polling free REST
every few minutes is plenty** — no streaming required. Stocks are the only place
we'd reach for a websocket. So **v1 can be all-polling**, which is dramatically
simpler and matches the existing `ingest.ts` cron-style pattern.

### Proposed architecture (fits current stack: Next 16 + better-sqlite3 + tsx)

Mirror the existing ingest pattern — a standalone poll script on an interval,
writing to SQLite, surfaced by the Next app.

- **New tables**
  - `watchlist` — `(id, kind: 'stock'|'prediction', source, external_id, label)`
  - `price_snapshots` — `(watchlist_id, price, ts)` — rolling history for baselines
  - `market_alerts` — `(watchlist_id, ts, kind, magnitude, message, related_article_id?)`
- **New script** `scripts/poll-markets.ts` (sibling to `ingest.ts`)
  - Poll each watchlist entity → append snapshot
  - Compute move vs rolling window; if it clears the threshold and isn't within a
    cooldown, write a `market_alerts` row
  - Optional: match against recent `articles` for a related headline
- **Surface in feed** — render `market_alerts` as a distinct "Market Move" card
  type in the existing feed. **v1 needs zero new notification infra.**

### "Sharp move" — detection options (pick one for v1)
1. **Fixed % over rolling window** — e.g. stock ±5% in 1h; prediction market
   ±10 probability points in 24h. Simplest; good enough to ship.
2. **Volatility-relative (z-score)** — move measured in std-devs of the asset's
   own recent returns. Fewer false alarms on jumpy assets. _Recommended once #1
   works._
3. **Volume-confirmed** — require a volume spike alongside the price move. Best
   signal, most data plumbing. Defer.

### Delivery tiers (ship v1, earn the rest)
- **v1 — in-feed "Market Move" cards.** Reuses feed UI, no service cost, no infra.
- **v2 — browser Web Push API.** Free, no third-party service. Real "notification."
- **v3 — email digest** (e.g. Resend/SMTP) — a daily "what moved" summary.

### Open questions
- Who curates the watchlist for v1? (Hardcode Maxwell's picks, matching the
  single-user-but-not-single-user-schema stance in SCOPE.md.)
- Poll interval? (Prediction: 5–15 min. Stocks: depends on threshold window.)
- Does the news-correlation feature make v1, or is it a v1.1 "wow" add?

---

## Feature 2 — _(next idea — TBD)_
