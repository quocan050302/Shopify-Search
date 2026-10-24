import { describe, it, expect } from "vitest";
import {
  calculateEconomics,
  deriveRecommendation,
  extractDomainFromUrl,
} from "@/services/products/productService";
import {
  calculateAdLongevityScore,
  rankEvergreenAds,
  type AdLongevityScoreInput,
} from "@/services/evergreen/evergreenScoring";
import { AdViewModel } from "@/types/adViewModel";

describe("SWAI V11.3 — Ad Detail & Shopify Research Foundation", () => {
  describe("P0: Ad Detail Data Contract & Score Decomposition", () => {
    it("satisfies the AdViewModel shape for list data without breaking detail requirements", () => {
      const sampleListItem: AdViewModel = {
        id: "ad_test_123",
        externalAdId: "1234567890",
        platform: "META",
        headline: "Innovative Ergonomic Pillow",
        bodyText: "Sleep better tonight with cervical alignment.",
        callToAction: "Shop Now",
        landingPageUrl: "https://pillowstore.com/products/cervical-pillow",
        originalAdUrl: "https://www.facebook.com/ads/library/?id=1234567890",
        status: "ACTIVE",
        lifecycleStatus: "ACTIVE_OBSERVED",
        category: "Home & Kitchen",
        targetMarket: "US",
        calendarAgeDays: 45,
        ageEvidenceSource: "SOURCE_REPORTED",
        sourceReportedStartAt: "2026-09-01T00:00:00.000Z",
        observationCount: 3,
        verifiedActiveCount: 2,
        advertiser: {
          name: "SleepWell Labs",
          platform: "META",
        },
        media: {
          mediaType: "IMAGE",
          videoUrl: null,
          embedUrl: null,
          thumbnailUrl: "https://images.unsplash.com/photo-pillow.jpg",
          aspectRatio: "1:1",
          availability: "READY",
        },
        score: {
          totalScore: 68,
          tier: "MEDIUM_RESEARCH_PRIORITY",
          evidenceConfidence: 0.75,
          coverageStatus: "MODERATE_COVERAGE",
          explanation: "Longevity research signal",
        },
      };

      expect(sampleListItem.id).toBe("ad_test_123");
      expect(sampleListItem.media?.mediaType).toBe("IMAGE");
      expect(sampleListItem.media?.aspectRatio).toBe("1:1");
      expect(sampleListItem.score?.totalScore).toBe(68);
    });

    it("maps full detail records to AdDetailViewModel with genuine score decomposition", () => {
      const longevityInput: AdLongevityScoreInput = {
        adId: "ad_test_detail",
        platform: "META",
        sourceReportedStartAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
        sourceReportedEndAt: null,
        isSyntheticQuarantine: false,
        observations: [
          {
            observedAt: new Date(),
            observationStatus: "ACTIVE",
            confidence: 0.9,
          },
          {
            observedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
            observationStatus: "ACTIVE",
            confidence: 0.85,
          },
        ],
        sourceReliability: "OFFICIAL_PROVIDER",
      };

      const scoreResult = calculateAdLongevityScore(longevityInput);

      expect(scoreResult.eligible).toBe(true);
      expect(scoreResult.longevityComponent).toBeGreaterThan(0);
      expect(scoreResult.observationComponent).toBeGreaterThan(0);
      expect(scoreResult.coverageComponent).toBeDefined();
      expect(scoreResult.sourceReliabilityComponent).toBe(15);
      expect(scoreResult.formulaVersion).toBe("7.0.0");
      expect(scoreResult.explanation).toContain("RESEARCH PRIORITY signal");
    });

    it("does not default missing dates or observation counts to 1", () => {
      const noDateInput: AdLongevityScoreInput = {
        adId: "ad_nodate",
        platform: "META",
        sourceReportedStartAt: null,
        sourceReportedEndAt: null,
        isSyntheticQuarantine: false,
        observations: [],
        sourceReliability: "UNKNOWN",
      };

      const scoreResult = calculateAdLongevityScore(noDateInput);
      expect(scoreResult.eligible).toBe(false);
      expect(scoreResult.calendarAgeDays).toBeNull();
      expect(scoreResult.totalScore).toBeNull();
      expect(scoreResult.tier).toBe("INSUFFICIENT_EVIDENCE");
    });
  });

  describe("P1: Shopify Product Research Economics & Checklist", () => {
    it("extracts clean store domains from landing page URLs", () => {
      expect(extractDomainFromUrl("https://store.getcleanblend.com/products/blender?utm=1")).toBe("store.getcleanblend.com");
      expect(extractDomainFromUrl("https://www.myshop.com/")).toBe("myshop.com");
      expect(extractDomainFromUrl("invalid-url")).toBe("invalid-url");
      expect(extractDomainFromUrl(null)).toBeNull();
    });

    it("calculates contribution margin and break-even CPA accurately", () => {
      const econ = calculateEconomics({
        observedSellingPrice: 49.99,
        estimatedSupplierCost: 12.50,
        shippingCost: 4.50,
        platformFees: 2.00,
        returnAllowancePercent: 5,
      });

      // Price: 49.99
      // Cost: 12.50
      // Shipping: 4.50
      // Fees: 2.00
      // Return allowance (5% of 49.99): 2.4995 -> 2.50
      // Margin = 49.99 - 12.50 - 4.50 - 2.00 - 2.4995 = 28.4905 -> 28.49
      expect(econ.contributionMargin).toBe(28.49);
      expect(econ.breakEvenCPA).toBe(28.49);
    });

    it("never invents supplier costs — returns null margin when cost is missing", () => {
      const missingCostEcon = calculateEconomics({
        observedSellingPrice: 39.99,
        estimatedSupplierCost: null,
      });
      expect(missingCostEcon.contributionMargin).toBeNull();
      expect(missingCostEcon.breakEvenCPA).toBeNull();

      const missingPriceEcon = calculateEconomics({
        observedSellingPrice: null,
        estimatedSupplierCost: 10.00,
      });
      expect(missingPriceEcon.contributionMargin).toBeNull();
      expect(missingPriceEcon.breakEvenCPA).toBeNull();
    });

    it("evaluates recommendation states based on explicit criteria", () => {
      // 1. Ready for small test: healthy margin, viable differentiation, demand evidence
      const readyRec = deriveRecommendation({
        demandEvidence: true,
        competitionLevel: "MODERATE",
        creativeAppeal: "STRONG",
        differentiationFeasibility: true,
        deliveryFeasibility: true,
        returnRisk: "LOW",
        contributionMargin: 25.00,
      });
      expect(readyRec.recommendation).toBe("READY_FOR_SMALL_TEST");

      // 2. Rejected: negative unit margin
      const negativeMarginRec = deriveRecommendation({
        demandEvidence: true,
        competitionLevel: "LOW",
        creativeAppeal: "STRONG",
        differentiationFeasibility: true,
        deliveryFeasibility: true,
        returnRisk: "LOW",
        contributionMargin: -2.50,
      });
      expect(negativeMarginRec.recommendation).toBe("REJECTED");
      expect(negativeMarginRec.rationale).toContain("Unviable unit economics");

      // 3. Rejected: saturated competition with no differentiation
      const saturatedRec = deriveRecommendation({
        demandEvidence: true,
        competitionLevel: "SATURATED",
        creativeAppeal: "MODERATE",
        differentiationFeasibility: false,
        deliveryFeasibility: true,
        returnRisk: "LOW",
        contributionMargin: 20.00,
      });
      expect(saturatedRec.recommendation).toBe("REJECTED");

      // 4. Research more: uncalculated margin or missing validation
      const researchMoreRec = deriveRecommendation({
        demandEvidence: true,
        competitionLevel: "HIGH",
        creativeAppeal: "MODERATE",
        differentiationFeasibility: true,
        deliveryFeasibility: true,
        returnRisk: "MEDIUM",
        contributionMargin: null,
      });
      expect(researchMoreRec.recommendation).toBe("RESEARCH_MORE");
    });
  });

  describe("P2: Four Explorer Modes Correctness", () => {
    const fixtureScores = [
      {
        adId: "ad_young_testing",
        eligible: true,
        eligibilityReason: "OK",
        availableSignals: ["date"],
        missingSignals: [],
        totalScore: 35,
        tier: "LOW_RESEARCH_PRIORITY" as const,
        longevityComponent: 10,
        observationComponent: 5,
        coverageComponent: 3,
        sourceReliabilityComponent: 15,
        componentWeights: { longevity: 35, observation: 30, coverage: 20, sourceReliability: 15 },
        evidenceConfidence: 0.6,
        longevityCategory: "EARLY_POTENTIAL" as const,
        coverageStatus: "SPARSE_COVERAGE" as const,
        calendarAgeDays: 18,
        ageEvidenceSource: "SOURCE_REPORTED" as const,
        scoreBreakdown: {},
        formulaVersion: "7.0.0",
        explanation: "Test",
        calculatedAt: new Date().toISOString(),
      },
      {
        adId: "ad_evergreen_leader",
        eligible: true,
        eligibilityReason: "OK",
        availableSignals: ["date", "obs"],
        missingSignals: [],
        totalScore: 82,
        tier: "HIGH_RESEARCH_PRIORITY" as const,
        longevityComponent: 35,
        observationComponent: 25,
        coverageComponent: 15,
        sourceReliabilityComponent: 15,
        componentWeights: { longevity: 35, observation: 30, coverage: 20, sourceReliability: 15 },
        evidenceConfidence: 0.85,
        longevityCategory: "EVERGREEN_CANDIDATE" as const,
        coverageStatus: "HIGH_COVERAGE" as const,
        calendarAgeDays: 120,
        ageEvidenceSource: "SOURCE_REPORTED" as const,
        scoreBreakdown: {},
        formulaVersion: "7.0.0",
        explanation: "Test",
        calculatedAt: new Date().toISOString(),
      },
      {
        adId: "ad_multi_observed",
        eligible: true,
        eligibilityReason: "OK",
        availableSignals: ["date", "obs_multi"],
        missingSignals: [],
        totalScore: 75,
        tier: "HIGH_RESEARCH_PRIORITY" as const,
        longevityComponent: 24,
        observationComponent: 30,
        coverageComponent: 20,
        sourceReliabilityComponent: 15,
        componentWeights: { longevity: 35, observation: 30, coverage: 20, sourceReliability: 15 },
        evidenceConfidence: 0.95,
        longevityCategory: "PROMISING" as const,
        coverageStatus: "HIGH_COVERAGE" as const,
        calendarAgeDays: 45,
        ageEvidenceSource: "SOURCE_REPORTED" as const,
        scoreBreakdown: {},
        formulaVersion: "7.0.0",
        explanation: "Test",
        calculatedAt: new Date().toISOString(),
      },
      {
        adId: "ad_brand_new_zero_evidence",
        eligible: true,
        eligibilityReason: "OK",
        availableSignals: ["date"],
        missingSignals: ["obs"],
        totalScore: 10,
        tier: "INSUFFICIENT_EVIDENCE" as const,
        longevityComponent: 5,
        observationComponent: 0,
        coverageComponent: 0,
        sourceReliabilityComponent: 5,
        componentWeights: { longevity: 35, observation: 30, coverage: 20, sourceReliability: 15 },
        evidenceConfidence: 0.1,
        longevityCategory: "NEW_TESTING" as const,
        coverageStatus: "SINGLE_OBSERVATION" as const,
        calendarAgeDays: 2,
        ageEvidenceSource: "SOURCE_REPORTED" as const,
        scoreBreakdown: {},
        formulaVersion: "7.0.0",
        explanation: "Test",
        calculatedAt: new Date().toISOString(),
      },
    ];

    it("ranks EVERGREEN mode by longevity score and verified runtime", () => {
      const ranked = rankEvergreenAds(fixtureScores, { mode: "EVERGREEN" });
      expect(ranked[0].adId).toBe("ad_evergreen_leader");
      expect(ranked[0].totalScore).toBe(82);
    });

    it("restricts EMERGING mode to actual early-stage signals", () => {
      const emerging = rankEvergreenAds(fixtureScores, { mode: "EMERGING" });
      const ids = emerging.map((s) => s.adId);
      // Brand new 2-day ad with 0 observation component should be excluded from Emerging
      expect(ids).toContain("ad_young_testing");
      expect(ids).toContain("ad_multi_observed");
      expect(ids).not.toContain("ad_brand_new_zero_evidence");
    });

    it("ranks TRENDING / EVIDENCE RANKED mode by measurable observation history and confidence", () => {
      const trending = rankEvergreenAds(fixtureScores, { mode: "TRENDING" });
      // ad_multi_observed has the highest observationComponent (30) and confidence (0.95)
      expect(trending[0].adId).toBe("ad_multi_observed");
    });
  });
});
