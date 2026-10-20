#!/usr/bin/env tsx
/**
 * SWAI V9.2 — CLI Discovery Worker Process
 *
 * Runs the continuous background worker loop with shared Next.js environment loading
 * and cross-process database heartbeat persistence.
 *
 * Usage:
 *   npm run discovery:worker
 */

// 1. Initialize environment with Next.js precedence FIRST
import { loadLocalEnvironment } from "../src/lib/loadLocalEnvironment";
loadLocalEnvironment();

import { startDiscoveryWorker, stopDiscoveryWorker } from "../src/workers/discoveryWorker";

console.log("==================================================================");
console.log("  SWAI V9.2 — TIKTOK AUTO DISCOVERY BACKGROUND WORKER");
console.log("==================================================================");
console.log("  Target Market: United States (US)");
console.log("  Operating Mode: RESEARCH_ONLY");
console.log("  Heartbeat: Cross-process SQLite database persistence active");
console.log("  Press Ctrl+C to terminate cleanly.");
console.log("------------------------------------------------------------------");

startDiscoveryWorker(30000); // 30s check interval

process.on("SIGINT", async () => {
  console.log("\n[Worker] Caught SIGINT. Shutting down cleanly...");
  await stopDiscoveryWorker();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n[Worker] Caught SIGTERM. Shutting down cleanly...");
  await stopDiscoveryWorker();
  process.exit(0);
});
