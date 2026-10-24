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
});
