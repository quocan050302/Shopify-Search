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
  ProductIdentityStatus,
} from "./productIdentityResolver";
import { extractProductUrlMetadata } from "./productMetadataExtractor";
import { evaluateProductRelevance } from "./productRelevanceEvaluator";
import {
  analyzeCustomerPsychology,
  CustomerPsychologyProfile,
} from "../psychology/customerPsychologyService";

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

    candidates.push({
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
      identityConfidence: resolvedIdentity.identityStatus === "VERIFIED" ? "EXACT" : (resolvedIdentity.identityStatus === "PROBABLE" ? "HIGH_CONFIDENCE" : "AMBIGUOUS"),
      sourceObservations: c.observations,
      identityStatus: resolvedIdentity.identityStatus,
      resolutionSource: resolvedIdentity.resolutionSource,
      requiresManualReview: resolvedIdentity.requiresManualReview,
      identityEvidenceReferences: resolvedIdentity.identityEvidenceReferences,
      isEligibleAsEvergreenWinner: resolvedIdentity.isEligibleAsEvergreenWinner && relevance.isAccepted && relevance.relevanceStatus !== "IRRELEVANT",
      relevanceStatus: relevance.relevanceStatus,
      relevanceScore: relevance.score,
      relevanceReasons: relevance.reasons,
      psychologyProfile: psychProfile,
    });

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

/**
 * Selects up to `limit` (default 3) distinct, genuine, niche-relevant products for human evaluation.
 * Returns explicit shortfall reason if authorized source data yields fewer than 3 products.
 */
export function selectTopResearchShortlist(
  candidates: DiscoveredProductCandidate[],
  limit: number = 3
): ResearchShortlistResult {
  // 1. Filter candidates for shortlist eligibility:
  // - Must be relevant to requested topic
  // - Product identity must be resolved (not unresolved / campaign code)
  // - Must have supporting source evidence
  const eligible = candidates.filter((c) => {
    const isRelevant = c.relevanceStatus === "RELEVANT" || c.relevanceStatus === "PROBABLY_RELEVANT";
    const hasResolvedIdentity = c.identityStatus !== "UNRESOLVED" && Boolean(c.canonicalProductName || c.displayName);
    const hasEvidence = (c.supportingAdIds && c.supportingAdIds.length > 0) || (c.sourceObservations && c.sourceObservations.length > 0);
    return isRelevant && hasResolvedIdentity && hasEvidence;
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
