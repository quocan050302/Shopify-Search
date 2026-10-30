import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { createClient } from "@libsql/client";
import { createPrismaClient } from "@/lib/db";
import { ensureSyncJobSchemaUpgraded } from "../../src/services/kh02/persistence/kh02PersistenceService";

describe("SWAI KH-02 V12.1.4.1 — Genuine Legacy SQLite Migration & Idempotency", () => {
  const tempFiles: string[] = [];

  function createTempDbPath(prefix: string): { dbPath: string; dbUrl: string } {
    const dbPath = path.join(os.tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}.db`);
    tempFiles.push(dbPath);
    return {
      dbPath,
      dbUrl: `file:${dbPath}`,
    };
  }

  afterEach(async () => {
    for (const f of tempFiles) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {}
    }
  });

  const LEGACY_PRE_V12_1_3_DDL = `
    CREATE TABLE IF NOT EXISTS "workspaces" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "slug" TEXT NOT NULL UNIQUE,
      "tier" TEXT NOT NULL DEFAULT 'FREE',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS "sync_jobs" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "workspaceId" TEXT NOT NULL,
      "jobType" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "progress" INTEGER NOT NULL DEFAULT 0,
      "totalItems" INTEGER NOT NULL DEFAULT 0,
      "resultJson" TEXT,
      "errorMessage" TEXT,
      "startedAt" DATETIME,
      "completedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `;

  it("successfully migrates a genuine legacy SQLite schema lacking all 7 KH-02 ownership columns", async () => {
    const { dbPath, dbUrl } = createTempDbPath("legacy_full_migration");

    // 1. Initialize strictly legacy DDL
    const rawClient = createClient({ url: dbUrl });
    await rawClient.executeMultiple(LEGACY_PRE_V12_1_3_DDL);

    // 2. Authoritatively verify with PRAGMA that NONE of the 7 columns exist initially
    const prePragmaRes = await rawClient.execute('PRAGMA table_info("sync_jobs");');
    const initialColumns = new Set(prePragmaRes.rows.map((r: any) => String(r.name)));
    const targetColumns = [
      "workerId",
      "claimToken",
      "fencingToken",
      "fencingGeneration",
      "recordVersion",
      "leaseExpiresAt",
      "attemptNumber",
    ];

    for (const col of targetColumns) {
      expect(initialColumns.has(col)).toBe(false);
    }

    // 3. Seed historical KH-01 and KH-02 jobs before migration
    await rawClient.execute({
      sql: `INSERT INTO "workspaces" ("id", "name", "slug") VALUES (?, ?, ?)`,
      args: ["ws_legacy_1", "Legacy Workspace", "legacy-workspace-1"],
    });

    await rawClient.execute({
      sql: `INSERT INTO "sync_jobs" ("id", "workspaceId", "jobType", "status", "progress") VALUES (?, ?, ?, ?, ?)`,
      args: ["job_kh01_hist", "ws_legacy_1", "PRODUCT_OFFER_SYNC", "COMPLETED", 100],
    });

    const historicalResultJson = JSON.stringify({
      topic: "Ergonomic Office Chair",
      totalCandidatesDiscovered: 3,
      topThree: [{ candidate: { id: "c1", title: "Mesh Chair" } }],
    });

    await rawClient.execute({
      sql: `INSERT INTO "sync_jobs" ("id", "workspaceId", "jobType", "status", "progress", "resultJson") VALUES (?, ?, ?, ?, ?, ?)`,
      args: ["job_kh02_hist_comp", "ws_legacy_1", "KH02_RESEARCH", "COMPLETED", 100, historicalResultJson],
    });

    await rawClient.execute({
      sql: `INSERT INTO "sync_jobs" ("id", "workspaceId", "jobType", "status", "progress") VALUES (?, ?, ?, ?, ?)`,
      args: ["job_kh02_hist_pend", "ws_legacy_1", "KH02_RESEARCH", "PENDING", 0],
    });

    // 4. Connect Prisma Client to run migration
    const prisma = createPrismaClient(dbUrl);
    await prisma.$connect();

    try {
      // 5. Execute migration
      const migrationResult = await ensureSyncJobSchemaUpgraded(prisma);

      expect(migrationResult.upgraded).toBe(true);
      expect(migrationResult.addedColumns).toEqual(targetColumns);
      expect(migrationResult.indicesVerified).toBe(true);

      // 6. Direct PRAGMA table_info verification on SQLite metadata
      const postPragma: any = await prisma.$queryRawUnsafe('PRAGMA table_info("sync_jobs");');
      const postColMap = new Map<string, any>((postPragma || []).map((c: any) => [c.name, c]));

      for (const col of targetColumns) {
        expect(postColMap.has(col)).toBe(true);
      }

      // Check specific column types and default values
      expect((postColMap.get("fencingGeneration") as any)?.dflt_value).toBe("0");
      expect((postColMap.get("recordVersion") as any)?.dflt_value).toBe("0");
      expect((postColMap.get("attemptNumber") as any)?.dflt_value).toBe("0");

      // 7. Direct PRAGMA index_list verification on SQLite metadata
      const postIndices: any = await prisma.$queryRawUnsafe('PRAGMA index_list("sync_jobs");');
      const indexNames = new Set((postIndices || []).map((idx: any) => idx.name));
      expect(indexNames.has("sync_jobs_jobType_status_idx")).toBe(true);
      expect(indexNames.has("sync_jobs_workerId_status_idx")).toBe(true);

      // 8. Historical data preservation
      const kh01Job: any = await prisma.syncJob.findUnique({ where: { id: "job_kh01_hist" } });
      expect(kh01Job).not.toBeNull();
      expect(kh01Job.jobType).toBe("PRODUCT_OFFER_SYNC");
      expect(kh01Job.status).toBe("COMPLETED");
      expect(kh01Job.progress).toBe(100);
      expect(kh01Job.recordVersion).toBe(0);
      expect(kh01Job.fencingGeneration).toBe(0);

      const kh02Comp: any = await prisma.syncJob.findUnique({ where: { id: "job_kh02_hist_comp" } });
      expect(kh02Comp).not.toBeNull();
      expect(kh02Comp.resultJson).toBe(historicalResultJson);
      expect(JSON.parse(kh02Comp.resultJson).topic).toBe("Ergonomic Office Chair");

      const kh02Pend: any = await prisma.syncJob.findUnique({ where: { id: "job_kh02_hist_pend" } });
      expect(kh02Pend).not.toBeNull();
      expect(kh02Pend.status).toBe("PENDING");

      // 9. Idempotency verification: running migration a second time does not re-add columns or error
      const secondRun = await ensureSyncJobSchemaUpgraded(prisma);
      expect(secondRun.upgraded).toBe(false);
      expect(secondRun.addedColumns).toEqual([]);
      expect(secondRun.alreadyPresentColumns).toEqual(targetColumns);
      expect(secondRun.indicesVerified).toBe(true);

      // Records remain intact after second run
      const postSecondKh01: any = await prisma.syncJob.findUnique({ where: { id: "job_kh01_hist" } });
      expect(postSecondKh01.status).toBe("COMPLETED");
    } finally {
      await prisma.$disconnect();
      rawClient.close();
    }
  });

  it("handles partial migration recovery when only a subset of columns exist", async () => {
    const { dbPath, dbUrl } = createTempDbPath("legacy_partial_migration");

    const PARTIAL_DDL = `
      CREATE TABLE IF NOT EXISTS "sync_jobs" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "workspaceId" TEXT NOT NULL,
        "jobType" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "workerId" TEXT,
        "recordVersion" INTEGER NOT NULL DEFAULT 0,
        "attemptNumber" INTEGER NOT NULL DEFAULT 0
      );
    `;

    const rawClient = createClient({ url: dbUrl });
    await rawClient.executeMultiple(PARTIAL_DDL);

    const prisma = createPrismaClient(dbUrl);
    await prisma.$connect();

    try {
      const partialResult = await ensureSyncJobSchemaUpgraded(prisma);

      expect(partialResult.upgraded).toBe(true);
      // Columns that were already present
      expect(partialResult.alreadyPresentColumns).toContain("workerId");
      expect(partialResult.alreadyPresentColumns).toContain("recordVersion");
      expect(partialResult.alreadyPresentColumns).toContain("attemptNumber");

      // Columns that were newly added
      expect(partialResult.addedColumns).toContain("claimToken");
      expect(partialResult.addedColumns).toContain("fencingToken");
      expect(partialResult.addedColumns).toContain("fencingGeneration");
      expect(partialResult.addedColumns).toContain("leaseExpiresAt");

      // Verify all 7 columns now exist
      const postPragma: any = await prisma.$queryRawUnsafe('PRAGMA table_info("sync_jobs");');
      const postColNames = new Set((postPragma || []).map((c: any) => c.name));
      for (const col of [
        "workerId",
        "claimToken",
        "fencingToken",
        "fencingGeneration",
        "recordVersion",
        "leaseExpiresAt",
        "attemptNumber",
      ]) {
        expect(postColNames.has(col)).toBe(true);
      }
    } finally {
      await prisma.$disconnect();
      rawClient.close();
    }
  });
});
