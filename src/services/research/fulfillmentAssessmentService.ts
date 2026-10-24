import { prisma } from "@/lib/db";
import { ResearchAccessContext, assertProductWorkspaceAccess } from "./researchAuthService";
import { createResearchEvidence } from "./evidenceService";

export interface SupplierQuoteInput {
  productId: string;
  supplierName: string;
  productIdentifier?: string;
  currency?: string;
  unitCost: number;
  moq?: number;
  processingTimeDays?: number;
  shippingCostEstimate?: number;
  shippingLeadTimeDays?: number;
  destinationCountry?: string;
  quoteSource: "SUPPLIER_INVOICE" | "DIRECT_CHAT" | "ALIBABA_LISTING" | "CJ_DROPSHIPPING" | "USER_ESTIMATE" | string;
  quoteDate?: string | Date;
  evidenceReference?: string;
}

export interface FulfillmentEvidence {
  productWeightGrams?: number | null;
  packageDimensionsCm?: string | null;
  isFragile?: boolean;
  hasBatteryOrLiquid?: boolean;
  processingLeadTimeDays?: number | null;
  shippingLeadTimeDays?: number | null;
  destinationCountry?: string;
  returnComplexity?: "SIMPLE" | "MODERATE" | "HIGH" | "UNKNOWN";
  regulatoryReviewNeeded?: boolean;
  hasConfirmedSupplierQuote?: boolean;
  knownRestrictions?: string[];
}

export interface FulfillmentAssessmentResult {
  overallRiskLevel: "LOW" | "MODERATE" | "HIGH" | "UNKNOWN";
  identifiedRisks: string[];
  criticalGaps: string[];
  leadTimeAssessment: string;
  complianceStatus: string;
  riskScore: number; // 0 (safe) to 100 (extreme risk)
}

/**
 * Records an authentic supplier quote with tenant validation and evidence linkage.
 */
export async function recordSupplierQuote(
  input: SupplierQuoteInput,
  context: ResearchAccessContext
) {
  await assertProductWorkspaceAccess(input.productId, context);

  if (!input.supplierName || input.supplierName.trim().length === 0) {
    throw new Error("Supplier name is required");
  }

  if (input.unitCost == null || isNaN(input.unitCost) || input.unitCost < 0) {
    throw new Error("Valid unit cost is required");
  }

  const quoteDate = input.quoteDate ? new Date(input.quoteDate) : new Date();

  const quote = await prisma.supplierQuote.create({
    data: {
      workspaceId: context.workspaceId,
      productId: input.productId,
      supplierName: input.supplierName.trim(),
      productIdentifier: input.productIdentifier?.trim() || null,
      currency: (input.currency || "USD").toUpperCase(),
      unitCost: input.unitCost,
      moq: Math.max(1, input.moq || 1),
      processingTimeDays: input.processingTimeDays ?? null,
      shippingCostEstimate: input.shippingCostEstimate ?? null,
      shippingLeadTimeDays: input.shippingLeadTimeDays ?? null,
      destinationCountry: input.destinationCountry || "US",
      quoteSource: input.quoteSource || "USER_ESTIMATE",
      quoteDate,
      evidenceReference: input.evidenceReference?.trim() || null,
    },
  });

  // Record audit evidence
  const isEstimate = input.quoteSource === "USER_ESTIMATE";
  await createResearchEvidence(
    {
      subjectType: "PRODUCT",
      subjectId: input.productId,
      pillar: "ECONOMICS",
      claim: `Supplier unit quote: $${input.unitCost.toFixed(2)} from ${input.supplierName}`,
      observedValue: String(input.unitCost),
      observationMethod: "USER_INPUT",
      classification: isEstimate ? "USER_ESTIMATED" : "SOURCE_OBSERVED",
      sourceUrl: input.evidenceReference || null,
      sourceContentRef: `MOQ: ${quote.moq}, Shipping: $${input.shippingCostEstimate ?? "UNKNOWN"}`,
    },
    context
  );

  return quote;
}

/**
 * Evaluates operational, logistics, and compliance risks based on verifiable evidence.
 * Unknown parameters are strictly preserved as unknown gaps rather than assumed safe.
 */
export function calculateFulfillmentRisk(input: FulfillmentEvidence): FulfillmentAssessmentResult {
  const identifiedRisks: string[] = [];
  const criticalGaps: string[] = [];
  let riskScore = 0;

  // 1. Supplier Quote Availability
  if (!input.hasConfirmedSupplierQuote) {
    criticalGaps.push("No confirmed supplier quote on file (COGS and MOQ unverified)");
    riskScore += 25;
  }

  // 2. Weight and Dimensions
  if (input.productWeightGrams == null) {
    criticalGaps.push("Package gross weight is unknown (shipping rates cannot be verified)");
    riskScore += 15;
  } else if (input.productWeightGrams > 1500) {
    identifiedRisks.push(`Heavy shipment weight (${input.productWeightGrams}g): high air-freight and last-mile delivery surcharge`);
    riskScore += 25;
  } else if (input.productWeightGrams > 800) {
    identifiedRisks.push(`Moderate package weight (${input.productWeightGrams}g): shipping will consume $6-$10+ per parcel`);
    riskScore += 10;
  }

  if (!input.packageDimensionsCm) {
    criticalGaps.push("Package dimensions unknown: volumetric shipping penalties unverified");
    riskScore += 10;
  }

  // 3. Fragility & Hazmat
  if (input.isFragile) {
    identifiedRisks.push("Fragile goods: elevated damage in transit rate and return dispute exposure");
    riskScore += 20;
  }

  if (input.hasBatteryOrLiquid) {
    identifiedRisks.push("Battery or liquid contents: restricted air shipping lines, MSDS documentation required");
    riskScore += 30;
  }

  // 4. Lead Times (Processing + Transit)
  const procTime = input.processingLeadTimeDays ?? null;
  const shipTime = input.shippingLeadTimeDays ?? null;

  let leadTimeAssessment = "Lead times unverified";
  if (procTime == null && shipTime == null) {
    criticalGaps.push("Supplier processing and shipping lead times are unverified");
    riskScore += 15;
  } else {
    const totalLead = (procTime || 0) + (shipTime || 0);
    if (totalLead > 18) {
      identifiedRisks.push(`Excessive customer wait time (~${totalLead} days): high dispute, cancellation, and chargeback risk`);
      riskScore += 25;
      leadTimeAssessment = `Critical delivery delay: ~${totalLead} days total lead time`;
    } else if (totalLead > 12) {
      identifiedRisks.push(`Borderline delivery timeline (~${totalLead} days): requires proactive tracking and shipping notifications`);
      riskScore += 15;
      leadTimeAssessment = `Moderate lead time: ~${totalLead} days total`;
    } else {
      leadTimeAssessment = `Competitive delivery: ~${totalLead} days total (${procTime ?? 0}d prep + ${shipTime ?? 0}d transit)`;
    }
  }

  // 5. Compliance & Regulatory
  let complianceStatus = "Standard consumer product (No obvious restrictions)";
  if (input.regulatoryReviewNeeded) {
    identifiedRisks.push("Regulatory or safety certification required (FDA, FCC, CE, or cosmetics testing)");
    riskScore += 25;
    complianceStatus = "Requires formal compliance and certification review";
  }

  if (input.knownRestrictions && input.knownRestrictions.length > 0) {
    identifiedRisks.push(...input.knownRestrictions);
    riskScore += input.knownRestrictions.length * 10;
  }

  // 6. Return Complexity
  if (input.returnComplexity === "HIGH") {
    identifiedRisks.push("High return friction: complex return authorization, costly reverse logistics, or hygiene restrictions");
    riskScore += 15;
  } else if (!input.returnComplexity || input.returnComplexity === "UNKNOWN") {
    criticalGaps.push("Return and reverse-logistics process is not defined");
  }

  // 7. Overall Classification
  let overallRiskLevel: "LOW" | "MODERATE" | "HIGH" | "UNKNOWN" = "LOW";
  if (criticalGaps.length >= 3 && identifiedRisks.length === 0) {
    overallRiskLevel = "UNKNOWN";
  } else if (riskScore >= 50 || input.hasBatteryOrLiquid || (input.shippingLeadTimeDays && input.shippingLeadTimeDays > 15)) {
    overallRiskLevel = "HIGH";
  } else if (riskScore >= 20 || criticalGaps.length > 0) {
    overallRiskLevel = "MODERATE";
  } else {
    overallRiskLevel = "LOW";
  }

  return {
    overallRiskLevel,
    identifiedRisks,
    criticalGaps,
    leadTimeAssessment,
    complianceStatus,
    riskScore: Math.min(100, riskScore),
  };
}

/**
 * Extracts immediate required operational actions from fulfillment gaps.
 */
export function identifyCriticalFulfillmentGaps(assessment: FulfillmentAssessmentResult): string[] {
  return assessment.criticalGaps;
}

/**
 * Persists fulfillment assessment record.
 */
export async function saveFulfillmentAssessment(
  productId: string,
  assessment: FulfillmentAssessmentResult,
  evidence: FulfillmentEvidence,
  context: ResearchAccessContext
) {
  await assertProductWorkspaceAccess(productId, context);

  return prisma.fulfillmentAssessment.create({
    data: {
      workspaceId: context.workspaceId,
      productId,
      productWeightGrams: evidence.productWeightGrams ?? null,
      packageDimensionsCm: evidence.packageDimensionsCm || null,
      isFragile: Boolean(evidence.isFragile),
      hasBatteryOrLiquid: Boolean(evidence.hasBatteryOrLiquid),
      overallRiskLevel: assessment.overallRiskLevel,
      risksJson: JSON.stringify(assessment.identifiedRisks),
      criticalGapsJson: JSON.stringify(assessment.criticalGaps),
      assessmentVersion: "11.4.0",
    },
  });
}
