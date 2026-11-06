/**
 * Worker script for multi-process concurrency testing
 * Invoked as an independent OS child process to test SQLite WAL concurrency
 * and composite unique index enforcement across real OS processes.
 */

import { prisma } from "@/lib/db";
import { executeDemandObservationBatchImport } from "@/services/kh02/demand/demandObservationBatchImport";

async function main() {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (args[i].startsWith("--")) {
      options[args[i].slice(2)] = args[i + 1];
    }
  }

  const productId = options.productId || "prod_worker_default";
  const workspaceId = options.workspaceId || "ws_worker_default";
  const source = options.source || "GOOGLE_TRENDS_CSV";
  const count = parseInt(options.count || "50", 10);
  const offset = parseInt(options.offset || "0", 10);
  const keyword = options.keyword || "automatic cat feeder";
  const region = options.region || "US";
  const evidenceReference = options.evidenceReference || null;
  const strictProvenance = options.strict === "true";

  const valueFixed = options.valueFixed !== undefined ? parseInt(options.valueFixed, 10) : null;
  const points = [];
  const baseEpoch = Date.UTC(2025, 0, 5); // 2025-01-05
  for (let i = 0; i < count; i++) {
    const periodStart = new Date(baseEpoch + (offset + i) * 7 * 86400000).toISOString().slice(0, 10);
    const demandValue = valueFixed !== null ? valueFixed : (offset + i) % 100;
    points.push({
      periodStart,
      demandValue,
      keyword,
      region,
      evidenceReference: evidenceReference || undefined,
    });
  }

  try {
    try {
      await (prisma as any).$executeRawUnsafe("PRAGMA journal_mode = WAL;");
      await (prisma as any).$executeRawUnsafe("PRAGMA busy_timeout = 15000;");
    } catch {
      // ignore
    }

    const res = await executeDemandObservationBatchImport({
      productId,
      workspaceId,
      source: source as any,
      strictProvenance,
      points,
    });

    const output = {
      pid: process.pid,
      success: true,
      productId: res.productId,
      insertedCount: res.insertedCount,
      skippedCount: res.skippedCount,
      totalRows: res.totalRows,
    };

    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (err: any) {
    console.error(
      JSON.stringify({
        pid: process.pid,
        success: false,
        error: err.message,
        code: err.code || "UNKNOWN_ERROR",
      })
    );
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
