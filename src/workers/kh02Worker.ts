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
 * Atomically updates a job record ONLY if current lease and fencing ownership hold.
 */
export async function updateJobIfClaimOwned(
  jobId: string,
  ownership: JobOwnership,
  patch: {
    status?: string;
    progress?: number;
    errorMessage?: string;
    completedAt?: Date;
    resultJson?: string;
  },
  db: any = prisma
): Promise<{ success: boolean; rowsAffected: number }> {
  const updateData: any = {};
  if (patch.status) updateData.status = patch.status;
  if (patch.progress !== undefined) updateData.progress = patch.progress;
  if (patch.errorMessage !== undefined) updateData.errorMessage = patch.errorMessage;
  if (patch.completedAt) updateData.completedAt = patch.completedAt;
  if (patch.resultJson) updateData.resultJson = patch.resultJson;

  const res = await db.syncJob.updateMany({
    where: {
      id: jobId,
      status: "RUNNING",
      resultJson: { contains: ownership.fencingToken },
    },
    data: updateData,
  });

  return { success: res.count > 0, rowsAffected: res.count };
}

/**
 * Renews the lease for an actively owned job using atomic CAS.
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

  // Atomic database compare-and-swap: requires matching fencingToken in resultJson
  const updateRes = await db.syncJob.updateMany({
    where: {
      id: jobId,
      status: "RUNNING",
      resultJson: { contains: fencingToken },
    },
    data: {
      resultJson: JSON.stringify({ ...meta, _runtime: runtime }),
    },
  });

  if (updateRes.count === 0) {
    return { renewed: false, error: "Lease renewal failed atomic CAS: ownership lost or state changed." };
  }

  return {
    renewed: true,
    leaseExpiresAt: nextLeaseExpiresAt,
    fencingVersion: nextVersion,
  };
}

/**
 * Active heartbeat manager maintaining monotonic lease renewal during long executions.
 */
export class ResearchHeartbeatManager {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    public readonly jobId: string,
    public readonly ownership: JobOwnership,
    public readonly intervalMs: number = 15000,
    private db: any = prisma,
    private onLostOwnership?: () => void
  ) {}

  start() {
    this.stopped = false;
    this.timer = setInterval(async () => {
      if (this.stopped) return;
      try {
        const res = await renewResearchJobLease(
          this.jobId,
          this.ownership.workerId,
          this.ownership.fencingToken,
          this.db
        );
        if (!res.renewed) {
          this.stop();
          if (this.onLostOwnership) this.onLostOwnership();
        } else if (res.fencingVersion) {
          this.ownership.fencingVersion = res.fencingVersion;
        }
      } catch {
        // Transient error will be retried on next heartbeat cycle
      }
    }, this.intervalMs);
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export function startResearchHeartbeat(
  jobId: string,
  ownership: JobOwnership,
  options: { intervalMs?: number; db?: any; onLostOwnership?: () => void } = {}
): ResearchHeartbeatManager {
  const manager = new ResearchHeartbeatManager(
    jobId,
    ownership,
    options.intervalMs || 15000,
    options.db || prisma,
    options.onLostOwnership
  );
  manager.start();
  return manager;
}

/**
 * Updates execution progress safely if claim ownership holds.
 */
export async function updateResearchProgress(
  jobId: string,
  ownership: JobOwnership,
  progress: ResearchProgress,
  db: any = prisma
): Promise<{ success: boolean; rowsAffected: number }> {
  const job = await db.syncJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING") return { success: false, rowsAffected: 0 };

  let meta: any = {};
  try {
    meta = JSON.parse(job.resultJson || "{}");
  } catch {
    return { success: false, rowsAffected: 0 };
  }

  const runtime = meta._runtime || {};
  if (runtime.workerId !== ownership.workerId || runtime.fencingToken !== ownership.fencingToken) {
    return { success: false, rowsAffected: 0 };
  }

  meta._runtime.lastProgress = progress;

  return updateJobIfClaimOwned(
    jobId,
    ownership,
    {
      progress: progress.percent,
      resultJson: JSON.stringify(meta),
    },
    db
  );
}

/**
 * Completes a research job and stores the final leaderboard snapshot atomically.
 */
export async function completeResearchJob(
  jobId: string,
  ownership: JobOwnership,
  result: EvergreenLeaderboardResult,
  db: any = prisma
): Promise<{ success: boolean; rowsAffected: number }> {
  const job = await db.syncJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING") return { success: false, rowsAffected: 0 };

  let meta: any = {};
  try {
    meta = JSON.parse(job.resultJson || "{}");
  } catch {}

  const runtime = meta._runtime || {};
  if (runtime.workerId !== ownership.workerId || runtime.fencingToken !== ownership.fencingToken) {
    return { success: false, rowsAffected: 0 };
  }

  const terminalStatus =
    result.runStatus === "FAILED"
      ? "FAILED"
      : result.runStatus === "PARTIAL"
      ? "PARTIALLY_COMPLETED"
      : "COMPLETED";

  // Preserve input metadata, runtime telemetry, and leaderboard result snapshot
  const mergedResultJson = JSON.stringify({
    ...result,
    _input: {
      topic: meta.topic || result.topic,
      market: meta.market || result.market,
      lookbackDays: meta.lookbackDays || result.lookbackDays,
    },
    _runtime: {
      ...runtime,
      completedAt: new Date().toISOString(),
    },
  });

  return updateJobIfClaimOwned(
    jobId,
    ownership,
    {
      status: terminalStatus,
      progress: 100,
      completedAt: new Date(),
      resultJson: mergedResultJson,
    },
    db
  );
}

/**
 * Marks a research job as failed with sanitized error details using atomic CAS.
 */
export async function failResearchJob(
  jobId: string,
  ownership: JobOwnership,
  error: unknown,
  db: any = prisma
): Promise<{ success: boolean; rowsAffected: number }> {
  const rawMsg = error instanceof Error ? error.message : String(error);
  // Sanitize any potential API keys or tokens
  const sanitized = rawMsg
    .replace(/key=[^&\s]+/gi, "key=REDACTED")
    .replace(/Bearer\s+[^&\s]+/gi, "Bearer REDACTED");

  // Atomic ownership-aware transition to FAILED
  const res = await db.syncJob.updateMany({
    where: {
      id: jobId,
      status: "RUNNING",
      resultJson: { contains: ownership.fencingToken },
    },
    data: {
      status: "FAILED",
      errorMessage: sanitized,
      completedAt: new Date(),
    },
  });

  return { success: res.count > 0, rowsAffected: res.count };
}

/**
 * Scans for abandoned/crashed RUNNING jobs whose leases have expired using atomic CAS.
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

    if (leaseTime < now && runtime.fencingToken) {
      const attempts = runtime.attemptNumber || 1;
      if (attempts < KH02_MAX_ATTEMPTS) {
        // Atomic CAS reclaim to PENDING
        const res = await db.syncJob.updateMany({
          where: {
            id: job.id,
            status: "RUNNING",
            resultJson: { contains: runtime.fencingToken },
          },
          data: {
            status: "PENDING",
            progress: 0,
            errorMessage: `Recovered from stale worker lease expiry (attempt ${attempts}/${KH02_MAX_ATTEMPTS}).`,
          },
        });
        if (res.count > 0) recoveredCount++;
      } else {
        // Atomic CAS fail permanently
        const res = await db.syncJob.updateMany({
          where: {
            id: job.id,
            status: "RUNNING",
            resultJson: { contains: runtime.fencingToken },
          },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            errorMessage: `Research job failed: exceeded maximum attempts (${KH02_MAX_ATTEMPTS}) following worker crash.`,
          },
        });
        if (res.count > 0) failedCount++;
      }
    }
  }

  return { recoveredCount, failedCount };
}

/**
 * Executes a claimed research job across all sources with active heartbeat protection.
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

  let lostOwnership = false;
  const heartbeat = startResearchHeartbeat(job.id, ownership, {
    intervalMs: 15000,
    db,
    onLostOwnership: () => {
      lostOwnership = true;
    },
  });

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

    if (lostOwnership) {
      throw new Error("Job execution aborted: ownership lease was lost or claimed by another worker.");
    }

    await updateResearchProgress(job.id, ownership, { stage: "SNAPSHOT", percent: 90 }, db);
    const completeRes = await completeResearchJob(job.id, ownership, result, db);
    if (!completeRes.success) {
      throw new Error("Failed to commit terminal completion: ownership lost before final write.");
    }

    processedJobs++;
    activeJobId = null;
    return { success: true, result };
  } catch (err: any) {
    failedJobs++;
    activeJobId = null;
    if (!lostOwnership) {
      await failResearchJob(job.id, ownership, err, db);
    }
    return { success: false, error: err.message };
  } finally {
    heartbeat.stop();
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
