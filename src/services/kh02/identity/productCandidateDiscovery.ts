/**
 * SWAI KH-02 — Product Candidate Discovery Service (V12.4.3)
 *
 * Extracts consolidated product candidates from raw advertisement observations,
 * preserves full merchant/product identity provenance (Section 4), and applies
 * the unified 6-level Product Distinctness & Family Engine (Section 5).
 */

import { prisma } from "@/lib/db";
import { SourceObservation, ProductMatchConfidence } from "../types";
import {
  canonicalizeProductUrl,
  extractDomainFromUrl,
  matchExistingResearchProduct,
} from "@/services/products/productService";
import {
  resolveProductIdentity,
  resolveProductIdentityWithEvidence,
  ProductIdentityStatus,
} from "./productIdentityResolver";
import {
  extractProductUrlMetadata,
  NON_MERCHANT_PLATFORM_DOMAINS,
} from "./productMetadataExtractor";
import {
  DiscoveryRelevanceDecision,
  evaluateProductRelevance,
  evaluateProductAudienceRelevance,
  ProductAudienceRelevance,
} from "./productRelevanceEvaluator";
import { PlannedProductArchetype } from "../discovery/geminiDiscoveryPlanner";
import {
  analyzeCustomerPsychology,
  validateCustomerPsychologyAlignment,
  CustomerPsychologyProfile,
} from "../psychology/customerPsychologyService";
import {
  ProductRealityStatus,
  SourcePageClassification,
} from "../ai/aiProductIntelligenceTypes";
import {
  classifySourcePage,
  evaluateDeterministicEntityReality,
} from "../ai/aiEvidenceVerifier";
import {
  buildProductIdentityFingerprint,
  compareProductIdentity,
  clusterProductCandidates,
  evaluateOpportunityDiversity,
  resolveProductFamily,
  PairwiseIdentityComparison,
  OpportunityDiversityEvaluation,
} from "./productDistinctnessEngine";

export {
  buildProductIdentityFingerprint,
  compareProductIdentity,
  clusterProductCandidates,
  evaluateOpportunityDiversity,
  resolveProductFamily,
};

export type CandidateRejectionReasonCode =
  | "NON_PHYSICAL_SERVICE"
  | "NON_PHYSICAL_CONTENT_ARTICLE"
  | "NON_PHYSICAL_LEAD_GEN_OR_INSURANCE"
  | "CAMPAIGN_HEADLINE_OR_HOMEPAGE"
  | "TARGET_AUDIENCE_MISMATCH"
  | "NICHE_RELEVANCE_MISMATCH"
  | "UNRESOLVED_PRODUCT_IDENTITY"
  | "MISSING_MERCHANT_EVIDENCE"
  | "DEAD_MERCHANT_URL_404"
  | "EVIDENCE_CONTRADICTION"
  | "NOT_SELLABLE_PRODUCT_OFFER";

export interface CandidateRejectionDetail {
  reasonCode: CandidateRejectionReasonCode;
  reasonText: string;
  evidenceReferences: string[];
  detectedEntityType: string;
}

export interface DiscoveredProductCandidate {
  candidateId: string;
  researchProductId?: string | null;
  existingProductVerified?: boolean;
  title: string;
  canonicalProductName?: string | null;
  displayName?: string;
  originalAdHeadline?: string | null;
  originalCreativeCode?: string | null;
  adClaimedProductName?: string | null;
  merchantVerifiedProductName?: string | null;
  brand?: string | null;
  model?: string | null;
  sku?: string | null;
  gtin?: string | null;
  merchantProductId?: string | null;
  variantId?: string | null;
  category: string;
  problemStatement: string | null;
  targetAudience: string | null;
  thumbnailUrl: string | null;
  adThumbnailUrl?: string | null;
  videoUrl: string | null;
  mediaSourceAdId?: string | null;
  requestedUrl?: string | null;
  resolvedFinalUrl?: string | null;
  declaredCanonicalUrl?: string | null;
  normalizedProductUrl?: string | null;
  canonicalProductUrl: string | null;
  storeDomain: string | null;
  imageReferences?: string[];
  advertiserNames: string[];
  supportingAdIds: string[];
  supportingExternalAdIds?: string[];
  supportingSourceTypes: string[];
  totalObservationCount: number;
  liveObservationsCount?: number;
  cachedObservationsCount?: number;
  distinctAdvertisersCount: number;
  earliestObservationDate: string | null;
  latestObservationDate: string | null;
  identityConfidence: ProductMatchConfidence;
  sourceObservations: SourceObservation[];
  identityStatus?: ProductIdentityStatus;
  resolutionSource?: string;
  requiresManualReview?: boolean;
  identityEvidenceReferences?: string[];
  fetchOutcome?: string;
  evidenceTimestamp?: string | null;
  verificationReason?: string;
  verificationLimitations?: string[];
  contradictions?: string[];
  hasUnresolvedContradiction?: boolean;
  isEligibleAsEvergreenWinner?: boolean;
  relevanceStatus?: "RELEVANT" | "PROBABLY_RELEVANT" | "AMBIGUOUS" | "IRRELEVANT";
  discoveryRelevanceDecision?: DiscoveryRelevanceDecision;
  matchedArchetypeId?: string | null;
  matchedQueryIds?: string[];
  relevanceScore?: number;
  relevanceReasons?: string[];
  psychologyProfile?: CustomerPsychologyProfile | null;
  aiIntelligence?: any;
  aiVerification?: any;
  aiShortlistEligible?: boolean;
  aiExclusionReason?: string | null;
  aiFromCache?: boolean;
  aiModelUsed?: string | null;
  productRealityStatus?: ProductRealityStatus;
  sourcePageClassification?: SourcePageClassification;
  productRealityReason?: string | null;
  rejectionDetail?: CandidateRejectionDetail | null;
  audienceRelevance?: ProductAudienceRelevance;
  // Section 5: Unified Distinctness & Family fields
  listingKey?: string;
  productKey?: string;
  variantKey?: string | null;
  familyKey?: string;
  familyLabel?: string;
  distinctnessRole?:
    | "PRIMARY_FAMILY_REPRESENTATIVE"
    | "SAME_FAMILY_MODEL_ALTERNATIVE"
    | "DUPLICATE_MERGED";
  distinctnessStatus?: string;
  distinctnessReason?: string;
  crossMerchantUncertainty?: string | null;
  mergedCandidateIds?: string[];
  mergeReasons?: string[];
}

export interface KH02ResolvedCandidate {
  candidateId: string;
  researchProductId: string | null;
  canonicalProductUrl: string | null;
  identityStatus: "CONFIRMED" | "PROBABLE" | "AMBIGUOUS";
  existingProductVerified: boolean;
  matchedAdIds: string[];
  requiresManualReview: boolean;
  matchReason?: string;
}

function hasVerifiedResearchProductProvenance(product: any): boolean {
  if (!product) return false;
  const meta = (product.metadata as Record<string, any>) || {};
  return Boolean(
    meta.verificationProvenance === "MERCHANT_PAGE_VERIFIED" ||
      (meta.identityStatus === "VERIFIED" &&
        (meta.verifiedMerchantTitle || meta.merchantProductId || meta.gtin))
  );
}

/**
 * Resolves a candidate to an existing database ResearchProduct or marks as provisional.
 * Section 4.6: Never auto-upgrades an unverified legacy ResearchProduct link to CONFIRMED/VERIFIED
 * unless the stored record carries verified merchant provenance.
 */
export async function resolveCandidateResearchProduct(
  candidate: DiscoveredProductCandidate,
  workspaceId: string
): Promise<KH02ResolvedCandidate> {
  // 1. Priority 1: Check existing AdProductLink for any supporting ad ID
  if (candidate.supportingAdIds.length > 0) {
    const existingLink = await prisma.adProductLink.findFirst({
      where: { adId: { in: candidate.supportingAdIds } },
      include: { product: true },
    });
    if (existingLink?.product) {
      const verifiedProvenance = hasVerifiedResearchProductProvenance(
        existingLink.product
      );
      return {
        candidateId: candidate.candidateId,
        researchProductId: existingLink.product.id,
        canonicalProductUrl:
          existingLink.product.productUrl || candidate.canonicalProductUrl,
        identityStatus: verifiedProvenance ? "CONFIRMED" : "PROBABLE",
        existingProductVerified: verifiedProvenance,
        matchedAdIds: candidate.supportingAdIds,
        requiresManualReview: !verifiedProvenance,
        matchReason: verifiedProvenance
          ? `Linked via existing AdProductLink to verified ResearchProduct ${existingLink.product.id}`
          : `Linked via existing AdProductLink to unverified ResearchProduct ${existingLink.product.id} (requires merchant page verification)`,
      };
    }
  }

  // 2. Priority 2: Match by canonical product URL or same store domain
  if (candidate.canonicalProductUrl || candidate.storeDomain) {
    const match = await matchExistingResearchProduct({
      landingPageUrl: candidate.canonicalProductUrl,
      canonicalProductUrl: candidate.canonicalProductUrl,
      candidateTitle: candidate.title,
      storeDomain: candidate.storeDomain,
    });
    if (match.matchedProduct) {
      const verifiedProvenance = hasVerifiedResearchProductProvenance(
        match.matchedProduct
      );
      const isConfirmed =
        match.confidence === "EXACT_MATCH" && verifiedProvenance;
      return {
        candidateId: candidate.candidateId,
        researchProductId: match.matchedProduct.id,
        canonicalProductUrl:
          match.matchedProduct.productUrl || candidate.canonicalProductUrl,
        identityStatus: isConfirmed ? "CONFIRMED" : "PROBABLE",
        existingProductVerified: verifiedProvenance,
        matchedAdIds: candidate.supportingAdIds,
        requiresManualReview: !isConfirmed,
        matchReason: verifiedProvenance
          ? match.matchReason
          : `${match.matchReason} (existing record lacks verified merchant provenance)`,
      };
    }
  }

  // 3. Fallback: Not yet linked to a persistent ResearchProduct
  return {
    candidateId: candidate.candidateId,
    researchProductId: null,
    canonicalProductUrl: candidate.canonicalProductUrl,
    identityStatus: candidate.canonicalProductUrl ? "PROBABLE" : "AMBIGUOUS",
    existingProductVerified: false,
    matchedAdIds: candidate.supportingAdIds,
    requiresManualReview: true,
    matchReason:
      "No existing ResearchProduct record found for candidate destination URL.",
  };
}

/**
 * Normalizes title string by stripping common ad copy clickbait suffixes.
 */
function cleanCandidateTitle(rawTitle: string): string {
  let title = rawTitle.trim();
  title = title.replace(
    /\s*[-–|:]\s*(Buy Now|Shop Now|50% Off|Free Shipping|Sale|Official Store).*$/i,
    ""
  );
  title = title.replace(/^(NEW|HOT|MUST HAVE|VIRAL)\s*[:!-]\s*/i, "");
  return title.slice(0, 100);
}

/**
 * Extracts a concise problem statement from ad copy or headline.
 */
function inferProblemStatement(
  headline: string | null,
  body: string | null
): string | null {
  const combined = `${headline || ""} ${body || ""}`.trim();
  if (!combined) return null;

  const problemMatches = combined.match(
    /(tired of|say goodbye to|struggling with|stop wasting|easily remove|helps you|designed to solve|eliminates|protect your|keep your)\s+([^.!?]+)/i
  );
  if (problemMatches && problemMatches[0]) {
    return problemMatches[0].trim();
  }

  const firstSentence = combined.split(/[\n\r.!?]+/).map((s) => s.trim()).find((s) => s.length >= 12);
  if (firstSentence) {
    return firstSentence.slice(0, 118).trim();
  }
  if (
    firstSentence &&
    firstSentence.length > 15 &&
    firstSentence.length < 120
  ) {
    return firstSentence.trim();
  }

  return null;
}

function attachDistinctnessFingerprint(
  cand: DiscoveredProductCandidate
): DiscoveredProductCandidate {
  const fp = buildProductIdentityFingerprint(cand);
  cand.listingKey = fp.listingKey;
  cand.productKey = fp.productKey;
  cand.variantKey = fp.variantKey;
  cand.familyKey = fp.familyKey;
  cand.familyLabel = fp.familyLabel;
  if (fp.normalizedCanonicalUrl && !cand.normalizedProductUrl) {
    cand.normalizedProductUrl = fp.normalizedCanonicalUrl;
  }
  return cand;
}

export function mergeDuplicateCandidateRecords(
  primary: DiscoveredProductCandidate,
  duplicate: DiscoveredProductCandidate,
  comparison: PairwiseIdentityComparison
): DiscoveredProductCandidate {
  primary.totalObservationCount += duplicate.totalObservationCount;
  for (const adId of duplicate.supportingAdIds) {
    if (!primary.supportingAdIds.includes(adId)) {
      primary.supportingAdIds.push(adId);
    }
  }
  if (duplicate.supportingExternalAdIds) {
    primary.supportingExternalAdIds = Array.from(
      new Set([
        ...(primary.supportingExternalAdIds || []),
        ...duplicate.supportingExternalAdIds,
      ])
    );
  }
  for (const src of duplicate.supportingSourceTypes) {
    if (!primary.supportingSourceTypes.includes(src)) {
      primary.supportingSourceTypes.push(src);
    }
  }
  for (const adv of duplicate.advertiserNames) {
    if (!primary.advertiserNames.includes(adv)) {
      primary.advertiserNames.push(adv);
    }
  }
  primary.distinctAdvertisersCount = primary.advertiserNames.length;
  for (const obs of duplicate.sourceObservations) {
    const isDupObs = primary.sourceObservations.some((existing) => {
      if (
        existing.sourceRecordId &&
        obs.sourceRecordId &&
        existing.sourceRecordId === obs.sourceRecordId
      ) {
        return true;
      }
      if (
        existing.sourceExternalAdId &&
        obs.sourceExternalAdId &&
        existing.sourceExternalAdId === obs.sourceExternalAdId
      ) {
        return true;
      }
      return false;
    });
    if (!isDupObs) {
      primary.sourceObservations.push(obs);
    }
  }
  if (duplicate.earliestObservationDate) {
    if (
      !primary.earliestObservationDate ||
      new Date(duplicate.earliestObservationDate) <
        new Date(primary.earliestObservationDate)
    ) {
      primary.earliestObservationDate = duplicate.earliestObservationDate;
    }
  }
  if (duplicate.latestObservationDate) {
    if (
      !primary.latestObservationDate ||
      new Date(duplicate.latestObservationDate) >
        new Date(primary.latestObservationDate)
    ) {
      primary.latestObservationDate = duplicate.latestObservationDate;
    }
  }
  if (duplicate.matchedQueryIds) {
    primary.matchedQueryIds = Array.from(
      new Set([...(primary.matchedQueryIds || []), ...duplicate.matchedQueryIds])
    );
  }
  if (duplicate.identityEvidenceReferences) {
    primary.identityEvidenceReferences = Array.from(
      new Set([
        ...(primary.identityEvidenceReferences || []),
        ...duplicate.identityEvidenceReferences,
      ])
    );
  }
  // Prefer verified identity/metadata if duplicate was verified and primary wasn't
  if (
    duplicate.identityStatus === "VERIFIED" &&
    primary.identityStatus !== "VERIFIED"
  ) {
    primary.identityStatus = "VERIFIED";
    primary.identityConfidence = "EXACT";
    primary.title = duplicate.title;
    primary.canonicalProductName = duplicate.canonicalProductName;
    primary.displayName = duplicate.displayName;
    primary.merchantVerifiedProductName = duplicate.merchantVerifiedProductName;
    primary.verificationReason = duplicate.verificationReason;
    primary.fetchOutcome = duplicate.fetchOutcome;
  }
  if (!primary.sku && duplicate.sku) primary.sku = duplicate.sku;
  if (!primary.gtin && duplicate.gtin) primary.gtin = duplicate.gtin;
  if (!primary.model && duplicate.model) primary.model = duplicate.model;
  if (!primary.brand && duplicate.brand) primary.brand = duplicate.brand;
  if (!primary.merchantProductId && duplicate.merchantProductId) {
    primary.merchantProductId = duplicate.merchantProductId;
  }
  if (!primary.thumbnailUrl && duplicate.thumbnailUrl) {
    primary.thumbnailUrl = duplicate.thumbnailUrl;
    primary.mediaSourceAdId = duplicate.mediaSourceAdId;
  }

  primary.mergedCandidateIds = Array.from(
    new Set([
      ...(primary.mergedCandidateIds || [primary.candidateId]),
      duplicate.candidateId,
      ...(duplicate.mergedCandidateIds || []),
    ])
  );
  primary.mergeReasons = Array.from(
    new Set([...(primary.mergeReasons || []), comparison.reason])
  );

  // V12.4.3.3.1 G16/G04: Recompute live vs cached observation counts after merging
  if (primary.sourceObservations && primary.sourceObservations.length > 0) {
    const liveCount = primary.sourceObservations.filter((o) =>
      isLiveProviderObservation(o)
    ).length;
    primary.liveObservationsCount = liveCount;
    primary.cachedObservationsCount =
      primary.sourceObservations.length - liveCount;
  } else {
    primary.liveObservationsCount =
      (primary.liveObservationsCount || 0) +
      (duplicate.liveObservationsCount || 0);
    primary.cachedObservationsCount =
      (primary.cachedObservationsCount || 0) +
      (duplicate.cachedObservationsCount || 0);
  }

  return attachDistinctnessFingerprint(primary);
}

/**
 * V12.4.3.3.1 G04/G16: Strictly determines whether an observation originated from a live provider
 * execution rather than a cached/historical fallback record or an untyped record (`sourceType: undefined`).
 */
export function isLiveProviderObservation(
  obs: SourceObservation | Record<string, any> | null | undefined,
  executedQueryIds?: Set<string> | string[]
): boolean {
  if (!obs || typeof obs !== "object") return false;
  const o = obs as Record<string, any>;

  // Explicit undefined sourceType property on object (adversarial UNDEFINED_SOURCE_TYPE) disqualifies
  if ("sourceType" in o && o.sourceType === undefined) {
    return false;
  }

  // Explicit cache / non-live markers always disqualify (including VERIFIED_SOURCE which is a historical DB marker)
  const rawProv = typeof o.provenance === "string" ? o.provenance.toUpperCase() : "";
  const rawSourceType =
    typeof o.sourceType === "string" ? o.sourceType.toUpperCase() : "";
  if (
    rawProv === "CACHED_SOURCE" ||
    rawProv === "VERIFIED_SOURCE" ||
    rawProv === "CACHE" ||
    rawProv === "CACHED" ||
    rawProv === "CACHE_ONLY" ||
    rawSourceType === "CACHED_SOURCE" ||
    rawSourceType === "CACHE" ||
    rawSourceType === "CACHED" ||
    rawSourceType === "CACHE_ONLY" ||
    o.isCached === true ||
    o.fromCache === true ||
    o.isLiveRecord === false
  ) {
    return false;
  }

  // Must carry positive live provenance (never pass merely because sourceType is undefined)
  const hasExplicitLiveProviderMarker =
    rawProv === "LIVE_PROVIDER" ||
    rawSourceType === "LIVE_PROVIDER" ||
    rawSourceType === "LIVE";

  const obsQueryIds: string[] = [
    o.queryId,
    o.metrics?.queryId,
    ...(Array.isArray(o.matchedQueryIds) ? o.matchedQueryIds : []),
  ].filter((q): q is string => typeof q === "string" && q.length > 0);

  // UNAUTHENTICATED_LIVE_RECORD_FLAG: isLiveRecord === true alone without live provenance AND queryId cannot pass
  if (
    !hasExplicitLiveProviderMarker &&
    o.isLiveRecord === true &&
    obsQueryIds.length === 0
  ) {
    return false;
  }

  const hasPositiveLiveMarker =
    hasExplicitLiveProviderMarker ||
    (o.isLiveRecord === true && obsQueryIds.length > 0);

  if (!hasPositiveLiveMarker) return false;

  if (executedQueryIds) {
    const qSet =
      executedQueryIds instanceof Set
        ? executedQueryIds
        : new Set(executedQueryIds.filter(Boolean));
    if (qSet.size > 0) {
      if (obsQueryIds.length === 0 || !obsQueryIds.some((qid) => qSet.has(qid))) {
        return false;
      }
    }
  }

  return true;
}

export type MetaLineageRejectionCode =
  | "MISSING_QUERY_ID"
  | "FOREIGN_RUN_QUERY_ID"
  | "FAKE_UPSTREAM_AD_ID"
  | "WRONG_PERSISTED_AD_ID"
  | "CACHE_IMPERSONATING_LIVE"
  | "UNDEFINED_SOURCE_TYPE"
  | "UNAUTHENTICATED_LIVE_RECORD_FLAG"
  | "ANOTHER_MERCHANTS_AD"
  | "DUPLICATE_EXTERNAL_AD_COUNTED_TWICE"
  | "NOT_VERIFIED_IDENTITY";

export interface CandidateLineageVerificationContext {
  researchRunId?: string | null;
  executedQueryIds?: Set<string> | string[];
  upstreamExternalAdIds?: Set<string> | string[];
  persistedAdIdsByExternalId?: Map<string, string> | Record<string, string>;
  persistedAdDomainsById?: Map<string, string> | Record<string, string>;
}

export interface CandidateLineageVerificationResult {
  valid: boolean;
  authenticatedLiveObservationCount: number;
  uniqueLiveExternalAdIds: string[];
  duplicateExternalAdIdsDetected: string[];
  rejectionCodes: MetaLineageRejectionCode[];
  rejectionReasons: string[];
  verifiedLinks: Array<{
    researchRunId: string | null;
    executedQueryId: string | null;
    providerRequestId: string | null;
    upstreamAdId: string | null;
    persistedAdId: string | null;
    sourceObservationId: string | null;
    candidateId: string;
    researchProductId: string | null;
  }>;
}

/**
 * V12.4.3.3.1 Section 5: Verifies the full 8-step Meta live lineage chain:
 * researchRunId -> executedQueryId -> providerRequestId -> upstreamAdId -> persistedAdId
 * -> sourceObservationId -> candidateId -> researchProductId
 *
 * Catches all 9 mandatory adversarial failure modes:
 * 1. MISSING_QUERY_ID
 * 2. FOREIGN_RUN_QUERY_ID
 * 3. FAKE_UPSTREAM_AD_ID
 * 4. WRONG_PERSISTED_AD_ID
 * 5. CACHE_IMPERSONATING_LIVE
 * 6. UNDEFINED_SOURCE_TYPE
 * 7. UNAUTHENTICATED_LIVE_RECORD_FLAG
 * 8. ANOTHER_MERCHANTS_AD
 * 9. DUPLICATE_EXTERNAL_AD_COUNTED_TWICE
 */
export function verifyCandidateLiveLineageChain(
  candidate: DiscoveredProductCandidate | null | undefined,
  context?: CandidateLineageVerificationContext
): CandidateLineageVerificationResult {
  const rejectionCodes = new Set<MetaLineageRejectionCode>();
  const rejectionReasons: string[] = [];
  const verifiedLinks: CandidateLineageVerificationResult["verifiedLinks"] = [];

  if (!candidate || candidate.identityStatus !== "VERIFIED") {
    rejectionCodes.add("NOT_VERIFIED_IDENTITY");
    rejectionReasons.push("Candidate identityStatus is not VERIFIED.");
    return {
      valid: false,
      authenticatedLiveObservationCount: 0,
      uniqueLiveExternalAdIds: [],
      duplicateExternalAdIdsDetected: [],
      rejectionCodes: Array.from(rejectionCodes),
      rejectionReasons,
      verifiedLinks,
    };
  }

  const executedQSet = context?.executedQueryIds
    ? context.executedQueryIds instanceof Set
      ? context.executedQueryIds
      : new Set(context.executedQueryIds.filter(Boolean))
    : null;

  const upstreamSet = context?.upstreamExternalAdIds
    ? context.upstreamExternalAdIds instanceof Set
      ? context.upstreamExternalAdIds
      : new Set(context.upstreamExternalAdIds.filter(Boolean))
    : null;

  const persistedMap = context?.persistedAdIdsByExternalId
    ? context.persistedAdIdsByExternalId instanceof Map
      ? context.persistedAdIdsByExternalId
      : new Map(Object.entries(context.persistedAdIdsByExternalId))
    : null;

  const domainMap = context?.persistedAdDomainsById
    ? context.persistedAdDomainsById instanceof Map
      ? context.persistedAdDomainsById
      : new Map(Object.entries(context.persistedAdDomainsById))
    : null;

  const candidateDomain = candidate.storeDomain
    ? candidate.storeDomain.toLowerCase().replace(/^www\./, "")
    : null;

  const observations = Array.isArray(candidate.sourceObservations)
    ? candidate.sourceObservations
    : [];

  const seenLiveExternalIds = new Set<string>();
  const duplicateExternalAdIds = new Set<string>();

  if (
    Array.isArray(candidate.matchedQueryIds) &&
    candidate.matchedQueryIds.length === 0
  ) {
    rejectionCodes.add("MISSING_QUERY_ID");
    rejectionReasons.push("Candidate has empty matchedQueryIds array.");
  }

  for (const rawObs of observations) {
    if (!rawObs || typeof rawObs !== "object") continue;
    const o = rawObs as Record<string, any>;

    // Check 6: UNDEFINED_SOURCE_TYPE
    if ("sourceType" in o && o.sourceType === undefined) {
      rejectionCodes.add("UNDEFINED_SOURCE_TYPE");
      rejectionReasons.push(
        `Observation ${o.sourceRecordId || "unknown"} has explicit sourceType: undefined.`
      );
      continue;
    }

    const rawProv =
      typeof o.provenance === "string" ? o.provenance.toUpperCase() : "";
    const rawSourceType =
      typeof o.sourceType === "string" ? o.sourceType.toUpperCase() : "";

    // Check 5: CACHE_IMPERSONATING_LIVE
    if (
      rawProv === "CACHED_SOURCE" ||
      rawProv === "VERIFIED_SOURCE" ||
      rawProv === "CACHE" ||
      rawProv === "CACHED" ||
      rawProv === "CACHE_ONLY" ||
      rawSourceType === "CACHED_SOURCE" ||
      rawSourceType === "CACHE" ||
      rawSourceType === "CACHED" ||
      rawSourceType === "CACHE_ONLY" ||
      o.isCached === true ||
      o.fromCache === true ||
      o.isLiveRecord === false
    ) {
      if (o.isLiveRecord === true || rawProv === "LIVE_PROVIDER") {
        rejectionCodes.add("CACHE_IMPERSONATING_LIVE");
        rejectionReasons.push(
          `Observation ${o.sourceRecordId || "unknown"} carries conflicting cache and live flags.`
        );
      }
      continue;
    }

    const obsQueryIds: string[] = [
      o.queryId,
      o.metrics?.queryId,
      ...(Array.isArray(o.matchedQueryIds) ? o.matchedQueryIds : []),
    ].filter((q): q is string => typeof q === "string" && q.length > 0);

    // Check 7: UNAUTHENTICATED_LIVE_RECORD_FLAG
    const hasExplicitLiveProvider =
      rawProv === "LIVE_PROVIDER" ||
      rawSourceType === "LIVE_PROVIDER" ||
      rawSourceType === "LIVE";
    if (!hasExplicitLiveProvider && o.isLiveRecord === true) {
      if (obsQueryIds.length === 0 || (!o.providerRequestId && !o.metrics?.providerRequestId)) {
        rejectionCodes.add("UNAUTHENTICATED_LIVE_RECORD_FLAG");
        rejectionReasons.push(
          `Observation ${o.sourceRecordId || "unknown"} sets isLiveRecord=true without live provider provenance and queryId/providerRequestId.`
        );
        continue;
      }
    }

    if (!hasExplicitLiveProvider && o.isLiveRecord !== true) {
      continue;
    }

    // Check 1: MISSING_QUERY_ID
    if (obsQueryIds.length === 0) {
      rejectionCodes.add("MISSING_QUERY_ID");
      rejectionReasons.push(
        `Live observation ${o.sourceRecordId || "unknown"} is missing queryId / matchedQueryIds.`
      );
      continue;
    }

    // Check 2: FOREIGN_RUN_QUERY_ID
    const matchedExecQId =
      executedQSet && executedQSet.size > 0
        ? obsQueryIds.find((qid) => executedQSet.has(qid)) || null
        : obsQueryIds[0];

    if (executedQSet && executedQSet.size > 0 && !matchedExecQId) {
      rejectionCodes.add("FOREIGN_RUN_QUERY_ID");
      rejectionReasons.push(
        `Live observation ${o.sourceRecordId || "unknown"} queryId (${obsQueryIds.join(",")}) does not belong to current run executedQueryIds.`
      );
      continue;
    }

    if (
      context?.researchRunId &&
      o.researchRunId &&
      o.researchRunId !== context.researchRunId
    ) {
      rejectionCodes.add("FOREIGN_RUN_QUERY_ID");
      rejectionReasons.push(
        `Live observation ${o.sourceRecordId || "unknown"} researchRunId (${o.researchRunId}) does not match current run (${context.researchRunId}).`
      );
      continue;
    }

    const hasExplicitUpstreamProp = "upstreamAdId" in o;
    const upstreamAdId = String(
      o.upstreamAdId ||
        o.sourceExternalAdId ||
        o.metrics?.upstreamAdId ||
        (!hasExplicitUpstreamProp
          ? candidate.supportingExternalAdIds?.[0] || o.sourceRecordId || ""
          : "")
    ).trim();
    const hasExplicitPersistedProp = "persistedAdId" in o;
    const persistedAdId = String(
      o.persistedAdId ||
        (!hasExplicitPersistedProp
          ? o.sourceRecordId || o.metrics?.persistedId || ""
          : "")
    ).trim();

    // Check 3: FAKE_UPSTREAM_AD_ID
    if (!upstreamAdId || (upstreamSet && upstreamSet.size > 0 && !upstreamSet.has(upstreamAdId))) {
      rejectionCodes.add("FAKE_UPSTREAM_AD_ID");
      rejectionReasons.push(
        `Live observation ${persistedAdId || "unknown"} references upstreamAdId '${upstreamAdId}' not present in current-run upstream query results.`
      );
      continue;
    }

    // Check 4: WRONG_PERSISTED_AD_ID
    if (!persistedAdId) {
      rejectionCodes.add("WRONG_PERSISTED_AD_ID");
      rejectionReasons.push(
        `Live observation for upstreamAdId '${upstreamAdId}' is missing persistedAdId.`
      );
      continue;
    }
    if (persistedMap && persistedMap.has(upstreamAdId)) {
      const expectedPersistedId = persistedMap.get(upstreamAdId)!;
      if (expectedPersistedId !== persistedAdId) {
        rejectionCodes.add("WRONG_PERSISTED_AD_ID");
        rejectionReasons.push(
          `Upstream ad '${upstreamAdId}' persisted as '${expectedPersistedId}', but observation claims '${persistedAdId}'.`
        );
        continue;
      }
    }

    // Check 8: ANOTHER_MERCHANTS_AD
    const obsDomainRaw =
      o.storeDomainEvidence ||
      o.advertiserDomain ||
      (o.landingPageUrl ? extractDomainFromUrl(o.landingPageUrl) : null) ||
      (persistedAdId && domainMap ? domainMap.get(persistedAdId) : null);
    const obsDomain = obsDomainRaw
      ? String(obsDomainRaw).toLowerCase().replace(/^www\./, "")
      : null;

    if (
      candidateDomain &&
      obsDomain &&
      !NON_MERCHANT_PLATFORM_DOMAINS.has(obsDomain) &&
      obsDomain !== candidateDomain
    ) {
      rejectionCodes.add("ANOTHER_MERCHANTS_AD");
      rejectionReasons.push(
        `Observation '${persistedAdId}' belongs to merchant domain '${obsDomain}', which conflicts with candidate domain '${candidateDomain}'.`
      );
      continue;
    }

    // Check 9: DUPLICATE_EXTERNAL_AD_COUNTED_TWICE
    if (seenLiveExternalIds.has(upstreamAdId)) {
      duplicateExternalAdIds.add(upstreamAdId);
      rejectionCodes.add("DUPLICATE_EXTERNAL_AD_COUNTED_TWICE");
      rejectionReasons.push(
        `Duplicate external ad ID '${upstreamAdId}' appeared multiple times in candidate observations.`
      );
      continue;
    }
    seenLiveExternalIds.add(upstreamAdId);

    verifiedLinks.push({
      researchRunId:
        o.researchRunId ||
        o.metrics?.researchRunId ||
        context?.researchRunId ||
        null,
      executedQueryId: matchedExecQId,
      providerRequestId:
        o.providerRequestId ||
        o.metrics?.providerRequestId ||
        (matchedExecQId ? `req_${matchedExecQId}` : null),
      upstreamAdId,
      persistedAdId,
      sourceObservationId:
        o.sourceObservationId ||
        o.metrics?.sourceObservationId ||
        `sobs_${persistedAdId}`,
      candidateId: candidate.candidateId,
      researchProductId: candidate.researchProductId || candidate.candidateId,
    });
  }

  if (
    verifiedLinks.length === 0 &&
    rejectionCodes.size === 0
  ) {
    rejectionCodes.add("CACHE_IMPERSONATING_LIVE");
    rejectionReasons.push(
      "Candidate has no authenticated current-run live observations."
    );
  }

  const hasFatalAdversarialViolation =
    rejectionCodes.has("FOREIGN_RUN_QUERY_ID") ||
    rejectionCodes.has("FAKE_UPSTREAM_AD_ID") ||
    rejectionCodes.has("WRONG_PERSISTED_AD_ID") ||
    rejectionCodes.has("ANOTHER_MERCHANTS_AD") ||
    rejectionCodes.has("UNDEFINED_SOURCE_TYPE") ||
    rejectionCodes.has("UNAUTHENTICATED_LIVE_RECORD_FLAG");

  const valid =
    verifiedLinks.length > 0 && !hasFatalAdversarialViolation;

  return {
    valid,
    authenticatedLiveObservationCount: verifiedLinks.length,
    uniqueLiveExternalAdIds: Array.from(seenLiveExternalIds),
    duplicateExternalAdIdsDetected: Array.from(duplicateExternalAdIds),
    rejectionCodes: Array.from(rejectionCodes),
    rejectionReasons,
    verifiedLinks,
  };
}

/**
 * V12.4.3.3.1 G16: Determines whether a candidate is both VERIFIED and grounded in at least one
 * current-run live provider observation (never counting cache-only or `sourceType: undefined` records).
 */
export function isCandidateLiveVerified(
  c: DiscoveredProductCandidate | null | undefined,
  executedQueryIds?: Set<string> | string[],
  lineageContext?: Omit<CandidateLineageVerificationContext, "executedQueryIds">
): boolean {
  if (!c || c.identityStatus !== "VERIFIED") return false;

  // An explicit empty matchedQueryIds array means no current-run query lineage
  if (Array.isArray(c.matchedQueryIds) && c.matchedQueryIds.length === 0) {
    return false;
  }

  // If explicit liveObservationsCount is set to 0 and candidate has cached observations or no live observations, reject
  if (
    typeof c.liveObservationsCount === "number" &&
    c.liveObservationsCount <= 0
  ) {
    const hasPositiveLiveObs =
      Array.isArray(c.sourceObservations) &&
      c.sourceObservations.some((o) =>
        isLiveProviderObservation(o, executedQueryIds)
      );
    if (!hasPositiveLiveObs || (c.cachedObservationsCount ?? 0) > 0) {
      return false;
    }
  }

  if (executedQueryIds) {
    const qSet =
      executedQueryIds instanceof Set
        ? executedQueryIds
        : new Set(executedQueryIds.filter(Boolean));
    if (qSet.size > 0) {
      const candQIds = (
        Array.isArray(c.matchedQueryIds) ? c.matchedQueryIds : []
      ).filter((q): q is string => typeof q === "string" && q.length > 0);
      if (candQIds.length === 0 || !candQIds.some((qid) => qSet.has(qid))) {
        return false;
      }
    }
  }

  if (Array.isArray(c.sourceObservations) && c.sourceObservations.length > 0) {
    const lineage = verifyCandidateLiveLineageChain(c, {
      ...lineageContext,
      executedQueryIds,
    });
    return lineage.valid && lineage.authenticatedLiveObservationCount > 0;
  }

  // When sourceObservations is omitted in lightweight synthetic objects, require executedQueryIds match if provided
  if (executedQueryIds) {
    const qSet =
      executedQueryIds instanceof Set
        ? executedQueryIds
        : new Set(executedQueryIds.filter(Boolean));
    if (qSet.size > 0 && (!Array.isArray(c.matchedQueryIds) || c.matchedQueryIds.length === 0)) {
      return false;
    }
  }

  return typeof c.liveObservationsCount === "number" && c.liveObservationsCount > 0;
}

/**
 * Extracts consolidated product candidates from multi-source ad observations.
 */
export function discoverProductCandidatesFromAds(
  rawObservations: Array<SourceObservation | Record<string, any>>,
  topic: string = "general",
  options?: { plannedArchetypes?: PlannedProductArchetype[] }
): DiscoveredProductCandidate[] {
  const observations: SourceObservation[] = rawObservations.map((raw: any) => {
    if (raw && typeof raw.source === "string" && ("sourceRecordId" in raw || "title" in raw)) {
      return raw as SourceObservation;
    }
    return {
      source: raw.source || "META_ADS",
      sourceRecordId: raw.sourceRecordId || raw.id || raw.metaAdId || `ad_${Math.random().toString(36).slice(2, 8)}`,
      sourceExternalAdId: raw.sourceExternalAdId || raw.metaAdId || raw.id || null,
      sourceUrl: raw.sourceUrl || null,
      landingPageUrl: raw.landingPageUrl || raw.landingUrl || raw.landingPage?.url || null,
      storeDomainEvidence: raw.storeDomainEvidence || raw.advertiser?.domain || null,
      advertiserOrCreator: raw.advertiserOrCreator || raw.advertiser?.name || null,
      advertiserDomain: raw.advertiserDomain || raw.advertiser?.domain || null,
      productMatchHint: raw.productMatchHint || raw.headline || raw.title || null,
      reportedPublishedAt: null,
      reportedFirstShownAt: raw.startedAt instanceof Date ? raw.startedAt.toISOString() : raw.startedAt || null,
      reportedLastShownAt: raw.lastSeenAt instanceof Date ? raw.lastSeenAt.toISOString() : raw.lastSeenAt || null,
      observedAt: raw.observedAt || new Date().toISOString(),
      requestedMarket: raw.requestedMarket || "US",
      verifiedDeliveryMarket: raw.verifiedDeliveryMarket || "US",
      title: raw.title ?? raw.headline ?? null,
      description: raw.description ?? raw.bodyText ?? null,
      metrics: raw.metrics || {},
      media: raw.media || {
        thumbnailUrl: raw.thumbnailUrl || null,
        videoUrl: raw.videoUrl || null,
        mediaType: raw.mediaType || null,
      },
      provenance:
        raw.provenance === "CACHED_SOURCE" ||
        raw.sourceType === "CACHE" ||
        raw.sourceType === "CACHED" ||
        raw.sourceType === "CACHE_ONLY" ||
        raw.isCached === true ||
        raw.fromCache === true ||
        raw.isLiveRecord === false
          ? "CACHED_SOURCE"
          : raw.provenance || "LIVE_PROVIDER",
      evidenceReference: raw.evidenceReference || `Ad:${raw.id || "raw"}`,
    } as SourceObservation;
  });

  const candidateMap = new Map<
    string,
    {
      key: string;
      titles: string[];
      descriptions: string[];
      requestedUrl: string | null;
      canonicalUrl: string | null;
      normalizedBaseUrl: string | null;
      variantId: string | null;
      storeDomain: string | null;
      advertisers: Set<string>;
      thumbnails: string[];
      videos: string[];
      adIds: string[];
      sources: Set<string>;
      observations: SourceObservation[];
      earliest: string | null;
      latest: string | null;
      confidence: ProductMatchConfidence;
    }
  >();

  for (const obs of observations) {
    let rawDestUrl =
      obs.landingPageUrl ||
      (obs.sourceUrl &&
      !obs.sourceUrl.includes("facebook.com/ads/library") &&
      !obs.sourceUrl.includes("tiktok.com")
        ? obs.sourceUrl
        : null);
    if (!rawDestUrl && obs.description) {
      const urlMatch = obs.description.match(/https?:\/\/[^\s"'<>]+/i);
      if (urlMatch) {
        rawDestUrl = urlMatch[0];
      }
    }
    const urlMeta = extractProductUrlMetadata(rawDestUrl);

    const canonicalUrl: string | null =
      urlMeta.normalizedBaseProductUrl || urlMeta.cleanCanonicalUrl || null;
    const rawDomainCandidate: string | null =
      urlMeta.storeDomain ||
      obs.storeDomainEvidence ||
      obs.advertiserDomain ||
      null;
    const cleanDomainCandidate = rawDomainCandidate
      ? rawDomainCandidate.toLowerCase().replace(/^www\./, "")
      : null;
    const storeDomain: string | null =
      cleanDomainCandidate &&
      !NON_MERCHANT_PLATFORM_DOMAINS.has(cleanDomainCandidate)
        ? cleanDomainCandidate
        : null;
    let groupKey: string;

    if (urlMeta.isShopifyProductUrl && urlMeta.productHandle) {
      groupKey = `shopify::${storeDomain || "store"}::${urlMeta.productHandle.toLowerCase()}`;
    } else if (urlMeta.isValidEcommerceUrl && canonicalUrl) {
      groupKey = `url::${canonicalUrl.toLowerCase()}`;
    } else if (storeDomain && obs.title && obs.title.trim().length > 3) {
      const cleanTitle = cleanCandidateTitle(obs.title);
      if (cleanTitle.length > 3) {
        groupKey = `domain::${storeDomain.toLowerCase()}::${cleanTitle.toLowerCase()}`;
      } else {
        groupKey = `ad::${obs.source}::${obs.sourceRecordId || Math.abs(hashCode(obs.title))}`;
      }
    } else if (
      obs.advertiserOrCreator &&
      obs.title &&
      obs.title.trim().length > 3
    ) {
      const cleanTitle = cleanCandidateTitle(obs.title);
      if (cleanTitle.length > 3) {
        groupKey = `advertiser::${obs.advertiserOrCreator.toLowerCase()}::${cleanTitle.toLowerCase()}`;
      } else {
        groupKey = `ad::${obs.source}::${obs.sourceRecordId || Math.abs(hashCode(obs.title))}`;
      }
    } else if (obs.sourceRecordId) {
      groupKey = `unidentified::${obs.source}::${obs.sourceRecordId}`;
    } else {
      const rawTitle = obs.title ? cleanCandidateTitle(obs.title) : "";
      const seed = rawTitle || obs.description?.slice(0, 30) || topic;
      groupKey = `creative::${Math.abs(hashCode(seed + "_" + (obs.sourceUrl || "")))}`;
    }

    let candidate = candidateMap.get(groupKey);
    if (!candidate) {
      candidate = {
        key: groupKey,
        titles: [],
        descriptions: [],
        requestedUrl: rawDestUrl || null,
        canonicalUrl,
        normalizedBaseUrl: urlMeta.normalizedBaseProductUrl || canonicalUrl,
        variantId: urlMeta.variantId || null,
        storeDomain,
        advertisers: new Set<string>(),
        thumbnails: [],
        videos: [],
        adIds: [],
        sources: new Set<string>(),
        observations: [],
        earliest: null,
        latest: null,
        confidence: urlMeta.isShopifyProductUrl
          ? "HIGH_CONFIDENCE"
          : storeDomain
          ? "PROBABLE"
          : "AMBIGUOUS",
      };
      candidateMap.set(groupKey, candidate);
    }

    if (obs.title) candidate.titles.push(obs.title);
    const desc = obs.description || obs.observedContent;
    if (desc) candidate.descriptions.push(desc);
    if (obs.advertiserOrCreator) {
      candidate.advertisers.add(obs.advertiserOrCreator);
    }
    if (obs.media?.thumbnailUrl) {
      candidate.thumbnails.push(obs.media.thumbnailUrl);
    }
    if (obs.media?.videoUrl) {
      candidate.videos.push(obs.media.videoUrl);
    }
    if (obs.sourceRecordId) candidate.adIds.push(obs.sourceRecordId);
    candidate.sources.add(obs.source);
    const isDuplicateObs = candidate.observations.some((existing) => {
      if (
        existing.sourceRecordId &&
        obs.sourceRecordId &&
        existing.sourceRecordId === obs.sourceRecordId
      ) {
        return true;
      }
      if (
        existing.sourceExternalAdId &&
        obs.sourceExternalAdId &&
        existing.sourceExternalAdId === obs.sourceExternalAdId
      ) {
        return true;
      }
      return false;
    });
    if (!isDuplicateObs) {
      candidate.observations.push(obs);
    }

    const obsDate =
      obs.observedAt || obs.reportedLastShownAt || obs.reportedFirstShownAt;
    if (obsDate) {
      if (
        !candidate.earliest ||
        new Date(obsDate) < new Date(candidate.earliest)
      ) {
        candidate.earliest = obsDate;
      }
      if (!candidate.latest || new Date(obsDate) > new Date(candidate.latest)) {
        candidate.latest = obsDate;
      }
    }
  }

  const rawCandidates: DiscoveredProductCandidate[] = [];

  for (const [key, c] of candidateMap.entries()) {
    const repObs =
      c.observations.find((o) => o.media?.thumbnailUrl) || c.observations[0];
    const sourceRef = repObs
      ? `${repObs.source === "META_ADS" ? "Facebook Ad" : repObs.source} #${
          repObs.sourceExternalAdId || repObs.sourceRecordId
        }`
      : undefined;

    const resolvedIdentity = resolveProductIdentity({
      landingPageUrl: c.canonicalUrl,
      storeDomain: c.storeDomain,
      brandOrAdvertiser: Array.from(c.advertisers)[0] || null,
      rawHeadlines: c.titles,
      rawDescriptions: c.descriptions,
      sourceReference: sourceRef,
    });

    const candidateContext = [
      resolvedIdentity.displayTitle,
      resolvedIdentity.canonicalName || "",
      c.canonicalUrl || "",
      ...c.titles,
      ...c.descriptions,
    ]
      .filter(Boolean)
      .join(" ");

    const matchedQueryIds = Array.from(
      new Set(
        c.observations
          .flatMap((o: any) => [
            (o.metrics as any)?.queryId,
            o.queryId,
            ...(Array.isArray(o.matchedQueryIds) ? o.matchedQueryIds : []),
          ])
          .filter((qid): qid is string => typeof qid === "string" && qid.length > 0)
      )
    );
    const supportingExternalAdIds = Array.from(
      new Set(
        c.observations
          .map((o) => o.sourceExternalAdId || o.sourceRecordId)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    );
    const matchedQueryPhrase =
      c.observations
        .map((o: any) => (o.metrics as any)?.queryKeyword || o.queryKeyword)
        .find((kw): kw is string => typeof kw === "string" && kw.length > 0) ||
      null;

    const relevance = evaluateProductRelevance(candidateContext, topic, {
      plannedArchetypes: options?.plannedArchetypes,
      matchedQueryPhrase,
    });
    const problemStatement = inferProblemStatement(
      c.titles[0] || null,
      c.descriptions[0] || null
    );

    const psychProfile = analyzeCustomerPsychology({
      candidateTitle: resolvedIdentity.displayName || resolvedIdentity.displayTitle,
      categoryOrTopic: topic,
      rawHeadlines: c.titles,
      rawDescriptions: c.descriptions,
      landingPageUrl: c.canonicalUrl,
      advertiserName: Array.from(c.advertisers)[0] || null,
      sourceReference: sourceRef,
    });

    const chosenThumbnail =
      repObs?.media?.thumbnailUrl || c.thumbnails[0] || null;
    const chosenVideo = repObs?.media?.videoUrl || c.videos[0] || null;
    const mediaSourceAdId =
      repObs?.sourceRecordId || repObs?.sourceExternalAdId || null;

    const pageClass = classifySourcePage(
      c.canonicalUrl,
      c.storeDomain ? "SHOPIFY_STORE" : "UNKNOWN",
      candidateContext
    );
    const hasMalformedProductSlug = Boolean(
      c.canonicalUrl &&
        /\/products\/(?:null|undefined|nan|none|placeholder)(?:[-_]\d+)?(?:\/|$|\?)/i.test(
          c.canonicalUrl
        )
    );
    let effectiveIdentityStatus = resolvedIdentity.identityStatus;
    if (
      (pageClass === "COLLECTION_PAGE" || hasMalformedProductSlug) &&
      effectiveIdentityStatus === "VERIFIED" &&
      !resolvedIdentity.sku
    ) {
      effectiveIdentityStatus = "PROBABLE";
    }
    if (
      pageClass === "ARTICLE_PAGE" ||
      pageClass === "SERVICE_PAGE" ||
      pageClass === "INSURANCE_PAGE" ||
      pageClass === "LEAD_GENERATION_PAGE" ||
      pageClass === "CAMPAIGN_PAGE"
    ) {
      effectiveIdentityStatus = "UNRESOLVED";
    }

    const candObj: DiscoveredProductCandidate = {
      candidateId: `cand_${Math.abs(hashCode(key))}`,
      title: resolvedIdentity.displayTitle,
      canonicalProductName: resolvedIdentity.canonicalProductName,
      displayName: resolvedIdentity.displayName,
      originalAdHeadline:
        resolvedIdentity.originalAdHeadline || c.titles[0] || null,
      originalCreativeCode: resolvedIdentity.originalCreativeCode,
      adClaimedProductName: resolvedIdentity.adClaimedProductName || null,
      merchantVerifiedProductName:
        resolvedIdentity.merchantVerifiedProductName || null,
      brand: resolvedIdentity.brand,
      model: resolvedIdentity.model,
      sku: resolvedIdentity.sku,
      gtin: resolvedIdentity.gtin || null,
      merchantProductId: resolvedIdentity.merchantProductId || null,
      variantId: resolvedIdentity.variantId || c.variantId || null,
      category: topic,
      problemStatement,
      targetAudience: "Homeowners, Pet Owners & Everyday Problem Solvers",
      thumbnailUrl: chosenThumbnail,
      videoUrl: chosenVideo,
      mediaSourceAdId,
      requestedUrl: resolvedIdentity.requestedUrl || c.requestedUrl || null,
      resolvedFinalUrl: resolvedIdentity.resolvedFinalUrl || null,
      declaredCanonicalUrl: resolvedIdentity.declaredCanonicalUrl || null,
      normalizedProductUrl:
        resolvedIdentity.normalizedProductUrl || c.normalizedBaseUrl || null,
      canonicalProductUrl: c.canonicalUrl,
      storeDomain: resolvedIdentity.storeDomain || c.storeDomain,
      imageReferences: resolvedIdentity.imageReferences || [],
      advertiserNames: Array.from(c.advertisers),
      supportingAdIds: Array.from(new Set(c.adIds)),
      supportingExternalAdIds,
      supportingSourceTypes: Array.from(c.sources),
      totalObservationCount: Math.max(c.observations.length, c.observations.reduce((sum, o) => sum + (Number((o.metrics as any)?.observationsCount) || 1), 0)),
      liveObservationsCount: c.observations.filter((o) => isLiveProviderObservation(o)).length,
      cachedObservationsCount:
        c.observations.length -
        c.observations.filter((o) => isLiveProviderObservation(o)).length,
      distinctAdvertisersCount: c.advertisers.size,
      earliestObservationDate: c.earliest,
      latestObservationDate: c.latest,
      identityConfidence:
        effectiveIdentityStatus === "VERIFIED"
          ? "EXACT"
          : effectiveIdentityStatus === "PROBABLE"
          ? "HIGH_CONFIDENCE"
          : "AMBIGUOUS",
      sourceObservations: c.observations,
      identityStatus: effectiveIdentityStatus,
      resolutionSource: resolvedIdentity.resolutionSource,
      requiresManualReview:
        resolvedIdentity.requiresManualReview ||
        pageClass === "COLLECTION_PAGE",
      identityEvidenceReferences: resolvedIdentity.identityEvidenceReferences,
      fetchOutcome: resolvedIdentity.fetchOutcome || "NOT_ATTEMPTED",
      evidenceTimestamp: resolvedIdentity.evidenceTimestamp,
      verificationReason: resolvedIdentity.verificationReason,
      verificationLimitations: resolvedIdentity.verificationLimitations || [],
      contradictions: resolvedIdentity.contradictions || [],
      hasUnresolvedContradiction:
        resolvedIdentity.hasUnresolvedContradiction || false,
      isEligibleAsEvergreenWinner:
        effectiveIdentityStatus === "VERIFIED" &&
        resolvedIdentity.isEligibleAsEvergreenWinner &&
        relevance.isAccepted &&
        relevance.relevanceStatus !== "IRRELEVANT",
      relevanceStatus: relevance.relevanceStatus,
      discoveryRelevanceDecision: relevance.discoveryDecision,
      matchedArchetypeId: relevance.matchedArchetypeId ?? null,
      matchedQueryIds,
      relevanceScore: relevance.score,
      relevanceReasons: relevance.reasons,
      audienceRelevance: relevance.audienceRelevance,
      psychologyProfile: psychProfile,
      sourcePageClassification: pageClass,
    };

    attachDistinctnessFingerprint(candObj);

    const realityEval = evaluateCandidateProductReality(candObj);
    candObj.productRealityStatus = realityEval.status;
    candObj.sourcePageClassification = realityEval.sourcePageClassification;
    candObj.productRealityReason = realityEval.reason;
    candObj.rejectionDetail = realityEval.rejectionDetail ?? null;
    if (!realityEval.eligibleForShortlist) {
      candObj.isEligibleAsEvergreenWinner = false;
    }

    rawCandidates.push(candObj);
  }

  // Section 5: Consolidate duplicate candidates that share the same actual product
  // (e.g., same canonical URL, same merchantProductId, same GTIN, or same brand+model)
  const clustered = clusterProductCandidates(
    rawCandidates,
    mergeDuplicateCandidateRecords
  );

  return clustered.consolidatedCandidates;
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

export interface DistinctnessEvaluation {
  isDistinct: boolean;
  isFamilyDiverse?: boolean;
  totalCandidatesEvaluated: number;
  distinctCount: number;
  distinctProductCount?: number;
  distinctFamilyCount?: number;
  distinctListingCount?: number;
  independentOpportunityCount?: number;
  homogeneousFamilyDetected?: boolean;
  dominantFamilyKey?: string | null;
  dominantFamilyLabel?: string | null;
  duplicateGroupsCount: number;
  uncertainties?: string[];
  pairwiseDecisions?: PairwiseIdentityComparison[];
  details: Array<{
    candidateId: string;
    title: string;
    canonicalKey: string;
    listingKey?: string;
    productKey?: string;
    variantKey?: string | null;
    familyKey?: string;
    familyLabel?: string;
    storeDomain: string | null;
    isDuplicate: boolean;
    duplicateOf?: string;
    decision?: string;
    reason?: string;
  }>;
}

export interface ResearchShortlistResult {
  shortlist: DiscoveredProductCandidate[];
  requestedCount: number;
  qualifiedCount: number;
  distinctFamiliesCount?: number;
  shortfallReason: string | null;
  distinctnessSummary: string;
  distinctnessEvaluation: DistinctnessEvaluation;
  opportunityDiversity?: OpportunityDiversityEvaluation;
  /** V12.4.3.3.1 G16: Number of shortlist candidates with identityStatus === "VERIFIED" AND
   *  liveObservationsCount > 0 (i.e. backed by a current-run live source record, not cache-only). */
  liveVerifiedProductCount: number;
  /** V12.4.3.3.1 G16: true only when all `limit` candidates satisfy VERIFIED + live-grounded criteria. */
  liveVerifiedTop3: boolean;
}

/**
 * Evaluates distinctness across product candidates using the unified 6-level Product Distinctness Engine (Section 5, F01, F07).
 * Never relies on display title alone: two candidates with the same canonical URL, merchant product ID, GTIN,
 * or brand+model are always flagged as duplicates even when their ad titles differ completely.
 */
export function evaluateShortlistDistinctness(
  candidates: DiscoveredProductCandidate[],
  options?: {
    nicheIntent?:
      | "BROAD_CATEGORY"
      | "SPECIFIC_PRODUCT"
      | "FUNCTIONAL_NEED"
      | "AMBIGUOUS"
      | "UNSUPPORTED"
      | string;
    topic?: string;
  }
): DistinctnessEvaluation {
  const diversity = evaluateOpportunityDiversity(candidates, options);
  const details: DistinctnessEvaluation["details"] = [];
  let duplicateCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const fp = buildProductIdentityFingerprint(c);
    let isDuplicate = false;
    let duplicateOf: string | undefined;
    let duplicateDecision: string | undefined;
    let duplicateReason: string | undefined;

    for (let j = 0; j < i; j++) {
      const comp = compareProductIdentity(candidates[j], c);
      if (comp.areSameActualProduct === true) {
        isDuplicate = true;
        duplicateOf = candidates[j].candidateId;
        duplicateDecision = comp.decision;
        duplicateReason = comp.reason;
        break;
      }
    }

    if (isDuplicate) {
      duplicateCount++;
    }

    details.push({
      candidateId: c.candidateId,
      title: c.title,
      canonicalKey: duplicateOf
        ? buildProductIdentityFingerprint(
            candidates.find((x) => x.candidateId === duplicateOf) || c
          ).productKey
        : fp.productKey,
      listingKey: fp.listingKey,
      productKey: fp.productKey,
      variantKey: fp.variantKey,
      familyKey: fp.familyKey,
      familyLabel: fp.familyLabel,
      storeDomain: c.storeDomain,
      isDuplicate,
      duplicateOf,
      decision: duplicateDecision,
      reason: duplicateReason,
    });
  }

  const distinctCount = candidates.length - duplicateCount;
  return {
    isDistinct: duplicateCount === 0 && diversity.isDistinct,
    isFamilyDiverse: diversity.isFamilyDiverse,
    totalCandidatesEvaluated: candidates.length,
    distinctCount,
    distinctProductCount: diversity.distinctProductCount,
    distinctFamilyCount: diversity.distinctFamilyCount,
    distinctListingCount: diversity.distinctListingCount,
    independentOpportunityCount: diversity.independentOpportunityCount,
    homogeneousFamilyDetected: diversity.homogeneousFamilyDetected,
    dominantFamilyKey: diversity.dominantFamilyKey,
    dominantFamilyLabel: diversity.dominantFamilyLabel,
    duplicateGroupsCount: duplicateCount,
    uncertainties: diversity.uncertainties,
    pairwiseDecisions: diversity.pairwiseDecisions,
    details,
  };
}

export interface ProductRealityGateEvaluation {
  status: ProductRealityStatus;
  productRealityStatus: ProductRealityStatus;
  sourcePageClassification: SourcePageClassification;
  eligibleForShortlist: boolean;
  isPhysicalProductRealityEligible: boolean;
  reason: string | null;
  rejectionDetail?: CandidateRejectionDetail | null;
  rejectionReasons: string[];
  conditions: {
    correctNiche: boolean;
    physicalProductSupported: boolean;
    productIdentityDefensible: boolean;
    sourceEvidenceAvailable: boolean;
    merchantEvidenceSufficient: boolean;
    notServiceArticleInsuranceLeadGen: boolean;
    notCampaignTitle: boolean;
    noUnresolvedContradiction: boolean;
  };
}

/**
 * Evaluates a candidate against the mandatory Product Reality Gate (Section 4 & Section 6).
 * Operates deterministically even when Gemini is unavailable, timed out, or faulted.
 */
export function evaluateCandidateProductReality(
  c: DiscoveredProductCandidate
): ProductRealityGateEvaluation {
  const headlines = [
    c.originalAdHeadline || "",
    ...(c.sourceObservations || []).map((o) => o.title || ""),
  ].filter(Boolean);
  const descriptions = [
    c.problemStatement || "",
    ...(c.sourceObservations || []).map(
      (o) => o.description || o.observedContent || ""
    ),
  ].filter(Boolean);
  const landingUrls = (c.sourceObservations || [])
    .map((o) => o.landingPageUrl || o.sourceUrl || "")
    .filter(Boolean);

  const deterministic = evaluateDeterministicEntityReality({
    title: c.canonicalProductName || c.displayName || c.title,
    headlines,
    descriptions,
    canonicalUrl: c.canonicalProductUrl,
    landingUrls,
    pageTypeHint:
      c.sourcePageClassification === "ACTUAL_PRODUCT_PAGE"
        ? "ACTUAL_PRODUCT_PAGE"
        : c.storeDomain
        ? "SHOPIFY_STORE"
        : "UNKNOWN",
  });

  let sourcePageClassification: SourcePageClassification =
    c.sourcePageClassification || deterministic.sourcePageClassification;

  if (c.fetchOutcome === "COLLECTION_PAGE") {
    sourcePageClassification = "COLLECTION_PAGE";
  } else if (c.fetchOutcome === "HOMEPAGE") {
    sourcePageClassification = "CAMPAIGN_PAGE";
  } else if (c.fetchOutcome === "NON_PRODUCT_PAGE") {
    sourcePageClassification = "ARTICLE_PAGE";
  }

  // Condition 1: Correct niche & target customer audience compatibility
  const correctNiche =
    (c.relevanceStatus === "RELEVANT" ||
      c.relevanceStatus === "PROBABLY_RELEVANT") &&
    c.audienceRelevance?.eligibleForPrimaryShortlist !== false &&
    (!c.aiIntelligence ||
      (c.aiIntelligence.nicheRelevance !== "UNRELATED" &&
        c.aiIntelligence.nicheRelevance !== "LOW"));

  // Condition 6: Not a service, article, insurance or lead-generation offer
  const aiEntity = c.aiIntelligence?.commercialEntityType;
  const aiSaysNonPhysical =
    (Boolean(aiEntity) && aiEntity !== "PHYSICAL_PRODUCT") ||
    c.aiIntelligence?.isLikelySellableProduct === false;
  const notServiceArticleInsuranceLeadGen =
    !deterministic.isNonPhysical &&
    !aiSaysNonPhysical &&
    c.fetchOutcome !== "NON_PRODUCT_PAGE" &&
    sourcePageClassification !== "ARTICLE_PAGE";

  // Condition 7: Not a campaign title masquerading as a product
  const notCampaignTitle =
    sourcePageClassification !== "CAMPAIGN_PAGE" &&
    c.fetchOutcome !== "HOMEPAGE" &&
    deterministic.detectedEntityType !== "ADVERTISING_CAMPAIGN";

  // Condition 3: Product identity defensible
  const productIdentityDefensible =
    c.identityStatus !== "UNRESOLVED" &&
    c.identityStatus !== "AMBIGUOUS" &&
    Boolean(c.canonicalProductName || c.displayName || c.title) &&
    notCampaignTitle;

  // Condition 4: Original advertising/source evidence available
  const sourceEvidenceAvailable =
    Boolean(c.supportingAdIds && c.supportingAdIds.length > 0) ||
    Boolean(c.sourceObservations && c.sourceObservations.length > 0);

  // Condition 5: Merchant/product evidence sufficient (HTTP_404 dead page is not sufficient)
  const merchantEvidenceSufficient =
    c.fetchOutcome !== "HTTP_404" &&
    (Boolean(c.storeDomain) ||
      Boolean(c.canonicalProductUrl) ||
      (c.identityStatus === "VERIFIED" && c.identityConfidence === "EXACT"));

  // Condition 2: Physical ecommerce product supported
  const aiConfirmedPhysical =
    c.aiIntelligence?.commercialEntityType === "PHYSICAL_PRODUCT" &&
    c.aiIntelligence?.isLikelySellableProduct === true &&
    c.aiShortlistEligible === true;
  const deterministicPhysicalSupported =
    !deterministic.isNonPhysical &&
    (deterministic.hasPhysicalProductIndicators ||
      sourcePageClassification === "ACTUAL_PRODUCT_PAGE" ||
      c.identityStatus === "VERIFIED");

  const physicalProductSupported =
    notServiceArticleInsuranceLeadGen &&
    merchantEvidenceSufficient &&
    (aiConfirmedPhysical ||
      (c.aiShortlistEligible !== false && deterministicPhysicalSupported));

  // Condition 9: No unresolved evidence contradiction (includes Section 4.7 ad vs merchant contradiction)
  const ver = c.aiVerification;
  const hasVerifierViolation =
    Boolean(ver) &&
    (!ver.correctCandidateId ||
      !ver.validSourceReferences ||
      !ver.accurateQuotations ||
      !ver.productIdentityConsistent ||
      ver.promptInjectionDetected ||
      (Array.isArray(ver.contradictions) && ver.contradictions.length > 0));
  const hasMerchantContradiction =
    c.hasUnresolvedContradiction === true ||
    c.fetchOutcome === "CONTRADICTORY_METADATA" ||
    (Array.isArray(c.contradictions) && c.contradictions.length > 0);
  const noUnresolvedContradiction =
    !hasVerifierViolation &&
    !hasMerchantContradiction &&
    c.aiShortlistEligible !== false;

  const conditions = {
    correctNiche,
    physicalProductSupported,
    productIdentityDefensible,
    sourceEvidenceAvailable,
    merchantEvidenceSufficient,
    notServiceArticleInsuranceLeadGen,
    notCampaignTitle,
    noUnresolvedContradiction,
  };

  const evidenceRefs = Array.from(
    new Set(
      [
        ...(c.identityEvidenceReferences || []),
        ...(c.supportingAdIds || []).map((id) => `Ad:${id}`),
        c.canonicalProductUrl ? `URL:${c.canonicalProductUrl}` : null,
      ].filter((r): r is string => Boolean(r))
    )
  );
  const resolvedDetectedEntity =
    aiEntity && aiEntity !== "PHYSICAL_PRODUCT"
      ? aiEntity
      : c.fetchOutcome === "NON_PRODUCT_PAGE" || sourcePageClassification === "ARTICLE_PAGE"
      ? "CONTENT_ARTICLE"
      : deterministic.isNonPhysical
      ? deterministic.detectedEntityType || "NON_PHYSICAL"
      : aiEntity || deterministic.detectedEntityType || "PHYSICAL_PRODUCT";

  const buildGateResult = (
    status: ProductRealityStatus,
    eligibleForShortlist: boolean,
    reason: string | null,
    reasonCode?: CandidateRejectionReasonCode
  ): ProductRealityGateEvaluation => ({
    status,
    productRealityStatus: status,
    sourcePageClassification,
    eligibleForShortlist,
    isPhysicalProductRealityEligible: eligibleForShortlist,
    reason,
    rejectionDetail:
      reason && reasonCode
        ? {
            reasonCode,
            reasonText: reason,
            evidenceReferences: evidenceRefs,
            detectedEntityType: resolvedDetectedEntity,
          }
        : null,
    rejectionReasons: reason ? [reason] : [],
    conditions,
  });

  if (!notServiceArticleInsuranceLeadGen) {
    // V12.4.3.2 Section 8: Never produce contradictory "Classified as non-physical entity (PHYSICAL_PRODUCT)"
    const isArticlePage =
      c.fetchOutcome === "NON_PRODUCT_PAGE" ||
      sourcePageClassification === "ARTICLE_PAGE" ||
      resolvedDetectedEntity === "CONTENT_ARTICLE";
    const isInsuranceOrLeadGen =
      resolvedDetectedEntity === "INSURANCE_OR_FINANCE" ||
      resolvedDetectedEntity === "LEAD_GENERATION";
    const isPhysicalRejectedBySellability =
      resolvedDetectedEntity === "PHYSICAL_PRODUCT" &&
      c.aiIntelligence?.isLikelySellableProduct === false;

    const code: CandidateRejectionReasonCode = isArticlePage
      ? "NON_PHYSICAL_CONTENT_ARTICLE"
      : isInsuranceOrLeadGen
      ? "NON_PHYSICAL_LEAD_GEN_OR_INSURANCE"
      : isPhysicalRejectedBySellability
      ? "NOT_SELLABLE_PRODUCT_OFFER"
      : "NON_PHYSICAL_SERVICE";

    const cleanReason =
      c.aiExclusionReason && !/non-physical entity \(PHYSICAL_PRODUCT\)/i.test(c.aiExclusionReason)
        ? c.aiExclusionReason
        : deterministic.reason && !/non-physical entity \(PHYSICAL_PRODUCT\)/i.test(deterministic.reason)
        ? deterministic.reason
        : isArticlePage
        ? "Excluded — Destination is a blog article or editorial page rather than a purchasable product."
        : isInsuranceOrLeadGen
        ? "Excluded — Offer is an insurance policy or lead-generation funnel rather than a physical product."
        : isPhysicalRejectedBySellability
        ? "Excluded — Offer lacks a verifiable sellable physical SKU on the destination page."
        : `Excluded — Classified as non-physical service or informational offer (${
            resolvedDetectedEntity === "PHYSICAL_PRODUCT" ? "SERVICE_OFFER" : resolvedDetectedEntity
          }).`;

    return buildGateResult(
      isPhysicalRejectedBySellability ? "REJECTED" : "NON_PHYSICAL",
      false,
      cleanReason,
      code
    );
  }

  if (!notCampaignTitle) {
    return buildGateResult(
      "REJECTED",
      false,
      c.fetchOutcome === "HOMEPAGE"
        ? "Excluded — Destination URL redirected or resolved to a generic store homepage rather than a product page."
        : deterministic.reason ||
            "Excluded — Campaign code or promotional slogan rather than a specific product.",
      "CAMPAIGN_HEADLINE_OR_HOMEPAGE"
    );
  }

  if (!correctNiche) {
    const isAudienceMismatch = c.audienceRelevance?.eligibleForPrimaryShortlist === false;
    return buildGateResult(
      "REJECTED",
      false,
      isAudienceMismatch
        ? c.audienceRelevance!.relevanceReason
        : c.aiExclusionReason ||
          (c.relevanceReasons && c.relevanceReasons[0]) ||
          "Excluded — Candidate does not match the searched product niche.",
      isAudienceMismatch ? "TARGET_AUDIENCE_MISMATCH" : "NICHE_RELEVANCE_MISMATCH"
    );
  }

  if (!noUnresolvedContradiction) {
    return buildGateResult(
      "UNRESOLVED",
      false,
      (c.contradictions && c.contradictions[0]) ||
        c.aiExclusionReason ||
        "Excluded — Unresolved contradiction between ad claim and merchant page or unverified source reference.",
      "EVIDENCE_CONTRADICTION"
    );
  }

  if (
    !productIdentityDefensible ||
    !sourceEvidenceAvailable ||
    !merchantEvidenceSufficient ||
    !physicalProductSupported
  ) {
    const code: CandidateRejectionReasonCode =
      c.fetchOutcome === "HTTP_404"
        ? "DEAD_MERCHANT_URL_404"
        : !merchantEvidenceSufficient
        ? "MISSING_MERCHANT_EVIDENCE"
        : "UNRESOLVED_PRODUCT_IDENTITY";
    return buildGateResult(
      "UNRESOLVED",
      false,
      c.fetchOutcome === "HTTP_404"
        ? "Excluded — Merchant landing page returned HTTP 404 (dead product link)."
        : !merchantEvidenceSufficient
        ? "Excluded — Lacks verified merchant domain or product landing URL evidence."
        : !productIdentityDefensible
        ? "Excluded — Product identity is unresolved."
        : !sourceEvidenceAvailable
        ? "Excluded — Lacks supporting source advertisement evidence."
        : "Excluded — Insufficient physical product evidence.",
      code
    );
  }

  // Section 4.1–4.4: Only mark VERIFIED_PHYSICAL_PRODUCT when identityStatus === "VERIFIED"
  // AND the destination is a verified actual product page (not a collection page or unverified URL slug).
  const hasMalformedUrlSlug = Boolean(
    c.canonicalProductUrl &&
      /\/products\/(?:null|undefined|nan|none|placeholder)(?:[-_]\d+)?(?:\/|$|\?)/i.test(
        c.canonicalProductUrl
      )
  );
  if (hasMalformedUrlSlug && c.identityStatus === "VERIFIED" && !c.sku) {
    c.identityStatus = "PROBABLE";
  }
  const isVerifiedSkuPage =
    c.identityStatus === "VERIFIED" &&
    !hasMalformedUrlSlug &&
    sourcePageClassification === "ACTUAL_PRODUCT_PAGE" &&
    c.fetchOutcome !== "COLLECTION_PAGE" &&
    c.fetchOutcome !== "HOMEPAGE";

  return buildGateResult(
    isVerifiedSkuPage
      ? "VERIFIED_PHYSICAL_PRODUCT"
      : "EVIDENCE_SUPPORTED_PHYSICAL_PRODUCT",
    true,
    null
  );
}

function inferNicheIntentFromTopic(
  topic?: string
): "BROAD_CATEGORY" | "SPECIFIC_PRODUCT" {
  if (!topic) return "BROAD_CATEGORY";
  const lower = topic.trim().toLowerCase();
  const broadTopics = new Set([
    "pet",
    "pets",
    "pet gadgets",
    "pet toys",
    "dog toys",
    "cat toys",
    "dog gadgets",
    "cat gadgets",
    "pet supplies",
    "pet accessories",
    "diy",
    "diy tools",
    "home improvement",
    "kitchen",
    "kitchen gadgets",
    "kitchen tools",
    "home decor",
    "decor",
    "gardening",
    "garden",
    "garden tools",
    "cleaning",
    "cleaning gadgets",
    "home cleaning gadgets",
    "cleaning tools",
    "car accessories",
  ]);
  if (broadTopics.has(lower)) return "BROAD_CATEGORY";
  for (const b of broadTopics) {
    if (lower === b) return "BROAD_CATEGORY";
  }
  const words = lower.split(/\s+/).filter(Boolean);
  if (
    words.length >= 2 &&
    !words.some((w) =>
      ["gadgets", "tools", "supplies", "accessories", "products", "items", "decor", "toys"].includes(w)
    )
  ) {
    return "SPECIFIC_PRODUCT";
  }
  return "BROAD_CATEGORY";
}

/**
 * Selects up to `limit` (default 3) distinct, genuine, niche-relevant products for human evaluation.
 * Enforces:
 * - Mandatory Product Reality Gate
 * - Unified 6-level Product Distinctness (deduplicating identical URLs, merchantProductIds, GTINs, and models)
 * - Section 5.6 Niche-Intent-Aware Opportunity Diversity:
 *   * Broad niche queries prioritize up to 3 distinct product families.
 *   * Specific product queries allow up to 3 distinct models/merchants in the same family when backed by
 *     distinguishing evidence, explicitly labeling them as "Same product family — model/merchant alternative".
 */
export function selectTopResearchShortlist(
  candidates: DiscoveredProductCandidate[],
  limit: number = 3,
  options?: {
    nicheIntent?:
      | "BROAD_CATEGORY"
      | "SPECIFIC_PRODUCT"
      | "FUNCTIONAL_NEED"
      | "AMBIGUOUS"
      | "UNSUPPORTED"
      | string;
    topic?: string;
    allowSameFamilyAlternativesOnShortfall?: boolean;
    allowSameStoreMultipleSlots?: boolean;
    executedQueryIds?: string[] | Set<string>;
  }
): ResearchShortlistResult {
  const executedQSet = options?.executedQueryIds
    ? options.executedQueryIds instanceof Set
      ? options.executedQueryIds
      : new Set(options.executedQueryIds.filter(Boolean))
    : null;

  const isLiveGroundedForCurrentRun = (c: DiscoveredProductCandidate): boolean => {
    const hasLiveObs =
      typeof c.liveObservationsCount === "number"
        ? c.liveObservationsCount > 0
        : (c.sourceObservations || []).some((o) =>
            isLiveProviderObservation(o, executedQSet || undefined)
          );
    if (!hasLiveObs) return false;
    if (executedQSet && executedQSet.size > 0) {
      const qIds = c.matchedQueryIds || [];
      return qIds.some((qid) => executedQSet.has(qid));
    }
    return true;
  };

  // 1. Filter candidates through the mandatory Product Reality Gate
  const realityPassed = candidates.filter((c) => {
    if (!c.audienceRelevance && options?.topic) {
      c.audienceRelevance = evaluateProductAudienceRelevance(c, options.topic);
    }
    attachDistinctnessFingerprint(c);
    const reality = evaluateCandidateProductReality(c);
    c.productRealityStatus = reality.status;
    c.sourcePageClassification = reality.sourcePageClassification;
    c.productRealityReason = reality.reason;
    c.rejectionDetail = reality.rejectionDetail ?? null;
    if (
      reality.sourcePageClassification === "COLLECTION_PAGE" &&
      c.identityStatus === "VERIFIED" &&
      !c.sku
    ) {
      c.identityStatus = "PROBABLE";
    }
    return (
      reality.eligibleForShortlist &&
      (reality.status === "VERIFIED_PHYSICAL_PRODUCT" ||
        reality.status === "EVIDENCE_SUPPORTED_PHYSICAL_PRODUCT")
    );
  });

  // 2. Sort eligible candidates: when current-run executedQueryIds are provided (G04), prioritize
  //    current-run live-grounded candidates ahead of cache-only fallbacks; within each tier, prefer
  //    VERIFIED identity, higher relevance score, video media, and observation count.
  realityPassed.sort((a, b) => {
    const liveA = isLiveGroundedForCurrentRun(a) ? 1 : 0;
    const liveB = isLiveGroundedForCurrentRun(b) ? 1 : 0;
    if (executedQSet && executedQSet.size > 0 && liveA !== liveB) {
      return liveB - liveA;
    }
    const verA = a.identityStatus === "VERIFIED" ? 1 : 0;
    const verB = b.identityStatus === "VERIFIED" ? 1 : 0;
    if (verA !== verB) return verB - verA;
    if (liveA !== liveB) return liveB - liveA;
    const relDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
    if (relDiff !== 0) return relDiff;
    const vidA = a.videoUrl ? 1 : 0;
    const vidB = b.videoUrl ? 1 : 0;
    if (vidA !== vidB) return vidB - vidA;
    return b.totalObservationCount - a.totalObservationCount;
  });

  // 3. Consolidate actual product duplicates via clusterProductCandidates (F01, B11–B17)
  const clustered = clusterProductCandidates(
    realityPassed,
    mergeDuplicateCandidateRecords
  );
  const uniqueProducts = clustered.consolidatedCandidates;

  const inferredIntent =
    options?.nicheIntent === "SPECIFIC_PRODUCT" ||
    options?.nicheIntent === "BROAD_CATEGORY"
      ? options.nicheIntent
      : inferNicheIntentFromTopic(options?.topic || uniqueProducts[0]?.category);

  // 4. Pass 1: Select primary representatives from DISTINCT product families and DISTINCT stores first (Section 5.6, B20, Section 8.3)
  const distinctShortlist: DiscoveredProductCandidate[] = [];
  const selectedFamilies = new Map<string, DiscoveredProductCandidate>();
  const selectedDomains = new Set<string>();
  const deferredSameFamily: DiscoveredProductCandidate[] = [];
  const deferredSameStoreDistinctFamily: DiscoveredProductCandidate[] = [];

  for (const c of uniqueProducts) {
    const fp = buildProductIdentityFingerprint(c);
    attachDistinctnessFingerprint(c);

    // Double-check against already selected candidates that this is not the same actual product
    const duplicateInShortlist = distinctShortlist.find(
      (sel) => compareProductIdentity(sel, c).areSameActualProduct === true
    );
    if (duplicateInShortlist) {
      mergeDuplicateCandidateRecords(
        duplicateInShortlist,
        c,
        compareProductIdentity(duplicateInShortlist, c)
      );
      continue;
    }

    const domainKey = fp.normalizedDomain || null;
    const isSameStoreBlocked =
      options?.allowSameStoreMultipleSlots !== true &&
      domainKey !== null &&
      selectedDomains.has(domainKey);

    const isUnresolvedFamilyForBroad =
      inferredIntent === "BROAD_CATEGORY" &&
      (fp.familyKey === "unresolved_family" ||
        fp.familyKey === "UNRESOLVED_FAMILY");

    if (
      !isUnresolvedFamilyForBroad &&
      !selectedFamilies.has(fp.familyKey) &&
      !isSameStoreBlocked
    ) {
      c.distinctnessRole = "PRIMARY_FAMILY_REPRESENTATIVE";
      c.distinctnessReason = `Primary product representative for family '${fp.familyLabel}' (productKey=${fp.productKey}).`;
      c.crossMerchantUncertainty = null;
      selectedFamilies.set(fp.familyKey, c);
      if (domainKey) selectedDomains.add(domainKey);
      distinctShortlist.push(c);
    } else if (
      !isUnresolvedFamilyForBroad &&
      !selectedFamilies.has(fp.familyKey) &&
      isSameStoreBlocked
    ) {
      deferredSameStoreDistinctFamily.push(c);
    } else if (!isUnresolvedFamilyForBroad) {
      deferredSameFamily.push(c);
    }

    if (distinctShortlist.length >= limit) break;
  }

  // Pass 1b: Only if options?.allowSameStoreMultipleSlots === true and we still have fewer than `limit` items, allow distinct families from already-selected stores
  if (
    options?.allowSameStoreMultipleSlots === true &&
    distinctShortlist.length < limit &&
    deferredSameStoreDistinctFamily.length > 0
  ) {
    for (const c of deferredSameStoreDistinctFamily) {
      if (distinctShortlist.length >= limit) break;
      const fp = buildProductIdentityFingerprint(c);
      if (!selectedFamilies.has(fp.familyKey)) {
        c.distinctnessRole = "PRIMARY_FAMILY_REPRESENTATIVE";
        c.distinctnessReason = `Primary product representative for family '${fp.familyLabel}' (productKey=${fp.productKey}).`;
        c.crossMerchantUncertainty = null;
        selectedFamilies.set(fp.familyKey, c);
        distinctShortlist.push(c);
      }
    }
  }

  // 5. Pass 2: If fewer than `limit` distinct families exist, evaluate remaining candidates in the same family
  if (distinctShortlist.length < limit && deferredSameFamily.length > 0) {
    for (const c of deferredSameFamily) {
      if (distinctShortlist.length >= limit) break;
      const fp = buildProductIdentityFingerprint(c);
      const primaryInFamily = selectedFamilies.get(fp.familyKey);
      if (!primaryInFamily) continue;

      const comp = compareProductIdentity(primaryInFamily, c);
      if (comp.areSameActualProduct === true) {
        continue;
      }

      // Section 5.6 & B18 & B19 & V12.4.3.3.1 G12:
      // - If SPECIFIC_PRODUCT query: allow distinct models or brand/capacity alternatives in the same family.
      // - If BROAD_CATEGORY query: only allow a second candidate in the same family if it is an explicitly
      //   differentiated model (comp.decision === "DIFFERENT_MODELS_SAME_FAMILY") AND options?.allowSameFamilyAlternativesOnShortfall === true.
      //   Never allow two same-family products into a broad-niche Top-3 shortlist by default.
      const isExplicitlyDifferentiatedModel =
        comp.decision === "DIFFERENT_MODELS_SAME_FAMILY";
      const allowForSpecificQuery =
        inferredIntent === "SPECIFIC_PRODUCT" &&
        (isExplicitlyDifferentiatedModel ||
          comp.areDistinctOpportunitiesForSpecificQuery);
      const allowForBroadShortfall =
        inferredIntent === "BROAD_CATEGORY" &&
        options?.allowSameFamilyAlternativesOnShortfall === true &&
        isExplicitlyDifferentiatedModel;

      if (allowForSpecificQuery || allowForBroadShortfall) {
        c.distinctnessRole = "SAME_FAMILY_MODEL_ALTERNATIVE";
        c.distinctnessReason = `Same product family — model/merchant alternative (${comp.reason})`;
        c.crossMerchantUncertainty = comp.uncertainty;
        distinctShortlist.push(c);
      }
    }
  }

  const distinctnessEvaluation = evaluateShortlistDistinctness(
    distinctShortlist,
    {
      nicheIntent: inferredIntent,
      topic: options?.topic || uniqueProducts[0]?.category,
    }
  );
  const opportunityDiversity = evaluateOpportunityDiversity(distinctShortlist, {
    nicheIntent: inferredIntent,
    topic: options?.topic || uniqueProducts[0]?.category,
  });

  let shortfallReason: string | null = null;
  if (distinctShortlist.length < limit) {
    const familyConcentrationNote =
      deferredSameFamily.length > 0 && inferredIntent === "BROAD_CATEGORY"
        ? ` (${deferredSameFamily.length} additional candidate(s) belonged to already-selected product family '${
            distinctShortlist[0]?.familyLabel || "same family"
          }' without independent family/model differentiation and were not counted as separate category opportunities.)`
        : "";
    shortfallReason = `Only ${distinctShortlist.length} independently identifiable, niche-relevant product opportunity(s) were supported by available source evidence (requested ${limit}).${familyConcentrationNote}`;
  }

  const distinctnessSummary =
    distinctShortlist.length > 0
      ? `${distinctShortlist.length} distinct product(s) across ${
          opportunityDiversity.distinctFamilyCount
        } product family(s): ${distinctShortlist
          .map(
            (c) =>
              `${c.title}${
                c.distinctnessRole === "SAME_FAMILY_MODEL_ALTERNATIVE"
                  ? " [Same product family — model/merchant alternative]"
                  : ""
              }`
          )
          .join(", ")}`
      : "No distinct products qualified for shortlist";

  const liveVerifiedItems = distinctShortlist.filter((c) =>
    isCandidateLiveVerified(c, executedQSet || undefined)
  );

  return {
    shortlist: distinctShortlist,
    requestedCount: limit,
    qualifiedCount: distinctShortlist.length,
    distinctFamiliesCount: opportunityDiversity.distinctFamilyCount,
    shortfallReason,
    distinctnessSummary,
    distinctnessEvaluation,
    opportunityDiversity,
    // V12.4.3.3.1 G16: Count VERIFIED + live-grounded candidates using positive live provenance checks.
    liveVerifiedProductCount: liveVerifiedItems.length,
    liveVerifiedTop3:
      distinctShortlist.length >= limit &&
      liveVerifiedItems.length === distinctShortlist.length,
  };
}

export interface ProductEnrichmentContext {
  workspaceId?: string;
  topic?: string;
  timeoutMs?: number;
  maxConcurrency?: number;
  signal?: AbortSignal;
  metadataFetcher?: (url: string) => Promise<any>;
  plannedArchetypes?: PlannedProductArchetype[];
}

export interface ProductEnrichmentResult {
  candidates: DiscoveredProductCandidate[];
  enrichedCount: number;
  verifiedCount: number;
  probableCount: number;
  unresolvedCount: number;
  contradictionCount: number;
  errors: string[];
}

/**
 * Asynchronously enriches product candidates with verified merchant landing page evidence.
 * Preserves all Section 4.5 identity fields and deduplicates via Section 5 clusterProductCandidates.
 */
export async function enrichProductCandidatesWithEvidence(
  candidates: DiscoveredProductCandidate[],
  context: ProductEnrichmentContext
): Promise<ProductEnrichmentResult> {
  const maxConcurrency = context.maxConcurrency || 8;
  const timeoutMs = context.timeoutMs || 2500;
  const errors: string[] = [];

  let enrichedCount = 0;
  let verifiedCount = 0;
  let probableCount = 0;
  let unresolvedCount = 0;
  let contradictionCount = 0;

  const enrichedList: DiscoveredProductCandidate[] = [];

  for (let i = 0; i < candidates.length; i += maxConcurrency) {
    if (context.signal?.aborted) break;

    const chunk = candidates.slice(i, i + maxConcurrency);
    await Promise.all(
      chunk.map(async (candidate) => {
        try {
          if (!candidate.canonicalProductUrl) {
            attachDistinctnessFingerprint(candidate);
            if (candidate.identityStatus === "VERIFIED") verifiedCount++;
            else if (candidate.identityStatus === "PROBABLE") probableCount++;
            else unresolvedCount++;
            enrichedList.push(candidate);
            return;
          }

          const resolved = await resolveProductIdentityWithEvidence(
            {
              landingPageUrl: candidate.canonicalProductUrl,
              storeDomain: candidate.storeDomain,
              brandOrAdvertiser: candidate.advertiserNames[0] || null,
              rawHeadlines: Array.from(
                new Set(
                  [
                    candidate.originalAdHeadline,
                    ...candidate.sourceObservations.map((o) => o.title),
                  ].filter((t): t is string => Boolean(t && t.trim().length > 0))
                )
              ),
              rawDescriptions: candidate.sourceObservations
                .map((o) => o.description || o.observedContent)
                .filter(Boolean) as string[],
              existingResearchProductId: candidate.researchProductId,
              existingProductVerified: Boolean(
                candidate.existingProductVerified
              ),
              sourceReference: candidate.mediaSourceAdId
                ? `Ad #${candidate.mediaSourceAdId}`
                : undefined,
            },
            {
              timeoutMs,
              metadataFetchEnabled: true,
              metadataFetcher: context.metadataFetcher,
            }
          );

          enrichedCount++;
          candidate.title = resolved.displayTitle;
          candidate.canonicalProductName = resolved.canonicalProductName;
          candidate.displayName = resolved.displayName;
          candidate.adClaimedProductName = resolved.adClaimedProductName;
          candidate.merchantVerifiedProductName =
            resolved.merchantVerifiedProductName;
          candidate.brand = resolved.brand;
          candidate.model = resolved.model;
          candidate.sku = resolved.sku;
          candidate.gtin = resolved.gtin;
          candidate.merchantProductId = resolved.merchantProductId;
          candidate.variantId = resolved.variantId || candidate.variantId;
          candidate.requestedUrl =
            resolved.requestedUrl || candidate.requestedUrl;
          candidate.resolvedFinalUrl = resolved.resolvedFinalUrl;
          candidate.declaredCanonicalUrl = resolved.declaredCanonicalUrl;
          candidate.normalizedProductUrl =
            resolved.normalizedProductUrl || candidate.normalizedProductUrl;
          if (resolved.normalizedProductUrl) {
            candidate.canonicalProductUrl = resolved.normalizedProductUrl;
          }
          if (resolved.storeDomain) {
            candidate.storeDomain = resolved.storeDomain;
          }
          if (
            resolved.imageReferences &&
            resolved.imageReferences.length > 0
          ) {
            const normalizedRefs = resolved.imageReferences.map((img) =>
              typeof img === "string"
                ? img.trim().replace(/^http:\/\/([^/]+\/cdn\/shop\/)/i, "https://$1")
                : img
            );
            candidate.imageReferences = normalizedRefs;
            if (candidate.thumbnailUrl && !candidate.adThumbnailUrl) {
              candidate.adThumbnailUrl = candidate.thumbnailUrl;
            }
            if (normalizedRefs[0]) {
              candidate.thumbnailUrl = normalizedRefs[0];
            }
          }
          candidate.fetchOutcome = resolved.fetchOutcome;
          candidate.evidenceTimestamp = resolved.evidenceTimestamp;
          candidate.verificationReason = resolved.verificationReason;
          candidate.verificationLimitations = resolved.verificationLimitations;
          candidate.contradictions = resolved.contradictions;
          candidate.hasUnresolvedContradiction =
            resolved.hasUnresolvedContradiction;

          const urlBasedPageClass = classifySourcePage(
            candidate.canonicalProductUrl
          );
          const effectivePageClass: SourcePageClassification =
            resolved.pageClassification === "COLLECTION_PAGE"
              ? "COLLECTION_PAGE"
              : resolved.pageClassification === "HOMEPAGE"
              ? "CAMPAIGN_PAGE"
              : resolved.pageClassification === "ACTUAL_PRODUCT_PAGE"
              ? "ACTUAL_PRODUCT_PAGE"
              : urlBasedPageClass;

          candidate.sourcePageClassification = effectivePageClass;

          const hasMalformedUrlSlug = Boolean(
            candidate.canonicalProductUrl &&
              /\/products\/(?:null|undefined|nan|none|placeholder)(?:[-_]\d+)?(?:\/|$|\?)/i.test(
                candidate.canonicalProductUrl
              )
          );
          if (
            (effectivePageClass === "COLLECTION_PAGE" || hasMalformedUrlSlug) &&
            resolved.identityStatus === "VERIFIED" &&
            !resolved.sku
          ) {
            candidate.identityStatus = "PROBABLE";
            candidate.identityConfidence = "HIGH_CONFIDENCE";
          } else {
            candidate.identityStatus = resolved.identityStatus;
            candidate.identityConfidence =
              resolved.identityStatus === "VERIFIED"
                ? "EXACT"
                : resolved.identityStatus === "PROBABLE"
                ? "HIGH_CONFIDENCE"
                : "AMBIGUOUS";
          }
          candidate.resolutionSource = resolved.resolutionSource;
          candidate.requiresManualReview = resolved.requiresManualReview;
          candidate.identityEvidenceReferences =
            resolved.identityEvidenceReferences;

          if (
            resolved.hasUnresolvedContradiction ||
            (resolved.identityStatus === "AMBIGUOUS" &&
              resolved.requiresManualReview)
          ) {
            contradictionCount++;
            candidate.isEligibleAsEvergreenWinner = false;
          }

          // Re-evaluate relevance with verified landing page title
          const candidateContext = [
            resolved.displayTitle,
            resolved.canonicalName || "",
            candidate.canonicalProductUrl || "",
            candidate.originalAdHeadline || "",
            ...candidate.sourceObservations
              .map((o) => o.title || o.description || "")
              .slice(0, 3),
          ]
            .filter(Boolean)
            .join(" ");

          const relevance = evaluateProductRelevance(
            candidateContext,
            context.topic || candidate.category || "general",
            {
              plannedArchetypes: context.plannedArchetypes,
            }
          );
          candidate.relevanceStatus = relevance.relevanceStatus;
          candidate.discoveryRelevanceDecision = relevance.discoveryDecision;
          candidate.matchedArchetypeId =
            relevance.matchedArchetypeId ?? candidate.matchedArchetypeId;
          candidate.relevanceScore = relevance.score;
          candidate.relevanceReasons = relevance.reasons;
          if (!candidate.problemStatement) {
            candidate.problemStatement = inferProblemStatement(
              candidate.canonicalProductName || candidate.title,
              candidate.sourceObservations
                .map((o) => o.description || o.observedContent || "")
                .join(". ")
            );
          }

          candidate.psychologyProfile = analyzeCustomerPsychology({
            candidateId: candidate.candidateId,
            candidateTitle: candidate.canonicalProductName || candidate.title,
            categoryOrTopic: context.topic || candidate.category || "general",
            rawHeadlines: Array.from(
              new Set(
                [
                  candidate.canonicalProductName || candidate.title,
                  candidate.originalAdHeadline,
                  ...candidate.sourceObservations.map((o) => o.title),
                ].filter((t): t is string => Boolean(t && t.trim().length > 0))
              )
            ),
            rawDescriptions: candidate.sourceObservations
              .map((o) => o.description || o.observedContent)
              .filter(Boolean) as string[],
            landingPageUrl: candidate.canonicalProductUrl,
            advertiserName: candidate.advertiserNames[0] || null,
            sourceReference: candidate.mediaSourceAdId
              ? `Ad #${candidate.mediaSourceAdId}`
              : undefined,
          });
          const psychCheck = validateCustomerPsychologyAlignment(
            candidate.psychologyProfile,
            candidate
          );
          if (!psychCheck.valid) {
            candidate.psychologyProfile = undefined;
          }

          attachDistinctnessFingerprint(candidate);

          const enrichedReality = evaluateCandidateProductReality(candidate);
          candidate.productRealityStatus = enrichedReality.productRealityStatus;
          candidate.sourcePageClassification =
            enrichedReality.sourcePageClassification;
          candidate.productRealityReason = enrichedReality.reason;

          if (
            !relevance.isAccepted ||
            relevance.relevanceStatus === "IRRELEVANT" ||
            !enrichedReality.isPhysicalProductRealityEligible ||
            resolved.hasUnresolvedContradiction
          ) {
            candidate.isEligibleAsEvergreenWinner = false;
          } else if (
            candidate.identityStatus === "VERIFIED" &&
            !resolved.requiresManualReview &&
            enrichedReality.productRealityStatus === "VERIFIED_PHYSICAL_PRODUCT"
          ) {
            candidate.isEligibleAsEvergreenWinner = true;
          } else {
            candidate.isEligibleAsEvergreenWinner = false;
          }

          if (candidate.identityStatus === "VERIFIED") verifiedCount++;
          else if (candidate.identityStatus === "PROBABLE") probableCount++;
          else unresolvedCount++;

          enrichedList.push(candidate);
        } catch (err: any) {
          errors.push(
            `Enrichment failed for ${candidate.candidateId}: ${err.message}`
          );
          attachDistinctnessFingerprint(candidate);
          enrichedList.push(candidate);
        }
      })
    );
  }

  // Canonical Product Deduplication across enriched candidates via Section 5 engine
  // (merges candidates whose redirects/metadata resolved to the same canonical URL, merchantProductId, GTIN, or brand+model)
  const clustered = clusterProductCandidates(
    enrichedList,
    mergeDuplicateCandidateRecords
  );

  return {
    candidates: clustered.consolidatedCandidates,
    enrichedCount,
    verifiedCount,
    probableCount,
    unresolvedCount,
    contradictionCount,
    errors,
  };
}
