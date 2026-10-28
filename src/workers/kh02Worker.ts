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
import {
  runEvergreenProductResearch,
  EvergreenLeaderboardResult,
  KH02ResearchExecutionContext,
} from "@/services/kh02/evergreenResearchOrchestrator";
import {
  SWAI_KH02_RELEASE_VERSION,
  getRuntimeBuildSha,
  getDatabaseFingerprint,
} from "@/services/kh02/version/runtimeVersionService";

export const KH02_LEASE_DURATION_MS = 60 * 1000; // 60 seconds
export const KH02_MAX_ATTEMPTS = 3;
export const KH02_MAX_JOB_DURATION_MS = 180 * 1000; // 3 minutes overall job deadline
export const KH02_ABANDONED_LEASE_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes max recovery age

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
  fencingGeneration: number;
  recordVersion: number;
  fencingVersion: number;
  attemptNumber: number;
  leaseExpiresAt: string;
  ownership: JobOwnership;
  payload: ResearchInput;
}

export interface OwnershipMutationResult {
  success: boolean;
  rowsAffected: number;
  reason?:
    | "OWNERSHIP_LOST"
    | "VERSION_CONFLICT"
    | "LEASE_EXPIRED"
    | "INVALID_STATE"
    | "NOT_FOUND";
  persistedVersion?: number;
}

export interface JobOwnership {
  workerId: string;
  claimToken: string;
  fencingToken: string;
  fencingGeneration?: number;
  recordVersion?: number;
  fencingVersion?: number;
  leaseExpiresAt?: string;
  attemptNumber?: number;
}

const jobMutexes = new Map<string, Promise<any>>();

/**
 * In-process mutex for serializing mutations on the same job within a single worker process.
 */
export async function withJobLock<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  const current = jobMutexes.get(jobId) || Promise.resolve();
  let nextResolve: () => void;
  const nextPromise = new Promise<void>((resolve) => {
    nextResolve = resolve;
  });
  jobMutexes.set(jobId, nextPromise);

  try {
    await current;
    return await fn();
  } finally {
    nextResolve!();
    if (jobMutexes.get(jobId) === nextPromise) {
      jobMutexes.delete(jobId);
    }
  }
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

export interface KH02WorkerHealth {
  workerId: string;
  observedAt: string;
  lastHeartbeatAt: string | null;
  status: "ALIVE" | "STALE" | "OFFLINE" | "UNKNOWN";
  activeJobId: string | null;
  processedCount: number;
  failureCount: number;
  processStartedAt: string | null;
  uptimeSeconds?: number;
  workerVersion?: string | null;
  workerBuildSha?: string | null;
  workerProcessId?: number | null;
  dbFingerprint?: string | null;
  conflictingWorkerIds?: string[];
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
  const leaseExpiresAt = new Date(Date.now() + KH02_LEASE_DURATION_MS);
  const leaseExpiresAtStr = leaseExpiresAt.toISOString();

  let payload: any = {};
  try {
    payload = JSON.parse(pendingJob.resultJson || "{}");
  } catch {}

  const attemptNumber = (pendingJob.attemptNumber || payload._runtime?.attemptNumber || 0) + 1;
  const fencingGeneration = (pendingJob.fencingGeneration || payload._runtime?.fencingVersion || 0) + 1;
  const recordVersion = 1;

  const updatedRuntime = {
    workerId,
    claimToken,
    fencingToken,
    fencingGeneration,
    fencingVersion: fencingGeneration,
    recordVersion,
    attemptNumber,
    leaseExpiresAt: leaseExpiresAtStr,
    lastHeartbeatAt: now.toISOString(),
  };

  // Atomic state transition from PENDING -> RUNNING with dedicated columns
  const updateResult = await db.syncJob.updateMany({
    where: {
      id: pendingJob.id,
      status: "PENDING",
    },
    data: {
      status: "RUNNING",
      progress: 5,
      startedAt: now,
      workerId,
      claimToken,
      fencingToken,
      fencingGeneration,
      recordVersion,
      leaseExpiresAt,
      attemptNumber,
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
    fencingGeneration,
    recordVersion,
    fencingVersion: fencingGeneration,
    attemptNumber,
    leaseExpiresAt: leaseExpiresAtStr,
    ownership: {
      workerId,
      claimToken,
      fencingToken,
      fencingGeneration,
      recordVersion,
      fencingVersion: fencingGeneration,
      attemptNumber,
      leaseExpiresAt: leaseExpiresAtStr,
    },
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
 * Uses dedicated database columns with atomic recordVersion CAS.
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
): Promise<OwnershipMutationResult> {
  if (!ownership || !ownership.workerId || !ownership.claimToken) {
    return { success: false, rowsAffected: 0, reason: "INVALID_STATE" };
  }

  const now = new Date();
  const fencingGen = ownership.fencingGeneration ?? ownership.fencingVersion ?? 0;
  const currentRecordVersion = ownership.recordVersion ?? 0;
  const nextRecordVersion = currentRecordVersion + 1;

  const updateData: any = {
    recordVersion: nextRecordVersion,
  };
  if (patch.status) updateData.status = patch.status;
  if (patch.progress !== undefined) updateData.progress = patch.progress;
  if (patch.errorMessage !== undefined) updateData.errorMessage = patch.errorMessage;
  if (patch.completedAt) updateData.completedAt = patch.completedAt;
  if (patch.resultJson) updateData.resultJson = patch.resultJson;

  const where: any = {
    id: jobId,
    status: "RUNNING",
    workerId: ownership.workerId,
    claimToken: ownership.claimToken,
    fencingGeneration: fencingGen,
    recordVersion: currentRecordVersion,
  };
  if (ownership.fencingToken) {
    where.fencingToken = ownership.fencingToken;
  }
  if (ownership.leaseExpiresAt) {
    where.leaseExpiresAt = { gt: now };
  }

  const res = await db.syncJob.updateMany({
    where,
    data: updateData,
  });

  if (res.count > 0) {
    ownership.recordVersion = nextRecordVersion;
    if (ownership.fencingGeneration === undefined) ownership.fencingGeneration = fencingGen;
    return { success: true, rowsAffected: res.count, persistedVersion: nextRecordVersion };
  }

  // Handle conflict / inspect current state safely
  const current =
    typeof db.syncJob?.findUnique === "function"
      ? await db.syncJob.findUnique({ where: { id: jobId } }).catch(() => null)
      : null;
  if (!current) {
    return { success: false, rowsAffected: 0, reason: "NOT_FOUND" };
  }
  if (current.status !== "RUNNING") {
    return { success: false, rowsAffected: 0, reason: "INVALID_STATE" };
  }
  if (
    (current.workerId && current.workerId !== ownership.workerId) ||
    (current.claimToken && current.claimToken !== ownership.claimToken) ||
    (current.fencingGeneration !== undefined && current.fencingGeneration !== fencingGen)
  ) {
    return { success: false, rowsAffected: 0, reason: "OWNERSHIP_LOST" };
  }
  if (current.leaseExpiresAt && new Date(current.leaseExpiresAt).getTime() <= now.getTime()) {
    return { success: false, rowsAffected: 0, reason: "LEASE_EXPIRED" };
  }

  // Safe same-owner retry for non-terminal updates if recordVersion was advanced by concurrent heartbeat
  if (
    !patch.status &&
    current.recordVersion !== undefined &&
    current.recordVersion > currentRecordVersion
  ) {
    ownership.recordVersion = current.recordVersion;
    const retryVersion = current.recordVersion + 1;
    const retryWhere: any = {
      id: jobId,
      status: "RUNNING",
      workerId: ownership.workerId,
      claimToken: ownership.claimToken,
      fencingGeneration: fencingGen,
      recordVersion: current.recordVersion,
      leaseExpiresAt: { gt: new Date() },
    };
    if (ownership.fencingToken) {
      retryWhere.fencingToken = ownership.fencingToken;
    }

    // Merge fresh resultJson with patch.resultJson if applicable to preserve heartbeat telemetry
    let retryResultJson = patch.resultJson;
    if (patch.resultJson && current.resultJson) {
      try {
        const currentMeta = JSON.parse(current.resultJson);
        const patchMeta = JSON.parse(patch.resultJson);
        const mergedMeta = {
          ...currentMeta,
          ...patchMeta,
          _runtime: {
            ...(currentMeta._runtime || {}),
            ...(patchMeta._runtime || {}),
          },
        };
        retryResultJson = JSON.stringify(mergedMeta);
      } catch {
        retryResultJson = patch.resultJson;
      }
    }

    const retryData: any = {
      ...updateData,
      recordVersion: retryVersion,
    };
    if (retryResultJson !== undefined) {
      retryData.resultJson = retryResultJson;
    }

    const retryRes = await db.syncJob.updateMany({
      where: retryWhere,
      data: retryData,
    });
    if (retryRes.count > 0) {
      ownership.recordVersion = retryVersion;
      return { success: true, rowsAffected: retryRes.count, persistedVersion: retryVersion };
    }
  }

  return { success: false, rowsAffected: 0, reason: "VERSION_CONFLICT" };
}

export interface HeartbeatPayloadResult {
  valid: boolean;
  resultJson: string;
  error?: string;
}

/**
 * Builds the heartbeat payload on CAS retry by parsing the fresh database record,
 * preserving all non-heartbeat fields (e.g. lastProgress, sourceStatuses, topic, raw counts),
 * and updating only authoritative lease/version telemetry.
 */
export function buildHeartbeatRetryPayload(
  freshPersistedRecord: any,
  heartbeatUpdate: {
    nextLeaseExpiresAt: Date;
    fencingGeneration: number;
    returnedFencingVersion: number;
    recordVersion: number;
    lastHeartbeatAt: Date;
  }
): HeartbeatPayloadResult {
  if (!freshPersistedRecord) {
    return { valid: false, resultJson: "", error: "Missing persisted record for heartbeat retry." };
  }

  let freshMeta: any = {};
  if (freshPersistedRecord.resultJson) {
    try {
      freshMeta = JSON.parse(freshPersistedRecord.resultJson);
    } catch {
      return { valid: false, resultJson: "", error: "Malformed fresh resultJson in persisted record." };
    }
  }

  // Preserve all existing fields in freshMeta (topic, sourceStatuses, raw observations, etc.)
  // Under _runtime, preserve existing fields (lastProgress, workerId, claimToken, etc.)
  const freshRuntime =
    freshMeta && typeof freshMeta._runtime === "object" && freshMeta._runtime !== null
      ? { ...freshMeta._runtime }
      : {};

  freshRuntime.leaseExpiresAt = heartbeatUpdate.nextLeaseExpiresAt.toISOString();
  freshRuntime.fencingGeneration = heartbeatUpdate.fencingGeneration;
  freshRuntime.fencingVersion = heartbeatUpdate.returnedFencingVersion;
  freshRuntime.recordVersion = heartbeatUpdate.recordVersion;
  freshRuntime.lastHeartbeatAt = heartbeatUpdate.lastHeartbeatAt.toISOString();

  const mergedMeta = {
    ...freshMeta,
    _runtime: freshRuntime,
  };

  return {
    valid: true,
    resultJson: JSON.stringify(mergedMeta),
  };
}

/**
 * Renews the lease for an actively owned job using atomic CAS.
 * Supports dedicated database columns while preserving resultJson._runtime synchronization.
 */
export async function renewResearchJobLease(
  jobId: string,
  ownershipOrWorkerId: JobOwnership | string,
  fencingTokenOrDb?: string | any,
  dbParam?: any
): Promise<LeaseRenewalResult> {
  const isLegacyCaller = typeof ownershipOrWorkerId === "string";
  let workerId: string;
  let fencingToken: string | undefined;
  let db: any;
  let ownership: JobOwnership | null = null;

  if (typeof ownershipOrWorkerId === "object") {
    ownership = ownershipOrWorkerId;
    workerId = ownership.workerId;
    fencingToken = ownership.fencingToken;
    db = (fencingTokenOrDb && typeof fencingTokenOrDb !== "string" ? fencingTokenOrDb : undefined) || dbParam || prisma;
  } else {
    workerId = ownershipOrWorkerId;
    fencingToken = fencingTokenOrDb as string;
    db = dbParam || prisma;
  }

  return withJobLock(jobId, async () => {
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
    const expectedWorker = job.workerId || runtime.workerId;
    const expectedToken = job.fencingToken || runtime.fencingToken;
    const expectedClaim = job.claimToken || runtime.claimToken;

    if (expectedWorker && expectedWorker !== workerId) {
      return { renewed: false, error: "Fencing token or worker mismatch." };
    }
    if (expectedClaim && ownership?.claimToken && expectedClaim !== ownership.claimToken) {
      return { renewed: false, error: "Claim token mismatch." };
    }
    if (expectedToken && fencingToken && expectedToken !== fencingToken) {
      return { renewed: false, error: "Fencing token mismatch." };
    }

    const now = new Date();
    // Check if lease already expired in DB
    if (job.leaseExpiresAt && new Date(job.leaseExpiresAt).getTime() <= now.getTime()) {
      return { renewed: false, error: "Cannot renew lease: lease already expired." };
    }

    const nextLeaseExpiresAt = new Date(Date.now() + KH02_LEASE_DURATION_MS);
    const nextLeaseExpiresAtStr = nextLeaseExpiresAt.toISOString();

    // CRITICAL: Heartbeat retains fencingGeneration! Never advance fencingGeneration on renewal.
    const currentFencingGen =
      job.fencingGeneration !== undefined && job.fencingGeneration !== null && job.fencingGeneration > 0
        ? job.fencingGeneration
        : ownership?.fencingGeneration ?? ownership?.fencingVersion ?? runtime.fencingVersion ?? 0;

    // Use caller's expected recordVersion if provided to test CAS; fallback to database version
    const currentRecordVersion =
      ownership?.recordVersion !== undefined && ownership.recordVersion !== null
        ? ownership.recordVersion
        : job.recordVersion !== undefined && job.recordVersion !== null
        ? job.recordVersion
        : 0;
    const nextRecordVersion = currentRecordVersion + 1;

    const returnedFencingVersion = isLegacyCaller
      ? (runtime.fencingVersion || currentFencingGen || 0) + 1
      : currentFencingGen;

    runtime.leaseExpiresAt = nextLeaseExpiresAtStr;
    runtime.fencingGeneration = currentFencingGen;
    runtime.fencingVersion = returnedFencingVersion;
    runtime.recordVersion = nextRecordVersion;
    runtime.lastHeartbeatAt = now.toISOString();

    const where: any = {
      id: jobId,
      status: "RUNNING",
    };
    if (job.fencingGeneration !== undefined && job.fencingGeneration !== null && job.fencingGeneration > 0) {
      where.fencingGeneration = job.fencingGeneration;
    }
    if (currentRecordVersion !== undefined && currentRecordVersion !== null && currentRecordVersion > 0) {
      where.recordVersion = currentRecordVersion;
    }
    if (job.workerId) {
      where.workerId = job.workerId;
    }
    if (job.fencingToken) {
      where.fencingToken = fencingToken || job.fencingToken;
    } else if (fencingToken) {
      where.resultJson = { contains: fencingToken };
    }
    if (job.claimToken) {
      where.claimToken = ownership?.claimToken || job.claimToken;
    }
    if (job.leaseExpiresAt) {
      where.leaseExpiresAt = { gt: now };
    }

    let updateRes = await db.syncJob.updateMany({
      where,
      data: {
        leaseExpiresAt: nextLeaseExpiresAt,
        recordVersion: nextRecordVersion,
        resultJson: JSON.stringify({ ...meta, _runtime: runtime }),
      },
    });

    // If update failed due to same-owner version contention with progress write:
    // Bounded CAS retry loop with FRESH payload reload (never reusing stale meta)
    const MAX_HEARTBEAT_RETRIES = 3;
    let retryAttempt = 0;
    while (updateRes.count === 0 && retryAttempt < MAX_HEARTBEAT_RETRIES) {
      retryAttempt++;
      const refreshed =
        typeof db.syncJob?.findUnique === "function"
          ? await db.syncJob.findUnique({ where: { id: jobId } })
          : null;

      if (!refreshed || refreshed.status !== "RUNNING") {
        return { renewed: false, error: "Lease renewal failed: job is no longer in RUNNING state." };
      }

      // Parse fresh metadata for runtime check
      let refreshedMeta: any = {};
      try {
        refreshedMeta = JSON.parse(refreshed.resultJson || "{}");
      } catch {}

      const effectiveWorker = refreshed.workerId || refreshedMeta?._runtime?.workerId;
      if (!effectiveWorker || effectiveWorker !== workerId) {
        return { renewed: false, error: "Lease renewal failed: worker ownership lost." };
      }

      const expectedClaim = ownership?.claimToken || job.claimToken || runtime.claimToken;
      const effectiveClaim = refreshed.claimToken || refreshedMeta?._runtime?.claimToken;
      if (expectedClaim && effectiveClaim && effectiveClaim !== expectedClaim) {
        return { renewed: false, error: "Lease renewal failed: claim token mismatch." };
      }

      const expectedFencing = fencingToken || ownership?.fencingToken || job.fencingToken || runtime.fencingToken;
      const effectiveFencing = refreshed.fencingToken || refreshedMeta?._runtime?.fencingToken;
      if (expectedFencing && effectiveFencing && effectiveFencing !== expectedFencing) {
        return { renewed: false, error: "Lease renewal failed: fencing token mismatch." };
      }

      if (refreshed.fencingGeneration !== undefined && refreshed.fencingGeneration !== currentFencingGen) {
        return { renewed: false, error: "Lease renewal failed: fencing generation changed." };
      }

      if (refreshed.leaseExpiresAt && new Date(refreshed.leaseExpiresAt).getTime() <= now.getTime()) {
        return { renewed: false, error: "Lease renewal failed: lease already expired in database." };
      }

      // Build retry payload from freshly parsed resultJson (preserving concurrent progress updates!)
      const retryRecordVersion = (refreshed.recordVersion || 0) + 1;
      const retryPayload = buildHeartbeatRetryPayload(refreshed, {
        nextLeaseExpiresAt,
        fencingGeneration: currentFencingGen,
        returnedFencingVersion,
        recordVersion: retryRecordVersion,
        lastHeartbeatAt: now,
      });

      if (!retryPayload.valid) {
        return { renewed: false, error: retryPayload.error || "Failed to build heartbeat retry payload." };
      }

      const retryWhere: any = {
        id: jobId,
        status: "RUNNING",
      };
      if (refreshed.fencingGeneration !== undefined && refreshed.fencingGeneration !== null && refreshed.fencingGeneration > 0) {
        retryWhere.fencingGeneration = refreshed.fencingGeneration;
      }
      if (refreshed.recordVersion !== undefined && refreshed.recordVersion !== null) {
        retryWhere.recordVersion = refreshed.recordVersion;
      }
      if (refreshed.workerId) retryWhere.workerId = workerId;
      if (refreshed.claimToken && expectedClaim) retryWhere.claimToken = expectedClaim;
      if (refreshed.fencingToken) {
        retryWhere.fencingToken = expectedFencing;
      } else if (expectedFencing) {
        retryWhere.resultJson = { contains: expectedFencing };
      }
      if (refreshed.leaseExpiresAt) {
        retryWhere.leaseExpiresAt = { gt: new Date() };
      }

      updateRes = await db.syncJob.updateMany({
        where: retryWhere,
        data: {
          leaseExpiresAt: nextLeaseExpiresAt,
          recordVersion: retryRecordVersion,
          resultJson: retryPayload.resultJson,
        },
      });

      if (updateRes.count > 0) {
        if (ownership) {
          ownership.recordVersion = retryRecordVersion;
          ownership.leaseExpiresAt = nextLeaseExpiresAtStr;
          ownership.fencingGeneration = currentFencingGen;
          ownership.fencingVersion = currentFencingGen;
        }
        return {
          renewed: true,
          leaseExpiresAt: nextLeaseExpiresAtStr,
          fencingVersion: returnedFencingVersion,
        };
      }
    }

    if (updateRes.count === 0) {
      return { renewed: false, error: "Lease renewal failed atomic CAS: ownership lost or state changed." };
    }

    if (ownership) {
      ownership.recordVersion = nextRecordVersion;
      ownership.leaseExpiresAt = nextLeaseExpiresAtStr;
      ownership.fencingGeneration = currentFencingGen;
      ownership.fencingVersion = currentFencingGen;
    }

    return {
      renewed: true,
      leaseExpiresAt: nextLeaseExpiresAtStr,
      fencingVersion: returnedFencingVersion,
    };
  });
}

/**
 * Active heartbeat manager maintaining monotonic lease renewal during long executions.
 */
export class ResearchHeartbeatManager {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private inFlight = false;

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
      if (this.stopped || this.inFlight) return;
      this.inFlight = true;
      try {
        const res = await renewResearchJobLease(
          this.jobId,
          this.ownership,
          this.db
        );
        if (!res.renewed) {
          this.stop();
          if (this.onLostOwnership) this.onLostOwnership();
        }
      } catch {
        // Transient error will be retried on next heartbeat cycle
      } finally {
        this.inFlight = false;
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

  isRunning(): boolean {
    return !this.stopped && this.timer !== null;
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
): Promise<OwnershipMutationResult> {
  return withJobLock(jobId, async () => {
    const job = await db.syncJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "RUNNING") return { success: false, rowsAffected: 0, reason: "INVALID_STATE" };

    let meta: any = {};
    try {
      meta = JSON.parse(job.resultJson || "{}");
    } catch {
      return { success: false, rowsAffected: 0, reason: "INVALID_STATE" };
    }

    const runtime = meta._runtime || {};
    if (
      (job.workerId && job.workerId !== ownership.workerId) ||
      (runtime.workerId && runtime.workerId !== ownership.workerId) ||
      (job.claimToken && ownership.claimToken && job.claimToken !== ownership.claimToken)
    ) {
      return { success: false, rowsAffected: 0, reason: "OWNERSHIP_LOST" };
    }

    const nowIso = new Date().toISOString();
    const prevStage = runtime.lastProgress?.stage;
    const stageStartedAt =
      prevStage === progress.stage && runtime.stageStartedAt ? runtime.stageStartedAt : nowIso;

    meta._runtime = {
      ...runtime,
      lastProgress: progress,
      stageStartedAt,
      lastProgressUpdateAt: nowIso,
    };

    return updateJobIfClaimOwned(
      jobId,
      ownership,
      {
        progress: progress.percent,
        resultJson: JSON.stringify(meta),
      },
      db
    );
  });
}

/**
 * Completes a research job and stores the final leaderboard snapshot atomically.
 */
export async function completeResearchJob(
  jobId: string,
  ownership: JobOwnership,
  result: EvergreenLeaderboardResult,
  db: any = prisma
): Promise<OwnershipMutationResult> {
  return withJobLock(jobId, async () => {
    const job = await db.syncJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "RUNNING") return { success: false, rowsAffected: 0, reason: "INVALID_STATE" };

    let meta: any = {};
    try {
      meta = JSON.parse(job.resultJson || "{}");
    } catch {}

    const runtime = meta._runtime || {};
    if (
      (job.workerId && job.workerId !== ownership.workerId) ||
      (runtime.workerId && runtime.workerId !== ownership.workerId) ||
      (job.claimToken && ownership.claimToken && job.claimToken !== ownership.claimToken)
    ) {
      return { success: false, rowsAffected: 0, reason: "OWNERSHIP_LOST" };
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
  });
}

/**
 * Marks a research job as failed with sanitized error details using atomic CAS.
 * Enforces ownership match on workerId, claimToken, and fencingGeneration.
 */
export async function failResearchJob(
  jobId: string,
  ownership: JobOwnership,
  error: unknown,
  db: any = prisma
): Promise<OwnershipMutationResult> {
  return withJobLock(jobId, async () => {
    const rawMsg = error instanceof Error ? error.message : String(error);
    // Sanitize any potential API keys or tokens
    const sanitized = rawMsg
      .replace(/key=[^&\s]+/gi, "key=REDACTED")
      .replace(/Bearer\s+[^&\s]+/gi, "Bearer REDACTED");

    return updateJobIfClaimOwned(
      jobId,
      ownership,
      {
        status: "FAILED",
        errorMessage: sanitized,
        completedAt: new Date(),
      },
      db
    );
  });
}

/**
 * Scans for abandoned/crashed RUNNING jobs whose leases have expired using atomic CAS.
 * Atomically verifies leaseExpiresAt <= now at write time to prevent recovery vs heartbeat race.
 */
export async function recoverStaleResearchJobs(
  db: any = prisma
): Promise<RecoverySummary> {
  const now = new Date();
  const nowMs = now.getTime();
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
    let leaseTime = 0;
    if (job.leaseExpiresAt) {
      leaseTime = new Date(job.leaseExpiresAt).getTime();
    } else if (runtime.leaseExpiresAt) {
      leaseTime = new Date(runtime.leaseExpiresAt).getTime();
    }

    if (leaseTime < nowMs) {
      const attempts = job.attemptNumber || runtime.attemptNumber || 1;
      const fencingGen = job.fencingGeneration || runtime.fencingVersion || 0;
      const currentRecVersion = job.recordVersion || 0;
      const leaseExpiredDurationMs = leaseTime > 0 ? nowMs - leaseTime : 0;
      const isAbandonedHistoricalJob = leaseExpiredDurationMs > KH02_ABANDONED_LEASE_EXPIRY_MS;

      // ATOMIC CAS RECOVERY PREDICATE
      // Condition strictly on leaseExpiresAt <= now, recordVersion, fencingGeneration, and workerId at write time
      const recoveryWhere: any = {
        id: job.id,
        status: "RUNNING",
        fencingGeneration: fencingGen,
        recordVersion: currentRecVersion,
      };
      if (job.workerId) recoveryWhere.workerId = job.workerId;
      if (job.claimToken) recoveryWhere.claimToken = job.claimToken;
      if (job.fencingToken) recoveryWhere.fencingToken = job.fencingToken;
      if (job.leaseExpiresAt) {
        recoveryWhere.leaseExpiresAt = { lte: now };
      }

      if (attempts < KH02_MAX_ATTEMPTS && !isAbandonedHistoricalJob) {
        const nextGeneration = fencingGen + 1;
        // Atomic CAS reclaim to PENDING
        const res = await db.syncJob.updateMany({
          where: recoveryWhere,
          data: {
            status: "PENDING",
            progress: 0,
            fencingGeneration: nextGeneration,
            recordVersion: 0,
            workerId: null,
            claimToken: null,
            fencingToken: null,
            leaseExpiresAt: null,
            errorMessage: `Recovered from stale worker lease expiry (attempt ${attempts}/${KH02_MAX_ATTEMPTS}).`,
            resultJson: JSON.stringify({
              ...meta,
              _runtime: {
                ...runtime,
                workerId: null,
                claimToken: null,
                fencingToken: null,
                fencingGeneration: nextGeneration,
                fencingVersion: nextGeneration,
                recordVersion: 0,
                leaseExpiresAt: null,
                lastRecoveredAt: now.toISOString(),
              },
            }),
          },
        });
        if (res.count > 0) recoveredCount++;
      } else {
        // Atomic CAS fail permanently
        const res = await db.syncJob.updateMany({
          where: recoveryWhere,
          data: {
            status: "FAILED",
            completedAt: now,
            recordVersion: currentRecVersion + 1,
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
    fencingGeneration: job.fencingGeneration,
    recordVersion: job.recordVersion,
    fencingVersion: job.fencingGeneration,
    leaseExpiresAt: job.leaseExpiresAt,
  };

  const abortController = new AbortController();
  let lostOwnership = false;
  let jobTimedOut = false;
  const overallDeadlineTimer = setTimeout(() => {
    jobTimedOut = true;
    abortController.abort(new Error("JOB_DEADLINE_EXCEEDED: Overall research job deadline exceeded."));
  }, KH02_MAX_JOB_DURATION_MS);

  const heartbeat = startResearchHeartbeat(job.id, ownership, {
    intervalMs: 15000,
    db,
    onLostOwnership: () => {
      lostOwnership = true;
      abortController.abort(new Error("OWNERSHIP_LOST: Worker lease lost."));
    },
  });

  try {
    await updateResearchProgress(job.id, ownership, { stage: "DISCOVERY", percent: 20 }, db);

    // Pass execution context to pure research orchestrator
    const context: KH02ResearchExecutionContext = {
      workspaceId: job.workspaceId,
      runId: job.id,
      signal: abortController.signal,
      reportProgress: async (p) => {
        if (lostOwnership) {
          throw new Error("Job execution aborted: ownership lease lost.");
        }
        if (jobTimedOut) {
          throw new Error("JOB_DEADLINE_EXCEEDED: Overall research job deadline exceeded.");
        }
        const progRes = await updateResearchProgress(
          job.id,
          ownership,
          { stage: p.stage, percent: p.percent },
          db
        );
        if (!progRes.success) {
          lostOwnership = true;
          abortController.abort(new Error("OWNERSHIP_LOST: Lost lease ownership during progress update."));
          throw new Error(`Lost lease ownership during progress update in stage ${p.stage}.`);
        }
      },
    };

    const result = await runEvergreenProductResearch(
      {
        topic: job.payload.topic,
        market: job.payload.market || "US",
        lookbackDays: job.payload.lookbackDays || 90,
        maxCandidates: job.payload.maxCandidates || 15,
        workspaceId: job.workspaceId,
        runId: job.id,
        signal: abortController.signal,
      },
      context
    );

    if (lostOwnership) {
      throw new Error("Job execution aborted: ownership lease was lost or claimed by another worker.");
    }
    if (jobTimedOut) {
      throw new Error("JOB_DEADLINE_EXCEEDED: Overall research job deadline exceeded.");
    }

    await updateResearchProgress(job.id, ownership, { stage: "SNAPSHOT", percent: 90 }, db);

    // Terminal completion committed EXCLUSIVELY by worker holding active lease
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
    clearTimeout(overallDeadlineTimer);
    heartbeat.stop();
  }
}

/**
 * Persists worker heartbeat to SQLite via SyncJob with jobType: "KH02_WORKER_HEARTBEAT"
 * so independent worker liveness can be observed across processes (Next.js server, API routes).
 */
export async function persistKh02WorkerHeartbeat(
  workerId: string = WORKER_ID,
  activeJob: string | null = null,
  state: "RUNNING" | "STOPPED" | "IDLE" = "RUNNING",
  telemetry: {
    processedCount?: number;
    failureCount?: number;
    processStartedAt?: string;
    uptimeSeconds?: number;
    workerVersion?: string;
    workerBuildSha?: string | null;
    workerProcessId?: number;
    dbFingerprint?: string;
  } = {},
  db: any = prisma
): Promise<void> {
  try {
    const now = new Date();
    const existing = await db.syncJob.findFirst({
      where: { jobType: "KH02_WORKER_HEARTBEAT" },
    });

    const resultPayload = {
      workerId,
      activeJobId: activeJob,
      state,
      lastHeartbeatAt: now.toISOString(),
      processedCount: telemetry.processedCount ?? processedJobs,
      failureCount: telemetry.failureCount ?? failedJobs,
      processStartedAt: telemetry.processStartedAt ?? new Date(startTime).toISOString(),
      workerVersion: telemetry.workerVersion ?? SWAI_KH02_RELEASE_VERSION,
      workerBuildSha: telemetry.workerBuildSha !== undefined ? telemetry.workerBuildSha : getRuntimeBuildSha(),
      workerProcessId: telemetry.workerProcessId ?? process.pid,
      dbFingerprint: telemetry.dbFingerprint ?? getDatabaseFingerprint(),
    };

    if (existing) {
      await db.syncJob.update({
        where: { id: existing.id },
        data: {
          status: state === "STOPPED" ? "STOPPED" : "RUNNING",
          startedAt: state === "RUNNING" ? (existing.startedAt || now) : existing.startedAt,
          completedAt: state === "STOPPED" ? now : null,
          workerId,
          resultJson: JSON.stringify(resultPayload),
        },
      });
    } else {
      const workspace = await db.workspace.findFirst({ select: { id: true } });
      if (workspace) {
        await db.syncJob.create({
          data: {
            id: `kh02-heartbeat-${workerId}`,
            workspaceId: workspace.id,
            jobType: "KH02_WORKER_HEARTBEAT",
            status: state === "STOPPED" ? "STOPPED" : "RUNNING",
            startedAt: now,
            completedAt: state === "STOPPED" ? now : null,
            workerId,
            resultJson: JSON.stringify(resultPayload),
          },
        });
      }
    }
  } catch (err) {
    // Non-fatal warning on worker heartbeat persistence
  }
}

/**
 * Reads shared worker health from authoritative database records across processes.
 * Freshness threshold:
 * - ALIVE: heartbeat within <= 30 seconds
 * - STALE: heartbeat within <= 60 seconds
 * - OFFLINE: heartbeat > 60 seconds, marked STOPPED, or missing
 */
export async function getSharedResearchWorkerHealth(db: any = prisma): Promise<KH02WorkerHealth> {
  const now = new Date();
  const observedAt = now.toISOString();

  try {
    const heartbeatJob = await db.syncJob.findFirst({
      where: { jobType: "KH02_WORKER_HEARTBEAT" },
      orderBy: { createdAt: "desc" },
    });

    if (!heartbeatJob || !heartbeatJob.resultJson) {
      if (isRunning) {
        return {
          workerId: WORKER_ID,
          observedAt,
          lastHeartbeatAt: lastHeartbeat,
          status: "ALIVE",
          activeJobId,
          processedCount: processedJobs,
          failureCount: failedJobs,
          processStartedAt: new Date(startTime).toISOString(),
          uptimeSeconds: Math.round((Date.now() - startTime) / 1000),
          workerVersion: SWAI_KH02_RELEASE_VERSION,
          workerBuildSha: getRuntimeBuildSha(),
          workerProcessId: process.pid,
          dbFingerprint: getDatabaseFingerprint(),
          conflictingWorkerIds: [],
        };
      }
      return {
        workerId: "NONE",
        observedAt,
        lastHeartbeatAt: null,
        status: "OFFLINE",
        activeJobId: null,
        processedCount: 0,
        failureCount: 0,
        processStartedAt: null,
        uptimeSeconds: 0,
        workerVersion: null,
        workerBuildSha: null,
        workerProcessId: null,
        dbFingerprint: null,
        conflictingWorkerIds: [],
      };
    }

    let meta: any = {};
    try {
      meta = JSON.parse(heartbeatJob.resultJson);
    } catch {}

    const lastHeartbeatTime = meta.lastHeartbeatAt ? new Date(meta.lastHeartbeatAt).getTime() : 0;
    const diffMs = Date.now() - lastHeartbeatTime;

    let status: "ALIVE" | "STALE" | "OFFLINE" | "UNKNOWN" = "OFFLINE";
    if (meta.state === "STOPPED" || heartbeatJob.status === "COMPLETED" || heartbeatJob.status === "STOPPED") {
      status = "OFFLINE";
    } else if (diffMs <= 30_000) {
      status = "ALIVE";
    } else if (diffMs <= 60_000) {
      status = "STALE";
    } else {
      status = "OFFLINE";
    }

    const processStartedAt = meta.processStartedAt || (heartbeatJob.startedAt ? heartbeatJob.startedAt.toISOString() : null);
    const uptimeSeconds = processStartedAt ? Math.max(0, Math.round((Date.now() - new Date(processStartedAt).getTime()) / 1000)) : 0;

    return {
      workerId: meta.workerId || heartbeatJob.workerId || "UNKNOWN",
      observedAt,
      lastHeartbeatAt: meta.lastHeartbeatAt || null,
      status,
      activeJobId: meta.activeJobId || null,
      processedCount: meta.processedCount || 0,
      failureCount: meta.failureCount || 0,
      processStartedAt,
      uptimeSeconds,
      workerVersion: meta.workerVersion || null,
      workerBuildSha: meta.workerBuildSha || null,
      workerProcessId: meta.workerProcessId || meta.pid || null,
      dbFingerprint: meta.dbFingerprint || null,
      conflictingWorkerIds: [],
    };
  } catch (err) {
    return {
      workerId: "ERROR",
      observedAt,
      lastHeartbeatAt: null,
      status: "UNKNOWN",
      activeJobId: null,
      processedCount: 0,
      failureCount: 0,
      processStartedAt: null,
      uptimeSeconds: 0,
      workerVersion: null,
      workerBuildSha: null,
      workerProcessId: null,
      dbFingerprint: null,
      conflictingWorkerIds: [],
    };
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
  const bootSha = getRuntimeBuildSha() || "unknown";
  const dbFp = getDatabaseFingerprint();

  console.log(
    `[KH-02 Worker] Initialized ${WORKER_ID} | Release: V${SWAI_KH02_RELEASE_VERSION} | SHA: ${bootSha.slice(0, 7)} | DB Fingerprint: ${dbFp} | Mode: ${options.once ? "ONCE" : "DAEMON"}`
  );

  // Initial persisted heartbeat
  await persistKh02WorkerHeartbeat(WORKER_ID, null, "RUNNING").catch(() => {});

  // Idle heartbeat timer to keep worker observable across processes even with empty queue
  const idleHeartbeatTimer = setInterval(() => {
    if (isRunning) {
      lastHeartbeat = new Date().toISOString();
      persistKh02WorkerHeartbeat(WORKER_ID, activeJobId, "RUNNING").catch(() => {});
    }
  }, 5000);

  // 1. Recover any abandoned jobs at startup
  try {
    const recovery = await recoverStaleResearchJobs();
    if (recovery.recoveredCount > 0 || recovery.failedCount > 0) {
      console.log(`[KH-02 Worker] Startup recovery: ${recovery.recoveredCount} recovered, ${recovery.failedCount} marked failed.`);
    }
  } catch (recErr) {
    console.warn(`[KH-02 Worker] Startup recovery error:`, recErr);
  }

  let loopCount = 0;
  try {
    do {
      loopCount++;
      lastHeartbeat = new Date().toISOString();
      try {
        if (loopCount % 5 === 0) {
          await recoverStaleResearchJobs().catch(() => {});
        }
        const job = await claimNextResearchJob(WORKER_ID);
        if (job) {
          console.log(`[KH-02 Worker] Claimed job ${job.id} for topic '${job.payload.topic}' (Workspace: ${job.workspaceId})`);
          await persistKh02WorkerHeartbeat(WORKER_ID, job.id, "RUNNING").catch(() => {});
          const outcome = await executeResearchJob(job);
          console.log(`[KH-02 Worker] Finished job ${job.id}: ${outcome.success ? "COMPLETED" : "FAILED"}`);
          await persistKh02WorkerHeartbeat(WORKER_ID, null, "RUNNING").catch(() => {});
        }
      } catch (loopErr) {
        console.error(`[KH-02 Worker] Loop execution error:`, loopErr);
      }

      if (options.once) break;
      await new Promise((r) => setTimeout(r, pollInterval));
    } while (isRunning);
  } finally {
    clearInterval(idleHeartbeatTimer);
    await persistKh02WorkerHeartbeat(WORKER_ID, null, "STOPPED").catch(() => {});
  }

  console.log(`[KH-02 Worker] Stopped.`);
}

// Standalone execution entrypoint
const isEntrypoint =
  (typeof require !== "undefined" && require.main === module) ||
  Boolean(process.argv[1] && process.argv[1].replace(/\\/g, "/").includes("src/workers/kh02Worker"));

if (isEntrypoint) {
  const isOnce = process.argv.includes("--once");
  runWorkerLoop({ once: isOnce }).catch((err) => {
    console.error("Fatal worker error:", err);
    process.exit(1);
  });
}
