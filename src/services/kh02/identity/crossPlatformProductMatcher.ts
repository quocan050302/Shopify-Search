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

export type GoogleAssociationClassification =
  | "EXACT_PRODUCT_MATCH"
  | "PROBABLE_PRODUCT_MATCH"
  | "BRAND_ONLY_MATCH"
  | "REJECTED_UNRELATED_CREATIVE";

export interface ProductMatchHypothesis {
  matchId: string;
  sourceCandidateId: string;
  targetCandidateId?: string;
  matchedEntityTitle: string;
  matchedPlatform: string;
  confidence: ProductMatchConfidence;
  associationClassification?: GoogleAssociationClassification;
  isProductSpecificEvidence?: boolean;
  matchReasons: string[];
  requiresManualReview: boolean;
  userReviewDecision?: "CONFIRMED" | "REJECTED" | "UNCERTAIN" | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
}

export function extractProductHandleFromUrl(url?: string | null): string | null {
  if (!url) return null;
  const m = String(url).match(/\/products\/([a-z0-9-_]+)/i);
  return m && m[1] ? m[1].toLowerCase() : null;
}

export interface VerifiedGoogleMerchantDestinationResult {
  urlStructureValid?: boolean;
  isVerifiedPdp: boolean;
  destinationVerificationStatus:
    | "PDP_URL_STRUCTURE_VALID"
    | "CONFIRMED_MERCHANT_PDP"
    | "MISSING_DESTINATION"
    | "TRANSPARENCY_ONLY"
    | "GENERIC_GOOGLE_URL"
    | "REDIRECTOR_OR_SHORTENER"
    | "INVALID_URL_SCHEME"
    | "STORE_DOMAIN_MISMATCH"
    | "NON_PDP_PAGE"
    | "PRODUCT_HANDLE_CONFLICT";
  finalDestination: string | null;
  normalizedProductUrl: string | null;
  extractedHandle: string | null;
  reason: string;
}

export function classifyVerifiedGoogleMerchantDestination(
  rawUrl: string | null | undefined,
  candidate: {
    storeDomain?: string | null;
    canonicalProductUrl?: string | null;
    candidateId?: string;
  }
): VerifiedGoogleMerchantDestinationResult {
  if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.trim()) {
    return {
      urlStructureValid: false,
      isVerifiedPdp: false,
      destinationVerificationStatus: "MISSING_DESTINATION",
      finalDestination: null,
      normalizedProductUrl: null,
      extractedHandle: null,
      reason: "No destination URL provided.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return {
      urlStructureValid: false,
      isVerifiedPdp: false,
      destinationVerificationStatus: "INVALID_URL_SCHEME",
      finalDestination: null,
      normalizedProductUrl: null,
      extractedHandle: null,
      reason: `Malformed destination URL '${rawUrl}'.`,
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      urlStructureValid: false,
      isVerifiedPdp: false,
      destinationVerificationStatus: "INVALID_URL_SCHEME",
      finalDestination: null,
      normalizedProductUrl: null,
      extractedHandle: null,
      reason: `Destination URL must use HTTPS protocol; received '${parsed.protocol}'.`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Check for Google Ads Transparency URLs and variants
  if (
    hostname === "adstransparency.google.com" ||
    hostname.endsWith(".adstransparency.google.com") ||
    parsed.pathname.includes("/advertiser/")
  ) {
    return {
      urlStructureValid: false,
      isVerifiedPdp: false,
      destinationVerificationStatus: "TRANSPARENCY_ONLY",
      finalDestination: null,
      normalizedProductUrl: null,
      extractedHandle: null,
      reason: "URL points to Google Ads Transparency listing, not merchant product page.",
    };
  }

  // Check for generic Google domains and tracking/redirect services
  if (
    hostname === "google.com" ||
    hostname.endsWith(".google.com") ||
    hostname.includes("googleadservices.com") ||
    hostname.includes("googlesyndication.com") ||
    hostname.includes("doubleclick.net")
  ) {
    return {
      urlStructureValid: false,
      isVerifiedPdp: false,
      destinationVerificationStatus: "GENERIC_GOOGLE_URL",
      finalDestination: null,
      normalizedProductUrl: null,
      extractedHandle: null,
      reason: "URL is a generic Google domain or ad redirector.",
    };
  }

  // Check for known link shorteners / redirect services
  const shortenerDomains = [
    "bit.ly",
    "tinyurl.com",
    "t.co",
    "goo.gl",
    "ow.ly",
    "buff.ly",
    "is.gd",
    "rebrand.ly",
  ];
  if (shortenerDomains.includes(hostname) || shortenerDomains.some((d) => hostname.endsWith("." + d))) {
    return {
      urlStructureValid: false,
      isVerifiedPdp: false,
      destinationVerificationStatus: "REDIRECTOR_OR_SHORTENER",
      finalDestination: null,
      normalizedProductUrl: null,
      extractedHandle: null,
      reason: `Link shortener / redirect service '${hostname}' cannot verify canonical merchant PDP destination.`,
    };
  }

  // Check for redirect URL parameters attempting to embed a target URL
  const redirectParamNames = ["url", "dest", "destination", "target", "adurl", "r"];
  for (const p of redirectParamNames) {
    if (parsed.searchParams.has(p)) {
      const val = parsed.searchParams.get(p);
      if (val && /^https?:\/\//i.test(val)) {
        return {
          urlStructureValid: false,
          isVerifiedPdp: false,
          destinationVerificationStatus: "REDIRECTOR_OR_SHORTENER",
          finalDestination: null,
          normalizedProductUrl: null,
          extractedHandle: null,
          reason: `Unresolved redirect parameter '?${p}=' detected in URL.`,
        };
      }
    }
  }

  // Domain verification against candidate store domain
  if (candidate.storeDomain) {
    const candRegDomain = extractRegistrableDomain(candidate.storeDomain);
    const evRegDomain = extractRegistrableDomain(hostname);
    if (!candRegDomain || !evRegDomain || candRegDomain !== evRegDomain) {
      return {
        urlStructureValid: false,
        isVerifiedPdp: false,
        destinationVerificationStatus: "STORE_DOMAIN_MISMATCH",
        finalDestination: null,
        normalizedProductUrl: null,
        extractedHandle: null,
        reason: `Destination domain '${evRegDomain}' does not match candidate merchant domain '${candRegDomain}'.`,
      };
    }
  }

  // Path inspection: must be a product page (/products/<handle>), not homepage, collection, blog, cart, etc.
  const pathname = parsed.pathname;
  if (!pathname || pathname === "/" || pathname === "") {
    return {
      urlStructureValid: false,
      isVerifiedPdp: false,
      destinationVerificationStatus: "NON_PDP_PAGE",
      finalDestination: null,
      normalizedProductUrl: null,
      extractedHandle: null,
      reason: "Destination is the store homepage, not a specific product detail page.",
    };
  }

  const nonPdpPatterns = [
    /^\/(collections|collection)\b/i,
    /^\/(blogs|blog|posts|post)\b/i,
    /^\/(pages|page)\b/i,
    /^\/(cart|checkout|account|search)\b/i,
    /^\/(policies|privacy|terms)\b/i,
  ];
  if (nonPdpPatterns.some((pattern) => pattern.test(pathname))) {
    return {
      urlStructureValid: false,
      isVerifiedPdp: false,
      destinationVerificationStatus: "NON_PDP_PAGE",
      finalDestination: null,
      normalizedProductUrl: null,
      extractedHandle: null,
      reason: `Destination path '${pathname}' is a collection, blog, or non-product utility page.`,
    };
  }

  const handleMatch = pathname.match(/\/products\/([a-z0-9-_]+)/i);
  if (!handleMatch || !handleMatch[1]) {
    return {
      urlStructureValid: false,
      isVerifiedPdp: false,
      destinationVerificationStatus: "NON_PDP_PAGE",
      finalDestination: null,
      normalizedProductUrl: null,
      extractedHandle: null,
      reason: `Destination path '${pathname}' is not a recognized /products/<handle> product detail page.`,
    };
  }

  const evHandle = handleMatch[1].toLowerCase();

  // Check handle conflict against candidate canonical product URL
  if (candidate.canonicalProductUrl) {
    const candHandleMatch = String(candidate.canonicalProductUrl).match(/\/products\/([a-z0-9-_]+)/i);
    const candHandle = candHandleMatch && candHandleMatch[1] ? candHandleMatch[1].toLowerCase() : null;
    if (candHandle && candHandle !== evHandle) {
      return {
        urlStructureValid: false,
        isVerifiedPdp: false,
        destinationVerificationStatus: "PRODUCT_HANDLE_CONFLICT",
        finalDestination: null,
        normalizedProductUrl: null,
        extractedHandle: evHandle,
        reason: `Destination product handle '${evHandle}' conflicts with candidate product handle '${candHandle}'.`,
      };
    }
  }

  // Clean canonical PDP URL (origin + pathname)
  const cleanUrl = `${parsed.origin}${parsed.pathname}`;
  return {
    urlStructureValid: true,
    isVerifiedPdp: false,
    destinationVerificationStatus: "PDP_URL_STRUCTURE_VALID",
    finalDestination: cleanUrl,
    normalizedProductUrl: cleanUrl,
    extractedHandle: evHandle,
    reason: `Merchant product page URL structure is valid ('${cleanUrl}'); requires verified HTTP fetch to confirm live PDP.`,
  };
}

const MUTUALLY_EXCLUSIVE_PRODUCT_GROUPS: string[][] = [
  ["feeder", "dispenser", "bowl"],
  ["fountain", "waterer", "hydration"],
  ["litter", "scoop", "deodorizer"],
  ["roller", "remover", "scraper", "chom", "uproot"],
  ["laundry", "detergent", "sheets"],
  ["harness", "leash", "collar"],
  ["bark", "ultrasonic", "trainer"],
  ["camera", "monitor", "treat"],
  ["carrier", "backpack", "seat", "hammock"],
  ["laser", "level"],
  ["stripper", "stripping", "crimper", "pliers"],
  ["stud", "scanner", "detector"],
  ["chopper", "dicer", "slicer", "mandoline"],
  ["sharpener", "knife"],
  ["sealer", "vacuum"],
  ["thermometer", "probe"],
  ["purifier", "air cleaner", "filter"],
];

function hasConflictingProductCategory(textA: string, textB: string): boolean {
  const lowerA = textA.toLowerCase();
  const lowerB = textB.toLowerCase();
  let groupA = -1;
  let groupB = -1;
  for (let i = 0; i < MUTUALLY_EXCLUSIVE_PRODUCT_GROUPS.length; i++) {
    const grp = MUTUALLY_EXCLUSIVE_PRODUCT_GROUPS[i];
    if (grp.some((w) => new RegExp(`\\b${w}s?\\b`, "i").test(lowerA))) {
      groupA = i;
      break;
    }
  }
  for (let i = 0; i < MUTUALLY_EXCLUSIVE_PRODUCT_GROUPS.length; i++) {
    const grp = MUTUALLY_EXCLUSIVE_PRODUCT_GROUPS[i];
    if (grp.some((w) => new RegExp(`\\b${w}s?\\b`, "i").test(lowerB))) {
      groupB = i;
      break;
    }
  }
  return groupA !== -1 && groupB !== -1 && groupA !== groupB;
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
      associationClassification: "EXACT_PRODUCT_MATCH",
      isProductSpecificEvidence: true,
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

    const candHandle =
      (candidate as any).normalizedProductHandle ||
      extractProductHandleFromUrl(candidate.canonicalProductUrl);
    const evHandle = extractProductHandleFromUrl(incomingEvidence.url);

    // If both URLs specify /products/<handle> on the same store and the handles differ,
    // or if the product categories are mutually exclusive (e.g. fountain vs feeder, laundry sheets vs pet hair remover),
    // reject as product-specific evidence (keep confidence PROBABLE for backwards compatibility, classification REJECTED_UNRELATED_CREATIVE)
    const hasHandleConflict = Boolean(candHandle && evHandle && candHandle !== evHandle);
    const hasCategoryConflict = hasConflictingProductCategory(candidateProductText, incomingText);

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
    const hasSameHandle = Boolean(candHandle && evHandle && candHandle === evHandle);

    if (hasSameHandle) {
      return {
        matchId: `match_${candidate.candidateId}_exact_handle`,
        sourceCandidateId: candidate.candidateId,
        matchedEntityTitle: incomingEvidence.title || "Store Catalog Item",
        matchedPlatform: incomingEvidence.platform,
        confidence: "EXACT",
        associationClassification: "EXACT_PRODUCT_MATCH",
        isProductSpecificEvidence: true,
        matchReasons: [
          `Same verified store domain (${candRegDomain}) and identical product handle (${candHandle}).`,
        ],
        requiresManualReview: false,
      };
    }

    if (hasHandleConflict || hasCategoryConflict) {
      confidence = "PROBABLE";
      matchReasons.push(
        `Same verified store domain (${candRegDomain}), but creative targets a different product (${hasHandleConflict ? `handle ${evHandle} vs ${candHandle}` : "conflicting product category"}). Not counted as product-specific evidence.`
      );
      return {
        matchId: `match_${candidate.candidateId}_domain_different_product`,
        sourceCandidateId: candidate.candidateId,
        matchedEntityTitle: incomingEvidence.title || "Store Catalog Item",
        matchedPlatform: incomingEvidence.platform,
        confidence,
        associationClassification: "REJECTED_UNRELATED_CREATIVE",
        isProductSpecificEvidence: false,
        matchReasons,
        requiresManualReview: true,
      };
    }

    if ((jaccard > 0.5 || coverage > 0.7 || hasModelMatch) && (nonBrandOverlap >= 1 || hasModelMatch)) {
      confidence = "HIGH_CONFIDENCE";
      const assocClass: GoogleAssociationClassification =
        hasModelMatch && (jaccard >= 0.5 || coverage >= 0.7)
          ? "EXACT_PRODUCT_MATCH"
          : "PROBABLE_PRODUCT_MATCH";
      matchReasons.push(
        `Same verified store domain (${candRegDomain}) and product-specific creative match (${Math.round(Math.max(jaccard, coverage) * 100)}% overlap).`
      );
      return {
        matchId: `match_${candidate.candidateId}_domain`,
        sourceCandidateId: candidate.candidateId,
        matchedEntityTitle: incomingEvidence.title || "Store Catalog Item",
        matchedPlatform: incomingEvidence.platform,
        confidence,
        associationClassification: assocClass,
        isProductSpecificEvidence: true,
        matchReasons,
        requiresManualReview: false,
      };
    } else {
      confidence = "PROBABLE";
      matchReasons.push(
        `Same verified store domain (${candRegDomain}) with brand-level or general catalog creative (no product-specific match).`
      );
      return {
        matchId: `match_${candidate.candidateId}_domain`,
        sourceCandidateId: candidate.candidateId,
        matchedEntityTitle: incomingEvidence.title || "Store Catalog Item",
        matchedPlatform: incomingEvidence.platform,
        confidence,
        associationClassification: "BRAND_ONLY_MATCH",
        isProductSpecificEvidence: false,
        matchReasons,
        requiresManualReview: true,
      };
    }
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
      associationClassification: "REJECTED_UNRELATED_CREATIVE",
      isProductSpecificEvidence: false,
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
    associationClassification: "REJECTED_UNRELATED_CREATIVE",
    isProductSpecificEvidence: false,
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
