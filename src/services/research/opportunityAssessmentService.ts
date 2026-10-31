import { prisma } from "@/lib/db";
import { ResearchAccessContext, assertProductWorkspaceAccess } from "./researchAuthService";
import { ProductEconomicsScenarioResult } from "@/lib/economics";
import { CompetitorFunnelAssessment } from "./funnelAnalysisService";
import { FulfillmentAssessmentResult } from "./fulfillmentAssessmentService";

export interface PillarAssessment {
  pillar: "PRODUCT" | "CREATIVE" | "OFFER" | "LANDING_PAGE" | "ECONOMICS" | "FULFILLMENT";
  weight: number;
  score: number | null; // 0-100 or null if insufficient factual evidence
  readiness: number;   // 0-100 evidence completeness
  status: "PASS" | "NEEDS_WORK" | "FAIL" | "INSUFFICIENT_DATA";
  findings: string[];
  missingEvidence: string[];
  risks: string[];
}

export interface ProductResearchEvidence {
  productTitle: string;
  category?: string;
  problemSolved?: string | null;
  customerPainPointClarity?: "CLEAR" | "MODERATE" | "VAGUE" | "UNKNOWN";
  observedDifferentiation?: string | null;
  hasCustomerDemandEvidence?: boolean;
  demandEvidenceSource?: string | null;
  competitionLevel?: "LOW" | "MODERATE" | "HIGH" | "SATURATED" | "UNKNOWN";
  isSeasonalityRisk?: boolean;
  identityConfidence?: "EXACT" | "PROBABLE" | "AMBIGUOUS" | "INSUFFICIENT_EVIDENCE";
}

export interface CreativeResearchEvidence {
  adCount: number;
  hasVideoDemonstration?: boolean;
  hookQualityObserved?: "STRONG" | "MODERATE" | "WEAK" | "UNVERIFIED";
  hasBeforeAfterOrProblemHook?: boolean;
  clearCtaObserved?: boolean;
  anglesCount?: number;
  ugcFeasibility?: "EASY" | "MODERATE" | "HARD" | "UNKNOWN";
}

export interface SixPillarOpportunityInput {
  productId: string;
  productEvidence: ProductResearchEvidence;
  creativeEvidence: CreativeResearchEvidence;
  offerSnapshots: any[]; // CompetitorOfferSnapshot[]
  funnelAssessment?: CompetitorFunnelAssessment | null;
  economicsScenarios: ProductEconomicsScenarioResult[];
  fulfillmentAssessment?: FulfillmentAssessmentResult | null;
}

export interface ProductOpportunityAssessment {
  productId: string;
  methodologyVersion: string;
  opportunityScore: number | null;
  isPartialScore?: boolean;
  assessedCoveragePercent?: number;
  missingPillarWeights?: number;
  evidenceReadinessScore: number | null;
  pillars: {
    product: PillarAssessment;
    creative: PillarAssessment;
    offer: PillarAssessment;
    landingPage: PillarAssessment;
    economics: PillarAssessment;
    fulfillment: PillarAssessment;
  };
  strengths: string[];
  risks: string[];
  missingCriticalEvidence: string[];
  recommendation: "RESEARCH_MORE" | "SHORTLIST" | "TEST_CANDIDATE" | "REJECT";
  recommendationRationale: string;
  testReadinessStatus: "ELIGIBLE" | "BLOCKED_MISSING_DATA" | "USER_OVERRIDE";
}

export interface TestReadinessDecision {
  isReadyForSmallTest: boolean;
  status: "ELIGIBLE" | "BLOCKED_MISSING_DATA" | "USER_OVERRIDE";
  gateChecks: {
    name: string;
    passed: boolean;
    reason: string;
  }[];
  unmetRequirements: string[];
  actionableNextSteps: string[];
}

export interface OpportunityExplanation {
  summary: string;
  whyInteresting: string[];
  supportingEvidence: string[];
  inferredClaims: string[];
  hypotheticalAssumptions: string[];
  missingCriticalInformation: string[];
  hypothesisFalsificationConditions: string[];
  recommendedNextActions: string[];
}

// -------------------------------------------------------------
// Pillar Evaluators
// -------------------------------------------------------------

export function evaluateProductPillar(evidence: ProductResearchEvidence): PillarAssessment {
  const findings: string[] = [];
  const missingEvidence: string[] = [];
  const risks: string[] = [];
  let scorePoints = 0;
  let readinessPoints = 0;

  // Identity confidence
  if (evidence.identityConfidence === "EXACT" || evidence.identityConfidence === "PROBABLE") {
    readinessPoints += 30;
    scorePoints += 25;
    findings.push(`Product identity established with ${evidence.identityConfidence} confidence`);
  } else {
    missingEvidence.push("Ambiguous or unconfirmed product identity");
  }

  // Problem solved & pain point
  if (evidence.customerPainPointClarity === "CLEAR") {
    readinessPoints += 30;
    scorePoints += 35;
    findings.push(`Clear customer pain point identified: ${evidence.problemSolved || "Observable functional utility"}`);
  } else if (evidence.customerPainPointClarity === "MODERATE") {
    readinessPoints += 20;
    scorePoints += 20;
    findings.push("Moderate pain point clarity; problem is understandable but not urgent");
  } else {
    missingEvidence.push("Customer problem addressed is vague or unverified");
  }

  // Differentiation
  if (evidence.observedDifferentiation && evidence.observedDifferentiation.length > 5) {
    readinessPoints += 20;
    scorePoints += 25;
    findings.push(`Differentiating angle: ${evidence.observedDifferentiation}`);
  } else {
    missingEvidence.push("No observable product differentiation recorded");
  }

  // Competition & Seasonality
  if (evidence.competitionLevel === "SATURATED") {
    risks.push("Saturated market: numerous direct dropshipping competitors with identical units");
    scorePoints -= 15;
  } else if (evidence.competitionLevel === "LOW" || evidence.competitionLevel === "MODERATE") {
    scorePoints += 15;
    readinessPoints += 20;
    findings.push(`Market competition is ${evidence.competitionLevel}`);
  }

  if (evidence.isSeasonalityRisk) {
    risks.push("Seasonal demand window: product sales may decline outside active season");
  }

  const score = readinessPoints >= 40 ? Math.max(0, Math.min(100, scorePoints)) : null;
  const status = score == null ? "INSUFFICIENT_DATA" : score >= 65 ? "PASS" : score >= 40 ? "NEEDS_WORK" : "FAIL";

  return {
    pillar: "PRODUCT",
    weight: 20,
    score,
    readiness: readinessPoints,
    status,
    findings,
    missingEvidence,
    risks,
  };
}

export function evaluateCreativePillar(evidence: CreativeResearchEvidence): PillarAssessment {
  const findings: string[] = [];
  const missingEvidence: string[] = [];
  const risks: string[] = [];
  let scorePoints = 0;
  let readinessPoints = 0;

  if (evidence.adCount > 0) {
    readinessPoints += 25;
    findings.push(`${evidence.adCount} authentic competitor ad(s) cataloged`);
    if (evidence.adCount >= 3) {
      scorePoints += 20;
    } else {
      scorePoints += 10;
    }
  } else {
    missingEvidence.push("No associated Meta advertisements cataloged");
  }

  if (evidence.hasVideoDemonstration) {
    readinessPoints += 30;
    scorePoints += 30;
    findings.push("Video demonstration observed proving functional utility");
  } else {
    missingEvidence.push("No video demonstration observed in creative assets");
  }

  if (evidence.hasBeforeAfterOrProblemHook) {
    readinessPoints += 25;
    scorePoints += 25;
    findings.push("Strong visual hook: before/after transformation or problem-first callout");
  }

  if (evidence.clearCtaObserved) {
    readinessPoints += 20;
    scorePoints += 15;
    findings.push("Clear direct-response Call to Action in creative messaging");
  }

  if (evidence.ugcFeasibility === "HARD") {
    risks.push("High UGC production friction: complex setup or specialized creator required");
  }

  const score = readinessPoints >= 30 ? Math.max(0, Math.min(100, scorePoints)) : null;
  const status = score == null ? "INSUFFICIENT_DATA" : score >= 60 ? "PASS" : score >= 35 ? "NEEDS_WORK" : "FAIL";

  return {
    pillar: "CREATIVE",
    weight: 15,
    score,
    readiness: readinessPoints,
    status,
    findings,
    missingEvidence,
    risks,
  };
}

export function evaluateOfferPillar(snapshots: any[]): PillarAssessment {
  const findings: string[] = [];
  const missingEvidence: string[] = [];
  const risks: string[] = [];
  let scorePoints = 0;
  let readinessPoints = 0;

  if (!snapshots || snapshots.length === 0) {
    missingEvidence.push("No competitor offer snapshots recorded");
    return {
      pillar: "OFFER",
      weight: 15,
      score: null,
      readiness: 0,
      status: "INSUFFICIENT_DATA",
      findings: [],
      missingEvidence,
      risks: ["Competitor pricing and commercial terms unknown"],
    };
  }

  readinessPoints += 40;
  const latest = snapshots[0];
  findings.push(`Recorded offer observed: $${latest.sellingPrice ?? "N/A"} ${latest.currency || "USD"}`);

  if (latest.sellingPrice != null && latest.sellingPrice > 0) {
    readinessPoints += 20;
    scorePoints += 30;

    if (latest.compareAtPrice && latest.compareAtPrice > latest.sellingPrice) {
      scorePoints += 20;
      findings.push(`Compare-at anchor price displayed: $${latest.compareAtPrice}`);
    }
  }

  if (latest.bundleQuantity && latest.bundleQuantity > 1) {
    readinessPoints += 20;
    scorePoints += 25;
    findings.push(`Multi-unit bundle structure: ${latest.bundleQuantity} units`);
  }

  if (latest.hasFreeShipping) {
    readinessPoints += 20;
    scorePoints += 25;
    findings.push(`Free shipping policy promoted${latest.shippingThreshold ? ` (threshold: $${latest.shippingThreshold})` : ""}`);
  }

  const score = readinessPoints >= 40 ? Math.max(0, Math.min(100, scorePoints)) : null;
  const status = score == null ? "INSUFFICIENT_DATA" : score >= 60 ? "PASS" : score >= 35 ? "NEEDS_WORK" : "FAIL";

  return {
    pillar: "OFFER",
    weight: 15,
    score,
    readiness: readinessPoints,
    status,
    findings,
    missingEvidence,
    risks,
  };
}

export function evaluateLandingPagePillar(funnel?: CompetitorFunnelAssessment | null): PillarAssessment {
  const findings: string[] = [];
  const missingEvidence: string[] = [];
  const risks: string[] = [];

  if (!funnel) {
    missingEvidence.push("Landing page inspection has not been executed");
    return {
      pillar: "LANDING_PAGE",
      weight: 15,
      score: null,
      readiness: 0,
      status: "INSUFFICIENT_DATA",
      findings: [],
      missingEvidence,
      risks: ["Funnel conversion structure and trust elements unverified"],
    };
  }

  const funnelAny = funnel as any;
  if (funnelAny.statusClassification === "ACCESS_RESTRICTED" || funnelAny.httpStatus === 403 || funnelAny.httpStatus === 429) {
    risks.push(`Landing page returned access restriction (HTTP ${funnelAny.httpStatus || 403}); page was not inspectable.`);
    missingEvidence.push("Landing page content blocked by website access restrictions");
    return {
      pillar: "LANDING_PAGE",
      weight: 15,
      score: null,
      readiness: 10,
      status: "FAIL",
      findings: [],
      missingEvidence,
      risks,
    };
  }

  const croScore = funnel.croReadiness != null ? funnel.croReadiness : null;
  const readiness = funnel.confidence != null ? Math.round(funnel.confidence * 100) : 0;

  for (const str of funnel.observedStrengths || []) {
    findings.push(`${str.finding}: ${str.observedEvidence}`);
  }

  for (const w of funnel.observedWeaknesses || []) {
    risks.push(`${w.finding}: ${w.observedEvidence}`);
  }

  for (const f of funnel.potentialFriction || []) {
    risks.push(`Friction: ${f.finding}`);
  }

  if (Array.isArray(funnel.missingEvidence)) {
    missingEvidence.push(...funnel.missingEvidence);
  }
  if (croScore == null) {
    missingEvidence.push("No verified CRO score available from landing page inspection");
  }

  const status =
    croScore == null
      ? "INSUFFICIENT_DATA"
      : croScore >= 70
      ? "PASS"
      : croScore >= 45
      ? "NEEDS_WORK"
      : "FAIL";

  return {
    pillar: "LANDING_PAGE",
    weight: 15,
    score: croScore,
    readiness,
    status,
    findings,
    missingEvidence,
    risks,
  };
}

export function evaluateEconomicsPillar(scenarios: ProductEconomicsScenarioResult[]): PillarAssessment {
  const findings: string[] = [];
  const missingEvidence: string[] = [];
  const risks: string[] = [];

  if (!scenarios || scenarios.length === 0) {
    missingEvidence.push("No unit economics scenario modeled");
    return {
      pillar: "ECONOMICS",
      weight: 25,
      score: null,
      readiness: 0,
      status: "INSUFFICIENT_DATA",
      findings: [],
      missingEvidence,
      risks: ["Unit economics and break-even CPA unknown"],
    };
  }

  const primary = scenarios[0];
  let readiness = 30;
  let scorePoints = 0;

  if (primary.grossMerchandiseValue != null) readiness += 20;
  if (primary.cogs != null) readiness += 25;
  if (primary.shippingSubsidy != null) readiness += 15;
  if (primary.fulfillmentCost != null) readiness += 10;

  missingEvidence.push(...primary.missingInputs);
  risks.push(...primary.riskFlags);

  if (primary.contributionBeforeAds != null) {
    findings.push(`Contribution before ads: $${primary.contributionBeforeAds.toFixed(2)} (${primary.contributionMarginPercent ?? 0}%)`);
    findings.push(`Break-even CPA: $${primary.breakEvenCpa?.toFixed(2) ?? "N/A"}`);

    if (primary.breakEvenRoas != null) {
      findings.push(`Break-even ROAS: ${primary.breakEvenRoas}x`);
    }

    if (primary.contributionBeforeAds <= 0) {
      scorePoints = 0;
      risks.push("Zero or negative contribution margin. Order loses money before advertising.");
    } else if (primary.contributionBeforeAds >= 20) {
      scorePoints = 90;
      findings.push("Strong acquisition cushion: > $20.00 contribution before ads");
    } else if (primary.contributionBeforeAds >= 12) {
      scorePoints = 70;
      findings.push("Acceptable acquisition cushion ($12 - $20)");
    } else {
      scorePoints = 35;
      risks.push("Thin margin (< $12.00) vulnerable to ad auction volatility");
    }
  }

  const score = readiness >= 50 && primary.cogs != null ? scorePoints : null;
  const status = score == null ? "INSUFFICIENT_DATA" : score >= 65 ? "PASS" : score >= 40 ? "NEEDS_WORK" : "FAIL";

  return {
    pillar: "ECONOMICS",
    weight: 25,
    score,
    readiness: Math.min(100, readiness),
    status,
    findings,
    missingEvidence,
    risks,
  };
}

export function evaluateFulfillmentPillar(assessment?: FulfillmentAssessmentResult | null): PillarAssessment {
  const findings: string[] = [];
  const missingEvidence: string[] = [];
  const risks: string[] = [];

  if (!assessment) {
    missingEvidence.push("Fulfillment and supplier assessment not performed");
    return {
      pillar: "FULFILLMENT",
      weight: 10,
      score: null,
      readiness: 0,
      status: "INSUFFICIENT_DATA",
      findings: [],
      missingEvidence,
      risks: ["Supplier lead times, shipping weight, and fragility unverified"],
    };
  }

  const isInsufficient =
    assessment.overallRiskLevel === "UNKNOWN" ||
    (assessment.overallRiskLevel as string) === "INSUFFICIENT_DATA";

  const readiness = isInsufficient
    ? Math.max(10, Math.min(40, 100 - (assessment.criticalGaps.length * 20)))
    : Math.max(20, 100 - (assessment.criticalGaps.length * 20));

  const score = isInsufficient ? null : Math.max(0, 100 - assessment.riskScore);

  findings.push(`Lead time evaluation: ${assessment.leadTimeAssessment}`);
  findings.push(`Compliance status: ${assessment.complianceStatus}`);
  risks.push(...assessment.identifiedRisks);
  missingEvidence.push(...assessment.criticalGaps);

  const status = isInsufficient
    ? "INSUFFICIENT_DATA"
    : assessment.overallRiskLevel === "LOW"
    ? "PASS"
    : assessment.overallRiskLevel === "MODERATE"
    ? "NEEDS_WORK"
    : "FAIL";

  return {
    pillar: "FULFILLMENT",
    weight: 10,
    score: readiness >= 40 && !isInsufficient ? score : null,
    readiness,
    status,
    findings,
    missingEvidence,
    risks,
  };
}

// -------------------------------------------------------------
// Six-Pillar Opportunity Assessment Aggregator
// -------------------------------------------------------------

export function calculateOpportunityAssessment(input: SixPillarOpportunityInput): ProductOpportunityAssessment {
  const productPillar = evaluateProductPillar(input.productEvidence);
  const creativePillar = evaluateCreativePillar(input.creativeEvidence);
  const offerPillar = evaluateOfferPillar(input.offerSnapshots);
  const landingPagePillar = evaluateLandingPagePillar(input.funnelAssessment);
  const economicsPillar = evaluateEconomicsPillar(input.economicsScenarios);
  const fulfillmentPillar = evaluateFulfillmentPillar(input.fulfillmentAssessment);

  const pillars = {
    product: productPillar,
    creative: creativePillar,
    offer: offerPillar,
    landingPage: landingPagePillar,
    economics: economicsPillar,
    fulfillment: fulfillmentPillar,
  };

  // 1. Evidence Readiness Score: weighted completeness of facts
  const totalReadiness = Math.round(
    (productPillar.readiness * 0.20) +
    (creativePillar.readiness * 0.15) +
    (offerPillar.readiness * 0.15) +
    (landingPagePillar.readiness * 0.15) +
    (economicsPillar.readiness * 0.25) +
    (fulfillmentPillar.readiness * 0.10)
  );

  // 2. Opportunity Score: weighted evaluation score, only valid when sufficient factual evidence exists
  let opportunityScore: number | null = null;

  // Filter only pillars that have factual, non-null scores.
  // CRITICAL INTEGRITY: Never substitute unassessed or missing pillars with 50!
  const scoredPillars = [
    { pillar: productPillar, weight: 0.20 },
    { pillar: creativePillar, weight: 0.15 },
    { pillar: offerPillar, weight: 0.15 },
    { pillar: landingPagePillar, weight: 0.15 },
    { pillar: economicsPillar, weight: 0.25 },
    { pillar: fulfillmentPillar, weight: 0.10 },
  ].filter((p) => p.pillar.score != null);

  const totalAssessedWeight = scoredPillars.reduce((acc, p) => acc + p.weight, 0);

  // Require core factual evidence: product, offer, and economics MUST be scored, and total readiness >= 45
  const hasCoreEvidence =
    productPillar.score != null &&
    offerPillar.score != null &&
    economicsPillar.score != null &&
    totalReadiness >= 45;

  if (hasCoreEvidence && totalAssessedWeight > 0) {
    const weightedSum = scoredPillars.reduce((acc, p) => acc + (p.pillar.score! * p.weight), 0);
    opportunityScore = Math.round(weightedSum / totalAssessedWeight);
  }

  // 3. Aggregate Strengths, Risks & Missing Evidence
  const strengths: string[] = [];
  const risks: string[] = [];
  const missingCriticalEvidence: string[] = [];

  for (const p of Object.values(pillars)) {
    if (p.score != null && p.score >= 65) {
      strengths.push(...p.findings.slice(0, 2));
    }
    risks.push(...p.risks);
    missingCriticalEvidence.push(...p.missingEvidence);
  }

  // 4. Recommendation derivation (Canonical Policy)
  let recommendation: "RESEARCH_MORE" | "SHORTLIST" | "TEST_CANDIDATE" | "REJECT" = "RESEARCH_MORE";
  let recommendationRationale = "";

  // Disqualifiers
  const isNegativeEconomics =
    economicsPillar.score === 0 ||
    (input.economicsScenarios[0]?.contributionBeforeAds != null &&
      input.economicsScenarios[0].contributionBeforeAds <= 0);
  const isHighFulfillmentRisk = input.fulfillmentAssessment?.overallRiskLevel === "HIGH";

  if (isNegativeEconomics) {
    recommendation = "REJECT";
    recommendationRationale = "Negative or zero contribution margin. Order loses money before advertising.";
  } else if (isHighFulfillmentRisk && fulfillmentPillar.risks.length > 0) {
    recommendation = "REJECT";
    recommendationRationale = `Unviable fulfillment risk: ${fulfillmentPillar.risks[0]}`;
  } else if (totalReadiness < 50 || missingCriticalEvidence.length > 3) {
    recommendation = "RESEARCH_MORE";
    recommendationRationale = `Insufficient factual evidence (${totalReadiness}% readiness). Critical gaps: ${missingCriticalEvidence.slice(0, 3).join("; ")}.`;
  } else {
    // Canonical Readiness Check
    const tempAssessment = {
      productId: input.productId,
      methodologyVersion: "11.4.2",
      opportunityScore,
      isPartialScore: totalAssessedWeight < 1.0,
      assessedCoveragePercent: Math.round(totalAssessedWeight * 100),
      missingPillarWeights: Math.round((1.0 - totalAssessedWeight) * 100) / 100,
      evidenceReadinessScore: totalReadiness,
      pillars,
      strengths,
      risks,
      missingCriticalEvidence,
      recommendation: "RESEARCH_MORE" as const,
      recommendationRationale: "",
      testReadinessStatus: "BLOCKED_MISSING_DATA" as const,
    };
    const readinessCheck = evaluateSmallTestReadiness(tempAssessment);

    if (readinessCheck.isReadyForSmallTest && opportunityScore != null && opportunityScore >= 65) {
      recommendation = "TEST_CANDIDATE";
      recommendationRationale = `Strong candidate (${opportunityScore}/100) meeting all canonical decision gates with verified economics ($${input.economicsScenarios[0]?.breakEvenCpa?.toFixed(2) ?? 0} break-even CPA) and confirmed fulfillment feasibility.`;
    } else if (opportunityScore != null && opportunityScore >= 50) {
      recommendation = "SHORTLIST";
      recommendationRationale = `Promising angle (${opportunityScore}/100) with acceptable foundation. Unmet gates: ${readinessCheck.unmetRequirements.slice(0, 2).join("; ")}. Further offer refinement and supplier negotiation recommended.`;
    } else {
      recommendation = "RESEARCH_MORE";
      recommendationRationale = `Underperforming research score or low margin cushion. Unmet gates: ${readinessCheck.unmetRequirements.slice(0, 2).join("; ") || "Deeper research required"}.`;
    }
  }

  const testReadinessStatus = recommendation === "TEST_CANDIDATE" ? "ELIGIBLE" : "BLOCKED_MISSING_DATA";

  return {
    productId: input.productId,
    methodologyVersion: "11.4.2",
    opportunityScore,
    isPartialScore: totalAssessedWeight < 1.0,
    assessedCoveragePercent: Math.round(totalAssessedWeight * 100),
    missingPillarWeights: Math.round((1.0 - totalAssessedWeight) * 100) / 100,
    evidenceReadinessScore: totalReadiness,
    pillars,
    strengths: Array.from(new Set(strengths)),
    risks: Array.from(new Set(risks)),
    missingCriticalEvidence: Array.from(new Set(missingCriticalEvidence)),
    recommendation,
    recommendationRationale,
    testReadinessStatus,
  };
}

/**
 * Validates critical decision gates that must pass before any real ad spend is authorized.
 */
export function evaluateSmallTestReadiness(
  assessment: ProductOpportunityAssessment,
  options?: { allowUserOverride?: boolean; overrideReason?: string }
): TestReadinessDecision {
  const gateChecks = [
    {
      name: "Product Identity & Problem Clarity",
      passed: assessment.pillars.product.status === "PASS",
      reason: assessment.pillars.product.findings.join("; ") || "Product identity or utility is ambiguous",
    },
    {
      name: "Competing Offer Understanding",
      passed: assessment.pillars.offer.status === "PASS" || assessment.pillars.offer.status === "NEEDS_WORK",
      reason: assessment.pillars.offer.findings.join("; ") || "Competitor commercial terms unverified",
    },
    {
      name: "Verified Unit Economics",
      passed: assessment.pillars.economics.status === "PASS",
      reason: assessment.pillars.economics.findings.join("; ") || "Missing supplier cost or negative margin",
    },
    {
      name: "Operational & Logistics Feasibility",
      passed: assessment.pillars.fulfillment.status === "PASS" || assessment.pillars.fulfillment.status === "NEEDS_WORK",
      reason: assessment.pillars.fulfillment.findings.join("; ") || "Critical fulfillment blocker or unperformed assessment",
    },
    {
      name: "Evidence Readiness Threshold (>= 70%)",
      passed: (assessment.evidenceReadinessScore ?? 0) >= 70,
      reason: `Current readiness is ${assessment.evidenceReadinessScore ?? 0}% (Required: 70%)`,
    },
  ];

  const unmetRequirements = gateChecks.filter((g) => !g.passed).map((g) => `${g.name}: ${g.reason}`);
  const isAlgoReady = unmetRequirements.length === 0;

  const actionableNextSteps: string[] = [];
  if (!gateChecks[2].passed) actionableNextSteps.push("Obtain authentic supplier invoice or platform quote to lock COGS");
  if (!gateChecks[3].passed) actionableNextSteps.push("Verify package weight, shipping transit times, and compliance risks");
  if (!gateChecks[1].passed) actionableNextSteps.push("Inspect competitor landing page offer and bundle terms");
  if (!gateChecks[0].passed) actionableNextSteps.push("Verify product identity and validate clear customer problem statement");
  if (actionableNextSteps.length === 0 && isAlgoReady) {
    actionableNextSteps.push("Build high-converting Shopify product page mirroring validated offer terms");
    actionableNextSteps.push("Determine disciplined test budget based on target CPA and initial hypothesis validation goals");
  }

  const isUserOverride = Boolean(options?.allowUserOverride && !isAlgoReady);
  const status: "ELIGIBLE" | "BLOCKED_MISSING_DATA" | "USER_OVERRIDE" =
    isAlgoReady ? "ELIGIBLE" : isUserOverride ? "USER_OVERRIDE" : "BLOCKED_MISSING_DATA";

  return {
    isReadyForSmallTest: isAlgoReady || isUserOverride,
    status,
    gateChecks,
    unmetRequirements,
    actionableNextSteps,
  };
}

/**
 * Produces an audit-grade narrative explaining the analytical recommendation.
 */
export function explainOpportunityRecommendation(assessment: ProductOpportunityAssessment): OpportunityExplanation {
  const isTest = assessment.recommendation === "TEST_CANDIDATE";
  const isReject = assessment.recommendation === "REJECT";

  const summary = isTest
    ? `Product qualifies for a small-budget ad test based on verified economics ($${assessment.pillars.economics.findings[0] ?? ""}) and proven customer pain point.`
    : isReject
    ? `Product is rejected due to fundamental commercial disqualifiers (${assessment.recommendationRationale}).`
    : `Product requires additional research before capital commitment. Current readiness: ${assessment.evidenceReadinessScore}%.`;

  return {
    summary,
    whyInteresting: assessment.strengths,
    supportingEvidence: [
      ...assessment.pillars.product.findings,
      ...assessment.pillars.economics.findings,
    ],
    inferredClaims: [
      "Competitor conversion rate and sales volume are NOT directly measured and remain unverified",
      "Observed creative angles represent published ads, not validated profitability",
    ],
    hypotheticalAssumptions: [
      "Calculated break-even CPA assumes 100% first-pass order fulfillment without unmodeled merchant chargebacks",
      "ROAS target assumes modeled bundle take-rates",
    ],
    missingCriticalInformation: assessment.missingCriticalEvidence,
    hypothesisFalsificationConditions: [
      "User-configurable hypothesis: If supplier unit cost exceeds target COGS, modeled break-even margin shrinks accordingly",
      "User-configurable hypothesis: If creative demonstration fails to generate qualifying engagement, messaging angle requires review",
      "If competitor landing page uses hidden subscription or shipping terms not observable in public DOM",
    ],
    recommendedNextActions: [
      ...assessment.missingCriticalEvidence.map((m) => `Verify: ${m}`),
    ],
  };
}

/**
 * Persists the Product Opportunity Assessment to the database.
 */
export async function saveProductOpportunityAssessment(
  productId: string,
  assessment: ProductOpportunityAssessment,
  context: ResearchAccessContext
) {
  await assertProductWorkspaceAccess(productId, context);

  return prisma.productOpportunityAssessment.create({
    data: {
      workspaceId: context.workspaceId,
      productId,
      methodologyVersion: assessment.methodologyVersion,
      opportunityScore: assessment.opportunityScore,
      evidenceReadinessScore: assessment.evidenceReadinessScore,
      pillarsJson: JSON.stringify(assessment.pillars),
      strengthsJson: JSON.stringify(assessment.strengths),
      risksJson: JSON.stringify(assessment.risks),
      missingCriticalEvidenceJson: JSON.stringify(assessment.missingCriticalEvidence),
      recommendation: assessment.recommendation,
      recommendationRationale: assessment.recommendationRationale,
      testReadinessStatus: assessment.testReadinessStatus,
    },
  });
}

/**
 * Assembles factual SixPillarOpportunityInput strictly from persisted database records.
 * NEVER fabricates confidence, pain points, video demonstration, or default CRO scores.
 */
export async function buildProductOpportunityInput(
  productId: string,
  context: ResearchAccessContext
): Promise<SixPillarOpportunityInput> {
  await assertProductWorkspaceAccess(productId, context);

  // 1. Load product and linked ads
  const product = await prisma.researchProduct.findUnique({
    where: { id: productId },
    include: {
      adLinks: { include: { ad: { include: { mediaAssets: true } } } },
    },
  });

  if (!product) {
    throw new Error(`Product '${productId}' not found.`);
  }

  // 2. Load persisted research evidence to establish proven facts
  const evidenceRecords = await prisma.researchEvidence.findMany({
    where: { productId },
  });

  // Identity confidence: Only EXACT if verified evidence exists, else PROBABLE if ad links exist, else INSUFFICIENT_EVIDENCE
  const hasVerifiedIdentity = evidenceRecords.some(
    (e) => e.pillar === "PRODUCT" && e.classification === "VERIFIED"
  );
  const identityConfidence: "EXACT" | "PROBABLE" | "AMBIGUOUS" | "INSUFFICIENT_EVIDENCE" =
    hasVerifiedIdentity
      ? "EXACT"
      : product.adLinks.length > 0
      ? "PROBABLE"
      : "INSUFFICIENT_EVIDENCE";

  // Problem solved & pain point: Truthfully derived, never defaulting to "Identified consumer utility"
  const problemSolved =
    product.description && product.description.trim().length > 0
      ? product.description.trim()
      : null;

  const customerPainPointClarity: "CLEAR" | "MODERATE" | "VAGUE" | "UNKNOWN" =
    problemSolved && problemSolved.length > 20
      ? "MODERATE"
      : problemSolved
      ? "VAGUE"
      : "UNKNOWN";

  // Creative evidence: Do NOT infer video demonstration from 9:16 or positive duration!
  const hasDemonstrationEvidence = evidenceRecords.some(
    (e) =>
      e.pillar === "CREATIVE" &&
      (e.classification === "SOURCE_OBSERVED" || e.classification === "VERIFIED") &&
      e.claim.toLowerCase().includes("demonstration")
  );

  const hasCtaEvidence = evidenceRecords.some(
    (e) =>
      e.pillar === "CREATIVE" &&
      (e.classification === "SOURCE_OBSERVED" || e.classification === "VERIFIED") &&
      (e.claim.toLowerCase().includes("call-to-action") || e.claim.toLowerCase().includes("cta"))
  );
  const hasAdCta = product.adLinks.some((l) =>
    Boolean(
      l.ad.callToAction ||
        (l.ad.headline && /(shop|get|buy|claim|order)/i.test(l.ad.headline))
    )
  );

  // 3. Load latest offer snapshots
  const offerSnapshots = await prisma.competitorOfferSnapshot.findMany({
    where: { productId },
    orderBy: { observedAt: "desc" },
    take: 10,
  });

  // 4. Load latest landing page & funnel
  const landingPage = await prisma.landingPageSnapshot.findFirst({
    where: { productId },
    orderBy: { observedAt: "desc" },
  });

  let funnelAssessment: CompetitorFunnelAssessment | null = null;
  if (landingPage) {
    if (
      landingPage.accessStatus === "ACCESS_RESTRICTED" ||
      landingPage.accessStatus === "RATE_LIMITED"
    ) {
      // Restricted source: No verified CRO signals can be inferred!
      funnelAssessment = null;
    } else if (landingPage.croSignalsJson) {
      try {
        const cro = JSON.parse(landingPage.croSignalsJson);
        const croScore =
          typeof cro.croReadinessScore === "number" ? cro.croReadinessScore : null;
        const observationsCount =
          (cro.aboveTheFold?.strengths?.length ?? 0) +
          (cro.aboveTheFold?.weaknesses?.length ?? 0);
        const dynamicConfidence = Math.min(1.0, Math.max(0.1, observationsCount * 0.15));

        funnelAssessment = {
          observedStrengths: cro.aboveTheFold?.strengths || [],
          observedWeaknesses: cro.aboveTheFold?.weaknesses || [],
          potentialFriction: cro.potentialFriction || [],
          missingEvidence: landingPage.warningsJson
            ? JSON.parse(landingPage.warningsJson)
            : [],
          confidence: dynamicConfidence,
          croReadiness: croScore, // Explicit null when missing; no fallback 65!
          structure: {
            pageUrl: landingPage.finalUrl || landingPage.originalUrl,
            hasProductHero: typeof cro.structure?.hasProductHero === "boolean"
              ? cro.structure.hasProductHero
              : Boolean(cro.aboveTheFold?.heroHeadline || cro.structure?.heroHeadline),
            heroHeadline: cro.structure?.heroHeadline || cro.aboveTheFold?.heroHeadline || null,
            productImagesCount: typeof cro.structure?.productImagesCount === "number" ? cro.structure.productImagesCount : 0,
            hasVisiblePriceNearCta: Boolean(cro.structure?.hasVisiblePriceNearCta),
            primaryCtaText: cro.structure?.primaryCtaText || null,
            hasBenefitList: Boolean(cro.structure?.hasBenefitList),
            hasDemonstrationOrVideo: Boolean(cro.structure?.hasDemonstrationOrVideo),
            hasCustomerReviews: Boolean(cro.structure?.hasCustomerReviews),
            observedReviewCountText: cro.structure?.observedReviewCountText || null,
            observedRatingScoreText: cro.structure?.observedRatingScoreText || null,
            hasFaqSection: Boolean(cro.structure?.hasFaqSection),
            hasShippingPolicySummary: Boolean(cro.structure?.hasShippingPolicySummary),
            hasReturnPolicySummary: Boolean(cro.structure?.hasReturnPolicySummary),
            hasTrustBadges: Boolean(cro.structure?.hasTrustBadges),
            hasPaymentIcons: Boolean(cro.structure?.hasPaymentIcons),
            missingObservableComponents: cro.structure?.missingObservableComponents || [],
          },
          trustSignals: {
            score: 0,
            observedSignals: [],
            missingSignals: [],
            disclaimer: "RESEARCH_ONLY heuristic trust score.",
          },
          messageMatch: {
            overallMatchScore: 0,
            matchedClaims: [],
            conflictingClaims: [],
            missingOnLandingPage: [],
            unverifiedClaims: [],
          },
          analysisVersion: "11.4.1",
          disclaimer: "RESEARCH_ONLY assessment based on public page inspection.",
        };
      } catch {
        funnelAssessment = null;
      }
    }
  }

  // 5. Load economics scenarios
  const savedEconomics = await prisma.productEconomicsScenario.findMany({
    where: { productId },
    orderBy: { createdAt: "desc" },
  });

  const economicsScenarios: ProductEconomicsScenarioResult[] = [];
  for (const e of savedEconomics) {
    try {
      if (e.outputsJson) economicsScenarios.push(JSON.parse(e.outputsJson));
    } catch {}
  }

  // 6. Load fulfillment assessment
  const fulfillmentRecord = await prisma.fulfillmentAssessment.findFirst({
    where: { productId },
    orderBy: { createdAt: "desc" },
  });

  let fulfillmentAssessment: FulfillmentAssessmentResult | null = null;
  if (fulfillmentRecord) {
    try {
      const riskLevel = fulfillmentRecord.overallRiskLevel;
      const isInsufficient =
        riskLevel === "UNKNOWN" || (riskLevel as string) === "INSUFFICIENT_DATA";
      const riskScore =
        riskLevel === "HIGH"
          ? 75
          : riskLevel === "MODERATE"
          ? 50
          : riskLevel === "LOW"
          ? 20
          : 50;

      fulfillmentAssessment = {
        overallRiskLevel: riskLevel as any,
        identifiedRisks: fulfillmentRecord.risksJson
          ? JSON.parse(fulfillmentRecord.risksJson)
          : [],
        criticalGaps: fulfillmentRecord.criticalGapsJson
          ? JSON.parse(fulfillmentRecord.criticalGapsJson)
          : [],
        leadTimeAssessment: isInsufficient
          ? "Unverified lead times"
          : "Lead times evaluated",
        complianceStatus: isInsufficient
          ? "Unverified compliance"
          : "Compliance reviewed",
        riskScore,
      };
    } catch {
      fulfillmentAssessment = null;
    }
  }

  return {
    productId,
    productEvidence: {
      productTitle: product.title,
      category: product.category,
      problemSolved,
      customerPainPointClarity,
      identityConfidence,
    },
    creativeEvidence: {
      adCount: product.adLinks.length,
      hasVideoDemonstration: hasDemonstrationEvidence,
      clearCtaObserved: hasCtaEvidence || hasAdCta,
    },
    offerSnapshots,
    funnelAssessment,
    economicsScenarios,
    fulfillmentAssessment,
  };
}
