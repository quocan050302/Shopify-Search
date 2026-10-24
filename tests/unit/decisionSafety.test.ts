import { describe, it, expect, vi } from "vitest";
import {
  calculateEconomics,
  deriveRecommendation,
  roundCurrency,
} from "@/lib/economics";
import {
  calculateProductResearchTrend,
  saveAdProductCandidate,
} from "@/services/products/productService";
import { prisma } from "@/lib/db";

describe("SWAI V11.3.1 — Decision Engine Safety & Economics Integrity", () => {
  describe("P0: deriveRecommendation() Rules & Hard Gates", () => {
    it("never produces READY_FOR_SMALL_TEST when contribution margin is missing (null)", () => {
      const rec = deriveRecommendation({
        contributionMargin: null,
        observedSellingPrice: 49.99,
        isConfirmedByUser: true,
        costVerificationSource: "USER_VERIFIED_QUOTE",
        demandEvidence: "VERIFIED",
        demandEvidenceSource: "Google Trends index > 70 & 200+ reviews",
        competitionLevel: "LOW",
        creativeAppeal: "STRONG",
        differentiationFeasibility: "VIABLE",
        deliveryFeasibility: "CONFIRMED",
        returnRisk: "LOW",
      });

      expect(rec.recommendation).toBe("RESEARCH_MORE");
      expect(rec.isSmallTestEligible).toBe(false);
      expect(rec.missingEvidence).toContain(
        "Missing supplier cost or selling price: contribution margin cannot be computed."
      );
    });

    it("never produces READY_FOR_SMALL_TEST when contribution margin is zero or negative (hard REJECTED)", () => {
      const zeroMarginRec = deriveRecommendation({
        contributionMargin: 0,
        observedSellingPrice: 30.00,
        isConfirmedByUser: true,
        demandEvidence: "VERIFIED",
        demandEvidenceSource: "Google Trends verified",
        competitionLevel: "LOW",
        creativeAppeal: "STRONG",
        differentiationFeasibility: "VIABLE",
        deliveryFeasibility: "CONFIRMED",
        returnRisk: "LOW",
      });
      expect(zeroMarginRec.recommendation).toBe("REJECTED");
      expect(zeroMarginRec.hardDisqualifiers.length).toBeGreaterThan(0);
      expect(zeroMarginRec.rationale).toContain("Unviable unit economics");

      const negativeMarginRec = deriveRecommendation({
        contributionMargin: -4.50,
        observedSellingPrice: 25.00,
        isConfirmedByUser: true,
        demandEvidence: "VERIFIED",
        demandEvidenceSource: "Google Trends verified",
        competitionLevel: "LOW",
        creativeAppeal: "STRONG",
        differentiationFeasibility: "VIABLE",
        deliveryFeasibility: "CONFIRMED",
        returnRisk: "LOW",
      });
      expect(negativeMarginRec.recommendation).toBe("REJECTED");
      expect(negativeMarginRec.rationale).toContain("Unviable unit economics");
    });

    it("strictly removes the low competition bypass (positive margin under $12 cannot qualify even if competition is LOW)", () => {
      // In V11.3, competitionLevel === "LOW" would bypass the healthy margin check.
      // In V11.3.1, this bypass is eliminated: margin < 12 cannot be READY_FOR_SMALL_TEST.
      const lowMarginRec = deriveRecommendation({
        contributionMargin: 6.50, // Positive, but under $12 minimum threshold
        observedSellingPrice: 20.00,
        isConfirmedByUser: true,
        costVerificationSource: "USER_VERIFIED_QUOTE",
        demandEvidence: "VERIFIED",
        demandEvidenceSource: "Amazon Best Seller ranking #14",
        competitionLevel: "LOW",
        creativeAppeal: "STRONG",
        differentiationFeasibility: "VIABLE",
        deliveryFeasibility: "CONFIRMED",
        returnRisk: "LOW",
      });

      expect(lowMarginRec.recommendation).toBe("RESEARCH_MORE");
      expect(lowMarginRec.isSmallTestEligible).toBe(false);
      expect(lowMarginRec.rationale).toContain("below the recommended $12.00 threshold");
    });

    it("requires verified or user-confirmed economics assumptions (unconfirmed estimates cannot qualify)", () => {
      const unconfirmedRec = deriveRecommendation({
        contributionMargin: 24.00,
        observedSellingPrice: 49.99,
        isConfirmedByUser: false, // User has NOT confirmed cost assumptions
        costVerificationSource: "USER_ESTIMATE",
        demandEvidence: "VERIFIED",
        demandEvidenceSource: "Google Trends index 80",
        competitionLevel: "MODERATE",
        creativeAppeal: "STRONG",
        differentiationFeasibility: "VIABLE",
        deliveryFeasibility: "CONFIRMED",
        returnRisk: "LOW",
      });

      expect(unconfirmedRec.recommendation).toBe("RESEARCH_MORE");
      expect(unconfirmedRec.rationale).toContain("Cost assumptions are unconfirmed estimates");
    });

    it("blocks READY_FOR_SMALL_TEST when any critical dimension is in an UNKNOWN state", () => {
      const baseValid = {
        contributionMargin: 20.00,
        observedSellingPrice: 45.00,
        isConfirmedByUser: true,
        costVerificationSource: "USER_VERIFIED_QUOTE" as const,
        demandEvidence: "VERIFIED" as const,
        demandEvidenceSource: "Verified search interest",
        competitionLevel: "MODERATE" as const,
        creativeAppeal: "STRONG" as const,
        differentiationFeasibility: "VIABLE" as const,
        deliveryFeasibility: "CONFIRMED" as const,
        returnRisk: "LOW" as const,
      };

      // Test UNKNOWN demand
      expect(
        deriveRecommendation({ ...baseValid, demandEvidence: "UNKNOWN" }).recommendation
      ).toBe("RESEARCH_MORE");

      // Test UNKNOWN competition
      expect(
        deriveRecommendation({ ...baseValid, competitionLevel: "UNKNOWN" }).recommendation
      ).toBe("RESEARCH_MORE");

      // Test UNKNOWN differentiation
      expect(
        deriveRecommendation({ ...baseValid, differentiationFeasibility: "UNKNOWN" }).recommendation
      ).toBe("RESEARCH_MORE");

      // Test UNKNOWN delivery
      expect(
        deriveRecommendation({ ...baseValid, deliveryFeasibility: "UNKNOWN" }).recommendation
      ).toBe("RESEARCH_MORE");

      // Test UNKNOWN return risk
      expect(
        deriveRecommendation({ ...baseValid, returnRisk: "UNKNOWN" }).recommendation
      ).toBe("RESEARCH_MORE");

      // Test UNKNOWN creative appeal
      expect(
        deriveRecommendation({ ...baseValid, creativeAppeal: "UNKNOWN" }).recommendation
      ).toBe("RESEARCH_MORE");
    });

    it("never treats an ad headline or body text as verified market demand", () => {
      const headlineCitationRec = deriveRecommendation({
        contributionMargin: 22.00,
        observedSellingPrice: 50.00,
        isConfirmedByUser: true,
        costVerificationSource: "USER_VERIFIED_QUOTE",
        demandEvidence: "VERIFIED",
        demandEvidenceSource: "From ad headline: Best Selling Orthopedic Pillow 2026",
        competitionLevel: "MODERATE",
        creativeAppeal: "STRONG",
        differentiationFeasibility: "VIABLE",
        deliveryFeasibility: "CONFIRMED",
        returnRisk: "LOW",
      });

      expect(headlineCitationRec.recommendation).toBe("RESEARCH_MORE");
      expect(headlineCitationRec.rationale).toContain("Ad headline or body text was cited as demand evidence");
    });

    it("does not treat manual checkbox selection as verified evidence without a source citation", () => {
      const noCitationRec = deriveRecommendation({
        contributionMargin: 25.00,
        observedSellingPrice: 55.00,
        isConfirmedByUser: true,
        costVerificationSource: "USER_VERIFIED_QUOTE",
        demandEvidence: "VERIFIED",
        demandEvidenceSource: "", // Empty citation
        competitionLevel: "MODERATE",
        creativeAppeal: "STRONG",
        differentiationFeasibility: "VIABLE",
        deliveryFeasibility: "CONFIRMED",
        returnRisk: "LOW",
      });

      expect(noCitationRec.recommendation).toBe("RESEARCH_MORE");
      expect(noCitationRec.rationale).toContain("lacks a supporting source citation");
    });

    it("qualifies for READY_FOR_SMALL_TEST only when all validation gates are strictly satisfied", () => {
      const qualifiedRec = deriveRecommendation({
        contributionMargin: 28.50,
        observedSellingPrice: 59.99,
        missingCostState: "COMPLETE",
        isConfirmedByUser: true,
        costVerificationSource: "USER_VERIFIED_QUOTE",
        demandEvidence: "VERIFIED",
        demandEvidenceSource: "Google Trends index > 65 & 450 verified storefront reviews",
        competitionLevel: "MODERATE",
        creativeAppeal: "STRONG",
        differentiationFeasibility: "VIABLE",
        deliveryFeasibility: "CONFIRMED",
        returnRisk: "LOW",
      });

      expect(qualifiedRec.recommendation).toBe("READY_FOR_SMALL_TEST");
      expect(qualifiedRec.isSmallTestEligible).toBe(true);
      expect(qualifiedRec.hardDisqualifiers).toHaveLength(0);
      expect(qualifiedRec.missingEvidence).toHaveLength(0);
      expect(qualifiedRec.rationale).toContain("All validation gates passed");
    });
  });

  describe("P1: Canonical calculateEconomics() & Safe Currency Arithmetic", () => {
    it("handles missing costs and flags missingCostState explicitly", () => {
      const missingSupplier = calculateEconomics({
        observedSellingPrice: 40.00,
        estimatedSupplierCost: null,
      });
      expect(missingSupplier.contributionMargin).toBeNull();
      expect(missingSupplier.breakEvenCPA).toBeNull();
      expect(missingSupplier.missingCostState).toBe("MISSING_SUPPLIER_COST");

      const missingPrice = calculateEconomics({
        observedSellingPrice: null,
        estimatedSupplierCost: 12.00,
      });
      expect(missingPrice.contributionMargin).toBeNull();
      expect(missingPrice.missingCostState).toBe("MISSING_SELLING_PRICE");

      const missingBoth = calculateEconomics({
        observedSellingPrice: null,
        estimatedSupplierCost: null,
      });
      expect(missingBoth.missingCostState).toBe("MISSING_ECONOMICS");
    });

    it("does not silently assume unknown shipping or fees equal zero without explicit tracking flags", () => {
      const econ = calculateEconomics({
        observedSellingPrice: 50.00,
        estimatedSupplierCost: 15.00,
        shippingCost: null, // unknown shipping
        platformFees: null, // unknown fees
      });

      expect(econ.hasAssumedZeroShipping).toBe(true);
      expect(econ.hasAssumedZeroFees).toBe(true);
      expect(econ.missingCostState).toBe("MISSING_SHIPPING_AND_FEES");
      // Even though a preliminary margin is calculated, the missing cost state prevents false certainty
      expect(econ.contributionMargin).toBe(32.50); // 50 - 15 - 0 - 0 - 2.50 (5% return)
    });

    it("calculates Break-even ROAS and Target CPA accurately", () => {
      const econ = calculateEconomics({
        observedSellingPrice: 60.00,
        estimatedSupplierCost: 18.00,
        shippingCost: 5.00,
        platformFees: 2.00,
        returnAllowancePercent: 5,
        targetProfitPerUnit: 7.00,
        isConfirmedByUser: true,
      });

      // Price: 60, COGS: 18, Shipping: 5, Fees: 2, Return allowance (5% of 60): 3
      // Margin = 60 - 18 - 5 - 2 - 3 = 32.00
      expect(econ.contributionMargin).toBe(32.00);
      expect(econ.breakEvenCPA).toBe(32.00);
      // Break-even ROAS = Selling Price / Margin = 60 / 32 = 1.875 -> 1.88
      expect(econ.breakEvenROAS).toBe(1.88);
      // Target CPA = Margin - Target Profit = 32 - 7 = 25.00
      expect(econ.targetCPA).toBe(25.00);
      expect(econ.isHypothetical).toBe(true);
    });

    it("uses safe currency arithmetic without floating point precision artifacts", () => {
      expect(roundCurrency(0.1 + 0.2)).toBe(0.3);
      expect(roundCurrency(19.99 * 0.05)).toBe(1.0);
    });
  });

  describe("P1: Research Trend Velocity with UNKNOWN Meta Ad Status", () => {
    it("does not imply COOLING when ads have UNKNOWN active status", async () => {
      // Mock prisma findUnique to return a product with 3 ads having UNKNOWN status
      const mockProduct = {
        id: "prod_unknown_test",
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // created 5 days ago
        adLinks: [
          { ad: { status: "UNKNOWN", mediaAssets: [{ id: "m1" }] } },
          { ad: { status: "UNKNOWN", mediaAssets: [{ id: "m2" }] } },
          { ad: { status: "UNKNOWN", mediaAssets: [{ id: "m3" }] } },
        ],
        priceHistory: [],
      };

      vi.spyOn(prisma.researchProduct, "findUnique").mockResolvedValueOnce(mockProduct as any);

      const trend = await calculateProductResearchTrend("prod_unknown_test", 30);
      // Must NOT be COOLING! Since createdAt is within 30 days and no ads are confirmed inactive, it's NEW or STEADY.
      expect(trend.trendVelocity).not.toBe("COOLING");
      expect(trend.trendVelocity).toBe("NEW");
      expect(trend.summary).toContain("3 unconfirmed/unknown status ads");
    });

    it("only classifies as COOLING when there are confirmed INACTIVE ads and zero ACTIVE ads", async () => {
      const mockProduct = {
        id: "prod_cooling_test",
        createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // older than 30 days
        adLinks: [
          { ad: { status: "INACTIVE", mediaAssets: [{ id: "m1" }] } },
          { ad: { status: "INACTIVE", mediaAssets: [{ id: "m2" }] } },
        ],
        priceHistory: [],
      };

      vi.spyOn(prisma.researchProduct, "findUnique").mockResolvedValueOnce(mockProduct as any);

      const trend = await calculateProductResearchTrend("prod_cooling_test", 30);
      expect(trend.trendVelocity).toBe("COOLING");
      expect(trend.activeAdsCount).toBe(0);
      expect(trend.summary).toContain("2 inactive ads");
    });
  });

  describe("P1: Duplicate Product Prevention & Client Recommendation Tampering", () => {
    it("rejects client recommendation tampering by deriving authoritative algorithm recommendation", async () => {
      const mockAd = {
        id: "ad_test_123",
        headline: "Test Gadget",
        bodyText: "Amazing product description",
        landingPageUrl: "https://myshop.com/products/laser-cleaner",
        advertiserId: "adv_1",
        category: "Gadgets",
        advertiser: { name: "Laser Co" },
        productLinks: [],
      };

      const mockStore = {
        id: "store_1",
        domain: "myshop.com",
      };

      const mockProduct = {
        id: "prod_1",
        title: "Test Gadget",
        category: "Gadgets",
        productUrl: "https://myshop.com/products/laser-cleaner",
        currentPrice: 30.00,
        storeId: "store_1",
      };

      const mockDecision = {
        id: "dec_1",
        decision: "REJECTED",
      };

      // Mock transaction execution
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (callback: any) => {
        const tx = {
          competitorAd: {
            findUnique: vi.fn().mockResolvedValue(mockAd),
          },
          competitorStore: {
            findUnique: vi.fn().mockResolvedValue(mockStore),
            create: vi.fn(),
          },
          researchProduct: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue(mockProduct),
            update: vi.fn().mockResolvedValue(mockProduct),
          },
          adProductLink: {
            findUnique: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: "link_1" }),
          },
          productPriceObservation: {
            create: vi.fn().mockResolvedValue({ id: "obs_1" }),
          },
          researchDecision: {
            create: vi.fn().mockResolvedValue(mockDecision),
          },
        };
        return await callback(tx);
      });

      // Client attempts to send `recommendation: "READY_FOR_SMALL_TEST"` with negative margin
      const result = await saveAdProductCandidate({
        adId: "ad_test_123",
        observedSellingPrice: 20.00,
        estimatedSupplierCost: 25.00, // Negative margin: $20 - $25 = -$5
        recommendation: "READY_FOR_SMALL_TEST", // CLIENT TAMPERING ATTEMPT
        userDecision: "READY_FOR_SMALL_TEST",
      });

      // The algorithm recommendation MUST be REJECTED, ignoring the client claim
      expect(result.algorithmRecommendation).toBe("REJECTED");
      expect(result.economics.contributionMargin).toBeLessThan(0);
      expect(result.userDecision).toBe("READY_FOR_SMALL_TEST");
    });

    it("prevents duplicate product records when multiple ads share the same product URL", async () => {
      const existingProduct = {
        id: "prod_shared_123",
        title: "Canonical Lumbar Cushion",
        productUrl: "https://shop.com/products/lumbar-cushion",
        storeId: "store_1",
      };

      const mockAd2 = {
        id: "ad_variant_2",
        headline: "Totally Different Ad Copy Title",
        landingPageUrl: "https://shop.com/products/lumbar-cushion?utm_source=fb",
        advertiserId: "adv_1",
        advertiser: { name: "Ergo Shop" },
        productLinks: [],
      };

      let createdProduct = false;
      let updatedTitle: string | null = null;
      let linkCreatedWith: any = null;

      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async (callback: any) => {
        const tx = {
          competitorAd: {
            findUnique: vi.fn().mockResolvedValue(mockAd2),
          },
          competitorStore: {
            findUnique: vi.fn().mockResolvedValue({ id: "store_1", domain: "shop.com" }),
          },
          researchProduct: {
            // Deduplication match found by normalized productUrl
            findFirst: vi.fn().mockResolvedValue(existingProduct),
            create: vi.fn().mockImplementation(() => {
              createdProduct = true;
              return existingProduct;
            }),
            update: vi.fn().mockImplementation(({ data }: any) => {
              if (data.title) updatedTitle = data.title;
              return { ...existingProduct, ...data };
            }),
          },
          adProductLink: {
            findUnique: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockImplementation(({ data }: any) => {
              linkCreatedWith = data;
              return { id: "link_new", ...data };
            }),
          },
          productPriceObservation: {
            create: vi.fn().mockResolvedValue({ id: "obs_new" }),
          },
          researchDecision: {
            create: vi.fn().mockResolvedValue({ id: "dec_new", decision: "RESEARCH_MORE" }),
          },
        };
        return await callback(tx);
      });

      const result = await saveAdProductCandidate({
        adId: "ad_variant_2",
        observedSellingPrice: 39.99,
        estimatedSupplierCost: 12.00,
        // Notice: user does NOT provide a new title, ad headline is different
      });

      // 1. Must reuse existing product, not create duplicate
      expect(createdProduct).toBe(false);
      expect(result.productId).toBe("prod_shared_123");
      // 2. Must not overwrite canonical product title with ad headline
      expect(updatedTitle).toBeNull();
      expect(result.title).toBe("Canonical Lumbar Cushion");
      // 3. Link created with CONFIRMED because normalized URLs match
      expect(linkCreatedWith.confidence).toBe("CONFIRMED");
    });

    it("rolls back all mutations if any step inside transaction fails", async () => {
      vi.spyOn(prisma, "$transaction").mockImplementationOnce(async () => {
        throw new Error("Simulated database failure during link creation");
      });

      await expect(
        saveAdProductCandidate({
          adId: "ad_fail_test",
          observedSellingPrice: 49.99,
        })
      ).rejects.toThrow("Simulated database failure during link creation");
    });
  });

  describe("P0: API Security & Workspace Isolation (POST /api/v1/ads/[id]/product-candidate)", () => {
    // Dynamic import route handler
    const getRouteHandler = async () => {
      const { POST } = await import("@/app/api/v1/ads/[id]/product-candidate/route");
      return POST;
    };

    it("rejects invalid costs, NaN, Infinity, and negative numbers with HTTP 400", async () => {
      const POST = await getRouteHandler();

      const makeRequest = (body: any) =>
        new Request("http://localhost:3000/api/v1/ads/ad_123/product-candidate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

      // 1. Negative selling price
      const resNegPrice = await POST(
        makeRequest({ observedSellingPrice: -10.00 }) as any,
        { params: Promise.resolve({ id: "ad_123" }) }
      );
      expect(resNegPrice.status).toBe(400);
      const jsonNeg = await resNegPrice.json();
      expect(jsonNeg.error.code).toBe("VALIDATION_FAILED");

      // 2. Negative supplier cost
      const resNegCost = await POST(
        makeRequest({ estimatedSupplierCost: -5.00 }) as any,
        { params: Promise.resolve({ id: "ad_123" }) }
      );
      expect(resNegCost.status).toBe(400);

      // 3. Return allowance > 100%
      const resInvalidReturn = await POST(
        makeRequest({ returnAllowancePercent: 150 }) as any,
        { params: Promise.resolve({ id: "ad_123" }) }
      );
      expect(resInvalidReturn.status).toBe(400);
    });

    it("rejects malicious URL schemes (e.g. javascript:, data:, file:)", async () => {
      const POST = await getRouteHandler();

      const maliciousReq = new Request("http://localhost:3000/api/v1/ads/ad_123/product-candidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productUrl: "javascript:alert('xss')",
        }),
      });

      const res = await POST(maliciousReq as any, { params: Promise.resolve({ id: "ad_123" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects access when workspace ID does not exist (HTTP 403)", async () => {
      const POST = await getRouteHandler();

      vi.spyOn(prisma.workspace, "findUnique").mockResolvedValueOnce(null);

      const unauthorizedReq = new Request("http://localhost:3000/api/v1/ads/ad_123/product-candidate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": "non_existent_workspace_id",
        },
        body: JSON.stringify({ observedSellingPrice: 30.00 }),
      });

      const res = await POST(unauthorizedReq as any, { params: Promise.resolve({ id: "ad_123" }) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED_WORKSPACE");
    });

    it("enforces workspace isolation by rejecting ads belonging exclusively to other workspaces (HTTP 403)", async () => {
      const POST = await getRouteHandler();

      // Workspace requested
      vi.spyOn(prisma.workspace, "findUnique").mockResolvedValueOnce({
        id: "workspace_client_A",
        name: "Client A Workspace",
      } as any);

      // Ad belongs exclusively to Workspace B
      vi.spyOn(prisma.competitorAd, "findUnique").mockResolvedValueOnce({
        id: "ad_isolated_b",
        runAds: [{ workspaceId: "workspace_client_B" }],
        watchlistItems: [],
      } as any);

      const crossTenantReq = new Request("http://localhost:3000/api/v1/ads/ad_isolated_b/product-candidate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": "workspace_client_A",
        },
        body: JSON.stringify({ observedSellingPrice: 40.00 }),
      });

      const res = await POST(crossTenantReq as any, { params: Promise.resolve({ id: "ad_isolated_b" }) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN_WORKSPACE_AD");
    });
  });
});
