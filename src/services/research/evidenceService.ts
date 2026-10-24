/**
 * SWAI Research Evidence & Provenance Service
 *
 * KH-01.A — Security, Data Integrity & Evidence Foundation
 *
 * Rules:
 * - Every important research conclusion must have explicit provenance.
 * - Evidence classifications: SOURCE_OBSERVED, USER_ENTERED, USER_ESTIMATED, MODEL_INFERRED,
 *   SOURCE_SUBMITTED, SOURCE_REVIEWED, VERIFIED, UNKNOWN.
 * - VERIFIED requires an explicit verification procedure and verifier, never just a raw sentence.
 * - Separate Evidence Readiness from Opportunity/Profitability Scores.
 */

import { prisma } from "@/lib/db";
import { ResearchAccessContext, assertProductWorkspaceAccess } from "./researchAuthService";

export type EvidenceClassification =
  | "SOURCE_OBSERVED"
  | "USER_ENTERED"
  | "USER_ESTIMATED"
  | "MODEL_INFERRED"
  | "SOURCE_SUBMITTED"
  | "SOURCE_REVIEWED"
  | "VERIFIED"
  | "UNKNOWN";

export type ResearchPillar =
  | "PRODUCT"
  | "CREATIVE"
  | "OFFER"
  | "LANDING_PAGE"
  | "ECONOMICS"
  | "FULFILLMENT";

export type EvidenceSubjectType = "PRODUCT" | "AD" | "STORE" | "OFFER" | "FUNNEL";

export interface CreateResearchEvidenceInput {
  productId?: string;
  subjectType: EvidenceSubjectType;
  subjectId: string;
  pillar: ResearchPillar;
  claim: string;
  observedValue?: string | null;
  sourceUrl?: string | null;
  observationMethod: string;
  classification: EvidenceClassification;
  sourceContentRef?: string | null;
  verifiedAt?: Date | null;
  verifierActorId?: string | null;
}

export interface ResearchEvidenceRecord {
  id: string;
  workspaceId: string | null;
  subjectType: string;
  subjectId: string;
  pillar: string;
  claim: string;
  observedValue: string | null;
  sourceUrl: string | null;
  observationMethod: string;
  classification: EvidenceClassification;
  sourceContentRef: string | null;
  observedAt: string;
  verifiedAt: string | null;
  verifierActorId: string | null;
  createdAt: string;
  productId: string | null;
}

export interface EvidenceReadinessResult {
  evidenceCompletenessScore: number; // 0 - 100
  evidenceSourceQualityScore: number; // 0 - 100
  freshnessScore: number; // 0 - 100
  contradictoryEvidence: {
    claimA: string;
    valueA: string | null;
    claimB: string;
    valueB: string | null;
    reason: string;
  }[];
  missingCriticalEvidence: string[];
  reviewRequirements: string[];
  isAdequateForTestConsideration: boolean;
  provenanceSummary: Record<EvidenceClassification, number>;
  disclaimer: string;
}

/**
export interface VerificationResult {
  isVerified: boolean;
  verifierActorId?: string;
  notes?: string;
}

/**
 * Persists an evidence record with strict classification safeguards.
 */
export async function createResearchEvidence(
  input: CreateResearchEvidenceInput,
  context: ResearchAccessContext
): Promise<ResearchEvidenceRecord> {
  // If associated with a product, enforce workspace access
  if (input.productId) {
    await assertProductWorkspaceAccess(input.productId, context);
  }

  // Safety gate: 'VERIFIED' status CANNOT be directly claimed via initial user input.
  // It requires explicit invocation of verifyResearchEvidence by an authorized principal.
  let sanitizedClassification = input.classification;
  if (sanitizedClassification === "VERIFIED") {
    sanitizedClassification =
      input.observationMethod === "USER_INPUT" ? "USER_ENTERED" : "SOURCE_OBSERVED";
  }

  const record = await prisma.researchEvidence.create({
    data: {
      workspaceId: context.workspaceId,
      productId: input.productId ?? null,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      pillar: input.pillar,
      claim: input.claim.trim(),
      observedValue: input.observedValue?.trim() ?? null,
      sourceUrl: input.sourceUrl?.trim() ?? null,
      observationMethod: input.observationMethod,
      classification: sanitizedClassification,
      sourceContentRef: input.sourceContentRef ?? null,
      observedAt: new Date(),
      verifiedAt: null,
      verifierActorId: null,
    },
  });

  return {
    ...record,
    classification: record.classification as EvidenceClassification,
    observedAt: record.observedAt.toISOString(),
    verifiedAt: record.verifiedAt ? record.verifiedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
  };
}

/**
 * Performs explicit verification on an existing evidence record.
 */
export async function verifyResearchEvidence(
  evidenceId: string,
  verification: VerificationResult,
  context: ResearchAccessContext
): Promise<ResearchEvidenceRecord> {
  const existing = await prisma.researchEvidence.findUnique({
    where: { id: evidenceId },
  });

  if (!existing) {
    throw new Error(`Evidence '${evidenceId}' not found.`);
  }

  if (existing.productId) {
    await assertProductWorkspaceAccess(existing.productId, context);
  }

  const updated = await prisma.researchEvidence.update({
    where: { id: evidenceId },
    data: {
      classification: verification.isVerified ? "VERIFIED" : "SOURCE_REVIEWED",
      verifiedAt: verification.isVerified ? new Date() : null,
      verifierActorId: verification.isVerified
        ? context.actorId || verification.verifierActorId || "authorized_verifier"
        : null,
    },
  });

  return {
    ...updated,
    classification: updated.classification as EvidenceClassification,
    observedAt: updated.observedAt.toISOString(),
    verifiedAt: updated.verifiedAt ? updated.verifiedAt.toISOString() : null,
    createdAt: updated.createdAt.toISOString(),
  };
}

/**
 * Evaluates the factual readiness of a body of research evidence.
 *
 * Checks:
 * - Coverage across the six required pillars
 * - Quality of sources (verifiable observation vs rough assumption)
 * - Freshness within 30 days
 * - Contradictions between claimed terms and observed storefront data
 * - Critical missing requirements before considering any product for testing
 */
export function evaluateEvidenceReadiness(
  evidence: ResearchEvidenceRecord[]
): EvidenceReadinessResult {
  const counts: Record<EvidenceClassification, number> = {
    SOURCE_OBSERVED: 0,
    USER_ENTERED: 0,
    USER_ESTIMATED: 0,
    MODEL_INFERRED: 0,
    SOURCE_SUBMITTED: 0,
    SOURCE_REVIEWED: 0,
    VERIFIED: 0,
    UNKNOWN: 0,
  };

  const pillarCoverage = new Set<string>();
  const missingCritical: string[] = [];
  const reviewRequirements: string[] = [];
  const contradictions: EvidenceReadinessResult["contradictoryEvidence"] = [];

  let totalFreshnessDays = 0;
  const now = Date.now();

  for (const item of evidence) {
    counts[item.classification] = (counts[item.classification] || 0) + 1;
    pillarCoverage.add(item.pillar);

    const obsAgeDays = Math.max(
      0,
      Math.floor((now - new Date(item.observedAt).getTime()) / (1000 * 60 * 60 * 24))
    );
    totalFreshnessDays += obsAgeDays;
  }

  // 1. Pillar Completeness Score (up to 100)
  const requiredPillars: ResearchPillar[] = [
    "PRODUCT",
    "CREATIVE",
    "OFFER",
    "LANDING_PAGE",
    "ECONOMICS",
    "FULFILLMENT",
  ];
  let coveredCount = 0;
  for (const p of requiredPillars) {
    if (pillarCoverage.has(p)) {
      coveredCount++;
    } else {
      missingCritical.push(`Missing evidence for pillar: ${p}`);
    }
  }
  const evidenceCompletenessScore = Math.round((coveredCount / requiredPillars.length) * 100);

  // 2. Source Quality Score
  // VERIFIED: weight 1.0, SOURCE_OBSERVED: 0.9, SOURCE_REVIEWED: 0.8,
  // USER_ENTERED: 0.6, USER_ESTIMATED: 0.4, MODEL_INFERRED: 0.5, UNKNOWN: 0.1
  const totalItems = evidence.length;
  let evidenceSourceQualityScore = 0;
  if (totalItems > 0) {
    const weightedSum =
      counts.VERIFIED * 1.0 +
      counts.SOURCE_OBSERVED * 0.9 +
      counts.SOURCE_REVIEWED * 0.8 +
      counts.SOURCE_SUBMITTED * 0.7 +
      counts.USER_ENTERED * 0.6 +
      counts.MODEL_INFERRED * 0.5 +
      counts.USER_ESTIMATED * 0.4 +
      counts.UNKNOWN * 0.1;
    evidenceSourceQualityScore = Math.min(100, Math.round((weightedSum / totalItems) * 100));
  }

  // 3. Freshness Score
  let freshnessScore = 100;
  if (totalItems > 0) {
    const avgAge = totalFreshnessDays / totalItems;
    if (avgAge > 60) freshnessScore = 30;
    else if (avgAge > 30) freshnessScore = 60;
    else if (avgAge > 14) freshnessScore = 85;
    else freshnessScore = 100;
  } else {
    freshnessScore = 0;
  }

  // 4. Critical Gate Checks
  const hasObservedOffer = evidence.some(
    (e) => e.pillar === "OFFER" && ["SOURCE_OBSERVED", "VERIFIED"].includes(e.classification)
  );
  if (!hasObservedOffer) {
    missingCritical.push("No verified or observed competitor selling price/offer.");
    reviewRequirements.push("Inspect landing page to observe real selling price and commercial terms.");
  }

  const hasCostEvidence = evidence.some(
    (e) =>
      e.pillar === "ECONOMICS" &&
      ["SOURCE_OBSERVED", "VERIFIED", "USER_ENTERED", "SOURCE_SUBMITTED"].includes(
        e.classification
      )
  );
  if (!hasCostEvidence) {
    missingCritical.push("Missing supplier quote or baseline product cost assumption.");
    reviewRequirements.push("Record at least one verified quote or explicit supplier cost estimate.");
  }

  const hasFulfillmentReview = evidence.some((e) => e.pillar === "FULFILLMENT");
  if (!hasFulfillmentReview) {
    missingCritical.push("Missing shipping and delivery timeline review.");
    reviewRequirements.push("Review product weight, destination shipping costs, and return exposure.");
  }

  // 5. Detect potential contradictions
  const priceClaims = evidence.filter(
    (e) => e.claim.toLowerCase().includes("price") && e.observedValue
  );
  if (priceClaims.length >= 2) {
    const first = priceClaims[0];
    const second = priceClaims[1];
    if (first.observedValue !== second.observedValue) {
      contradictions.push({
        claimA: `${first.claim} (${first.classification})`,
        valueA: first.observedValue,
        claimB: `${second.claim} (${second.classification})`,
        valueB: second.observedValue,
        reason: "Different prices recorded across multiple observation sources.",
      });
    }
  }

  const isAdequateForTestConsideration =
    evidenceCompletenessScore >= 80 &&
    hasObservedOffer &&
    hasCostEvidence &&
    hasFulfillmentReview &&
    contradictions.length === 0;

  return {
    evidenceCompletenessScore,
    evidenceSourceQualityScore,
    freshnessScore,
    contradictoryEvidence: contradictions,
    missingCriticalEvidence: missingCritical,
    reviewRequirements,
    isAdequateForTestConsideration,
    provenanceSummary: counts,
    disclaimer:
      "Evidence readiness assesses factual completeness and data provenance. It does not measure product profitability or forecast sales.",
  };
}
