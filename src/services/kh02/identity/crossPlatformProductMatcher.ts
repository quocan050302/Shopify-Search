/**
 * SWAI KH-02 — Cross-Platform Product Matching & Identity Engine
 *
 * Implements conservative cross-platform evidence aggregation.
 *
 * NON-NEGOTIABLE RULE:
 * Never automatically merge two ResearchProduct records across different stores
 * solely because their titles or creative angles appear similar.
 * Cross-store matches are flagged as PROBABLE hypotheses and require human confirmation.
 */

import { ProductMatchConfidence } from "../types";
import { DiscoveredProductCandidate } from "./productCandidateDiscovery";
import { canonicalizeProductUrl, extractDomainFromUrl } from "@/services/products/productService";
import { extractRegistrableDomain } from "../providers/googleTransparencyResearchAdapter";

export { extractRegistrableDomain };

export interface ProductMatchHypothesis {
  matchId: string;
  sourceCandidateId: string;
  targetCandidateId?: string;
  matchedEntityTitle: string;
  matchedPlatform: string;
  confidence: ProductMatchConfidence;
  matchReasons: string[];
  requiresManualReview: boolean;
  userReviewDecision?: "CONFIRMED" | "REJECTED" | "UNCERTAIN" | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
}

/**
 * Normalizes a word for functional token comparison (lower case, strip punctuation, strip trailing plural 's').
 */
function normalizeWord(w: string): string {
  let word = w.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (word.length > 4 && word.endsWith("s")) {
    word = word.slice(0, -1);
  }
  return word;
}

/**
 * Calculates string word-overlap Jaccard similarity and token coverage.
 */
function wordSimilarity(a?: string | null, b?: string | null): { jaccard: number; coverage: number } {
  const wordsA = new Set((a || "").toLowerCase().split(/\W+/).filter((w) => w.length > 2).map(normalizeWord));
  const wordsB = new Set((b || "").toLowerCase().split(/\W+/).filter((w) => w.length > 2).map(normalizeWord));
  if (wordsA.size === 0 || wordsB.size === 0) return { jaccard: 0, coverage: 0 };

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  const jaccard = union > 0 ? intersection / union : 0;
  const coverage = intersection / Math.min(wordsA.size, wordsB.size);
  return { jaccard, coverage };
}

/**
 * Evaluates whether an external video or ad evidence matches a product candidate.
 */
export function matchCrossPlatformProductEvidence(
  candidate: DiscoveredProductCandidate,
  incomingEvidence: {
    title?: string | null;
    url?: string | null;
    domain?: string | null;
    platform: string;
  }
): ProductMatchHypothesis {
  const matchReasons: string[] = [];
  let confidence: ProductMatchConfidence = "AMBIGUOUS";

  const candidateCanonical = candidate.canonicalProductUrl ? canonicalizeProductUrl(candidate.canonicalProductUrl).canonicalUrl : null;
  const evidenceCanonical = incomingEvidence.url ? canonicalizeProductUrl(incomingEvidence.url).canonicalUrl : null;
  const evidenceDomain = incomingEvidence.domain || (incomingEvidence.url ? extractDomainFromUrl(incomingEvidence.url) : null);

  // 1. Exact canonical URL match
  if (candidateCanonical && evidenceCanonical && candidateCanonical === evidenceCanonical) {
    confidence = "EXACT";
    matchReasons.push("Exact canonical product URL match on identical storefront destination.");
    return {
      matchId: `match_${candidate.candidateId}_exact`,
      sourceCandidateId: candidate.candidateId,
      matchedEntityTitle: incomingEvidence.title || "External Evidence",
      matchedPlatform: incomingEvidence.platform,
      confidence,
      matchReasons,
      requiresManualReview: false,
    };
  }

  // 2. Same store domain (including registrable subdomain match) with strong product-specific title/model match
  const candRegDomain = candidate.storeDomain ? extractRegistrableDomain(candidate.storeDomain) : null;
  const evRegDomain = evidenceDomain ? extractRegistrableDomain(evidenceDomain) : null;

  if (candRegDomain && evRegDomain && candRegDomain === evRegDomain) {
    const candidateProductText = candidate.canonicalProductName || candidate.displayName || candidate.title || "";
    const incomingText = incomingEvidence.title || "";
    const { jaccard, coverage } = wordSimilarity(candidateProductText, incomingText);

    // Strip store/brand tokens to verify whether the ad matches the actual product vs brand-only
    const brandTokens = new Set(
      [
        ...(candidate.brand ? candidate.brand.toLowerCase().split(/\W+/) : []),
        ...candRegDomain.split(".")[0].split(/[-_]+/),
        "official", "store", "shop", "sale", "free", "shipping", "online", "best", "new",
      ]
        .filter((w) => w.length > 1)
        .map(normalizeWord)
    );
    const nonBrandCandWords = new Set(
      candidateProductText
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2)
        .map(normalizeWord)
        .filter((w) => !brandTokens.has(w))
    );
    const nonBrandEvWords = new Set(
      incomingText
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2)
        .map(normalizeWord)
        .filter((w) => !brandTokens.has(w))
    );
    let nonBrandOverlap = 0;
    for (const w of nonBrandCandWords) {
      if (nonBrandEvWords.has(w)) nonBrandOverlap++;
    }
    const hasModelMatch = Boolean(
      candidate.model &&
        incomingText.toLowerCase().includes(candidate.model.toLowerCase())
    );

    if ((jaccard > 0.5 || coverage > 0.7 || hasModelMatch) && (nonBrandOverlap >= 1 || hasModelMatch)) {
      confidence = "HIGH_CONFIDENCE";
      matchReasons.push(
        `Same verified store domain (${candRegDomain}) and product-specific creative match (${Math.round(Math.max(jaccard, coverage) * 100)}% overlap).`
      );
    } else {
      confidence = "PROBABLE";
      matchReasons.push(
        `Same verified store domain (${candRegDomain}) with brand-level or general catalog creative (no product-specific match).`
      );
    }
    return {
      matchId: `match_${candidate.candidateId}_domain`,
      sourceCandidateId: candidate.candidateId,
      matchedEntityTitle: incomingEvidence.title || "Store Catalog Item",
      matchedPlatform: incomingEvidence.platform,
      confidence,
      matchReasons,
      requiresManualReview: confidence !== "HIGH_CONFIDENCE",
    };
  }

  // 3. Different stores or unverified URL: Check functional/title similarity
  const { jaccard, coverage } = wordSimilarity(candidate.title, incomingEvidence.title || "");
  if (jaccard >= 0.3 || coverage >= 0.5) {
    confidence = "PROBABLE";
    matchReasons.push(`Shared functional product concept across different storefronts (${Math.round(Math.max(jaccard, coverage) * 100)}% keyword overlap).`);
    matchReasons.push("CROSS-STORE SAFETY: Different stores must NOT be merged into a single SKU without manual review.");
    return {
      matchId: `match_${candidate.candidateId}_cross_store`,
      sourceCandidateId: candidate.candidateId,
      matchedEntityTitle: incomingEvidence.title || "Cross-Store Competitor Listing",
      matchedPlatform: incomingEvidence.platform,
      confidence,
      matchReasons,
      requiresManualReview: true, // User must review cross-store links
    };
  }

  // 4. Low similarity
  return {
    matchId: `match_${candidate.candidateId}_ambiguous`,
    sourceCandidateId: candidate.candidateId,
    matchedEntityTitle: incomingEvidence.title || "Unknown Evidence",
    matchedPlatform: incomingEvidence.platform,
    confidence: "AMBIGUOUS",
    matchReasons: ["Insufficient keyword or destination overlap to establish product identity."],
    requiresManualReview: true,
  };
}

/**
 * In-memory operator review update (for unit testing and pure updates).
 */
export function submitProductMatchReview(
  hypothesis: ProductMatchHypothesis,
  decision: "CONFIRMED" | "REJECTED" | "UNCERTAIN",
  reviewerId: string = "system_operator"
): ProductMatchHypothesis {
  return {
    ...hypothesis,
    userReviewDecision: decision,
    reviewedAt: new Date().toISOString(),
    reviewedBy: reviewerId,
    confidence: decision === "CONFIRMED" ? "HIGH_CONFIDENCE" : (decision === "REJECTED" ? "REJECTED" : "AMBIGUOUS"),
    requiresManualReview: false,
  };
}

/**
 * Persists an operator review decision for a cross-store product match hypothesis in SQLite.
 * Strictly scoped to the authorized workspace.
 */
export async function persistProductMatchReview(
  matchOrHypothesis: string | ProductMatchHypothesis,
  decision: "CONFIRMED" | "REJECTED" | "UNCERTAIN",
  reviewerId: string = "system_operator",
  workspaceId: string = "default-workspace",
  notes?: string
): Promise<ProductMatchHypothesis> {
  const hypothesis: ProductMatchHypothesis =
    typeof matchOrHypothesis === "string"
      ? {
          matchId: matchOrHypothesis,
          sourceCandidateId: "manual_review",
          matchedEntityTitle: notes || "Operator Review Decision",
          matchedPlatform: "CROSS_PLATFORM",
          confidence: decision === "CONFIRMED" ? "HIGH_CONFIDENCE" : (decision === "REJECTED" ? "REJECTED" : "AMBIGUOUS"),
          matchReasons: [notes || `Operator marked match as ${decision}`],
          requiresManualReview: false,
        }
      : matchOrHypothesis;

  const updatedHypothesis = submitProductMatchReview(hypothesis, decision, reviewerId);

  try {
    const { prisma } = await import("@/lib/db");
    await prisma.researchEvidence.create({
      data: {
        workspaceId,
        subjectType: "PRODUCT_MATCH_REVIEW",
        subjectId: updatedHypothesis.matchId,
        pillar: "PRODUCT",
        claim: decision,
        observedValue: JSON.stringify({ ...updatedHypothesis, notes }),
        observationMethod: "USER_INPUT",
        classification: "SOURCE_REVIEWED",
        verifierActorId: reviewerId,
        verifiedAt: new Date(),
      },
    });
  } catch (err: any) {
    console.error("Failed to persist product match review to SQLite:", err.message);
  }

  return updatedHypothesis;
}

/**
 * Retrieves a stored review decision for a matchId from the authorized workspace.
 */
export async function getStoredProductMatchReview(
  matchId: string,
  workspaceId: string
): Promise<ProductMatchHypothesis | null> {
  try {
    const { prisma } = await import("@/lib/db");
    const evidence = await prisma.researchEvidence.findFirst({
      where: {
        workspaceId,
        subjectType: "PRODUCT_MATCH_REVIEW",
        subjectId: matchId,
      },
      orderBy: { observedAt: "desc" },
    });

    if (evidence?.observedValue) {
      return JSON.parse(evidence.observedValue) as ProductMatchHypothesis;
    }
  } catch {
    // Ignore read errors
  }
  return null;
}
