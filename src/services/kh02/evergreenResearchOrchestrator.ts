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
} from "./types";
import { collectMetaProductSignals } from "./providers/metaResearchAdapter";
import { collectTikTokAdsSignals } from "./providers/tiktokAdsResearchAdapter";
import { collectTikTokOrganicSignals } from "./providers/tiktokOrganicResearchAdapter";
import { collectGoogleAdvertiserSignals } from "./providers/googleTransparencyResearchAdapter";
import { diagnoseKH02Source } from "./providers/sourceRegistry";
import {
  discoverProductCandidatesFromAds,
  resolveCandidateResearchProduct,
  DiscoveredProductCandidate,
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
  generatedAt: string;
  warnings: string[];
  errors: string[];
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

  // Demand history starts as CONFIGURED policy engine until actual temporal points are verified
  const sourceStatuses: Record<IntelligenceSource, SourceRunStatus> = {
    META_ADS: "NOT_CONFIGURED",
    TIKTOK_ADS: "NOT_CONFIGURED",
    TIKTOK_ORGANIC: "NOT_CONFIGURED",
    GOOGLE_ADS: "NOT_CONFIGURED",
    DEMAND_HISTORY: "CONFIGURED",
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
    TIKTOK_ORGANIC: {
      source: "TIKTOK_ORGANIC",
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
    GOOGLE_ADS: {
      source: "GOOGLE_ADS",
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
    DEMAND_HISTORY: {
      source: "DEMAND_HISTORY",
      queryExecuted: false,
      queryStatus: "CONFIGURED",
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

  const isSelected = (source: IntelligenceSource) =>
    !input.selectedSources || input.selectedSources.includes(source);

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

  // ── Stage 1: Meta Ads Discovery (Canonical Platform & Workspace Scoped) ────
  if (!isSelected("META_ADS")) {
    sourceStatuses.META_ADS = "SKIPPED";
    providerTelemetry.META_ADS.queryStatus = "SKIPPED";
  } else {
    try {
      const metaResult = await executeStageWithSignal(
        "Meta Ads",
        STAGE_TIMEOUT_MS,
        (q) => collectMetaProductSignals(q)
      );
      sourceStatuses.META_ADS = metaResult.status;
      adObservations.push(...metaResult.observations);
      if (metaResult.warnings.length > 0) warnings.push(...metaResult.warnings);

      const isLiveMeta = metaResult.observations.some((o) => o.provenance === "LIVE_PROVIDER");
      const metaNow = new Date().toISOString();
      providerTelemetry.META_ADS = {
        source: "META_ADS",
        queryExecuted: true,
        queryStatus: metaResult.status,
        queryTimestamp: metaNow,
        retrievedCount: metaResult.retrievedCount,
        acceptedCount: metaResult.acceptedCount,
        queryProvenance: isLiveMeta ? "LIVE_PROVIDER" : "CACHED_SOURCE",
        isLive: isLiveMeta,
        queryError: metaResult.errors.length > 0 ? metaResult.errors.join("; ") : null,
        lastSuccessfulRecordCount: metaResult.retrievedCount,
        lastSuccessfulQueryAt: metaResult.retrievedCount > 0 ? metaNow : null,
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
      };
    }
  }

  // ── Stage 2: TikTok Ads US Discovery ──────────────────────────────────────
  if (!isSelected("TIKTOK_ADS")) {
    sourceStatuses.TIKTOK_ADS = "SKIPPED";
    providerTelemetry.TIKTOK_ADS.queryStatus = "SKIPPED";
  } else {
    try {
      const ttAdsResult = await executeStageWithSignal(
        "TikTok Ads",
        STAGE_TIMEOUT_MS,
        (q) => collectTikTokAdsSignals(q)
      );
      sourceStatuses.TIKTOK_ADS = ttAdsResult.status;
      adObservations.push(...ttAdsResult.observations);
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
      message: "Consolidating product landing pages",
    }).catch((err) => {
      warnings.push(`Progress reporting warning: ${err.message}`);
    });
  }

  // ── Stage 3: Extract Consolidated Product Candidates (Bounded) ───────────
  const rawCandidates = discoverProductCandidatesFromAds(adObservations, input.topic);
  const eligibleCandidates = rawCandidates.filter((c) => c.relevanceStatus !== "IRRELEVANT");
  const preRejectedCandidates = rawCandidates.filter((c) => c.relevanceStatus === "IRRELEVANT");
  const candidates = eligibleCandidates.slice(0, maxCandidates);

  // ── Stage 4: Resolve Candidate Identities to Real ResearchProduct IDs ─────
  for (const candidate of candidates) {
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
    sourceStatuses.TIKTOK_ORGANIC = "SKIPPED";
    providerTelemetry.TIKTOK_ORGANIC.queryStatus = "SKIPPED";
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

        providerTelemetry.TIKTOK_ORGANIC = {
          source: "TIKTOK_ORGANIC",
          queryExecuted: isExecuted,
          queryStatus: ttOrganicResult.status,
          queryTimestamp: isExecuted ? ttOrgNow : null,
          retrievedCount: isSuccess ? ttOrganicResult.retrievedCount : null,
          acceptedCount: isSuccess ? ttOrganicResult.acceptedCount : null,
          queryProvenance: isExecuted ? "LIVE_PROVIDER" : "NONE",
          isLive: isExecuted,
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

          providerTelemetry.GOOGLE_ADS = {
            source: "GOOGLE_ADS",
            queryExecuted: isExecuted,
            queryStatus: googleResult.status,
            queryTimestamp: isExecuted ? googleNow : null,
            retrievedCount: isSuccess ? googleResult.retrievedCount : null,
            acceptedCount: isSuccess ? googleResult.acceptedCount : null,
            queryProvenance: isExecuted ? "LIVE_PROVIDER" : "NONE",
            isLive: isExecuted,
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
        if (!candidate.videoUrl && obs.media?.videoUrl) {
          candidate.videoUrl = obs.media.videoUrl;
          if (obs.media.thumbnailUrl && !candidate.thumbnailUrl) {
            candidate.thumbnailUrl = obs.media.thumbnailUrl;
          }
        }
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

  // Assign ranks strictly to verified eligible candidates
  verifiedWinners.forEach((item, idx) => {
    item.rank = idx + 1;
  });

  const topThree = verifiedWinners.slice(0, 3);
  const remainingCandidates = verifiedWinners.slice(3, maxCandidates);

  // Overall run status
  const anyPassed = Object.values(sourceStatuses).some(
    (s) => s === "PASSED" || s === "SOURCE_DATA_VERIFIED" || s === "LIVE_DATA_VERIFIED"
  );
  const anyFailed = Object.values(sourceStatuses).some(
    (s) =>
      s === "FAILED" ||
      s === "BLOCKED_SOURCE" ||
      s === "QUERY_FAILED" ||
      s === "TRANSPORT_FAILED" ||
      s === "AUTHENTICATION_FAILED"
  );
  let overallRunStatus: SourceRunStatus = "PASSED";
  if (!anyPassed) overallRunStatus = "NO_RESULTS";
  else if (anyFailed) overallRunStatus = "PARTIAL";

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
    generatedAt,
    warnings,
    errors,
  };

  // Pure orchestrator: returns result without unowned writes to SyncJob
  return result;
}
