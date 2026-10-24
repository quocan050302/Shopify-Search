/**
 * SWAI V11 — MetaAdsCollector Diagnostic Doctor
 *
 * Checks Python venv, dependencies, MCP stdio communication,
 * database connectivity, and background worker status.
 */

import path from "path";
import fs from "fs";
import { prisma } from "../src/lib/db";
import { getMetaCollectorConfig } from "../src/services/discovery/metaCollector/metaCollectorConfig";
import { createMetaCollectorClient } from "../src/services/discovery/metaCollector/metaCollectorMcpClient";

async function main() {
  console.log("==================================================================");
  console.log("  SWAI V11 — META ADS COLLECTOR DIAGNOSTIC DOCTOR");
  console.log("==================================================================");

  const config = getMetaCollectorConfig();

  // 1. Environment & Paths
  console.log("\n[ENV] Checking Python virtual environment...");
  const venvExists = fs.existsSync(config.pythonBin);
  console.log(`  • Python Binary:      ${config.pythonBin} (${venvExists ? "FOUND" : "MISSING"})`);
  console.log(`  • Collector Data Dir: ${config.dataDir}`);
  console.log(`  • Target Market:      ${config.defaultCountry}`);
  console.log(`  • Max Results Budget: ${config.maxResults} ads`);
  console.log(`  • Live Test Allowed:  ${config.liveTestEnabled ? "YES" : "NO (Safe default)"}`);

  if (!venvExists) {
    console.error("\n[ERROR] Virtual environment is not initialized!");
    console.error("Run setup command:");
    console.error("  bash scripts/meta-collector-setup.sh");
    console.error("  or on Windows: powershell -ExecutionPolicy Bypass -File scripts/meta-collector-setup.ps1");
    process.exit(1);
  }

  // 2. Local MCP Server Handshake
  console.log("\n[MCP] Initializing local Python MCP server via stdio...");
  try {
    const client = await createMetaCollectorClient();
    try {
      const caps = await client.getCapabilities();
      console.log("  • MCP Handshake:      SUCCESS");
      console.log(`  • Collector Version:  ${caps.collector_version}`);
      console.log(`  • Extension Version:  ${caps.extension_version}`);
      console.log(`  • Available Tools:    ${caps.operations.join(", ")}`);
      console.log(`  • Supported Ad Types: ${caps.supported.ad_types.join(", ")}`);
    } finally {
      await client.close();
    }
  } catch (mcpErr: unknown) {
    console.error("  • MCP Handshake:      FAILED");
    console.error(`  • Reason:             ${(mcpErr as Error).message}`);
    process.exit(1);
  }

  // 3. Database Check
  console.log("\n[DB] Checking SQLite database connection...");
  try {
    const totalAds = await prisma.competitorAd.count();
    const metaAds = await prisma.competitorAd.count({ where: { platform: "META" } });
    const metaRuns = await prisma.discoveryRun.count({ where: { providerId: "meta-ads-collector" } });
    const pendingMetaRuns = await prisma.discoveryRun.count({
      where: { providerId: "meta-ads-collector", status: "PENDING" },
    });

    console.log("  • Database:           CONNECTED");
    console.log(`  • Total Ads:          ${totalAds}`);
    console.log(`  • Meta Platform Ads:  ${metaAds}`);
    console.log(`  • Meta Collector Runs:${metaRuns} (${pendingMetaRuns} pending)`);
  } catch (dbErr: unknown) {
    console.error("  • Database:           FAILED");
    console.error(`  • Reason:             ${(dbErr as Error).message}`);
    process.exit(1);
  }

  // 4. Background Worker Status
  console.log("\n[WORKER] Checking background worker heartbeat...");
  const heartbeat = await prisma.syncJob.findFirst({
    where: { jobType: "DISCOVERY_WORKER_HEARTBEAT" },
  });

  const isOnline =
    heartbeat?.status === "RUNNING" &&
    heartbeat.startedAt &&
    Date.now() - new Date(heartbeat.startedAt).getTime() < 120_000;

  if (isOnline) {
    console.log("  • Worker Status:      ONLINE (Actively polling)");
  } else {
    console.log("  • Worker Status:      OFFLINE (Start with: npm run discovery:worker)");
  }

  console.log("\n==================================================================");
  console.log("  DIAGNOSIS COMPLETE: MetaAdsCollector is ready for research.");
  console.log("==================================================================");
}

main().catch(console.error).finally(() => prisma.$disconnect());
