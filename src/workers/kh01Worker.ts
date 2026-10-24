/**
 * SWAI KH-01 Background Worker & Job Processor
 *
 * Lightweight, strictly bounded landing-page research processor.
 * Concurrency: Configurable via KH01_MAX_ACTIVE_HEAVY_RESEARCH_JOBS (default: 1).
 * Enforces atomic database-backed claim fencing, monotonic fencing versions,
 * conditional lease renewal, slot management, and graceful abort on shutdown.
 */

import { loadLocalEnvironment } from "@/lib/loadLocalEnvironment";
loadLocalEnvironment();

import crypto from "crypto";
import { prisma } from "@/lib/db";
import {
  executeLandingPageResearchJob,
} from "@/services/research/landingPageInspectionService";

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
  attemptNumber?: number;
  fencingVersion?: number;
}

export interface ClaimedKh01Job {
  id: string;
  workspaceId: string;
  jobType: string;
  status: string;
  workerId: string;
  claimToken: string;
  fencingVersion?: number;
  attemptNumber: number;
  leaseExpiresAt?: string;
  payload?: Kh01JobInput;
}

export interface Kh01OwnedJobPatch {
  status?: ResearchJobStatus;
  progress?: number;
  errorMessage?: string | null;
  completedAt?: Date | null;
  resultJsonPayload?: Record<string, any>;
  extendLease?: boolean;
  leaseDurationMs?: number;
}

export interface LeaseRenewalResult {
  renewed: boolean;
  leaseExpiresAt?: string;
  fencingVersion?: number;
  error?: string;
}

export interface ResearchSlotLease {
  slotId: string;
  workerId: string;
  jobId: string;
  claimToken: string;
  leaseExpiresAt: string;
}

export interface Kh01JobRuntime {
  workerId: string | null;
  claimToken: string | null;
  fencingVersion?: number;
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

const WORKER_ID = `kh01-worker-${process.pid}-${Date.now().toString(36)}`;
export const KH01_LEASE_DURATION_MS = 60 * 1000; // 60 seconds (canonical lease duration)

/**
 * Scoped global concurrency budget for heavy research jobs across the shared DB.
 * Defaults to 1 for local environments.
 */
export function getKh01MaxConcurrency(): number {
  const parsed = parseInt(process.env.KH01_MAX_ACTIVE_HEAVY_RESEARCH_JOBS || "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

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

  // Validate URL protocol
  try {
    const parsed = new URL(rec.targetUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Unsupported protocol '${parsed.protocol}'. Only http/https supported.`);
    }
  } catch (err: any) {
    throw new Error(`Invalid targetUrl '${rec.targetUrl}': ${err.message}`);
  }

  if (rec.productId !== undefined && rec.productId !== null && typeof rec.productId !== "string") {
    throw new Error("Invalid 'productId' in job payload: must be string or null.");
  }

  if (rec.adId !== undefined && rec.adId !== null && typeof rec.adId !== "string") {
    throw new Error("Invalid 'adId' in job payload: must be string or null.");
  }

  return {
    productId: typeof rec.productId === "string" ? rec.productId : null,
    adId: typeof rec.adId === "string" ? rec.adId : null,
    targetUrl: rec.targetUrl,
    forceRefresh: Boolean(rec.forceRefresh),
    requestedAt: typeof rec.requestedAt === "string" ? rec.requestedAt : new Date().toISOString(),
    attemptNumber: typeof rec.attemptNumber === "number" ? rec.attemptNumber : 0,
    fencingVersion: typeof rec.fencingVersion === "number" ? rec.fencingVersion : 0,
  };
}

/**
 * Asserts that the specified worker and claim token currently hold an active, unexpired lease.
 * Supports passing either a ClaimedKh01Job object or individual parameters.
 */
export async function assertActiveJobLease(
  jobOrClaim: string | ClaimedKh01Job,
  workerIdArg?: string,
  claimTokenArg?: string,
  fencingVersionArg?: number,
  txClient?: any
): Promise<void> {
  const db = txClient || prisma;
  const jobId = typeof jobOrClaim === "string" ? jobOrClaim : jobOrClaim.id;
  const workerId = typeof jobOrClaim === "object" ? jobOrClaim.workerId : workerIdArg;
  const claimToken = typeof jobOrClaim === "object" ? jobOrClaim.claimToken : claimTokenArg;
  const fencingVersion =
    typeof jobOrClaim === "object" ? jobOrClaim.fencingVersion : fencingVersionArg;

  const job = await db.syncJob.findUnique({
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

  if (
    fencingVersion !== undefined &&
    meta.fencingVersion !== undefined &&
    meta.fencingVersion !== fencingVersion
  ) {
    throw new Error(
      `Fencing version mismatch: Claim version ${fencingVersion} does not match database version ${meta.fencingVersion}.`
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
 * Atomically updates a job ONLY if the caller is the current active claim owner
 * with an unexpired lease and matching fencing version.
 * Advances the fencing version monotonically on every successful mutation.
 * In-memory claim is mutated strictly AFTER the database write has committed.
 */
export async function updateJobIfClaimOwned(
  claim: ClaimedKh01Job,
  patch: Kh01OwnedJobPatch,
  txClient?: any
): Promise<boolean> {
  let committedFencingVersion: number | null = null;
  let committedLeaseExpiry: string | null = null;

  const runner = async (tx: any) => {
    const job = await tx.syncJob.findUnique({
      where: { id: claim.id },
    });
    if (!job || job.status !== "RUNNING") {
      return false;
    }

    let meta: any = {};
    try {
      meta = JSON.parse(job.resultJson || "{}");
    } catch {
      return false;
    }

    // Ownership check: workerId, claimToken, fencingVersion
    if (
      meta.workerId !== claim.workerId ||
      meta.claimToken !== claim.claimToken ||
      (typeof claim.fencingVersion === "number" &&
        meta.fencingVersion !== undefined &&
        meta.fencingVersion !== claim.fencingVersion)
    ) {
      return false;
    }

    // Cancellation check
    if (meta.cancellationRequested) {
      return false;
    }

    // Unexpired lease check
    if (meta.leaseExpiresAt && new Date(meta.leaseExpiresAt).getTime() < Date.now()) {
      return false;
    }

    // Calculate monotonically advanced fencing version locally without mutating claim prematurely
    const nextFencingVersion = (meta.fencingVersion ?? claim.fencingVersion ?? 0) + 1;

    const now = new Date();
    const leaseDuration = patch.leaseDurationMs || KH01_LEASE_DURATION_MS;
    const newLeaseExpiry = patch.extendLease
      ? new Date(now.getTime() + leaseDuration).toISOString()
      : meta.leaseExpiresAt;

    const updatedMeta = {
      ...meta,
      ...(patch.resultJsonPayload || {}),
      workerId: claim.workerId,
      claimToken: claim.claimToken,
      fencingVersion: nextFencingVersion,
      leaseExpiresAt: newLeaseExpiry,
      lastHeartbeatAt: now.toISOString(),
      ...(patch.errorMessage ? { errorMessage: patch.errorMessage } : {}),
    };

    await tx.syncJob.update({
      where: { id: claim.id },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(typeof patch.progress === "number" ? { progress: patch.progress } : {}),
        ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
        ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
        resultJson: JSON.stringify(updatedMeta),
      },
    });

    committedFencingVersion = nextFencingVersion;
    if (patch.extendLease) {
      committedLeaseExpiry = newLeaseExpiry;
    }

    return true;
  };

  const success = txClient ? await runner(txClient) : await prisma.$transaction(runner);

  // Update in-memory claim object strictly after transaction has committed
  if (success && committedFencingVersion !== null) {
    claim.fencingVersion = committedFencingVersion;
    if (committedLeaseExpiry) {
      claim.leaseExpiresAt = committedLeaseExpiry;
    }
  }

  return success;
}

/**
 * Renews the lease expiration timestamp and heartbeat for an active claimed job.
 * Guaranteed atomic via updateJobIfClaimOwned compare-and-swap.
 */
export async function renewKh01Lease(claim: ClaimedKh01Job): Promise<LeaseRenewalResult> {
  const success = await updateJobIfClaimOwned(claim, {
    extendLease: true,
  });

  if (!success) {
    return {
      renewed: false,
      error: `Claim lost or lease expired for job '${claim.id}'. Cannot renew lease.`,
    };
  }

  return {
    renewed: true,
    fencingVersion: claim.fencingVersion,
    leaseExpiresAt: claim.leaseExpiresAt,
  };
}

/**
 * Explicit research slot acquisition helper.
 * Atomically checks capacity and establishes a durable capacity reservation on SyncJob.
 */
export async function acquireResearchSlot(
  workerId: string,
  jobId: string,
  claimToken: string = crypto.randomUUID(),
  txClient?: any
): Promise<ResearchSlotLease | null> {
  // Input validation (Tasks 082, 083)
  if (!workerId || typeof workerId !== "string" || !workerId.trim()) return null;
  if (!jobId || typeof jobId !== "string" || !jobId.trim()) return null;
  if (!claimToken || typeof claimToken !== "string" || !claimToken.trim()) return null;

  const maxConcurrency = getKh01MaxConcurrency();

  const runner = async (tx: any) => {
    const job = await tx.syncJob.findUnique({ where: { id: jobId } });
    if (!job) {
      return null;
    }

    // Task 085: Restrict acquisition states. Only PENDING or RUNNING jobs can acquire/renew.
    if (job.status !== "PENDING" && job.status !== "RUNNING") {
      return null;
    }

    let meta: any = {};
    try {
      meta = JSON.parse(job.resultJson || "{}");
    } catch {
      meta = {};
    }

    const now = Date.now();
    const isLeaseActive = meta.leaseExpiresAt && new Date(meta.leaseExpiresAt).getTime() >= now;

    // Task 084: Prevent arbitrary reassignment.
    // If the job is RUNNING under another worker with an unexpired active lease, reject takeover!
    if (job.status === "RUNNING") {
      if (meta.workerId && meta.workerId !== workerId && isLeaseActive) {
        return null;
      }
    }

    // 1. Check currently active heavy research jobs with unexpired lease
    const runningJobs = await tx.syncJob.findMany({
      where: {
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "RUNNING",
      },
    });

    const activeCount = runningJobs.filter((j: any) => {
      if (j.id === jobId) return false;
      try {
        const m = JSON.parse(j.resultJson || "{}");
        return m.leaseExpiresAt && new Date(m.leaseExpiresAt).getTime() >= now;
      } catch {
        return false;
      }
    }).length;

    if (activeCount >= maxConcurrency) {
      return null;
    }

    const leaseExpiresAt = new Date(now + KH01_LEASE_DURATION_MS).toISOString();
    const fencingVersion = (meta.fencingVersion || 0) + 1;

    // Atomically transition or update the job reservation
    await tx.syncJob.update({
      where: { id: jobId },
      data: {
        status: "RUNNING",
        startedAt: job.startedAt || new Date(now),
        resultJson: JSON.stringify({
          ...meta,
          workerId,
          claimToken,
          fencingVersion,
          leaseExpiresAt,
          lastHeartbeatAt: new Date(now).toISOString(),
        }),
      },
    });

    return {
      slotId: `slot_${jobId}`,
      workerId,
      jobId,
      claimToken,
      leaseExpiresAt,
    };
  };

  if (txClient) {
    return await runner(txClient);
  } else {
    return await prisma.$transaction(runner);
  }
}

/**
 * Explicit research slot renewal helper.
 * Atomically extends the lease only if owned by the caller.
 */
export async function renewResearchSlot(
  workerId: string,
  jobId: string,
  claimToken: string,
  txClient?: any
): Promise<boolean> {
  if (!workerId || typeof workerId !== "string" || !workerId.trim()) return false;
  if (!jobId || typeof jobId !== "string" || !jobId.trim()) return false;
  if (!claimToken || typeof claimToken !== "string" || !claimToken.trim()) return false;

  const runner = async (tx: any) => {
    const job = await tx.syncJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "RUNNING") return false;
    let meta: any = {};
    try {
      meta = JSON.parse(job.resultJson || "{}");
    } catch {
      return false;
    }
    if (meta.workerId !== workerId || meta.claimToken !== claimToken) return false;
    if (meta.leaseExpiresAt && new Date(meta.leaseExpiresAt).getTime() < Date.now()) return false;
    if (meta.cancellationRequested) return false;

    const now = Date.now();
    const leaseExpiresAt = new Date(now + KH01_LEASE_DURATION_MS).toISOString();
    const nextFencingVersion = (meta.fencingVersion || 0) + 1;

    await tx.syncJob.update({
      where: { id: jobId },
      data: {
        resultJson: JSON.stringify({
          ...meta,
          leaseExpiresAt,
          fencingVersion: nextFencingVersion,
          lastHeartbeatAt: new Date(now).toISOString(),
        }),
      },
    });

    return true;
  };

  if (txClient) {
    return await runner(txClient);
  } else {
    return await prisma.$transaction(runner);
  }
}

/**
 * Explicit research slot release helper.
 * Atomically verifies claim ownership and clears the capacity reservation.
 * Rejects stale, mismatched, empty, or already released claimants with false.
 */
export async function releaseResearchSlot(
  workerId: string,
  jobId: string,
  claimToken: string,
  txClient?: any
): Promise<boolean> {
  // Tasks 081 & 082: Strictly require non-empty claimToken at runtime
  if (!workerId || typeof workerId !== "string" || !workerId.trim()) return false;
  if (!jobId || typeof jobId !== "string" || !jobId.trim()) return false;
  if (!claimToken || typeof claimToken !== "string" || !claimToken.trim()) return false;

  const runner = async (tx: any) => {
    const job = await tx.syncJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "RUNNING") return false;

    let meta: any = {};
    try {
      meta = JSON.parse(job.resultJson || "{}");
    } catch {
      return false;
    }

    // Task 083: Ownership check: workerId and claimToken
    if (meta.workerId !== workerId) return false;
    if (meta.claimToken !== claimToken) return false;

    // Check if lease already expired or slot already released
    if (meta.leaseExpiresAt && new Date(meta.leaseExpiresAt).getTime() < Date.now()) {
      return false;
    }

    // Atomically release the capacity reservation
    const nextFencingVersion = (meta.fencingVersion || 0) + 1;
    await tx.syncJob.update({
      where: { id: jobId },
      data: {
        resultJson: JSON.stringify({
          ...meta,
          leaseExpiresAt: new Date(0).toISOString(), // Expired/freed lease
          releasedAt: new Date().toISOString(),
          fencingVersion: nextFencingVersion,
        }),
      },
    });

    return true;
  };

  if (txClient) {
    return await runner(txClient);
  } else {
    return await prisma.$transaction(runner);
  }
}

/**
 * Recovers any expired research slots.
 */
export async function recoverExpiredResearchSlots(): Promise<number> {
  const rec = await recoverInterruptedKh01Jobs();
  return rec.recoveredCount;
}


/**
 * Cancels an active or pending KH-01 research job safely.
 */
export async function cancelKh01Job(jobId: string, reason: string = "User cancelled"): Promise<boolean> {
  return await prisma.$transaction(async (tx) => {
    const job = await tx.syncJob.findUnique({ where: { id: jobId } });
    if (!job) return false;
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) {
      return false;
    }

    let meta: any = {};
    try {
      meta = JSON.parse(job.resultJson || "{}");
    } catch {
      // ignore
    }

    await tx.syncJob.update({
      where: { id: jobId },
      data: {
        status: "CANCELLED",
        completedAt: new Date(),
        errorMessage: reason,
        resultJson: JSON.stringify({
          ...meta,
          cancellationRequested: true,
          cancelledAt: new Date().toISOString(),
          cancelReason: reason,
        }),
      },
    });

    return true;
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
          resultJson: JSON.stringify({
            workerId,
            activeJobId: jobId,
            timestamp: new Date().toISOString(),
          }),
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
            resultJson: JSON.stringify({
              workerId,
              activeJobId: jobId,
              timestamp: new Date().toISOString(),
            }),
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
 * Strictly enforces global heavy research concurrency limit inside the transaction boundary.
 */
export async function claimPendingKh01Job(workerId: string = WORKER_ID): Promise<ClaimedKh01Job | null> {
  const maxConcurrency = getKh01MaxConcurrency();

  return await prisma.$transaction(async (tx) => {
    // 1. Enforce global research capacity across all workers sharing this database
    const runningJobs = await tx.syncJob.findMany({
      where: {
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "RUNNING",
      },
    });

    const nowMs = Date.now();
    const activeUnexpiredCount = runningJobs.filter((job) => {
      try {
        const meta = JSON.parse(job.resultJson || "{}");
        return meta.leaseExpiresAt && new Date(meta.leaseExpiresAt).getTime() >= nowMs;
      } catch {
        return false;
      }
    }).length;

    if (activeUnexpiredCount >= maxConcurrency) {
      // Global concurrency limit reached. No worker can claim additional heavy jobs.
      return null;
    }

    // 2. Select oldest pending job
    const pending = await tx.syncJob.findFirst({
      where: {
        jobType: "KH01_LANDING_PAGE_RESEARCH",
        status: "PENDING",
      },
      orderBy: { createdAt: "asc" },
    });

    if (!pending) {
      return null;
    }

    // 3. Validate payload before claiming
    let existingPayload: Kh01JobInput;
    try {
      const raw = JSON.parse(pending.resultJson || "{}");
      existingPayload = assertValidJobPayload(raw);
    } catch (err: any) {
      // Malformed input must not be claimed; fail it safely
      await tx.syncJob.update({
        where: { id: pending.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          errorMessage: `Invalid job payload: ${err?.message || "parse error"}`,
        },
      });
      return null;
    }

    // 4. Atomically transition from PENDING to RUNNING with worker claim token & monotonic fencing
    const claimToken = crypto.randomUUID();
    const attemptNumber = (existingPayload.attemptNumber || 0) + 1;
    const fencingVersion = (existingPayload.fencingVersion || 0) + 1;
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + KH01_LEASE_DURATION_MS);

    const updated = await tx.syncJob.update({
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
          fencingVersion,
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
      fencingVersion,
      attemptNumber,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      payload: existingPayload,
    };
  });
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
      errorMessage:
        normalizedStatus === "FAILED"
          ? researchResult.warnings?.join("; ") || "Research job failed."
          : undefined,
    };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);

    // Atomically check lease ownership before writing failure state
    const written = await updateJobIfClaimOwned(job, {
      status: "FAILED",
      errorMessage: errorMsg,
      completedAt: new Date(),
      resultJsonPayload: {
        failedAt: new Date().toISOString(),
        errorMessage: errorMsg,
      },
    });

    if (written) {
      return {
        jobId: job.id,
        status: "FAILED",
        errorMessage: errorMsg,
      };
    } else {
      // Lease was lost, recovered, or usurped by another worker; do NOT overwrite DB!
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
 * Protected by transactional compare-and-swap so concurrent renewals are not overwritten.
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
      // Job is actively running with valid unexpired lease; do not recover
      continue;
    }

    const currentFencingVersion = existingData.fencingVersion || 0;
    const attempt = existingData.attemptNumber || 1;

    // Execute atomic recovery within a transaction to guard against concurrent lease renewals
    await prisma.$transaction(async (tx) => {
      const liveJob = await tx.syncJob.findUnique({ where: { id: job.id } });
      if (!liveJob || liveJob.status !== "RUNNING") return;

      let liveMeta: any = {};
      try {
        liveMeta = JSON.parse(liveJob.resultJson || "{}");
      } catch {
        return;
      }

      // Check if lease was renewed concurrently during recovery scan
      if (
        liveMeta.leaseExpiresAt &&
        new Date(liveMeta.leaseExpiresAt).getTime() >= Date.now()
      ) {
        return;
      }

      // Check if fencing version changed
      if (
        typeof liveMeta.fencingVersion === "number" &&
        liveMeta.fencingVersion !== currentFencingVersion
      ) {
        return;
      }

      const nextFencingVersion = currentFencingVersion + 1;

      // Retry budget: 3 attempts. Attempt counter increments only when claimed, NOT during recovery
      if (attempt < 3) {
        await tx.syncJob.update({
          where: { id: job.id, status: "RUNNING" },
          data: {
            status: "PENDING",
            startedAt: null,
            resultJson: JSON.stringify({
              ...liveMeta,
              attemptNumber: attempt, // Retain attempt number; next claim increments it
              fencingVersion: nextFencingVersion,
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
        await tx.syncJob.update({
          where: { id: job.id, status: "RUNNING" },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            errorMessage: "Job lease expired after maximum retries (3 attempts exhausted).",
            resultJson: JSON.stringify({
              ...liveMeta,
              attemptNumber: attempt,
              fencingVersion: nextFencingVersion,
              failedAt: new Date().toISOString(),
            }),
          },
        });
        abandonedCount++;
      }
    });
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

  console.log(`[KH01 Worker] Started with worker ID ${WORKER_ID}. Concurrency limit = ${getKh01MaxConcurrency()}.`);

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
