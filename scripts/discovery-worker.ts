#!/usr/bin/env tsx
/**
 * SWAI V9 — CLI Discovery Worker Process
 *
 * Usage:
 *   npx tsx scripts/discovery-worker.ts
 */

import { startDiscoveryWorker, stopDiscoveryWorker } from "../src/workers/discoveryWorker";

console.log("==================================================================");
console.log("  SWAI V9 — TIKTOK AUTO DISCOVERY BACKGROUND WORKER");
console.log("==================================================================");
console.log("  Target Market: United States (US)");
console.log("  Operating Mode: RESEARCH_ONLY");
console.log("  Press Ctrl+C to terminate cleanly.");
console.log("------------------------------------------------------------------");

startDiscoveryWorker(30000); // 30s check interval

process.on("SIGINT", () => {
  console.log("\n[Worker] Caught SIGINT. Shutting down...");
  stopDiscoveryWorker();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[Worker] Caught SIGTERM. Shutting down...");
  stopDiscoveryWorker();
  process.exit(0);
});
