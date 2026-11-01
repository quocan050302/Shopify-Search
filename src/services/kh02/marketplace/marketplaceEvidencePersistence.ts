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
  NON_INFLATION_NOTICE,
  ProductAmazonEvidenceSummary,
  computeDeterministicEvidenceHash,
  resolveAmazonUsPolicyContext,
  summarizeAmazonEvidenceForProduct,
} from "./marketplaceEvidenceTypes";
import { evaluateAmazonUsEvidenceGate } from "./amazonUsEvidenceGate";

export { NON_INFLATION_NOTICE, summarizeAmazonEvidenceForProduct };

export const AMAZON_EVIDENCE_SUBJECT_TYPE = "AMAZON_US_MARKETPLACE";

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
  ownershipJobId?: string;
  expectedWorkerId?: string;
  expectedClaimToken?: string;
  expectedFencingToken?: string;
  expectedFencingGeneration?: number;
  signal?: AbortSignal;
  isLeaseStillOwned?: () => Promise<boolean> | boolean;
  telemetry?: AmazonMarketplaceTelemetry | null;
  simulateWriteFailureForTest?: boolean;
}

export interface PersistAmazonEvidenceResult {
  persistedCount: number;
  deduplicatedCount: number;
  persistedIds: string[];
  blockedByOwnershipOrAbort: boolean;
  blockReason: string | null;
}

function checkJobOwnershipConstraints(
  job: {
    id: string;
    workspaceId?: string | null;
    status: string;
    workerId: string | null;
    claimToken?: string | null;
    fencingToken?: string | null;
    fencingGeneration?: number | null;
    leaseExpiresAt?: Date | string | null;
  } | null,
  expectedWorkspaceId: string,
  options: PersistAmazonEvidenceOptions
): { valid: boolean; reason: string | null } {
  const hasStrictTokenExpectation = Boolean(
    options.expectedClaimToken ||
      options.expectedFencingToken ||
      typeof options.expectedFencingGeneration === "number"
  );
  if (!job) {
    return {
      valid: false,
      reason: `STALE_WORKER_JOB_GUARD: Job is missing in workspace '${expectedWorkspaceId}'.`,
    };
  }
  if (job.workspaceId && job.workspaceId !== expectedWorkspaceId) {
    return {
      valid: false,
      reason: `FORBIDDEN_WORKSPACE_JOB: Job '${job.id}' belongs to workspace '${job.workspaceId}', expected '${expectedWorkspaceId}'.`,
    };
  }
  if (job.status === "FAILED" || job.status === "CANCELLED") {
    return {
      valid: false,
      reason: `STALE_WORKER_JOB_GUARD: Job '${job.id}' is already terminal (status=${job.status}).`,
    };
  }
  if (hasStrictTokenExpectation && job.status !== "RUNNING") {
    return {
      valid: false,
      reason: `STALE_WORKER_JOB_GUARD: Job '${job.id}' is not RUNNING (status=${job.status}).`,
    };
  }
  if (
    options.expectedWorkerId &&
    job.workerId &&
    job.workerId !== options.expectedWorkerId
  ) {
    return {
      valid: false,
      reason: `STALE_WORKER_JOB_GUARD: Job '${job.id}' is owned by '${job.workerId}', expected '${options.expectedWorkerId}'.`,
    };
  }
  if (options.expectedClaimToken && job.claimToken !== options.expectedClaimToken) {
    return {
      valid: false,
      reason: `STALE_CLAIM_TOKEN: Job '${job.id}' claimToken mismatch (expected '${options.expectedClaimToken}', actual '${job.claimToken ?? "null"}').`,
    };
  }
  if (options.expectedFencingToken && job.fencingToken !== options.expectedFencingToken) {
    return {
      valid: false,
      reason: `STALE_FENCING_TOKEN: Job '${job.id}' fencingToken mismatch (expected '${options.expectedFencingToken}', actual '${job.fencingToken ?? "null"}').`,
    };
  }
  if (
    typeof options.expectedFencingGeneration === "number" &&
    typeof job.fencingGeneration === "number" &&
    job.fencingGeneration !== options.expectedFencingGeneration
  ) {
    return {
      valid: false,
      reason: `STALE_FENCING_GENERATION: Job '${job.id}' fencingGeneration=${job.fencingGeneration}, expected ${options.expectedFencingGeneration}.`,
    };
  }
  if (hasStrictTokenExpectation && job.leaseExpiresAt) {
    const expMs = new Date(job.leaseExpiresAt).getTime();
    if (Number.isFinite(expMs) && expMs <= Date.now()) {
      return {
        valid: false,
        reason: `EXPIRED_WORKER_LEASE: Job '${job.id}' lease expired at ${new Date(expMs).toISOString()}.`,
      };
    }
  }
  return { valid: true, reason: null };
}

function isStrongerAuthorizedLiveRow(existing: AmazonProductEvidence | null): boolean {
  if (!existing) return false;
  return (
    existing.status === "IDENTITY_VERIFIED" &&
    existing.observationClass === "AUTHORIZED_LIVE" &&
    existing.identityMatch === "EXACT_PRODUCT"
  );
}

/**
 * Atomically and idempotently persists Amazon US product evidence rows for a workspace and run.
 * - Rejects stale worker writes if signal is aborted, lease check fails, or SyncJob belongs to another worker
 *   both before AND inside `db.$transaction`.
 * - Deduplicates by composite key (workspaceId, researchRunId, candidateId, provider, asin).
 * - Preserves stronger `AUTHORIZED_LIVE` `IDENTITY_VERIFIED` rows against weaker overwrites.
 */
export async function persistAmazonEvidenceAtomically(
  workspaceId: string,
  runId: string,
  evidenceRows: AmazonProductEvidence[],
  options: PersistAmazonEvidenceOptions = {}
): Promise<PersistAmazonEvidenceResult> {
  const db = options.db || defaultPrisma;
  const ownershipJobId = options.ownershipJobId || runId;

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

  const hasOwnershipExpectation = Boolean(
    options.expectedWorkerId ||
      options.expectedClaimToken ||
      options.expectedFencingToken ||
      typeof options.expectedFencingGeneration === "number"
  );

  // Verify SyncJob ownership before transaction
  if (hasOwnershipExpectation) {
    const job = await db.syncJob.findFirst({
      where: { id: ownershipJobId, workspaceId },
      select: {
        id: true,
        workspaceId: true,
        status: true,
        workerId: true,
        claimToken: true,
        fencingToken: true,
        fencingGeneration: true,
        leaseExpiresAt: true,
      },
    });
    const check = checkJobOwnershipConstraints(job, workspaceId, options);
    if (!check.valid) {
      return {
        persistedCount: 0,
        deduplicatedCount: 0,
        persistedIds: [],
        blockedByOwnershipOrAbort: true,
        blockReason: check.reason,
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

  try {
    await db.$transaction(async (tx: any) => {
      // Re-check abort inside transaction boundary
      if (options.signal?.aborted) {
        throw new Error("ABORTED_IN_TRANSACTION");
      }

      if (options.isLeaseStillOwned) {
        const stillOwned = await options.isLeaseStillOwned();
        if (!stillOwned) {
          throw new Error(
            "STALE_WORKER_IN_TX:STALE_WORKER_LEASE: Worker lost lease ownership inside transaction."
          );
        }
      }

      // Re-verify SyncJob ownership, claimToken, fencingToken, fencingGeneration & leaseExpiresAt inside transaction (N28)
      if (hasOwnershipExpectation) {
        const txJob = await tx.syncJob.findFirst({
          where: { id: ownershipJobId, workspaceId },
          select: {
            id: true,
            workspaceId: true,
            status: true,
            workerId: true,
            claimToken: true,
            fencingToken: true,
            fencingGeneration: true,
            leaseExpiresAt: true,
          },
        });
        const txCheck = checkJobOwnershipConstraints(txJob, workspaceId, options);
        if (!txCheck.valid) {
          throw new Error(`STALE_WORKER_IN_TX:${txCheck.reason}`);
        }
      }

      if (options.simulateWriteFailureForTest) {
        throw new Error(
          "SIMULATED_AMAZON_EVIDENCE_DB_WRITE_FAILURE: Injected persistence failure for negative test."
        );
      }

      for (const row of normalizedList) {
        // Check if a stronger AUTHORIZED_LIVE IDENTITY_VERIFIED row already exists (N29)
        const existingRecord = await tx.researchEvidence.findUnique({
          where: { id: row.id },
          select: { id: true, observedValue: true },
        });
        if (existingRecord?.observedValue) {
          try {
            const parsedExisting = JSON.parse(
              existingRecord.observedValue
            ) as AmazonProductEvidence;
            if (
              isStrongerAuthorizedLiveRow(parsedExisting) &&
              !isStrongerAuthorizedLiveRow(row)
            ) {
              persistedIds.push(row.id);
              continue;
            }
          } catch {
            // Proceed with upsert if existing JSON is unparseable
          }
        }

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
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.startsWith("STALE_WORKER_IN_TX:")) {
      return {
        persistedCount: 0,
        deduplicatedCount,
        persistedIds: [],
        blockedByOwnershipOrAbort: true,
        blockReason: msg.slice("STALE_WORKER_IN_TX:".length),
      };
    }
    if (msg === "ABORTED_IN_TRANSACTION") {
      return {
        persistedCount: 0,
        deduplicatedCount,
        persistedIds: [],
        blockedByOwnershipOrAbort: true,
        blockReason: "ABORTED_IN_TRANSACTION: Operation signal aborted inside transaction.",
      };
    }
    throw err;
  }

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

export interface AttachAmazonEvidenceToRunParams {
  workspaceId: string;
  researchRunId: string;
  verifyJobId?: string;
  evidenceRows: AmazonProductEvidence[];
  telemetry: AmazonMarketplaceTelemetry;
  candidateUrls?: Record<string, string>;
  expectedWorkerId?: string;
  expectedClaimToken?: string;
  expectedFencingToken?: string;
  expectedFencingGeneration?: number;
  signal?: AbortSignal;
  isLeaseStillOwned?: () => Promise<boolean> | boolean;
  simulateWriteFailureForTest?: boolean;
}

export interface AttachAmazonEvidenceToRunResult {
  attached: boolean;
  persistedCount: number;
  blockedByOwnershipOrAbort: boolean;
  blockReason: string | null;
  mergedEvidenceCount: number;
  updatedTelemetry: AmazonMarketplaceTelemetry | null;
}

/**
 * Atomically attaches post-run Amazon US verification evidence and telemetry to an existing
 * completed/partially-completed KH-02 research run without re-running Meta/Google discovery
 * and without altering candidate opportunity scores, top-3 ordering, G15, or G16.
 */
export async function attachAmazonEvidenceToExistingResearchRun(
  params: AttachAmazonEvidenceToRunParams,
  db: any = defaultPrisma
): Promise<AttachAmazonEvidenceToRunResult> {
  if (!params.workspaceId || !params.researchRunId) {
    throw new Error(
      "workspaceId and researchRunId are required to attach Amazon evidence to an existing run."
    );
  }

  const parentJob = await db.syncJob.findFirst({
    where: { id: params.researchRunId },
    select: {
      id: true,
      workspaceId: true,
      jobType: true,
      status: true,
      resultJson: true,
    },
  });

  if (!parentJob) {
    throw new Error(`RUN_NOT_FOUND: Parent research run '${params.researchRunId}' not found.`);
  }

  if (parentJob.workspaceId !== params.workspaceId) {
    throw new Error(
      `FORBIDDEN_WORKSPACE_RUN: Run '${params.researchRunId}' belongs to another workspace.`
    );
  }

  if (
    parentJob.status !== "COMPLETED" &&
    parentJob.status !== "PARTIALLY_COMPLETED"
  ) {
    throw new Error(
      `INVALID_PARENT_RUN_STATE: Parent run '${params.researchRunId}' has status '${parentJob.status}'; must be COMPLETED or PARTIALLY_COMPLETED.`
    );
  }

  let parsedResult: Record<string, any> = {};
  if (parentJob.resultJson) {
    try {
      parsedResult = JSON.parse(parentJob.resultJson);
    } catch {
      throw new Error(
        `CORRUPT_PARENT_RESULT_JSON: Parent run '${params.researchRunId}' has unparseable resultJson.`
      );
    }
  }

  const allParentLists: any[][] = [
    Array.isArray(parsedResult.candidates) ? parsedResult.candidates : [],
    Array.isArray(parsedResult.topThree) ? parsedResult.topThree : [],
    Array.isArray(parsedResult.researchShortlist?.shortlist)
      ? parsedResult.researchShortlist.shortlist
      : [],
    Array.isArray(parsedResult.provisionalCandidates)
      ? parsedResult.provisionalCandidates
      : [],
    Array.isArray(parsedResult.remainingCandidates)
      ? parsedResult.remainingCandidates
      : [],
    Array.isArray(parsedResult.insufficientEvidenceCandidates)
      ? parsedResult.insufficientEvidenceCandidates
      : [],
  ];
  const knownCandidateIds = new Set<string>();
  for (const list of allParentLists) {
    for (const item of list) {
      const c = item?.candidate || item;
      if (c?.candidateId) knownCandidateIds.add(String(c.candidateId));
    }
  }

  const requestedCandidateIds = new Set<string>([
    ...Object.keys(params.candidateUrls || {}),
    ...(params.evidenceRows || []).map((r) => r.candidateId).filter(Boolean),
  ]);
  for (const cid of requestedCandidateIds) {
    if (!knownCandidateIds.has(cid)) {
      throw new Error(
        `UNKNOWN_CANDIDATE_FOR_RUN: Candidate '${cid}' does not belong to research run '${params.researchRunId}'.`
      );
    }
  }

  // 1. Persist dedicated ResearchEvidence rows atomically with child/worker ownership verification
  const persistRes = await persistAmazonEvidenceAtomically(
    params.workspaceId,
    params.researchRunId,
    params.evidenceRows,
    {
      db,
      ownershipJobId: params.verifyJobId || params.researchRunId,
      expectedWorkerId: params.expectedWorkerId,
      expectedClaimToken: params.expectedClaimToken,
      expectedFencingToken: params.expectedFencingToken,
      expectedFencingGeneration: params.expectedFencingGeneration,
      signal: params.signal,
      isLeaseStillOwned: params.isLeaseStillOwned,
      telemetry: params.telemetry,
      simulateWriteFailureForTest: params.simulateWriteFailureForTest,
    }
  );

  if (persistRes.blockedByOwnershipOrAbort) {
    return {
      attached: false,
      persistedCount: 0,
      blockedByOwnershipOrAbort: true,
      blockReason: persistRes.blockReason,
      mergedEvidenceCount: 0,
      updatedTelemetry: null,
    };
  }

  // 2. Load authoritative persisted ResearchEvidence rows for this run so stronger rows are preserved
  const loadedAfterPersist = await loadAmazonEvidenceForRun(
    params.workspaceId,
    params.researchRunId,
    db
  );

  const mergedByCompositeId = new Map<string, AmazonProductEvidence>();
  const existingJsonRows: AmazonProductEvidence[] = Array.isArray(
    parsedResult.marketplaceEvidence
  )
    ? parsedResult.marketplaceEvidence
    : [];

  for (const row of existingJsonRows) {
    if (!row) continue;
    const cid = computeAmazonEvidenceCompositeId(
      params.workspaceId,
      params.researchRunId,
      row.candidateId,
      row.asin,
      row.sourceUrl
    );
    mergedByCompositeId.set(cid, { ...row, id: cid });
  }
  for (const row of loadedAfterPersist.evidenceRows) {
    if (!row) continue;
    const existing = mergedByCompositeId.get(row.id) || null;
    if (isStrongerAuthorizedLiveRow(existing) && !isStrongerAuthorizedLiveRow(row)) {
      continue;
    }
    mergedByCompositeId.set(row.id, row);
  }

  const mergedEvidence = Array.from(mergedByCompositeId.values());
  const prevTelemetry: AmazonMarketplaceTelemetry | null =
    parsedResult.marketplaceTelemetry || null;
  const mergedOperationLedger = [
    ...(prevTelemetry?.operationLedger || []),
    ...(params.telemetry?.operationLedger || []),
  ];
  const mergedRejectionLedger = [
    ...(prevTelemetry?.rejectionLedger || []),
    ...(params.telemetry?.rejectionLedger || []),
  ];

  const policy = resolveAmazonUsPolicyContext();
  const gateEvaluation = evaluateAmazonUsEvidenceGate(
    params.researchRunId,
    mergedEvidence,
    mergedOperationLedger,
    policy,
    { workspaceId: params.workspaceId }
  );

  const identityVerifiedCount = mergedEvidence.filter(
    (e) => e.identityMatch === "EXACT_PRODUCT" && e.status === "IDENTITY_VERIFIED"
  ).length;
  const probableMatchCount = mergedEvidence.filter(
    (e) => e.identityMatch === "PROBABLE_PRODUCT"
  ).length;
  const brandOnlyCount = mergedEvidence.filter(
    (e) => e.identityMatch === "BRAND_ONLY"
  ).length;

  const updatedTelemetry: AmazonMarketplaceTelemetry = {
    ...params.telemetry,
    identityVerifiedCount,
    probableMatchCount,
    brandOnlyCount,
    operationLedger: mergedOperationLedger,
    rejectionLedger: mergedRejectionLedger,
    gateEvaluation,
    persistenceStatus: "PERSISTED",
    persistenceError: null,
  };

  // Update only Amazon evidence summary fields on candidates and topThree — never touch scores, ordering, G15, or G16
  const enrichCandidateSummaryInPlace = (cand: any) => {
    if (!cand || !cand.candidateId) return;
    if (params.candidateUrls?.[cand.candidateId]) {
      cand.amazonProductUrl = params.candidateUrls[cand.candidateId];
    }
    const summary = summarizeAmazonEvidenceForProduct(
      cand.candidateId,
      params.researchRunId,
      mergedEvidence,
      { policyContext: policy, telemetry: updatedTelemetry }
    );
    cand.amazonEvidenceSummary = summary;
    const matchingRow =
      mergedEvidence.find(
        (r) => r.candidateId === cand.candidateId && r.status === "IDENTITY_VERIFIED"
      ) ||
      mergedEvidence.find((r) => r.candidateId === cand.candidateId) ||
      null;
    if (matchingRow) {
      cand.amazonEvidence = matchingRow;
      cand.amazonEvidenceStatus = matchingRow.status;
    }
  };

  for (const list of allParentLists) {
    for (const item of list) {
      const cand = item?.candidate || item;
      enrichCandidateSummaryInPlace(cand);
    }
  }

  parsedResult.marketplaceEvidence = mergedEvidence;
  parsedResult.marketplaceTelemetry = updatedTelemetry;

  await db.syncJob.update({
    where: { id: params.researchRunId },
    data: {
      resultJson: JSON.stringify(parsedResult),
    },
  });

  return {
    attached: true,
    persistedCount: persistRes.persistedCount,
    blockedByOwnershipOrAbort: false,
    blockReason: null,
    mergedEvidenceCount: mergedEvidence.length,
    updatedTelemetry,
  };
}
