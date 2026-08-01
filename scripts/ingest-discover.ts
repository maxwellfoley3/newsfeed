/**
 * Discover ingest job — sample UNFOLLOWED catalog feeds and pull their articles
 * so the For You page has real posts to show (and, later, R1 to rank).
 * Run: npm run ingest:discover [count]   (default 60 feeds per run)
 *
 * The selection + parse/store logic lives in lib/ingest.ts (ingestDiscover).
 * This file is just the CLI + logging. Run it repeatedly (or on a schedule) to
 * rotate through the catalog over time.
 */
import { ingestDiscover } from "../lib/ingest";

async function main() {
  const limit = Number(process.argv[2]) || 60;
  console.log(`Sampling ${limit} unfollowed catalog feeds…\n`);
  const { results, totalNew } = await ingestDiscover(limit, (r) => {
    if (r.error) {
      console.log(`  ✗ ${r.source.name.padEnd(24)} FAILED: ${r.error}`);
    } else {
      console.log(`  ✓ ${r.source.name.padEnd(24)} +${r.added} new`);
    }
  });
  console.log(
    `\nDone. ${totalNew} new articles across ${results.length} discover feeds.`
  );
}

main();
