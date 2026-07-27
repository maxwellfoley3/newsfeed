// Shared feed constants. Kept out of actions.ts because a "use server" module
// may only export async functions — a plain const there breaks client imports.

// How many articles load per infinite-scroll batch. Used by the initial page
// render and by loadMoreFeed so the "is there more?" math lines up.
export const FEED_PAGE_SIZE = 15;
