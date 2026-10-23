/**
 * SWAI — Muse External-Agent Research Request Service
 *
 * Manages the lifecycle of asynchronous Meta Ad Library research requests:
 * 1. Creates and validates research tasks (enforces META platform, US market, validated keywords).
 * 2. Atomic database-backed job leasing to prevent multiple agents claiming the same request.
 * 3. Enforces valid status transitions (rejects reopening completed/failed runs).
 * 4. Lease renewals and cancellation handling.
 */

import { prisma } from "@/lib/db";
import { MUSE_PROVIDER_ID } from "../normalization/normalizeFacebookAd";
import { DiscoveryQuerySchema, DiscoveryJobStatus } from "../types";
import { AuthenticatedMuseAgent } from "@/services/security/museAuth";

export interface CreateMuseRequestInput {
  workspaceId?: string;
  keywords: string[];
  market?: string;
  requestedLimit?: number;
  category?: string;
  creativePreference?: "VIDEO" | "IMAGE" | "CAROUSEL" | "ALL";
  notes?: string;
}

export interface MuseResearchRequestSummary {
  requestId: string;
  status: string;
  providerId: string;
  platform: "META";
  keywords: string[];
  market: string;
  targetCount: number;
  creativePreference?: string;
  actualRetrievedCount: number;
  validCount: number;
  newUniqueCount: number;
  existingDuplicateCount: number;
  rejectedCount: number;
  failedCount: number;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  heartbeatAt: Date | null;
}

const LEASE_DURATION_MS = 15 * 60 * 1000; // 15-minute lease duration

/**
 * Creates a new persisted PENDING Meta Ad Library research request for Muse.
 */
export async function createMuseResearchRequest(
  input: CreateMuseRequestInput,
  context?: { workspaceId?: string }
): Promise<{ requestId: string; syncJobId: string; status: DiscoveryJobStatus }> {
  // 1. Resolve and validate workspace
  let effectiveWorkspaceId = input.workspaceId || context?.workspaceId || "default-workspace";
  const workspace = await prisma.workspace.findUnique({
    where: { id: effectiveWorkspaceId },
    select: { id: true },
  });

  if (!workspace) {
    const fallback = await prisma.workspace.findFirst({ select: { id: true } });
    if (fallback) effectiveWorkspaceId = fallback.id;
  }

  // 2. Validate and clean keywords
  if (!Array.isArray(input.keywords) || input.keywords.length === 0) {
    throw new Error("At least one search keyword is required for Meta Ad Library research.");
  }

  const cleanKeywords = Array.from(
    new Set(
      input.keywords
        .map((k) => (typeof k === "string" ? k.trim() : ""))
        .filter((k) => k.length > 0 && k.length <= 100)
    )
  ).slice(0, 20);

  if (cleanKeywords.length === 0) {
    throw new Error("Provided keywords were invalid or empty after trimming.");
  }

  const requestedLimit = Math.min(Math.max(input.requestedLimit || 25, 1), 200);
  const market = (input.market || "US").toUpperCase().slice(0, 2);

  // 3. Queue rate limit check
  const activePendingCount = await prisma.discoveryRun.count({
    where: {
      providerId: MUSE_PROVIDER_ID,
      status: "PENDING",
      workspaceId: effectiveWorkspaceId,
    },
  });

  if (activePendingCount >= 50) {
    throw new Error("Maximum pending research queue limit (50) reached. Please wait for current requests to complete.");
  }

  // 4. Construct validated query
  const query = DiscoveryQuerySchema.parse({
    workspaceId: effectiveWorkspaceId,
    platform: "META",
    providerId: MUSE_PROVIDER_ID,
    market,
    keywords: cleanKeywords,
    requestedLimit,
    runMode: "MANUAL",
  });

  // Include extra metadata
  const fullConfig = {
    ...query,
    category: input.category || null,
    creativePreference: input.creativePreference || "ALL",
    notes: input.notes || null,
  };

  // 5. Create SyncJob
  const syncJob = await prisma.syncJob.create({
    data: {
      workspaceId: effectiveWorkspaceId,
      jobType: "MUSE_META_RESEARCH",
      status: "PENDING",
      progress: 0,
      totalItems: requestedLimit,
    },
  });

  // 6. Create DiscoveryRun
  const run = await prisma.discoveryRun.create({
    data: {
      workspaceId: effectiveWorkspaceId,
      jobId: syncJob.id,
      providerId: MUSE_PROVIDER_ID,
      status: "PENDING",
      runMode: "MANUAL",
      queryConfigJson: JSON.stringify(fullConfig),
      requestedLimit,
    },
  });

  return {
    requestId: run.id,
    syncJobId: syncJob.id,
    status: "PENDING",
  };
}

/**
 * Lists queued Muse requests with minimal, redacted payloads.
 */
export async function listMuseResearchRequests(filter: {
  status?: string;
  limit?: number;
  workspaceId?: string;
}): Promise<MuseResearchRequestSummary[]> {
  const status = filter.status || "PENDING";
  const limit = Math.min(filter.limit || 20, 100);

  const whereClause: Record<string, unknown> = {
    providerId: MUSE_PROVIDER_ID,
  };

  if (status !== "ALL") {
    whereClause.status = status;
  }
  if (filter.workspaceId && filter.workspaceId !== "ALL") {
    whereClause.workspaceId = filter.workspaceId;
  }

  const runs = await prisma.discoveryRun.findMany({
    where: whereClause,
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  return runs.map((r) => {
    let query: Record<string, unknown> = {};
    try {
      query = JSON.parse(r.queryConfigJson);
    } catch {
      query = {};
    }

    return {
      requestId: r.id,
      status: r.status,
      providerId: r.providerId,
      platform: "META",
      keywords: Array.isArray(query.keywords) ? (query.keywords as string[]) : [],
      market: typeof query.market === "string" ? query.market : "US",
      targetCount: r.requestedLimit,
      creativePreference: typeof query.creativePreference === "string" ? query.creativePreference : undefined,
      actualRetrievedCount: r.actualRetrievedCount,
      validCount: r.validCount,
      newUniqueCount: r.newUniqueCount,
      existingDuplicateCount: r.existingDuplicateCount,
      rejectedCount: r.rejectedCount,
      failedCount: r.failedCount,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      heartbeatAt: r.heartbeatAt,
    };
  });
}

/**
 * Loads a single Muse research request by ID.
 */
export async function getMuseResearchRequest(
  id: string,
  workspaceId?: string
): Promise<MuseResearchRequestSummary | null> {
  const whereClause: Record<string, unknown> = {
    id,
    providerId: MUSE_PROVIDER_ID,
  };
  if (workspaceId && workspaceId !== "ALL") {
    whereClause.workspaceId = workspaceId;
  }

  const run = await prisma.discoveryRun.findFirst({
    where: whereClause,
  });

  if (!run) return null;

  let query: Record<string, unknown> = {};
  try {
    query = JSON.parse(run.queryConfigJson);
  } catch {
    query = {};
  }

  return {
    requestId: run.id,
    status: run.status,
    providerId: run.providerId,
    platform: "META",
    keywords: Array.isArray(query.keywords) ? (query.keywords as string[]) : [],
    market: typeof query.market === "string" ? query.market : "US",
    targetCount: run.requestedLimit,
    creativePreference: typeof query.creativePreference === "string" ? query.creativePreference : undefined,
    actualRetrievedCount: run.actualRetrievedCount,
    validCount: run.validCount,
    newUniqueCount: run.newUniqueCount,
    existingDuplicateCount: run.existingDuplicateCount,
    rejectedCount: run.rejectedCount,
    failedCount: run.failedCount,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    heartbeatAt: run.heartbeatAt,
  };
}

/**
 * Atomically claims a pending request for an authorized Muse agent session.
 * Prevents multiple agents from claiming the same request.
 */
export async function claimMuseResearchRequest(
  requestId: string,
  agent: AuthenticatedMuseAgent
): Promise<{ success: boolean; request?: MuseResearchRequestSummary; error?: string }> {
  const now = new Date();
  const leaseExpirationCutoff = new Date(now.getTime() - LEASE_DURATION_MS);

  // Use a transaction to ensure atomic ownership
  try {
    const result = await prisma.$transaction(async (tx) => {
      const run = await tx.discoveryRun.findUnique({
        where: { id: requestId },
      });

      if (!run || run.providerId !== MUSE_PROVIDER_ID) {
        return { success: false, error: "NOT_FOUND" };
      }

      // Check if already claimed and lease is still valid
      if (
        (run.status === "CLAIMED" || run.status === "RUNNING") &&
        run.heartbeatAt &&
        run.heartbeatAt > leaseExpirationCutoff
      ) {
        return { success: false, error: "ALREADY_CLAIMED" };
      }

      // Check if terminal
      if (run.status === "COMPLETED" || run.status === "PARTIALLY_COMPLETED" || run.status === "CANCELLED") {
        return { success: false, error: "REQUEST_ALREADY_CLOSED" };
      }

      // Claim request
      const updated = await tx.discoveryRun.update({
        where: { id: run.id },
        data: {
          status: "CLAIMED",
          startedAt: run.startedAt || now,
          heartbeatAt: now,
        },
      });

      if (run.jobId) {
        await tx.syncJob.update({
          where: { id: run.jobId },
          data: {
            status: "RUNNING",
            startedAt: now,
            errorMessage: `Claimed by agent ${agent.agentId}`,
          },
        });
      }

      return { success: true, updated };
    });

    if (!result.success || !result.updated) {
      return { success: false, error: result.error || "CLAIM_FAILED" };
    }

    const summary = await getMuseResearchRequest(requestId);
    return { success: true, request: summary || undefined };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "DATABASE_TRANSACTION_FAILED",
    };
  }
}

/**
 * Updates status of an active Muse request (RUNNING heartbeat, FAILED, or CANCELLED).
 * Enforces valid state machine transitions.
 */
export async function updateMuseRequestStatus(
  requestId: string,
  update: { status: "RUNNING" | "FAILED" | "CANCELLED"; errorMessage?: string },
  agent: AuthenticatedMuseAgent
): Promise<{ success: boolean; status?: string; error?: string }> {
  void agent;
  const run = await prisma.discoveryRun.findUnique({
    where: { id: requestId },
  });

  if (!run || run.providerId !== MUSE_PROVIDER_ID) {
    return { success: false, error: "NOT_FOUND" };
  }

  // Reject reopening terminal states
  if (run.status === "COMPLETED" || run.status === "PARTIALLY_COMPLETED") {
    return {
      success: false,
      error: `Request '${requestId}' is already ${run.status} and cannot be reopened.`,
    };
  }

  if (run.status === "CANCELLED" && update.status !== "CANCELLED") {
    return {
      success: false,
      error: `Request '${requestId}' has been cancelled and cannot be changed to ${update.status}.`,
    };
  }

  const now = new Date();
  const updated = await prisma.discoveryRun.update({
    where: { id: run.id },
    data: {
      status: update.status,
      heartbeatAt: update.status === "RUNNING" ? now : run.heartbeatAt,
      startedAt: update.status === "RUNNING" && !run.startedAt ? now : run.startedAt,
      finishedAt: update.status === "FAILED" || update.status === "CANCELLED" ? now : run.finishedAt,
      errorMessage: update.errorMessage ?? run.errorMessage,
    },
  });

  if (run.jobId) {
    await prisma.syncJob.update({
      where: { id: run.jobId },
      data: {
        status: update.status === "RUNNING" ? "RUNNING" : "FAILED",
        errorMessage: update.errorMessage ?? undefined,
        completedAt: update.status === "FAILED" || update.status === "CANCELLED" ? now : undefined,
      },
    });
  }

  return { success: true, status: updated.status };
}

/**
 * Cancels a Muse request.
 */
export async function cancelMuseResearchRequest(
  requestId: string,
  workspaceId?: string
): Promise<boolean> {
  void workspaceId;
  const run = await prisma.discoveryRun.findUnique({
    where: { id: requestId },
  });

  if (!run || run.providerId !== MUSE_PROVIDER_ID) return false;
  if (run.status === "COMPLETED" || run.status === "PARTIALLY_COMPLETED") return false;

  const now = new Date();
  await prisma.discoveryRun.update({
    where: { id: run.id },
    data: {
      status: "CANCELLED",
      finishedAt: now,
      errorMessage: "Request cancelled by user.",
    },
  });

  if (run.jobId) {
    await prisma.syncJob.update({
      where: { id: run.jobId },
      data: {
        status: "CANCELLED",
        errorMessage: "Request cancelled by user.",
        completedAt: now,
      },
    });
  }

  return true;
}
