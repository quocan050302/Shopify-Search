import type {
  DiscoveredProductCandidate,
  EvergreenLeaderboardResponse,
  RankedProductCandidate,
} from "../types";

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
  familyLabel: string;
  familyKey: string;
  modelOrSku: string | null;
  qualificationTier: CanonicalQualificationTier;
  qualificationBadgeLabel: string;
  qualificationTone: "emerald" | "amber" | "slate";
  opportunityScore: number | null;
  scoreStatusLabel: string;
  scoreStatusCode: string;
  evidenceConfidence: number;
  observationCount: number;
  supportingAdCount: number;
  supportingSources: string[];
  audienceBadgeLabel: string;
  audienceFitStatus: "MATCHED" | "COMPATIBLE_BROAD" | "MISMATCHED" | "NEUTRAL";
  whyItMatters: string;
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
    if (/AI Review classified candidate as non-physical entity/i.test(reason) && candidate.aiIntelligence?.commercialEntityType === "PHYSICAL_PRODUCT") {
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

  const hasFreshLiveAds =
    (leaderboard.sourceCoverage?.META_ADS?.freshLiveAdsCount ?? 0) > 0 ||
    (leaderboard.sourceCoverage?.GOOGLE_ADS_TRANSPARENCY?.freshLiveAdsCount ?? 0) > 0;

  const tryAddCandidate = (
    candidate: DiscoveredProductCandidate,
    rankedItem: RankedProductCandidate | null,
    tier: CanonicalQualificationTier
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
    const titleSourceLabel = candidate.merchantVerifiedProductName
      ? "Merchant-Verified Title"
      : "Ad-Claimed Product Name";

    const audience = resolveAudienceBadge(candidate);

    let qualificationBadgeLabel = "Provisional · Needs Demand History";
    let qualificationTone: "emerald" | "amber" | "slate" = "slate";
    if (tier === "VERIFIED_EVERGREEN") {
      qualificationBadgeLabel = "Verified Evergreen";
      qualificationTone = "emerald";
    } else if (tier === "RESEARCH_QUALIFIED") {
      qualificationBadgeLabel = hasFreshLiveAds
        ? "Research Qualified · Live & Historical Evidence"
        : "Research Qualified · Historical Evidence";
      qualificationTone = "amber";
    }

    const verifiedEvidenceItems: string[] = [];
    if (candidate.canonicalProductUrl || candidate.identityStatus === "VERIFIED") {
      verifiedEvidenceItems.push("Merchant product page verified");
    }
    if (
      candidate.productRealityStatus === "VERIFIED_PHYSICAL_PRODUCT" ||
      candidate.productRealityStatus === "EVIDENCE_SUPPORTED_PHYSICAL_PRODUCT"
    ) {
      verifiedEvidenceItems.push("Physical product confirmed");
    }
    const obsCount =
      candidate.totalObservationCount || candidate.supportingAdIds?.length || 1;
    const sources =
      candidate.supportingSourceTypes && candidate.supportingSourceTypes.length > 0
        ? candidate.supportingSourceTypes.map((s: any) =>
            s === "META_ADS" ? "Meta Ads" : s === "GOOGLE_ADS_TRANSPARENCY" ? "Google Ads" : s
          )
        : ["Meta Ads"];
    verifiedEvidenceItems.push(
      `${obsCount} ad observation${obsCount === 1 ? "" : "s"} (${sources.join(", ")})`
    );
    if (candidate.aiIntelligence?.aiExecuted) {
      verifiedEvidenceItems.push("AI product classification verified");
    }

    const missingRequirements: string[] = [];
    if (tier !== "VERIFIED_EVERGREEN") {
      if (score?.missingEvidence && score.missingEvidence.length > 0) {
        for (const m of score.missingEvidence.slice(0, 2)) {
          missingRequirements.push(m);
        }
      } else {
        missingRequirements.push(
          "6–12 month authoritative non-declining demand history required for Verified Evergreen status"
        );
      }
    }

    const whyItMatters =
      candidate.audienceRelevance?.relevanceReason &&
      candidate.audienceRelevance.audienceMatch === "EXACT"
        ? `${candidate.audienceRelevance.relevanceReason} Verified on ${candidate.storeDomain || "merchant storefront"} as a concrete sellable product.`
        : candidate.verificationReason ||
          score?.recommendationRationale ||
          `Concrete physical product in ${
            candidate.familyLabel || candidate.category || "your target niche"
          } supported by merchant page and advertising evidence.`;

    const modelParts = [candidate.model, candidate.sku, candidate.gtin].filter(Boolean);

    results.push({
      rank: results.length + 1,
      candidateId: candidate.candidateId,
      productKey: candidate.productKey || candidate.candidateId,
      title: displayTitle,
      titleSourceLabel,
      storeDomain: candidate.storeDomain || null,
      canonicalProductUrl: candidate.canonicalProductUrl || null,
      thumbnailUrl: candidate.thumbnailUrl || null,
      videoUrl: candidate.videoUrl || null,
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
      opportunityScore: score?.opportunityScore ?? null,
      scoreStatusLabel: formatBusinessTerm(score?.scoreStatus || "PROVISIONAL"),
      scoreStatusCode: score?.scoreStatus || "PROVISIONAL",
      evidenceConfidence: score?.evidenceConfidence ?? Math.round((candidate.identityConfidence || 0.7) * 100),
      observationCount: obsCount,
      supportingAdCount: candidate.supportingAdIds?.length || 1,
      supportingSources: sources,
      audienceBadgeLabel: audience.label,
      audienceFitStatus: audience.status,
      whyItMatters,
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
    tryAddCandidate(item.candidate, item, "VERIFIED_EVERGREEN");
  }

  // 2. Research Shortlist (Top 3 Products to Evaluate)
  for (const cand of leaderboard.researchShortlist?.shortlist || []) {
    const matched = findScoredItem(cand);
    const tier: CanonicalQualificationTier =
      matched?.score?.tier === "VERIFIED_EVERGREEN"
        ? "VERIFIED_EVERGREEN"
        : "RESEARCH_QUALIFIED";
    tryAddCandidate(cand, matched, tier);
  }

  // 3. Provisional Candidates (only if not already added above, capped at 6 total recommended cards)
  for (const item of leaderboard.provisionalCandidates || []) {
    if (results.length >= 6) break;
    tryAddCandidate(item.candidate, item, "PROVISIONAL");
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

  const seenKeys = new Set<string>();
  const rows: ExplorerCandidateRow[] = [];

  const shortlistIds = new Set(
    (leaderboard.researchShortlist?.shortlist || []).map((c: any) => c.candidateId)
  );
  const evergreenIds = new Set(
    (leaderboard.topThree || []).map((r: any) => r.candidate.candidateId)
  );

  const addEntry = (
    candidate: DiscoveredProductCandidate,
    rankedItem: RankedProductCandidate | null,
    defaultBucket: ExplorerCandidateStatus
  ) => {
    const keys = getCanonicalDedupeKeys(candidate);
    if (keys.some((k) => seenKeys.has(k))) return;
    keys.forEach((k) => seenKeys.add(k));

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
    } else if (evergreenIds.has(candidate.candidateId) || shortlistIds.has(candidate.candidateId)) {
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

    const sources =
      candidate.supportingSourceTypes && candidate.supportingSourceTypes.length > 0
        ? candidate.supportingSourceTypes.map((s: any) =>
            s === "META_ADS" ? "Meta Ads" : s === "GOOGLE_ADS_TRANSPARENCY" ? "Google Ads" : s
          )
        : ["Meta Ads"];

    const plainEnglishReason =
      explorerStatus === "EXCLUDED"
        ? sanitizeRejectionOrRealityReason(candidate, rankedItem)
        : candidate.verificationReason ||
          rankedItem?.score?.recommendationRationale ||
          "Physical product candidate discovered from advertising observations.";

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
      identityLabel: formatBusinessTerm(candidate.identityStatus || "PROBABLE"),
      identityCode: candidate.identityStatus || "PROBABLE",
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
        Math.round((candidate.identityConfidence || 0.5) * 100),
      observationCount:
        candidate.totalObservationCount || candidate.supportingAdIds?.length || 1,
      supportingSources: sources,
      plainEnglishReason,
      rejectionReasonCode: candidate.rejectionDetail?.reasonCode || null,
      researchProductId: candidate.researchProductId || null,
      rawCandidate: candidate,
      rawRankedItem: rankedItem,
    });
  };

  for (const item of leaderboard.topThree || []) {
    addEntry(item.candidate, item, "RESEARCH_QUALIFIED");
  }
  for (const cand of leaderboard.researchShortlist?.shortlist || []) {
    const matched = [
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
