import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import {
  claimPendingKh01Job,
  acquireResearchSlot,
  releaseResearchSlot,
  updateJobIfClaimOwned,
  recoverInterruptedKh01Jobs,
  ClaimedKh01Job,
} from "../../src/workers/kh01Worker";

describe("KH-01 Checkpoint 4 & 5: Worker Capacity, Slot Lifecycle & Claim Fencing", () => {
  let dbHandle: TestDatabaseHandle;
  const workspaceId = "ws_kh01_concurrency_test";

  let previousTestDbUrl: string | undefined;

  beforeAll(async () => {
    dbHandle = await createIsolatedTestDatabase({ prefix: "worker-concurrency" });
    previousTestDbUrl = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = dbHandle.url;

    await dbHandle.prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "Worker Concurrency Test Workspace",
      },
    });
  });

  afterAll(async () => {
    if (previousTestDbUrl) {
      process.env.TEST_DATABASE_URL = previousTestDbUrl;
    }
    if (dbHandle) {
      await dbHandle.teardown();
    }
  });

  beforeEach(async () => {
    await dbHandle.prisma.syncJob.deleteMany({});
    delete process.env.KH01_MAX_ACTIVE_HEAVY_RESEARCH_JOBS;
  });

  it("strictly enforces global concurrency budget = 1 across multiple workers", async () => {
    process.env.KH01_MAX_ACTIVE_HEAVY_RESEARCH_JOBS = "1";

    // Create 2 pending research jobs
    await dbHandle.prisma.syncJob.createMany({
      data: [
        {
          id: "job_conc_1",
          workspaceId,
          jobType: "KH01_LANDING_PAGE_RESEARCH",
          status: "PENDING",
          resultJson: JSON.stringify({ targetUrl: "https://example.com/item-1" }),
        },
        {
          id: "job_conc_2",
          workspaceId,
          jobType: "KH01_LANDING_PAGE_RESEARCH",
          status: "PENDING",
          resultJson: JSON.stringify({ targetUrl: "https://example.com/item-2" }),
        },
      ],
    });

    // Worker A claims Job 1
    const claimA = await claimPendingKh01Job("worker-process-A");
    expect(claimA).not.toBeNull();
    expect(claimA?.id).toBe("job_conc_1");
    expect(claimA?.workerId).toBe("worker-process-A");

    // Worker B attempts to claim second job -> blocked by global concurrency
    const claimB = await claimPendingKh01Job("worker-process-B");
    expect(claimB).toBeNull();

    // Release capacity on Job 1 via releaseResearchSlot
    const released = await releaseResearchSlot(
      claimA!.workerId,
      claimA!.id,
      claimA!.claimToken
    );
    expect(released).toBe(true);

    // Worker B can now claim Job 2
    const claimBRetry = await claimPendingKh01Job("worker-process-B");
    expect(claimBRetry).not.toBeNull();
    expect(claimBRetry?.id).toBe("job_conc_2");
    expect(claimBRetry?.workerId).toBe("worker-process-B");
  });

  it("strictly enforces global concurrency budget = 2 across 3 concurrent jobs", async () => {
    process.env.KH01_MAX_ACTIVE_HEAVY_RESEARCH_JOBS = "2";

    await dbHandle.prisma.syncJob.createMany({
      data: [
        {
          id: "job_multi_1",
          workspaceId,
          jobType: "KH01_LANDING_PAGE_RESEARCH",
          status: "PENDING",
          resultJson: JSON.stringify({ targetUrl: "https://example.com/item-1" }),
        },
        {
          id: "job_multi_2",
          workspaceId,
          jobType: "KH01_LANDING_PAGE_RESEARCH",
          status: "PENDING",
          resultJson: JSON.stringify({ targetUrl: "https://example.com/item-2" }),
        },
        {
          id: "job_multi_3",
          workspaceId,
          jobType: "KH01_LANDING_PAGE_RESEARCH",
          status: "PENDING",
          resultJson: JSON.stringify({ targetUrl: "https://example.com/item-3" }),
        },
      ],
    });

    const claim1 = await claimPendingKh01Job("worker-1");
    const claim2 = await claimPendingKh01Job("worker-2");
    const claim3 = await claimPendingKh01Job("worker-3");

    expect(claim1).not.toBeNull();
    expect(claim2).not.toBeNull();
    expect(claim3).toBeNull(); // Concurrency budget of 2 reached
  });

  it("preserves in-memory fencingVersion if transaction fails or is rejected", async () => {
    await dbHandle.prisma.syncJob.create({
      data: {
        id: "job_fence_test",
        workspaceId,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "RUNNING",
        resultJson: JSON.stringify({
          workerId: "owner_worker",
          claimToken: "valid_token",
          fencingVersion: 5,
          leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
        }),
      },
    });

    const staleClaim: ClaimedKh01Job = {
      id: "job_fence_test",
      workspaceId,
      jobType: "KH01_LANDING_PAGE_RESEARCH",
      status: "RUNNING",
      workerId: "owner_worker",
      claimToken: "valid_token",
      fencingVersion: 3, // Stale fencing version!
      attemptNumber: 1,
    };

    // Stale version mutation attempt
    const updated = await updateJobIfClaimOwned(staleClaim, { progress: 50 });
    expect(updated).toBe(false);

    // In-memory claim must NOT have advanced its fencingVersion
    expect(staleClaim.fencingVersion).toBe(3);
  });

  it("enforces mutual exclusion when multiple workers contend for the exact same job simultaneously", async () => {
    await dbHandle.prisma.syncJob.create({
      data: {
        id: "job_single_contention",
        workspaceId,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "PENDING",
        resultJson: JSON.stringify({ targetUrl: "https://example.com/single-contention" }),
      },
    });

    // Both workers attempt to claim the exact same job concurrently
    const [claimA, claimB] = await Promise.all([
      claimPendingKh01Job("contender-worker-A"),
      claimPendingKh01Job("contender-worker-B"),
    ]);

    // Exactly one worker must win the claim; the other must receive null
    const winners = [claimA, claimB].filter((c) => c !== null);
    expect(winners.length).toBe(1);
    expect(winners[0]?.id).toBe("job_single_contention");

    const winnerWorkerId = winners[0]?.workerId;
    const loser = [claimA, claimB].find((c) => c === null);
    expect(loser).toBeNull();

    // Verify DB reflects the winner
    const jobInDb = await dbHandle.prisma.syncJob.findUnique({
      where: { id: "job_single_contention" },
    });
    const meta = JSON.parse(jobInDb?.resultJson || "{}");
    expect(jobInDb?.status).toBe("RUNNING");
    expect(meta.workerId).toBe(winnerWorkerId);
  });

  it("measures and enforces active overlap bounds under simultaneous multi-worker claims", async () => {
    process.env.KH01_MAX_ACTIVE_HEAVY_RESEARCH_JOBS = "2";

    // Seed 4 pending research jobs
    const jobIds = ["job_overlap_1", "job_overlap_2", "job_overlap_3", "job_overlap_4"];
    await dbHandle.prisma.syncJob.createMany({
      data: jobIds.map((id) => ({
        id,
        workspaceId,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "PENDING",
        resultJson: JSON.stringify({ targetUrl: `https://example.com/${id}` }),
      })),
    });

    // 4 workers start claiming concurrently
    const claims = await Promise.all([
      claimPendingKh01Job("overlap-worker-1"),
      claimPendingKh01Job("overlap-worker-2"),
      claimPendingKh01Job("overlap-worker-3"),
      claimPendingKh01Job("overlap-worker-4"),
    ]);

    const activeClaims = claims.filter((c): c is ClaimedKh01Job => c !== null);
    expect(activeClaims.length).toBe(2); // strictly bounded by budget = 2

    // Check database to ensure no more than 2 active unexpired running jobs exist
    const runningJobs = await dbHandle.prisma.syncJob.findMany({
      where: {
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "RUNNING",
      },
    });

    const now = Date.now();
    const activeRunning = runningJobs.filter((j) => {
      try {
        const m = JSON.parse(j.resultJson || "{}");
        return m.leaseExpiresAt && new Date(m.leaseExpiresAt).getTime() > now;
      } catch {
        return false;
      }
    });

    expect(activeRunning.length).toBe(2);

    // Release 1 claim -> queued worker can now claim
    const released = await releaseResearchSlot(
      activeClaims[0].workerId,
      activeClaims[0].id,
      activeClaims[0].claimToken
    );
    expect(released).toBe(true);

    const queuedWorkerClaim = await claimPendingKh01Job("overlap-worker-queued");
    expect(queuedWorkerClaim).not.toBeNull();
  });

  it("strictly enforces research slot ownership and rejects unauthorized or stale release", async () => {
    // 1. acquireResearchSlot with owner
    const jobId = "job_slot_security_test";
    await dbHandle.prisma.syncJob.create({
      data: {
        id: jobId,
        workspaceId,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "PENDING",
        resultJson: JSON.stringify({ targetUrl: "https://example.com/slot-sec" }),
      },
    });

    const slot = await acquireResearchSlot("legit_worker", jobId, "legit_token_123");
    expect(slot).not.toBeNull();
    expect(slot?.claimToken).toBe("legit_token_123");

    // 2. Reject arbitrary takeover in acquireResearchSlot while job is RUNNING with active lease
    const rogueTakeover = await acquireResearchSlot("rogue_worker", jobId, "rogue_token_999");
    expect(rogueTakeover).toBeNull(); // Takeover blocked!

    // 3. Reject release with empty/missing token
    const emptyTokenRelease = await releaseResearchSlot("legit_worker", jobId, "");
    expect(emptyTokenRelease).toBe(false);

    // 4. Reject release with wrong workerId
    const wrongWorkerRelease = await releaseResearchSlot("wrong_worker", jobId, "legit_token_123");
    expect(wrongWorkerRelease).toBe(false);

    // 5. Reject release with mismatched claimToken
    const wrongTokenRelease = await releaseResearchSlot("legit_worker", jobId, "wrong_token_777");
    expect(wrongTokenRelease).toBe(false);

    // 6. Valid release succeeds
    const validRelease = await releaseResearchSlot("legit_worker", jobId, "legit_token_123");
    expect(validRelease).toBe(true);

    // 7. Double release rejected
    const doubleRelease = await releaseResearchSlot("legit_worker", jobId, "legit_token_123");
    expect(doubleRelease).toBe(false);
  });

  it("verifies full crash recovery scenario, immutable payload preservation, and stale rejection", async () => {
    const originalInput = {
      productId: "prod_crash_recovery_test",
      adId: "ad_crash_recovery_test",
      targetUrl: "https://example.com/crash-recovery-test",
      forceRefresh: true,
      requestedAt: "2026-10-24T12:00:00.000Z",
    };

    const expiredLeaseTimestamp = new Date(Date.now() - 30000).toISOString(); // 30s ago
    await dbHandle.prisma.syncJob.create({
      data: {
        id: "job_full_crash_test",
        workspaceId,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "RUNNING",
        resultJson: JSON.stringify({
          ...originalInput,
          workerId: "crashed_worker_original",
          claimToken: "crashed_token_original",
          fencingVersion: 1,
          leaseExpiresAt: expiredLeaseTimestamp,
          attemptNumber: 1,
        }),
      },
    });

    // 1. Production recovery scan detects expired lease and resets to PENDING
    const recovery = await recoverInterruptedKh01Jobs();
    expect(recovery.recoveredCount).toBe(1);

    const recoveredJob = await dbHandle.prisma.syncJob.findUnique({
      where: { id: "job_full_crash_test" },
    });
    expect(recoveredJob?.status).toBe("PENDING");

    // 2. Verify immutable payload is strictly preserved
    const recoveredMeta = JSON.parse(recoveredJob?.resultJson || "{}");
    expect(recoveredMeta.productId).toBe(originalInput.productId);
    expect(recoveredMeta.adId).toBe(originalInput.adId);
    expect(recoveredMeta.targetUrl).toBe(originalInput.targetUrl);
    expect(recoveredMeta.forceRefresh).toBe(originalInput.forceRefresh);
    expect(recoveredMeta.requestedAt).toBe(originalInput.requestedAt);
    expect(recoveredMeta.attemptNumber).toBe(1); // Not incremented yet

    // 3. New worker claims the recovered job
    const newClaim = await claimPendingKh01Job("new_worker_healthy");
    expect(newClaim).not.toBeNull();
    expect(newClaim?.id).toBe("job_full_crash_test");
    expect(newClaim?.attemptNumber).toBe(2); // Incremented on claim
    expect(newClaim?.workerId).toBe("new_worker_healthy");
    expect(newClaim?.claimToken).not.toBe("crashed_token_original");

    // 4. Stale original worker attempts to mutate or release -> all rejected
    const staleClaim: ClaimedKh01Job = {
      id: "job_full_crash_test",
      workspaceId,
      jobType: "KH01_LANDING_PAGE_RESEARCH",
      status: "RUNNING",
      workerId: "crashed_worker_original",
      claimToken: "crashed_token_original",
      fencingVersion: 1,
      attemptNumber: 1,
    };

    const staleUpdate = await updateJobIfClaimOwned(staleClaim, { progress: 99 });
    expect(staleUpdate).toBe(false);

    const staleRelease = await releaseResearchSlot(
      "crashed_worker_original",
      "job_full_crash_test",
      "crashed_token_original"
    );
    expect(staleRelease).toBe(false);

    // 5. New owner successfully mutates and finishes
    const newUpdate = await updateJobIfClaimOwned(newClaim!, { progress: 100, status: "COMPLETED" });
    expect(newUpdate).toBe(true);

    const finalizedJob = await dbHandle.prisma.syncJob.findUnique({
      where: { id: "job_full_crash_test" },
    });
    expect(finalizedJob?.status).toBe("COMPLETED");
  });
});
