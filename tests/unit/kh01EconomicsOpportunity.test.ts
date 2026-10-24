import { describe, it, expect } from "vitest";
import {
  parseMoney,
  calculateOrderEconomics,
  buildOfferEconomicsScenario,
  compareEconomicsScenarios,
  evaluateEconomicsEligibility,
} from "@/lib/economics";
import {
  calculateFulfillmentRisk,
  identifyCriticalFulfillmentGaps,
} from "@/services/research/fulfillmentAssessmentService";
import {
  calculateOpportunityAssessment,
  evaluateSmallTestReadiness,
  explainOpportunityRecommendation,
  evaluateProductPillar,
  evaluateEconomicsPillar,
} from "@/services/research/opportunityAssessmentService";

describe("KH-01.D — Product Economics & Opportunity Assessment Tests", () => {
  describe("Money Arithmetic & Precise Minor Units", () => {
    it("parses valid monetary inputs and rounds to 2 decimal places with minor units", () => {
      const parsed = parseMoney("29.994");
      expect(parsed.amount).toBe(29.99);
      expect(parsed.minorUnits).toBe(2999);
      expect(parsed.currency).toBe("USD");
      expect(parsed.formatted).toBe("$29.99");
    });

    it("rejects malformed, null, or nonfinite numbers", () => {
      expect(() => parseMoney("")).toThrow();
      expect(() => parseMoney(null)).toThrow();
      expect(() => parseMoney(NaN)).toThrow();
      expect(() => parseMoney(Infinity)).toThrow();
      expect(() => parseMoney("invalid_money")).toThrow();
    });
  });

  describe("Order Economics Calculations", () => {
    it("calculates single-unit order contribution with full inputs", () => {
      const res = calculateOrderEconomics({
        unitsPerOrder: 1,
        sellingPricePerUnit: 39.99,
        supplierCostPerUnit: 8.50,
        shippingChargedToCustomer: 0, // Free shipping
        actualShippingCostPaid: 5.50, // $5.50 subsidy
        fulfillmentCostPerOrder: 2.00,
        paymentProcessingFeePercent: 2.9,
        paymentProcessingFeeFixed: 0.30,
        otherVariableCostPerOrder: 1.00,
        expectedReturnRatePercent: 5,
        recoverableCostOnReturnPercent: 0,
        targetProfitPerOrder: 10.00,
      });

      expect(res.grossMerchandiseValue).toBe(39.99);
      expect(res.netSellingRevenue).toBe(39.99);
      expect(res.cogs).toBe(8.50);
      expect(res.shippingSubsidy).toBe(5.50);
      expect(res.fulfillmentCost).toBe(2.00);
      // Payment fee: 39.99 * 0.029 + 0.30 = 1.15971 + 0.30 = 1.46
      expect(res.paymentProcessingFee).toBe(1.46);
      // Return loss: 39.99 * 0.05 = 2.00
      expect(res.expectedReturnLoss).toBe(2.00);

      // Margin: 39.99 - 8.50 - 5.50 - 2.00 - 1.46 - 1.00 - 2.00 = 19.53
      expect(res.contributionBeforeAds).toBe(19.53);
      expect(res.breakEvenCpa).toBe(19.53);
      // Target CPA: 19.53 - 10.00 = 9.53
      expect(res.targetCpa).toBe(9.53);
      // Break-even ROAS: 39.99 / 19.53 = 2.05
      expect(res.breakEvenRoas).toBe(2.05);
      // Target ROAS: 39.99 / 9.53 = 4.20
      expect(res.targetRoas).toBe(4.20);
      expect(res.isComplete).toBe(true);
      expect(res.missingInputs).toHaveLength(0);
    });

    it("multiplies units correctly for multi-unit bundle scenarios", () => {
      const bundle = buildOfferEconomicsScenario(
        { currentPrice: 29.99, currency: "USD" },
        {
          name: "2-Pack Special",
          type: "TWO_UNIT_BUNDLE",
          units: 2,
          bundleSellingPrice: 49.99,
          freeShippingApplied: true,
        },
        {
          supplierUnitCost: 6.00, // 2 * 6 = $12 COGS
          shippingPaidPerOrder: 6.50,
          shippingChargedToCustomer: 0,
          fulfillmentFeePerOrder: 2.50,
          paymentFeePercent: 2.9,
          paymentFeeFixed: 0.30,
        }
      );

      expect(bundle.unitsPerOrder).toBe(2);
      expect(bundle.netSellingRevenue).toBe(49.99);
      expect(bundle.cogs).toBe(12.00);
      expect(bundle.shippingSubsidy).toBe(6.50);
      // Higher revenue yields higher contribution margin cushion
      expect(bundle.contributionBeforeAds).toBeGreaterThan(20);
    });

    it("tracks missing COGS or missing shipping without assuming zero", () => {
      const missingCogs = calculateOrderEconomics({
        unitsPerOrder: 1,
        sellingPricePerUnit: 29.99,
        supplierCostPerUnit: null, // UNKNOWN COGS
        actualShippingCostPaid: 5.00,
        fulfillmentCostPerOrder: 1.50,
      });

      expect(missingCogs.isComplete).toBe(false);
      expect(missingCogs.missingCostState).toBe("MISSING_SUPPLIER_COST");
      expect(missingCogs.contributionBeforeAds).toBeNull();
      expect(missingCogs.breakEvenCpa).toBeNull();
      expect(missingCogs.missingInputs).toContain("Supplier cost (COGS) is unknown");

      const missingShipping = calculateOrderEconomics({
        unitsPerOrder: 1,
        sellingPricePerUnit: 29.99,
        supplierCostPerUnit: 7.00,
        actualShippingCostPaid: null, // UNKNOWN SHIPPING
      });

      expect(missingShipping.isComplete).toBe(false);
      expect(missingShipping.missingInputs).toContain("Actual shipping cost paid by merchant is unknown");
      expect(missingShipping.riskFlags).toContain("Shipping cost not confirmed; shipping subsidy omitted");
    });

    it("flags negative contribution when costs exceed selling price", () => {
      const negative = calculateOrderEconomics({
        unitsPerOrder: 1,
        sellingPricePerUnit: 15.00,
        supplierCostPerUnit: 12.00,
        actualShippingCostPaid: 6.00, // $6 shipping
        fulfillmentCostPerOrder: 2.00,
      });

      expect(negative.contributionBeforeAds).toBeLessThan(0);
      expect(negative.riskFlags).toContain("Contribution before ads is zero or negative. Unviable unit economics.");

      const eligibility = evaluateEconomicsEligibility(negative);
      expect(eligibility.isEligibleForTest).toBe(false);
      expect(eligibility.acquisitionCapacity).toBe("UNVIABLE");
    });

    it("compares multiple scenarios and identifies strongest configuration", () => {
      const single = calculateOrderEconomics({
        scenarioName: "Single Unit",
        unitsPerOrder: 1,
        sellingPricePerUnit: 29.99,
        supplierCostPerUnit: 8.00,
        actualShippingCostPaid: 5.00,
        fulfillmentCostPerOrder: 2.00,
      });

      const bundle = calculateOrderEconomics({
        scenarioName: "2-Unit Bundle",
        unitsPerOrder: 2,
        sellingPricePerUnit: 24.99, // $49.98 total
        supplierCostPerUnit: 8.00,   // $16.00 total
        actualShippingCostPaid: 6.00,
        fulfillmentCostPerOrder: 2.50,
      });

      const comp = compareEconomicsScenarios([single, bundle]);
      expect(comp.scenarios).toHaveLength(2);
      expect(comp.summary.highestContributionScenario).toBe("2-Unit Bundle");
      expect(comp.recommendedScenario).toBe("2-Unit Bundle");
    });
  });

  describe("Fulfillment & Operational Risk", () => {
    it("flags high risk for hazardous liquids or battery shipments", () => {
      const risk = calculateFulfillmentRisk({
        hasBatteryOrLiquid: true,
        productWeightGrams: 450,
        hasConfirmedSupplierQuote: true,
      });

      expect(risk.overallRiskLevel).toBe("HIGH");
      expect(risk.identifiedRisks.some((r) => r.includes("Battery or liquid"))).toBe(true);
    });

    it("identifies critical gaps when weights, quotes, and transit times are unknown", () => {
      const unverified = calculateFulfillmentRisk({
        hasConfirmedSupplierQuote: false,
        productWeightGrams: null,
        packageDimensionsCm: null,
      });

      const gaps = identifyCriticalFulfillmentGaps(unverified);
      expect(gaps.length).toBeGreaterThanOrEqual(3);
      expect(gaps.some((g) => g.includes("No confirmed supplier quote"))).toBe(true);
      expect(gaps.some((g) => g.includes("gross weight is unknown"))).toBe(true);
    });
  });

  describe("Six-Pillar Opportunity Assessment", () => {
    it("keeps Opportunity Score strictly separated from Evidence Readiness Score", () => {
      const singleScenario = calculateOrderEconomics({
        unitsPerOrder: 1,
        sellingPricePerUnit: 34.99,
        supplierCostPerUnit: 8.00,
        actualShippingCostPaid: 5.00,
        fulfillmentCostPerOrder: 2.00,
      });

      const assessment = calculateOpportunityAssessment({
        productId: "prod_pet_hair_remover",
        productEvidence: {
          productTitle: "Pet Hair Remover Roller",
          customerPainPointClarity: "CLEAR",
          problemSolved: "Removes stubborn pet hair from sofas and rugs instantly",
          observedDifferentiation: "Patented double-sided electrostatic silicone head",
          competitionLevel: "MODERATE",
          identityConfidence: "EXACT",
        },
        creativeEvidence: {
          adCount: 4,
          hasVideoDemonstration: true,
          hasBeforeAfterOrProblemHook: true,
          clearCtaObserved: true,
        },
        offerSnapshots: [
          {
            sellingPrice: 34.99,
            compareAtPrice: 49.99,
            currency: "USD",
            bundleQuantity: 1,
            hasFreeShipping: true,
          },
        ],
        economicsScenarios: [singleScenario],
        fulfillmentAssessment: {
          overallRiskLevel: "LOW",
          identifiedRisks: [],
          criticalGaps: [],
          leadTimeAssessment: "Competitive delivery",
          complianceStatus: "Standard",
          riskScore: 10,
        },
      });

      expect(assessment.opportunityScore).not.toBeNull();
      expect(assessment.evidenceReadinessScore).not.toBeNull();
      // Readiness is completeness of factual inputs, while opportunity score is analytical strength
      expect(assessment.opportunityScore).toBeGreaterThanOrEqual(60);
      expect(assessment.evidenceReadinessScore).toBeGreaterThanOrEqual(70);
    });

    it("returns null Opportunity Score when critical evidence is missing", () => {
      const assessment = calculateOpportunityAssessment({
        productId: "prod_sparse_data",
        productEvidence: {
          productTitle: "Uncertain Item",
          customerPainPointClarity: "UNKNOWN",
          identityConfidence: "INSUFFICIENT_EVIDENCE",
        },
        creativeEvidence: {
          adCount: 0,
        },
        offerSnapshots: [],
        economicsScenarios: [], // NO ECONOMICS
      });

      expect(assessment.opportunityScore).toBeNull();
      expect(assessment.evidenceReadinessScore).toBeLessThan(40);
      expect(assessment.recommendation).toBe("RESEARCH_MORE");
    });

    it("blocks test readiness when supplier cost or fulfillment is unverified", () => {
      const missingCostScenario = calculateOrderEconomics({
        unitsPerOrder: 1,
        sellingPricePerUnit: 29.99,
        supplierCostPerUnit: null, // missing cost!
      });

      const assessment = calculateOpportunityAssessment({
        productId: "prod_test_block",
        productEvidence: {
          productTitle: "Cool Gadget",
          customerPainPointClarity: "CLEAR",
          identityConfidence: "EXACT",
        },
        creativeEvidence: {
          adCount: 5,
          hasVideoDemonstration: true,
        },
        offerSnapshots: [{ sellingPrice: 29.99 }],
        economicsScenarios: [missingCostScenario],
      });

      const readiness = evaluateSmallTestReadiness(assessment);
      expect(readiness.isReadyForSmallTest).toBe(false);
      expect(readiness.status).toBe("BLOCKED_MISSING_DATA");
      expect(readiness.unmetRequirements.some((u) => u.includes("Verified Unit Economics"))).toBe(true);
    });

    it("generates an explainable recommendation narrative without fabricated data", () => {
      const scenario = calculateOrderEconomics({
        unitsPerOrder: 1,
        sellingPricePerUnit: 39.99,
        supplierCostPerUnit: 10.00,
        actualShippingCostPaid: 5.00,
        fulfillmentCostPerOrder: 2.00,
      });

      const assessment = calculateOpportunityAssessment({
        productId: "prod_explainable",
        productEvidence: {
          productTitle: "Car Vacuum Cleaner",
          customerPainPointClarity: "CLEAR",
          identityConfidence: "EXACT",
        },
        creativeEvidence: { adCount: 2, hasVideoDemonstration: true },
        offerSnapshots: [{ sellingPrice: 39.99 }],
        economicsScenarios: [scenario],
      });

      const explanation = explainOpportunityRecommendation(assessment);
      expect(explanation.summary).toBeDefined();
      expect(explanation.inferredClaims).toContain(
        "Competitor conversion rate and sales volume are NOT directly measured and remain unverified"
      );
      expect(explanation.hypothesisFalsificationConditions.length).toBeGreaterThan(0);
    });
  });
});
