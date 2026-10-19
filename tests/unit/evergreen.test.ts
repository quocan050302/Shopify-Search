import { describe, it, expect } from "vitest";
import {
  calculateAdLongevity,
  classifyLongevityCategory,
  classifyCoverageStatus,
  buildAdLifecycleTimeline,
  DEFAULT_CATEGORY_CONFIG,
} from "@/services/evergreen/longevityEngine";
import {
  calculateAdLongevityScore,
  calculateEvergreenProductScore,
  calculateDemandStability,
  detectProductSeasonality,
  calculateEvergreenEvidenceConfidence,
  rankEvergreenAds,
  explainEvergreenRanking,
  EVERGREEN_FORMULA_VERSION,
} from "@/services/evergreen/evergreenScoring";

// ─── Helper ───────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function observation(daysAgoN: number, status: "ACTIVE" | "INACTIVE" | "UNKNOWN" = "ACTIVE") {
  return { observedAt: daysAgo(daysAgoN), observationStatus: status };
}

// ─── Test Suite: Longevity Categories ────────────────────────────────────────

describe("classifyLongevityCategory", () => {
  const cfg = DEFAULT_CATEGORY_CONFIG;

  it("classifies 0–13 days as NEW_TESTING", () => {
    expect(classifyLongevityCategory(0, cfg)).toBe("NEW_TESTING");
    expect(classifyLongevityCategory(13, cfg)).toBe("NEW_TESTING");
  });

  it("classifies 14–29 days as EARLY_POTENTIAL", () => {
    expect(classifyLongevityCategory(14, cfg)).toBe("EARLY_POTENTIAL");
    expect(classifyLongevityCategory(29, cfg)).toBe("EARLY_POTENTIAL");
  });

  it("classifies 30–59 days as PROMISING", () => {
    expect(classifyLongevityCategory(30, cfg)).toBe("PROMISING");
    expect(classifyLongevityCategory(59, cfg)).toBe("PROMISING");
  });

  it("classifies 60–89 days as STRONG_CANDIDATE", () => {
    expect(classifyLongevityCategory(60, cfg)).toBe("STRONG_CANDIDATE");
    expect(classifyLongevityCategory(89, cfg)).toBe("STRONG_CANDIDATE");
  });

  it("classifies 90–179 days as EVERGREEN_CANDIDATE", () => {
    expect(classifyLongevityCategory(90, cfg)).toBe("EVERGREEN_CANDIDATE");
    expect(classifyLongevityCategory(179, cfg)).toBe("EVERGREEN_CANDIDATE");
  });

  it("classifies 180+ days as LONG_TERM_REFERENCE", () => {
    expect(classifyLongevityCategory(180, cfg)).toBe("LONG_TERM_REFERENCE");
    expect(classifyLongevityCategory(365, cfg)).toBe("LONG_TERM_REFERENCE");
  });

  it("returns UNKNOWN for null or negative", () => {
    expect(classifyLongevityCategory(null)).toBe("UNKNOWN");
    expect(classifyLongevityCategory(-1)).toBe("UNKNOWN");
  });
});

// ─── Critical Scenario A: Single imported URL ─────────────────────────────────

describe("Scenario A: Single imported URL, no verification", () => {
  it("returns no confirmed active streak and low confidence", () => {
    const result = calculateAdLongevity({
      adId: "test-a",
      platform: "META",
      // No sourceReportedStartAt — no date evidence
      observations: [],
    });

    expect(result.calendarAgeDays).toBeNull();
    expect(result.ageEvidenceSource).toBe("NONE");
    expect(result.totalObservationCount).toBe(0);
    expect(result.verifiedActiveObservationCount).toBe(0);
    expect(result.continuityConfidence).toBe(0);
    expect(result.evidenceQuality).toBe("NONE");
    expect(result.longevityCategory).toBe("UNKNOWN");
  });

  it("scores INSUFFICIENT_EVIDENCE when no date evidence", () => {
    const score = calculateAdLongevityScore({
      adId: "test-a",
      platform: "META",
      observations: [],
    });

    expect(score.eligible).toBe(false);
    expect(score.totalScore).toBeNull();
    expect(score.tier).toBe("INSUFFICIENT_EVIDENCE");
  });
});

// ─── Critical Scenario B: Two observations 90 days apart ─────────────────────

describe("Scenario B: Two observations 90 days apart", () => {
  it("does NOT claim 90 continuous active days", () => {
    const result = calculateAdLongevity({
      adId: "test-b",
      platform: "TIKTOK",
      observations: [
        observation(90, "ACTIVE"),
        observation(0, "ACTIVE"),
      ],
    });

    // observedActiveDays = 2 (two distinct calendar days), NOT 90
    expect(result.totalObservationCount).toBe(2);
    expect(result.verifiedActiveObservationCount).toBe(2);
    expect(result.observedActiveDays).toBe(2); // Only 2 distinct days confirmed active
    expect(result.observationCoverageDays).toBeCloseTo(90, -1);
    // Largest gap should be ~90 days
    expect(result.largestGapDays).toBeGreaterThanOrEqual(80);
    // Continuity should be LOW due to huge gap
    expect(result.continuityConfidence).toBeLessThan(0.5);
    // Explanation must mention the gap
    expect(result.explanation).toContain("gap");
  });
});

// ─── Critical Scenario C: Provider reports 120-day start, one observation ────

describe("Scenario C: Provider-reported 120-day start, no daily history", () => {
  it("shows 120-day reported age but does NOT invent daily activity", () => {
    const result = calculateAdLongevity({
      adId: "test-c",
      platform: "META",
      sourceReportedStartAt: daysAgo(120),
      observations: [observation(0, "ACTIVE")],
    });

    expect(result.calendarAgeDays).toBeCloseTo(120, -1);
    expect(result.ageEvidenceSource).toBe("SOURCE_REPORTED");
    // Only one observation, not 120 active days
    expect(result.observedActiveDays).toBe(1);
    expect(result.totalObservationCount).toBe(1);
    // Coverage status should be SINGLE_OBSERVATION
    expect(result.coverageStatus).toBe("SINGLE_OBSERVATION");
    // Note must say not independently verified
    expect(result.explanation).toMatch(/not independently verified|Single observation/i);
  });

  it("scores lower than a well-observed ad of same age", () => {
    const sparse = calculateAdLongevityScore({
      adId: "sparse",
      platform: "META",
      sourceReportedStartAt: daysAgo(120),
      observations: [observation(0, "ACTIVE")],
      sourceReliability: "USER_IMPORT",
    });

    const dense = calculateAdLongevityScore({
      adId: "dense",
      platform: "META",
      sourceReportedStartAt: daysAgo(120),
      observations: Array.from({ length: 12 }, (_, i) => observation(i * 10, "ACTIVE")),
      sourceReliability: "OFFICIAL_PROVIDER",
    });

    expect(sparse.totalScore).not.toBeNull();
    expect(dense.totalScore).not.toBeNull();
    expect(dense.totalScore!).toBeGreaterThan(sparse.totalScore!);
    expect(dense.evidenceConfidence).toBeGreaterThan(sparse.evidenceConfidence);
  });
});

// ─── Scenario D: 5-year stable demand data ────────────────────────────────────

describe("Scenario D: 5-year stable demand data", () => {
  it("evaluates demand stability from actual time-series", () => {
    // 60 monthly observations with low variance (stable product)
    const obs = Array.from({ length: 60 }, (_, i) => {
      const d = new Date("2020-01-01");
      d.setMonth(d.getMonth() + i);
      return {
        periodStart: d,
        periodEnd: new Date(d.getFullYear(), d.getMonth() + 1, 0),
        demandValue: 70 + Math.sin(i) * 5, // Small variation
      };
    });

    const result = calculateDemandStability(obs);
    expect(result.class).toBe("EVERGREEN_STABLE");
    expect(result.stabilityScore).not.toBeNull();
    expect(result.stabilityScore!).toBeGreaterThan(25);
  });
});

// ─── Scenario E: Single short viral spike ────────────────────────────────────

describe("Scenario E: Single viral spike", () => {
  it("does not classify as evergreen stable", () => {
    const obs = [
      { periodStart: daysAgo(90), periodEnd: daysAgo(60), demandValue: 5 },
      { periodStart: daysAgo(60), periodEnd: daysAgo(30), demandValue: 4 },
      { periodStart: daysAgo(30), periodEnd: daysAgo(0), demandValue: 95 }, // Huge spike
    ];

    const result = calculateDemandStability(obs);
    // High CV → not EVERGREEN_STABLE
    expect(result.class).not.toBe("EVERGREEN_STABLE");
  });
});

// ─── Scenario F: Seasonal recurring product ───────────────────────────────────

describe("Scenario F: Seasonal recurring product", () => {
  it("may classify as SEASONAL_RECURRING, not failing evergreen", () => {
    // Q4 spikes every year
    const obs: Array<{ periodStart: Date; periodEnd: Date; demandValue: number }> = [];
    for (let year = 2021; year <= 2024; year++) {
      for (let month = 0; month < 12; month++) {
        const isQ4 = month >= 9; // Oct–Dec
        const d = new Date(year, month, 1);
        obs.push({
          periodStart: d,
          periodEnd: new Date(year, month + 1, 0),
          demandValue: isQ4 ? 80 : 20,
        });
      }
    }

    const result = calculateDemandStability(obs);
    // Should be SEASONAL_RECURRING or TREND_DRIVEN, NOT "worthless"
    expect(result.class).toMatch(/SEASONAL_RECURRING|TREND_DRIVEN/);
    // Explanation must exist
    expect(result.explanation).toBeTruthy();
  });
});

// ─── Scenario G: Source access fails ─────────────────────────────────────────

describe("Scenario G: Synthetic / quarantined record", () => {
  it("returns INSUFFICIENT_EVIDENCE and does not infer active status", () => {
    const result = calculateAdLongevity({
      adId: "test-g-synthetic",
      platform: "META",
      isSyntheticQuarantine: true,
      observations: [],
    });

    expect(result.longevityCategory).toBe("UNKNOWN");
    expect(result.continuityConfidence).toBe(0);
    expect(result.evidenceQuality).toBe("NONE");
    expect(result.explanation).toMatch(/synthetic|quarantined/i);

    const score = calculateAdLongevityScore({
      adId: "test-g-synthetic",
      platform: "META",
      isSyntheticQuarantine: true,
      observations: [],
    });

    expect(score.eligible).toBe(false);
    expect(score.totalScore).toBeNull();
    expect(score.tier).toBe("INSUFFICIENT_EVIDENCE");
  });
});

// ─── Scenario H: No real ads or demand data ───────────────────────────────────

describe("Scenario H: No data available", () => {
  it("calculates INSUFFICIENT_EVIDENCE with zero ads and no demand", () => {
    const score = calculateEvergreenProductScore({
      productId: "empty-product",
      demandObservations: [],
      linkedAdCount: 0,
      distinctCreativeCount: 0,
      observedActiveAdCount: 0,
      productAvailabilityConfirmed: false,
      priceObservationCount: 0,
    });

    expect(score.eligible).toBe(false);
    expect(score.totalScore).toBeNull();
    expect(score.tier).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("returns INSUFFICIENT_DATA for < 3 demand observations", () => {
    const result = calculateDemandStability([
      { periodStart: daysAgo(60), periodEnd: daysAgo(30), demandValue: 50 },
    ]);
    expect(result.class).toBe("INSUFFICIENT_DATA");
    expect(result.stabilityScore).toBeNull();
  });
});

// ─── Coverage Status Classification ──────────────────────────────────────────

describe("classifyCoverageStatus", () => {
  it("returns INSUFFICIENT_EVIDENCE with 0 observations", () => {
    expect(classifyCoverageStatus(0, null, 0)).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("returns SINGLE_OBSERVATION with 1 observation", () => {
    expect(classifyCoverageStatus(1, 0, 0)).toBe("SINGLE_OBSERVATION");
  });

  it("returns SPARSE_COVERAGE with 2 observations", () => {
    expect(classifyCoverageStatus(2, 30, 1)).toBe("SPARSE_COVERAGE");
  });
});

// ─── Ranking Engine ───────────────────────────────────────────────────────────

describe("rankEvergreenAds", () => {
  const makeScore = (id: string, total: number, ageDays: number, conf: number, eligible = true) =>
    calculateAdLongevityScore({
      adId: id,
      platform: "META",
      sourceReportedStartAt: daysAgo(ageDays),
      isSyntheticQuarantine: !eligible,
      observations: conf > 0.5
        ? Array.from({ length: 5 }, (_, i) => observation(i * 5, "ACTIVE"))
        : [],
      sourceReliability: conf > 0.5 ? "OFFICIAL_PROVIDER" : "UNKNOWN",
    });

  it("ranks higher-score ads first in EVERGREEN mode", () => {
    const scoreA = makeScore("ad-a", 80, 120, 0.6);
    const scoreB = makeScore("ad-b", 30, 20, 0.1);

    const ranked = rankEvergreenAds([scoreB, scoreA], { mode: "EVERGREEN" });
    // Higher scorer should be first
    if (ranked.length >= 2) {
      expect((ranked[0].totalScore ?? 0)).toBeGreaterThanOrEqual(ranked[1].totalScore ?? 0);
    }
  });

  it("never ranks ineligible synthetic records", () => {
    const synthetic = makeScore("syn-01", 0, 0, 0, false);
    const real = makeScore("real-01", 50, 60, 0.3, true);

    const ranked = rankEvergreenAds([synthetic, real], { mode: "EVERGREEN" });
    const ids = ranked.map((s) => s.adId);
    expect(ids).not.toContain("syn-01");
  });

  it("minAgeDays filter removes young ads", () => {
    const old = makeScore("old-01", 90, 90, 0.5);
    const young = makeScore("young-01", 20, 5, 0.3);

    const ranked = rankEvergreenAds([old, young], { mode: "EVERGREEN", minAgeDays: 60 });
    const ids = ranked.map((s) => s.adId);
    expect(ids).toContain("old-01");
    expect(ids).not.toContain("young-01");
  });
});

// ─── Evidence Confidence ─────────────────────────────────────────────────────

describe("calculateEvergreenEvidenceConfidence", () => {
  it("gives maximum confidence with many observations, long history, and official source", () => {
    const result = calculateEvergreenEvidenceConfidence({
      sourceReliability: "OFFICIAL_PROVIDER",
      observationCount: 15,
      demandHistoryMonths: 36,
      hasVerifiedTimestamps: true,
      productMatchConfidence: "CONFIRMED",
      missingDataFields: [],
    });
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("gives low confidence with no evidence", () => {
    const result = calculateEvergreenEvidenceConfidence({
      sourceReliability: "UNKNOWN",
      observationCount: 0,
      demandHistoryMonths: null,
      hasVerifiedTimestamps: false,
      productMatchConfidence: "UNKNOWN",
      missingDataFields: ["source_url", "dates", "media"],
    });
    expect(result.confidence).toBeLessThan(0.2);
  });

  it("includes explanation string", () => {
    const result = calculateEvergreenEvidenceConfidence({
      sourceReliability: "USER_IMPORT",
      observationCount: 3,
      demandHistoryMonths: 6,
      hasVerifiedTimestamps: false,
      productMatchConfidence: "PROBABLE",
      missingDataFields: [],
    });
    expect(result.explanation).toContain("confidence");
  });
});

// ─── Lifecycle Timeline ───────────────────────────────────────────────────────

describe("buildAdLifecycleTimeline", () => {
  it("returns events in chronological order", () => {
    const timeline = buildAdLifecycleTimeline(
      [
        { eventType: "ACTIVE_VERIFIED", occurredAt: daysAgo(30), notes: null },
        { eventType: "AD_DISCOVERED", occurredAt: daysAgo(60), notes: null },
      ],
      [
        { observedAt: daysAgo(15), observationStatus: "ACTIVE", evidenceType: "USER_OBSERVED" },
      ]
    );

    expect(timeline.length).toBe(3);
    // First entry should be oldest
    expect(timeline[0].eventType).toBe("AD_DISCOVERED");
    expect(timeline[timeline.length - 1].date.getTime()).toBeGreaterThanOrEqual(
      timeline[0].date.getTime()
    );
  });

  it("returns empty array for no events or observations", () => {
    const timeline = buildAdLifecycleTimeline([], []);
    expect(timeline).toHaveLength(0);
  });
});

// ─── Formula Version ─────────────────────────────────────────────────────────

describe("EVERGREEN_FORMULA_VERSION", () => {
  it("is 7.0.0", () => {
    expect(EVERGREEN_FORMULA_VERSION).toBe("7.0.0");
  });

  it("is included in score explanations", () => {
    const score = calculateAdLongevityScore({
      adId: "version-test",
      platform: "META",
      sourceReportedStartAt: daysAgo(30),
      observations: [observation(0, "ACTIVE")],
    });
    expect(score.formulaVersion).toBe("7.0.0");
    expect(score.explanation).toContain("7.0.0");
  });
});
