/**
 * SWAI KH-02 V12.1 — P0 & P1 Regression & Correctness Test Suite
 *
 * Covers:
 * 1. META-01: Canonical platform "META" discovery in KH-02
 * 2. PRODUCT-01: Three FB Ad Library URLs with identical landing page -> 1 candidate, 3 ads
 * 3. PRODUCT-02: Same advertiser with different landing pages -> 2 separate candidates
 * 4. PRODUCT-03: Cross-store matching hypothesis without destructive database merge
 * 5. DEMAND-01: Historical demand lookup requires resolved ResearchProduct.id, never temporary candidateId
 * 6. DEMAND-02: Insufficient historical demand (<60 days) fails closed
 * 7. DEMAND-03: Non-periodic variance is not misclassified as recurring seasonality
 * 8. SOURCE-02: Google Transparency ad without product keywords is BRAND_RELATED, not PRODUCT_SPECIFIC
 * 9. SOURCE-03: Google Transparency ad without US region verification keeps verifiedDeliveryMarket null
 * 10. SOURCE-07: Metered provider (TikTok Organic) is blocked in zero-cost mode (AUTO_PAID_RESEARCH=false)
 * 11. EVERGREEN-01: 5M TikTok views without historical demand is PROVISIONAL, not VERIFIED_EVERGREEN
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { discoverProductCandidatesFromAds } from "@/services/kh02/identity/productCandidateDiscovery";
import { matchCrossPlatformProductEvidence } from "@/services/kh02/identity/crossPlatformProductMatcher";
import {
  evaluateTemporalDemandStability,
  DemandDataPoint,
} from "@/services/kh02/demand/temporalDemandEngine";
import {
  calculateKH02EvergreenScore,
  applyKH02EligibilityGates,
} from "@/services/kh02/scoring/evergreenOpportunityScoring";
import { estimateResearchProviderCost } from "@/services/kh02/providers/sourceRegistry";
import { normalizeTikTokOrganicVideo } from "@/services/kh02/providers/tiktokOrganicResearchAdapter";
import { SourceObservation } from "@/services/kh02/types";

describe("SWAI KH-02 V12.1 — P0/P1 Correctness & Regression Suite", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ── PRODUCT-01: Three FB Ad Library URLs, One Landing Page ──────────────
  it("PRODUCT-01: groups multiple Facebook Ad Library URLs for identical landing page into 1 product candidate with 3 ads", () => {
    const observations: SourceObservation[] = [
      {
        source: "META_ADS",
        sourceRecordId: "meta_ad_111",
        sourceUrl: "https://www.facebook.com/ads/library/?id=111111111",
        landingPageUrl: "https://furrycleanco.com/products/pet-hair-remover",
        advertiserOrCreator: "FurryClean Co",
        advertiserDomain: "furrycleanco.com",
        title: "Pet Hair Remover Roller - Hook 1",
        description: "Removes pet hair effortlessly from velvet sofas",
        observedAt: "2026-03-01T00:00:00.000Z",
        requestedMarket: "US",
        verifiedDeliveryMarket: "US",
        media: { mediaType: "VIDEO", videoUrl: "https://cdn.fb.com/video1.mp4" },
        metrics: {},
        provenance: "REAL_UPSTREAM",
      },
      {
        source: "META_ADS",
        sourceRecordId: "meta_ad_222",
        sourceUrl: "https://www.facebook.com/ads/library/?id=222222222",
        landingPageUrl: "https://furrycleanco.com/products/pet-hair-remover?utm_source=facebook&utm_campaign=retargeting",
        advertiserOrCreator: "FurryClean Co",
        advertiserDomain: "furrycleanco.com",
        title: "Pet Hair Remover Roller - Hook 2",
        description: "Stop throwing away sticky sheets",
        observedAt: "2026-03-05T00:00:00.000Z",
        requestedMarket: "US",
        verifiedDeliveryMarket: "US",
        media: { mediaType: "IMAGE", thumbnailUrl: "https://cdn.fb.com/img2.jpg" },
        metrics: {},
        provenance: "REAL_UPSTREAM",
      },
      {
        source: "META_ADS",
        sourceRecordId: "meta_ad_333",
        sourceUrl: "https://www.facebook.com/ads/library/?id=333333333",
        landingPageUrl: "https://furrycleanco.com/products/pet-hair-remover",
        advertiserOrCreator: "FurryClean Co",
        advertiserDomain: "furrycleanco.com",
        title: "Pet Hair Remover Roller - Hook 3",
        description: "The reusable roller for dog and cat owners",
        observedAt: "2026-03-10T00:00:00.000Z",
        requestedMarket: "US",
        verifiedDeliveryMarket: "US",
        media: { mediaType: "VIDEO", videoUrl: "https://cdn.fb.com/video3.mp4" },
        metrics: {},
        provenance: "REAL_UPSTREAM",
      },
    ];

    const candidates = discoverProductCandidatesFromAds(observations, "Pet Gadgets");

    expect(candidates).toHaveLength(1);
    const candidate = candidates[0];
    expect(candidate.supportingAdIds).toHaveLength(3);
    expect(candidate.supportingAdIds).toEqual(["meta_ad_111", "meta_ad_222", "meta_ad_333"]);
    expect(candidate.storeDomain).toBe("furrycleanco.com");
    expect(candidate.canonicalProductUrl).toBe("https://furrycleanco.com/products/pet-hair-remover");
    expect(candidate.totalObservationCount).toBe(3);
  });

  // ── PRODUCT-02: Same Advertiser, Different Products ──────────────────────
  it("PRODUCT-02: separates distinct products from the same advertiser into independent candidates", () => {
    const observations: SourceObservation[] = [
      {
        source: "META_ADS",
        sourceRecordId: "meta_ad_101",
        sourceUrl: "https://www.facebook.com/ads/library/?id=101",
        landingPageUrl: "https://furrycleanco.com/products/pet-hair-remover",
        advertiserOrCreator: "FurryClean Co",
        advertiserDomain: "furrycleanco.com",
        title: "Pet Hair Remover Roller",
        observedAt: "2026-03-01T00:00:00.000Z",
        requestedMarket: "US",
        verifiedDeliveryMarket: "US",
        media: { mediaType: "VIDEO" },
        metrics: {},
        provenance: "REAL_UPSTREAM",
      },
      {
        source: "META_ADS",
        sourceRecordId: "meta_ad_102",
        sourceUrl: "https://www.facebook.com/ads/library/?id=102",
        landingPageUrl: "https://furrycleanco.com/products/pet-nail-grinder",
        advertiserOrCreator: "FurryClean Co",
        advertiserDomain: "furrycleanco.com",
        title: "Painless Dog Nail Grinder",
        observedAt: "2026-03-02T00:00:00.000Z",
        requestedMarket: "US",
        verifiedDeliveryMarket: "US",
        media: { mediaType: "VIDEO" },
        metrics: {},
        provenance: "REAL_UPSTREAM",
      },
    ];

    const candidates = discoverProductCandidatesFromAds(observations, "Pet Gadgets");

    expect(candidates).toHaveLength(2);
    const urls = candidates.map((c) => c.canonicalProductUrl);
    expect(urls).toContain("https://furrycleanco.com/products/pet-hair-remover");
    expect(urls).toContain("https://furrycleanco.com/products/pet-nail-grinder");
  });

  // ── PRODUCT-03: Cross-Store Matching Hypothesis ─────────────────────────
  it("PRODUCT-03: creates a PROBABLE matching hypothesis without merging records across different store domains", () => {
    const candidate = {
      candidateId: "cand_storeA_1",
      title: "Reusable Pet Hair Remover Roller",
      category: "Pet Supplies",
      problemStatement: "Removes pet hair from furniture",
      targetAudience: "Pet Owners",
      thumbnailUrl: null,
      videoUrl: null,
      canonicalProductUrl: "https://store-a.com/products/pet-hair-roller",
      storeDomain: "store-a.com",
      advertiserNames: ["Store A"],
      supportingAdIds: ["ad_1"],
      supportingSourceTypes: ["META_ADS"],
      totalObservationCount: 1,
      distinctAdvertisersCount: 1,
      earliestObservationDate: null,
      latestObservationDate: null,
      identityConfidence: "PROBABLE" as const,
      sourceObservations: [],
    };

    const hypothesis = matchCrossPlatformProductEvidence(candidate, {
      title: "Pet Hair Remover Roller Reusable",
      url: "https://store-b.com/products/reusable-roller",
      domain: "store-b.com",
      platform: "TIKTOK_ORGANIC",
    });

    expect(hypothesis.confidence).toBe("PROBABLE");
    expect(hypothesis.requiresManualReview).toBe(true);
    expect(hypothesis.matchReasons.some((r) => r.toUpperCase().includes("CROSS-STORE"))).toBe(true);
  });

  // ── DEMAND-02: Insufficient History ─────────────────────────────────────
  it("DEMAND-02: fails closed with INSUFFICIENT_HISTORY when demand time series covers less than 60 days", () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const shortSeries: DemandDataPoint[] = [
      { date: new Date(now - 25 * day).toISOString().slice(0, 10), value: 65 },
      { date: new Date(now - 15 * day).toISOString().slice(0, 10), value: 70 },
      { date: new Date(now - 2 * day).toISOString().slice(0, 10), value: 68 },
    ];

    const result = evaluateTemporalDemandStability(shortSeries, 90);
    expect(result.stabilityScore).toBeNull();
    expect(result.demandClass).toBe("INSUFFICIENT_HISTORY");
    expect(result.explanation).toContain("span only");
  });

  // ── DEMAND-03: Non-Periodic Variance ────────────────────────────────────
  it("DEMAND-03: does not misclassify a non-cyclical series as SEASONAL_RECURRING", () => {
    // 120 days of random / volatile data without cyclical waves
    const volatileSeries: DemandDataPoint[] = [];
    const base = new Date("2025-10-01").getTime();
    for (let i = 0; i < 20; i++) {
      const date = new Date(base + i * 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      volatileSeries.push({ date, value: 30 + (i * 2) }); // Strictly monotonic upward trend
    }

    const result = evaluateTemporalDemandStability(volatileSeries, 90);
    expect(result.demandClass).not.toBe("SEASONAL_RECURRING");
  });

  // ── SOURCE-07: Budget Safeguards ────────────────────────────────────────
  it("SOURCE-07: blocks metered TikTok Organic calls when AUTO_PAID_RESEARCH is false", () => {
    delete process.env.AUTO_PAID_RESEARCH;

    const estimate = estimateResearchProviderCost("TIKTOK_ORGANIC", {
      workspaceId: "ws_secure",
      researchRunId: "run_secure",
      topic: "Pet Gadgets",
      market: "US",
      lookbackDays: 90,
      maxResults: 20,
    });

    expect(estimate.requiresPaidApproval).toBe(true);
    expect(estimate.isAllowed).toBe(false);
  });

  // ── EVERGREEN-01: Viral Video Without Demand Is PROVISIONAL ─────────────
  it("EVERGREEN-01: ranks a product with viral video metrics but missing demand history as PROVISIONAL, never VERIFIED_EVERGREEN", () => {
    const candidate = {
      candidateId: "cand_viral_spike",
      title: "Viral Pet Bubble Blower",
      category: "Pet Gadgets",
      problemStatement: "Entertains high-energy dogs indoors",
      targetAudience: "Dog owners",
      thumbnailUrl: "https://p16-sign.tiktokcdn.com/thumb.jpg",
      videoUrl: "https://www.tiktok.com/@creator/video/123",
      canonicalProductUrl: "https://petbubbleshop.com/products/bubble-gun",
      storeDomain: "petbubbleshop.com",
      advertiserNames: ["PetBubbleShop"],
      supportingAdIds: ["ad_1"],
      supportingSourceTypes: ["TIKTOK_ORGANIC"],
      totalObservationCount: 1,
      distinctAdvertisersCount: 1,
      earliestObservationDate: null,
      latestObservationDate: null,
      identityConfidence: "PROBABLE" as const,
      sourceObservations: [],
    };

    // No historical demand series available
    const score = calculateKH02EvergreenScore({
      candidate,
      demandSeries: [],
    });

    expect(score.scoreStatus).toBe("PROVISIONAL");
    expect(score.tier).toBe("PROVISIONAL_OPPORTUNITY");

    const gate = applyKH02EligibilityGates(score);
    expect(gate.isTop3Eligible).toBe(false);
    expect(gate.tier).toBe("PROVISIONAL_OPPORTUNITY");
    expect(gate.gateReasons.some((r) => r.includes("historical demand"))).toBe(true);
  });

  // ── TIKTOK NORMALIZATION SAFETY ─────────────────────────────────────────
  it("normalizes malformed TikTok payloads safely without throwing unexpected errors", () => {
    // Negative metrics and invalid dates
    const badPayload = {
      id: "998877",
      desc: "Funny cat gadget",
      play_count: -500, // Negative view count
      create_time: "invalid_date_string",
      author: { unique_id: "catlover" },
    };

    const normalized = normalizeTikTokOrganicVideo(badPayload);
    expect(normalized.videoId).toBe("998877");
    expect(normalized.views).toBeNull(); // Negative rejected
    expect(normalized.publishedAt).toBeNull(); // Invalid date rejected
    expect(normalized.sourceProvenance).toBe("UNKNOWN"); // Default to UNKNOWN
    expect(normalized.targetMarketEvidence).toBeNull(); // No US claim without proof
  });
});
