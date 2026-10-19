import { WinningPotentialBreakdown, ScoreTier } from "@/types";

export interface ScoringInput {
  firstSeenAt: Date;
  lastSeenAt: Date;
  variantCount?: number;
  /** UNKNOWN means status is not verified — do NOT assume ACTIVE for scoring */
  status: "ACTIVE" | "INACTIVE" | "UNKNOWN";
  hasLandingPage: boolean;
  hasCallToAction: boolean;
  performanceSignals?: {
    likes?: number;
    impressionsRange?: string;
    hasGenuineMetrics: boolean;
  };
  /**
   * Only supply this when an AI provider has actually returned a score.
   * Do NOT pass 65 as a default when no analysis exists.
   */
  aiQualityScore?: number;
}

/**
 * V6.1 — Evidence-aware scoring formula.
 * Breaking changes from V2.0.0:
 *  - Performance score no longer uses active status as a fallback points source.
 *  - AI quality score has NO hardcoded default; missing = not scored.
 *  - Missing data is marked UNAVAILABLE in breakdown, not assigned zero.
 */
export const FORMULA_VERSION = "6.1.0";

/**
 * Normalizes a measured value to 0–100 against a benchmark.
 */
export function normalizeResearchSignal(
  value: number,
  maxBenchmark: number
): number {
  if (!isFinite(value) || value <= 0) return 0;
  return Math.min(100, Math.round((value / maxBenchmark) * 100));
}

/**
 * Evidence confidence reflects how much verifiable data backs the score.
 * Only MEASURED or VERIFIED items contribute weight.
 */
export function calculateEvidenceConfidence(input: ScoringInput): number {
  let availableWeight = 0;

  // Longevity signal is always present from timestamps (but low if same-day)
  const daysActive = Math.max(
    0,
    Math.round(
      (new Date(input.lastSeenAt).getTime() -
        new Date(input.firstSeenAt).getTime()) /
        (1000 * 60 * 60 * 24)
    )
  );
  if (daysActive >= 1) availableWeight += 25;

  // Verified active status
  if (input.status === "ACTIVE") availableWeight += 10;

  // Creative iterations evidence (confirmed count)
  if (typeof input.variantCount === "number" && input.variantCount > 1)
    availableWeight += 20;
  else if (typeof input.variantCount === "number" && input.variantCount === 1)
    availableWeight += 5; // minimum observed

  // Landing page / offer clarity
  if (input.hasLandingPage) availableWeight += 15;
  if (input.hasCallToAction) availableWeight += 10;

  // Genuine platform metrics add confidence
  if (input.performanceSignals?.hasGenuineMetrics) availableWeight += 15;

  // Real AI analysis adds confidence
  if (typeof input.aiQualityScore === "number") availableWeight += 5;

  return Math.min(100, availableWeight);
}

/**
 * Computes the evidence-aware Winning Potential Score (0–100).
 * Missing data is tracked — NOT assigned a convenient default.
 */
export function calculateWinningPotentialScore(
  input: ScoringInput
): WinningPotentialBreakdown {
  const now = new Date();
  const firstSeen = new Date(input.firstSeenAt);
  const lastSeen = new Date(input.lastSeenAt);

  const missingSignals: string[] = [];
  const unavailableComponents: string[] = [];

  // ── 1. Longevity (weight: 25%) ─────────────────────────────────────
  const daysActive = Math.max(
    0,
    Math.round(
      (lastSeen.getTime() - firstSeen.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1
  );
  const longevityScore = normalizeResearchSignal(daysActive, 90);

  // ── 2. Creative Diversity (weight: 20%) ────────────────────────────
  let diversityScore: number;
  let variantCount: number;
  if (typeof input.variantCount === "number" && input.variantCount > 0) {
    variantCount = input.variantCount;
    diversityScore = normalizeResearchSignal(variantCount, 10);
  } else {
    // We know at least 1 creative exists (the one being scored)
    variantCount = 1;
    diversityScore = normalizeResearchSignal(1, 10);
    missingSignals.push("CONFIRMED_VARIANT_COUNT");
  }

  // ── 3. Performance Signals (weight: 20%) ───────────────────────────
  let performanceScore: number;
  if (input.performanceSignals?.hasGenuineMetrics) {
    if (input.performanceSignals.likes) {
      performanceScore = normalizeResearchSignal(
        input.performanceSignals.likes,
        10000
      );
    } else {
      // Has genuine metrics flag but no specific value
      performanceScore = 50;
      missingSignals.push("SPECIFIC_ENGAGEMENT_COUNT");
    }
  } else {
    // No genuine metrics — performance is UNAVAILABLE, not estimated
    performanceScore = 0;
    missingSignals.push("GENUINE_ENGAGEMENT_METRICS");
    unavailableComponents.push("performance");
  }

  // ── 4. Active Recency (weight: 15%) ────────────────────────────────
  const lastSeenDaysAgo = Math.max(
    0,
    Math.round(
      (now.getTime() - lastSeen.getTime()) / (1000 * 60 * 60 * 24)
    )
  );
  let recencyScore = 10;
  if (lastSeenDaysAgo <= 1) recencyScore = 100;
  else if (lastSeenDaysAgo <= 7) recencyScore = 80;
  else if (lastSeenDaysAgo <= 14) recencyScore = 60;
  else if (lastSeenDaysAgo <= 30) recencyScore = 40;
  else if (lastSeenDaysAgo <= 60) recencyScore = 20;

  // If status is UNKNOWN, reduce recency confidence
  if (input.status === "UNKNOWN") {
    recencyScore = Math.round(recencyScore * 0.5);
    missingSignals.push("VERIFIED_ACTIVE_STATUS");
  }

  // ── 5. Product & Offer Clarity (weight: 10%) ───────────────────────
  let clarityScore = 20;
  if (input.hasLandingPage) clarityScore += 50;
  if (input.hasCallToAction) clarityScore += 30;
  clarityScore = Math.min(100, clarityScore);

  // ── 6. AI Creative Quality (weight: 10%) ───────────────────────────
  // No default — only use when a real analysis was performed.
  let aiScore: number | undefined = undefined;
  if (typeof input.aiQualityScore === "number") {
    aiScore = Math.min(100, Math.max(0, input.aiQualityScore));
  } else {
    missingSignals.push("AI_CREATIVE_ANALYSIS");
    unavailableComponents.push("aiQuality");
  }

  // ── Weighted Total ──────────────────────────────────────────────────
  // If performance is unavailable, redistribute its weight to longevity & recency
  const hasPerformance = !unavailableComponents.includes("performance");
  const hasAI = !unavailableComponents.includes("aiQuality");

  let totalScore: number;
  if (hasPerformance && hasAI) {
    totalScore = Math.round(
      longevityScore * 0.25 +
        diversityScore * 0.2 +
        performanceScore * 0.2 +
        recencyScore * 0.15 +
        clarityScore * 0.1 +
        aiScore! * 0.1
    );
  } else if (hasPerformance && !hasAI) {
    // AI missing: redistribute 10% to longevity
    totalScore = Math.round(
      longevityScore * 0.35 +
        diversityScore * 0.2 +
        performanceScore * 0.2 +
        recencyScore * 0.15 +
        clarityScore * 0.1
    );
  } else if (!hasPerformance && hasAI) {
    // Performance missing: redistribute 20% to longevity + recency
    totalScore = Math.round(
      longevityScore * 0.35 +
        diversityScore * 0.2 +
        recencyScore * 0.25 +
        clarityScore * 0.1 +
        aiScore! * 0.1
    );
  } else {
    // Both missing
    totalScore = Math.round(
      longevityScore * 0.4 +
        diversityScore * 0.25 +
        recencyScore * 0.25 +
        clarityScore * 0.1
    );
  }

  const confidenceScore = calculateEvidenceConfidence(input);

  // ── Tier Assignment ─────────────────────────────────────────────────
  let tier: ScoreTier = "LOW_POTENTIAL";
  if (confidenceScore < 30) {
    tier = "INSUFFICIENT_EVIDENCE";
  } else if (totalScore >= 70 && confidenceScore >= 50) {
    tier = "HIGH_POTENTIAL";
  } else if (totalScore >= 45) {
    tier = "MEDIUM_POTENTIAL";
  }

  return {
    totalScore,
    tier,
    confidenceScore,
    components: {
      longevity: { score: longevityScore, weight: 0.25, daysActive },
      diversity: { score: diversityScore, weight: 0.2, variantCount },
      performance: {
        score: hasPerformance ? performanceScore : 0,
        weight: 0.2,
        status: input.status,
      },
      recency: { score: recencyScore, weight: 0.15, lastSeenDaysAgo },
      clarity: { score: clarityScore, weight: 0.1, hasOffer: input.hasLandingPage },
      aiQuality: { score: aiScore ?? 0, weight: 0.1 },
    },
    missingSignals,
    formulaVersion: FORMULA_VERSION,
  };
}
