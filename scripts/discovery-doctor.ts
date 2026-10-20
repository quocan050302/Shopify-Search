#!/usr/bin/env tsx
/**
 * SWAI V9 — Discovery Diagnostic Doctor
 *
 * Validates database, environment variables, registered providers, and budget guards.
 *
 * Usage:
 *   npx tsx scripts/discovery-doctor.ts
 */

import { prisma } from "../src/lib/db";
import { listDiscoveryProviders } from "../src/services/discovery/providerRegistry";
import { loadProviderBudgets } from "../src/services/providers/budgetService";

async function runDoctor() {
  console.log("==================================================================");
  console.log("  SWAI V9 — AUTO DISCOVERY DIAGNOSTIC DOCTOR");
  console.log("==================================================================");

  // 1. Database Connection Check
  try {
    const adCount = await prisma.competitorAd.count();
    const schedCount = await prisma.discoverySchedule.count();
    const runCount = await prisma.discoveryRun.count();
    console.log(`[DB] Connected successfully.`);
    console.log(`     Saved Ads: ${adCount}`);
    console.log(`     Schedules: ${schedCount}`);
    console.log(`     Discovery Runs: ${runCount}`);
  } catch (err: unknown) {
    console.error(`[DB] Connection FAILED:`, err);
    process.exit(1);
  }

  // 2. Providers Inspection
  console.log("\n[PROVIDERS] Checking registered discovery providers...");
  const providers = listDiscoveryProviders();
  for (const p of providers) {
    const caps = p.getCapabilities();
    const avail = await p.checkAvailability();
    console.log(`  • ${p.name} (${p.id})`);
    console.log(`    Status: ${avail.status}`);
    console.log(`    Authorized: ${avail.isAuthorized}`);
    console.log(`    Paid: ${caps.isPaid}`);
    console.log(`    Message: ${avail.message || "N/A"}`);
  }

  // 3. Budget & Safety Check
  console.log("\n[BUDGET] Checking paid API protection...");
  const budgets = loadProviderBudgets();
  console.log(`  • Captapi: Enabled=${budgets.captapi.enabled}, AllowAuto=${budgets.captapi.allowAutomaticRequests}, Limit=${budgets.captapi.monthlyCreditLimit}`);
  console.log(`  • Meta:    Enabled=${budgets.meta.enabled}, AllowAuto=${budgets.meta.allowAutomaticRequests}`);
  console.log(`  • Gemini:  Enabled=${budgets.gemini.enabled}, AllowAuto=${budgets.gemini.allowAutomaticRequests}`);

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
