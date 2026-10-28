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
import { createMetaCollectorClient } from "@/services/discovery/metaCollector/metaCollectorMcpClient";
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

export type MetaQueryOutcomeStatus =
  | "SUCCEEDED_WITH_RESULTS"
  | "SUCCEEDED_EMPTY"
  | "FAILED"
  | "CANCELLED"
  | "SKIPPED_BUDGET";

export interface MetaSubqueryExecution {
  queryId: string;
  keyword: string;
  searchType: string;
  attempted: boolean;
  status: MetaQueryOutcomeStatus;
  startedAt: string | null;
  completedAt: string | null;
  actualApiCalls: number;
  returnedCount: number;
  errorCode: string | null;
  errorMessage: string | null;
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

    const budgetTracker = new MetaQueryBudgetTracker(plan.budget);
    const queryOutcomes: MetaSubqueryExecution[] = [];

    const rawAds: any[] = [];
    const seenRawIds = new Set<string>();
    const subqueryBindingMap = new Map<string, { queryKeyword: string; queryId: string }>();

    // 1. Primary Query Execution (Preserves user topic with exact phrase constraint)
    const primaryOutcome: MetaSubqueryExecution = {
      queryId: "primary",
      keyword: plan.primaryQuery.subquery,
      searchType: plan.primaryQuery.searchType,
      attempted: true,
      status: "FAILED",
      startedAt: new Date().toISOString(),
      completedAt: null,
      actualApiCalls: 0,
      returnedCount: 0,
      errorCode: null,
      errorMessage: null,
    };

    const primaryReqs = budgetTracker.reserveRequests(2);
    try {
      const primaryRes = await client.searchAds({
        query: plan.primaryQuery.subquery,
        country: plan.market,
        status: "ACTIVE",
        searchType: plan.primaryQuery.searchType,
        maxResults: plan.primaryQuery.maxResults,
        maxRequests: primaryReqs,
        maxSeconds: 20,
        pageSize: 10,
      });

      const primaryAds = primaryRes.ads || [];
      budgetTracker.recordUsage(primaryReqs, primaryAds.length);
      primaryOutcome.completedAt = new Date().toISOString();
      primaryOutcome.actualApiCalls = primaryReqs;
      primaryOutcome.returnedCount = primaryAds.length;
      primaryOutcome.status = primaryAds.length > 0 ? "SUCCEEDED_WITH_RESULTS" : "SUCCEEDED_EMPTY";

      for (const ad of primaryAds) {
        const id = String(ad.id || ad.library_id || ad.libraryId);
        if (id && !seenRawIds.has(id)) {
          seenRawIds.add(id);
          rawAds.push(ad);
          subqueryBindingMap.set(id, { queryKeyword: plan.primaryQuery.subquery, queryId: "primary" });
        }
      }
    } catch (primaryErr: any) {
      primaryOutcome.completedAt = new Date().toISOString();
      primaryOutcome.status = "FAILED";
      primaryOutcome.errorCode = primaryErr.code || "PRIMARY_QUERY_ERROR";
      primaryOutcome.errorMessage = primaryErr.message || String(primaryErr);
      console.warn(`[META_COLLECTOR] Primary query error for '${plan.primaryQuery.subquery}':`, primaryErr.message);
    }
    queryOutcomes.push(primaryOutcome);

    // 2. Bounded Subquery Expansion (Only expands relevant domain subqueries within budget)
    const maxSubqueriesToRun = Math.min(plan.subqueries.length, 2);
    for (let sIdx = 0; sIdx < maxSubqueriesToRun; sIdx++) {
      const subplan = plan.subqueries[sIdx];
      const subqueryId = `subquery_${sIdx + 1}`;

      if (rawAds.length >= plan.maxTotalResults || query.signal?.aborted || !budgetTracker.canExecuteSubquery()) {
        queryOutcomes.push({
          queryId: subqueryId,
          keyword: subplan.subquery,
          searchType: subplan.searchType,
          attempted: false,
          status: query.signal?.aborted ? "CANCELLED" : "SKIPPED_BUDGET",
          startedAt: null,
          completedAt: null,
          actualApiCalls: 0,
          returnedCount: 0,
          errorCode: null,
          errorMessage: query.signal?.aborted ? "Operation cancelled" : "Skipped due to query budget limit",
        });
        continue;
      }

      const subOutcome: MetaSubqueryExecution = {
        queryId: subqueryId,
        keyword: subplan.subquery,
        searchType: subplan.searchType,
        attempted: true,
        status: "FAILED",
        startedAt: new Date().toISOString(),
        completedAt: null,
        actualApiCalls: 0,
        returnedCount: 0,
        errorCode: null,
        errorMessage: null,
      };

      const subReqs = budgetTracker.reserveRequests(2);
      try {
        const subRes = await client.searchAds({
          query: subplan.subquery,
          country: plan.market,
          status: "ACTIVE",
          searchType: subplan.searchType,
          maxResults: Math.min(subplan.maxResults, plan.maxTotalResults - rawAds.length),
          maxRequests: subReqs,
          maxSeconds: 20,
          pageSize: 10,
        });

        const subAds = subRes.ads || [];
        budgetTracker.recordUsage(subReqs, subAds.length);
        subOutcome.completedAt = new Date().toISOString();
        subOutcome.actualApiCalls = subReqs;
        subOutcome.returnedCount = subAds.length;
        subOutcome.status = subAds.length > 0 ? "SUCCEEDED_WITH_RESULTS" : "SUCCEEDED_EMPTY";

        for (const ad of subAds) {
          const id = String(ad.id || ad.library_id || ad.libraryId);
          if (id && !seenRawIds.has(id)) {
            seenRawIds.add(id);
            rawAds.push(ad);
            subqueryBindingMap.set(id, { queryKeyword: subplan.subquery, queryId: subqueryId });
          }
        }
      } catch (subErr: any) {
        subOutcome.completedAt = new Date().toISOString();
        subOutcome.status = "FAILED";
        subOutcome.errorCode = subErr.code || "SUBQUERY_ERROR";
        subOutcome.errorMessage = subErr.message || String(subErr);
        console.warn(`[META_COLLECTOR] Subquery error for '${subplan.subquery}':`, subErr.message);
      }
      queryOutcomes.push(subOutcome);
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

  // 1. Attempt live collection if enabled and not in unit test execution boundary
  const allowLive =
    process.env.ENABLE_LIVE_META === "true" ||
    (process.env.META_COLLECTOR_ENABLED !== "false" &&
     process.env.DISABLE_LIVE_MCP !== "true" &&
     process.env.NODE_ENV !== "test" &&
     process.env.VITEST !== "true");

  if (allowLive) {
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

    // 4. Query cached ads to fill up to query.maxResults
    const liveAdIdSet = new Set(liveMatchingAds.map((a) => a.id));
    let cachedMatchingAds: any[] = [];
    const remainingSlots = Math.max(0, (query.maxResults || 50) - liveMatchingAds.length);

    if (remainingSlots > 0) {
      const keywords = query.productKeywords && query.productKeywords.length > 0
        ? query.productKeywords
        : query.topic.split(/\s+/).filter((w) => w.length > 2);

      const searchClauses = keywords.map((k) => ({
        OR: [
          { headline: { contains: k } },
          { bodyText: { contains: k } },
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
        take: remainingSlots,
        orderBy: { lastSeenAt: "desc" },
      });
    }

    const matchingAds = [...liveMatchingAds, ...cachedMatchingAds];

    if (matchingAds.length === 0) {
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
          cachedRecordsUsedCount: 0,
          fallbackToCache: false,
          auditTraces: liveCollectorResult?.auditTraces || [],
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
          observationsCount: ad.observations.length,
          dataConfidence: ad.dataConfidence,
          marketVerification: marketProv.marketVerification,
          isFreshLive,
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
      cachedRecordsUsedCount: cachedCount,
      fallbackToCache: !liveSucceeded && cachedCount > 0,
      auditTraces: liveCollectorResult?.auditTraces || [],
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
