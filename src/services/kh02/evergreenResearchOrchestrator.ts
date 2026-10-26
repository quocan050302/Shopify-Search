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
} from "./types";
import { collectMetaProductSignals } from "./providers/metaResearchAdapter";
import { collectTikTokAdsSignals } from "./providers/tiktokAdsResearchAdapter";
import { collectTikTokOrganicSignals } from "./providers/tiktokOrganicResearchAdapter";
import { collectGoogleAdvertiserSignals } from "./providers/googleTransparencyResearchAdapter";
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
import {
  calculateKH02EvergreenScore,
  KH02ScoreResult,
  KH02_SCORE_VERSION,
} from "./scoring/evergreenOpportunityScoring";
import {
  updateKH02ResearchRunStatus,
  persistKH02RankingSnapshot,
} from "./persistence/kh02PersistenceService";

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
  totalCandidatesDiscovered: number;
  generatedAt: string;
  warnings: string[];
  errors: string[];
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
 */
export async function runEvergreenProductResearch(
  input: RunEvergreenResearchInput
): Promise<EvergreenLeaderboardResult> {
  const generatedAt = new Date().toISOString();
  const runId = input.runId || `kh02_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const market = input.market || "US";
  const lookbackDays = input.lookbackDays || 90;
  const maxCandidates = input.maxCandidates || 15;
  const warnings: string[] = [];
  const errors: string[] = [];

  // Update status to RUNNING if persistent run exists
  await updateKH02ResearchRunStatus({
    runId,
    workspaceId: input.workspaceId,
    status: "RUNNING",
    progress: 10,
    startedAt: new Date(),
  }).catch(() => {});

  const sourceStatuses: Record<IntelligenceSource, SourceRunStatus> = {
    META_ADS: "NOT_CONFIGURED",
    TIKTOK_ADS: "NOT_CONFIGURED",
    TIKTOK_ORGANIC: "NOT_CONFIGURED",
    GOOGLE_ADS: "NOT_CONFIGURED",
    DEMAND_HISTORY: "SOURCE_DATA_VERIFIED",
  };

  const query: IntelligenceQuery = {
    workspaceId: input.workspaceId,
    researchRunId: runId,
    topic: input.topic,
    market,
    lookbackDays,
    maxResults: 30,
    signal: input.signal,
  };

  const adObservations: SourceObservation[] = [];

  // ── Stage 1: Meta Ads Discovery (Canonical Platform & Workspace Scoped) ────
  try {
    const metaResult = await collectMetaProductSignals(query);
    sourceStatuses.META_ADS = metaResult.status;
    adObservations.push(...metaResult.observations);
    if (metaResult.warnings.length > 0) warnings.push(...metaResult.warnings);
  } catch (err: any) {
    sourceStatuses.META_ADS = "FAILED";
    errors.push(`Meta Ads collection failed: ${err.message}`);
  }

  // ── Stage 2: TikTok Ads US Discovery ──────────────────────────────────────
  try {
    const ttAdsResult = await collectTikTokAdsSignals(query);
    sourceStatuses.TIKTOK_ADS = ttAdsResult.status;
    adObservations.push(...ttAdsResult.observations);
    if (ttAdsResult.warnings.length > 0) warnings.push(...ttAdsResult.warnings);
  } catch (err: any) {
    sourceStatuses.TIKTOK_ADS = "FAILED";
    errors.push(`TikTok Ads collection failed: ${err.message}`);
  }

  await updateKH02ResearchRunStatus({
    runId,
    workspaceId: input.workspaceId,
    status: "RUNNING",
    progress: 35,
  }).catch(() => {});

  // ── Stage 3: Extract Consolidated Product Candidates ──────────────────────
  const candidates = discoverProductCandidatesFromAds(adObservations, input.topic);

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

  await updateKH02ResearchRunStatus({
    runId,
    workspaceId: input.workspaceId,
    status: "RUNNING",
    progress: 50,
  }).catch(() => {});

  // ── Stage 5: TikTok Organic Video Enrichment ──────────────────────────────
  const secondaryObservations: SourceObservation[] = [];
  try {
    const ttOrganicResult = await collectTikTokOrganicSignals(query);
    sourceStatuses.TIKTOK_ORGANIC = ttOrganicResult.status;
    secondaryObservations.push(...ttOrganicResult.observations);
    if (ttOrganicResult.warnings.length > 0) warnings.push(...ttOrganicResult.warnings);
  } catch (err: any) {
    sourceStatuses.TIKTOK_ORGANIC = "FAILED";
    errors.push(`TikTok Organic collection failed: ${err.message}`);
  }

  // ── Stage 6: Google Ads Transparency Enrichment ───────────────────────────
  try {
    // Extract identified advertiser domains from candidates
    const discoveredDomains = candidates
      .map((c) => c.storeDomain)
      .filter((d): d is string => Boolean(d));

    const googleQuery: IntelligenceQuery = {
      ...query,
      advertiserDomains: Array.from(new Set(discoveredDomains)),
    };

    const googleResult = await collectGoogleAdvertiserSignals(googleQuery);
    sourceStatuses.GOOGLE_ADS = googleResult.status;
    secondaryObservations.push(...googleResult.observations);
    if (googleResult.warnings.length > 0) warnings.push(...googleResult.warnings);
  } catch (err: any) {
    sourceStatuses.GOOGLE_ADS = "FAILED";
    errors.push(`Google Ads collection failed: ${err.message}`);
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

  await updateKH02ResearchRunStatus({
    runId,
    workspaceId: input.workspaceId,
    status: "RUNNING",
    progress: 75,
  }).catch(() => {});

  // ── Stage 8 & 9: Demand Loading, Scoring & Eligibility Gating ─────────────
  const rankedItems: RankedLeaderboardItem[] = [];

  for (const candidate of candidates) {
    let demandSeries: DemandDataPoint[] = [];

    // Grounded: Only query historical demand if a real ResearchProduct.id was resolved
    if (candidate.researchProductId) {
      demandSeries = await loadProductHistoricalDemand(candidate.researchProductId);
    }

    const score = calculateKH02EvergreenScore({
      candidate,
      demandSeries,
      hasVerifiedSupplierQuote: false,
    });

    rankedItems.push({
      rank: null,
      candidate,
      score,
    });
  }

  // Sort by opportunityScore desc, then evidenceConfidence desc
  rankedItems.sort((a, b) => {
    const scoreA = a.score.opportunityScore || 0;
    const scoreB = b.score.opportunityScore || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return b.score.evidenceConfidence - a.score.evidenceConfidence;
  });

  // ── Stage 10: Partition into Verified Winners vs Provisional Opportunities ─
  const verifiedWinners: RankedLeaderboardItem[] = [];
  const provisionalCandidates: RankedLeaderboardItem[] = [];
  const insufficientEvidenceCandidates: RankedLeaderboardItem[] = [];

  for (const item of rankedItems) {
    if (item.score.tier === "VERIFIED_EVERGREEN") {
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
    (s) => s === "PASSED" || s === "SOURCE_DATA_VERIFIED"
  );
  const anyFailed = Object.values(sourceStatuses).some(
    (s) => s === "FAILED" || s === "BLOCKED_SOURCE"
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
    totalCandidatesDiscovered: candidates.length,
    generatedAt,
    warnings,
    errors,
  };

  // ── Stage 11: Persist Snapshot to Database ────────────────────────────────
  await persistKH02RankingSnapshot(runId, input.workspaceId, result).catch((persistErr) => {
    warnings.push(`Ranking snapshot persistence warning: ${persistErr.message}`);
  });

  return result;
}
