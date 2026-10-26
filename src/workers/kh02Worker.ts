/**
 * SWAI KH-02 — Evergreen Winning Products Research Worker
 *
 * Dedicated, strictly bounded background processor for persistent KH-02 research jobs.
 * Enforces atomic database-backed claim fencing, monotonic lease renewal,
 * safe timeout handling, stale-job recovery, and graceful shutdown.
 */

import { loadLocalEnvironment } from "@/lib/loadLocalEnvironment";
loadLocalEnvironment();

import crypto from "crypto";
import { prisma } from "@/lib/db";
import { runEvergreenProductResearch, EvergreenLeaderboardResult } from "@/services/kh02/evergreenResearchOrchestrator";
import { persistKH02RankingSnapshot } from "@/services/kh02/persistence/kh02PersistenceService";

export const KH02_LEASE_DURATION_MS = 60 * 1000; // 60 seconds
export const KH02_MAX_ATTEMPTS = 3;

export interface ResearchInput {
  topic: string;
  market?: "US";
  lookbackDays?: number;
  maxCandidates?: number;
  workspaceId: string;
}

export interface RequestContext {
  workspaceId: string;
  actorId?: string;
}

export interface ClaimedResearchJob {
  id: string;
  workspaceId: string;
  jobType: string;
  status: string;
  workerId: string;
  claimToken: string;
  fencingToken: string;
  fencingVersion: number;
  attemptNumber: number;
  leaseExpiresAt: string;
  payload: ResearchInput;
}

export interface JobOwnership {
  workerId: string;
  claimToken: string;
  fencingToken: string;
  fencingVersion: number;
}

export interface ResearchProgress {
  stage: string;
  percent: number;
  candidatesDiscovered?: number;
}

export interface WorkerHealth {
  workerId: string;
  isAlive: boolean;
  activeJobId: string | null;
  lastHeartbeatAt: string;
  processedCount: number;
  failureCount: number;
  uptimeSeconds: number;
}

export interface RetryDecision {
  retryable: boolean;
  backoffMs: number;
  reason: string;
}

export interface LeaseRenewalResult {
  renewed: boolean;
  leaseExpiresAt?: string;
  fencingVersion?: number;
  error?: string;
}

export interface RecoverySummary {
  recoveredCount: number;
  failedCount: number;
}

const WORKER_ID = `kh02-worker-${process.pid}-${Date.now().toString(36)}`;
const startTime = Date.now();
let isRunning = false;
let activeJobId: string | null = null;
let lastHeartbeat = new Date().toISOString();
let processedJobs = 0;
let failedJobs = 0;

/**
 * Computes an idempotency key for research job creation.
 */
export function computeResearchIdempotencyKey(
  input: ResearchInput,
  context: RequestContext
): string {
  const normTopic = input.topic.trim().toLowerCase();
  const raw = `${context.workspaceId}:${normTopic}:${input.market || "US"}:${input.lookbackDays || 90}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

/**
 * Classifies research errors to decide whether a retry is appropriate.
 */
export function classifyResearchError(error: unknown): RetryDecision {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();

  // Non-retryable errors
  if (
    msg.includes("validation_failed") ||
    msg.includes("unauthorized") ||
    msg.includes("access_restricted") ||
    msg.includes("invalid topic")
  ) {
    return { retryable: false, backoffMs: 0, reason: "Permanent validation or authorization failure" };
  }

  // Transient / network errors
  if (
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("rate_limited") ||
    msg.includes("429")
  ) {
    return { retryable: true, backoffMs: 5000, reason: "Transient network or upstream provider rate limit" };
  }

  return { retryable: true, backoffMs: 2000, reason: "Unclassified unexpected error" };
}

/**
 * Atomically claims the next PENDING KH-02 research job.
 */
export async function claimNextResearchJob(
  workerId: string = WORKER_ID,
  db: any = prisma
): Promise<ClaimedResearchJob | null> {
  const now = new Date();

  // Find candidate PENDING job
  const pendingJob = await db.syncJob.findFirst({
    where: {
      jobType: "KH02_RESEARCH",
      status: "PENDING",
    },
    orderBy: { createdAt: "asc" },
  });

  if (!pendingJob) return null;

  const claimToken = crypto.randomUUID();
  const fencingToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(Date.now() + KH02_LEASE_DURATION_MS).toISOString();

  let payload: any = {};
  try {
    payload = JSON.parse(pendingJob.resultJson || "{}");
  } catch {}

  const attemptNumber = (payload._runtime?.attemptNumber || 0) + 1;
  const fencingVersion = (payload._runtime?.fencingVersion || 0) + 1;

  const updatedRuntime = {
    workerId,
    claimToken,
    fencingToken,
    fencingVersion,
    attemptNumber,
    leaseExpiresAt,
    lastHeartbeatAt: now.toISOString(),
  };

  // Atomic state transition from PENDING -> RUNNING
  const updateResult = await db.syncJob.updateMany({
    where: {
      id: pendingJob.id,
      status: "PENDING",
    },
    data: {
      status: "RUNNING",
      progress: 5,
      startedAt: now,
      resultJson: JSON.stringify({
        ...payload,
        _runtime: updatedRuntime,
      }),
    },
  });

  if (updateResult.count === 0) {
    return null; // Another worker claimed this job concurrently
  }

  return {
    id: pendingJob.id,
    workspaceId: pendingJob.workspaceId,
    jobType: pendingJob.jobType,
    status: "RUNNING",
    workerId,
    claimToken,
    fencingToken,
    fencingVersion,
    attemptNumber,
    leaseExpiresAt,
    payload: {
      topic: payload.topic || "General Research",
      market: payload.market || "US",
      lookbackDays: payload.lookbackDays || 90,
      maxCandidates: payload.maxCandidates || 15,
      workspaceId: pendingJob.workspaceId,
    },
  };
}

/**
 * Renews the lease for an actively owned job.
 */
export async function renewResearchJobLease(
  jobId: string,
  workerId: string,
  fencingToken: string,
  db: any = prisma
): Promise<LeaseRenewalResult> {
  const job = await db.syncJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING") {
    return { renewed: false, error: "Job is no longer in RUNNING state." };
  }

  let meta: any = {};
  try {
    meta = JSON.parse(job.resultJson || "{}");
  } catch {
    return { renewed: false, error: "Malformed job result payload." };
  }

  const runtime = meta._runtime || {};
  if (runtime.workerId !== workerId || runtime.fencingToken !== fencingToken) {
    return { renewed: false, error: "Fencing token or worker mismatch." };
  }

  const nextLeaseExpiresAt = new Date(Date.now() + KH02_LEASE_DURATION_MS).toISOString();
  const nextVersion = (runtime.fencingVersion || 0) + 1;

  runtime.leaseExpiresAt = nextLeaseExpiresAt;
  runtime.fencingVersion = nextVersion;
  runtime.lastHeartbeatAt = new Date().toISOString();

  await db.syncJob.update({
    where: { id: jobId },
    data: {
      resultJson: JSON.stringify({ ...meta, _runtime: runtime }),
    },
  });

  return {
    renewed: true,
    leaseExpiresAt: nextLeaseExpiresAt,
    fencingVersion: nextVersion,
  };
}

/**
 * Updates execution progress safely if claim ownership holds.
 */
export async function updateResearchProgress(
  jobId: string,
  ownership: JobOwnership,
  progress: ResearchProgress,
  db: any = prisma
): Promise<{ success: boolean }> {
  const job = await db.syncJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING") return { success: false };

  let meta: any = {};
  try {
    meta = JSON.parse(job.resultJson || "{}");
  } catch {
    return { success: false };
  }

  const runtime = meta._runtime || {};
  if (runtime.workerId !== ownership.workerId || runtime.fencingToken !== ownership.fencingToken) {
    return { success: false };
  }

  meta._runtime.lastProgress = progress;

  await db.syncJob.update({
    where: { id: jobId },
    data: {
      progress: progress.percent,
      resultJson: JSON.stringify(meta),
    },
  });

  return { success: true };
}

/**
 * Completes a research job and stores the final leaderboard snapshot.
 */
export async function completeResearchJob(
  jobId: string,
  ownership: JobOwnership,
  result: EvergreenLeaderboardResult,
  db: any = prisma
): Promise<{ success: boolean }> {
  const job = await db.syncJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING") return { success: false };

  let meta: any = {};
  try {
    meta = JSON.parse(job.resultJson || "{}");
  } catch {}

  const runtime = meta._runtime || {};
  if (runtime.workerId !== ownership.workerId || runtime.fencingToken !== ownership.fencingToken) {
    return { success: false };
  }

  await persistKH02RankingSnapshot(jobId, job.workspaceId, result);
  return { success: true };
}

/**
 * Marks a research job as failed with sanitized error details.
 */
export async function failResearchJob(
  jobId: string,
  ownership: JobOwnership,
  error: unknown,
  db: any = prisma
): Promise<{ success: boolean }> {
  const rawMsg = error instanceof Error ? error.message : String(error);
  // Sanitize any potential API keys or tokens
  const sanitized = rawMsg.replace(/key=[^&\s]+/gi, "key=REDACTED").replace(/Bearer\s+[^&\s]+/gi, "Bearer REDACTED");

  await db.syncJob.updateMany({
    where: { id: jobId },
    data: {
      status: "FAILED",
      errorMessage: sanitized,
      completedAt: new Date(),
    },
  });

  return { success: true };
}

/**
 * Scans for abandoned/crashed RUNNING jobs whose leases have expired.
 */
export async function recoverStaleResearchJobs(
  db: any = prisma
): Promise<RecoverySummary> {
  const now = Date.now();
  let recoveredCount = 0;
  let failedCount = 0;

  const runningJobs = await db.syncJob.findMany({
    where: {
      jobType: "KH02_RESEARCH",
      status: "RUNNING",
    },
  });

  for (const job of runningJobs) {
    let meta: any = {};
    try {
      meta = JSON.parse(job.resultJson || "{}");
    } catch {}

    const runtime = meta._runtime || {};
    const leaseTime = runtime.leaseExpiresAt ? new Date(runtime.leaseExpiresAt).getTime() : 0;

    if (leaseTime < now) {
      const attempts = runtime.attemptNumber || 1;
      if (attempts < KH02_MAX_ATTEMPTS) {
        // Recover back to PENDING for retry
        await db.syncJob.update({
          where: { id: job.id },
          data: {
            status: "PENDING",
            progress: 0,
            errorMessage: `Recovered from stale worker lease expiry (attempt ${attempts}/${KH02_MAX_ATTEMPTS}).`,
          },
        });
        recoveredCount++;
      } else {
        // Exceeded max retry attempts: fail permanently
        await db.syncJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            errorMessage: `Research job failed: exceeded maximum attempts (${KH02_MAX_ATTEMPTS}) following worker crash.`,
          },
        });
        failedCount++;
      }
    }
  }

  return { recoveredCount, failedCount };
}

/**
 * Executes a claimed research job across all sources.
 */
export async function executeResearchJob(
  job: ClaimedResearchJob,
  db: any = prisma
): Promise<{ success: boolean; result?: EvergreenLeaderboardResult; error?: string }> {
  activeJobId = job.id;
  const ownership: JobOwnership = {
    workerId: job.workerId,
    claimToken: job.claimToken,
    fencingToken: job.fencingToken,
    fencingVersion: job.fencingVersion,
  };

  try {
    await updateResearchProgress(job.id, ownership, { stage: "DISCOVERY", percent: 20 }, db);

    const result = await runEvergreenProductResearch({
      topic: job.payload.topic,
      market: job.payload.market || "US",
      lookbackDays: job.payload.lookbackDays || 90,
      maxCandidates: job.payload.maxCandidates || 15,
      workspaceId: job.workspaceId,
      runId: job.id,
    });

    await updateResearchProgress(job.id, ownership, { stage: "SNAPSHOT", percent: 90 }, db);
    await completeResearchJob(job.id, ownership, result, db);

    processedJobs++;
    activeJobId = null;
    return { success: true, result };
  } catch (err: any) {
    failedJobs++;
    activeJobId = null;
    await failResearchJob(job.id, ownership, err, db);
    return { success: false, error: err.message };
  }
}

/**
 * Returns current health and telemetry of the research worker.
 */
export function getResearchWorkerHealth(): WorkerHealth {
  return {
    workerId: WORKER_ID,
    isAlive: isRunning,
    activeJobId,
    lastHeartbeatAt: lastHeartbeat,
    processedCount: processedJobs,
    failureCount: failedJobs,
    uptimeSeconds: Math.round((Date.now() - startTime) / 1000),
  };
}

/**
 * Main polling worker loop.
 */
export async function runWorkerLoop(options: { once?: boolean; pollIntervalMs?: number } = {}) {
  isRunning = true;
  const pollInterval = options.pollIntervalMs || 2000;

  console.log(`[KH-02 Worker] Initialized ${WORKER_ID}. Mode: ${options.once ? "ONCE" : "DAEMON"}`);

  // 1. Recover any abandoned jobs at startup
  try {
    const recovery = await recoverStaleResearchJobs();
    if (recovery.recoveredCount > 0 || recovery.failedCount > 0) {
      console.log(`[KH-02 Worker] Startup recovery: ${recovery.recoveredCount} recovered, ${recovery.failedCount} marked failed.`);
    }
  } catch (recErr) {
    console.warn(`[KH-02 Worker] Startup recovery error:`, recErr);
  }

  do {
    lastHeartbeat = new Date().toISOString();
    try {
      const job = await claimNextResearchJob(WORKER_ID);
      if (job) {
        console.log(`[KH-02 Worker] Claimed job ${job.id} for topic '${job.payload.topic}' (Workspace: ${job.workspaceId})`);
        const outcome = await executeResearchJob(job);
        console.log(`[KH-02 Worker] Finished job ${job.id}: ${outcome.success ? "COMPLETED" : "FAILED"}`);
      }
    } catch (loopErr) {
      console.error(`[KH-02 Worker] Loop execution error:`, loopErr);
    }

    if (options.once) break;
    await new Promise((r) => setTimeout(r, pollInterval));
  } while (isRunning);

  console.log(`[KH-02 Worker] Stopped.`);
}

// Standalone execution entrypoint
if (typeof require !== "undefined" && require.main === module) {
  const isOnce = process.argv.includes("--once");
  runWorkerLoop({ once: isOnce }).catch((err) => {
    console.error("Fatal worker error:", err);
    process.exit(1);
  });
}
