/**
 * SWAI KH-02 V12.3 — Product Identity Resolver
 *
 * Implements the 7-level product identification hierarchy:
 * 1. Verified product-specific landing page (Shopify /products/<slug> with valid product title)
 * 2. Existing linked ResearchProduct
 * 3. Structured product metadata from authorized product page
 * 4. Credible product-specific landing page title / slug (non-Shopify ecommerce path)
 * 5. Supported cross-source identity matches
 * 6. Product-specific creative/text extraction (Filtered by AdHeadlineClassifier)
 * 7. Unresolved identity requiring review (honest fallback; never claims Ad ID or campaign slug as product)
 *
 * Directives (Section 7):
 * - URLs with campaign slugs like "/products/ad50fb" or "/products/wmt004-1" must NEVER become verified product names.
 * - Distinguish: canonicalProductName, displayName, originalAdHeadline, originalCreativeCode, brand, model, identityConfidence.
 */

import { classifyAdvertisingHeadline, HeadlineClass } from "./adHeadlineClassifier";
import {
  extractProductUrlMetadata,
  ExtractedProductUrlInfo,
  fetchVerifiedProductPageMetadata,
} from "./productMetadataExtractor";
import { ProductMatchConfidence } from "../types";

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
  originalAdHeadline: string | null;
  originalCreativeCode: string | null;
  productType: string | null;
  brand: string | null;
  model: string | null;
  sku: string | null;
  variantId: string | null;
  canonicalProductUrl: string | null;
  productUrl: string | null; // Compatibility alias
  landingPageUrl: string | null;
  storeDomain: string | null;
  category: string | null;
  identityStatus: ProductIdentityStatus;
  identityConfidence: ProductMatchConfidence;
  resolutionHierarchyLevel: number; // 1 to 7
  resolutionSource: string;
  identityEvidenceReferences: string[];
  requiresManualReview: boolean;
  isEligibleAsEvergreenWinner: boolean;
}

export interface CandidateIdentityInput {
  landingPageUrl?: string | null;
  rawLandingUrl?: string | null; // Compatibility alias
  storeDomain?: string | null;
  brandOrAdvertiser?: string | null;
  rawHeadlines: string[];
  rawDescriptions?: string[];
  existingResearchProductId?: string | null;
  existingProductTitle?: string | null;
  sourceReference?: string | null;
  verifiedMerchantTitle?: string | null;
  verifiedMerchantBrand?: string | null;
  verifiedPageType?: string | null;
}

export interface IdentityResolutionContext {
  timeoutMs?: number;
  metadataFetchEnabled?: boolean;
  metadataFetcher?: (url: string) => Promise<any>;
}

/**
 * Resolves a factual product identity from advertising and landing page signals.
 */
export function resolveProductIdentity(
  input: CandidateIdentityInput
): ProductIdentity {
  const storeDomain = input.storeDomain || null;
  const brand = input.verifiedMerchantBrand || input.brandOrAdvertiser || null;
  const sourceRef = input.sourceReference || "Ad Creative";
  const firstHeadline = input.rawHeadlines[0] || null;
  const targetUrl = input.landingPageUrl || input.rawLandingUrl || null;
  const urlMeta = extractProductUrlMetadata(targetUrl);

  // Pre-classify all raw headlines to find any legitimate product titles
  const validProductHeadlines: Array<{
    cleanText: string;
    model: string | null;
    raw: string;
    confidence: number;
  }> = [];

  for (const rawHeadline of input.rawHeadlines) {
    if (!rawHeadline) continue;
    const classification = classifyAdvertisingHeadline(rawHeadline);
    if (classification.headlineClass === "PRODUCT_CANDIDATE" && classification.isEligibleAsProductName && classification.cleanTitle) {
      validProductHeadlines.push({
        cleanText: classification.cleanTitle,
        model: classification.extractedModelOrSku || null,
        raw: rawHeadline,
        confidence: classification.confidence,
      });
    }
  }

  // Sort valid headlines: prefer descriptive 3-8 words
  validProductHeadlines.sort((a, b) => {
    const aWords = a.cleanText.split(/\s+/).length;
    const bWords = b.cleanText.split(/\s+/).length;
    const aIdeal = aWords >= 3 && aWords <= 8 ? 1 : 0;
    const bIdeal = bWords >= 3 && bWords <= 8 ? 1 : 0;
    return bIdeal - aIdeal || b.cleanText.length - a.cleanText.length;
  });

  const bestAdHeadline = validProductHeadlines[0] || null;

  // Level 0: Verified merchant product page metadata (Highest Priority)
  if (input.verifiedMerchantTitle && input.verifiedPageType === "ACTUAL_PRODUCT_PAGE") {
    const merchantClassification = classifyAdvertisingHeadline(input.verifiedMerchantTitle);
    if (merchantClassification.isEligibleAsProductName && merchantClassification.cleanTitle) {
      const canonicalName = merchantClassification.cleanTitle;
      return {
        canonicalProductName: canonicalName,
        canonicalName,
        displayName: canonicalName,
        displayTitle: canonicalName,
        originalAdHeadline: firstHeadline,
        originalCreativeCode: urlMeta.productHandle || null,
        productType: null,
        brand,
        model: merchantClassification.extractedModelOrSku || null,
        sku: null,
        variantId: null,
        canonicalProductUrl: urlMeta.cleanCanonicalUrl || input.landingPageUrl || null,
        productUrl: urlMeta.cleanCanonicalUrl || input.landingPageUrl || null,
        landingPageUrl: input.landingPageUrl || null,
        storeDomain: urlMeta.storeDomain || storeDomain,
        category: null,
        identityStatus: "VERIFIED",
        identityConfidence: "EXACT",
        resolutionHierarchyLevel: 1,
        resolutionSource: "Verified Merchant Product Page Metadata (JSON-LD / OG Title)",
        identityEvidenceReferences: [
          `Merchant Title: ${canonicalName}`,
          `Canonical URL: ${urlMeta.cleanCanonicalUrl || input.landingPageUrl}`,
        ],
        requiresManualReview: false,
        isEligibleAsEvergreenWinner: true,
      };
    }
  }

  // Level 1: Verified product-specific landing page (Shopify /products/<handle>)
  if (urlMeta.isShopifyProductUrl && urlMeta.derivedTitleFromSlug) {
    const slugClassification = classifyAdvertisingHeadline(urlMeta.derivedTitleFromSlug);

    // CRITICAL: Ensure slug itself is a valid product name, not a campaign code like "ad50fb", "wmt004-1" or "wmt008-l4v2-mustyclothes"
    if (slugClassification.headlineClass === "PRODUCT_CANDIDATE" && slugClassification.isEligibleAsProductName && slugClassification.cleanTitle) {
      // Prefer richer descriptive ad headline if it corroborates the slug
      const canonicalName = (bestAdHeadline && bestAdHeadline.cleanText.toLowerCase().includes(slugClassification.cleanTitle.toLowerCase()))
        ? bestAdHeadline.cleanText
        : (bestAdHeadline?.cleanText || slugClassification.cleanTitle);
      return {
        canonicalProductName: canonicalName,
        canonicalName,
        displayName: canonicalName,
        displayTitle: canonicalName,
        originalAdHeadline: firstHeadline,
        originalCreativeCode: urlMeta.productHandle || null,
        productType: null,
        brand,
        model: slugClassification.extractedModelOrSku || null,
        sku: null,
        variantId: null,
        canonicalProductUrl: urlMeta.cleanCanonicalUrl,
        productUrl: urlMeta.cleanCanonicalUrl,
        landingPageUrl: input.landingPageUrl || null,
        storeDomain: urlMeta.storeDomain || storeDomain,
        category: null,
        identityStatus: "VERIFIED",
        identityConfidence: "EXACT",
        resolutionHierarchyLevel: 1,
        resolutionSource: `Verified Shopify Product URL (/products/${urlMeta.productHandle})`,
        identityEvidenceReferences: [`Shopify Handle: ${urlMeta.productHandle}`, `Canonical URL: ${urlMeta.cleanCanonicalUrl}`],
        requiresManualReview: false,
        isEligibleAsEvergreenWinner: true,
      };
    } else {
      // Slug is a campaign tag (e.g. "ad50fb") or raw SKU (e.g. "wmt004-1")
      // Check if we have a legitimate product headline from ad copy instead of the slug
      if (bestAdHeadline) {
        return {
          canonicalProductName: bestAdHeadline.cleanText,
          canonicalName: bestAdHeadline.cleanText,
          displayName: bestAdHeadline.cleanText,
          displayTitle: bestAdHeadline.cleanText,
          originalAdHeadline: firstHeadline,
          originalCreativeCode: urlMeta.productHandle,
          productType: null,
          brand,
          model: bestAdHeadline.model,
          sku: null,
          variantId: null,
          canonicalProductUrl: urlMeta.cleanCanonicalUrl,
          productUrl: urlMeta.cleanCanonicalUrl,
          landingPageUrl: input.landingPageUrl || null,
          storeDomain: urlMeta.storeDomain || storeDomain,
          category: null,
          identityStatus: "PROBABLE",
          identityConfidence: "HIGH_CONFIDENCE",
          resolutionHierarchyLevel: 3,
          resolutionSource: `Ad Headline (${bestAdHeadline.cleanText}) with Shopify URL (/products/${urlMeta.productHandle})`,
          identityEvidenceReferences: [`Ad Copy: ${bestAdHeadline.raw}`, `Shopify Slug: ${urlMeta.productHandle}`],
          requiresManualReview: false,
          isEligibleAsEvergreenWinner: true,
        };
      }

      // No legitimate product title from slug or ad headlines: honest unresolved status!
      const fallbackDisplayTitle = `Unidentified Product (Slug: /products/${urlMeta.productHandle}, Review Required)`;
      return {
        canonicalProductName: null,
        canonicalName: null,
        displayName: fallbackDisplayTitle,
        displayTitle: fallbackDisplayTitle,
        originalAdHeadline: firstHeadline,
        originalCreativeCode: urlMeta.productHandle,
        productType: null,
        brand,
        model: null,
        sku: null,
        variantId: null,
        canonicalProductUrl: urlMeta.cleanCanonicalUrl,
        productUrl: urlMeta.cleanCanonicalUrl,
        landingPageUrl: input.landingPageUrl || null,
        storeDomain: urlMeta.storeDomain || storeDomain,
        category: null,
        identityStatus: "UNRESOLVED",
        identityConfidence: "AMBIGUOUS",
        resolutionHierarchyLevel: 7,
        resolutionSource: `Unresolved Shopify Slug (/products/${urlMeta.productHandle}) classified as ${slugClassification.headlineClass}`,
        identityEvidenceReferences: [`Invalid Slug: ${urlMeta.productHandle}`],
        requiresManualReview: true,
        isEligibleAsEvergreenWinner: false,
      };
    }
  }

  // Level 2: Existing linked ResearchProduct
  if (input.existingResearchProductId && input.existingProductTitle) {
    return {
      canonicalProductName: input.existingProductTitle,
      canonicalName: input.existingProductTitle,
      displayName: input.existingProductTitle,
      displayTitle: input.existingProductTitle,
      originalAdHeadline: firstHeadline,
      originalCreativeCode: null,
      productType: null,
      brand,
      model: null,
      sku: null,
      variantId: null,
      canonicalProductUrl: urlMeta.cleanCanonicalUrl || input.landingPageUrl || null,
      productUrl: urlMeta.cleanCanonicalUrl || input.landingPageUrl || null,
      landingPageUrl: input.landingPageUrl || null,
      storeDomain,
      category: null,
      identityStatus: "VERIFIED",
      identityConfidence: "EXACT",
      resolutionHierarchyLevel: 2,
      resolutionSource: `Linked ResearchProduct #${input.existingResearchProductId}`,
      identityEvidenceReferences: [`ResearchProduct ID: ${input.existingResearchProductId}`],
      requiresManualReview: false,
      isEligibleAsEvergreenWinner: true,
    };
  }

  // Level 4: Credible product-specific landing page slug (non-Shopify ecommerce path)
  if (urlMeta.isValidEcommerceUrl && urlMeta.cleanCanonicalUrl) {
    const segments = new URL(urlMeta.cleanCanonicalUrl).pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    if (lastSegment && lastSegment.length > 3 && !["shop", "collections", "cart", "checkout", "categories"].includes(lastSegment.toLowerCase())) {
      const derivedSlugTitle = lastSegment
        .replace(/\.[a-z0-9]+$/i, "")
        .split(/[-_]+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");

      const slugClassification = classifyAdvertisingHeadline(derivedSlugTitle);
      if (slugClassification.headlineClass === "PRODUCT_CANDIDATE" && slugClassification.isEligibleAsProductName && slugClassification.cleanTitle) {
        return {
          canonicalProductName: slugClassification.cleanTitle,
          canonicalName: slugClassification.cleanTitle,
          displayName: slugClassification.cleanTitle,
          displayTitle: slugClassification.cleanTitle,
          originalAdHeadline: firstHeadline,
          originalCreativeCode: lastSegment,
          productType: null,
          brand,
          model: slugClassification.extractedModelOrSku || null,
          sku: null,
          variantId: null,
          canonicalProductUrl: urlMeta.cleanCanonicalUrl,
          productUrl: urlMeta.cleanCanonicalUrl,
          landingPageUrl: input.landingPageUrl || null,
          storeDomain: urlMeta.storeDomain || storeDomain,
          category: null,
          identityStatus: "PROBABLE",
          identityConfidence: "PROBABLE",
          resolutionHierarchyLevel: 4,
          resolutionSource: "Ecommerce Path Slug Extraction",
          identityEvidenceReferences: [`URL Path: ${lastSegment}`],
          requiresManualReview: false,
          isEligibleAsEvergreenWinner: true,
        };
      }
    }
  }

  // Level 6: Product-specific creative/text extraction (Filtered by AdHeadlineClassifier)
  if (bestAdHeadline) {
    return {
      canonicalProductName: bestAdHeadline.cleanText,
      canonicalName: bestAdHeadline.cleanText,
      displayName: bestAdHeadline.cleanText,
      displayTitle: bestAdHeadline.cleanText,
      originalAdHeadline: firstHeadline,
      originalCreativeCode: null,
      productType: null,
      brand,
      model: bestAdHeadline.model,
      sku: null,
      variantId: null,
      canonicalProductUrl: urlMeta.cleanCanonicalUrl || input.landingPageUrl || null,
      productUrl: urlMeta.cleanCanonicalUrl || input.landingPageUrl || null,
      landingPageUrl: input.landingPageUrl || null,
      storeDomain,
      category: null,
      identityStatus: "PROBABLE",
      identityConfidence: "HIGH_CONFIDENCE",
      resolutionHierarchyLevel: 6,
      resolutionSource: "Ad Creative Headline (Classified Product Name)",
      identityEvidenceReferences: [`Ad Headline: ${bestAdHeadline.raw}`],
      requiresManualReview: false,
      isEligibleAsEvergreenWinner: true,
    };
  }

  // Level 7: Unresolved identity requiring review
  // All headlines are ad IDs, CTAs, clickbait hooks, or campaign codes
  const fallbackDisplayTitle = `Unidentified Product (Source: ${sourceRef}, Identity: Needs Review)`;
  return {
    canonicalProductName: null,
    canonicalName: null,
    displayName: fallbackDisplayTitle,
    displayTitle: fallbackDisplayTitle,
    originalAdHeadline: firstHeadline,
    originalCreativeCode: null,
    productType: null,
    brand,
    model: null,
    sku: null,
    variantId: null,
    canonicalProductUrl: urlMeta.cleanCanonicalUrl || input.landingPageUrl || null,
    productUrl: urlMeta.cleanCanonicalUrl || input.landingPageUrl || null,
    landingPageUrl: input.landingPageUrl || null,
    storeDomain,
    category: null,
    identityStatus: "UNRESOLVED",
    identityConfidence: "AMBIGUOUS",
    resolutionHierarchyLevel: 7,
    resolutionSource: "Unresolved Identity (All Ad Copy Classified as IDs, Hooks, or Codes)",
    identityEvidenceReferences: firstHeadline ? [`Raw Headline: ${firstHeadline}`] : [],
    requiresManualReview: true,
    isEligibleAsEvergreenWinner: false,
  };
}

/**
 * Asynchronously resolves product identity with live merchant landing page metadata inspection when available.
 * Detects contradictions between ad copy claims and landing page merchant offerings.
 */
export async function resolveProductIdentityWithEvidence(
  input: CandidateIdentityInput,
  context: IdentityResolutionContext = {}
): Promise<ProductIdentity> {
  let verifiedMerchantTitle: string | null = null;
  let verifiedMerchantBrand: string | null = null;
  let verifiedPageType: string | null = null;

  if (input.landingPageUrl && context.metadataFetchEnabled !== false) {
    try {
      const fetcher = context.metadataFetcher || ((u: string) => fetchVerifiedProductPageMetadata(u, { timeoutMs: context.timeoutMs }));
      const metaEvidence = await fetcher(input.landingPageUrl);
      if (metaEvidence && metaEvidence.isSafe && metaEvidence.pageType === "ACTUAL_PRODUCT_PAGE") {
        verifiedMerchantTitle = metaEvidence.productName || metaEvidence.ogTitle || metaEvidence.title || null;
        verifiedMerchantBrand = metaEvidence.brand || null;
        verifiedPageType = metaEvidence.pageType;
      }
    } catch {
      // Non-fatal: safely fall back to synchronous identity resolution
    }
  }

  const identity = resolveProductIdentity({
    ...input,
    verifiedMerchantTitle: verifiedMerchantTitle || input.verifiedMerchantTitle,
    verifiedMerchantBrand: verifiedMerchantBrand || input.verifiedMerchantBrand,
    verifiedPageType: verifiedPageType || input.verifiedPageType,
  });

  // Check for contradiction between ad headline and verified merchant page
  if (verifiedMerchantTitle && input.rawHeadlines.length > 0) {
    const merchantClass = classifyAdvertisingHeadline(verifiedMerchantTitle);
    const adClass = classifyAdvertisingHeadline(input.rawHeadlines[0]);
    if (merchantClass.isEligibleAsProductName && adClass.isEligibleAsProductName) {
      const merchantNouns = merchantClass.cleanTitle?.toLowerCase().split(/\s+/) || [];
      const adNouns = adClass.cleanTitle?.toLowerCase().split(/\s+/) || [];
      const hasOverlap = merchantNouns.some((n) => adNouns.includes(n));
      if (!hasOverlap && merchantNouns.length > 0 && adNouns.length > 0) {
        return {
          ...identity,
          identityStatus: "AMBIGUOUS",
          requiresManualReview: true,
          identityEvidenceReferences: [
            ...identity.identityEvidenceReferences,
            `Ad vs Merchant Title Mismatch: Ad claims '${adClass.cleanTitle}' but merchant sells '${merchantClass.cleanTitle}'`,
          ],
        };
      }
    }
  }

  return identity;
}
