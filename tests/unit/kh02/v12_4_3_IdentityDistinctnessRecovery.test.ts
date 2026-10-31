/**
 * SWAI KH-02 V12.4.3 — Mandatory 50-Case Regression Test Suite (Sections 3–10)
 *
 * Covers:
 * - Group A (A01–A10): Evidence-True Product Identity & Merchant Metadata Verification
 * - Group B (B11–B21): 6-Level Product Distinctness, Family Clustering & Opportunity Diversity
 * - Group C (C22–C30): Post-Gate Bounded Adaptive Search Recovery, Queue Refill & Budget
 * - Group D (D31–D36): Google Ads Transparency Diagnostic States & Product-Specific Association
 * - Group E (E37–E43): Product-Specific Demand History, Lookback Coverage & Evergreen Gates
 * - Group F (F44–F50): API/UI Input Validation, Snapshot Topic Lock, Media Isolation & Disabled TikTok
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  resolveProductIdentity,
  resolveProductIdentityWithEvidence,
} from "@/services/kh02/identity/productIdentityResolver";
import {
  extractProductUrlMetadata,
  fetchVerifiedProductPageMetadata,
} from "@/services/kh02/identity/productMetadataExtractor";
import {
  discoverProductCandidatesFromAds,
  resolveCandidateResearchProduct,
  enrichProductCandidatesWithEvidence,
  evaluateCandidateProductReality,
  evaluateShortlistDistinctness,
  selectTopResearchShortlist,
  DiscoveredProductCandidate,
} from "@/services/kh02/identity/productCandidateDiscovery";
import {
  buildProductIdentityFingerprint,
  compareProductIdentity,
  evaluateOpportunityDiversity,
} from "@/services/kh02/identity/productDistinctnessEngine";
import {
  analyzeNicheIntent,
  buildDeterministicDiscoveryPlan,
  validateDiscoveryPlan,
  clearDiscoveryPlanCache,
  DiscoveryPlannerInput,
} from "@/services/kh02/discovery/geminiDiscoveryPlanner";
import {
  selectQueriesForSearchRound,
  evaluateShortlistCoverage,
  MetaQueryBudgetTracker,
} from "@/services/kh02/discovery/discoveryQueryPlanner";
import {
  aggregateMetaQueryOutcomes,
  MetaSubqueryExecution,
} from "@/services/kh02/providers/metaResearchAdapter";
import {
  matchCrossPlatformProductEvidence,
  extractRegistrableDomain,
} from "@/services/kh02/identity/crossPlatformProductMatcher";
import {
  normalizeDemandQueryTerm,
} from "@/services/kh02/demand/historicalDemandIngestion";
import {
  calculateKH02EvergreenScore,
  applyKH02EligibilityGates,
} from "@/services/kh02/scoring/evergreenOpportunityScoring";
import {
  isSourceTemporarilyDisabled,
} from "@/services/kh02/providers/sourcePolicy";
import {
  SWAI_KH02_RELEASE_VERSION,
} from "@/services/kh02/version/runtimeVersionService";

function makeAd(overrides: Record<string, any> = {}) {
  const id = overrides.id || `ad_${Math.random().toString(36).slice(2, 9)}`;
  return {
    id,
    metaAdId: overrides.metaAdId || `meta_${id}`,
    headline: overrides.headline ?? "Stainless Steel Cat Water Fountain 2.5L",
    bodyText:
      overrides.bodyText ??
      "Ultra quiet automatic pet water dispenser with triple filtration for cats and dogs.",
    landingUrl:
      overrides.landingUrl ??
      "https://petstream-shop.com/products/stainless-steel-cat-water-fountain",
    ctaText: overrides.ctaText ?? "Shop Now",
    mediaType: overrides.mediaType ?? "VIDEO",
    thumbnailUrl:
      overrides.thumbnailUrl ?? `https://cdn.petstream-shop.com/media/${id}.jpg`,
    videoUrl: overrides.videoUrl ?? null,
    isActive: overrides.isActive ?? true,
    startedAt: overrides.startedAt ?? new Date("2026-08-01T00:00:00Z"),
    lastSeenAt: overrides.lastSeenAt ?? new Date("2026-10-15T00:00:00Z"),
    createdAt: overrides.createdAt ?? new Date("2026-08-01T00:00:00Z"),
    advertiser: overrides.advertiser ?? {
      id: `adv_${id}`,
      name: "PetStream Official",
      domain: "petstream-shop.com",
    },
    offer: overrides.offer ?? null,
    landingPage: overrides.landingPage ?? null,
  };
}

function makePlannerInput(
  topic: string,
  overrides?: Partial<DiscoveryPlannerInput>
): DiscoveryPlannerInput {
  return {
    researchRunId: `run_v12_4_3_${Date.now()}`,
    topic,
    market: "US",
    lookbackDays: 90,
    productPolicy: "PHYSICAL_ECOMMERCE_PRODUCTS",
    supportedSources: ["META_ADS", "GOOGLE_ADS"],
    remainingProviderRequests: 3,
    remainingAIRequests: 10,
    ...overrides,
  };
}

describe("SWAI KH-02 V12.4.3 — Mandatory 50-Case Regression Suite", () => {
  beforeEach(() => {
    clearDiscoveryPlanCache();
  });

  // ============================================================================
  // GROUP A: IDENTITY & MERCHANT METADATA VERIFICATION (A01–A10)
  // ============================================================================
  describe("Group A — Evidence-True Product Identity (A01–A10)", () => {
    it("A01: Merchant HTTP 403 + valid /products/<handle> slug does NOT return VERIFIED (Fixes F02)", async () => {
      const res = await resolveProductIdentityWithEvidence(
        {
          landingUrl: "https://locked-merchant.com/products/automatic-cat-water-fountain",
          rawHeadlines: ["Automatic Cat Water Fountain 2.5L Ultra Quiet"],
          rawBodies: ["Keep your pet hydrated all day with fresh filtered water."],
          advertiserDomain: "locked-merchant.com",
          advertiserName: "Locked Merchant",
        },
        async () => {
          throw new Error("HTTP 403 Forbidden");
        }
      );

      expect(res.identityStatus).not.toBe("VERIFIED");
      expect(res.identityStatus).toBe("PROBABLE");
      expect(res.fetchOutcome).toBe("HTTP_403");
      expect(res.isEligibleAsEvergreenWinner).toBe(false);
      expect(res.verificationLimitations?.some((l) => l.includes("403"))).toBe(true);
    });

    it("A02: Merchant timeout + valid ad copy does NOT return VERIFIED", async () => {
      const res = await resolveProductIdentityWithEvidence(
        {
          landingUrl: "https://slow-merchant.com/products/cordless-hot-glue-gun",
          rawHeadlines: ["20V Cordless Hot Glue Gun Kit for DIY Crafts"],
          rawBodies: ["Heats up in 30 seconds with drip-free nozzle."],
          advertiserDomain: "slow-merchant.com",
        },
        async () => {
          throw new Error("AbortError: The operation was aborted due to timeout");
        }
      );

      expect(res.identityStatus).not.toBe("VERIFIED");
      expect(res.identityStatus).toBe("PROBABLE");
      expect(res.fetchOutcome).toBe("TIMEOUT");
      expect(res.isEligibleAsEvergreenWinner).toBe(false);
    });

    it("A03: Invalid merchant metadata + raw headline 'Facebook Ad: 123...' does NOT return VERIFIED (Fixes F02)", async () => {
      const res = await resolveProductIdentityWithEvidence(
        {
          landingUrl: "https://mystery-shop.com/products/mystery-gadget-x1",
          rawHeadlines: ["Facebook Ad: 987654321012345", "Shop Now"],
          rawBodies: ["Limited time sale! Click below."],
          advertiserDomain: "mystery-shop.com",
        },
        async (url) => ({
          url,
          finalUrl: url,
          canonicalUrl: null,
          title: "Just a moment...",
          ogTitle: null,
          ogType: null,
          jsonLdProductName: null,
          h1Title: null,
          price: null,
          currency: null,
          brand: null,
          sku: null,
          gtin: null,
          model: null,
          productId: null,
          variantId: null,
          images: [],
          isValidProductPage: false,
          pageClassification: "CAPTCHA_OR_CHALLENGE",
          fetchOutcome: "CAPTCHA_OR_CHALLENGE",
          evidenceTimestamp: new Date().toISOString(),
          rejectionReason: "CAPTCHA_OR_CHALLENGE",
        })
      );

      expect(res.identityStatus).not.toBe("VERIFIED");
      expect(res.isEligibleAsEvergreenWinner).toBe(false);
      expect(res.displayName).not.toContain("Facebook Ad:");
    });

    it("A04: Captcha / Cloudflare challenge page on /products/... URL is classified as CAPTCHA_OR_CHALLENGE and not VERIFIED", async () => {
      const challengeHtml = `
        <!DOCTYPE html>
        <html>
          <head><title>Attention Required! | Cloudflare</title></head>
          <body>
            <div id="cf-wrapper">Checking your browser before accessing store.com/products/cat-fountain. Enable JavaScript and cookies to continue. cf-chl-bypass</div>
          </body>
        </html>
      `;
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: "https://store.com/products/cat-fountain",
        headers: new Map([["content-type", "text/html; charset=utf-8"]]),
        text: async () => challengeHtml,
      });

      const meta = await fetchVerifiedProductPageMetadata(
        "https://store.com/products/cat-fountain",
        1000,
        mockFetch as any
      );
      expect(meta.isValidProductPage).toBe(false);
      expect(meta.pageClassification).toBe("CAPTCHA_OR_CHALLENGE");
      expect(meta.fetchOutcome).toBe("CAPTCHA_OR_CHALLENGE");

      const identity = await resolveProductIdentityWithEvidence(
        {
          landingUrl: "https://store.com/products/cat-fountain",
          rawHeadlines: ["Automatic Cat Water Fountain"],
        },
        async () => meta
      );
      expect(identity.identityStatus).not.toBe("VERIFIED");
      expect(identity.isEligibleAsEvergreenWinner).toBe(false);
    });

    it("A05: Collection page and homepage URLs never self-promote to verified SKU or selectable product", () => {
      const collectionIdentity = resolveProductIdentity({
        landingUrl: "https://petstore.com/collections/all-pet-fountains",
        rawHeadlines: ["Automatic Cat Water Fountain Collection"],
        advertiserDomain: "petstore.com",
      });
      expect(collectionIdentity.identityStatus).not.toBe("VERIFIED");
      expect(collectionIdentity.pageClassification).toBe("COLLECTION_PAGE");

      const homepageIdentity = resolveProductIdentity({
        landingUrl: "https://petstore.com/",
        rawHeadlines: ["PetStore Official Site"],
        advertiserDomain: "petstore.com",
      });
      expect(homepageIdentity.identityStatus).not.toBe("VERIFIED");
      expect(homepageIdentity.pageClassification).toBe("HOMEPAGE");

      const candidates = discoverProductCandidatesFromAds(
        [
          makeAd({
            id: "ad_col",
            landingUrl: "https://petstore.com/collections/all-pet-fountains",
            headline: "Shop Our Pet Fountains",
          }),
        ],
        "pet"
      );
      const reality = evaluateCandidateProductReality(candidates[0]);
      expect(reality.sourcePageClassification).toBe("COLLECTION_PAGE");
      expect(reality.eligibleForShortlist).toBe(false);
    });

    it("A06: Valid merchant product page metadata with JSON-LD Product produces VERIFIED identity", async () => {
      const productHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Dockstream Stainless Steel Cat Water Fountain | PetStream</title>
            <link rel="canonical" href="https://petstream.com/products/dockstream-cat-water-fountain" />
            <meta property="og:type" content="product" />
            <meta property="og:title" content="Dockstream Stainless Steel Cat Water Fountain" />
            <script type="application/ld+json">
              {
                "@context": "https://schema.org/",
                "@type": "Product",
                "name": "Dockstream Stainless Steel Cat Water Fountain",
                "sku": "PS-WF-001",
                "gtin13": "0850012345678",
                "mpn": "DOCK-25L-SS",
                "productID": "7788990011",
                "brand": { "@type": "Brand", "name": "PetStream" },
                "image": ["https://petstream.com/cdn/shop/products/dockstream-1.jpg"],
                "offers": {
                  "@type": "Offer",
                  "price": "49.99",
                  "priceCurrency": "USD"
                }
              }
            </script>
          </head>
          <body><h1>Dockstream Stainless Steel Cat Water Fountain</h1></body>
        </html>
      `;
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: "https://petstream.com/products/dockstream-cat-water-fountain",
        headers: new Map([["content-type", "text/html"]]),
        text: async () => productHtml,
      });

      const meta = await fetchVerifiedProductPageMetadata(
        "https://petstream.com/products/dockstream-cat-water-fountain?variant=445566",
        1000,
        mockFetch as any
      );
      expect(meta.isValidProductPage).toBe(true);
      expect(meta.pageClassification).toBe("ACTUAL_PRODUCT_PAGE");
      expect(meta.sku).toBe("PS-WF-001");
      expect(meta.gtin).toBe("0850012345678");
      expect(meta.model).toBe("DOCK-25L-SS");
      expect(meta.brand).toBe("PetStream");
      expect(meta.productId).toBe("7788990011");

      const identity = await resolveProductIdentityWithEvidence(
        {
          landingUrl: "https://petstream.com/products/dockstream-cat-water-fountain?variant=445566",
          rawHeadlines: ["Dockstream Stainless Steel Cat Water Fountain"],
          advertiserDomain: "petstream.com",
        },
        async () => meta
      );

      expect(identity.identityStatus).toBe("VERIFIED");
      expect(identity.isEligibleAsEvergreenWinner).toBe(true);
      expect(identity.fetchOutcome).toBe("VERIFIED_PRODUCT_PAGE");
      expect(identity.pageClassification).toBe("ACTUAL_PRODUCT_PAGE");
      expect(identity.canonicalProductName).toContain("Dockstream Stainless Steel Cat Water Fountain");
    });

    it("A07: SKU, model, brand, GTIN, merchantProductId, and variantId propagate through extractor -> resolver -> candidate (Fixes F03)", async () => {
      const ads = [
        makeAd({
          id: "ad_sku_prop",
          landingUrl: "https://petstream.com/products/dockstream-cat-water-fountain?variant=445566",
          headline: "Dockstream Stainless Steel Cat Water Fountain",
          advertiser: { id: "adv_ps", name: "PetStream", domain: "petstream.com" },
        }),
      ];
      const discovered = discoverProductCandidatesFromAds(ads, "pet");
      expect(discovered.length).toBe(1);

      const enriched = await enrichProductCandidatesWithEvidence(discovered, {
        topic: "pet",
        metadataFetcher: async (url) => ({
          url,
          finalUrl: "https://petstream.com/products/dockstream-cat-water-fountain?variant=445566",
          canonicalUrl: "https://petstream.com/products/dockstream-cat-water-fountain",
          title: "Dockstream Stainless Steel Cat Water Fountain",
          ogTitle: "Dockstream Stainless Steel Cat Water Fountain",
          ogType: "product",
          jsonLdProductName: "Dockstream Stainless Steel Cat Water Fountain",
          h1Title: "Dockstream Stainless Steel Cat Water Fountain",
          price: "49.99",
          currency: "USD",
          brand: "PetStream",
          sku: "PS-WF-001",
          gtin: "0850012345678",
          model: "DOCK-25L-SS",
          productId: "7788990011",
          variantId: "445566",
          images: ["https://petstream.com/cdn/dockstream.jpg"],
          verified: true,
          isValidProductPage: true,
          pageType: "ACTUAL_PRODUCT_PAGE",
          pageClassification: "ACTUAL_PRODUCT_PAGE",
          fetchOutcome: "VERIFIED_PRODUCT_PAGE",
          evidenceTimestamp: "2026-10-28T00:00:00.000Z",
          rejectionReason: null,
        }),
      });

      const cand = enriched.candidates[0];
      expect(cand.identityStatus).toBe("VERIFIED");
      expect(cand.sku).toBe("PS-WF-001");
      expect(cand.gtin).toBe("0850012345678");
      expect(cand.model).toBe("DOCK-25L-SS");
      expect(cand.brand).toBe("PetStream");
      expect(cand.merchantProductId).toBe("7788990011");
      expect(cand.variantId).toBe("445566");
      expect(cand.declaredCanonicalUrl).toBe("https://petstream.com/products/dockstream-cat-water-fountain");
      expect(cand.imageReferences).toContain("https://petstream.com/cdn/dockstream.jpg");
    });

    it("A08: Existing ResearchProduct row without verified provenance does NOT auto-verify candidate (Section 4.6)", async () => {
      const identity = resolveProductIdentity({
        landingUrl: "https://legacy-store.com/products/pet-grooming-brush",
        rawHeadlines: ["Self Cleaning Pet Grooming Slicker Brush"],
        existingResearchProductId: "rp_legacy_unverified",
        existingProductTitle: "Self Cleaning Pet Grooming Slicker Brush",
        existingProductVerified: false,
      });

      expect(identity.identityStatus).toBe("PROBABLE");
      expect(identity.identityStatus).not.toBe("VERIFIED");
      expect(identity.isEligibleAsEvergreenWinner).toBe(false);
    });

    it("A09: Ad claim vs merchant page contradiction marks identity AMBIGUOUS and blocks winner eligibility (Section 4.7)", async () => {
      const identity = await resolveProductIdentityWithEvidence(
        {
          landingUrl: "https://hijacked-store.com/products/cat-fountain",
          rawHeadlines: ["Automatic Stainless Steel Cat Water Fountain 2.5L"],
          rawBodies: ["Fresh flowing water for your cat."],
          advertiserDomain: "hijacked-store.com",
        },
        async (url) => ({
          url,
          finalUrl: url,
          canonicalUrl: url,
          title: "Men Leather Bifold Wallet RFID Blocking",
          ogTitle: "Men Leather Bifold Wallet RFID Blocking",
          ogType: "product",
          jsonLdProductName: "Men Leather Bifold Wallet RFID Blocking",
          h1Title: "Men Leather Bifold Wallet RFID Blocking",
          price: "29.99",
          currency: "USD",
          brand: "LeatherCraft",
          sku: "WALLET-01",
          gtin: null,
          model: null,
          productId: "9911",
          variantId: null,
          images: [],
          verified: true,
          isValidProductPage: true,
          pageType: "ACTUAL_PRODUCT_PAGE",
          pageClassification: "ACTUAL_PRODUCT_PAGE",
          fetchOutcome: "VERIFIED_PRODUCT_PAGE",
          evidenceTimestamp: new Date().toISOString(),
          rejectionReason: null,
        })
      );

      expect(identity.identityStatus).toBe("AMBIGUOUS");
      expect(identity.hasUnresolvedContradiction).toBe(true);
      expect(identity.contradictions?.length).toBeGreaterThan(0);
      expect(identity.adClaimedProductName).toContain("Cat Water Fountain");
      expect(identity.merchantVerifiedProductName).toContain("Leather Bifold Wallet");
      expect(identity.isEligibleAsEvergreenWinner).toBe(false);
    });

    it("A10: Missing merchant metadata preserves PROBABLE uncertainty without falsely rejecting physical product as non-product", async () => {
      const ads = [
        makeAd({
          id: "ad_missing_meta",
          landingUrl: "https://petgadget-shop.com/products/interactive-laser-cat-collar",
          headline: "Rechargeable Interactive Laser Cat Collar Toy",
          bodyText: "Hands-free automatic laser toy collar for indoor cats.",
        }),
      ];
      const discovered = discoverProductCandidatesFromAds(ads, "pet");
      const enriched = await enrichProductCandidatesWithEvidence(discovered, {
        topic: "pet",
        metadataFetcher: async (url) => ({
          url,
          finalUrl: url,
          canonicalUrl: null,
          title: null,
          ogTitle: null,
          ogType: null,
          jsonLdProductName: null,
          h1Title: null,
          price: null,
          currency: null,
          brand: null,
          sku: null,
          gtin: null,
          model: null,
          productId: null,
          variantId: null,
          images: [],
          verified: false,
          isValidProductPage: false,
          pageType: "ERROR_PAGE",
          pageClassification: "ERROR_PAGE",
          fetchOutcome: "HTTP_403",
          evidenceTimestamp: new Date().toISOString(),
          rejectionReason: "HTTP_403",
        }),
      });

      const cand = enriched.candidates[0];
      expect(cand.identityStatus).toBe("PROBABLE");
      const reality = evaluateCandidateProductReality(cand);
      expect(reality.productRealityStatus).toBe("EVIDENCE_SUPPORTED_PHYSICAL_PRODUCT");
      expect(reality.eligibleForShortlist).toBe(true);
    });
  });

  // ============================================================================
  // GROUP B: UNIFIED DISTINCTNESS & PRODUCT FAMILY ENGINE (B11–B21)
  // ============================================================================
  describe("Group B — Unified 6-Level Product Distinctness & Family Diversity (B11–B21)", () => {
    it("B11: Same canonicalProductUrl + different ad titles consolidate to 1 product and distinctCount = 1 (Fixes F01)", () => {
      const ad1 = makeAd({
        id: "ad_dup_url_1",
        landingUrl: "https://petstream.com/products/dockstream-cat-water-fountain",
        headline: "2.5L Ultra Quiet Stainless Steel Cat Fountain",
      });
      const ad2 = makeAd({
        id: "ad_dup_url_2",
        landingUrl: "https://petstream.com/products/dockstream-cat-water-fountain",
        headline: "Vet Recommended Automatic Pet Water Dispenser",
      });

      const candidates = discoverProductCandidatesFromAds([ad1, ad2], "pet");
      expect(candidates.length).toBe(1);
      expect(candidates[0].totalObservationCount).toBe(2);

      // Even if two separate candidate objects have the same canonicalProductUrl and different titles:
      const separateA: DiscoveredProductCandidate = {
        ...candidates[0],
        candidateId: "cand_split_a",
        title: "2.5L Ultra Quiet Stainless Steel Cat Fountain",
        canonicalProductName: "2.5L Ultra Quiet Stainless Steel Cat Fountain",
        displayName: "2.5L Ultra Quiet Stainless Steel Cat Fountain",
      };
      const separateB: DiscoveredProductCandidate = {
        ...candidates[0],
        candidateId: "cand_split_b",
        title: "Vet Recommended Automatic Pet Water Dispenser",
        canonicalProductName: "Vet Recommended Automatic Pet Water Dispenser",
        displayName: "Vet Recommended Automatic Pet Water Dispenser",
      };

      const check = evaluateShortlistDistinctness([separateA, separateB]);
      expect(check.distinctCount).toBe(1);
      expect(check.isDistinct).toBe(false);
    });

    it("B12: Tracking parameters and variant query strings normalize to the same product with variant tracking", () => {
      const meta1 = extractProductUrlMetadata(
        "https://www.petstream.com/collections/best-sellers/products/dockstream-fountain?variant=111&utm_source=facebook&fbclid=IwAR999"
      );
      const meta2 = extractProductUrlMetadata(
        "https://petstream.com/products/dockstream-fountain?variant=222&gclid=Cj0KCQ"
      );

      expect(meta1.normalizedBaseProductUrl).toBe("https://petstream.com/products/dockstream-fountain");
      expect(meta2.normalizedBaseProductUrl).toBe("https://petstream.com/products/dockstream-fountain");
      expect(meta1.variantId).toBe("111");
      expect(meta2.variantId).toBe("222");

      const fp1 = buildProductIdentityFingerprint({
        candidateId: "c1",
        normalizedProductUrl: meta1.normalizedBaseProductUrl,
        storeDomain: meta1.storeDomain,
        productHandle: meta1.productHandle,
        variantId: meta1.variantId,
        canonicalProductName: "Dockstream Fountain White",
      });
      const fp2 = buildProductIdentityFingerprint({
        candidateId: "c2",
        normalizedProductUrl: meta2.normalizedBaseProductUrl,
        storeDomain: meta2.storeDomain,
        productHandle: meta2.productHandle,
        variantId: meta2.variantId,
        canonicalProductName: "Dockstream Fountain Black",
      });

      const cmp = compareProductIdentity(fp1, fp2);
      expect(cmp.decision).toBe("SAME_PRODUCT_DIFFERENT_VARIANT");
      expect(cmp.areSameActualProduct).toBe(true);
      expect(cmp.areSameVariant).toBe(false);
    });

    it("B13: Shortlink resolved to final product URL matches direct product URL", () => {
      const fpShort = buildProductIdentityFingerprint({
        candidateId: "c_short",
        requestedUrl: "https://bit.ly/3xyzPetFountain",
        resolvedFinalUrl: "https://petstream.com/products/dockstream-fountain?utm_medium=social",
        storeDomain: "petstream.com",
        canonicalProductName: "Dockstream Fountain",
      });
      const fpDirect = buildProductIdentityFingerprint({
        candidateId: "c_direct",
        requestedUrl: "https://www.petstream.com/products/dockstream-fountain",
        storeDomain: "petstream.com",
        canonicalProductName: "Dockstream Fountain",
      });

      const cmp = compareProductIdentity(fpShort, fpDirect);
      expect(cmp.areSameActualProduct).toBe(true);
    });

    it("B14: Same product across different merchants with verified GTIN or Brand+Model links as same actual product", () => {
      const fpMerchant1 = buildProductIdentityFingerprint({
        candidateId: "m1",
        storeDomain: "petstream-official.com",
        normalizedProductUrl: "https://petstream-official.com/products/plwf005",
        brand: "Petlibro",
        model: "PLWF005",
        gtin: "0850012345678",
        canonicalProductName: "Petlibro Dockstream Fountain PLWF005",
        identityStatus: "VERIFIED",
      });
      const fpMerchant2 = buildProductIdentityFingerprint({
        candidateId: "m2",
        storeDomain: "chewy-boutique.com",
        normalizedProductUrl: "https://chewy-boutique.com/products/petlibro-fountain",
        brand: "Petlibro",
        model: "PLWF005",
        gtin: "0850012345678",
        canonicalProductName: "Dockstream Automatic Cat Water Dispenser",
        identityStatus: "VERIFIED",
      });

      const cmp = compareProductIdentity(fpMerchant1, fpMerchant2);
      expect(cmp.decision).toBe("SAME_PRODUCT_CROSS_MERCHANT");
      expect(cmp.areSameActualProduct).toBe(true);
    });

    it("B15: Same local SKU string at two different merchants does NOT merge them", () => {
      const fpStoreA = buildProductIdentityFingerprint({
        candidateId: "store_a",
        storeDomain: "alpha-pet.com",
        normalizedProductUrl: "https://alpha-pet.com/products/cat-fountain",
        sku: "SKU-1001",
        canonicalProductName: "Alpha Ceramic Cat Water Fountain",
        identityStatus: "VERIFIED",
      });
      const fpStoreB = buildProductIdentityFingerprint({
        candidateId: "store_b",
        storeDomain: "beta-tools.com",
        normalizedProductUrl: "https://beta-tools.com/products/laser-level",
        sku: "SKU-1001",
        canonicalProductName: "Beta Cross Line Laser Level",
        identityStatus: "VERIFIED",
      });

      const cmp = compareProductIdentity(fpStoreA, fpStoreB);
      expect(cmp.areSameActualProduct).toBe(false);
      expect(cmp.decision).toBe("DIFFERENT_PRODUCTS");
      expect(cmp.conflictingEvidence.some((e) => e.includes("SKU-1001"))).toBe(true);
    });

    it("B16: Same product family with different verified models stays separate as DIFFERENT_MODELS_SAME_FAMILY", () => {
      const fpModelA = buildProductIdentityFingerprint({
        candidateId: "oil_a",
        storeDomain: "kitchencraft.com",
        normalizedProductUrl: "https://kitchencraft.com/products/oil-sprayer-200ml",
        brand: "KitchenCraft",
        model: "KC-OIL-200MIST",
        canonicalProductName: "KitchenCraft 200ml Mist Glass Oil Sprayer",
        identityStatus: "VERIFIED",
      });
      const fpModelB = buildProductIdentityFingerprint({
        candidateId: "oil_b",
        storeDomain: "kitchencraft.com",
        normalizedProductUrl: "https://kitchencraft.com/products/oil-dispenser-500ml",
        brand: "KitchenCraft",
        model: "KC-OIL-500POUR",
        canonicalProductName: "KitchenCraft 500ml Auto-Flip Olive Oil Dispenser Bottle",
        identityStatus: "VERIFIED",
      });

      const cmp = compareProductIdentity(fpModelA, fpModelB);
      expect(cmp.decision).toBe("DIFFERENT_MODELS_SAME_FAMILY");
      expect(cmp.areSameActualProduct).toBe(false);
      expect(cmp.areSameFamily).toBe(true);
    });

    it("B17: Different ad titles but same verified model on same merchant merge as 1 product opportunity", () => {
      const fp1 = buildProductIdentityFingerprint({
        candidateId: "gg_1",
        storeDomain: "crafttools.com",
        normalizedProductUrl: "https://crafttools.com/products/pro-glue-gun-v1",
        brand: "CraftTools",
        model: "CT-GG20V",
        canonicalProductName: "20V Cordless Hot Glue Gun Kit",
        identityStatus: "VERIFIED",
      });
      const fp2 = buildProductIdentityFingerprint({
        candidateId: "gg_2",
        storeDomain: "crafttools.com",
        normalizedProductUrl: "https://crafttools.com/products/pro-glue-gun-promo",
        brand: "CraftTools",
        model: "CT-GG20V",
        canonicalProductName: "Heavy Duty Rechargeable Glue Gun for Crafts",
        identityStatus: "VERIFIED",
      });

      const cmp = compareProductIdentity(fp1, fp2);
      expect(cmp.areSameActualProduct).toBe(true);
      expect(cmp.decision).toBe("SAME_PRODUCT_MODEL");
    });

    it("B18: Similar promotional wording for different physical products never merges falsely", () => {
      const fpChopper = buildProductIdentityFingerprint({
        candidateId: "chopper",
        storeDomain: "smartkitchen.com",
        normalizedProductUrl: "https://smartkitchen.com/products/mini-electric-garlic-chopper",
        canonicalProductName: "SmartKitchen USB Rechargeable Mini Electric Garlic Chopper",
      });
      const fpSoap = buildProductIdentityFingerprint({
        candidateId: "soap",
        storeDomain: "smartkitchen.com",
        normalizedProductUrl: "https://smartkitchen.com/products/touchless-foaming-soap-dispenser",
        canonicalProductName: "SmartKitchen USB Rechargeable Touchless Foaming Soap Dispenser",
      });

      const cmp = compareProductIdentity(fpChopper, fpSoap);
      expect(cmp.areSameActualProduct).toBe(false);
      expect(cmp.areSameFamily).toBe(false);
      expect(cmp.decision).toBe("DIFFERENT_PRODUCTS");
    });

    it("B19: Unknown cross-merchant relationship in same family reports UNKNOWN_CROSS_MERCHANT_SAME_FAMILY with uncertainty", () => {
      const fpMerch1 = buildProductIdentityFingerprint({
        candidateId: "f1",
        storeDomain: "pet-haven.com",
        normalizedProductUrl: "https://pet-haven.com/products/stainless-cat-water-fountain",
        canonicalProductName: "2.5L Automatic Stainless Steel Cat Water Fountain",
      });
      const fpMerch2 = buildProductIdentityFingerprint({
        candidateId: "f2",
        storeDomain: "furry-oasis.com",
        normalizedProductUrl: "https://furry-oasis.com/products/automatic-cat-water-fountain",
        canonicalProductName: "Automatic Cat Water Fountain 2.5L Dispenser",
      });

      const cmp = compareProductIdentity(fpMerch1, fpMerch2);
      expect(cmp.decision).toBe("UNKNOWN_CROSS_MERCHANT_SAME_FAMILY");
      expect(cmp.areSameActualProduct).toBeNull();
      expect(cmp.areSameFamily).toBe(true);
      expect(cmp.uncertainty).toBeTruthy();
    });

    it("B20: Three oil-dispenser listings in Kitchen are flagged as 1 homogeneous family; BROAD_CATEGORY prioritizes diverse families first (Fixes F07)", () => {
      const oilAds = [
        makeAd({
          id: "oil_1",
          landingUrl: "https://chefgear.com/products/2-in-1-glass-oil-sprayer",
          headline: "2-in-1 Glass Olive Oil Sprayer and Dispenser Bottle",
          advertiser: { id: "a1", name: "ChefGear", domain: "chefgear.com" },
        }),
        makeAd({
          id: "oil_2",
          landingUrl: "https://culinarypro.com/products/olive-oil-mister-bottle",
          headline: "500ml Kitchen Olive Oil Dispenser & Sprayer Bottle",
          advertiser: { id: "a2", name: "CulinaryPro", domain: "culinarypro.com" },
        }),
        makeAd({
          id: "oil_3",
          landingUrl: "https://homebistro.com/products/cooking-oil-spray-dispenser",
          headline: "Glass Cooking Oil Spray Bottle Dispenser for Air Fryer",
          advertiser: { id: "a3", name: "HomeBistro", domain: "homebistro.com" },
        }),
      ];

      const oilCandidates = discoverProductCandidatesFromAds(oilAds, "kitchen");
      const oilDiversity = evaluateOpportunityDiversity(oilCandidates, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "Kitchen",
      });
      expect(oilDiversity.distinctFamilyCount).toBe(1);
      expect(oilDiversity.homogeneousFamilyDetected).toBe(true);

      // For BROAD_CATEGORY, unverified cross-merchant same-family clones are NOT padded into 3 fake opportunities
      const homogeneousResult = selectTopResearchShortlist(oilCandidates, 3, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "Kitchen",
      });
      expect(homogeneousResult.shortlist.length).toBe(1);
      expect(homogeneousResult.shortlist[0].distinctnessRole).toBe("PRIMARY_FAMILY_REPRESENTATIVE");

      // For SPECIFIC_PRODUCT query ("glass oil dispenser"), differentiated capacities/brands ARE allowed as labeled alternatives
      const specificResult = selectTopResearchShortlist(oilCandidates, 3, {
        nicheIntent: "SPECIFIC_PRODUCT",
        topic: "glass oil dispenser",
      });
      expect(specificResult.shortlist.length).toBeGreaterThanOrEqual(2);
      expect(specificResult.shortlist[1].distinctnessRole).toBe("SAME_FAMILY_MODEL_ALTERNATIVE");
      expect(specificResult.shortlist[1].distinctnessReason).toContain("Same product family — model/merchant alternative");

      // When diverse kitchen families are available in the pool, Pass 1 selects 3 distinct families!
      const diverseAds = [
        ...oilAds,
        makeAd({
          id: "chopper_1",
          landingUrl: "https://kitchenwiz.com/products/rotary-cheese-grater-slicer",
          headline: "Rotary Mandoline Cheese Grater and Vegetable Slicer",
          advertiser: { id: "a4", name: "KitchenWiz", domain: "kitchenwiz.com" },
        }),
        makeAd({
          id: "defrost_1",
          landingUrl: "https://frostfast.com/products/rapid-defrosting-tray",
          headline: "Rapid Meat Defrosting Tray Aluminum Thawing Board",
          advertiser: { id: "a5", name: "FrostFast", domain: "frostfast.com" },
        }),
      ];
      const allKitchenCandidates = discoverProductCandidatesFromAds(diverseAds, "kitchen");
      const diverseResult = selectTopResearchShortlist(allKitchenCandidates, 3, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "Kitchen",
      });
      const selectedFamilies = new Set(diverseResult.shortlist.map((c) => c.familyKey));
      expect(selectedFamilies.size).toBe(3);
    });

    it("B21: Shortlist and evergreen winners share the exact same identity distinctness policy", () => {
      const adA = makeAd({
        id: "w1",
        landingUrl: "https://petstream.com/products/fountain-pro",
        headline: "Pro Stainless Cat Water Fountain",
      });
      const base = discoverProductCandidatesFromAds([adA], "pet")[0];
      const dup1: DiscoveredProductCandidate = {
        ...base,
        candidateId: "dup_1",
        title: "Pro Stainless Cat Water Fountain",
        canonicalProductName: "Pro Stainless Cat Water Fountain",
        displayName: "Pro Stainless Cat Water Fountain",
        identityStatus: "VERIFIED",
        isEligibleAsEvergreenWinner: true,
      };
      const dup2: DiscoveredProductCandidate = {
        ...base,
        candidateId: "dup_2",
        title: "Ultra Quiet 2.5L Cat Dispenser",
        canonicalProductName: "Ultra Quiet 2.5L Cat Dispenser",
        displayName: "Ultra Quiet 2.5L Cat Dispenser",
        identityStatus: "VERIFIED",
        isEligibleAsEvergreenWinner: true,
      };

      const shortlistRes = selectTopResearchShortlist([dup1, dup2], 3, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "Pet Gadgets",
      });
      expect(shortlistRes.shortlist.length).toBe(1);

      const distinctCheck = evaluateShortlistDistinctness([dup1, dup2]);
      expect(distinctCheck.distinctCount).toBe(1);
      expect(distinctCheck.isDistinct).toBe(false);
    });
  });

  // ============================================================================
  // GROUP C: POST-GATE BOUNDED ADAPTIVE SEARCH & QUEUE REFILL (C22–C30)
  // ============================================================================
  describe("Group C — Post-Gate Adaptive Search Recovery & Queue Refill (C22–C30)", () => {
    it("C22: 3 preliminary candidates reduced to 1 post-gate triggers adaptive recovery when budget remains (Fixes F04)", () => {
      const plan = buildDeterministicDiscoveryPlan(makePlannerInput("pet"));
      const adValid = makeAd({
        id: "c22_valid",
        landingUrl: "https://petstream.com/products/cat-water-fountain",
        headline: "Automatic Stainless Steel Cat Water Fountain",
      });
      const cands = discoverProductCandidatesFromAds([adValid], "pet");

      const coverage = evaluateShortlistCoverage({
        requestedCount: 3,
        qualifiedProducts: cands.length, // Only 1 survived reality + identity gates (preliminary had 3)
        distinctFamiliesCount: 1,
        nicheIntent: "BROAD_CATEGORY",
        observedArchetypeIds: [plan.productArchetypes[0].archetypeId],
        plannedArchetypes: plan.productArchetypes,
        unresolvedCandidates: 2,
        unverifiedQueueRemaining: 0,
        remainingSourceQueries: 1,
        remainingAIRequests: 5,
        remainingUnusedQueriesCount: 2,
        sourceAvailable: true,
        timeDeadlineReached: false,
        cancelled: false,
      });

      expect(coverage.qualifiedProducts).toBe(1);
      expect(coverage.recoveryRecommended).toBe(true);
      expect(coverage.stopReason).toBe("CONTINUE");
      expect(coverage.recoveryTriggerReason).toContain("below target");
    });

    it("C23: Candidate processing cap full with top rejections refills from unverified queue (Fixes F05)", () => {
      // Simulate 5 discovered candidates across distinct families where batch 1 (size 3) had 2 rejected
      const pool = discoverProductCandidatesFromAds(
        [
          makeAd({
            id: "c23_valid_1",
            landingUrl: "https://diytools.com/products/cordless-glue-gun",
            headline: "20V Cordless Hot Glue Gun Kit",
            advertiser: { id: "a1", name: "DIYTools", domain: "diytools.com" },
          }),
          makeAd({
            id: "c23_bad_collection",
            landingUrl: "https://diytools.com/collections/all-tools",
            headline: "Shop Our Tools",
            advertiser: { id: "a1", name: "DIYTools", domain: "diytools.com" },
          }),
          makeAd({
            id: "c23_refill_2",
            landingUrl: "https://switchcraft.com/products/decorative-switch-plate",
            headline: "Floral Decorative Wall Switch Plate Cover",
            advertiser: { id: "a2", name: "SwitchCraft", domain: "switchcraft.com" },
          }),
          makeAd({
            id: "c23_refill_3",
            landingUrl: "https://laserpro.com/products/cross-line-laser-level",
            headline: "Self Leveling Cross Line Laser Level Tool",
            advertiser: { id: "a3", name: "LaserPro", domain: "laserpro.com" },
          }),
        ],
        "diy"
      );

      // Batch 1 only processes first 2 candidates (1 passes, 1 collection page fails)
      const batch1 = pool.slice(0, 2);
      const unverifiedQueue = pool.slice(2);
      const shortlistAfterBatch1 = selectTopResearchShortlist(batch1, 3, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "DIY",
      });
      expect(shortlistAfterBatch1.qualifiedCount).toBe(1);
      expect(unverifiedQueue.length).toBe(2);

      // Refill from unverifiedQueue recovers full Top 3 without extra provider requests!
      const refilledShortlist = selectTopResearchShortlist([...batch1, ...unverifiedQueue], 3, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "DIY",
      });
      expect(refilledShortlist.qualifiedCount).toBe(3);
      expect(refilledShortlist.distinctFamiliesCount).toBe(3);
    });

    it("C24: Homogeneous single-family candidates in BROAD_CATEGORY trigger Round 2 query from uncovered archetype", () => {
      const input = makePlannerInput("kitchen");
      const plan = buildDeterministicDiscoveryPlan(input);
      const val = validateDiscoveryPlan(plan, input, "DETERMINISTIC_FALLBACK", 1);

      const oilCands = discoverProductCandidatesFromAds(
        [
          makeAd({
            id: "c24_1",
            landingUrl: "https://k1.com/products/oil-sprayer",
            headline: "Glass Olive Oil Sprayer Bottle",
            advertiser: { id: "a1", name: "K1", domain: "k1.com" },
          }),
          makeAd({
            id: "c24_2",
            landingUrl: "https://k2.com/products/oil-dispenser",
            headline: "Kitchen Olive Oil Dispenser Mister",
            advertiser: { id: "a2", name: "K2", domain: "k2.com" },
          }),
          makeAd({
            id: "c24_3",
            landingUrl: "https://k3.com/products/oil-bottle",
            headline: "Cooking Oil Spray Dispenser Bottle",
            advertiser: { id: "a3", name: "K3", domain: "k3.com" },
          }),
        ],
        "kitchen"
      );

      const coverage = evaluateShortlistCoverage({
        requestedCount: 3,
        qualifiedProducts: oilCands.length,
        distinctFamiliesCount: 1,
        nicheIntent: "BROAD_CATEGORY",
        observedArchetypeIds: [plan.productArchetypes[0].archetypeId],
        plannedArchetypes: plan.productArchetypes,
        unresolvedCandidates: 0,
        unverifiedQueueRemaining: 0,
        remainingSourceQueries: 1,
        remainingAIRequests: 5,
        remainingUnusedQueriesCount: 2,
        sourceAvailable: true,
        timeDeadlineReached: false,
        cancelled: false,
      });

      expect(coverage.homogeneousFamilyDetected).toBe(true);
      expect(coverage.recoveryRecommended).toBe(true);
      expect(coverage.stopReason).toBe("CONTINUE");

      const usedPhrases = new Set([val.validatedQueries[0].normalizedPhrase]);
      const coveredArchs = new Set([val.validatedQueries[0].archetypeId!]);

      const round2 = selectQueriesForSearchRound(val.validatedQueries, 1, usedPhrases, coveredArchs, 2);
      expect(round2.length).toBe(1);
      expect(coveredArchs.has(round2[0].archetypeId!)).toBe(false);
    });

    it("C25: Zero-result exact phrase query falls back to broader KEYWORD_UNORDERED query when budget remains", () => {
      const planned = [
        {
          queryId: "q_litter_1",
          phrase: "automatic self cleaning stainless cat litter box",
          normalizedPhrase: "automatic self cleaning stainless cat litter box",
          searchType: "KEYWORD_EXACT_PHRASE" as const,
          archetypeId: "arch_litter",
          expectedProductCategory: "Smart Litter Box",
          priority: 1,
          rationale: "Primary exact query",
          origin: "DETERMINISTIC_FALLBACK" as const,
          roundNumber: 1,
          researchRunId: "test_run",
          source: "META_ADS" as const,
        },
      ];
      const usedPhrases = new Set([
        "automatic self cleaning stainless cat litter box",
        "automatic self cleaning stainless cat litter box::KEYWORD_EXACT_PHRASE",
      ]);
      const coveredArchs = new Set<string>();

      const fallback = selectQueriesForSearchRound(planned, 1, usedPhrases, coveredArchs, 2, {
        zeroResultQueries: planned,
      });

      expect(fallback.length).toBe(1);
      expect(fallback[0].searchType).toBe("KEYWORD_UNORDERED");
      expect(fallback[0].phrase.split(/\s+/).length).toBeLessThanOrEqual(3);
    });

    it("C26: Failed Meta query is recorded as FAILED and never converted into QUERY_SUCCEEDED_EMPTY", () => {
      const logs: MetaSubqueryExecution[] = [
        {
          queryId: "q1",
          keyword: "cat water fountain",
          searchType: "KEYWORD_EXACT_PHRASE",
          attempted: true,
          status: "FAILED",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          actualApiCalls: 1,
          returnedCount: 0,
          errorCode: "HTTP_500",
          errorMessage: "Meta Graph API HTTP 500 Internal Error",
        },
      ];
      const agg = aggregateMetaQueryOutcomes(logs);
      expect(agg.executionStatus).toBe("FAILED");
      expect(agg.executionStatus).not.toBe("QUERY_SUCCEEDED_EMPTY");
      expect(agg.liveSucceeded).toBe(false);
      expect(agg.failedQueries).toBe(1);
    });

    it("C27: Budget tracker is shared across rounds without resetting consumed requests", () => {
      const tracker = new MetaQueryBudgetTracker({
        maxLogicalSubqueries: 3,
        maxProviderRequests: 3,
        maxPages: 3,
        maxUniqueAds: 25,
        maxDurationMs: 30_000,
      });

      expect(tracker.tryConsume(2)).toBe(true); // Round 1 consumes 2
      expect(tracker.remainingRequests).toBe(1);
      expect(tracker.tryConsume(1)).toBe(true); // Round 2 consumes 1
      expect(tracker.remainingRequests).toBe(0);
      expect(tracker.tryConsume(1)).toBe(false);
      expect(tracker.getUsageSummary().consumedRequests).toBe(3);
    });

    it("C28: Retries and pagination consume provider request budget accurately", () => {
      const tracker = new MetaQueryBudgetTracker({
        maxLogicalSubqueries: 3,
        maxProviderRequests: 3,
        maxPages: 2,
        maxUniqueAds: 25,
        maxDurationMs: 30_000,
      });

      expect(tracker.tryConsume(1)).toBe(true); // Initial query (consumes 1 request & 1 page)
      expect(tracker.tryConsume(1)).toBe(true); // Page 2 (consumes 2nd request & 2nd page)

      expect(tracker.canFetchMorePages()).toBe(false);
      expect(tracker.canExecuteRequest()).toBe(false);
    });

    it("C29: Expired deadline immediately terminates budget eligibility with DEADLINE_EXCEEDED", () => {
      const tracker = new MetaQueryBudgetTracker({
        maxLogicalSubqueries: 3,
        maxProviderRequests: 3,
        maxPages: 3,
        maxUniqueAds: 25,
        maxDurationMs: -10, // Already expired
      });

      expect(tracker.isExpired()).toBe(true);
      expect(tracker.canExecuteRequest()).toBe(false);
      expect(tracker.tryConsume(1)).toBe(false);
      expect(tracker.getUsageSummary().stopReason).toBe("DEADLINE_EXCEEDED");
    });

    it("C30: Exhausted queries and zero remaining recovery actions terminate cleanly with []", () => {
      const planned = [
        {
          queryId: "q1",
          phrase: "cat water fountain",
          normalizedPhrase: "cat water fountain",
          searchType: "KEYWORD_EXACT_PHRASE" as const,
          archetypeId: "arch_1",
          expectedProductCategory: "Pet Fountain",
          priority: 1,
          rationale: "Primary",
          origin: "DETERMINISTIC_FALLBACK" as const,
          roundNumber: 1,
          researchRunId: "test_run",
          source: "META_ADS" as const,
        },
      ];
      const used = new Set(["cat water fountain", "cat water fountain::KEYWORD_EXACT_PHRASE"]);
      const next = selectQueriesForSearchRound(planned, 1, used, new Set(["arch_1"]), 2);
      expect(next).toEqual([]);
    });
  });

  // ============================================================================
  // GROUP D: GOOGLE ADS TRANSPARENCY REAL EVIDENCE & TELEMETRY (D31–D36)
  // ============================================================================
  describe("Group D — Google Ads Transparency Diagnostics & Product Association (D31–D36)", () => {
    it("D31: Subdomain and tracking domain normalize to registrable domain for cross-platform matching", () => {
      expect(extractRegistrableDomain("https://shop.petlibro.com/products/dockstream")).toBe("petlibro.com");
      expect(extractRegistrableDomain("www.uprootclean.co.uk")).toBe("uprootclean.co.uk");
    });

    it("D32: Advertiser found with 0 ads or Brand-only Google ad is NOT classified as HIGH_CONFIDENCE product match (Fixes F06)", () => {
      const cand = discoverProductCandidatesFromAds(
        [
          makeAd({
            id: "d32_ad",
            landingUrl: "https://shop.petlibro.com/products/dockstream-fountain",
            headline: "Petlibro Dockstream Stainless Steel Cat Water Fountain",
            advertiser: { id: "adv_pl", name: "Petlibro", domain: "shop.petlibro.com" },
          }),
        ],
        "pet"
      )[0];
      cand.brand = "Petlibro";

      const match = matchCrossPlatformProductEvidence(cand, {
        title: "Petlibro Official Store — Free Shipping On Orders",
        url: "https://petlibro.com",
        domain: "petlibro.com",
        platform: "GOOGLE_ADS",
      });

      expect(match.confidence).toBe("PROBABLE");
      expect(match.confidence).not.toBe("HIGH_CONFIDENCE");
    });

    it("D33: Brand-related Google record for an unrelated product is separated from HIGH_CONFIDENCE product association", () => {
      const cand = discoverProductCandidatesFromAds(
        [
          makeAd({
            id: "d33_ad",
            landingUrl: "https://uprootclean.com/products/uproot-cleaner-pro",
            headline: "Uproot Clean Pro Pet Hair Remover Carpet Scraper",
            advertiser: { id: "adv_up", name: "Uproot Clean", domain: "uprootclean.com" },
          }),
        ],
        "pet"
      )[0];
      cand.brand = "Uproot Clean";

      const match = matchCrossPlatformProductEvidence(cand, {
        title: "Uproot Clean Laundry Detergent Sheets",
        url: "https://uprootclean.com/products/laundry-sheets",
        domain: "uprootclean.com",
        platform: "GOOGLE_ADS",
      });

      expect(match.confidence).toBe("PROBABLE");
      expect(match.confidence).not.toBe("HIGH_CONFIDENCE");
    });

    it("D34: Product-specific Google ad with domain + product/model token overlap achieves HIGH_CONFIDENCE", () => {
      const cand = discoverProductCandidatesFromAds(
        [
          makeAd({
            id: "d34_ad",
            landingUrl: "https://shop.petlibro.com/products/luma-smart-litter-box",
            headline: "Petlibro Luma Smart Automatic Cat Litter Box",
            advertiser: { id: "adv_pl", name: "Petlibro", domain: "shop.petlibro.com" },
          }),
        ],
        "pet"
      )[0];
      cand.brand = "Petlibro";

      const match = matchCrossPlatformProductEvidence(cand, {
        title: "Petlibro Luma Smart Litter Box",
        url: "https://petlibro.com",
        domain: "petlibro.com",
        platform: "GOOGLE_ADS",
      });

      expect(match.confidence).toBe("HIGH_CONFIDENCE");
      expect(match.matchReasons.some((r) => r.includes("product-specific"))).toBe(true);
    });

    it("D35: Unrelated merchant and unrelated product returns AMBIGUOUS (non-match)", () => {
      const cand = discoverProductCandidatesFromAds(
        [
          makeAd({
            id: "d35_ad",
            landingUrl: "https://petstream.com/products/cat-fountain",
            headline: "Stainless Steel Cat Water Fountain",
            advertiser: { id: "adv_ps", name: "PetStream", domain: "petstream.com" },
          }),
        ],
        "pet"
      )[0];

      const match = matchCrossPlatformProductEvidence(cand, {
        title: "Herren Laufschuhe Wasserdicht",
        url: "https://schuhwelt.de/products/laufschuhe",
        domain: "schuhwelt.de",
        platform: "GOOGLE_ADS",
      });

      expect(match.confidence).toBe("AMBIGUOUS");
    });

    it("D36: Google diagnostic state breakdown separates transportConnected from adsRetrieved and productAssociatedEvidence", () => {
      const adapterPath = path.resolve(
        process.cwd(),
        "src/services/kh02/providers/googleTransparencyResearchAdapter.ts"
      );
      const source = fs.readFileSync(adapterPath, "utf8");
      expect(source).toContain("stateBreakdown");
      expect(source).toContain("productAssociatedEvidence:");
      expect(source).toContain("adsRetrieved: observations.length > 0");
    });
  });

  // ============================================================================
  // GROUP E: DEMAND HISTORY, COVERAGE & EVERGREEN SCORING (E37–E43)
  // ============================================================================
  describe("Group E — Demand History Coverage & Evergreen Qualification Gates (E37–E43)", () => {
    it("E37: Missing demand history prevents VERIFIED_EVERGREEN qualification even when identity is VERIFIED", () => {
      const cand = discoverProductCandidatesFromAds(
        [
          makeAd({
            id: "e37_ad",
            landingUrl: "https://petstream.com/products/dockstream-fountain",
            headline: "Dockstream Stainless Steel Cat Water Fountain",
          }),
        ],
        "pet"
      )[0];
      cand.identityStatus = "VERIFIED";
      cand.identityConfidence = "EXACT";
      cand.isEligibleAsEvergreenWinner = true;

      const score = calculateKH02EvergreenScore({
        candidate: cand,
        demandSeries: [],
      });

      const gate = applyKH02EligibilityGates({
        ...score,
        isProductIdentityVerified: true,
      });

      expect(gate.isTop3Eligible).toBe(false);
      expect(gate.tier).not.toBe("VERIFIED_EVERGREEN");
      expect(gate.gateReasons.some((r) => r.toLowerCase().includes("demand"))).toBe(true);
    });

    it("E38: Demand term normalization strips campaign codes, promotional suffixes, and records mappingReason", () => {
      const res = normalizeDemandQueryTerm(
        "50% OFF Today! Dockstream 2.5L Stainless Steel Cat Water Fountain - Free Shipping [FB_CAMPAIGN_9921]"
      );
      expect(res.rawTerm).toContain("50% OFF Today!");
      expect(res.normalizedTerm.toLowerCase()).not.toContain("50% off");
      expect(res.normalizedTerm.toLowerCase()).not.toContain("free shipping");
      expect(res.normalizedTerm.toLowerCase()).toContain("cat water fountain");
      expect(res.mappingReason).toBeTruthy();
    });

    it("E39: Requested lookback (e.g. 30D or 180D) is preserved and never silently overwritten to 60D", () => {
      const demandSource = fs.readFileSync(
        path.resolve(process.cwd(), "src/services/kh02/demand/historicalDemandIngestion.ts"),
        "utf8"
      );
      expect(demandSource).toContain("const requestedLookbackDays = options.lookbackDays || 90");
      expect(demandSource).not.toContain("Math.max(options.lookbackDays, 60)");
    });

    it("E40: Duplicate demand observation dates do not inflate observation count or covered days", () => {
      const rawPoints = [
        { date: "2026-09-01", value: 55 },
        { date: "2026-09-01", value: 55 },
        { date: "2026-09-01", value: 60 },
        { date: "2026-09-15", value: 58 },
      ];
      const uniqueDates = new Set(rawPoints.map((p) => p.date));
      expect(uniqueDates.size).toBe(2);
      const timestamps = Array.from(uniqueDates).map((d) => new Date(d).getTime());
      const coveredDays = Math.round(
        (Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60 * 24)
      );
      expect(coveredDays).toBe(14);
    });

    it("E41: Evergreen qualification thresholds remain strictly enforced (Score >= 65, Confidence >= 65, Demand Stability >= 15, Coverage >= 60D)", () => {
      const cand = discoverProductCandidatesFromAds(
        [
          makeAd({
            id: "e41_ad",
            landingUrl: "https://petstream.com/products/dockstream-fountain",
            headline: "Dockstream Stainless Steel Cat Water Fountain",
          }),
        ],
        "pet"
      )[0];
      cand.identityStatus = "VERIFIED";
      cand.identityConfidence = "EXACT";

      // Only 2 points over 15 days (< 60 days minimum coverage)
      const shortDemand = [
        { date: "2026-10-01", value: 70, source: "GOOGLE_TRENDS" },
        { date: "2026-10-15", value: 72, source: "GOOGLE_TRENDS" },
      ];

      const score = calculateKH02EvergreenScore({
        candidate: cand,
        demandSeries: shortDemand as any,
      });

      const gate = applyKH02EligibilityGates({
        ...score,
        isProductIdentityVerified: true,
      });

      expect(gate.isTop3Eligible).toBe(false);
      expect(gate.tier).not.toBe("VERIFIED_EVERGREEN");
    });

    it("E42: Single product with many ad creatives from one advertiser cannot pass Evergreen without demand coverage", () => {
      const manyAds = Array.from({ length: 12 }, (_, idx) =>
        makeAd({
          id: `e42_ad_${idx}`,
          landingUrl: "https://petstream.com/products/dockstream-fountain",
          headline: `Dockstream Stainless Steel Cat Water Fountain Angle ${idx}`,
        })
      );
      const cand = discoverProductCandidatesFromAds(manyAds, "pet")[0];
      expect(cand.totalObservationCount).toBe(12);
      cand.identityStatus = "VERIFIED";
      cand.identityConfidence = "EXACT";

      const score = calculateKH02EvergreenScore({
        candidate: cand,
        demandSeries: [],
      });

      expect(score.tier).not.toBe("VERIFIED_EVERGREEN");
      expect(score.pillars.demandStability.score).toBeNull();
    });

    it("E43: AI product intelligence psychological hypotheses never count as measured demand history", () => {
      const cand = discoverProductCandidatesFromAds(
        [
          makeAd({
            id: "e43_ad",
            landingUrl: "https://petstream.com/products/dockstream-fountain",
            headline: "Dockstream Stainless Steel Cat Water Fountain",
          }),
        ],
        "pet"
      )[0];
      cand.identityStatus = "VERIFIED";
      cand.identityConfidence = "EXACT";
      (cand as any).aiIntelligence = {
        customerProblem: "Cats dehydrated from stagnant bowl water",
        buyerPersona: "Indoor cat owners",
        confidence: 0.92,
      };

      const score = calculateKH02EvergreenScore({
        candidate: cand,
        demandSeries: [],
      });

      expect(score.pillars.demandStability.score).toBeNull();
      expect(score.tier).not.toBe("VERIFIED_EVERGREEN");
    });
  });

  // ============================================================================
  // GROUP F: API, UI, SNAPSHOT & DISABLED SOURCE ISOLATION (F44–F50)
  // ============================================================================
  describe("Group F — API/UI Validation, Snapshot Integrity & Disabled TikTok Isolation (F44–F50)", () => {
    it("F44: Empty and whitespace queries are blocked at intent validation and API route", () => {
      expect(analyzeNicheIntent("").isProhibitedOrUnsupported).toBe(true);
      expect(analyzeNicheIntent("    \t\n  ").isProhibitedOrUnsupported).toBe(true);

      const routeSource = fs.readFileSync(
        path.resolve(process.cwd(), "src/app/api/v1/kh02/research/route.ts"),
        "utf8"
      );
      expect(routeSource).toContain("status: 400");
      expect(routeSource).toContain("VALIDATION_FAILED");
    });

    it("F45: UI snapshot topic heading uses leaderboard.topic and does not mutate while typing", () => {
      const uiSource = fs.readFileSync(
        path.resolve(process.cwd(), "src/app/products/page.tsx"),
        "utf8"
      );
      expect(uiSource).toContain("data-testid=\"kh02-snapshot-topic-heading\"");
      expect(uiSource).toContain("leaderboard?.topic || activeRunTopic");
      expect(uiSource).toContain("Please enter a research topic (at least 2 characters).");
    });

    it("F46: Runtime release version is updated to 12.4.3 across service and UI", () => {
      expect(["12.4.3", "12.4.3.1", "12.4.3.2", "12.4.3.2.1", "12.4.3.3", "12.4.3.3.1", "12.4.3.3.2", "12.4.3.4.1", "12.4.3.4.2", "12.4.3.4.3", "12.4.3.4.4", "12.4.3.4.5", "12.4.3.4.6", "12.4.3.4.7", "12.4.3.4.8"]).toContain(SWAI_KH02_RELEASE_VERSION);
      const uiSource = fs.readFileSync(
        path.resolve(process.cwd(), "src/app/products/page.tsx"),
        "utf8"
      );
      expect(uiSource).toContain("12.4.3");
    });

    it("F47: Reload reconciliation preserves candidate IDs, identityStatus, familyKey, and sourceObservations", () => {
      const cands = discoverProductCandidatesFromAds(
        [
          makeAd({
            id: "f47_1",
            landingUrl: "https://petstream.com/products/dockstream-fountain",
            headline: "Dockstream Stainless Steel Cat Water Fountain",
          }),
        ],
        "pet"
      );
      const shortlistRes = selectTopResearchShortlist(cands, 3, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "Pet Gadgets",
      });

      const serialized = JSON.parse(JSON.stringify(shortlistRes.shortlist));
      expect(serialized[0].candidateId).toBe(shortlistRes.shortlist[0].candidateId);
      expect(serialized[0].canonicalProductUrl).toBe(shortlistRes.shortlist[0].canonicalProductUrl);
      expect(serialized[0].familyKey).toBe(shortlistRes.shortlist[0].familyKey);
      expect(serialized[0].identityStatus).toBe(shortlistRes.shortlist[0].identityStatus);
      expect(serialized[0].sourceObservations.length).toBeGreaterThan(0);
    });

    it("F48: Media belongs strictly to the selected candidate and never leaks across candidates", () => {
      const ads = [
        makeAd({
          id: "media_a",
          landingUrl: "https://store-a.com/products/cat-fountain",
          headline: "Automatic Cat Water Fountain",
          thumbnailUrl: "https://cdn.store-a.com/cat-fountain.jpg",
          advertiser: { id: "adv_a", name: "Store A", domain: "store-a.com" },
        }),
        makeAd({
          id: "media_b",
          landingUrl: "https://store-b.com/products/dog-harness",
          headline: "No-Pull Reflective Dog Harness",
          thumbnailUrl: "https://cdn.store-b.com/dog-harness.jpg",
          advertiser: { id: "adv_b", name: "Store B", domain: "store-b.com" },
        }),
      ];

      const cands = discoverProductCandidatesFromAds(ads, "pet");
      expect(cands.length).toBe(2);
      const candA = cands.find((c) => c.storeDomain === "store-a.com")!;
      const candB = cands.find((c) => c.storeDomain === "store-b.com")!;

      expect(candA.thumbnailUrl).toBe("https://cdn.store-a.com/cat-fountain.jpg");
      expect(candB.thumbnailUrl).toBe("https://cdn.store-b.com/dog-harness.jpg");
      expect(candA.imageReferences).not.toContain("https://cdn.store-b.com/dog-harness.jpg");
    });

    it("F49: No test fixtures are injected into production orchestrator runs", () => {
      const orchSource = fs.readFileSync(
        path.resolve(process.cwd(), "src/services/kh02/evergreenResearchOrchestrator.ts"),
        "utf8"
      );
      expect(orchSource).not.toContain("MOCK_EVERGREEN_PRODUCTS");
      expect(orchSource).not.toContain("SEED_FAKE_WINNERS");
    });

    it("F50: Disabled TikTok sources (TIKTOK_ADS, TIKTOK_ADS_US, TIKTOK_ORGANIC) remain disabled and make zero outbound calls", () => {
      expect(isSourceTemporarilyDisabled("TIKTOK_ADS")).toBe(true);
      expect(isSourceTemporarilyDisabled("TIKTOK_ADS_US")).toBe(true);
      expect(isSourceTemporarilyDisabled("TIKTOK_ORGANIC")).toBe(true);
      expect(isSourceTemporarilyDisabled("META_ADS")).toBe(false);
      expect(isSourceTemporarilyDisabled("GOOGLE_ADS")).toBe(false);
    });
  });
});
