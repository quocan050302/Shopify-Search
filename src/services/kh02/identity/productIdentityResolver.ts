/**
 * SWAI KH-02 — Product Identity Resolver
 *
 * Implements the 7-level product identification hierarchy:
 * 1. Verified product-specific landing page (Shopify /products/<slug>)
 * 2. Existing linked ResearchProduct
 * 3. Structured product metadata from authorized product page
 * 4. Credible product-specific landing page title / slug
 * 5. Supported cross-source identity matches
 * 6. Product-specific creative/text extraction (filtered by AdHeadlineClassifier)
 * 7. Unresolved identity requiring review (honest fallback; never claims Ad ID as product)
 */

import { classifyAdvertisingHeadline, HeadlineClass } from "./adHeadlineClassifier";
import { extractProductUrlMetadata, ExtractedProductUrlInfo } from "./productMetadataExtractor";

export interface AdIdentity {
  adId: string;
  advertiser: string | null;
  headline: string | null;
  creativeUrl: string | null;
  sourceExternalId?: string | null;
}

export type ProductIdentityStatus =
  | "VERIFIED"
  | "PROBABLE"
  | "AMBIGUOUS"
  | "UNRESOLVED";

export interface ProductIdentity {
  canonicalName: string | null;
  displayTitle: string;
  category: string | null;
  productUrl: string | null;
  storeDomain: string | null;
  brand: string | null;
  sku: string | null;
  variantId: string | null;
  identityStatus: ProductIdentityStatus;
  resolutionHierarchyLevel: number; // 1 to 7
  resolutionSource: string;
  isEligibleAsEvergreenWinner: boolean;
}

export interface CandidateIdentityInput {
  landingPageUrl?: string | null;
  storeDomain?: string | null;
  brandOrAdvertiser?: string | null;
  rawHeadlines: string[];
  rawDescriptions?: string[];
  existingResearchProductId?: string | null;
  existingProductTitle?: string | null;
  sourceReference?: string | null;
}

/**
 * Resolves a factual product identity from advertising and landing page signals.
 */
export function resolveProductIdentity(
  input: CandidateIdentityInput
): ProductIdentity {
  const storeDomain = input.storeDomain || null;
  const brand = input.brandOrAdvertiser || null;
  const sourceRef = input.sourceReference || "Ad Creative";

  // Level 1: Verified product-specific landing page (e.g. Shopify /products/<handle>)
  const urlMeta = extractProductUrlMetadata(input.landingPageUrl);
  if (urlMeta.isShopifyProductUrl && urlMeta.derivedTitleFromSlug) {
    return {
      canonicalName: urlMeta.derivedTitleFromSlug,
      displayTitle: urlMeta.derivedTitleFromSlug,
      category: null,
      productUrl: urlMeta.cleanCanonicalUrl,
      storeDomain: urlMeta.storeDomain || storeDomain,
      brand,
      sku: null,
      variantId: null,
      identityStatus: "VERIFIED",
      resolutionHierarchyLevel: 1,
      resolutionSource: `Verified Shopify Product URL (/products/${urlMeta.productHandle})`,
      isEligibleAsEvergreenWinner: true,
    };
  }

  // Level 2: Existing linked ResearchProduct
  if (input.existingResearchProductId && input.existingProductTitle) {
    return {
      canonicalName: input.existingProductTitle,
      displayTitle: input.existingProductTitle,
      category: null,
      productUrl: urlMeta.cleanCanonicalUrl || input.landingPageUrl || null,
      storeDomain,
      brand,
      sku: null,
      variantId: null,
      identityStatus: "VERIFIED",
      resolutionHierarchyLevel: 2,
      resolutionSource: `Linked ResearchProduct #${input.existingResearchProductId}`,
      isEligibleAsEvergreenWinner: true,
    };
  }

  // Level 4: Credible product-specific landing page slug (non-Shopify ecommerce path)
  if (urlMeta.isValidEcommerceUrl && urlMeta.cleanCanonicalUrl) {
    const segments = new URL(urlMeta.cleanCanonicalUrl).pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    if (lastSegment && lastSegment.length > 3 && !["shop", "collections", "cart", "checkout"].includes(lastSegment.toLowerCase())) {
      const derivedSlugTitle = lastSegment
        .replace(/\.[a-z0-9]+$/i, "")
        .split(/[-_]+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");

      return {
        canonicalName: derivedSlugTitle,
        displayTitle: derivedSlugTitle,
        category: null,
        productUrl: urlMeta.cleanCanonicalUrl,
        storeDomain: urlMeta.storeDomain || storeDomain,
        brand,
        sku: null,
        variantId: null,
        identityStatus: "PROBABLE",
        resolutionHierarchyLevel: 4,
        resolutionSource: "Ecommerce Path Slug Extraction",
        isEligibleAsEvergreenWinner: true,
      };
    }
  }

  // Level 6: Product-specific creative/text extraction (Filtered by AdHeadlineClassifier)
  const validProductHeadlines: string[] = [];
  for (const rawHeadline of input.rawHeadlines) {
    if (!rawHeadline) continue;
    const classification = classifyAdvertisingHeadline(rawHeadline);
    if (classification.headlineClass === "PRODUCT_CANDIDATE" && classification.isEligibleAsProductName) {
      validProductHeadlines.push(classification.normalizedCleanText);
    }
  }

  if (validProductHeadlines.length > 0) {
    // Select the most descriptive headline (preferring 3-8 words)
    validProductHeadlines.sort((a, b) => {
      const aWords = a.split(/\s+/).length;
      const bWords = b.split(/\s+/).length;
      const aIdeal = aWords >= 3 && aWords <= 8 ? 1 : 0;
      const bIdeal = bWords >= 3 && bWords <= 8 ? 1 : 0;
      return bIdeal - aIdeal || b.length - a.length;
    });

    const chosenTitle = validProductHeadlines[0];
    return {
      canonicalName: chosenTitle,
      displayTitle: chosenTitle,
      category: null,
      productUrl: urlMeta.cleanCanonicalUrl || input.landingPageUrl || null,
      storeDomain,
      brand,
      sku: null,
      variantId: null,
      identityStatus: "PROBABLE",
      resolutionHierarchyLevel: 6,
      resolutionSource: "Ad Creative Headline (Classified Product Name)",
      isEligibleAsEvergreenWinner: true,
    };
  }

  // Level 7: Unresolved identity requiring review
  // When all headlines are ad IDs, CTAs, or unverified slogans
  const fallbackDisplayTitle = `Unidentified Product (Source: ${sourceRef}, Identity: Needs Review)`;
  return {
    canonicalName: null,
    displayTitle: fallbackDisplayTitle,
    category: null,
    productUrl: urlMeta.cleanCanonicalUrl || input.landingPageUrl || null,
    storeDomain,
    brand,
    sku: null,
    variantId: null,
    identityStatus: "UNRESOLVED",
    resolutionHierarchyLevel: 7,
    resolutionSource: "Unresolved Identity (All Ad Copy Classified as IDs/CTAs)",
    isEligibleAsEvergreenWinner: false, // Rule 95: Ambiguous/unresolved cannot become verified evergreen winner
  };
}
