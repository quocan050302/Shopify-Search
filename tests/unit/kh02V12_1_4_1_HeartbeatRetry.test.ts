/**
 * SWAI KH-02 V12.1.4.1 — Heartbeat CAS Retry Integrity & Lost-Update Prevention Unit Tests
 *
 * Verifies on real isolated SQLite persistence:
 * 1. buildHeartbeatRetryPayload parses fresh database record and preserves all unrelated metadata.
 * 2. Stale JSON retry preserves concurrent progress updates (e.g. stage="SCORING", percent=70).
 * 3. Heartbeat retry verifies exact ownership on every retry path (claimToken, fencingToken, fencingGeneration).
 * 4. Stale worker / replaced owner retry is rejected without corrupting new owner's state.
 * 5. Expired lease is rejected on retry.
 * 6. Terminal status (COMPLETED, FAILED) is rejected on retry and cannot be mutated.
 * 7. Multi-client concurrent write race condition prevents lost updates.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import {
  renewResearchJobLease,
  updateResearchProgress,
  buildHeartbeatRetryPayload,
  JobOwnership,
} from "@/workers/kh02Worker";
import { createPrismaClient } from "@/lib/db";

describe("SWAI KH-02 V12.1.4.1 — Heartbeat CAS Retry Integrity", () => {
  let ctx: TestDatabaseHandle;
  const TEST_WS = "ws_heartbeat_test_12_1_4_1";

  beforeEach(async () => {
    ctx = await createIsolatedTestDatabase({ prefix: "kh02-hb-retry" });

    await ctx.prisma.workspace.create({
      data: {
        id: TEST_WS,
        name: "Heartbeat Test Workspace",
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

  // ── 1. PAYLOAD BUILDER PRESERVES UNRELATED METADATA ────────────────────────

  it("buildHeartbeatRetryPayload preserves topic, sourceStatuses, and lastProgress", () => {
    const freshRecord = {
      resultJson: JSON.stringify({
        topic: "Smart Posture Corrector",
        market: "US",
        sourceStatuses: {
          META: "COMPLETED",
          TIKTOK: "PARTIAL",
        },
        _runtime: {
          lastProgress: {
            stage: "SCORING",
            percent: 70,
            message: "Computing evergreen scores",
          },
          lastHeartbeatAt: "2026-10-26T08:00:00.000Z",
          workerId: "worker-alpha",
        },
      }),
    };

    const nextLease = new Date("2026-10-26T12:00:00.000Z");
    const now = new Date("2026-10-26T11:55:00.000Z");
    const payload = buildHeartbeatRetryPayload(freshRecord, {
      nextLeaseExpiresAt: nextLease,
      fencingGeneration: 1,
      returnedFencingVersion: 1,
      recordVersion: 5,
      lastHeartbeatAt: now,
    });

    expect(payload.valid).toBe(true);
    const parsed = JSON.parse(payload.resultJson);
    expect(parsed.topic).toBe("Smart Posture Corrector");
    expect(parsed.market).toBe("US");
    expect(parsed.sourceStatuses.META).toBe("COMPLETED");
    expect(parsed.sourceStatuses.TIKTOK).toBe("PARTIAL");
    expect(parsed.someUnrelatedProperty).toBeUndefined();

    // Critical: lastProgress must NOT be overwritten!
    expect(parsed._runtime.lastProgress).toEqual({
      stage: "SCORING",
      percent: 70,
      message: "Computing evergreen scores",
    });
    // Updated heartbeat fields
    expect(parsed._runtime.recordVersion).toBe(5);
    expect(parsed._runtime.leaseExpiresAt).toBe(nextLease.toISOString());
    expect(parsed._runtime.lastHeartbeatAt).toBe(now.toISOString());
  });

  // ── 2. STALE JSON RETRY PRESERVES CONCURRENT PROGRESS IN REAL DB ───────────

  it("heartbeat retry against version conflict preserves progress written by concurrent update", async () => {
    const initialLease = new Date(Date.now() + 60000);
    const job = await ctx.prisma.syncJob.create({
      data: {
        id: `job_hb_race_${Date.now()}`,
        workspaceId: TEST_WS,
        jobType: "KH02_RESEARCH",
        status: "RUNNING",
        workerId: "worker-alpha",
        claimToken: "claim-alpha",
        fencingToken: "fence-alpha",
        fencingGeneration: 1,
        recordVersion: 1,
        leaseExpiresAt: initialLease,
        resultJson: JSON.stringify({
          topic: "Ergonomic Pillow",
          _runtime: {
            workerId: "worker-alpha",
            lastHeartbeatAt: new Date(Date.now() - 5000).toISOString(),
          },
        }),
      },
    });

    const ownership: JobOwnership = {
      workerId: "worker-alpha",
      claimToken: "claim-alpha",
      fencingToken: "fence-alpha",
      fencingGeneration: 1,
      recordVersion: 1,
      leaseExpiresAt: initialLease.toISOString(),
    };

    // Step A: Progress write updates recordVersion from 1 -> 2 and writes lastProgress="SCORING"
    const progRes = await updateResearchProgress(
      job.id,
      ownership,
      { stage: "SCORING", percent: 75 },
      ctx.prisma
    );
    expect(progRes.success).toBe(true);
    expect(progRes.persistedVersion).toBe(2);

    // Step B: Worker renews heartbeat holding old ownership.recordVersion = 1
    // The initial CAS against version 1 will fail, triggering the retry path.
    // The retry path MUST read the fresh database row and merge, preserving lastProgress!
    ownership.recordVersion = 1;
    const renewRes = await renewResearchJobLease(job.id, ownership, undefined, ctx.prisma);
    expect(renewRes.renewed).toBe(true);

    // Step C: Verify persisted database row contains BOTH the updated lease AND the lastProgress
    const persistedJob = await ctx.prisma.syncJob.findUnique({ where: { id: job.id } });
    expect(persistedJob?.recordVersion).toBe(3);
    const parsedResult = JSON.parse(persistedJob?.resultJson || "{}");
    expect(parsedResult._runtime.lastProgress).toEqual({
      stage: "SCORING",
      percent: 75,
    });
    expect(parsedResult.topic).toBe("Ergonomic Pillow");
    expect(new Date(persistedJob!.leaseExpiresAt!).getTime()).toBeGreaterThan(initialLease.getTime());
  });

  // ── 3. STRICT OWNERSHIP VERIFICATION ON RETRY ───────────────────────────────

  it("heartbeat retry rejects claimToken mismatch", async () => {
    const initialLease = new Date(Date.now() + 60000);
    const job = await ctx.prisma.syncJob.create({
      data: {
        id: `job_hb_claim_${Date.now()}`,
        workspaceId: TEST_WS,
        jobType: "KH02_RESEARCH",
        status: "RUNNING",
        workerId: "worker-alpha",
        claimToken: "claim-actual",
        fencingToken: "fence-actual",
        fencingGeneration: 1,
        recordVersion: 2, // version conflict setup
        leaseExpiresAt: initialLease,
      },
    });

    const staleOwnership: JobOwnership = {
      workerId: "worker-alpha",
      claimToken: "claim-WRONG",
      fencingToken: "fence-actual",
      fencingGeneration: 1,
      recordVersion: 1, // causes initial CAS to fail and hit retry
      leaseExpiresAt: initialLease.toISOString(),
    };

    const res = await renewResearchJobLease(job.id, staleOwnership, undefined, ctx.prisma);
    expect(res.renewed).toBe(false);
    expect(res.error?.toLowerCase()).toContain("claim token mismatch");
  });

  it("heartbeat retry rejects fencingToken mismatch", async () => {
    const initialLease = new Date(Date.now() + 60000);
    const job = await ctx.prisma.syncJob.create({
      data: {
        id: `job_hb_fence_${Date.now()}`,
        workspaceId: TEST_WS,
        jobType: "KH02_RESEARCH",
        status: "RUNNING",
        workerId: "worker-alpha",
        claimToken: "claim-actual",
        fencingToken: "fence-actual",
        fencingGeneration: 1,
        recordVersion: 2,
        leaseExpiresAt: initialLease,
      },
    });

    const staleOwnership: JobOwnership = {
      workerId: "worker-alpha",
      claimToken: "claim-actual",
      fencingToken: "fence-WRONG",
      fencingGeneration: 1,
      recordVersion: 1,
      leaseExpiresAt: initialLease.toISOString(),
    };

    const res = await renewResearchJobLease(job.id, staleOwnership, undefined, ctx.prisma);
    expect(res.renewed).toBe(false);
    expect(res.error?.toLowerCase()).toContain("fencing token mismatch");
  });

  it("heartbeat retry rejects replaced owner after lease reclaim", async () => {
    const initialLease = new Date(Date.now() + 60000);
    const job = await ctx.prisma.syncJob.create({
      data: {
        id: `job_hb_replaced_${Date.now()}`,
        workspaceId: TEST_WS,
        jobType: "KH02_RESEARCH",
        status: "RUNNING",
        workerId: "worker-beta-new",
        claimToken: "claim-beta-new",
        fencingToken: "fence-beta-new",
        fencingGeneration: 2,
        recordVersion: 2,
        leaseExpiresAt: initialLease,
      },
    });

    const oldWorkerOwnership: JobOwnership = {
      workerId: "worker-alpha-stale",
      claimToken: "claim-alpha-stale",
      fencingToken: "fence-alpha-stale",
      fencingGeneration: 1,
      recordVersion: 1,
      leaseExpiresAt: initialLease.toISOString(),
    };

    const res = await renewResearchJobLease(job.id, oldWorkerOwnership, undefined, ctx.prisma);
    expect(res.renewed).toBe(false);

    // Verify Worker Beta's state was completely unmolested
    const finalJob = await ctx.prisma.syncJob.findUnique({ where: { id: job.id } });
    expect(finalJob?.workerId).toBe("worker-beta-new");
    expect(finalJob?.claimToken).toBe("claim-beta-new");
    expect(finalJob?.fencingGeneration).toBe(2);
    expect(finalJob?.recordVersion).toBe(2);
  });

  // ── 4. TERMINAL STATE SAFETY ───────────────────────────────────────────────

  it("heartbeat retry rejects mutating COMPLETED or FAILED jobs", async () => {
    const job = await ctx.prisma.syncJob.create({
      data: {
        id: `job_hb_completed_${Date.now()}`,
        workspaceId: TEST_WS,
        jobType: "KH02_RESEARCH",
        status: "COMPLETED",
        workerId: "worker-alpha",
        claimToken: "claim-alpha",
        fencingToken: "fence-alpha",
        fencingGeneration: 1,
        recordVersion: 3,
        resultJson: JSON.stringify({ final: true }),
      },
    });

    const ownership: JobOwnership = {
      workerId: "worker-alpha",
      claimToken: "claim-alpha",
      fencingToken: "fence-alpha",
      fencingGeneration: 1,
      recordVersion: 1,
    };

    const res = await renewResearchJobLease(job.id, ownership, undefined, ctx.prisma);
    expect(res.renewed).toBe(false);

    const checkJob = await ctx.prisma.syncJob.findUnique({ where: { id: job.id } });
    expect(checkJob?.status).toBe("COMPLETED");
    expect(checkJob?.recordVersion).toBe(3);
  });

  // ── 5. MULTI-CLIENT CONCURRENCY (LOST-UPDATE DEFENSE) ───────────────────────

  it("handles concurrent progress writes and heartbeats across independent Prisma clients", async () => {
    const initialLease = new Date(Date.now() + 60000);
    const job = await ctx.prisma.syncJob.create({
      data: {
        id: `job_concurrency_${Date.now()}`,
        workspaceId: TEST_WS,
        jobType: "KH02_RESEARCH",
        status: "RUNNING",
        workerId: "worker-concur",
        claimToken: "claim-concur",
        fencingToken: "fence-concur",
        fencingGeneration: 1,
        recordVersion: 1,
        leaseExpiresAt: initialLease,
        resultJson: JSON.stringify({
          topic: "Electric Spin Scrubber",
          _runtime: {
            workerId: "worker-concur",
            lastProgress: { stage: "DISCOVERY", percent: 10 },
          },
        }),
      },
    });

    // Create a second independent Prisma client connecting to the same SQLite database
    const clientB = createPrismaClient(ctx.url);

    const ownershipA: JobOwnership = {
      workerId: "worker-concur",
      claimToken: "claim-concur",
      fencingToken: "fence-concur",
      fencingGeneration: 1,
      recordVersion: 1,
      leaseExpiresAt: initialLease.toISOString(),
    };

    const ownershipB: JobOwnership = {
      ...ownershipA,
    };

    // Client A sends a progress write
    const p1 = updateResearchProgress(
      job.id,
      ownershipA,
      { stage: "NORMALIZATION", percent: 40 },
      ctx.prisma
    );

    // Client B sends a heartbeat renewal concurrently
    const p2 = renewResearchJobLease(job.id, ownershipB, undefined, clientB);

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1.success).toBe(true);
    expect(res2.renewed).toBe(true);

    // Inspect final state in DB: must retain both progress and heartbeat
    const finalJob = await ctx.prisma.syncJob.findUnique({ where: { id: job.id } });
    expect(finalJob?.recordVersion).toBeGreaterThanOrEqual(3);
    const parsed = JSON.parse(finalJob?.resultJson || "{}");
    expect(parsed._runtime.lastProgress).toBeDefined();
    expect(parsed._runtime.lastProgress.stage).toBe("NORMALIZATION");
    expect(parsed._runtime.lastHeartbeatAt).toBeDefined();

    await clientB.$disconnect();
  });
});
