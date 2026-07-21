# newsfeed

A calm, chronological RSS reader — the **Following feed**. v1.0.

Twitter-style interaction model for RSS, pointed at a different objective:
*"was this worth your time,"* not *"did this keep you scrolling."* See
[`SCOPE.md`](./SCOPE.md) for the product scope and roadmap.

## v1.0 (this version)
- Seeded catalog of 17 verified sources (`seeds.json`), auto-followed on first run.
- Following feed only — newest first, no algorithm.
- Tap an article → opens the publisher's site (no in-app reader yet).
- Like / "less" buttons persist a signal per article. Does nothing yet — it's
  collecting the training data a future For You page will need.

## Stack
Next 16 (App Router) · React 19 · better-sqlite3 · Tailwind 4 · TypeScript.
SQLite file lives at `data/newsfeed.db` (gitignored).

## Run
```bash
npm install
npm run ingest   # pull articles from all feeds (re-run any time; dedups)
npm run dev      # http://localhost:3200
```

## Layout
- `seeds.json` — sources + initial follows (each verified to return valid RSS).
- `lib/db.ts` — schema, seeding, feed query, signal writes.
- `scripts/ingest.ts` — poll feeds, parse, dedup, store. Run on a schedule later.
- `app/page.tsx` — the Following feed (server component).
- `app/actions.ts` + `app/ArticleActions.tsx` — like/less via a server action.

## Not built yet (deferred, by decision)
For You / discovery ranking, in-app reader, user-added feeds, auth/multi-user.
