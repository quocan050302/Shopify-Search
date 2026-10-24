import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import {
  claimPendingKh01Job,
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

  it("recovers expired lease after worker crash and frees capacity", async () => {
    process.env.KH01_MAX_ACTIVE_HEAVY_RESEARCH_JOBS = "1";

    // Simulate crashed worker holding expired lease
    const expiredTimestamp = new Date(Date.now() - 10000).toISOString();
    await dbHandle.prisma.syncJob.create({
      data: {
        id: "job_crashed_worker",
        workspaceId,
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "RUNNING",
        resultJson: JSON.stringify({
          targetUrl: "https://example.com/crashed",
          workerId: "crashed_worker_pid_9999",
          claimToken: "crashed_token",
          fencingVersion: 1,
          leaseExpiresAt: expiredTimestamp,
          attemptNumber: 1,
        }),
      },
    });

    // Capacity is initially full because job status is RUNNING
    // But recovery detects expired lease and resets to PENDING
    const recovery = await recoverInterruptedKh01Jobs();
    expect(recovery.recoveredCount).toBe(1);

    const recoveredInDb = await dbHandle.prisma.syncJob.findUnique({
      where: { id: "job_crashed_worker" },
    });
    expect(recoveredInDb?.status).toBe("PENDING");

    // New worker can now claim the recovered job
    const newClaim = await claimPendingKh01Job("new_worker_pid_1234");
    expect(newClaim).not.toBeNull();
    expect(newClaim?.id).toBe("job_crashed_worker");
    expect(newClaim?.attemptNumber).toBe(2); // Next attempt
  });
});
