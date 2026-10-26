/**
 * SWAI V11 — MetaAdsCollector One-Shot Execution Script
 *
 * Checks for a queued PENDING Meta research run in the database,
 * claims it atomically, executes retrieval via local MCP, normalizes
 * and ingests genuine ads, links DiscoveryRunAd relationships, updates
 * checkpoints and counters, and prints the truthful outcome report.
 */

import { prisma } from "../src/lib/db";
import { discoveryOrchestrator } from "../src/services/discovery/discoveryOrchestrator";

async function main() {
  console.log("==================================================================");
  console.log("  SWAI V11 — META ADS ONE-SHOT RESEARCH WORKER");
  console.log("==================================================================");

  // 1. Find a pending Meta run or any pending run
  const pendingRun = await prisma.discoveryRun.findFirst({
    where: {
      status: "PENDING",
      providerId: "meta-ads-collector",
    },
    orderBy: { createdAt: "asc" },
  });

  if (!pendingRun) {
    console.log("[Notice] No pending 'meta-ads-collector' discovery runs found in database.");
    console.log("To queue a new research task, use the Meta Discovery UI at /meta-discovery");
    console.log("or send a POST to /api/v1/discovery/meta/requests with keyword(s).");
    return;
  }

  console.log(`[Job] Found pending Meta run '${pendingRun.id}'. Claiming...`);
  const claimedId = await discoveryOrchestrator.claimPendingDiscoveryJob();

  if (!claimedId) {
    console.log("[Notice] Job was claimed by another worker or is no longer pending.");
    return;
  }

  console.log(`[Executing] Running discovery for job '${claimedId}'...`);
  const summary = await discoveryOrchestrator.executeDiscoveryJob(claimedId);

  console.log("\n==================================================================");
  console.log("  EXECUTION COMPLETE — TRUTHFUL OUTCOME REPORT");
  console.log("==================================================================");
  console.log(`  • Run ID:             ${summary.jobId}`);
  console.log(`  • Provider:           ${summary.providerId}`);
  console.log(`  • Final Status:       ${summary.finalStatus}`);
  console.log(`  • Requested Limit:    ${summary.requestedLimit}`);
  console.log(`  • Actual Retrieved:   ${summary.actualRetrievedCount}`);
  console.log(`  • Valid Ingested:     ${summary.validCount}`);
  console.log(`  • New Unique Ads:     ${summary.newUniqueCount}`);
  console.log(`  • Existing Duplicates:${summary.existingDuplicateCount}`);
  console.log(`  • Failed Count:       ${summary.failedCount}`);
  console.log(`  • Duration:           ${Math.round((summary.finishTime.getTime() - summary.startTime.getTime()) / 1000)}s`);

  if (summary.errorMessage) {
    console.log(`  • Diagnostic Message: ${summary.errorMessage}`);
  }

  // Check linked run ads in DB
  const linkedAds = await prisma.discoveryRunAd.findMany({
    where: { runId: summary.jobId },
    select: { adId: true, libraryId: true, ingestOutcome: true },
  });
  console.log(`  • Relational Run Ads: ${linkedAds.length} linked records`);
  for (const ad of linkedAds) {
    console.log(`    - Ad ${ad.adId} (FB Library ID: ${ad.libraryId}) [${ad.ingestOutcome}]`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
