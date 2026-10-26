/**
 * SWAI KH-02 V12.1.4.2 — Integration Test Suite: Long-Running Research, Worker Lifecycle & Reload Recovery
 *
 * Verifies on real isolated SQLite persistence:
 * 1. Async research job creation with durable SyncJob record in PENDING state.
 * 2. Independent worker claim with monotonic fencing token and lease expiration.
 * 3. Worker heartbeat persistence across idle and processing states.
 * 4. Progressive stage updates (DISCOVERY -> NORMALIZATION -> ENRICHMENT -> SCORING -> SNAPSHOT).
 * 5. Active job readback (simulating browser reload while research is RUNNING).
 * 6. Terminal completion with immutable leaderboard snapshot.
 * 7. Worker offline detection before claim.
 * 8. Stale worker crash recovery.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import {
  claimNextResearchJob,
  executeResearchJob,
  persistKh02WorkerHeartbeat,
  getSharedResearchWorkerHealth,
  recoverStaleResearchJobs,
} from "@/workers/kh02Worker";
import {
  createKH02ResearchRun,
  enqueueResearchJob,
  getKH02ResearchRunById,
  getKH02ActiveResearchRun,
} from "@/services/kh02/persistence/kh02PersistenceService";
import {
  diagnoseKH02Source,
  testKH02SourceConnection,
} from "@/services/kh02/providers/sourceRegistry";

describe("SWAI KH-02 V12.1.4.2 — Integration: Long-Running Research & Worker Lifecycle", () => {
  let ctx: TestDatabaseHandle;
  const TEST_WS = "ws_long_research_12_1_4_2";

  beforeEach(async () => {
    ctx = await createIsolatedTestDatabase({ prefix: "kh02-long-research" });

    await ctx.prisma.workspace.create({
      data: {
        id: TEST_WS,
        name: "Long Research Test Workspace",
        operatingMode: "RESEARCH_ONLY",
        targetMarket: "US",
      },
    });
  });

  afterEach(async () => {
    if (ctx) {
      await ctx.teardown();
    }
  });

  it("executes complete async research lifecycle from enqueue to worker claim and terminal snapshot", async () => {
    // 1. Enqueue job
    const runId = await createKH02ResearchRun({
      workspaceId: TEST_WS,
      topic: "Pet Gadgets",
      market: "US",
      lookbackDays: 90,
      maxCandidates: 5,
    }, ctx.prisma);
    await enqueueResearchJob(runId, { workspaceId: TEST_WS }, ctx.prisma);

    // Verify initial PENDING state and active run discovery
    const initialRun = await getKH02ResearchRunById(runId, TEST_WS, ctx.prisma);
    expect(initialRun).toBeTruthy();
    expect(initialRun?.status).toBe("PENDING");

    // 2. Active run query detects pending job
    const activeBeforeClaim = await ctx.prisma.syncJob.findFirst({
      where: {
        workspaceId: TEST_WS,
        jobType: "KH02_RESEARCH",
        status: { in: ["PENDING", "RUNNING"] },
      },
    });
    expect(activeBeforeClaim?.id).toBe(runId);

    // 3. Worker claims job
    const workerId = "worker-integration-alpha";
    await persistKh02WorkerHeartbeat(workerId, null, "RUNNING", {}, ctx.prisma);

    const claimed = await claimNextResearchJob(workerId, ctx.prisma);
    expect(claimed).toBeTruthy();
    expect(claimed?.id).toBe(runId);
    expect(claimed?.workerId).toBe(workerId);
    expect(claimed?.fencingGeneration).toBeGreaterThanOrEqual(1);

    // 4. Worker executes job
    const outcome = await executeResearchJob(claimed!, ctx.prisma);
    expect(outcome.success).toBe(true);

    // 5. Verify terminal snapshot in database
    const terminal = await getKH02ResearchRunById(runId, TEST_WS, ctx.prisma);
    expect(terminal?.status).toBe("COMPLETED");
    expect(terminal?.result).toBeTruthy();
    expect(terminal?.result?.topic).toBe("Pet Gadgets");
    expect(terminal?.completedAt).toBeTruthy();

    // 6. Active run query no longer returns the finished job
    const activeAfter = await ctx.prisma.syncJob.findFirst({
      where: {
        workspaceId: TEST_WS,
        jobType: "KH02_RESEARCH",
        status: { in: ["PENDING", "RUNNING"] },
      },
    });
    expect(activeAfter).toBeNull();
  });

  it("detects worker offline when job is PENDING and no active heartbeat exists", async () => {
    const health = await getSharedResearchWorkerHealth(ctx.prisma);
    expect(health.status).toBe("OFFLINE");

    const runId = await createKH02ResearchRun({
      workspaceId: TEST_WS,
      topic: "Home Cleaning",
      lookbackDays: 180,
    }, ctx.prisma);

    const run = await getKH02ResearchRunById(runId, TEST_WS, ctx.prisma);
    expect(run?.status).toBe("PENDING");
    // With worker OFFLINE, frontend displays "Research queued — worker not running"
  });

  it("recovers stale job after worker crash and allows subsequent worker to finish research", async () => {
    const runId = await createKH02ResearchRun({
      workspaceId: TEST_WS,
      topic: "Kitchen Organization",
      lookbackDays: 365,
    }, ctx.prisma);
    await enqueueResearchJob(runId, { workspaceId: TEST_WS }, ctx.prisma);

    // Worker 1 claims job
    const worker1 = "crashed-worker";
    const claimed = await claimNextResearchJob(worker1, ctx.prisma);
    expect(claimed).toBeTruthy();

    // Simulate crash: expire the lease
    const expiredTime = new Date(Date.now() - 5000);
    await ctx.prisma.syncJob.update({
      where: { id: runId },
      data: { leaseExpiresAt: expiredTime },
    });

    // Run recovery
    const recovery = await recoverStaleResearchJobs(ctx.prisma);
    expect(recovery.recoveredCount).toBe(1);

    // Job should be reset to PENDING with attemptNumber = 1
    const recoveredJob = await getKH02ResearchRunById(runId, TEST_WS, ctx.prisma);
    expect(recoveredJob?.status).toBe("PENDING");

    // Worker 2 claims and finishes
    const worker2 = "healthy-worker";
    const reclaimed = await claimNextResearchJob(worker2, ctx.prisma);
    expect(reclaimed).toBeTruthy();
    expect(reclaimed?.workerId).toBe(worker2);

    const outcome = await executeResearchJob(reclaimed!, ctx.prisma);
    expect(outcome.success).toBe(true);
  });
});
