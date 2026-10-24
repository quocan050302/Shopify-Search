import { describe, it, expect } from "vitest";
import {
  calculateOrderEconomics,
  evaluateEconomicsEligibility,
} from "@/lib/economics";
import {
  calculateOpportunityAssessment,
  evaluateSmallTestReadiness,
  explainOpportunityRecommendation,
  SixPillarOpportunityInput,
} from "@/services/research/opportunityAssessmentService";

describe("KH-01 Checkpoint 7: Shopify Economics & Six-Pillar Decision Integrity (Tasks 125–137)", () => {
  it("Scenario 1: Strong advertising evidence but unknown supplier cost strictly blocks TEST_CANDIDATE", () => {
    const input: SixPillarOpportunityInput = {
      productId: "prod_strong_ad_no_supplier",
      productEvidence: {
        productTitle: "Viral Pet Grooming Vacuum",
        customerPainPointClarity: "CLEAR",
        identityConfidence: "EXACT",
        hasCustomerDemandEvidence: true,
      },
      creativeEvidence: {
        adCount: 15,
        hasVideoDemonstration: true,
        hookQualityObserved: "STRONG",
        clearCtaObserved: true,
      },
      offerSnapshots: [
        {
          id: "offer_1",
          sellingPrice: 59.99,
          currency: "USD",
          observedAt: new Date(),
        },
      ],
      economicsScenarios: [
        calculateOrderEconomics({
          unitsPerOrder: 1,
          sellingPricePerUnit: 59.99,
          supplierCostPerUnit: null, // UNKNOWN SUPPLIER COST
          actualShippingCostPaid: 8.0,
          fulfillmentCostPerOrder: 3.0,
        }),
      ],
    };

    const assessment = calculateOpportunityAssessment(input);
    expect(assessment.recommendation).not.toBe("TEST_CANDIDATE");
    expect(assessment.recommendation).toBe("RESEARCH_MORE");

    const readiness = evaluateSmallTestReadiness(assessment);
    expect(readiness.isReadyForSmallTest).toBe(false);
    expect(readiness.status).toBe("BLOCKED_MISSING_DATA");
    expect(readiness.unmetRequirements.some((r) => r.includes("Verified Unit Economics"))).toBe(true);
  });

  it("Scenario 2: Missing shipping cost is never assumed to be zero", () => {
    const economics = calculateOrderEconomics({
      unitsPerOrder: 1,
      sellingPricePerUnit: 39.99,
      supplierCostPerUnit: 10.0,
      shippingChargedToCustomer: 0,
      actualShippingCostPaid: null, // MISSING SHIPPING
      fulfillmentCostPerOrder: 2.5,
    });

    expect(economics.isComplete).toBe(false);
    expect(economics.missingCostState).toBe("MISSING_SHIPPING_AND_FEES");
    expect(economics.missingInputs.some((m) => m.toLowerCase().includes("shipping"))).toBe(true);
    expect(economics.riskFlags.some((r) => r.toLowerCase().includes("shipping"))).toBe(true);

    const eligibility = evaluateEconomicsEligibility(economics);
    expect(eligibility.isEligibleForTest).toBe(false);
    expect(eligibility.acquisitionCapacity).toBe("INSUFFICIENT_DATA");
  });

  it("Scenario 3: Video presence alone does not prove product demonstration without verified demonstration evidence", () => {
    const assessment = calculateOpportunityAssessment({
      productId: "prod_video_no_demo",
      productEvidence: {
        productTitle: "Fashion Bag",
        customerPainPointClarity: "VAGUE",
        identityConfidence: "AMBIGUOUS",
      },
      creativeEvidence: {
        adCount: 2,
        hasVideoDemonstration: false, // Video exists in ad link, but no verified demo hook!
        hookQualityObserved: "UNVERIFIED",
      },
      offerSnapshots: [{ sellingPrice: 45.0 }],
      economicsScenarios: [],
    });

    expect(assessment.pillars.creative.status).not.toBe("PASS");
    expect(assessment.pillars.creative.missingEvidence.some((m) => m.toLowerCase().includes("video demonstration"))).toBe(true);
  });

  it("Scenario 4: Long-running ad does not prove sales, profitability, or competitor conversion rates", () => {
    const assessment = calculateOpportunityAssessment({
      productId: "prod_long_running_ad",
      productEvidence: {
        productTitle: "Orthopedic Pillow",
        customerPainPointClarity: "CLEAR",
        identityConfidence: "EXACT",
      },
      creativeEvidence: {
        adCount: 8,
        hasVideoDemonstration: true,
      },
      offerSnapshots: [{ sellingPrice: 49.99 }],
      economicsScenarios: [
        calculateOrderEconomics({
          unitsPerOrder: 1,
          sellingPricePerUnit: 49.99,
          supplierCostPerUnit: 12.0,
          actualShippingCostPaid: 6.0,
          fulfillmentCostPerOrder: 2.0,
        }),
      ],
    });

    const explanation = explainOpportunityRecommendation(assessment);
    expect(explanation.inferredClaims).toContain(
      "Competitor conversion rate and sales volume are NOT directly measured and remain unverified"
    );
  });

  it("Scenario 5: Blocked landing page (ACCESS_RESTRICTED) cannot receive a verified CRO pass", () => {
    const assessment = calculateOpportunityAssessment({
      productId: "prod_blocked_lp",
      productEvidence: {
        productTitle: "Blocked Gadget",
      },
      creativeEvidence: {
        adCount: 1,
      },
      offerSnapshots: [],
      funnelAssessment: {
        landingPageUrl: "https://competitor.com/product",
        httpStatus: 403,
        statusClassification: "ACCESS_RESTRICTED",
        isAccessible: false,
        elements: [],
        croChecklist: [],
        score: null,
      } as any,
      economicsScenarios: [],
    });

    expect(assessment.pillars.landingPage.status).toBe("FAIL");
    expect(assessment.pillars.landingPage.score).toBeNull();
    expect(assessment.pillars.landingPage.risks.some((r) => r.toLowerCase().includes("restriction"))).toBe(true);
  });

  it("Scenario 6: Partial opportunity score coverage is visible and distinct from Evidence Readiness", () => {
    const assessment = calculateOpportunityAssessment({
      productId: "prod_partial_coverage",
      productEvidence: {
        productTitle: "Partially Researched Item",
        customerPainPointClarity: "CLEAR",
        identityConfidence: "PROBABLE",
      },
      creativeEvidence: {
        adCount: 3,
        hasVideoDemonstration: true,
      },
      offerSnapshots: [{ sellingPrice: 29.99 }],
      economicsScenarios: [
        calculateOrderEconomics({
          unitsPerOrder: 1,
          sellingPricePerUnit: 29.99,
          supplierCostPerUnit: 7.0,
          actualShippingCostPaid: 4.5,
          fulfillmentCostPerOrder: 1.5,
        }),
      ],
      // No funnel assessment, no fulfillment assessment
    });

    expect(assessment.isPartialScore).toBe(true);
    expect(assessment.assessedCoveragePercent).toBeDefined();
    expect(assessment.assessedCoveragePercent).toBeLessThan(100);
    expect(assessment.evidenceReadinessScore).toBeDefined();
    // Readiness and score are mathematically distinct
    expect(typeof assessment.opportunityScore === "number" || assessment.opportunityScore === null).toBe(true);
    expect(typeof assessment.evidenceReadinessScore).toBe("number");
  });

  it("Scenario 7: User override decision is preserved and distinguished from algorithmic readiness", () => {
    const assessment = calculateOpportunityAssessment({
      productId: "prod_override_test",
      productEvidence: {
        productTitle: "Experimental Item",
      },
      creativeEvidence: { adCount: 1 },
      offerSnapshots: [],
      economicsScenarios: [],
    });

    // Algorithmic check
    const algoReadiness = evaluateSmallTestReadiness(assessment);
    expect(algoReadiness.isReadyForSmallTest).toBe(false);
    expect(algoReadiness.status).toBe("BLOCKED_MISSING_DATA");

    // Simulated user override
    const userOverrideReadiness = evaluateSmallTestReadiness(assessment, {
      allowUserOverride: true,
      overrideReason: "Founder testing 5 sample units with verified local inventory",
    });
    expect(userOverrideReadiness.isReadyForSmallTest).toBe(true);
    expect(userOverrideReadiness.status).toBe("USER_OVERRIDE");
    expect(userOverrideReadiness.unmetRequirements.length).toBeGreaterThan(0);
  });
});
