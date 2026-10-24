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

// =========================================================================
// KH-01 Advanced Economics, Money Arithmetic & Multi-Offer Scenarios
// =========================================================================

export interface Money {
  amount: number;
  currency: string;
  minorUnits: number;
  formatted: string;
}

/**
 * Validates and converts monetary string or number inputs into tested minor units.
 */
export function parseMoney(input: string | number | null | undefined, currency = "USD"): Money {
  if (input == null || input === "") {
    throw new Error("Money input cannot be null or empty");
  }

  const num = typeof input === "number" ? input : parseFloat(String(input).replace(/[^0-9.-]/g, ""));

  if (isNaN(num) || !Number.isFinite(num)) {
    throw new Error(`Invalid monetary amount: ${input}`);
  }

  const rounded = roundCurrency(num);
  const minorUnits = Math.round(rounded * 100);

  return {
    amount: rounded,
    currency: currency.toUpperCase(),
    minorUnits,
    formatted: new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
    }).format(rounded),
  };
}

export type FinancialSourceType =
  | "USER_ESTIMATE"
  | "SUPPLIER_QUOTE"
  | "OBSERVED_STOREFRONT"
  | "FIRST_PARTY_ACTUAL"
  | "UNKNOWN";

export interface FinancialAssumption {
  value: number | string | null;
  currency: string;
  sourceType: FinancialSourceType;
  evidenceId?: string;
  observedAt?: string;
}

export interface ProductEconomicsScenarioInput {
  scenarioName?: string;
  currency?: string;
  unitsPerOrder?: number;
  grossMerchandiseValue?: number | null | undefined;
  sellingPricePerUnit: number | null | undefined;
  discountPerUnit?: number | null | undefined;
  supplierCostPerUnit: number | null | undefined;
  shippingChargedToCustomer?: number | null | undefined;
  actualShippingCostPaid?: number | null | undefined;
  fulfillmentCostPerOrder?: number | null | undefined;
  paymentProcessingFeePercent?: number | null | undefined; // e.g. 2.9%
  paymentProcessingFeeFixed?: number | null | undefined;   // e.g. $0.30
  otherVariableCostPerOrder?: number | null | undefined;
  expectedReturnRatePercent?: number | null | undefined;   // e.g. 5%
  recoverableCostOnReturnPercent?: number | null | undefined; // 0% if scrapped, 50% if restocked
  targetProfitPerOrder?: number | null | undefined;
  assumedCpa?: number | null | undefined;
  sourceProvenance?: Record<string, FinancialAssumption>;
}

export interface ProductEconomicsScenarioResult {
  scenarioName: string;
  currency: string;
  unitsPerOrder: number;
  grossMerchandiseValue: number | null;
  discountAmount: number;
  netSellingRevenue: number | null;
  cogs: number | null;
  shippingSubsidy: number | null;
  fulfillmentCost: number | null;
  paymentProcessingFee: number | null;
  otherVariableCosts: number | null;
  expectedReturnLoss: number | null;
  contributionBeforeAds: number | null;
  contributionMarginPercent: number | null;
  breakEvenCpa: number | null;
  targetProfitPerOrder: number | null;
  targetCpa: number | null;
  breakEvenRoas: number | null;
  targetRoas: number | null;
  contributionAfterAssumedCpa: number | null;
  isComplete: boolean;
  missingCostState: MissingCostState;
  missingInputs: string[];
  riskFlags: string[];
  provenance: Record<string, FinancialAssumption>;
  isHypothetical: boolean;
}

/**
 * Calculates complete order economics with honest tracking of missing costs.
 * Never silently turns unknown shipping or supplier cost into free/zero.
 */
export function calculateOrderEconomics(input: ProductEconomicsScenarioInput): ProductEconomicsScenarioResult {
  const currency = (input.currency || "USD").toUpperCase();
  const units = Math.max(1, Math.floor(input.unitsPerOrder || 1));
  const scenarioName = input.scenarioName || "Base Order Scenario";
  const missingInputs: string[] = [];
  const riskFlags: string[] = [];

  // 1. Selling Price
  const hasPrice =
    input.sellingPricePerUnit != null &&
    !isNaN(input.sellingPricePerUnit) &&
    Number.isFinite(input.sellingPricePerUnit) &&
    input.sellingPricePerUnit >= 0;

  if (!hasPrice) {
    missingInputs.push("Selling price per unit is unknown");
  }

  const unitPrice = hasPrice ? roundCurrency(input.sellingPricePerUnit!) : null;
  const unitDiscount = input.discountPerUnit != null && Number.isFinite(input.discountPerUnit) && input.discountPerUnit >= 0
    ? roundCurrency(input.discountPerUnit)
    : 0;

  const grossMerchandiseValue =
    input.grossMerchandiseValue != null && !isNaN(input.grossMerchandiseValue) && input.grossMerchandiseValue >= 0
      ? roundCurrency(input.grossMerchandiseValue)
      : unitPrice != null
      ? roundCurrency(unitPrice * units)
      : null;
  const discountAmount = roundCurrency(unitDiscount * units);
  const netSellingRevenue = grossMerchandiseValue != null
    ? roundCurrency(Math.max(0, grossMerchandiseValue - discountAmount))
    : null;

  // 2. Supplier Cost (COGS)
  const hasCost =
    input.supplierCostPerUnit != null &&
    !isNaN(input.supplierCostPerUnit) &&
    Number.isFinite(input.supplierCostPerUnit) &&
    input.supplierCostPerUnit >= 0;

  if (!hasCost) {
    missingInputs.push("Supplier cost (COGS) is unknown");
  }

  const unitCost = hasCost ? roundCurrency(input.supplierCostPerUnit!) : null;
  const cogs = unitCost != null ? roundCurrency(unitCost * units) : null;

  // 3. Shipping & Subsidy
  const hasShippingPaid =
    input.actualShippingCostPaid != null &&
    !isNaN(input.actualShippingCostPaid) &&
    Number.isFinite(input.actualShippingCostPaid) &&
    input.actualShippingCostPaid >= 0;

  const hasShippingCharged =
    input.shippingChargedToCustomer != null &&
    !isNaN(input.shippingChargedToCustomer) &&
    Number.isFinite(input.shippingChargedToCustomer) &&
    input.shippingChargedToCustomer >= 0;

  let shippingSubsidy: number | null = null;
  if (hasShippingPaid) {
    const actualShipping = roundCurrency(input.actualShippingCostPaid!);
    const chargedShipping = hasShippingCharged ? roundCurrency(input.shippingChargedToCustomer!) : 0;
    // Subsidy = merchant expense minus customer payment
    shippingSubsidy = roundCurrency(actualShipping - chargedShipping);
  } else {
    missingInputs.push("Actual shipping cost paid by merchant is unknown");
    riskFlags.push("Shipping cost not confirmed; shipping subsidy omitted");
  }

  // 4. Fulfillment
  const hasFulfillment =
    input.fulfillmentCostPerOrder != null &&
    !isNaN(input.fulfillmentCostPerOrder) &&
    Number.isFinite(input.fulfillmentCostPerOrder) &&
    input.fulfillmentCostPerOrder >= 0;

  const fulfillmentCost = hasFulfillment ? roundCurrency(input.fulfillmentCostPerOrder!) : null;
  if (!hasFulfillment) {
    missingInputs.push("Fulfillment/handling fee is unknown");
  }

  // 5. Payment Processing Fee (e.g. Stripe 2.9% + $0.30)
  let paymentProcessingFee: number | null = null;
  const feePercent = input.paymentProcessingFeePercent ?? 2.9;
  const feeFixed = input.paymentProcessingFeeFixed ?? 0.30;

  if (netSellingRevenue != null) {
    const customerTotal = netSellingRevenue + (hasShippingCharged ? input.shippingChargedToCustomer! : 0);
    paymentProcessingFee = roundCurrency((customerTotal * (feePercent / 100)) + feeFixed);
  }

  // 6. Other Variable Costs
  const otherVariableCosts = input.otherVariableCostPerOrder != null && Number.isFinite(input.otherVariableCostPerOrder)
    ? roundCurrency(input.otherVariableCostPerOrder)
    : 0;

  // 7. Expected Return/Refund Loss
  const returnRate = input.expectedReturnRatePercent ?? 5; // default 5%
  const recoverablePercent = input.recoverableCostOnReturnPercent ?? 0; // 0% default (lost)

  let expectedReturnLoss: number | null = null;
  if (netSellingRevenue != null) {
    // Loss per order = return rate * (net revenue - recoverable unit cost)
    const orderCostBasis = cogs ?? 0;
    const lossBasis = netSellingRevenue - (orderCostBasis * (recoverablePercent / 100));
    expectedReturnLoss = roundCurrency(Math.max(0, lossBasis * (returnRate / 100)));
  }

  // 8. Missing Cost State
  let missingCostState: MissingCostState = "COMPLETE";
  if (!hasPrice && !hasCost) {
    missingCostState = "MISSING_ECONOMICS";
  } else if (!hasPrice) {
    missingCostState = "MISSING_SELLING_PRICE";
  } else if (!hasCost) {
    missingCostState = "MISSING_SUPPLIER_COST";
  } else if (!hasShippingPaid || !hasFulfillment) {
    missingCostState = "MISSING_SHIPPING_AND_FEES";
  }

  const isComplete = missingInputs.length === 0;

  // 9. Contribution Before Ads & Break-Even CPA
  let contributionBeforeAds: number | null = null;
  let contributionMarginPercent: number | null = null;
  let breakEvenCpa: number | null = null;
  let breakEvenRoas: number | null = null;
  let targetCpa: number | null = null;
  let targetRoas: number | null = null;
  let contributionAfterAssumedCpa: number | null = null;

  if (netSellingRevenue != null && cogs != null) {
    // Base required subtraction
    let margin = netSellingRevenue - cogs;

    if (shippingSubsidy != null) {
      margin -= shippingSubsidy;
    }
    if (fulfillmentCost != null) {
      margin -= fulfillmentCost;
    }
    if (paymentProcessingFee != null) {
      margin -= paymentProcessingFee;
    }
    margin -= otherVariableCosts;

    if (expectedReturnLoss != null) {
      margin -= expectedReturnLoss;
    }

    contributionBeforeAds = roundCurrency(margin);
    breakEvenCpa = contributionBeforeAds;

    if (netSellingRevenue > 0) {
      contributionMarginPercent = roundCurrency((contributionBeforeAds / netSellingRevenue) * 100);
    }

    if (contributionBeforeAds > 0) {
      breakEvenRoas = roundCurrency(netSellingRevenue / contributionBeforeAds);
    } else {
      riskFlags.push("Contribution before ads is zero or negative. Unviable unit economics.");
    }

    if (input.targetProfitPerOrder != null && Number.isFinite(input.targetProfitPerOrder)) {
      const targetProfit = roundCurrency(input.targetProfitPerOrder);
      targetCpa = Math.max(0, roundCurrency(contributionBeforeAds - targetProfit));
      if (targetCpa > 0) {
        targetRoas = roundCurrency(netSellingRevenue / targetCpa);
      }
    }

    if (input.assumedCpa != null && Number.isFinite(input.assumedCpa)) {
      contributionAfterAssumedCpa = roundCurrency(contributionBeforeAds - input.assumedCpa);
    }
  }

  return {
    scenarioName,
    currency,
    unitsPerOrder: units,
    grossMerchandiseValue,
    discountAmount,
    netSellingRevenue,
    cogs,
    shippingSubsidy,
    fulfillmentCost,
    paymentProcessingFee,
    otherVariableCosts,
    expectedReturnLoss,
    contributionBeforeAds,
    contributionMarginPercent,
    breakEvenCpa,
    targetProfitPerOrder: input.targetProfitPerOrder != null ? roundCurrency(input.targetProfitPerOrder) : null,
    targetCpa,
    breakEvenRoas,
    targetRoas,
    contributionAfterAssumedCpa,
    isComplete,
    missingCostState,
    missingInputs,
    riskFlags,
    provenance: input.sourceProvenance || {},
    isHypothetical: true,
  };
}

export interface OfferScenarioInput {
  name: string;
  type: "SINGLE" | "TWO_UNIT_BUNDLE" | "THREE_UNIT_BUNDLE" | "QUANTITY_TIER" | "FREE_SHIPPING_THRESHOLD" | "GIFT_WITH_PURCHASE" | "UPSELL";
  units: number;
  bundleSellingPrice: number;
  discountAmount?: number;
  freeShippingApplied?: boolean;
  giftItemCost?: number;
}

export interface ProductCostAssumptions {
  supplierUnitCost: number | null;
  shippingPaidPerOrder: number | null;
  shippingChargedToCustomer: number | null;
  fulfillmentFeePerOrder: number | null;
  paymentFeePercent?: number;
  paymentFeeFixed?: number;
  expectedReturnRatePercent?: number;
  targetProfitPerOrder?: number;
  sourceProvenance?: Record<string, FinancialAssumption>;
}

/**
 * Builds offer-specific unit economics scenario (bundles, thresholds, gifts).
 */
export function buildOfferEconomicsScenario(
  product: { currentPrice?: number | null; currency?: string } | null,
  offer: OfferScenarioInput,
  costs: ProductCostAssumptions
): ProductEconomicsScenarioResult {
  const units = Math.max(1, offer.units);
  const unitPrice = roundCurrency(offer.bundleSellingPrice / units);

  // Additional variable cost if gift included
  let extraVariableCost = 0;
  if (offer.giftItemCost != null && offer.giftItemCost > 0) {
    extraVariableCost += roundCurrency(offer.giftItemCost);
  }

  // Shipping charged: if free shipping applied in offer, customer pays 0
  const shippingCharged = offer.freeShippingApplied ? 0 : costs.shippingChargedToCustomer;

  return calculateOrderEconomics({
    scenarioName: offer.name,
    currency: product?.currency || "USD",
    unitsPerOrder: units,
    grossMerchandiseValue: offer.bundleSellingPrice,
    sellingPricePerUnit: unitPrice,
    discountPerUnit: offer.discountAmount ? roundCurrency(offer.discountAmount / units) : 0,
    supplierCostPerUnit: costs.supplierUnitCost,
    shippingChargedToCustomer: shippingCharged,
    actualShippingCostPaid: costs.shippingPaidPerOrder,
    fulfillmentCostPerOrder: costs.fulfillmentFeePerOrder,
    paymentProcessingFeePercent: costs.paymentFeePercent,
    paymentProcessingFeeFixed: costs.paymentFeeFixed,
    otherVariableCostPerOrder: extraVariableCost,
    expectedReturnRatePercent: costs.expectedReturnRatePercent,
    targetProfitPerOrder: costs.targetProfitPerOrder,
    sourceProvenance: costs.sourceProvenance,
  });
}

export interface EconomicsComparison {
  scenarios: ProductEconomicsScenarioResult[];
  recommendedScenario: string | null;
  summary: {
    highestContributionScenario: string | null;
    lowestBreakEvenRoasScenario: string | null;
    missingCostCount: number;
  };
}

/**
 * Compares multiple offer scenarios side-by-side to identify the strongest commercial configuration.
 */
export function compareEconomicsScenarios(scenarios: ProductEconomicsScenarioResult[]): EconomicsComparison {
  if (scenarios.length === 0) {
    return {
      scenarios: [],
      recommendedScenario: null,
      summary: { highestContributionScenario: null, lowestBreakEvenRoasScenario: null, missingCostCount: 0 },
    };
  }

  let bestContribution: ProductEconomicsScenarioResult | null = null;
  let bestRoas: ProductEconomicsScenarioResult | null = null;
  let totalMissing = 0;

  for (const s of scenarios) {
    totalMissing += s.missingInputs.length;

    if (s.contributionBeforeAds != null) {
      if (!bestContribution || s.contributionBeforeAds > (bestContribution.contributionBeforeAds ?? -Infinity)) {
        bestContribution = s;
      }
    }

    if (s.breakEvenRoas != null && s.breakEvenRoas > 0) {
      if (!bestRoas || s.breakEvenRoas < (bestRoas.breakEvenRoas ?? Infinity)) {
        bestRoas = s;
      }
    }
  }

  return {
    scenarios,
    recommendedScenario: bestContribution?.scenarioName || scenarios[0]?.scenarioName || null,
    summary: {
      highestContributionScenario: bestContribution?.scenarioName || null,
      lowestBreakEvenRoasScenario: bestRoas?.scenarioName || null,
      missingCostCount: totalMissing,
    },
  };
}

export interface EconomicsEligibility {
  isEligibleForTest: boolean;
  acquisitionCapacity: "HEALTHY" | "TIGHT" | "UNVIABLE" | "INSUFFICIENT_DATA";
  rationale: string;
  missingInputs: string[];
}

/**
 * Validates whether an economics scenario meets the rigorous threshold for real ad spend.
 */
export function evaluateEconomicsEligibility(scenario: ProductEconomicsScenarioResult): EconomicsEligibility {
  if (!scenario.isComplete) {
    return {
      isEligibleForTest: false,
      acquisitionCapacity: "INSUFFICIENT_DATA",
      rationale: `Cannot approve ad spend: ${scenario.missingInputs.join(", ")}.`,
      missingInputs: scenario.missingInputs,
    };
  }

  const margin = scenario.contributionBeforeAds;
  if (margin == null || margin <= 0) {
    return {
      isEligibleForTest: false,
      acquisitionCapacity: "UNVIABLE",
      rationale: `Negative or zero contribution margin ($${margin ?? 0.00}). Orders will lose money before advertising.`,
      missingInputs: [],
    };
  }

  // Acquisition capacity relative to target CPA
  if (margin < 12) {
    return {
      isEligibleForTest: false,
      acquisitionCapacity: "TIGHT",
      rationale: `Contribution before ads ($${margin.toFixed(2)}) is under $12.00, leaving negligible cushion for Meta CPA volatility.`,
      missingInputs: [],
    };
  }

  return {
    isEligibleForTest: true,
    acquisitionCapacity: "HEALTHY",
    rationale: `Sufficient acquisition capacity: $${margin.toFixed(2)} break-even CPA (Break-even ROAS ${scenario.breakEvenRoas ?? "N/A"}x).`,
    missingInputs: [],
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
