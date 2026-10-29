import { describe, it, expect } from "vitest";
import {
  evaluateDemandSourceAuthority,
  auditDemandObservationsProvenance,
  isTemplatedSyntheticDemandSeries,
  isPromotionalAdCopyDemandKeyword,
  hasVerifiableCsvOrProviderLineage,
  evaluateTemporalDemandStability,
} from "@/services/kh02/demand/temporalDemandEngine";
import {
  evaluateProductAudienceRelevance,
  evaluateProductRelevance,
} from "@/services/kh02/identity/productRelevanceEvaluator";
import { buildKH02DiscoveryQueryPlan } from "@/services/kh02/discovery/discoveryQueryPlanner";
import { analyzeCustomerPsychology } from "@/services/kh02/psychology/customerPsychologyService";
import {
  buildCanonicalRecommendedProducts,
  buildAllCandidatesExplorerList,
  sanitizeRejectionOrRealityReason,
} from "@/services/kh02/presentation/productFinderViewModel";
import {
  SWAI_KH02_RELEASE_VERSION,
  evaluateKH02RuntimeIdentity,
} from "@/services/kh02/version/runtimeVersionService";
import {
  runAdversarialFalsePassSuiteV12_4_3_2,
  evaluateLiveOnlyIsolation,
} from "@/services/kh02/acceptance/gateAndAsyncVerifierV12_4_3_2";
import type {
  DiscoveredProductCandidate,
  EvergreenLeaderboardResponse,
} from "@/services/kh02/types";

function makeBaseCandidate(
  overrides: Partial<DiscoveredProductCandidate> = {}
): DiscoveredProductCandidate {
  return {
    candidateId: "cand_uahpet_fountain",
    productKey: "uahpet_water_fountain",
    title: "uahpet Cat Water Fountain Wireless Stainless Steel",
    brand: "uahpet",
    category: "Pet Supplies",
    storeDomain: "uahpet.com",
    canonicalProductUrl: "https://uahpet.com/products/wireless-pet-water-fountain",
    thumbnailUrl: "https://uahpet.com/cdn/shop/fountain.jpg",
    videoUrl: null,
    estimatedPrice: 49.99,
    estimatedCogs: null,
    estimatedShipping: null,
    grossMarginPct: null,
    supportingAdIds: ["ad_1", "ad_2"],
    supportingSourceTypes: ["META_ADS"],
    distinctAdvertisersCount: 1,
    totalObservationCount: 2,
    firstObservedAt: "2026-01-10T00:00:00.000Z",
    lastObservedAt: "2026-04-15T00:00:00.000Z",
    activeDaysObserved: 95,
    recurringWindowsCount: 3,
    isShopifyStore: true,
    identityStatus: "VERIFIED",
    identityConfidence: 0.92,
    evidenceSnippets: ["Wireless pet water fountain for cats and dogs"],
    productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
    productRealityReason: "Verified physical product page on uahpet.com",
    merchantVerifiedProductName: "uahpet Wireless Pet Water Fountain",
    canonicalProductName: "uahpet Wireless Pet Water Fountain",
    displayName: "uahpet Wireless Pet Water Fountain",
    familyKey: "pet_water_fountain",
    familyLabel: "Pet Water Fountain",
    relevanceStatus: "RELEVANT",
    relevanceScore: 88,
    relevanceReasons: ["Matched pet niche"],
    ...overrides,
  };
}

describe("SWAI KH-02 V12.4.3.2 — Live Discovery, Forensic Demand Audit, Audience Relevance & UX ViewModel", () => {
  describe("1. Release & Runtime Identity", () => {
    it("reports release version 12.4.3.2 or 12.4.3.2.1", () => {
      expect(SWAI_KH02_RELEASE_VERSION).toMatch(/^12\.4\.3\.2(\.1)?$/);
      const runtime = evaluateKH02RuntimeIdentity();
      expect(runtime.releaseVersion).toMatch(/^12\.4\.3\.2(\.1)?$/);
    });
  });

  describe("2. Forensic Demand Source Audit & Authority (Section 4)", () => {
    it("rejects verified-merchant-demand:<domain> synthetic series from Evergreen authority", () => {
      const syntheticMerchantRows = [
        {
          id: "obs_1",
          productId: "prod_pawspick_1",
          keyword: "automatic wet food cat feeder",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "verified-merchant-demand:pawspick.com",
          demandValue: 76,
          date: "2025-11-01T00:00:00Z",
        },
        {
          id: "obs_2",
          productId: "prod_pawspick_1",
          keyword: "automatic wet food cat feeder",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "verified-merchant-demand:pawspick.com",
          demandValue: 79,
          date: "2025-12-01T00:00:00Z",
        },
        {
          id: "obs_3",
          productId: "prod_pawspick_1",
          keyword: "automatic wet food cat feeder",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "verified-merchant-demand:pawspick.com",
          demandValue: 77,
          date: "2026-01-01T00:00:00Z",
        },
        {
          id: "obs_4",
          productId: "prod_pawspick_1",
          keyword: "automatic wet food cat feeder",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "verified-merchant-demand:pawspick.com",
          demandValue: 81,
          date: "2026-02-01T00:00:00Z",
        },
        {
          id: "obs_5",
          productId: "prod_pawspick_1",
          keyword: "automatic wet food cat feeder",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "verified-merchant-demand:pawspick.com",
          demandValue: 78,
          date: "2026-03-01T00:00:00Z",
        },
        {
          id: "obs_6",
          productId: "prod_pawspick_1",
          keyword: "automatic wet food cat feeder",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "verified-merchant-demand:pawspick.com",
          demandValue: 82,
          date: "2026-04-01T00:00:00Z",
        },
      ];

      expect(isTemplatedSyntheticDemandSeries(syntheticMerchantRows)).toBe(true);
      const lineage = hasVerifiableCsvOrProviderLineage("verified-merchant-demand:pawspick.com");
      expect(lineage.isMerchantDomainPseudoRef).toBe(true);
      expect(lineage.rawCsvFileExists).toBe(false);

      const authority = evaluateDemandSourceAuthority(syntheticMerchantRows);
      expect(authority.authority).toBe("CACHED_UNVERIFIED");

      const audit = auditDemandObservationsProvenance(
        "prod_pawspick_1",
        "Automatic Wet Food Cat Feeder",
        syntheticMerchantRows
      );
      expect(audit.resolvedAuthority).toBe("CACHED_UNVERIFIED");
      expect(audit.eligibleForEvergreen).toBe(false);
      expect(audit.evidenceKind).toBe("SEARCH_INTEREST_NOT_SALES");
    });

    it("rejects promotional ad-copy strings masquerading as search demand keywords", () => {
      expect(
        isPromotionalAdCopyDemandKeyword("Free bonus 50% off shop now limited time offer")
      ).toBe(true);
      expect(isPromotionalAdCopyDemandKeyword("dog grooming brush")).toBe(false);

      const adCopyRows = [
        {
          id: "ad_kw_1",
          productId: "prod_ad_copy",
          keyword: "Free bonus 50% off shop now limited time offer for pet lovers",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "csv-import:job_1:sha256:9f86d081884c7d659a2feaa0c55ad015",
          demandValue: 64,
          date: "2026-01-01T00:00:00Z",
        },
      ];

      const authority = evaluateDemandSourceAuthority(adCopyRows);
      expect(authority.authority).toBe("CACHED_UNVERIFIED");
    });

    it("accepts GOOGLE_TRENDS_CSV only when backed by verifiable csv-import + sha256 lineage and non-templated values", () => {
      const validCsvRows = [
        {
          productId: "prod_fountain_1",
          keyword: "dog water fountain",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "csv-import:job_2026_04:sha256:9f86d081884c7d659a2feaa0c55ad015",
          demandValue: 61,
          date: "2025-10-01T00:00:00Z",
        },
        {
          productId: "prod_fountain_1",
          keyword: "dog water fountain",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "csv-import:job_2026_04:sha256:9f86d081884c7d659a2feaa0c55ad015",
          demandValue: 68,
          date: "2025-11-01T00:00:00Z",
        },
      ];

      const authority = evaluateDemandSourceAuthority(validCsvRows, {
        targetProductId: "prod_fountain_1",
        candidateCanonicalName: "Dog Water Fountain Stainless Steel",
      });
      expect(authority.authority).toBe("HISTORICAL_SOURCE_VERIFIED");
    });

    it("demotes candidates with synthetic merchant-seeded demand in evaluateTemporalDemandStability", () => {
      const evalResult = evaluateTemporalDemandStability(
        [
          {
            productId: "prod_pawspick_1",
            keyword: "pawspick cat water fountain",
            date: "2025-09-01T00:00:00Z",
            demandValue: 76,
            source: "GOOGLE_TRENDS_CSV",
            evidenceReference: "verified-merchant-demand:pawspick.com",
          },
          {
            productId: "prod_pawspick_1",
            keyword: "pawspick cat water fountain",
            date: "2025-10-15T00:00:00Z",
            demandValue: 79,
            source: "GOOGLE_TRENDS_CSV",
            evidenceReference: "verified-merchant-demand:pawspick.com",
          },
          {
            productId: "prod_pawspick_1",
            keyword: "pawspick cat water fountain",
            date: "2025-12-01T00:00:00Z",
            demandValue: 77,
            source: "GOOGLE_TRENDS_CSV",
            evidenceReference: "verified-merchant-demand:pawspick.com",
          },
          {
            productId: "prod_pawspick_1",
            keyword: "pawspick cat water fountain",
            date: "2026-01-15T00:00:00Z",
            demandValue: 81,
            source: "GOOGLE_TRENDS_CSV",
            evidenceReference: "verified-merchant-demand:pawspick.com",
          },
          {
            productId: "prod_pawspick_1",
            keyword: "pawspick cat water fountain",
            date: "2026-03-01T00:00:00Z",
            demandValue: 78,
            source: "GOOGLE_TRENDS_CSV",
            evidenceReference: "verified-merchant-demand:pawspick.com",
          },
          {
            productId: "prod_pawspick_1",
            keyword: "pawspick cat water fountain",
            date: "2026-04-10T00:00:00Z",
            demandValue: 82,
            source: "GOOGLE_TRENDS_CSV",
            evidenceReference: "verified-merchant-demand:pawspick.com",
          },
        ],
        90,
        {
          targetProductId: "prod_pawspick_1",
          candidateCanonicalName: "Pawspick Cat Water Fountain",
        }
      );

      expect(evalResult.sourceAuthority).toBe("CACHED_UNVERIFIED");
      expect(evalResult.eligibleForEvergreen).toBe(false);
      expect(evalResult.evidenceKind).toBe("SEARCH_INTEREST_NOT_SALES");
    });
  });

  describe("3. Audience & Species Relevance (Section 5)", () => {
    it("rejects cat-only products when searching for 'dog'", () => {
      const catFeeder = evaluateProductAudienceRelevance(
        {
          title: "Automatic Wet Food Cat Feeder",
          canonicalProductName: "Automatic Wet Food Cat Feeder",
          merchantVerifiedProductName: "Automatic Wet Food Cat Feeder",
          productUrl: "https://pawspick.com/products/automatic-wet-food-cat-feeder",
          evidenceSnippets: ["Keep your kitten and cat fed on schedule with ice packs"],
        },
        "dog"
      );
      expect(catFeeder.requestedAudience).toBe("DOG");
      expect(catFeeder.supportedAudiences).toContain("CAT");
      expect(catFeeder.eligibleForPrimaryShortlist).toBe(false);

      const catFountain = evaluateProductRelevance(
        {
          title: "Pawspick Cat Water Fountain Stainless Steel",
          category: "Pet Supplies",
          canonicalProductName: "Pawspick Cat Water Fountain",
          productUrl: "https://pawspick.com/products/cat-water-fountain",
          evidenceSnippets: ["Designed for cats and kittens"],
        },
        "dog"
      );
      expect(catFountain.relevanceStatus).toBe("IRRELEVANT");
      expect(catFountain.isAccepted).toBe(false);
      expect(catFountain.audienceRelevance?.eligibleForPrimaryShortlist).toBe(false);
    });

    it("accepts dog-specific and multi-pet products when searching for 'dog'", () => {
      const dogHarness = evaluateProductRelevance(
        {
          title: "No-Pull Tactical Dog Harness for Large Dogs",
          category: "Pet Supplies",
          productUrl: "https://doggear.com/products/no-pull-dog-harness",
          evidenceSnippets: ["Heavy duty canine vest harness for walking your dog"],
        },
        "dog"
      );
      expect(dogHarness.relevanceStatus).toBe("RELEVANT");
      expect(dogHarness.isAccepted).toBe(true);
      expect(dogHarness.audienceRelevance?.eligibleForPrimaryShortlist).toBe(true);
      expect(dogHarness.audienceRelevance?.audienceMatch).toBe("EXACT");

      const multiPetRoller = evaluateProductRelevance(
        {
          title: "Reusable Pet Hair Remover Roller for Dog and Cat Fur",
          category: "Pet Supplies",
          productUrl: "https://chomchom.com/products/pet-hair-remover",
          evidenceSnippets: ["Works on dog hair and cat hair on couches"],
        },
        "dog"
      );
      expect(multiPetRoller.relevanceStatus).toBe("RELEVANT");
      expect(multiPetRoller.isAccepted).toBe(true);
      expect(multiPetRoller.audienceRelevance?.eligibleForPrimaryShortlist).toBe(true);
    });

    it("rejects dog-only products when searching for 'cat'", () => {
      const barkCollar = evaluateProductRelevance(
        {
          title: "Rechargeable Anti-Bark Dog Training Collar",
          category: "Pet Supplies",
          productUrl: "https://barkstop.com/products/anti-bark-dog-collar",
          evidenceSnippets: ["Stop dog barking safely for small and large dogs"],
        },
        "cat"
      );
      expect(barkCollar.relevanceStatus).toBe("IRRELEVANT");
      expect(barkCollar.isAccepted).toBe(false);
      expect(barkCollar.audienceRelevance?.requestedAudience).toBe("CAT");
      expect(barkCollar.audienceRelevance?.supportedAudiences).toContain("DOG");
      expect(barkCollar.audienceRelevance?.eligibleForPrimaryShortlist).toBe(false);
    });

    it("enforces audience compatibility across MEN/WOMEN, KIDS/ADULTS, CAR/MOTORCYCLE, INDOOR/OUTDOOR", () => {
      const menQueryWomenProduct = evaluateProductAudienceRelevance(
        {
          title: "Women's Facial Hair Flawless Epilator for Ladies",
          evidenceSnippets: ["Designed for women's delicate skin"],
        },
        "men grooming trimmer"
      );
      expect(menQueryWomenProduct.eligibleForPrimaryShortlist).toBe(false);
      expect(menQueryWomenProduct.audienceMatch).toBe("CONTRADICTORY");

      const carQueryMotorcycleProduct = evaluateProductAudienceRelevance(
        {
          title: "Motorcycle Helmet Bluetooth Intercom Headset for Bikers",
          evidenceSnippets: ["Motorbike helmet communicator"],
        },
        "car accessories"
      );
      expect(carQueryMotorcycleProduct.eligibleForPrimaryShortlist).toBe(false);
      expect(carQueryMotorcycleProduct.audienceMatch).toBe("CONTRADICTORY");
    });

    it("plans species-specific subqueries for 'dog' and 'cat' without cross-species contamination", () => {
      const dogPlan = buildKH02DiscoveryQueryPlan("dog", "US", { maxRequests: 3 });
      const dogStrings = dogPlan.subqueries.map((q) => q.subquery.toLowerCase());
      expect(dogStrings.every((s) => s.includes("dog"))).toBe(true);
      expect(dogStrings.some((s) => s.includes("cat"))).toBe(false);

      const catPlan = buildKH02DiscoveryQueryPlan("cat", "US", { maxRequests: 3 });
      const catStrings = catPlan.subqueries.map((q) => q.subquery.toLowerCase());
      expect(catStrings.every((s) => s.includes("cat"))).toBe(true);
      expect(catStrings.some((s) => s.includes("dog"))).toBe(false);
    });
  });

  describe("4. Customer Psychology Claim Integrity (Section 7)", () => {
    it("never marks Multi-Pet Households as OBSERVED merely because 'dog' and 'cat' both appear in ad text", () => {
      const profile = analyzeCustomerPsychology({
        candidateId: "cand_chomchom",
        candidateTitle: "ChomChom Pet Hair Remover for Dogs and Cats",
        categoryOrTopic: "Pet Gadgets",
        rawHeadlines: ["Removes dog hair and cat fur from furniture"],
        rawDescriptions: [
          "Works great on dog hair and cat hair on sofas, beds, and carpets.",
        ],
        landingPageUrl: "https://chomchom.com/products/roller",
      });

      expect(profile.targetCustomer.status).toBe("INFERRED");
      expect(profile.targetCustomer.status).not.toBe("OBSERVED");
    });

    it("marks Multi-Pet Households as OBSERVED only when ad copy explicitly mentions multi-pet household ownership", () => {
      const profile = analyzeCustomerPsychology({
        candidateId: "cand_multipet_feeder",
        candidateTitle: "Smart RFID Feeder for Multi-Pet Households",
        categoryOrTopic: "Pet Gadgets",
        rawHeadlines: ["Built for multi-pet households with both dogs and cats"],
        rawDescriptions: [
          "Stop food stealing in any multi-pet home where dogs and cats live together.",
        ],
      });

      expect(profile.targetCustomer.status).toBe("OBSERVED");
    });
  });

  describe("5. Structured Exclusion Reason Integrity & Canonical UI Deduplication (Sections 8 & 11)", () => {
    it("sanitizes contradictory legacy 'Classified as non-physical entity (PHYSICAL_PRODUCT)' strings", () => {
      const badCandidate = makeBaseCandidate({
        productRealityStatus: "REJECTED_NON_PRODUCT",
        productRealityReason:
          "Excluded: AI Review classified candidate as non-physical entity (PHYSICAL_PRODUCT).",
      });
      const sanitized = sanitizeRejectionOrRealityReason(badCandidate);
      expect(sanitized).not.toContain("non-physical entity (PHYSICAL_PRODUCT)");
      expect(sanitized).toContain("Missing verifiable merchant product URL");
    });

    it("deduplicates products across topThree, researchShortlist, and provisionalCandidates so each product appears only once in Recommended", () => {
      const c1 = makeBaseCandidate({
        candidateId: "cand_1",
        productKey: "uahpet_fountain",
        title: "uahpet Wireless Pet Water Fountain",
        canonicalProductUrl: "https://uahpet.com/products/wireless-pet-water-fountain",
      });
      const c2 = makeBaseCandidate({
        candidateId: "cand_2",
        productKey: "furbo_camera",
        title: "Furbo 360 Dog Camera",
        storeDomain: "furbo.com",
        canonicalProductUrl: "https://furbo.com/products/furbo-360-dog-camera",
      });

      const ranked1: any = {
        rank: 1,
        candidate: c1,
        score: {
          candidateId: c1.candidateId,
          opportunityScore: 68,
          demandPersistenceScore: 12,
          adLongevityScore: 18,
          multiAdvertiserReplicationScore: 10,
          creativeFormatStrengthScore: 10,
          storeQualityScore: 9,
          marginViabilityScore: 9,
          evidenceConfidence: 76,
          demandClass: "INSUFFICIENT_HISTORY",
          tier: "PROVISIONAL",
          scoreStatus: "PROVISIONAL",
          evergreenQualified: false,
          disqualificationReasons: [],
          missingEvidence: ["Requires 6+ months of authoritative demand history"],
          recommendationRationale: "Strong merchant product evidence",
        },
        temporalProfile: {} as any,
      };

      const ranked2: any = {
        ...ranked1,
        rank: 2,
        candidate: c2,
      };

      const mockLeaderboard: EvergreenLeaderboardResponse = {
        topic: "Pet Gadgets",
        country: "US",
        lookbackDays: 180,
        generatedAt: "2026-04-19T00:00:00.000Z",
        sourceCoverage: {} as any,
        topThree: [],
        remainingCandidates: [],
        provisionalCandidates: [ranked1, ranked2],
        insufficientEvidenceCandidates: [],
        rejectedCandidates: [],
        researchShortlist: {
          requestedCount: 3,
          qualifiedCount: 2,
          shortlist: [c1, c2],
          shortfallReason: "Only 2 merchant-verified physical products matched.",
          allRankedHaveProductIdentity: true,
          distinctProductFamiliesCount: 2,
        },
        totalObservationsNormalized: 50,
        totalCandidatesEvaluated: 8,
      };

      const recommended = buildCanonicalRecommendedProducts(mockLeaderboard);
      expect(recommended).toHaveLength(2);
      const ids = recommended.map((r) => r.candidateId);
      expect(new Set(ids).size).toBe(ids.length);

      const explorer = buildAllCandidatesExplorerList(mockLeaderboard);
      expect(explorer).toHaveLength(2);
    });
  });

  describe("6. Adversarial False-PASS Resistance (Section 26: Mutations A–J)", () => {
    it("catches and rejects all 10 adversarial false-PASS mutations (A through J)", () => {
      const suite = runAdversarialFalsePassSuiteV12_4_3_2();
      expect(suite.mutations).toHaveLength(10);
      for (const m of suite.mutations) {
        expect(m.detectedAndRejected).toBe(true);
        expect(m.gateVerdictUnderMutation).toBe("FAIL");
      }
      expect(suite.allMutationsCaught).toBe(true);
    });

    it("enforces LIVE_ONLY isolation so cached ads never leak into LIVE_ONLY runs", () => {
      const cleanLiveOnly = evaluateLiveOnlyIsolation({
        sourceMode: "LIVE_ONLY",
        metaQueryExecuted: true,
        freshLiveAdsCount: 0,
        historicalCachedAdsCount: 0,
        observationsCount: 0,
      });
      expect(cleanLiveOnly.valid).toBe(true);

      const leakedLiveOnly = evaluateLiveOnlyIsolation({
        sourceMode: "LIVE_ONLY",
        metaQueryExecuted: true,
        freshLiveAdsCount: 0,
        historicalCachedAdsCount: 50,
        observationsCount: 50,
      });
      expect(leakedLiveOnly.valid).toBe(false);
    });
  });
});
