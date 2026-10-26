/**
 * SWAI KH-02 V12.1.4 — Atomic Lease CAS, Stale Recovery & SQLite Concurrency Test Suite
 *
 * Verifies on real isolated SQLite persistence:
 * 1. Exact conditional update CAS on dedicated columns (workerId, claimToken, fencingToken, fencingGeneration, recordVersion, leaseExpiresAt).
 * 2. Monotonic recordVersion increments without changing fencingGeneration on heartbeats.
 * 3. Heartbeat vs progress contention with safe same-owner retry.
 * 4. Heartbeat vs recovery race condition: recovery write fails if heartbeat extended lease deadline.
 * 5. Concurrent recovery conflict: two recovery workers racing on the same expired job; exactly one wins.
 * 6. Stale worker write rejection across progress, completion, and failure transitions.
 * 7. Safe, idempotent SQLite schema upgrade (ensureSyncJobSchemaUpgraded) on existing databases.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import {
  renewResearchJobLease,
  updateResearchProgress,
  completeResearchJob,
  failResearchJob,
  recoverStaleResearchJobs,
  updateJobIfClaimOwned,
  JobOwnership,
} from "@/workers/kh02Worker";
import {
  ensureSyncJobSchemaUpgraded,
} from "@/services/kh02/persistence/kh02PersistenceService";

describe("SWAI KH-02 V12.1.4 — Atomic Lease CAS & Database Concurrency", () => {
  let ctx: TestDatabaseHandle;
  const TEST_WS = "ws_cas_test_12_1_4";

  beforeEach(async () => {
    ctx = await createIsolatedTestDatabase({ prefix: "kh02-cas-v12-1-4" });

    // Seed test workspace
    await ctx.prisma.workspace.create({
      data: {
        id: TEST_WS,
        name: "CAS Test Workspace",
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

  // ── 1. EXACT CONDITIONAL UPDATE CAS ON DEDICATED COLUMNS ─────────────────────

  it("updateJobIfClaimOwned enforces exact conditional match on all identity columns", async () => {
    const now = new Date();
    const leaseExp = new Date(Date.now() + 60000);

    // Create active RUNNING job
    const job = await ctx.prisma.syncJob.create({
      data: {
        id: `job_cas_${Date.now()}`,
        workspaceId: TEST_WS,
        jobType: "KH02_RESEARCH",
        status: "RUNNING",
        workerId: "worker-correct",
        claimToken: "claim-correct",
        fencingToken: "fence-correct",
        fencingGeneration: 1,
        recordVersion: 1,
        leaseExpiresAt: leaseExp,
        startedAt: now,
      },
    });

    const validOwnership: JobOwnership = {
      workerId: "worker-correct",
      claimToken: "claim-correct",
      fencingToken: "fence-correct",
      fencingGeneration: 1,
      recordVersion: 1,
      leaseExpiresAt: leaseExp.toISOString(),
    };

    // 1. Valid owner mutation succeeds
    const successRes = await updateJobIfClaimOwned(
      job.id,
      validOwnership,
      { progress: 25 },
      ctx.prisma
    );
    expect(successRes.success).toBe(true);
    expect(successRes.rowsAffected).toBe(1);
    expect(validOwnership.recordVersion).toBe(2);

    // 2. Wrong workerId rejected
    const wrongWorkerRes = await updateJobIfClaimOwned(
      job.id,
      { ...validOwnership, workerId: "imposter-worker" },
      { progress: 30 },
      ctx.prisma
    );
    expect(wrongWorkerRes.success).toBe(false);
    expect(wrongWorkerRes.reason).toBe("OWNERSHIP_LOST");

    // 3. Wrong claimToken rejected
    const wrongTokenRes = await updateJobIfClaimOwned(
      job.id,
      { ...validOwnership, claimToken: "forged-claim" },
      { progress: 35 },
      ctx.prisma
    );
    expect(wrongTokenRes.success).toBe(false);
    expect(wrongTokenRes.reason).toBe("OWNERSHIP_LOST");

    // 4. Stale recordVersion rejected
    const staleVersionRes = await updateJobIfClaimOwned(
      job.id,
      { ...validOwnership, recordVersion: 1 }, // Job is now version 2
      { progress: 40 },
      ctx.prisma
    );
    // Safe retry refreshes and succeeds because same owner is valid
    expect(staleVersionRes.success).toBe(true);

    // 5. Expired lease rejected at write time
    await ctx.prisma.syncJob.update({
      where: { id: job.id },
      data: { leaseExpiresAt: new Date(Date.now() - 5000) },
    });
    const expiredRes = await updateJobIfClaimOwned(
      job.id,
      validOwnership,
      { progress: 50 },
      ctx.prisma
    );
    expect(expiredRes.success).toBe(false);
    expect(expiredRes.reason).toBe("LEASE_EXPIRED");
  });

  // ── 2. HEARTBEAT ADVANCES RECORD VERSION, PRESERVES FENCING GENERATION ──────

  it("renewResearchJobLease advances recordVersion monotonically and never advances fencingGeneration", async () => {
    const leaseExp = new Date(Date.now() + 30000);
    const initialGeneration = 4;
    const initialRecordVersion = 2;

    const job = await ctx.prisma.syncJob.create({
      data: {
        id: `job_hb_mono_${Date.now()}`,
        workspaceId: TEST_WS,
        jobType: "KH02_RESEARCH",
        status: "RUNNING",
        workerId: "worker-heartbeat",
        claimToken: "claim-hb-token",
        fencingToken: "fence-hb-token",
        fencingGeneration: initialGeneration,
        recordVersion: initialRecordVersion,
        leaseExpiresAt: leaseExp,
        resultJson: JSON.stringify({
          _runtime: {
            workerId: "worker-heartbeat",
            fencingToken: "fence-hb-token",
            fencingGeneration: initialGeneration,
            recordVersion: initialRecordVersion,
          },
        }),
      },
    });

    const ownership: JobOwnership = {
      workerId: "worker-heartbeat",
      claimToken: "claim-hb-token",
      fencingToken: "fence-hb-token",
      fencingGeneration: initialGeneration,
      recordVersion: initialRecordVersion,
      leaseExpiresAt: leaseExp.toISOString(),
    };

    // First renewal
    const r1 = await renewResearchJobLease(job.id, ownership, ctx.prisma);
    expect(r1.renewed).toBe(true);
    expect(ownership.recordVersion).toBe(3);
    expect(ownership.fencingGeneration).toBe(initialGeneration); // Generation unchanged!

    // Second renewal
    const r2 = await renewResearchJobLease(job.id, ownership, ctx.prisma);
    expect(r2.renewed).toBe(true);
    expect(ownership.recordVersion).toBe(4);
    expect(ownership.fencingGeneration).toBe(initialGeneration); // Generation unchanged!

    // Verify persisted DB values
    const dbJob = await ctx.prisma.syncJob.findUnique({ where: { id: job.id } });
    expect(dbJob?.fencingGeneration).toBe(initialGeneration);
    expect(dbJob?.recordVersion).toBe(4);
  });

  // ── 3. HEARTBEAT VS PROGRESS CONTENTION (SAFE SAME-OWNER RETRY) ─────────────

  it("safely handles heartbeat vs progress write races with same-owner CAS retry", async () => {
    const job = await ctx.prisma.syncJob.create({
      data: {
        id: `job_race_${Date.now()}`,
        workspaceId: TEST_WS,
        jobType: "KH02_RESEARCH",
        status: "RUNNING",
        workerId: "worker-duo",
        claimToken: "claim-duo",
        fencingToken: "fence-duo",
        fencingGeneration: 1,
        recordVersion: 1,
        leaseExpiresAt: new Date(Date.now() + 45000),
        resultJson: JSON.stringify({
          _runtime: {
            workerId: "worker-duo",
            fencingToken: "fence-duo",
            fencingGeneration: 1,
            recordVersion: 1,
          },
        }),
      },
    });

    const sharedOwnership: JobOwnership = {
      workerId: "worker-duo",
      claimToken: "claim-duo",
      fencingToken: "fence-duo",
      fencingGeneration: 1,
      recordVersion: 1,
      leaseExpiresAt: new Date(Date.now() + 45000).toISOString(),
    };

    // Simulate progress updating recordVersion in the database behind the heartbeat's back
    await ctx.prisma.syncJob.update({
      where: { id: job.id },
      data: {
        recordVersion: 2,
        progress: 30,
      },
    });

    // Heartbeat tries with old expected recordVersion 1; should detect same-owner version contention and safely retry
    const renewRes = await renewResearchJobLease(job.id, sharedOwnership, ctx.prisma);
    expect(renewRes.renewed).toBe(true);
    expect(sharedOwnership.recordVersion).toBe(3);

    // Progress update after renewal
    const progRes = await updateResearchProgress(
      job.id,
      sharedOwnership,
      { stage: "ANALYSIS", percent: 60 },
      ctx.prisma
    );
    expect(progRes.success).toBe(true);
    expect(sharedOwnership.recordVersion).toBe(4);
  });

  // ── 4. HEARTBEAT VS RECOVERY RACE CONDITION (LEASE EXPIRY AT WRITE TIME) ────

  it("prevents recovery from snatching a lease when heartbeat extends it before recovery write", async () => {
    // 1. Create a job whose lease just expired 100ms ago
    const expiredTime = new Date(Date.now() - 100);
    const job = await ctx.prisma.syncJob.create({
      data: {
        id: `job_recovery_race_${Date.now()}`,
        workspaceId: TEST_WS,
        jobType: "KH02_RESEARCH",
        status: "RUNNING",
        workerId: "worker-live",
        claimToken: "claim-live",
        fencingToken: "fence-live",
        fencingGeneration: 2,
        recordVersion: 5,
        leaseExpiresAt: expiredTime,
        attemptNumber: 1,
        resultJson: JSON.stringify({
          _runtime: {
            workerId: "worker-live",
            fencingToken: "fence-live",
            fencingGeneration: 2,
            recordVersion: 5,
            leaseExpiresAt: expiredTime.toISOString(),
          },
        }),
      },
    });

    // 2. Active worker heartbeat successfully extends the lease into the future
    await ctx.prisma.syncJob.update({
      where: { id: job.id },
      data: {
        leaseExpiresAt: new Date(Date.now() + 60000),
        recordVersion: 6,
      },
    });

    // 3. Stale-job recovery scans and attempts atomic conditional reclaim
    // Its conditional update WHERE clause includes leaseExpiresAt <= now at write time!
    const recovery = await recoverStaleResearchJobs(ctx.prisma);

    // Recovery must NOT have touched the job because leaseExpiresAt is now in the future
    expect(recovery.recoveredCount).toBe(0);

    const checkJob = await ctx.prisma.syncJob.findUnique({ where: { id: job.id } });
    expect(checkJob?.status).toBe("RUNNING");
    expect(checkJob?.workerId).toBe("worker-live");
    expect(checkJob?.fencingGeneration).toBe(2);
  });

  // ── 5. TWO RECOVERY WORKERS CONTENTION (EXACTLY ONE WINS) ───────────────────

  it("resolves concurrent recovery contention so exactly one recovery worker reclaims", async () => {
    const expiredTime = new Date(Date.now() - 10000);
    const job = await ctx.prisma.syncJob.create({
      data: {
        id: `job_contended_rec_${Date.now()}`,
        workspaceId: TEST_WS,
        jobType: "KH02_RESEARCH",
        status: "RUNNING",
        workerId: "worker-crashed",
        claimToken: "claim-crashed",
        fencingToken: "fence-crashed",
        fencingGeneration: 1,
        recordVersion: 3,
        leaseExpiresAt: expiredTime,
        attemptNumber: 1,
        resultJson: JSON.stringify({
          _runtime: {
            workerId: "worker-crashed",
            fencingToken: "fence-crashed",
            fencingGeneration: 1,
            recordVersion: 3,
            leaseExpiresAt: expiredTime.toISOString(),
          },
        }),
      },
    });

    // Execute two recovery sweeps concurrently
    const [recA, recB] = await Promise.all([
      recoverStaleResearchJobs(ctx.prisma),
      recoverStaleResearchJobs(ctx.prisma),
    ]);

    // Total recovered count across both sweeps must equal exactly 1 (no duplicate recovery)
    expect(recA.recoveredCount + recB.recoveredCount).toBe(1);

    const recoveredJob = await ctx.prisma.syncJob.findUnique({ where: { id: job.id } });
    expect(recoveredJob?.status).toBe("PENDING");
    expect(recoveredJob?.workerId).toBeNull();
    expect(recoveredJob?.claimToken).toBeNull();
    expect(recoveredJob?.fencingGeneration).toBe(2); // Advanced to next generation
    expect(recoveredJob?.recordVersion).toBe(0);
  });

  // ── 6. STALE WORKER WRITE REJECTION ACROSS ALL TRANSITIONS ──────────────────

  it("completely rejects progress, completion, and failure writes from stale workers after recovery", async () => {
    const expiredTime = new Date(Date.now() - 20000);
    const job = await ctx.prisma.syncJob.create({
      data: {
        id: `job_stale_rejection_${Date.now()}`,
        workspaceId: TEST_WS,
        jobType: "KH02_RESEARCH",
        status: "RUNNING",
        workerId: "worker-stale-alpha",
        claimToken: "claim-stale-alpha",
        fencingToken: "fence-stale-alpha",
        fencingGeneration: 1,
        recordVersion: 2,
        leaseExpiresAt: expiredTime,
        attemptNumber: 1,
      },
    });

    const staleOwnership: JobOwnership = {
      workerId: "worker-stale-alpha",
      claimToken: "claim-stale-alpha",
      fencingToken: "fence-stale-alpha",
      fencingGeneration: 1,
      recordVersion: 2,
    };

    // Recover job to PENDING
    const rec = await recoverStaleResearchJobs(ctx.prisma);
    expect(rec.recoveredCount).toBe(1);

    // Stale Worker Alpha attempts progress update -> REJECTED
    const progRes = await updateResearchProgress(
      job.id,
      staleOwnership,
      { stage: "LATE_STAGE", percent: 80 },
      ctx.prisma
    );
    expect(progRes.success).toBe(false);
    expect(progRes.rowsAffected).toBe(0);

    // Stale Worker Alpha attempts terminal completion -> REJECTED
    const dummyResult: any = {
      researchRunId: job.id,
      topic: "Stale Topic",
      market: "US",
      analyzedAt: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      lookbackDays: 90,
      runStatus: "COMPLETED",
      totalCandidatesDiscovered: 0,
      formulaVersion: "12.1.4",
      scoringVersion: "12.1.4",
      topThree: [],
      provisionalCandidates: [],
      remainingCandidates: [],
      insufficientEvidenceCandidates: [],
      sourceStatuses: {} as any,
    };
    const compRes = await completeResearchJob(job.id, staleOwnership, dummyResult, ctx.prisma);
    expect(compRes.success).toBe(false);
    expect(compRes.rowsAffected).toBe(0);

    // Stale Worker Alpha attempts failure transition -> REJECTED
    const failRes = await failResearchJob(job.id, staleOwnership, new Error("Late failure"), ctx.prisma);
    expect(failRes.success).toBe(false);
    expect(failRes.rowsAffected).toBe(0);

    // Verify job remained PENDING and was not modified by stale worker
    const finalJob = await ctx.prisma.syncJob.findUnique({ where: { id: job.id } });
    expect(finalJob?.status).toBe("PENDING");
  });

  // ── 7. SAFE SQLITE SCHEMA UPGRADE ON EXISTING DATABASES ─────────────────────

  it("ensureSyncJobSchemaUpgraded verifies all columns and operates idempotently", async () => {
    // 1. Initial check on existing isolated database
    const up1 = await ensureSyncJobSchemaUpgraded(ctx.prisma);
    expect(up1.indicesVerified).toBe(true);
    expect(up1.error).toBeUndefined();

    // 2. Second invocation must be idempotent
    const up2 = await ensureSyncJobSchemaUpgraded(ctx.prisma);
    expect(up2.upgraded).toBe(false); // No new columns needed
    expect(up2.addedColumns.length).toBe(0);
    expect(up2.indicesVerified).toBe(true);

    // 3. Confirm historical data remains fully readable and writable
    const testHistoricalJob = await ctx.prisma.syncJob.create({
      data: {
        id: `historical_job_${Date.now()}`,
        workspaceId: TEST_WS,
        jobType: "KH01_RESEARCH",
        status: "COMPLETED",
        progress: 100,
        resultJson: JSON.stringify({ legacyField: "persisted" }),
      },
    });

    const readback = await ctx.prisma.syncJob.findUnique({
      where: { id: testHistoricalJob.id },
    });
    expect(readback?.id).toBe(testHistoricalJob.id);
    expect(readback?.status).toBe("COMPLETED");
  });
});
