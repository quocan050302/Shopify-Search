import { WinningPotentialBreakdown, ScoreTier } from "@/types";

export interface ScoringInput {
  firstSeenAt: Date;
  lastSeenAt: Date;
  variantCount?: number;
  status: "ACTIVE" | "INACTIVE" | "UNKNOWN";
  hasLandingPage: boolean;
  hasCallToAction: boolean;
  performanceSignals?: {
    likes?: number;
    impressionsRange?: string;
    hasGenuineMetrics: boolean;
  };
  aiQualityScore?: number;
}

export const FORMULA_VERSION = "2.0.0";

/**
 * Normalizes an arbitrary metric into a 0-100 bounded scale.
 */
export function normalizeResearchSignal(
  value: number,
  maxBenchmark: number
): number {
  if (isNaN(value) || value <= 0) return 0;
  return Math.min(100, Math.round((value / maxBenchmark) * 100));
}

/**
 * Calculates evidence confidence based on availability of observational data.
 */
export function calculateEvidenceConfidence(input: ScoringInput): number {
  let availableWeight = 0;
  const totalWeight = 100;

  // Longevity signal is always present from timestamps
  availableWeight += 30;

  // Active status evidence
  if (input.status === "ACTIVE") availableWeight += 15;

  // Creative iterations evidence
  if (typeof input.variantCount === "number" && input.variantCount > 0) availableWeight += 20;

  // Landing page / offer clarity
  if (input.hasLandingPage) availableWeight += 15;

  // Genuine platform metrics
  if (input.performanceSignals?.hasGenuineMetrics) availableWeight += 10;

  // AI analysis presence
  if (typeof input.aiQualityScore === "number") availableWeight += 10;

  return Math.min(100, availableWeight);
}

/**
 * Computes the transparent Winning Potential Score (0-100).
 */
export function calculateWinningPotentialScore(
  input: ScoringInput
): WinningPotentialBreakdown {
  const now = new Date();
  const firstSeen = new Date(input.firstSeenAt);
  const lastSeen = new Date(input.lastSeenAt);

  // 1. Longevity (weight: 25%)
  const daysActive = Math.max(
    1,
    Math.round((lastSeen.getTime() - firstSeen.getTime()) / (1000 * 60 * 60 * 24)) + 1
  );
  const longevityScore = normalizeResearchSignal(daysActive, 90);

  // 2. Creative Diversity / Variants (weight: 20%)
  const variantCount = input.variantCount || 1;
  const diversityScore = normalizeResearchSignal(variantCount, 10);

  // 3. Performance Signals (weight: 20%)
  let performanceScore = 50; // Neutral baseline for observed active ads
  const missingSignals: string[] = [];

  if (input.performanceSignals?.hasGenuineMetrics) {
    if (input.performanceSignals.likes) {
      performanceScore = normalizeResearchSignal(input.performanceSignals.likes, 10000);
    } else {
      performanceScore = 70;
    }
  } else {
    missingSignals.push("GENUINE_ENGAGEMENT_METRICS");
    // If ad is actively running, grant 60 pts; if inactive, 30 pts
    performanceScore = input.status === "ACTIVE" ? 60 : 30;
  }

  // 4. Active Recency (weight: 15%)
  const lastSeenDaysAgo = Math.max(
    0,
    Math.round((now.getTime() - lastSeen.getTime()) / (1000 * 60 * 60 * 24))
  );
  let recencyScore = 20;
  if (lastSeenDaysAgo <= 2) recencyScore = 100;
  else if (lastSeenDaysAgo <= 7) recencyScore = 80;
  else if (lastSeenDaysAgo <= 30) recencyScore = 50;

  // 5. Product & Offer Clarity (weight: 10%)
  let clarityScore = 40;
  if (input.hasLandingPage) clarityScore += 35;
  if (input.hasCallToAction) clarityScore += 25;

  // 6. AI Creative Quality (weight: 10%)
  const aiScore = typeof input.aiQualityScore === "number" ? input.aiQualityScore : 65;
  if (typeof input.aiQualityScore !== "number") {
    missingSignals.push("AI_CREATIVE_DEEP_INSPECTION");
  }

  // Total weighted score
  const totalScore = Math.round(
    longevityScore * 0.25 +
    diversityScore * 0.20 +
    performanceScore * 0.20 +
    recencyScore * 0.15 +
    clarityScore * 0.10 +
    aiScore * 0.10
  );

  const confidenceScore = calculateEvidenceConfidence(input);

  // Determine Priority Tier
  let tier: ScoreTier = "LOW_POTENTIAL";
  if (confidenceScore < 40) {
    tier = "INSUFFICIENT_EVIDENCE";
  } else if (totalScore >= 75) {
    tier = "HIGH_POTENTIAL";
  } else if (totalScore >= 50) {
    tier = "MEDIUM_POTENTIAL";
  }

  return {
    totalScore,
    tier,
    confidenceScore,
    components: {
      longevity: { score: longevityScore, weight: 0.25, daysActive },
      diversity: { score: diversityScore, weight: 0.20, variantCount },
      performance: { score: performanceScore, weight: 0.20, status: input.status },
      recency: { score: recencyScore, weight: 0.15, lastSeenDaysAgo },
      clarity: { score: clarityScore, weight: 0.10, hasOffer: input.hasLandingPage },
      aiQuality: { score: aiScore, weight: 0.10 },
    },
    missingSignals,
    formulaVersion: FORMULA_VERSION,
  };
}
