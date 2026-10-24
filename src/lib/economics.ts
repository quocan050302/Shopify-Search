import { MissingCostState, ProductEconomics, ResearchChecklist } from "@/types/adViewModel";

/**
 * Safe currency arithmetic rounding to 2 decimal places.
 */
export function roundCurrency(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export interface CalculateEconomicsInput {
  observedSellingPrice: number | null | undefined;
  estimatedSupplierCost: number | null | undefined;
  shippingCost?: number | null | undefined;
  platformFees?: number | null | undefined;
  returnAllowancePercent?: number | null | undefined;
  targetProfitPerUnit?: number | null | undefined;
  isConfirmedByUser?: boolean;
  costVerificationSource?: "USER_ESTIMATE" | "SUPPLIER_INVOICE" | "USER_VERIFIED_QUOTE" | "UNVERIFIED" | null;
  sourceStatus?: "USER_ENTERED" | "STOREFRONT_VERIFIED" | "UNVERIFIED";
}

export interface EconomicsResult extends ProductEconomics {
  contributionMargin: number | null;
  returnAllowanceAmount: number | null;
  isHypothetical: boolean;
}

/**
 * Canonical calculation of unit economics, margins, and missing cost states.
 * Shared across frontend and backend.
 *
 * Rules:
 * - NEVER invents supplier costs or assumes unknown shipping/fees equal zero without explicit tracking.
 * - Missing selling price or supplier cost results in null contribution margin and break-even CPA.
 * - Break-even ROAS = Selling Price / Contribution Margin (when margin > 0).
 * - Target CPA = max(0, Contribution Margin - Target Profit) (when target profit is defined).
 * - Tracks missing cost states and flags assumed-zero shipping/fees.
 */
export function calculateEconomics(inputs: CalculateEconomicsInput): EconomicsResult {
  const {
    observedSellingPrice,
    estimatedSupplierCost,
    shippingCost,
    platformFees,
    returnAllowancePercent,
    targetProfitPerUnit,
    isConfirmedByUser = false,
    costVerificationSource = null,
    sourceStatus = "USER_ENTERED",
  } = inputs;

  const hasPrice =
    observedSellingPrice != null &&
    !isNaN(observedSellingPrice) &&
    Number.isFinite(observedSellingPrice) &&
    observedSellingPrice >= 0;

  const hasCost =
    estimatedSupplierCost != null &&
    !isNaN(estimatedSupplierCost) &&
    Number.isFinite(estimatedSupplierCost) &&
    estimatedSupplierCost >= 0;

  const price = hasPrice ? roundCurrency(observedSellingPrice!) : null;
  const cost = hasCost ? roundCurrency(estimatedSupplierCost!) : null;

  // Determine shipping & fees presence
  const hasShippingInput =
    shippingCost != null && !isNaN(shippingCost) && Number.isFinite(shippingCost) && shippingCost >= 0;
  const hasFeesInput =
    platformFees != null && !isNaN(platformFees) && Number.isFinite(platformFees) && platformFees >= 0;

  const shipping = hasShippingInput ? roundCurrency(shippingCost!) : 0;
  const fees = hasFeesInput ? roundCurrency(platformFees!) : 0;

  const hasAssumedZeroShipping = !hasShippingInput;
  const hasAssumedZeroFees = !hasFeesInput;

  // Return allowance rate
  const returnRate =
    returnAllowancePercent != null &&
    !isNaN(returnAllowancePercent) &&
    Number.isFinite(returnAllowancePercent) &&
    returnAllowancePercent >= 0 &&
    returnAllowancePercent <= 100
      ? returnAllowancePercent
      : 5; // Default 5% return allowance

  const returnAllowanceAmount = price != null ? roundCurrency((price * returnRate) / 100) : null;

  // Determine missing cost state
  let missingCostState: MissingCostState = "COMPLETE";
  if (price == null && cost == null) {
    missingCostState = "MISSING_ECONOMICS";
  } else if (price == null) {
    missingCostState = "MISSING_SELLING_PRICE";
  } else if (cost == null) {
    missingCostState = "MISSING_SUPPLIER_COST";
  } else if (hasAssumedZeroShipping || hasAssumedZeroFees) {
    missingCostState = "MISSING_SHIPPING_AND_FEES";
  } else {
    missingCostState = "COMPLETE";
  }

  // Margin calculation: requires both selling price and supplier cost
  let contributionMargin: number | null = null;
  let breakEvenCPA: number | null = null;
  let breakEvenROAS: number | null = null;
  let computedTargetProfit: number | null = null;
  let computedTargetCPA: number | null = null;

  if (price != null && cost != null) {
    const rawMargin = price - cost - shipping - fees - (returnAllowanceAmount || 0);
    contributionMargin = roundCurrency(rawMargin);
    breakEvenCPA = contributionMargin;

    if (contributionMargin > 0) {
      breakEvenROAS = roundCurrency(price / contributionMargin);
    }

    if (targetProfitPerUnit != null && !isNaN(targetProfitPerUnit) && Number.isFinite(targetProfitPerUnit) && targetProfitPerUnit >= 0) {
      computedTargetProfit = roundCurrency(targetProfitPerUnit);
      computedTargetCPA = Math.max(0, roundCurrency(contributionMargin - computedTargetProfit));
    }
  }

  return {
    observedSellingPrice: price,
    estimatedSupplierCost: cost,
    shippingCost: hasShippingInput ? shipping : null,
    platformFees: hasFeesInput ? fees : null,
    returnAllowancePercent: returnRate,
    returnAllowanceAmount,
    contributionMargin,
    estimatedContributionMargin: contributionMargin,
    breakEvenCPA,
    breakEvenROAS,
    targetProfitPerUnit: computedTargetProfit,
    targetCPA: computedTargetCPA,
    missingCostState,
    hasAssumedZeroShipping,
    hasAssumedZeroFees,
    isConfirmedByUser: Boolean(isConfirmedByUser),
    costVerificationSource: costVerificationSource ?? (isConfirmedByUser ? "USER_VERIFIED_QUOTE" : "USER_ESTIMATE"),
    sourceStatus,
    isHypothetical: true, // Always labeled hypothetical margin until confirmed by actual store accounting
  };
}

export interface RecommendationInputs {
  contributionMargin: number | null;
  observedSellingPrice?: number | null;
  missingCostState?: MissingCostState;
  isConfirmedByUser?: boolean;
  costVerificationSource?: "USER_ESTIMATE" | "SUPPLIER_INVOICE" | "USER_VERIFIED_QUOTE" | "UNVERIFIED" | null;
  demandEvidence: "UNKNOWN" | "UNVERIFIED" | "VERIFIED" | boolean;
  demandEvidenceSource?: string | null;
  competitionLevel: "UNKNOWN" | "LOW" | "MODERATE" | "HIGH" | "SATURATED";
  creativeAppeal: "UNKNOWN" | "STRONG" | "MODERATE" | "WEAK";
  differentiationFeasibility: "UNKNOWN" | "VIABLE" | "UNCERTAIN" | "NOT_VIABLE" | boolean;
  deliveryFeasibility: "UNKNOWN" | "CONFIRMED" | "UNCERTAIN" | "HIGH_RISK" | boolean;
  returnRisk: "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH";
}

export interface RecommendationResult {
  recommendation: "READY_FOR_SMALL_TEST" | "RESEARCH_MORE" | "REJECTED";
  rationale: string;
  isSmallTestEligible: boolean;
  hardDisqualifiers: string[];
  missingEvidence: string[];
}

/**
 * Derives evidence-based recommendation following strict safety rules:
 * 1. Missing, zero, or negative contribution margin must NEVER produce READY_FOR_SMALL_TEST.
 * 2. Negative or zero margin is an automatic hard REJECTED.
 * 3. NO bypasses allowed: (isHealthyMargin || competitionLevel === "LOW") is completely removed.
 * 4. Economics assumptions must be verified or explicitly user-confirmed.
 * 5. UNKNOWN states for demand, competition, differentiation, delivery, or return risk block READY_FOR_SMALL_TEST.
 * 6. Ad headlines or body text are NEVER treated as verified market demand.
 * 7. Manual checkbox selection without an external source citation is not treated as verified evidence.
 * 8. RESEARCH_MORE is the safe default when critical evidence is missing.
 */
export function deriveRecommendation(checklist: RecommendationInputs): RecommendationResult {
  const hardDisqualifiers: string[] = [];
  const missingEvidence: string[] = [];

  // Normalize boolean inputs for backward compatibility
  const diffFeas: "UNKNOWN" | "VIABLE" | "UNCERTAIN" | "NOT_VIABLE" =
    typeof checklist.differentiationFeasibility === "boolean"
      ? checklist.differentiationFeasibility
        ? "VIABLE"
        : "NOT_VIABLE"
      : checklist.differentiationFeasibility ?? "UNKNOWN";

  const delivFeas: "UNKNOWN" | "CONFIRMED" | "UNCERTAIN" | "HIGH_RISK" =
    typeof checklist.deliveryFeasibility === "boolean"
      ? checklist.deliveryFeasibility
        ? "CONFIRMED"
        : "HIGH_RISK"
      : checklist.deliveryFeasibility ?? "UNKNOWN";

  // Validate demand evidence and citations
  let demandStatus: "UNKNOWN" | "UNVERIFIED" | "VERIFIED" = "UNKNOWN";
  if (typeof checklist.demandEvidence === "boolean") {
    demandStatus = checklist.demandEvidence ? "UNVERIFIED" : "UNVERIFIED";
  } else {
    demandStatus = checklist.demandEvidence ?? "UNKNOWN";
  }

  const sourceCitation = (checklist.demandEvidenceSource || "").trim().toLowerCase();
  const isCitingAdCopy =
    sourceCitation.includes("ad headline") ||
    sourceCitation.includes("headline") ||
    sourceCitation.includes("ad body") ||
    sourceCitation.includes("body text") ||
    sourceCitation.includes("ad copy");

  // Rule 6 & 8: Ad copy cannot be demand proof, and citation must be provided for VERIFIED status
  let verifiedDemand = false;
  if (demandStatus === "VERIFIED") {
    if (!sourceCitation || sourceCitation.length < 5) {
      missingEvidence.push("Market demand was selected as verified, but lacks a supporting source citation (search volume, order counts, customer reviews).");
    } else if (isCitingAdCopy) {
      missingEvidence.push("Ad headline or body text was cited as demand evidence. Ad copy is commercial messaging, not independent market demand proof.");
    } else {
      verifiedDemand = true;
    }
  } else if (demandStatus === "UNKNOWN") {
    missingEvidence.push("Market demand evidence is unverified (status is UNKNOWN).");
  } else {
    missingEvidence.push("Market demand evidence has not been validated against external search volume or sales observations.");
  }

  // Check economics assumptions
  const margin = checklist.contributionMargin;
  if (margin === null) {
    missingEvidence.push("Missing supplier cost or selling price: contribution margin cannot be computed.");
  } else if (margin <= 0) {
    hardDisqualifiers.push(`Unviable unit economics: estimated contribution margin is $${margin.toFixed(2)} (<= $0.00). Running ads on this product will lose money on every order.`);
  } else if (margin < 12) {
    // Margin is positive but under minimum threshold to absorb typical Meta acquisition CPA
    missingEvidence.push(`Contribution margin ($${margin.toFixed(2)}) is below the recommended $12.00 threshold required to absorb typical Meta ad acquisition costs.`);
  }

  const isConfirmedEconomics =
    checklist.isConfirmedByUser === true ||
    checklist.costVerificationSource === "USER_VERIFIED_QUOTE" ||
    checklist.costVerificationSource === "SUPPLIER_INVOICE";

  if (margin !== null && margin > 0 && !isConfirmedEconomics) {
    missingEvidence.push("Cost assumptions are unconfirmed estimates. Must verify supplier quotes and shipping rates before committing ad budget.");
  }

  if (checklist.missingCostState === "MISSING_SHIPPING_AND_FEES") {
    missingEvidence.push("Shipping costs or gateway processing fees are unconfirmed and currently assumed zero.");
  }

  // Check Competition Level
  if (checklist.competitionLevel === "UNKNOWN") {
    missingEvidence.push("Competition level has not been investigated (UNKNOWN).");
  } else if (checklist.competitionLevel === "SATURATED" && (diffFeas === "NOT_VIABLE" || diffFeas === "UNCERTAIN")) {
    hardDisqualifiers.push("Market is saturated with competitors and no viable product or creative differentiation has been confirmed.");
  }

  // Check Differentiation Feasibility
  if (diffFeas === "UNKNOWN") {
    missingEvidence.push("Differentiation feasibility has not been evaluated (UNKNOWN).");
  } else if (diffFeas === "NOT_VIABLE") {
    missingEvidence.push("Differentiation is not viable: product is an undifferentiated commodity.");
  }

  // Check Delivery Feasibility
  if (delivFeas === "UNKNOWN") {
    missingEvidence.push("Delivery feasibility has not been evaluated (UNKNOWN).");
  } else if (delivFeas === "HIGH_RISK") {
    hardDisqualifiers.push("Delivery feasibility is HIGH RISK (fragile goods, liquid/hazardous materials, excessive weight, or prohibitive international shipping).");
  } else if (delivFeas === "UNCERTAIN") {
    missingEvidence.push("Delivery packaging and transit safety remain uncertain.");
  }

  // Check Creative Appeal
  if (checklist.creativeAppeal === "UNKNOWN") {
    missingEvidence.push("Creative angle appeal has not been evaluated (UNKNOWN).");
  }

  // Check Return Risk
  if (checklist.returnRisk === "UNKNOWN") {
    missingEvidence.push("Return and defect risk has not been evaluated (UNKNOWN).");
  } else if (checklist.returnRisk === "HIGH" && checklist.creativeAppeal === "WEAK") {
    hardDisqualifiers.push("High return rate risk combined with weak creative appeal creates unacceptable loss exposure.");
  }

  // 1. HARD DISQUALIFIERS -> REJECTED
  if (hardDisqualifiers.length > 0) {
    return {
      recommendation: "REJECTED",
      rationale: hardDisqualifiers.join(" "),
      isSmallTestEligible: false,
      hardDisqualifiers,
      missingEvidence,
    };
  }

  // 2. SMALL TEST QUALIFYING GATE
  // ALL criteria must pass strictly without bypasses:
  const isHealthyMargin = margin !== null && margin >= 12;
  const isSmallTestEligible =
    isHealthyMargin &&
    isConfirmedEconomics &&
    checklist.missingCostState !== "MISSING_SHIPPING_AND_FEES" &&
    verifiedDemand &&
    diffFeas === "VIABLE" &&
    delivFeas === "CONFIRMED" &&
    checklist.competitionLevel !== "SATURATED" &&
    checklist.competitionLevel !== "UNKNOWN" &&
    checklist.creativeAppeal !== "WEAK" &&
    checklist.creativeAppeal !== "UNKNOWN" &&
    checklist.returnRisk !== "HIGH" &&
    checklist.returnRisk !== "UNKNOWN" &&
    missingEvidence.length === 0;

  if (isSmallTestEligible) {
    return {
      recommendation: "READY_FOR_SMALL_TEST",
      rationale: `All validation gates passed: verified contribution margin ($${margin!.toFixed(2)}), confirmed demand with source citation, viable differentiation, and acceptable delivery/return risk. Ready for preliminary low-budget ad test.`,
      isSmallTestEligible: true,
      hardDisqualifiers: [],
      missingEvidence: [],
    };
  }

  // 3. DEFAULT -> RESEARCH_MORE
  const itemizedIssues = missingEvidence.length > 0
    ? missingEvidence.join(" ")
    : "Further verification required before spending ad budget.";

  return {
    recommendation: "RESEARCH_MORE",
    rationale: `Further validation needed before spending ad budget: ${itemizedIssues}`,
    isSmallTestEligible: false,
    hardDisqualifiers: [],
    missingEvidence,
  };
}
