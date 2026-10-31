/**
 * KH-01 — Real-World Live Source Acceptance Test
 *
 * Classification: LIVE_SOURCE_ACCEPTANCE
 *
 * Validates real source-backed Meta advertisement (Library ID: 1642750633880173, Advertiser: Uproot Clean)
 * against its authorized live public landing page without mocks or synthetic data fabrication.
 */

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import {
  validatePublicResearchUrl,
  fetchPublicResearchPage,
} from "@/services/links/linkValidationService";
import { parsePublicLandingPage } from "@/services/research/landingPageInspectionService";
import {
  extractStructuredProductOffer,
  extractPromotionalOffer,
  normalizeCompetitorOffer,
} from "@/services/research/offerExtractionService";
import { analyzeCompetitorFunnel } from "@/services/research/funnelAnalysisService";
import {
  calculateOpportunityAssessment,
  evaluateSmallTestReadiness,
} from "@/services/research/opportunityAssessmentService";

describe("KH-01 — LIVE_SOURCE_ACCEPTANCE: Authentic Meta Ad & Real Storefront Verification", () => {
  const REAL_META_LIB_ID = "1642750633880173";
  const REAL_ADVERTISER = "Uproot Clean";
  const REAL_LANDING_URL = "https://cc.uprootclean.com/main/phr";

  it("verifies authentic Meta ad record exists in active research database with provenance", async () => {
    const ad = await prisma.competitorAd.findFirst({
      where: { externalAdId: REAL_META_LIB_ID },
      include: { advertiser: true, dataSource: true },
    });

    expect(ad).not.toBeNull();
    expect(ad?.externalAdId).toBe(REAL_META_LIB_ID);
    expect(ad?.advertiser.name).toBe(REAL_ADVERTISER);
    expect(ad?.platform).toBe("META");
    expect(ad?.landingPageUrl).toBe(REAL_LANDING_URL);
    expect(ad?.originalAdUrl).toContain(REAL_META_LIB_ID);
  });

  it("performs bounded public landing page inspection with IP security and genuine extraction", async () => {
    // 1. SSRF & Scheme Validation
    const validated = validatePublicResearchUrl(REAL_LANDING_URL);
    expect(validated.protocol).toBe("https:");
    expect(validated.hostname).toBe("cc.uprootclean.com");
    expect(validated.isPublic).toBe(true);

    // 2. Safe bounded fetch (concurrency 1, timeout 8000ms, cap 2MB)
    const fetchResult = await fetchPublicResearchPage(validated, {
      timeoutMs: 8000,
      maxRedirects: 3,
      maxResponseBytes: 2 * 1024 * 1024,
    });

    expect(fetchResult.httpStatus).toBe(200);
    expect(fetchResult.statusClassification).toBe("SUCCESS");
    expect(fetchResult.contentLengthBytes).toBeGreaterThan(10000);
    expect(fetchResult.isTruncated).toBe(false);
    expect(fetchResult.content).not.toBeNull();

    // 3. Document Parsing
    const parsed = parsePublicLandingPage(fetchResult.content!, fetchResult.finalUrl);
    expect(parsed.pageTitle).toBeTruthy();
    expect(parsed.visibleHeadings.length).toBeGreaterThan(0);
    expect(parsed.ctaButtons.length).toBeGreaterThan(0);
    expect(parsed.visiblePrices.length).toBeGreaterThan(0);

    // 4. Commercial Offer Extraction (Truthful observed data only)
    const structuredOffers = extractStructuredProductOffer(parsed);
    const promotions = extractPromotionalOffer(parsed);
    const normalizedOffer = normalizeCompetitorOffer(structuredOffers, promotions, {
      productId: "live_test_product",
      adId: "live_test_ad",
      sourceUrl: validated.originalUrl,
      finalUrl: fetchResult.finalUrl,
    });

    expect(normalizedOffer.sellingPrice).toBeGreaterThan(0);
    expect(normalizedOffer.currency).toBe("USD");
    expect(normalizedOffer.bundleQuantity).toBeGreaterThanOrEqual(1);

    // 5. Funnel Analysis
    const funnel = analyzeCompetitorFunnel({
      page: parsed,
      offer: normalizedOffer,
    });

    expect(funnel.croReadiness).toBeGreaterThan(50);
    expect(funnel.trustSignals.score).toBeGreaterThanOrEqual(50);

    // 6. Decision Integrity Check:
    // Without verified supplier quotes and unit economics, the canonical decision gate
    // must REJECT small test readiness (never hallucinate test readiness from CRO alone!)
    const opportunity = calculateOpportunityAssessment({
      productId: "live_test_product",
      productEvidence: {
        productTitle: parsed.pageTitle || "Uproot Clean Pet Hair Remover",
        category: "Pet Supplies",
        customerPainPointClarity: "CLEAR",
        identityConfidence: "PROBABLE",
      },
      creativeEvidence: {
        adCount: 1,
        hasVideoDemonstration: false, // Not inspected via video player
        clearCtaObserved: true,
      },
      offerSnapshots: [normalizedOffer],
      funnelAssessment: funnel,
      economicsScenarios: [], // NO economics entered yet!
    });

    const readiness = evaluateSmallTestReadiness(opportunity);
    // Economics gate MUST fail because no economics were modeled
    const economicsGate = readiness.gateChecks.find((g) => g.name === "Verified Unit Economics");
    expect(economicsGate?.passed).toBe(false);
    expect(readiness.isReadyForSmallTest).toBe(false);
    expect(opportunity.recommendation).not.toBe("TEST_CANDIDATE");
  });
});
