/**
 * SWAI V11.2 — Meta Media Repair CLI
 *
 * Scans existing database advertisements for missing thumbnails and repairs them
 * using verified records stored in the local MetaAdsCollector state database.
 *
 * Usage:
 *   npx tsx scripts/meta-repair-media.ts               # Dry-run mode (scans up to 5 ads)
 *   npx tsx scripts/meta-repair-media.ts --commit     # Commit mode (updates DB)
 *   npx tsx scripts/meta-repair-media.ts --limit 30   # Custom batch size
 *   npx tsx scripts/meta-repair-media.ts --commit --limit 50
 */

import { repairMissingThumbnails } from "../src/services/discovery/metaCollector/metaMediaRepairService";
import { prisma } from "../src/lib/db";

async function main() {
  const args = process.argv.slice(2);
  const isCommit = args.includes("--commit");
  const allowNetwork = args.includes("--network");

  let limit = 5;
  const limitIdx = args.indexOf("--limit");
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1], 10) || 5;
  } else if (args.includes("--all")) {
    limit = 100;
  }

  console.log("==================================================================");
  console.log("  SWAI V11.2 — META CREATIVE THUMBNAIL REPAIR CLI");
  console.log("==================================================================");
  console.log(`  Mode:           ${isCommit ? "COMMIT (Updates will be persisted)" : "DRY-RUN (Preview only, no DB writes)"}`);
  console.log(`  Batch Limit:    ${limit} ads`);
  console.log(`  Network Enrich: ${allowNetwork ? "ENABLED (Bounded source check)" : "DISABLED (Local stored records only)"}`);
  console.log("------------------------------------------------------------------");

  const startTime = Date.now();
  const summary = await repairMissingThumbnails({
    platform: "META",
    limit,
    dryRun: !isCommit,
    allowNetworkEnrich: allowNetwork,
  });
  const durationMs = Date.now() - startTime;

  console.log("\n[CANDIDATES INSPECTED]");
  if (summary.candidates.length === 0) {
    console.log("  No Meta ads currently missing thumbnails in the database.");
  } else {
    for (const c of summary.candidates) {
      console.log(`  • [${c.status}] FB ID: ${c.externalAdId} | "${c.headline?.slice(0, 45) || 'No headline'}..."`);
      if (c.recoveredThumbnailUrl) {
        // Redact signed token query params from log for privacy (Rule 51)
        const parsedUrl = new URL(c.recoveredThumbnailUrl);
        const redacted = `${parsedUrl.origin}${parsedUrl.pathname}`;
        console.log(`      ↳ Real Thumbnail Found: ${redacted} [${c.source}]`);
        if (c.recoveredVideoUrl) {
          const parsedVideo = new URL(c.recoveredVideoUrl);
          console.log(`      ↳ Real Video Found:     ${parsedVideo.origin}${parsedVideo.pathname}`);
        }
      } else {
        console.log(`      ↳ Reason: Media unavailable in stored records`);
      }
    }
  }

  console.log("\n==================================================================");
  console.log("  REPAIR SUMMARY REPORT");
  console.log("==================================================================");
  console.log(`  Ads scanned:                ${summary.adsScanned}`);
  console.log(`  Missing media:              ${summary.missingMediaCount}`);
  console.log(`  Found real thumbnail URL:   ${summary.foundRealThumbnailUrlCount}`);
  console.log(`  Repaired successfully:      ${summary.repairedSuccessfullyCount} ${!isCommit && summary.foundRealThumbnailUrlCount > 0 ? "(Dry-run: run with --commit to persist)" : ""}`);
  console.log(`  Expired / restricted:       ${summary.expiredOrRestrictedCount}`);
  console.log(`  Still unavailable:          ${summary.stillUnavailableCount}`);
  console.log(`  Failed:                     ${summary.failedCount}`);
  console.log(`  Execution Time:             ${durationMs}ms`);
  console.log("==================================================================");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
