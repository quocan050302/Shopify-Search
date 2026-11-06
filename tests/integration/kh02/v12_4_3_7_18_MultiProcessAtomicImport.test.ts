/**
 * ANTI — KH-02 V12.4.3.7.18: MULTI-PROCESS ATOMIC IMPORT INTEGRATION TEST
 * Validates real OS child processes competing on isolated SQLite DB with composite uniqueness.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { prisma } from "@/lib/db";
import { GOOGLE_TRENDS_CSV_STORAGE_DIR } from "@/services/kh02/demand/googleTrendsCsvValidator";

describe("KH-02 V12.4.3.7.18: MultiProcessAtomicImport Integration", () => {
  const tsxCli = path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
  const useNode = fs.existsSync(tsxCli);
  const tsxBin = useNode
    ? process.execPath
    : path.resolve(process.cwd(), process.platform === "win32" ? "node_modules/.bin/tsx.cmd" : "node_modules/.bin/tsx");
  const workerScript = path.resolve(process.cwd(), "scripts/kh02/multiProcessImportWorker.ts");

  const testWorkspaceId = "ws_mp_atomic_test";
  const productA = "prod_mp_atomic_A";
  const productB = "prod_mp_atomic_B";

  // Pre-generate CSV file with 100 points
  let sampleCsvContent = "Category: All categories\nWeek,automatic cat feeder: (United States)\n";
  const baseEpoch = Date.UTC(2025, 0, 5);
  for (let i = 0; i < 100; i++) {
    const dt = new Date(baseEpoch + i * 7 * 86400000).toISOString().slice(0, 10);
    sampleCsvContent += `${dt},${i % 100}\n`;
  }
  const csvSha256 = crypto.createHash("sha256").update(sampleCsvContent, "utf8").digest("hex");
  const csvFilePath = path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${csvSha256}.csv`);
  const evidenceRef = `csv-import:google-trends-explore:sha256:${csvSha256}:q=automatic_cat_feeder`;

  beforeEach(async () => {
    try {
      await prisma.$executeRawUnsafe("PRAGMA journal_mode = WAL;");
      await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 15000;");
    } catch {}

    fs.mkdirSync(GOOGLE_TRENDS_CSV_STORAGE_DIR, { recursive: true });
    fs.writeFileSync(csvFilePath, sampleCsvContent, "utf8");

    await prisma.workspace.upsert({
      where: { id: testWorkspaceId },
      create: { id: testWorkspaceId, name: "WS MP Atomic Test" },
      update: {},
    });

    const wl = await prisma.watchlist.upsert({
      where: { id: "wl_" + testWorkspaceId },
      create: { id: "wl_" + testWorkspaceId, workspaceId: testWorkspaceId, name: "WL MP Atomic Test" },
      update: {},
    });

    for (const pid of [productA, productB]) {
      await prisma.researchProduct.upsert({
        where: { id: pid },
        create: { id: pid, title: "Product " + pid },
        update: {},
      });
      await prisma.watchlistItem.upsert({
        where: { id: "wli_" + pid },
        create: { id: "wli_" + pid, watchlistId: wl.id, productId: pid, itemType: "PRODUCT" },
        update: { watchlistId: wl.id, productId: pid },
      });
      await prisma.productDemandObservation.deleteMany({
        where: { productId: pid },
      });
    }
  });

  afterEach(async () => {
    try {
      if (fs.existsSync(csvFilePath)) fs.unlinkSync(csvFilePath);
    } catch {
      // ignore
    }
    await prisma.productDemandObservation.deleteMany({
      where: { productId: { in: [productA, productB] } },
    });
  });

  function runWorker(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string; parsed: any }> {
    return new Promise((resolve) => {
      const spawnArgs = useNode ? [tsxCli, workerScript, ...args] : [workerScript, ...args];
      const child = spawn(tsxBin, spawnArgs, {
        cwd: process.cwd(),
        env: { ...process.env, DEBUG_IMPORT_RETRY: "1" },
        stdio: "pipe",
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (d) => {
        stdout += d.toString();
      });
      child.stderr?.on("data", (d) => {
        stderr += d.toString();
      });

      child.on("close", (exitCode) => {
        let parsed = null;
        try {
          parsed = JSON.parse(stdout.trim());
        } catch {
          try {
            parsed = JSON.parse(stderr.trim());
          } catch {
            // ignore
          }
        }
        resolve({
          exitCode: exitCode ?? 1,
          stdout,
          stderr,
          parsed,
        });
      });
    });
  }

  it("MP01: Two real OS child processes compete concurrently inserting separate products (50 points each)", async () => {
    const parentPid = process.pid;

    const [workerA, workerB] = await Promise.all([
      runWorker([
        "--productId",
        productA,
        "--workspaceId",
        testWorkspaceId,
        "--source",
        "GOOGLE_TRENDS_CSV",
        "--count",
        "50",
        "--offset",
        "0",
        "--evidenceReference",
        evidenceRef,
        "--strict",
        "true",
      ]),
      runWorker([
        "--productId",
        productB,
        "--workspaceId",
        testWorkspaceId,
        "--source",
        "GOOGLE_TRENDS_CSV",
        "--count",
        "50",
        "--offset",
        "50",
        "--evidenceReference",
        evidenceRef,
        "--strict",
        "true",
      ]),
    ]);

    expect(workerA.exitCode).toBe(0);
    expect(workerB.exitCode).toBe(0);

    const pidA = workerA.parsed?.pid;
    const pidB = workerB.parsed?.pid;

    expect(pidA).toBeDefined();
    expect(pidB).toBeDefined();
    expect(pidA).not.toBe(parentPid);
    expect(pidB).not.toBe(parentPid);
    expect(pidA).not.toBe(pidB);

    const countA = await prisma.productDemandObservation.count({ where: { productId: productA } });
    const countB = await prisma.productDemandObservation.count({ where: { productId: productB } });

    expect(countA).toBe(50);
    expect(countB).toBe(50);
  });

  it("MP02: Two real OS child processes compete to insert identical rows for Product A simultaneously", async () => {
    const [worker1, worker2] = await Promise.all([
      runWorker([
        "--productId",
        productA,
        "--workspaceId",
        testWorkspaceId,
        "--source",
        "GOOGLE_TRENDS_CSV",
        "--count",
        "50",
        "--offset",
        "0",
        "--evidenceReference",
        evidenceRef,
        "--strict",
        "true",
      ]),
      runWorker([
        "--productId",
        productA,
        "--workspaceId",
        testWorkspaceId,
        "--source",
        "GOOGLE_TRENDS_CSV",
        "--count",
        "50",
        "--offset",
        "0",
        "--evidenceReference",
        evidenceRef,
        "--strict",
        "true",
      ]),
    ]);

    // Both should exit cleanly without crashing SQLite
    expect(worker1.exitCode).toBe(0);
    expect(worker2.exitCode).toBe(0);

    // Active composite unique constraint ensures exactly 50 rows in DB, 0 duplicate keys
    const count = await prisma.productDemandObservation.count({ where: { productId: productA } });
    expect(count).toBe(50);

    const totalInserted = (worker1.parsed?.insertedCount || 0) + (worker2.parsed?.insertedCount || 0);
    const totalSkipped = (worker1.parsed?.skippedCount || 0) + (worker2.parsed?.skippedCount || 0);
    expect(totalInserted + totalSkipped).toBe(100);
  });

  it("MP03: Concurrently running invalid worker rolls back while valid worker completes 50 rows", async () => {
    const [validWorker, invalidWorker] = await Promise.all([
      runWorker([
        "--productId",
        productA,
        "--workspaceId",
        testWorkspaceId,
        "--source",
        "GOOGLE_TRENDS_CSV",
        "--count",
        "50",
        "--offset",
        "0",
        "--evidenceReference",
        evidenceRef,
        "--strict",
        "true",
      ]),
      runWorker([
        "--productId",
        productB,
        "--workspaceId",
        testWorkspaceId,
        "--source",
        "GOOGLE_TRENDS_CSV",
        "--count",
        "50",
        "--offset",
        "0",
        // Missing evidenceReference with strict=true will fail
        "--strict",
        "true",
      ]),
    ]);

    expect(validWorker.exitCode).toBe(0);
    expect(invalidWorker.exitCode).toBe(1);

    const countA = await prisma.productDemandObservation.count({ where: { productId: productA } });
    const countB = await prisma.productDemandObservation.count({ where: { productId: productB } });

    expect(countA).toBe(50);
    expect(countB).toBe(0); // Rollback ensures 0 partial writes
  });

  it("MP04: Sequential rapid spawns verify no lingering SQLite database locks", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await runWorker([
        "--productId",
        productA,
        "--workspaceId",
        testWorkspaceId,
        "--source",
        "GOOGLE_TRENDS_CSV",
        "--count",
        "10",
        "--offset",
        String(i * 10),
        "--evidenceReference",
        evidenceRef,
        "--strict",
        "true",
      ]);
      expect(res.exitCode).toBe(0);
    }

    const count = await prisma.productDemandObservation.count({ where: { productId: productA } });
    expect(count).toBe(30);
  });
});
