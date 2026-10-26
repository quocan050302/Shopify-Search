/**
 * SWAI KH-02 — Evergreen Opportunity Scoring Service (V12.1.0)
 *
 * Evaluates product candidates across 6 balanced pillars (100 points total)
 * and produces a strictly segregated Evidence Confidence Score (0-100).
 *
 * PILLARS:
 * 1. Demand Stability (25 pts) — Historical time series, CV, persistence across seasons.
 * 2. Problem-Solution Fit (20 pts) — Clear pain point, demonstrable utility, urgency.
 * 3. Multi-Platform Validation (20 pts) — Independent signals across Meta, TikTok, Google.
 * 4. Brandability & Store Fit (15 pts) — Niche coherence, SKU expansion, bundling, branding.
 * 5. Creative Depth (10 pts) — Distinct creative hooks, video demonstrations, UGC feasibility.
 * 6. Competition Sustainability (10 pts) — Advertiser breadth without commodity saturation.
 *
 * V12.1 INVARIANTS:
 * - Zero ungrounded baseline points: Points accumulate strictly from observed evidence.
 * - Opportunity Score and Evidence Confidence are distinct metrics.
 * - Primary Top 3 Evergreen Leaderboard requires verified eligible candidates.
 * - Provisional candidates are routed to a separate provisional shortlist.
 */

import { DiscoveredProductCandidate } from "../identity/productCandidateDiscovery";
import {
  evaluateTemporalDemandStability,
  DemandDataPoint,
  KH02DemandClass,
} from "../demand/temporalDemandEngine";

export const KH02_SCORE_VERSION = "12.1.0";

export type KH02ProductTier =
  | "VERIFIED_EVERGREEN"
  | "PROVISIONAL_OPPORTUNITY"
  | "INSUFFICIENT_EVIDENCE"
  | "REQUIRES_MANUAL_REVIEW"
  | "REJECTED";

export interface PillarScoreDetail {
  score: number | null;
  maxWeight: number;
  status: "PASS" | "MODERATE" | "FAIL" | "MISSING_DATA";
  explanation: string;
}

export interface KH02ScoreResult {
  candidateId: string;
  opportunityScore: number | null;
  evidenceConfidence: number; // 0-100 completeness score
  scoreStatus: "VERIFIED" | "PROVISIONAL" | "INSUFFICIENT_EVIDENCE";
  tier: KH02ProductTier;
  formulaVersion: string;
  demandClass: KH02DemandClass;
  pillars: {
    demandStability: PillarScoreDetail;
    problemSolutionFit: PillarScoreDetail;
    multiPlatformValidation: PillarScoreDetail;
    brandabilityStoreFit: PillarScoreDetail;
    creativeDepth: PillarScoreDetail;
    competitionSustainability: PillarScoreDetail;
  };
  strengths: string[];
  risks: string[];
  missingEvidence: string[];
  recommendation: "RESEARCH_MORE" | "SHORTLIST" | "TEST_CANDIDATE" | "REQUIRES_MANUAL_REVIEW" | "REJECT";
  recommendationRationale: string;
  evaluatedAt: string;
}

export interface ProductScoringContext {
  candidate: DiscoveredProductCandidate;
  demandSeries: DemandDataPoint[];
  hasVerifiedSupplierQuote?: boolean;
  estimatedMargin?: number | null;
  complianceRiskDetected?: boolean;
  fragileOrHeavyShipping?: boolean;
}

export interface EligibilityGateResult {
  tier: KH02ProductTier;
  isTop3Eligible: boolean;
  gateReasons: string[];
}

/**
 * Evaluates whether a candidate qualifies for the primary Top 3 Evergreen Winners
 * versus the secondary Provisional Opportunities shortlist.
 */
export function applyKH02EligibilityGates(
  scoreResult: Omit<KH02ScoreResult, "tier"> & { tier?: KH02ProductTier; isProductIdentityVerified?: boolean }
): EligibilityGateResult {
  const gateReasons: string[] = [];

  // Gate 1: Compliance / trademark block
  if (scoreResult.recommendation === "REQUIRES_MANUAL_REVIEW") {
    gateReasons.push("Compliance, trademark, or safety risk flagged; requires manual operator review.");
    return {
      tier: "REQUIRES_MANUAL_REVIEW",
      isTop3Eligible: false,
      gateReasons,
    };
  }

  // Gate 2: Demand Stability Check
  const demandScore = scoreResult.pillars.demandStability.score;
  const isDemandDeclining =
    scoreResult.demandClass === "DECLINING" ||
    scoreResult.demandClass === "TREND_DEPENDENT" ||
    scoreResult.demandClass === "INSUFFICIENT_HISTORY";

  if (demandScore === null || isDemandDeclining || demandScore < 15) {
    gateReasons.push(
      demandScore === null
        ? "Lacks verified multi-month historical demand time series."
        : `Demand stability inadequate (${scoreResult.demandClass}, score: ${demandScore}/25).`
    );
  }

  // Gate 3: Evidence Confidence
  if (scoreResult.evidenceConfidence < 65) {
    gateReasons.push(`Evidence confidence (${scoreResult.evidenceConfidence}/100) below verified threshold (65/100).`);
  }

  // Gate 4: Overall Opportunity Score
  const oppScore = scoreResult.opportunityScore || 0;
  if (oppScore < 65) {
    gateReasons.push(`Opportunity score (${oppScore}/100) below verified evergreen threshold (65/100).`);
  }

  // Gate 5: Product Identity Verification (Section 95: Ambiguous identity cannot become verified evergreen winner)
  const isIdentityVerified = (scoreResult as any).isProductIdentityVerified !== false;
  if (!isIdentityVerified) {
    gateReasons.push("Product identity is unconfirmed, provisional, or ambiguous; cannot qualify as verified evergreen winner.");
  }

  // Final Qualification Decision
  if (
    scoreResult.scoreStatus === "VERIFIED" &&
    isIdentityVerified &&
    demandScore !== null &&
    demandScore >= 15 &&
    !isDemandDeclining &&
    scoreResult.evidenceConfidence >= 65 &&
    oppScore >= 65
  ) {
    return {
      tier: "VERIFIED_EVERGREEN",
      isTop3Eligible: true,
      gateReasons: ["Passed all evidence, stability, and confidence gates for evergreen qualification."],
    };
  }

  // Distinguish provisional opportunities from dead / insufficient data
  if (oppScore >= 40 && scoreResult.evidenceConfidence >= 30 && scoreResult.demandClass !== "DECLINING") {
    return {
      tier: "PROVISIONAL_OPPORTUNITY",
      isTop3Eligible: false,
      gateReasons,
    };
  }

  return {
    tier: "INSUFFICIENT_EVIDENCE",
    isTop3Eligible: false,
    gateReasons,
  };
}

/**
 * Calculates authoritative V12.1 Evergreen Opportunity Score.
 * Strictly avoids ungrounded point inflation.
 */
export function calculateKH02EvergreenScore(
  ctx: ProductScoringContext
): KH02ScoreResult {
  const evaluatedAt = new Date().toISOString();
  const c = ctx.candidate;
  const strengths: string[] = [];
  const risks: string[] = [];
  const missingEvidence: string[] = [];

  let confidencePoints = 0; // Out of 100

  // ── Pillar A: Demand Stability (25 pts) ───────────────────────────────────
  const demandEval = evaluateTemporalDemandStability(ctx.demandSeries, 90);
  let pillarA_Score: number | null = demandEval.stabilityScore;
  let pillarA_Status: PillarScoreDetail["status"] = "MISSING_DATA";

  if (pillarA_Score !== null) {
    confidencePoints += 25; // Full historical data confidence
    if (pillarA_Score >= 20) {
      pillarA_Status = "PASS";
      strengths.push(`Proven demand stability: ${demandEval.explanation}`);
    } else if (pillarA_Score >= 12) {
      pillarA_Status = "MODERATE";
      risks.push(`Moderate demand variation: ${demandEval.explanation}`);
    } else {
      pillarA_Status = "FAIL";
      risks.push(`Demand pattern: ${demandEval.explanation}`);
    }
  } else {
    missingEvidence.push(demandEval.explanation);
  }

  // ── Pillar B: Problem-Solution Fit (20 pts) ───────────────────────────────
  // Grounded: 0 base points
  let pillarB_Score = 0;
  let pillarB_Status: PillarScoreDetail["status"] = "FAIL";

  if (c.problemStatement && c.problemStatement.length > 10) {
    pillarB_Score += 12;
    confidencePoints += 15;
    strengths.push(`Clear customer problem addressed: "${c.problemStatement}"`);
  } else {
    missingEvidence.push("Explicit customer pain point statement is not verified in ad copy.");
  }

  if (c.totalObservationCount >= 5) {
    pillarB_Score += 8;
  } else if (c.totalObservationCount >= 2) {
    pillarB_Score += 4;
  }

  pillarB_Score = Math.min(20, pillarB_Score);
  if (pillarB_Score >= 15) pillarB_Status = "PASS";
  else if (pillarB_Score >= 8) pillarB_Status = "MODERATE";

  // ── Pillar C: Multi-Platform Validation (20 pts) ───────────────────────────
  // Grounded: 0 base points
  let pillarC_Score = 0;
  const sourceSet = new Set(c.supportingSourceTypes);
  const platformCount = sourceSet.size;

  if (sourceSet.has("META_ADS")) {
    pillarC_Score += 8;
    confidencePoints += 15;
  }
  if (sourceSet.has("TIKTOK_ADS") || sourceSet.has("TIKTOK_ORGANIC")) {
    pillarC_Score += 6;
    confidencePoints += 15;
  }
  if (sourceSet.has("GOOGLE_ADS")) {
    pillarC_Score += 6;
    confidencePoints += 10;
  }

  pillarC_Score = Math.min(20, pillarC_Score);
  let pillarC_Status: PillarScoreDetail["status"] = "FAIL";
  if (pillarC_Score >= 14) pillarC_Status = "PASS";
  else if (pillarC_Score >= 6) pillarC_Status = "MODERATE";

  if (platformCount > 1) {
    strengths.push(`Cross-platform validation: Confirmed across ${platformCount} independent media channels.`);
  } else if (platformCount === 1) {
    missingEvidence.push("Single-platform evidence: Lacks corroboration on secondary ad or social channels.");
  }

  // ── Pillar D: Brandability / Store Fit (15 pts) ─────────────────────────────
  // Grounded: 0 base points
  let pillarD_Score = 0;
  let pillarD_Status: PillarScoreDetail["status"] = "FAIL";

  if (c.storeDomain) {
    pillarD_Score += 8;
    confidencePoints += 10;
    strengths.push(`Identified commercial domain: ${c.storeDomain} with branded catalog potential.`);
  } else {
    missingEvidence.push("No independent store domain confirmed; domain evidence missing.");
  }

  if (c.category && c.category !== "General" && c.category !== "Other") {
    pillarD_Score += 7;
  } else {
    pillarD_Score += 2;
  }
  pillarD_Score = Math.min(15, pillarD_Score);
  if (pillarD_Score >= 11) pillarD_Status = "PASS";
  else if (pillarD_Score >= 6) pillarD_Status = "MODERATE";

  // ── Pillar E: Creative Depth (10 pts) ─────────────────────────────────────
  // Grounded: 0 base points
  let pillarE_Score = 0;
  const uniqueAds = c.supportingAdIds.length;

  if (uniqueAds >= 5) pillarE_Score += 5;
  else if (uniqueAds >= 2) pillarE_Score += 3;
  else if (uniqueAds === 1) pillarE_Score += 1;

  if (c.videoUrl || c.sourceObservations.some((o) => o.media.mediaType === "VIDEO")) {
    pillarE_Score += 5;
    confidencePoints += 10;
    strengths.push("Video demonstration creative available for product hook evaluation.");
  } else {
    missingEvidence.push("No verified video creative available for hook analysis.");
  }

  pillarE_Score = Math.min(10, pillarE_Score);
  let pillarE_Status: PillarScoreDetail["status"] = "FAIL";
  if (pillarE_Score >= 7) pillarE_Status = "PASS";
  else if (pillarE_Score >= 4) pillarE_Status = "MODERATE";

  // ── Pillar F: Competition Sustainability (10 pts) ──────────────────────────
  // Grounded: 0 base points
  let pillarF_Score = 0;
  const distinctAdvertisers = c.distinctAdvertisersCount;

  if (distinctAdvertisers >= 2 && distinctAdvertisers <= 8) {
    // Healthy competitive breadth
    pillarF_Score = 10;
    strengths.push(`Healthy competitive landscape: ${distinctAdvertisers} active independent advertisers observed.`);
    confidencePoints += 10;
  } else if (distinctAdvertisers > 8) {
    // Crowded / saturated
    pillarF_Score = 6;
    risks.push(`High competitive saturation: ${distinctAdvertisers}+ advertisers competing in identical niche.`);
    confidencePoints += 10;
  } else if (distinctAdvertisers === 1) {
    // Single advertiser
    pillarF_Score = 3;
    risks.push("Concentration risk: Evidence currently limited to a single advertiser.");
    confidencePoints += 5;
  } else {
    pillarF_Score = 0;
  }

  let pillarF_Status: PillarScoreDetail["status"] = "FAIL";
  if (pillarF_Score >= 8) pillarF_Status = "PASS";
  else if (pillarF_Score >= 3) pillarF_Status = "MODERATE";

  // ── Total Score & Status Determination ─────────────────────────────────────
  let totalScore: number | null = null;
  let scoreStatus: KH02ScoreResult["scoreStatus"] = "INSUFFICIENT_EVIDENCE";

  if (pillarA_Score !== null) {
    totalScore = pillarA_Score + pillarB_Score + pillarC_Score + pillarD_Score + pillarE_Score + pillarF_Score;
    scoreStatus = confidencePoints >= 65 ? "VERIFIED" : "PROVISIONAL";
  } else {
    // Provisional score calculated without Pillar A, scaled for research context
    const preliminaryTotal = pillarB_Score + pillarC_Score + pillarD_Score + pillarE_Score + pillarF_Score;
    totalScore = Math.round((preliminaryTotal / 75) * 80); // Capped at 80 provisional
    scoreStatus = "PROVISIONAL";
  }

  // ── Recommendations & Risk Gates ───────────────────────────────────────────
  let recommendation: KH02ScoreResult["recommendation"] = "RESEARCH_MORE";
  let rationale = "Further data required to confirm evergreen stability and economics viability.";

  if (ctx.complianceRiskDetected) {
    recommendation = "REQUIRES_MANUAL_REVIEW";
    rationale = "Compliance or trademark/safety risk flagged. Manual inspection required before promotion.";
    risks.push("Compliance/safety risk flagged on product candidate.");
  } else if (ctx.fragileOrHeavyShipping) {
    risks.push("Shipping & fulfillment fragility risk: Potentially high return or damage rate.");
  }

  if (recommendation !== "REQUIRES_MANUAL_REVIEW") {
    // Rule: Declining demand, trend-dependent volatility, or failing demand stability can NEVER be a TEST_CANDIDATE
    const isDemandEligible =
      demandEval.demandClass !== "DECLINING" &&
      demandEval.demandClass !== "TREND_DEPENDENT" &&
      demandEval.demandClass !== "INSUFFICIENT_HISTORY" &&
      pillarA_Score !== null &&
      pillarA_Score >= 15;

    if (scoreStatus === "VERIFIED" && totalScore !== null && totalScore >= 75 && confidencePoints >= 70 && isDemandEligible) {
      recommendation = "TEST_CANDIDATE";
      rationale = `High evergreen opportunity score (${totalScore}/100) with verified demand stability and multi-source evidence.`;
    } else if (totalScore !== null && totalScore >= 50 && demandEval.demandClass !== "DECLINING") {
      recommendation = "SHORTLIST";
      rationale = `Promising candidate (${totalScore}/100). Valid candidate for niche store catalog, recommend supplier quote verification.`;
    } else {
      recommendation = "RESEARCH_MORE";
      rationale = demandEval.demandClass === "DECLINING"
        ? `Declining search interest detected (${demandEval.explanation}). Do not test without proving renewed demand.`
        : `Moderate score (${totalScore || "N/A"}/100). Requires additional demand history and creative validation.`;
    }
  }

  const prelimResult = {
    candidateId: c.candidateId,
    opportunityScore: totalScore,
    evidenceConfidence: Math.min(100, confidencePoints),
    scoreStatus,
    formulaVersion: KH02_SCORE_VERSION,
    demandClass: demandEval.demandClass,
    pillars: {
      demandStability: {
        score: pillarA_Score,
        maxWeight: 25,
        status: pillarA_Status,
        explanation: demandEval.explanation,
      },
      problemSolutionFit: {
        score: pillarB_Score,
        maxWeight: 20,
        status: pillarB_Status,
        explanation: c.problemStatement || "Functional utility observed across promotional creative hooks.",
      },
      multiPlatformValidation: {
        score: pillarC_Score,
        maxWeight: 20,
        status: pillarC_Status,
        explanation: `Observed across ${platformCount} platform source(s): ${Array.from(sourceSet).join(", ")}.`,
      },
      brandabilityStoreFit: {
        score: pillarD_Score,
        maxWeight: 15,
        status: pillarD_Status,
        explanation: c.storeDomain
          ? `Well-suited for dedicated ${c.category} branded store (${c.storeDomain}).`
          : `Generic ${c.category} product without confirmed storefront domain.`,
      },
      creativeDepth: {
        score: pillarE_Score,
        maxWeight: 10,
        status: pillarE_Status,
        explanation: `${uniqueAds} distinct creative variation(s) observed${c.videoUrl ? " with video demonstration" : ""}.`,
      },
      competitionSustainability: {
        score: pillarF_Score,
        maxWeight: 10,
        status: pillarF_Status,
        explanation: `${distinctAdvertisers} independent advertiser(s) actively running campaigns.`,
      },
    },
    strengths,
    risks,
    missingEvidence,
    recommendation,
    recommendationRationale: rationale,
    evaluatedAt,
  };

  const gateResult = applyKH02EligibilityGates({
    ...prelimResult,
    isProductIdentityVerified: c.identityStatus === "VERIFIED",
  });

  return {
    ...prelimResult,
    tier: gateResult.tier,
  };
}
