/**
 * Longevity Engine — SWAI V7.0
 *
 * Calculates verifiable ad age, observation coverage, and longevity
 * classification based strictly on available evidence.
 *
 * IMPORTANT DESIGN PRINCIPLES:
 * - Never assumes continuous activity between sparse observations.
 * - Two observations 90 days apart do NOT prove 90 days of continuous delivery.
 * - Provider-reported dates are labelled as source-reported, not verified.
 * - Missing data remains MISSING — never substituted with defaults.
 */

export const LONGEVITY_ENGINE_VERSION = "7.0.0";

// ─── Longevity Categories ────────────────────────────────────────────────────

export type LongevityCategory =
  | "NEW_TESTING"          // 0–13 days
  | "EARLY_POTENTIAL"      // 14–29 days
  | "PROMISING"            // 30–59 days
  | "STRONG_CANDIDATE"     // 60–89 days
  | "EVERGREEN_CANDIDATE"  // 90–179 days
  | "LONG_TERM_REFERENCE"  // 180+ days
  | "UNKNOWN";             // No usable date evidence

// ─── Coverage Status ─────────────────────────────────────────────────────────

export type CoverageStatus =
  | "HIGH_COVERAGE"          // Dense observation history (many observations over a long period)
  | "MODERATE_COVERAGE"      // Multiple observations but gaps exist
  | "SPARSE_COVERAGE"        // Few observations relative to age
  | "SINGLE_OBSERVATION"     // Only one observation recorded
  | "INSUFFICIENT_EVIDENCE"; // No usable observation data

// ─── Observation Status ──────────────────────────────────────────────────────

export type ObservationStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "UNKNOWN"
  | "CHECK_FAILED"
  | "ACCESS_RESTRICTED";

// ─── Lifecycle Status ────────────────────────────────────────────────────────

export type LifecycleStatus =
  | "UNKNOWN"
  | "ACTIVE_VERIFIED"
  | "INACTIVE_VERIFIED"
  | "NOT_OBSERVED_RECENTLY"
  | "SOURCE_UNAVAILABLE"
  | "ARCHIVED"
  | "SYNTHETIC_QUARANTINED";

// ─── Input Types ─────────────────────────────────────────────────────────────

export interface LongevityInput {
  adId: string;
  platform: string;
  // Provider-reported dates (sourced from the ad platform, not verified by SWAI)
  sourceReportedStartAt?: Date | null;
  sourceReportedEndAt?: Date | null;
  // SWAI observation history
  observations: Array<{
    observedAt: Date;
    observationStatus: ObservationStatus;
    confidence?: number | null;
  }>;
  // Current state
  lifecycleStatus?: LifecycleStatus | string;
  isSyntheticQuarantine?: boolean;
  // Reference time (defaults to now)
  referenceDate?: Date;
}

// ─── Output Types ────────────────────────────────────────────────────────────

export interface LongevityResult {
  adId: string;
  // Calendar age in days
  calendarAgeDays: number | null;
  ageEvidenceSource: "SOURCE_REPORTED" | "FIRST_OBSERVATION" | "NONE";
  ageNote: string;
  // Observations
  totalObservationCount: number;
  verifiedActiveObservationCount: number;
  observedActiveDays: number | null;
  // Coverage: span of days covered by observations (NOT assumed continuous)
  observationCoverageDays: number | null;
  observationSpanStart: Date | null;
  observationSpanEnd: Date | null;
  // Gaps
  unobservedGapDays: number | null;
  largestGapDays: number | null;
  // Classification
  longevityCategory: LongevityCategory;
  coverageStatus: CoverageStatus;
  // Confidence
  continuityConfidence: number; // 0–1: confidence in continuous activity
  evidenceQuality: "HIGH" | "MODERATE" | "LOW" | "NONE";
  // Human-readable
  explanation: string;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface LongevityCategoryConfig {
  newTesting: number;      // < this → NEW_TESTING
  earlyPotential: number;  // < this → EARLY_POTENTIAL
  promising: number;       // < this → PROMISING
  strongCandidate: number; // < this → STRONG_CANDIDATE
  evergreenCandidate: number; // < this → EVERGREEN_CANDIDATE
  // 180+ → LONG_TERM_REFERENCE
}

export const DEFAULT_CATEGORY_CONFIG: LongevityCategoryConfig = {
  newTesting: 14,
  earlyPotential: 30,
  promising: 60,
  strongCandidate: 90,
  evergreenCandidate: 180,
};

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Classifies longevity category from age in days.
 * Returns UNKNOWN if ageDays is null.
 */
export function classifyLongevityCategory(
  ageDays: number | null,
  config: LongevityCategoryConfig = DEFAULT_CATEGORY_CONFIG
): LongevityCategory {
  if (ageDays === null || ageDays < 0) return "UNKNOWN";
  if (ageDays < config.newTesting) return "NEW_TESTING";
  if (ageDays < config.earlyPotential) return "EARLY_POTENTIAL";
  if (ageDays < config.promising) return "PROMISING";
  if (ageDays < config.strongCandidate) return "STRONG_CANDIDATE";
  if (ageDays < config.evergreenCandidate) return "EVERGREEN_CANDIDATE";
  return "LONG_TERM_REFERENCE";
}

/**
 * Computes coverage status from observation history.
 */
export function classifyCoverageStatus(
  observationCount: number,
  observationCoverageDays: number | null,
  verifiedActiveCount: number
): CoverageStatus {
  if (observationCount === 0) return "INSUFFICIENT_EVIDENCE";
  if (observationCount === 1) return "SINGLE_OBSERVATION";

  const coverage = observationCoverageDays ?? 0;
  const density = coverage > 0 ? observationCount / (coverage / 30) : 0; // obs per 30 days

  if (density >= 10 && coverage >= 60) return "HIGH_COVERAGE";
  if (density >= 3 || (observationCount >= 3 && coverage >= 30)) return "MODERATE_COVERAGE";
  return "SPARSE_COVERAGE";
}

/**
 * Calculates days between two dates (inclusive start).
 */
function daysBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Main longevity calculation function.
 *
 * CRITICAL: Does NOT assume continuous activity between observations.
 * CRITICAL: Does NOT assume a provider-reported start date means the ad ran every day.
 */
export function calculateAdLongevity(input: LongevityInput): LongevityResult {
  const now = input.referenceDate ?? new Date();

  // Guard: synthetic quarantine records have no valid longevity
  if (input.isSyntheticQuarantine) {
    return {
      adId: input.adId,
      calendarAgeDays: null,
      ageEvidenceSource: "NONE",
      ageNote: "Record is synthetic/quarantined — no longevity evidence.",
      totalObservationCount: 0,
      verifiedActiveObservationCount: 0,
      observedActiveDays: null,
      observationCoverageDays: null,
      observationSpanStart: null,
      observationSpanEnd: null,
      unobservedGapDays: null,
      largestGapDays: null,
      longevityCategory: "UNKNOWN",
      coverageStatus: "INSUFFICIENT_EVIDENCE",
      continuityConfidence: 0,
      evidenceQuality: "NONE",
      explanation: "Synthetic quarantine record. Age and observation data cannot be evaluated.",
    };
  }

  // ── Calendar age ──────────────────────────────────────────────────────────
  let calendarAgeDays: number | null = null;
  let ageEvidenceSource: LongevityResult["ageEvidenceSource"] = "NONE";
  let ageNote = "";

  if (input.sourceReportedStartAt) {
    const start = new Date(input.sourceReportedStartAt);
    if (start <= now) {
      calendarAgeDays = daysBetween(start, now);
      ageEvidenceSource = "SOURCE_REPORTED";
      ageNote = `Provider reported start: ${start.toISOString().split("T")[0]}. Not independently verified by SWAI.`;
    } else {
      ageNote = "Source-reported start date is in the future — ignored.";
    }
  }

  // ── Observations ──────────────────────────────────────────────────────────
  const validObservations = (input.observations ?? []).filter(
    (o) => o.observedAt && new Date(o.observedAt) <= now
  );

  const sortedObs = [...validObservations].sort(
    (a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime()
  );

  const totalObservationCount = sortedObs.length;
  const verifiedActiveObservationCount = sortedObs.filter(
    (o) => o.observationStatus === "ACTIVE"
  ).length;

  // First observation date can serve as age anchor if no source-reported date
  if (!calendarAgeDays && sortedObs.length > 0) {
    const firstObs = new Date(sortedObs[0].observedAt);
    calendarAgeDays = daysBetween(firstObs, now);
    ageEvidenceSource = "FIRST_OBSERVATION";
    ageNote = `No provider-reported start date. Age estimated from first SWAI observation on ${firstObs.toISOString().split("T")[0]}.`;
  }

  // Observation coverage span
  let observationSpanStart: Date | null = null;
  let observationSpanEnd: Date | null = null;
  let observationCoverageDays: number | null = null;
  let largestGapDays: number | null = null;
  let unobservedGapDays: number | null = null;

  if (sortedObs.length >= 2) {
    observationSpanStart = new Date(sortedObs[0].observedAt);
    observationSpanEnd = new Date(sortedObs[sortedObs.length - 1].observedAt);
    observationCoverageDays = daysBetween(observationSpanStart, observationSpanEnd);

    // Find largest gap between consecutive observations
    let maxGap = 0;
    for (let i = 1; i < sortedObs.length; i++) {
      const gap = daysBetween(
        new Date(sortedObs[i - 1].observedAt),
        new Date(sortedObs[i].observedAt)
      );
      if (gap > maxGap) maxGap = gap;
    }
    largestGapDays = maxGap;
    // Unobserved gap: difference between coverage span and number of distinct days with observations
    const distinctDays = new Set(
      sortedObs.map((o) => new Date(o.observedAt).toISOString().split("T")[0])
    ).size;
    unobservedGapDays = Math.max(0, observationCoverageDays - distinctDays);
  } else if (sortedObs.length === 1) {
    observationSpanStart = new Date(sortedObs[0].observedAt);
    observationSpanEnd = observationSpanStart;
    observationCoverageDays = 0;
  }

  // Observed active days: count distinct days where status === ACTIVE
  const activeDates = new Set(
    sortedObs
      .filter((o) => o.observationStatus === "ACTIVE")
      .map((o) => new Date(o.observedAt).toISOString().split("T")[0])
  );
  const observedActiveDays = activeDates.size > 0 ? activeDates.size : null;

  // ── Classifications ───────────────────────────────────────────────────────
  const longevityCategory = classifyLongevityCategory(calendarAgeDays);
  const coverageStatus = classifyCoverageStatus(
    totalObservationCount,
    observationCoverageDays,
    verifiedActiveObservationCount
  );

  // ── Continuity Confidence ─────────────────────────────────────────────────
  // Scale: 0 = no evidence, 1 = dense, verified observations with no gaps
  let continuityConfidence = 0;

  if (totalObservationCount >= 1 && ageEvidenceSource !== "NONE") {
    // Base: having any evidence at all
    continuityConfidence = 0.1;
    // Coverage density
    if (coverageStatus === "HIGH_COVERAGE") continuityConfidence += 0.5;
    else if (coverageStatus === "MODERATE_COVERAGE") continuityConfidence += 0.3;
    else if (coverageStatus === "SPARSE_COVERAGE") continuityConfidence += 0.1;
    // Source reliability
    if (ageEvidenceSource === "SOURCE_REPORTED") continuityConfidence += 0.1;
    // Verified active observations
    if (verifiedActiveObservationCount >= 3) continuityConfidence += 0.2;
    else if (verifiedActiveObservationCount >= 1) continuityConfidence += 0.1;
    // Gap penalty
    if (largestGapDays !== null && largestGapDays > 30) continuityConfidence -= 0.2;
    if (largestGapDays !== null && largestGapDays > 90) continuityConfidence -= 0.2;
  }
  continuityConfidence = Math.max(0, Math.min(1, continuityConfidence));

  // ── Evidence Quality ──────────────────────────────────────────────────────
  let evidenceQuality: LongevityResult["evidenceQuality"] = "NONE";
  if (
    totalObservationCount >= 5 &&
    coverageStatus === "HIGH_COVERAGE" &&
    ageEvidenceSource === "SOURCE_REPORTED"
  ) {
    evidenceQuality = "HIGH";
  } else if (totalObservationCount >= 2 || ageEvidenceSource === "SOURCE_REPORTED") {
    evidenceQuality = totalObservationCount >= 3 ? "MODERATE" : "LOW";
  } else if (totalObservationCount === 1) {
    evidenceQuality = "LOW";
  }

  // ── Explanation ───────────────────────────────────────────────────────────
  const agePart =
    calendarAgeDays !== null
      ? `${ageEvidenceSource === "SOURCE_REPORTED" ? "Source-reported" : "Estimated"} age: ${calendarAgeDays} days.`
      : "No date evidence available.";

  const obsPart =
    totalObservationCount > 0
      ? `${totalObservationCount} total observation(s), ${verifiedActiveObservationCount} confirmed active.`
      : "No SWAI observations recorded.";

  const gapNote =
    largestGapDays !== null && largestGapDays > 7
      ? ` Largest observation gap: ${largestGapDays} days — continuous delivery in this period is NOT verified.`
      : "";

  const disclaimer =
    ageEvidenceSource === "SOURCE_REPORTED"
      ? " Provider-reported dates are not independently verified."
      : totalObservationCount === 1
      ? " Single observation — age is an estimate from first discovery only."
      : "";

  const explanation = `${agePart} ${obsPart}${gapNote}${disclaimer}`;

  return {
    adId: input.adId,
    calendarAgeDays,
    ageEvidenceSource,
    ageNote,
    totalObservationCount,
    verifiedActiveObservationCount,
    observedActiveDays,
    observationCoverageDays,
    observationSpanStart,
    observationSpanEnd,
    unobservedGapDays,
    largestGapDays,
    longevityCategory,
    coverageStatus,
    continuityConfidence,
    evidenceQuality,
    explanation,
  };
}

/**
 * Builds a chronological lifecycle timeline from lifecycle events and observations.
 */
export function buildAdLifecycleTimeline(
  events: Array<{
    eventType: string;
    occurredAt: Date;
    sourceTimestamp?: Date | null;
    evidenceReference?: string | null;
    confidence?: number | null;
    notes?: string | null;
  }>,
  observations: Array<{
    observedAt: Date;
    observationStatus: ObservationStatus;
    evidenceType: string;
    evidenceReference?: string | null;
  }>
): Array<{
  date: Date;
  eventType: string;
  source: "LIFECYCLE_EVENT" | "OBSERVATION";
  status?: string;
  confidence?: number | null;
  evidenceReference?: string | null;
  notes?: string | null;
}> {
  const timeline: Array<{
    date: Date;
    eventType: string;
    source: "LIFECYCLE_EVENT" | "OBSERVATION";
    status?: string;
    confidence?: number | null;
    evidenceReference?: string | null;
    notes?: string | null;
  }> = [];

  for (const ev of events) {
    timeline.push({
      date: ev.sourceTimestamp ? new Date(ev.sourceTimestamp) : new Date(ev.occurredAt),
      eventType: ev.eventType,
      source: "LIFECYCLE_EVENT",
      confidence: ev.confidence,
      evidenceReference: ev.evidenceReference,
      notes: ev.notes,
    });
  }

  for (const obs of observations) {
    timeline.push({
      date: new Date(obs.observedAt),
      eventType: `OBSERVATION_${obs.observationStatus}`,
      source: "OBSERVATION",
      status: obs.observationStatus,
      evidenceReference: obs.evidenceReference,
    });
  }

  return timeline.sort((a, b) => a.date.getTime() - b.date.getTime());
}
