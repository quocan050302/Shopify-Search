/**
 * SWAI V9.2 — Local Discovery Scheduler & Background Worker
 *
 * Runs in a dedicated Node.js process (CLI or dev:all).
 * Polls database for due schedules, claims pending asynchronous jobs (job leasing),
 * recovers interrupted jobs, persists cross-process database heartbeats,
 * and honors system sleep/restart limits.
 */

// 1. Initialize environment FIRST
import { loadLocalEnvironment } from "@/lib/loadLocalEnvironment";
loadLocalEnvironment();

import { prisma } from "@/lib/db";
import { discoveryOrchestrator } from "@/services/discovery/discoveryOrchestrator";
import { DiscoveryQuery } from "@/services/discovery/types";
import { getDiscoveryProvider } from "@/services/discovery/providerRegistry";

export interface WorkerStatus {
  isRunning: boolean;
  startedAt: Date | null;
  lastPollAt: Date | null;
  activeJobsCount: number;
  completedRunsCount: number;
}

let isRunning = false;
let isProcessingPoll = false;
let pollTimer: NodeJS.Timeout | null = null;
const status: WorkerStatus = {
  isRunning: false,
  startedAt: null,
  lastPollAt: null,
  activeJobsCount: 0,
  completedRunsCount: 0,
};

/**
 * Persists worker heartbeat to database so the web application process
 * can reliably detect the worker state across separate processes (Rule 131).
 */
export async function persistWorkerHeartbeat(workerState: "RUNNING" | "STOPPED" = "RUNNING"): Promise<void> {
  try {
    const existing = await prisma.syncJob.findFirst({
      where: { jobType: "DISCOVERY_WORKER_HEARTBEAT" },
    });

    if (existing) {
      await prisma.syncJob.update({
        where: { id: existing.id },
        data: {
          status: workerState,
          startedAt: workerState === "RUNNING" ? new Date() : existing.startedAt,
          completedAt: workerState === "STOPPED" ? new Date() : null,
        },
      });
    } else {
      const workspace = await prisma.workspace.findFirst({ select: { id: true } });
      if (workspace) {
        await prisma.syncJob.create({
          data: {
            id: "discovery-worker-heartbeat",
            workspaceId: workspace.id,
            jobType: "DISCOVERY_WORKER_HEARTBEAT",
            status: workerState,
            startedAt: new Date(),
            completedAt: workerState === "STOPPED" ? new Date() : null,
          },
        });
      }
    }
  } catch (err) {
    console.warn("[DiscoveryWorker] Could not persist heartbeat to database:", err);
  }
}

/**
 * Checks for schedules that are eligible to execute right now.
 * Enforces scheduler idempotency (Rule 130).
 */
export async function findDueDiscoverySchedules() {
  const schedules = await prisma.discoverySchedule.findMany({
    where: { enabled: true },
  });

  const now = new Date();
  const currentUtcHour = now.getUTCHours();
  const dueSchedules: typeof schedules = [];

  for (const s of schedules) {
    // If nextEligibleRunAt is explicitly set and due
    if (s.nextEligibleRunAt && s.nextEligibleRunAt <= now) {
      dueSchedules.push(s);
      continue;
    }

    // Check daily hour recurrence
    if (s.hourOfDayUtc === currentUtcHour) {
      // Idempotency: Check if already executed in the last 20 hours to prevent duplicate runs
      if (s.lastRunAt) {
        const hoursSinceLast = (now.getTime() - s.lastRunAt.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLast < 20) {
          continue;
        }
      }
      dueSchedules.push(s);
    }
  }

  return dueSchedules;
}

/**
 * Recovers stale RUNNING jobs that were interrupted by a local PC shutdown or crash.
 */
export async function recoverInterruptedDiscoveryJobs(): Promise<number> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  const staleRuns = await prisma.discoveryRun.findMany({
    where: {
      status: "RUNNING",
      heartbeatAt: { lt: fiveMinutesAgo },
    },
  });

  for (const run of staleRuns) {
    await prisma.discoveryRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorMessage: "Job interrupted by process termination or system sleep.",
        finishedAt: new Date(),
      },
    });

    if (run.jobId) {
      await prisma.syncJob.update({
        where: { id: run.jobId },
        data: {
          status: "FAILED",
          errorMessage: "Job interrupted by process termination or system sleep.",
          completedAt: new Date(),
        },
      });
    }
  }

  return staleRuns.length;
}

/**
 * Executes a single polling iteration:
 * 1. Persists worker heartbeat to DB
 * 2. Recovers interrupted stale jobs
 * 3. Claims and executes any queued PENDING discovery jobs (job leasing)
 * 4. Finds and executes due scheduled jobs with preflight checks and backoff
 */
export async function processDueSchedulesOnce(): Promise<void> {
  if (isProcessingPoll) {
    console.log("[DiscoveryWorker] Polling iteration already in progress; skipping overlapping poll.");
    return;
  }
  isProcessingPoll = true;
  try {
    status.lastPollAt = new Date();

    // 1. Persist cross-process heartbeat
    await persistWorkerHeartbeat("RUNNING");

  // 2. Recover stale crashed jobs
  await recoverInterruptedDiscoveryJobs();

  // 3. Process queued PENDING jobs from UI / API (Job Leasing - Rule 99)
  let claimedJobId = await discoveryOrchestrator.claimPendingDiscoveryJob();
  while (claimedJobId) {
    try {
      status.activeJobsCount++;
      console.log(`[DiscoveryWorker] Claimed pending job '${claimedJobId}'. Executing...`);
      await discoveryOrchestrator.executeDiscoveryJob(claimedJobId);
      status.completedRunsCount++;
    } catch (jobErr) {
      console.error(`[DiscoveryWorker] Failed executing claimed job '${claimedJobId}':`, jobErr);
    } finally {
      status.activeJobsCount = Math.max(0, status.activeJobsCount - 1);
    }
    // Claim next pending job if any
    claimedJobId = await discoveryOrchestrator.claimPendingDiscoveryJob();
  }

  // 4. Find due schedules
  const due = await findDueDiscoverySchedules();
  if (due.length === 0) return;

  console.log(`[DiscoveryWorker] Found ${due.length} due discovery schedule(s).`);

  for (const schedule of due) {
    try {
      status.activeJobsCount++;
      const keywords: string[] = JSON.parse(schedule.keywordsJson || "[]");
      const industries: string[] = JSON.parse(schedule.industriesJson || "[]");

      // Provider preflight check (Rule 129)
      const provider = getDiscoveryProvider(schedule.providerId);
      if (provider) {
        const avail = await provider.checkAvailability();
        if (!avail.isAuthorized || avail.status !== "AVAILABLE") {
          console.warn(
            `[DiscoveryWorker] Preflight failed for schedule '${schedule.name}': Provider '${schedule.providerId}' is ${avail.status}. Pausing execution.`
          );
          // Update schedule failure and backoff (Rule 132)
          await prisma.discoverySchedule.update({
            where: { id: schedule.id },
            data: {
              failureCount: { increment: 1 },
              lastErrorReason: avail.message || "Provider unavailable during preflight.",
              // Set next retry in 4 hours to avoid retry storms
              nextEligibleRunAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
            },
          });
          continue;
        }
      }

      const scheduledPlatform = schedule.providerId.toLowerCase().includes("meta") ? "META" : "TIKTOK";

      const query: DiscoveryQuery = {
        workspaceId: schedule.workspaceId,
        platform: scheduledPlatform,
        market: schedule.targetMarket || "US",
        keywords,
        industries,
        objectives: [],
        searchWindowDays: (schedule.searchWindowDays as 7 | 30 | 180) || 30,
        sortBy: "relevance",
        requestedLimit: schedule.dailyLimit || 20,
        pageSize: 20,
        providerId: schedule.providerId,
        runMode: "SCHEDULED",
      };

      console.log(`[DiscoveryWorker] Executing schedule '${schedule.name}' (${schedule.id})...`);
      const summary = await discoveryOrchestrator.runDiscoveryJob(query, {
        scheduleId: schedule.id,
      });

      console.log(
        `[DiscoveryWorker] Schedule '${schedule.name}' completed with status ${summary.finalStatus}. Retrieved ${summary.actualRetrievedCount}, new unique: ${summary.newUniqueCount}.`
      );

      status.completedRunsCount++;
    } catch (schedErr) {
      console.error(`[DiscoveryWorker] Failed schedule '${schedule.id}':`, schedErr);
    } finally {
      status.activeJobsCount = Math.max(0, status.activeJobsCount - 1);
    }
  }
  } finally {
    isProcessingPoll = false;
  }
}

/**
 * Starts the background discovery worker loop.
 */
export function startDiscoveryWorker(pollIntervalMs = 60000): WorkerStatus {
  if (isRunning) return status;

  isRunning = true;
  status.isRunning = true;
  status.startedAt = new Date();

  console.log(`[DiscoveryWorker] Auto Discovery Worker started. Polling every ${Math.round(pollIntervalMs / 1000)}s.`);

  // Initial immediate check
  processDueSchedulesOnce().catch((e) => console.error("[DiscoveryWorker] Initial poll error:", e));

  // Recurring polling timer
  pollTimer = setInterval(() => {
    processDueSchedulesOnce().catch((e) => console.error("[DiscoveryWorker] Poll error:", e));
  }, pollIntervalMs);

  return status;
}

/**
 * Stops the background discovery worker loop gracefully.
 */
export async function stopDiscoveryWorker(): Promise<WorkerStatus> {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  isRunning = false;
  status.isRunning = false;
  await persistWorkerHeartbeat("STOPPED");
  console.log("[DiscoveryWorker] Worker stopped cleanly.");
  return status;
}

export function getDiscoveryWorkerStatus(): WorkerStatus {
  return { ...status };
}
