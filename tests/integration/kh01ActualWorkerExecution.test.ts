import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import { executeDirectOrchestratorResearch } from "../../scripts/kh01/runFullAcceptance";
import { discoveryOrchestrator } from "../../src/services/discovery/discoveryOrchestrator";

describe("KH-01 Orchestrator Direct Integration (ORCHESTRATOR_INTEGRATION)", () => {
  let testDb: TestDatabaseHandle;
  const workspaceId = "ws_test_worker_acceptance";

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase({ prefix: "kh01-worker-exec" });
    // Seed workspace
    await testDb.prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "Worker Acceptance Workspace",
        operatingMode: "RESEARCH_ONLY",
        targetMarket: "US",
      },
    });

    // Ensure clean state without template runs
    await testDb.prisma.discoveryRun.deleteMany({});
    await testDb.prisma.syncJob.deleteMany({});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await testDb.teardown();
  });

  it("creates a genuine DiscoveryRun in PENDING state and executes via Worker claim", async () => {
    // Mock the actual execution to deterministically complete the run in isolated DB
    const executeSpy = vi.spyOn(discoveryOrchestrator, "executeDiscoveryJob").mockImplementation(async (runId: string) => {
      // Simulate genuine worker completing run and updating database terminal state
      await testDb.prisma.discoveryRun.update({
        where: { id: runId },
        data: {
          status: "COMPLETED",
          actualRetrievedCount: 3,
          validCount: 3,
          finishedAt: new Date(),
        },
      });
      return { success: true, processedCount: 3 } as any;
    });

    const context = {
      workspaceId,
      liveDbHandle: testDb,
      databaseUrl: testDb.url,
      testDatabaseUrl: testDb.url,
      timeoutMs: 15000,
    };

    const result = await executeDirectOrchestratorResearch(context as any, {
      market: "US",
      keywords: ["apparel"],
      limit: 5,
    });

    expect(result.runId).toBeTruthy();
    expect(result.initialStatus).toBe("PENDING");
    expect(result.finalStatus).toBe("COMPLETED");
    expect(result.success).toBe(true);
    expect(result.retrievedCount).toBe(3);
    expect(result.validCount).toBe(3);
    expect(executeSpy).toHaveBeenCalledWith(result.runId, expect.any(Object));

    // Invariant 2: Verify SQLite row directly
    const persistedRun = await testDb.prisma.discoveryRun.findUnique({
      where: { id: result.runId! },
    });
    expect(persistedRun).not.toBeNull();
    expect(persistedRun?.workspaceId).toBe(workspaceId);
    expect(persistedRun?.status).toBe("COMPLETED");
    expect(persistedRun?.actualRetrievedCount).toBe(3);
  });

  it("fails when Worker is unable to claim the pending job (claim invariant failed)", async () => {
    vi.spyOn(discoveryOrchestrator, "claimPendingDiscoveryJob").mockResolvedValue(null);

    const context = {
      workspaceId,
      liveDbHandle: testDb,
      databaseUrl: testDb.url,
      testDatabaseUrl: testDb.url,
      timeoutMs: 5000,
    };

    const result = await executeDirectOrchestratorResearch(context as any, {
      market: "US",
      keywords: ["electronics"],
      limit: 5,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Worker failed to claim job");
    expect(result.evidenceReferences).toContain("Job lease claim invariant failed");
  });

  it("fails when DiscoveryRun is created with non-PENDING status", async () => {
    // Intercept createDiscoveryJob to create a job that is already FAILED
    vi.spyOn(discoveryOrchestrator, "createDiscoveryJob").mockImplementation(async (params: any) => {
      const run = await testDb.prisma.discoveryRun.create({
        data: {
          workspaceId: params.workspaceId,
          providerId: params.providerId,
          status: "FAILED", // Bad initial status
          queryConfigJson: JSON.stringify(params),
        },
      });
      return { jobId: run.id, status: "FAILED" } as any;
    });

    const context = {
      workspaceId,
      liveDbHandle: testDb,
      databaseUrl: testDb.url,
      testDatabaseUrl: testDb.url,
      timeoutMs: 5000,
    };

    const result = await executeDirectOrchestratorResearch(context as any, {
      market: "US",
      keywords: ["beauty"],
      limit: 5,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("unexpected initial status 'FAILED' (expected PENDING)");
    expect(result.evidenceReferences).toContain("Job creation initial status invariant failed");
  });

  it("fails when Worker execution throws an exception", async () => {
    vi.spyOn(discoveryOrchestrator, "executeDiscoveryJob").mockRejectedValue(new Error("Worker process crash"));

    const context = {
      workspaceId,
      liveDbHandle: testDb,
      databaseUrl: testDb.url,
      testDatabaseUrl: testDb.url,
      timeoutMs: 5000,
    };

    const result = await executeDirectOrchestratorResearch(context as any, {
      market: "US",
      keywords: ["home"],
      limit: 5,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Worker process crash");
  });
});
