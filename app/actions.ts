"use server";

import { revalidatePath } from "next/cache";
import { getFeed, setSignal, type FeedItem } from "@/lib/db";
import { FEED_PAGE_SIZE } from "./feed-config";

export async function submitSignal(articleId: number, value: 1 | -1) {
  setSignal(articleId, value);
  revalidatePath("/");
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
