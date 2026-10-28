/**
 * SWAI KH-02 V12.4.3 — Evidence-Based Product Identity Resolver
 *
 * Implements strict evidence-based product identity resolution (Section 4):
 * - 4.1: URL (/products/<handle>) is a locator, NOT standalone proof of VERIFIED identity.
 * - 4.2: Ad copy is evidence about the ad creative; URL + copy from the same ad do NOT self-upgrade to VERIFIED.
 *        Raw headlines (Facebook Ad: <id>, creative IDs, campaign codes, generic categories, CTAs) never corroborate identity.
 * - 4.3: Merchant fetch failures (403, 404, timeout, captcha, non-HTML, collection, homepage, missing/contradictory metadata)
 *        preserve explicit uncertainty and never silently fall back to VERIFIED from URL slug.
 * - 4.4: VERIFIED requires verified merchant product page metadata, verified merchant product identifiers (ID/GTIN/SKU),
 *        or an existing linked ResearchProduct with valid verification provenance.
 * - 4.5: Preserves full identity evidence (requestedUrl, resolvedFinalUrl, declaredCanonicalUrl, normalizedProductUrl,
 *        storeDomain, merchantProductId, productName, brand, model, sku, gtin, variantId, imageReferences,
 *        pageClassification, fetchOutcome, evidenceTimestamp, verificationReason, verificationLimitations).
 * - 4.6: Never auto-verifies from unverified legacy ResearchProduct rows.
 * - 4.7: Preserves both ad and merchant claims on contradiction and blocks winner qualification.
 */

import { classifyAdvertisingHeadline } from "./adHeadlineClassifier";
import {
  extractProductUrlMetadata,
  fetchVerifiedProductPageMetadata,
  MerchantFetchOutcome,
  ProductMetadataEvidence,
} from "./productMetadataExtractor";
import { ProductMatchConfidence } from "../types";

export const KH02_IDENTITY_VERIFICATION_VERSION = "12.4.3";

export type ProductIdentityStatus =
  | "VERIFIED"
  | "PROBABLE"
  | "AMBIGUOUS"
  | "UNRESOLVED";

export interface ProductIdentity {
  canonicalProductName: string | null;
  canonicalName: string | null; // Compatibility alias
  displayName: string;
  displayTitle: string; // Compatibility alias
  adClaimedProductName?: string | null;
  merchantVerifiedProductName?: string | null;
  originalAdHeadline: string | null;
  originalCreativeCode: string | null;
  productType: string | null;
  brand: string | null;
  model: string | null;
  sku: string | null;
  gtin?: string | null;
  merchantProductId?: string | null;
  variantId: string | null;
  requestedUrl?: string | null;
  resolvedFinalUrl?: string | null;
  declaredCanonicalUrl?: string | null;
  normalizedProductUrl?: string | null;
  canonicalProductUrl: string | null;
  productUrl: string | null; // Compatibility alias
  landingPageUrl: string | null;
  storeDomain: string | null;
  category: string | null;
  imageReferences?: string[];
  pageClassification?: string | null;
  fetchOutcome?: MerchantFetchOutcome | "NOT_FETCHED";
  evidenceTimestamp?: string | null;
  identityStatus: ProductIdentityStatus;
  identityConfidence: ProductMatchConfidence;
  resolutionHierarchyLevel: number; // 1 to 7
  resolutionSource: string;
  verificationReason?: string;
  verificationLimitations?: string[];
  contradictions?: string[];
  hasUnresolvedContradiction?: boolean;
  identityEvidenceReferences: string[];
  requiresManualReview: boolean;
  isEligibleAsEvergreenWinner: boolean;
}

export interface CandidateIdentityInput {
  landingPageUrl?: string | null;
  rawLandingUrl?: string | null; // Compatibility alias
  landingUrl?: string | null; // Compatibility alias
  storeDomain?: string | null;
  advertiserDomain?: string | null; // Compatibility alias
  brandOrAdvertiser?: string | null;
  advertiserName?: string | null; // Compatibility alias
  advertiserNames?: string[]; // Compatibility alias
  rawHeadlines: string[];
  rawDescriptions?: string[];
  rawBodies?: string[]; // Compatibility alias
  existingResearchProductId?: string | null;
  existingProductTitle?: string | null;
  existingProductVerified?: boolean;
  existingProductVerificationProvenance?: string | null;
  existingProductVerificationVersion?: string | null;
  sourceReference?: string | null;
  verifiedMerchantTitle?: string | null;
  verifiedLandingPageTitle?: string | null; // Compatibility alias
  verifiedMerchantBrand?: string | null;
  verifiedPageType?: string | null;
  verifiedMerchantSku?: string | null;
  verifiedMerchantGtin?: string | null;
  verifiedMerchantModel?: string | null;
  verifiedMerchantProductId?: string | null;
  verifiedVariantId?: string | null;
  verifiedCanonicalUrl?: string | null;
  resolvedFinalUrl?: string | null;
  declaredCanonicalUrl?: string | null;
  normalizedProductUrl?: string | null;
  imageReferences?: string[];
  fetchOutcome?: MerchantFetchOutcome | "NOT_FETCHED";
  evidenceTimestamp?: string | null;
  verificationReason?: string | null;
  verificationLimitations?: string[];
  merchantContradictions?: string[];
}

export interface IdentityResolutionContext {
  timeoutMs?: number;
  metadataFetchEnabled?: boolean;
  metadataFetcher?: (url: string) => Promise<ProductMetadataEvidence>;
  fetchImpl?: typeof fetch;
  fetchFn?: typeof fetch;
}

function isLegitimateModelSuffix(model: string | null | undefined): boolean {
  if (!model) return false;
  const trimmed = model.trim();
  // Single-token model like "X200", "V3", "4G", "Pro", "M2", "T100" (not multi-token campaign experiment "Gg002 L1")
  if (/\s/.test(trimmed)) return false;
  if (/^(ad|fb|ig|tt|lp|camp|test|var|wmt|gg)\d+/i.test(trimmed)) return false;
  return /^[A-Za-z]{1,4}\d{1,4}[A-Za-z]?$|^\d{1,2}[A-Za-z]$/.test(trimmed);
}

function combineTitleAndModel(cleanTitle: string, model: string | null | undefined): string {
  if (!model || !isLegitimateModelSuffix(model)) return cleanTitle;
  const lowerTitle = cleanTitle.toLowerCase();
  const lowerModel = model.toLowerCase();
  if (lowerTitle.endsWith(` ${lowerModel}`) || lowerTitle === lowerModel) {
    return cleanTitle;
  }
  return `${cleanTitle} ${model}`.trim();
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "our", "from", "that", "this",
  "new", "best", "pro", "kit", "set", "pack", "edition", "original",
  "official", "premium", "smart", "portable", "electric", "automatic",
  "rechargeable", "cordless", "wireless", "mini", "ultra", "home",
  "multi", "purpose", "high", "quality", "heavy", "duty",
]);

/**
 * Checks whether an ad's claimed product name and a merchant's verified product name contradict each other.
 */
export function detectAdMerchantContradiction(
  adTitle: string | null | undefined,
  merchantTitle: string | null | undefined
): { contradicts: boolean; reason: string | null } {
  if (!adTitle || !merchantTitle) {
    return { contradicts: false, reason: null };
  }

  const adCls = classifyAdvertisingHeadline(adTitle);
  const merchCls = classifyAdvertisingHeadline(merchantTitle);

  if (!adCls.isEligibleAsProductName || !merchCls.isEligibleAsProductName) {
    return { contradicts: false, reason: null };
  }

  const adClean = (adCls.cleanTitle || adTitle).toLowerCase();
  const merchClean = (merchCls.cleanTitle || merchantTitle).toLowerCase();

  if (adClean === merchClean || adClean.includes(merchClean) || merchClean.includes(adClean)) {
    return { contradicts: false, reason: null };
  }

  const tokenize = (s: string) =>
    s
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));

  const adTokens = tokenize(adClean);
  const merchTokens = tokenize(merchClean);

  if (adTokens.length === 0 || merchTokens.length === 0) {
    return { contradicts: false, reason: null };
  }

  const SYNONYM_GROUPS: string[][] = [
    ["feeder", "dispenser", "bowl"],
    ["sprayer", "mister", "dispenser", "bottle", "pourer"],
    ["remover", "roller", "scraper", "cleaner", "brush", "zapper"],
    ["fountain", "drinker", "dispenser", "waterer"],
    ["tracker", "collar", "locator", "gps"],
    ["grinder", "trimmer", "clipper", "cutter", "shears"],
    ["scrubber", "brush", "cleaner", "mop"],
    ["lamp", "sconce", "light", "lighting"],
    ["cover", "slipcover", "protector", "mat", "pad", "liner"],
  ];

  const areSynonyms = (a: string, b: string) =>
    SYNONYM_GROUPS.some((grp) => grp.includes(a) && grp.includes(b));

  const hasOverlap = adTokens.some((t) =>
    merchTokens.some(
      (m) =>
        m === t ||
        areSynonyms(m, t) ||
        (m.length >= 4 &&
          t.length >= 4 &&
          (m.includes(t) ||
            t.includes(m) ||
            m.startsWith(t.slice(0, -1)) ||
            t.startsWith(m.slice(0, -1))))
    )
  );

  if (!hasOverlap) {
    return {
      contradicts: true,
      reason: `Ad creative claims product '${adCls.cleanTitle || adTitle}' whereas merchant page sells '${merchCls.cleanTitle || merchantTitle}' (zero shared product tokens).`,
    };
  }

  return { contradicts: false, reason: null };
}

/**
 * Resolves a factual product identity from advertising and landing page signals.
 * Enforces Section 4: URL slug + ad copy alone cannot produce VERIFIED without verified merchant metadata
 * or verified provenance.
 */
export function resolveProductIdentity(
  input: CandidateIdentityInput
): ProductIdentity {
  const targetUrl = input.landingPageUrl || input.rawLandingUrl || input.landingUrl || null;
  const effectiveUrlForMeta =
    input.normalizedProductUrl ||
    input.verifiedCanonicalUrl ||
    input.resolvedFinalUrl ||
    targetUrl;
  const urlMeta = extractProductUrlMetadata(effectiveUrlForMeta);
  const requestedUrlMeta = extractProductUrlMetadata(targetUrl);

  const storeDomain =
    urlMeta.storeDomain ||
    requestedUrlMeta.storeDomain ||
    input.storeDomain ||
    input.advertiserDomain ||
    null;
  const brand =
    input.verifiedMerchantBrand ||
    input.brandOrAdvertiser ||
    input.advertiserName ||
    null;
  const sourceRef = input.sourceReference || "Ad Creative";
  const firstHeadline = input.rawHeadlines?.[0] || null;
  const fetchOutcome: MerchantFetchOutcome | "NOT_FETCHED" =
    input.fetchOutcome || "NOT_FETCHED";
  const evidenceTimestamp = input.evidenceTimestamp || null;

  // Pre-classify all raw headlines to find any legitimate product titles
  const validProductHeadlines: Array<{
    cleanText: string;
    fullTextWithModel: string;
    model: string | null;
    raw: string;
    confidence: number;
  }> = [];

  for (const rawHeadline of input.rawHeadlines || []) {
    if (!rawHeadline) continue;
    const classification = classifyAdvertisingHeadline(rawHeadline);
    if (
      classification.headlineClass === "PRODUCT_CANDIDATE" &&
      classification.isEligibleAsProductName &&
      classification.cleanTitle
    ) {
      const model = classification.extractedModelOrSku || null;
      validProductHeadlines.push({
        cleanText: classification.cleanTitle,
        fullTextWithModel: combineTitleAndModel(classification.cleanTitle, model),
        model,
        raw: rawHeadline,
        confidence: classification.confidence,
      });
    }
  }

  // Sort valid headlines: prefer descriptive 3-8 words
  validProductHeadlines.sort((a, b) => {
    const aWords = a.fullTextWithModel.split(/\s+/).length;
    const bWords = b.fullTextWithModel.split(/\s+/).length;
    const aIdeal = aWords >= 3 && aWords <= 8 ? 1 : 0;
    const bIdeal = bWords >= 3 && bWords <= 8 ? 1 : 0;
    return bIdeal - aIdeal || b.fullTextWithModel.length - a.fullTextWithModel.length;
  });

  const bestAdHeadline = validProductHeadlines[0] || null;
  const adClaimedProductName = bestAdHeadline ? bestAdHeadline.fullTextWithModel : null;

  const baseCanonicalUrl =
    input.normalizedProductUrl ||
    urlMeta.normalizedBaseProductUrl ||
    urlMeta.cleanCanonicalUrl ||
    requestedUrlMeta.normalizedBaseProductUrl ||
    requestedUrlMeta.cleanCanonicalUrl ||
    targetUrl ||
    null;

  const resolvedVariantId =
    input.verifiedVariantId ||
    urlMeta.variantId ||
    requestedUrlMeta.variantId ||
    null;
  const resolvedSku =
    input.verifiedMerchantSku ||
    urlMeta.skuFromQuery ||
    requestedUrlMeta.skuFromQuery ||
    null;
  const resolvedGtin = input.verifiedMerchantGtin || null;
  const resolvedMerchantProductId =
    input.verifiedMerchantProductId ||
    urlMeta.queryProductId ||
    requestedUrlMeta.queryProductId ||
    null;
  const imageReferences = input.imageReferences || [];

  const limitations: string[] = [...(input.verificationLimitations || [])];
  const contradictions: string[] = [...(input.merchantContradictions || [])];

  // Check if merchant metadata was verified as an ACTUAL_PRODUCT_PAGE
  const explicitVerifiedMerchantTitle =
    input.verifiedMerchantTitle || (input as any).verifiedLandingPageTitle || null;
  const effectiveVerifiedPageType =
    input.verifiedPageType ||
    (explicitVerifiedMerchantTitle ? "ACTUAL_PRODUCT_PAGE" : undefined);

  const hasVerifiedMerchantPage =
    Boolean(explicitVerifiedMerchantTitle) &&
    effectiveVerifiedPageType === "ACTUAL_PRODUCT_PAGE" &&
    fetchOutcome !== "HTTP_403" &&
    fetchOutcome !== "HTTP_404" &&
    fetchOutcome !== "HTTP_ERROR" &&
    fetchOutcome !== "TIMEOUT" &&
    fetchOutcome !== "NETWORK_ERROR" &&
    fetchOutcome !== "CAPTCHA_OR_CHALLENGE" &&
    fetchOutcome !== "COLLECTION_PAGE" &&
    fetchOutcome !== "HOMEPAGE" &&
    fetchOutcome !== "CONTRADICTORY_METADATA";

  if (hasVerifiedMerchantPage && explicitVerifiedMerchantTitle) {
    const cleanedMerchantInput =
      explicitVerifiedMerchantTitle
        .replace(
          /^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}!*🔥📢⏰🎁🎃🛠️✨💥⚡🎉]*(?:(?:halloween|summer|spring|winter|holiday|black\s+friday|cyber\s+monday|flash|limited\s+time)\s+(?:deal|sale|offer|special)s?\s*[!|:\-–—]*\s*)?(?:\d+%\s*off\s*(?:today)?\s*[!|:\-–—]*\s*)?[\s\p{Emoji_Presentation}\p{Extended_Pictographic}!*🔥📢⏰🎁🎃🛠️✨💥⚡🎉]*/iu,
          ""
        )
        .trim() || explicitVerifiedMerchantTitle.trim();
    const merchantClassification = classifyAdvertisingHeadline(cleanedMerchantInput);
    const hasStrongIdentifiers = Boolean(
      resolvedSku || resolvedGtin || resolvedMerchantProductId
    );
    const merchantCleanTitle =
      merchantClassification.isEligibleAsProductName && merchantClassification.cleanTitle
        ? combineTitleAndModel(
            merchantClassification.cleanTitle,
            input.verifiedMerchantModel || merchantClassification.extractedModelOrSku
          )
        : hasStrongIdentifiers && cleanedMerchantInput.length >= 3
        ? cleanedMerchantInput
        : null;

    if (merchantCleanTitle) {
      const resolvedModel =
        input.verifiedMerchantModel ||
        merchantClassification.extractedModelOrSku ||
        bestAdHeadline?.model ||
        urlMeta.modelFromQuery ||
        null;

      // Section 4.7: Check contradiction between ad copy and merchant product metadata
      const contradictionCheck = detectAdMerchantContradiction(
        adClaimedProductName,
        merchantCleanTitle
      );

      if (contradictionCheck.contradicts && contradictionCheck.reason) {
        contradictions.push(contradictionCheck.reason);
      }

      if (contradictions.length > 0) {
        return {
          canonicalProductName: merchantCleanTitle,
          canonicalName: merchantCleanTitle,
          displayName: `${merchantCleanTitle} [Contradicts Ad: ${adClaimedProductName}]`,
          displayTitle: `${merchantCleanTitle} [Contradicts Ad: ${adClaimedProductName}]`,
          adClaimedProductName,
          merchantVerifiedProductName: merchantCleanTitle,
          originalAdHeadline: firstHeadline,
          originalCreativeCode: urlMeta.productHandle || null,
          productType: null,
          brand,
          model: resolvedModel,
          sku: resolvedSku,
          gtin: resolvedGtin,
          merchantProductId: resolvedMerchantProductId,
          variantId: resolvedVariantId,
          requestedUrl: targetUrl,
          resolvedFinalUrl: input.resolvedFinalUrl || targetUrl,
          declaredCanonicalUrl: input.declaredCanonicalUrl || null,
          normalizedProductUrl: baseCanonicalUrl,
          canonicalProductUrl: baseCanonicalUrl,
          productUrl: baseCanonicalUrl,
          landingPageUrl: targetUrl,
          storeDomain,
          category: null,
          imageReferences,
          pageClassification: "ACTUAL_PRODUCT_PAGE",
          fetchOutcome,
          evidenceTimestamp,
          identityStatus: "AMBIGUOUS",
          identityConfidence: "AMBIGUOUS",
          resolutionHierarchyLevel: 1,
          resolutionSource: "Contradictory Ad vs Merchant Product Metadata",
          verificationReason: contradictions.join(" "),
          verificationLimitations: [...limitations, ...contradictions],
          contradictions,
          hasUnresolvedContradiction: true,
          identityEvidenceReferences: [
            `Merchant Title: ${merchantCleanTitle}`,
            ...(adClaimedProductName ? [`Ad Claimed Title: ${adClaimedProductName}`] : []),
            `Canonical URL: ${baseCanonicalUrl}`,
            ...contradictions.map((c) => `Contradiction: ${c}`),
          ],
          requiresManualReview: true,
          isEligibleAsEvergreenWinner: false,
        };
      }

      const evRefs: string[] = [
        `Merchant Title: ${merchantCleanTitle}`,
        `Canonical URL: ${baseCanonicalUrl}`,
      ];
      if (resolvedMerchantProductId) evRefs.push(`Merchant Product ID: ${resolvedMerchantProductId}`);
      if (resolvedSku) evRefs.push(`Merchant SKU: ${resolvedSku}`);
      if (resolvedGtin) evRefs.push(`GTIN: ${resolvedGtin}`);
      if (resolvedModel) evRefs.push(`Model: ${resolvedModel}`);
      if (brand) evRefs.push(`Brand: ${brand}`);
      if (adClaimedProductName) evRefs.push(`Corroborating Ad Copy: ${adClaimedProductName}`);

      return {
        canonicalProductName: merchantCleanTitle,
        canonicalName: merchantCleanTitle,
        displayName: merchantCleanTitle,
        displayTitle: merchantCleanTitle,
        adClaimedProductName,
        merchantVerifiedProductName: merchantCleanTitle,
        originalAdHeadline: firstHeadline,
        originalCreativeCode: urlMeta.productHandle || null,
        productType: null,
        brand,
        model: resolvedModel,
        sku: resolvedSku,
        gtin: resolvedGtin,
        merchantProductId: resolvedMerchantProductId,
        variantId: resolvedVariantId,
        requestedUrl: targetUrl,
        resolvedFinalUrl: input.resolvedFinalUrl || targetUrl,
        declaredCanonicalUrl: input.declaredCanonicalUrl || null,
        normalizedProductUrl: baseCanonicalUrl,
        canonicalProductUrl: baseCanonicalUrl,
        productUrl: baseCanonicalUrl,
        landingPageUrl: targetUrl,
        storeDomain,
        category: null,
        imageReferences,
        pageClassification: "ACTUAL_PRODUCT_PAGE",
        fetchOutcome: fetchOutcome === "NOT_FETCHED" ? "VERIFIED_PRODUCT_PAGE" : fetchOutcome,
        evidenceTimestamp,
        identityStatus: "VERIFIED",
        identityConfidence: "EXACT",
        resolutionHierarchyLevel: 1,
        resolutionSource: "Verified Merchant Product Page Metadata",
        verificationReason:
          input.verificationReason ||
          "Verified via live merchant product page metadata and corroborating product schema.",
        verificationLimitations: limitations,
        contradictions: [],
        hasUnresolvedContradiction: false,
        identityEvidenceReferences: evRefs,
        requiresManualReview: false,
        isEligibleAsEvergreenWinner: true,
      };
    }
  }

  // Section 4.6: Existing linked ResearchProduct — only VERIFIED if it carries valid verification provenance!
  if (input.existingResearchProductId && input.existingProductTitle) {
    const existingCls = classifyAdvertisingHeadline(input.existingProductTitle);
    const hasValidProvenance =
      input.existingProductVerified === true &&
      (input.existingProductVerificationProvenance === "MERCHANT_PAGE_VERIFIED" ||
        input.existingProductVerificationProvenance === "MULTI_SOURCE_VERIFIED") &&
      (!input.existingProductVerificationVersion ||
        input.existingProductVerificationVersion === KH02_IDENTITY_VERIFICATION_VERSION);

    if (existingCls.isEligibleAsProductName && existingCls.cleanTitle) {
      const cleanExisting = combineTitleAndModel(
        existingCls.cleanTitle,
        existingCls.extractedModelOrSku
      );
      if (hasValidProvenance) {
        return {
          canonicalProductName: cleanExisting,
          canonicalName: cleanExisting,
          displayName: cleanExisting,
          displayTitle: cleanExisting,
          adClaimedProductName,
          merchantVerifiedProductName: cleanExisting,
          originalAdHeadline: firstHeadline,
          originalCreativeCode: urlMeta.productHandle || null,
          productType: null,
          brand,
          model: existingCls.extractedModelOrSku || bestAdHeadline?.model || null,
          sku: resolvedSku,
          gtin: resolvedGtin,
          merchantProductId: resolvedMerchantProductId,
          variantId: resolvedVariantId,
          requestedUrl: targetUrl,
          resolvedFinalUrl: input.resolvedFinalUrl || targetUrl,
          declaredCanonicalUrl: input.declaredCanonicalUrl || null,
          normalizedProductUrl: baseCanonicalUrl,
          canonicalProductUrl: baseCanonicalUrl,
          productUrl: baseCanonicalUrl,
          landingPageUrl: targetUrl,
          storeDomain,
          category: null,
          imageReferences,
          pageClassification: input.verifiedPageType || "ACTUAL_PRODUCT_PAGE",
          fetchOutcome,
          evidenceTimestamp,
          identityStatus: "VERIFIED",
          identityConfidence: "EXACT",
          resolutionHierarchyLevel: 2,
          resolutionSource: `Verified Linked ResearchProduct #${input.existingResearchProductId} (${input.existingProductVerificationProvenance})`,
          verificationReason: `Linked ResearchProduct #${input.existingResearchProductId} has verified provenance (${input.existingProductVerificationProvenance}).`,
          verificationLimitations: limitations,
          contradictions: [],
          hasUnresolvedContradiction: false,
          identityEvidenceReferences: [
            `ResearchProduct ID: ${input.existingResearchProductId}`,
            `Verification Provenance: ${input.existingProductVerificationProvenance}`,
          ],
          requiresManualReview: false,
          isEligibleAsEvergreenWinner: true,
        };
      } else {
        limitations.push(
          `Existing ResearchProduct #${input.existingResearchProductId} lacks verified merchant provenance; downgraded from VERIFIED to PROBABLE (Section 4.6).`
        );
      }
    }
  }

  // Handle explicit non-product page classifications from merchant fetch (Collection / Homepage / Article / Non-Product)
  const isFetchedCollectionOrHomepage =
    fetchOutcome === "COLLECTION_PAGE" ||
    fetchOutcome === "HOMEPAGE" ||
    fetchOutcome === "NON_PRODUCT_PAGE" ||
    input.verifiedPageType === "COLLECTION_PAGE" ||
    input.verifiedPageType === "HOMEPAGE" ||
    input.verifiedPageType === "ARTICLE_PAGE" ||
    input.verifiedPageType === "SERVICE_OR_LEADGEN_PAGE" ||
    urlMeta.isCollectionUrl ||
    urlMeta.isHomepageUrl;

  if (isFetchedCollectionOrHomepage) {
    const pageClass =
      fetchOutcome === "HOMEPAGE" || input.verifiedPageType === "HOMEPAGE" || urlMeta.isHomepageUrl
        ? "HOMEPAGE"
        : fetchOutcome === "NON_PRODUCT_PAGE" ||
          input.verifiedPageType === "ARTICLE_PAGE" ||
          input.verifiedPageType === "SERVICE_OR_LEADGEN_PAGE"
        ? (input.verifiedPageType || "ARTICLE_PAGE")
        : "COLLECTION_PAGE";
    limitations.push(
      `Landing URL resolves to ${pageClass} rather than a single-SKU product page.`
    );

    if (bestAdHeadline) {
      return {
        canonicalProductName: bestAdHeadline.fullTextWithModel,
        canonicalName: bestAdHeadline.fullTextWithModel,
        displayName: bestAdHeadline.fullTextWithModel,
        displayTitle: bestAdHeadline.fullTextWithModel,
        adClaimedProductName,
        merchantVerifiedProductName: null,
        originalAdHeadline: firstHeadline,
        originalCreativeCode: null,
        productType: null,
        brand,
        model: bestAdHeadline.model,
        sku: null,
        gtin: null,
        merchantProductId: null,
        variantId: null,
        requestedUrl: targetUrl,
        resolvedFinalUrl: input.resolvedFinalUrl || targetUrl,
        declaredCanonicalUrl: input.declaredCanonicalUrl || null,
        normalizedProductUrl: null,
        canonicalProductUrl: baseCanonicalUrl,
        productUrl: baseCanonicalUrl,
        landingPageUrl: targetUrl,
        storeDomain,
        category: null,
        imageReferences,
        pageClassification: pageClass,
        fetchOutcome,
        evidenceTimestamp,
        identityStatus: "PROBABLE",
        identityConfidence: "PROBABLE",
        resolutionHierarchyLevel: 5,
        resolutionSource: `Ad Creative Headline on ${pageClass} (Single SKU Unverified)`,
        verificationReason: `Ad copy identifies '${bestAdHeadline.fullTextWithModel}', but destination URL is a ${pageClass} without single-SKU verification.`,
        verificationLimitations: limitations,
        contradictions,
        hasUnresolvedContradiction: false,
        identityEvidenceReferences: [
          `Ad Headline: ${bestAdHeadline.raw}`,
          `Page Classification: ${pageClass}`,
        ],
        requiresManualReview: true,
        isEligibleAsEvergreenWinner: false,
      };
    }

    const fallbackDisplay = `Unidentified Product (${pageClass}: ${storeDomain || targetUrl || "Unknown"}, Review Required)`;
    return {
      canonicalProductName: null,
      canonicalName: null,
      displayName: fallbackDisplay,
      displayTitle: fallbackDisplay,
      adClaimedProductName: null,
      merchantVerifiedProductName: null,
      originalAdHeadline: firstHeadline,
      originalCreativeCode: null,
      productType: null,
      brand,
      model: null,
      sku: null,
      gtin: null,
      merchantProductId: null,
      variantId: null,
      requestedUrl: targetUrl,
      resolvedFinalUrl: input.resolvedFinalUrl || targetUrl,
      declaredCanonicalUrl: input.declaredCanonicalUrl || null,
      normalizedProductUrl: null,
      canonicalProductUrl: baseCanonicalUrl,
      productUrl: baseCanonicalUrl,
      landingPageUrl: targetUrl,
      storeDomain,
      category: null,
      imageReferences,
      pageClassification: pageClass,
      fetchOutcome,
      evidenceTimestamp,
      identityStatus: "UNRESOLVED",
      identityConfidence: "AMBIGUOUS",
      resolutionHierarchyLevel: 7,
      resolutionSource: `${pageClass} Without Specific Product Identity`,
      verificationReason: `Destination is a ${pageClass} and ad copy lacks a specific product name.`,
      verificationLimitations: limitations,
      contradictions,
      hasUnresolvedContradiction: false,
      identityEvidenceReferences: [`Page Classification: ${pageClass}`],
      requiresManualReview: true,
      isEligibleAsEvergreenWinner: false,
    };
  }

  // Level 1/3: Product-specific locator URL (/products/<handle>) WITHOUT verified merchant metadata
  // Section 4.1, 4.2, 4.3: URL + ad copy from the same ad is PROBABLE, NEVER VERIFIED!
  if (urlMeta.isShopifyProductUrl && urlMeta.derivedTitleFromSlug) {
    const slugClassification = classifyAdvertisingHeadline(urlMeta.derivedTitleFromSlug);

    if (
      slugClassification.headlineClass === "PRODUCT_CANDIDATE" &&
      slugClassification.isEligibleAsProductName &&
      slugClassification.cleanTitle
    ) {
      const slugTitleWithModel = combineTitleAndModel(
        slugClassification.cleanTitle,
        slugClassification.extractedModelOrSku
      );
      const canonicalName = bestAdHeadline
        ? bestAdHeadline.fullTextWithModel
        : slugTitleWithModel;
      const displayTitle = slugTitleWithModel;
      const resolvedModel =
        bestAdHeadline?.model ||
        slugClassification.extractedModelOrSku ||
        urlMeta.modelFromQuery ||
        null;

      if (fetchOutcome !== "NOT_FETCHED") {
        limitations.push(
          `Merchant metadata verification did not complete (${fetchOutcome}); URL slug and ad copy alone cannot establish VERIFIED status.`
        );
      } else {
        limitations.push(
          "Merchant product page metadata has not been verified yet; URL locator and ad copy establish PROBABLE identity only."
        );
      }

      // If merchant returned CAPTCHA or MISSING_METADATA and raw headline was only an Ad ID / non-product,
      // keep PROBABLE with explicit limitation (never VERIFIED!)
      return {
        canonicalProductName: canonicalName,
        canonicalName,
        displayName: displayTitle,
        displayTitle,
        adClaimedProductName,
        merchantVerifiedProductName: null,
        originalAdHeadline: firstHeadline,
        originalCreativeCode: urlMeta.productHandle || null,
        productType: null,
        brand,
        model: resolvedModel,
        sku: resolvedSku,
        gtin: resolvedGtin,
        merchantProductId: resolvedMerchantProductId,
        variantId: resolvedVariantId,
        requestedUrl: targetUrl,
        resolvedFinalUrl: input.resolvedFinalUrl || targetUrl,
        declaredCanonicalUrl: input.declaredCanonicalUrl || null,
        normalizedProductUrl: baseCanonicalUrl,
        canonicalProductUrl: baseCanonicalUrl,
        productUrl: baseCanonicalUrl,
        landingPageUrl: targetUrl,
        storeDomain,
        category: null,
        imageReferences,
        pageClassification:
          fetchOutcome === "NOT_FETCHED" || fetchOutcome === "MISSING_METADATA"
            ? "PRODUCT_LOCATOR_UNVERIFIED"
            : fetchOutcome,
        fetchOutcome,
        evidenceTimestamp,
        identityStatus: "PROBABLE",
        identityConfidence: bestAdHeadline ? "HIGH_CONFIDENCE" : "PROBABLE",
        resolutionHierarchyLevel: 3,
        resolutionSource:
          fetchOutcome === "NOT_FETCHED"
            ? `Product URL Locator (/products/${urlMeta.productHandle}) Pending Merchant Metadata Verification`
            : `Product URL Locator (/products/${urlMeta.productHandle}) with Unverified Merchant Fetch (${fetchOutcome})`,
        verificationReason:
          fetchOutcome === "NOT_FETCHED"
            ? `Identified candidate '${canonicalName}' from product URL locator /products/${urlMeta.productHandle}; awaiting live merchant metadata verification.`
            : `Merchant fetch returned ${fetchOutcome}; identity kept as PROBABLE from URL locator /products/${urlMeta.productHandle} (Section 4.3).`,
        verificationLimitations: limitations,
        contradictions,
        hasUnresolvedContradiction: false,
        identityEvidenceReferences: [
          `Product Handle: ${urlMeta.productHandle}`,
          `Canonical URL: ${baseCanonicalUrl}`,
          ...(bestAdHeadline ? [`Ad Copy Headline: ${bestAdHeadline.raw}`] : []),
          ...(fetchOutcome !== "NOT_FETCHED" ? [`Merchant Fetch Outcome: ${fetchOutcome}`] : []),
        ],
        requiresManualReview: fetchOutcome !== "NOT_FETCHED",
        isEligibleAsEvergreenWinner: false,
      };
    } else {
      // Slug is a campaign tag (e.g. "ad50fb") or raw SKU (e.g. "wmt004-1")
      if (bestAdHeadline) {
        limitations.push(
          `URL slug '${urlMeta.productHandle}' is a campaign/SKU code; product name derived from ad headline only.`
        );
        return {
          canonicalProductName: bestAdHeadline.fullTextWithModel,
          canonicalName: bestAdHeadline.fullTextWithModel,
          displayName: bestAdHeadline.fullTextWithModel,
          displayTitle: bestAdHeadline.fullTextWithModel,
          adClaimedProductName,
          merchantVerifiedProductName: null,
          originalAdHeadline: firstHeadline,
          originalCreativeCode: urlMeta.productHandle,
          productType: null,
          brand,
          model: bestAdHeadline.model,
          sku: resolvedSku,
          gtin: resolvedGtin,
          merchantProductId: resolvedMerchantProductId,
          variantId: resolvedVariantId,
          requestedUrl: targetUrl,
          resolvedFinalUrl: input.resolvedFinalUrl || targetUrl,
          declaredCanonicalUrl: input.declaredCanonicalUrl || null,
          normalizedProductUrl: baseCanonicalUrl,
          canonicalProductUrl: baseCanonicalUrl,
          productUrl: baseCanonicalUrl,
          landingPageUrl: targetUrl,
          storeDomain,
          category: null,
          imageReferences,
          pageClassification: "CAMPAIGN_SLUG_PRODUCT_URL",
          fetchOutcome,
          evidenceTimestamp,
          identityStatus: "PROBABLE",
          identityConfidence: "PROBABLE",
          resolutionHierarchyLevel: 4,
          resolutionSource: `Ad Headline (${bestAdHeadline.fullTextWithModel}) with Unverified Slug (/products/${urlMeta.productHandle})`,
          verificationReason: `Ad headline identifies '${bestAdHeadline.fullTextWithModel}', but URL slug '${urlMeta.productHandle}' is a non-descriptive code.`,
          verificationLimitations: limitations,
          contradictions,
          hasUnresolvedContradiction: false,
          identityEvidenceReferences: [
            `Ad Copy: ${bestAdHeadline.raw}`,
            `Campaign Slug: ${urlMeta.productHandle}`,
          ],
          requiresManualReview: true,
          isEligibleAsEvergreenWinner: false,
        };
      }

      const fallbackDisplayTitle = `Unidentified Product (Slug: /products/${urlMeta.productHandle}, Review Required)`;
      return {
        canonicalProductName: null,
        canonicalName: null,
        displayName: fallbackDisplayTitle,
        displayTitle: fallbackDisplayTitle,
        adClaimedProductName: null,
        merchantVerifiedProductName: null,
        originalAdHeadline: firstHeadline,
        originalCreativeCode: urlMeta.productHandle,
        productType: null,
        brand,
        model: null,
        sku: null,
        gtin: null,
        merchantProductId: null,
        variantId: null,
        requestedUrl: targetUrl,
        resolvedFinalUrl: input.resolvedFinalUrl || targetUrl,
        declaredCanonicalUrl: input.declaredCanonicalUrl || null,
        normalizedProductUrl: baseCanonicalUrl,
        canonicalProductUrl: baseCanonicalUrl,
        productUrl: baseCanonicalUrl,
        landingPageUrl: targetUrl,
        storeDomain,
        category: null,
        imageReferences,
        pageClassification: "CAMPAIGN_PAGE",
        fetchOutcome,
        evidenceTimestamp,
        identityStatus: "UNRESOLVED",
        identityConfidence: "AMBIGUOUS",
        resolutionHierarchyLevel: 7,
        resolutionSource: `Unresolved Shopify Slug (/products/${urlMeta.productHandle}) classified as ${slugClassification.headlineClass}`,
        verificationReason: `URL slug '${urlMeta.productHandle}' is not a valid product name and ad copy provides no corroborating product title.`,
        verificationLimitations: [
          ...limitations,
          `Invalid product slug '${urlMeta.productHandle}' (${slugClassification.headlineClass}).`,
        ],
        contradictions,
        hasUnresolvedContradiction: false,
        identityEvidenceReferences: [`Invalid Slug: ${urlMeta.productHandle}`],
        requiresManualReview: true,
        isEligibleAsEvergreenWinner: false,
      };
    }
  }

  // Level 4: Credible product-specific landing page slug (non-Shopify ecommerce path)
  if (urlMeta.isValidEcommerceUrl && urlMeta.cleanCanonicalUrl) {
    try {
      const segments = new URL(urlMeta.cleanCanonicalUrl).pathname.split("/").filter(Boolean);
      const lastSegment = segments[segments.length - 1];
      if (
        lastSegment &&
        lastSegment.length > 3 &&
        !["shop", "collections", "cart", "checkout", "categories"].includes(
          lastSegment.toLowerCase()
        )
      ) {
        const derivedSlugTitle = lastSegment
          .replace(/\.[a-z0-9]+$/i, "")
          .replace(/-(?:[a-z]{1,4}\d{2,4}(?:-[a-z0-9]{1,4})?|l\d+v\d+|v\d+)$/i, "")
          .split(/[-_]+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(" ");

        const slugClassification = classifyAdvertisingHeadline(derivedSlugTitle);
        if (
          slugClassification.headlineClass === "PRODUCT_CANDIDATE" &&
          slugClassification.isEligibleAsProductName &&
          slugClassification.cleanTitle
        ) {
          const fullTitle = combineTitleAndModel(
            slugClassification.cleanTitle,
            slugClassification.extractedModelOrSku
          );
          return {
            canonicalProductName: fullTitle,
            canonicalName: fullTitle,
            displayName: fullTitle,
            displayTitle: fullTitle,
            adClaimedProductName,
            merchantVerifiedProductName: null,
            originalAdHeadline: firstHeadline,
            originalCreativeCode: lastSegment,
            productType: null,
            brand,
            model: slugClassification.extractedModelOrSku || null,
            sku: resolvedSku,
            gtin: resolvedGtin,
            merchantProductId: resolvedMerchantProductId,
            variantId: resolvedVariantId,
            requestedUrl: targetUrl,
            resolvedFinalUrl: input.resolvedFinalUrl || targetUrl,
            declaredCanonicalUrl: input.declaredCanonicalUrl || null,
            normalizedProductUrl: baseCanonicalUrl,
            canonicalProductUrl: baseCanonicalUrl,
            productUrl: baseCanonicalUrl,
            landingPageUrl: targetUrl,
            storeDomain,
            category: null,
            imageReferences,
            pageClassification: "ECOMMERCE_PATH_UNVERIFIED",
            fetchOutcome,
            evidenceTimestamp,
            identityStatus: "PROBABLE",
            identityConfidence: "PROBABLE",
            resolutionHierarchyLevel: 4,
            resolutionSource: "Ecommerce Path Slug Extraction",
            verificationReason: `Derived probable product '${fullTitle}' from URL path segment '${lastSegment}' without verified merchant schema.`,
            verificationLimitations: [
              ...limitations,
              "Derived from URL path without verified merchant schema.",
            ],
            contradictions,
            hasUnresolvedContradiction: false,
            identityEvidenceReferences: [`URL Path: ${lastSegment}`],
            requiresManualReview: true,
            isEligibleAsEvergreenWinner: false,
          };
        }
      }
    } catch {}
  }

  // Level 6: Product-specific creative/text extraction (Filtered by AdHeadlineClassifier)
  if (bestAdHeadline) {
    return {
      canonicalProductName: bestAdHeadline.fullTextWithModel,
      canonicalName: bestAdHeadline.fullTextWithModel,
      displayName: bestAdHeadline.fullTextWithModel,
      displayTitle: bestAdHeadline.fullTextWithModel,
      adClaimedProductName,
      merchantVerifiedProductName: null,
      originalAdHeadline: firstHeadline,
      originalCreativeCode: null,
      productType: null,
      brand,
      model: bestAdHeadline.model,
      sku: resolvedSku,
      gtin: resolvedGtin,
      merchantProductId: resolvedMerchantProductId,
      variantId: resolvedVariantId,
      requestedUrl: targetUrl,
      resolvedFinalUrl: input.resolvedFinalUrl || targetUrl,
      declaredCanonicalUrl: input.declaredCanonicalUrl || null,
      normalizedProductUrl: baseCanonicalUrl,
      canonicalProductUrl: baseCanonicalUrl,
      productUrl: baseCanonicalUrl,
      landingPageUrl: targetUrl,
      storeDomain,
      category: null,
      imageReferences,
      pageClassification: baseCanonicalUrl ? "LANDING_URL_UNVERIFIED" : "NO_LANDING_URL",
      fetchOutcome,
      evidenceTimestamp,
      identityStatus: "PROBABLE",
      identityConfidence: "HIGH_CONFIDENCE",
      resolutionHierarchyLevel: 6,
      resolutionSource: "Ad Creative Headline (Classified Product Name)",
      verificationReason: `Derived probable product name '${bestAdHeadline.fullTextWithModel}' from ad creative headline; lacks verified merchant product page metadata.`,
      verificationLimitations: [
        ...limitations,
        "Identity based on ad headline without verified merchant product page metadata.",
      ],
      contradictions,
      hasUnresolvedContradiction: false,
      identityEvidenceReferences: [`Ad Headline: ${bestAdHeadline.raw}`],
      requiresManualReview: true,
      isEligibleAsEvergreenWinner: false,
    };
  }

  // Level 7: Unresolved identity requiring review
  const fallbackDisplayTitle = `Unidentified Product (Source: ${sourceRef}, Identity: Needs Review)`;
  return {
    canonicalProductName: null,
    canonicalName: null,
    displayName: fallbackDisplayTitle,
    displayTitle: fallbackDisplayTitle,
    adClaimedProductName: null,
    merchantVerifiedProductName: null,
    originalAdHeadline: firstHeadline,
    originalCreativeCode: null,
    productType: null,
    brand,
    model: null,
    sku: null,
    gtin: null,
    merchantProductId: null,
    variantId: null,
    requestedUrl: targetUrl,
    resolvedFinalUrl: input.resolvedFinalUrl || targetUrl,
    declaredCanonicalUrl: input.declaredCanonicalUrl || null,
    normalizedProductUrl: baseCanonicalUrl,
    canonicalProductUrl: baseCanonicalUrl,
    productUrl: baseCanonicalUrl,
    landingPageUrl: targetUrl,
    storeDomain,
    category: null,
    imageReferences,
    pageClassification: "UNRESOLVED_PAGE",
    fetchOutcome,
    evidenceTimestamp,
    identityStatus: "UNRESOLVED",
    identityConfidence: "AMBIGUOUS",
    resolutionHierarchyLevel: 7,
    resolutionSource: "Unresolved Identity (All Ad Copy Classified as IDs, Hooks, or Codes)",
    verificationReason:
      "Unable to resolve product identity: no verified merchant metadata and all ad headlines classified as ad IDs, campaign codes, or generic hooks.",
    verificationLimitations: [
      ...limitations,
      "No valid product name in merchant metadata, URL slug, or ad copy.",
    ],
    contradictions,
    hasUnresolvedContradiction: false,
    identityEvidenceReferences: firstHeadline ? [`Raw Headline: ${firstHeadline}`] : [],
    requiresManualReview: true,
    isEligibleAsEvergreenWinner: false,
  };
}

/**
 * Asynchronously resolves product identity with live merchant landing page metadata inspection.
 * Preserves all merchant metadata fields (SKU, GTIN, model, brand, merchantProductId, variantId, fetchOutcome)
 * and enforces strict evidence-based verification (Section 4).
 */
export async function resolveProductIdentityWithEvidence(
  input: CandidateIdentityInput,
  contextOrFetcher: IdentityResolutionContext | ((url: string) => Promise<any>) = {}
): Promise<ProductIdentity> {
  const context: IdentityResolutionContext =
    typeof contextOrFetcher === "function"
      ? { metadataFetcher: contextOrFetcher }
      : contextOrFetcher;
  const targetUrl = input.landingPageUrl || input.rawLandingUrl || input.landingUrl || null;
  let metaEvidence: ProductMetadataEvidence | null = null;

  if (targetUrl && context.metadataFetchEnabled !== false) {
    try {
      if (typeof contextOrFetcher === "function") {
        // Support both metadataFetcher(url) -> ProductMetadataEvidence AND fetchImpl(url) -> Response
        const probeRes = await contextOrFetcher(targetUrl);
        if (
          probeRes &&
          typeof (probeRes as any).text === "function" &&
          typeof (probeRes as any).status === "number" &&
          !("fetchOutcome" in probeRes) &&
          !("pageType" in probeRes) &&
          !("pageClassification" in probeRes)
        ) {
          metaEvidence = await fetchVerifiedProductPageMetadata(targetUrl, {
            timeoutMs: context.timeoutMs,
            fetchFn: (async () => probeRes) as any,
          });
        } else {
          metaEvidence = probeRes as ProductMetadataEvidence;
        }
      } else {
        const fetcher =
          context.metadataFetcher ||
          ((u: string) =>
            fetchVerifiedProductPageMetadata(u, {
              timeoutMs: context.timeoutMs,
              fetchFn: context.fetchImpl || context.fetchFn,
            }));
        metaEvidence = await fetcher(targetUrl);
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      const inferredOutcome: MerchantFetchOutcome = /\b403\b|forbidden/i.test(errMsg)
        ? "HTTP_403"
        : /\b404\b|not\s+found/i.test(errMsg)
        ? "HTTP_404"
        : /timeout|timed?\s*out|abort/i.test(errMsg)
        ? "TIMEOUT"
        : "NETWORK_ERROR";
      metaEvidence = {
        url: targetUrl,
        requestedUrl: targetUrl,
        resolvedFinalUrl: null,
        declaredCanonicalUrl: null,
        normalizedProductUrl: null,
        storeDomain: input.storeDomain || null,
        merchantProductId: null,
        isSafe: true,
        pageType: "ERROR_PAGE",
        fetchOutcome: inferredOutcome,
        httpStatus: inferredOutcome === "HTTP_403" ? 403 : inferredOutcome === "HTTP_404" ? 404 : null,
        verified: false,
        verificationReason: `Merchant metadata fetch threw error: ${errMsg}`,
        verificationLimitations: [`Exception during merchant metadata fetch: ${errMsg}`],
        contradictions: [],
        evidenceTimestamp: new Date().toISOString(),
        evidenceReferences: [],
        title: null,
        ogTitle: null,
        ogImage: null,
        imageReferences: [],
        canonicalUrl: null,
        brand: null,
        model: null,
        sku: null,
        gtin: null,
        variantId: null,
        price: null,
        currency: null,
        productName: null,
        description: null,
        jsonLdFound: false,
        jsonLdProduct: null,
        fetchError: errMsg,
      };
    }
  }

  // Note: Support both `pageType` and `pageClassification`, and both `productName` and `jsonLdProductName`
  const rawPageType =
    metaEvidence?.pageType ||
    (metaEvidence as any)?.pageClassification ||
    null;
  const extractedProductName =
    metaEvidence?.productName ||
    (metaEvidence as any)?.jsonLdProductName ||
    metaEvidence?.ogTitle ||
    metaEvidence?.title ||
    null;

  const isMetaVerified = Boolean(
    metaEvidence &&
      metaEvidence.isSafe !== false &&
      (rawPageType === "ACTUAL_PRODUCT_PAGE" || metaEvidence.verified === true) &&
      metaEvidence.verified !== false &&
      Boolean(extractedProductName)
  );

  const verifiedMerchantTitle = isMetaVerified
    ? extractedProductName
    : input.verifiedMerchantTitle || null;

  const verifiedMerchantBrand =
    metaEvidence?.brand ||
    metaEvidence?.jsonLdProduct?.brand ||
    input.verifiedMerchantBrand ||
    null;

  const verifiedPageType = isMetaVerified
    ? "ACTUAL_PRODUCT_PAGE"
    : rawPageType && rawPageType !== "UNCLASSIFIED_PAGE"
    ? rawPageType
    : input.verifiedPageType || null;

  const verifiedMerchantSku =
    metaEvidence?.sku ||
    metaEvidence?.jsonLdProduct?.sku ||
    input.verifiedMerchantSku ||
    null;
  const verifiedMerchantGtin =
    metaEvidence?.gtin ||
    metaEvidence?.jsonLdProduct?.gtin ||
    input.verifiedMerchantGtin ||
    null;
  const verifiedMerchantModel =
    metaEvidence?.model ||
    metaEvidence?.jsonLdProduct?.model ||
    input.verifiedMerchantModel ||
    null;
  const verifiedMerchantProductId =
    metaEvidence?.merchantProductId ||
    (metaEvidence as any)?.productId ||
    metaEvidence?.jsonLdProduct?.productId ||
    input.verifiedMerchantProductId ||
    null;
  const verifiedVariantId =
    metaEvidence?.variantId ||
    input.verifiedVariantId ||
    null;

  const fetchOutcome: MerchantFetchOutcome | "NOT_FETCHED" =
    metaEvidence?.fetchOutcome ||
    (metaEvidence
      ? isMetaVerified
        ? "VERIFIED_PRODUCT_PAGE"
        : metaEvidence.pageType === "COLLECTION_PAGE"
        ? "COLLECTION_PAGE"
        : metaEvidence.pageType === "HOMEPAGE"
        ? "HOMEPAGE"
        : metaEvidence.fetchError?.includes("403")
        ? "HTTP_403"
        : metaEvidence.fetchError?.includes("404")
        ? "HTTP_404"
        : metaEvidence.fetchError
        ? "NETWORK_ERROR"
        : "MISSING_METADATA"
      : input.fetchOutcome || "NOT_FETCHED");

  return resolveProductIdentity({
    ...input,
    landingPageUrl: targetUrl,
    storeDomain: metaEvidence?.storeDomain || input.storeDomain || input.advertiserDomain,
    verifiedMerchantTitle,
    verifiedMerchantBrand,
    verifiedPageType,
    verifiedMerchantSku,
    verifiedMerchantGtin,
    verifiedMerchantModel,
    verifiedMerchantProductId,
    verifiedVariantId,
    verifiedCanonicalUrl: metaEvidence?.canonicalUrl || input.verifiedCanonicalUrl || null,
    resolvedFinalUrl:
      metaEvidence?.resolvedFinalUrl ||
      (metaEvidence as any)?.finalUrl ||
      metaEvidence?.url ||
      input.resolvedFinalUrl ||
      targetUrl,
    declaredCanonicalUrl: metaEvidence?.declaredCanonicalUrl || metaEvidence?.canonicalUrl || input.declaredCanonicalUrl || null,
    normalizedProductUrl: metaEvidence?.normalizedProductUrl || input.normalizedProductUrl || null,
    imageReferences:
      metaEvidence?.imageReferences && metaEvidence.imageReferences.length > 0
        ? metaEvidence.imageReferences
        : Array.isArray((metaEvidence as any)?.images) && (metaEvidence as any).images.length > 0
        ? (metaEvidence as any).images
        : metaEvidence?.ogImage
        ? [metaEvidence.ogImage]
        : input.imageReferences || [],
    fetchOutcome,
    evidenceTimestamp: metaEvidence?.evidenceTimestamp || input.evidenceTimestamp || new Date().toISOString(),
    verificationReason: metaEvidence?.verificationReason || input.verificationReason || null,
    verificationLimitations: [
      ...(input.verificationLimitations || []),
      ...(metaEvidence?.verificationLimitations || []),
    ],
    merchantContradictions: [
      ...(input.merchantContradictions || []),
      ...(metaEvidence?.contradictions || []),
    ],
  });
}
