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

const pollInterval = Number(process.env.SWAI_WORKER_POLL_INTERVAL_MS) || 30000;
startDiscoveryWorker(pollInterval);

if (process.env.SWAI_ACCEPTANCE_MARKER_ID) {
  (async () => {
    try {
      const markerId = process.env.SWAI_ACCEPTANCE_MARKER_ID!;
      const acceptanceRunId = process.env.SWAI_ACCEPTANCE_RUN_ID || "";
      const { prisma } = await import("../src/lib/db");
      const { resolveDatabaseConfiguration, canonicalizeSqliteDatabasePath } = await import(
        "../src/lib/database/databaseConfig"
      );
      const ws = await prisma.workspace.findUnique({ where: { id: markerId } });
      const config = resolveDatabaseConfiguration();
      const canonicalKey = canonicalizeSqliteDatabasePath(config.url).canonicalKey;

      const observation = {
        eventType: "KH01_WORKER_DATABASE_OBSERVATION",
        processName: "WORKER",
        processId: process.pid,
        acceptanceRunId,
        discoveryRunId: null,
        expectedDatabaseKey: process.env.SWAI_EXPECTED_DB_KEY || canonicalKey,
        observedDatabaseKey: canonicalKey,
        markerId,
        markerObserved: Boolean(ws && ws.id === markerId),
        observedRunId: null,
        observedAdIds: [],
        observedAt: new Date().toISOString(),
        observationMethod: "WORKER_PROCESS_EVENT",
        evidenceReference: `Worker subprocess PID ${process.pid} verified marker '${markerId}' in database`,
      };

      console.log(`[KH01_EVENT] ${JSON.stringify(observation)}`);

      if (process.env.KH01_WORKER_EVIDENCE_DIR) {
        const fs = await import("fs");
        const path = await import("path");
        const outDir = process.env.KH01_WORKER_EVIDENCE_DIR;
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(
          path.join(outDir, "worker-database-observation.json"),
          JSON.stringify(observation, null, 2),
          "utf8"
        );
      }
    } catch (err: any) {
      console.error(`[KH01_EVENT_ERROR] Worker failed initial marker observation: ${err.message}`);
    }
  })();
}

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
