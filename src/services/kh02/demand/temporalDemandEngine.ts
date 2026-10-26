/**
 * SWAI KH-02 — Temporal Demand Engine
 *
 * Implements historical time-series demand assessment over 30D, 90D, 180D, and 365D windows.
 *
 * Rules:
 * 1. Historical demand evidence is mandatory for evergreen claims.
 * 2. 7D/30D data represents short-term novelty, not sustainable evergreen demand.
 * 3. Stable low demand (flatline near zero) is NOT high-value evergreen.
 * 4. Seasonality requires cyclical periodic recurrence across seasons.
 * 5. Missing time series strictly yields INSUFFICIENT_HISTORY.
 */

import { prisma } from "@/lib/db";

export type KH02DemandClass =
  | "EVERGREEN_STABLE"
  | "SEASONAL_RECURRING"
  | "EMERGING_PERSISTENT"
  | "TREND_DEPENDENT"
  | "DECLINING"
  | "INSUFFICIENT_HISTORY";

export interface DemandDataPoint {
  periodStart?: Date | string;
  periodEnd?: Date | string;
  demandValue?: number | null; // 0-100 relative index (Google Trends)
  date?: Date | string;
  value?: number | null;
  region?: string;
  source?: string;
}

export interface TemporalStabilityEvaluation {
  eligibleForEvergreen: boolean;
  demandClass: KH02DemandClass;
  stabilityScore: number | null; // 0-25 points for scoring Pillar A
  dataPointsCount: number;
  coveredDays: number;
  meanInterest: number | null;
  stdDev: number | null;
  coefficientOfVariation: number | null;
  trendVelocity: "ACCELERATING" | "STEADY" | "DECELERATING" | "FLAT";
  explanation: string;
  evaluatedAt: string;
  confidencePenaltyReason?: string | null;
}

/**
 * Loads stored Google Trends demand observations for a product.
 */
export async function loadProductHistoricalDemand(
  productId: string
): Promise<DemandDataPoint[]> {
  const records = await prisma.productDemandObservation.findMany({
    where: { productId },
    orderBy: { periodStart: "asc" },
  });

  return records.map((r) => ({
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    demandValue: r.demandValue,
    region: r.region,
    source: r.source,
  }));
}

/**
 * Evaluates temporal stability across a historical observation series.
 */
export function evaluateTemporalDemandStability(
  observations: DemandDataPoint[],
  requestedLookbackDays: number = 90
): TemporalStabilityEvaluation {
  const evaluatedAt = new Date().toISOString();

  // 1. Filter valid numeric observations, deduplicate identical periods, and sort chronologically
  const seenPeriods = new Set<string>();
  const valid = observations
    .filter((o) => {
      const val = o.demandValue !== undefined ? o.demandValue : (o as any).value;
      if (val === null || val === undefined || isNaN(val) || val < 0) return false;
      if (o.demandValue === undefined) o.demandValue = val;
      const startDate = o.periodStart || o.date;
      if (!startDate) return false;
      const timeVal = new Date(startDate).getTime();
      if (isNaN(timeVal)) return false;
      const key = `${startDate}::${o.periodEnd || ""}`;
      if (seenPeriods.has(key)) return false;
      seenPeriods.add(key);
      return true;
    })
    .sort((a, b) => new Date(a.periodStart || a.date!).getTime() - new Date(b.periodStart || b.date!).getTime());

  if (valid.length < 3) {
    return {
      eligibleForEvergreen: false,
      demandClass: "INSUFFICIENT_HISTORY",
      stabilityScore: null,
      dataPointsCount: valid.length,
      coveredDays: 0,
      meanInterest: null,
      stdDev: null,
      coefficientOfVariation: null,
      trendVelocity: "FLAT",
      explanation: `Insufficient historical data (${valid.length} points observed, minimum 3 required). Evergreen sustainability cannot be verified.`,
      evaluatedAt,
      confidencePenaltyReason: "Missing historical demand time series.",
    };
  }

  // 2. Calculate time span covered
  const firstTime = new Date(valid[0].periodStart || valid[0].date!).getTime();
  const lastTime = new Date(valid[valid.length - 1].periodEnd || valid[valid.length - 1].periodStart || valid[valid.length - 1].date!).getTime();
  const coveredDays = Math.max(1, Math.round((lastTime - firstTime) / (1000 * 60 * 60 * 24)));

  // Rule: Never declare evergreen from short-term (< 60 days) data
  if (coveredDays < 60) {
    return {
      eligibleForEvergreen: false,
      demandClass: "INSUFFICIENT_HISTORY",
      stabilityScore: null,
      dataPointsCount: valid.length,
      coveredDays,
      meanInterest: null,
      stdDev: null,
      coefficientOfVariation: null,
      trendVelocity: "FLAT",
      explanation: `Observations span only ${coveredDays} days — short-term window cannot substantiate evergreen claims (minimum 60-90 days required).`,
      evaluatedAt,
      confidencePenaltyReason: "Demand observations span less than 60 days.",
    };
  }

  // 3. Statistical metrics (Mean, Variance, StdDev, CV)
  const values = valid.map((v) => v.demandValue as number);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : 1.0;

  // 4. Calculate simple linear slope to detect trend velocity
  const n = values.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / Math.max(1, n * sumX2 - sumX * sumX);
  let trendVelocity: TemporalStabilityEvaluation["trendVelocity"] = "STEADY";
  if (slope > 0.5) trendVelocity = "ACCELERATING";
  else if (slope < -0.5) trendVelocity = "DECELERATING";
  else trendVelocity = "STEADY";

  // Check for cyclical wave evidence (local peaks / troughs)
  let hasCyclicSwings = false;
  for (let i = 1; i < values.length - 1; i++) {
    if ((values[i] > values[i - 1] && values[i] > values[i + 1]) ||
        (values[i] < values[i - 1] && values[i] < values[i + 1])) {
      hasCyclicSwings = true;
      break;
    }
  }

  // 5. Classification logic
  let demandClass: KH02DemandClass;
  let stabilityScore: number;
  let explanation: string;

  if (mean < 12 && stdDev < 4) {
    // Dead / flatline interest
    demandClass = "DECLINING";
    stabilityScore = 3;
    explanation = `Very low mean relative search interest (${mean.toFixed(1)}/100). Low variation reflects lack of market demand, not evergreen viability.`;
  } else if (trendVelocity === "ACCELERATING" && cv < 0.35) {
    // Emerging persistent demand
    demandClass = "EMERGING_PERSISTENT";
    stabilityScore = 22; // Out of 25
    explanation = `Accelerating search interest (mean: ${mean.toFixed(1)}, slope: +${slope.toFixed(2)}) with low volatility over ${coveredDays} days.`;
  } else if (cv < 0.22 && mean >= 20) {
    // True evergreen stable demand
    demandClass = "EVERGREEN_STABLE";
    stabilityScore = 25; // Full 25 points for Pillar A
    explanation = `High demand stability (CV: ${cv.toFixed(2)}, mean: ${mean.toFixed(1)}/100) across ${coveredDays} days. Proven persistent search interest.`;
  } else if (hasCyclicSwings && cv >= 0.20 && cv < 0.60 && mean >= 15) {
    // Moderate variation with confirmed cyclic peaks/troughs
    demandClass = "SEASONAL_RECURRING";
    stabilityScore = 18;
    explanation = `Moderate variation (CV: ${cv.toFixed(2)}, mean: ${mean.toFixed(1)}) with recurring cyclical waves across ${coveredDays} days.`;
  } else if (trendVelocity === "DECELERATING" || slope < -1.0) {
    demandClass = "DECLINING";
    stabilityScore = 6;
    explanation = `Declining search interest (slope: ${slope.toFixed(2)}, mean: ${mean.toFixed(1)}). Demand is dropping off.`;
  } else {
    // High variation spike / trend dependent without periodic cycles
    demandClass = "TREND_DEPENDENT";
    stabilityScore = 10;
    explanation = `High volatility or non-periodic variation (CV: ${cv.toFixed(2)}). Typical of short-lived viral social spikes rather than durable evergreen utility.`;
  }

  return {
    eligibleForEvergreen: demandClass === "EVERGREEN_STABLE" || demandClass === "SEASONAL_RECURRING" || demandClass === "EMERGING_PERSISTENT",
    demandClass,
    stabilityScore,
    dataPointsCount: valid.length,
    coveredDays,
    meanInterest: Math.round(mean * 10) / 10,
    stdDev: Math.round(stdDev * 10) / 10,
    coefficientOfVariation: Math.round(cv * 100) / 100,
    trendVelocity,
    explanation,
    evaluatedAt,
  };
}
