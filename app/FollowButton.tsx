"use client";

import { useState, useTransition } from "react";
import { followFeed, unfollowFeed } from "./actions";

// Follow/unfollow toggle for a For You feed card. Optimistic: the card stays
// put after following (flips to "Following ✓") so you can follow several
// without them vanishing mid-scroll; the server drops followed feeds from the
// pool on the next page load. The source id equals the catalog id (see
// followFromCatalog), so both actions key off the same id.
export function FollowButton({ catalogId }: { catalogId: string }) {
  const [following, setFollowing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle() {
    const next = !following;
    setFollowing(next); // optimistic
    setNote(null);
    start(async () => {
      if (next) {
        const res = await followFeed(catalogId);
        if (!res.ok) {
          setFollowing(false);
          setNote("Couldn't follow");
        } else if (res.error) {
          // Followed, but the feed didn't fetch cleanly — it'll retry on the
          // next ingest. Say so quietly rather than pretending it worked.
          setNote("Followed · feed didn't load");
        } else {
          setNote(res.added > 0 ? `Followed · ${res.added} new` : "Followed");
        }
      } else {
        await unfollowFeed(catalogId);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {note && (
        <span className="text-xs" style={{ color: "var(--muted)", fontFamily: "system-ui" }}>
          {note}
        </span>
      )}
      <button
        onClick={toggle}
        disabled={pending}
        aria-pressed={following}
        className="rounded-full px-4 py-1.5 text-[0.8rem] font-semibold transition-colors disabled:opacity-50"
        style={
          following
            ? { color: "var(--muted)", background: "rgba(0,0,0,0.05)" }
            : { color: "#ffffff", background: "var(--accent)" }
        }
      >
        {following ? "Following ✓" : "Follow"}
      </button>
    </div>
  );
}
