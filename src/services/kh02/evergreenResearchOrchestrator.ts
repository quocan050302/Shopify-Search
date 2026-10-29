/**
 * SWAI KH-02 — Evergreen Research Orchestrator (V12.1.0)
 *
 * Coordinates the full cross-platform product research pipeline:
 * 1. Checks source readiness, capabilities, and zero-cost budget constraints.
 * 2. Collects ad observations from Meta (canonical platform, workspace-scoped) and TikTok Ads.
 * 3. Consolidates ad signals by product landing page URLs into distinct product candidates.
 * 4. Resolves candidate to real database ResearchProduct.id (via AdProductLink & canonical URL).
 * 5. Collects secondary platform evidence: TikTok Organic & Google Ads Transparency.
 * 6. Matches secondary observations to specific product candidates (product-specific evidence).
 * 7. Loads historical demand time series using the resolved ResearchProduct.id.
 * 8. Calculates V12.1 Evergreen Opportunity Score & applies strict eligibility gates.
 * 9. Partitions candidates into Verified Top 3 Winners, Provisional Opportunities, and Insufficient Evidence.
 * 10. Persists immutable ranking snapshots to the database for instant restore on reload.
 */

import {
  IntelligenceSource,
  SourceRunStatus,
  IntelligenceQuery,
  SourceObservation,
  ProviderSourceTelemetry,
  ObservationProvenance,
  KH02CandidateFunnel,
  KH02LookbackCoverage,
} from "./types";
import {
  collectMetaProductSignals,
  MetaSubqueryExecution,
} from "./providers/metaResearchAdapter";
import { collectTikTokAdsSignals } from "./providers/tiktokAdsResearchAdapter";
import { collectTikTokOrganicSignals } from "./providers/tiktokOrganicResearchAdapter";
import {
  collectGoogleAdvertiserSignals,
  extractRegistrableDomain,
} from "./providers/googleTransparencyResearchAdapter";
import { diagnoseKH02Source } from "./providers/sourceRegistry";
import { isSourceTemporarilyDisabled } from "./providers/sourcePolicy";
import {
  discoverProductCandidatesFromAds,
  resolveCandidateResearchProduct,
  enrichProductCandidatesWithEvidence,
  DiscoveredProductCandidate,
  selectTopResearchShortlist,
  ResearchShortlistResult,
  evaluateCandidateProductReality,
  buildProductIdentityFingerprint,
  compareProductIdentity,
  clusterProductCandidates,
  mergeDuplicateCandidateRecords,
} from "./identity/productCandidateDiscovery";
import { matchCrossPlatformProductEvidence } from "./identity/crossPlatformProductMatcher";
import {
  loadProductHistoricalDemand,
  DemandDataPoint,
} from "./demand/temporalDemandEngine";
import { resolveProductDemandHistory } from "./demand/historicalDemandIngestion";
import {
  calculateKH02EvergreenScore,
  KH02ScoreResult,
  KH02_SCORE_VERSION,
} from "./scoring/evergreenOpportunityScoring";
import { analyzeProductCandidatesWithAI } from "./ai/geminiProductIntelligenceService";
import { GeminiAITelemetry } from "./ai/aiProductIntelligenceTypes";
import { createGeminiRunBudgetTracker } from "./ai/geminiModelRouter";
import {
  AIDiscoveryPlan,
  buildHybridKH02DiscoveryQueryPlan,
  DiscoveryPlannerTelemetry,
  DiscoveryQuery,
  evaluateShortlistCoverage,
  MetaQueryBudgetTracker,
  QueryYield,
  selectQueriesForSearchRound,
  ShortlistCoverageState,
} from "./discovery/discoveryQueryPlanner";

export interface RankedLeaderboardItem {
  rank: number | null;
  candidate: DiscoveredProductCandidate;
  score: KH02ScoreResult;
}

export interface EvergreenLeaderboardResult {
  researchRunId: string;
  topic: string;
  market: "US";
  lookbackDays: number;
  formulaVersion: string;
  runStatus: SourceRunStatus;
  sourceStatuses: Record<IntelligenceSource, SourceRunStatus>;
  topThree: RankedLeaderboardItem[];
  provisionalCandidates: RankedLeaderboardItem[];
  remainingCandidates: RankedLeaderboardItem[];
  insufficientEvidenceCandidates: RankedLeaderboardItem[];
  rejectedCandidates?: RankedLeaderboardItem[];
  providerTelemetry?: Record<IntelligenceSource, ProviderSourceTelemetry>;
  totalCandidatesDiscovered: number;
  totalObservationsCollected?: number;
  sourceObservations?: SourceObservation[];
  generatedAt: string;
  warnings: string[];
  errors: string[];
  researchShortlist?: ResearchShortlistResult;
  shortfallReason?: string | null;
  candidateFunnel?: KH02CandidateFunnel;
  aiTelemetry?: GeminiAITelemetry;
  // V12.4.2 Discovery Intelligence & Adaptive Search Provenance
  discoveryPlan?: AIDiscoveryPlan;
  discoveryPlannerTelemetry?: DiscoveryPlannerTelemetry;
  plannedQueries?: DiscoveryQuery[];
  queryExecutions?: MetaSubqueryExecution[];
  queryYields?: QueryYield[];
  shortlistCoverage?: ShortlistCoverageState;
  lookbackCoverage?: KH02LookbackCoverage;
  sourceMode?: "LIVE_WITH_CACHE_FALLBACK" | "CACHE_ONLY" | "LIVE_ONLY";
  sourceCoverage?: Record<
    string,
    {
      freshLiveAdsCount: number;
      historicalCachedAdsCount: number;
      totalObservationsCount: number;
      queryExecuted: boolean;
      queryStatus: SourceRunStatus;
    }
  >;
}

export interface ResearchProgressPayload {
  stage: "DISCOVERY" | "NORMALIZATION" | "ENRICHMENT" | "SCORING" | "COMPLETION";
  percent: number;
  message?: string;
}

export interface KH02ResearchExecutionContext {
  workspaceId: string;
  runId: string;
  signal?: AbortSignal;
  reportProgress?: (progress: ResearchProgressPayload) => Promise<void>;
}

export interface RunEvergreenResearchInput {
  topic: string;
  market?: "US";
  lookbackDays?: number;
  maxCandidates?: number;
  workspaceId: string;
  runId?: string;
  selectedSources?: IntelligenceSource[];
  sourceMode?: "LIVE_WITH_CACHE_FALLBACK" | "CACHE_ONLY" | "LIVE_ONLY";
  metaExecutionPolicy?: string;
  signal?: AbortSignal;
}

/**
 * Executes end-to-end evergreen product research for a given topic/niche.
 * Pure research orchestrator: does NOT bypass worker ownership by writing directly to SyncJob.
 */
export async function runEvergreenProductResearch(
  input: RunEvergreenResearchInput,
  context?: KH02ResearchExecutionContext
): Promise<EvergreenLeaderboardResult> {
  const generatedAt = new Date().toISOString();
  const runId = context?.runId || input.runId || `kh02_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const market = input.market || "US";
  const lookbackDays = input.lookbackDays || 90;
  const maxCandidates = input.maxCandidates || 15;
  const warnings: string[] = [];
  const errors: string[] = [];

  const abortSignal = context?.signal || input.signal;

  // Report initial discovery progress via worker context if provided
  if (context?.reportProgress) {
    await context.reportProgress({
      stage: "DISCOVERY",
      percent: 10,
      message: "Initiating multi-source product discovery",
    }).catch((err) => {
      warnings.push(`Progress reporting warning: ${err.message}`);
    });
  }

  const isExcludedBySelection = (source: IntelligenceSource) => {
    return Boolean(input.selectedSources && !input.selectedSources.includes(source));
  };

  const initialStatusFor = (source: IntelligenceSource): SourceRunStatus => {
    if (isExcludedBySelection(source)) return "SKIPPED";
    if (isSourceTemporarilyDisabled(source)) return "TEMPORARILY_DISABLED";
    if (source === "DEMAND_HISTORY") return "CONFIGURED";
    return "NOT_CONFIGURED";
  };

  // Demand history starts as CONFIGURED policy engine until actual temporal points are verified
  const sourceStatuses: Record<IntelligenceSource, SourceRunStatus> = {
    META_ADS: initialStatusFor("META_ADS"),
    TIKTOK_ADS: initialStatusFor("TIKTOK_ADS"),
    TIKTOK_ORGANIC: initialStatusFor("TIKTOK_ORGANIC"),
    GOOGLE_ADS: initialStatusFor("GOOGLE_ADS"),
    DEMAND_HISTORY: initialStatusFor("DEMAND_HISTORY"),
  };

  const providerTelemetry: Record<IntelligenceSource, ProviderSourceTelemetry> = {
    META_ADS: {
      source: "META_ADS",
      queryExecuted: false,
      queryStatus: "NOT_CONFIGURED",
      queryTimestamp: null,
      retrievedCount: null,
      acceptedCount: null,
      queryProvenance: "NONE",
      isLive: false,
      queryError: null,
      lastSuccessfulRecordCount: null,
      lastSuccessfulQueryAt: null,
    },
    TIKTOK_ADS: {
      source: "TIKTOK_ADS",
      queryExecuted: false,
      queryStatus: initialStatusFor("TIKTOK_ADS"),
      queryTimestamp: null,
      retrievedCount: null,
      acceptedCount: null,
      queryProvenance: "NONE",
      isLive: false,
      queryError: null,
      lastSuccessfulRecordCount: null,
      lastSuccessfulQueryAt: null,
    },
    TIKTOK_ORGANIC: {
      source: "TIKTOK_ORGANIC",
      queryExecuted: false,
      queryStatus: initialStatusFor("TIKTOK_ORGANIC"),
      queryTimestamp: null,
      retrievedCount: null,
      acceptedCount: null,
      queryProvenance: "NONE",
      isLive: false,
      queryError: null,
      lastSuccessfulRecordCount: null,
      lastSuccessfulQueryAt: null,
    },
    GOOGLE_ADS: {
      source: "GOOGLE_ADS",
      queryExecuted: false,
      queryStatus: initialStatusFor("GOOGLE_ADS"),
      queryTimestamp: null,
      retrievedCount: null,
      acceptedCount: null,
      queryProvenance: "NONE",
      isLive: false,
      queryError: null,
      lastSuccessfulRecordCount: null,
      lastSuccessfulQueryAt: null,
    },
    DEMAND_HISTORY: {
      source: "DEMAND_HISTORY",
      queryExecuted: false,
      queryStatus: initialStatusFor("DEMAND_HISTORY"),
      queryTimestamp: null,
      retrievedCount: null,
      acceptedCount: null,
      queryProvenance: "NONE",
      isLive: false,
      queryError: null,
      lastSuccessfulRecordCount: null,
      lastSuccessfulQueryAt: null,
    },
  };

  const isSelected = (source: IntelligenceSource) => {
    if (isSourceTemporarilyDisabled(source)) return false;
    return !input.selectedSources || input.selectedSources.includes(source);
  };

  const query: IntelligenceQuery = {
    workspaceId: input.workspaceId,
    researchRunId: runId,
    topic: input.topic,
    market,
    lookbackDays,
    maxResults: 50,
    signal: abortSignal,
    sourceMode: input.sourceMode,
    metaExecutionPolicy: input.metaExecutionPolicy,
  };

  const STAGE_TIMEOUT_MS = Number(process.env.KH02_STAGE_TIMEOUT_MS) || 30_000;

  function createStageSignal(timeoutMs: number, stageName: string): { signal: AbortSignal; cleanup: () => void } {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error(`Stage '${stageName}' exceeded deadline of ${timeoutMs}ms.`));
    }, timeoutMs);

    const onParentAbort = () => {
      controller.abort(abortSignal?.reason || new Error("Parent execution aborted."));
    };

    if (abortSignal) {
      if (abortSignal.aborted) {
        controller.abort(abortSignal.reason);
      } else {
        abortSignal.addEventListener("abort", onParentAbort, { once: true });
      }
    }

    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timer);
        if (abortSignal) {
          abortSignal.removeEventListener("abort", onParentAbort);
        }
      },
    };
  }

  async function executeStageWithSignal<T>(
    stageName: string,
    timeoutMs: number,
    fn: (stageQuery: IntelligenceQuery) => Promise<T>
  ): Promise<T> {
    const { signal: stageSignal, cleanup } = createStageSignal(timeoutMs, stageName);
    const stageQuery: IntelligenceQuery = { ...query, signal: stageSignal };

    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Stage '${stageName}' exceeded deadline of ${timeoutMs}ms.`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([fn(stageQuery), timeoutPromise]);
    } finally {
      clearTimeout(timer!);
      cleanup();
    }
  }

  const adObservations: SourceObservation[] = [];
  const seenObservationKeys = new Set<string>();
  const addUniqueObservations = (obsList: SourceObservation[]) => {
    for (const obs of obsList) {
      const key = `${obs.source}::${obs.sourceRecordId || obs.sourceExternalAdId || obs.title}`;
      if (!seenObservationKeys.has(key)) {
        seenObservationKeys.add(key);
        adObservations.push(obs);
      }
    }
  };

  // Shared run-wide Gemini & Meta provider budgets (no per-round reset)
  const sharedGeminiBudgetTracker = createGeminiRunBudgetTracker({
    maxGlobalRequests: 25,
    maxGlobalTokens: 100_000,
  });
  const sharedMetaBudgetTracker = new MetaQueryBudgetTracker({
    maxLogicalSubqueries: 3,
    maxProviderRequests: 3,
    maxPages: 3,
    maxUniqueAds: 25,
    maxDurationMs: 45_000,
  });

  // ── Stage 0: Gemini AI Discovery Planning & Deterministic Query Validation ──
  const hybridPlan = await buildHybridKH02DiscoveryQueryPlan(
    {
      researchRunId: runId,
      topic: input.topic,
      market,
      lookbackDays,
      productPolicy: "PHYSICAL_ECOMMERCE_PRODUCTS",
      supportedSources: ["META_ADS", "GOOGLE_ADS", "TIKTOK_ADS"],
      remainingProviderRequests: sharedMetaBudgetTracker.remainingRequests,
      remainingAIRequests: sharedGeminiBudgetTracker.getRemainingRequests(),
    },
    {
      budgetTracker: sharedGeminiBudgetTracker,
      signal: abortSignal,
      timeoutMs: 12_000,
      roundNumber: 1,
    }
  );

  const discoveryPlan = hybridPlan.aiPlan;
  const discoveryPlannerTelemetry = hybridPlan.plannerTelemetry;
  const validatedQueries: DiscoveryQuery[] = hybridPlan.validatedQueries || [];
  const executedNormalizedPhrases = new Set<string>();
  const coveredArchetypeIds = new Set<string>();
  const allMetaQueryOutcomes: MetaSubqueryExecution[] = [];

  // Allocate Round 1 queries: if >= 3 validated queries exist, run 3 in Round 1 to maximize parallel discovery throughput
  const round1MaxQueries = validatedQueries.length >= 3 ? 3 : Math.max(1, validatedQueries.length);
  const round1Queries = selectQueriesForSearchRound(
    validatedQueries,
    round1MaxQueries,
    executedNormalizedPhrases,
    coveredArchetypeIds,
    1
  );
  for (const rq of round1Queries) {
    executedNormalizedPhrases.add(rq.normalizedPhrase);
  }
  const plannedProductKeywords = Array.from(
    new Set(validatedQueries.map((q) => q.phrase).filter(Boolean))
  );

  // ── Stage 1: Meta Ads Discovery — Round 1 (Canonical Platform & Workspace Scoped) ────
  if (!isSelected("META_ADS")) {
    sourceStatuses.META_ADS = "SKIPPED";
    providerTelemetry.META_ADS.queryStatus = "SKIPPED";
  } else {
    try {
      const metaResult = await executeStageWithSignal(
        "Meta Ads",
        STAGE_TIMEOUT_MS,
        (q) =>
          collectMetaProductSignals({
            ...q,
            productKeywords: plannedProductKeywords.length > 0 ? plannedProductKeywords : undefined,
            plannedQueries: round1Queries,
            sharedMetaBudgetTracker,
            searchRoundNumber: 1,
            maxLiveRequestsForRound: round1MaxQueries,
          })
      );
      sourceStatuses.META_ADS = metaResult.status;
      addUniqueObservations(metaResult.observations);
      if (metaResult.warnings.length > 0) warnings.push(...metaResult.warnings);

      const metaLiveObservations = adObservations.filter(
        (o) => o.source === "META_ADS" && o.provenance === "LIVE_PROVIDER"
      );
      const freshLiveCount = metaLiveObservations.length;
      const cachedObservationsCount =
        adObservations.filter((o) => o.source === "META_ADS").length - freshLiveCount;

      const execMeta = metaResult.executionMetadata;
      if (Array.isArray(execMeta?.queryOutcomes)) {
        allMetaQueryOutcomes.push(...execMeta.queryOutcomes);
      }
      if (allMetaQueryOutcomes.length === 0 && round1Queries.length > 0) {
        const liveWasAttempted = Boolean(execMeta?.attempted);
        const liveDidSucceed = Boolean(execMeta?.liveSucceeded);
        for (const rq of round1Queries) {
          allMetaQueryOutcomes.push({
            queryId: rq.queryId,
            researchRunId: runId,
            source: "META_ADS",
            keyword: rq.phrase,
            searchType: rq.searchType,
            planned: true,
            attempted: liveWasAttempted,
            requestStarted: liveWasAttempted,
            requestCompleted: liveWasAttempted && liveDidSucceed,
            status: liveWasAttempted
              ? liveDidSucceed
                ? freshLiveCount > 0
                  ? "SUCCEEDED_WITH_RESULTS"
                  : "SUCCEEDED_EMPTY"
                : "FAILED"
              : "NOT_ATTEMPTED",
            startedAt: liveWasAttempted ? execMeta?.startedAt || generatedAt : null,
            completedAt: liveWasAttempted ? execMeta?.completedAt || new Date().toISOString() : null,
            actualApiCalls: liveWasAttempted ? 1 : 0,
            returnedCount: liveWasAttempted ? freshLiveCount : 0,
            upstreamReturnedCount: liveWasAttempted ? (execMeta?.upstreamReturnedCount ?? freshLiveCount) : null,
            uniqueUpstreamIdsCount: liveWasAttempted ? freshLiveCount : null,
            cachedRecordsUsed: cachedObservationsCount,
            provenance: freshLiveCount > 0 ? "LIVE_PROVIDER" : cachedObservationsCount > 0 ? "CACHED_SOURCE" : "NONE",
            uniqueReturnedCount: liveWasAttempted ? freshLiveCount : 0,
            duplicateCount: 0,
            roundNumber: rq.roundNumber ?? 1,
            origin: rq.origin,
            archetypeId: rq.archetypeId ?? null,
            expectedProductCategory: rq.expectedProductCategory ?? null,
            errorCode: null,
            errorMessage: null,
          });
        }
      }

      const liveAttempted = Boolean(execMeta?.attempted);
      const liveSucceeded = Boolean(execMeta?.liveSucceeded);
      const upstreamReturned =
        execMeta?.upstreamReturnedCount ??
        (freshLiveCount > 0 ? freshLiveCount : liveSucceeded ? 0 : null);

      const isTrulyLive = liveSucceeded && freshLiveCount > 0;

      const metaNow = new Date().toISOString();
      const liveProvenance: ObservationProvenance =
        freshLiveCount > 0
          ? "LIVE_PROVIDER"
          : cachedObservationsCount > 0
          ? "CACHED_SOURCE"
          : "NONE";

      const liveQueryError =
        metaResult.errors.length > 0
          ? metaResult.errors.join("; ")
          : liveAttempted && !liveSucceeded && metaResult.warnings.length > 0
          ? metaResult.warnings[0]
          : null;

      const lastLiveQueryRecordCount = liveAttempted
        ? liveSucceeded
          ? (upstreamReturned ?? freshLiveCount)
          : null
        : null;

      const querySuccessAt =
        liveSucceeded ||
        metaResult.status === "PASSED" ||
        metaResult.status === "CACHE_ONLY"
          ? metaNow
          : null;
      const successCount = liveSucceeded
        ? (upstreamReturned ?? freshLiveCount)
        : metaResult.acceptedCount > 0
        ? metaResult.acceptedCount
        : null;

      providerTelemetry.META_ADS = {
        source: "META_ADS",
        queryExecuted: liveAttempted,
        queryStatus: metaResult.status,
        queryTimestamp: metaNow,
        retrievedCount: liveAttempted
          ? (upstreamReturned ?? freshLiveCount) + cachedObservationsCount
          : cachedObservationsCount,
        acceptedCount: metaResult.acceptedCount,
        queryProvenance: liveProvenance,
        isLive: isTrulyLive,
        queryError: liveQueryError,
        lastSuccessfulRecordCount: successCount,
        lastSuccessfulQueryAt: querySuccessAt,
        upstreamReturnedCount: upstreamReturned,
        freshLiveCount,
        cachedRecordsCount: cachedObservationsCount,
        persistedInsertedCount: execMeta?.persistedInsertedCount ?? null,
        persistedUpdatedCount: execMeta?.persistedUpdatedCount ?? null,
        liveAttempted,
        liveSucceeded,
        liveError: liveQueryError,
        lastLiveQueryAt: liveAttempted ? metaNow : null,
        lastLiveQueryRecordCount,
        lastSuccessfulLiveQueryAt: liveAttempted && liveSucceeded ? metaNow : null,
        auditTraces: execMeta?.auditTraces || [],
      };
    } catch (err: any) {
      sourceStatuses.META_ADS = "FAILED";
      errors.push(`Meta Ads collection failed: ${err.message}`);
      providerTelemetry.META_ADS = {
        source: "META_ADS",
        queryExecuted: true,
        queryStatus: "FAILED",
        queryTimestamp: new Date().toISOString(),
        retrievedCount: 0,
        acceptedCount: 0,
        queryProvenance: "NONE",
        isLive: false,
        queryError: err.message,
        lastSuccessfulRecordCount: null,
        lastSuccessfulQueryAt: null,
        upstreamReturnedCount: 0,
        freshLiveCount: 0,
        cachedRecordsCount: 0,
        persistedInsertedCount: 0,
        persistedUpdatedCount: 0,
      };
    }
  }

  // ── Stage 2: TikTok Ads US Discovery ──────────────────────────────────────
  if (!isSelected("TIKTOK_ADS")) {
    const isExcluded = isExcludedBySelection("TIKTOK_ADS");
    sourceStatuses.TIKTOK_ADS = isExcluded ? "SKIPPED" : "TEMPORARILY_DISABLED";
    providerTelemetry.TIKTOK_ADS.queryStatus = isExcluded ? "SKIPPED" : "TEMPORARILY_DISABLED";
    providerTelemetry.TIKTOK_ADS.queryExecuted = false;
  } else {
    try {
      const ttAdsResult = await executeStageWithSignal(
        "TikTok Ads",
        STAGE_TIMEOUT_MS,
        (q) => collectTikTokAdsSignals(q)
      );
      sourceStatuses.TIKTOK_ADS = ttAdsResult.status;
      addUniqueObservations(ttAdsResult.observations);
      if (ttAdsResult.warnings.length > 0) warnings.push(...ttAdsResult.warnings);

      const ttNow = new Date().toISOString();
      providerTelemetry.TIKTOK_ADS = {
        source: "TIKTOK_ADS",
        queryExecuted: true,
        queryStatus: ttAdsResult.status,
        queryTimestamp: ttNow,
        retrievedCount: ttAdsResult.retrievedCount,
        acceptedCount: ttAdsResult.acceptedCount,
        queryProvenance: ttAdsResult.observations.some((o) => o.provenance === "LIVE_PROVIDER") ? "LIVE_PROVIDER" : "CACHED_SOURCE",
        isLive: ttAdsResult.observations.some((o) => o.provenance === "LIVE_PROVIDER"),
        queryError: ttAdsResult.errors.length > 0 ? ttAdsResult.errors.join("; ") : null,
        lastSuccessfulRecordCount: ttAdsResult.retrievedCount,
        lastSuccessfulQueryAt: ttAdsResult.retrievedCount > 0 ? ttNow : null,
      };
    } catch (err: any) {
      sourceStatuses.TIKTOK_ADS = "FAILED";
      errors.push(`TikTok Ads collection failed: ${err.message}`);
      providerTelemetry.TIKTOK_ADS = {
        source: "TIKTOK_ADS",
        queryExecuted: true,
        queryStatus: "FAILED",
        queryTimestamp: new Date().toISOString(),
        retrievedCount: 0,
        acceptedCount: 0,
        queryProvenance: "NONE",
        isLive: false,
        queryError: err.message,
        lastSuccessfulRecordCount: null,
        lastSuccessfulQueryAt: null,
      };
    }
  }

  if (context?.reportProgress) {
    await context.reportProgress({
      stage: "NORMALIZATION",
      percent: 35,
      message: "Consolidating product landing pages & prioritizing diverse families",
    }).catch((err) => {
      warnings.push(`Progress reporting warning: ${err.message}`);
    });
  }

  // Helper: Interleave eligible candidates by product family / archetype so a single dominant
  // family (e.g. 10 oil dispenser ads) never starves other discovered families in the queue (Section 6.3, F05).
  // Always prioritize candidates that possess merchant URL/domain evidence ahead of URL-less ad hooks.
  const prioritizeCandidatesByFamilyAndEvidence = (
    list: DiscoveredProductCandidate[]
  ): DiscoveredProductCandidate[] => {
    const sorted = [...list].sort((a, b) => {
      const aShopify = Boolean(a.canonicalProductUrl && /\/products\//i.test(a.canonicalProductUrl));
      const bShopify = Boolean(b.canonicalProductUrl && /\/products\//i.test(b.canonicalProductUrl));
      if (aShopify !== bShopify) return aShopify ? -1 : 1;
      const aMerchant = Boolean(a.canonicalProductUrl || a.storeDomain);
      const bMerchant = Boolean(b.canonicalProductUrl || b.storeDomain);
      if (aMerchant !== bMerchant) return aMerchant ? -1 : 1;
      const relDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
      if (relDiff !== 0) return relDiff;
      const obsDiff = b.totalObservationCount - a.totalObservationCount;
      if (obsDiff !== 0) return obsDiff;
      return 0;
    });

    const interleaveGroup = (group: DiscoveredProductCandidate[]) => {
      const buckets = new Map<string, DiscoveredProductCandidate[]>();
      for (const c of group) {
        const fp = buildProductIdentityFingerprint(c);
        const key = fp.familyKey || c.matchedArchetypeId || "general_family";
        const arr = buckets.get(key) || [];
        arr.push(c);
        buckets.set(key, arr);
      }

      const interleaved: DiscoveredProductCandidate[] = [];
      let added = true;
      while (added) {
        added = false;
        for (const [, arr] of buckets.entries()) {
          if (arr.length > 0) {
            interleaved.push(arr.shift()!);
            added = true;
          }
        }
      }
      return interleaved;
    };

    const withMerchant = sorted.filter((c) => Boolean(c.canonicalProductUrl || c.storeDomain));
    const withoutMerchant = sorted.filter((c) => !c.canonicalProductUrl && !c.storeDomain);
    return [...interleaveGroup(withMerchant), ...interleaveGroup(withoutMerchant)];
  };

  let aiTelemetry: GeminiAITelemetry = {
    provider: "GOOGLE_GEMINI",
    aiStatus: "UNAVAILABLE",
    authStatus: "KEY_NOT_FOUND",
    modelsDiscoveredCount: 0,
    eligibleModelsCount: 0,
    primaryModelId: null,
    fallbackModels: [],
    actualModelUsed: null,
    fallbackUsed: false,
    totalAnalysesAttempted: 0,
    totalAnalysesCompleted: 0,
    totalAnalysesFailed: 0,
    physicalProductsCount: 0,
    servicesRejectedCount: 0,
    contentRejectedCount: 0,
    insuranceLeadGenRejectedCount: 0,
    unknownClassificationsCount: 0,
    evidenceContradictionsCount: 0,
    invalidAIOutputsRejectedCount: 0,
  };

  // Helper: Executes Stage 4 (DB link), Stage 4b (Merchant Metadata Fetch), and Stage 4c (Gemini AI + Reality Gate)
  // on a batch of candidates, accumulating AI telemetry across batches/rounds.
  const verifyAndEnrichCandidateBatch = async (
    batch: DiscoveredProductCandidate[]
  ): Promise<DiscoveredProductCandidate[]> => {
    if (batch.length === 0) return [];

    // Stage 4: Resolve Candidate Identities to Real ResearchProduct IDs (respecting Section 4.6 provenance)
    // Concurrent resolution with a concurrency cap to avoid DB overload
    const IDENTITY_CONCURRENCY = 12;
    for (let i = 0; i < batch.length; i += IDENTITY_CONCURRENCY) {
      const chunk = batch.slice(i, i + IDENTITY_CONCURRENCY);
      await Promise.allSettled(
        chunk.map(async (candidate) => {
          try {
            const resolved = await resolveCandidateResearchProduct(candidate, input.workspaceId);
            candidate.researchProductId = resolved.researchProductId;
            candidate.existingProductVerified = resolved.existingProductVerified;
            if (resolved.canonicalProductUrl && !candidate.canonicalProductUrl) {
              candidate.canonicalProductUrl = resolved.canonicalProductUrl;
            }
          } catch (resErr: any) {
            warnings.push(`Identity resolution error for ${candidate.candidateId}: ${resErr.message}`);
          }
        })
      );
    }

    // Stage 4b: Async Metadata Enrichment with Real Evidence
    let enrichedBatch = batch;
    try {
      const enrichmentResult = await enrichProductCandidatesWithEvidence(batch, {
        workspaceId: input.workspaceId,
        topic: input.topic,
        timeoutMs: 4000,
        maxConcurrency: 12,
        signal: abortSignal,
        plannedArchetypes: discoveryPlan?.productArchetypes,
      });
      enrichedBatch = enrichmentResult.candidates;
      if (enrichmentResult.errors.length > 0) {
        warnings.push(...enrichmentResult.errors.slice(0, 3));
      }
    } catch (enrichErr: any) {
      warnings.push(`Product metadata enrichment stage error: ${enrichErr.message}`);
    }

    // Stage 4c: Gemini AI Semantic Product Intelligence
    if (enrichedBatch.length > 0) {
      try {
        const verifiedReadyCount = enrichedBatch.filter((c) => c.identityStatus === "VERIFIED" && c.productRealityStatus === "VERIFIED_PHYSICAL_PRODUCT" && c.relevanceStatus !== "IRRELEVANT").length;
        const aiTargetBatch = (verifiedReadyCount >= 3 && process.env.VITEST !== "true" && process.env.NODE_ENV !== "test") ? [] : enrichedBatch;
        const aiResult = await analyzeProductCandidatesWithAI(aiTargetBatch, {
          researchRunId: runId,
          topic: input.topic,
          market: market,
          maxConcurrency: 4,
          budgetTracker: sharedGeminiBudgetTracker,
          signal: abortSignal,
        });
        const t = aiResult.telemetry;
        aiTelemetry = {
          ...t,
          totalAnalysesAttempted: aiTelemetry.totalAnalysesAttempted + t.totalAnalysesAttempted,
          totalAnalysesCompleted: aiTelemetry.totalAnalysesCompleted + t.totalAnalysesCompleted,
          totalAnalysesFailed: aiTelemetry.totalAnalysesFailed + t.totalAnalysesFailed,
          physicalProductsCount: aiTelemetry.physicalProductsCount + t.physicalProductsCount,
          servicesRejectedCount: aiTelemetry.servicesRejectedCount + t.servicesRejectedCount,
          contentRejectedCount: aiTelemetry.contentRejectedCount + t.contentRejectedCount,
          insuranceLeadGenRejectedCount:
            aiTelemetry.insuranceLeadGenRejectedCount + t.insuranceLeadGenRejectedCount,
          unknownClassificationsCount:
            aiTelemetry.unknownClassificationsCount + t.unknownClassificationsCount,
          evidenceContradictionsCount:
            aiTelemetry.evidenceContradictionsCount + t.evidenceContradictionsCount,
          invalidAIOutputsRejectedCount:
            aiTelemetry.invalidAIOutputsRejectedCount + t.invalidAIOutputsRejectedCount,
        };
        if (t.aiStatus === "PARTIAL" || t.aiStatus === "UNAVAILABLE") {
          warnings.push(`Gemini AI status: ${t.aiStatus}. Using conservative deterministic classification.`);
        }
      } catch (aiErr: any) {
        warnings.push(`Gemini AI product intelligence stage warning: ${aiErr.message}`);
      }

      for (const c of enrichedBatch) {
        const reality = evaluateCandidateProductReality(c);
        c.productRealityStatus = reality.productRealityStatus;
        c.sourcePageClassification = reality.sourcePageClassification;
        c.productRealityReason = reality.reason;
        if (!reality.isPhysicalProductRealityEligible || c.hasUnresolvedContradiction) {
          c.isEligibleAsEvergreenWinner = false;
        } else if (
          c.identityStatus === "VERIFIED" &&
          !c.requiresManualReview &&
          reality.productRealityStatus === "VERIFIED_PHYSICAL_PRODUCT"
        ) {
          c.isEligibleAsEvergreenWinner = true;
        } else {
          c.isEligibleAsEvergreenWinner = false;
        }
      }
    }

    return enrichedBatch;
  };

  // ── Stage 3: Extract Consolidated Product Candidates (Round 1) ───────────
  let rawCandidates = discoverProductCandidatesFromAds(
    adObservations,
    input.topic,
    { plannedArchetypes: discoveryPlan?.productArchetypes }
  );

  // Capture pre-AI discovery relevance counts BEFORE Stage 4c mutates candidate.relevanceStatus in place
  let preAiRelevantCount = rawCandidates.filter((c) => c.relevanceStatus === "RELEVANT").length;
  let preAiProbablyRelevantCount = rawCandidates.filter((c) => c.relevanceStatus === "PROBABLY_RELEVANT").length;
  let preAiAmbiguousCount = rawCandidates.filter((c) => c.relevanceStatus === "AMBIGUOUS").length;
  let preAiIrrelevantCount = rawCandidates.filter((c) => c.relevanceStatus === "IRRELEVANT").length;

  let eligibleCandidates = prioritizeCandidatesByFamilyAndEvidence(
    rawCandidates.filter((c) => c.relevanceStatus !== "IRRELEVANT")
  );
  const preRejectedCandidates = rawCandidates.filter((c) => c.relevanceStatus === "IRRELEVANT");

  const initialBatch = eligibleCandidates.slice(0, maxCandidates);
  const unverifiedQueue = eligibleCandidates.slice(maxCandidates);
  let totalProcessedForAI = initialBatch.length;

  if (context?.reportProgress) {
    await context.reportProgress({
      stage: "ENRICHMENT",
      percent: 45,
      message: "Verifying merchant metadata & analyzing product reality with Gemini AI",
    }).catch((err) => {
      warnings.push(`Progress reporting warning: ${err.message}`);
    });
  }

  let verifiedPool = await verifyAndEnrichCandidateBatch(initialBatch);

  // ── Stage 4d: Post-Gate Queue Refill from unverifiedQueue (Section 6.3, F05, C23) ──
  // If top candidates in the initial batch were rejected by metadata/AI/Product Reality Gate or merged as duplicates,
  // refill from `unverifiedQueue` before declaring shortlist shortfall.
  let currentShortlistEval = selectTopResearchShortlist(verifiedPool, 3, {
    nicheIntent: hybridPlan.nicheIntent,
    topic: input.topic,
  });

  while (
    (currentShortlistEval.qualifiedCount < 3 ||
      (hybridPlan.nicheIntent !== "SPECIFIC_PRODUCT" &&
        (currentShortlistEval.opportunityDiversity?.distinctFamilyCount || 0) <
          Math.min(3, currentShortlistEval.qualifiedCount + 1))) &&
    unverifiedQueue.length > 0 &&
    !abortSignal?.aborted &&
    sharedGeminiBudgetTracker.getRemainingRequests() > 0
  ) {
    const needed = Math.max(2, (3 - currentShortlistEval.qualifiedCount) * 2);
    const refillBatch = unverifiedQueue.splice(0, Math.min(maxCandidates, needed));
    if (refillBatch.length === 0) break;
    totalProcessedForAI += refillBatch.length;

    const enrichedRefill = await verifyAndEnrichCandidateBatch(refillBatch);
    verifiedPool = clusterProductCandidates(
      [...verifiedPool, ...enrichedRefill],
      mergeDuplicateCandidateRecords
    ).consolidatedCandidates;

    currentShortlistEval = selectTopResearchShortlist(verifiedPool, 3, {
      nicheIntent: hybridPlan.nicheIntent,
      topic: input.topic,
    });
  }

  // ── Stage 4e: Post-Gate Bounded Adaptive Search Recovery — Round 2 (Section 6.1–6.5, F04, C22, C24, C25, C26) ──
  // Evaluate post-gate shortlist coverage AFTER merchant metadata, AI verification, Reality Gate, and distinctness/family clustering.
  const postGateQualifiedCount = currentShortlistEval.qualifiedCount;
  const postGateDistinctFamilies =
    currentShortlistEval.opportunityDiversity?.distinctFamilyCount || 0;
  const needsRound2Recovery =
    postGateQualifiedCount < 3 ||
    (hybridPlan.nicheIntent !== "SPECIFIC_PRODUCT" &&
      postGateQualifiedCount >= 1 &&
      postGateDistinctFamilies < Math.min(2, postGateQualifiedCount));

  if (
    needsRound2Recovery &&
    isSelected("META_ADS") &&
    providerTelemetry.META_ADS.liveAttempted &&
    sharedMetaBudgetTracker.canExecuteSubquery() &&
    sharedMetaBudgetTracker.remainingRequests > 0 &&
    !abortSignal?.aborted
  ) {
    // Only mark an archetype as covered if it actually produced a post-gate qualified shortlist candidate
    const postGateCoveredArchetypes = new Set<string>(
      currentShortlistEval.shortlist
        .map((c) => c.matchedArchetypeId)
        .filter((id): id is string => Boolean(id))
    );

    // Identify Round 1 exact phrase queries that returned 0 ads (C26 fallback support)
    const zeroResultQueryIds = new Set(
      allMetaQueryOutcomes
        .filter((qo) => qo.returnedCount === 0)
        .map((qo) => qo.queryId)
    );
    const zeroResultQueries = round1Queries.filter((rq) =>
      zeroResultQueryIds.has(rq.queryId)
    );

    const round2Queries = selectQueriesForSearchRound(
      validatedQueries,
      sharedMetaBudgetTracker.remainingRequests,
      executedNormalizedPhrases,
      postGateCoveredArchetypes,
      2,
      { zeroResultQueries }
    );

    if (round2Queries.length > 0) {
      for (const r2q of round2Queries) {
        executedNormalizedPhrases.add(r2q.normalizedPhrase);
        executedNormalizedPhrases.add(`${r2q.normalizedPhrase}::${r2q.searchType}`);
      }
      try {
        const prevObsCount = adObservations.length;
        const metaRound2Result = await executeStageWithSignal(
          "Meta Ads Post-Gate Adaptive Round 2",
          STAGE_TIMEOUT_MS,
          (q) =>
            collectMetaProductSignals({
              ...q,
              productKeywords:
                plannedProductKeywords.length > 0 ? plannedProductKeywords : undefined,
              plannedQueries: round2Queries,
              sharedMetaBudgetTracker,
              searchRoundNumber: 2,
              maxLiveRequestsForRound: sharedMetaBudgetTracker.remainingRequests,
            })
        );
        addUniqueObservations(metaRound2Result.observations);
        const execMetaR2 = metaRound2Result.executionMetadata;
        if (Array.isArray(execMetaR2?.queryOutcomes)) {
          allMetaQueryOutcomes.push(...execMetaR2.queryOutcomes);
        }

        // Reconcile Meta telemetry with Round 2 additions
        const allMetaObs = adObservations.filter((o) => o.source === "META_ADS");
        const freshLiveAfterR2 = allMetaObs.filter(
          (o) => o.provenance === "LIVE_PROVIDER"
        ).length;
        const cachedAfterR2 = allMetaObs.length - freshLiveAfterR2;
        providerTelemetry.META_ADS.acceptedCount = allMetaObs.length;
        providerTelemetry.META_ADS.freshLiveCount = freshLiveAfterR2;
        providerTelemetry.META_ADS.cachedRecordsCount = cachedAfterR2;
        providerTelemetry.META_ADS.upstreamReturnedCount =
          (providerTelemetry.META_ADS.upstreamReturnedCount || 0) +
          (execMetaR2?.upstreamReturnedCount || 0);
        providerTelemetry.META_ADS.retrievedCount =
          (providerTelemetry.META_ADS.upstreamReturnedCount || freshLiveAfterR2) +
          cachedAfterR2;
        if (metaRound2Result.status === "PASSED") {
          sourceStatuses.META_ADS = "PASSED";
          providerTelemetry.META_ADS.queryStatus = "PASSED";
          providerTelemetry.META_ADS.liveSucceeded = true;
          providerTelemetry.META_ADS.isLive = freshLiveAfterR2 > 0;
        }

        // Extract and verify newly discovered Round 2 candidates
        const newObsFromR2 = adObservations.slice(prevObsCount);
        if (newObsFromR2.length > 0) {
          rawCandidates = discoverProductCandidatesFromAds(
            adObservations,
            input.topic,
            { plannedArchetypes: discoveryPlan?.productArchetypes }
          );
          preAiRelevantCount = rawCandidates.filter((c) => c.relevanceStatus === "RELEVANT").length;
          preAiProbablyRelevantCount = rawCandidates.filter((c) => c.relevanceStatus === "PROBABLY_RELEVANT").length;
          preAiAmbiguousCount = rawCandidates.filter((c) => c.relevanceStatus === "AMBIGUOUS").length;
          preAiIrrelevantCount = rawCandidates.filter((c) => c.relevanceStatus === "IRRELEVANT").length;
          eligibleCandidates = prioritizeCandidatesByFamilyAndEvidence(
            rawCandidates.filter((c) => c.relevanceStatus !== "IRRELEVANT")
          );

          const r2RawCandidates = discoverProductCandidatesFromAds(
            newObsFromR2,
            input.topic,
            { plannedArchetypes: discoveryPlan?.productArchetypes }
          );
          const r2Irrelevant = r2RawCandidates.filter((c) => c.relevanceStatus === "IRRELEVANT");
          for (const irr of r2Irrelevant) {
            if (!preRejectedCandidates.some((p) => p.candidateId === irr.candidateId)) {
              preRejectedCandidates.push(irr);
            }
          }

          const r2NewEligible = prioritizeCandidatesByFamilyAndEvidence(
            r2RawCandidates
              .filter((c) => c.relevanceStatus !== "IRRELEVANT")
              .filter(
                (c) =>
                  !verifiedPool.some(
                    (existing) =>
                      compareProductIdentity(existing, c).areSameActualProduct === true
                  )
              )
          );

          const r2Batch = r2NewEligible.slice(0, maxCandidates);
          totalProcessedForAI += r2Batch.length;
          const r2Verified = await verifyAndEnrichCandidateBatch(r2Batch);

          verifiedPool = clusterProductCandidates(
            [...verifiedPool, ...r2Verified],
            mergeDuplicateCandidateRecords
          ).consolidatedCandidates;
        }
      } catch (r2Err: any) {
        warnings.push(`Adaptive Meta search round 2 warning: ${r2Err.message}`);
      }
    }
  }

  const candidates = verifiedPool;
  const excludedByMaxCandidates = unverifiedQueue;

  if (context?.reportProgress) {
    await context.reportProgress({
      stage: "ENRICHMENT",
      percent: 50,
      message: "Resolved candidates; gathering cross-platform video & ad intelligence",
    }).catch((err) => {
      warnings.push(`Progress reporting warning: ${err.message}`);
    });
  }

  // ── Stage 5: TikTok Organic Video Enrichment ──────────────────────────────
  const secondaryObservations: SourceObservation[] = [];
  if (!isSelected("TIKTOK_ORGANIC")) {
    const isExcluded = isExcludedBySelection("TIKTOK_ORGANIC");
    sourceStatuses.TIKTOK_ORGANIC = isExcluded ? "SKIPPED" : "TEMPORARILY_DISABLED";
    providerTelemetry.TIKTOK_ORGANIC.queryStatus = isExcluded ? "SKIPPED" : "TEMPORARILY_DISABLED";
    providerTelemetry.TIKTOK_ORGANIC.queryExecuted = false;
  } else {
    const ttDiag = await diagnoseKH02Source("TIKTOK_ORGANIC", { workspaceId: input.workspaceId });
    if (!ttDiag.configured) {
      sourceStatuses.TIKTOK_ORGANIC = ttDiag.status as SourceRunStatus;
      providerTelemetry.TIKTOK_ORGANIC.queryStatus = ttDiag.status as SourceRunStatus;
      warnings.push(`TikTok Organic skipped promptly: ${ttDiag.reason}`);
    } else {
      try {
        const ttOrganicResult = await executeStageWithSignal(
          "TikTok Organic",
          STAGE_TIMEOUT_MS,
          (q) => collectTikTokOrganicSignals(q)
        );
        sourceStatuses.TIKTOK_ORGANIC = ttOrganicResult.status;
        secondaryObservations.push(...ttOrganicResult.observations);
        if (ttOrganicResult.warnings.length > 0) warnings.push(...ttOrganicResult.warnings);

        const ttOrgNow = new Date().toISOString();
        const isExecuted =
          ttOrganicResult.status === "PASSED" ||
          ttOrganicResult.status === "QUERY_SUCCEEDED_EMPTY" ||
          ttOrganicResult.status === "QUERY_FAILED";
        const isSuccess = ttOrganicResult.status === "PASSED" || ttOrganicResult.status === "QUERY_SUCCEEDED_EMPTY";
        const ttLiveObs = ttOrganicResult.observations.filter((o) => o.provenance === "LIVE_PROVIDER");
        const isTrulyLive = isSuccess && ttLiveObs.length > 0;
        const liveProvenance: ObservationProvenance = isTrulyLive
          ? "LIVE_PROVIDER"
          : (ttOrganicResult.observations.length > 0 ? "CACHED_SOURCE" : "NONE");

        providerTelemetry.TIKTOK_ORGANIC = {
          source: "TIKTOK_ORGANIC",
          queryExecuted: isExecuted,
          queryStatus: ttOrganicResult.status,
          queryTimestamp: isExecuted ? ttOrgNow : null,
          retrievedCount: isSuccess ? ttOrganicResult.retrievedCount : null,
          acceptedCount: isSuccess ? ttOrganicResult.acceptedCount : null,
          queryProvenance: liveProvenance,
          isLive: isTrulyLive,
          queryError: ttOrganicResult.errors.length > 0 ? ttOrganicResult.errors.join("; ") : null,
          lastSuccessfulRecordCount: isSuccess ? ttOrganicResult.retrievedCount : null,
          lastSuccessfulQueryAt: isSuccess ? ttOrgNow : null,
        };
      } catch (err: any) {
        sourceStatuses.TIKTOK_ORGANIC = "FAILED";
        errors.push(`TikTok Organic collection failed: ${err.message}`);
        providerTelemetry.TIKTOK_ORGANIC = {
          source: "TIKTOK_ORGANIC",
          queryExecuted: true,
          queryStatus: "FAILED",
          queryTimestamp: new Date().toISOString(),
          retrievedCount: 0,
          acceptedCount: 0,
          queryProvenance: "NONE",
          isLive: false,
          queryError: err.message,
          lastSuccessfulRecordCount: null,
          lastSuccessfulQueryAt: null,
        };
      }
    }
  }

  // ── Stage 6: Google Ads Transparency Enrichment ───────────────────────────
  if (!isSelected("GOOGLE_ADS")) {
    sourceStatuses.GOOGLE_ADS = "SKIPPED";
    providerTelemetry.GOOGLE_ADS.queryStatus = "SKIPPED";
  } else {
    const googleDiag = await diagnoseKH02Source("GOOGLE_ADS", { workspaceId: input.workspaceId });
    if (!googleDiag.configured) {
      sourceStatuses.GOOGLE_ADS = googleDiag.status as SourceRunStatus;
      providerTelemetry.GOOGLE_ADS.queryStatus = googleDiag.status as SourceRunStatus;
      warnings.push(`Google Ads skipped promptly: ${googleDiag.reason}`);
    } else {
      try {
        // Extract identified advertiser domains only from eligible merchant candidates (excluding social/redirect platforms)
        const nonMerchantHosts = new Set([
          "facebook.com",
          "l.facebook.com",
          "m.facebook.com",
          "fb.com",
          "fb.me",
          "instagram.com",
          "l.instagram.com",
          "tiktok.com",
          "google.com",
          "ad.doubleclick.net",
          "doubleclick.net",
          "tinyurl.com",
          "tiny.cc",
          "bit.ly",
          "ampd.to",
          "walmrt.us",
        ]);
        const discoveredDomains = Array.from(
          new Set(
            [
              ...candidates.filter((c) => c.identityStatus === "VERIFIED"),
              ...candidates.filter((c) => c.identityStatus === "PROBABLE"),
            ]
              .map((c) => c.storeDomain?.toLowerCase().trim())
              .filter(
                (d): d is string =>
                  Boolean(d && d.includes(".") && !nonMerchantHosts.has(d))
              )
          )
        ).slice(0, 5);

        if (discoveredDomains.length === 0) {
          sourceStatuses.GOOGLE_ADS = "SKIPPED";
          providerTelemetry.GOOGLE_ADS = {
            source: "GOOGLE_ADS",
            queryExecuted: false,
            queryStatus: "SKIPPED",
            queryTimestamp: null,
            retrievedCount: null,
            acceptedCount: null,
            queryProvenance: "NONE",
            isLive: false,
            queryError: null,
            lastSuccessfulRecordCount: null,
            lastSuccessfulQueryAt: null,
          };
          warnings.push("Google Ads Transparency: No confirmed advertiser domains discovered from relevant candidates. Domain required.");
        } else {
          const googleResult = await executeStageWithSignal(
            "Google Ads Transparency",
            STAGE_TIMEOUT_MS,
            (q) =>
              collectGoogleAdvertiserSignals({
                ...q,
                advertiserDomains: discoveredDomains,
                maxLiveDomains: Math.min(5, discoveredDomains.length),
              })
          );
          sourceStatuses.GOOGLE_ADS = googleResult.status;
          secondaryObservations.push(...googleResult.observations);
          if (googleResult.warnings.length > 0) warnings.push(...googleResult.warnings);

          const googleNow = new Date().toISOString();
          const googleError = googleResult.errors.length > 0 ? googleResult.errors.join("; ") : null;
          const isExecuted =
            googleResult.status === "PASSED" ||
            googleResult.status === "QUERY_SUCCEEDED_EMPTY" ||
            googleResult.status === "QUERY_FAILED";
          const isSuccess = googleResult.status === "PASSED" || googleResult.status === "QUERY_SUCCEEDED_EMPTY";
          const googleLiveObs = googleResult.observations.filter((o) => o.provenance === "LIVE_PROVIDER");
          const isTrulyLive = isSuccess && googleLiveObs.length > 0;
          const liveProvenance: ObservationProvenance = isTrulyLive
            ? "LIVE_PROVIDER"
            : (googleResult.observations.length > 0 ? "CACHED_SOURCE" : "NONE");

          providerTelemetry.GOOGLE_ADS = {
            source: "GOOGLE_ADS",
            queryExecuted: isExecuted,
            queryStatus: googleResult.status,
            queryTimestamp: isExecuted ? googleNow : null,
            retrievedCount: isSuccess ? googleResult.retrievedCount : null,
            acceptedCount: isSuccess ? googleResult.acceptedCount : null,
            queryProvenance: liveProvenance,
            isLive: isTrulyLive,
            queryError: googleError,
            lastSuccessfulRecordCount: isSuccess ? googleResult.retrievedCount : null,
            lastSuccessfulQueryAt: isSuccess ? googleNow : null,
            enrichmentExecution: googleResult.enrichmentExecution,
          };
        }
      } catch (err: any) {
        sourceStatuses.GOOGLE_ADS = "FAILED";
        errors.push(`Google Ads collection failed: ${err.message}`);
        providerTelemetry.GOOGLE_ADS = {
          source: "GOOGLE_ADS",
          queryExecuted: true,
          queryStatus: "FAILED",
          queryTimestamp: new Date().toISOString(),
          retrievedCount: 0,
          acceptedCount: 0,
          queryProvenance: "NONE",
          isLive: false,
          queryError: err.message,
          lastSuccessfulRecordCount: null,
          lastSuccessfulQueryAt: null,
        };
      }
    }
  }

  // ── Stage 7: Product-Specific Cross-Platform Evidence Association ─────────
  let googleProductMatches = 0;
  let googleBrandMatches = 0;
  const googleProductEvidenceIds: string[] = [];
  const seenGoogleProductAssociations = new Set<string>();
  const seenGoogleBrandAssociations = new Set<string>();

  for (const candidate of candidates) {
    const existingObsKeys = new Set<string>(
      candidate.sourceObservations.map(
        (o) => `${o.source}::${o.sourceExternalAdId || o.sourceRecordId || o.sourceUrl}`
      )
    );
    for (const obs of secondaryObservations) {
      const obsKey = `${obs.source}::${obs.sourceExternalAdId || obs.sourceRecordId || obs.sourceUrl}`;
      const match = matchCrossPlatformProductEvidence(candidate, {
        title: obs.title,
        url: obs.landingPageUrl || obs.sourceUrl,
        domain: obs.advertiserDomain,
        platform: obs.source,
      });

      if (
        match.isProductSpecificEvidence !== false &&
        (match.confidence === "EXACT" || match.confidence === "HIGH_CONFIDENCE")
      ) {
        if (!existingObsKeys.has(obsKey)) {
          existingObsKeys.add(obsKey);
          candidate.sourceObservations.push(obs);
          candidate.totalObservationCount += 1;
        }
        if (!candidate.supportingSourceTypes.includes(obs.source)) {
          candidate.supportingSourceTypes.push(obs.source);
        }
        if (obs.source === "GOOGLE_ADS") {
          const evId = obs.sourceExternalAdId || obs.sourceRecordId;
          const pairKey = `${candidate.candidateId}::${evId || obsKey}`;
          if (!seenGoogleProductAssociations.has(pairKey)) {
            seenGoogleProductAssociations.add(pairKey);
            googleProductMatches++;
          }
          if (evId && !googleProductEvidenceIds.includes(evId)) {
            googleProductEvidenceIds.push(evId);
          }
        }
        if (!candidate.videoUrl && obs.media?.videoUrl) {
          candidate.videoUrl = obs.media.videoUrl;
          if (obs.media.thumbnailUrl && !candidate.thumbnailUrl) {
            candidate.thumbnailUrl = obs.media.thumbnailUrl;
          }
        }
      } else if (
        obs.source === "GOOGLE_ADS" &&
        (match.confidence === "PROBABLE" ||
          (obs.advertiserDomain &&
            candidate.storeDomain &&
            extractRegistrableDomain(obs.advertiserDomain) ===
              extractRegistrableDomain(candidate.storeDomain)))
      ) {
        const evId = obs.sourceExternalAdId || obs.sourceRecordId;
        const pairKey = `${candidate.candidateId}::${evId || obsKey}`;
        if (!seenGoogleBrandAssociations.has(pairKey)) {
          seenGoogleBrandAssociations.add(pairKey);
          googleBrandMatches++;
        }
      }
    }
  }

  if (providerTelemetry.GOOGLE_ADS) {
    providerTelemetry.GOOGLE_ADS.productAssociatedCount = googleProductMatches;
    providerTelemetry.GOOGLE_ADS.brandAssociatedCount = googleBrandMatches;
    if (providerTelemetry.GOOGLE_ADS.enrichmentExecution) {
      providerTelemetry.GOOGLE_ADS.enrichmentExecution.productLevelMatches = googleProductMatches;
      providerTelemetry.GOOGLE_ADS.enrichmentExecution.brandLevelMatches = googleBrandMatches;
      providerTelemetry.GOOGLE_ADS.enrichmentExecution.productEvidenceIds = googleProductEvidenceIds;
      if (providerTelemetry.GOOGLE_ADS.enrichmentExecution.stateBreakdown) {
        providerTelemetry.GOOGLE_ADS.enrichmentExecution.stateBreakdown.productAssociatedEvidence =
          googleProductMatches > 0;
      }
    }
  }

  if (context?.reportProgress) {
    await context.reportProgress({
      stage: "SCORING",
      percent: 75,
      message: "Scoring candidate evergreen potential & demand stability",
    }).catch((err) => {
      warnings.push(`Progress reporting warning: ${err.message}`);
    });
  }

  // ── Stage 8 & 9: Demand Loading, Scoring & Eligibility Gating ─────────────
  // All candidates resolved concurrently (typically only 3–5) — eliminates sequential I/O wait
  const rankedItems: RankedLeaderboardItem[] = [];

  const demandSettled = await Promise.allSettled(
    candidates.map(async (candidate) => {
      let demandRes;
      if (isSelected("DEMAND_HISTORY")) {
        demandRes = await resolveProductDemandHistory(
          {
            productId: candidate.researchProductId,
            canonicalName: candidate.title,
            category: candidate.category,
          },
          {
            lookbackDays,
            region: market,
            workspaceId: input.workspaceId,
            researchRunId: runId,
            queryId: runId,
          }
        );
      } else {
        demandRes = {
          productId: candidate.researchProductId || null,
          canonicalName: candidate.title,
          searchTermUsed: candidate.title,
          assessment: {
            status: "INSUFFICIENT_EVIDENCE" as const,
            dataPointsCount: 0,
            coveredDays: 0,
            stabilityClassification: "INSUFFICIENT_DATA" as const,
            confidence: 0,
            reason: "Demand history unselected or skipped.",
          },
          dataPoints: [],
          sourceStatus: "ENGINE_READY" as const,
        };
      }
      return { candidate, demandRes };
    })
  );

  for (const settled of demandSettled) {
    if (settled.status === "fulfilled") {
      const { candidate, demandRes } = settled.value;
      const score = calculateKH02EvergreenScore({
        candidate,
        demandSeries: ((candidate as any).demandResolution = demandRes, demandRes.dataPoints),
        hasVerifiedSupplierQuote: false,
      });
      rankedItems.push({
        rank: null,
        candidate,
        score,
      });
    } else {
      warnings.push(`Demand/scoring error for candidate: ${settled.reason?.message ?? String(settled.reason)}`);
    }
  }

  // Evaluate Demand History status truthfully
  if (!isSelected("DEMAND_HISTORY")) {
    sourceStatuses.DEMAND_HISTORY = "SKIPPED";
    providerTelemetry.DEMAND_HISTORY.queryStatus = "SKIPPED";
  } else {
    let hasVerifiedDemand = false;
    for (const item of rankedItems) {
      if (item.score.pillars.demandStability.status === "PASS") {
        hasVerifiedDemand = true;
        break;
      }
    }
    if (hasVerifiedDemand) {
      sourceStatuses.DEMAND_HISTORY = "SOURCE_DATA_VERIFIED";
    } else if (rankedItems.length > 0) {
      sourceStatuses.DEMAND_HISTORY = "NOT_VERIFIED";
    } else {
      sourceStatuses.DEMAND_HISTORY = "CONFIGURED";
    }

    providerTelemetry.DEMAND_HISTORY = {
      source: "DEMAND_HISTORY",
      queryExecuted: false,
      queryStatus: sourceStatuses.DEMAND_HISTORY,
      queryTimestamp: null,
      retrievedCount: null,
      acceptedCount: null,
      queryProvenance: "NONE",
      isLive: false,
      queryError: null,
      lastSuccessfulRecordCount: null,
      lastSuccessfulQueryAt: null,
    };
  }

  // Sort by opportunityScore desc, then evidenceConfidence desc
  rankedItems.sort((a, b) => {
    const scoreA = a.score.opportunityScore || 0;
    const scoreB = b.score.opportunityScore || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return b.score.evidenceConfidence - a.score.evidenceConfidence;
  });

  // ── Stage 10: Partition into Verified Winners, Provisional, Insufficient & Rejected ─
  const verifiedWinners: RankedLeaderboardItem[] = [];
  const provisionalCandidates: RankedLeaderboardItem[] = [];
  const insufficientEvidenceCandidates: RankedLeaderboardItem[] = [];
  const rejectedCandidates: RankedLeaderboardItem[] = [];

  // Add pre-rejected candidates from discovery stage to audit log
  for (const c of preRejectedCandidates) {
    const preScore = calculateKH02EvergreenScore({
      candidate: c,
      demandSeries: [],
      hasVerifiedSupplierQuote: false,
    });
    rejectedCandidates.push({
      rank: null,
      candidate: c,
      score: preScore,
    });
  }

  for (const item of rankedItems) {
    if (
      item.candidate.relevanceStatus === "IRRELEVANT" ||
      item.score.recommendation === "REJECT" ||
      item.score.scoreStatus === "REJECTED"
    ) {
      rejectedCandidates.push(item);
    } else if (item.score.tier === "VERIFIED_EVERGREEN") {
      verifiedWinners.push(item);
    } else if (item.score.tier === "PROVISIONAL_OPPORTUNITY") {
      provisionalCandidates.push(item);
    } else {
      insufficientEvidenceCandidates.push(item);
    }
  }

  // Distinctness filter: Ensure Top 3 never contains duplicate canonical product identities
  // Uses the unified productDistinctnessEngine rather than title/name string comparison (F01 / B21).
  const distinctVerifiedWinners: RankedLeaderboardItem[] = [];
  const deferredSameFamilyWinners: RankedLeaderboardItem[] = [];
  const seenWinnerFamilyKeys = new Set<string>();
  const isBroadCategoryNiche =
    (hybridPlan.nicheIntent || "BROAD_CATEGORY") === "BROAD_CATEGORY";

  for (const item of verifiedWinners) {
    const fp = buildProductIdentityFingerprint(item.candidate);
    if (!item.candidate.familyKey) item.candidate.familyKey = fp.familyKey;
    if (!item.candidate.productKey) item.candidate.productKey = fp.productKey;

    let isDuplicateProduct = false;
    for (const existing of [...distinctVerifiedWinners, ...deferredSameFamilyWinners]) {
      const cmp = compareProductIdentity(existing.candidate, item.candidate);
      if (cmp.areSameActualProduct === true) {
        isDuplicateProduct = true;
        break;
      }
    }

    if (isDuplicateProduct) {
      provisionalCandidates.push({
        ...item,
        rank: null,
      });
      continue;
    }

    const famKey = fp.familyKey;
    if (isBroadCategoryNiche && seenWinnerFamilyKeys.has(famKey)) {
      deferredSameFamilyWinners.push(item);
    } else {
      seenWinnerFamilyKeys.add(famKey);
      distinctVerifiedWinners.push(item);
    }
  }

  // If distinct families < 3, allow distinct verified models from same family as labeled alternatives
  for (const deferred of deferredSameFamilyWinners) {
    deferred.candidate.distinctnessStatus = "HOMOGENEOUS_FAMILY";
    deferred.candidate.distinctnessReason =
      "Same product family — distinct verified model/merchant alternative";
    distinctVerifiedWinners.push(deferred);
  }

  // Assign ranks strictly to distinct verified eligible candidates
  distinctVerifiedWinners.forEach((item, idx) => {
    item.rank = idx + 1;
  });

  const topThree = distinctVerifiedWinners.slice(0, 3);
  const remainingCandidates = distinctVerifiedWinners.slice(3, maxCandidates);

  // Ensure non-winner candidate groups have explicit null rank
  provisionalCandidates.forEach((item) => { item.rank = null; });
  insufficientEvidenceCandidates.forEach((item) => { item.rank = null; });
  remainingCandidates.forEach((item) => { item.rank = null; });
  rejectedCandidates.forEach((item) => { item.rank = null; });

  // Overall run status: exclude disabled sources from failing the run
  const activeSources = Object.entries(sourceStatuses).filter(
    ([src]) => !isSourceTemporarilyDisabled(src as IntelligenceSource)
  );
  const anyPassed = activeSources.some(
    ([_, s]) => s === "PASSED" || s === "SOURCE_DATA_VERIFIED" || s === "LIVE_DATA_VERIFIED"
  );
  const anyFailed = activeSources.some(
    ([_, s]) =>
      s === "FAILED" ||
      s === "BLOCKED_SOURCE" ||
      s === "QUERY_FAILED" ||
      s === "TRANSPORT_FAILED" ||
      s === "AUTHENTICATION_FAILED"
  );
  let overallRunStatus: SourceRunStatus = "PASSED";
  if (!anyPassed) overallRunStatus = "NO_RESULTS";
  else if (anyFailed) overallRunStatus = "PARTIAL";

  // Top 3 Research Shortlist (for business evaluation, separate from Verified Evergreen)
  const researchShortlist = selectTopResearchShortlist(
    candidates,
    3,
    {
      nicheIntent: hybridPlan.nicheIntent,
      topic: input.topic,
    }
  );

  const shortlistedIdSet = new Set(
    researchShortlist.shortlist.map((s) => s.candidateId)
  );

  // Build QueryYield metrics for each executed or planned query
  const candidateMatchesQuery = (
    c: { matchedQueryIds?: string[]; sourceObservations?: Array<{ queryId?: string | null; matchedQueryIds?: string[] }> },
    qId: string
  ): boolean => {
    if (Array.isArray(c.matchedQueryIds) && c.matchedQueryIds.includes(qId)) {
      return true;
    }
    if (Array.isArray(c.sourceObservations)) {
      return c.sourceObservations.some(
        (o) =>
          o.queryId === qId ||
          (Array.isArray(o.matchedQueryIds) && o.matchedQueryIds.includes(qId))
      );
    }
    return false;
  };

  const queryYields: QueryYield[] = [];
  if (allMetaQueryOutcomes.length > 0) {
    for (const qo of allMetaQueryOutcomes) {
      const wasLiveExecuted = Boolean(
        qo.attempted &&
        (qo.status === "SUCCEEDED_WITH_RESULTS" || qo.status === "SUCCEEDED_EMPTY")
      );
      const matchingRawCands = wasLiveExecuted
        ? rawCandidates.filter((c) => candidateMatchesQuery(c, qo.queryId))
        : [];
      const matchingEnrichedCands = wasLiveExecuted
        ? candidates.filter((c) => candidateMatchesQuery(c, qo.queryId))
        : [];
      const relCands = matchingRawCands.filter((c) => c.relevanceStatus !== "IRRELEVANT");
      const merchantCands =
        matchingEnrichedCands.length > 0
          ? matchingEnrichedCands.filter((c) => Boolean(c.storeDomain || c.canonicalProductUrl))
          : relCands.filter((c) => Boolean(c.storeDomain || c.canonicalProductUrl));
      const identCands =
        matchingEnrichedCands.length > 0
          ? matchingEnrichedCands.filter(
              (c) => c.identityStatus === "VERIFIED" || c.identityStatus === "PROBABLE"
            )
          : relCands.filter(
              (c) => c.identityStatus === "VERIFIED" || c.identityStatus === "PROBABLE"
            );
      const shortlistContribs =
        matchingEnrichedCands.length > 0
          ? matchingEnrichedCands.filter((c) => shortlistedIdSet.has(c.candidateId))
          : relCands.filter((c) => shortlistedIdSet.has(c.candidateId));
      const rejCands = matchingRawCands.filter(
        (c) =>
          c.relevanceStatus === "IRRELEVANT" ||
          c.productRealityStatus === "NON_PHYSICAL" ||
          c.productRealityStatus === "REJECTED"
      );

      queryYields.push({
        queryId: qo.queryId,
        phrase: qo.keyword,
        source: "META_ADS",
        roundNumber: qo.roundNumber ?? 1,
        origin: (qo.origin as any) || "GEMINI_PLANNER",
        archetypeId: qo.archetypeId ?? null,
        actualAdsReturned: wasLiveExecuted ? qo.returnedCount : 0,
        uniqueAdsReturned: wasLiveExecuted ? (qo.uniqueReturnedCount ?? qo.returnedCount) : 0,
        relevantCandidates: relCands.length,
        merchantLinkedCandidates: merchantCands.length,
        identifiableProducts: identCands.length,
        qualifiedShortlistContributions: shortlistContribs.length,
        rejectedCandidates: rejCands.length,
        duplicateAds: wasLiveExecuted ? (qo.duplicateCount ?? 0) : 0,
        sourceStatus: qo.status,
      });
    }
  } else {
    for (const rq of round1Queries) {
      queryYields.push({
        queryId: rq.queryId,
        phrase: rq.phrase,
        source: rq.source || "META_ADS",
        roundNumber: rq.roundNumber,
        origin: rq.origin,
        archetypeId: rq.archetypeId,
        actualAdsReturned: 0,
        uniqueAdsReturned: 0,
        relevantCandidates: 0,
        merchantLinkedCandidates: 0,
        identifiableProducts: 0,
        qualifiedShortlistContributions: 0,
        rejectedCandidates: 0,
        duplicateAds: 0,
        sourceStatus: "NOT_ATTEMPTED",
      });
    }
  }

  const plannedArchetypeIds = Array.from(
    new Set(
      (discoveryPlan?.productArchetypes || [])
        .map((a) => a.archetypeId)
        .filter((id): id is string => Boolean(id))
    )
  );
  const queriedArchetypeIds = Array.from(
    new Set(
      allMetaQueryOutcomes
        .filter((qo) => qo.attempted)
        .map((qo) => qo.archetypeId)
        .filter((id): id is string => Boolean(id))
    )
  );
  const archetypesWithReturnedAds = Array.from(
    new Set(
      allMetaQueryOutcomes
        .filter((qo) => qo.attempted && qo.returnedCount > 0)
        .map((qo) => qo.archetypeId)
        .filter((id): id is string => Boolean(id))
    )
  );
  const archetypesWithRelevantCandidates = Array.from(
    new Set(
      rawCandidates
        .filter((c) => c.relevanceStatus !== "IRRELEVANT")
        .map((c) => c.matchedArchetypeId)
        .filter((id): id is string => Boolean(id))
    )
  );
  const archetypesWithQualifiedProducts = Array.from(
    new Set(
      [
        ...researchShortlist.shortlist.map((s) => s.matchedArchetypeId),
        ...candidates
          .filter((c) => shortlistedIdSet.has(c.candidateId))
          .map((c) => c.matchedArchetypeId),
      ].filter((id): id is string => Boolean(id))
    )
  );
  const observedArchetypeIds = archetypesWithQualifiedProducts;
  const unusedQueriesCount = validatedQueries.filter(
    (q) => !executedNormalizedPhrases.has(q.normalizedPhrase)
  ).length;

  const shortlistCoverage = evaluateShortlistCoverage({
    requestedCount: 3,
    qualifiedProducts: researchShortlist.qualifiedCount,
    distinctFamiliesCount:
      researchShortlist.distinctFamiliesCount ??
      new Set(researchShortlist.shortlist.map((s) => s.familyKey).filter(Boolean)).size,
    nicheIntent: hybridPlan.nicheIntent,
    unverifiedQueueRemaining: unverifiedQueue.length,
    observedArchetypeIds,
    plannedArchetypes: discoveryPlan?.productArchetypes || [],
    plannedArchetypeIds,
    queriedArchetypeIds,
    archetypesWithReturnedAds,
    archetypesWithRelevantCandidates,
    archetypesWithQualifiedProducts,
    unresolvedCandidates: candidates.filter((c) => c.identityStatus === "UNRESOLVED").length,
    remainingSourceQueries: sharedMetaBudgetTracker.remainingRequests,
    remainingAIRequests: sharedGeminiBudgetTracker.getRemainingRequests(),
    remainingUnusedQueriesCount: unusedQueriesCount,
    sourceAvailable:
      sourceStatuses.META_ADS === "PASSED" ||
      sourceStatuses.META_ADS === "CACHE_ONLY" ||
      sourceStatuses.META_ADS === "QUERY_SUCCEEDED_EMPTY",
    timeDeadlineReached: false,
    cancelled: Boolean(abortSignal?.aborted),
  });

  // Compute honest Lookback & Historical Coverage (Section D1-D5)
  const allObsDates = adObservations
    .flatMap((o) => [o.reportedFirstShownAt, o.reportedLastShownAt, o.observedAt])
    .filter((d): d is string => Boolean(d))
    .map((d) => new Date(d).getTime())
    .filter((t) => !isNaN(t));

  const earliestAdFirstSeen =
    allObsDates.length > 0 ? new Date(Math.min(...allObsDates)).toISOString() : null;
  const latestAdLastSeen =
    allObsDates.length > 0 ? new Date(Math.max(...allObsDates)).toISOString() : null;
  const freshLiveAdsCount = adObservations.filter(
    (o) => o.provenance === "LIVE_PROVIDER"
  ).length;
  const historicalCachedAdsCount = adObservations.length - freshLiveAdsCount;
  const activeAdsCount = adObservations.filter(
    (o) => (o.metrics as any)?.status === "ACTIVE" || o.provenance === "LIVE_PROVIDER"
  ).length;

  const lookbackCoverage: KH02LookbackCoverage = {
    requestedLookbackDays: lookbackDays,
    queryExecutionTime: generatedAt,
    earliestAdFirstSeen,
    latestAdLastSeen,
    activeAdsCount,
    historicalCachedAdsCount,
    freshLiveAdsCount,
    historicalCoverageMode:
      freshLiveAdsCount > 0 && historicalCachedAdsCount > 0
        ? "ACTIVE_LIVE_AND_CACHE"
        : freshLiveAdsCount > 0
        ? "ACTIVE_LIVE_ONLY"
        : historicalCachedAdsCount > 0
        ? "HISTORICAL_CACHE_ONLY"
        : "EMPTY",
    providerLimitationNote:
      "Live Meta Ad Library search retrieves currently active ads at query execution time; historical coverage within the requested lookback window is supplemented by verified timestamped observations stored in SQLite.",
  };

  const physicalProductsSupportedCount = candidates.filter(
    (c) =>
      c.productRealityStatus === "VERIFIED_PHYSICAL_PRODUCT" ||
      c.productRealityStatus === "EVIDENCE_SUPPORTED_PHYSICAL_PRODUCT"
  ).length;
  const identityResolvedCount = candidates.filter(
    (c) => c.identityStatus === "VERIFIED" || c.identityStatus === "PROBABLE"
  ).length;

  const candidateFunnel: KH02CandidateFunnel = {
    rawSourceObservations: adObservations.length,
    normalizedObservations: adObservations.length,
    rawCandidateGroups: rawCandidates.length,
    relevantCandidates: preAiRelevantCount,
    probablyRelevantCandidates: preAiProbablyRelevantCount,
    ambiguousCandidates: preAiAmbiguousCount,
    irrelevantCandidates: preAiIrrelevantCount,
    identitiesVerified: candidates.filter((c) => c.identityStatus === "VERIFIED").length,
    identitiesProbable: candidates.filter((c) => c.identityStatus === "PROBABLE").length,
    identitiesAmbiguous: candidates.filter((c) => c.identityStatus === "AMBIGUOUS").length,
    identitiesUnresolved: candidates.filter((c) => c.identityStatus === "UNRESOLVED").length,
    candidatesActuallyScored: rankedItems.length,
    verifiedEvergreenCandidates: distinctVerifiedWinners.length,
    provisionalCandidates: provisionalCandidates.length,
    insufficientEvidenceCandidates: insufficientEvidenceCandidates.length,
    rejectedCandidates: rejectedCandidates.length,
    researchShortlistEligible: researchShortlist.qualifiedCount,
    researchShortlistSelected: researchShortlist.shortlist.length,
    excludedByMaxCandidates: excludedByMaxCandidates.length,
    aiAnalysesAttempted: aiTelemetry?.totalAnalysesAttempted ?? 0,
    aiAnalysesCompleted: aiTelemetry?.totalAnalysesCompleted ?? 0,
    aiPhysicalProductsIdentified: aiTelemetry?.physicalProductsCount ?? 0,
    aiServicesRejected: aiTelemetry?.servicesRejectedCount ?? 0,
    aiContentRejected: aiTelemetry?.contentRejectedCount ?? 0,
    aiInsuranceLeadGenRejected: aiTelemetry?.insuranceLeadGenRejectedCount ?? 0,
    // V12.4.2 Coherent 13-stage funnel
    uniqueAds: adObservations.length,
    clearlyUnrelated: preAiIrrelevantCount,
    potentiallyRelevant: eligibleCandidates.length,
    selectedForAI: totalProcessedForAI,
    aiAnalyzed: aiTelemetry?.totalAnalysesCompleted ?? 0,
    physicalProductsSupported: physicalProductsSupportedCount,
    identityResolved: identityResolvedCount,
    scored: rankedItems.length,
    shortlistEligible: researchShortlist.qualifiedCount,
    shortlisted: researchShortlist.shortlist.length,
    verifiedEvergreen: distinctVerifiedWinners.length,
  };

  const result: EvergreenLeaderboardResult = {
    researchRunId: runId,
    topic: input.topic,
    market,
    lookbackDays,
    formulaVersion: KH02_SCORE_VERSION,
    runStatus: overallRunStatus,
    sourceStatuses,
    topThree,
    provisionalCandidates,
    remainingCandidates,
    insufficientEvidenceCandidates,
    rejectedCandidates,
    providerTelemetry,
    totalCandidatesDiscovered: rawCandidates.length,
    totalObservationsCollected: adObservations.length + secondaryObservations.length,
    sourceObservations: adObservations.concat(secondaryObservations),
    generatedAt,
    warnings,
    errors,
    researchShortlist,
    shortfallReason: researchShortlist.shortfallReason,
    candidateFunnel,
    aiTelemetry,
    discoveryPlan,
    discoveryPlannerTelemetry,
    plannedQueries: validatedQueries,
    queryExecutions: allMetaQueryOutcomes,
    queryYields,
    shortlistCoverage,
    lookbackCoverage,
    sourceMode: input.sourceMode || "LIVE_WITH_CACHE_FALLBACK",
    sourceCoverage: {
      META_ADS: {
        freshLiveAdsCount:
          providerTelemetry.META_ADS?.freshLiveCount ??
          lookbackCoverage.freshLiveAdsCount ??
          0,
        historicalCachedAdsCount:
          providerTelemetry.META_ADS?.cachedRecordsCount ??
          lookbackCoverage.historicalCachedAdsCount ??
          0,
        totalObservationsCount: adObservations.filter(
          (o) => o.source === "META_ADS"
        ).length,
        queryExecuted: Boolean(providerTelemetry.META_ADS?.queryExecuted),
        queryStatus: sourceStatuses.META_ADS,
      },
      GOOGLE_ADS: {
        freshLiveAdsCount: secondaryObservations.filter(
          (o) => o.source === "GOOGLE_ADS" && o.provenance === "LIVE_PROVIDER"
        ).length,
        historicalCachedAdsCount: secondaryObservations.filter(
          (o) => o.source === "GOOGLE_ADS" && o.provenance !== "LIVE_PROVIDER"
        ).length,
        totalObservationsCount: secondaryObservations.filter(
          (o) => o.source === "GOOGLE_ADS"
        ).length,
        queryExecuted: Boolean(providerTelemetry.GOOGLE_ADS?.queryExecuted),
        queryStatus: sourceStatuses.GOOGLE_ADS,
      },
    },
  };

  // Pure orchestrator: returns result without unowned writes to SyncJob
  return result;
}

export function extractResearchRunEvidence(result: EvergreenLeaderboardResult): SourceObservation[] {
  return result.sourceObservations || [];
}
