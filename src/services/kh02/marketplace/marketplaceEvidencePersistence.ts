/**
 * SWAI KH-02 V12.4.3.5.0 — Marketplace Product Evidence Persistence & Read-Only Loader
 *
 * Implements:
 * - persistAmazonEvidenceAtomically(workspaceId, runId, evidenceRows, options)
 * - loadAmazonEvidenceForRun(workspaceId, runId, db)
 * - summarizeAmazonEvidenceForProduct(candidateId, runId, evidenceRows, options)
 *
 * Enforces:
 * - Unique composite key idempotency: (workspaceId, runId, candidateId, provider, asin)
 * - Strict workspace isolation (Workspace A vs Workspace B)
 * - Stale/aborted worker barrier (blocks writes if worker lost lease or run was cancelled/failed)
 * - Pure read-only loading (zero DB writes or timestamp fabrication on GET)
 * - Backward compatibility with legacy SyncJob resultJson payloads lacking marketplaceEvidence
 */

import { prisma as defaultPrisma } from "@/lib/db";
import {
  AmazonMarketplaceTelemetry,
  AmazonPolicyContext,
  AmazonProductEvidence,
  MarketplaceEvidenceStatus,
  ProductAmazonEvidenceSummary,
  computeDeterministicEvidenceHash,
  resolveAmazonUsPolicyContext,
} from "./marketplaceEvidenceTypes";

export const AMAZON_EVIDENCE_SUBJECT_TYPE = "AMAZON_US_MARKETPLACE";

export const NON_INFLATION_NOTICE =
  "Listing existence corroborates product identity only; never implies unit sales, 60-day demand (G15), or live ad/merchant verification (G16).";

export function computeAmazonEvidenceCompositeId(
  workspaceId: string,
  researchRunId: string,
  candidateId: string,
  asinOrKey: string | null,
  sourceUrl?: string | null
): string {
  const discriminator = (asinOrKey || sourceUrl || "UNKNOWN").trim();
  const compositeKey = `${workspaceId}:${researchRunId}:${candidateId}:AMAZON_US:${discriminator}`;
  const digest = computeDeterministicEvidenceHash(compositeKey)?.slice(0, 24) || "default";
  return `amz_ev_${digest}`;
}

export interface PersistAmazonEvidenceOptions {
  db?: any;
  expectedWorkerId?: string;
  signal?: AbortSignal;
  isLeaseStillOwned?: () => Promise<boolean> | boolean;
  telemetry?: AmazonMarketplaceTelemetry | null;
}

export interface PersistAmazonEvidenceResult {
  persistedCount: number;
  deduplicatedCount: number;
  persistedIds: string[];
  blockedByOwnershipOrAbort: boolean;
  blockReason: string | null;
}

/**
 * Atomically and idempotently persists Amazon US product evidence rows for a workspace and run.
 * - Rejects stale worker writes if signal is aborted, lease check fails, or SyncJob belongs to another worker.
 * - Deduplicates by composite key (workspaceId, researchRunId, candidateId, provider, asin).
 * - Upserts into `ResearchEvidence` so retries/reloads never create duplicate ASIN rows.
 */
export async function persistAmazonEvidenceAtomically(
  workspaceId: string,
  runId: string,
  evidenceRows: AmazonProductEvidence[],
  options: PersistAmazonEvidenceOptions = {}
): Promise<PersistAmazonEvidenceResult> {
  const db = options.db || defaultPrisma;

  if (!workspaceId || !runId) {
    throw new Error("workspaceId and runId are required to persist Amazon evidence.");
  }

  if (options.signal?.aborted) {
    return {
      persistedCount: 0,
      deduplicatedCount: 0,
      persistedIds: [],
      blockedByOwnershipOrAbort: true,
      blockReason: "ABORTED_BEFORE_PERSIST: Operation signal was aborted.",
    };
  }

  if (options.isLeaseStillOwned) {
    const owned = await options.isLeaseStillOwned();
    if (!owned) {
      return {
        persistedCount: 0,
        deduplicatedCount: 0,
        persistedIds: [],
        blockedByOwnershipOrAbort: true,
        blockReason: "STALE_WORKER_LEASE: Worker lost lease ownership before persistence.",
      };
    }
  }

  // Verify SyncJob ownership if expectedWorkerId is provided
  if (options.expectedWorkerId) {
    const job = await db.syncJob.findFirst({
      where: { id: runId, workspaceId },
      select: { id: true, status: true, workerId: true },
    });
    if (
      !job ||
      job.status === "FAILED" ||
      job.status === "CANCELLED" ||
      (job.workerId && job.workerId !== options.expectedWorkerId)
    ) {
      return {
        persistedCount: 0,
        deduplicatedCount: 0,
        persistedIds: [],
        blockedByOwnershipOrAbort: true,
        blockReason: `STALE_WORKER_JOB_GUARD: Job ${runId} is owned by '${job?.workerId ?? "none"}' (status=${job?.status ?? "missing"}), expected '${options.expectedWorkerId}'.`,
      };
    }
  }

  // Deduplicate by composite key (workspaceId, runId, candidateId, provider, asin/sourceUrl)
  const dedupedByCompositeId = new Map<string, AmazonProductEvidence>();
  let deduplicatedCount = 0;

  for (const rawRow of evidenceRows || []) {
    if (!rawRow) continue;
    const compositeId = computeAmazonEvidenceCompositeId(
      workspaceId,
      runId,
      rawRow.candidateId,
      rawRow.asin,
      rawRow.sourceUrl
    );
    const normalizedRow: AmazonProductEvidence = {
      ...rawRow,
      id: compositeId,
      workspaceId,
      researchRunId: runId,
      provider: "AMAZON_US",
    };
    if (dedupedByCompositeId.has(compositeId)) {
      deduplicatedCount += 1;
    }
    dedupedByCompositeId.set(compositeId, normalizedRow);
  }

  const normalizedList = Array.from(dedupedByCompositeId.values());
  const persistedIds: string[] = [];

  await db.$transaction(async (tx: any) => {
    // Re-check abort inside transaction boundary
    if (options.signal?.aborted) {
      throw new Error("ABORTED_IN_TRANSACTION");
    }

    for (const row of normalizedList) {
      const subjectId = `${runId}:${row.candidateId}:${row.asin || "NO_ASIN"}`;
      const observedDate = row.observedAt ? new Date(row.observedAt) : new Date();
      const classification =
        row.observationClass === "AUTHORIZED_LIVE"
          ? "OBSERVED_FACT"
          : "DERIVED_METRIC";

      await tx.researchEvidence.upsert({
        where: { id: row.id },
        create: {
          id: row.id,
          workspaceId,
          subjectType: AMAZON_EVIDENCE_SUBJECT_TYPE,
          subjectId,
          pillar: "PRODUCT",
          claim: `AMAZON_US_${row.status}_${row.identityMatch}`,
          observedValue: JSON.stringify(row),
          sourceUrl: row.canonicalAmazonUrl || row.sourceUrl,
          observationMethod: `AMAZON_US_${row.requestMode}`,
          classification,
          sourceContentRef: row.rawEvidenceHash || row.extractedFieldsHash,
          observedAt: Number.isNaN(observedDate.getTime()) ? new Date() : observedDate,
        },
        update: {
          subjectId,
          claim: `AMAZON_US_${row.status}_${row.identityMatch}`,
          observedValue: JSON.stringify(row),
          sourceUrl: row.canonicalAmazonUrl || row.sourceUrl,
          observationMethod: `AMAZON_US_${row.requestMode}`,
          classification,
          sourceContentRef: row.rawEvidenceHash || row.extractedFieldsHash,
          observedAt: Number.isNaN(observedDate.getTime()) ? new Date() : observedDate,
        },
      });
      persistedIds.push(row.id);
    }
  });

  return {
    persistedCount: persistedIds.length,
    deduplicatedCount,
    persistedIds,
    blockedByOwnershipOrAbort: false,
    blockReason: null,
  };
}

export interface LoadedRunAmazonEvidence {
  workspaceId: string;
  researchRunId: string;
  evidenceRows: AmazonProductEvidence[];
  telemetry: AmazonMarketplaceTelemetry | null;
  isLegacyRunWithoutMarketplaceEvidence: boolean;
}

/**
 * Pure read-only loader for a run's persisted Amazon US product evidence.
 * - Strictly scoped by `workspaceId` and `runId`.
 * - Never writes to SQLite or fabricates current timestamps.
 * - Supports legacy runs whose `SyncJob.resultJson` has no `marketplaceEvidence` field.
 */
export async function loadAmazonEvidenceForRun(
  workspaceId: string,
  runId: string,
  db: any = defaultPrisma
): Promise<LoadedRunAmazonEvidence> {
  if (!workspaceId || !runId) {
    return {
      workspaceId: workspaceId || "",
      researchRunId: runId || "",
      evidenceRows: [],
      telemetry: null,
      isLegacyRunWithoutMarketplaceEvidence: true,
    };
  }

  // 1. Load from dedicated ResearchEvidence rows scoped to workspaceId + runId prefix
  const dbRows = await db.researchEvidence.findMany({
    where: {
      workspaceId,
      subjectType: AMAZON_EVIDENCE_SUBJECT_TYPE,
      subjectId: {
        startsWith: `${runId}:`,
      },
    },
    orderBy: {
      id: "asc",
    },
  });

  const parsedById = new Map<string, AmazonProductEvidence>();
  for (const record of dbRows) {
    if (record.workspaceId !== workspaceId) continue;
    try {
      const parsed = JSON.parse(record.observedValue) as AmazonProductEvidence;
      if (
        parsed &&
        parsed.workspaceId === workspaceId &&
        parsed.researchRunId === runId &&
        parsed.provider === "AMAZON_US"
      ) {
        parsedById.set(parsed.id, parsed);
      }
    } catch {
      // Ignore malformed JSON row
    }
  }

  // 2. Also inspect SyncJob.resultJson (strictly read-only, scoped by workspaceId + runId)
  let telemetry: AmazonMarketplaceTelemetry | null = null;
  let hasResultJsonField = false;

  const job = await db.syncJob.findFirst({
    where: {
      id: runId,
      workspaceId,
    },
    select: {
      id: true,
      workspaceId: true,
      resultJson: true,
    },
  });

  if (job?.resultJson && job.workspaceId === workspaceId) {
    try {
      const parsedResult = JSON.parse(job.resultJson);
      if (parsedResult && typeof parsedResult === "object") {
        if (Array.isArray(parsedResult.marketplaceEvidence)) {
          hasResultJsonField = true;
          for (const item of parsedResult.marketplaceEvidence as AmazonProductEvidence[]) {
            if (
              item &&
              item.workspaceId === workspaceId &&
              item.researchRunId === runId &&
              item.provider === "AMAZON_US" &&
              !parsedById.has(item.id)
            ) {
              parsedById.set(item.id, item);
            }
          }
        }
        if (parsedResult.marketplaceTelemetry) {
          hasResultJsonField = true;
          telemetry = parsedResult.marketplaceTelemetry as AmazonMarketplaceTelemetry;
        }
      }
    } catch {
      // Ignore malformed resultJson
    }
  }

  const evidenceRows = Array.from(parsedById.values());
  const isLegacyRunWithoutMarketplaceEvidence =
    evidenceRows.length === 0 && !hasResultJsonField;

  return {
    workspaceId,
    researchRunId: runId,
    evidenceRows,
    telemetry,
    isLegacyRunWithoutMarketplaceEvidence,
  };
}

function formatStatusLabel(status: MarketplaceEvidenceStatus): string {
  switch (status) {
    case "IDENTITY_VERIFIED":
      return "Amazon US Identity Verified";
    case "OBSERVED_UNVERIFIED":
      return "Amazon US Listing Observed (Unverified Match)";
    case "PARTIAL":
      return "Amazon US Listing Observed (Partial Metadata)";
    case "BLOCKED_POLICY":
      return "Amazon US Blocked by Policy Guard";
    case "BLOCKED_PROVIDER":
      return "Amazon US Access Blocked by Provider";
    case "CAPTCHA_BLOCKED":
      return "Amazon US CAPTCHA Challenge";
    case "RATE_LIMITED":
      return "Amazon US Rate Limited (Budget Cap)";
    case "TIMED_OUT":
      return "Amazon US Timed Out";
    case "QUERY_SUCCEEDED_EMPTY":
      return "Amazon US No Product Found";
    case "NOT_AUTHORIZED":
      return "Amazon US Not Authorized";
    case "NOT_ATTEMPTED":
      return "Amazon US Not Attempted";
    case "DISABLED":
      return "Amazon US Pilot Disabled";
    case "FAILED":
    default:
      return "Amazon US Verification Rejected";
  }
}

function formatIdentityMatchLabel(match: AmazonProductEvidence["identityMatch"]): string {
  switch (match) {
    case "EXACT_PRODUCT":
      return "Exact Product Match";
    case "PROBABLE_PRODUCT":
      return "Probable Product Match";
    case "BRAND_ONLY":
      return "Brand-Only Match (Product Unverified)";
    case "AMBIGUOUS":
      return "Ambiguous Match";
    case "NO_MATCH":
    default:
      return "No Verified Match";
  }
}

/**
 * Summarizes persisted Amazon US product evidence for a single KH-02 candidate.
 * - Preserves exact persisted values (`asin`, `canonicalAmazonUrl`, `identityMatch`, `status`,
 *   `observedAt`, `providerInvocationRef`, `providerRequestId`, `rawEvidenceHash`, `extractedFieldsHash`).
 * - When `evidenceRows` has no match for `(runId, candidateId)` and feature flag is OFF (or legacy run),
 *   returns `visible: false` so UI remains completely unchanged.
 */
export function summarizeAmazonEvidenceForProduct(
  candidateId: string,
  runId: string,
  evidenceRows: AmazonProductEvidence[] | undefined | null,
  options?: {
    policyContext?: AmazonPolicyContext;
    telemetry?: AmazonMarketplaceTelemetry | null;
  }
): ProductAmazonEvidenceSummary {
  const rows = Array.isArray(evidenceRows) ? evidenceRows : [];
  const matchingRows = rows.filter(
    (r) =>
      r &&
      r.candidateId === candidateId &&
      (!runId || r.researchRunId === runId) &&
      r.provider === "AMAZON_US"
  );

  // Prefer positive/verified match if multiple exist, otherwise first matching record
  const bestRow =
    matchingRows.find((r) => r.status === "IDENTITY_VERIFIED") ||
    matchingRows.find((r) => r.status === "PARTIAL" || r.status === "OBSERVED_UNVERIFIED") ||
    matchingRows[0] ||
    null;

  if (bestRow) {
    return {
      candidateId,
      researchRunId: bestRow.researchRunId,
      provider: "AMAZON_US",
      visible: true,
      status: bestRow.status,
      statusLabel: formatStatusLabel(bestRow.status),
      asin: bestRow.asin,
      parentAsin: bestRow.parentAsin,
      variationAsin: bestRow.variationAsin,
      canonicalAmazonUrl: bestRow.canonicalAmazonUrl,
      productTitle: bestRow.productTitle,
      brand: bestRow.brand,
      price: bestRow.price,
      currency: bestRow.currency,
      availability: bestRow.availability,
      identityMatch: bestRow.identityMatch,
      identityMatchLabel: formatIdentityMatchLabel(bestRow.identityMatch),
      observationClass: bestRow.observationClass,
      verificationScope: bestRow.verificationScope,
      observedAt: bestRow.observedAt,
      providerInvocationRef: bestRow.providerInvocationRef,
      providerRequestId: bestRow.providerRequestId,
      rawEvidenceHash: bestRow.rawEvidenceHash,
      extractedFieldsHash: bestRow.extractedFieldsHash,
      matchingReasons: [...(bestRow.matchingReasons || [])],
      missingFields: [...(bestRow.missingFields || [])],
      rejectionReasons: [...(bestRow.rejectionReasons || [])],
      nonInflationNotice: NON_INFLATION_NOTICE,
    };
  }

  const policy = options?.policyContext || resolveAmazonUsPolicyContext();
  const telemetryStatus = options?.telemetry?.runStatus;
  const fallbackStatus: MarketplaceEvidenceStatus =
    telemetryStatus && telemetryStatus !== "DISABLED"
      ? "NOT_ATTEMPTED"
      : policy.featureEnabled
      ? "NOT_ATTEMPTED"
      : "DISABLED";

  return {
    candidateId,
    researchRunId: runId,
    provider: "AMAZON_US",
    visible: false,
    status: fallbackStatus,
    statusLabel: formatStatusLabel(fallbackStatus),
    asin: null,
    parentAsin: null,
    variationAsin: null,
    canonicalAmazonUrl: null,
    productTitle: null,
    brand: null,
    price: null,
    currency: null,
    availability: null,
    identityMatch: "NO_MATCH",
    identityMatchLabel: formatIdentityMatchLabel("NO_MATCH"),
    observationClass: "UNVERIFIED",
    verificationScope: null,
    observedAt: null,
    providerInvocationRef: null,
    providerRequestId: null,
    rawEvidenceHash: null,
    extractedFieldsHash: null,
    matchingReasons: [],
    missingFields: [],
    rejectionReasons: [],
    nonInflationNotice: NON_INFLATION_NOTICE,
  };
}
