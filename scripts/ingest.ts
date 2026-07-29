/**
 * Ingest job — poll every FOLLOWED source's feed, parse, dedup, store.
 * Run: npm run ingest   (later: on a schedule / cron)
 *
 * The parse/store logic lives in lib/ingest.ts so it can be shared with the
 * fetch-on-follow path in the app. This file is just the CLI + logging.
 */
import { ingestAll } from "../lib/ingest";

async function main() {
  const { results, totalNew } = await ingestAll((r) => {
    if (r.error) {
      console.log(`  ✗ ${r.source.name.padEnd(18)} FAILED: ${r.error}`);
    } else {
      console.log(`  ✓ ${r.source.name.padEnd(18)} +${r.added} new`);
    }
  });
  console.log(`\nDone. ${totalNew} new articles across ${results.length} followed sources.`);
}

main();
