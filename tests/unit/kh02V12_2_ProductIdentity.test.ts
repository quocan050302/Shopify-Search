/**
 * SWAI KH-02 V12.2 — Real Ads Source Activation & Product Identity Intelligence Tests
 *
 * Covers:
 * 1. Ad headline classification (ad IDs vs promotional CTAs vs real product names)
 * 2. Shopify product URL metadata extraction and SSRF security protection
 * 3. Product relevance evaluation for target niche ("Pet Gadgets")
 * 4. 7-level product identification hierarchy
 * 5. Cost guard protection (AUTO_PAID_RESEARCH=false)
 * 6. Historical demand product resolution
 */

import { describe, it, expect } from "vitest";
import {
  classifyAdvertisingHeadline,
} from "@/services/kh02/identity/adHeadlineClassifier";
import {
  extractProductUrlMetadata,
  isSafePublicUrl,
} from "@/services/kh02/identity/productMetadataExtractor";
import {
  evaluateProductRelevance,
} from "@/services/kh02/identity/productRelevanceEvaluator";
import {
  resolveProductIdentity,
} from "@/services/kh02/identity/productIdentityResolver";
import {
  evaluateProviderCostGuard,
} from "@/services/kh02/providers/providerCostPolicy";
import {
  normalizeProductSearchTerm,
} from "@/services/kh02/demand/historicalDemandIngestion";

describe("SWAI KH-02 V12.2 — Ad Headline Classification (Section 85)", () => {
  it("rejects Facebook Ad IDs as eligible product names", () => {
    const res1 = classifyAdvertisingHeadline("Facebook Ad: 893760707134895");
    expect(res1.headlineClass).toBe("AD_IDENTIFIER");
    expect(res1.isEligibleAsProductName).toBe(false);

    const res2 = classifyAdvertisingHeadline("Ad ID: 1765076104621076");
    expect(res2.headlineClass).toBe("AD_IDENTIFIER");
    expect(res2.isEligibleAsProductName).toBe(false);

    const res3 = classifyAdvertisingHeadline("2249466188957796");
    expect(res3.headlineClass).toBe("AD_IDENTIFIER");
    expect(res3.isEligibleAsProductName).toBe(false);
  });

  it("rejects promotional slogans, discounts, and CTAs", () => {
    const cta1 = classifyAdvertisingHeadline("Sign up now for 50% off your order!");
    expect(cta1.headlineClass).toBe("PROMOTIONAL_CTA");
    expect(cta1.isEligibleAsProductName).toBe(false);

    const cta2 = classifyAdvertisingHeadline("Shop Now - Limited Time Offer!");
    expect(cta2.headlineClass).toBe("PROMOTIONAL_CTA");
    expect(cta2.isEligibleAsProductName).toBe(false);

    const cta3 = classifyAdvertisingHeadline("Free Shipping Worldwide Today Only");
    expect(cta3.headlineClass).toBe("PROMOTIONAL_CTA");
    expect(cta3.isEligibleAsProductName).toBe(false);
  });

  it("accepts genuine descriptive product names", () => {
    const prod1 = classifyAdvertisingHeadline("Ultrasonic Anti-Barking Device");
    expect(prod1.headlineClass).toBe("PRODUCT_CANDIDATE");
    expect(prod1.isEligibleAsProductName).toBe(true);
    expect(prod1.normalizedCleanText).toBe("Ultrasonic Anti-Barking Device");

    const prod2 = classifyAdvertisingHeadline("Self-Cleaning Dog Grooming Vacuum");
    expect(prod2.headlineClass).toBe("PRODUCT_CANDIDATE");
    expect(prod2.isEligibleAsProductName).toBe(true);
  });
});

describe("SWAI KH-02 V12.2 — Product Metadata Extraction & SSRF Protection (Section 82 & 83)", () => {
  it("extracts clean title-cased product name from Shopify /products/<slug> URL", () => {
    const url = "https://furryco.com/products/ultrasonic-anti-barking-device?utm_source=fb&utm_campaign=winter";
    const meta = extractProductUrlMetadata(url);

    expect(meta.isValidEcommerceUrl).toBe(true);
    expect(meta.isShopifyProductUrl).toBe(true);
    expect(meta.productHandle).toBe("ultrasonic-anti-barking-device");
    expect(meta.derivedTitleFromSlug).toBe("Ultrasonic Anti Barking Device");
    expect(meta.cleanCanonicalUrl).toBe("https://furryco.com/products/ultrasonic-anti-barking-device");
    expect(meta.storeDomain).toBe("furryco.com");
  });

  it("detects and rejects root domain / homepages from being treated as product URLs", () => {
    const meta = extractProductUrlMetadata("https://brandstore.com/?utm_source=facebook");
    expect(meta.isShopifyProductUrl).toBe(false);
    expect(meta.productHandle).toBeNull();
  });

  it("enforces SSRF protection: strictly blocks loopback, private subnets, and metadata endpoints", () => {
    expect(isSafePublicUrl("http://localhost:3000/products/test")).toBe(false);
    expect(isSafePublicUrl("http://127.0.0.1:8000/products/test")).toBe(false);
    expect(isSafePublicUrl("http://192.168.1.100/products/test")).toBe(false);
    expect(isSafePublicUrl("http://10.0.0.1/products/test")).toBe(false);
    expect(isSafePublicUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafePublicUrl("https://mypetshop.com/products/safe-toy")).toBe(true);
  });
});

describe("SWAI KH-02 V12.2 — Product Relevance Validation (Section 90)", () => {
  it("correctly identifies relevant pet products for Pet Gadgets niche", () => {
    const rel1 = evaluateProductRelevance("Automatic Dog Ball Launcher", "Pet Gadgets");
    expect(rel1.relevanceStatus).toBe("RELEVANT");
    expect(rel1.isAccepted).toBe(true);

    const rel2 = evaluateProductRelevance("Cat Water Fountain Stainless Steel", "Pet Gadgets");
    expect(rel2.relevanceStatus).toBe("RELEVANT");
    expect(rel2.isAccepted).toBe(true);
  });

  it("rejects irrelevant commercial items or financial offers", () => {
    const rel = evaluateProductRelevance("Crypto Investment Masterclass for Beginners", "Pet Gadgets");
    expect(rel.relevanceStatus).toBe("IRRELEVANT");
    expect(rel.isAccepted).toBe(false);
  });
});

describe("SWAI KH-02 V12.2 — 7-Level Product Identity Hierarchy (Section 81 & 96)", () => {
  it("Level 1: Uses verified Shopify landing page slug as PROBABLE until merchant page title is verified", () => {
    const identity = resolveProductIdentity({
      landingPageUrl: "https://barkshield.com/products/silent-dog-whistle",
      rawHeadlines: ["Sign up now for 50% off", "Facebook Ad: 9812739123"],
    });

    expect(identity.identityStatus).toBe("PROBABLE");
    expect(identity.canonicalName).toBe("Silent Dog Whistle");
    expect(identity.isEligibleAsEvergreenWinner).toBe(false);

    const verifiedIdentity = resolveProductIdentity({
      landingPageUrl: "https://barkshield.com/products/silent-dog-whistle",
      verifiedLandingPageTitle: "Silent Dog Whistle",
      rawHeadlines: ["Sign up now for 50% off", "Facebook Ad: 9812739123"],
    });
    expect(verifiedIdentity.identityStatus).toBe("VERIFIED");
    expect(verifiedIdentity.isEligibleAsEvergreenWinner).toBe(true);
  });

  it("Level 6: Uses classified product headline when landing page is missing but copy is descriptive", () => {
    const identity = resolveProductIdentity({
      landingPageUrl: null,
      rawHeadlines: ["Free Shipping Today", "Electric Pet Nail Grinder Pro"],
    });

    expect(identity.identityStatus).toBe("PROBABLE");
    expect(identity.canonicalName).toBe("Electric Pet Nail Grinder Pro");
    expect(identity.resolutionHierarchyLevel).toBe(6);
  });

  it("Level 7: Refuses to treat Ad ID or CTA as product name when identity is unresolved", () => {
    const identity = resolveProductIdentity({
      landingPageUrl: null,
      rawHeadlines: ["Facebook Ad: 893760707134895", "Limited Time Offer 50% Off"],
      sourceReference: "Facebook Ad #893760707134895",
    });

    expect(identity.identityStatus).toBe("UNRESOLVED");
    expect(identity.canonicalName).toBeNull();
    expect(identity.displayTitle).toBe("Unidentified Product (Source: Facebook Ad #893760707134895, Identity: Needs Review)");
    expect(identity.resolutionHierarchyLevel).toBe(7);
    expect(identity.isEligibleAsEvergreenWinner).toBe(false);
  });
});

describe("SWAI KH-02 V12.2 — Cost Policy & Zero Unapproved Paid API Calls (Section 24 & 55)", () => {
  it("permits zero-cost operations by default", () => {
    const decision = evaluateProviderCostGuard("META_ADS", "SEARCH", 0);
    expect(decision.allowed).toBe(true);
  });

  it("strictly blocks metered operations when AUTO_PAID_RESEARCH=false", () => {
    const decision = evaluateProviderCostGuard("TIKTOK_ORGANIC", "HASDATA_QUERY", 1, false);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("AUTO_PAID_RESEARCH=false");
  });
});

describe("SWAI KH-02 V12.2 — Historical Demand Term Normalization (Section 72 & 73)", () => {
  it("normalizes product title into concise search term", () => {
    const term = normalizeProductSearchTerm("Ultrasonic Anti-Barking Device - Free Shipping Shop Now");
    expect(term).toBe("Ultrasonic Anti-Barking Device");
  });

  it("strips raw ad ID prefix before building demand query", () => {
    const term = normalizeProductSearchTerm("Facebook Ad: 123456 Smart Cat Litter Box");
    expect(term).toBe("Smart Cat Litter Box");
  });
});
