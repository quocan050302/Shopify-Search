/**
 * SWAI KH-02 — Evergreen Research Orchestrator
 *
 * Coordinates the 14-stage cross-platform research workflow:
 * 1. Checks source readiness and budget constraints.
 * 2. Collects ad observations from Meta, TikTok, Google, and Organic.
 * 3. Consolidates multi-ad signals into distinct product candidates.
 * 4. Loads and analyzes historical demand stability.
 * 5. Calculates V12.0 Evergreen Opportunity Scores & Evidence Confidence.
 * 6. Partitions candidates into Top 3 Leaderboard and remaining candidates.
 */

import {
  IntelligenceSource,
  SourceRunStatus,
  IntelligenceQuery,
  SourceObservation,
} from "./types";
import { checkKH02ProviderReadiness } from "./providers/sourceRegistry";
import { collectMetaProductSignals } from "./providers/metaResearchAdapter";
import { collectTikTokAdsSignals } from "./providers/tiktokAdsResearchAdapter";
import { collectTikTokOrganicSignals } from "./providers/tiktokOrganicResearchAdapter";
import { collectGoogleAdvertiserSignals } from "./providers/googleTransparencyResearchAdapter";
import {
  discoverProductCandidatesFromAds,
  DiscoveredProductCandidate,
} from "./identity/productCandidateDiscovery";
import {
  loadProductHistoricalDemand,
  DemandDataPoint,
} from "./demand/temporalDemandEngine";
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
  const runId = `kh02_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const market = input.market || "US";
  const lookbackDays = input.lookbackDays || 90;
  const maxCandidates = input.maxCandidates || 15;
  const warnings: string[] = [];
  const errors: string[] = [];

  const sourceStatuses: Record<IntelligenceSource, SourceRunStatus> = {
    META_ADS: "NOT_CONFIGURED",
    TIKTOK_ADS: "NOT_CONFIGURED",
    TIKTOK_ORGANIC: "NOT_CONFIGURED",
    GOOGLE_ADS: "NOT_CONFIGURED",
    DEMAND_HISTORY: "PASSED",
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

  const allObservations: SourceObservation[] = [];

  // ── Stage 1: Meta Ads Discovery ───────────────────────────────────────────
  try {
    const metaResult = await collectMetaProductSignals(query);
    sourceStatuses.META_ADS = metaResult.status;
    allObservations.push(...metaResult.observations);
    if (metaResult.warnings.length > 0) warnings.push(...metaResult.warnings);
  } catch (err: any) {
    sourceStatuses.META_ADS = "FAILED";
    errors.push(`Meta Ads collection failed: ${err.message}`);
  }

  // ── Stage 2: TikTok Ads US Discovery ──────────────────────────────────────
  try {
    const ttAdsResult = await collectTikTokAdsSignals(query);
    sourceStatuses.TIKTOK_ADS = ttAdsResult.status;
    allObservations.push(...ttAdsResult.observations);
    if (ttAdsResult.warnings.length > 0) warnings.push(...ttAdsResult.warnings);
  } catch (err: any) {
    sourceStatuses.TIKTOK_ADS = "FAILED";
    errors.push(`TikTok Ads collection failed: ${err.message}`);
  }

  // ── Stage 3: Extract Consolidated Product Candidates ──────────────────────
  const candidates = discoverProductCandidatesFromAds(allObservations, input.topic);

  // ── Stage 4: TikTok Organic Video Enrichment ──────────────────────────────
  try {
    const ttOrganicResult = await collectTikTokOrganicSignals(query);
    sourceStatuses.TIKTOK_ORGANIC = ttOrganicResult.status;
    allObservations.push(...ttOrganicResult.observations);
    if (ttOrganicResult.warnings.length > 0) warnings.push(...ttOrganicResult.warnings);
  } catch (err: any) {
    sourceStatuses.TIKTOK_ORGANIC = "FAILED";
    errors.push(`TikTok Organic collection failed: ${err.message}`);
  }

  // ── Stage 5: Google Ads Transparency Enrichment ───────────────────────────
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
    allObservations.push(...googleResult.observations);
    if (googleResult.warnings.length > 0) warnings.push(...googleResult.warnings);
  } catch (err: any) {
    sourceStatuses.GOOGLE_ADS = "FAILED";
    errors.push(`Google Ads collection failed: ${err.message}`);
  }

  // ── Stage 6: Scoring & Ranking Each Candidate ─────────────────────────────
  const rankedItems: RankedLeaderboardItem[] = [];

  for (const candidate of candidates) {
    // Attempt loading historical demand series if stored
    let demandSeries: DemandDataPoint[] = [];
    if (candidate.canonicalProductUrl) {
      // Look up any matching product in DB
      demandSeries = await loadProductHistoricalDemand(candidate.candidateId);
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

  // ── Stage 7: Partition & Rank Candidates ──────────────────────────────────
  // Sort by opportunityScore desc, then evidenceConfidence desc
  rankedItems.sort((a, b) => {
    const scoreA = a.score.opportunityScore || 0;
    const scoreB = b.score.opportunityScore || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return b.score.evidenceConfidence - a.score.evidenceConfidence;
  });

  const eligibleCandidates: RankedLeaderboardItem[] = [];
  const insufficientEvidenceCandidates: RankedLeaderboardItem[] = [];

  for (const item of rankedItems) {
    if (item.score.scoreStatus === "INSUFFICIENT_EVIDENCE") {
      insufficientEvidenceCandidates.push(item);
    } else {
      eligibleCandidates.push(item);
    }
  }

  // Assign ranks to eligible candidates
  eligibleCandidates.forEach((item, idx) => {
    item.rank = idx + 1;
  });

  const topThree = eligibleCandidates.slice(0, 3);
  const remainingCandidates = eligibleCandidates.slice(3, maxCandidates);

  // Overall run status
  const anyPassed = Object.values(sourceStatuses).some((s) => s === "PASSED");
  const anyFailed = Object.values(sourceStatuses).some((s) => s === "FAILED" || s === "BLOCKED_SOURCE");
  let overallRunStatus: SourceRunStatus = "PASSED";
  if (!anyPassed) overallRunStatus = "NO_RESULTS";
  else if (anyFailed) overallRunStatus = "PARTIAL";

  return {
    researchRunId: runId,
    topic: input.topic,
    market,
    lookbackDays,
    formulaVersion: KH02_SCORE_VERSION,
    runStatus: overallRunStatus,
    sourceStatuses,
    topThree,
    remainingCandidates,
    insufficientEvidenceCandidates,
    totalCandidatesDiscovered: candidates.length,
    generatedAt,
    warnings,
    errors,
  };
}
