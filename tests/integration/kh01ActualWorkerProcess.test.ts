import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import {
  startIsolatedAcceptanceWorker,
  executeLiveResearchThroughWorker,
} from "../../scripts/kh01/runFullAcceptance";
import { canonicalizeSqliteDatabasePath } from "../../src/lib/database/databaseConfig";

describe("KH-01 Actual Worker Process Execution (FINAL-FIX-01)", () => {
  let testDb: TestDatabaseHandle;
  const workspaceId = "ws_actual_worker_test";

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase({ prefix: "actual-worker" });
    // Seed workspace
    await testDb.prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "Actual Worker Acceptance Workspace",
        operatingMode: "RESEARCH_ONLY",
        targetMarket: "US",
      },
    });

    // Seed data source
    await testDb.prisma.dataSource.create({
      data: {
        id: "ds_meta_collector",
        name: "meta-ads-collector",
        displayName: "Meta Ads Collector",
        capabilities: JSON.stringify(["KEYWORD_SEARCH"]),
        supportedRegions: JSON.stringify(["US"]),
      },
    });

    // Ensure clean state
    await testDb.prisma.discoveryRun.deleteMany({});
    await testDb.prisma.syncJob.deleteMany({});

    process.env.TEST_DATABASE_URL = testDb.url;
    process.env.SWAI_DB_ROLE = "LIVE_ACCEPTANCE";
    process.env.SWAI_TEST_ISOLATION = "strict";
  });

  afterEach(async () => {
    delete process.env.SWAI_MOCK_META_BOUNDARY;
    delete process.env.TEST_DATABASE_URL;
    delete process.env.SWAI_DB_ROLE;
    delete process.env.SWAI_TEST_ISOLATION;
    if (testDb) {
      await testDb.teardown();
    }
  });

  it("launches real child discovery-worker.ts subprocess with genuine OS PID and isolated DB", async () => {
    const context = {
      acceptanceRunId: `run_${Date.now()}`,
      workspaceId,
      databaseUrl: testDb.url,
      startedAt: new Date().toISOString(),
      liveDbHandle: testDb,
      cleanup: async () => {},
    };

    const worker = await startIsolatedAcceptanceWorker(context);
    try {
      expect(worker.pid).toBeGreaterThan(0);
      expect(typeof worker.pid).toBe("number");
      expect(worker.databaseIdentity).toBe(testDb.url);

      // Verify PID is genuinely running in the OS
      const isAlive = () => {
        try {
          process.kill(worker.pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      expect(isAlive()).toBe(true);
    } finally {
      await worker.stop();
    }
  });

  it("real worker subprocess claims pending discovery run and completes pipeline", async () => {
    process.env.SWAI_MOCK_META_BOUNDARY = "true";

    const context = {
      acceptanceRunId: `run_${Date.now()}`,
      workspaceId,
      databaseUrl: testDb.url,
      startedAt: new Date().toISOString(),
      liveDbHandle: testDb,
      cleanup: async () => {},
    };

    const result = await executeLiveResearchThroughWorker(context, {
      market: "US",
      keywords: ["orthopedic dog bed"],
      limit: 5,
    });

    expect(result.success).toBe(true);
    expect(result.initialStatus).toBe("PENDING");
    expect(result.finalStatus).toBe("COMPLETED");
    expect(result.workerId).toMatch(/^worker-pid-\d+$/);
    expect(result.retrievedCount).toBeGreaterThan(0);
    expect(result.validCount).toBeGreaterThan(0);

    // Verify row in isolated SQLite DB
    const dbRun = await testDb.prisma.discoveryRun.findUnique({
      where: { id: result.runId! },
    });
    expect(dbRun).not.toBeNull();
    expect(dbRun?.status).toBe("COMPLETED");
    expect(dbRun?.validCount).toBe(result.validCount);
  }, 30000);

  it("handles provider failure gracefully in real worker pipeline", async () => {
    process.env.SWAI_MOCK_META_BOUNDARY = "fail";

    const context = {
      acceptanceRunId: `run_${Date.now()}`,
      workspaceId,
      databaseUrl: testDb.url,
      startedAt: new Date().toISOString(),
      liveDbHandle: testDb,
      cleanup: async () => {},
    };

    const result = await executeLiveResearchThroughWorker(context, {
      market: "US",
      keywords: ["failing keyword"],
      limit: 5,
    });

    expect(result.success).toBe(false);
    expect(result.finalStatus).toBe("BLOCKED_SOURCE");
    expect(result.error).toBeTruthy();
  }, 30000);

  it("worker stops cleanly on stop() call and cannot mutate active app db", async () => {
    const activeAppDb = process.env.DATABASE_URL || "file:./dev.db";
    const activeLoc = canonicalizeSqliteDatabasePath(activeAppDb);
    const testLoc = canonicalizeSqliteDatabasePath(testDb.url);
    expect(activeLoc.canonicalKey).not.toBe(testLoc.canonicalKey);

    const context = {
      acceptanceRunId: `run_${Date.now()}`,
      workspaceId,
      databaseUrl: testDb.url,
      startedAt: new Date().toISOString(),
      liveDbHandle: testDb,
      cleanup: async () => {},
    };

    const worker = await startIsolatedAcceptanceWorker(context);
    const pid = worker.pid;
    await worker.stop();

    // Verify process terminated
    await new Promise((r) => setTimeout(r, 500));
    let isAlive = false;
    try {
      process.kill(pid, 0);
      isAlive = true;
    } catch {
      isAlive = false;
    }
    expect(isAlive).toBe(false);
  });
});
