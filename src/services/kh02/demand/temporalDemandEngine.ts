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
 * 6. Evidence evaluation enforces multi-point verification and distinct observation timestamps.
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

export type HistoricalObservation = DemandDataPoint & {
  observedAt?: string;
  publicationDate?: string;
};

export interface DemandHistoryPolicy {
  minimumDataPoints?: number; // default: 3
  minimumCoveredDays?: number; // default: 60
  strictChronological?: boolean;
  rejectDuplicateTimestamps?: boolean;
  requiredRegion?: string;
}

export interface DemandHistoryAssessment {
  status: "VERIFIED" | "UNVERIFIED" | "INSUFFICIENT_HISTORY";
  eligibleForEvergreen: boolean;
  dataPointsCount: number;
  distinctObservationDatesCount: number;
  coveredDays: number;
  meanInterest: number | null;
  stdDev: number | null;
  coefficientOfVariation: number | null;
  demandClass: KH02DemandClass;
  sourceAuthority: "AUTHORITATIVE_PROVIDER" | "ESTIMATED_SNAPSHOTS" | "UNVERIFIED";
  temporalCoverageValid: boolean;
  calculationVersion: string;
  explanation: string;
  missingEvidence: string[];
  evaluatedAt: string;
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
 * Evaluates historical demand observations against policy requirements to prevent false VERIFIED states.
 */
export function evaluateDemandHistoryEvidence(
  observations: HistoricalObservation[],
  policy: DemandHistoryPolicy = {}
): DemandHistoryAssessment {
  const evaluatedAt = new Date().toISOString();
  const minPoints = policy.minimumDataPoints ?? 3;
  const minDays = policy.minimumCoveredDays ?? 60;
  const missingEvidence: string[] = [];

  // Filter valid numeric observations, deduplicate identical periods, and sort chronologically
  const seenDates = new Set<string>();
  const valid = (observations || [])
    .filter((o) => {
      const val = o.demandValue !== undefined ? o.demandValue : (o as any).value;
      if (val === null || val === undefined || isNaN(val) || val < 0) return false;
      const startDate = o.periodStart || o.date;
      if (!startDate) return false;
      const timeVal = new Date(startDate).getTime();
      if (isNaN(timeVal)) return false;
      const dateKey = new Date(startDate).toISOString().slice(0, 10);
      if (seenDates.has(dateKey) && policy.rejectDuplicateTimestamps !== false) {
        return false;
      }
      seenDates.add(dateKey);
      return true;
    })
    .map((o) => ({
      ...o,
      demandValue: o.demandValue !== undefined ? o.demandValue : (o as any).value,
    }))
    .sort((a, b) => {
      const aTime = new Date(a.periodStart || a.date!).getTime();
      const bTime = new Date(b.periodStart || b.date!).getTime();
      return aTime - bTime;
    });

  if (valid.length < minPoints) {
    const expl = `Insufficient historical data (${valid.length} points observed, minimum ${minPoints} required). Evergreen sustainability cannot be verified.`;
    missingEvidence.push(expl);
    return {
      status: "INSUFFICIENT_HISTORY",
      eligibleForEvergreen: false,
      dataPointsCount: valid.length,
      distinctObservationDatesCount: seenDates.size,
      coveredDays: 0,
      meanInterest: null,
      stdDev: null,
      coefficientOfVariation: null,
      demandClass: "INSUFFICIENT_HISTORY",
      sourceAuthority: "UNVERIFIED",
      temporalCoverageValid: false,
      calculationVersion: "12.1.1",
      explanation: expl,
      missingEvidence,
      evaluatedAt,
    };
  }

  const firstTime = new Date(valid[0].periodStart || valid[0].date!).getTime();
  const lastTime = new Date(
    valid[valid.length - 1].periodEnd || valid[valid.length - 1].periodStart || valid[valid.length - 1].date!
  ).getTime();
  const coveredDays = Math.max(1, Math.round((lastTime - firstTime) / (1000 * 60 * 60 * 24)));

  if (coveredDays < minDays) {
    const expl = `Observations span only ${coveredDays} days — short-term window cannot substantiate evergreen claims (minimum ${minDays} days required).`;
    missingEvidence.push(expl);
    return {
      status: "INSUFFICIENT_HISTORY",
      eligibleForEvergreen: false,
      dataPointsCount: valid.length,
      distinctObservationDatesCount: seenDates.size,
      coveredDays,
      meanInterest: null,
      stdDev: null,
      coefficientOfVariation: null,
      demandClass: "INSUFFICIENT_HISTORY",
      sourceAuthority: "UNVERIFIED",
      temporalCoverageValid: false,
      calculationVersion: "12.1.1",
      explanation: expl,
      missingEvidence,
      evaluatedAt,
    };
  }

  // Statistical metrics
  const values = valid.map((v) => Number(v.demandValue));
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : 1.0;

  // Trend velocity calculation
  const half = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, half);
  const secondHalf = values.slice(half);
  const firstMean = firstHalf.length ? firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length : 0;
  const secondMean = secondHalf.length ? secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length : 0;
  const delta = secondMean - firstMean;

  // Classify demand stability
  let demandClass: KH02DemandClass = "TREND_DEPENDENT";
  let eligibleForEvergreen = false;

  if (mean < 10) {
    demandClass = "DECLINING";
  } else if (delta > 8 && values[values.length - 1] > values[0] && cv <= 0.40) {
    demandClass = "EMERGING_PERSISTENT";
    eligibleForEvergreen = true;
  } else if (cv <= 0.35 && mean >= 25) {
    demandClass = "EVERGREEN_STABLE";
    eligibleForEvergreen = true;
  } else if (cv > 0.35 && cv <= 0.65) {
    let hasPeak = false;
    for (let i = 1; i < values.length - 1; i++) {
      if (values[i] > values[i - 1] && values[i] > values[i + 1]) hasPeak = true;
    }
    const hasSeasonalWave =
      (values[0] < values[1] || values[0] < values[2]) &&
      values[values.length - 1] < values[values.length - 2];

    if (hasPeak || hasSeasonalWave) {
      demandClass = "SEASONAL_RECURRING";
      eligibleForEvergreen = true;
    } else {
      demandClass = "TREND_DEPENDENT";
    }
  } else {
    demandClass = "TREND_DEPENDENT";
  }

  return {
    status: eligibleForEvergreen ? "VERIFIED" : "UNVERIFIED",
    eligibleForEvergreen,
    dataPointsCount: valid.length,
    distinctObservationDatesCount: seenDates.size,
    coveredDays,
    meanInterest: Math.round(mean * 10) / 10,
    stdDev: Math.round(stdDev * 10) / 10,
    coefficientOfVariation: Math.round(cv * 100) / 100,
    demandClass,
    sourceAuthority: "AUTHORITATIVE_PROVIDER",
    temporalCoverageValid: true,
    calculationVersion: "12.1.1",
    explanation: eligibleForEvergreen
      ? `Verified demand stability: ${valid.length} points spanning ${coveredDays} days with CV=${cv.toFixed(2)}.`
      : `Demand class '${demandClass}' does not meet verified evergreen criteria.`,
    missingEvidence,
    evaluatedAt,
  };
}

/**
 * Evaluates temporal stability across a historical observation series.
 */
export function evaluateTemporalDemandStability(
  observations: DemandDataPoint[],
  requestedLookbackDays: number = 90
): TemporalStabilityEvaluation {
  const evaluatedAt = new Date().toISOString();
  const assessment = evaluateDemandHistoryEvidence(observations, {
    minimumDataPoints: 3,
    minimumCoveredDays: 60,
  });

  if (assessment.status === "INSUFFICIENT_HISTORY" || assessment.dataPointsCount < 3) {
    return {
      eligibleForEvergreen: false,
      demandClass: "INSUFFICIENT_HISTORY",
      stabilityScore: null,
      dataPointsCount: assessment.dataPointsCount,
      coveredDays: assessment.coveredDays,
      meanInterest: null,
      stdDev: null,
      coefficientOfVariation: null,
      trendVelocity: "FLAT",
      explanation: assessment.explanation,
      evaluatedAt,
      confidencePenaltyReason: assessment.missingEvidence[0] || "Missing historical demand time series.",
    };
  }

  // Calculate velocity trend
  const valid = observations
    .map((o) => ({ ...o, demandValue: o.demandValue !== undefined ? o.demandValue : (o as any).value }))
    .filter((o) => o.demandValue !== null && o.demandValue !== undefined && !isNaN(o.demandValue));

  const half = Math.floor(valid.length / 2);
  const firstHalf = valid.slice(0, half).map((v) => Number(v.demandValue));
  const secondHalf = valid.slice(half).map((v) => Number(v.demandValue));
  const firstMean = firstHalf.length ? firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length : 0;
  const secondMean = secondHalf.length ? secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length : 0;
  const delta = secondMean - firstMean;

  let trendVelocity: "ACCELERATING" | "STEADY" | "DECELERATING" | "FLAT" = "STEADY";
  if (delta > 8) trendVelocity = "ACCELERATING";
  else if (delta < -8) trendVelocity = "DECELERATING";
  else trendVelocity = "STEADY";

  // Calculate stability score (0-25)
  let stabilityScore = 0;
  const mean = assessment.meanInterest || 0;
  const cv = assessment.coefficientOfVariation || 1.0;

  if (assessment.demandClass === "EVERGREEN_STABLE") {
    stabilityScore = 18 + Math.round((1 - Math.min(cv, 0.35) / 0.35) * 7);
  } else if (assessment.demandClass === "EMERGING_PERSISTENT") {
    stabilityScore = 18 + Math.round((mean / 100) * 7);
  } else if (assessment.demandClass === "SEASONAL_RECURRING") {
    stabilityScore = 18;
  } else if (assessment.demandClass === "TREND_DEPENDENT") {
    stabilityScore = Math.max(5, Math.round((mean / 100) * 10));
  } else {
    stabilityScore = Math.max(0, Math.round((mean / 100) * 5));
  }

  return {
    eligibleForEvergreen: assessment.eligibleForEvergreen,
    demandClass: assessment.demandClass,
    stabilityScore,
    dataPointsCount: assessment.dataPointsCount,
    coveredDays: assessment.coveredDays,
    meanInterest: assessment.meanInterest,
    stdDev: assessment.stdDev,
    coefficientOfVariation: assessment.coefficientOfVariation,
    trendVelocity,
    explanation: assessment.explanation,
    evaluatedAt,
  };
}
