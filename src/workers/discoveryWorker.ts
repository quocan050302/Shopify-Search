/**
 * SWAI V9 — Local Discovery Scheduler & Background Worker
 *
 * Runs in a dedicated Node.js process (CLI or dev:all).
 * Polls database for due schedules, recovers interrupted jobs,
 * executes automated discovery boundedly, and honors system sleep/restart limits.
 */

import { prisma } from "@/lib/db";
import { discoveryOrchestrator } from "@/services/discovery/discoveryOrchestrator";
import { DiscoveryQuery } from "@/services/discovery/types";

export interface WorkerStatus {
  isRunning: boolean;
  startedAt: Date | null;
  lastPollAt: Date | null;
  activeJobsCount: number;
  completedRunsCount: number;
}

let isRunning = false;
let pollTimer: NodeJS.Timeout | null = null;
const status: WorkerStatus = {
  isRunning: false,
  startedAt: null,
  lastPollAt: null,
  activeJobsCount: 0,
  completedRunsCount: 0,
};

/**
 * Checks for schedules that are eligible to execute right now.
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
      // Check if already executed in the last 20 hours to prevent duplicate runs
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
          errorMessage: "Job interrupted by process termination.",
          completedAt: new Date(),
        },
      });
    }
  }

  return staleRuns.length;
}

/**
 * Executes a single polling iteration for all due schedules.
 */
export async function processDueSchedulesOnce(): Promise<void> {
  status.lastPollAt = new Date();

  // 1. Recover stale crashed jobs
  await recoverInterruptedDiscoveryJobs();

  // 2. Find due schedules
  const due = await findDueDiscoverySchedules();
  if (due.length === 0) return;

  console.log(`[DiscoveryWorker] Found ${due.length} due discovery schedule(s).`);

  for (const schedule of due) {
    try {
      status.activeJobsCount++;
      const keywords: string[] = JSON.parse(schedule.keywordsJson || "[]");
      const industries: string[] = JSON.parse(schedule.industriesJson || "[]");

      const query: DiscoveryQuery = {
        workspaceId: schedule.workspaceId,
        platform: "TIKTOK",
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
export function stopDiscoveryWorker(): WorkerStatus {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  isRunning = false;
  status.isRunning = false;
  console.log("[DiscoveryWorker] Worker stopped cleanly.");
  return status;
}

export function getDiscoveryWorkerStatus(): WorkerStatus {
  return { ...status };
}
