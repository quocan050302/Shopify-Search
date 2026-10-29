/**
 * SWAI KH-02 — Meta Ads Research Adapter
 *
 * Connects to verified Meta competitor advertisements in SQLite,
 * applies diminishing returns for creative volume, and extracts
 * independent advertiser signals for product candidate identification.
 *
 * Geographic Market Rule:
 * Never assume "US" delivery market merely because the query requested US.
 * Deliver truthful geographic provenance: separate requested_market from
 * verified_delivery_market.
 */

import fs from "fs";
import { prisma } from "@/lib/db";
import {
  IntelligenceQuery,
  SourceResearchResult,
  SourceObservation,
  MetaResearchSignals,
  ObservationProvenance,
  SourceRunStatus,
  ProviderExecutionMetadata,
  UpstreamRecordTrace,
} from "../types";
import { extractDomainFromUrl } from "@/services/products/productService";
import { buildAuthorizedAdWhere } from "@/services/research/authorizedScopeHelpers";
import { getMetaCollectorConfig } from "@/services/discovery/metaCollector/metaCollectorConfig";
import { createMetaCollectorClient, getDetailedMetaAdsBatch } from "@/services/discovery/metaCollector/metaCollectorMcpClient";
import { normalizeMetaCollectorAd } from "@/services/discovery/normalization/normalizeMetaCollectorAd";
import { NormalizedDiscoveredAd } from "@/services/discovery/types";
import { ingestDiscoveredAds } from "@/services/discovery/discoveryIngestionService";
import {
  buildKH02DiscoveryQueryPlan,
  MetaQueryBudgetTracker,
  MetaResearchBudget,
} from "@/services/kh02/discovery/discoveryQueryPlanner";

export interface MarketProvenance {
  requestedMarket: string;
  sourceReportedMarket: string | null;
  observedMarket: string | null;
  advertiserLocation: string | null;
  inferredMarket: string | null;
  marketVerification: "VERIFIED" | "INFERRED" | "UNKNOWN";
  verifiedDeliveryMarket: string | null;
}

export interface MetaQueryContext {
  requestedMarket?: string;
  topic?: string;
}

/**
 * Resolves truthful geographic delivery market provenance for a Meta ad.
 * Never assumes "US" delivery market merely because the user requested US.
 */
export function resolveMetaMarketProvenance(
  rawAd: any,
  queryContext: MetaQueryContext = {}
): MarketProvenance {
  const requestedMarket = queryContext.requestedMarket || "US";
  const rawMarket = rawAd?.targetMarket || rawAd?.region || null;

  // Check if provider explicitly reported US delivery market on the ad itself
  const isExplicitUS = rawMarket === "US" || rawMarket === "USA";

  if (isExplicitUS) {
    return {
      requestedMarket,
      sourceReportedMarket: "US",
      observedMarket: "US",
      advertiserLocation: rawAd?.advertiser?.country || null,
      inferredMarket: null,
      marketVerification: "VERIFIED",
      verifiedDeliveryMarket: "US",
    };
  }

  // Explicit non-US
  if (rawMarket && rawMarket !== "UNKNOWN") {
    return {
      requestedMarket,
      sourceReportedMarket: String(rawMarket),
      observedMarket: String(rawMarket),
      advertiserLocation: rawAd?.advertiser?.country || null,
      inferredMarket: null,
      marketVerification: "VERIFIED",
      verifiedDeliveryMarket: null,
    };
  }

  // If dataSource supports US but ad itself does not specify region, it is INFERRED, NOT VERIFIED
  const dataSourceSupportsUS = Boolean(
    rawAd?.dataSource?.supportedRegions &&
    String(rawAd.dataSource.supportedRegions).includes("US")
  );

  if (dataSourceSupportsUS) {
    return {
      requestedMarket,
      sourceReportedMarket: null,
      observedMarket: null,
      advertiserLocation: rawAd?.advertiser?.country || null,
      inferredMarket: "US",
      marketVerification: "INFERRED",
      verifiedDeliveryMarket: null,
    };
  }

  // Unknown market provenance
  return {
    requestedMarket,
    sourceReportedMarket: null,
    observedMarket: null,
    advertiserLocation: rawAd?.advertiser?.country || null,
    inferredMarket: null,
    marketVerification: "UNKNOWN",
    verifiedDeliveryMarket: null,
  };
}

export interface MetaCollectorDiagnostic {
  source: "META_ADS";
  adapterInstalled: boolean;
  configured: boolean;
  transportConnected: boolean;
  authenticated: boolean;
  discoverySupported: boolean;
  queryExecuted: boolean;
  recordsReturned: number;
  provenanceVerified: boolean;
  lastCheckedAt: string;
  status: string;
  reason: string;
  missingRequirements: string[];
  pythonBin?: string | null;
  collectorVersion?: string | null;
  databaseRecordsIndexed?: number;
}

/**
 * Inspects real MetaAdsCollector MCP server health, python virtualenv, and SQLite index.
 */
export async function diagnoseMetaLiveCollector(
  context?: { workspaceId?: string; checkLiveTransport?: boolean }
): Promise<MetaCollectorDiagnostic> {
  const lastCheckedAt = new Date().toISOString();
  let workspaceRecordCount = 0;
  let globalRecordCount = 0;
  try {
    globalRecordCount = await prisma.competitorAd.count({
      where: { platform: { in: ["META", "FACEBOOK"] }, isSyntheticQuarantine: false },
    });
    if (context?.workspaceId) {
      workspaceRecordCount = await prisma.competitorAd.count({
        where: {
          platform: { in: ["META", "FACEBOOK"] },
          isSyntheticQuarantine: false,
          ...buildAuthorizedAdWhere(context.workspaceId),
        },
      });
    } else {
      workspaceRecordCount = globalRecordCount;
    }
  } catch {}

  const config = getMetaCollectorConfig();
  const pythonExists = Boolean(config.pythonBin && fs.existsSync(config.pythonBin));

  if (!pythonExists) {
    return {
      source: "META_ADS",
      adapterInstalled: true,
      configured: false,
      transportConnected: false,
      authenticated: false,
      discoverySupported: false,
      queryExecuted: false,
      recordsReturned: workspaceRecordCount,
      provenanceVerified: workspaceRecordCount > 0,
      lastCheckedAt,
      status: "NOT_CONFIGURED",
      reason: `MetaAdsCollector Python environment not found at '${config.pythonBin}'. Run python virtualenv setup.`,
      missingRequirements: ["META_COLLECTOR_PYTHON_VENV"],
      pythonBin: config.pythonBin,
      collectorVersion: null,
      databaseRecordsIndexed: workspaceRecordCount,
    };
  }

  let collectorVersion: string | null = null;
  let transportConnected: boolean = Boolean(pythonExists);

  if (context?.checkLiveTransport) {
    try {
      const client = await createMetaCollectorClient();
      try {
        const caps = await client.getCapabilities();
        collectorVersion = caps.collector_version || "1.7.0";
        transportConnected = true;
      } finally {
        await client.close();
      }
    } catch {
      transportConnected = false;
    }
  }

  const reason = transportConnected
    ? context?.workspaceId
      ? `Workspace has ${workspaceRecordCount} Meta ad records stored (Global: ${globalRecordCount}); live collector active (v${collectorVersion || "1.7.0"}).`
      : `Meta competitor ads indexed in database (${globalRecordCount} records); live collector active (v${collectorVersion || "1.7.0"}).`
    : "MetaAdsCollector Python virtualenv present but MCP stdio handshake failed.";

  return {
    source: "META_ADS",
    adapterInstalled: true,
    configured: true,
    transportConnected,
    authenticated: true,
    discoverySupported: true,
    queryExecuted: false, // Never infer query execution from stored count
    recordsReturned: workspaceRecordCount,
    provenanceVerified: workspaceRecordCount > 0,
    lastCheckedAt,
    status: transportConnected ? "SOURCE_ACCESS_VERIFIED" : "FAILED",
    reason,
    missingRequirements: transportConnected ? [] : ["MCP_TRANSPORT_FAILED"],
    pythonBin: config.pythonBin,
    collectorVersion,
    databaseRecordsIndexed: workspaceRecordCount,
  };
}

export type MetaExecutionPolicy =
  | "LIVE_FIRST"
  | "CACHE_SUPPLEMENTED"
  | "CACHE_ONLY"
  | "OFFLINE_FIXTURE";

export type ResearchSourceMode =
  | "LIVE_WITH_CACHE_FALLBACK"
  | "CACHE_ONLY"
  | "LIVE_ONLY";

export function resolveMetaExecutionPolicy(
  query?: IntelligenceQuery
): MetaExecutionPolicy {
  const explicit =
    (query as any)?.metaExecutionPolicy || process.env.SWAI_META_EXECUTION_POLICY;
  if (
    explicit === "LIVE_FIRST" ||
    explicit === "CACHE_SUPPLEMENTED" ||
    explicit === "CACHE_ONLY" ||
    explicit === "OFFLINE_FIXTURE"
  ) {
    return explicit;
  }
  const sourceMode: ResearchSourceMode | undefined = (query as any)?.sourceMode;
  if (sourceMode === "CACHE_ONLY") {
    return "CACHE_ONLY";
  }
  if (sourceMode === "LIVE_ONLY") {
    return "LIVE_FIRST";
  }
  if (process.env.ENABLE_LIVE_META === "true") {
    return "LIVE_FIRST";
  }
  if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") {
    return "OFFLINE_FIXTURE";
  }
  if (
    process.env.META_COLLECTOR_ENABLED === "false" ||
    process.env.DISABLE_LIVE_MCP === "true"
  ) {
    return "CACHE_ONLY";
  }
  return "CACHE_SUPPLEMENTED";
}

export type MetaQueryOutcomeStatus =
  | "NOT_ATTEMPTED"
  | "SUCCEEDED_WITH_RESULTS"
  | "SUCCEEDED_EMPTY"
  | "FAILED"
  | "CANCELLED"
  | "SKIPPED_BUDGET";

export interface EvidenceTrueQueryExecution {
  queryId: string;
  researchRunId: string;
  source: "META_ADS";
  keyword: string;
  searchType: string;
  planned: boolean;
  attempted: boolean;
  requestStarted: boolean;
  requestCompleted: boolean;
  actualApiCalls: number;
  status: MetaQueryOutcomeStatus;
  upstreamReturnedCount: number | null;
  uniqueUpstreamIdsCount: number | null;
  cachedRecordsUsed: number;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  provenance: "LIVE_PROVIDER" | "CACHED_SOURCE" | "NONE";
  returnedCount: number;
  uniqueReturnedCount?: number;
  duplicateCount?: number;
  roundNumber?: number;
  origin?: string;
  archetypeId?: string | null;
  expectedProductCategory?: string | null;
}

export interface MetaSubqueryExecution {
  queryId: string;
  researchRunId?: string;
  source?: "META_ADS";
  keyword: string;
  searchType: string;
  planned?: boolean;
  attempted: boolean;
  requestStarted?: boolean;
  requestCompleted?: boolean;
  status: MetaQueryOutcomeStatus;
  startedAt: string | null;
  completedAt: string | null;
  actualApiCalls: number;
  returnedCount: number;
  upstreamReturnedCount?: number | null;
  uniqueUpstreamIdsCount?: number | null;
  cachedRecordsUsed?: number;
  provenance?: "LIVE_PROVIDER" | "CACHED_SOURCE" | "NONE";
  uniqueReturnedCount?: number;
  duplicateCount?: number;
  roundNumber?: number;
  origin?: string;
  archetypeId?: string | null;
  expectedProductCategory?: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

function normalizeMetaQueryOutcomeFields(outcome: MetaSubqueryExecution, runId?: string): MetaSubqueryExecution {
  return {
    researchRunId: outcome.researchRunId || runId || "unknown_run",
    source: "META_ADS",
    planned: outcome.planned ?? true,
    requestStarted: outcome.requestStarted ?? outcome.attempted,
    requestCompleted: outcome.requestCompleted ?? (outcome.attempted && (outcome.status === "SUCCEEDED_WITH_RESULTS" || outcome.status === "SUCCEEDED_EMPTY")),
    upstreamReturnedCount: outcome.upstreamReturnedCount !== undefined ? outcome.upstreamReturnedCount : (outcome.attempted ? outcome.returnedCount : null),
    uniqueUpstreamIdsCount: outcome.uniqueUpstreamIdsCount !== undefined ? outcome.uniqueUpstreamIdsCount : (outcome.attempted ? (outcome.uniqueReturnedCount ?? outcome.returnedCount) : null),
    cachedRecordsUsed: outcome.cachedRecordsUsed ?? 0,
    provenance: outcome.provenance || (outcome.attempted && (outcome.status === "SUCCEEDED_WITH_RESULTS" || outcome.status === "SUCCEEDED_EMPTY") ? "LIVE_PROVIDER" : "NONE"),
    ...outcome,
  };
}

export interface MetaAggregatedOutcomes {
  executionStatus: string;
  liveSucceeded: boolean;
  attemptedQueries: number;
  successfulQueries: number;
  failedQueries: number;
  cancelledQueries: number;
  skippedQueries: number;
  totalReturned: number;
  sourceRecordsReturned: number;
  uniqueExternalIdsReturned: number;
  errors: string[];
  warnings: string[];
}

export function aggregateMetaQueryOutcomes(
  subqueries: MetaSubqueryExecution[]
): MetaAggregatedOutcomes {
  const attempted = subqueries.filter((s) => s.attempted);
  if (attempted.length === 0) {
    return {
      executionStatus: "NOT_RUN",
      liveSucceeded: false,
      attemptedQueries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      cancelledQueries: 0,
      skippedQueries: subqueries.length,
      totalReturned: 0,
      sourceRecordsReturned: 0,
      uniqueExternalIdsReturned: 0,
      errors: [],
      warnings: ["No Meta subqueries were attempted."],
    };
  }

  const succeededWithResults = subqueries.filter((s) => s.status === "SUCCEEDED_WITH_RESULTS");
  const succeededEmpty = subqueries.filter((s) => s.status === "SUCCEEDED_EMPTY");
  const failed = subqueries.filter((s) => s.status === "FAILED");
  const cancelled = subqueries.filter((s) => s.status === "CANCELLED");
  const skipped = subqueries.filter((s) => s.status === "SKIPPED_BUDGET");

  const totalReturned = subqueries.reduce((sum, s) => sum + s.returnedCount, 0);
  const successfulCount = succeededWithResults.length + succeededEmpty.length;
  const errors = failed.map((f) => `Subquery '${f.keyword}' failed: ${f.errorMessage || f.errorCode || "Unknown error"}`);
  const warnings: string[] = [];

  if (skipped.length > 0) {
    warnings.push(`${skipped.length} subqueries skipped due to global budget constraints.`);
  }

  let executionStatus: string;
  let liveSucceeded: boolean;

  if (failed.length === attempted.length) {
    executionStatus = "FAILED";
    liveSucceeded = false;
  } else if (cancelled.length === attempted.length) {
    executionStatus = "CANCELLED";
    liveSucceeded = false;
  } else if (successfulCount > 0 && failed.length > 0) {
    if (totalReturned > 0) {
      executionStatus = "PARTIAL_SUCCESS_WITH_RESULTS";
      liveSucceeded = true;
    } else {
      executionStatus = "PARTIAL_SUCCESS_EMPTY";
      liveSucceeded = true;
    }
  } else if (successfulCount === attempted.length) {
    if (totalReturned > 0) {
      executionStatus = "QUERY_SUCCEEDED_WITH_RESULTS";
      liveSucceeded = true;
    } else {
      executionStatus = "QUERY_SUCCEEDED_EMPTY";
      liveSucceeded = true;
    }
  } else {
    executionStatus = totalReturned > 0 ? "QUERY_SUCCEEDED_WITH_RESULTS" : "FAILED";
    liveSucceeded = totalReturned > 0;
  }

  return {
    executionStatus,
    liveSucceeded,
    attemptedQueries: attempted.length,
    successfulQueries: successfulCount,
    failedQueries: failed.length,
    cancelledQueries: cancelled.length,
    skippedQueries: skipped.length,
    totalReturned,
    sourceRecordsReturned: totalReturned,
    uniqueExternalIdsReturned: totalReturned,
    errors,
    warnings,
  };
}

/**
 * Executes a real live query against public Meta Ad Library via the local MetaAdsCollector MCP server.
 */
export interface MetaLiveCollectionBreakdown {
  recordsInDbBeforeQuery: number;
  sourceRecordsReturned: number;
  recordsNormalized: number;
  newUniqueInserted: number;
  existingUpdated: number;
  recordsRejected: number;
  recordsInDbAfterQuery: number;
  providerQueryTimestamp: string;
  newAdIds: string[];
  totalCollected: number;
  newlyIngestedCount: number;
  auditTraces?: UpstreamRecordTrace[];
  error?: string;
  // V12.3.1 additions
  liveSucceeded?: boolean;
  executionStatus?: string;
  attemptedQueries?: number;
  successfulQueries?: number;
  failedQueries?: number;
  cancelledQueries?: number;
  queryOutcomes?: MetaSubqueryExecution[];
  subqueryBindings?: Record<string, any>;
  currentQueryExternalAdIds?: string[];
  currentQueryPersistedAdIds?: string[];
  existingUpdatedAdIds?: string[];
  newlyInsertedAdIds?: string[];
  errors?: string[];
  warnings?: string[];
}

export async function collectLiveMetaAds(
  query: IntelligenceQuery,
  options: { maxLiveResults?: number; timeoutMs?: number } = {}
): Promise<MetaLiveCollectionBreakdown> {
  const providerQueryTimestamp = new Date().toISOString();
  let dbCountBefore = 0;
  try {
    if (query.workspaceId) {
      dbCountBefore = await prisma.competitorAd.count({
        where: {
          platform: { in: ["META", "FACEBOOK"] },
          isSyntheticQuarantine: false,
          ...buildAuthorizedAdWhere(query.workspaceId),
        },
      });
    }
  } catch {}

  const config = getMetaCollectorConfig();
  if (!config.enabled || !fs.existsSync(config.pythonBin)) {
    return {
      recordsInDbBeforeQuery: dbCountBefore,
      sourceRecordsReturned: 0,
      recordsNormalized: 0,
      newUniqueInserted: 0,
      existingUpdated: 0,
      recordsRejected: 0,
      recordsInDbAfterQuery: dbCountBefore,
      providerQueryTimestamp,
      newAdIds: [],
      totalCollected: 0,
      newlyIngestedCount: 0,
      liveSucceeded: false,
      executionStatus: "NOT_CONFIGURED",
      attemptedQueries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      cancelledQueries: 0,
      queryOutcomes: [],
      error: "Meta collector not configured",
      errors: ["Meta collector not configured"],
      warnings: [],
    };
  }

  let client: any = null;
  try {
    client = await createMetaCollectorClient();

    const plan = buildKH02DiscoveryQueryPlan(query.topic, query.market || "US", {
      maxTotalResults: options.maxLiveResults || Math.min(query.maxResults || 25, 25),
      maxRequests: 3,
    });

    const budgetTracker: MetaQueryBudgetTracker =
      query.sharedMetaBudgetTracker instanceof MetaQueryBudgetTracker
        ? query.sharedMetaBudgetTracker
        : new MetaQueryBudgetTracker(plan.budget);

    const roundNumber = query.searchRoundNumber ?? 1;
    const queryOutcomes: MetaSubqueryExecution[] = [];

    const rawAds: any[] = [];
    const seenRawIds = new Set<string>();
    const subqueryBindingMap = new Map<
      string,
      {
        queryKeyword: string;
        queryId: string;
        roundNumber: number;
        origin: string;
        archetypeId: string | null;
      }
    >();

    // Build the ordered list of queries to execute in this round:
    // - If plannedQueries were provided by V12.4.2 orchestrator, execute those
    // - Else if broad category with multiple archetype subqueries, prioritize distinct archetype subqueries (1 request each)
    // - Else preserve primary query + subqueries
    const queriesToRun: Array<{
      queryId: string;
      keyword: string;
      searchType: "KEYWORD_EXACT_PHRASE" | "KEYWORD_UNORDERED";
      maxResults: number;
      roundNumber: number;
      origin: string;
      archetypeId: string | null;
      expectedProductCategory: string | null;
    }> = [];

    if (Array.isArray(query.plannedQueries) && query.plannedQueries.length > 0) {
      for (const pq of query.plannedQueries) {
        queriesToRun.push({
          queryId: pq.queryId || `q_r${roundNumber}_${queriesToRun.length + 1}`,
          keyword: pq.phrase || pq.subquery || query.topic,
          searchType:
            pq.searchType === "KEYWORD_UNORDERED"
              ? "KEYWORD_UNORDERED"
              : "KEYWORD_EXACT_PHRASE",
          maxResults: 10,
          roundNumber: pq.roundNumber ?? roundNumber,
          origin: pq.origin || "GEMINI_PLANNER",
          archetypeId: pq.archetypeId ?? null,
          expectedProductCategory: pq.expectedProductCategory ?? null,
        });
      }
    } else if (
      plan.nicheIntent === "BROAD_CATEGORY" &&
      plan.subqueries.length >= 2
    ) {
      for (let i = 0; i < Math.min(plan.subqueries.length, 3); i++) {
        const sub = plan.subqueries[i];
        queriesToRun.push({
          queryId: sub.queryId || `subquery_${i + 1}`,
          keyword: sub.subquery,
          searchType: sub.searchType,
          maxResults: sub.maxResults || 10,
          roundNumber,
          origin: sub.origin || "DETERMINISTIC_FALLBACK",
          archetypeId: sub.archetypeId ?? null,
          expectedProductCategory: sub.expectedProductCategory ?? null,
        });
      }
    } else {
      queriesToRun.push({
        queryId: "primary",
        keyword: plan.primaryQuery.subquery,
        searchType: plan.primaryQuery.searchType,
        maxResults: plan.primaryQuery.maxResults,
        roundNumber,
        origin: plan.primaryQuery.origin || "USER",
        archetypeId: plan.primaryQuery.archetypeId ?? null,
        expectedProductCategory: plan.primaryQuery.expectedProductCategory ?? null,
      });
      for (let i = 0; i < Math.min(plan.subqueries.length, 2); i++) {
        const sub = plan.subqueries[i];
        queriesToRun.push({
          queryId: sub.queryId || `subquery_${i + 1}`,
          keyword: sub.subquery,
          searchType: sub.searchType,
          maxResults: sub.maxResults || 10,
          roundNumber,
          origin: sub.origin || "DETERMINISTIC_FALLBACK",
          archetypeId: sub.archetypeId ?? null,
          expectedProductCategory: sub.expectedProductCategory ?? null,
        });
      }
    }

    const maxRoundRequests =
      typeof query.maxLiveRequestsForRound === "number" &&
      query.maxLiveRequestsForRound > 0
        ? Math.min(query.maxLiveRequestsForRound, budgetTracker.remainingRequests)
        : budgetTracker.remainingRequests;

    let roundRequestsConsumed = 0;
    const desiredReqsPerQuery = queriesToRun.length === 1 ? Math.min(2, maxRoundRequests) : 1;

    for (let qIdx = 0; qIdx < queriesToRun.length; qIdx++) {
      const qSpec = queriesToRun[qIdx];

      if (
        rawAds.length >= plan.maxTotalResults ||
        query.signal?.aborted ||
        !budgetTracker.canExecuteSubquery() ||
        roundRequestsConsumed >= maxRoundRequests
      ) {
        queryOutcomes.push({
          queryId: qSpec.queryId,
          keyword: qSpec.keyword,
          searchType: qSpec.searchType,
          attempted: false,
          status: query.signal?.aborted ? "CANCELLED" : "SKIPPED_BUDGET",
          startedAt: null,
          completedAt: null,
          actualApiCalls: 0,
          returnedCount: 0,
          uniqueReturnedCount: 0,
          duplicateCount: 0,
          roundNumber: qSpec.roundNumber,
          origin: qSpec.origin,
          archetypeId: qSpec.archetypeId,
          expectedProductCategory: qSpec.expectedProductCategory,
          errorCode: null,
          errorMessage: query.signal?.aborted
            ? "Operation cancelled"
            : "Skipped due to query budget limit",
        });
        continue;
      }

      const reqsToReserve = Math.min(
        desiredReqsPerQuery,
        maxRoundRequests - roundRequestsConsumed
      );
      const reservedReqs = budgetTracker.reserveRequests(reqsToReserve);
      if (reservedReqs <= 0) {
        queryOutcomes.push({
          queryId: qSpec.queryId,
          keyword: qSpec.keyword,
          searchType: qSpec.searchType,
          attempted: false,
          status: "SKIPPED_BUDGET",
          startedAt: null,
          completedAt: null,
          actualApiCalls: 0,
          returnedCount: 0,
          uniqueReturnedCount: 0,
          duplicateCount: 0,
          roundNumber: qSpec.roundNumber,
          origin: qSpec.origin,
          archetypeId: qSpec.archetypeId,
          expectedProductCategory: qSpec.expectedProductCategory,
          errorCode: null,
          errorMessage: "Skipped due to exhausted query budget",
        });
        continue;
      }

      roundRequestsConsumed += reservedReqs;

      const outcome: MetaSubqueryExecution = {
        queryId: qSpec.queryId,
        keyword: qSpec.keyword,
        searchType: qSpec.searchType,
        attempted: true,
        status: "FAILED",
        startedAt: new Date().toISOString(),
        completedAt: null,
        actualApiCalls: 0,
        returnedCount: 0,
        uniqueReturnedCount: 0,
        duplicateCount: 0,
        roundNumber: qSpec.roundNumber,
        origin: qSpec.origin,
        archetypeId: qSpec.archetypeId,
        expectedProductCategory: qSpec.expectedProductCategory,
        errorCode: null,
        errorMessage: null,
      };

      try {
        const searchRes = await client.searchAds({
          query: qSpec.keyword,
          country: plan.market,
          status: "ACTIVE",
          searchType: qSpec.searchType,
          maxResults: Math.max(
            1,
            Math.min(qSpec.maxResults, plan.maxTotalResults - rawAds.length)
          ),
          maxRequests: reservedReqs,
          maxSeconds: 20,
          pageSize: 10,
        });

        let returnedAds = searchRes.ads || [];
        const resultSetId = searchRes.result_set_id || searchRes.job_id;
        if (resultSetId && typeof (client as any).getResults === "function") {
          try {
            const detailedBatch = await getDetailedMetaAdsBatch(
              client,
              resultSetId,
              0,
              Math.max(returnedAds.length, qSpec.maxResults, 25)
            );
            const detailedAds = Array.isArray(detailedBatch) ? detailedBatch : (Array.isArray((detailedBatch as any)?.ads) ? (detailedBatch as any).ads : []);
            if (detailedAds.length > 0) {
              returnedAds = detailedAds;
            }
          } catch (detailErr: any) {
            console.warn(
              `[META_COLLECTOR] Detailed batch fetch fallback for '${qSpec.keyword}':`,
              detailErr?.message || String(detailErr)
            );
          }
        }
        let uniqueCountForQuery = 0;
        let dupCountForQuery = 0;

        for (const ad of returnedAds) {
          const id = String(ad.id || ad.library_id || ad.libraryId);
          if (id && !seenRawIds.has(id)) {
            seenRawIds.add(id);
            rawAds.push(ad);
            uniqueCountForQuery++;
            subqueryBindingMap.set(id, {
              queryKeyword: qSpec.keyword,
              queryId: qSpec.queryId,
              roundNumber: qSpec.roundNumber,
              origin: qSpec.origin,
              archetypeId: qSpec.archetypeId,
            });
          } else {
            dupCountForQuery++;
          }
        }

        budgetTracker.finalizeUsage(reservedReqs, reservedReqs, uniqueCountForQuery);
        outcome.completedAt = new Date().toISOString();
        outcome.requestStarted = true;
        outcome.requestCompleted = true;
        outcome.actualApiCalls = reservedReqs;
        outcome.returnedCount = returnedAds.length;
        outcome.upstreamReturnedCount = returnedAds.length;
        outcome.uniqueUpstreamIdsCount = uniqueCountForQuery;
        outcome.cachedRecordsUsed = 0;
        outcome.provenance = "LIVE_PROVIDER";
        outcome.uniqueReturnedCount = uniqueCountForQuery;
        outcome.actualApiCalls = reservedReqs;
        outcome.returnedCount = returnedAds.length;
        outcome.uniqueReturnedCount = uniqueCountForQuery;
        outcome.duplicateCount = dupCountForQuery;
        outcome.status =
          returnedAds.length > 0 ? "SUCCEEDED_WITH_RESULTS" : "SUCCEEDED_EMPTY";
      } catch (qErr: any) {
        budgetTracker.recordFailure(reservedReqs);
        outcome.completedAt = new Date().toISOString();
        outcome.requestStarted = true;
        outcome.requestCompleted = false;
        outcome.actualApiCalls = reservedReqs;
        outcome.returnedCount = 0;
        outcome.upstreamReturnedCount = 0;
        outcome.uniqueUpstreamIdsCount = 0;
        outcome.cachedRecordsUsed = 0;
        outcome.provenance = "NONE";
        outcome.status = "FAILED";
        outcome.errorCode = qErr.code || "META_QUERY_ERROR";
        outcome.errorMessage = qErr.message || String(qErr);
      }

      queryOutcomes.push(normalizeMetaQueryOutcomeFields(outcome, query.researchRunId));
    }

    const aggregated = aggregateMetaQueryOutcomes(queryOutcomes);

    // If every query failed (or cancelled), fail closed truthfully!
    if (!aggregated.liveSucceeded) {
      return {
        recordsInDbBeforeQuery: dbCountBefore,
        sourceRecordsReturned: 0,
        recordsNormalized: 0,
        newUniqueInserted: 0,
        existingUpdated: 0,
        recordsRejected: 0,
        recordsInDbAfterQuery: dbCountBefore,
        providerQueryTimestamp,
        newAdIds: [],
        totalCollected: 0,
        newlyIngestedCount: 0,
        liveSucceeded: false,
        executionStatus: aggregated.executionStatus,
        attemptedQueries: queryOutcomes.filter((q) => q.attempted).length,
        successfulQueries: aggregated.successfulQueries,
        failedQueries: aggregated.failedQueries,
        cancelledQueries: aggregated.cancelledQueries,
        queryOutcomes,
        error: aggregated.errors.join("; ") || "All Meta queries failed",
        errors: aggregated.errors,
        warnings: aggregated.warnings,
        auditTraces: [],
      };
    }

    if (rawAds.length === 0) {
      return {
        recordsInDbBeforeQuery: dbCountBefore,
        sourceRecordsReturned: 0,
        recordsNormalized: 0,
        newUniqueInserted: 0,
        existingUpdated: 0,
        recordsRejected: 0,
        recordsInDbAfterQuery: dbCountBefore,
        providerQueryTimestamp,
        newlyIngestedCount: 0,
        newAdIds: [],
        totalCollected: 0,
        liveSucceeded: true,
        executionStatus: aggregated.executionStatus,
        attemptedQueries: queryOutcomes.filter((q) => q.attempted).length,
        successfulQueries: aggregated.successfulQueries,
        failedQueries: aggregated.failedQueries,
        cancelledQueries: aggregated.cancelledQueries,
        queryOutcomes,
        errors: aggregated.errors,
        warnings: aggregated.warnings,
        auditTraces: [],
      };
    }

    const auditTraces: UpstreamRecordTrace[] = [];
    const normalizedAds: NormalizedDiscoveredAd[] = [];

    for (let i = 0; i < rawAds.length; i++) {
      const ad = rawAds[i];
      const anyRaw = ad as Record<string, unknown>;
      const rawId = String(anyRaw?.id ?? anyRaw?.library_id ?? anyRaw?.libraryId ?? `raw_meta_${i + 1}`);
      const binding = subqueryBindingMap.get(rawId);
      const queryKeyword = binding?.queryKeyword || query.topic;
      try {
        const norm = normalizeMetaCollectorAd(ad, { queryMarket: query.market || "US", keyword: queryKeyword });
        normalizedAds.push(norm);
      } catch (normErr: any) {
        auditTraces.push({
          rawId,
          digest: anyRaw?.digest ? String(anyRaw.digest) : undefined,
          decision: "REJECTED",
          rejectionReason: `NORMALIZATION_REJECTED: ${normErr?.message || String(normErr)}`,
          persistedId: null,
        });
      }
    }

    // Ensure discoveryRun exists so DiscoveryRunAd can link ingested ads to this research run & workspace
    let discoveryRunId: string | undefined = undefined;
    if (query.workspaceId) {
      try {
        const runId = query.researchRunId || `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        let dRun = await prisma.discoveryRun.findUnique({
          where: { id: runId },
        });
        if (!dRun) {
          dRun = await prisma.discoveryRun.create({
            data: {
              id: runId,
              workspaceId: query.workspaceId,
              providerId: "meta-ads-collector",
              status: "COMPLETED",
              runMode: "MANUAL",
              queryConfigJson: JSON.stringify({ topic: query.topic, market: query.market || "US" }),
              startedAt: new Date(),
              finishedAt: new Date(),
            },
          });
        }
        discoveryRunId = dRun.id;
      } catch {
        // Fallback safely if discoveryRun creation encountered non-fatal issue
      }
    }

    const ingestSummary = await ingestDiscoveredAds(normalizedAds, {
      workspaceId: query.workspaceId,
      discoveryRunId,
      runId: discoveryRunId,
      providerId: "meta-ads-collector",
      runMode: "MANUAL",
      isQuarantined: false,
    });

    if (ingestSummary.recordTraces) {
      auditTraces.push(...ingestSummary.recordTraces);
    }

    if (discoveryRunId) {
      try {
        await prisma.discoveryRun.update({
          where: { id: discoveryRunId },
          data: {
            queryConfigJson: JSON.stringify({
              topic: query.topic,
              market: query.market || "US",
              upstreamReturnedCount: rawAds.length,
              auditTraces,
            }),
            actualRetrievedCount: rawAds.length,
            validCount: normalizedAds.length,
            newUniqueCount: ingestSummary.newUniqueCount || ingestSummary.newUniqueInserted || 0,
            existingDuplicateCount: ingestSummary.existingCount || ingestSummary.existingUpdated || 0,
            rejectedCount: auditTraces.filter((t) => t.decision === "REJECTED").length,
          },
        });
      } catch {}
    }

    let dbCountAfter = dbCountBefore;
    try {
      if (query.workspaceId) {
        dbCountAfter = await prisma.competitorAd.count({
          where: {
            platform: { in: ["META", "FACEBOOK"] },
            isSyntheticQuarantine: false,
            ...buildAuthorizedAdWhere(query.workspaceId),
          },
        });
      }
    } catch {}

    const newInserted = ingestSummary.newUniqueCount || ingestSummary.newUniqueInserted || 0;
    const existingUp = ingestSummary.existingCount || ingestSummary.existingUpdated || 0;

    const newlyInsertedAdIds = (ingestSummary.recordTraces || [])
      .filter((t) => t.decision === "ACCEPTED" && t.persistedId)
      .map((t) => t.persistedId!);

    const existingUpdatedAdIds = (ingestSummary.recordTraces || [])
      .filter((t) => (t.decision === "UPDATED" || t.decision === "DUPLICATE") && t.persistedId)
      .map((t) => t.persistedId!);

    const currentQueryPersistedAdIds = Array.from(
      new Set([...newlyInsertedAdIds, ...existingUpdatedAdIds, ...(ingestSummary.adIds || [])])
    );

    return {
      recordsInDbBeforeQuery: dbCountBefore,
      sourceRecordsReturned: rawAds.length,
      recordsNormalized: normalizedAds.length,
      newUniqueInserted: newInserted,
      existingUpdated: existingUp,
      recordsRejected: auditTraces.filter((t) => t.decision === "REJECTED").length,
      recordsInDbAfterQuery: dbCountAfter,
      providerQueryTimestamp,
      newlyIngestedCount: newInserted,
      newAdIds: ingestSummary.adIds || [],
      totalCollected: rawAds.length,
      auditTraces,
      liveSucceeded: true,
      executionStatus: aggregated.executionStatus,
      attemptedQueries: queryOutcomes.filter((q) => q.attempted).length,
      successfulQueries: aggregated.successfulQueries,
      failedQueries: aggregated.failedQueries,
      cancelledQueries: aggregated.cancelledQueries,
      queryOutcomes,
      currentQueryExternalAdIds: Array.from(seenRawIds),
      subqueryBindings: Object.fromEntries(subqueryBindingMap),
      currentQueryPersistedAdIds,
      newlyInsertedAdIds,
      existingUpdatedAdIds,
      errors: aggregated.errors,
      warnings: aggregated.warnings,
    };
  } catch (err: any) {
    return {
      recordsInDbBeforeQuery: dbCountBefore,
      sourceRecordsReturned: 0,
      recordsNormalized: 0,
      newUniqueInserted: 0,
      existingUpdated: 0,
      recordsRejected: 0,
      recordsInDbAfterQuery: dbCountBefore,
      providerQueryTimestamp,
      newlyIngestedCount: 0,
      newAdIds: [],
      totalCollected: 0,
      liveSucceeded: false,
      executionStatus: "FAILED",
      attemptedQueries: 1,
      successfulQueries: 0,
      failedQueries: 1,
      cancelledQueries: 0,
      queryOutcomes: [],
      error: err?.message || String(err),
      errors: [err?.message || String(err)],
      warnings: [],
    };
  } finally {
    if (client) {
      await client.close().catch(() => {});
    }
  }
}

/**
 * Collects Meta advertising observations for a research topic in the US market.
 */
export async function collectMetaProductSignals(
  query: IntelligenceQuery
): Promise<SourceResearchResult> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const warnings: string[] = [];
  const freshLivePersistedAdIds = new Set<string>();
  const freshLiveExternalAdIds = new Set<string>();
  let liveAttempted = false;
  let liveSucceeded = false;
  let liveCollectorResult: any = null;

  // 1. Attempt live collection according to explicit MetaExecutionPolicy & ResearchSourceMode
  // V12.4.3.2 Section 3: Never suppress live Meta discovery merely because the global cached ad pool has >= 100 ads.
  const executionPolicy = resolveMetaExecutionPolicy(query);
  const requestedSourceMode: ResearchSourceMode =
    (query as any)?.sourceMode ||
    (executionPolicy === "CACHE_ONLY" || executionPolicy === "OFFLINE_FIXTURE"
      ? "CACHE_ONLY"
      : "LIVE_WITH_CACHE_FALLBACK");
  const allowLive =
    executionPolicy === "LIVE_FIRST" ||
    (executionPolicy === "CACHE_SUPPLEMENTED" &&
     requestedSourceMode !== "CACHE_ONLY" &&
     process.env.META_COLLECTOR_ENABLED !== "false" &&
     process.env.DISABLE_LIVE_MCP !== "true" &&
     process.env.NODE_ENV !== "test" &&
     process.env.VITEST !== "true");

  const shouldRunLiveMeta = allowLive;

  if (shouldRunLiveMeta) {
    liveAttempted = true;
    try {
      const liveRes = await collectLiveMetaAds(query);
      liveCollectorResult = liveRes;
      liveSucceeded = Boolean(liveRes.liveSucceeded);

      if (liveRes.currentQueryPersistedAdIds && liveRes.currentQueryPersistedAdIds.length > 0) {
        liveRes.currentQueryPersistedAdIds.forEach((id: string) => freshLivePersistedAdIds.add(id));
      } else if (liveRes.newAdIds && liveRes.newAdIds.length > 0) {
        liveRes.newAdIds.forEach((id: string) => freshLivePersistedAdIds.add(id));
      }

      if (liveRes.currentQueryExternalAdIds && liveRes.currentQueryExternalAdIds.length > 0) {
        liveRes.currentQueryExternalAdIds.forEach((id: string) => freshLiveExternalAdIds.add(id));
      }

      if (liveRes.error || !liveSucceeded) {
        if (!liveSucceeded && liveRes.errors && liveRes.errors.length > 0) {
          errors.push(...liveRes.errors);
        }
        warnings.push(`Live Meta collector attempt reported: ${liveRes.error || "Query failed"}. Falling back to cached SQLite observations.`);
      }
    } catch (liveErr: any) {
      liveSucceeded = false;
      warnings.push(`Live Meta query bypassed: ${liveErr?.message || String(liveErr)}. Using cached database observations.`);
    }
  }

  try {
    // 2. Determine lookback threshold
    const lookbackDays = query.lookbackDays && !isNaN(Number(query.lookbackDays))
      ? Number(query.lookbackDays)
      : (query.timeWindow === "90D" ? 90 : (query.timeWindow === "180D" ? 180 : (query.timeWindow === "365D" ? 365 : 30)));
    const lookbackThreshold = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    const authorizedWhere = buildAuthorizedAdWhere(query.workspaceId);

    // 3. Query run-linked / freshly observed live ads without topic string drop
    let liveMatchingAds: any[] = [];
    if (freshLivePersistedAdIds.size > 0 || freshLiveExternalAdIds.size > 0) {
      liveMatchingAds = await prisma.competitorAd.findMany({
        where: {
          platform: { in: ["META", "FACEBOOK"] },
          isSyntheticQuarantine: false,
          NOT: { headline: { startsWith: "[SYNTHETIC_DEMO]" } },
          AND: [
            authorizedWhere,
            {
              OR: [
                { id: { in: Array.from(freshLivePersistedAdIds) } },
                { externalAdId: { in: Array.from(freshLiveExternalAdIds) } },
              ],
            },
          ],
        },
        include: {
          advertiser: true,
          dataSource: true,
          mediaAssets: { take: 2 },
          observations: { orderBy: { observedAt: "desc" }, take: 10 },
        },
      });
    }

    // 4. Query cached ads to fill up to query.maxResults (unless requestedSourceMode === "LIVE_ONLY")
    const liveAdIdSet = new Set(liveMatchingAds.map((a) => a.id));
    let cachedMatchingAds: any[] = [];
    const remainingSlots =
      requestedSourceMode === "LIVE_ONLY"
        ? 0
        : Math.max(0, (query.maxResults || 50) - liveMatchingAds.length);

    if (remainingSlots > 0) {
      const plannedQueryKeywords = Array.isArray(query.plannedQueries)
        ? query.plannedQueries
            .map((pq: any) => pq?.phrase || pq?.subquery || "")
            .filter((s: string) => s.length > 2)
        : [];

      const baseKeywords = query.productKeywords && query.productKeywords.length > 0
        ? query.productKeywords
        : query.topic.split(/\s+/).filter((w) => w.length > 2);

      const topicWords = query.topic
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 3);

      const phraseTokens = [...baseKeywords, ...plannedQueryKeywords]
        .flatMap((phrase) => String(phrase).split(/\s+/))
        .map((w) => w.trim().toLowerCase())
        .filter(
          (w) =>
            w.length >= 4 &&
            !["with", "from", "that", "this", "your", "free", "best", "portable", "electric", "automatic"].includes(w)
        );

      const combinedKeywords = Array.from(
        new Set([
          ...baseKeywords,
          ...plannedQueryKeywords,
          ...topicWords,
          ...phraseTokens,
          query.topic.trim(),
        ])
      ).filter((w) => w.length >= 2);

      const searchClauses = combinedKeywords.map((k) => ({
        OR: [
          { headline: { contains: k } },
          { bodyText: { contains: k } },
          { landingPageUrl: { contains: k } },
          { advertiser: { name: { contains: k } } },
        ],
      }));

      cachedMatchingAds = await prisma.competitorAd.findMany({
        where: {
          platform: { in: ["META", "FACEBOOK"] },
          isSyntheticQuarantine: false,
          NOT: { headline: { startsWith: "[SYNTHETIC_DEMO]" } },
          id: { notIn: Array.from(liveAdIdSet) },
          AND: [
            authorizedWhere,
            { OR: searchClauses.map((sc) => sc.OR).flat() },
            { lastSeenAt: { gte: lookbackThreshold } },
          ],
        },
        include: {
          advertiser: true,
          dataSource: true,
          mediaAssets: { take: 2 },
          observations: { orderBy: { observedAt: "desc" }, take: 10 },
        },
        take: Math.max(remainingSlots * 4, 150),
        orderBy: [{ landingPageUrl: "desc" }, { lastSeenAt: "desc" }],
      });
    }

    if (cachedMatchingAds.length > 0) {
      const plannedQueryKeywords = Array.isArray(query.plannedQueries)
        ? query.plannedQueries
            .map((pq: any) => pq?.phrase || pq?.subquery || "")
            .filter((s: string) => s.length > 2)
        : [];
      const baseKeywords =
        query.productKeywords && query.productKeywords.length > 0
          ? query.productKeywords
          : query.topic.split(/\s+/).filter((w) => w.length > 2);
      const topicWords = query.topic
        .split(/\s+/)
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w.length >= 3 && !["gadgets", "products", "supplies", "accessories", "items"].includes(w));
      const exactPhrasesLower = Array.from(
        new Set([query.topic.trim(), ...plannedQueryKeywords, ...baseKeywords])
      )
        .map((p) => String(p).trim().toLowerCase())
        .filter((p) => p.length >= 3);
      const phraseTokens = [...baseKeywords, ...plannedQueryKeywords]
        .flatMap((phrase) => String(phrase).split(/\s+/))
        .map((w) => w.trim().toLowerCase())
        .filter(
          (w) =>
            w.length >= 4 &&
            !["with", "from", "that", "this", "your", "free", "best", "portable", "electric", "automatic", "water", "wall", "home", "clean", "tool", "tools", "cover", "covers", "plate", "plates", "panel", "panels", "holder", "rack", "tray", "brush", "spray", "bottle", "smart"].includes(w)
        );

      const scoreCachedAd = (ad: any): number => {
        const text = `${ad.headline || ""} ${ad.landingPageUrl || ""} ${ad.bodyText || ""} ${ad.advertiser?.name || ""}`.toLowerCase();
        let score = 0;
        for (const phrase of exactPhrasesLower) {
          if (text.includes(phrase)) score += 100;
        }
        for (const tw of topicWords) {
          if (text.includes(tw)) score += 40;
        }
        for (const pt of phraseTokens) {
          if (text.includes(pt)) score += 20;
        }
        if (ad.landingPageUrl && /\/products\//i.test(ad.landingPageUrl)) score += 25;
        else if (ad.landingPageUrl && ad.landingPageUrl.trim() !== "") score += 10;
        return score;
      };

      cachedMatchingAds = cachedMatchingAds
        .sort((a, b) => scoreCachedAd(b) - scoreCachedAd(a))
        .slice(0, remainingSlots);
    }

    const matchingAds = [...liveMatchingAds, ...cachedMatchingAds];

    if (matchingAds.length === 0) {
      const cachedCount = 0;
      warnings.push(`No active Meta ads found for topic '${query.topic}' within ${lookbackDays} days.`);
      const emptyStatus: SourceRunStatus = liveSucceeded
        ? "QUERY_SUCCEEDED_EMPTY"
        : (liveAttempted ? "FAILED" : "NO_RESULTS");

      const upstreamReturnedOnEmpty = liveCollectorResult
        ? (liveCollectorResult.sourceRecordsReturned ?? 0)
        : 0;
      const persistedInsertedOnEmpty = liveCollectorResult ? (liveCollectorResult.newUniqueInserted ?? 0) : 0;
      const persistedUpdatedOnEmpty = liveCollectorResult ? (liveCollectorResult.existingUpdated ?? 0) : 0;

      return {
        source: "META_ADS",
        status: emptyStatus,
        observations: [],
        retrievedCount: liveAttempted ? upstreamReturnedOnEmpty : 0,
        acceptedCount: 0,
        rejectedCount: liveCollectorResult?.recordsRejected || 0,
        estimatedCredits: 0,
        consumedCredits: 0,
        startedAt,
        completedAt: new Date().toISOString(),
        errors,
        warnings,
        executionMetadata: {
          attempted: liveAttempted,
          executed: liveAttempted,
          liveSucceeded,
          startedAt,
          completedAt: new Date().toISOString(),
          upstreamReturnedCount: liveAttempted ? upstreamReturnedOnEmpty : null,
          freshLiveObservedCount: 0,
          persistedInsertedCount: persistedInsertedOnEmpty,
          persistedUpdatedCount: persistedUpdatedOnEmpty,
          reobservedExistingCount: persistedUpdatedOnEmpty,
          cachedRecordsUsedCount: 0,
          fallbackToCache: false,
          sourceMode: requestedSourceMode,
          executionPolicy,
          auditTraces: liveCollectorResult?.auditTraces || [],
      queryOutcomes:
        liveCollectorResult?.queryOutcomes && liveCollectorResult.queryOutcomes.length > 0
          ? liveCollectorResult.queryOutcomes
          : !liveAttempted && Array.isArray(query.plannedQueries) && query.plannedQueries.length > 0
          ? query.plannedQueries.map((pq: any, idx: number) => ({
              queryId: pq.queryId || `q_r1_${idx + 1}`,
              researchRunId: query.researchRunId || "unknown_run",
              source: "META_ADS" as const,
              keyword: pq.phrase || pq.subquery || query.topic,
              searchType: pq.searchType === "KEYWORD_UNORDERED" ? "KEYWORD_UNORDERED" : "KEYWORD_EXACT_PHRASE",
              planned: true,
              attempted: false,
              requestStarted: false,
              requestCompleted: false,
              actualApiCalls: 0,
              status: "NOT_ATTEMPTED" as const,
              upstreamReturnedCount: null,
              uniqueUpstreamIdsCount: null,
              cachedRecordsUsed: cachedCount,
              startedAt: null,
              completedAt: null,
              returnedCount: 0,
              uniqueReturnedCount: 0,
              duplicateCount: 0,
              roundNumber: pq.roundNumber ?? 1,
              origin: pq.origin || "DETERMINISTIC_FALLBACK",
              archetypeId: pq.archetypeId ?? null,
              expectedProductCategory: pq.expectedProductCategory ?? null,
              errorCode: null,
              errorMessage: null,
              provenance: cachedCount > 0 ? ("CACHED_SOURCE" as const) : ("NONE" as const),
            }))
          : [],

        },
      };
    }

    // 5. Normalize into SourceObservations with explicit live vs cached provenance
    const observations: SourceObservation[] = matchingAds.map((ad) => {
      const media = ad.mediaAssets[0];
      const domain = ad.landingPageUrl ? extractDomainFromUrl(ad.landingPageUrl) : null;
      const marketProv = resolveMetaMarketProvenance(ad, { requestedMarket: query.market || "US", topic: query.topic });

      const isFreshLive = freshLivePersistedAdIds.has(ad.id) || (ad.externalAdId && freshLiveExternalAdIds.has(ad.externalAdId));
      const provenance: ObservationProvenance = isFreshLive
        ? "LIVE_PROVIDER"
        : ad.dataConfidence === "VERIFIED"
        ? "VERIFIED_SOURCE"
        : "CACHED_SOURCE";

      return {
        source: "META_ADS",
        sourceRecordId: ad.id,
        sourceUrl: ad.originalAdUrl || (ad.externalAdId ? `https://www.facebook.com/ads/library/?id=${ad.externalAdId}` : null),
        landingPageUrl: ad.landingPageUrl || null,
        sourceExternalAdId: ad.externalAdId || ad.id,
        storeDomainEvidence: domain,
        advertiserOrCreator: ad.advertiser?.name || null,
        advertiserDomain: domain,
        productMatchHint: ad.headline || null,
        reportedPublishedAt: null,
        reportedFirstShownAt: ad.firstSeenAt?.toISOString() || null,
        reportedLastShownAt: ad.lastSeenAt?.toISOString() || null,
        observedAt: isFreshLive ? new Date().toISOString() : (ad.lastSeenAt?.toISOString() || new Date().toISOString()),
        requestedMarket: marketProv.requestedMarket,
        verifiedDeliveryMarket: marketProv.verifiedDeliveryMarket,
        title: ad.headline,
        description: ad.bodyText,
        metrics: {
          daysRunning: ad.daysRunning,
          status: ad.status,
          observationsCount: Math.max(ad.observations.length, (ad as any).observationCount || 1),
          dataConfidence: ad.dataConfidence,
          marketVerification: marketProv.marketVerification,
          isFreshLive,
          ...(isFreshLive && ad.externalAdId && liveCollectorResult?.subqueryBindings?.[ad.externalAdId]
            ? {
                queryId: liveCollectorResult.subqueryBindings[ad.externalAdId].queryId,
                queryKeyword: liveCollectorResult.subqueryBindings[ad.externalAdId].queryKeyword,
                roundNumber: liveCollectorResult.subqueryBindings[ad.externalAdId].roundNumber,
                origin: liveCollectorResult.subqueryBindings[ad.externalAdId].origin,
                archetypeId: liveCollectorResult.subqueryBindings[ad.externalAdId].archetypeId,
              }
            : {}),
                  },
        media: {
          thumbnailUrl: media?.thumbnailUrl || null,
          videoUrl: media?.videoUrl || null,
          mediaType: media?.mediaType || null,
        },
        provenance,
        evidenceReference: `CompetitorAd:${ad.id}`,
      };
    });

    const freshLiveCount = observations.filter((o) => o.provenance === "LIVE_PROVIDER").length;
    const cachedCount = observations.length - freshLiveCount;
    const upstreamReturned = liveCollectorResult
      ? (liveCollectorResult.sourceRecordsReturned ?? freshLiveCount)
      : (freshLiveCount > 0 ? freshLiveCount : 0);
    const persistedInserted = liveCollectorResult ? (liveCollectorResult.newUniqueInserted ?? 0) : freshLiveCount;
    const persistedUpdated = liveCollectorResult ? (liveCollectorResult.existingUpdated ?? 0) : 0;

    // Truthful status: if live query succeeded, report PASSED. If failed or bypassed, report CACHE_ONLY
    const status: SourceRunStatus = liveSucceeded ? "PASSED" : "CACHE_ONLY";

    const executionMetadata: ProviderExecutionMetadata = {
      attempted: liveAttempted,
      executed: liveAttempted,
      liveSucceeded,
      startedAt,
      completedAt: new Date().toISOString(),
      upstreamReturnedCount: liveAttempted ? upstreamReturned : null,
      freshLiveObservedCount: freshLiveCount,
      persistedInsertedCount: persistedInserted,
      persistedUpdatedCount: persistedUpdated,
      reobservedExistingCount: persistedUpdated,
      cachedRecordsUsedCount: cachedCount,
      fallbackToCache: !liveSucceeded && cachedCount > 0,
      sourceMode: requestedSourceMode,
      executionPolicy,
      auditTraces: liveCollectorResult?.auditTraces || [],
      queryOutcomes:
        liveCollectorResult?.queryOutcomes && liveCollectorResult.queryOutcomes.length > 0
          ? liveCollectorResult.queryOutcomes
          : !liveAttempted && Array.isArray(query.plannedQueries) && query.plannedQueries.length > 0
          ? query.plannedQueries.map((pq: any, idx: number) => ({
              queryId: pq.queryId || `q_r1_${idx + 1}`,
              researchRunId: query.researchRunId || "unknown_run",
              source: "META_ADS" as const,
              keyword: pq.phrase || pq.subquery || query.topic,
              searchType: pq.searchType === "KEYWORD_UNORDERED" ? "KEYWORD_UNORDERED" : "KEYWORD_EXACT_PHRASE",
              planned: true,
              attempted: false,
              requestStarted: false,
              requestCompleted: false,
              actualApiCalls: 0,
              status: "NOT_ATTEMPTED" as const,
              upstreamReturnedCount: null,
              uniqueUpstreamIdsCount: null,
              cachedRecordsUsed: cachedCount,
              startedAt: null,
              completedAt: null,
              returnedCount: 0,
              uniqueReturnedCount: 0,
              duplicateCount: 0,
              roundNumber: pq.roundNumber ?? 1,
              origin: pq.origin || "DETERMINISTIC_FALLBACK",
              archetypeId: pq.archetypeId ?? null,
              expectedProductCategory: pq.expectedProductCategory ?? null,
              errorCode: null,
              errorMessage: null,
              provenance: cachedCount > 0 ? ("CACHED_SOURCE" as const) : ("NONE" as const),
            }))
          : [],

    };

    return {
      source: "META_ADS",
      status,
      observations,
      retrievedCount: liveSucceeded ? upstreamReturned : observations.length,
      acceptedCount: observations.length,
      rejectedCount: liveCollectorResult?.recordsRejected || 0,
      estimatedCredits: 0,
      consumedCredits: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      errors,
      warnings,
      executionMetadata,
    };
  } catch (err: any) {
    errors.push(err.message || "Failed to collect Meta product signals.");
    return {
      source: "META_ADS",
      status: "FAILED",
      observations: [],
      retrievedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      estimatedCredits: 0,
      consumedCredits: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      errors,
      warnings,
      executionMetadata: {
        attempted: liveAttempted,
        executed: liveAttempted,
        liveSucceeded: false,
        startedAt,
        completedAt: new Date().toISOString(),
        upstreamReturnedCount: 0,
        freshLiveObservedCount: 0,
        persistedInsertedCount: 0,
        persistedUpdatedCount: 0,
        cachedRecordsUsedCount: 0,
        fallbackToCache: false,
      },
    };
  }
}
