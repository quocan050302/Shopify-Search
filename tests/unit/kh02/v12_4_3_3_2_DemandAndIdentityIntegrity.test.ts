/**
 * SWAI KH-02 V12.4.3.3.2 — Authoritative Demand, Live Product Identity & Verified Top-3 Closure
 *
 * Test Suite:
 * 1. Demand cache authority, cache refresh, and provider status diagnostics (Phase B)
 * 2. Unverified cache does not block live queries when provider is available (Section 4.2)
 * 3. Authoritative fresh cache avoids redundant live queries (Section 4.2)
 * 4. Missing SERPAPI_API_KEY handled gracefully as NOT_CONFIGURED without data fabrication (Section 4.3)
 * 5. Broad category & promotional headline demand queries rejected from authoritative status (Section 4.4)
 * 6. Product identity verification & negative controls (Phase C, Section 5.1-5.3)
 * 7. Candidate recovery prioritizing VERIFIED physical products across distinct families (Section 5.2)
 * 8. Google Ads Transparency product-level vs brand-level association distinction (Phase D, Section 6)
 * 9. Runtime version parity and release version 12.4.3.3.2
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveProductDemandHistory,
  normalizeProductSearchTerm,
} from "@/services/kh02/demand/historicalDemandIngestion";
import { defaultDemandProvider } from "@/services/kh02/demand/demandProviderRegistry";
import {
  evaluateDemandSourceAuthority,
  evaluateDemandHistoryEvidence,
} from "@/services/kh02/demand/temporalDemandEngine";
import {
  resolveProductIdentity,
} from "@/services/kh02/identity/productIdentityResolver";
import {
  selectTopResearchShortlist,
  DiscoveredProductCandidate,
} from "@/services/kh02/identity/productCandidateDiscovery";
import {
  matchCrossPlatformProductEvidence,
} from "@/services/kh02/identity/crossPlatformProductMatcher";
import {
  SWAI_KH02_RELEASE_VERSION,
  evaluateKH02RuntimeIdentity,
} from "@/services/kh02/version/runtimeVersionService";

function makeCandidate(
  overrides: Record<string, any> = {}
): DiscoveredProductCandidate {
  return {
    candidateId: "cand_test_01",
    productKey: "test_product_key",
    title: "UAHPET Fresh Food Automatic Pet Feeder",
    canonicalProductName: "UAHPET Fresh Food Automatic Pet Feeder",
    displayName: "UAHPET Fresh Food Automatic Pet Feeder",
    brand: "UAHPET",
    category: "Pet Gadgets",
    storeDomain: "uahpet.com",
    canonicalProductUrl: "https://uahpet.com/products/fresh-feeder",
    problemStatement: null,
    targetAudience: null,
    thumbnailUrl: "https://uahpet.com/cdn/shop/feeder.jpg",
    relevanceScore: 92,
    relevanceStatus: "RELEVANT",
    productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
    identityStatus: "VERIFIED",
    sourcePageClassification: "ACTUAL_PRODUCT_PAGE",
    liveObservationsCount: 3,
    cachedObservationsCount: 0,
    totalObservationCount: 3,
    advertiserNames: ["UAHPET"],
    distinctAdvertisersCount: 1,
    supportingAdIds: ["ad_01", "ad_02"],
    supportingSourceTypes: ["META_ADS"],
    sourceObservations: [
      {
        source: "META_ADS",
        sourceRecordId: "meta_rec_01",
        sourceExternalAdId: "meta_ad_01",
        observedAt: new Date().toISOString(),
        title: "UAHPET Automatic Pet Feeder",
        provenance: "LIVE_PROVIDER",
      },
    ],
    matchedQueryIds: ["q_pet_gadgets_01"],
    ...overrides,
  } as any as DiscoveredProductCandidate;
}

describe("SWAI KH-02 V12.4.3.3.2 — Authoritative Demand, Identity & Top-3 Integrity", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("1. Runtime Version & Parity (V12.4.3.3.2)", () => {
    it("reports release version 12.4.3.3.2, 12.4.3.4.1, 12.4.3.4.2, 12.4.3.4.3, 12.4.3.4.4, 12.4.3.4.5, or 12.4.3.4.6", () => {
      expect(["12.4.3.3.2", "12.4.3.4.1", "12.4.3.4.2", "12.4.3.4.3", "12.4.3.4.4", "12.4.3.4.5", "12.4.3.4.6"]).toContain(SWAI_KH02_RELEASE_VERSION);
      const runtime = evaluateKH02RuntimeIdentity();
      expect(["12.4.3.3.2", "12.4.3.4.1", "12.4.3.4.2", "12.4.3.4.3", "12.4.3.4.4", "12.4.3.4.5", "12.4.3.4.6"]).toContain(runtime.releaseVersion);
    });
  });

  describe("2. Historical Demand Ingestion & Cache Behavior (Phase B)", () => {
    it("normalizes product search terms cleanly for Google Trends queries", () => {
      expect(
        normalizeProductSearchTerm("Facebook Ad: 2447113252478901 | Universal Folding Magnetic Car Mount")
      ).toBe("Universal Folding Magnetic Car Mount");

      expect(
        normalizeProductSearchTerm("UAHPET Dual Bowl Fresh Food Cat Feeder [50% OFF TODAY]")
      ).toBe("UAHPET Dual Bowl Fresh Food Cat Feeder");
    });

    it("evaluates unconfigured SERPAPI_API_KEY gracefully as NOT_CONFIGURED without throwing", async () => {
      process.env.DEMAND_PROVIDER_MODE = "SERPAPI_LEGACY";
      delete process.env.SERPAPI_API_KEY;

      const diag = await defaultDemandProvider.diagnose();
      expect(diag.status).toBe("NOT_CONFIGURED");
      expect(diag.configured).toBe(false);
      expect(diag.missingRequirements).toContain("SERPAPI_API_KEY");

      const res = await resolveProductDemandHistory(
        {
          canonicalName: "Universal Magnetic Car Mount",
          category: "Car Accessories",
        },
        { lookbackDays: 90, region: "US" }
      );

      expect(res.sourceStatus).toBe("ENGINE_READY");
      expect(res.cacheClassification).toBe("NO_VALID_DEMAND_EVIDENCE");
      expect(res.providerStatus).toBe("NOT_CONFIGURED");
      expect(res.providerAttempted).toBe(false);
      expect(res.coverageGaps.some((g) => g.includes("SERPAPI_API_KEY"))).toBe(true);
    });

    it("detects unbacked templated synthetic series [76, 79, 77, 81, 78, 82] as CACHED_UNVERIFIED", () => {
      const templatedSeries = [
        { demandValue: 76, periodStart: "2026-05-01T00:00:00Z", periodEnd: "2026-05-07T00:00:00Z", source: "google_trends_csv" },
        { demandValue: 79, periodStart: "2026-05-08T00:00:00Z", periodEnd: "2026-05-14T00:00:00Z", source: "google_trends_csv" },
        { demandValue: 77, periodStart: "2026-05-15T00:00:00Z", periodEnd: "2026-05-21T00:00:00Z", source: "google_trends_csv" },
        { demandValue: 81, periodStart: "2026-05-22T00:00:00Z", periodEnd: "2026-05-28T00:00:00Z", source: "google_trends_csv" },
        { demandValue: 78, periodStart: "2026-05-29T00:00:00Z", periodEnd: "2026-06-04T00:00:00Z", source: "google_trends_csv" },
        { demandValue: 82, periodStart: "2026-06-05T00:00:00Z", periodEnd: "2026-06-11T00:00:00Z", source: "google_trends_csv" },
      ];

      const auth = evaluateDemandSourceAuthority(templatedSeries as any);
      expect(auth.authority).toBe("CACHED_UNVERIFIED");
      expect(auth.reasons.some((r) => r.includes("[76, 79, 77, 81, 78, 82]"))).toBe(true);
    });

    it("detects broad category queries and rejects them as ESTIMATED_OR_PROXY", () => {
      const broadSeries = [
        { demandValue: 50, periodStart: "2026-05-01T00:00:00Z", periodEnd: "2026-05-07T00:00:00Z", keyword: "pet supplies", source: "authoritative_api" },
        { demandValue: 55, periodStart: "2026-05-08T00:00:00Z", periodEnd: "2026-05-14T00:00:00Z", keyword: "pet supplies", source: "authoritative_api" },
        { demandValue: 60, periodStart: "2026-05-15T00:00:00Z", periodEnd: "2026-05-21T00:00:00Z", keyword: "pet supplies", source: "authoritative_api" },
      ];

      const auth = evaluateDemandSourceAuthority(broadSeries as any, { searchTermUsed: "pet supplies" });
      expect(auth.authority).toBe("ESTIMATED_OR_PROXY");
      expect(auth.productAttributionValid).toBe(false);
    });

    it("verifies authoritative Google Trends observations with valid provider lineage", () => {
      const validSeries = [
        {
          demandValue: 65,
          periodStart: "2026-04-01T00:00:00Z",
          periodEnd: "2026-04-07T00:00:00Z",
          keyword: "automatic pet feeder",
          source: "Google Trends (SerpApi)",
          methodologyVersion: "serpapi_google_trends_live",
          evidenceReference: "DEMAND_API_INGESTION",
        },
        {
          demandValue: 70,
          periodStart: "2026-05-01T00:00:00Z",
          periodEnd: "2026-05-07T00:00:00Z",
          keyword: "automatic pet feeder",
          source: "Google Trends (SerpApi)",
          methodologyVersion: "serpapi_google_trends_live",
          evidenceReference: "DEMAND_API_INGESTION",
        },
        {
          demandValue: 75,
          periodStart: "2026-06-01T00:00:00Z",
          periodEnd: "2026-06-07T00:00:00Z",
          keyword: "automatic pet feeder",
          source: "Google Trends (SerpApi)",
          methodologyVersion: "serpapi_google_trends_live",
          evidenceReference: "DEMAND_API_INGESTION",
        },
      ];

      const auth = evaluateDemandSourceAuthority(validSeries as any);
      expect(auth.authority).toBe("AUTHORITATIVE_VERIFIED");
      expect(auth.productAttributionValid).toBe(true);

      const assessment = evaluateDemandHistoryEvidence(validSeries as any, {
        minimumDataPoints: 3,
        minimumCoveredDays: 60,
        requiredRegion: "US",
      });
      expect(assessment.status).toBe("VERIFIED");
    });
  });

  describe("3. Product Identity & Negative Controls (Phase C)", () => {
    it("uproot funnel URL without JSON-LD or OG title resolves as PROBABLE, not false VERIFIED", () => {
      const res = resolveProductIdentity({
        landingPageUrl: "https://cc.uprootclean.com/main/phr",
        storeDomain: "cc.uprootclean.com",
        brandOrAdvertiser: "Uproot Clean",
        rawHeadlines: ["Pet Hair Cleaner - Special Offer"],
        fetchOutcome: "MISSING_METADATA",
      });

      expect(res.identityStatus).toBe("PROBABLE");
      expect(res.resolutionHierarchyLevel).not.toBe(1);
    });

    it("Shopify merchant product page with JSON-LD resolves as VERIFIED", () => {
      const res = resolveProductIdentity({
        landingPageUrl: "https://www.uahpet.com/products/fresh-feeder",
        storeDomain: "uahpet.com",
        brandOrAdvertiser: "UAHPET",
        rawHeadlines: ["UAHPET Fresh Food Automatic Pet Feeder"],
        verifiedMerchantTitle: "UAHPET Fresh Food Automatic Pet Feeder",
        verifiedMerchantSku: "UAH-FEEDER-01",
        verifiedCanonicalUrl: "https://www.uahpet.com/products/fresh-feeder",
        fetchOutcome: "VERIFIED_PRODUCT_PAGE",
      });

      expect(res.identityStatus).toBe("VERIFIED");
      expect(res.canonicalProductName).toBe("UAHPET Fresh Food Automatic Pet Feeder");
    });
  });

  describe("4. Candidate Recovery & Shortlist Diversity (Section 5.2)", () => {
    it("selectTopResearchShortlist enforces distinct product families across top 3", () => {
      const candA = makeCandidate({
        candidateId: "cand_feeder_01",
        title: "UAHPET Automatic Pet Feeder",
        canonicalProductName: "UAHPET Automatic Pet Feeder",
        storeDomain: "uahpet.com",
        canonicalProductUrl: "https://uahpet.com/products/fresh-feeder",
        relevanceScore: 95,
      });

      const candB = makeCandidate({
        candidateId: "cand_fountain_01",
        title: "KittySpout Wireless Fountain",
        canonicalProductName: "KittySpout Wireless Fountain",
        storeDomain: "kittyspout.com",
        canonicalProductUrl: "https://kittyspout.com/products/wireless-fountain",
        relevanceScore: 90,
      });

      const candC = makeCandidate({
        candidateId: "cand_fountain_02",
        title: "Pawira Stainless Steel Water Fountain",
        canonicalProductName: "Pawira Stainless Steel Water Fountain",
        storeDomain: "pawira.com",
        canonicalProductUrl: "https://pawira.com/products/stainless-fountain",
        relevanceScore: 88, // Duplicate family with KittySpout
      });

      const candD = makeCandidate({
        candidateId: "cand_roller_01",
        title: "Livland Co. Reusable Pet Hair Remover Roller",
        canonicalProductName: "Livland Co. Reusable Pet Hair Remover Roller",
        storeDomain: "livlandco.com",
        canonicalProductUrl: "https://livlandco.com/products/pet-hair-remover-roller",
        relevanceScore: 82, // Distinct family (hair remover roller)
      });

      const shortlistRes = selectTopResearchShortlist([candA, candB, candC, candD], 3, {
        topic: "Pet Gadgets",
        executedQueryIds: ["q_pet_gadgets_01"],
      });

      expect(shortlistRes.shortlist.length).toBe(3);
      expect(shortlistRes.opportunityDiversity?.distinctFamilyCount).toBe(3);
      const families = shortlistRes.shortlist.map((c) => c.familyKey);
      expect(families).toContain("automatic_pet_feeder");
      expect(families).toContain("pet_water_fountain");
      expect(families).toContain("pet_hair_remover_roller");
    });
  });

  describe("5. Google Ads Transparency Product Association (Phase D)", () => {
    it("distinguishes product-specific creative match from brand-only match", () => {
      const candidate = makeCandidate({
        candidateId: "cand_fountain",
        title: "KittySpout Wireless Fountain",
        canonicalProductName: "KittySpout Wireless Fountain",
        storeDomain: "kittyspout.com",
        canonicalProductUrl: "https://kittyspout.com/products/wireless-fountain",
      });

      // Product-specific creative mentioning "fountain"
      const productCreativeMatch = matchCrossPlatformProductEvidence(candidate, {
        title: "KittySpout Wireless Cat Water Fountain - Ultra Quiet & Clean",
        url: "https://kittyspout.com/products/wireless-fountain",
        domain: "kittyspout.com",
        platform: "GOOGLE_ADS",
      });
      expect(productCreativeMatch.isProductSpecificEvidence).toBe(true);
      expect(productCreativeMatch.confidence).toBe("EXACT");

      // Brand-only creative without product terms
      const brandCreativeMatch = matchCrossPlatformProductEvidence(candidate, {
        title: "KittySpout Official Store | Premium Pet Care Essentials",
        url: "https://kittyspout.com",
        domain: "kittyspout.com",
        platform: "GOOGLE_ADS",
      });
      expect(brandCreativeMatch.isProductSpecificEvidence).toBe(false);
      expect(brandCreativeMatch.associationClassification).toBe("BRAND_ONLY_MATCH");
    });
  });
});
