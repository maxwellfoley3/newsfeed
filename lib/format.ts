// Pure display helpers, safe to import from both server and client components.

// `nowSec` is the reference "now" (epoch seconds), passed in rather than read
// from Date.now() so a client caller can keep server and hydration renders in
// agreement (see FeedList).
export function relativeTime(epoch: number | null, nowSec: number): string {
  if (!epoch) return "";
  const diff = nowSec - epoch;
  if (diff < 60) return "just now";
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(epoch * 1000).toLocaleDateString();
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
