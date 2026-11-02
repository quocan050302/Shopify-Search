/**
 * SWAI KH-02 V12.4.3.5.1 — Walmart US Pilot Enrichment Adapter
 *
 * Orchestrator-facing entry point:
 * - runWalmartUsPilotEnrichment(params)
 * - executeWalmartLogicalOperationWithRetry(params)
 *
 * Strictly enforces:
 * - Server-only feature flags (`KH02_WALMART_US_ENABLED`, `KH02_WALMART_US_LIVE_ALLOWED`).
 * - Provider-level budget (`<=1` concurrent op, `<=4` logical ops/run, `<=2` attempts/op, `<=6` req/60s).
 * - Separation of `REAL_JINA_READER` vs `TEST_FIXTURE` provenance.
 * - Independent dimensions for `queryStatus`, `presence`, `matchLevel`, and `availability`.
 * - Zero impact on KH-02 opportunity scores, G07/G15/G16 gates, or Amazon US evidence.
 */

import {
  EvidenceOrigin,
  MarketplacePresence,
  WALMART_NON_INFLATION_NOTICE,
  WalmartEvidenceSummary,
  WalmartJinaResponse,
  WalmartPilotPolicyLimits,
  WalmartProductEvidence,
  WalmartProviderRequestRecord,
  WalmartProviderTelemetry,
  WalmartQueryExecutionStatus,
  computeWalmartDeterministicHash,
} from "./walmartJinaTypes";
import {
  resolveEffectiveWalmartRunAuthorization,
  resolveWalmartUsPilotPolicy,
} from "./walmartJinaPolicy";
import { requestWalmartJinaReader } from "./walmartJinaReaderClient";
import {
  extractNextDataScript,
  parseWalmartPdpNextData,
  parseWalmartSearchNextData,
} from "./walmartNextDataParser";
import {
  CandidateIdentityInput,
  chooseWalmartPdpTargets,
  compareCandidateToWalmartListing,
  deriveWalmartSearchIntents,
} from "./walmartProductIdentity";
import {
  WalmartProviderBudget,
  applyWalmartProviderCooldown,
  awaitWalmartRateSlot,
  commitWalmartOperationAttemptResult,
  createWalmartProviderBudget,
  reserveWalmartNetworkAttempt,
  reserveWalmartOperation,
} from "./walmartJinaBudget";
import {
  computeWalmartEvidenceCompositeId,
  summarizeWalmartEvidenceForCandidate,
} from "./walmartEvidencePersistence";

export interface ExecuteWalmartLogicalOpParams {
  budget: WalmartProviderBudget;
  logicalOperationId: string;
  operationKind: "SEARCH" | "PDP";
  query?: string | null;
  itemId?: string | null;
  candidateId?: string | null;
  customFetch?: typeof fetch;
  evidenceOrigin?: EvidenceOrigin;
  requestLedger: WalmartProviderRequestRecord[];
  signal?: AbortSignal;
}

export interface ExecuteWalmartLogicalOpResult {
  finalResponse: WalmartJinaResponse | null;
  finalStatus: WalmartQueryExecutionStatus;
  attemptsExecuted: number;
  committedGeneration: number;
  statusReason: string;
}

/**
 * Executes a reserved logical Walmart operation (SEARCH or PDP) with the bounded
 * retry state machine (`<= 2` attempts, `>= 3s` backoff on transient timeout/5xx/network reset,
 * shared 429 cooldown, immediate 401/402 free-pilot stop, and monotonic attemptGeneration fence).
 */
export async function executeWalmartLogicalOperationWithRetry(
  params: ExecuteWalmartLogicalOpParams
): Promise<ExecuteWalmartLogicalOpResult> {
  const { budget, logicalOperationId, operationKind } = params;
  let lastResponse: WalmartJinaResponse | null = null;
  let finalStatus: WalmartQueryExecutionStatus = "NOT_ATTEMPTED";
  let statusReason = "Not attempted";
  let attemptsExecuted = 0;
  let committedGeneration = 0;

  const maxAttempts = budget.limits.maxAttemptsPerOperation;

  for (let attemptIdx = 1; attemptIdx <= maxAttempts; attemptIdx++) {
    if (budget.isCancelled() || params.signal?.aborted) {
      finalStatus = "CANCELLED";
      statusReason = budget.cancelReason || "Cancelled before network attempt.";
      break;
    }

    const freeStop = budget.isFreePilotStopped();
    if (freeStop.stopped) {
      finalStatus = "KEY_OR_PAYMENT_REQUIRED";
      statusReason =
        freeStop.reason ||
        "Free no-key Jina Reader pilot stopped due to prior 401/402 response.";
      break;
    }

    // If this is a retry (attempt #2), enforce >= 3s backoff before reserving the next rate slot
    if (attemptIdx > 1) {
      const backoffMs = budget.limits.minRetryBackoffMs;
      const opState = budget.operations.get(logicalOperationId);
      const nowBeforeBackoff = budget.nowFn();
      if (opState && nowBeforeBackoff + backoffMs >= opState.deadlineAtMs) {
        finalStatus = lastResponse?.queryStatus || "TIMED_OUT";
        statusReason = `Retry backoff (${backoffMs}ms) exceeds remaining operation deadline.`;
        break;
      }
      try {
        await budget.sleepFn(
          backoffMs,
          params.signal || budget.controller.signal
        );
      } catch {
        finalStatus = "CANCELLED";
        statusReason = "Cancelled during retry backoff.";
        break;
      }
    }

    const attemptRes = reserveWalmartNetworkAttempt(budget, logicalOperationId);
    if (!attemptRes.permitted) {
      finalStatus =
        lastResponse?.queryStatus && lastResponse.queryStatus !== "PENDING"
          ? lastResponse.queryStatus
          : attemptRes.status;
      statusReason =
        attemptRes.reason || "Network attempt reservation rejected.";
      break;
    }

    const { attemptNumber, attemptGeneration } = attemptRes;

    // Await rate slot & single-concurrency lock across workers
    const slotRes = await awaitWalmartRateSlot(budget, {
      logicalOperationId,
      attemptNumber,
      signal: params.signal || budget.controller.signal,
    });

    if (!slotRes.permitted) {
      finalStatus = slotRes.status;
      statusReason = slotRes.reason || "Rate slot wait rejected or deferred.";
      break;
    }

    let response: WalmartJinaResponse;
    try {
      attemptsExecuted += 1;
      response = await requestWalmartJinaReader({
        operationKind,
        query: params.query,
        itemId: params.itemId,
        workspaceId: budget.workspaceId,
        researchRunId: budget.researchRunId,
        candidateId: params.candidateId,
        logicalOperationId,
        attemptNumber,
        attemptGeneration,
        timeoutMs: budget.limits.httpTimeoutMs,
        maxResponseBytes: budget.limits.maxResponseBytes,
        signal: params.signal || budget.controller.signal,
        customFetch: params.customFetch,
        evidenceOrigin: params.evidenceOrigin,
      });
    } finally {
      slotRes.releaseConcurrencySlot();
    }

    // Record in provider request ledger
    params.requestLedger.push({
      requestId: `${logicalOperationId}_att${attemptNumber}`,
      localRequestRef: response.localRequestRef,
      upstreamRequestId: response.upstreamRequestId,
      workspaceId: budget.workspaceId,
      researchRunId: budget.researchRunId,
      candidateId: params.candidateId ?? null,
      logicalOperationId,
      operationKind,
      attemptNumber,
      attemptGeneration,
      query: params.query ?? null,
      itemId: params.itemId ?? null,
      requestUrl: response.requestUrl,
      targetWalmartUrl: response.targetWalmartUrl,
      headersSent: response.requestHeadersSent,
      outerHttpStatus: response.outerHttpStatus,
      innerHttpStatus: response.innerHttpStatus,
      queryStatus: response.queryStatus,
      evidenceOrigin: response.evidenceOrigin,
      requestedNoCache: response.requestedNoCache,
      observedCacheMetadata: response.observedCacheMetadata,
      retryAfterMs: response.retryAfterMs,
      startedAt: response.startedAt,
      completedAt: response.completedAt,
      durationMs: response.durationMs,
      aborted: response.aborted,
      timedOut: response.timedOut,
      requestHash: response.requestHash,
      responseHash: response.responseHash,
      errorCode: response.errorCode,
      errorMessage: response.errorMessage,
    });

    if (response.aborted) {
      budget.abortedRequestsCount += 1;
    }

    // Apply shared provider cooldown on 429 or stop free pilot on 401/402
    if (
      response.stopFreePilot ||
      response.outerHttpStatus === 401 ||
      response.outerHttpStatus === 402 ||
      response.innerHttpStatus === 401 ||
      response.innerHttpStatus === 402
    ) {
      await applyWalmartProviderCooldown(budget, {
        statusCode: response.outerHttpStatus || response.innerHttpStatus || 402,
        stopFreePilot: true,
        reason: response.errorMessage,
      });
    } else if (
      response.queryStatus === "RATE_LIMITED" ||
      response.outerHttpStatus === 429 ||
      response.innerHttpStatus === 429
    ) {
      await applyWalmartProviderCooldown(budget, {
        statusCode: 429,
        retryAfterHeader: response.retryAfterRaw,
        retryAfterMs: response.retryAfterMs,
        reason: response.errorMessage,
      });
    }

    // Commit generation fence check: ensure a late attempt #1 cannot overwrite attempt #2
    const commitRes = commitWalmartOperationAttemptResult(
      budget,
      logicalOperationId,
      attemptGeneration,
      response,
      response.queryStatus
    );

    if (commitRes.committed) {
      lastResponse = response;
      finalStatus = response.queryStatus;
      committedGeneration = attemptGeneration;
      statusReason =
        response.errorMessage ||
        `Walmart ${operationKind} ${response.queryStatus}`;
    }

    if (response.ok && response.queryStatus === "SUCCEEDED") {
      break;
    }

    // Stop immediately if non-retryable (e.g. 401/402, 403/bot wall, parse error, caller cancel)
    if (!response.retryable || response.stopFreePilot || budget.isCancelled()) {
      break;
    }

    // If 429 RATE_LIMITED, only retry once if cooldown wait + deadline + budget allow
    if (response.queryStatus === "RATE_LIMITED") {
      const opState = budget.operations.get(logicalOperationId);
      const cooldownUntil = budget.getCooldownUntilMs();
      if (opState && cooldownUntil >= opState.deadlineAtMs) {
        finalStatus = "RATE_LIMITED";
        statusReason =
          "HTTP 429 Retry-After cooldown exceeds remaining operation deadline.";
        break;
      }
    }
  }

  return {
    finalResponse: lastResponse,
    finalStatus,
    attemptsExecuted,
    committedGeneration,
    statusReason,
  };
}

export interface RunWalmartUsPilotEnrichmentParams {
  workspaceId: string;
  researchRunId: string;
  niche?: string;
  topic?: string;
  market?: string;
  enableWalmartUsPilot?: boolean;
  shortlistedCandidates?: CandidateIdentityInput[];
  shortlistCandidates?: CandidateIdentityInput[];
  env?: Record<string, string | undefined>;
  limitsOverride?: Partial<WalmartPilotPolicyLimits>;
  providerGroupKey?: string;
  customFetch?: typeof fetch;
  evidenceOrigin?: EvidenceOrigin;
  db?: any;
  nowFn?: () => number;
  sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  onProgress?: (progress: {
    step: string;
    message: string;
    logicalOperationsUsed: number;
    networkAttemptsUsed: number;
  }) => Promise<void> | void;
}

export interface RunWalmartUsPilotEnrichmentResult {
  evidenceRows: WalmartProductEvidence[];
  telemetry: WalmartProviderTelemetry;
  summariesByCandidateId: Record<string, WalmartEvidenceSummary>;
}

/**
 * Main orchestrator-facing function for KH-02 V12.4.3.5.1 Walmart US Pilot Enrichment.
 * Enriches up to top-3 shortlisted candidates using free Jina Reader REST (search + PDP)
 * under the strict 4-logical-operation per-run cap.
 */
export async function runWalmartUsPilotEnrichment(
  params: RunWalmartUsPilotEnrichmentParams
): Promise<RunWalmartUsPilotEnrichmentResult> {
  const effectiveNiche = (params.niche || params.topic || "General Research").trim();
  const effectiveCandidates = params.shortlistedCandidates || params.shortlistCandidates || [];
  const env = params.env || process.env;
  const hasCustomFixtureTransport = typeof params.customFetch === "function";
  const auth = resolveEffectiveWalmartRunAuthorization(
    params.enableWalmartUsPilot,
    env,
    hasCustomFixtureTransport
  );
  const policy = auth.policy;
  const effectiveLimits: WalmartPilotPolicyLimits = {
    ...policy.limits,
    ...params.limitsOverride,
    maxLogicalOperationsPerRun: Math.min(
      4,
      params.limitsOverride?.maxLogicalOperationsPerRun ??
        policy.limits.maxLogicalOperationsPerRun
    ),
    maxAttemptsPerOperation: Math.min(
      2,
      params.limitsOverride?.maxAttemptsPerOperation ??
        policy.limits.maxAttemptsPerOperation
    ),
    maxRequestsPerMinuteAcrossWorkers: Math.min(
      6,
      params.limitsOverride?.maxRequestsPerMinuteAcrossWorkers ??
        policy.limits.maxRequestsPerMinuteAcrossWorkers
    ),
  };
  effectiveLimits.maxNetworkAttemptsPerRun =
    effectiveLimits.maxLogicalOperationsPerRun *
    effectiveLimits.maxAttemptsPerOperation;

  const targetCandidates = effectiveCandidates.slice(0, 3);

  // If disabled or not opted in -> 0 network calls, 0 DB writes
  if (!auth.effectiveEnabled) {
    const telemetry: WalmartProviderTelemetry = {
      provider: "WALMART_US",
      workspaceId: params.workspaceId,
      researchRunId: params.researchRunId,
      featureEnabled: policy.featureEnabled,
      liveAllowed: policy.liveAllowed,
      freeReaderMode: true,
      requiresApiKey: false,
      authenticated: false,
      chargedCreditsOrDollars: 0,
      overallStatus: auth.initialQueryStatus,
      statusReason: auth.reason,
      shortlistedTargetsCount: targetCandidates.length,
      logicalOperationsUsed: 0,
      logicalOperationsLimit: effectiveLimits.maxLogicalOperationsPerRun,
      networkAttemptsUsed: 0,
      networkAttemptsLimit: effectiveLimits.maxNetworkAttemptsPerRun,
      searchOperationsCount: 0,
      pdpOperationsCount: 0,
      succeededCount: 0,
      partialCount: 0,
      deferredCount: 0,
      timedOutCount: 0,
      rateLimitedCount: 0,
      blockedProviderCount: 0,
      parseErrorCount: 0,
      cancelledCount: 0,
      foundCount: 0,
      noMatchInScopeCount: 0,
      unknownPresenceCount: targetCandidates.length,
      exactMatchCount: 0,
      similarMatchCount: 0,
      uncertainMatchCount: targetCandidates.length,
      realJinaVerifiedCount: 0,
      fixtureOrCachedCount: 0,
      rollingMinuteRequestsObserved: 0,
      rollingMinuteLimit: effectiveLimits.maxRequestsPerMinuteAcrossWorkers,
      cooldownUntil: null,
      lastAttemptAt: null,
      lastSuccessfulLiveQueryAt: null,
      persistenceStatus: "SKIPPED_DISABLED",
      persistenceError: null,
      requestLedger: [],
      operationalStatus: policy.operationalStatus,
      upstreamBlockerStatus: policy.upstreamBlockerStatus,
      priorLiveBlockerReference: policy.priorLiveBlockerReference ?? null,
    };

    const summariesByCandidateId: Record<string, WalmartEvidenceSummary> = {};
    for (const cand of targetCandidates) {
      summariesByCandidateId[cand.candidateId] =
        summarizeWalmartEvidenceForCandidate(
          cand.candidateId,
          params.researchRunId,
          [],
          { telemetry, policy }
        );
    }

    return {
      evidenceRows: [],
      telemetry,
      summariesByCandidateId,
    };
  }

  const budget = createWalmartProviderBudget({
    workspaceId: params.workspaceId,
    researchRunId: params.researchRunId,
    providerGroupKey: params.providerGroupKey,
    limits: effectiveLimits,
    db: params.db,
    nowFn: params.nowFn,
    sleepFn: params.sleepFn,
    parentSignal: params.signal,
  });

  const requestLedger: WalmartProviderRequestRecord[] = [];
  const evidenceRows: WalmartProductEvidence[] = [];
  const fetchedPdpItemIds = new Set<string>();
  let searchOperationsCount = 0;
  let pdpOperationsCount = 0;
  let providerBlockedInRun = false;

  const effectiveOrigin: EvidenceOrigin =
    hasCustomFixtureTransport || params.evidenceOrigin === "TEST_FIXTURE"
      ? "TEST_FIXTURE"
      : params.evidenceOrigin || "REAL_JINA_READER";

  for (let idx = 0; idx < targetCandidates.length; idx++) {
    const candidate = targetCandidates[idx];
    const nowIso = new Date(budget.nowFn()).toISOString();

    if (budget.isCancelled() || params.signal?.aborted) {
      const cancelId = computeWalmartEvidenceCompositeId(
        params.workspaceId,
        params.researchRunId,
        candidate.candidateId,
        null,
        "cancelled"
      );
      evidenceRows.push({
        id: cancelId,
        workspaceId: params.workspaceId,
        researchRunId: params.researchRunId,
        candidateId: candidate.candidateId,
        provider: "WALMART_US",
        itemId: null,
        canonicalProductUrl: null,
        sourceUrl: "",
        finalUrl: null,
        title: null,
        brand: null,
        model: null,
        upc: null,
        price: null,
        currency: null,
        seller: null,
        locationPostalCode: null,
        locationStoreIds: [],
        availability: "UNKNOWN",
        queryStatus: "CANCELLED",
        presence: "UNKNOWN",
        matchLevel: "UNCERTAIN",
        verifiedIdentity: false,
        matchReasons: [],
        rejectionReasons: ["OPERATION_CANCELLED_BY_PARENT_RUN"],
        missingFields: [],
        appearanceProvenance: [],
        schemaCompatibility: "UNSUPPORTED_SCHEMA",
        schemaFieldPaths: [],
        evidenceOrigin: effectiveOrigin,
        isCached: false,
        isStale: false,
        requestedNoCache: true,
        observedCacheMetadata: null,
        requestHash: computeWalmartDeterministicHash({
          candidateId: candidate.candidateId,
          status: "CANCELLED",
        }),
        responseHash: computeWalmartDeterministicHash({ status: "CANCELLED" }),
        rawEvidenceHash: computeWalmartDeterministicHash({
          candidateId: candidate.candidateId,
          status: "CANCELLED",
        }),
        extractedFieldsHash: computeWalmartDeterministicHash({
          status: "CANCELLED",
        }),
        localRequestRef: `wmt_cancel_${params.researchRunId}_${candidate.candidateId}`,
        upstreamRequestId: null,
        lastAttemptAt: nowIso,
        observedAt: null,
        lastSuccessfulLiveQueryAt: null,
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
      });
      continue;
    }

    const intents = deriveWalmartSearchIntents(candidate, effectiveNiche);
    const primaryIntent = intents[0];

    if (!primaryIntent) {
      const noIntentId = computeWalmartEvidenceCompositeId(
        params.workspaceId,
        params.researchRunId,
        candidate.candidateId,
        null,
        "no_intent"
      );
      evidenceRows.push({
        id: noIntentId,
        workspaceId: params.workspaceId,
        researchRunId: params.researchRunId,
        candidateId: candidate.candidateId,
        provider: "WALMART_US",
        itemId: null,
        canonicalProductUrl: null,
        sourceUrl: "",
        finalUrl: null,
        title: null,
        brand: null,
        model: null,
        upc: null,
        price: null,
        currency: null,
        seller: null,
        locationPostalCode: null,
        locationStoreIds: [],
        availability: "UNKNOWN",
        queryStatus: "NOT_ATTEMPTED",
        presence: "UNKNOWN",
        matchLevel: "UNCERTAIN",
        verifiedIdentity: false,
        matchReasons: [],
        rejectionReasons: ["NO_SPECIFIC_CANDIDATE_SEARCH_INTENT"],
        missingFields: [],
        appearanceProvenance: [],
        schemaCompatibility: "UNSUPPORTED_SCHEMA",
        schemaFieldPaths: [],
        evidenceOrigin: effectiveOrigin,
        isCached: false,
        isStale: false,
        requestedNoCache: false,
        observedCacheMetadata: null,
        requestHash: computeWalmartDeterministicHash({
          candidateId: candidate.candidateId,
          status: "NO_INTENT",
        }),
        responseHash: computeWalmartDeterministicHash({ status: "NO_INTENT" }),
        rawEvidenceHash: computeWalmartDeterministicHash({
          candidateId: candidate.candidateId,
          status: "NO_INTENT",
        }),
        extractedFieldsHash: computeWalmartDeterministicHash({
          status: "NO_INTENT",
        }),
        localRequestRef: `wmt_nointent_${params.researchRunId}_${candidate.candidateId}`,
        upstreamRequestId: null,
        lastAttemptAt: nowIso,
        observedAt: null,
        lastSuccessfulLiveQueryAt: null,
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
      });
      continue;
    }

    // Reserve SEARCH logical operation (or stop immediately if prior candidate hit PerimeterX/CAPTCHA bot wall)
    const searchOpRes = providerBlockedInRun
      ? {
          permitted: false,
          logicalOperationId: null,
          status: "BLOCKED_PROVIDER" as const,
          reason: "STOPPED_AFTER_PROVIDER_BOT_WALL; PDP_NOT_EXECUTED",
        }
      : reserveWalmartOperation(budget, {
          operationKind: "SEARCH",
          candidateId: candidate.candidateId,
          targetKey: primaryIntent.normalizedQuery,
        });

    if (!searchOpRes.permitted || !searchOpRes.logicalOperationId) {
      const deferredId = computeWalmartEvidenceCompositeId(
        params.workspaceId,
        params.researchRunId,
        candidate.candidateId,
        null,
        searchOpRes.status.toLowerCase()
      );
      evidenceRows.push({
        id: deferredId,
        workspaceId: params.workspaceId,
        researchRunId: params.researchRunId,
        candidateId: candidate.candidateId,
        provider: "WALMART_US",
        itemId: null,
        canonicalProductUrl: null,
        sourceUrl: primaryIntent.jinaReaderUrl,
        finalUrl: null,
        title: null,
        brand: null,
        model: null,
        upc: null,
        price: null,
        currency: null,
        seller: null,
        locationPostalCode: null,
        locationStoreIds: [],
        availability: "UNKNOWN",
        queryStatus: searchOpRes.status,
        presence: "UNKNOWN",
        matchLevel: "UNCERTAIN",
        verifiedIdentity: false,
        matchReasons: [],
        rejectionReasons: [
          searchOpRes.reason || `SEARCH_SKIPPED:${searchOpRes.status}`,
        ],
        missingFields: [],
        appearanceProvenance: [],
        schemaCompatibility: "UNSUPPORTED_SCHEMA",
        schemaFieldPaths: [],
        evidenceOrigin: effectiveOrigin,
        isCached: false,
        isStale: false,
        requestedNoCache: false,
        observedCacheMetadata: null,
        requestHash: computeWalmartDeterministicHash({
          query: primaryIntent.normalizedQuery,
          status: searchOpRes.status,
        }),
        responseHash: computeWalmartDeterministicHash({
          status: searchOpRes.status,
        }),
        rawEvidenceHash: computeWalmartDeterministicHash({
          candidateId: candidate.candidateId,
          query: primaryIntent.normalizedQuery,
          status: searchOpRes.status,
        }),
        extractedFieldsHash: computeWalmartDeterministicHash({
          status: searchOpRes.status,
        }),
        localRequestRef: `wmt_skip_${params.researchRunId}_${candidate.candidateId}`,
        upstreamRequestId: null,
        lastAttemptAt: nowIso,
        observedAt: null,
        lastSuccessfulLiveQueryAt: null,
        queryScope: {
          query: primaryIntent.rawQuery,
          normalizedQuery: primaryIntent.normalizedQuery,
          market: "US",
          checkedSearchCount: 0,
          checkedPdpCount: 0,
          rawSearchResultCount: null,
          dedupedSearchResultCount: null,
          completeSearchScope: false,
        },
        nonInflationNotice: WALMART_NON_INFLATION_NOTICE,
      });
      continue;
    }

    searchOperationsCount += 1;
    if (params.onProgress) {
      await params.onProgress({
        step: "WALMART_US_SEARCH",
        message: `Searching Walmart US via Jina Reader for '${primaryIntent.normalizedQuery}'`,
        logicalOperationsUsed: budget.logicalOperationsUsed,
        networkAttemptsUsed: budget.networkAttemptsUsed,
      });
    }

    const searchExec = await executeWalmartLogicalOperationWithRetry({
      budget,
      logicalOperationId: searchOpRes.logicalOperationId,
      operationKind: "SEARCH",
      query: primaryIntent.normalizedQuery,
      candidateId: candidate.candidateId,
      customFetch: params.customFetch,
      evidenceOrigin: effectiveOrigin,
      requestLedger,
      signal: params.signal,
    });

    const searchResp = searchExec.finalResponse;
    const searchAttemptAt =
      searchResp?.completedAt || new Date(budget.nowFn()).toISOString();

    if (!searchResp || !searchResp.ok || !searchResp.envelope?.html) {
      const failStatus = searchExec.finalStatus || "FAILED";
      if (failStatus === "BLOCKED_PROVIDER") {
        providerBlockedInRun = true;
      }
      const failId = computeWalmartEvidenceCompositeId(
        params.workspaceId,
        params.researchRunId,
        candidate.candidateId,
        null,
        `search_${failStatus}`
      );
      evidenceRows.push({
        id: failId,
        workspaceId: params.workspaceId,
        researchRunId: params.researchRunId,
        candidateId: candidate.candidateId,
        provider: "WALMART_US",
        itemId: null,
        canonicalProductUrl: null,
        sourceUrl: searchResp?.requestUrl || primaryIntent.jinaReaderUrl,
        finalUrl: searchResp?.envelope?.finalUrl || null,
        title: null,
        brand: null,
        model: null,
        upc: null,
        price: null,
        currency: null,
        seller: null,
        locationPostalCode: null,
        locationStoreIds: [],
        availability: "UNKNOWN",
        queryStatus: failStatus,
        presence: "UNKNOWN",
        matchLevel: "UNCERTAIN",
        verifiedIdentity: false,
        matchReasons: [],
        rejectionReasons: [
          searchResp?.errorCode || searchExec.statusReason || failStatus,
        ],
        missingFields: [],
        appearanceProvenance: [],
        schemaCompatibility: "UNSUPPORTED_SCHEMA",
        schemaFieldPaths: [],
        evidenceOrigin: searchResp?.evidenceOrigin || effectiveOrigin,
        isCached: false,
        isStale: false,
        requestedNoCache: searchResp?.requestedNoCache ?? true,
        observedCacheMetadata: searchResp?.observedCacheMetadata || null,
        requestHash:
          searchResp?.requestHash ||
          computeWalmartDeterministicHash({ query: primaryIntent.normalizedQuery }),
        responseHash:
          searchResp?.responseHash ||
          computeWalmartDeterministicHash({ status: failStatus }),
        rawEvidenceHash:
          searchResp?.responseHash ||
          computeWalmartDeterministicHash({
            candidateId: candidate.candidateId,
            status: failStatus,
          }),
        extractedFieldsHash: computeWalmartDeterministicHash({
          status: failStatus,
        }),
        localRequestRef:
          searchResp?.localRequestRef || searchOpRes.logicalOperationId,
        upstreamRequestId: searchResp?.upstreamRequestId || null,
        lastAttemptAt: searchAttemptAt,
        observedAt: null,
        lastSuccessfulLiveQueryAt: null,
        queryScope: {
          query: primaryIntent.rawQuery,
          normalizedQuery: primaryIntent.normalizedQuery,
          market: "US",
          checkedSearchCount: 1,
          checkedPdpCount: 0,
          rawSearchResultCount: null,
          dedupedSearchResultCount: null,
          completeSearchScope: false,
        },
        nonInflationNotice: WALMART_NON_INFLATION_NOTICE,
      });
      continue;
    }

    // Extract and parse search `__NEXT_DATA__`
    const searchScript = extractNextDataScript(
      searchResp.envelope.html,
      effectiveLimits.maxNextDataBytes
    );
    if (!searchScript.ok || !searchScript.parsedJson) {
      const errStatus = searchScript.queryStatus;
      const errId = computeWalmartEvidenceCompositeId(
        params.workspaceId,
        params.researchRunId,
        candidate.candidateId,
        null,
        `search_script_${searchScript.errorCode}`
      );
      evidenceRows.push({
        id: errId,
        workspaceId: params.workspaceId,
        researchRunId: params.researchRunId,
        candidateId: candidate.candidateId,
        provider: "WALMART_US",
        itemId: null,
        canonicalProductUrl: null,
        sourceUrl: searchResp.requestUrl,
        finalUrl: searchResp.envelope.finalUrl,
        title: null,
        brand: null,
        model: null,
        upc: null,
        price: null,
        currency: null,
        seller: null,
        locationPostalCode: null,
        locationStoreIds: [],
        availability: "UNKNOWN",
        queryStatus: errStatus,
        presence: "UNKNOWN",
        matchLevel: "UNCERTAIN",
        verifiedIdentity: false,
        matchReasons: [],
        rejectionReasons: [
          searchScript.errorCode || "SEARCH_NEXT_DATA_EXTRACTION_FAILED",
          searchScript.errorMessage || "",
        ].filter(Boolean),
        missingFields: [],
        appearanceProvenance: [],
        schemaCompatibility: "UNSUPPORTED_SCHEMA",
        schemaFieldPaths: [],
        evidenceOrigin: searchResp.evidenceOrigin,
        isCached: false,
        isStale: false,
        requestedNoCache: searchResp.requestedNoCache,
        observedCacheMetadata: searchResp.observedCacheMetadata,
        requestHash: searchResp.requestHash,
        responseHash: searchResp.responseHash,
        rawEvidenceHash: searchResp.responseHash,
        extractedFieldsHash: computeWalmartDeterministicHash({
          error: searchScript.errorCode,
        }),
        localRequestRef: searchResp.localRequestRef,
        upstreamRequestId: searchResp.upstreamRequestId,
        lastAttemptAt: searchAttemptAt,
        observedAt: null,
        lastSuccessfulLiveQueryAt: null,
        queryScope: {
          query: primaryIntent.rawQuery,
          normalizedQuery: primaryIntent.normalizedQuery,
          market: "US",
          checkedSearchCount: 1,
          checkedPdpCount: 0,
          rawSearchResultCount: null,
          dedupedSearchResultCount: null,
          completeSearchScope: false,
        },
        nonInflationNotice: WALMART_NON_INFLATION_NOTICE,
      });
      continue;
    }

    const searchParsed = parseWalmartSearchNextData(searchScript.parsedJson, {
      expectedQuery: primaryIntent.normalizedQuery,
      finalUrl: searchResp.envelope.finalUrl,
      pageTitle: searchResp.envelope.title,
    });

    if (!searchParsed.ok) {
      const parseFailId = computeWalmartEvidenceCompositeId(
        params.workspaceId,
        params.researchRunId,
        candidate.candidateId,
        null,
        `search_parse_${searchParsed.errorCode}`
      );
      evidenceRows.push({
        id: parseFailId,
        workspaceId: params.workspaceId,
        researchRunId: params.researchRunId,
        candidateId: candidate.candidateId,
        provider: "WALMART_US",
        itemId: null,
        canonicalProductUrl: null,
        sourceUrl: searchResp.requestUrl,
        finalUrl: searchResp.envelope.finalUrl,
        title: null,
        brand: null,
        model: null,
        upc: null,
        price: null,
        currency: null,
        seller: null,
        locationPostalCode: null,
        locationStoreIds: [],
        availability: "UNKNOWN",
        queryStatus: searchParsed.queryStatus,
        presence: "UNKNOWN",
        matchLevel: "UNCERTAIN",
        verifiedIdentity: false,
        matchReasons: [],
        rejectionReasons: [
          searchParsed.errorCode || "SEARCH_PARSE_FAILED",
          searchParsed.errorMessage || "",
        ].filter(Boolean),
        missingFields: [],
        appearanceProvenance: [],
        schemaCompatibility: searchParsed.schemaCompatibility,
        schemaFieldPaths: searchParsed.schemaFieldPaths,
        evidenceOrigin: searchResp.evidenceOrigin,
        isCached: false,
        isStale: false,
        requestedNoCache: searchResp.requestedNoCache,
        observedCacheMetadata: searchResp.observedCacheMetadata,
        requestHash: searchResp.requestHash,
        responseHash: searchResp.responseHash,
        rawEvidenceHash: searchResp.responseHash,
        extractedFieldsHash: computeWalmartDeterministicHash({
          error: searchParsed.errorCode,
        }),
        localRequestRef: searchResp.localRequestRef,
        upstreamRequestId: searchResp.upstreamRequestId,
        lastAttemptAt: searchAttemptAt,
        observedAt: null,
        lastSuccessfulLiveQueryAt: null,
        queryScope: {
          query: primaryIntent.rawQuery,
          normalizedQuery: primaryIntent.normalizedQuery,
          market: "US",
          checkedSearchCount: 1,
          checkedPdpCount: 0,
          rawSearchResultCount: null,
          dedupedSearchResultCount: null,
          completeSearchScope: false,
        },
        nonInflationNotice: WALMART_NON_INFLATION_NOTICE,
      });
      continue;
    }

    // Valid empty search => NO_MATCH_IN_SCOPE (W16)
    if (searchParsed.listings.length === 0) {
      const emptyId = computeWalmartEvidenceCompositeId(
        params.workspaceId,
        params.researchRunId,
        candidate.candidateId,
        null,
        "empty_search"
      );
      evidenceRows.push({
        id: emptyId,
        workspaceId: params.workspaceId,
        researchRunId: params.researchRunId,
        candidateId: candidate.candidateId,
        provider: "WALMART_US",
        itemId: null,
        canonicalProductUrl: null,
        sourceUrl: searchResp.requestUrl,
        finalUrl: searchResp.envelope.finalUrl || primaryIntent.targetWalmartUrl,
        title: null,
        brand: null,
        model: null,
        upc: null,
        price: null,
        currency: null,
        seller: null,
        locationPostalCode: null,
        locationStoreIds: [],
        availability: "UNKNOWN",
        queryStatus: "SUCCEEDED",
        presence: searchParsed.presence, // "NO_MATCH_IN_SCOPE"
        matchLevel: "UNCERTAIN",
        verifiedIdentity: false,
        matchReasons: [],
        rejectionReasons: [
          `NO_MATCHING_WALMART_LISTINGS_IN_SEARCH_SCOPE:query='${primaryIntent.normalizedQuery}'`,
        ],
        missingFields: [],
        appearanceProvenance: [],
        schemaCompatibility: searchParsed.schemaCompatibility,
        schemaFieldPaths: searchParsed.schemaFieldPaths,
        evidenceOrigin: searchResp.evidenceOrigin,
        isCached: false,
        isStale: false,
        requestedNoCache: searchResp.requestedNoCache,
        observedCacheMetadata: searchResp.observedCacheMetadata,
        requestHash: searchResp.requestHash,
        responseHash: searchResp.responseHash,
        rawEvidenceHash: searchResp.responseHash,
        extractedFieldsHash: computeWalmartDeterministicHash({
          presence: searchParsed.presence,
          query: primaryIntent.normalizedQuery,
          rawItemCount: 0,
        }),
        localRequestRef: searchResp.localRequestRef,
        upstreamRequestId: searchResp.upstreamRequestId,
        lastAttemptAt: searchAttemptAt,
        observedAt: searchAttemptAt,
        lastSuccessfulLiveQueryAt:
          searchResp.evidenceOrigin === "REAL_JINA_READER"
            ? searchAttemptAt
            : null,
        queryScope: {
          query: primaryIntent.rawQuery,
          normalizedQuery: primaryIntent.normalizedQuery,
          market: "US",
          checkedSearchCount: 1,
          checkedPdpCount: 0,
          rawSearchResultCount: searchParsed.rawItemCount,
          dedupedSearchResultCount: searchParsed.dedupedItemCount,
          completeSearchScope: searchParsed.completeSearchScope,
        },
        nonInflationNotice: WALMART_NON_INFLATION_NOTICE,
      });
      continue;
    }

    // Choose high-signal PDP target(s) within remaining logical-operation cap
    const remainingOps = Math.max(
      0,
      effectiveLimits.maxLogicalOperationsPerRun - budget.logicalOperationsUsed
    );
    // Reserve at most 1 primary PDP per candidate during enrichment so each candidate gets its single best-matching PDP
    const maxPdpForThisCandidate = Math.min(1, remainingOps);

    const chosenTargets = chooseWalmartPdpTargets(
      searchParsed.listings,
      maxPdpForThisCandidate,
      candidate,
      fetchedPdpItemIds
    );

    if (chosenTargets.length === 0) {
      // Either remainingOps === 0 (budget exhausted after search) or all search listings were accessories/low-signal
      const bestListing = searchParsed.listings[0];
      const prelim = compareCandidateToWalmartListing(
        candidate,
        bestListing,
        null
      );
      const isBudgetCapped = remainingOps === 0;
      const searchOnlyStatus: WalmartQueryExecutionStatus = isBudgetCapped
        ? "PARTIAL"
        : "SUCCEEDED";
      const searchOnlyPresence: MarketplacePresence =
        prelim.isAccessoryMismatch ||
        prelim.rejectionReasons.some((r) => r.startsWith("BRAND_MISMATCH"))
          ? "NO_MATCH_IN_SCOPE"
          : "FOUND";

      const searchOnlyId = computeWalmartEvidenceCompositeId(
        params.workspaceId,
        params.researchRunId,
        candidate.candidateId,
        bestListing.itemId,
        "search_only"
      );

      evidenceRows.push({
        id: searchOnlyId,
        workspaceId: params.workspaceId,
        researchRunId: params.researchRunId,
        candidateId: candidate.candidateId,
        provider: "WALMART_US",
        itemId: bestListing.itemId,
        canonicalProductUrl: bestListing.canonicalProductUrl,
        sourceUrl: searchResp.requestUrl,
        finalUrl: searchResp.envelope.finalUrl || primaryIntent.targetWalmartUrl,
        title: bestListing.title,
        brand: bestListing.brand,
        model: bestListing.modelNumber,
        upc: bestListing.upc,
        price: bestListing.price,
        currency: bestListing.currency,
        seller: bestListing.sellerName,
        locationPostalCode: null,
        locationStoreIds: [],
        availability: bestListing.availability,
        queryStatus: searchOnlyStatus,
        presence: searchOnlyPresence,
        matchLevel: prelim.matchLevel,
        verifiedIdentity: prelim.verifiedIdentity,
        matchReasons: prelim.matchReasons,
        rejectionReasons: isBudgetCapped
          ? [
              ...prelim.rejectionReasons,
              "PDP_DEFERRED_LOGICAL_OPERATION_CAP_REACHED",
            ]
          : prelim.rejectionReasons,
        missingFields: prelim.missingFields,
        appearanceProvenance: bestListing.appearanceProvenance,
        schemaCompatibility: searchParsed.schemaCompatibility,
        schemaFieldPaths: searchParsed.schemaFieldPaths,
        evidenceOrigin: searchResp.evidenceOrigin,
        isCached: false,
        isStale: false,
        requestedNoCache: searchResp.requestedNoCache,
        observedCacheMetadata: searchResp.observedCacheMetadata,
        requestHash: searchResp.requestHash,
        responseHash: searchResp.responseHash,
        rawEvidenceHash: searchResp.responseHash,
        extractedFieldsHash: bestListing.rawItemHash,
        localRequestRef: searchResp.localRequestRef,
        upstreamRequestId: searchResp.upstreamRequestId,
        lastAttemptAt: searchAttemptAt,
        observedAt: searchAttemptAt,
        lastSuccessfulLiveQueryAt:
          searchResp.evidenceOrigin === "REAL_JINA_READER"
            ? searchAttemptAt
            : null,
        queryScope: {
          query: primaryIntent.rawQuery,
          normalizedQuery: primaryIntent.normalizedQuery,
          market: "US",
          checkedSearchCount: 1,
          checkedPdpCount: 0,
          rawSearchResultCount: searchParsed.rawItemCount,
          dedupedSearchResultCount: searchParsed.dedupedItemCount,
          completeSearchScope: searchParsed.completeSearchScope,
        },
        nonInflationNotice: WALMART_NON_INFLATION_NOTICE,
      });
      continue;
    }

    // Fetch PDP for chosen target(s)
    for (const target of chosenTargets) {
      const pdpOpRes = reserveWalmartOperation(budget, {
        operationKind: "PDP",
        candidateId: candidate.candidateId,
        targetKey: target.itemId,
      });

      if (!pdpOpRes.permitted || !pdpOpRes.logicalOperationId) {
        break;
      }

      fetchedPdpItemIds.add(target.itemId);
      pdpOperationsCount += 1;

      if (params.onProgress) {
        await params.onProgress({
          step: "WALMART_US_PDP",
          message: `Inspecting Walmart US PDP /ip/${target.itemId} via Jina Reader`,
          logicalOperationsUsed: budget.logicalOperationsUsed,
          networkAttemptsUsed: budget.networkAttemptsUsed,
        });
      }

      const pdpExec = await executeWalmartLogicalOperationWithRetry({
        budget,
        logicalOperationId: pdpOpRes.logicalOperationId,
        operationKind: "PDP",
        itemId: target.itemId,
        candidateId: candidate.candidateId,
        customFetch: params.customFetch,
        evidenceOrigin: effectiveOrigin,
        requestLedger,
        signal: params.signal,
      });

      const pdpResp = pdpExec.finalResponse;
      const pdpAttemptAt =
        pdpResp?.completedAt || new Date(budget.nowFn()).toISOString();

      if (!pdpResp || !pdpResp.ok || !pdpResp.envelope?.html) {
        const pdpFailStatus = pdpExec.finalStatus || "FAILED";
        const pdpFailId = computeWalmartEvidenceCompositeId(
          params.workspaceId,
          params.researchRunId,
          candidate.candidateId,
          target.itemId,
          `pdp_${pdpFailStatus}`
        );
        evidenceRows.push({
          id: pdpFailId,
          workspaceId: params.workspaceId,
          researchRunId: params.researchRunId,
          candidateId: candidate.candidateId,
          provider: "WALMART_US",
          itemId: target.itemId,
          canonicalProductUrl: target.listing.canonicalProductUrl,
          sourceUrl:
            pdpResp?.requestUrl ||
            `https://r.jina.ai/https://www.walmart.com/ip/${target.itemId}`,
          finalUrl: pdpResp?.envelope?.finalUrl || null,
          title: target.listing.title,
          brand: target.listing.brand,
          model: target.listing.modelNumber,
          upc: target.listing.upc,
          price: null,
          currency: null,
          seller: null,
          locationPostalCode: null,
          locationStoreIds: [],
          availability: "UNKNOWN",
          queryStatus: pdpFailStatus,
          presence: "UNKNOWN",
          matchLevel: "UNCERTAIN",
          verifiedIdentity: false,
          matchReasons: [],
          rejectionReasons: [
            pdpResp?.errorCode || pdpExec.statusReason || pdpFailStatus,
          ],
          missingFields: ["pdpVerification"],
          appearanceProvenance: target.listing.appearanceProvenance,
          schemaCompatibility: "UNSUPPORTED_SCHEMA",
          schemaFieldPaths: [],
          evidenceOrigin: pdpResp?.evidenceOrigin || effectiveOrigin,
          isCached: false,
          isStale: false,
          requestedNoCache: pdpResp?.requestedNoCache ?? true,
          observedCacheMetadata: pdpResp?.observedCacheMetadata || null,
          requestHash:
            pdpResp?.requestHash ||
            computeWalmartDeterministicHash({ itemId: target.itemId }),
          responseHash:
            pdpResp?.responseHash ||
            computeWalmartDeterministicHash({ status: pdpFailStatus }),
          rawEvidenceHash:
            pdpResp?.responseHash ||
            computeWalmartDeterministicHash({
              itemId: target.itemId,
              status: pdpFailStatus,
            }),
          extractedFieldsHash: computeWalmartDeterministicHash({
            status: pdpFailStatus,
          }),
          localRequestRef:
            pdpResp?.localRequestRef || pdpOpRes.logicalOperationId,
          upstreamRequestId: pdpResp?.upstreamRequestId || null,
          lastAttemptAt: pdpAttemptAt,
          observedAt: null,
          lastSuccessfulLiveQueryAt: null,
          queryScope: {
            query: primaryIntent.rawQuery,
            normalizedQuery: primaryIntent.normalizedQuery,
            market: "US",
            checkedSearchCount: 1,
            checkedPdpCount: 1,
            rawSearchResultCount: searchParsed.rawItemCount,
            dedupedSearchResultCount: searchParsed.dedupedItemCount,
            completeSearchScope: searchParsed.completeSearchScope,
          },
          nonInflationNotice: WALMART_NON_INFLATION_NOTICE,
        });
        continue;
      }

      const pdpScript = extractNextDataScript(
        pdpResp.envelope.html,
        effectiveLimits.maxNextDataBytes
      );
      if (!pdpScript.ok || !pdpScript.parsedJson) {
        const scriptFailId = computeWalmartEvidenceCompositeId(
          params.workspaceId,
          params.researchRunId,
          candidate.candidateId,
          target.itemId,
          `pdp_script_${pdpScript.errorCode}`
        );
        evidenceRows.push({
          id: scriptFailId,
          workspaceId: params.workspaceId,
          researchRunId: params.researchRunId,
          candidateId: candidate.candidateId,
          provider: "WALMART_US",
          itemId: target.itemId,
          canonicalProductUrl: target.listing.canonicalProductUrl,
          sourceUrl: pdpResp.requestUrl,
          finalUrl: pdpResp.envelope.finalUrl,
          title: null,
          brand: null,
          model: null,
          upc: null,
          price: null,
          currency: null,
          seller: null,
          locationPostalCode: null,
          locationStoreIds: [],
          availability: "UNKNOWN",
          queryStatus: pdpScript.queryStatus,
          presence: "UNKNOWN",
          matchLevel: "UNCERTAIN",
          verifiedIdentity: false,
          matchReasons: [],
          rejectionReasons: [
            pdpScript.errorCode || "PDP_NEXT_DATA_EXTRACTION_FAILED",
            pdpScript.errorMessage || "",
          ].filter(Boolean),
          missingFields: [],
          appearanceProvenance: target.listing.appearanceProvenance,
          schemaCompatibility: "UNSUPPORTED_SCHEMA",
          schemaFieldPaths: [],
          evidenceOrigin: pdpResp.evidenceOrigin,
          isCached: false,
          isStale: false,
          requestedNoCache: pdpResp.requestedNoCache,
          observedCacheMetadata: pdpResp.observedCacheMetadata,
          requestHash: pdpResp.requestHash,
          responseHash: pdpResp.responseHash,
          rawEvidenceHash: pdpResp.responseHash,
          extractedFieldsHash: computeWalmartDeterministicHash({
            error: pdpScript.errorCode,
          }),
          localRequestRef: pdpResp.localRequestRef,
          upstreamRequestId: pdpResp.upstreamRequestId,
          lastAttemptAt: pdpAttemptAt,
          observedAt: null,
          lastSuccessfulLiveQueryAt: null,
          queryScope: {
            query: primaryIntent.rawQuery,
            normalizedQuery: primaryIntent.normalizedQuery,
            market: "US",
            checkedSearchCount: 1,
            checkedPdpCount: 1,
            rawSearchResultCount: searchParsed.rawItemCount,
            dedupedSearchResultCount: searchParsed.dedupedItemCount,
            completeSearchScope: searchParsed.completeSearchScope,
          },
          nonInflationNotice: WALMART_NON_INFLATION_NOTICE,
        });
        continue;
      }

      const pdpParsed = parseWalmartPdpNextData(pdpScript.parsedJson, {
        expectedItemId: target.itemId,
        finalUrl: pdpResp.envelope.finalUrl,
        pageTitle: pdpResp.envelope.title,
      });

      if (!pdpParsed.ok || !pdpParsed.product) {
        const pdpParseErrId = computeWalmartEvidenceCompositeId(
          params.workspaceId,
          params.researchRunId,
          candidate.candidateId,
          target.itemId,
          `pdp_parse_${pdpParsed.errorCode}`
        );
        evidenceRows.push({
          id: pdpParseErrId,
          workspaceId: params.workspaceId,
          researchRunId: params.researchRunId,
          candidateId: candidate.candidateId,
          provider: "WALMART_US",
          itemId: target.itemId,
          canonicalProductUrl: target.listing.canonicalProductUrl,
          sourceUrl: pdpResp.requestUrl,
          finalUrl: pdpResp.envelope.finalUrl,
          title: null,
          brand: null,
          model: null,
          upc: null,
          price: null,
          currency: null,
          seller: null,
          locationPostalCode: null,
          locationStoreIds: [],
          availability: "UNKNOWN",
          queryStatus: pdpParsed.queryStatus,
          presence: "UNKNOWN",
          matchLevel: "UNCERTAIN",
          verifiedIdentity: false,
          matchReasons: [],
          rejectionReasons: [
            pdpParsed.errorCode || "PDP_PARSE_FAILED",
            pdpParsed.errorMessage || "",
          ].filter(Boolean),
          missingFields: [],
          appearanceProvenance: target.listing.appearanceProvenance,
          schemaCompatibility: pdpParsed.schemaCompatibility,
          schemaFieldPaths: pdpParsed.schemaFieldPaths,
          evidenceOrigin: pdpResp.evidenceOrigin,
          isCached: false,
          isStale: false,
          requestedNoCache: pdpResp.requestedNoCache,
          observedCacheMetadata: pdpResp.observedCacheMetadata,
          requestHash: pdpResp.requestHash,
          responseHash: pdpResp.responseHash,
          rawEvidenceHash: pdpResp.responseHash,
          extractedFieldsHash: computeWalmartDeterministicHash({
            error: pdpParsed.errorCode,
          }),
          localRequestRef: pdpResp.localRequestRef,
          upstreamRequestId: pdpResp.upstreamRequestId,
          lastAttemptAt: pdpAttemptAt,
          observedAt: null,
          lastSuccessfulLiveQueryAt: null,
          queryScope: {
            query: primaryIntent.rawQuery,
            normalizedQuery: primaryIntent.normalizedQuery,
            market: "US",
            checkedSearchCount: 1,
            checkedPdpCount: 1,
            rawSearchResultCount: searchParsed.rawItemCount,
            dedupedSearchResultCount: searchParsed.dedupedItemCount,
            completeSearchScope: searchParsed.completeSearchScope,
          },
          nonInflationNotice: WALMART_NON_INFLATION_NOTICE,
        });
        continue;
      }

      const pdpProduct = pdpParsed.product;
      const decision = compareCandidateToWalmartListing(
        candidate,
        target.listing,
        pdpProduct
      );

      const evId = computeWalmartEvidenceCompositeId(
        params.workspaceId,
        params.researchRunId,
        candidate.candidateId,
        pdpProduct.usItemId,
        pdpResp.responseHash.slice(0, 12)
      );

      evidenceRows.push({
        id: evId,
        workspaceId: params.workspaceId,
        researchRunId: params.researchRunId,
        candidateId: candidate.candidateId,
        provider: "WALMART_US",
        itemId: pdpProduct.usItemId,
        canonicalProductUrl: pdpProduct.canonicalUrl,
        sourceUrl: pdpResp.requestUrl,
        finalUrl: pdpResp.envelope.finalUrl || pdpProduct.canonicalUrl,
        title: pdpProduct.title,
        brand: pdpProduct.brand,
        model: pdpProduct.model,
        upc: pdpProduct.upc,
        price: pdpProduct.price,
        currency: pdpProduct.currency,
        seller: pdpProduct.sellerDisplayName,
        locationPostalCode: pdpProduct.locationPostalCode,
        locationStoreIds: pdpProduct.locationStoreIds,
        availability: pdpProduct.availability,
        queryStatus: "SUCCEEDED",
        presence: "FOUND", // Even if OUT_OF_STOCK, listing existence is FOUND (W26)
        matchLevel: decision.matchLevel,
        verifiedIdentity: decision.verifiedIdentity,
        matchReasons: decision.matchReasons,
        rejectionReasons: decision.rejectionReasons,
        missingFields: decision.missingFields,
        appearanceProvenance: target.listing.appearanceProvenance,
        schemaCompatibility: pdpProduct.schemaCompatibility,
        schemaFieldPaths: pdpProduct.schemaFieldPaths,
        evidenceOrigin: pdpResp.evidenceOrigin,
        isCached: false,
        isStale: false,
        requestedNoCache: pdpResp.requestedNoCache,
        observedCacheMetadata: pdpResp.observedCacheMetadata,
        requestHash: pdpResp.requestHash,
        responseHash: pdpResp.responseHash,
        rawEvidenceHash: pdpResp.responseHash,
        extractedFieldsHash: pdpProduct.rawProductHash,
        localRequestRef: pdpResp.localRequestRef,
        upstreamRequestId: pdpResp.upstreamRequestId,
        lastAttemptAt: pdpAttemptAt,
        observedAt: pdpAttemptAt,
        lastSuccessfulLiveQueryAt:
          pdpResp.evidenceOrigin === "REAL_JINA_READER" ? pdpAttemptAt : null,
        queryScope: {
          query: primaryIntent.rawQuery,
          normalizedQuery: primaryIntent.normalizedQuery,
          market: "US",
          checkedSearchCount: 1,
          checkedPdpCount: 1,
          rawSearchResultCount: searchParsed.rawItemCount,
          dedupedSearchResultCount: searchParsed.dedupedItemCount,
          completeSearchScope: searchParsed.completeSearchScope,
        },
        nonInflationNotice: WALMART_NON_INFLATION_NOTICE,
      });
    }
  }

  // Compute aggregated provider telemetry
  const succeededCount = evidenceRows.filter(
    (r) => r.queryStatus === "SUCCEEDED"
  ).length;
  const partialCount = evidenceRows.filter(
    (r) => r.queryStatus === "PARTIAL"
  ).length;
  const deferredCount = evidenceRows.filter(
    (r) =>
      r.queryStatus === "DEFERRED" || r.queryStatus === "BUDGET_EXHAUSTED"
  ).length;
  const timedOutCount = evidenceRows.filter(
    (r) => r.queryStatus === "TIMED_OUT"
  ).length;
  const rateLimitedCount = evidenceRows.filter(
    (r) => r.queryStatus === "RATE_LIMITED"
  ).length;
  const blockedProviderCount = evidenceRows.filter(
    (r) =>
      r.queryStatus === "BLOCKED_PROVIDER" ||
      r.queryStatus === "KEY_OR_PAYMENT_REQUIRED"
  ).length;
  const parseErrorCount = evidenceRows.filter(
    (r) => r.queryStatus === "PARSE_ERROR"
  ).length;
  const cancelledCount = evidenceRows.filter(
    (r) => r.queryStatus === "CANCELLED"
  ).length;
  const failedCount = evidenceRows.filter(
    (r) => r.queryStatus === "FAILED" || r.queryStatus === "UNAVAILABLE"
  ).length;
  const nonSucceededCount = evidenceRows.filter(
    (r) => r.queryStatus !== "SUCCEEDED"
  ).length;

  const foundCount = evidenceRows.filter((r) => r.presence === "FOUND").length;
  const noMatchInScopeCount = evidenceRows.filter(
    (r) => r.presence === "NO_MATCH_IN_SCOPE"
  ).length;
  const unknownPresenceCount = evidenceRows.filter(
    (r) => r.presence === "UNKNOWN"
  ).length;

  const exactMatchCount = evidenceRows.filter(
    (r) => r.matchLevel === "EXACT"
  ).length;
  const similarMatchCount = evidenceRows.filter(
    (r) => r.matchLevel === "SIMILAR"
  ).length;
  const uncertainMatchCount = evidenceRows.filter(
    (r) => r.matchLevel === "UNCERTAIN"
  ).length;

  const realJinaVerifiedCount = evidenceRows.filter(
    (r) =>
      r.evidenceOrigin === "REAL_JINA_READER" &&
      r.queryStatus === "SUCCEEDED" &&
      !r.isCached
  ).length;
  const fixtureOrCachedCount = evidenceRows.filter(
    (r) => r.evidenceOrigin !== "REAL_JINA_READER" || r.isCached
  ).length;

  let overallStatus: WalmartQueryExecutionStatus = "SUCCEEDED";
  let statusReason = `Walmart US Jina Reader pilot completed (${budget.logicalOperationsUsed}/${effectiveLimits.maxLogicalOperationsPerRun} ops, ${foundCount} found, ${noMatchInScopeCount} scoped no-match).`;

  if (budget.isFreePilotStopped().stopped) {
    overallStatus = "KEY_OR_PAYMENT_REQUIRED";
    statusReason =
      budget.isFreePilotStopped().reason ||
      "Free no-key Jina Reader access restricted (401/402).";
  } else if (budget.isCancelled()) {
    overallStatus = "CANCELLED";
    statusReason = budget.cancelReason || "Walmart enrichment cancelled.";
  } else if (succeededCount > 0 && nonSucceededCount > 0) {
    overallStatus = "PARTIAL";
    statusReason = `Walmart US pilot partially completed (${succeededCount} succeeded, ${nonSucceededCount} non-succeeded).`;
  } else if (succeededCount === 0 && evidenceRows.length > 0) {
    overallStatus = evidenceRows[0].queryStatus;
    statusReason =
      evidenceRows[0].rejectionReasons.join("; ") ||
      `Walmart US pilot ended with status ${overallStatus}.`;
  } else if (evidenceRows.length === 0) {
    overallStatus = "NOT_ATTEMPTED";
    statusReason = "No eligible shortlisted candidates to enrich.";
  }

  const lastAttemptAt =
    requestLedger.length > 0
      ? requestLedger[requestLedger.length - 1].completedAt
      : evidenceRows[0]?.lastAttemptAt || null;

  const liveSuccessRows = evidenceRows.filter(
    (r) => r.lastSuccessfulLiveQueryAt
  );
  const lastSuccessfulLiveQueryAt =
    liveSuccessRows.length > 0
      ? liveSuccessRows[liveSuccessRows.length - 1].lastSuccessfulLiveQueryAt
      : null;

  const cooldownUntilMs = budget.getCooldownUntilMs();
  const cooldownUntil =
    cooldownUntilMs > budget.nowFn()
      ? new Date(cooldownUntilMs).toISOString()
      : null;

  const telemetry: WalmartProviderTelemetry = {
    provider: "WALMART_US",
    workspaceId: params.workspaceId,
    researchRunId: params.researchRunId,
    featureEnabled: policy.featureEnabled,
    liveAllowed: policy.liveAllowed,
    freeReaderMode: true,
    requiresApiKey: false,
    authenticated: false,
    chargedCreditsOrDollars: 0,
    overallStatus,
    statusReason,
    shortlistedTargetsCount: targetCandidates.length,
    logicalOperationsUsed: budget.logicalOperationsUsed,
    logicalOperationsLimit: effectiveLimits.maxLogicalOperationsPerRun,
    networkAttemptsUsed: budget.networkAttemptsUsed,
    networkAttemptsLimit: effectiveLimits.maxNetworkAttemptsPerRun,
    searchOperationsCount,
    pdpOperationsCount,
    succeededCount,
    partialCount,
    deferredCount,
    timedOutCount,
    rateLimitedCount,
    blockedProviderCount,
    parseErrorCount,
    cancelledCount,
    foundCount,
    noMatchInScopeCount,
    unknownPresenceCount,
    exactMatchCount,
    similarMatchCount,
    uncertainMatchCount,
    realJinaVerifiedCount,
    fixtureOrCachedCount,
    rollingMinuteRequestsObserved: budget.getRollingWindowRequestCount(),
    rollingMinuteLimit: effectiveLimits.maxRequestsPerMinuteAcrossWorkers,
    cooldownUntil,
    lastAttemptAt,
    lastSuccessfulLiveQueryAt,
    persistenceStatus: "NOT_APPLICABLE",
    persistenceError: null,
    requestLedger,
    operationalStatus: policy.operationalStatus,
    upstreamBlockerStatus: policy.upstreamBlockerStatus,
    priorLiveBlockerReference: policy.priorLiveBlockerReference ?? null,
  };

  const summariesByCandidateId: Record<string, WalmartEvidenceSummary> = {};
  for (const cand of targetCandidates) {
    summariesByCandidateId[cand.candidateId] =
      summarizeWalmartEvidenceForCandidate(
        cand.candidateId,
        params.researchRunId,
        evidenceRows,
        { telemetry, policy }
      );
  }

  return {
    evidenceRows,
    telemetry,
    summariesByCandidateId,
  };
}
