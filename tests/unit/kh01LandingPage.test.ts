/**
 * KH-01.C — Landing Page & Competitor Funnel Analyzer Unit Tests
 */

import { describe, it, expect } from "vitest";
import { parsePublicLandingPage } from "@/services/research/landingPageInspectionService";
import {
  extractPageStructure,
  inspectTrustSignals,
  inspectMessageMatch,
  analyzeCompetitorFunnel,
} from "@/services/research/funnelAnalysisService";
import { compareLandingPageSnapshots } from "@/services/research/landingPageSnapshotService";
import { normalizeCompetitorOffer } from "@/services/research/offerExtractionService";

describe("KH-01.C — Landing Page & Competitor Funnel Analyzer", () => {
  const sampleGoodHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Ionic Hair Dryer Pro - Salon Results at Home | Free Shipping</title>
        <meta name="description" content="Dry hair 2x faster without heat damage. 30-Day Money Back Guarantee." />
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Ionic Hair Dryer Pro",
            "offers": {
              "@type": "Offer",
              "price": "79.99",
              "priceCurrency": "USD",
              "availability": "https://schema.org/InStock"
            }
          }
        </script>
      </head>
      <body>
        <header>
          <div class="announcement">Free shipping on orders over $50</div>
        </header>
        <main>
          <h1>Ionic Hair Dryer Pro</h1>
          <h2>Salon-grade ionic airflow for zero frizz</h2>
          <div class="pricing">
            <span class="price">$79.99</span>
            <span class="compare-price">$129.99</span>
          </div>
          <button class="btn-primary add-to-cart">Order Now - $79.99</button>
          <section class="benefits">
            <h3>Key Benefits</h3>
            <ul>
              <li>Dries in under 5 minutes</li>
              <li>Lightweight design</li>
            </ul>
          </section>
          <section class="reviews">
            <h3>Customer Reviews</h3>
            <p>Rated 4.8 stars by over 1,200 verified customers</p>
          </section>
          <section class="faq">
            <h3>Frequently Asked Questions</h3>
            <p>How does the ionic technology work?</p>
          </section>
          <footer>
            <p>Free standard shipping worldwide on orders over $50. 30-day money-back guarantee.</p>
            <a href="/policies/privacy">Privacy Policy</a>
            <a href="/policies/terms">Terms of Service</a>
            <a href="/pages/contact">Contact Us: support@hairdryerpro.com</a>
          </footer>
        </main>
      </body>
    </html>
  `;

  describe("C2: Landing Page HTML & Structure Extraction", () => {
    it("parses title, meta description, JSON-LD, headings and CTAs safely", () => {
      const parsed = parsePublicLandingPage(sampleGoodHtml, "https://example.com/dryer");

      expect(parsed.pageTitle).toContain("Ionic Hair Dryer Pro");
      expect(parsed.metaDescription).toContain("30-Day Money Back Guarantee");
      expect(parsed.jsonLdObjects.length).toBe(1);
      expect(parsed.visibleHeadings).toContain("Ionic Hair Dryer Pro");
      expect(parsed.ctaButtons.some((b) => b.includes("Order Now"))).toBe(true);
      expect(parsed.visiblePrices.some((p) => p.amount === 79.99)).toBe(true);
      expect(parsed.visiblePrices.some((p) => p.amount === 129.99)).toBe(true);
    });

    it("extracts page structure recognizing hero, reviews, FAQ, and shipping", () => {
      const parsed = parsePublicLandingPage(sampleGoodHtml, "https://example.com/dryer");
      const structure = extractPageStructure(parsed);

      expect(structure.hasProductHero).toBe(true);
      expect(structure.heroHeadline).toBe("Ionic Hair Dryer Pro");
      expect(structure.hasCustomerReviews).toBe(true);
      expect(structure.hasFaqSection).toBe(true);
      expect(structure.hasShippingPolicySummary).toBe(true);
      expect(structure.hasReturnPolicySummary).toBe(true);
      expect(structure.primaryCtaText).toContain("Order Now");
    });

    it("flags missing critical elements on sparse pages", () => {
      const sparseHtml = `<html><body><p>Hello Just a paragraph</p></body></html>`;
      const parsed = parsePublicLandingPage(sparseHtml, "https://example.com/sparse");
      const structure = extractPageStructure(parsed);

      expect(structure.missingObservableComponents).toContain("Product Hero Headline");
      expect(structure.missingObservableComponents).toContain("Prominent Primary Call-to-Action button");
      expect(structure.missingObservableComponents).toContain("Clear Visible Price");
      expect(structure.missingObservableComponents).toContain("Customer Reviews / Social Proof section");
    });
  });

  describe("C3: Trust Signals & Ad Message Match", () => {
    it("evaluates trust signals and identifies policy links and contact information", () => {
      const parsed = parsePublicLandingPage(sampleGoodHtml, "https://example.com/dryer");
      const trust = inspectTrustSignals(parsed);

      expect(trust.score).toBeGreaterThanOrEqual(75);
      expect(trust.observedSignals.some((s) => s.includes("support"))).toBe(true);
      expect(trust.observedSignals.some((s) => s.includes("Legal policies"))).toBe(true);
    });

    it("detects conditional mismatch when ad claims Free Shipping but landing page requires threshold", () => {
      const parsed = parsePublicLandingPage(sampleGoodHtml, "https://example.com/dryer");
      const ad = {
        headline: "Ionic Hair Dryer - Free Shipping Today",
        bodyText: "Get yours now with free shipping anywhere in the USA.",
        callToAction: "Shop Now",
      };

      const match = inspectMessageMatch(ad, parsed);

      expect(match.conflictingClaims.length).toBeGreaterThan(0);
      expect(match.conflictingClaims[0].reason).toContain("CONDITIONAL_MISMATCH");
      expect(match.conflictingClaims[0].pageEvidence).toContain("50");
    });

    it("calculates CRO readiness heuristic without fabricating conversion rate", () => {
      const parsed = parsePublicLandingPage(sampleGoodHtml, "https://example.com/dryer");
      const offer = normalizeCompetitorOffer([], [], { sourceUrl: "https://example.com/dryer" });

      const funnel = analyzeCompetitorFunnel({
        page: parsed,
        offer,
        ad: { headline: "Ionic Hair Dryer", bodyText: "Dry hair 2x faster", callToAction: "Order Now" },
      });

      expect(funnel.croReadiness).toBeGreaterThanOrEqual(60);
      expect(funnel.croReadiness).toBeLessThanOrEqual(95);
      expect(funnel.disclaimer).toContain("croReadiness is an analytical heuristic");
      expect(funnel.observedStrengths.length).toBeGreaterThan(0);
    });
  });

  describe("C4: Historical Snapshot Change Detection", () => {
    it("detects copy and headline changes between two observations", () => {
      const older = {
        observedAt: new Date("2026-01-01T00:00:00Z"),
        pageTitle: "Ionic Hair Dryer V1",
        observationsJson: JSON.stringify({
          heroHeadline: "Old Headline Title",
          primaryCtaText: "Buy Now",
          hasCustomerReviews: false,
          hasShippingPolicySummary: false,
        }),
        croSignalsJson: "{}",
      };

      const newer = {
        observedAt: new Date("2026-02-01T00:00:00Z"),
        pageTitle: "Ionic Hair Dryer Pro - V2",
        observationsJson: JSON.stringify({
          heroHeadline: "New Proven Salon Hair Dryer",
          primaryCtaText: "Order Now - 50% Off",
          hasCustomerReviews: true,
          hasShippingPolicySummary: true,
        }),
        croSignalsJson: "{}",
      };

      const report = compareLandingPageSnapshots(older, newer);

      expect(report.hasChanges).toBe(true);
      expect(report.detectedChanges.some((c) => c.field === "Hero Headline")).toBe(true);
      expect(report.detectedChanges.some((c) => c.field === "Customer Reviews Section")).toBe(true);
      expect(report.detectedChanges.some((c) => c.field === "Primary CTA")).toBe(true);
    });

    it("reports no changes when snapshots have identical observable attributes", () => {
      const snapshot = {
        observedAt: new Date("2026-01-01T00:00:00Z"),
        pageTitle: "Ionic Hair Dryer Pro",
        observationsJson: JSON.stringify({
          heroHeadline: "Ionic Hair Dryer Pro",
          primaryCtaText: "Order Now",
          hasCustomerReviews: true,
          hasShippingPolicySummary: true,
        }),
        croSignalsJson: "{}",
      };

      const report = compareLandingPageSnapshots(snapshot, { ...snapshot, observedAt: new Date("2026-01-05T00:00:00Z") });
      expect(report.hasChanges).toBe(false);
      expect(report.detectedChanges.length).toBe(0);
    });
  });
});
