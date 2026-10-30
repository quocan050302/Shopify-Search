import type {
  DiscoveredProductCandidate,
  EvergreenLeaderboardResponse,
  RankedProductCandidate,
} from "../types";
import { validateAndNormalizeMediaUrl } from "../media/productMediaResolver";

export type CanonicalQualificationTier =
  | "VERIFIED_EVERGREEN"
  | "RESEARCH_QUALIFIED"
  | "PROVISIONAL";

export type ExplorerCandidateStatus =
  | "RESEARCH_QUALIFIED"
  | "PROVISIONAL"
  | "NEEDS_VERIFICATION"
  | "EXCLUDED";

export interface CanonicalRecommendedProduct {
  rank: number;
  candidateId: string;
  productKey: string;
  title: string;
  titleSourceLabel: "Merchant-Verified Title" | "Ad-Claimed Product Name";
  storeDomain: string | null;
  canonicalProductUrl: string | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  primaryMediaSourceLabel:
    | "Merchant Product Image"
    | "Candidate Thumbnail"
    | "Meta Ad Creative"
    | "Meta Ad Video Creative"
    | "No Verified Media";
  familyLabel: string;
  familyKey: string;
  modelOrSku: string | null;
  qualificationTier: CanonicalQualificationTier;
  qualificationBadgeLabel: string;
  qualificationTone: "emerald" | "amber" | "slate";
  isShortlisted: boolean;
  merchantPageVerified: boolean;
  opportunityScore: number | null;
  scoreStatusLabel: string;
  scoreStatusCode: string;
  evidenceConfidence: number;
  observationCount: number;
  supportingAdCount: number;
  currentRunLiveAdsCount: number;
  currentRunCachedAdsCount: number;
  distinctAdvertisersCount: number;
  supportingSources: string[];
  audienceBadgeLabel: string;
  audienceFitStatus: "MATCHED" | "COMPATIBLE_BROAD" | "MISMATCHED" | "NEUTRAL";
  whyItMatters: string;
  technicalVerificationSummary: string | null;
  verifiedEvidenceItems: string[];
  missingRequirements: string[];
  researchProductId: string | null;
  distinctnessNote: string | null;
  rawCandidate: DiscoveredProductCandidate;
  rawRankedItem: RankedProductCandidate | null;
}

export interface ExplorerCandidateRow {
  candidateId: string;
  productKey: string;
  title: string;
  storeDomain: string | null;
  canonicalProductUrl: string | null;
  familyLabel: string;
  familyKey: string;
  explorerStatus: ExplorerCandidateStatus;
  statusBadgeLabel: string;
  statusTone: "emerald" | "amber" | "slate" | "rose";
  identityLabel: string;
  identityCode: string;
  realityLabel: string;
  realityCode: string;
  audienceBadgeLabel: string;
  audienceFitStatus: "MATCHED" | "COMPATIBLE_BROAD" | "MISMATCHED" | "NEUTRAL";
  opportunityScore: number | null;
  evidenceConfidence: number;
  observationCount: number;
  supportingSources: string[];
  plainEnglishReason: string;
  rejectionReasonCode: string | null;
  researchProductId: string | null;
  inRankedSnapshot?: boolean;
  rawCandidate: DiscoveredProductCandidate;
  rawRankedItem: RankedProductCandidate | null;
}

const BUSINESS_TERM_MAP: Record<string, string> = {
  VERIFIED_PHYSICAL_PRODUCT: "Verified Physical Product",
  EVIDENCE_SUPPORTED_PHYSICAL_PRODUCT: "Physical Product Confirmed",
  UNVERIFIED_SITE_SHELL: "Unverified Store Shell",
  REJECTED_NON_PRODUCT: "Excluded: Non-Product Page",
  VERIFIED: "Merchant Page Verified",
  PROBABLE: "Ad-Supported Product",
  UNVERIFIED: "Needs Store Verification",
  VERIFIED_EVERGREEN: "Verified Evergreen",
  RESEARCH_QUALIFIED: "Research Qualified",
  PROVISIONAL: "Provisional — Needs Demand History",
  INSUFFICIENT_EVIDENCE: "Needs Additional Evidence",
  DISQUALIFIED_IRRELEVANT: "Excluded — Audience or Niche Mismatch",
  AUTHORITATIVE_CURRENT: "Verified Multi-Month Demand",
  CACHED_UNVERIFIED: "Historical Cache (Unverified)",
  UNAVAILABLE: "Demand History Pending",
  LIVE_PARSED: "Live Source Evidence",
  LIVE_plus_CACHE: "Live + Historical Cache",
  CACHE_ONLY_HISTORICAL: "Historical Ad Cache",
  EMPTY: "No Source Observations",
};

export function formatBusinessTerm(code: string | null | undefined): string {
  if (!code) return "Unverified";
  return BUSINESS_TERM_MAP[code] || code.replace(/_/g, " ");
}

export function sanitizeRejectionOrRealityReason(
  candidate: Partial<DiscoveredProductCandidate>,
  rankedItem?: RankedProductCandidate | null
): string {
  if (candidate.rejectionDetail?.reasonText) {
    return candidate.rejectionDetail.reasonText;
  }

  const rawReasons = [
    candidate.productRealityReason,
    candidate.aiExclusionReason,
    rankedItem?.score?.recommendationRationale,
    ...(candidate.relevanceReasons || []),
  ].filter((r): r is string => Boolean(r && r.trim()));

  for (const reason of rawReasons) {
    // Guard against legacy contradictory message
    if (/non-physical entity\s*\(\s*PHYSICAL_PRODUCT\s*\)/i.test(reason)) {
      return "Excluded: Missing verifiable merchant product URL or landing page evidence despite physical product ad copy.";
    }
    if (
      /AI Review classified candidate as non-physical entity/i.test(reason) &&
      candidate.aiIntelligence?.commercialEntityType === "PHYSICAL_PRODUCT"
    ) {
      return "Excluded: Missing verifiable merchant product URL or landing page evidence despite physical product ad copy.";
    }
    return reason;
  }

  if (
    candidate.audienceRelevance &&
    candidate.audienceRelevance.eligibleForPrimaryShortlist === false
  ) {
    return candidate.audienceRelevance.relevanceReason;
  }

  return "Excluded during candidate qualification due to insufficient merchant or niche evidence.";
}

export function resolveAudienceBadge(candidate: Partial<DiscoveredProductCandidate>): {
  label: string;
  status: "MATCHED" | "COMPATIBLE_BROAD" | "MISMATCHED" | "NEUTRAL";
} {
  const ar = candidate.audienceRelevance;
  if (ar) {
    if (!ar.eligibleForPrimaryShortlist || ar.audienceMatch === "CONTRADICTORY") {
      const opp = ar.supportedAudiences?.[0] || "OTHER";
      return {
        label: `Mismatch (${opp})`,
        status: "MISMATCHED",
      };
    }
    const sup = ar.supportedAudiences || [];
    if (sup.includes("DOG") && sup.includes("CAT")) {
      return { label: "Dog & Cat Households", status: "COMPATIBLE_BROAD" };
    }
    if (sup.includes("DOG")) return { label: "Dog Owners", status: "MATCHED" };
    if (sup.includes("CAT")) return { label: "Cat Owners", status: "MATCHED" };
    if (sup.includes("PET_GENERAL")) return { label: "Pet Owners", status: "COMPATIBLE_BROAD" };
    if (sup.includes("WOMEN")) return { label: "Women", status: "MATCHED" };
    if (sup.includes("MEN")) return { label: "Men", status: "MATCHED" };
    if (sup.includes("KIDS")) return { label: "Kids & Family", status: "MATCHED" };
    if (sup.includes("ADULTS")) return { label: "Adults", status: "MATCHED" };
    if (sup.includes("CAR")) return { label: "Automotive / Car", status: "MATCHED" };
    if (sup.includes("MOTORCYCLE")) return { label: "Motorcycle", status: "MATCHED" };
    if (sup.includes("INDOOR")) return { label: "Indoor Home", status: "MATCHED" };
    if (sup.includes("OUTDOOR")) return { label: "Outdoor & Garden", status: "MATCHED" };
  }

  const hay = `${candidate.title || ""} ${candidate.category || ""} ${candidate.familyLabel || ""}`.toLowerCase();
  if (/\b(dog|dogs|canine|puppy|bark)\b/.test(hay) && !/\b(cat|cats|feline|kitten|litter)\b/.test(hay)) {
    return { label: "Dog Owners", status: "MATCHED" };
  }
  if (/\b(cat|cats|feline|kitten|litter)\b/.test(hay) && !/\b(dog|dogs|canine|puppy|bark)\b/.test(hay)) {
    return { label: "Cat Owners", status: "MATCHED" };
  }
  if (/\b(pet|pets|fountain|feeder|grooming)\b/.test(hay)) {
    return { label: "Pet Owners", status: "COMPATIBLE_BROAD" };
  }
  return { label: "Target Niche Fit", status: "NEUTRAL" };
}

function isTechnicalMetadataExplanation(text: string | null | undefined): boolean {
  if (!text) return true;
  return /OpenGraph|product DOM|JSON-LD|merchant product ID|canonical URL slug|Verified product page via|Resolved via/i.test(
    text
  );
}

/**
 * V12.4.3.2.1 Section 10: Builds a buyer/seller-oriented "Why it fits your search" statement
 * grounded strictly in the candidate's product function, problem solved, audience fit, and source evidence,
 * keeping technical OpenGraph/DOM verification language out of the primary card copy.
 */
export function buildBuyerOrientedWhyItFits(
  candidate: Partial<DiscoveredProductCandidate>,
  topic: string | null | undefined,
  audienceLabel: string = "Target Buyers",
  merchantPageVerified: boolean = Boolean(
    candidate.identityStatus === "VERIFIED" && candidate.fetchOutcome !== "HTTP_ERROR"
  )
): string {
  const displayTitle = (
    candidate.merchantVerifiedProductName ||
    candidate.canonicalProductName ||
    candidate.displayName ||
    candidate.title ||
    "Physical product"
  ).trim();
  const cleanTopic = (topic || candidate.category || "your search").trim();

  // Check if AI or problemStatement provides a clean functional summary
  const aiSummary =
    candidate.aiIntelligence?.productSummary ||
    candidate.aiIntelligence?.coreProblemSolved ||
    null;
  if (
    typeof aiSummary === "string" &&
    aiSummary.trim().length >= 20 &&
    !isTechnicalMetadataExplanation(aiSummary)
  ) {
    return aiSummary.trim();
  }

  const rawProblem = candidate.problemStatement
    ? String(candidate.problemStatement).trim()
    : "";
  const cleanProblem =
    rawProblem.length >= 18 &&
    rawProblem.length <= 160 &&
    !isTechnicalMetadataExplanation(rawProblem) &&
    !/https?:\/\//i.test(rawProblem)
      ? rawProblem.replace(/\.+$/, "")
      : null;

  const provenanceClause = merchantPageVerified
    ? `verified on ${candidate.storeDomain || "the merchant storefront"}`
    : `supported by ${
        candidate.supportingAdIds?.length || 1
      } linked advertising creative(s)${
        candidate.storeDomain ? ` for ${candidate.storeDomain}` : ""
      }`;

  if (cleanProblem && cleanProblem.toLowerCase() !== displayTitle.toLowerCase()) {
    return `${displayTitle} for ${audienceLabel.toLowerCase()} (${cleanProblem}), matching your "${cleanTopic}" search and ${provenanceClause}.`;
  }

  const familyDesc = (
    candidate.familyLabel ||
    candidate.familyKey?.replace(/_/g, " ") ||
    cleanTopic
  ).toLowerCase();

  return `${displayTitle} designed for ${audienceLabel.toLowerCase()} in the ${familyDesc} category, matching your "${cleanTopic}" search and ${provenanceClause}.`;
}

export function resolveCandidatePrimaryMedia(
  candidate: Partial<DiscoveredProductCandidate>,
  merchantPageVerified: boolean = Boolean(
    candidate.identityStatus === "VERIFIED" ||
      (Array.isArray(candidate.imageReferences) &&
        candidate.imageReferences.length > 0 &&
        candidate.fetchOutcome !== "HTTP_ERROR")
  )
): {
  thumbnailUrl: string | null;
  primaryImageUrl: string | null;
  primaryMediaSourceLabel: CanonicalRecommendedProduct["primaryMediaSourceLabel"];
} {
  // 1. Prefer verified merchant product image from imageReferences[0]
  if (Array.isArray(candidate.imageReferences) && candidate.imageReferences.length > 0) {
    for (const ref of candidate.imageReferences) {
      const check = validateAndNormalizeMediaUrl(ref);
      if (check.valid && check.normalizedUrl) {
        const isMetaCdn = /fbcdn\.net|facebook\.com/i.test(check.normalizedUrl);
        return {
          thumbnailUrl: check.normalizedUrl,
          primaryImageUrl: check.normalizedUrl,
          primaryMediaSourceLabel:
            !isMetaCdn && merchantPageVerified
              ? "Merchant Product Image"
              : isMetaCdn
              ? "Meta Ad Creative"
              : "Candidate Thumbnail",
        };
      }
    }
  }

  // 2. Fallback to candidate.thumbnailUrl
  const thumbCheck = validateAndNormalizeMediaUrl(candidate.thumbnailUrl);
  if (thumbCheck.valid && thumbCheck.normalizedUrl) {
    const isShopifyOrMerchant =
      merchantPageVerified &&
      !/fbcdn\.net|facebook\.com/i.test(thumbCheck.normalizedUrl) &&
      (thumbCheck.normalizedUrl.includes("/cdn/shop/") ||
        (candidate.storeDomain &&
          thumbCheck.normalizedUrl
            .toLowerCase()
            .includes(candidate.storeDomain.toLowerCase())));
    return {
      thumbnailUrl: thumbCheck.normalizedUrl,
      primaryImageUrl: thumbCheck.normalizedUrl,
      primaryMediaSourceLabel: isShopifyOrMerchant
        ? "Merchant Product Image"
        : candidate.mediaSourceAdId || /fbcdn\.net|facebook\.com/i.test(thumbCheck.normalizedUrl)
        ? "Meta Ad Creative"
        : "Candidate Thumbnail",
    };
  }

  return {
    thumbnailUrl: null,
    primaryImageUrl: null,
    primaryMediaSourceLabel: "No Verified Media",
  };
}

function getCanonicalDedupeKeys(candidate: Partial<DiscoveredProductCandidate>): string[] {
  const keys: string[] = [];
  if (candidate.candidateId) keys.push(`id:${candidate.candidateId.toLowerCase()}`);
  if (candidate.productKey) keys.push(`pk:${candidate.productKey.toLowerCase()}`);
  if (candidate.canonicalProductUrl) {
    const cleanUrl = candidate.canonicalProductUrl
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?/, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
    if (cleanUrl) keys.push(`url:${cleanUrl}`);
  }
  const displayTitle = (
    candidate.merchantVerifiedProductName ||
    candidate.canonicalProductName ||
    candidate.displayName ||
    candidate.title ||
    ""
  )
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const domain = (candidate.storeDomain || "").toLowerCase().trim();
  if (displayTitle) {
    keys.push(`title:${domain}:${displayTitle}`);
  }
  return keys;
}

/**
 * Builds the canonical deduplicated list of recommended products for Tab 1 ("Recommended").
 * Never emits the same product more than once across topThree, researchShortlist, and provisionalCandidates.
 */
export function buildCanonicalRecommendedProducts(
  leaderboard: EvergreenLeaderboardResponse | null | undefined
): CanonicalRecommendedProduct[] {
  if (!leaderboard) return [];

  const allScoredItems: RankedProductCandidate[] = [
    ...(leaderboard.topThree || []),
    ...(leaderboard.provisionalCandidates || []),
    ...(leaderboard.remainingCandidates || []),
    ...(leaderboard.insufficientEvidenceCandidates || []),
  ];

  const rawShortlistArray: any[] =
    leaderboard.researchShortlist?.shortlist ||
    (leaderboard.researchShortlist as any)?.items ||
    [];
  const shortlistArray: DiscoveredProductCandidate[] = rawShortlistArray
    .map((item: any) => item?.candidate || item)
    .filter(Boolean);

  const shortlistIdSet = new Set<string>(
    shortlistArray.map((c: any) => c.candidateId)
  );

  const findScoredItem = (cand: DiscoveredProductCandidate): RankedProductCandidate | null => {
    return (
      allScoredItems.find(
        (item) =>
          item.candidate.candidateId === cand.candidateId ||
          (cand.productKey && item.candidate.productKey === cand.productKey) ||
          (cand.canonicalProductUrl &&
            item.candidate.canonicalProductUrl === cand.canonicalProductUrl)
      ) || null
    );
  };

  const seenKeys = new Set<string>();
  const results: CanonicalRecommendedProduct[] = [];

  const tryAddCandidate = (
    candidate: DiscoveredProductCandidate,
    rankedItem: RankedProductCandidate | null,
    tier: CanonicalQualificationTier,
    isShortlisted: boolean
  ) => {
    // Never recommend an excluded or audience-mismatched product
    if (candidate.relevanceStatus === "REJECTED" || candidate.relevanceStatus === "IRRELEVANT") return;
    if (
      candidate.audienceRelevance &&
      candidate.audienceRelevance.eligibleForPrimaryShortlist === false
    ) {
      return;
    }
    if (
      candidate.productRealityStatus === "REJECTED_NON_PRODUCT" ||
      candidate.productRealityStatus === "UNVERIFIED_SITE_SHELL"
    ) {
      return;
    }

    const keys = getCanonicalDedupeKeys(candidate);
    if (keys.some((k) => seenKeys.has(k))) {
      return;
    }
    keys.forEach((k) => seenKeys.add(k));

    const score = rankedItem?.score;
    const displayTitle =
      candidate.merchantVerifiedProductName ||
      candidate.canonicalProductName ||
      candidate.displayName ||
      candidate.title;

    // V12.4.3.2.1 Section 8: Merchant page is ONLY verified when identityStatus === "VERIFIED"
    // AND fetchOutcome did not fail with HTTP_ERROR / HTTP_404 / NON_PRODUCT_PAGE / HOMEPAGE
    const rawFetchOutcome =
      candidate.fetchOutcome || (candidate as any).identityEvidence?.fetchOutcome || null;
    const merchantPageVerified = Boolean(
      candidate.identityStatus === "VERIFIED" &&
        rawFetchOutcome !== "HTTP_ERROR" &&
        rawFetchOutcome !== "HTTP_404" &&
        rawFetchOutcome !== "NON_PRODUCT_PAGE" &&
        rawFetchOutcome !== "HOMEPAGE"
    );

    const titleSourceLabel =
      candidate.merchantVerifiedProductName && merchantPageVerified
        ? "Merchant-Verified Title"
        : "Ad-Claimed Product Name";

    const audience = resolveAudienceBadge(candidate);

    // V12.4.3.2.1 Section 9: Separate current-run live ads vs current-run cached ads vs product distinct ads vs total observations
    const obsArray: any[] = Array.isArray(candidate.sourceObservations)
      ? candidate.sourceObservations
      : [];
    const currentRunLiveAdsCount = obsArray.filter(
      (o) => o?.provenance === "LIVE_PROVIDER"
    ).length;
    const currentRunCachedAdsCount = Math.max(
      0,
      obsArray.length - currentRunLiveAdsCount
    );
    const supportingAdCount =
      (Array.isArray(candidate.supportingAdIds) && candidate.supportingAdIds.length > 0
        ? candidate.supportingAdIds.length
        : obsArray.length) || 1;
    const obsCount = Math.max(
      supportingAdCount,
      candidate.totalObservationCount || obsArray.length || 1
    );
    const distinctAdvertisersCount =
      candidate.distinctAdvertisersCount ||
      (Array.isArray(candidate.advertiserNames) ? candidate.advertiserNames.length : 1) ||
      1;

    let qualificationBadgeLabel = "Provisional · Needs Demand History";
    let qualificationTone: "emerald" | "amber" | "slate" = "slate";
    if (tier === "VERIFIED_EVERGREEN") {
      qualificationBadgeLabel = "Verified Evergreen";
      qualificationTone = "emerald";
    } else if (tier === "RESEARCH_QUALIFIED") {
      qualificationBadgeLabel =
        currentRunLiveAdsCount > 0
          ? "Research Shortlist · Live & Historical Evidence"
          : "Research Shortlist · Historical Evidence";
      qualificationTone = "amber";
    }

    // V12.4.3.2.1 Section 8.3: Build truthful, separated evidence checklist items
    const verifiedEvidenceItems: string[] = [];
    if (merchantPageVerified) {
      verifiedEvidenceItems.push("Merchant product page verified");
    } else {
      verifiedEvidenceItems.push("Ad-supported product (merchant page unverified)");
    }

    if (
      candidate.productRealityStatus === "VERIFIED_PHYSICAL_PRODUCT" ||
      candidate.productRealityStatus === "EVIDENCE_SUPPORTED_PHYSICAL_PRODUCT"
    ) {
      verifiedEvidenceItems.push("Physical product supported");
    }

    const sources =
      candidate.supportingSourceTypes && candidate.supportingSourceTypes.length > 0
        ? candidate.supportingSourceTypes.map((s: any) =>
            s === "META_ADS"
              ? "Meta Ads"
              : s === "GOOGLE_ADS_TRANSPARENCY" || s === "GOOGLE_ADS"
              ? "Google Ads"
              : s
          )
        : ["Meta Ads"];

    if (currentRunLiveAdsCount > 0) {
      verifiedEvidenceItems.push(
        `Live ads observed (${currentRunLiveAdsCount} in current run)`
      );
    }
    verifiedEvidenceItems.push(
      `Historical advertising observations: ${supportingAdCount} distinct ad${
        supportingAdCount === 1 ? "" : "s"
      } · ${obsCount} total obs (${sources.join(", ")})`
    );

    if (candidate.aiIntelligence?.aiExecuted) {
      verifiedEvidenceItems.push("AI product classification verified");
    }

    const missingRequirements: string[] = [];
    if (!merchantPageVerified) {
      missingRequirements.push(
        candidate.fetchOutcome === "HTTP_ERROR"
          ? "Merchant product page returned HTTP error during live verification"
          : "Direct merchant product page verification still needed"
      );
    }
    if (tier !== "VERIFIED_EVERGREEN") {
      if (score?.missingEvidence && score.missingEvidence.length > 0) {
        for (const m of score.missingEvidence.slice(0, 2)) {
          if (!missingRequirements.includes(m)) {
            missingRequirements.push(m);
          }
        }
      } else {
        missingRequirements.push(
          "6–12 month authoritative non-declining demand history required for Verified Evergreen status"
        );
      }
    }

    // V12.4.3.2.1 Section 10: Buyer/seller-oriented "Why it fits your search"
    const whyItMatters = buildBuyerOrientedWhyItFits(
      candidate,
      leaderboard.topic,
      audience.label,
      merchantPageVerified
    );

    const technicalVerificationSummary =
      candidate.verificationReason ||
      (merchantPageVerified
        ? `Merchant product page verified on ${candidate.storeDomain || "storefront"}.`
        : `Ad-supported candidate (${candidate.fetchOutcome || "merchant page unverified"}).`);

    const resolvedPrimaryMedia = resolveCandidatePrimaryMedia(
      candidate,
      merchantPageVerified
    );

    const modelParts = [candidate.model, candidate.sku, candidate.gtin].filter(Boolean);

    results.push({
      rank: results.length + 1,
      candidateId: candidate.candidateId,
      productKey: candidate.productKey || candidate.candidateId,
      title: displayTitle,
      titleSourceLabel,
      storeDomain: candidate.storeDomain || null,
      canonicalProductUrl: candidate.canonicalProductUrl || null,
      thumbnailUrl: resolvedPrimaryMedia.thumbnailUrl,
      videoUrl: candidate.videoUrl || null,
      primaryMediaSourceLabel: resolvedPrimaryMedia.primaryMediaSourceLabel,
      familyLabel:
        candidate.familyLabel ||
        candidate.familyKey?.replace(/_/g, " ") ||
        candidate.category ||
        "Physical Product",
      familyKey: candidate.familyKey || "general_product",
      modelOrSku: modelParts.length > 0 ? modelParts.join(" · ") : null,
      qualificationTier: tier,
      qualificationBadgeLabel,
      qualificationTone,
      isShortlisted,
      merchantPageVerified,
      opportunityScore: score?.opportunityScore ?? null,
      scoreStatusLabel: formatBusinessTerm(score?.scoreStatus || "PROVISIONAL"),
      scoreStatusCode: score?.scoreStatus || "PROVISIONAL",
      evidenceConfidence:
        score?.evidenceConfidence ??
        Math.round((Number(candidate.identityConfidence) || 0.7) * 100),
      observationCount: obsCount,
      supportingAdCount,
      currentRunLiveAdsCount,
      currentRunCachedAdsCount,
      distinctAdvertisersCount,
      supportingSources: sources,
      audienceBadgeLabel: audience.label,
      audienceFitStatus: audience.status,
      whyItMatters,
      technicalVerificationSummary,
      verifiedEvidenceItems,
      missingRequirements,
      researchProductId: candidate.researchProductId || null,
      distinctnessNote:
        candidate.distinctnessRole === "SAME_FAMILY_MODEL_ALTERNATIVE"
          ? "Alternative model/merchant in same product family"
          : null,
      rawCandidate: candidate,
      rawRankedItem: rankedItem,
    });
  };

  // 1. Verified Evergreen Top 3
  for (const item of leaderboard.topThree || []) {
    tryAddCandidate(
      item.candidate,
      item,
      "VERIFIED_EVERGREEN",
      shortlistIdSet.has(item.candidate.candidateId) || true
    );
  }

  // 2. Research Shortlist (Top 3 Products to Evaluate)
  for (const cand of shortlistArray) {
    const matched = findScoredItem(cand);
    const tier: CanonicalQualificationTier =
      matched?.score?.tier === "VERIFIED_EVERGREEN"
        ? "VERIFIED_EVERGREEN"
        : "RESEARCH_QUALIFIED";
    tryAddCandidate(cand, matched, tier, true);
  }

  // 3. Provisional Candidates (only if not already added above, capped at 6 total recommended cards)
  for (const item of leaderboard.provisionalCandidates || []) {
    if (results.length >= 6) break;
    tryAddCandidate(
      item.candidate,
      item,
      "PROVISIONAL",
      shortlistIdSet.has(item.candidate.candidateId)
    );
  }

  return results;
}

/**
 * Builds the consolidated deduplicated candidate list for Tab 2 ("All Candidates").
 */
export function buildAllCandidatesExplorerList(
  leaderboard: EvergreenLeaderboardResponse | null | undefined
): ExplorerCandidateRow[] {
  if (!leaderboard) return [];

  const seenCandidateIds = new Set<string>();
  const rows: ExplorerCandidateRow[] = [];

  const shortlistIds = new Set(
    (leaderboard.researchShortlist?.shortlist || []).map((c: any) => c.candidateId)
  );
  const evergreenIds = new Set(
    (leaderboard.topThree || []).map((r: any) => r.candidate.candidateId)
  );
  const rankedSnapshotIds = new Set<string>([
    ...(leaderboard.topThree || []).map((r: any) => r.candidate?.candidateId),
    ...(leaderboard.provisionalCandidates || []).map((r: any) => r.candidate?.candidateId),
    ...(leaderboard.remainingCandidates || []).map((r: any) => r.candidate?.candidateId),
  ].filter(Boolean));

  const addEntry = (
    candidate: DiscoveredProductCandidate,
    rankedItem: RankedProductCandidate | null,
    defaultBucket: ExplorerCandidateStatus
  ) => {
    if (!candidate?.candidateId || seenCandidateIds.has(candidate.candidateId)) return;
    seenCandidateIds.add(candidate.candidateId);

    let explorerStatus: ExplorerCandidateStatus = defaultBucket;
    if (
      defaultBucket === "EXCLUDED" ||
      candidate.relevanceStatus === "REJECTED" ||
      candidate.relevanceStatus === "IRRELEVANT" ||
      candidate.productRealityStatus === "REJECTED_NON_PRODUCT" ||
      candidate.productRealityStatus === "UNVERIFIED_SITE_SHELL" ||
      (candidate.audienceRelevance &&
        candidate.audienceRelevance.eligibleForPrimaryShortlist === false)
    ) {
      explorerStatus = "EXCLUDED";
    } else if (
      evergreenIds.has(candidate.candidateId) ||
      shortlistIds.has(candidate.candidateId)
    ) {
      explorerStatus = "RESEARCH_QUALIFIED";
    } else if (candidate.identityStatus === "UNVERIFIED") {
      explorerStatus = "NEEDS_VERIFICATION";
    }

    let statusBadgeLabel = "Provisional";
    let statusTone: "emerald" | "amber" | "slate" | "rose" = "amber";
    if (explorerStatus === "RESEARCH_QUALIFIED") {
      statusBadgeLabel = evergreenIds.has(candidate.candidateId)
        ? "Verified Evergreen"
        : "Research Qualified";
      statusTone = "emerald";
    } else if (explorerStatus === "NEEDS_VERIFICATION") {
      statusBadgeLabel = "Needs Verification";
      statusTone = "slate";
    } else if (explorerStatus === "EXCLUDED") {
      statusBadgeLabel = "Excluded";
      statusTone = "rose";
    }

    const audience = resolveAudienceBadge(candidate);
    const displayTitle =
      candidate.merchantVerifiedProductName ||
      candidate.canonicalProductName ||
      candidate.displayName ||
      candidate.title;

    const merchantPageVerified = Boolean(
      candidate.identityStatus === "VERIFIED" &&
        candidate.fetchOutcome !== "HTTP_ERROR" &&
        candidate.fetchOutcome !== "HTTP_404" &&
        candidate.fetchOutcome !== "NON_PRODUCT_PAGE" &&
        candidate.fetchOutcome !== "HOMEPAGE"
    );

    const sources =
      candidate.supportingSourceTypes && candidate.supportingSourceTypes.length > 0
        ? candidate.supportingSourceTypes.map((s: any) =>
            s === "META_ADS"
              ? "Meta Ads"
              : s === "GOOGLE_ADS_TRANSPARENCY" || s === "GOOGLE_ADS"
              ? "Google Ads"
              : s
          )
        : ["Meta Ads"];

    const plainEnglishReason =
      explorerStatus === "EXCLUDED"
        ? sanitizeRejectionOrRealityReason(candidate, rankedItem)
        : buildBuyerOrientedWhyItFits(
            candidate,
            leaderboard.topic,
            audience.label,
            merchantPageVerified
          );

    rows.push({
      candidateId: candidate.candidateId,
      productKey: candidate.productKey || candidate.candidateId,
      title: displayTitle,
      storeDomain: candidate.storeDomain || null,
      canonicalProductUrl: candidate.canonicalProductUrl || null,
      familyLabel:
        candidate.familyLabel ||
        candidate.familyKey?.replace(/_/g, " ") ||
        candidate.category ||
        "Physical Product",
      familyKey: candidate.familyKey || "general_product",
      explorerStatus,
      statusBadgeLabel,
      statusTone,
      identityLabel: merchantPageVerified
        ? "Merchant Page Verified"
        : formatBusinessTerm(
            candidate.identityStatus === "VERIFIED"
              ? "PROBABLE"
              : candidate.identityStatus || "PROBABLE"
          ),
      identityCode: merchantPageVerified
        ? "VERIFIED"
        : candidate.identityStatus === "VERIFIED"
        ? "PROBABLE"
        : candidate.identityStatus || "PROBABLE",
      realityLabel: formatBusinessTerm(
        candidate.productRealityStatus || "EVIDENCE_SUPPORTED_PHYSICAL_PRODUCT"
      ),
      realityCode:
        candidate.productRealityStatus || "EVIDENCE_SUPPORTED_PHYSICAL_PRODUCT",
      audienceBadgeLabel: audience.label,
      audienceFitStatus: audience.status,
      opportunityScore: rankedItem?.score?.opportunityScore ?? null,
      evidenceConfidence:
        rankedItem?.score?.evidenceConfidence ??
        Math.round((Number(candidate.identityConfidence) || 0.5) * 100),
      observationCount:
        candidate.totalObservationCount || candidate.supportingAdIds?.length || 1,
      supportingSources: sources,
      plainEnglishReason,
      rejectionReasonCode: candidate.rejectionDetail?.reasonCode || null,
      researchProductId: candidate.researchProductId || null,
      inRankedSnapshot: rankedSnapshotIds.has(candidate.candidateId),
      rawCandidate: candidate,
      rawRankedItem: rankedItem,
    });
  };

  for (const item of leaderboard.topThree || []) {
    addEntry(item.candidate, item, "RESEARCH_QUALIFIED");
  }
  for (const cand of leaderboard.researchShortlist?.shortlist || []) {
    const matched =
      [
        ...(leaderboard.topThree || []),
        ...(leaderboard.provisionalCandidates || []),
        ...(leaderboard.remainingCandidates || []),
      ].find((i) => i.candidate.candidateId === cand.candidateId) || null;
    addEntry(cand, matched, "RESEARCH_QUALIFIED");
  }
  for (const item of leaderboard.provisionalCandidates || []) {
    addEntry(item.candidate, item, "PROVISIONAL");
  }
  for (const item of leaderboard.remainingCandidates || []) {
    addEntry(item.candidate, item, "PROVISIONAL");
  }
  for (const item of leaderboard.insufficientEvidenceCandidates || []) {
    addEntry(item.candidate, item, "NEEDS_VERIFICATION");
  }
  for (const item of leaderboard.rejectedCandidates || []) {
    addEntry(item.candidate, item, "EXCLUDED");
  }

  return rows;
}
