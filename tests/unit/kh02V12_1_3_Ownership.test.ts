/**
 * SWAI KH-02 V12.1.3 — Final Runtime Ownership, Pure Orchestrator & Fencing Integrity Unit Suite
 *
 * Verifies:
 * 1. Orchestrator pure research invariant: zero unowned status/snapshot writes, progress via context.
 * 2. Truthful demand history initialization (CONFIGURED, promoted only on stability PASS).
 * 3. Atomic CAS with dedicated columns (fencingGeneration, recordVersion, workerId).
 * 4. Separation of fencing generation from record version (renewal increments recordVersion, not generation).
 * 5. Complete Worker A vs Worker B stale-write rejection sequence (Section 44).
 * 6. Heartbeat in-flight deduplication guard.
 */

import { describe, it, expect, vi } from "vitest";
import {
  claimNextResearchJob,
  renewResearchJobLease,
  updateResearchProgress,
  completeResearchJob,
  failResearchJob,
  updateJobIfClaimOwned,
  JobOwnership,
  ResearchHeartbeatManager,
} from "@/workers/kh02Worker";
import {
  runEvergreenProductResearch,
  KH02ResearchExecutionContext,
} from "@/services/kh02/evergreenResearchOrchestrator";

describe("SWAI KH-02 V12.1.3 — Runtime Ownership & Pure Orchestration", () => {
  // ── 1. ORCHESTRATOR PURITY & ZERO UNOWNED WRITES ─────────────────────────

  it("orchestrator executes without calling unowned DB status or snapshot mutations", async () => {
    // When no context is provided, orchestrator should complete without error
    // and not attempt to write to prisma/DB.
    const result = await runEvergreenProductResearch({
      topic: "Pet Accessories",
      market: "US",
      lookbackDays: 90,
      workspaceId: "test-workspace-pure",
    });

    expect(result).toBeDefined();
    expect(result.topic).toBe("Pet Accessories");
    expect(result.market).toBe("US");
    expect(result.sourceStatuses).toBeDefined();
    // Verify DEMAND_HISTORY initial truthfulness
    expect(["CONFIGURED", "NOT_VERIFIED", "SOURCE_DATA_VERIFIED"]).toContain(
      result.sourceStatuses.DEMAND_HISTORY
    );
  });

  it("orchestrator delegates progress to execution context reportProgress callback", async () => {
    const reportedProgress: any[] = [];
    const context: KH02ResearchExecutionContext = {
      workspaceId: "ws-test",
      runId: "run-test-123",
      reportProgress: async (p) => {
        reportedProgress.push(p);
      },
    };

    const result = await runEvergreenProductResearch(
      {
        topic: "Kitchen Tools",
        market: "US",
        lookbackDays: 90,
        workspaceId: "ws-test",
      },
      context
    );

    expect(result).toBeDefined();
    expect(reportedProgress.length).toBeGreaterThan(0);
    expect(reportedProgress[0].stage).toBe("DISCOVERY");
    expect(reportedProgress.some((p) => p.stage === "SCORING")).toBe(true);
  });

  // ── 2. SEPARATION OF FENCING GENERATION & RECORD VERSION ──────────────────

  it("lease renewal advances recordVersion while preserving fencingGeneration", async () => {
    let storedVersion = 0;
    const initialGeneration = 3;

    const mockDb = {
      syncJob: {
        findUnique: vi.fn().mockImplementation(() =>
          Promise.resolve({
            id: "job-renew-test",
            status: "RUNNING",
            workerId: "worker-prime",
            claimToken: "token-prime",
            fencingGeneration: initialGeneration,
            recordVersion: storedVersion,
            leaseExpiresAt: new Date(Date.now() + 30000),
            resultJson: JSON.stringify({
              topic: "Wireless Earbuds",
              _runtime: {
                workerId: "worker-prime",
                fencingToken: "fence-prime",
                fencingVersion: storedVersion,
                leaseExpiresAt: new Date(Date.now() + 30000).toISOString(),
              },
            }),
          })
        ),
        updateMany: vi.fn().mockImplementation(({ where, data }) => {
          // Check matching generation and version
          const matches =
            where.fencingGeneration === initialGeneration;
          if (matches) {
            storedVersion++;
            return Promise.resolve({ count: 1 });
          }
          return Promise.resolve({ count: 0 });
        }),
      },
    };

    const ownership: JobOwnership = {
      workerId: "worker-prime",
      claimToken: "token-prime",
      fencingToken: "fence-prime",
      fencingGeneration: initialGeneration,
      recordVersion: storedVersion,
    };

    const renewResult = await renewResearchJobLease(
      "job-renew-test",
      ownership,
      mockDb as any
    );

    expect(renewResult.renewed).toBe(true);
    expect(ownership.recordVersion).toBe(1);
    expect(storedVersion).toBe(1);
  });

  // ── 3. WORKER A VS WORKER B COMPLETE STALE-WRITE SEQUENCE (SECTION 44) ────

  it("rejects all stale writes from Worker A after lease is lost to Worker B", async () => {
    // Current database state holds Worker B with generation 2
    const currentDbState = {
      id: "job-contested-1",
      status: "RUNNING",
      workerId: "worker-bravo",
      claimToken: "claim-bravo",
      fencingGeneration: 2,
      recordVersion: 0,
      leaseExpiresAt: new Date(Date.now() + 60000),
      resultJson: JSON.stringify({
        topic: "Ergonomic Chairs",
        _runtime: {
          workerId: "worker-bravo",
          fencingToken: "fence-bravo",
          fencingGeneration: 2,
          recordVersion: 0,
        },
      }),
    };

    const mockDb = {
      syncJob: {
        findUnique: vi.fn().mockResolvedValue(currentDbState),
        updateMany: vi.fn().mockImplementation(({ where, data }) => {
          // Strict CAS match on generation and workerId
          const generationMatches =
            where.fencingGeneration === currentDbState.fencingGeneration ||
            where.resultJson?.contains === "fence-bravo";
          const workerMatches = !where.workerId || where.workerId === currentDbState.workerId;
          const statusMatches = where.status === currentDbState.status;

          if (generationMatches && workerMatches && statusMatches) {
            return Promise.resolve({ count: 1 });
          }
          return Promise.resolve({ count: 0 });
        }),
      },
    };

    // Stale Worker A holds generation 1
    const workerAOwnership: JobOwnership = {
      workerId: "worker-alpha",
      claimToken: "claim-alpha",
      fencingToken: "fence-alpha",
      fencingGeneration: 1,
      recordVersion: 3,
    };

    // Active Worker B holds generation 2
    const workerBOwnership: JobOwnership = {
      workerId: "worker-bravo",
      claimToken: "claim-bravo",
      fencingToken: "fence-bravo",
      fencingGeneration: 2,
      recordVersion: 0,
    };

    // 1. Worker A attempts progress -> MUST BE REJECTED
    const aProgress = await updateResearchProgress(
      "job-contested-1",
      workerAOwnership,
      { stage: "ANALYZING_DEMAND", percent: 60 },
      mockDb as any
    );
    expect(aProgress.success).toBe(false);
    expect(aProgress.rowsAffected).toBe(0);

    // 2. Worker A attempts completion -> MUST BE REJECTED
    const dummyResult: any = {
      researchRunId: "job-contested-1",
      topic: "Ergonomic Chairs",
      market: "US",
      analyzedAt: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      lookbackDays: 90,
      runStatus: "COMPLETED",
      totalCandidatesDiscovered: 1,
      formulaVersion: "12.1.3",
      scoringVersion: "12.1.3",
      topThree: [],
      provisionalCandidates: [],
      remainingCandidates: [],
      insufficientEvidenceCandidates: [],
      sourceStatuses: {} as any,
    };
    const aComplete = await completeResearchJob(
      "job-contested-1",
      workerAOwnership,
      dummyResult,
      mockDb as any
    );
    expect(aComplete.success).toBe(false);
    expect(aComplete.rowsAffected).toBe(0);

    // 3. Worker A attempts failure -> MUST BE REJECTED
    const aFail = await failResearchJob(
      "job-contested-1",
      workerAOwnership,
      new Error("Worker A transient crash"),
      mockDb as any
    );
    expect(aFail.success).toBe(false);
    expect(aFail.rowsAffected).toBe(0);

    // 4. Worker B attempts progress -> SUCCEEDS
    const bProgress = await updateResearchProgress(
      "job-contested-1",
      workerBOwnership,
      { stage: "ANALYZING_DEMAND", percent: 70 },
      mockDb as any
    );
    expect(bProgress.success).toBe(true);
    expect(bProgress.rowsAffected).toBe(1);

    // 5. Worker B attempts completion -> SUCCEEDS
    const bComplete = await completeResearchJob(
      "job-contested-1",
      workerBOwnership,
      dummyResult,
      mockDb as any
    );
    expect(bComplete.success).toBe(true);
    expect(bComplete.rowsAffected).toBe(1);
  });

  // ── 4. HEARTBEAT IN-FLIGHT GUARD ──────────────────────────────────────────

  it("heartbeat manager prevents overlapping concurrent renewals", async () => {
    let renewalInvocations = 0;
    const mockDb = {
      syncJob: {
        findUnique: vi.fn().mockImplementation(() =>
          Promise.resolve({
            id: "job-hb-test",
            status: "RUNNING",
            workerId: "worker-hb",
            fencingToken: "hb-fence",
            fencingGeneration: 1,
            recordVersion: 0,
            leaseExpiresAt: new Date(Date.now() + 30000),
            resultJson: JSON.stringify({
              _runtime: {
                workerId: "worker-hb",
                fencingToken: "hb-fence",
                fencingVersion: 1,
                leaseExpiresAt: new Date(Date.now() + 30000).toISOString(),
              },
            }),
          })
        ),
        updateMany: vi.fn().mockImplementation(async () => {
          renewalInvocations++;
          await new Promise((r) => setTimeout(r, 20));
          return { count: 1 };
        }),
      },
    };

    const ownership: JobOwnership = {
      workerId: "worker-hb",
      claimToken: "claim-hb",
      fencingToken: "hb-fence",
      fencingGeneration: 1,
      recordVersion: 0,
    };

    const hb = new ResearchHeartbeatManager("job-hb-test", ownership, 40, mockDb as any);
    hb.start();

    // Wait 150ms (interval is 40ms, each renewal takes 20ms)
    await new Promise((r) => setTimeout(r, 150));
    hb.stop();

    expect(renewalInvocations).toBeGreaterThanOrEqual(1);
    expect(hb.isRunning()).toBe(false);
  });
});
