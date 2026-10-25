import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { cleanupLiveJourneyResources, LiveJourneyResources } from "@/services/discovery/metaCollector/liveJourneyCleanup";
import { createIsolatedTestDatabase } from "../helpers/createIsolatedTestDatabase";
import { finalizeLiveJourneyVerdict } from "@/services/discovery/metaCollector/metaExactReconciliation";

describe("Live Journey Resource Management & Safe Cleanup (Sections 18, 19, 27)", () => {
  it("cleans up resources cleanly and reports all subsystems closed", async () => {
    // 1. Create a dummy isolated DB
    const dbHandle = await createIsolatedTestDatabase({ prefix: "cleanup-test-db" });
    const dbPath = dbHandle.filePath;
    expect(fs.existsSync(dbPath)).toBe(true);

    // 2. Spawn a short-lived dummy child process
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
    expect(child.pid).toBeTruthy();

    let serverStopped = false;
    const fakeServer = {
      stop: async () => {
        serverStopped = true;
      },
    };

    let mcpClosed = false;
    const fakeMcp = {
      close: async () => {
        mcpClosed = true;
      },
    };

    const resources: LiveJourneyResources = {
      workerChild: child,
      server: fakeServer,
      mcpClient: fakeMcp,
      dbHandle,
    };

    const cleanupResult = await cleanupLiveJourneyResources(resources);

    expect(cleanupResult.workerStopped).toBe(true);
    expect(cleanupResult.nextServerStopped).toBe(true);
    expect(cleanupResult.mcpClosed).toBe(true);
    expect(cleanupResult.prismaDisconnected).toBe(true);
    expect(cleanupResult.isolatedDatabaseDeleted).toBe(true);
    expect(cleanupResult.errors).toHaveLength(0);

    expect(serverStopped).toBe(true);
    expect(mcpClosed).toBe(true);
    // Database file must be deleted
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("is idempotent when called multiple times without throwing errors", async () => {
    const fakeServer = {
      stop: async () => {},
    };

    const resources: LiveJourneyResources = {
      server: fakeServer,
    };

    const res1 = await cleanupLiveJourneyResources(resources);
    expect(res1.nextServerStopped).toBe(true);

    // Second call with same resources
    const res2 = await cleanupLiveJourneyResources(resources);
    expect(res2.nextServerStopped).toBe(true);
    expect(res2.errors).toHaveLength(0);
  });

  it("preserves active dev.db completely untouched during teardown", async () => {
    const devDbPath = path.resolve(process.cwd(), "dev.db");
    const devDbExists = fs.existsSync(devDbPath);
    let devDbMtimeBefore: number | null = null;
    if (devDbExists) {
      devDbMtimeBefore = fs.statSync(devDbPath).mtimeMs;
    }

    const isolatedDb = await createIsolatedTestDatabase({ prefix: "cleanup-devdb-safety" });
    const isolatedPath = isolatedDb.filePath;

    await cleanupLiveJourneyResources({
      dbHandle: isolatedDb,
    });

    expect(fs.existsSync(isolatedPath)).toBe(false);
    if (devDbExists) {
      expect(fs.existsSync(devDbPath)).toBe(true);
      const devDbMtimeAfter = fs.statSync(devDbPath).mtimeMs;
      expect(devDbMtimeAfter).toBe(devDbMtimeBefore);
    }
  });

  it("fails closed on injected stage errors and preserves failure verdict", () => {
    // Stage failure at Worker
    const workerFailedVerdict = finalizeLiveJourneyVerdict({
      source: "PASSED",
      worker: "FAILED",
      persistence: "SKIPPED",
      http: "SKIPPED",
      browser: "SKIPPED",
      reconciliation: "SKIPPED",
      artifactIntegrity: "FAILED",
    });

    expect(workerFailedVerdict.success).toBe(false);
    expect(workerFailedVerdict.verdict).toBe("FAILED");
    expect(workerFailedVerdict.blockingReasons.some((r) => r.includes("worker"))).toBe(true);

    // Stage failure at Upstream Source
    const sourceBlockedVerdict = finalizeLiveJourneyVerdict({
      source: "BLOCKED",
      worker: "SKIPPED",
      persistence: "SKIPPED",
      http: "SKIPPED",
      browser: "SKIPPED",
      reconciliation: "SKIPPED",
      artifactIntegrity: "FAILED",
    });

    expect(sourceBlockedVerdict.success).toBe(false);
    expect(sourceBlockedVerdict.verdict).toBe("BLOCKED");
  });
});
