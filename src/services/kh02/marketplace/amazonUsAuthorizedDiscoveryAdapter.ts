/**
 * SWAI KH-02 V12.4.3.5.0.2 — Authorized Amazon US Product Discovery Adapter & Non-Inflation Delta Calculator
 *
 * Implements Section 5A & Section 6 (BUG T2):
 * 1. deriveAmazonSearchIntents(candidate, niche, options): AmazonSearchIntent[]
 * 2. planAmazonDiscoveryBudget(candidates, remainingBudget, policy): AmazonDiscoveryPlan
 * 3. discoverAmazonProductsForCandidates(params): Promise<AmazonDiscoveryResult>
 * 4. selectAmazonCandidateMatches(candidate, listings): AmazonMatchDecision[]
 * 5. normalizeAmazonSearchItem(raw, invocation): NormalizedAmazonSearchItemResult
 * 6. computeAmazonNonInflationDelta(beforeSnapshot, afterSnapshot): AmazonNonInflationComparisonResult
 */

import {
  AmazonAccessPolicyStatus,
  AmazonPolicyContext,
  AmazonProductEvidence,
  AmazonProviderOperationRecord,
  IdentityMatch,
  MarketplaceEvidenceStatus,
  MarketplaceObservationClass,
  computeDeterministicEvidenceHash,
  resolveAmazonUsPolicyContext,
} from "./marketplaceEvidenceTypes";
import {
  canonicalizeAmazonProductIdentity,
  isValidStrictAmazonAsin,
  sanitizeUntrustedAmazonText,
  validateAmazonUsProductUrl,
  verifyAmazonProductIdentity,
} from "./amazonUsIdentity";
import {
  AMAZON_PILOT_MAX_ATTEMPTS_PER_OPERATION,
  AMAZON_PILOT_MAX_CANDIDATES_PER_RUN,
  AMAZON_PILOT_MAX_CONCURRENCY,
  AMAZON_PILOT_MAX_OPERATIONS_PER_RUN,
  AmazonProviderBudget,
  createAmazonProviderBudget,
} from "./amazonUsBudget";
import {
  CreatorsApiClient,
  RawCreatorsApiItem,
  resolveCreatorsApiEligibility,
} from "./amazonCreatorsApiClient";

export interface DiscoveryCandidateInput {
  candidateId: string;
  title?: string | null;
  canonicalProductName?: string | null;
  merchantVerifiedProductName?: string | null;
  brand?: string | null;
  storeDomain?: string | null;
  model?: string | null;
  sku?: string | null;
  gtin?: string | null;
  asin?: string | null;
  productFamily?: string | null;
  rawAdCopy?: string | null;
}

export interface AmazonSearchIntent {
  intentId: string;
  candidateId: string;
  normalizedKeywords: string;
  verifiedBrand: string | null;
  verifiedModel: string | null;
  intentRank: number;
  sourceProvenance:
    | "MERCHANT_VERIFIED_TITLE_AND_BRAND"
    | "CANONICAL_PRODUCT_AND_MODEL"
    | "CANDIDATE_TITLE_SPECIFIC"
    | "PRODUCT_FAMILY_FALLBACK";
  reason: string;
  suppressedTerms: string[];
}

export interface DeriveAmazonSearchIntentsOptions {
  maxIntentsPerCandidate?: number;
  maxKeywordLength?: number;
  maxTokens?: number;
}

const GENERIC_NICHE_TERMS = new Set([
  "pet gadgets",
  "pet supplies",
  "kitchen gadgets",
  "home gadgets",
  "winning products",
  "dropshipping",
  "gadgets",
  "products",
  "accessories",
  "best seller",
  "viral product",
]);

const UNTRUSTED_AD_NOISE_PATTERNS = [
  /\b(?:\d+%\s*off|free\s+shipping|buy\s+\d+\s+get\s+\d+|limited\s+time|shop\s+now|order\s+now|click\s+here|link\s+in\s+bio|sale\s+ends|discount|promo\s+code)\b/gi,
  /https?:\/\/\S+/gi,
  /[#@][A-Za-z0-9_]+/g,
];

function cleanCandidatePhrase(raw: string | null | undefined): {
  cleaned: string;
  suppressed: string[];
} {
  if (!raw || typeof raw !== "string") {
    return { cleaned: "", suppressed: [] };
  }
  const suppressed: string[] = [];
  const sanitized = sanitizeUntrustedAmazonText(raw);
  if (sanitized.warnings.length > 0) {
    suppressed.push(...sanitized.warnings);
  }
  let text = sanitized.sanitized || "";
  for (const pat of UNTRUSTED_AD_NOISE_PATTERNS) {
    const matches = text.match(pat);
    if (matches) {
      suppressed.push(...matches.map((m) => `AD_NOISE:${m.trim()}`));
      text = text.replace(pat, " ");
    }
  }
  text = text
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { cleaned: text, suppressed };
}

/**
 * Section 5A.1: Pure, deterministic search intent planner from verified candidate fields.
 * Never trusts raw ad copy as ASIN/SKU/brand and avoids generic niche queries when specific product identity exists.
 */
export function deriveAmazonSearchIntents(
  candidate: DiscoveryCandidateInput,
  niche: string,
  options: DeriveAmazonSearchIntentsOptions = {}
): AmazonSearchIntent[] {
  const maxIntents = Math.min(3, Math.max(1, options.maxIntentsPerCandidate ?? 2));
  const maxKeywordLength = Math.min(120, Math.max(24, options.maxKeywordLength ?? 96));
  const maxTokens = Math.min(12, Math.max(3, options.maxTokens ?? 9));

  const suppressedTerms: string[] = [];
  if (candidate.rawAdCopy) {
    suppressedTerms.push("RAW_AD_COPY_IGNORED_FOR_TRUSTED_IDENTIFIERS");
  }

  const brandClean = cleanCandidatePhrase(candidate.brand);
  suppressedTerms.push(...brandClean.suppressed);
  const verifiedBrand =
    brandClean.cleaned && brandClean.cleaned.length >= 2
      ? brandClean.cleaned.slice(0, 32)
      : null;

  const modelClean = cleanCandidatePhrase(candidate.model || candidate.sku);
  suppressedTerms.push(...modelClean.suppressed);
  const verifiedModel =
    modelClean.cleaned &&
    modelClean.cleaned.length >= 2 &&
    !/^(?:standard|default|none|null|n\/a)$/i.test(modelClean.cleaned)
      ? modelClean.cleaned.slice(0, 28)
      : null;

  const merchantTitleClean = cleanCandidatePhrase(
    candidate.merchantVerifiedProductName
  );
  const canonicalTitleClean = cleanCandidatePhrase(candidate.canonicalProductName);
  const baseTitleClean = cleanCandidatePhrase(candidate.title);
  const familyClean = cleanCandidatePhrase(candidate.productFamily);
  const nicheClean = cleanCandidatePhrase(niche);

  if (
    nicheClean.cleaned &&
    GENERIC_NICHE_TERMS.has(nicheClean.cleaned.toLowerCase())
  ) {
    suppressedTerms.push(`GENERIC_NICHE_SUPPRESSED:${nicheClean.cleaned}`);
  }

  const normalizeAndCapKeywords = (phrase: string): string | null => {
    const words = phrase
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2);
    const dedupedWords: string[] = [];
    const seenLower = new Set<string>();
    for (const w of words) {
      const l = w.toLowerCase();
      if (!seenLower.has(l)) {
        seenLower.add(l);
        dedupedWords.push(w);
      }
      if (dedupedWords.length >= maxTokens) break;
    }
    const joined = dedupedWords.join(" ").slice(0, maxKeywordLength).trim();
    if (!joined || joined.length < 3) return null;
    if (GENERIC_NICHE_TERMS.has(joined.toLowerCase())) return null;
    // Reject brand-only single-token queries
    if (
      dedupedWords.length === 1 &&
      verifiedBrand &&
      joined.toLowerCase() === verifiedBrand.toLowerCase()
    ) {
      suppressedTerms.push(`BRAND_ONLY_QUERY_REJECTED:${joined}`);
      return null;
    }
    return joined;
  };

  const candidatesList: Array<{
    rawPhrase: string;
    provenance: AmazonSearchIntent["sourceProvenance"];
    reason: string;
  }> = [];

  const primaryTitle =
    merchantTitleClean.cleaned ||
    canonicalTitleClean.cleaned ||
    baseTitleClean.cleaned;

  if (primaryTitle) {
    const withBrandAndModel = [verifiedBrand, primaryTitle, verifiedModel]
      .filter(Boolean)
      .join(" ");
    candidatesList.push({
      rawPhrase: withBrandAndModel,
      provenance: merchantTitleClean.cleaned
        ? "MERCHANT_VERIFIED_TITLE_AND_BRAND"
        : canonicalTitleClean.cleaned
        ? "CANONICAL_PRODUCT_AND_MODEL"
        : "CANDIDATE_TITLE_SPECIFIC",
      reason:
        "Primary candidate-specific query combining verified brand, specific product title, and model identifier.",
    });

    if (verifiedBrand && familyClean.cleaned && familyClean.cleaned !== primaryTitle) {
      candidatesList.push({
        rawPhrase: [verifiedBrand, familyClean.cleaned, verifiedModel]
          .filter(Boolean)
          .join(" "),
        provenance: "PRODUCT_FAMILY_FALLBACK",
        reason:
          "Secondary corroboration query combining verified brand and specific product family.",
      });
    }
  } else if (verifiedBrand && familyClean.cleaned) {
    candidatesList.push({
      rawPhrase: [verifiedBrand, familyClean.cleaned, verifiedModel]
        .filter(Boolean)
        .join(" "),
      provenance: "PRODUCT_FAMILY_FALLBACK",
      reason: "Fallback query using verified brand and product family.",
    });
  }

  const intents: AmazonSearchIntent[] = [];
  const seenNormalized = new Set<string>();

  for (const item of candidatesList) {
    const normalized = normalizeAndCapKeywords(item.rawPhrase);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seenNormalized.has(key)) continue;
    seenNormalized.add(key);

    const intentRank = intents.length + 1;
    const hash =
      computeDeterministicEvidenceHash(
        `${candidate.candidateId}:${intentRank}:${key}`
      )?.slice(0, 10) || String(intentRank);

    intents.push({
      intentId: `amz_intent_${candidate.candidateId}_${intentRank}_${hash}`,
      candidateId: candidate.candidateId,
      normalizedKeywords: normalized,
      verifiedBrand,
      verifiedModel,
      intentRank,
      sourceProvenance: item.provenance,
      reason: item.reason,
      suppressedTerms: Array.from(new Set(suppressedTerms)),
    });

    if (intents.length >= maxIntents) break;
  }

  return intents;
}

export interface AmazonDiscoveryPlan {
  maxCandidatesPerRun: number;
  maxTotalOperationsPerRun: number;
  remainingOperationsBudget: number;
  maxConcurrency: number;
  maxAttemptsPerOperation: number;
  policyAllowed: boolean;
  policyStatus: AmazonAccessPolicyStatus;
  selectedCandidateIds: string[];
  deferredCandidateIds: string[];
  plannedSearchOperationsCount: number;
  reservedGetItemsBatchCount: number;
  candidateQueryPlans: Array<{
    candidateId: string;
    primaryIntent: AmazonSearchIntent | null;
    backupIntents: AmazonSearchIntent[];
    suppressionReason: string | null;
  }>;
}

/**
 * Section 5A.2: Plans discovery operations within the strict shared budget
 * (max 3 candidates/run, max 4 total operations/run shared across search + detail + URL verification, concurrency=1).
 */
export function planAmazonDiscoveryBudget(
  candidates: DiscoveryCandidateInput[],
  remainingBudget: number,
  policy: AmazonPolicyContext,
  niche: string = ""
): AmazonDiscoveryPlan {
  const safeRemaining = Math.max(
    0,
    Math.min(AMAZON_PILOT_MAX_OPERATIONS_PER_RUN, Math.floor(remainingBudget))
  );
  const selectedCandidateIds: string[] = [];
  const deferredCandidateIds: string[] = [];
  const candidateQueryPlans: AmazonDiscoveryPlan["candidateQueryPlans"] = [];

  const seenFamilyQueryKeys = new Set<string>();

  for (const cand of candidates || []) {
    const intents = deriveAmazonSearchIntents(cand, niche);
    const primary = intents[0] || null;
    const backups = intents.slice(1);

    if (!primary) {
      deferredCandidateIds.push(cand.candidateId);
      candidateQueryPlans.push({
        candidateId: cand.candidateId,
        primaryIntent: null,
        backupIntents: [],
        suppressionReason: "NO_SPECIFIC_CANDIDATE_SEARCH_INTENT_DERIVED",
      });
      continue;
    }

    const queryKey = primary.normalizedKeywords.toLowerCase();
    if (seenFamilyQueryKeys.has(queryKey)) {
      deferredCandidateIds.push(cand.candidateId);
      candidateQueryPlans.push({
        candidateId: cand.candidateId,
        primaryIntent: primary,
        backupIntents: backups,
        suppressionReason: "DUPLICATE_NORMALIZED_QUERY_SUPPRESSED",
      });
      continue;
    }

    if (selectedCandidateIds.length >= AMAZON_PILOT_MAX_CANDIDATES_PER_RUN) {
      deferredCandidateIds.push(cand.candidateId);
      candidateQueryPlans.push({
        candidateId: cand.candidateId,
        primaryIntent: primary,
        backupIntents: backups,
        suppressionReason: `PILOT_CANDIDATE_CAP_REACHED_MAX_${AMAZON_PILOT_MAX_CANDIDATES_PER_RUN}`,
      });
      continue;
    }

    seenFamilyQueryKeys.add(queryKey);
    selectedCandidateIds.push(cand.candidateId);
    candidateQueryPlans.push({
      candidateId: cand.candidateId,
      primaryIntent: primary,
      backupIntents: backups,
      suppressionReason: null,
    });
  }

  // Prefer up to 3 SearchItems operations and reserve 1 GetItems batch if budget >= 4
  const maxSearchOps =
    safeRemaining >= 4
      ? Math.min(3, selectedCandidateIds.length)
      : Math.min(safeRemaining, selectedCandidateIds.length);
  const reservedGetItemsBatchCount =
    safeRemaining > maxSearchOps && maxSearchOps > 0 ? 1 : 0;

  return {
    maxCandidatesPerRun: AMAZON_PILOT_MAX_CANDIDATES_PER_RUN,
    maxTotalOperationsPerRun: AMAZON_PILOT_MAX_OPERATIONS_PER_RUN,
    remainingOperationsBudget: safeRemaining,
    maxConcurrency: AMAZON_PILOT_MAX_CONCURRENCY,
    maxAttemptsPerOperation: AMAZON_PILOT_MAX_ATTEMPTS_PER_OPERATION,
    policyAllowed: Boolean(policy.featureEnabled && policy.liveAllowed),
    policyStatus: policy.accessPolicyStatus,
    selectedCandidateIds: selectedCandidateIds.slice(0, maxSearchOps),
    deferredCandidateIds: [
      ...selectedCandidateIds.slice(maxSearchOps),
      ...deferredCandidateIds,
    ],
    plannedSearchOperationsCount: maxSearchOps,
    reservedGetItemsBatchCount,
    candidateQueryPlans,
  };
}

export interface NormalizeAmazonSearchItemInvocation {
  workspaceId: string;
  researchRunId: string;
  candidateId: string;
  providerInvocationRef: string;
  providerRequestId: string | null;
  observedAt: string;
  rawResponseHash: string | null;
  accessPolicyStatus: AmazonAccessPolicyStatus;
  observationClass?: MarketplaceObservationClass;
  imageLicensePermitted?: boolean;
}

export type NormalizedAmazonSearchItemResult =
  | {
      kind: "EVIDENCE";
      evidence: AmazonProductEvidence;
      licensedImageUrl: string | null;
    }
  | {
      kind: "REJECTED";
      asin: string | null;
      rejectionReason: string;
    };

/**
 * Section 5A.5: Normalizes an official Creators API item into AmazonProductEvidence.
 * Preserves nullable price/currency, licenses image only when permitted, validates canonical URL/ASIN,
 * and never invents US delivery or USD currency when absent.
 */
export function normalizeAmazonSearchItem(
  raw: RawCreatorsApiItem | null | undefined,
  invocation: NormalizeAmazonSearchItemInvocation
): NormalizedAmazonSearchItemResult {
  if (!raw || typeof raw !== "object") {
    return {
      kind: "REJECTED",
      asin: null,
      rejectionReason: "EMPTY_OR_INVALID_SEARCH_ITEM",
    };
  }

  const rawAsin = String(raw.ASIN || "").trim().toUpperCase();
  if (!isValidStrictAmazonAsin(rawAsin)) {
    return {
      kind: "REJECTED",
      asin: rawAsin || null,
      rejectionReason: `INVALID_ITEM_ASIN:${rawAsin || "MISSING"}`,
    };
  }

  const rawParentAsin = raw.ParentASIN
    ? String(raw.ParentASIN).trim().toUpperCase()
    : null;
  const validParentAsin =
    rawParentAsin && isValidStrictAmazonAsin(rawParentAsin) ? rawParentAsin : null;

  const detailUrl = raw.DetailPageURL
    ? String(raw.DetailPageURL).trim()
    : `https://www.amazon.com/dp/${rawAsin}`;
  const urlCheck = validateAmazonUsProductUrl(detailUrl);
  const canonicalUrl = urlCheck.valid
    ? urlCheck.canonicalAmazonUrl!
    : `https://www.amazon.com/dp/${rawAsin}`;

  // If DetailPageURL points to a non-US Amazon domain, reject immediately
  if (!urlCheck.valid && urlCheck.rejectionCode === "NON_US_AMAZON_MARKETPLACE") {
    return {
      kind: "REJECTED",
      asin: rawAsin,
      rejectionReason: `NON_US_DETAIL_PAGE_URL:${detailUrl}`,
    };
  }

  const titleSanitized = sanitizeUntrustedAmazonText(
    raw.ItemInfo?.Title?.DisplayValue
  );
  if (!titleSanitized.sanitized) {
    return {
      kind: "REJECTED",
      asin: rawAsin,
      rejectionReason: "MISSING_ITEM_TITLE",
    };
  }

  const brandSanitized = sanitizeUntrustedAmazonText(
    raw.ItemInfo?.ByLineInfo?.Brand?.DisplayValue ||
      raw.ItemInfo?.ByLineInfo?.Manufacturer?.DisplayValue
  );
  const modelSanitized = sanitizeUntrustedAmazonText(
    raw.ItemInfo?.ManufactureInfo?.Model?.DisplayValue ||
      raw.ItemInfo?.ManufactureInfo?.ItemPartNumber?.DisplayValue
  );
  const gtinRaw =
    raw.ItemInfo?.ExternalIds?.UPCs?.DisplayValues?.[0] ||
    raw.ItemInfo?.ExternalIds?.EANs?.DisplayValues?.[0] ||
    raw.ItemInfo?.ExternalIds?.ISBNs?.DisplayValues?.[0] ||
    null;
  const gtinSanitized = sanitizeUntrustedAmazonText(gtinRaw);

  const primaryListing =
    raw.Offers?.V2?.Listings?.[0] || raw.Offers?.Listings?.[0] || null;
  const rawAmount = primaryListing?.Price?.Amount;
  const rawCurrency = primaryListing?.Price?.Currency
    ? String(primaryListing.Price.Currency).trim().toUpperCase()
    : null;

  if (rawCurrency && rawCurrency !== "USD") {
    return {
      kind: "REJECTED",
      asin: rawAsin,
      rejectionReason: `NON_USD_OFFER_CURRENCY:${rawCurrency}`,
    };
  }

  // Price must remain null when absent or <= 0 (never convert missing price to 0)
  const price: number | null =
    typeof rawAmount === "number" && Number.isFinite(rawAmount) && rawAmount > 0
      ? Math.round(rawAmount * 100) / 100
      : null;
  const currency: string | null = price !== null ? rawCurrency || null : rawCurrency;

  const availabilitySanitized = sanitizeUntrustedAmazonText(
    primaryListing?.Availability?.Message || primaryListing?.Availability?.Type
  );
  const merchantSanitized = sanitizeUntrustedAmazonText(
    primaryListing?.MerchantInfo?.Name
  );

  // Image URL is included ONLY when official API license permits
  const rawImageUrl = raw.Images?.Primary?.Medium?.URL
    ? String(raw.Images.Primary.Medium.URL).trim()
    : null;
  const licensedImageUrl =
    invocation.imageLicensePermitted === true &&
    rawImageUrl &&
    rawImageUrl.startsWith("https://")
      ? rawImageUrl
      : null;

  const canonicalIdentity = canonicalizeAmazonProductIdentity({
    asin: rawAsin,
    parentAsin: validParentAsin,
    variationAsin:
      validParentAsin && validParentAsin !== rawAsin ? rawAsin : null,
    productTitle: titleSanitized.sanitized,
    brand: brandSanitized.sanitized,
    modelNumber: modelSanitized.sanitized,
    sku: null,
  });

  const missingFields: string[] = [];
  if (!canonicalIdentity.normalizedBrand) missingFields.push("brand");
  if (price === null) missingFields.push("price");
  if (!availabilitySanitized.sanitized) missingFields.push("availability");
  if (!merchantSanitized.sanitized) missingFields.push("merchantOrSeller");

  const extractedFieldsHash = computeDeterministicEvidenceHash({
    asin: canonicalIdentity.asin,
    parentAsin: canonicalIdentity.parentAsin,
    variationAsin: canonicalIdentity.variationAsin,
    canonicalAmazonUrl: canonicalUrl,
    productTitle: canonicalIdentity.normalizedTitle,
    brand: canonicalIdentity.normalizedBrand,
    merchant: merchantSanitized.sanitized,
    currency,
    price,
    availability: availabilitySanitized.sanitized,
    modelNumber: canonicalIdentity.modelNumber,
    gtin: gtinSanitized.sanitized,
  });

  const rawItemHash =
    computeDeterministicEvidenceHash({
      invocationResponseHash: invocation.rawResponseHash,
      rawItem: raw,
    }) || invocation.rawResponseHash;

  const idSeed = `${invocation.workspaceId}:${invocation.researchRunId}:${invocation.candidateId}:AMAZON_US:${canonicalIdentity.asin}`;
  const idHash =
    computeDeterministicEvidenceHash(idSeed)?.slice(0, 20) ||
    canonicalIdentity.asin;

  const observationClass: MarketplaceObservationClass =
    invocation.observationClass || "AUTHORIZED_LIVE";

  const evidence: AmazonProductEvidence = {
    id: `amz_ev_${idHash}`,
    workspaceId: invocation.workspaceId,
    researchRunId: invocation.researchRunId,
    candidateId: invocation.candidateId,
    provider: "AMAZON_US",
    requestMode: "AUTHORIZED_SEARCH",
    requestedMarket: "US",
    verifiedDeliveryMarket: null,
    sourceUrl: canonicalUrl,
    finalUrl: canonicalUrl,
    canonicalAmazonUrl: canonicalUrl,
    asin: canonicalIdentity.asin,
    parentAsin: canonicalIdentity.parentAsin,
    variationAsin: canonicalIdentity.variationAsin,
    productTitle: canonicalIdentity.normalizedTitle,
    brand: canonicalIdentity.normalizedBrand,
    merchant: merchantSanitized.sanitized,
    seller: merchantSanitized.sanitized,
    currency,
    price,
    availability: availabilitySanitized.sanitized,
    modelNumber: canonicalIdentity.modelNumber,
    sku: null,
    gtin: gtinSanitized.sanitized,
    observedAt: invocation.observedAt,
    sourceTimestamp: invocation.observedAt,
    rawEvidenceHash: rawItemHash,
    extractedFieldsHash,
    providerInvocationRef: invocation.providerInvocationRef,
    providerRequestId: invocation.providerRequestId,
    responseEvidenceRef: rawItemHash ? `amz_api:${rawItemHash.slice(0, 16)}` : null,
    evidenceOrigin:
      observationClass === "AUTHORIZED_LIVE"
        ? "AMAZON_US_CREATORS_API"
        : `AMAZON_US_${observationClass}`,
    providerSourceOrigin:
      observationClass === "AUTHORIZED_LIVE"
        ? "AUTHORIZED_CREATORS_API"
        : "TEST_FIXTURE",
    httpStatus: 200,
    httpStatusOrigin: "OBSERVED",
    observationClass,
    verificationScope: "LISTING_OBSERVED",
    identityMatch: "AMBIGUOUS",
    isCached: false,
    matchedCanonicalKey: canonicalIdentity.canonicalIdentityKey,
    matchingReasons: [`Observed Creators API ASIN ${canonicalIdentity.asin}`],
    missingFields,
    rejectionReasons: [],
    sanitizationWarnings: [
      ...titleSanitized.warnings,
      ...brandSanitized.warnings,
    ],
    accessPolicyStatus: invocation.accessPolicyStatus,
    status: "OBSERVED_UNVERIFIED",
  };

  return {
    kind: "EVIDENCE",
    evidence,
    licensedImageUrl,
  };
}

export interface AmazonMatchDecision {
  candidateId: string;
  asin: string;
  parentAsin: string | null;
  variationAsin: string | null;
  canonicalAmazonUrl: string | null;
  identityMatch: IdentityMatch;
  status: MarketplaceEvidenceStatus;
  rankScore: number;
  selectedAsBest: boolean;
  matchingReasons: string[];
  rejectionReasons: string[];
  updatedEvidence: AmazonProductEvidence;
}

function matchRankWeight(match: IdentityMatch): number {
  switch (match) {
    case "EXACT_PRODUCT":
      return 100;
    case "PROBABLE_PRODUCT":
      return 70;
    case "BRAND_ONLY":
      return 30;
    case "AMBIGUOUS":
      return 15;
    case "NO_MATCH":
    default:
      return 0;
  }
}

/**
 * Section 5A.4: Evaluates and ranks normalized Amazon listings against a KH-02 candidate
 * using verifyAmazonProductIdentity. Never promotes BRAND_ONLY or accessory mismatches to EXACT_PRODUCT.
 */
export function selectAmazonCandidateMatches(
  candidate: DiscoveryCandidateInput,
  listings: AmazonProductEvidence[]
): AmazonMatchDecision[] {
  const decisions: AmazonMatchDecision[] = [];

  for (const listing of listings || []) {
    if (!listing || !listing.asin) continue;
    const verified = verifyAmazonProductIdentity(candidate, listing);
    const baseWeight = matchRankWeight(verified.identityMatch);
    const hasPriceBonus = verified.updatedEvidence.price !== null ? 3 : 0;
    const hasModelBonus = verified.updatedEvidence.modelNumber ? 4 : 0;
    const rankScore = baseWeight + hasPriceBonus + hasModelBonus;

    decisions.push({
      candidateId: candidate.candidateId,
      asin: listing.asin,
      parentAsin: listing.parentAsin,
      variationAsin: listing.variationAsin,
      canonicalAmazonUrl: listing.canonicalAmazonUrl,
      identityMatch: verified.identityMatch,
      status: verified.status,
      rankScore,
      selectedAsBest: false,
      matchingReasons: verified.matchingReasons,
      rejectionReasons: verified.rejectionReasons,
      updatedEvidence: verified.updatedEvidence,
    });
  }

  decisions.sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    return a.asin.localeCompare(b.asin);
  });

  if (decisions.length > 0 && decisions[0].identityMatch !== "NO_MATCH") {
    decisions[0].selectedAsBest = true;
  }

  return decisions;
}

export interface DiscoverAmazonProductsParams {
  workspaceId: string;
  researchRunId: string;
  niche: string;
  candidates: DiscoveryCandidateInput[];
  policyContext?: AmazonPolicyContext;
  env?: Record<string, string | undefined>;
  budget?: AmazonProviderBudget;
  creatorsApiClient?: CreatorsApiClient | null;
  observationClassOverride?: MarketplaceObservationClass;
  signal?: AbortSignal;
}

export interface AmazonDiscoveryResult {
  runStatus: MarketplaceEvidenceStatus;
  accessPolicyStatus: AmazonAccessPolicyStatus;
  searchQueryPlan: AmazonDiscoveryPlan;
  providerRequestLedger: AmazonProviderOperationRecord[];
  rawAndNormalizedManifest: Array<{
    candidateId: string;
    asin: string | null;
    providerInvocationRef: string;
    providerRequestId: string | null;
    rawEvidenceHash: string | null;
    extractedFieldsHash: string | null;
    observedAt: string;
    status: MarketplaceEvidenceStatus;
    identityMatch: IdentityMatch | "REJECTED";
    rejectionReasons: string[];
  }>;
  matchAndIdentityLedger: Array<{
    candidateId: string;
    asin: string;
    parentAsin: string | null;
    variationAsin: string | null;
    identityMatch: IdentityMatch;
    status: MarketplaceEvidenceStatus;
    selectedAsBest: boolean;
    matchingReasons: string[];
    rejectionReasons: string[];
  }>;
  marketplaceEvidence: AmazonProductEvidence[];
}

/**
 * Section 5A.3: Executes bounded authorized Amazon product discovery for KH-02 candidates.
 * Checks policy and entitlement BEFORE making any network calls; never falls back to browser scraping.
 */
export async function discoverAmazonProductsForCandidates(
  params: DiscoverAmazonProductsParams
): Promise<AmazonDiscoveryResult> {
  const env = params.env || process.env;
  const eligibility = resolveCreatorsApiEligibility(env, {
    authenticated: Boolean(params.creatorsApiClient),
    transportVerified: Boolean(params.creatorsApiClient),
  });
  const policy =
    params.policyContext ||
    resolveAmazonUsPolicyContext(env, {
      creatorsApiEntitlementVerified: Boolean(params.creatorsApiClient),
    });

  const budget =
    params.budget ||
    createAmazonProviderBudget({
      workspaceId: params.workspaceId,
      researchRunId: params.researchRunId,
      signal: params.signal,
      isolatedCoordinator: true,
    });

  const snap = budget.getSnapshot();
  const remainingOps = Math.max(
    0,
    snap.maxOperationsPerRun - snap.operationsUsedInRun
  );
  const plan = planAmazonDiscoveryBudget(
    params.candidates,
    remainingOps,
    policy,
    params.niche
  );

  // 1. Policy OFF -> 0 network calls, DISABLED
  if (!policy.featureEnabled) {
    return {
      runStatus: "DISABLED",
      accessPolicyStatus: "DISABLED_BY_DEFAULT",
      searchQueryPlan: plan,
      providerRequestLedger: [],
      rawAndNormalizedManifest: [],
      matchAndIdentityLedger: [],
      marketplaceEvidence: [],
    };
  }

  // 2. Live not allowed -> 0 network calls, BLOCKED_POLICY
  if (!policy.liveAllowed) {
    return {
      runStatus: !eligibility.configured ? "CREDENTIALS_REQUIRED" : "BLOCKED_POLICY",
      accessPolicyStatus: !eligibility.configured
        ? "CREDENTIALS_REQUIRED"
        : policy.accessPolicyStatus,
      searchQueryPlan: plan,
      providerRequestLedger: [],
      rawAndNormalizedManifest: [],
      matchAndIdentityLedger: [],
      marketplaceEvidence: [],
    };
  }

  // 3. Missing credentials or uninitialized client -> 0 network calls, CREDENTIALS_REQUIRED / ACCESS_NOT_GRANTED
  if (!params.creatorsApiClient) {
    const blockedStatus: MarketplaceEvidenceStatus = !eligibility.configured
      ? "CREDENTIALS_REQUIRED"
      : "ACCESS_NOT_GRANTED";
    return {
      runStatus: blockedStatus,
      accessPolicyStatus: !eligibility.configured
        ? "CREDENTIALS_REQUIRED"
        : "ACCESS_NOT_GRANTED",
      searchQueryPlan: plan,
      providerRequestLedger: [],
      rawAndNormalizedManifest: [],
      matchAndIdentityLedger: [],
      marketplaceEvidence: [],
    };
  }

  const providerRequestLedger: AmazonProviderOperationRecord[] = [];
  const rawAndNormalizedManifest: AmazonDiscoveryResult["rawAndNormalizedManifest"] = [];
  const matchAndIdentityLedger: AmazonDiscoveryResult["matchAndIdentityLedger"] = [];
  const marketplaceEvidence: AmazonProductEvidence[] = [];

  const candidateById = new Map<string, DiscoveryCandidateInput>();
  for (const c of params.candidates) {
    candidateById.set(c.candidateId, c);
  }

  const matchedAsinsPendingDetail: Array<{
    candidate: DiscoveryCandidateInput;
    decision: AmazonMatchDecision;
  }> = [];

  for (const candId of plan.selectedCandidateIds) {
    if (params.signal?.aborted) break;
    const cand = candidateById.get(candId);
    const qPlan = plan.candidateQueryPlans.find((p) => p.candidateId === candId);
    if (!cand || !qPlan?.primaryIntent) continue;

    const searchRes = await params.creatorsApiClient.searchItemsByCandidateIntent(
      {
        candidateId: cand.candidateId,
        normalizedKeywords: qPlan.primaryIntent.normalizedKeywords,
        brand: qPlan.primaryIntent.verifiedBrand,
        model: qPlan.primaryIntent.verifiedModel,
        itemCount: 5,
      },
      {
        workspaceId: params.workspaceId,
        researchRunId: params.researchRunId,
        candidateId: cand.candidateId,
        budget,
        signal: params.signal,
      }
    );

    const observationClass: MarketplaceObservationClass =
      params.observationClassOverride || "AUTHORIZED_LIVE";

    providerRequestLedger.push({
      operationId: `amz_op_search_${searchRes.requestHash.slice(0, 12)}`,
      providerInvocationRef: searchRes.providerInvocationRef,
      providerRequestId: searchRes.upstreamRequestId,
      providerRequestIdOrigin: searchRes.upstreamRequestId ? "UPSTREAM" : "ABSENT",
      workspaceId: params.workspaceId,
      researchRunId: params.researchRunId,
      candidateId: cand.candidateId,
      provider: "AMAZON_US",
      requestMode: "AUTHORIZED_SEARCH",
      sourceUrl: `https://creatorsapi.amazon/catalog/v1/searchItems?k=${encodeURIComponent(
        qPlan.primaryIntent.normalizedKeywords
      )}`,
      finalUrl: null,
      attemptCount: searchRes.attempted ? 1 : 0,
      maxAttemptsAllowed: AMAZON_PILOT_MAX_ATTEMPTS_PER_OPERATION,
      startedAt: searchRes.startedAt,
      completedAt: searchRes.completedAt,
      durationMs: searchRes.durationMs,
      requestHash: searchRes.requestHash,
      responseHash: searchRes.rawResponseHash,
      status: searchRes.status,
      outcomeCategory: searchRes.errorCode || searchRes.status,
      observationClass,
      transportSessionId: null,
      aborted: false,
      errorMessage: searchRes.errorMessage,
    });

    if (!searchRes.succeeded || searchRes.items.length === 0) {
      rawAndNormalizedManifest.push({
        candidateId: cand.candidateId,
        asin: null,
        providerInvocationRef: searchRes.providerInvocationRef,
        providerRequestId: searchRes.upstreamRequestId,
        rawEvidenceHash: searchRes.rawResponseHash,
        extractedFieldsHash: null,
        observedAt: searchRes.completedAt,
        status: searchRes.status,
        identityMatch: "NO_MATCH",
        rejectionReasons: searchRes.errorMessage ? [searchRes.errorMessage] : [],
      });
      continue;
    }

    const normalizedListings: AmazonProductEvidence[] = [];
    for (const rawItem of searchRes.items) {
      const norm = normalizeAmazonSearchItem(rawItem, {
        workspaceId: params.workspaceId,
        researchRunId: params.researchRunId,
        candidateId: cand.candidateId,
        providerInvocationRef: searchRes.providerInvocationRef,
        providerRequestId: searchRes.upstreamRequestId,
        observedAt: searchRes.completedAt,
        rawResponseHash: searchRes.rawResponseHash,
        accessPolicyStatus: policy.accessPolicyStatus,
        observationClass,
      });

      if (norm.kind === "REJECTED") {
        rawAndNormalizedManifest.push({
          candidateId: cand.candidateId,
          asin: norm.asin,
          providerInvocationRef: searchRes.providerInvocationRef,
          providerRequestId: searchRes.upstreamRequestId,
          rawEvidenceHash: searchRes.rawResponseHash,
          extractedFieldsHash: null,
          observedAt: searchRes.completedAt,
          status: "FAILED",
          identityMatch: "REJECTED",
          rejectionReasons: [norm.rejectionReason],
        });
      } else {
        normalizedListings.push(norm.evidence);
      }
    }

    const decisions = selectAmazonCandidateMatches(cand, normalizedListings);
    for (const d of decisions) {
      matchAndIdentityLedger.push({
        candidateId: d.candidateId,
        asin: d.asin,
        parentAsin: d.parentAsin,
        variationAsin: d.variationAsin,
        identityMatch: d.identityMatch,
        status: d.status,
        selectedAsBest: d.selectedAsBest,
        matchingReasons: d.matchingReasons,
        rejectionReasons: d.rejectionReasons,
      });
      rawAndNormalizedManifest.push({
        candidateId: d.candidateId,
        asin: d.asin,
        providerInvocationRef: d.updatedEvidence.providerInvocationRef || searchRes.providerInvocationRef,
        providerRequestId: d.updatedEvidence.providerRequestId,
        rawEvidenceHash: d.updatedEvidence.rawEvidenceHash,
        extractedFieldsHash: d.updatedEvidence.extractedFieldsHash,
        observedAt: d.updatedEvidence.observedAt,
        status: d.status,
        identityMatch: d.identityMatch,
        rejectionReasons: d.rejectionReasons,
      });
    }

    const bestDecision = decisions.find((d) => d.selectedAsBest) || decisions[0];
    if (bestDecision) {
      // If best decision is missing price or modelNumber and we have budget for a batched GetItems, queue it
      if (
        (bestDecision.updatedEvidence.price === null ||
          !bestDecision.updatedEvidence.modelNumber) &&
        plan.reservedGetItemsBatchCount > 0
      ) {
        matchedAsinsPendingDetail.push({
          candidate: cand,
          decision: bestDecision,
        });
      }
      marketplaceEvidence.push(bestDecision.updatedEvidence);
    }
  }

  // Optional single batched GetItems call if within shared 4-operation budget
  const postSearchBudgetSnap = budget.getSnapshot();
  if (
    matchedAsinsPendingDetail.length > 0 &&
    postSearchBudgetSnap.operationsUsedInRun < postSearchBudgetSnap.maxOperationsPerRun &&
    !params.signal?.aborted
  ) {
    const asinsToFetch = matchedAsinsPendingDetail.map((m) => m.decision.asin);
    const getItemsRes = await params.creatorsApiClient.getItemsByAsins(asinsToFetch, {
      workspaceId: params.workspaceId,
      researchRunId: params.researchRunId,
      candidateId: matchedAsinsPendingDetail[0].candidate.candidateId,
      budget,
      signal: params.signal,
    });

    const observationClass: MarketplaceObservationClass =
      params.observationClassOverride || "AUTHORIZED_LIVE";

    if (getItemsRes.attempted) {
      providerRequestLedger.push({
        operationId: `amz_op_getitems_${getItemsRes.requestHash.slice(0, 12)}`,
        providerInvocationRef: getItemsRes.providerInvocationRef,
        providerRequestId: getItemsRes.upstreamRequestId,
        providerRequestIdOrigin: getItemsRes.upstreamRequestId ? "UPSTREAM" : "ABSENT",
        workspaceId: params.workspaceId,
        researchRunId: params.researchRunId,
        candidateId: matchedAsinsPendingDetail[0].candidate.candidateId,
        provider: "AMAZON_US",
        requestMode: "AUTHORIZED_SEARCH",
        sourceUrl: `https://creatorsapi.amazon/catalog/v1/getItems?asins=${asinsToFetch.join(",")}`,
        finalUrl: null,
        attemptCount: 1,
        maxAttemptsAllowed: AMAZON_PILOT_MAX_ATTEMPTS_PER_OPERATION,
        startedAt: getItemsRes.startedAt,
        completedAt: getItemsRes.completedAt,
        durationMs: getItemsRes.durationMs,
        requestHash: getItemsRes.requestHash,
        responseHash: getItemsRes.rawResponseHash,
        status: getItemsRes.status,
        outcomeCategory: getItemsRes.errorCode || getItemsRes.status,
        observationClass,
        transportSessionId: null,
        aborted: false,
        errorMessage: getItemsRes.errorMessage,
      });
    }

    if (getItemsRes.succeeded && getItemsRes.items.length > 0) {
      const detailByAsin = new Map<string, RawCreatorsApiItem>();
      for (const item of getItemsRes.items) {
        if (item.ASIN) detailByAsin.set(item.ASIN.trim().toUpperCase(), item);
      }

      for (let i = 0; i < marketplaceEvidence.length; i++) {
        const existingEv = marketplaceEvidence[i];
        if (!existingEv.asin) continue;
        const detailRaw = detailByAsin.get(existingEv.asin);
        const cand = candidateById.get(existingEv.candidateId);
        if (!detailRaw || !cand) continue;

        const normDetail = normalizeAmazonSearchItem(detailRaw, {
          workspaceId: params.workspaceId,
          researchRunId: params.researchRunId,
          candidateId: cand.candidateId,
          providerInvocationRef: getItemsRes.providerInvocationRef,
          providerRequestId: getItemsRes.upstreamRequestId,
          observedAt: getItemsRes.completedAt,
          rawResponseHash: getItemsRes.rawResponseHash,
          accessPolicyStatus: policy.accessPolicyStatus,
          observationClass,
        });
        if (normDetail.kind === "EVIDENCE") {
          const verifiedDetail = verifyAmazonProductIdentity(
            cand,
            normDetail.evidence
          );
          marketplaceEvidence[i] = verifiedDetail.updatedEvidence;
        }
      }
    }
  }

  let runStatus: MarketplaceEvidenceStatus = "NOT_ATTEMPTED";
  if (providerRequestLedger.length === 0) {
    runStatus = "NOT_ATTEMPTED";
  } else if (
    marketplaceEvidence.some(
      (e) => e.identityMatch === "EXACT_PRODUCT" && e.status === "IDENTITY_VERIFIED"
    )
  ) {
    runStatus = "IDENTITY_VERIFIED";
  } else if (marketplaceEvidence.length > 0) {
    runStatus = "OBSERVED_UNVERIFIED";
  } else if (
    providerRequestLedger.every((op) => op.status === "QUERY_SUCCEEDED_EMPTY")
  ) {
    runStatus = "QUERY_SUCCEEDED_EMPTY";
  } else {
    runStatus = providerRequestLedger[0].status;
  }

  return {
    runStatus,
    accessPolicyStatus: policy.accessPolicyStatus,
    searchQueryPlan: plan,
    providerRequestLedger,
    rawAndNormalizedManifest,
    matchAndIdentityLedger,
    marketplaceEvidence,
  };
}

export interface SnapshotForNonInflationComparison {
  runId?: string | null;
  topic?: string | null;
  cutoffIso?: string | null;
  sourceRevisionSha?: string | null;
  candidates: Array<{
    candidateId: string;
    rank?: number | null;
    opportunityScore: number;
    evidenceConfidence?: number;
    g07Passed?: boolean;
    g15Passed?: boolean;
    g16Passed?: boolean;
  }>;
}

export interface AmazonNonInflationComparisonResult {
  comparisonStatus: "COMPARED_ZERO_INFLATION" | "INFLATION_DETECTED" | "NOT_COMPARABLE";
  notComparableReason: string | null;
  beforeRunId: string | null;
  afterRunId: string | null;
  candidateCountBefore: number;
  candidateCountAfter: number;
  top3CandidateIdsBefore: string[];
  top3CandidateIdsAfter: string[];
  top3ScoresBefore: number[];
  top3ScoresAfter: number[];
  maxAbsoluteScoreDelta: number;
  rankOrderChanged: boolean;
  g07Changed: boolean;
  g15Changed: boolean;
  g16Changed: boolean;
  perCandidateComparisons: Array<{
    candidateId: string;
    rankBefore: number | null;
    rankAfter: number | null;
    scoreBefore: number;
    scoreAfter: number;
    scoreDelta: number;
    g07Before: boolean;
    g07After: boolean;
    g15Before: boolean;
    g15After: boolean;
    g16Before: boolean;
    g16After: boolean;
  }>;
}

/**
 * Section 6 (BUG T2 Fix): Dynamically computes before/after score, rank, and G07/G15/G16 deltas
 * from real replay snapshots. Never hardcodes [68, 64, 61]. Returns NOT_COMPARABLE if inputs are missing or incompatible.
 */
export function computeAmazonNonInflationDelta(
  beforeSnapshot: SnapshotForNonInflationComparison | null | undefined,
  afterSnapshot: SnapshotForNonInflationComparison | null | undefined
): AmazonNonInflationComparisonResult {
  if (
    !beforeSnapshot ||
    !afterSnapshot ||
    !Array.isArray(beforeSnapshot.candidates) ||
    !Array.isArray(afterSnapshot.candidates) ||
    beforeSnapshot.candidates.length === 0 ||
    afterSnapshot.candidates.length === 0
  ) {
    return {
      comparisonStatus: "NOT_COMPARABLE",
      notComparableReason:
        "Missing or empty before/after replay candidate snapshots.",
      beforeRunId: beforeSnapshot?.runId || null,
      afterRunId: afterSnapshot?.runId || null,
      candidateCountBefore: beforeSnapshot?.candidates?.length ?? 0,
      candidateCountAfter: afterSnapshot?.candidates?.length ?? 0,
      top3CandidateIdsBefore: [],
      top3CandidateIdsAfter: [],
      top3ScoresBefore: [],
      top3ScoresAfter: [],
      maxAbsoluteScoreDelta: 0,
      rankOrderChanged: false,
      g07Changed: false,
      g15Changed: false,
      g16Changed: false,
      perCandidateComparisons: [],
    };
  }

  if (
    beforeSnapshot.cutoffIso &&
    afterSnapshot.cutoffIso &&
    beforeSnapshot.cutoffIso !== afterSnapshot.cutoffIso
  ) {
    return {
      comparisonStatus: "NOT_COMPARABLE",
      notComparableReason: `Cutoff mismatch: before=${beforeSnapshot.cutoffIso} vs after=${afterSnapshot.cutoffIso}`,
      beforeRunId: beforeSnapshot.runId || null,
      afterRunId: afterSnapshot.runId || null,
      candidateCountBefore: beforeSnapshot.candidates.length,
      candidateCountAfter: afterSnapshot.candidates.length,
      top3CandidateIdsBefore: [],
      top3CandidateIdsAfter: [],
      top3ScoresBefore: [],
      top3ScoresAfter: [],
      maxAbsoluteScoreDelta: 0,
      rankOrderChanged: false,
      g07Changed: false,
      g15Changed: false,
      g16Changed: false,
      perCandidateComparisons: [],
    };
  }

  const afterById = new Map(
    afterSnapshot.candidates.map((c) => [c.candidateId, c])
  );

  const perCandidateComparisons: AmazonNonInflationComparisonResult["perCandidateComparisons"] =
    [];
  let maxAbsoluteScoreDelta = 0;
  let rankOrderChanged =
    beforeSnapshot.candidates.length !== afterSnapshot.candidates.length;
  let g07Changed = false;
  let g15Changed = false;
  let g16Changed = false;

  for (let i = 0; i < beforeSnapshot.candidates.length; i++) {
    const b = beforeSnapshot.candidates[i];
    const a = afterById.get(b.candidateId);
    if (!a) {
      return {
        comparisonStatus: "NOT_COMPARABLE",
        notComparableReason: `Candidate '${b.candidateId}' present in beforeSnapshot is missing in afterSnapshot.`,
        beforeRunId: beforeSnapshot.runId || null,
        afterRunId: afterSnapshot.runId || null,
        candidateCountBefore: beforeSnapshot.candidates.length,
        candidateCountAfter: afterSnapshot.candidates.length,
        top3CandidateIdsBefore: beforeSnapshot.candidates
          .slice(0, 3)
          .map((c) => c.candidateId),
        top3CandidateIdsAfter: afterSnapshot.candidates
          .slice(0, 3)
          .map((c) => c.candidateId),
        top3ScoresBefore: beforeSnapshot.candidates
          .slice(0, 3)
          .map((c) => c.opportunityScore),
        top3ScoresAfter: afterSnapshot.candidates
          .slice(0, 3)
          .map((c) => c.opportunityScore),
        maxAbsoluteScoreDelta: 0,
        rankOrderChanged: true,
        g07Changed: false,
        g15Changed: false,
        g16Changed: false,
        perCandidateComparisons: [],
      };
    }

    const scoreDelta = Number((a.opportunityScore - b.opportunityScore).toFixed(4));
    const absDelta = Math.abs(scoreDelta);
    if (absDelta > maxAbsoluteScoreDelta) {
      maxAbsoluteScoreDelta = absDelta;
    }

    const rankBefore = b.rank ?? i + 1;
    const rankAfter =
      a.rank ??
      afterSnapshot.candidates.findIndex((x) => x.candidateId === a.candidateId) + 1;
    if (rankBefore !== rankAfter) {
      rankOrderChanged = true;
    }

    const bG07 = Boolean(b.g07Passed);
    const aG07 = Boolean(a.g07Passed);
    const bG15 = Boolean(b.g15Passed);
    const aG15 = Boolean(a.g15Passed);
    const bG16 = Boolean(b.g16Passed);
    const aG16 = Boolean(a.g16Passed);

    if (bG07 !== aG07) g07Changed = true;
    if (bG15 !== aG15) g15Changed = true;
    if (bG16 !== aG16) g16Changed = true;

    perCandidateComparisons.push({
      candidateId: b.candidateId,
      rankBefore,
      rankAfter,
      scoreBefore: b.opportunityScore,
      scoreAfter: a.opportunityScore,
      scoreDelta,
      g07Before: bG07,
      g07After: aG07,
      g15Before: bG15,
      g15After: aG15,
      g16Before: bG16,
      g16After: aG16,
    });
  }

  const hasInflation =
    maxAbsoluteScoreDelta > 0 ||
    rankOrderChanged ||
    g07Changed ||
    g15Changed ||
    g16Changed;

  return {
    comparisonStatus: hasInflation
      ? "INFLATION_DETECTED"
      : "COMPARED_ZERO_INFLATION",
    notComparableReason: null,
    beforeRunId: beforeSnapshot.runId || null,
    afterRunId: afterSnapshot.runId || null,
    candidateCountBefore: beforeSnapshot.candidates.length,
    candidateCountAfter: afterSnapshot.candidates.length,
    top3CandidateIdsBefore: beforeSnapshot.candidates
      .slice(0, 3)
      .map((c) => c.candidateId),
    top3CandidateIdsAfter: afterSnapshot.candidates
      .slice(0, 3)
      .map((c) => c.candidateId),
    top3ScoresBefore: beforeSnapshot.candidates
      .slice(0, 3)
      .map((c) => c.opportunityScore),
    top3ScoresAfter: afterSnapshot.candidates
      .slice(0, 3)
      .map((c) => c.opportunityScore),
    maxAbsoluteScoreDelta,
    rankOrderChanged,
    g07Changed,
    g15Changed,
    g16Changed,
    perCandidateComparisons,
  };
}
