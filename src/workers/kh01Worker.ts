/**
 * SWAI KH-01 Background Worker & Job Processor
 *
 * Lightweight, strictly bounded landing-page research processor.
 * Concurrency: 1 job at a time.
 * Enforces atomic claiming, lease heartbeats, and graceful abort on shutdown.
 */

import { loadLocalEnvironment } from "@/lib/loadLocalEnvironment";
loadLocalEnvironment();

import crypto from "crypto";
import { prisma } from "@/lib/db";
import {
  executeLandingPageResearchJob,
  ClaimedKh01Job,
} from "@/services/research/landingPageInspectionService";

export type { ClaimedKh01Job };

export type ResearchJobStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "PARTIAL"
  | "ACCESS_RESTRICTED"
  | "RATE_LIMITED"
  | "FAILED"
  | "CANCELLED";

export interface Kh01JobInput {
  productId?: string | null;
  adId?: string | null;
  targetUrl: string;
  forceRefresh?: boolean;
  requestedAt?: string;
}

export interface Kh01JobRuntime {
  workerId: string | null;
  claimToken: string | null;
  leaseExpiresAt: string | null;
  lastHeartbeatAt: string | null;
  attemptNumber: number;
  cancellationRequested?: boolean;
  recoveredAt?: string;
  failedAt?: string;
}

export interface Kh01JobResult {
  jobId: string;
  status: "COMPLETED" | "FAILED" | "ACCESS_RESTRICTED";
  snapshotId?: string;
  errorMessage?: string;
}

export interface RecoverySummary {
  recoveredCount: number;
  abandonedCount: number;
}

let isRunning = false;
let isPolling = false;
let pollTimer: NodeJS.Timeout | null = null;
let currentAbortController: AbortController | null = null;
let currentExecutingJobId: string | null = null;

const WORKER_ID = `kh01-worker-${process.pid}-${Date.now().toString(36)}`;
export const KH01_LEASE_DURATION_MS = 60 * 1000; // 60 seconds (canonical lease duration)

/**
 * Validates that the input stored in SyncJob.resultJson contains valid KH-01 parameters.
 */
export function assertValidJobPayload(input: unknown): Kh01JobInput {
  if (!input || typeof input !== "object") {
    throw new Error("Job payload must be a non-empty object.");
  }
  const rec = input as Record<string, unknown>;
  if (!rec.targetUrl || typeof rec.targetUrl !== "string") {
    throw new Error("Job payload missing valid 'targetUrl' string.");
  }
  return {
    productId: typeof rec.productId === "string" ? rec.productId : null,
    adId: typeof rec.adId === "string" ? rec.adId : null,
    targetUrl: rec.targetUrl,
    forceRefresh: Boolean(rec.forceRefresh),
    requestedAt: typeof rec.requestedAt === "string" ? rec.requestedAt : new Date().toISOString(),
  };
}

/**
 * Asserts that the specified worker and claim token currently hold an active, unexpired lease.
 */
export async function assertActiveJobLease(
  jobId: string,
  workerId: string,
  claimToken: string
): Promise<void> {
  const job = await prisma.syncJob.findUnique({
    where: { id: jobId },
  });
  if (!job) {
    throw new Error(`Research job '${jobId}' not found.`);
  }
  if (job.jobType !== "KH01_LANDING_PAGE_RESEARCH") {
    throw new Error(`Job '${jobId}' is not a KH01_LANDING_PAGE_RESEARCH job.`);
  }
  if (job.status !== "RUNNING") {
    throw new Error(`Job '${jobId}' is not running (status: ${job.status}).`);
  }

  let meta: any = {};
  try {
    meta = JSON.parse(job.resultJson || "{}");
  } catch {
    throw new Error(`Corrupted job payload for job '${jobId}'.`);
  }

  if (meta.workerId !== workerId || meta.claimToken !== claimToken) {
    throw new Error(
      `Claim mismatch: Worker '${workerId}' does not own active lease on job '${jobId}'.`
    );
  }

  if (meta.cancellationRequested) {
    throw new Error(`Job '${jobId}' has been cancelled.`);
  }

  if (meta.leaseExpiresAt && new Date(meta.leaseExpiresAt).getTime() < Date.now()) {
    throw new Error(`Lease expired for job '${jobId}'.`);
  }
}

/**
 * Renews the lease expiration timestamp and heartbeat for an active claimed job.
 */
export async function renewKh01Lease(claim: ClaimedKh01Job): Promise<void> {
  await assertActiveJobLease(claim.id, claim.workerId, claim.claimToken);
  const now = new Date();
  const newLeaseExpiry = new Date(now.getTime() + KH01_LEASE_DURATION_MS);

  const job = await prisma.syncJob.findUnique({ where: { id: claim.id } });
  let payload: any = {};
  try {
    payload = JSON.parse(job?.resultJson || "{}");
  } catch {
    // ignore
  }

  // Conditional update requiring status RUNNING
  await prisma.syncJob.update({
    where: { id: claim.id, status: "RUNNING" },
    data: {
      resultJson: JSON.stringify({
        ...payload,
        workerId: claim.workerId,
        claimToken: claim.claimToken,
        leaseExpiresAt: newLeaseExpiry.toISOString(),
        lastHeartbeatAt: now.toISOString(),
      }),
    },
  });
}

/**
 * Persists worker process heartbeat to database.
 */
export async function persistKh01Heartbeat(
  jobId: string | null = null,
  workerId: string = WORKER_ID,
  state: "RUNNING" | "STOPPED" = "RUNNING"
): Promise<void> {
  try {
    const existing = await prisma.syncJob.findFirst({
      where: { jobType: "KH01_WORKER_HEARTBEAT" },
    });

    if (existing) {
      await prisma.syncJob.update({
        where: { id: existing.id },
        data: {
          status: state,
          startedAt: state === "RUNNING" ? new Date() : existing.startedAt,
          completedAt: state === "STOPPED" ? new Date() : null,
          resultJson: JSON.stringify({ workerId, activeJobId: jobId, timestamp: new Date().toISOString() }),
        },
      });
    } else {
      const workspace = await prisma.workspace.findFirst({ select: { id: true } });
      if (workspace) {
        await prisma.syncJob.create({
          data: {
            id: "kh01-worker-heartbeat",
            workspaceId: workspace.id,
            jobType: "KH01_WORKER_HEARTBEAT",
            status: state,
            startedAt: new Date(),
            completedAt: state === "STOPPED" ? new Date() : null,
            resultJson: JSON.stringify({ workerId, activeJobId: jobId, timestamp: new Date().toISOString() }),
          },
        });
      }
    }
  } catch (err) {
    console.warn("[KH01 Worker] Heartbeat error:", err);
  }
}

/**
 * Atomically claims one eligible pending KH-01 research job with unpredictable claim token.
 */
export async function claimPendingKh01Job(workerId: string = WORKER_ID): Promise<ClaimedKh01Job | null> {
  const pending = await prisma.syncJob.findFirst({
    where: {
      jobType: "KH01_LANDING_PAGE_RESEARCH",
      status: "PENDING",
    },
    orderBy: { createdAt: "asc" },
  });

  if (!pending) {
    return null;
  }

  // Validate payload before claiming
  let existingPayload: any = {};
  try {
    existingPayload = JSON.parse(pending.resultJson || "{}");
    assertValidJobPayload(existingPayload);
  } catch (err: any) {
    // Malformed input must not be claimed; fail it safely
    await prisma.syncJob.update({
      where: { id: pending.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: `Invalid job payload: ${err?.message || "parse error"}`,
      },
    });
    return null;
  }

  // Atomically transition from PENDING to RUNNING with worker claim token
  try {
    const claimToken = crypto.randomUUID();
    const attemptNumber = (existingPayload.attemptNumber || 0) + 1;
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + KH01_LEASE_DURATION_MS);

    const updated = await prisma.syncJob.update({
      where: {
        id: pending.id,
        status: "PENDING", // Atomic guard
      },
      data: {
        status: "RUNNING",
        startedAt: now,
        resultJson: JSON.stringify({
          ...existingPayload,
          workerId,
          claimToken,
          attemptNumber,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
          lastHeartbeatAt: now.toISOString(),
        }),
      },
    });

    return {
      id: updated.id,
      workspaceId: updated.workspaceId,
      jobType: updated.jobType,
      status: updated.status,
      workerId,
      claimToken,
      attemptNumber,
      payload: existingPayload,
    };
  } catch {
    // Another worker claimed it first
    return null;
  }
}

/**
 * Executes a claimed KH-01 job safely with an AbortSignal.
 * Guarded against stale worker overwrite if lease was lost during execution.
 */
export async function executeKh01Job(job: ClaimedKh01Job, signal?: AbortSignal): Promise<Kh01JobResult> {
  try {
    const researchResult = await executeLandingPageResearchJob(job, signal);

    const normalizedStatus: "COMPLETED" | "FAILED" | "ACCESS_RESTRICTED" =
      researchResult.status === "ACCESS_RESTRICTED"
        ? "ACCESS_RESTRICTED"
        : researchResult.status === "COMPLETED" || (researchResult.status as string) === "PARTIAL"
        ? "COMPLETED"
        : "FAILED";

    return {
      jobId: job.id,
      status: normalizedStatus,
      snapshotId: researchResult.snapshotId || undefined,
      errorMessage: normalizedStatus === "FAILED"
        ? (researchResult.warnings?.join("; ") || "Research job failed.")
        : undefined,
    };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);

    // Verify worker still owns the active lease before writing failure state
    let stillOwned = false;
    try {
      await assertActiveJobLease(job.id, job.workerId, job.claimToken);
      stillOwned = true;
    } catch {
      stillOwned = false;
    }

    if (stillOwned) {
      let currentPayload: any = {};
      const currentJob = await prisma.syncJob.findUnique({ where: { id: job.id } });
      try {
        currentPayload = JSON.parse(currentJob?.resultJson || "{}");
      } catch {
        // ignore
      }

      await prisma.syncJob.update({
        where: { id: job.id, status: "RUNNING" },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          errorMessage: errorMsg,
          resultJson: JSON.stringify({
            ...currentPayload,
            failedAt: new Date().toISOString(),
            errorMessage: errorMsg,
          }),
        },
      });

      return {
        jobId: job.id,
        status: "FAILED",
        errorMessage: errorMsg,
      };
    } else {
      // Lease was lost or claimed by another worker; do NOT overwrite
      return {
        jobId: job.id,
        status: "FAILED",
        errorMessage: `Claim lost or expired for job '${job.id}'. State not overwritten: ${errorMsg}`,
      };
    }
  }
}

/**
 * Recovers jobs that were interrupted due to process restart or worker lease expiry.
 * Strictly preserves original job research inputs (targetUrl, productId, adId).
 * Enforces single attempt increment rule: attemptNumber increments strictly upon claim, NOT during recovery.
 */
export async function recoverInterruptedKh01Jobs(): Promise<RecoverySummary> {
  const runningJobs = await prisma.syncJob.findMany({
    where: {
      jobType: "KH01_LANDING_PAGE_RESEARCH",
      status: "RUNNING",
    },
  });

  const now = Date.now();
  let recoveredCount = 0;
  let abandonedCount = 0;

  for (const job of runningJobs) {
    let existingData: any = {};
    try {
      if (job.resultJson) existingData = JSON.parse(job.resultJson);
    } catch {
      // ignore parse error
    }

    // Recover using actual lease expiration, not merely original start time
    const leaseExpiresAtMs = existingData.leaseExpiresAt
      ? new Date(existingData.leaseExpiresAt).getTime()
      : 0;
    const isExpired =
      leaseExpiresAtMs > 0
        ? leaseExpiresAtMs < now
        : job.startedAt
        ? now - job.startedAt.getTime() > KH01_LEASE_DURATION_MS
        : true;

    if (!isExpired) {
      // Job is actively running with valid lease; do not recover
      continue;
    }

    const attempt = existingData.attemptNumber || 1;

    // Retry budget: 3 attempts. Attempt counter increments only when claimed, not during recovery
    if (attempt < 3) {
      await prisma.syncJob.update({
        where: { id: job.id, status: "RUNNING" },
        data: {
          status: "PENDING",
          startedAt: null,
          resultJson: JSON.stringify({
            ...existingData,
            attemptNumber: attempt, // Retain attempt number; next claim increments it
            recoveredAt: new Date().toISOString(),
            workerId: null,
            claimToken: null,
            leaseExpiresAt: null,
            lastHeartbeatAt: null,
          }),
        },
      });
      recoveredCount++;
    } else {
      await prisma.syncJob.update({
        where: { id: job.id, status: "RUNNING" },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          errorMessage: "Job lease expired after maximum retries (3 attempts exhausted).",
          resultJson: JSON.stringify({
            ...existingData,
            attemptNumber: attempt,
            failedAt: new Date().toISOString(),
          }),
        },
      });
      abandonedCount++;
    }
  }

  return { recoveredCount, abandonedCount };
}

/**
 * Polls for a job and executes it. Concurrency = 1.
 */
async function processWorkerCycle(): Promise<boolean> {
  if (isPolling) return false;
  isPolling = true;

  try {
    await persistKh01Heartbeat(null, WORKER_ID, "RUNNING");
    const job = await claimPendingKh01Job(WORKER_ID);

    if (job) {
      console.log(`[KH01 Worker] Claimed job ${job.id}. Executing...`);
      currentAbortController = new AbortController();
      await persistKh01Heartbeat(job.id, WORKER_ID, "RUNNING");

      const result = await executeKh01Job(job, currentAbortController.signal);
      console.log(`[KH01 Worker] Job ${job.id} finished with status: ${result.status}`);

      currentAbortController = null;
      await persistKh01Heartbeat(null, WORKER_ID, "RUNNING");
      return true;
    }
  } catch (err) {
    console.error("[KH01 Worker] Error in worker cycle:", err);
  } finally {
    isPolling = false;
  }

  return false;
}

/**
 * Starts continuous background worker polling.
 */
export function startKh01Worker(pollIntervalMs: number = 3000) {
  if (isRunning) return;
  isRunning = true;

  console.log(`[KH01 Worker] Started with worker ID ${WORKER_ID}. Concurrency limit = 1.`);

  // Initial recovery
  recoverInterruptedKh01Jobs().then((rec) => {
    if (rec.recoveredCount > 0 || rec.abandonedCount > 0) {
      console.log(`[KH01 Worker] Recovered ${rec.recoveredCount} stale jobs, abandoned ${rec.abandonedCount}.`);
    }
  });

  pollTimer = setInterval(async () => {
    if (!isRunning) return;
    await processWorkerCycle();
  }, pollIntervalMs);
}

/**
 * Stops worker cleanly, aborting active requests and updating heartbeat.
 */
export async function stopKh01Worker(): Promise<void> {
  console.log("[KH01 Worker] Stopping worker...");
  isRunning = false;

  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }

  await persistKh01Heartbeat(null, WORKER_ID, "STOPPED");
  console.log("[KH01 Worker] Stopped cleanly.");
}

// Standalone runner execution
if (require.main === module) {
  const isOnce = process.argv.includes("--once");

  if (isOnce) {
    console.log("[KH01 Worker] Running in single-job execution mode (--once)...");
    (async () => {
      const job = await claimPendingKh01Job();
      if (!job) {
        console.log("[KH01 Worker] No pending KH-01 jobs found in queue.");
        process.exit(0);
      }
      console.log(`[KH01 Worker] Claimed job ${job.id}. Executing...`);
      const result = await executeKh01Job(job);
      console.log(`[KH01 Worker] Job finished:`, result);
      process.exit(result.status === "FAILED" ? 1 : 0);
    })();
  } else {
    startKh01Worker(3000);

    process.on("SIGINT", async () => {
      await stopKh01Worker();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      await stopKh01Worker();
      process.exit(0);
    });
  }
}
