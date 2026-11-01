/**
 * SWAI KH-02 V12.4.3.5.1 — Walmart US Marketplace Evidence Persistence, Fencing, Summary & 3-Way Parity
 *
 * Implements:
 * - computeWalmartEvidenceCompositeId(...)
 * - persistWalmartEvidenceAtomically(...)
 * - loadWalmartEvidenceForRun(...)
 * - summarizeWalmartEvidenceForCandidate(...)
 * - attachWalmartEvidenceToResearchRun(...)
 * - reconcileWalmartPersistenceParity(...)
 * - filterWalmartEvidencePointInTime(...)
 *
 * Guarantees:
 * - Strict workspace + run + candidate + itemId composite identity.
 * - Pre-write and in-transaction SyncJob claimToken / fencingToken / fencingGeneration / leaseExpiresAt checks.
 * - Never swallows SQLite transaction failures; surfaces WALMART_EVIDENCE_PERSISTENCE_FAILED.
 * - Preserves prior cached live observation (`observedAt`, `lastSuccessfulLiveQueryAt`) as stale when a new attempt fails (`lastAttemptAt` updated, current status shown honestly).
 * - Never alters KH-02 candidate scores, G07/G15/G16 gates, or Amazon evidence.
 */

import { prisma } from "@/lib/db";
import {
  EvidenceOrigin,
  MarketplacePresence,
  MatchLevel,
  StockState,
  WALMART_NON_INFLATION_NOTICE,
  WalmartEvidenceSummary,
  WalmartPilotPolicy,
  WalmartProductEvidence,
  WalmartProviderTelemetry,
  WalmartQueryExecutionStatus,
  computeWalmartDeterministicHash,
} from "./walmartJinaTypes";
import { resolveWalmartUsPilotPolicy } from "./walmartJinaPolicy";

export const WALMART_EVIDENCE_SUBJECT_TYPE = "WALMART_US_MARKETPLACE";
export const WALMART_EVIDENCE_PILLAR = "MARKETPLACE_PRESENCE";

/**
 * Computes a deterministic, collision-resistant composite ID for a Walmart evidence row.
 * Includes provider, workspaceId, researchRunId, candidateId, normalized itemId, and optional version/postalCode.
 */
export function computeWalmartEvidenceCompositeId(
  workspaceId: string,
  researchRunId: string,
  candidateId: string,
  itemId: string | null | undefined,
  observationVersion: string = "v1"
): string {
  const digest = computeWalmartDeterministicHash({
    provider: "WALMART_US",
    workspaceId: (workspaceId || "").trim(),
    researchRunId: (researchRunId || "").trim(),
    candidateId: (candidateId || "").trim(),
    itemId: (itemId || "NO_ITEM_ID").trim(),
    observationVersion: (observationVersion || "v1").trim(),
  });
  return `wmt_ev_${digest.slice(0, 32)}`;
}

export interface PersistWalmartEvidenceAtomicallyParams {
  workspaceId: string;
  researchRunId: string;
  ownershipJobId?: string | null;
  evidenceRows: WalmartProductEvidence[];
  telemetry: WalmartProviderTelemetry;
  expectedWorkerId?: string | null;
  expectedClaimToken?: string | null;
  expectedFencingToken?: string | null;
  expectedFencingGeneration?: number | null;
  requireActiveJobOwnership?: boolean;
  updateSyncJobSnapshot?: boolean;
  priorCachedEvidenceByCandidate?: Record<string, WalmartProductEvidence>;
  injectTransactionFailureForTest?: boolean;
  db?: any;
}

export interface PersistWalmartEvidenceAtomicallyResult {
  persisted: boolean;
  persistedCount: number;
  fencingRejected: boolean;
  workspaceRejected: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

function mergeFailedAttemptWithPriorCachedEvidence(
  currentRow: WalmartProductEvidence,
  priorRow: WalmartProductEvidence | undefined
): WalmartProductEvidence {
  if (!priorRow) return currentRow;

  const isCurrentFailedOrDegraded =
    currentRow.queryStatus === "TIMED_OUT" ||
    currentRow.queryStatus === "RATE_LIMITED" ||
    currentRow.queryStatus === "BLOCKED_PROVIDER" ||
    currentRow.queryStatus === "PARSE_ERROR" ||
    currentRow.queryStatus === "UNAVAILABLE" ||
    currentRow.queryStatus === "BUDGET_EXHAUSTED" ||
    currentRow.queryStatus === "DEFERRED" ||
    currentRow.queryStatus === "CANCELLED" ||
    currentRow.queryStatus === "FAILED";

  const hasPriorVerifiedData = Boolean(
    priorRow.itemId &&
      priorRow.observedAt &&
      (priorRow.presence === "FOUND" || priorRow.verifiedIdentity)
  );

  if (!isCurrentFailedOrDegraded || !hasPriorVerifiedData) {
    return currentRow;
  }

  // W49: Preserve old observedAt and lastSuccessfulLiveQueryAt, mark as cached+stale,
  // update lastAttemptAt to current attempt, and keep current outcome as UNKNOWN + failed queryStatus!
  return {
    ...priorRow,
    id: currentRow.id,
    workspaceId: currentRow.workspaceId,
    researchRunId: currentRow.researchRunId,
    candidateId: currentRow.candidateId,
    queryStatus: currentRow.queryStatus,
    presence: "UNKNOWN",
    isCached: true,
    isStale: true,
    lastAttemptAt: currentRow.lastAttemptAt,
    observedAt: priorRow.observedAt,
    lastSuccessfulLiveQueryAt:
      priorRow.lastSuccessfulLiveQueryAt ||
      (priorRow.evidenceOrigin === "REAL_JINA_READER" ? priorRow.observedAt : null),
    rejectionReasons: Array.from(
      new Set([
        ...currentRow.rejectionReasons,
        `CURRENT_CHECK_FAILED_SHOWING_STALE_CACHE:${currentRow.queryStatus}`,
      ])
    ),
  };
}

/**
 * Atomically persists Walmart US evidence rows and telemetry for a research run.
 * Enforces SyncJob ownership (workspace, claimToken, fencingToken, fencingGeneration, leaseExpiresAt)
 * both before and inside the SQLite transaction. Surfaces any database write failure without swallowing.
 */
export async function persistWalmartEvidenceAtomically(
  params: PersistWalmartEvidenceAtomicallyParams
): Promise<PersistWalmartEvidenceAtomicallyResult> {
  const db = params.db || prisma;
  const cleanWorkspaceId = (params.workspaceId || "").trim();
  const cleanRunId = (params.researchRunId || "").trim();

  if (!cleanWorkspaceId || !cleanRunId) {
    return {
      persisted: false,
      persistedCount: 0,
      fencingRejected: false,
      workspaceRejected: true,
      errorCode: "MISSING_WORKSPACE_OR_RUN_ID",
      errorMessage:
        "Cannot persist Walmart evidence without non-empty workspaceId and researchRunId.",
    };
  }

  for (const row of params.evidenceRows) {
    if (row.workspaceId !== cleanWorkspaceId || row.researchRunId !== cleanRunId) {
      return {
        persisted: false,
        persistedCount: 0,
        fencingRejected: false,
        workspaceRejected: true,
        errorCode: "CROSS_WORKSPACE_OR_RUN_EVIDENCE_MISMATCH",
        errorMessage: `Walmart evidence row '${row.id}' (workspace='${row.workspaceId}', run='${row.researchRunId}') does not match target (workspace='${cleanWorkspaceId}', run='${cleanRunId}').`,
      };
    }
  }

  const checkJobOwnership = (job: any, now: Date): PersistWalmartEvidenceAtomicallyResult | null => {
    if (!job) {
      return {
        persisted: false,
        persistedCount: 0,
        fencingRejected: true,
        workspaceRejected: false,
        errorCode: "SYNC_JOB_NOT_FOUND",
        errorMessage: `SyncJob '${cleanRunId}' was not found.`,
      };
    }
    if (job.workspaceId && job.workspaceId !== cleanWorkspaceId) {
      return {
        persisted: false,
        persistedCount: 0,
        fencingRejected: false,
        workspaceRejected: true,
        errorCode: "WORKSPACE_ISOLATION_VIOLATION",
        errorMessage: `SyncJob '${cleanRunId}' belongs to workspace '${job.workspaceId}', not '${cleanWorkspaceId}'.`,
      };
    }
    if (
      params.requireActiveJobOwnership ||
      params.expectedWorkerId !== undefined ||
      params.expectedClaimToken !== undefined ||
      params.expectedFencingToken !== undefined ||
      params.expectedFencingGeneration !== undefined
    ) {
      if (
        params.expectedWorkerId !== undefined &&
        params.expectedWorkerId !== null &&
        job.workerId &&
        job.workerId !== params.expectedWorkerId
      ) {
        return {
          persisted: false,
          persistedCount: 0,
          fencingRejected: true,
          workspaceRejected: false,
          errorCode: "STALE_WORKER_ID",
          errorMessage: `Worker ID mismatch on SyncJob '${cleanRunId}'.`,
        };
      }
      if (
        params.expectedClaimToken !== undefined &&
        params.expectedClaimToken !== null &&
        job.claimToken !== params.expectedClaimToken
      ) {
        return {
          persisted: false,
          persistedCount: 0,
          fencingRejected: true,
          workspaceRejected: false,
          errorCode: "STALE_CLAIM_TOKEN",
          errorMessage: `Worker claimToken mismatch on SyncJob '${cleanRunId}'.`,
        };
      }
      if (
        params.expectedFencingToken !== undefined &&
        params.expectedFencingToken !== null &&
        job.fencingToken !== params.expectedFencingToken
      ) {
        return {
          persisted: false,
          persistedCount: 0,
          fencingRejected: true,
          workspaceRejected: false,
          errorCode: "STALE_FENCING_TOKEN",
          errorMessage: `Worker fencingToken mismatch on SyncJob '${cleanRunId}'.`,
        };
      }
      if (
        typeof params.expectedFencingGeneration === "number" &&
        job.fencingGeneration !== params.expectedFencingGeneration
      ) {
        return {
          persisted: false,
          persistedCount: 0,
          fencingRejected: true,
          workspaceRejected: false,
          errorCode: "STALE_FENCING_GENERATION",
          errorMessage: `Worker fencingGeneration (${params.expectedFencingGeneration}) is stale vs DB (${job.fencingGeneration}).`,
        };
      }
      if (params.requireActiveJobOwnership) {
        if (job.status !== "RUNNING" && job.status !== "PROCESSING") {
          return {
            persisted: false,
            persistedCount: 0,
            fencingRejected: true,
            workspaceRejected: false,
            errorCode: "JOB_NOT_RUNNING",
            errorMessage: `SyncJob '${cleanRunId}' status is '${job.status}', expected 'RUNNING'.`,
          };
        }
        if (job.leaseExpiresAt && new Date(job.leaseExpiresAt) <= now) {
          return {
            persisted: false,
            persistedCount: 0,
            fencingRejected: true,
            workspaceRejected: false,
            errorCode: "JOB_LEASE_EXPIRED",
            errorMessage: `SyncJob '${cleanRunId}' lease expired at ${new Date(
              job.leaseExpiresAt
            ).toISOString()}.`,
          };
        }
      }
    }
    return null;
  };

  try {
    const ownershipTargetId = (params.ownershipJobId || cleanRunId).trim();
    const preJob = await db.syncJob.findUnique({ where: { id: ownershipTargetId } });
    const preErr = checkJobOwnership(preJob, new Date());
    if (preErr) return preErr;

    if (ownershipTargetId !== cleanRunId) {
      const parentJob = await db.syncJob.findUnique({ where: { id: cleanRunId } });
      if (!parentJob) {
        return {
          persisted: false,
          persistedCount: 0,
          fencingRejected: false,
          workspaceRejected: false,
          errorCode: "SYNC_JOB_NOT_FOUND",
          errorMessage: `Parent SyncJob '${cleanRunId}' was not found.`,
        };
      }
      if (parentJob.workspaceId && parentJob.workspaceId !== cleanWorkspaceId) {
        return {
          persisted: false,
          persistedCount: 0,
          fencingRejected: false,
          workspaceRejected: true,
          errorCode: "WORKSPACE_ISOLATION_VIOLATION",
          errorMessage: `Parent SyncJob '${cleanRunId}' belongs to workspace '${parentJob.workspaceId}', not '${cleanWorkspaceId}'.`,
        };
      }
    }

    let persistedCount = 0;

    await db.$transaction(async (tx: any) => {
      if (params.injectTransactionFailureForTest) {
        throw new Error(
          "INJECTED_SQLITE_WRITE_FAILURE: Simulated transaction commit failure for fault-injection test."
        );
      }

      const txNow = new Date();
      const txOwnerJob = await tx.syncJob.findUnique({ where: { id: ownershipTargetId } });
      const txErr = checkJobOwnership(txOwnerJob, txNow);
      if (txErr) {
        const fenceError: any = new Error(txErr.errorMessage || "Fencing check failed");
        fenceError.resultPayload = txErr;
        throw fenceError;
      }

      const txJob =
        ownershipTargetId === cleanRunId
          ? txOwnerJob
          : await tx.syncJob.findUnique({ where: { id: cleanRunId } });
      if (!txJob) {
        throw new Error(`Parent SyncJob '${cleanRunId}' was not found inside transaction.`);
      }

      // Check existing ResearchEvidence rows for this workspace+candidate so we don't overwrite stronger cached data on failure
      const existingRows = await tx.researchEvidence.findMany({
        where: {
          workspaceId: cleanWorkspaceId,
          subjectType: WALMART_EVIDENCE_SUBJECT_TYPE,
        },
        orderBy: { observedAt: "desc" },
        take: 50,
      });

      const priorByCand: Record<string, WalmartProductEvidence> = {
        ...(params.priorCachedEvidenceByCandidate || {}),
      };
      for (const r of existingRows) {
        if (!r?.observedValue) continue;
        try {
          const parsedEv = JSON.parse(r.observedValue) as WalmartProductEvidence;
          if (
            parsedEv?.candidateId &&
            parsedEv?.workspaceId === cleanWorkspaceId &&
            parsedEv?.observedAt &&
            !priorByCand[parsedEv.candidateId]
          ) {
            priorByCand[parsedEv.candidateId] = parsedEv;
          }
        } catch {
          // ignore malformed legacy row
        }
      }

      const finalRowsToPersist: WalmartProductEvidence[] = [];

      for (const rawRow of params.evidenceRows) {
        const mergedRow = mergeFailedAttemptWithPriorCachedEvidence(
          rawRow,
          priorByCand[rawRow.candidateId]
        );
        const compositeId = computeWalmartEvidenceCompositeId(
          cleanWorkspaceId,
          cleanRunId,
          mergedRow.candidateId,
          mergedRow.itemId,
          mergedRow.rawEvidenceHash.slice(0, 12)
        );
        const normalizedRow: WalmartProductEvidence = {
          ...mergedRow,
          id: compositeId,
        };
        finalRowsToPersist.push(normalizedRow);

        const claimText = `WALMART_US:${normalizedRow.queryStatus}:${normalizedRow.presence}:${normalizedRow.matchLevel}:${normalizedRow.itemId || "NONE"}`;
        const observedAtDate = normalizedRow.observedAt
          ? new Date(normalizedRow.observedAt)
          : new Date(normalizedRow.lastAttemptAt || Date.now());

        await tx.researchEvidence.upsert({
          where: { id: compositeId },
          create: {
            id: compositeId,
            workspaceId: cleanWorkspaceId,
            subjectType: WALMART_EVIDENCE_SUBJECT_TYPE,
            subjectId: `${cleanRunId}::${normalizedRow.candidateId}`,
            pillar: WALMART_EVIDENCE_PILLAR,
            claim: claimText,
            observedValue: JSON.stringify(normalizedRow),
            sourceUrl: normalizedRow.canonicalProductUrl || normalizedRow.sourceUrl,
            observationMethod: "JINA_READER_REST_NO_KEY",
            classification: normalizedRow.evidenceOrigin,
            sourceContentRef: normalizedRow.rawEvidenceHash,
            observedAt: observedAtDate,
          },
          update: {
            claim: claimText,
            observedValue: JSON.stringify(normalizedRow),
            sourceUrl: normalizedRow.canonicalProductUrl || normalizedRow.sourceUrl,
            classification: normalizedRow.evidenceOrigin,
            sourceContentRef: normalizedRow.rawEvidenceHash,
            observedAt: observedAtDate,
          },
        });
        persistedCount += 1;
      }

      if (params.updateSyncJobSnapshot !== false && txJob.resultJson) {
        let parsedSnap: any = null;
        try {
          parsedSnap = JSON.parse(txJob.resultJson);
        } catch {
          parsedSnap = null;
        }
        if (parsedSnap && typeof parsedSnap === "object") {
          const telemetryPersisted: WalmartProviderTelemetry = {
            ...params.telemetry,
            persistenceStatus: "PERSISTED",
            persistenceError: null,
          };
          parsedSnap.walmartMarketplaceEvidence = finalRowsToPersist;
          parsedSnap.walmartMarketplaceTelemetry = telemetryPersisted;

          const attachSummaryToList = (list: any[]) => {
            if (!Array.isArray(list)) return;
            for (const item of list) {
              const cand = item?.candidate || item;
              if (cand && typeof cand.candidateId === "string") {
                cand.walmartEvidenceSummary = summarizeWalmartEvidenceForCandidate(
                  cand.candidateId,
                  cleanRunId,
                  finalRowsToPersist,
                  { telemetry: telemetryPersisted }
                );
              }
            }
          };

          attachSummaryToList(parsedSnap.topThree);
          attachSummaryToList(parsedSnap.provisionalCandidates);
          attachSummaryToList(parsedSnap.remainingCandidates);
          attachSummaryToList(parsedSnap.insufficientEvidenceCandidates);
          if (Array.isArray(parsedSnap.researchShortlist?.shortlist)) {
            attachSummaryToList(parsedSnap.researchShortlist.shortlist);
          }

          await tx.syncJob.update({
            where: { id: cleanRunId },
            data: {
              resultJson: JSON.stringify(parsedSnap),
            },
          });
        }
      }
    });

    return {
      persisted: true,
      persistedCount,
      fencingRejected: false,
      workspaceRejected: false,
      errorCode: null,
      errorMessage: null,
    };
  } catch (err: any) {
    if (err?.resultPayload) {
      return err.resultPayload as PersistWalmartEvidenceAtomicallyResult;
    }
    return {
      persisted: false,
      persistedCount: 0,
      fencingRejected: false,
      workspaceRejected: false,
      errorCode: "WALMART_EVIDENCE_PERSISTENCE_FAILED",
      errorMessage:
        err instanceof Error
          ? err.message
          : `Failed to persist Walmart evidence: ${String(err)}`,
    };
  }
}

export interface LoadedWalmartEvidenceForRun {
  workspaceId: string;
  researchRunId: string;
  source: "RESEARCH_EVIDENCE_TABLE" | "SYNC_JOB_SNAPSHOT" | "NONE";
  evidenceRows: WalmartProductEvidence[];
  telemetry: WalmartProviderTelemetry | null;
}

/**
 * Read-only loader for persisted Walmart evidence and telemetry for a specific `(workspaceId, researchRunId)`.
 * Never mutates the database and strictly enforces workspace isolation.
 */
export async function loadWalmartEvidenceForRun(
  workspaceId: string,
  researchRunId: string,
  db: any = prisma
): Promise<LoadedWalmartEvidenceForRun> {
  const cleanWorkspaceId = (workspaceId || "").trim();
  const cleanRunId = (researchRunId || "").trim();

  if (!cleanWorkspaceId || !cleanRunId) {
    return {
      workspaceId: cleanWorkspaceId,
      researchRunId: cleanRunId,
      source: "NONE",
      evidenceRows: [],
      telemetry: null,
    };
  }

  const job = await db.syncJob.findUnique({
    where: { id: cleanRunId },
    select: {
      id: true,
      workspaceId: true,
      resultJson: true,
    },
  });

  if (!job || (job.workspaceId && job.workspaceId !== cleanWorkspaceId)) {
    return {
      workspaceId: cleanWorkspaceId,
      researchRunId: cleanRunId,
      source: "NONE",
      evidenceRows: [],
      telemetry: null,
    };
  }

  const rawRows = await db.researchEvidence.findMany({
    where: {
      workspaceId: cleanWorkspaceId,
      subjectType: WALMART_EVIDENCE_SUBJECT_TYPE,
      subjectId: { startsWith: `${cleanRunId}::` },
    },
    orderBy: [{ observedAt: "desc" }, { id: "asc" }],
  });

  const byId = new Map<string, WalmartProductEvidence>();
  for (const r of rawRows) {
    if (!r?.observedValue) continue;
    try {
      const parsed = JSON.parse(r.observedValue) as WalmartProductEvidence;
      if (
        parsed &&
        parsed.provider === "WALMART_US" &&
        parsed.workspaceId === cleanWorkspaceId &&
        parsed.researchRunId === cleanRunId
      ) {
        byId.set(parsed.id, parsed);
      }
    } catch {
      // ignore malformed row
    }
  }

  const loadedFromTable = byId.size > 0;

  let telemetry: WalmartProviderTelemetry | null = null;
  if (job.resultJson) {
    try {
      const parsedSnap = JSON.parse(job.resultJson);
      if (
        parsedSnap?.walmartMarketplaceTelemetry &&
        parsedSnap.walmartMarketplaceTelemetry.workspaceId === cleanWorkspaceId
      ) {
        telemetry = parsedSnap.walmartMarketplaceTelemetry;
      }
      if (
        byId.size === 0 &&
        Array.isArray(parsedSnap?.walmartMarketplaceEvidence)
      ) {
        for (const ev of parsedSnap.walmartMarketplaceEvidence) {
          if (
            ev &&
            ev.provider === "WALMART_US" &&
            ev.workspaceId === cleanWorkspaceId &&
            ev.researchRunId === cleanRunId
          ) {
            byId.set(ev.id, ev);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const source: "RESEARCH_EVIDENCE_TABLE" | "SYNC_JOB_SNAPSHOT" | "NONE" =
    loadedFromTable
      ? "RESEARCH_EVIDENCE_TABLE"
      : byId.size > 0
      ? "SYNC_JOB_SNAPSHOT"
      : "NONE";

  return {
    workspaceId: cleanWorkspaceId,
    researchRunId: cleanRunId,
    source,
    evidenceRows: Array.from(byId.values()),
    telemetry,
  };
}

export function formatWalmartPriceDisplay(
  price: number | null | undefined,
  currency: string | null | undefined
): string {
  if (
    typeof price === "number" &&
    Number.isFinite(price) &&
    price > 0 &&
    typeof currency === "string" &&
    /^[A-Z]{3}$/.test(currency.trim())
  ) {
    const code = currency.trim().toUpperCase();
    if (code === "USD") {
      return `$${price.toFixed(2)} USD`;
    }
    return `${price.toFixed(2)} ${code}`;
  }
  return "Not verified";
}

export function formatWalmartLocationDisplay(
  postalCode: string | null | undefined,
  storeIds: string[] | null | undefined
): string | null {
  const parts: string[] = [];
  if (postalCode && postalCode.trim()) {
    parts.push(`ZIP ${postalCode.trim()}`);
  }
  if (Array.isArray(storeIds) && storeIds.length > 0) {
    parts.push(`Store #${storeIds.join(", #")}`);
  }
  if (parts.length === 0) return null;
  return `${parts.join(" · ")} (Observed store scope)`;
}

function buildStatusReasonForSummary(
  row: WalmartProductEvidence | null,
  telemetry?: WalmartProviderTelemetry | null,
  policy?: WalmartPilotPolicy
): string {
  if (row) {
    if (row.isStale && row.isCached) {
      return `Current check ${row.queryStatus}; showing cached Walmart observation from ${
        row.observedAt || "prior run"
      }.`;
    }
    if (row.queryStatus === "SUCCEEDED") {
      if (row.presence === "NO_MATCH_IN_SCOPE") {
        return `Scoped Walmart US search completed for '${
          row.queryScope.query || "candidate"
        }'; no matching listing in checked search scope (not a global absence claim).`;
      }
      if (row.presence === "FOUND") {
        return `Walmart US listing observed (${row.matchLevel} match, stock: ${row.availability}).`;
      }
    }
    if (row.queryStatus === "BLOCKED_PROVIDER") {
      return "Walmart / Jina Reader returned anti-bot verification or HTTP 403 block; listing presence is UNKNOWN.";
    }
    if (row.queryStatus === "TIMED_OUT") {
      return "Walmart Jina Reader request timed out and was aborted; listing presence is UNKNOWN.";
    }
    if (row.queryStatus === "RATE_LIMITED") {
      return "Walmart Jina Reader rate limit (HTTP 429) or cooldown active; listing presence is UNKNOWN.";
    }
    if (row.queryStatus === "PARSE_ERROR") {
      return "Walmart response failed JSON/__NEXT_DATA__ schema validation; listing presence is UNKNOWN.";
    }
    if (row.queryStatus === "BUDGET_EXHAUSTED" || row.queryStatus === "DEFERRED") {
      return `Walmart pilot cap reached (${row.queryStatus}); candidate check deferred.`;
    }
    if (row.queryStatus === "KEY_OR_PAYMENT_REQUIRED") {
      return "Jina Reader free mode restricted (401/402); stopped free pilot without requesting API keys.";
    }
    if (row.rejectionReasons.length > 0) {
      return row.rejectionReasons.join("; ");
    }
  }
  if (telemetry) {
    return telemetry.statusReason;
  }
  const resolvedPolicy = policy || resolveWalmartUsPilotPolicy();
  return resolvedPolicy.reason;
}

/**
 * Summarizes persisted Walmart evidence for a specific candidate.
 * Keeps `queryStatus`, `presence`, `matchLevel`, and `availability` distinct,
 * and formats nullable price/currency and observed location truthfully.
 */
export function summarizeWalmartEvidenceForCandidate(
  candidateId: string,
  researchRunId: string,
  evidenceRows: WalmartProductEvidence[],
  options: {
    telemetry?: WalmartProviderTelemetry | null;
    policy?: WalmartPilotPolicy;
  } = {}
): WalmartEvidenceSummary {
  const candidateRows = (evidenceRows || []).filter(
    (r) => r && r.candidateId === candidateId && r.researchRunId === researchRunId
  );

  // Rank rows: EXACT > SIMILAR > UNCERTAIN > NO_MATCH_IN_SCOPE > failed/degraded
  const rankRow = (r: WalmartProductEvidence): number => {
    let score = 0;
    if (r.presence === "FOUND") score += 100;
    if (r.matchLevel === "EXACT") score += 50;
    else if (r.matchLevel === "SIMILAR") score += 25;
    if (r.queryStatus === "SUCCEEDED") score += 20;
    if (!r.isStale) score += 10;
    return score;
  };

  candidateRows.sort((a, b) => rankRow(b) - rankRow(a));
  const primary = candidateRows[0] || null;
  const telemetry = options.telemetry || null;
  const policy = options.policy || resolveWalmartUsPilotPolicy();

  if (!primary) {
    const fallbackStatus: WalmartQueryExecutionStatus = telemetry
      ? telemetry.overallStatus
      : policy.status;
    return {
      visible: Boolean(telemetry || policy.featureEnabled),
      provider: "WALMART_US",
      candidateId,
      researchRunId,
      queryStatus: fallbackStatus,
      presence: "UNKNOWN",
      matchLevel: "UNCERTAIN",
      verifiedIdentity: false,
      itemId: null,
      canonicalWalmartUrl: null,
      title: null,
      brand: null,
      model: null,
      upc: null,
      price: null,
      currency: null,
      priceDisplay: "Not verified",
      seller: null,
      locationPostalCode: null,
      locationStoreIds: [],
      locationDisplay: null,
      availability: "UNKNOWN",
      evidenceOrigin: "REAL_JINA_READER",
      isCached: false,
      isStale: false,
      observedAt: null,
      lastAttemptAt: telemetry?.lastAttemptAt || null,
      lastSuccessfulLiveQueryAt: telemetry?.lastSuccessfulLiveQueryAt || null,
      rawEvidenceHash: null,
      statusReason: buildStatusReasonForSummary(null, telemetry, policy),
      matchReasons: [],
      rejectionReasons: [],
      missingFields: [],
      appearanceProvenance: [],
      queryScope: {
        query: null,
        normalizedQuery: null,
        market: "US",
        checkedSearchCount: 0,
        checkedPdpCount: 0,
        rawSearchResultCount: null,
        dedupedSearchResultCount: null,
        completeSearchScope: false,
      },
      nonInflationNotice: WALMART_NON_INFLATION_NOTICE,
    };
  }

  return {
    visible: true,
    provider: "WALMART_US",
    candidateId,
    researchRunId,
    queryStatus: primary.queryStatus,
    presence: primary.presence,
    matchLevel: primary.matchLevel,
    verifiedIdentity: primary.verifiedIdentity,
    itemId: primary.itemId,
    canonicalWalmartUrl: primary.canonicalProductUrl,
    title: primary.title,
    brand: primary.brand,
    model: primary.model,
    upc: primary.upc,
    price: primary.price,
    currency: primary.currency,
    priceDisplay: formatWalmartPriceDisplay(primary.price, primary.currency),
    seller: primary.seller,
    locationPostalCode: primary.locationPostalCode,
    locationStoreIds: primary.locationStoreIds || [],
    locationDisplay: formatWalmartLocationDisplay(
      primary.locationPostalCode,
      primary.locationStoreIds
    ),
    availability: primary.availability,
    evidenceOrigin: primary.evidenceOrigin,
    isCached: primary.isCached,
    isStale: primary.isStale,
    observedAt: primary.observedAt,
    lastAttemptAt: primary.lastAttemptAt,
    lastSuccessfulLiveQueryAt: primary.lastSuccessfulLiveQueryAt,
    rawEvidenceHash: primary.rawEvidenceHash,
    statusReason: buildStatusReasonForSummary(primary, telemetry, policy),
    matchReasons: primary.matchReasons || [],
    rejectionReasons: primary.rejectionReasons || [],
    missingFields: primary.missingFields || [],
    appearanceProvenance: primary.appearanceProvenance || [],
    queryScope: primary.queryScope,
    nonInflationNotice: WALMART_NON_INFLATION_NOTICE,
  };
}

/**
 * Attaches Walmart evidence and telemetry to an existing completed research run
 * without modifying candidate opportunity scores, G07/G15/G16 gates, or Amazon evidence.
 */
export async function attachWalmartEvidenceToResearchRun(params: {
  workspaceId: string;
  researchRunId: string;
  verifyJobId?: string | null;
  evidenceRows: WalmartProductEvidence[];
  telemetry: WalmartProviderTelemetry;
  expectedWorkerId?: string | null;
  expectedClaimToken?: string | null;
  expectedFencingToken?: string | null;
  expectedFencingGeneration?: number | null;
  requireActiveJobOwnership?: boolean;
  injectTransactionFailureForTest?: boolean;
  db?: any;
}): Promise<PersistWalmartEvidenceAtomicallyResult> {
  return persistWalmartEvidenceAtomically({
    workspaceId: params.workspaceId,
    researchRunId: params.researchRunId,
    ownershipJobId: params.verifyJobId || null,
    evidenceRows: params.evidenceRows,
    telemetry: params.telemetry,
    expectedWorkerId: params.expectedWorkerId,
    expectedClaimToken: params.expectedClaimToken,
    expectedFencingToken: params.expectedFencingToken,
    expectedFencingGeneration: params.expectedFencingGeneration,
    requireActiveJobOwnership: Boolean(params.requireActiveJobOwnership),
    injectTransactionFailureForTest: Boolean(params.injectTransactionFailureForTest),
    updateSyncJobSnapshot: true,
    db: params.db,
  });
}

export interface WalmartDomCardSnapshot {
  candidateId: string;
  runId: string;
  queryStatus: string;
  presence: string;
  matchLevel: string;
  itemId: string;
  canonicalWalmartUrl: string;
  upc: string;
  priceDisplay: string;
  seller: string;
  locationPostalCode: string;
  availability: string;
  observedAt: string;
  evidenceOrigin: string;
}

export interface WalmartThreeWayParityResult {
  parityPassed: boolean;
  workspaceId: string;
  researchRunId: string;
  checkedCandidatesCount: number;
  mismatches: string[];
}

/**
 * Independently reconciles SQLite DB evidence rows against the HTTP GET API response
 * and the rendered Chromium DOM attributes (before and after page reload).
 */
export function reconcileWalmartPersistenceParity(params: {
  workspaceId: string;
  researchRunId: string;
  dbEvidenceRows: WalmartProductEvidence[];
  apiCandidateSummaries: WalmartEvidenceSummary[];
  domCardsBeforeReload: WalmartDomCardSnapshot[];
  domCardsAfterReload: WalmartDomCardSnapshot[];
}): WalmartThreeWayParityResult {
  const mismatches: string[] = [];
  const apiByCandidate = new Map<string, WalmartEvidenceSummary>();
  for (const s of params.apiCandidateSummaries) {
    apiByCandidate.set(s.candidateId, s);
  }

  const domBeforeByCand = new Map<string, WalmartDomCardSnapshot>();
  for (const d of params.domCardsBeforeReload) {
    domBeforeByCand.set(d.candidateId, d);
  }

  const domAfterByCand = new Map<string, WalmartDomCardSnapshot>();
  for (const d of params.domCardsAfterReload) {
    domAfterByCand.set(d.candidateId, d);
  }

  const candidateIds = Array.from(
    new Set([
      ...params.dbEvidenceRows.map((r) => r.candidateId),
      ...params.apiCandidateSummaries.map((s) => s.candidateId),
    ])
  );

  for (const cid of candidateIds) {
    const dbSummary = summarizeWalmartEvidenceForCandidate(
      cid,
      params.researchRunId,
      params.dbEvidenceRows
    );
    const apiSummary = apiByCandidate.get(cid);
    if (!apiSummary) {
      mismatches.push(`MISSING_API_SUMMARY:candidate=${cid}`);
      continue;
    }

    // 1. DB vs API check
    const fieldsToCompare: Array<keyof WalmartEvidenceSummary> = [
      "queryStatus",
      "presence",
      "matchLevel",
      "itemId",
      "canonicalWalmartUrl",
      "upc",
      "priceDisplay",
      "seller",
      "locationPostalCode",
      "availability",
      "observedAt",
      "evidenceOrigin",
    ];
    for (const f of fieldsToCompare) {
      const dbVal = String(dbSummary[f] ?? "");
      const apiVal = String(apiSummary[f] ?? "");
      if (dbVal !== apiVal) {
        mismatches.push(
          `DB_VS_API_MISMATCH:candidate=${cid},field=${String(
            f
          )},db='${dbVal}',api='${apiVal}'`
        );
      }
    }

    // 2. API vs DOM before reload
    const domBefore = domBeforeByCand.get(cid);
    if (!domBefore) {
      mismatches.push(`MISSING_DOM_BEFORE_RELOAD:candidate=${cid}`);
    } else {
      for (const f of [
        "queryStatus",
        "presence",
        "matchLevel",
        "itemId",
        "canonicalWalmartUrl",
        "upc",
        "priceDisplay",
        "locationPostalCode",
        "availability",
        "observedAt",
        "evidenceOrigin",
      ] as const) {
        const expected = String((apiSummary as any)[f] ?? "");
        const actual = String((domBefore as any)[f] ?? "");
        if (expected !== actual) {
          mismatches.push(
            `API_VS_DOM_BEFORE_RELOAD_MISMATCH:candidate=${cid},field=${f},api='${expected}',dom='${actual}'`
          );
        }
      }
    }

    // 3. DOM before reload vs DOM after reload
    const domAfter = domAfterByCand.get(cid);
    if (!domAfter) {
      mismatches.push(`MISSING_DOM_AFTER_RELOAD:candidate=${cid}`);
    } else if (domBefore) {
      for (const f of [
        "queryStatus",
        "presence",
        "matchLevel",
        "itemId",
        "canonicalWalmartUrl",
        "upc",
        "priceDisplay",
        "locationPostalCode",
        "availability",
        "observedAt",
        "evidenceOrigin",
      ] as const) {
        const bVal = String((domBefore as any)[f] ?? "");
        const aVal = String((domAfter as any)[f] ?? "");
        if (bVal !== aVal) {
          mismatches.push(
            `DOM_RELOAD_DRIFT:candidate=${cid},field=${f},before='${bVal}',after='${aVal}'`
          );
        }
      }
    }
  }

  return {
    parityPassed: mismatches.length === 0 && candidateIds.length > 0,
    workspaceId: params.workspaceId,
    researchRunId: params.researchRunId,
    checkedCandidatesCount: candidateIds.length,
    mismatches,
  };
}

export interface PointInTimeWalmartFilterResult {
  asOfCutoffIso: string;
  eligibleRecords: WalmartProductEvidence[];
  retainedRows: WalmartProductEvidence[];
  excludedPostCutoffRecords: WalmartProductEvidence[];
  excludedFixtureRecords: WalmartProductEvidence[];
  excludedMissingTimestampRecords: WalmartProductEvidence[];
  futureLeaksRejectedCount: number;
  missingTimestampRejectedCount: number;
  fixtureRecordsRejectedCount: number;
  zeroLeakCount: boolean;
}

/**
 * Enforces point-in-time historical cutoff for DEV/HOLDOUT backtests (W54, W55).
 * Excludes any Walmart observation with `observedAt > asOf` or `evidenceOrigin === "TEST_FIXTURE"`,
 * preventing 2026-11-01 observations from leaking into earlier historical cutoffs.
 */
export function filterWalmartEvidencePointInTime(
  records: WalmartProductEvidence[],
  asOfCutoff: string | Date
): PointInTimeWalmartFilterResult {
  const cutoffMs = new Date(asOfCutoff).getTime();
  const asOfCutoffIso = new Date(cutoffMs).toISOString();

  const eligibleRecords: WalmartProductEvidence[] = [];
  const excludedPostCutoffRecords: WalmartProductEvidence[] = [];
  const excludedFixtureRecords: WalmartProductEvidence[] = [];
  const excludedMissingTimestampRecords: WalmartProductEvidence[] = [];

  for (const rec of records || []) {
    if (!rec) continue;
    if (rec.evidenceOrigin === "TEST_FIXTURE") {
      excludedFixtureRecords.push(rec);
      continue;
    }
    const tsStr = rec.observedAt || rec.lastAttemptAt;
    if (!tsStr) {
      excludedMissingTimestampRecords.push(rec);
      continue;
    }
    const tsMs = new Date(tsStr).getTime();
    if (!Number.isFinite(tsMs)) {
      excludedMissingTimestampRecords.push(rec);
      continue;
    }
    if (tsMs > cutoffMs) {
      excludedPostCutoffRecords.push(rec);
      continue;
    }
    eligibleRecords.push(rec);
  }

  return {
    asOfCutoffIso,
    eligibleRecords,
    retainedRows: eligibleRecords,
    excludedPostCutoffRecords,
    excludedFixtureRecords,
    excludedMissingTimestampRecords,
    futureLeaksRejectedCount: excludedPostCutoffRecords.length,
    missingTimestampRejectedCount: excludedMissingTimestampRecords.length,
    fixtureRecordsRejectedCount: excludedFixtureRecords.length,
    zeroLeakCount: eligibleRecords.every((r) => {
      const ts = new Date(r.observedAt || r.lastAttemptAt || "").getTime();
      return (
        r.evidenceOrigin !== "TEST_FIXTURE" &&
        Number.isFinite(ts) &&
        ts <= cutoffMs
      );
    }),
  };
}
