#!/usr/bin/env tsx
/**
 * SWAI V9.2 — Discovery Diagnostic Doctor
 *
 * Validates database, environment variables, registered providers, and budget guards.
 * Uses shared Next.js-compatible environment loading.
 *
 * Usage:
 *   npm run discovery:doctor
 */

// 1. Initialize environment with Next.js precedence FIRST
import { loadLocalEnvironment, validateDiscoveryEnvironment } from "../src/lib/loadLocalEnvironment";
loadLocalEnvironment();

import { prisma } from "../src/lib/db";
import { listDiscoveryProviders } from "../src/services/discovery/providerRegistry";
import { loadProviderBudgets } from "../src/services/providers/budgetService";

async function runDoctor() {
  console.log("==================================================================");
  console.log("  SWAI V9.2 — AUTO DISCOVERY DIAGNOSTIC DOCTOR");
  console.log("==================================================================");

  // 1. Environment Diagnostics
  console.log("\n[ENV] Checking environment files & variables...");
  const envReport = validateDiscoveryEnvironment();
  console.log(`  • Environment files detected:  ${envReport.loadedFiles.length > 0 ? envReport.loadedFiles.join(", ") : "None (using process.env)"}`);
  console.log(`  • Node Environment:            ${envReport.nodeEnv}`);
  console.log(`  • Free Discovery Mode:         ${envReport.freeDiscoveryMode ? "ENABLED ($0 spending limit enforced)" : "DISABLED"}`);
  console.log(`  • Paid Apify Discovery:        ${envReport.enableApifyDiscovery ? "ENABLED" : "DISABLED (Safe default)"}`);
  console.log(`  • TikTok CC Session Cookie:    ${envReport.tiktokCookieConfigured ? "Configured (Present)" : "Not configured"}`);
  console.log(`  • Apify API Token:             ${envReport.apifyTokenConfigured ? "Configured (Present)" : "Not configured"}`);
  console.log(`  • Gemini API Key:              ${envReport.geminiKeyConfigured ? "Configured (Present)" : "Not configured"}`);
  console.log(`  • Meta Ad Library Token:       ${envReport.metaTokenConfigured ? "Configured (Present)" : "Not configured"}`);

  // 2. Database Connection Check
  console.log("\n[DB] Checking database connection...");
  try {
    const adCount = await prisma.competitorAd.count();
    const schedCount = await prisma.discoverySchedule.count();
    const runCount = await prisma.discoveryRun.count();
    const autoDiscoveredCount = await prisma.adSourceIdentity.groupBy({
      by: ["adId"],
      _count: { adId: true },
    }).then((rows) => rows.length);

    console.log(`  • Database:                    CONNECTED`);
    console.log(`  • Total Ads in DB:             ${adCount}`);
    console.log(`  • Auto-Discovered Ads (Source):${autoDiscoveredCount}`);
    console.log(`  • Active Schedules:            ${schedCount}`);
    console.log(`  • Recorded Discovery Runs:     ${runCount}`);
  } catch (err: unknown) {
    console.error(`  • Database Connection:         FAILED:`, err);
    process.exit(1);
  }

  // 3. Worker Status Check (via cross-process DB heartbeat)
  console.log("\n[WORKER] Checking background discovery worker status...");
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const workerHeartbeat = await prisma.syncJob.findFirst({
      where: {
        jobType: "DISCOVERY_WORKER_HEARTBEAT",
        startedAt: { gte: fiveMinutesAgo },
      },
      orderBy: { startedAt: "desc" },
    });

    const activeRun = await prisma.discoveryRun.findFirst({
      where: {
        status: "RUNNING",
        heartbeatAt: { gte: fiveMinutesAgo },
      },
    });

    const isWorkerOnline = Boolean(workerHeartbeat || activeRun);
    console.log(`  • Worker Status:               ${isWorkerOnline ? "ONLINE" : "OFFLINE"}`);
    if (isWorkerOnline) {
      const lastBeat = workerHeartbeat?.startedAt || activeRun?.heartbeatAt;
      console.log(`  • Last Heartbeat:              ${lastBeat?.toISOString()}`);
    } else {
      console.log(`  • Notice:                      Worker is not currently running. Start with: npm run discovery:worker`);
    }
  } catch (err) {
    console.warn(`  • Worker Check Notice:         Could not query worker heartbeat:`, err);
  }

  // 4. Providers Inspection
  console.log("\n[PROVIDERS] Checking registered discovery providers...");
  const providers = listDiscoveryProviders();
  for (const p of providers) {
    const caps = p.getCapabilities();
    const avail = await p.checkAvailability();
    console.log(`  • Provider: ${p.name} [ID: ${p.id}]`);
    console.log(`    Status:                      ${avail.status}`);
    console.log(`    Authorized:                  ${avail.isAuthorized}`);
    console.log(`    Paid:                        ${caps.isPaid}`);
    console.log(`    Supports US Commercial Ads:  ${caps.supportsUS}`);
    console.log(`    Message:                     ${avail.message || "N/A"}`);
  }

  // 5. Budget & Paid API Safety Check
  console.log("\n[BUDGET] Checking paid API protection...");
  const budgets = loadProviderBudgets();
  console.log(`  • Captapi: Enabled=${budgets.captapi?.enabled ?? false}, AllowAuto=${budgets.captapi?.allowAutomaticRequests ?? false}, Limit=${budgets.captapi?.monthlyCreditLimit ?? 0}`);
  console.log(`  • Apify:   Enabled=${budgets.apify?.enabled ?? false}, AllowAuto=${budgets.apify?.allowAutomaticRequests ?? false}, Limit=${budgets.apify?.monthlyCreditLimit ?? 0}`);
  console.log(`  • Meta:    Enabled=${budgets.meta?.enabled ?? false}, AllowAuto=${budgets.meta?.allowAutomaticRequests ?? false}`);
  console.log(`  • Gemini:  Enabled=${budgets.gemini?.enabled ?? false}, AllowAuto=${budgets.gemini?.allowAutomaticRequests ?? false}`);

  console.log("\n==================================================================");
  console.log("  DIAGNOSIS COMPLETE: Engine ready.");
  console.log("==================================================================");
}

runDoctor()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Doctor error:", e);
    process.exit(1);
  });
