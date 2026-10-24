/**
 * SWAI KH-01 Background Worker & Job Processor
 *
 * Lightweight, strictly bounded landing-page research processor.
 * Concurrency: 1 job at a time.
 * Enforces atomic claiming, lease heartbeats, and graceful abort on shutdown.
 */

import { loadLocalEnvironment } from "@/lib/loadLocalEnvironment";
loadLocalEnvironment();

import { prisma } from "@/lib/db";
import { executeLandingPageResearchJob } from "@/services/research/landingPageInspectionService";

export interface ClaimedKh01Job {
  id: string;
  workspaceId: string;
  jobType: string;
  status: string;
  workerId: string;
  attemptNumber: number;
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

const WORKER_ID = `kh01-worker-${process.pid}-${Date.now().toString(36)}`;
const LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minute lease

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
          resultJson: JSON.stringify({ workerId, activeJobId: jobId, timestamp: new Date() }),
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
            resultJson: JSON.stringify({ workerId, activeJobId: jobId, timestamp: new Date() }),
          },
        });
      }
    }
  } catch (err) {
    console.warn("[KH01 Worker] Heartbeat error:", err);
  }
}

/**
 * Atomically claims one eligible pending KH-01 research job.
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

  // Atomically transition from PENDING to RUNNING with worker claim
  try {
    let existingPayload: any = {};
    try {
      existingPayload = JSON.parse(pending.resultJson || "{}");
    } catch {
      // ignore
    }

    const updated = await prisma.syncJob.update({
      where: {
        id: pending.id,
        status: "PENDING", // Atomic guard
      },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        resultJson: JSON.stringify({
          ...existingPayload,
          workerId,
          attemptNumber: 1,
          leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS),
        }),
      },
    });

    return {
      id: updated.id,
      workspaceId: updated.workspaceId,
      jobType: updated.jobType,
      status: updated.status,
      workerId,
      attemptNumber: 1,
    };
  } catch {
    // Another worker claimed it first
    return null;
  }
}

/**
 * Executes a claimed KH-01 job safely with an AbortSignal.
 */
export async function executeKh01Job(job: ClaimedKh01Job, signal?: AbortSignal): Promise<Kh01JobResult> {
  try {
    const researchResult = await executeLandingPageResearchJob(job.id, signal);

    return {
      jobId: job.id,
      status: researchResult.status === "ACCESS_RESTRICTED" ? "ACCESS_RESTRICTED" : "COMPLETED",
      snapshotId: researchResult.snapshotId || undefined,
    };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: errorMsg,
      },
    });

    return {
      jobId: job.id,
      status: "FAILED",
      errorMessage: errorMsg,
    };
  }
}

/**
 * Recovers jobs that were interrupted due to process restart or server crash.
 */
export async function recoverInterruptedKh01Jobs(): Promise<RecoverySummary> {
  const expiredThreshold = new Date(Date.now() - LEASE_DURATION_MS);

  const staleJobs = await prisma.syncJob.findMany({
    where: {
      jobType: "KH01_LANDING_PAGE_RESEARCH",
      status: "RUNNING",
      startedAt: { lt: expiredThreshold },
    },
  });

  let recoveredCount = 0;
  let abandonedCount = 0;

  for (const job of staleJobs) {
    // Reset to PENDING if 1st attempt, otherwise mark FAILED
    let attempt = 1;
    try {
      if (job.resultJson) {
        const meta = JSON.parse(job.resultJson);
        attempt = meta.attemptNumber || 1;
      }
    } catch {
      // ignore parse error
    }

    if (attempt < 2) {
      await prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: "PENDING",
          startedAt: null,
          resultJson: JSON.stringify({ attemptNumber: attempt + 1, recoveredAt: new Date() }),
        },
      });
      recoveredCount++;
    } else {
      await prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          errorMessage: "Job lease expired after maximum retries",
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
