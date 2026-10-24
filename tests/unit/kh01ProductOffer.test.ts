/**
 * KH-01.B — Product Identity & Competitor Offer Intelligence Unit Tests
 */

import { describe, it, expect } from "vitest";
import {
  extractStructuredProductOffer,
  extractPromotionalOffer,
  normalizeCompetitorOffer,
  compareCompetitorOffers,
  ParsedPublicLandingPage,
} from "@/services/research/offerExtractionService";
import {
  verifyCommercePlatformEvidence,
} from "@/services/products/platformDetector";

describe("KH-01.B — Product Identity & Competitor Offer Intelligence", () => {
  const samplePageWithJsonLd: ParsedPublicLandingPage = {
    originalUrl: "https://crystalbrand.example.com/products/crystal-hair-eraser",
    finalUrl: "https://crystalbrand.example.com/products/crystal-hair-eraser",
    pageTitle: "Crystal Hair Eraser - Painless Exfoliation & Hair Removal | 50% Off",
    metaDescription: "Get silky smooth skin instantly with our viral crystal hair eraser. Buy 2 Get 1 Free today with free shipping on orders over $50.",
    html: "<html><body><script type='application/ld+json'>{\"@context\":\"https://schema.org/\",\"@type\":\"Product\",\"name\":\"Crystal Hair Eraser\",\"offers\":{\"@type\":\"Offer\",\"price\":\"29.99\",\"priceCurrency\":\"USD\",\"availability\":\"https://schema.org/InStock\"}}</script><div><span class='price'>$29.99</span><span class='compare-price'>$59.99</span><h1>Crystal Hair Eraser</h1><p>30-day money-back guarantee. 1-year warranty included.</p></div></body></html>",
    jsonLdObjects: [
      {
        "@context": "https://schema.org/",
        "@type": "Product",
        name: "Crystal Hair Eraser",
        offers: {
          "@type": "Offer",
          price: "29.99",
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
        },
      },
    ],
    visiblePrices: [
      { amount: 29.99, currency: "USD", rawText: "$29.99", type: "REGULAR" },
      { amount: 59.99, currency: "USD", rawText: "$59.99", type: "COMPARE_AT" },
    ],
    visibleHeadings: ["Crystal Hair Eraser", "Why Choose Crystal Hair Eraser"],
    ctaButtons: ["Add to Cart - $29.99", "Buy Now"],
    shippingStatements: ["Free shipping on orders over $50"],
    guaranteeStatements: ["30-day money-back guarantee", "1-year warranty included"],
  };

  describe("B1 & B2: Commerce Platform Evidence Detection", () => {
    it("confirms Shopify when domain is myshopify.com subdomain", () => {
      const result = verifyCommercePlatformEvidence({
        domain: "crystal-hair.myshopify.com",
      });
      expect(result.platform).toBe("SHOPIFY_CONFIRMED");
      expect(result.confidence).toBe("HIGH");
      expect(result.engineName).toBe("Shopify");
    });

    it("confirms Shopify when CDN assets and window.Shopify are present in HTML", () => {
      const html = "<html><head><script src='https://cdn.shopify.com/s/files/theme.js'></script></head><body><script>window.Shopify = { shop: 'test.myshopify.com' };</script></body></html>";
      const result = verifyCommercePlatformEvidence({
        domain: "customdomainbrand.com",
        html,
      });
      expect(result.platform).toBe("SHOPIFY_CONFIRMED");
      expect(result.confidence).toBe("HIGH");
    });

    it("identifies WooCommerce platform when wp-content and woocommerce classes are present", () => {
      const html = "<html><body class='woocommerce-page'><div class='wp-content/plugins/woocommerce'>Price</div></body></html>";
      const result = verifyCommercePlatformEvidence({
        domain: "woo-store.example.com",
        html,
      });
      expect(result.platform).toBe("OTHER");
      expect(result.engineName).toContain("WooCommerce");
    });

    it("returns UNKNOWN when no platform signatures are observed", () => {
      const result = verifyCommercePlatformEvidence({
        domain: "generic-website.example.com",
        html: "<html><body>Hello World</body></html>",
      });
      expect(result.platform).toBe("UNKNOWN");
      expect(result.confidence).toBe("LOW");
    });
  });

  describe("B6 & B7: Structured & Promotional Offer Extraction", () => {
    it("extracts structured price, currency, and availability from JSON-LD Product & Offer", () => {
      const offers = extractStructuredProductOffer(samplePageWithJsonLd);
      const jsonOffer = offers.find((o) => o.source === "JSON_LD");

      expect(jsonOffer).toBeDefined();
      expect(jsonOffer?.sellingPrice).toBe(29.99);
      expect(jsonOffer?.currency).toBe("USD");
      expect(jsonOffer?.availability).toBe("IN_STOCK");
    });

    it("extracts visible regular and compare-at prices from DOM", () => {
      const offers = extractStructuredProductOffer(samplePageWithJsonLd);
      const compareOffer = offers.find((o) => o.compareAtPrice !== null);

      expect(compareOffer).toBeDefined();
      expect(compareOffer?.compareAtPrice).toBe(59.99);
    });

    it("extracts percentage discount, bundle breaks, free shipping thresholds, and guarantees", () => {
      const promos = extractPromotionalOffer(samplePageWithJsonLd);

      const discount = promos.find((p) => p.type === "PERCENTAGE_DISCOUNT");
      expect(discount?.observedDiscountPercent).toBe(50);

      const freeShipping = promos.find((p) => p.type === "FREE_SHIPPING_THRESHOLD");
      expect(freeShipping?.observedThresholdAmount).toBe(50);

      const bogo = promos.find((p) => p.type === "BUNDLE_QUANTITY_BREAK");
      expect(bogo?.bundleQuantity).toBe(3); // Buy 2 Get 1 = 3

      const guarantee = promos.find((p) => p.type === "MONEY_BACK_GUARANTEE");
      expect(guarantee).toBeDefined();

      const warranty = promos.find((p) => p.type === "WARRANTY");
      expect(warranty).toBeDefined();
    });

    it("normalizes competitor offer with calculated effective unit price", () => {
      const structured = extractStructuredProductOffer(samplePageWithJsonLd);
      const promos = extractPromotionalOffer(samplePageWithJsonLd);

      const normalized = normalizeCompetitorOffer(structured, promos, {
        sourceUrl: samplePageWithJsonLd.originalUrl,
      });

      expect(normalized.sellingPrice).toBe(29.99);
      expect(normalized.compareAtPrice).toBe(59.99);
      expect(normalized.currency).toBe("USD");
      expect(normalized.bundleQuantity).toBe(3);
      // $29.99 / 3 = $10.00 effective unit price
      expect(normalized.effectivePricePerUnit).toBe(10);
      expect(normalized.hasFreeShipping).toBe(true);
      expect(normalized.freeShippingThreshold).toBe(50);
    });

    it("leaves missing selling price null and records explicit warning when price is absent", () => {
      const emptyPage: ParsedPublicLandingPage = {
        originalUrl: "https://example.com/no-price",
        finalUrl: "https://example.com/no-price",
        pageTitle: "Out of Stock Product",
        metaDescription: "Coming soon",
        html: "<html><body>Coming soon</body></html>",
        jsonLdObjects: [],
        visiblePrices: [],
        visibleHeadings: ["Coming Soon"],
        ctaButtons: ["Notify Me"],
        shippingStatements: [],
        guaranteeStatements: [],
      };

      const structured = extractStructuredProductOffer(emptyPage);
      const promos = extractPromotionalOffer(emptyPage);
      const normalized = normalizeCompetitorOffer(structured, promos, {
        sourceUrl: emptyPage.originalUrl,
      });

      expect(normalized.sellingPrice).toBeNull();
      expect(normalized.warnings.length).toBeGreaterThan(0);
      expect(normalized.warnings[0]).toContain("No explicit product selling price");
    });

    it("flags conflicting prices when JSON-LD and visible DOM disagree", () => {
      const conflictingPage: ParsedPublicLandingPage = {
        ...samplePageWithJsonLd,
        visiblePrices: [
          { amount: 39.99, currency: "USD", rawText: "$39.99", type: "REGULAR" },
        ],
      };

      const structured = extractStructuredProductOffer(conflictingPage);
      const promos = extractPromotionalOffer(conflictingPage);
      const normalized = normalizeCompetitorOffer(structured, promos, {
        sourceUrl: conflictingPage.originalUrl,
      });

      expect(normalized.conflicts.length).toBeGreaterThan(0);
      expect(normalized.conflicts[0]).toContain("differs from visible DOM price");
    });

    it("compares multiple competitor offer observations and detects price fluctuations over time", () => {
      const history = [
        {
          id: "snap_1",
          observedAt: new Date("2026-01-15T00:00:00Z"),
          currency: "USD",
          sellingPrice: 34.99,
          compareAtPrice: 59.99,
          bundleQuantity: 1,
          hasFreeShipping: false,
          shippingThreshold: 50,
          offerDataJson: JSON.stringify({ promotions: [] }),
        },
        {
          id: "snap_2",
          observedAt: new Date("2026-02-15T00:00:00Z"),
          currency: "USD",
          sellingPrice: 29.99,
          compareAtPrice: 59.99,
          bundleQuantity: 1,
          hasFreeShipping: true,
          shippingThreshold: 0,
          offerDataJson: JSON.stringify({
            promotions: [{ type: "MONEY_BACK_GUARANTEE", claimText: "30-Day Money-Back Guarantee" }],
          }),
        },
      ];

      const comparison = compareCompetitorOffers(history);
      expect(comparison.priceChangeObserved).toBe(true);
      expect(comparison.lowestObservedUnitPrice).toBe(29.99);
      expect(comparison.highestObservedUnitPrice).toBe(34.99);
      expect(comparison.offers[1].hasFreeShipping).toBe(true);
      expect(comparison.offers[1].guarantee).toBe("30-Day Money-Back Guarantee");
    });
  });
});
