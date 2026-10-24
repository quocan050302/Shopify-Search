/**
 * KH-01.P0.3 / P0.4 — Job Execution, Atomic Claims, Lease & Recovery Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  claimPendingKh01Job,
  assertActiveJobLease,
  renewKh01Lease,
  recoverInterruptedKh01Jobs,
  executeKh01Job,
  updateJobIfClaimOwned,
  acquireResearchSlot,
  renewResearchSlot,
  releaseResearchSlot,
  cancelKh01Job,
  ClaimedKh01Job,
} from "@/workers/kh01Worker";
import { executeLandingPageResearchJob } from "@/services/research/landingPageInspectionService";

describe("KH-01 Job Engine — Atomic Claims, Leases & Recovery", () => {
  const TEST_WORKSPACE = "ws_test_job_engine";
  const TEST_JOB_ID_1 = "job_test_kh01_01";
  const TEST_JOB_ID_2 = "job_test_kh01_02";

  beforeEach(async () => {
    await prisma.syncJob.deleteMany({
      where: { workspaceId: TEST_WORKSPACE },
    });
    await prisma.workspace.deleteMany({
      where: { id: TEST_WORKSPACE },
    });

    await prisma.workspace.create({
      data: { id: TEST_WORKSPACE, name: "Job Engine Test Workspace" },
    });
  });

  afterEach(async () => {
    await prisma.syncJob.deleteMany({
      where: { workspaceId: TEST_WORKSPACE },
    });
    await prisma.workspace.deleteMany({
      where: { id: TEST_WORKSPACE },
    });
  });

  it("claims a pending job with an unpredictable claim token and lease expiration", async () => {
    await prisma.syncJob.create({
      data: {
        id: TEST_JOB_ID_1,
        workspaceId: TEST_WORKSPACE,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "PENDING",
        resultJson: JSON.stringify({
          productId: "prod_1",
          adId: "ad_1",
          targetUrl: "https://example.com/products/item-1",
        }),
      },
    });

    const claimed = await claimPendingKh01Job("worker_alpha");
    expect(claimed).not.toBeNull();
    expect(claimed?.id).toBe(TEST_JOB_ID_1);
    expect(claimed?.workerId).toBe("worker_alpha");
    expect(claimed?.claimToken).toBeDefined();
    expect(typeof claimed?.claimToken).toBe("string");
    expect(claimed?.claimToken.length).toBeGreaterThan(10);
    expect(claimed?.payload?.targetUrl).toBe("https://example.com/products/item-1");

    // DB state must be RUNNING
    const inDb = await prisma.syncJob.findUnique({ where: { id: TEST_JOB_ID_1 } });
    expect(inDb?.status).toBe("RUNNING");

    const meta = JSON.parse(inDb?.resultJson || "{}");
    expect(meta.claimToken).toBe(claimed?.claimToken);
    expect(meta.targetUrl).toBe("https://example.com/products/item-1");
    expect(new Date(meta.leaseExpiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("ensures two workers contending for the same job results in only one winner", async () => {
    await prisma.syncJob.create({
      data: {
        id: TEST_JOB_ID_1,
        workspaceId: TEST_WORKSPACE,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "PENDING",
        resultJson: JSON.stringify({
          targetUrl: "https://example.com/products/race-test",
        }),
      },
    });

    const [worker1Claim, worker2Claim] = await Promise.all([
      claimPendingKh01Job("worker_fast"),
      claimPendingKh01Job("worker_slow"),
    ]);

    // Exactly one worker must claim the job; the other must receive null
    const claimedCount = [worker1Claim, worker2Claim].filter((c) => c !== null).length;
    expect(claimedCount).toBe(1);
  });

  it("assertActiveJobLease verifies active claim and rejects mismatched claim tokens", async () => {
    const claim = await prisma.syncJob.create({
      data: {
        id: TEST_JOB_ID_1,
        workspaceId: TEST_WORKSPACE,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "RUNNING",
        resultJson: JSON.stringify({
          workerId: "worker_owner",
          claimToken: "token_valid_123",
          leaseExpiresAt: new Date(Date.now() + 60000),
          targetUrl: "https://example.com/item",
        }),
      },
    });

    // Valid check
    await expect(
      assertActiveJobLease(claim.id, "worker_owner", "token_valid_123")
    ).resolves.not.toThrow();

    // Mismatched worker
    await expect(
      assertActiveJobLease(claim.id, "worker_imposter", "token_valid_123")
    ).rejects.toThrow(/Claim mismatch/);

    // Mismatched token
    await expect(
      assertActiveJobLease(claim.id, "worker_owner", "token_forged")
    ).rejects.toThrow(/Claim mismatch/);
  });

  it("assertActiveJobLease detects and rejects expired leases", async () => {
    const expiredJob = await prisma.syncJob.create({
      data: {
        id: TEST_JOB_ID_1,
        workspaceId: TEST_WORKSPACE,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "RUNNING",
        resultJson: JSON.stringify({
          workerId: "worker_owner",
          claimToken: "token_valid_123",
          leaseExpiresAt: new Date(Date.now() - 10000), // Expired in past
        }),
      },
    });

    await expect(
      assertActiveJobLease(expiredJob.id, "worker_owner", "token_valid_123")
    ).rejects.toThrow(/Lease expired/);
  });

  it("renewKh01Lease extends active lease expiration timestamp", async () => {
    const initialExpiry = new Date(Date.now() + 30000);
    const job = await prisma.syncJob.create({
      data: {
        id: TEST_JOB_ID_1,
        workspaceId: TEST_WORKSPACE,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "RUNNING",
        resultJson: JSON.stringify({
          workerId: "worker_renew",
          claimToken: "token_renew_1",
          leaseExpiresAt: initialExpiry,
          targetUrl: "https://example.com/renew",
        }),
      },
    });

    await renewKh01Lease({
      id: job.id,
      workspaceId: TEST_WORKSPACE,
      jobType: "KH01_LANDING_PAGE_RESEARCH",
      status: "RUNNING",
      workerId: "worker_renew",
      claimToken: "token_renew_1",
      attemptNumber: 1,
    });

    const refreshed = await prisma.syncJob.findUnique({ where: { id: job.id } });
    const meta = JSON.parse(refreshed?.resultJson || "{}");
    expect(new Date(meta.leaseExpiresAt).getTime()).toBeGreaterThan(initialExpiry.getTime());
  });

  it("recoverInterruptedKh01Jobs resets stale job to PENDING while strictly preserving research payload", async () => {
    // Stale job whose lease has expired
    await prisma.syncJob.create({
      data: {
        id: TEST_JOB_ID_1,
        workspaceId: TEST_WORKSPACE,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "RUNNING",
        startedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
        resultJson: JSON.stringify({
          productId: "prod_preserved_99",
          adId: "ad_preserved_88",
          targetUrl: "https://example.com/products/must-preserve-url",
          attemptNumber: 1,
          workerId: "crashed_worker",
          claimToken: "stale_token",
          leaseExpiresAt: new Date(Date.now() - 5 * 60 * 1000),
        }),
      },
    });

    const summary = await recoverInterruptedKh01Jobs();
    expect(summary.recoveredCount).toBe(1);

    const recovered = await prisma.syncJob.findUnique({ where: { id: TEST_JOB_ID_1 } });
    expect(recovered?.status).toBe("PENDING");
    expect(recovered?.startedAt).toBeNull();

    const payload = JSON.parse(recovered?.resultJson || "{}");
    expect(payload.productId).toBe("prod_preserved_99");
    expect(payload.adId).toBe("ad_preserved_88");
    expect(payload.targetUrl).toBe("https://example.com/products/must-preserve-url");
    // Attempt number is strictly preserved during recovery (Task 082)
    expect(payload.attemptNumber).toBe(1);
    expect(payload.workerId).toBeNull();
    expect(payload.claimToken).toBeNull();

    // Reclaiming by a new worker increments the attempt to 2 exactly once
    const reclaimed = await claimPendingKh01Job("worker_beta");
    expect(reclaimed).not.toBeNull();
    expect(reclaimed?.id).toBe(TEST_JOB_ID_1);
    expect(reclaimed?.attemptNumber).toBe(2);
  });

  it("recoverInterruptedKh01Jobs transitions to FAILED when maximum attempts are exhausted", async () => {
    await prisma.syncJob.create({
      data: {
        id: TEST_JOB_ID_2,
        workspaceId: TEST_WORKSPACE,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "RUNNING",
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
        resultJson: JSON.stringify({
          targetUrl: "https://example.com/failing-job",
          attemptNumber: 3, // Exhausted
          leaseExpiresAt: new Date(Date.now() - 5 * 60 * 1000),
        }),
      },
    });

    const summary = await recoverInterruptedKh01Jobs();
    expect(summary.abandonedCount).toBe(1);

    const failed = await prisma.syncJob.findUnique({ where: { id: TEST_JOB_ID_2 } });
    expect(failed?.status).toBe("FAILED");
    expect(failed?.errorMessage).toContain("maximum retries");
    const payload = JSON.parse(failed?.resultJson || "{}");
    expect(payload.targetUrl).toBe("https://example.com/failing-job");
  });

  it("executeLandingPageResearchJob rejects direct execution without a valid claim", async () => {
    // Pending job (unclaimed)
    const unclaimed = await prisma.syncJob.create({
      data: {
        id: TEST_JOB_ID_1,
        workspaceId: TEST_WORKSPACE,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "PENDING",
        resultJson: JSON.stringify({ targetUrl: "https://example.com/test" }),
      },
    });

    await expect(executeLandingPageResearchJob(unclaimed.id as any)).rejects.toThrow(
      /status must be claimed and RUNNING/
    );
  });

  it("assertActiveJobLease rejects job if cancellation has been requested", async () => {
    const cancelledJob = await prisma.syncJob.create({
      data: {
        id: TEST_JOB_ID_1,
        workspaceId: TEST_WORKSPACE,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "RUNNING",
        resultJson: JSON.stringify({
          workerId: "worker_cancelled",
          claimToken: "token_canc_1",
          leaseExpiresAt: new Date(Date.now() + 60000),
          cancellationRequested: true,
        }),
      },
    });

    await expect(
      assertActiveJobLease(cancelledJob.id, "worker_cancelled", "token_canc_1")
    ).rejects.toThrow(/cancelled/i);
  });

  it("executeKh01Job prevents stale worker from overwriting state if claim ownership was lost", async () => {
    // Worker A claims job
    await prisma.syncJob.create({
      data: {
        id: TEST_JOB_ID_1,
        workspaceId: TEST_WORKSPACE,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "RUNNING",
        resultJson: JSON.stringify({
          workerId: "worker_b",
          claimToken: "token_b_new",
          leaseExpiresAt: new Date(Date.now() + 60000),
          targetUrl: "https://example.com/stale-test",
        }),
      },
    });

    // Stale worker A tries to report failure with its old token
    const staleClaim: any = {
      id: TEST_JOB_ID_1,
      workspaceId: TEST_WORKSPACE,
      jobType: "KH01_LANDING_PAGE_RESEARCH",
      status: "RUNNING",
      workerId: "worker_a_stale",
      claimToken: "token_a_stale",
      attemptNumber: 1,
    };

    // Simulate executeKh01Job failing under stale worker A
    const res = await executeKh01Job(staleClaim);
    expect(res.status).toBe("FAILED");
    expect(res.errorMessage).toContain("Claim lost or expired");

    // DB state must remain owned by Worker B with status RUNNING
    const inDb = await prisma.syncJob.findUnique({ where: { id: TEST_JOB_ID_1 } });
    expect(inDb?.status).toBe("RUNNING");
    const meta = JSON.parse(inDb?.resultJson || "{}");
    expect(meta.workerId).toBe("worker_b");
    expect(meta.claimToken).toBe("token_b_new");
  });

  it("updateJobIfClaimOwned rejects mutation when claim token or fencing version does not match", async () => {
    await prisma.syncJob.create({
      data: {
        id: TEST_JOB_ID_1,
        workspaceId: TEST_WORKSPACE,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "RUNNING",
        resultJson: JSON.stringify({
          workerId: "worker_authorized",
          claimToken: "token_auth_999",
          fencingVersion: 3,
          leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
          targetUrl: "https://example.com/item",
        }),
      },
    });

    const validClaim: ClaimedKh01Job = {
      id: TEST_JOB_ID_1,
      workspaceId: TEST_WORKSPACE,
      jobType: "KH01_LANDING_PAGE_RESEARCH",
      status: "RUNNING",
      workerId: "worker_authorized",
      claimToken: "token_auth_999",
      fencingVersion: 3,
      attemptNumber: 1,
    };

    // Stale token attempt
    const staleTokenClaim = { ...validClaim, claimToken: "token_stale_111" };
    const staleTokenUpdated = await updateJobIfClaimOwned(staleTokenClaim, { progress: 50 });
    expect(staleTokenUpdated).toBe(false);

    // Stale fencing version attempt
    const staleVersionClaim = { ...validClaim, fencingVersion: 2 };
    const staleVersionUpdated = await updateJobIfClaimOwned(staleVersionClaim, { progress: 50 });
    expect(staleVersionUpdated).toBe(false);

    // Valid claim attempt: must succeed and monotonically advance fencing version
    const validUpdated = await updateJobIfClaimOwned(validClaim, { progress: 50 });
    expect(validUpdated).toBe(true);
    expect(validClaim.fencingVersion).toBe(4);

    const inDb = await prisma.syncJob.findUnique({ where: { id: TEST_JOB_ID_1 } });
    expect(inDb?.progress).toBe(50);
    const meta = JSON.parse(inDb?.resultJson || "{}");
    expect(meta.fencingVersion).toBe(4);
  });

  it("enforces global concurrency limit = 1 across multiple heavy research jobs", async () => {
    // Create two pending heavy jobs
    await prisma.syncJob.create({
      data: {
        id: TEST_JOB_ID_1,
        workspaceId: TEST_WORKSPACE,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "PENDING",
        resultJson: JSON.stringify({ targetUrl: "https://example.com/product-1" }),
      },
    });

    await prisma.syncJob.create({
      data: {
        id: TEST_JOB_ID_2,
        workspaceId: TEST_WORKSPACE,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "PENDING",
        resultJson: JSON.stringify({ targetUrl: "https://example.com/product-2" }),
      },
    });

    // Worker A claims Job 1
    const claimA = await claimPendingKh01Job("worker_A");
    expect(claimA).not.toBeNull();
    expect(claimA?.id).toBe(TEST_JOB_ID_1);

    // Worker B attempts to claim while Job 1 is RUNNING -> Must return null due to concurrency = 1!
    const claimB = await claimPendingKh01Job("worker_B");
    expect(claimB).toBeNull();

    // Now Job 1 finishes
    await prisma.syncJob.update({
      where: { id: TEST_JOB_ID_1 },
      data: { status: "COMPLETED", progress: 100 },
    });

    // Capacity is now released! Worker B can claim Job 2
    const claimBAfter = await claimPendingKh01Job("worker_B");
    expect(claimBAfter).not.toBeNull();
    expect(claimBAfter?.id).toBe(TEST_JOB_ID_2);
  });

  it("renewKh01Lease fails safely when claim ownership has been lost", async () => {
    const job = await prisma.syncJob.create({
      data: {
        id: TEST_JOB_ID_1,
        workspaceId: TEST_WORKSPACE,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "RUNNING",
        resultJson: JSON.stringify({
          workerId: "worker_new_owner",
          claimToken: "token_new",
          fencingVersion: 5,
          leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
          targetUrl: "https://example.com/item",
        }),
      },
    });

    // Stale worker tries to renew
    const staleClaim: ClaimedKh01Job = {
      id: job.id,
      workspaceId: TEST_WORKSPACE,
      jobType: "KH01_LANDING_PAGE_RESEARCH",
      status: "RUNNING",
      workerId: "worker_old_stale",
      claimToken: "token_old",
      fencingVersion: 4,
      attemptNumber: 1,
    };

    const result = await renewKh01Lease(staleClaim);
    expect(result.renewed).toBe(false);
    expect(result.error).toContain("Claim lost or lease expired");

    // DB state must remain untouched
    const inDb = await prisma.syncJob.findUnique({ where: { id: job.id } });
    const meta = JSON.parse(inDb?.resultJson || "{}");
    expect(meta.workerId).toBe("worker_new_owner");
    expect(meta.claimToken).toBe("token_new");
    expect(meta.fencingVersion).toBe(5);
  });

  it("cancelKh01Job authoritatively marks job cancelled and prevents subsequent claim updates", async () => {
    const job = await prisma.syncJob.create({
      data: {
        id: TEST_JOB_ID_1,
        workspaceId: TEST_WORKSPACE,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "RUNNING",
        resultJson: JSON.stringify({
          workerId: "worker_active",
          claimToken: "token_active",
          fencingVersion: 1,
          leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
          targetUrl: "https://example.com/item",
        }),
      },
    });

    const claim: ClaimedKh01Job = {
      id: job.id,
      workspaceId: TEST_WORKSPACE,
      jobType: "KH01_LANDING_PAGE_RESEARCH",
      status: "RUNNING",
      workerId: "worker_active",
      claimToken: "token_active",
      fencingVersion: 1,
      attemptNumber: 1,
    };

    // User cancels the job
    const cancelled = await cancelKh01Job(job.id, "User requested stop");
    expect(cancelled).toBe(true);

    const cancelledInDb = await prisma.syncJob.findUnique({ where: { id: job.id } });
    expect(cancelledInDb?.status).toBe("CANCELLED");

    // Worker attempts lease renewal -> rejected
    const renewal = await renewKh01Lease(claim);
    expect(renewal.renewed).toBe(false);

    // Worker attempts progress update -> rejected
    const progressUpdated = await updateJobIfClaimOwned(claim, { progress: 80 });
    expect(progressUpdated).toBe(false);
  });

  it("slot lifecycle manages explicit reservations correctly", async () => {
    await prisma.syncJob.create({
      data: {
        id: "slot_test_job_1",
        workspaceId: TEST_WORKSPACE,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "PENDING",
        resultJson: JSON.stringify({ targetUrl: "https://example.com" }),
      },
    });

    const token = "slot_token_999";
    const slot = await acquireResearchSlot("worker_slot_test", "slot_test_job_1", token);
    expect(slot).not.toBeNull();
    expect(slot?.jobId).toBe("slot_test_job_1");

    // Renewal with matching token and worker succeeds
    const renewed = await renewResearchSlot("worker_slot_test", "slot_test_job_1", token);
    expect(renewed).toBe(true);

    // Renewal with wrong token fails
    const invalidTokenRenew = await renewResearchSlot("worker_slot_test", "slot_test_job_1", "wrong_token");
    expect(invalidTokenRenew).toBe(false);

    // Renewal with wrong worker fails
    const invalidWorkerRenew = await renewResearchSlot("wrong_worker", "slot_test_job_1", token);
    expect(invalidWorkerRenew).toBe(false);

    // Release with wrong worker fails
    const wrongWorkerRelease = await releaseResearchSlot("wrong_worker", "slot_test_job_1", token);
    expect(wrongWorkerRelease).toBe(false);

    // Release with matching worker succeeds
    const released = await releaseResearchSlot("worker_slot_test", "slot_test_job_1", token);
    expect(released).toBe(true);

    // Second release fails (already released/expired)
    const secondRelease = await releaseResearchSlot("worker_slot_test", "slot_test_job_1", token);
    expect(secondRelease).toBe(false);
  });


  it("KH-01 workers strictly ignore non-KH01 discovery jobs (Task 169)", async () => {
    // Create an unrelated META discovery job in PENDING state
    await prisma.syncJob.create({
      data: {
        id: "discovery_job_meta_01",
        workspaceId: TEST_WORKSPACE,
        jobType: "META_AD_DISCOVERY",
        status: "PENDING",
        resultJson: JSON.stringify({ query: "pets", count: 20 }),
      },
    });

    const claimed = await claimPendingKh01Job("kh01_worker_specialist");
    // Must NOT claim META_AD_DISCOVERY
    expect(claimed).toBeNull();

    const inDb = await prisma.syncJob.findUnique({ where: { id: "discovery_job_meta_01" } });
    expect(inDb?.status).toBe("PENDING");
  });
});
