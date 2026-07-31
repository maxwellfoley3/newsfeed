"use server";

import { revalidatePath } from "next/cache";
import {
  getFeed,
  setSignal,
  getDiscoverFeeds,
  followFromCatalog,
  unfollowSource,
  type FeedItem,
  type DiscoverFeed,
} from "@/lib/db";
import { ingestSource } from "@/lib/ingest";
import { FEED_PAGE_SIZE } from "./feed-config";

// The client sends the desired absolute score (clamped to ±50 server-side).
// No revalidatePath: re-sorting the feed on every click would yank rows around
// mid-tap. Returns the stored value so the client can reconcile if it drifts.
export async function submitSignal(articleId: number, value: number): Promise<number> {
  return setSignal(articleId, value);
}

// Next batch for the infinite-scroll feed. Chronological + bounded: when this
// returns fewer than the requested count, the client knows it hit the end.
// `limit` defaults to one batch; scroll-restoration passes a larger count to
// rebuild the previously-loaded page in a single fetch.
export async function loadMoreFeed(
  offset: number,
  sourceId?: string,
  limit: number = FEED_PAGE_SIZE
): Promise<FeedItem[]> {
  return getFeed({ sourceId, limit, offset });
}

// ---- For You (discovery) --------------------------------------------------

// Next batch of catalog feeds the user doesn't follow, keyset-paginated by
// sort_key. Pass the last card's sort_key as `afterKey`; a short batch = end.
export async function loadMoreDiscover(
  afterKey: number | null
): Promise<DiscoverFeed[]> {
  return getDiscoverFeeds({ limit: FEED_PAGE_SIZE, afterKey });
}

// Follow a catalog feed and fetch it right away, so its articles show up on
// the Following page immediately. `added` is how many articles the fetch got.
export async function followFeed(
  catalogId: string
): Promise<{ ok: boolean; added: number; error?: string }> {
  const source = followFromCatalog(catalogId);
  if (!source) return { ok: false, added: 0, error: "not found" };

  const result = await ingestSource(source);
  revalidatePath("/");
  revalidatePath("/for-you");
  return { ok: true, added: result.added, error: result.error };
}

export async function unfollowFeed(sourceId: string): Promise<{ ok: boolean }> {
  unfollowSource(sourceId);
  revalidatePath("/");
  revalidatePath("/for-you");
  return { ok: true };
}
