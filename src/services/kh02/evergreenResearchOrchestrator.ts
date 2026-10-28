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
import { collectGoogleAdvertiserSignals } from "./providers/googleTransparencyResearchAdapter";
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
    maxResults: 30,
    signal: abortSignal,
  };

  const STAGE_TIMEOUT_MS = Number(process.env.KH02_STAGE_TIMEOUT_MS) || 20_000;

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

  // Allocate Round 1 queries: if >= 3 validated queries exist, run 2 in Round 1 and reserve 1 for adaptive Round 2 recovery
  const round1MaxQueries = validatedQueries.length >= 3 ? 2 : Math.max(1, validatedQueries.length);
  const round1Queries = selectQueriesForSearchRound(
    validatedQueries,
    round1MaxQueries,
    executedNormalizedPhrases,
    coveredArchetypeIds,
    1
  );
  for (const rq of round1Queries) {
    executedNormalizedPhrases.add(rq.normalizedPhrase);
    if (rq.archetypeId) coveredArchetypeIds.add(rq.archetypeId);
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

      const execMeta = metaResult.executionMetadata;
      if (Array.isArray(execMeta?.queryOutcomes)) {
        allMetaQueryOutcomes.push(...execMeta.queryOutcomes);
      }

      const metaLiveObservations = adObservations.filter(
        (o) => o.source === "META_ADS" && o.provenance === "LIVE_PROVIDER"
      );
      const freshLiveCount = metaLiveObservations.length;
      const cachedObservationsCount =
        adObservations.filter((o) => o.source === "META_ADS").length - freshLiveCount;

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

  // ── Stage 2b: Bounded Adaptive Search Recovery — Round 2 (V12.4.2 Phase C & H) ──
  if (
    isSelected("META_ADS") &&
    providerTelemetry.META_ADS.liveAttempted &&
    sharedMetaBudgetTracker.canExecuteSubquery() &&
    sharedMetaBudgetTracker.remainingRequests > 0 &&
    !abortSignal?.aborted
  ) {
    const prelimCandidates = discoverProductCandidatesFromAds(
      adObservations,
      input.topic,
      { plannedArchetypes: discoveryPlan?.productArchetypes }
    );
    const prelimIdentifiableCount = prelimCandidates.filter(
      (c) =>
        c.relevanceStatus !== "IRRELEVANT" &&
        c.productRealityStatus !== "NON_PHYSICAL" &&
        c.productRealityStatus !== "REJECTED" &&
        Boolean(c.storeDomain || c.canonicalProductUrl)
    ).length;

    if (prelimIdentifiableCount < 3) {
      const round2Queries = selectQueriesForSearchRound(
        validatedQueries,
        sharedMetaBudgetTracker.remainingRequests,
        executedNormalizedPhrases,
        coveredArchetypeIds,
        2
      );
      if (round2Queries.length > 0) {
        for (const r2q of round2Queries) {
          executedNormalizedPhrases.add(r2q.normalizedPhrase);
          if (r2q.archetypeId) coveredArchetypeIds.add(r2q.archetypeId);
        }
        try {
          const metaRound2Result = await executeStageWithSignal(
            "Meta Ads Adaptive Round 2",
            STAGE_TIMEOUT_MS,
            (q) =>
              collectMetaProductSignals({
                ...q,
                productKeywords: plannedProductKeywords.length > 0 ? plannedProductKeywords : undefined,
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
          const freshLiveAfterR2 = allMetaObs.filter((o) => o.provenance === "LIVE_PROVIDER").length;
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
        } catch (r2Err: any) {
          warnings.push(`Adaptive Meta search round 2 warning: ${r2Err.message}`);
        }
      }
    }
  }

  if (context?.reportProgress) {
    await context.reportProgress({
      stage: "NORMALIZATION",
      percent: 35,
      message: "Consolidating product landing pages",
    }).catch((err) => {
      warnings.push(`Progress reporting warning: ${err.message}`);
    });
  }

  // ── Stage 3: Extract Consolidated Product Candidates (Bounded) ───────────
  const rawCandidates = discoverProductCandidatesFromAds(
    adObservations,
    input.topic,
    { plannedArchetypes: discoveryPlan?.productArchetypes }
  );

  // Capture pre-AI discovery relevance counts BEFORE Stage 4c mutates candidate.relevanceStatus in place
  const preAiRelevantCount = rawCandidates.filter((c) => c.relevanceStatus === "RELEVANT").length;
  const preAiProbablyRelevantCount = rawCandidates.filter((c) => c.relevanceStatus === "PROBABLY_RELEVANT").length;
  const preAiAmbiguousCount = rawCandidates.filter((c) => c.relevanceStatus === "AMBIGUOUS").length;
  const preAiIrrelevantCount = rawCandidates.filter((c) => c.relevanceStatus === "IRRELEVANT").length;

  const eligibleCandidates = rawCandidates.filter((c) => c.relevanceStatus !== "IRRELEVANT");
  const preRejectedCandidates = rawCandidates.filter((c) => c.relevanceStatus === "IRRELEVANT");

  // Prioritize eligible candidates based on relevance score, evidence count, and valid canonical URL
  eligibleCandidates.sort((a, b) => {
    const relDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
    if (relDiff !== 0) return relDiff;
    const obsDiff = b.totalObservationCount - a.totalObservationCount;
    if (obsDiff !== 0) return obsDiff;
    const aHasUrl = Boolean(a.canonicalProductUrl);
    const bHasUrl = Boolean(b.canonicalProductUrl);
    if (aHasUrl !== bHasUrl) return aHasUrl ? -1 : 1;
    return 0;
  });

  const candidatesToProcess = eligibleCandidates.slice(0, maxCandidates);
  const excludedByMaxCandidates = eligibleCandidates.slice(maxCandidates);

  // ── Stage 4: Resolve Candidate Identities to Real ResearchProduct IDs ─────
  for (const candidate of candidatesToProcess) {
    try {
      const resolved = await resolveCandidateResearchProduct(candidate, input.workspaceId);
      candidate.researchProductId = resolved.researchProductId;
      if (resolved.canonicalProductUrl && !candidate.canonicalProductUrl) {
        candidate.canonicalProductUrl = resolved.canonicalProductUrl;
      }
    } catch (resErr: any) {
      warnings.push(`Identity resolution error for ${candidate.candidateId}: ${resErr.message}`);
    }
  }

  // ── Stage 4b: Async Metadata Enrichment with Real Evidence (Phase 6) ────────
  let enrichedCandidates = candidatesToProcess;
  try {
    const enrichmentResult = await enrichProductCandidatesWithEvidence(
      candidatesToProcess,
      {
        workspaceId: input.workspaceId,
        topic: input.topic,
        timeoutMs: 4000,
        maxConcurrency: 3,
        signal: abortSignal,
        plannedArchetypes: discoveryPlan?.productArchetypes,
      }
    );
    enrichedCandidates = enrichmentResult.candidates;
    if (enrichmentResult.errors.length > 0) {
      warnings.push(...enrichmentResult.errors.slice(0, 3));
    }
  } catch (enrichErr: any) {
    warnings.push(`Product metadata enrichment stage error: ${enrichErr.message}`);
  }

  const candidates = enrichedCandidates;

  // ── Stage 4c: Gemini AI Semantic Product Intelligence (V12.4) ────────────
  if (context?.reportProgress) {
    await context.reportProgress({
      stage: "ENRICHMENT",
      percent: 48,
      message: "Analyzing candidate product intelligence & commercial reality with Gemini AI",
    }).catch((err) => {
      warnings.push(`Progress reporting warning: ${err.message}`);
    });
  }

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

  if (candidates.length > 0) {
    try {
      const aiResult = await analyzeProductCandidatesWithAI(
        candidates,
        {
          researchRunId: runId,
          topic: input.topic,
          market: market,
          maxConcurrency: 2,
          budgetTracker: sharedGeminiBudgetTracker,
          signal: abortSignal,
        }
      );
      aiTelemetry = aiResult.telemetry;
      if (aiResult.telemetry.aiStatus === "PARTIAL" || aiResult.telemetry.aiStatus === "UNAVAILABLE") {
        warnings.push(`Gemini AI status: ${aiResult.telemetry.aiStatus}. Using conservative deterministic classification.`);
      }
    } catch (aiErr: any) {
      warnings.push(`Gemini AI product intelligence stage warning: ${aiErr.message}`);
    }

    // Re-evaluate mandatory Product Reality Gate after AI analysis (or fallback)
    for (const c of candidates) {
      const reality = evaluateCandidateProductReality(c);
      c.productRealityStatus = reality.productRealityStatus;
      c.sourcePageClassification = reality.sourcePageClassification;
      if (!reality.isPhysicalProductRealityEligible) {
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
        // Extract identified advertiser domains only from eligible research candidates
        const discoveredDomains = Array.from(
          new Set(
            candidates
              .map((c) => c.storeDomain)
              .filter((d): d is string => Boolean(d))
          )
        );

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

  for (const candidate of candidates) {
    for (const obs of secondaryObservations) {
      const match = matchCrossPlatformProductEvidence(candidate, {
        title: obs.title,
        url: obs.landingPageUrl || obs.sourceUrl,
        domain: obs.advertiserDomain,
        platform: obs.source,
      });

      if (match.confidence === "EXACT" || match.confidence === "HIGH_CONFIDENCE") {
        candidate.sourceObservations.push(obs);
        candidate.totalObservationCount += 1;
        if (!candidate.supportingSourceTypes.includes(obs.source)) {
          candidate.supportingSourceTypes.push(obs.source);
        }
        if (obs.source === "GOOGLE_ADS") {
          googleProductMatches++;
        }
        if (!candidate.videoUrl && obs.media?.videoUrl) {
          candidate.videoUrl = obs.media.videoUrl;
          if (obs.media.thumbnailUrl && !candidate.thumbnailUrl) {
            candidate.thumbnailUrl = obs.media.thumbnailUrl;
          }
        }
      } else if (obs.source === "GOOGLE_ADS" && obs.advertiserDomain && candidate.storeDomain && obs.advertiserDomain === candidate.storeDomain) {
        googleBrandMatches++;
      }
    }
  }

  if (providerTelemetry.GOOGLE_ADS) {
    providerTelemetry.GOOGLE_ADS.productAssociatedCount = googleProductMatches;
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
  const rankedItems: RankedLeaderboardItem[] = [];

  for (const candidate of candidates) {
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

    const score = calculateKH02EvergreenScore({
      candidate,
      demandSeries: demandRes.dataPoints,
      hasVerifiedSupplierQuote: false,
    });

    rankedItems.push({
      rank: null,
      candidate,
      score,
    });
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
  const distinctVerifiedWinners: RankedLeaderboardItem[] = [];
  const seenCanonicalIdentities = new Set<string>();

  for (const item of verifiedWinners) {
    const canonicalKey = (
      item.candidate.canonicalProductName ||
      item.candidate.displayName ||
      item.candidate.title ||
      item.candidate.candidateId
    ).toLowerCase().trim();

    if (!seenCanonicalIdentities.has(canonicalKey)) {
      seenCanonicalIdentities.add(canonicalKey);
      distinctVerifiedWinners.push(item);
    } else {
      provisionalCandidates.push({
        ...item,
        rank: null,
      });
    }
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
    3
  );

  const shortlistedIdSet = new Set(
    researchShortlist.shortlist.map((s) => s.candidateId)
  );

  // Build QueryYield metrics for each executed or planned query
  const queryYields: QueryYield[] = [];
  if (allMetaQueryOutcomes.length > 0) {
    for (const qo of allMetaQueryOutcomes) {
      const kwLower = (qo.keyword || "").toLowerCase();
      const matchingRawCands = rawCandidates.filter((c) => {
        if (c.matchedQueryIds && c.matchedQueryIds.includes(qo.queryId)) return true;
        const text = `${c.title} ${c.originalAdHeadline || ""} ${c.canonicalProductName || ""}`.toLowerCase();
        return kwLower.length > 2 && text.includes(kwLower);
      });
      const relCands = matchingRawCands.filter((c) => c.relevanceStatus !== "IRRELEVANT");
      const merchantCands = relCands.filter((c) => Boolean(c.storeDomain || c.canonicalProductUrl));
      const identCands = relCands.filter(
        (c) => c.identityStatus === "VERIFIED" || c.identityStatus === "PROBABLE"
      );
      const shortlistContribs = relCands.filter((c) => shortlistedIdSet.has(c.candidateId));
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
        actualAdsReturned: qo.returnedCount,
        uniqueAdsReturned: qo.uniqueReturnedCount ?? qo.returnedCount,
        relevantCandidates: relCands.length,
        merchantLinkedCandidates: merchantCands.length,
        identifiableProducts: identCands.length,
        qualifiedShortlistContributions: shortlistContribs.length,
        rejectedCandidates: rejCands.length,
        duplicateAds: qo.duplicateCount ?? 0,
        sourceStatus: qo.status,
      });
    }
  } else {
    for (const rq of round1Queries) {
      const kwLower = rq.normalizedPhrase;
      const matchingRawCands = rawCandidates.filter((c) => {
        const text = `${c.title} ${c.originalAdHeadline || ""} ${c.canonicalProductName || ""}`.toLowerCase();
        return kwLower.length > 2 && text.includes(kwLower);
      });
      const relCands = matchingRawCands.filter((c) => c.relevanceStatus !== "IRRELEVANT");
      const merchantCands = relCands.filter((c) => Boolean(c.storeDomain || c.canonicalProductUrl));
      const identCands = relCands.filter(
        (c) => c.identityStatus === "VERIFIED" || c.identityStatus === "PROBABLE"
      );
      const shortlistContribs = relCands.filter((c) => shortlistedIdSet.has(c.candidateId));
      const rejCands = matchingRawCands.filter((c) => c.relevanceStatus === "IRRELEVANT");

      queryYields.push({
        queryId: rq.queryId,
        phrase: rq.phrase,
        source: rq.source || "META_ADS",
        roundNumber: rq.roundNumber,
        origin: rq.origin,
        archetypeId: rq.archetypeId,
        actualAdsReturned: matchingRawCands.reduce((s, c) => s + c.totalObservationCount, 0),
        uniqueAdsReturned: matchingRawCands.reduce((s, c) => s + c.supportingAdIds.length, 0),
        relevantCandidates: relCands.length,
        merchantLinkedCandidates: merchantCands.length,
        identifiableProducts: identCands.length,
        qualifiedShortlistContributions: shortlistContribs.length,
        rejectedCandidates: rejCands.length,
        duplicateAds: 0,
        sourceStatus: sourceStatuses.META_ADS,
      });
    }
  }

  const observedArchetypeIds = Array.from(
    new Set(
      [
        ...Array.from(coveredArchetypeIds),
        ...candidates
          .map((c) => c.matchedArchetypeId)
          .filter((id): id is string => Boolean(id)),
      ]
    )
  );
  const unusedQueriesCount = validatedQueries.filter(
    (q) => !executedNormalizedPhrases.has(q.normalizedPhrase)
  ).length;

  const shortlistCoverage = evaluateShortlistCoverage({
    requestedCount: 3,
    qualifiedProducts: researchShortlist.qualifiedCount,
    observedArchetypeIds,
    plannedArchetypes: discoveryPlan?.productArchetypes || [],
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
    selectedForAI: candidatesToProcess.length,
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
  };

  // Pure orchestrator: returns result without unowned writes to SyncJob
  return result;
}

export function extractResearchRunEvidence(result: EvergreenLeaderboardResult): SourceObservation[] {
  return result.sourceObservations || [];
}
