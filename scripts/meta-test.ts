/**
 * SWAI V11 — Controlled Meta Live Source Verification Test
 *
 * Runs a bounded test probe against the public Meta Ad Library via the local MCP server.
 * Default mode is read-only (zero database mutation).
 * When run with --persist, safely ingests a bounded batch (<= 5 ads) and verifies
 * database association, DiscoveryRunAd linking, and deduplication.
 */

import { createMetaCollectorClient } from "../src/services/discovery/metaCollector/metaCollectorMcpClient";
import { getMetaCollectorConfig } from "../src/services/discovery/metaCollector/metaCollectorConfig";
import { normalizeMetaCollectorAd } from "../src/services/discovery/normalization/normalizeMetaCollectorAd";
import { ingestDiscoveredAds } from "../src/services/discovery/discoveryIngestionService";
import { discoveryOrchestrator } from "../src/services/discovery/discoveryOrchestrator";
import { prisma } from "../src/lib/db";

async function main() {
  const args = process.argv.slice(2);
  const shouldPersist = args.includes("--persist") || process.env.META_COLLECTOR_LIVE_TEST_PERSIST === "true";
  const queryKeyword = "pet hair remover";

  console.log("==================================================================");
  console.log("  SWAI V11 — CONTROLLED META AD LIBRARY SOURCE TEST");
  console.log("==================================================================");
  console.log(`  • Target Keyword:     '${queryKeyword}'`);
  console.log(`  • Market:             US`);
  console.log(`  • Max Ads Budget:     5 ads`);
  console.log(`  • Mode:               ${shouldPersist ? "LIVE INGESTION & DB VERIFICATION" : "READ-ONLY SOURCE PROBE"}`);

  const config = getMetaCollectorConfig();
  console.log(`  • Python Binary:      ${config.pythonBin}`);
  console.log(`  • MCP Data Dir:       ${config.dataDir}`);

  console.log("\n[1/3] Connecting to local MetaAdsCollector MCP server...");
  let client;
  try {
    client = await createMetaCollectorClient();
  } catch (err: unknown) {
    console.error("[FAILED] Could not start MCP server:", (err as Error).message);
    process.exit(1);
  }

  try {
    console.log("\n[2/3] Querying public Meta Ad Library (bounded probe)...");
    const startTime = Date.now();
    let searchRes;
    try {
      searchRes = await client.searchAds({
        query: queryKeyword,
        country: "US",
        status: "ACTIVE",
        maxResults: 5,
        maxRequests: 2,
        maxSeconds: 45,
        pageSize: 5,
      });
    } catch (queryErr: unknown) {
      const msg = (queryErr as Error).message;
      const isBlocked = msg.toLowerCase().includes("blocked") || msg.toLowerCase().includes("challenge") || msg.toLowerCase().includes("captcha");
      const isRateLimited = msg.toLowerCase().includes("rate limit") || msg.toLowerCase().includes("too many");

      if (isBlocked) {
        console.warn("\n[OUTCOME: BLOCKED_SOURCE] Meta denied automated access or presented a challenge.");
        console.warn("Details:", msg);
        console.warn("Rule 7 & 122: Honest reporting enforced. Never bypass CAPTCHAs or falsify data.");
        return;
      }

      if (isRateLimited) {
        console.warn("\n[OUTCOME: RATE_LIMITED] Meta rate limit encountered.");
        console.warn("Details:", msg);
        return;
      }

      console.error("\n[OUTCOME: FAILED] Upstream search query failed:", msg);
      return;
    }

    const durationMs = Date.now() - startTime;
    const rawAds = searchRes.ads || [];
    console.log(`  • Query Duration:     ${durationMs}ms`);
    console.log(`  • Upstream Job ID:    ${searchRes.result_set_id}`);
    console.log(`  • Ads Returned:       ${rawAds.length}`);

    if (rawAds.length === 0) {
      console.log("\n[Notice] Meta Ad Library returned 0 ads for this query.");
      return;
    }

    console.log("\n[3/3] Inspecting returned ad records and provenance...");
    const normalizedList = [];

    for (let i = 0; i < rawAds.length; i++) {
      const raw = rawAds[i];
      try {
        const norm = normalizeMetaCollectorAd(raw, {
          queryMarket: "US",
          keyword: queryKeyword,
        });
        normalizedList.push(norm);

        console.log(`\n  --- Ad #${i + 1} ---`);
        console.log(`  Library ID:      ${norm.sourceExternalId}`);
        console.log(`  Advertiser:      ${norm.advertiserName} (${norm.advertiserExternalId || "No Page ID"})`);
        console.log(`  Canonical URL:   ${norm.creativeUrl}`);
        console.log(`  Media Type:      ${norm.mediaType}`);
        console.log(`  Thumbnail URL:   ${norm.thumbnailUrl ? norm.thumbnailUrl.slice(0, 60) + "..." : "None"}`);
        console.log(`  Video URL:       ${norm.videoUrl ? norm.videoUrl.slice(0, 60) + "..." : "None"}`);
        console.log(`  Headline:        ${norm.headline || "None"}`);
        console.log(`  Source Start:    ${norm.sourceReportedStartAt?.toISOString() || "Not supplied"}`);
        console.log(`  Confidence:      ${norm.confidenceScore}`);
        console.log(`  Provenance:      ${norm.sourceEvidence?.observationMethod}`);
      } catch (err: unknown) {
        console.warn(`  [REJECTED] Ad record #${i + 1} failed normalization:`, (err as Error).message);
      }
    }

    console.log(`\nVerified Valid Ads: ${normalizedList.length} of ${rawAds.length}`);

    // Persist test only if explicitly requested
    if (shouldPersist && normalizedList.length > 0) {
      console.log("\n[DB] Persisting verified ads into SWAI database...");
      const workspace = await prisma.workspace.findFirst();
      const workspaceId = workspace?.id || "default-workspace";

      const createdJob = await discoveryOrchestrator.createDiscoveryJob({
        workspaceId,
        platform: "META",
        providerId: "meta-ads-collector",
        market: "US",
        keywords: [queryKeyword],
        industries: [],
        objectives: [],
        searchWindowDays: 30,
        sortBy: "relevance",
        requestedLimit: 5,
        pageSize: 5,
        runMode: "MANUAL",
      });

      const ingestSummary = await ingestDiscoveredAds(normalizedList, {
        workspaceId,
        discoveryRunId: createdJob.jobId,
        providerId: "meta-ads-collector",
      });

      // Update discovery run status
      await prisma.discoveryRun.update({
        where: { id: createdJob.jobId },
        data: {
          status: "COMPLETED",
          actualRetrievedCount: rawAds.length,
          validCount: normalizedList.length,
          newUniqueCount: ingestSummary.newUniqueInserted,
          existingDuplicateCount: ingestSummary.existingUpdated,
          finishedAt: new Date(),
        },
      });

      console.log("  • Discovery Run ID:   ", createdJob.jobId);
      console.log("  • Ingested Unique:    ", ingestSummary.newUniqueInserted);
      console.log("  • Updated Duplicates: ", ingestSummary.existingUpdated);
      console.log("  • Failed:             ", ingestSummary.failedCount);

      // Verify DiscoveryRunAd relations
      const runAds = await prisma.discoveryRunAd.findMany({
        where: { runId: createdJob.jobId },
      });
      console.log(`  • Verified Run Ads:   ${runAds.length} linked records in DB`);
    } else {
      console.log("\n[Notice] Database was NOT modified (read-only verification test).");
      console.log("To persist verified results, pass --persist flag.");
    }
  } finally {
    await client.close();
    console.log("\nMCP client session closed cleanly.");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
