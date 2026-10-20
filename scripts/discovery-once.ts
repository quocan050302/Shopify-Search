#!/usr/bin/env tsx
/**
 * SWAI V9 — Run Discovery Once
 *
 * Triggers a single immediate discovery run via CLI.
 *
 * Usage:
 *   npx tsx scripts/discovery-once.ts --limit 10 --keywords "ecommerce,gadget"
 */

import { discoveryOrchestrator } from "../src/services/discovery/discoveryOrchestrator";
import { DiscoveryQuery } from "../src/services/discovery/types";

async function runOnce() {
  console.log("==================================================================");
  console.log("  SWAI V9 — RUN DISCOVERY ONCE");
  console.log("==================================================================");

  const query: DiscoveryQuery = {
    workspaceId: "default-workspace",
    platform: "TIKTOK",
    market: "US",
    keywords: ["beauty", "skincare", "ecommerce"],
    industries: [],
    objectives: [],
    searchWindowDays: 30,
    sortBy: "relevance",
    requestedLimit: 10,
    pageSize: 10,
    runMode: "MANUAL",
  };

  console.log(`Starting discovery for US TikTok Top Ads (Limit: ${query.requestedLimit})...`);
  const summary = await discoveryOrchestrator.runDiscoveryJob(query);

  console.log("\n------------------ DISCOVERY SUMMARY ------------------");
  console.log(`Job ID:          ${summary.jobId}`);
  console.log(`Provider:        ${summary.providerId}`);
  console.log(`Final Status:    ${summary.finalStatus}`);
  console.log(`Retrieved Total: ${summary.actualRetrievedCount}`);
  console.log(`New Unique Ads:  ${summary.newUniqueCount}`);
  console.log(`Duplicates:      ${summary.existingDuplicateCount}`);
  console.log(`Failed:          ${summary.failedCount}`);
  if (summary.errorMessage) {
    console.log(`Notice / Error:  ${summary.errorMessage}`);
  }
  console.log("-------------------------------------------------------");
}

runOnce()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Discovery run error:", e);
    process.exit(1);
  });
