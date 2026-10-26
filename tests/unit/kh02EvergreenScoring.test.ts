import { describe, it, expect } from "vitest";
import {
  calculateKH02EvergreenScore,
  KH02_SCORE_VERSION,
} from "@/services/kh02/scoring/evergreenOpportunityScoring";
import { DiscoveredProductCandidate } from "@/services/kh02/identity/productCandidateDiscovery";
import { DemandDataPoint } from "@/services/kh02/demand/temporalDemandEngine";

function createMockCandidate(overrides: Partial<DiscoveredProductCandidate> = {}): DiscoveredProductCandidate {
  return {
    candidateId: "cand_test_123",
    title: "Reusable Pet Hair Remover Roller",
    category: "Pet Gadgets",
    problemStatement: "Easily removes embedded pet fur from couches, carpets, and clothes without sticky paper refills.",
    targetAudience: "Pet Owners",
    thumbnailUrl: "https://cdn.shopify.com/products/pet-roller.jpg",
    videoUrl: "https://cdn.shopify.com/products/pet-roller.mp4",
    canonicalProductUrl: "https://cleanpaws.com/products/pet-roller",
    storeDomain: "cleanpaws.com",
    advertiserNames: ["Clean Paws Co", "FurAway Store", "PetLiving Essentials"],
    supportingAdIds: ["ad_1", "ad_2", "ad_3", "ad_4", "ad_5"],
    supportingSourceTypes: ["META_ADS", "TIKTOK_ORGANIC", "GOOGLE_ADS"],
    totalObservationCount: 8,
    distinctAdvertisersCount: 3,
    earliestObservationDate: "2026-06-01T00:00:00Z",
    latestObservationDate: "2026-10-20T00:00:00Z",
    identityConfidence: "EXACT",
    sourceObservations: [],
    ...overrides,
  };
}

describe("SWAI KH-02 — Evergreen Opportunity Scoring (V12.0.0)", () => {
  it("uses version 12.0.0 formula specification", () => {
    expect(["12.0.0", "12.1.0"]).toContain(KH02_SCORE_VERSION);
  });

  it("Case A: A single viral TikTok spike cannot independently qualify as evergreen", () => {
    // 10M views on one video, but 0 historical demand series and only 1 advertiser
    const viralCandidate = createMockCandidate({
      supportingSourceTypes: ["TIKTOK_ORGANIC"],
      supportingAdIds: ["tt_video_1"],
      distinctAdvertisersCount: 1,
      totalObservationCount: 1,
      advertiserNames: ["SoloCreator"],
    });

    const result = calculateKH02EvergreenScore({
      candidate: viralCandidate,
      demandSeries: [], // No historical time series!
    });

    // Must be PROVISIONAL, not VERIFIED
    expect(result.scoreStatus).toBe("PROVISIONAL");
    expect(result.demandClass).toBe("INSUFFICIENT_HISTORY");
    expect(result.pillars.demandStability.score).toBeNull();
    expect(result.pillars.demandStability.status).toBe("MISSING_DATA");
    expect(result.missingEvidence).toContain(
      "Insufficient historical data (0 points observed, minimum 3 required). Evergreen sustainability cannot be verified."
    );
  });

  it("Case B: Multi-month stable demand + multi-platform signals achieves high score and VERIFIED status", () => {
    const candidate = createMockCandidate();

    // 120-day stable Google Trends series with low variance (CV ~ 0.12)
    const demandSeries: DemandDataPoint[] = [
      { periodStart: "2026-06-01", periodEnd: "2026-06-30", demandValue: 68 },
      { periodStart: "2026-07-01", periodEnd: "2026-07-31", demandValue: 72 },
      { periodStart: "2026-08-01", periodEnd: "2026-08-31", demandValue: 70 },
      { periodStart: "2026-09-01", periodEnd: "2026-09-30", demandValue: 69 },
    ];

    const result = calculateKH02EvergreenScore({
      candidate,
      demandSeries,
    });

    expect(result.scoreStatus).toBe("VERIFIED");
    expect(result.demandClass).toBe("EVERGREEN_STABLE");
    expect(result.pillars.demandStability.score).toBe(25); // Full 25 points
    expect(result.opportunityScore).toBeGreaterThanOrEqual(80);
    expect(result.evidenceConfidence).toBeGreaterThanOrEqual(70);
    expect(result.recommendation).toBe("TEST_CANDIDATE");
  });

  it("Case C: Flatline dead interest (low mean) is classified as DECLINING, not evergreen", () => {
    const candidate = createMockCandidate();

    // Very low interest: 4, 5, 4, 5 over 4 months
    const deadSeries: DemandDataPoint[] = [
      { periodStart: "2026-06-01", periodEnd: "2026-06-30", demandValue: 4 },
      { periodStart: "2026-07-01", periodEnd: "2026-07-31", demandValue: 5 },
      { periodStart: "2026-08-01", periodEnd: "2026-08-31", demandValue: 4 },
      { periodStart: "2026-09-01", periodEnd: "2026-09-30", demandValue: 5 },
    ];

    const result = calculateKH02EvergreenScore({
      candidate,
      demandSeries: deadSeries,
    });

    expect(result.demandClass).toBe("DECLINING");
    expect(result.pillars.demandStability.score).toBeLessThanOrEqual(5);
    expect(result.recommendation).not.toBe("TEST_CANDIDATE");
  });

  it("Case D: Recurring seasonal peaks are classified as SEASONAL_RECURRING, not EVERGREEN_STABLE", () => {
    const candidate = createMockCandidate();

    // Seasonal wave: 20 -> 80 -> 25 -> 75 (high variation)
    const seasonalSeries: DemandDataPoint[] = [
      { periodStart: "2026-06-01", periodEnd: "2026-06-30", demandValue: 20 },
      { periodStart: "2026-07-01", periodEnd: "2026-07-31", demandValue: 80 },
      { periodStart: "2026-08-01", periodEnd: "2026-08-31", demandValue: 25 },
      { periodStart: "2026-09-01", periodEnd: "2026-09-30", demandValue: 75 },
    ];

    const result = calculateKH02EvergreenScore({
      candidate,
      demandSeries: seasonalSeries,
    });

    expect(result.demandClass).toBe("SEASONAL_RECURRING");
    expect(result.pillars.demandStability.score).toBe(18); // 18 pts for seasonal
  });

  it("Case E: Compliance/safety risk strictly forces REQUIRES_MANUAL_REVIEW regardless of score", () => {
    const candidate = createMockCandidate();
    const demandSeries: DemandDataPoint[] = [
      { periodStart: "2026-06-01", periodEnd: "2026-06-30", demandValue: 68 },
      { periodStart: "2026-07-01", periodEnd: "2026-07-31", demandValue: 72 },
      { periodStart: "2026-08-01", periodEnd: "2026-08-31", demandValue: 70 },
    ];

    const result = calculateKH02EvergreenScore({
      candidate,
      demandSeries,
      complianceRiskDetected: true, // Injected compliance risk
    });

    expect(result.recommendation).toBe("REQUIRES_MANUAL_REVIEW");
    expect(result.risks).toContain("Compliance/safety risk flagged on product candidate.");
  });
});
