/**
 * SWAI KH-02 — Product Candidate Discovery Service
 *
 * Extracts consolidated product candidates from raw advertisement observations.
 * Prevents ad fragmentation by grouping multiple creatives promoting the same item.
 *
 * Invariant:
 * 50 Meta ads and 10 TikTok ads for the same product must become 1 Candidate,
 * not 60 separate products.
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
import { extractProductUrlMetadata } from "./productMetadataExtractor";
import { evaluateProductRelevance } from "./productRelevanceEvaluator";
import {
  analyzeCustomerPsychology,
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

export interface DiscoveredProductCandidate {
  candidateId: string;
  researchProductId?: string | null;
  title: string;
  canonicalProductName?: string | null;
  displayName?: string;
  originalAdHeadline?: string | null;
  originalCreativeCode?: string | null;
  brand?: string | null;
  model?: string | null;
  sku?: string | null;
  category: string;
  problemStatement: string | null;
  targetAudience: string | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  mediaSourceAdId?: string | null;
  canonicalProductUrl: string | null;
  storeDomain: string | null;
  advertiserNames: string[];
  supportingAdIds: string[];
  supportingSourceTypes: string[];
  totalObservationCount: number;
  distinctAdvertisersCount: number;
  earliestObservationDate: string | null;
  latestObservationDate: string | null;
  identityConfidence: ProductMatchConfidence;
  sourceObservations: SourceObservation[];
  identityStatus?: ProductIdentityStatus;
  resolutionSource?: string;
  requiresManualReview?: boolean;
  identityEvidenceReferences?: string[];
  isEligibleAsEvergreenWinner?: boolean;
  relevanceStatus?: "RELEVANT" | "PROBABLY_RELEVANT" | "AMBIGUOUS" | "IRRELEVANT";
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
}


export interface KH02ResolvedCandidate {
  candidateId: string;
  researchProductId: string | null;
  canonicalProductUrl: string | null;
  identityStatus: "CONFIRMED" | "PROBABLE" | "AMBIGUOUS";
  matchedAdIds: string[];
  requiresManualReview: boolean;
  matchReason?: string;
}

/**
 * Resolves a candidate to an existing database ResearchProduct or marks as provisional.
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
      return {
        candidateId: candidate.candidateId,
        researchProductId: existingLink.product.id,
        canonicalProductUrl: existingLink.product.productUrl || candidate.canonicalProductUrl,
        identityStatus: "CONFIRMED",
        matchedAdIds: candidate.supportingAdIds,
        requiresManualReview: false,
        matchReason: `Linked via existing AdProductLink to ResearchProduct ${existingLink.product.id}`,
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
      return {
        candidateId: candidate.candidateId,
        researchProductId: match.matchedProduct.id,
        canonicalProductUrl: match.matchedProduct.productUrl || candidate.canonicalProductUrl,
        identityStatus: match.confidence === "EXACT_MATCH" ? "CONFIRMED" : "PROBABLE",
        matchedAdIds: candidate.supportingAdIds,
        requiresManualReview: match.confidence !== "EXACT_MATCH",
        matchReason: match.matchReason,
      };
    }
  }

  // 3. Fallback: Not yet linked to a persistent ResearchProduct
  return {
    candidateId: candidate.candidateId,
    researchProductId: null,
    canonicalProductUrl: candidate.canonicalProductUrl,
    identityStatus: candidate.canonicalProductUrl ? "PROBABLE" : "AMBIGUOUS",
    matchedAdIds: candidate.supportingAdIds,
    requiresManualReview: true,
    matchReason: "No existing ResearchProduct record found for candidate destination URL.",
  };
}

/**
 * Normalizes title string by stripping common ad copy clickbait suffixes.
 */
function cleanCandidateTitle(rawTitle: string): string {
  let title = rawTitle.trim();
  // Strip trailing punctuation and common ad hook slogans
  title = title.replace(/\s*[-–|:]\s*(Buy Now|Shop Now|50% Off|Free Shipping|Sale|Official Store).*$/i, "");
  title = title.replace(/^(NEW|HOT|MUST HAVE|VIRAL)\s*[:!-]\s*/i, "");
  return title.slice(0, 100);
}

/**
 * Extracts a concise problem statement from ad copy or headline.
 */
function inferProblemStatement(headline: string | null, body: string | null): string | null {
  const combined = `${headline || ""} ${body || ""}`.trim();
  if (!combined) return null;

  // Look for problem-solution indicators
  const problemMatches = combined.match(/(tired of|say goodbye to|struggling with|stop wasting|easily remove|helps you|designed to solve|eliminates|protect your|keep your)\s+([^.!?]+)/i);
  if (problemMatches && problemMatches[0]) {
    return problemMatches[0].trim();
  }

  // Fallback to first coherent sentence if short
  const firstSentence = combined.split(/[.!?]/)[0];
  if (firstSentence && firstSentence.length > 15 && firstSentence.length < 120) {
    return firstSentence.trim();
  }

  return null;
}

/**
 * Extracts consolidated product candidates from multi-source ad observations.
 */
export function discoverProductCandidatesFromAds(
  observations: SourceObservation[],
  topic: string
): DiscoveredProductCandidate[] {
  // Map keyed by canonical product identity or secure product handle
  const candidateMap = new Map<string, {
    key: string;
    titles: string[];
    descriptions: string[];
    canonicalUrl: string | null;
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
  }>();

  for (const obs of observations) {
    let rawDestUrl = obs.landingPageUrl || (obs.sourceUrl && !obs.sourceUrl.includes("facebook.com/ads/library") && !obs.sourceUrl.includes("tiktok.com") ? obs.sourceUrl : null);
    if (!rawDestUrl && obs.description) {
      const urlMatch = obs.description.match(/https?:\/\/[^\s"'<>]+/i);
      if (urlMatch) {
        rawDestUrl = urlMatch[0];
      }
    }
    const urlMeta = extractProductUrlMetadata(rawDestUrl);

    let canonicalUrl: string | null = urlMeta.cleanCanonicalUrl || null;
    let storeDomain: string | null = urlMeta.storeDomain || obs.storeDomainEvidence || obs.advertiserDomain || null;
    let groupKey: string;

    if (urlMeta.isShopifyProductUrl && urlMeta.productHandle) {
      // Group ads for the exact same Shopify product together across all creatives
      groupKey = `shopify::${storeDomain || "store"}::${urlMeta.productHandle.toLowerCase()}`;
    } else if (urlMeta.isValidEcommerceUrl && urlMeta.cleanCanonicalUrl) {
      groupKey = `url::${urlMeta.cleanCanonicalUrl.toLowerCase()}`;
    } else if (storeDomain && obs.title && obs.title.trim().length > 3) {
      const cleanTitle = cleanCandidateTitle(obs.title);
      if (cleanTitle.length > 3) {
        groupKey = `domain::${storeDomain}::${cleanTitle.toLowerCase()}`;
      } else {
        groupKey = `ad::${obs.source}::${obs.sourceRecordId || Math.abs(hashCode(obs.title))}`;
      }
    } else if (obs.advertiserOrCreator && obs.title && obs.title.trim().length > 3) {
      const cleanTitle = cleanCandidateTitle(obs.title);
      if (cleanTitle.length > 3) {
        // Multiple ads from the same advertiser promoting the same product title
        groupKey = `advertiser::${obs.advertiserOrCreator.toLowerCase()}::${cleanTitle.toLowerCase()}`;
      } else {
        groupKey = `ad::${obs.source}::${obs.sourceRecordId || Math.abs(hashCode(obs.title))}`;
      }
    } else if (obs.sourceRecordId) {
      // Unidentified ad creative: separate group so different unknown ads don't collapse into one
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
        canonicalUrl,
        storeDomain,
        advertisers: new Set<string>(),
        thumbnails: [],
        videos: [],
        adIds: [],
        sources: new Set<string>(),
        observations: [],
        earliest: null,
        latest: null,
        confidence: urlMeta.isShopifyProductUrl ? "EXACT" : (storeDomain ? "PROBABLE" : "AMBIGUOUS"),
      };
      candidateMap.set(groupKey, candidate);
    }

    if (obs.title) candidate.titles.push(obs.title);
    const desc = obs.description || obs.observedContent;
    if (desc) candidate.descriptions.push(desc);
    if (obs.advertiserOrCreator) candidate.advertisers.add(obs.advertiserOrCreator);
    if (obs.media?.thumbnailUrl) candidate.thumbnails.push(obs.media.thumbnailUrl);
    if (obs.media?.videoUrl) candidate.videos.push(obs.media.videoUrl);
    if (obs.sourceRecordId) candidate.adIds.push(obs.sourceRecordId);
    candidate.sources.add(obs.source);
    candidate.observations.push(obs);

    // Update earliest/latest observation dates
    const obsDate = obs.observedAt || obs.reportedLastShownAt || obs.reportedFirstShownAt;
    if (obsDate) {
      if (!candidate.earliest || new Date(obsDate) < new Date(candidate.earliest)) {
        candidate.earliest = obsDate;
      }
      if (!candidate.latest || new Date(obsDate) > new Date(candidate.latest)) {
        candidate.latest = obsDate;
      }
    }
  }

  // Convert map into clean DiscoveredProductCandidate list with resolved identities
  const candidates: DiscoveredProductCandidate[] = [];
  let index = 1;

  for (const [key, c] of candidateMap.entries()) {
    // Find representative observation for media attachment integrity
    const repObs = c.observations.find((o) => o.media?.thumbnailUrl) || c.observations[0];
    const sourceRef = repObs
      ? `${repObs.source === "META_ADS" ? "Facebook Ad" : repObs.source} #${repObs.sourceExternalAdId || repObs.sourceRecordId}`
      : undefined;

    // Resolve factual product identity through 7-level hierarchy
    const resolvedIdentity = resolveProductIdentity({
      landingPageUrl: c.canonicalUrl,
      storeDomain: c.storeDomain,
      brandOrAdvertiser: Array.from(c.advertisers)[0] || null,
      rawHeadlines: c.titles,
      rawDescriptions: c.descriptions,
      sourceReference: sourceRef,
    });

    // Check product relevance against niche using full product context
    const candidateContext = [
      resolvedIdentity.displayTitle,
      resolvedIdentity.canonicalName || "",
      c.canonicalUrl || "",
      ...c.titles,
      ...c.descriptions,
    ].filter(Boolean).join(" ");

    const relevance = evaluateProductRelevance(candidateContext, topic);
    const problemStatement = inferProblemStatement(c.titles[0] || null, c.descriptions[0] || null);

    // Analyze customer psychology grounded strictly in observed evidence
    const psychProfile = analyzeCustomerPsychology({
      candidateTitle: resolvedIdentity.displayName || resolvedIdentity.displayTitle,
      categoryOrTopic: topic,
      rawHeadlines: c.titles,
      rawDescriptions: c.descriptions,
      landingPageUrl: c.canonicalUrl,
      advertiserName: Array.from(c.advertisers)[0] || null,
      sourceReference: sourceRef,
    });

    const chosenThumbnail = repObs?.media?.thumbnailUrl || c.thumbnails[0] || null;
    const chosenVideo = repObs?.media?.videoUrl || c.videos[0] || null;
    const mediaSourceAdId = repObs?.sourceRecordId || repObs?.sourceExternalAdId || null;

    // Section 6.5: A /collections/... URL is not an actual SKU-specific product page.
    // Do not mark a collection listing as VERIFIED product identity without an independently associated SKU page.
    const pageClass = classifySourcePage(
      c.canonicalUrl,
      c.storeDomain ? "SHOPIFY_STORE" : "UNKNOWN",
      candidateContext
    );
    let effectiveIdentityStatus = resolvedIdentity.identityStatus;
    if (pageClass === "COLLECTION_PAGE" && effectiveIdentityStatus === "VERIFIED" && !resolvedIdentity.sku) {
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
      originalAdHeadline: resolvedIdentity.originalAdHeadline || c.titles[0] || null,
      originalCreativeCode: resolvedIdentity.originalCreativeCode,
      brand: resolvedIdentity.brand,
      model: resolvedIdentity.model,
      sku: resolvedIdentity.sku,
      category: topic,
      problemStatement,
      targetAudience: "Homeowners, Pet Owners & Everyday Problem Solvers",
      thumbnailUrl: chosenThumbnail,
      videoUrl: chosenVideo,
      mediaSourceAdId,
      canonicalProductUrl: c.canonicalUrl,
      storeDomain: c.storeDomain,
      advertiserNames: Array.from(c.advertisers),
      supportingAdIds: Array.from(new Set(c.adIds)),
      supportingSourceTypes: Array.from(c.sources),
      totalObservationCount: c.observations.length,
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
      requiresManualReview: resolvedIdentity.requiresManualReview || pageClass === "COLLECTION_PAGE",
      identityEvidenceReferences: resolvedIdentity.identityEvidenceReferences,
      isEligibleAsEvergreenWinner:
        effectiveIdentityStatus === "VERIFIED" &&
        resolvedIdentity.isEligibleAsEvergreenWinner &&
        relevance.isAccepted &&
        relevance.relevanceStatus !== "IRRELEVANT",
      relevanceStatus: relevance.relevanceStatus,
      relevanceScore: relevance.score,
      relevanceReasons: relevance.reasons,
      psychologyProfile: psychProfile,
      sourcePageClassification: pageClass,
    };

    const realityEval = evaluateCandidateProductReality(candObj);
    candObj.productRealityStatus = realityEval.status;
    candObj.sourcePageClassification = realityEval.sourcePageClassification;
    candObj.productRealityReason = realityEval.reason;
    if (!realityEval.eligibleForShortlist) {
      candObj.isEligibleAsEvergreenWinner = false;
    }

    candidates.push(candObj);

    index++;
  }

  return candidates;
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
  totalCandidatesEvaluated: number;
  distinctCount: number;
  duplicateGroupsCount: number;
  details: Array<{
    candidateId: string;
    title: string;
    canonicalKey: string;
    storeDomain: string | null;
    isDuplicate: boolean;
    duplicateOf?: string;
  }>;
}

export interface ResearchShortlistResult {
  shortlist: DiscoveredProductCandidate[];
  requestedCount: number;
  qualifiedCount: number;
  shortfallReason: string | null;
  distinctnessSummary: string;
  distinctnessEvaluation: DistinctnessEvaluation;
}

/**
 * Evaluates distinctness across product candidates, identifying shared canonical keys or duplicates.
 */
export function evaluateShortlistDistinctness(
  candidates: DiscoveredProductCandidate[]
): DistinctnessEvaluation {
  const seenCanonicalKeys = new Map<string, string>(); // canonicalKey -> candidateId
  const details: DistinctnessEvaluation["details"] = [];
  let duplicateCount = 0;

  for (const c of candidates) {
    const rawKey = (c.canonicalProductName || c.displayName || c.title || "").toLowerCase().trim();
    // Normalize key: remove model numbers or minor punctuation
    const normalizedKey = rawKey.replace(/[-_.,;:]+/g, " ").trim();
    const existing = seenCanonicalKeys.get(normalizedKey);

    if (existing) {
      duplicateCount++;
      details.push({
        candidateId: c.candidateId,
        title: c.title,
        canonicalKey: normalizedKey,
        storeDomain: c.storeDomain,
        isDuplicate: true,
        duplicateOf: existing,
      });
    } else {
      seenCanonicalKeys.set(normalizedKey, c.candidateId);
      details.push({
        candidateId: c.candidateId,
        title: c.title,
        canonicalKey: normalizedKey,
        storeDomain: c.storeDomain,
        isDuplicate: false,
      });
    }
  }

  const distinctCount = candidates.length - duplicateCount;
  return {
    isDistinct: duplicateCount === 0,
    totalCandidatesEvaluated: candidates.length,
    distinctCount,
    duplicateGroupsCount: duplicateCount,
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
 * Evaluates a candidate against the mandatory 9-condition Product Reality Gate (Section 6).
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
    ...(c.sourceObservations || []).map((o) => o.description || o.observedContent || ""),
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
    pageTypeHint: c.storeDomain ? "SHOPIFY_STORE" : "UNKNOWN",
  });

  const sourcePageClassification =
    c.sourcePageClassification || deterministic.sourcePageClassification;

  // Condition 1: Correct niche
  const correctNiche =
    (c.relevanceStatus === "RELEVANT" || c.relevanceStatus === "PROBABLY_RELEVANT") &&
    (!c.aiIntelligence ||
      (c.aiIntelligence.nicheRelevance !== "UNRELATED" &&
        c.aiIntelligence.nicheRelevance !== "LOW"));

  // Condition 6: Not a service, article, insurance or lead-generation offer
  const aiEntity = c.aiIntelligence?.commercialEntityType;
  const aiSaysNonPhysical =
    (Boolean(aiEntity) && aiEntity !== "PHYSICAL_PRODUCT") ||
    c.aiIntelligence?.isLikelySellableProduct === false;
  const notServiceArticleInsuranceLeadGen =
    !deterministic.isNonPhysical && !aiSaysNonPhysical;

  // Condition 7: Not a campaign title masquerading as a product
  const notCampaignTitle =
    sourcePageClassification !== "CAMPAIGN_PAGE" &&
    deterministic.detectedEntityType !== "ADVERTISING_CAMPAIGN";

  // Condition 3: Product identity defensible
  // Note: Collection pages cannot claim VERIFIED SKU identity without an SKU,
  // but can have PROBABLE category/brand product identity if backed by physical product evidence.
  const productIdentityDefensible =
    c.identityStatus !== "UNRESOLVED" &&
    c.identityStatus !== "AMBIGUOUS" &&
    Boolean(c.canonicalProductName || c.displayName || c.title) &&
    notCampaignTitle;

  // Condition 4: Original advertising/source evidence available
  const sourceEvidenceAvailable =
    Boolean(c.supportingAdIds && c.supportingAdIds.length > 0) ||
    Boolean(c.sourceObservations && c.sourceObservations.length > 0);

  // Condition 5: Merchant/product evidence sufficient
  const merchantEvidenceSufficient =
    Boolean(c.storeDomain) ||
    Boolean(c.canonicalProductUrl) ||
    (c.identityStatus === "VERIFIED" && c.identityConfidence === "EXACT");

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
    (aiConfirmedPhysical || (c.aiShortlistEligible !== false && deterministicPhysicalSupported));

  // Condition 9: No unresolved evidence contradiction
  const ver = c.aiVerification;
  const hasVerifierViolation =
    Boolean(ver) &&
    (!ver.correctCandidateId ||
      !ver.validSourceReferences ||
      !ver.accurateQuotations ||
      !ver.productIdentityConsistent ||
      ver.promptInjectionDetected ||
      (Array.isArray(ver.contradictions) && ver.contradictions.length > 0));
  const noUnresolvedContradiction =
    !hasVerifierViolation && c.aiShortlistEligible !== false;

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

  const buildGateResult = (
    status: ProductRealityStatus,
    eligibleForShortlist: boolean,
    reason: string | null
  ): ProductRealityGateEvaluation => ({
    status,
    productRealityStatus: status,
    sourcePageClassification,
    eligibleForShortlist,
    isPhysicalProductRealityEligible: eligibleForShortlist,
    reason,
    rejectionReasons: reason ? [reason] : [],
    conditions,
  });

  if (!notServiceArticleInsuranceLeadGen) {
    return buildGateResult(
      "NON_PHYSICAL",
      false,
      c.aiExclusionReason ||
        deterministic.reason ||
        `Excluded: Classified as non-physical entity (${aiEntity || deterministic.detectedEntityType || "NON_PHYSICAL"}).`
    );
  }

  if (!notCampaignTitle) {
    return buildGateResult(
      "REJECTED",
      false,
      deterministic.reason || "Excluded: Campaign code or internal ad identifier."
    );
  }

  if (!correctNiche) {
    return buildGateResult(
      "REJECTED",
      false,
      c.aiExclusionReason ||
        (c.relevanceReasons && c.relevanceReasons[0]) ||
        "Excluded: Candidate does not match requested niche."
    );
  }

  if (!noUnresolvedContradiction) {
    return buildGateResult(
      "UNRESOLVED",
      false,
      c.aiExclusionReason ||
        "Excluded: Unresolved AI evidence contradiction or unverified source reference."
    );
  }

  if (
    !productIdentityDefensible ||
    !sourceEvidenceAvailable ||
    !merchantEvidenceSufficient ||
    !physicalProductSupported
  ) {
    return buildGateResult(
      "UNRESOLVED",
      false,
      !merchantEvidenceSufficient
        ? "Excluded: Lacks verified merchant domain or product landing URL evidence."
        : !productIdentityDefensible
        ? "Excluded: Product identity is unresolved."
        : !sourceEvidenceAvailable
        ? "Excluded: Lacks supporting source advertisement evidence."
        : "Excluded: Insufficient physical product evidence."
    );
  }

  const isVerifiedSkuPage =
    sourcePageClassification === "ACTUAL_PRODUCT_PAGE" ||
    (c.identityStatus === "VERIFIED" && sourcePageClassification !== "COLLECTION_PAGE");

  return buildGateResult(
    isVerifiedSkuPage
      ? "VERIFIED_PHYSICAL_PRODUCT"
      : "EVIDENCE_SUPPORTED_PHYSICAL_PRODUCT",
    true,
    null
  );
}

/**
 * Selects up to `limit` (default 3) distinct, genuine, niche-relevant products for human evaluation.
 * Enforces the mandatory Product Reality Gate even when Gemini is unavailable or failed.
 * Returns explicit shortfall reason if authorized source data yields fewer than 3 products.
 */
export function selectTopResearchShortlist(
  candidates: DiscoveredProductCandidate[],
  limit: number = 3
): ResearchShortlistResult {
  // 1. Filter candidates through the mandatory Product Reality Gate (Section 6):
  const eligible = candidates.filter((c) => {
    const reality = evaluateCandidateProductReality(c);
    c.productRealityStatus = reality.status;
    c.sourcePageClassification = reality.sourcePageClassification;
    c.productRealityReason = reality.reason;
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

  // 2. Sort eligible candidates: prefer higher relevance score, then observation count
  eligible.sort((a, b) => {
    const relDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
    if (relDiff !== 0) return relDiff;
    return b.totalObservationCount - a.totalObservationCount;
  });

  // 3. Apply distinctness filtering to prevent duplicate product opportunities
  const distinctShortlist: DiscoveredProductCandidate[] = [];
  const seenKeys = new Set<string>();

  for (const c of eligible) {
    const canonicalKey = (c.canonicalProductName || c.displayName || c.title || "").toLowerCase().trim();
    if (!seenKeys.has(canonicalKey)) {
      seenKeys.add(canonicalKey);
      distinctShortlist.push(c);
    }
    if (distinctShortlist.length >= limit) break;
  }

  const distinctnessEvaluation = evaluateShortlistDistinctness(distinctShortlist);
  const shortfallReason = distinctShortlist.length < limit
    ? `Only ${distinctShortlist.length} independently identifiable, niche-relevant product(s) were supported by available source evidence (requested ${limit}).`
    : null;

  const distinctnessSummary = distinctShortlist.length > 0
    ? `${distinctShortlist.length} distinct products identified: ${distinctShortlist.map((c) => c.title).join(", ")}`
    : "No distinct products qualified for shortlist";

  return {
    shortlist: distinctShortlist,
    requestedCount: limit,
    qualifiedCount: distinctShortlist.length,
    shortfallReason,
    distinctnessSummary,
    distinctnessEvaluation,
  };
}

export interface ProductEnrichmentContext {
  workspaceId: string;
  topic: string;
  timeoutMs?: number;
  maxConcurrency?: number;
  signal?: AbortSignal;
  metadataFetcher?: (url: string) => Promise<any>;
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
 * Bounded concurrency, per-page timeouts, contradiction detection, and canonical deduplication.
 */
export async function enrichProductCandidatesWithEvidence(
  candidates: DiscoveredProductCandidate[],
  context: ProductEnrichmentContext
): Promise<ProductEnrichmentResult> {
  const maxConcurrency = context.maxConcurrency || 3;
  const timeoutMs = context.timeoutMs || 4000;
  const errors: string[] = [];

  let enrichedCount = 0;
  let verifiedCount = 0;
  let probableCount = 0;
  let unresolvedCount = 0;
  let contradictionCount = 0;

  // Process candidates in bounded concurrent chunks
  const enrichedList: DiscoveredProductCandidate[] = [];

  for (let i = 0; i < candidates.length; i += maxConcurrency) {
    if (context.signal?.aborted) break;

    const chunk = candidates.slice(i, i + maxConcurrency);
    await Promise.all(
      chunk.map(async (candidate) => {
        try {
          if (!candidate.canonicalProductUrl) {
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
              rawHeadlines: candidate.originalAdHeadline ? [candidate.originalAdHeadline] : [],
              rawDescriptions: candidate.sourceObservations
                .map((o) => o.description || o.observedContent)
                .filter(Boolean) as string[],
              existingResearchProductId: candidate.researchProductId,
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
          candidate.brand = resolved.brand;
          candidate.model = resolved.model;
          candidate.sku = resolved.sku;
          const enrichedPageClass = classifySourcePage(candidate.canonicalProductUrl);
          candidate.sourcePageClassification = enrichedPageClass;
          if (enrichedPageClass === "COLLECTION_PAGE" && resolved.identityStatus === "VERIFIED" && !resolved.sku) {
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
          candidate.identityEvidenceReferences = resolved.identityEvidenceReferences;

          if (resolved.identityStatus === "AMBIGUOUS" && resolved.requiresManualReview) {
            contradictionCount++;
            candidate.isEligibleAsEvergreenWinner = false;
          }

          // Re-evaluate relevance with verified landing page title
          const candidateContext = [
            resolved.displayTitle,
            resolved.canonicalName || "",
            candidate.canonicalProductUrl || "",
            candidate.originalAdHeadline || "",
            ...candidate.sourceObservations.map((o) => o.title || o.description || "").slice(0, 3),
          ]
            .filter(Boolean)
            .join(" ");

          const relevance = evaluateProductRelevance(candidateContext, context.topic);
          candidate.relevanceStatus = relevance.relevanceStatus;
          candidate.relevanceScore = relevance.score;
          candidate.relevanceReasons = relevance.reasons;

          const enrichedReality = evaluateCandidateProductReality(candidate);
          candidate.productRealityStatus = enrichedReality.productRealityStatus;
          candidate.sourcePageClassification = enrichedReality.sourcePageClassification;

          if (
            !relevance.isAccepted ||
            relevance.relevanceStatus === "IRRELEVANT" ||
            !enrichedReality.isPhysicalProductRealityEligible
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
          errors.push(`Enrichment failed for ${candidate.candidateId}: ${err.message}`);
          enrichedList.push(candidate);
        }
      })
    );
  }

  // Canonical Product Deduplication across enriched candidates
  const deduplicated: DiscoveredProductCandidate[] = [];
  const seenCanonicalKeys = new Map<string, DiscoveredProductCandidate>();

  for (const c of enrichedList) {
    const rawName = (c.canonicalProductName || c.displayName || c.title || "").toLowerCase().trim();
    const domainKey = c.storeDomain ? c.storeDomain.toLowerCase().trim() : "";
    const dedupeKey = domainKey ? `${domainKey}::${rawName}` : rawName;

    const existing = seenCanonicalKeys.get(dedupeKey);
    if (existing) {
      existing.totalObservationCount += c.totalObservationCount;
      for (const adId of c.supportingAdIds) {
        if (!existing.supportingAdIds.includes(adId)) existing.supportingAdIds.push(adId);
      }
      for (const src of c.supportingSourceTypes) {
        if (!existing.supportingSourceTypes.includes(src)) existing.supportingSourceTypes.push(src);
      }
      for (const obs of c.sourceObservations) {
        existing.sourceObservations.push(obs);
      }
    } else {
      seenCanonicalKeys.set(dedupeKey, c);
      deduplicated.push(c);
    }
  }

  return {
    candidates: deduplicated,
    enrichedCount,
    verifiedCount,
    probableCount,
    unresolvedCount,
    contradictionCount,
    errors,
  };
}
