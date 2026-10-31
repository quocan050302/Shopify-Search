/**
 * Evergreen Scoring Engine — SWAI V7.0
 *
 * Calculates two separate scores:
 *   1. Ad Longevity Score — based on verified ad age and observation history.
 *   2. Evergreen Product Score — based on product demand stability and ad investment.
 *
 * IMPORTANT:
 * - Scores are RESEARCH PRIORITY signals, not profit indicators.
 * - "High Research Priority" ≠ "Guaranteed Profitable".
 * - Missing data stays missing — never substituted with median defaults.
 * - Score eligibility gates prevent false high scores from data gaps.
 */

import {
  calculateAdLongevity,
  type LongevityInput,
  type LongevityCategory,
  type CoverageStatus,
} from "./longevityEngine";

export const EVERGREEN_FORMULA_VERSION = "7.0.0";

// ─── Tier Definitions ─────────────────────────────────────────────────────────

export type EvergreenTier =
  | "HIGH_RESEARCH_PRIORITY"
  | "MEDIUM_RESEARCH_PRIORITY"
  | "LOW_RESEARCH_PRIORITY"
  | "INSUFFICIENT_EVIDENCE";

// ─── Ad Longevity Score ───────────────────────────────────────────────────────

export interface AdLongevityScoreInput extends LongevityInput {
  hasLandingPage?: boolean;
  hasCallToAction?: boolean;
  sourceReliability?: "OFFICIAL_PROVIDER" | "USER_IMPORT" | "MANUAL_ENTRY" | "UNKNOWN";
}

export interface AdLongevityScoreResult {
  adId: string;
  // Eligibility gate
  eligible: boolean;
  eligibilityReason: string;
  availableSignals: string[];
  missingSignals: string[];
  // Score
  totalScore: number | null;
  tier: EvergreenTier;
  // Components (null = signal not available)
  longevityComponent: number | null;      // 0–35 points
  observationComponent: number | null;    // 0–30 points
  coverageComponent: number | null;       // 0–20 points
  sourceReliabilityComponent: number | null; // 0–15 points
  // Weights
  componentWeights: {
    longevity: number;
    observation: number;
    coverage: number;
    sourceReliability: number;
  };
  // Evidence
  evidenceConfidence: number; // 0–1
  longevityCategory: LongevityCategory;
  coverageStatus: CoverageStatus;
  calendarAgeDays: number | null;
  ageEvidenceSource: "SOURCE_REPORTED" | "FIRST_OBSERVATION" | "NONE";
  // Breakdown detail
  scoreBreakdown: Record<string, { score: number | null; weight: number; reason: string }>;
  formulaVersion: string;
  explanation: string;
  calculatedAt: string;
}

const AD_LONGEVITY_WEIGHTS = {
  longevity: 35,
  observation: 30,
  coverage: 20,
  sourceReliability: 15,
};

// Minimum evidence gate: need at least one of these
const LONGEVITY_ELIGIBILITY_GATES = {
  minCalendarAgeDays: 1,
  minObservations: 0, // zero is ok — even source-reported age qualifies
};

/**
 * Computes Ad Longevity Score from longevity inputs.
 *
 * Requirements:
 * - Scoring requires at minimum one usable date signal.
 * - Two observations 90 days apart are NOT counted as 90 active days.
 * - SYNTHETIC_QUARANTINED records score null / INSUFFICIENT_EVIDENCE.
 */
export function calculateAdLongevityScore(
  input: AdLongevityScoreInput
): AdLongevityScoreResult {
  const calculatedAt = new Date().toISOString();

  // Get base longevity data
  const longevity = calculateAdLongevity(input);

  const availableSignals: string[] = [];
  const missingSignals: string[] = [];

  // ── Eligibility check ────────────────────────────────────────────────────
  if (input.isSyntheticQuarantine) {
    return {
      adId: input.adId,
      eligible: false,
      eligibilityReason: "Record is synthetic/quarantined. Scoring not applicable.",
      availableSignals: [],
      missingSignals: ["verified_ad_id", "real_source_url", "observation_history"],
      totalScore: null,
      tier: "INSUFFICIENT_EVIDENCE",
      longevityComponent: null,
      observationComponent: null,
      coverageComponent: null,
      sourceReliabilityComponent: null,
      componentWeights: AD_LONGEVITY_WEIGHTS,
      evidenceConfidence: 0,
      longevityCategory: "UNKNOWN",
      coverageStatus: "INSUFFICIENT_EVIDENCE",
      calendarAgeDays: null,
      ageEvidenceSource: "NONE",
      scoreBreakdown: {},
      formulaVersion: EVERGREEN_FORMULA_VERSION,
      explanation: "Synthetic/quarantined record. No longevity score can be calculated.",
      calculatedAt,
    };
  }

  // Need at least a date signal to score
  if (longevity.calendarAgeDays === null) {
    return {
      adId: input.adId,
      eligible: false,
      eligibilityReason:
        "No date evidence (no source-reported start date, no observations). Cannot calculate age.",
      availableSignals: [],
      missingSignals: [
        "source_reported_start_date",
        "first_observation",
        "lifecycle_events",
      ],
      totalScore: null,
      tier: "INSUFFICIENT_EVIDENCE",
      longevityComponent: null,
      observationComponent: null,
      coverageComponent: null,
      sourceReliabilityComponent: null,
      componentWeights: AD_LONGEVITY_WEIGHTS,
      evidenceConfidence: 0,
      longevityCategory: "UNKNOWN",
      coverageStatus: "INSUFFICIENT_EVIDENCE",
      calendarAgeDays: null,
      ageEvidenceSource: "NONE",
      scoreBreakdown: {},
      formulaVersion: EVERGREEN_FORMULA_VERSION,
      explanation: "Insufficient evidence: no date signals found.",
      calculatedAt,
    };
  }

  // ── Longevity component (0–35) ────────────────────────────────────────────
  // Score based on calendar age. Caps at 180+ days.
  let longevityComponent: number;
  const ageDays = longevity.calendarAgeDays;

  availableSignals.push(
    longevity.ageEvidenceSource === "SOURCE_REPORTED"
      ? "source_reported_start_date"
      : "first_observation_date"
  );

  if (ageDays < 14) longevityComponent = 5;
  else if (ageDays < 30) longevityComponent = 10;
  else if (ageDays < 60) longevityComponent = 18;
  else if (ageDays < 90) longevityComponent = 24;
  else if (ageDays < 180) longevityComponent = 30;
  else longevityComponent = 35;

  // Discount: source-reported dates without any SWAI verification are less reliable
  if (
    longevity.ageEvidenceSource === "SOURCE_REPORTED" &&
    longevity.totalObservationCount === 0
  ) {
    longevityComponent = Math.round(longevityComponent * 0.75);
    missingSignals.push("swai_observation_verification");
  }

  // ── Observation component (0–30) ─────────────────────────────────────────
  let observationComponent: number | null = null;
  const obsCount = longevity.totalObservationCount;
  const activeCount = longevity.verifiedActiveObservationCount;

  if (obsCount === 0) {
    missingSignals.push("swai_observations");
    observationComponent = 0; // Zero points, not null — we'll still score if age is known
  } else {
    availableSignals.push("swai_observations");
    // Base: observation count
    let obsScore = 0;
    if (obsCount >= 10) obsScore = 20;
    else if (obsCount >= 5) obsScore = 15;
    else if (obsCount >= 3) obsScore = 10;
    else if (obsCount >= 2) obsScore = 6;
    else obsScore = 3; // Single observation
    // Bonus: verified-active subset
    if (activeCount >= 3) obsScore += 10;
    else if (activeCount >= 1) obsScore += 5;
    observationComponent = Math.min(30, obsScore);
  }

  // ── Coverage component (0–20) ─────────────────────────────────────────────
  let coverageComponent: number | null = null;
  const coverageStatus = longevity.coverageStatus;

  if (coverageStatus === "INSUFFICIENT_EVIDENCE") {
    missingSignals.push("observation_coverage");
    coverageComponent = 0;
  } else {
    availableSignals.push("observation_coverage");
    if (coverageStatus === "HIGH_COVERAGE") coverageComponent = 20;
    else if (coverageStatus === "MODERATE_COVERAGE") coverageComponent = 13;
    else if (coverageStatus === "SPARSE_COVERAGE") coverageComponent = 7;
    else coverageComponent = 3; // SINGLE_OBSERVATION
  }

  // ── Source reliability component (0–15) ───────────────────────────────────
  let sourceReliabilityComponent: number;
  const srcRel = input.sourceReliability ?? "UNKNOWN";

  if (srcRel === "OFFICIAL_PROVIDER") {
    sourceReliabilityComponent = 15;
    availableSignals.push("official_provider_source");
  } else if (srcRel === "USER_IMPORT") {
    sourceReliabilityComponent = 8;
    availableSignals.push("user_import_source");
  } else if (srcRel === "MANUAL_ENTRY") {
    sourceReliabilityComponent = 4;
    availableSignals.push("manual_entry_source");
  } else {
    sourceReliabilityComponent = 2;
    missingSignals.push("known_source_reliability");
  }

  // ── Total score ───────────────────────────────────────────────────────────
  const totalScore = Math.round(
    longevityComponent + observationComponent + coverageComponent + sourceReliabilityComponent
  );

  // ── Tier classification ───────────────────────────────────────────────────
  let tier: EvergreenTier;
  const conf = longevity.continuityConfidence;

  if (totalScore >= 70 && conf >= 0.5) tier = "HIGH_RESEARCH_PRIORITY";
  else if (totalScore >= 45 && conf >= 0.2) tier = "MEDIUM_RESEARCH_PRIORITY";
  else if (totalScore >= 20) tier = "LOW_RESEARCH_PRIORITY";
  else tier = "INSUFFICIENT_EVIDENCE";

  // ── Breakdown ─────────────────────────────────────────────────────────────
  const scoreBreakdown = {
    longevity: {
      score: longevityComponent,
      weight: AD_LONGEVITY_WEIGHTS.longevity,
      reason: `${ageDays}-day ${longevity.ageEvidenceSource === "SOURCE_REPORTED" ? "source-reported" : "estimated"} age → ${longevityComponent}/${AD_LONGEVITY_WEIGHTS.longevity} points`,
    },
    observation: {
      score: observationComponent,
      weight: AD_LONGEVITY_WEIGHTS.observation,
      reason: `${obsCount} total observations, ${activeCount} confirmed active → ${observationComponent}/${AD_LONGEVITY_WEIGHTS.observation} points`,
    },
    coverage: {
      score: coverageComponent,
      weight: AD_LONGEVITY_WEIGHTS.coverage,
      reason: `${coverageStatus} → ${coverageComponent}/${AD_LONGEVITY_WEIGHTS.coverage} points`,
    },
    sourceReliability: {
      score: sourceReliabilityComponent,
      weight: AD_LONGEVITY_WEIGHTS.sourceReliability,
      reason: `Source: ${srcRel} → ${sourceReliabilityComponent}/${AD_LONGEVITY_WEIGHTS.sourceReliability} points`,
    },
  };

  const explanation =
    `Evergreen Research Score: ${totalScore}/100 (${tier}). ` +
    `${longevity.explanation} ` +
    `[Formula V${EVERGREEN_FORMULA_VERSION}. ` +
    `This score is a RESEARCH PRIORITY signal — not a profitability indicator.]`;

  return {
    adId: input.adId,
    eligible: true,
    eligibilityReason: "Minimum evidence met.",
    availableSignals,
    missingSignals,
    totalScore,
    tier,
    longevityComponent,
    observationComponent,
    coverageComponent,
    sourceReliabilityComponent,
    componentWeights: AD_LONGEVITY_WEIGHTS,
    evidenceConfidence: longevity.continuityConfidence,
    longevityCategory: longevity.longevityCategory,
    coverageStatus: longevity.coverageStatus,
    calendarAgeDays: ageDays,
    ageEvidenceSource: longevity.ageEvidenceSource,
    scoreBreakdown,
    formulaVersion: EVERGREEN_FORMULA_VERSION,
    explanation,
    calculatedAt,
  };
}

// ─── Evergreen Product Score ──────────────────────────────────────────────────

export type DemandStabilityClass =
  | "EVERGREEN_STABLE"
  | "SEASONAL_RECURRING"
  | "TREND_DRIVEN"
  | "DECLINING"
  | "INSUFFICIENT_DATA";

export interface ProductEvergreenInput {
  productId: string;
  // Demand observations (time-series data)
  demandObservations: Array<{
    periodStart: Date;
    periodEnd: Date;
    demandValue: number | null; // 0–100 relative interest
    region: string;
    source: string;
  }>;
  // Linked ads
  linkedAdCount: number;
  distinctCreativeCount: number; // Distinct verified creative variants
  observedActiveAdCount: number; // Ads with at least one active observation
  // Product availability
  productAvailabilityConfirmed: boolean;
  priceObservationCount: number;
}

export interface ProductEvergreenScoreResult {
  productId: string;
  eligible: boolean;
  eligibilityReason: string;
  totalScore: number | null;
  tier: EvergreenTier;
  // Components
  demandStabilityScore: number | null;   // 0–40
  adPersistenceScore: number | null;     // 0–30
  creativeInvestScore: number | null;    // 0–20
  productAvailScore: number | null;      // 0–10
  // Demand analysis
  demandStabilityClass: DemandStabilityClass;
  demandObservationCount: number;
  demandObservationPeriodDays: number | null;
  evidenceConfidence: number;
  scoreBreakdown: Record<string, { score: number | null; weight: number; reason: string }>;
  formulaVersion: string;
  explanation: string;
  calculatedAt: string;
}

/**
 * Calculates demand stability from time-series observations.
 * Returns null if insufficient data.
 */
export function calculateDemandStability(
  observations: Array<{
    demandValue: number | null;
    periodStart: Date;
    periodEnd: Date;
  }>
): { stabilityScore: number | null; class: DemandStabilityClass; explanation: string } {
  const valid = observations.filter(
    (o) => o.demandValue !== null && o.demandValue >= 0
  ) as Array<{ demandValue: number; periodStart: Date; periodEnd: Date }>;

  if (valid.length < 3) {
    return {
      stabilityScore: null,
      class: "INSUFFICIENT_DATA",
      explanation: `Only ${valid.length} valid demand data points — minimum 3 required for stability analysis.`,
    };
  }

  const values = valid.map((o) => o.demandValue);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = mean > 0 ? stdDev / mean : 1;

  // Score: lower CV = more stable = higher score
  let stabilityScore: number;
  let demandClass: DemandStabilityClass;
  let explanation: string;

  if (mean < 10 && stdDev < 5) {
    stabilityScore = 5;
    demandClass = "DECLINING";
    explanation = `Very low mean interest (${mean.toFixed(1)}) with low variation — likely declining product.`;
  } else if (coefficientOfVariation < 0.2) {
    stabilityScore = 38;
    demandClass = "EVERGREEN_STABLE";
    explanation = `High demand stability (CV=${coefficientOfVariation.toFixed(2)}, mean=${mean.toFixed(1)}).`;
  } else if (coefficientOfVariation < 0.4) {
    stabilityScore = 28;
    demandClass = "SEASONAL_RECURRING";
    explanation = `Moderate variation (CV=${coefficientOfVariation.toFixed(2)}) — possible seasonal pattern.`;
  } else if (coefficientOfVariation < 0.7) {
    stabilityScore = 15;
    demandClass = "TREND_DRIVEN";
    explanation = `High variation (CV=${coefficientOfVariation.toFixed(2)}) — possibly trend-driven, not evergreen.`;
  } else {
    stabilityScore = 5;
    demandClass = "TREND_DRIVEN";
    explanation = `Very high variation (CV=${coefficientOfVariation.toFixed(2)}) — short spike, not evergreen.`;
  }

  return { stabilityScore, class: demandClass, explanation };
}

/**
 * Classifies demand seasonality from time-series data.
 */
export function detectProductSeasonality(
  observations: Array<{ demandValue: number | null; periodStart: Date; periodEnd: Date }>
): DemandStabilityClass {
  return calculateDemandStability(observations).class;
}

/**
 * Calculates Evergreen Product Score.
 */
export function calculateEvergreenProductScore(
  input: ProductEvergreenInput
): ProductEvergreenScoreResult {
  const calculatedAt = new Date().toISOString();

  // ── Eligibility ───────────────────────────────────────────────────────────
  const hasAnySignal =
    input.demandObservations.length > 0 ||
    input.linkedAdCount > 0;

  if (!hasAnySignal) {
    return {
      productId: input.productId,
      eligible: false,
      eligibilityReason:
        "No demand observations and no linked ads. Cannot compute Evergreen Product Score.",
      totalScore: null,
      tier: "INSUFFICIENT_EVIDENCE",
      demandStabilityScore: null,
      adPersistenceScore: null,
      creativeInvestScore: null,
      productAvailScore: null,
      demandStabilityClass: "INSUFFICIENT_DATA",
      demandObservationCount: 0,
      demandObservationPeriodDays: null,
      evidenceConfidence: 0,
      scoreBreakdown: {},
      formulaVersion: EVERGREEN_FORMULA_VERSION,
      explanation: "INSUFFICIENT_EVIDENCE: No signals available for this product.",
      calculatedAt,
    };
  }

  // ── Demand stability (0–40) ───────────────────────────────────────────────
  const demandResult = calculateDemandStability(input.demandObservations);
  const demandStabilityScore = demandResult.stabilityScore;
  const demandStabilityClass = demandResult.class;

  // Observation period span
  let demandObservationPeriodDays: number | null = null;
  if (input.demandObservations.length >= 2) {
    const sorted = [...input.demandObservations].sort(
      (a, b) => new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime()
    );
    const spanMs =
      new Date(sorted[sorted.length - 1].periodEnd).getTime() -
      new Date(sorted[0].periodStart).getTime();
    demandObservationPeriodDays = Math.round(spanMs / (1000 * 60 * 60 * 24));
  }

  // ── Ad persistence (0–30) ────────────────────────────────────────────────
  let adPersistenceScore = 0;
  if (input.linkedAdCount >= 5) adPersistenceScore = 30;
  else if (input.linkedAdCount >= 3) adPersistenceScore = 20;
  else if (input.linkedAdCount >= 2) adPersistenceScore = 12;
  else if (input.linkedAdCount === 1) adPersistenceScore = 6;

  if (input.observedActiveAdCount >= 2) adPersistenceScore = Math.min(30, adPersistenceScore + 5);

  // ── Creative investment (0–20) ────────────────────────────────────────────
  let creativeInvestScore = 0;
  if (input.distinctCreativeCount >= 5) creativeInvestScore = 20;
  else if (input.distinctCreativeCount >= 3) creativeInvestScore = 14;
  else if (input.distinctCreativeCount >= 2) creativeInvestScore = 9;
  else if (input.distinctCreativeCount === 1) creativeInvestScore = 4;

  // ── Product availability (0–10) ───────────────────────────────────────────
  let productAvailScore = 0;
  if (input.productAvailabilityConfirmed) productAvailScore += 6;
  if (input.priceObservationCount >= 2) productAvailScore += 4;
  else if (input.priceObservationCount === 1) productAvailScore += 2;

  // ── Total ─────────────────────────────────────────────────────────────────
  const components = [
    demandStabilityScore ?? 0,
    adPersistenceScore,
    creativeInvestScore,
    productAvailScore,
  ];
  const totalScore = components.reduce((a, b) => a + b, 0);

  // ── Tier ──────────────────────────────────────────────────────────────────
  let tier: EvergreenTier;
  if (demandStabilityScore === null && input.linkedAdCount === 0) {
    tier = "INSUFFICIENT_EVIDENCE";
  } else if (totalScore >= 60) tier = "HIGH_RESEARCH_PRIORITY";
  else if (totalScore >= 35) tier = "MEDIUM_RESEARCH_PRIORITY";
  else if (totalScore >= 15) tier = "LOW_RESEARCH_PRIORITY";
  else tier = "INSUFFICIENT_EVIDENCE";

  // Evidence confidence
  let evidenceConfidence = 0;
  if (input.demandObservations.length >= 12) evidenceConfidence += 0.4;
  else if (input.demandObservations.length >= 4) evidenceConfidence += 0.2;
  else if (input.demandObservations.length > 0) evidenceConfidence += 0.1;
  if (input.linkedAdCount >= 2) evidenceConfidence += 0.2;
  if (input.distinctCreativeCount >= 2) evidenceConfidence += 0.2;
  if (input.productAvailabilityConfirmed) evidenceConfidence += 0.2;
  evidenceConfidence = Math.min(1, evidenceConfidence);

  const scoreBreakdown = {
    demandStability: {
      score: demandStabilityScore,
      weight: 40,
      reason: demandResult.explanation,
    },
    adPersistence: {
      score: adPersistenceScore,
      weight: 30,
      reason: `${input.linkedAdCount} linked ads, ${input.observedActiveAdCount} with active observations`,
    },
    creativeInvestment: {
      score: creativeInvestScore,
      weight: 20,
      reason: `${input.distinctCreativeCount} distinct creative variants confirmed`,
    },
    productAvailability: {
      score: productAvailScore,
      weight: 10,
      reason: `Availability: ${input.productAvailabilityConfirmed ? "confirmed" : "unknown"}. ${input.priceObservationCount} price observation(s).`,
    },
  };

  const explanation =
    `Evergreen Product Score: ${totalScore}/100 (${tier}). ` +
    `Demand: ${demandStabilityClass}. ` +
    `Linked ads: ${input.linkedAdCount}. ` +
    `Creative variants: ${input.distinctCreativeCount}. ` +
    `[Formula V${EVERGREEN_FORMULA_VERSION}. Research signal only — not a profitability guarantee.]`;

  return {
    productId: input.productId,
    eligible: true,
    eligibilityReason: "Minimum signals available.",
    totalScore,
    tier,
    demandStabilityScore,
    adPersistenceScore,
    creativeInvestScore,
    productAvailScore,
    demandStabilityClass,
    demandObservationCount: input.demandObservations.length,
    demandObservationPeriodDays,
    evidenceConfidence,
    scoreBreakdown,
    formulaVersion: EVERGREEN_FORMULA_VERSION,
    explanation,
    calculatedAt,
  };
}

// ─── Evidence Confidence ──────────────────────────────────────────────────────

export interface EvergreenEvidenceInput {
  sourceReliability: "OFFICIAL_PROVIDER" | "USER_IMPORT" | "MANUAL_ENTRY" | "UNKNOWN";
  observationCount: number;
  demandHistoryMonths: number | null;
  hasVerifiedTimestamps: boolean;
  productMatchConfidence: "CONFIRMED" | "HIGH_CONFIDENCE" | "PROBABLE" | "UNKNOWN";
  missingDataFields: string[];
  dateFreshnessLimitDays?: number; // Days since last observation
}

/**
 * Overall evidence confidence for evergreen classification.
 * Returns 0–1.
 */
export function calculateEvergreenEvidenceConfidence(
  input: EvergreenEvidenceInput
): {
  confidence: number;
  explanation: string;
  factors: Record<string, number>;
} {
  const factors: Record<string, number> = {};

  // Source reliability (up to 0.30)
  if (input.sourceReliability === "OFFICIAL_PROVIDER") factors.sourceReliability = 0.3;
  else if (input.sourceReliability === "USER_IMPORT") factors.sourceReliability = 0.18;
  else if (input.sourceReliability === "MANUAL_ENTRY") factors.sourceReliability = 0.08;
  else factors.sourceReliability = 0;

  // Observation coverage (up to 0.25)
  if (input.observationCount >= 10) factors.observationCoverage = 0.25;
  else if (input.observationCount >= 5) factors.observationCoverage = 0.18;
  else if (input.observationCount >= 2) factors.observationCoverage = 0.1;
  else if (input.observationCount === 1) factors.observationCoverage = 0.05;
  else factors.observationCoverage = 0;

  // Demand history (up to 0.25)
  const months = input.demandHistoryMonths ?? 0;
  if (months >= 24) factors.demandHistory = 0.25;
  else if (months >= 12) factors.demandHistory = 0.18;
  else if (months >= 6) factors.demandHistory = 0.1;
  else if (months >= 2) factors.demandHistory = 0.05;
  else factors.demandHistory = 0;

  // Verified timestamps (up to 0.10)
  factors.verifiedTimestamps = input.hasVerifiedTimestamps ? 0.1 : 0;

  // Product matching (up to 0.10)
  if (input.productMatchConfidence === "CONFIRMED") factors.productMatch = 0.1;
  else if (input.productMatchConfidence === "HIGH_CONFIDENCE") factors.productMatch = 0.07;
  else if (input.productMatchConfidence === "PROBABLE") factors.productMatch = 0.03;
  else factors.productMatch = 0;

  // Missing data penalty
  const missingPenalty = Math.min(0.3, input.missingDataFields.length * 0.05);
  factors.missingDataPenalty = -missingPenalty;

  // Data freshness penalty (if last observation was very old)
  if (input.dateFreshnessLimitDays && input.dateFreshnessLimitDays > 90) {
    factors.stalePenalty = -0.1;
  } else {
    factors.stalePenalty = 0;
  }

  const confidence = Math.max(
    0,
    Math.min(1, Object.values(factors).reduce((a, b) => a + b, 0))
  );

  const explanation =
    `Evidence confidence: ${(confidence * 100).toFixed(0)}%. ` +
    `Source: ${input.sourceReliability}. ` +
    `Observations: ${input.observationCount}. ` +
    `Demand history: ${months} months. ` +
    `Missing fields: [${input.missingDataFields.join(", ") || "none"}].`;

  return { confidence, explanation, factors };
}

// ─── Ranking Engine ───────────────────────────────────────────────────────────

export type ResearchMode = "NEWLY_LAUNCHED" | "EVERGREEN" | "EMERGING" | "TRENDING";

export interface EvergreenRankingFilters {
  mode: ResearchMode;
  platform?: "META" | "TIKTOK" | "ALL";
  minAgeDays?: number;
  minEvidenceConfidence?: number; // 0–1
  longevityCategories?: LongevityCategory[];
  coverageStatuses?: CoverageStatus[];
}

/**
 * Ranks evergreen scores by research priority.
 * Synthetic records MUST be excluded before calling this function.
 */
export function rankEvergreenAds(
  scores: AdLongevityScoreResult[],
  filters: EvergreenRankingFilters
): AdLongevityScoreResult[] {
  let filtered = scores.filter(
    (s) => s.eligible && s.totalScore !== null
  );

  // Apply filters
  if (filters.minAgeDays) {
    filtered = filtered.filter(
      (s) => s.calendarAgeDays !== null && s.calendarAgeDays >= (filters.minAgeDays ?? 0)
    );
  }

  if (filters.minEvidenceConfidence !== undefined) {
    filtered = filtered.filter(
      (s) => s.evidenceConfidence >= (filters.minEvidenceConfidence ?? 0)
    );
  }

  if (filters.longevityCategories?.length) {
    filtered = filtered.filter((s) =>
      filters.longevityCategories!.includes(s.longevityCategory)
    );
  }

  if (filters.coverageStatuses?.length) {
    filtered = filtered.filter((s) =>
      filters.coverageStatuses!.includes(s.coverageStatus)
    );
  }

  // Sort and filter by mode
  if (filters.mode === "NEWLY_LAUNCHED") {
    // Newest ads first (lowest calendar age days), secondary: score desc
    filtered.sort((a, b) => {
      const ageDiff = (a.calendarAgeDays ?? 9999) - (b.calendarAgeDays ?? 9999);
      if (ageDiff !== 0) return ageDiff;
      return (b.totalScore ?? 0) - (a.totalScore ?? 0);
    });
  } else if (filters.mode === "EVERGREEN") {
    // Longevity-based research ranking: total score desc, secondary: calendar age desc, tertiary: confidence desc
    filtered.sort((a, b) => {
      const scoreDiff = (b.totalScore ?? 0) - (a.totalScore ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      const ageDiff = (b.calendarAgeDays ?? 0) - (a.calendarAgeDays ?? 0);
      if (ageDiff !== 0) return ageDiff;
      return b.evidenceConfidence - a.evidenceConfidence;
    });
  } else if (filters.mode === "EMERGING") {
    // EMERGING: Requires actual early-stage signals (longevityCategory in EARLY_POTENTIAL or PROMISING,
    // or age between 7 and 60 days with valid score) rather than just sorting arbitrary ads by young age.
    filtered = filtered.filter(
      (s) =>
        s.longevityCategory === "EARLY_POTENTIAL" ||
        s.longevityCategory === "PROMISING" ||
        (s.calendarAgeDays !== null && s.calendarAgeDays >= 7 && s.calendarAgeDays <= 60 && (s.totalScore ?? 0) >= 15)
    );
    filtered.sort((a, b) => {
      // Prioritize ads with proven observation evidence first
      const obsDiff = (b.observationComponent ?? 0) - (a.observationComponent ?? 0);
      if (obsDiff !== 0) return obsDiff;
      return (a.calendarAgeDays ?? 0) - (b.calendarAgeDays ?? 0);
    });
  } else {
    // TRENDING / EVIDENCE RANKED: Prioritize measurable observation changes, repeated verified sightings,
    // and higher evidence confidence over single static sightings.
    filtered.sort((a, b) => {
      const aObs = a.observationComponent ?? 0;
      const bObs = b.observationComponent ?? 0;
      if (bObs !== aObs) return bObs - aObs;
      const confDiff = b.evidenceConfidence - a.evidenceConfidence;
      if (Math.abs(confDiff) > 0.05) return confDiff;
      return (b.totalScore ?? 0) - (a.totalScore ?? 0);
    });
  }

  return filtered;
}

/**
 * Returns human-readable ranking explanation for an ad.
 */
export function explainEvergreenRanking(score: AdLongevityScoreResult): string {
  if (!score.eligible) return score.eligibilityReason;

  const agePart =
    score.calendarAgeDays !== null
      ? `${score.calendarAgeDays}-day ${score.ageEvidenceSource === "SOURCE_REPORTED" ? "source-reported" : "estimated"} age`
      : "unknown age";

  const obsPart =
    score.observationComponent !== null
      ? `, ${score.scoreBreakdown?.observation?.reason ?? "observations recorded"}`
      : ", no direct SWAI observations";

  const disclaimer =
    "\n\nImportant: Research priority tier is not evidence of profitability or confirmed daily delivery.";

  return (
    `${score.tier.replace(/_/g, " ")}: ${agePart}${obsPart}. ` +
    `Evidence confidence: ${(score.evidenceConfidence * 100).toFixed(0)}%. ` +
    `Coverage: ${score.coverageStatus.replace(/_/g, " ")}.` +
    disclaimer
  );
}
