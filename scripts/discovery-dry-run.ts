#!/usr/bin/env tsx
/**
 * SWAI V9 — Discovery Dry Run (Zero DB Inserts & Zero Paid Calls)
 *
 * Usage:
 *   npx tsx scripts/discovery-dry-run.ts
 */

import { discoveryOrchestrator } from "../src/services/discovery/discoveryOrchestrator";
import { DiscoveryQuery } from "../src/services/discovery/types";

async function runDryRun() {
  console.log("==================================================================");
  console.log("  SWAI V9 — DISCOVERY DRY RUN (ZERO WRITES / ZERO PAID CALLS)");
  console.log("==================================================================");

  const query: DiscoveryQuery = {
    workspaceId: "default-workspace",
    platform: "TIKTOK",
    market: "US",
    keywords: ["gadget"],
    industries: [],
    objectives: [],
    searchWindowDays: 30,
    sortBy: "relevance",
    requestedLimit: 5,
    pageSize: 5,
    runMode: "DRY_RUN",
  };

  const summary = await discoveryOrchestrator.runDiscoveryJob(query, { dryRun: true });

  console.log("\n------------------ DRY RUN SUMMARY ------------------");
  console.log(`Job ID:       ${summary.jobId}`);
  console.log(`Provider:     ${summary.providerId}`);
  console.log(`Final Status: ${summary.finalStatus}`);
  console.log(`Retrieved:    ${summary.actualRetrievedCount}`);
  console.log(`Valid:        ${summary.validCount}`);
  console.log(`Database:     Unmodified (Dry-Run mode)`);
  if (summary.errorMessage) {
    console.log(`Notice:       ${summary.errorMessage}`);
  }
  console.log("-----------------------------------------------------");
}

runDryRun()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Dry run error:", e);
    process.exit(1);
  });
