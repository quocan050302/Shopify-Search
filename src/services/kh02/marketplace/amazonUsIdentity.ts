/**
 * SWAI KH-02 V12.4.3.5.0 — Amazon US URL Guard, ASIN Provenance, Sanitization & Product Identity Verifier
 *
 * Implements:
 * - validateAmazonUsProductUrl(rawUrl, finalUrl?)
 * - extractAmazonAsinFromProductEvidence(url, structuredData, canonicalTags)
 * - canonicalizeAmazonProductIdentity(record)
 * - deduplicateCanonicalAmazonIdentities(records)
 * - sanitizeUntrustedAmazonText(rawText)
 * - parseAmazonProductEvidence(snapshot, responseMetadata)
 * - verifyAmazonProductIdentity(candidate, evidence)
 */

import {
  AmazonProductEvidence,
  IdentityMatch,
  MarketplaceEvidenceStatus,
  MarketplaceObservationClass,
  MarketplaceVerificationScope,
  computeDeterministicEvidenceHash,
} from "./marketplaceEvidenceTypes";

export interface AmazonUrlValidationResult {
  valid: boolean;
  canonicalAmazonUrl: string | null;
  extractedAsin: string | null;
  normalizedHost: string | null;
  structuralPathType: "DP" | "GP_PRODUCT" | "GP_AW_D" | null;
  strippedTrackingParams: string[];
  rejectionCode:
    | "EMPTY_OR_INVALID_URL"
    | "UNSAFE_PROTOCOL"
    | "CREDENTIALS_IN_URL"
    | "IP_OR_INTERNAL_HOST"
    | "URL_SHORTENER_FORBIDDEN"
    | "NON_US_AMAZON_MARKETPLACE"
    | "UNAPPROVED_EXTERNAL_HOST"
    | "FINAL_URL_EXTERNAL_REDIRECT"
    | "FINAL_URL_COUNTRY_MISMATCH"
    | "FINAL_URL_AUTH_OR_BOT_REDIRECT"
    | "FINAL_URL_ASIN_MISMATCH"
    | "SEARCH_OR_CATEGORY_URL_NOT_PRODUCT"
    | "SPONSORED_REDIRECT_URL"
    | "MISSING_STRUCTURAL_PRODUCT_ASIN"
    | null;
  rejectionReason: string | null;
}

export interface AsinExtractionProvenanceResult {
  valid: boolean;
  asin: string | null;
  parentAsin: string | null;
  variationAsin: string | null;
  canonicalAmazonUrl: string | null;
  urlAsin: string | null;
  canonicalTagAsin: string | null;
  structuredDataAsin: string | null;
  provenanceSources: Array<"URL_PATH" | "CANONICAL_LINK_TAG" | "DATA_ASIN_ATTR" | "JSON_LD_OR_STRUCTURED">;
  discrepancyDetected: boolean;
  rejectionReason: string | null;
}

export interface CanonicalAmazonIdentityRecord {
  canonicalIdentityKey: string;
  parentFamilyKey: string;
  asin: string;
  parentAsin: string | null;
  variationAsin: string | null;
  isVariationChild: boolean;
  canonicalAmazonUrl: string;
  normalizedBrand: string | null;
  normalizedTitle: string;
  modelNumber: string | null;
  sku: string | null;
}

const ALLOWED_AMAZON_US_HOSTS = new Set([
  "amazon.com",
  "www.amazon.com",
  "smile.amazon.com",
]);

const NON_US_AMAZON_HOST_PATTERN =
  /(?:^|\.)amazon\.(?:co\.uk|ca|de|fr|es|it|co\.jp|in|com\.au|com\.mx|com\.br|nl|se|pl|sg|ae|sa|eg|com\.tr|com\.be)$/i;

const SHORTENER_HOSTS = new Set([
  "amzn.to",
  "a.co",
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
]);

/**
 * Strict ASIN format:
 * - Standard Amazon ASIN starts with 'B' followed by 9 uppercase alphanumeric chars (e.g. B08N5WRWNW), OR
 * - 10-character ISBN-10 (9 digits followed by a digit or 'X').
 * Arbitrary 10-letter English words like "CATEGORIES" or "COLLECTION" are rejected.
 */
export function isValidStrictAmazonAsin(candidate: unknown): boolean {
  if (typeof candidate !== "string") return false;
  const s = candidate.trim();
  if (s.length !== 10) return false;
  if (!/^[A-Z0-9]{10}$/.test(s)) return false;
  if (/^[0-9]{9}[0-9X]$/.test(s)) return true;
  // Standard non-ISBN ASINs begin with B and contain at least one digit
  if (/^B[A-Z0-9]{9}$/.test(s) && /[0-9]/.test(s)) {
    return true;
  }
  return false;
}

function isInternalOrIpHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h.startsWith("fe80:") ||
    h.startsWith("fc00:") ||
    h.startsWith("fd00:")
  ) {
    return true;
  }
  // IPv4 literal check
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) {
    return true;
  }
  return false;
}

function parseStructuralProductPath(pathname: string): {
  asin: string | null;
  pathType: "DP" | "GP_PRODUCT" | "GP_AW_D" | null;
  isSearchOrCategory: boolean;
  isSponsoredRedirect: boolean;
  isAuthOrCart: boolean;
} {
  const cleanPath = pathname.trim();

  if (/^\/(?:s|b|gp\/bestsellers|gp\/new-releases|gp\/movers-and-shakers|stores|bestsellers)(?:\/|$)/i.test(cleanPath)) {
    return {
      asin: null,
      pathType: null,
      isSearchOrCategory: true,
      isSponsoredRedirect: false,
      isAuthOrCart: false,
    };
  }

  if (/^\/(?:sspa\/click|gp\/slredirect|gp\/redirect\.html)(?:\/|$)/i.test(cleanPath)) {
    return {
      asin: null,
      pathType: null,
      isSearchOrCategory: false,
      isSponsoredRedirect: true,
      isAuthOrCart: false,
    };
  }

  if (/^\/(?:ap\/signin|ap\/register|gp\/cart|gp\/buy|errors\/validateCaptcha)(?:\/|$)/i.test(cleanPath)) {
    return {
      asin: null,
      pathType: null,
      isSearchOrCategory: false,
      isSponsoredRedirect: false,
      isAuthOrCart: true,
    };
  }

  // 1. /dp/<ASIN> or /<product-slug>/dp/<ASIN>
  const dpMatch = cleanPath.match(/(?:^|\/)dp\/([A-Za-z0-9]{10})(?:\/|$)/);
  if (dpMatch) {
    const candidate = dpMatch[1].toUpperCase();
    // Ensure Uppercase in original URL or standard ASIN (reject lowercase 10-letter words)
    if (dpMatch[1] === candidate && isValidStrictAmazonAsin(candidate)) {
      return {
        asin: candidate,
        pathType: "DP",
        isSearchOrCategory: false,
        isSponsoredRedirect: false,
        isAuthOrCart: false,
      };
    }
  }

  // 2. /gp/product/<ASIN>
  const gpMatch = cleanPath.match(/^\/gp\/product\/([A-Za-z0-9]{10})(?:\/|$)/);
  if (gpMatch) {
    const candidate = gpMatch[1].toUpperCase();
    if (gpMatch[1] === candidate && isValidStrictAmazonAsin(candidate)) {
      return {
        asin: candidate,
        pathType: "GP_PRODUCT",
        isSearchOrCategory: false,
        isSponsoredRedirect: false,
        isAuthOrCart: false,
      };
    }
  }

  // 3. /gp/aw/d/<ASIN>
  const awMatch = cleanPath.match(/^\/gp\/aw\/d\/([A-Za-z0-9]{10})(?:\/|$)/);
  if (awMatch) {
    const candidate = awMatch[1].toUpperCase();
    if (awMatch[1] === candidate && isValidStrictAmazonAsin(candidate)) {
      return {
        asin: candidate,
        pathType: "GP_AW_D",
        isSearchOrCategory: false,
        isSponsoredRedirect: false,
        isAuthOrCart: false,
      };
    }
  }

  return {
    asin: null,
    pathType: null,
    isSearchOrCategory: false,
    isSponsoredRedirect: false,
    isAuthOrCart: false,
  };
}

/**
 * Validates and normalizes an Amazon US product URL.
 * Rejects unsafe hosts, SSRF/IP literals, credentials, non-US Amazon domains,
 * URL shorteners, sponsored redirects, search/category pages, and arbitrary 10-char strings.
 */
export function validateAmazonUsProductUrl(
  rawUrl: unknown,
  finalUrl?: unknown
): AmazonUrlValidationResult {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return {
      valid: false,
      canonicalAmazonUrl: null,
      extractedAsin: null,
      normalizedHost: null,
      structuralPathType: null,
      strippedTrackingParams: [],
      rejectionCode: "EMPTY_OR_INVALID_URL",
      rejectionReason: "Product URL is empty or not a string.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return {
      valid: false,
      canonicalAmazonUrl: null,
      extractedAsin: null,
      normalizedHost: null,
      structuralPathType: null,
      strippedTrackingParams: [],
      rejectionCode: "EMPTY_OR_INVALID_URL",
      rejectionReason: `Malformed URL: ${String(rawUrl).slice(0, 120)}`,
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      valid: false,
      canonicalAmazonUrl: null,
      extractedAsin: null,
      normalizedHost: null,
      structuralPathType: null,
      strippedTrackingParams: [],
      rejectionCode: "UNSAFE_PROTOCOL",
      rejectionReason: `Disallowed URL protocol '${parsed.protocol}'. Only https://www.amazon.com product URLs are permitted.`,
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      canonicalAmazonUrl: null,
      extractedAsin: null,
      normalizedHost: null,
      structuralPathType: null,
      strippedTrackingParams: [],
      rejectionCode: "CREDENTIALS_IN_URL",
      rejectionReason: "Credentials embedded in URL are forbidden.",
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (isInternalOrIpHost(host)) {
    return {
      valid: false,
      canonicalAmazonUrl: null,
      extractedAsin: null,
      normalizedHost: host,
      structuralPathType: null,
      strippedTrackingParams: [],
      rejectionCode: "IP_OR_INTERNAL_HOST",
      rejectionReason: `Forbidden IP literal, loopback, or internal host '${host}'.`,
    };
  }

  if (SHORTENER_HOSTS.has(host)) {
    return {
      valid: false,
      canonicalAmazonUrl: null,
      extractedAsin: null,
      normalizedHost: host,
      structuralPathType: null,
      strippedTrackingParams: [],
      rejectionCode: "URL_SHORTENER_FORBIDDEN",
      rejectionReason: `URL shortener host '${host}' is rejected; canonical www.amazon.com product URL required.`,
    };
  }

  if (NON_US_AMAZON_HOST_PATTERN.test(host)) {
    return {
      valid: false,
      canonicalAmazonUrl: null,
      extractedAsin: null,
      normalizedHost: host,
      structuralPathType: null,
      strippedTrackingParams: [],
      rejectionCode: "NON_US_AMAZON_MARKETPLACE",
      rejectionReason: `Non-US Amazon marketplace host '${host}' is rejected. Pilot is strictly restricted to Amazon US (www.amazon.com).`,
    };
  }

  if (!ALLOWED_AMAZON_US_HOSTS.has(host)) {
    return {
      valid: false,
      canonicalAmazonUrl: null,
      extractedAsin: null,
      normalizedHost: host,
      structuralPathType: null,
      strippedTrackingParams: [],
      rejectionCode: "UNAPPROVED_EXTERNAL_HOST",
      rejectionReason: `Host '${host}' is not an approved Amazon US domain (www.amazon.com).`,
    };
  }

  const pathCheck = parseStructuralProductPath(parsed.pathname);
  if (pathCheck.isSponsoredRedirect) {
    return {
      valid: false,
      canonicalAmazonUrl: null,
      extractedAsin: null,
      normalizedHost: host,
      structuralPathType: null,
      strippedTrackingParams: [],
      rejectionCode: "SPONSORED_REDIRECT_URL",
      rejectionReason: `Sponsored ad redirect path '${parsed.pathname}' is not an canonical product detail URL.`,
    };
  }

  if (pathCheck.isSearchOrCategory || parsed.searchParams.has("k") || parsed.searchParams.has("field-keywords")) {
    return {
      valid: false,
      canonicalAmazonUrl: null,
      extractedAsin: null,
      normalizedHost: host,
      structuralPathType: null,
      strippedTrackingParams: [],
      rejectionCode: "SEARCH_OR_CATEGORY_URL_NOT_PRODUCT",
      rejectionReason: `Search or category browse URL '${parsed.pathname}' is not a specific product page.`,
    };
  }

  if (!pathCheck.asin || !pathCheck.pathType) {
    return {
      valid: false,
      canonicalAmazonUrl: null,
      extractedAsin: null,
      normalizedHost: host,
      structuralPathType: null,
      strippedTrackingParams: [],
      rejectionCode: "MISSING_STRUCTURAL_PRODUCT_ASIN",
      rejectionReason: `URL path '${parsed.pathname}' does not contain a valid structural ASIN in /dp/<ASIN> or /gp/product/<ASIN>.`,
    };
  }

  // If finalUrl is provided (e.g. after navigation/redirect), validate finalUrl strictly
  if (typeof finalUrl === "string" && finalUrl.trim()) {
    let parsedFinal: URL;
    try {
      parsedFinal = new URL(finalUrl.trim());
    } catch {
      return {
        valid: false,
        canonicalAmazonUrl: null,
        extractedAsin: null,
        normalizedHost: host,
        structuralPathType: null,
        strippedTrackingParams: [],
        rejectionCode: "FINAL_URL_EXTERNAL_REDIRECT",
        rejectionReason: `Malformed final redirect URL '${finalUrl}'.`,
      };
    }

    if (parsedFinal.protocol !== "https:") {
      return {
        valid: false,
        canonicalAmazonUrl: null,
        extractedAsin: null,
        normalizedHost: host,
        structuralPathType: null,
        strippedTrackingParams: [],
        rejectionCode: "UNSAFE_PROTOCOL",
        rejectionReason: `Disallowed final redirect protocol '${parsedFinal.protocol}'.`,
      };
    }

    const finalHost = parsedFinal.hostname.toLowerCase();
    if (isInternalOrIpHost(finalHost) || (!ALLOWED_AMAZON_US_HOSTS.has(finalHost) && !NON_US_AMAZON_HOST_PATTERN.test(finalHost))) {
      return {
        valid: false,
        canonicalAmazonUrl: null,
        extractedAsin: null,
        normalizedHost: finalHost,
        structuralPathType: null,
        strippedTrackingParams: [],
        rejectionCode: "FINAL_URL_EXTERNAL_REDIRECT",
        rejectionReason: `Redirected to unapproved external host '${finalHost}'.`,
      };
    }

    if (NON_US_AMAZON_HOST_PATTERN.test(finalHost)) {
      return {
        valid: false,
        canonicalAmazonUrl: null,
        extractedAsin: null,
        normalizedHost: finalHost,
        structuralPathType: null,
        strippedTrackingParams: [],
        rejectionCode: "FINAL_URL_COUNTRY_MISMATCH",
        rejectionReason: `Redirected to non-US Amazon domain '${finalHost}'.`,
      };
    }

    const finalPathCheck = parseStructuralProductPath(parsedFinal.pathname);
    if (finalPathCheck.isAuthOrCart) {
      return {
        valid: false,
        canonicalAmazonUrl: null,
        extractedAsin: null,
        normalizedHost: finalHost,
        structuralPathType: null,
        strippedTrackingParams: [],
        rejectionCode: "FINAL_URL_AUTH_OR_BOT_REDIRECT",
        rejectionReason: `Redirected to login, cart, or CAPTCHA path '${parsedFinal.pathname}'.`,
      };
    }

    if (finalPathCheck.asin && finalPathCheck.asin !== pathCheck.asin) {
      return {
        valid: false,
        canonicalAmazonUrl: null,
        extractedAsin: null,
        normalizedHost: finalHost,
        structuralPathType: null,
        strippedTrackingParams: [],
        rejectionCode: "FINAL_URL_ASIN_MISMATCH",
        rejectionReason: `Final URL ASIN '${finalPathCheck.asin}' contradicts requested URL ASIN '${pathCheck.asin}'.`,
      };
    }
  }

  const strippedTrackingParams = Array.from(parsed.searchParams.keys());

  return {
    valid: true,
    canonicalAmazonUrl: `https://www.amazon.com/dp/${pathCheck.asin}`,
    extractedAsin: pathCheck.asin,
    normalizedHost: "www.amazon.com",
    structuralPathType: pathCheck.pathType,
    strippedTrackingParams,
    rejectionCode: null,
    rejectionReason: null,
  };
}

/**
 * Extracts ASIN and variation lineage from URL, canonical tags, and structured product data.
 * Fails closed when URL ASIN contradicts structured data or canonical tag ASIN.
 */
export function extractAmazonAsinFromProductEvidence(
  url: string | null | undefined,
  structuredData?: {
    asin?: string | null;
    parentAsin?: string | null;
    variationAsin?: string | null;
    sku?: string | null;
  } | null,
  canonicalTags?: {
    canonicalUrl?: string | null;
    dataAsin?: string | null;
  } | null
): AsinExtractionProvenanceResult {
  const provenanceSources: Array<
    "URL_PATH" | "CANONICAL_LINK_TAG" | "DATA_ASIN_ATTR" | "JSON_LD_OR_STRUCTURED"
  > = [];

  let urlAsin: string | null = null;
  if (url) {
    const urlCheck = validateAmazonUsProductUrl(url);
    if (!urlCheck.valid) {
      return {
        valid: false,
        asin: null,
        parentAsin: null,
        variationAsin: null,
        canonicalAmazonUrl: null,
        urlAsin: null,
        canonicalTagAsin: null,
        structuredDataAsin: null,
        provenanceSources,
        discrepancyDetected: false,
        rejectionReason: urlCheck.rejectionReason || "Invalid Amazon US URL",
      };
    }
    urlAsin = urlCheck.extractedAsin;
    if (urlAsin) provenanceSources.push("URL_PATH");
  }

  let canonicalTagAsin: string | null = null;
  if (canonicalTags?.canonicalUrl) {
    const canonCheck = validateAmazonUsProductUrl(canonicalTags.canonicalUrl);
    if (!canonCheck.valid) {
      return {
        valid: false,
        asin: null,
        parentAsin: null,
        variationAsin: null,
        canonicalAmazonUrl: null,
        urlAsin,
        canonicalTagAsin: null,
        structuredDataAsin: null,
        provenanceSources,
        discrepancyDetected: true,
        rejectionReason: `Invalid canonical link tag URL: ${canonCheck.rejectionReason}`,
      };
    }
    canonicalTagAsin = canonCheck.extractedAsin;
    if (canonicalTagAsin) provenanceSources.push("CANONICAL_LINK_TAG");
  }

  let dataAsinAttr: string | null = null;
  if (canonicalTags?.dataAsin) {
    const rawAttr = String(canonicalTags.dataAsin).trim().toUpperCase();
    if (!isValidStrictAmazonAsin(rawAttr)) {
      return {
        valid: false,
        asin: null,
        parentAsin: null,
        variationAsin: null,
        canonicalAmazonUrl: null,
        urlAsin,
        canonicalTagAsin,
        structuredDataAsin: null,
        provenanceSources,
        discrepancyDetected: true,
        rejectionReason: `Invalid data-asin attribute '${canonicalTags.dataAsin}'.`,
      };
    }
    dataAsinAttr = rawAttr;
    provenanceSources.push("DATA_ASIN_ATTR");
  }

  let structuredDataAsin: string | null = null;
  if (structuredData?.asin) {
    const rawStruct = String(structuredData.asin).trim().toUpperCase();
    if (!isValidStrictAmazonAsin(rawStruct)) {
      return {
        valid: false,
        asin: null,
        parentAsin: null,
        variationAsin: null,
        canonicalAmazonUrl: null,
        urlAsin,
        canonicalTagAsin,
        structuredDataAsin: null,
        provenanceSources,
        discrepancyDetected: true,
        rejectionReason: `Invalid structured data ASIN '${structuredData.asin}'.`,
      };
    }
    structuredDataAsin = rawStruct;
    provenanceSources.push("JSON_LD_OR_STRUCTURED");
  }

  const parentAsinRaw = structuredData?.parentAsin
    ? String(structuredData.parentAsin).trim().toUpperCase()
    : null;
  const parentAsin =
    parentAsinRaw && isValidStrictAmazonAsin(parentAsinRaw) ? parentAsinRaw : null;

  const variationAsinRaw = structuredData?.variationAsin
    ? String(structuredData.variationAsin).trim().toUpperCase()
    : null;
  const variationAsin =
    variationAsinRaw && isValidStrictAmazonAsin(variationAsinRaw)
      ? variationAsinRaw
      : null;

  const observedPrimaryAsins = [
    urlAsin,
    canonicalTagAsin,
    dataAsinAttr,
    structuredDataAsin,
  ].filter((a): a is string => Boolean(a));

  if (observedPrimaryAsins.length === 0) {
    return {
      valid: false,
      asin: null,
      parentAsin,
      variationAsin,
      canonicalAmazonUrl: null,
      urlAsin,
      canonicalTagAsin,
      structuredDataAsin,
      provenanceSources,
      discrepancyDetected: false,
      rejectionReason: "No valid ASIN found in URL, canonical tag, or structured metadata.",
    };
  }

  const uniquePrimary = Array.from(new Set(observedPrimaryAsins));
  if (uniquePrimary.length > 1) {
    // Only allow canonicalTagAsin === parentAsin if variationAsin explicitly equals urlAsin/structuredDataAsin
    const isExplicitParentCanonicalOnly =
      uniquePrimary.length === 2 &&
      parentAsin !== null &&
      variationAsin !== null &&
      canonicalTagAsin === parentAsin &&
      (urlAsin === variationAsin || structuredDataAsin === variationAsin) &&
      (structuredDataAsin === null || structuredDataAsin === variationAsin) &&
      (dataAsinAttr === null || dataAsinAttr === variationAsin);

    if (!isExplicitParentCanonicalOnly) {
      return {
        valid: false,
        asin: null,
        parentAsin,
        variationAsin,
        canonicalAmazonUrl: null,
        urlAsin,
        canonicalTagAsin,
        structuredDataAsin,
        provenanceSources,
        discrepancyDetected: true,
        rejectionReason: `ASIN_DISCREPANCY_ACROSS_SOURCES: Conflicting ASINs observed across URL (${urlAsin || "none"}), canonical tag (${canonicalTagAsin || dataAsinAttr || "none"}), and structured metadata (${structuredDataAsin || "none"}).`,
      };
    }
  }

  const resolvedAsin = variationAsin || urlAsin || structuredDataAsin || dataAsinAttr || canonicalTagAsin!;

  return {
    valid: true,
    asin: resolvedAsin,
    parentAsin: parentAsin || null,
    variationAsin: variationAsin || (parentAsin && parentAsin !== resolvedAsin ? resolvedAsin : null),
    canonicalAmazonUrl: `https://www.amazon.com/dp/${resolvedAsin}`,
    urlAsin,
    canonicalTagAsin: canonicalTagAsin || dataAsinAttr,
    structuredDataAsin,
    provenanceSources,
    discrepancyDetected: false,
    rejectionReason: null,
  };
}

/**
 * Canonicalizes an Amazon product identity while preserving variation child vs parent ASINs.
 * Never merges distinct child ASINs by fuzzy title alone (A06).
 */
export function canonicalizeAmazonProductIdentity(record: {
  asin: string;
  parentAsin?: string | null;
  variationAsin?: string | null;
  productTitle?: string | null;
  brand?: string | null;
  modelNumber?: string | null;
  sku?: string | null;
}): CanonicalAmazonIdentityRecord {
  const cleanAsin = String(record.asin || "").trim().toUpperCase();
  if (!isValidStrictAmazonAsin(cleanAsin)) {
    throw new Error(`INVALID_ASIN: Cannot canonicalize invalid ASIN '${record.asin}'.`);
  }

  const cleanParent =
    record.parentAsin && isValidStrictAmazonAsin(record.parentAsin.trim().toUpperCase())
      ? record.parentAsin.trim().toUpperCase()
      : null;
  const cleanVariation =
    record.variationAsin && isValidStrictAmazonAsin(record.variationAsin.trim().toUpperCase())
      ? record.variationAsin.trim().toUpperCase()
      : cleanParent && cleanParent !== cleanAsin
      ? cleanAsin
      : null;

  const effectiveAsin = cleanVariation || cleanAsin;
  const isVariationChild = Boolean(cleanParent && cleanParent !== effectiveAsin);

  const normalizedBrand = record.brand
    ? record.brand
        .replace(/^(?:visit the|brand:|by)\s+/i, "")
        .replace(/\s+store$/i, "")
        .trim()
    : null;

  const normalizedTitle = String(record.productTitle || "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    canonicalIdentityKey: `amz_us:${effectiveAsin}`,
    parentFamilyKey: `amz_us_parent:${cleanParent || effectiveAsin}`,
    asin: effectiveAsin,
    parentAsin: cleanParent,
    variationAsin: cleanVariation,
    isVariationChild,
    canonicalAmazonUrl: `https://www.amazon.com/dp/${effectiveAsin}`,
    normalizedBrand: normalizedBrand || null,
    normalizedTitle,
    modelNumber: record.modelNumber ? String(record.modelNumber).trim() : null,
    sku: record.sku ? String(record.sku).trim() : null,
  };
}

/**
 * Deterministically deduplicates canonical Amazon identity records by exact item/variation ASIN.
 * Distinct variation ASINs under the same parentAsin are preserved as separate items.
 */
export function deduplicateCanonicalAmazonIdentities(
  records: CanonicalAmazonIdentityRecord[]
): CanonicalAmazonIdentityRecord[] {
  const byKey = new Map<string, CanonicalAmazonIdentityRecord>();
  for (const rec of records) {
    const existing = byKey.get(rec.canonicalIdentityKey);
    if (!existing) {
      byKey.set(rec.canonicalIdentityKey, rec);
    } else {
      byKey.set(rec.canonicalIdentityKey, {
        ...existing,
        parentAsin: existing.parentAsin || rec.parentAsin,
        variationAsin: existing.variationAsin || rec.variationAsin,
        isVariationChild: existing.isVariationChild || rec.isVariationChild,
        normalizedBrand: existing.normalizedBrand || rec.normalizedBrand,
        normalizedTitle:
          existing.normalizedTitle.length >= rec.normalizedTitle.length
            ? existing.normalizedTitle
            : rec.normalizedTitle,
        modelNumber: existing.modelNumber || rec.modelNumber,
        sku: existing.sku || rec.sku,
      });
    }
  }
  return Array.from(byKey.values());
}

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/gi,
  /system\s*prompt\s*:/gi,
  /you\s+are\s+now\s+an?\s+/gi,
  /\b(?:execSync|spawnSync|child_process|rm\s+-rf|process\.exit)\b/gi,
  /\bKH02_AMAZON_US_(?:ENABLED|LIVE_ALLOWED)\s*=\s*true\b/gi,
  /<script\b[^>]*>[\s\S]*?<\/script>/gi,
  /<style\b[^>]*>[\s\S]*?<\/style>/gi,
  /<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi,
  /\bon[a-z]+\s*=\s*["'][^"']*["']/gi,
  /javascript\s*:/gi,
];

/**
 * Strips untrusted HTML/script tags and neutralizes prompt-injection / command-injection strings
 * embedded in external HTML or JSON-LD (Section 2.5 & A24).
 */
export function sanitizeUntrustedAmazonText(rawText: unknown): {
  sanitized: string | null;
  warnings: string[];
} {
  if (rawText === null || rawText === undefined) {
    return { sanitized: null, warnings: [] };
  }
  let text = String(rawText);
  const warnings: string[] = [];

  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      warnings.push(`SANITIZED_UNTRUSTED_PATTERN:${pattern.source.slice(0, 32)}`);
      text = text.replace(pattern, " ");
    }
  }

  // Strip remaining HTML tags
  if (/<[^>]+>/.test(text)) {
    warnings.push("STRIPPED_HTML_TAGS");
    text = text.replace(/<[^>]+>/g, " ");
  }

  // Remove control characters
  text = text.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();

  return {
    sanitized: text.length > 0 ? text.slice(0, 500) : null,
    warnings,
  };
}

export interface RawAmazonSnapshotInput {
  sourceUrl: string;
  finalUrl?: string | null;
  httpStatus?: number | null;
  html?: string | null;
  pageTitle?: string | null;
  canonicalUrl?: string | null;
  dataAsin?: string | null;
  structuredData?: {
    asin?: string | null;
    parentAsin?: string | null;
    variationAsin?: string | null;
    productTitle?: string | null;
    brand?: string | null;
    merchant?: string | null;
    seller?: string | null;
    currency?: string | null;
    price?: number | string | null;
    availability?: string | null;
    modelNumber?: string | null;
    sku?: string | null;
    gtin?: string | null;
    reviewCount?: number | null;
    bestSellersRank?: number | null;
    explicitUsDeliveryConfirmed?: boolean;
    deliveryLocationText?: string | null;
    deliveryPostalCode?: string | null;
    isSponsored?: boolean;
    searchCards?: Array<{
      asin?: string | null;
      title?: string | null;
      productTitle?: string | null;
      url?: string | null;
      brand?: string | null;
      price?: number | string | null;
      currency?: string | null;
      isSponsored?: boolean;
      sponsoredLabel?: string | null;
    }>;
  } | null;
}

export interface ParseAmazonEvidenceMetadata {
  workspaceId: string;
  researchRunId: string;
  candidateId: string;
  observedAt?: string;
  sourceTimestamp?: string | null;
  providerInvocationRef?: string | null;
  providerRequestId?: string | null;
  observationClass?: MarketplaceObservationClass;
  requestMode?: "URL_VERIFICATION" | "AUTHORIZED_SEARCH" | "USER_IMPORTED" | "TEST_FIXTURE" | "NONE";
  accessPolicyStatus?: AmazonProductEvidence["accessPolicyStatus"];
  isCached?: boolean;
}

/**
 * Independently parses an accessible Amazon product snapshot or response payload,
 * detects CAPTCHA/botwall/login/403/429/country mismatch/empty pages, distinguishes
 * absent price (null) from zero price, and preserves URL/ASIN discrepancies as rejections.
 */
export function parseAmazonProductEvidence(
  snapshot: RawAmazonSnapshotInput,
  responseMetadata: ParseAmazonEvidenceMetadata
): AmazonProductEvidence {
  const observedAt = responseMetadata.observedAt || new Date().toISOString();
  const sourceTimestamp = responseMetadata.sourceTimestamp ?? null;
  const observationClass: MarketplaceObservationClass =
    responseMetadata.observationClass || "UNVERIFIED";
  const requestMode = responseMetadata.requestMode || "URL_VERIFICATION";
  const accessPolicyStatus =
    responseMetadata.accessPolicyStatus || "FIXTURE_OR_USER_IMPORT_ONLY";

  // Extract only वास्तविक (genuine) upstream providerRequestId; never copy local providerInvocationRef
  const localInvocationRef =
    responseMetadata.providerInvocationRef ||
    `amz_inv_${responseMetadata.researchRunId}_${responseMetadata.candidateId}`;
  const rawUpstreamReqId = responseMetadata.providerRequestId
    ? String(responseMetadata.providerRequestId).trim()
    : null;
  const isSyntheticOrLocalReqId =
    !rawUpstreamReqId ||
    rawUpstreamReqId === localInvocationRef ||
    /^(?:amz_inv_|mcp_inv_|local_inv_|synthetic_|fake_)/i.test(rawUpstreamReqId);
  const providerRequestId = isSyntheticOrLocalReqId ? null : rawUpstreamReqId;

  const rawEvidenceHash = computeDeterministicEvidenceHash({
    sourceUrl: snapshot.sourceUrl,
    finalUrl: snapshot.finalUrl ?? null,
    httpStatus: snapshot.httpStatus ?? null,
    pageTitle: snapshot.pageTitle ?? null,
    canonicalUrl: snapshot.canonicalUrl ?? null,
    dataAsin: snapshot.dataAsin ?? null,
    structuredData: snapshot.structuredData ?? null,
    htmlDigest: snapshot.html ? computeDeterministicEvidenceHash(snapshot.html) : null,
  });

  const buildRejected = (
    status: MarketplaceEvidenceStatus,
    reasons: string[],
    partial?: Partial<AmazonProductEvidence>
  ): AmazonProductEvidence => {
    const idSeed = `${responseMetadata.workspaceId}:${responseMetadata.researchRunId}:${responseMetadata.candidateId}:AMAZON_US:${partial?.asin || "REJECTED"}`;
    const idHash = computeDeterministicEvidenceHash(idSeed)?.slice(0, 20) || "rejected";
    return {
      id: `amz_ev_${idHash}`,
      workspaceId: responseMetadata.workspaceId,
      researchRunId: responseMetadata.researchRunId,
      candidateId: responseMetadata.candidateId,
      provider: "AMAZON_US",
      requestMode,
      requestedMarket: "US",
      verifiedDeliveryMarket: null,
      sourceUrl: snapshot.sourceUrl || null,
      finalUrl: snapshot.finalUrl || null,
      canonicalAmazonUrl: partial?.canonicalAmazonUrl || null,
      asin: partial?.asin || null,
      parentAsin: partial?.parentAsin || null,
      variationAsin: partial?.variationAsin || null,
      productTitle: null,
      brand: null,
      merchant: null,
      seller: null,
      currency: null,
      price: null,
      availability: null,
      observedAt,
      sourceTimestamp,
      rawEvidenceHash,
      extractedFieldsHash: null,
      providerInvocationRef: localInvocationRef,
      providerRequestId,
      responseEvidenceRef: rawEvidenceHash ? `amz_raw:${rawEvidenceHash.slice(0, 16)}` : null,
      evidenceOrigin: observationClass === "AUTHORIZED_LIVE" ? "AMAZON_US_LIVE_MCP" : `AMAZON_US_${observationClass}`,
      httpStatus:
        typeof snapshot.httpStatus === "number" && Number.isFinite(snapshot.httpStatus)
          ? snapshot.httpStatus
          : null,
      httpStatusOrigin:
        typeof snapshot.httpStatus === "number" && Number.isFinite(snapshot.httpStatus)
          ? "OBSERVED"
          : "UNOBSERVED_NULL",
      observationClass,
      verificationScope: null,
      identityMatch: "NO_MATCH",
      isCached: Boolean(responseMetadata.isCached || observationClass === "CACHED"),
      matchedCanonicalKey: null,
      matchingReasons: [],
      missingFields: ["asin", "productTitle", "brand"],
      rejectionReasons: reasons,
      sanitizationWarnings: partial?.sanitizationWarnings || [],
      accessPolicyStatus,
      status,
    };
  };

  // 1. Validate URL & Redirects first
  const urlValidation = validateAmazonUsProductUrl(snapshot.sourceUrl, snapshot.finalUrl);
  if (!urlValidation.valid) {
    const code = urlValidation.rejectionCode || "INVALID_URL";
    const status: MarketplaceEvidenceStatus =
      code === "FINAL_URL_AUTH_OR_BOT_REDIRECT"
        ? "BLOCKED_PROVIDER"
        : "FAILED";
    return buildRejected(status, [
      `${code}: ${urlValidation.rejectionReason || "Invalid Amazon US URL"}`,
    ]);
  }

  // 2. Inspect HTTP status & HTML/title for CAPTCHA, bot wall, rate limit, login wall
  // BUG T4 fix: Do NOT default httpStatus to 200 when unobserved; preserve null ("UNOBSERVED_NULL")
  const combinedHtml = `${snapshot.pageTitle || ""} ${snapshot.html || ""}`;
  const httpStatus: number | null =
    typeof snapshot.httpStatus === "number" && Number.isFinite(snapshot.httpStatus)
      ? snapshot.httpStatus
      : null;
  const httpStatusOrigin: "OBSERVED" | "UNOBSERVED_NULL" =
    httpStatus !== null ? "OBSERVED" : "UNOBSERVED_NULL";

  if (httpStatus === 429 || /429\s+too\s+many\s+requests|rate\s+limit\s+exceeded/i.test(combinedHtml)) {
    return buildRejected("RATE_LIMITED", ["HTTP_429_OR_RATE_LIMITED"]);
  }

  if (
    /validateCaptcha|opfcaptcha|Enter the characters you see below|not a robot|api-services-support@amazon\.com|type the characters you see in this image/i.test(
      combinedHtml
    )
  ) {
    return buildRejected("CAPTCHA_BLOCKED", ["AMAZON_CAPTCHA_CHALLENGE_DETECTED"]);
  }

  if (
    httpStatus === 403 ||
    httpStatus === 503 ||
    /To discuss automated access to Amazon data|Request blocked|Automated access|Sorry!\s+Something went wrong on our end/i.test(
      combinedHtml
    )
  ) {
    return buildRejected("BLOCKED_PROVIDER", [`HTTP_${httpStatus}_OR_BOT_WALL_BLOCKED`]);
  }

  const isLoginWallPage =
    /Amazon\s+Sign-In|ap_email|Sign in to continue/i.test(combinedHtml) ||
    (/\/ap\/signin|Sign-In/i.test(combinedHtml) &&
      !/nav_ya_signin|nav_custrec_signin|Hello,\s*sign\s*in/i.test(combinedHtml) &&
      !snapshot.structuredData?.productTitle);
  if (isLoginWallPage) {
    return buildRejected("BLOCKED_PROVIDER", ["LOGIN_WALL_DETECTED"]);
  }

  if (
    httpStatus === 404 ||
    /Page Not Found|dogs of amazon|looking for something\?\s*We're sorry/i.test(combinedHtml)
  ) {
    return buildRejected("QUERY_SUCCEEDED_EMPTY", ["PRODUCT_PAGE_NOT_FOUND_404"]);
  }

  if (snapshot.structuredData?.isSponsored === true) {
    return buildRejected("FAILED", ["SPONSORED_AD_LISTING_REJECTED"]);
  }

  // 3. Extract and cross-verify ASIN across URL, canonical tag, and structured data
  const asinCheck = extractAmazonAsinFromProductEvidence(
    snapshot.sourceUrl,
    snapshot.structuredData,
    {
      canonicalUrl: snapshot.canonicalUrl,
      dataAsin: snapshot.dataAsin,
    }
  );

  if (!asinCheck.valid || !asinCheck.asin) {
    return buildRejected("FAILED", [
      asinCheck.rejectionReason || "ASIN_EXTRACTION_FAILED",
    ]);
  }

  // 4. Sanitize untrusted strings
  const sanitizationWarnings: string[] = [];
  const rawTitle = snapshot.structuredData?.productTitle ?? snapshot.pageTitle ?? null;
  const titleSanitized = sanitizeUntrustedAmazonText(rawTitle);
  sanitizationWarnings.push(...titleSanitized.warnings);

  const brandSanitized = sanitizeUntrustedAmazonText(snapshot.structuredData?.brand);
  sanitizationWarnings.push(...brandSanitized.warnings);

  const merchantSanitized = sanitizeUntrustedAmazonText(snapshot.structuredData?.merchant);
  const sellerSanitized = sanitizeUntrustedAmazonText(snapshot.structuredData?.seller);
  const availSanitized = sanitizeUntrustedAmazonText(snapshot.structuredData?.availability);
  const modelSanitized = sanitizeUntrustedAmazonText(snapshot.structuredData?.modelNumber);
  const skuSanitized = sanitizeUntrustedAmazonText(snapshot.structuredData?.sku);
  const gtinSanitized = sanitizeUntrustedAmazonText(snapshot.structuredData?.gtin);

  if (!titleSanitized.sanitized) {
    return buildRejected(
      "QUERY_SUCCEEDED_EMPTY",
      ["MISSING_OBSERVED_PRODUCT_TITLE"],
      {
        asin: asinCheck.asin,
        parentAsin: asinCheck.parentAsin,
        variationAsin: asinCheck.variationAsin,
        canonicalAmazonUrl: asinCheck.canonicalAmazonUrl,
        sanitizationWarnings,
      }
    );
  }

  // 5. Currency & Market check (reject non-USD currency if explicitly non-US)
  const rawCurrency = snapshot.structuredData?.currency
    ? String(snapshot.structuredData.currency).trim().toUpperCase()
    : null;
  if (rawCurrency && rawCurrency !== "USD") {
    return buildRejected(
      "FAILED",
      [`COUNTRY_MARKETPLACE_CURRENCY_MISMATCH:${rawCurrency}`],
      {
        asin: asinCheck.asin,
        parentAsin: asinCheck.parentAsin,
        variationAsin: asinCheck.variationAsin,
        canonicalAmazonUrl: asinCheck.canonicalAmazonUrl,
        sanitizationWarnings,
      }
    );
  }

  // 6. Price parsing: absent price MUST be null, NEVER 0 (A22)
  let parsedPrice: number | null = null;
  const rawPrice = snapshot.structuredData?.price;
  if (rawPrice !== null && rawPrice !== undefined && String(rawPrice).trim() !== "") {
    const numericPrice =
      typeof rawPrice === "number"
        ? rawPrice
        : Number(String(rawPrice).replace(/[^0-9.]/g, ""));
    if (Number.isFinite(numericPrice) && numericPrice > 0) {
      parsedPrice = Math.round(numericPrice * 100) / 100;
    }
  }

  const canonicalIdentity = canonicalizeAmazonProductIdentity({
    asin: asinCheck.asin,
    parentAsin: asinCheck.parentAsin,
    variationAsin: asinCheck.variationAsin,
    productTitle: titleSanitized.sanitized,
    brand: brandSanitized.sanitized,
    modelNumber: modelSanitized.sanitized,
    sku: skuSanitized.sanitized,
  });

  const missingFields: string[] = [];
  if (!canonicalIdentity.normalizedBrand) missingFields.push("brand");
  if (parsedPrice === null) missingFields.push("price");
  if (!availSanitized.sanitized) missingFields.push("availability");
  if (!merchantSanitized.sanitized && !sellerSanitized.sanitized) {
    missingFields.push("merchantOrSeller");
  }

  const extractedPayload = {
    asin: canonicalIdentity.asin,
    parentAsin: canonicalIdentity.parentAsin,
    variationAsin: canonicalIdentity.variationAsin,
    canonicalAmazonUrl: canonicalIdentity.canonicalAmazonUrl,
    productTitle: canonicalIdentity.normalizedTitle,
    brand: canonicalIdentity.normalizedBrand,
    merchant: merchantSanitized.sanitized,
    seller: sellerSanitized.sanitized,
    currency: parsedPrice !== null ? rawCurrency || "USD" : rawCurrency,
    price: parsedPrice,
    availability: availSanitized.sanitized,
    modelNumber: canonicalIdentity.modelNumber,
    sku: canonicalIdentity.sku,
    gtin: gtinSanitized.sanitized,
  };
  const extractedFieldsHash = computeDeterministicEvidenceHash(extractedPayload);

  // Only confirm verifiedDeliveryMarket="US" and observedDeliveryPostalCode when explicit US delivery confirmation is observed
  const rawDeliveryZip =
    (snapshot.structuredData?.deliveryPostalCode &&
      String(snapshot.structuredData.deliveryPostalCode).trim().match(/^\d{5}$/)?.[0]) ||
    (snapshot.structuredData?.deliveryLocationText &&
      String(snapshot.structuredData.deliveryLocationText).match(
        /\b(?:deliver(?:\s+to)?|new\s+york|los\s+angeles|chicago|united\s+states|us|ny|ca|tx|fl)[^\n0-9]{0,30}\b(\d{5})\b/i
      )?.[1]) ||
    combinedHtml.match(
      /\bDeliver\s+to\s+(?:[A-Za-z][A-Za-z\s.]{1,28}\s+)?(\d{5})\b/i
    )?.[1] ||
    null;
  const observedDeliveryPostalCode: string | null = rawDeliveryZip || null;
  const verifiedDeliveryMarket: "US" | null =
    snapshot.structuredData?.explicitUsDeliveryConfirmed === true ||
    observedDeliveryPostalCode !== null ||
    Boolean(
      snapshot.structuredData?.deliveryLocationText &&
        /\b(?:deliver\s+to\s+united\s+states|deliver\s+to\s+us)\b/i.test(
          snapshot.structuredData.deliveryLocationText
        )
    )
      ? "US"
      : null;

  const idSeed = `${responseMetadata.workspaceId}:${responseMetadata.researchRunId}:${responseMetadata.candidateId}:AMAZON_US:${canonicalIdentity.asin}`;
  const idHash = computeDeterministicEvidenceHash(idSeed)?.slice(0, 20) || canonicalIdentity.asin;

  return {
    id: `amz_ev_${idHash}`,
    workspaceId: responseMetadata.workspaceId,
    researchRunId: responseMetadata.researchRunId,
    candidateId: responseMetadata.candidateId,
    provider: "AMAZON_US",
    requestMode,
    requestedMarket: "US",
    verifiedDeliveryMarket,
    observedDeliveryPostalCode,
    sourceUrl: snapshot.sourceUrl,
    finalUrl: snapshot.finalUrl || canonicalIdentity.canonicalAmazonUrl,
    canonicalAmazonUrl: canonicalIdentity.canonicalAmazonUrl,
    asin: canonicalIdentity.asin,
    parentAsin: canonicalIdentity.parentAsin,
    variationAsin: canonicalIdentity.variationAsin,
    productTitle: canonicalIdentity.normalizedTitle,
    brand: canonicalIdentity.normalizedBrand,
    merchant: merchantSanitized.sanitized,
    seller: sellerSanitized.sanitized,
    currency: parsedPrice !== null ? rawCurrency || "USD" : rawCurrency,
    price: parsedPrice,
    availability: availSanitized.sanitized,
    modelNumber: canonicalIdentity.modelNumber,
    sku: canonicalIdentity.sku,
    gtin: gtinSanitized.sanitized,
    observedAt,
    sourceTimestamp,
    rawEvidenceHash,
    extractedFieldsHash,
    providerInvocationRef: localInvocationRef,
    providerRequestId,
    responseEvidenceRef: rawEvidenceHash ? `amz_raw:${rawEvidenceHash.slice(0, 16)}` : null,
    evidenceOrigin:
      observationClass === "AUTHORIZED_LIVE"
        ? "AMAZON_US_LIVE_MCP"
        : `AMAZON_US_${observationClass}`,
    httpStatus,
    httpStatusOrigin,
    observationClass,
    verificationScope: "LISTING_OBSERVED",
    identityMatch: "AMBIGUOUS",
    isCached: Boolean(responseMetadata.isCached || observationClass === "CACHED"),
    matchedCanonicalKey: canonicalIdentity.canonicalIdentityKey,
    matchingReasons: [`Observed canonical ASIN ${canonicalIdentity.asin}`],
    missingFields,
    rejectionReasons: [],
    sanitizationWarnings,
    accessPolicyStatus,
    status: "OBSERVED_UNVERIFIED",
  };
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "your",
  "our",
  "new",
  "best",
  "pro",
  "plus",
  "pack",
  "set",
  "kit",
  "official",
  "store",
  "shop",
  "usa",
  "us",
]);

function tokenizeMeaningfulProductWords(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function normalizeBrandToken(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/^(?:visit the|brand:|by|the)\s+/i, "")
    .replace(/\s+(?:store|official|shop|inc|llc|co)$/i, "")
    .replace(/\.(?:com|net|org|io|co|shop|store)$/i, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Strictly verifies whether an observed Amazon product listing matches a specific KH-02 candidate.
 * - EXACT_PRODUCT requires independent product-specific corroboration (brand/merchant match + specific product/model/title match).
 * - Matching brand alone NEVER returns EXACT_PRODUCT (returns BRAND_ONLY).
 * - Accessories/refills/different SKUs of the same brand return BRAND_ONLY or NO_MATCH.
 * - Listing existence NEVER verifies sales or 60-day demand.
 */
export function verifyAmazonProductIdentity(
  candidate: {
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
  },
  evidence: AmazonProductEvidence
): {
  identityMatch: IdentityMatch;
  status: MarketplaceEvidenceStatus;
  verificationScope: MarketplaceVerificationScope | null;
  matchingReasons: string[];
  rejectionReasons: string[];
  updatedEvidence: AmazonProductEvidence;
} {
  if (
    evidence.rejectionReasons.length > 0 ||
    !evidence.asin ||
    !evidence.productTitle ||
    evidence.status === "FAILED" ||
    evidence.status === "BLOCKED_POLICY" ||
    evidence.status === "BLOCKED_PROVIDER" ||
    evidence.status === "CAPTCHA_BLOCKED" ||
    evidence.status === "RATE_LIMITED" ||
    evidence.status === "TIMED_OUT" ||
    evidence.status === "QUERY_SUCCEEDED_EMPTY"
  ) {
    return {
      identityMatch: "NO_MATCH",
      status: evidence.status,
      verificationScope: null,
      matchingReasons: [],
      rejectionReasons:
        evidence.rejectionReasons.length > 0
          ? evidence.rejectionReasons
          : ["EVIDENCE_NOT_ELIGIBLE_FOR_IDENTITY_MATCH"],
      updatedEvidence: {
        ...evidence,
        identityMatch: "NO_MATCH",
        verificationScope: null,
      },
    };
  }

  const candidateTitle =
    candidate.merchantVerifiedProductName ||
    candidate.canonicalProductName ||
    candidate.title ||
    "";
  const candWords = tokenizeMeaningfulProductWords(candidateTitle);
  const amzWords = tokenizeMeaningfulProductWords(evidence.productTitle);

  if (candWords.length === 0 || amzWords.length === 0) {
    const reasons = ["INSUFFICIENT_PRODUCT_TITLE_TOKENS"];
    return {
      identityMatch: "AMBIGUOUS",
      status: "OBSERVED_UNVERIFIED",
      verificationScope: "LISTING_OBSERVED",
      matchingReasons: [],
      rejectionReasons: reasons,
      updatedEvidence: {
        ...evidence,
        identityMatch: "AMBIGUOUS",
        status: "OBSERVED_UNVERIFIED",
        verificationScope: "LISTING_OBSERVED",
        rejectionReasons: reasons,
      },
    };
  }

  const candBrandNorm = normalizeBrandToken(
    candidate.brand || candidate.storeDomain?.split(".")[0] || ""
  );
  const amzBrandNorm = normalizeBrandToken(
    evidence.brand || evidence.merchant || evidence.seller || ""
  );

  // Check if brand is present in title when brand field is missing
  const brandMatched = Boolean(
    candBrandNorm &&
      candBrandNorm.length >= 3 &&
      ((amzBrandNorm &&
        (amzBrandNorm === candBrandNorm ||
          amzBrandNorm.includes(candBrandNorm) ||
          candBrandNorm.includes(amzBrandNorm))) ||
        evidence.productTitle
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .includes(candBrandNorm))
  );

  const explicitBrandConflict = Boolean(
    candBrandNorm &&
      amzBrandNorm &&
      candBrandNorm.length >= 3 &&
      amzBrandNorm.length >= 3 &&
      !brandMatched
  );

  // Check accessory/replacement mismatch (e.g. main fountain vs replacement filters)
  const accessoryRegex = /\b(?:replacement\s+filters?|refill\s+pack|spare\s+parts?|charcoal\s+filters?\s+only|adapter\s+only)\b/i;
  const candIsAccessory = accessoryRegex.test(candidateTitle);
  const amzIsAccessory = accessoryRegex.test(evidence.productTitle);
  const accessoryMismatch = candIsAccessory !== amzIsAccessory;

  // Token overlap excluding brand token
  const nonBrandCandWords = candWords.filter(
    (w) => !candBrandNorm || w.replace(/[^a-z0-9]/g, "") !== candBrandNorm
  );
  const amzWordSet = new Set(amzWords);
  const matchedProductTokens = nonBrandCandWords.filter((w) => amzWordSet.has(w));
  const overlapRatio =
    nonBrandCandWords.length > 0
      ? matchedProductTokens.length / nonBrandCandWords.length
      : 0;

  // Exact identifier corroboration (GTIN, ASIN, Model, SKU)
  const exactAsinMatch = Boolean(
    candidate.asin && candidate.asin.trim().toUpperCase() === evidence.asin
  );
  const exactGtinMatch = Boolean(
    candidate.gtin &&
      evidence.gtin &&
      candidate.gtin.trim().toUpperCase() === evidence.gtin.trim().toUpperCase()
  );
  const exactModelMatch = Boolean(
    candidate.model &&
      evidence.modelNumber &&
      candidate.model.trim().toLowerCase() === evidence.modelNumber.trim().toLowerCase()
  );
  const conflictingModel = Boolean(
    candidate.model &&
      evidence.modelNumber &&
      candidate.model.trim().toLowerCase() !== evidence.modelNumber.trim().toLowerCase()
  );

  const matchingReasons: string[] = [];
  const rejectionReasons: string[] = [];

  if (conflictingModel) {
    rejectionReasons.push(
      `MODEL_CONFLICT: Candidate model '${candidate.model}' != Amazon model '${evidence.modelNumber}'`
    );
  }
  if (accessoryMismatch) {
    rejectionReasons.push(
      "ACCESSORY_VS_MAIN_PRODUCT_MISMATCH: Replacement/accessory SKU does not match primary product"
    );
  }

  // Case 1: Brand matched, but product tokens do not match or conflicting model/accessory -> BRAND_ONLY
  if (
    brandMatched &&
    (conflictingModel || accessoryMismatch || matchedProductTokens.length < 2 || overlapRatio < 0.5)
  ) {
    matchingReasons.push(
      `Brand '${evidence.brand || candidate.brand}' matched, but product SKU/tokens differ (overlap=${matchedProductTokens.length}/${nonBrandCandWords.length})`
    );
    return {
      identityMatch: "BRAND_ONLY",
      status: "OBSERVED_UNVERIFIED",
      verificationScope: "LISTING_OBSERVED",
      matchingReasons,
      rejectionReasons,
      updatedEvidence: {
        ...evidence,
        identityMatch: "BRAND_ONLY",
        status: "OBSERVED_UNVERIFIED",
        verificationScope: "LISTING_OBSERVED",
        matchingReasons,
        rejectionReasons,
      },
    };
  }

  // Case 2: Explicit brand conflict
  if (explicitBrandConflict) {
    rejectionReasons.push(
      `BRAND_CONFLICT: Candidate brand '${candidate.brand || candidate.storeDomain}' != Amazon brand '${evidence.brand}'`
    );
    return {
      identityMatch: "NO_MATCH",
      status: "OBSERVED_UNVERIFIED",
      verificationScope: "LISTING_OBSERVED",
      matchingReasons: [],
      rejectionReasons,
      updatedEvidence: {
        ...evidence,
        identityMatch: "NO_MATCH",
        status: "OBSERVED_UNVERIFIED",
        verificationScope: "LISTING_OBSERVED",
        matchingReasons: [],
        rejectionReasons,
      },
    };
  }

  // Case 3: EXACT_PRODUCT requires brandMatched AND (exact identifier OR strong product token overlap >= 0.6 with >= 2 non-brand product tokens) and zero model/accessory conflicts
  if (
    brandMatched &&
    !conflictingModel &&
    !accessoryMismatch &&
    (exactAsinMatch ||
      exactGtinMatch ||
      exactModelMatch ||
      (matchedProductTokens.length >= 2 && overlapRatio >= 0.6))
  ) {
    matchingReasons.push(`Corroborated brand '${evidence.brand || candidate.brand}'`);
    if (exactAsinMatch) matchingReasons.push(`Exact ASIN match (${evidence.asin})`);
    if (exactGtinMatch) matchingReasons.push(`Exact GTIN match (${evidence.gtin})`);
    if (exactModelMatch) matchingReasons.push(`Exact model match (${evidence.modelNumber})`);
    matchingReasons.push(
      `Product token corroboration (${matchedProductTokens.join(", ")}; ratio=${overlapRatio.toFixed(2)})`
    );

    return {
      identityMatch: "EXACT_PRODUCT",
      status: "IDENTITY_VERIFIED",
      verificationScope: "IDENTITY_CORROBORATED",
      matchingReasons,
      rejectionReasons: [],
      updatedEvidence: {
        ...evidence,
        identityMatch: "EXACT_PRODUCT",
        status: "IDENTITY_VERIFIED",
        verificationScope: "IDENTITY_CORROBORATED",
        matchingReasons,
        rejectionReasons: [],
      },
    };
  }

  // Case 4: Strong product token overlap without brand confirmation -> PROBABLE_PRODUCT
  if (!conflictingModel && !accessoryMismatch && matchedProductTokens.length >= 2 && overlapRatio >= 0.6) {
    matchingReasons.push(
      `Probable product title token overlap (${matchedProductTokens.join(", ")}) without independent brand/identifier corroboration`
    );
    return {
      identityMatch: "PROBABLE_PRODUCT",
      status: "OBSERVED_UNVERIFIED",
      verificationScope: "LISTING_OBSERVED",
      matchingReasons,
      rejectionReasons,
      updatedEvidence: {
        ...evidence,
        identityMatch: "PROBABLE_PRODUCT",
        status: "OBSERVED_UNVERIFIED",
        verificationScope: "LISTING_OBSERVED",
        matchingReasons,
        rejectionReasons,
      },
    };
  }

  rejectionReasons.push(
    `INSUFFICIENT_PRODUCT_CORROBORATION: overlap=${matchedProductTokens.length}/${nonBrandCandWords.length}`
  );
  return {
    identityMatch: "NO_MATCH",
    status: "OBSERVED_UNVERIFIED",
    verificationScope: "LISTING_OBSERVED",
    matchingReasons: [],
    rejectionReasons,
    updatedEvidence: {
      ...evidence,
      identityMatch: "NO_MATCH",
      status: "OBSERVED_UNVERIFIED",
      verificationScope: "LISTING_OBSERVED",
      matchingReasons: [],
      rejectionReasons,
    },
  };
}

export interface AmazonSearchUrlValidationResult {
  valid: boolean;
  normalizedSearchUrl: string | null;
  query: string | null;
  rejectionCode?: string;
  rejectionReason?: string;
}

/**
 * Validates an Amazon US search URL (`https://www.amazon.com/s?k=...`) for the
 * explicitly authorized local Playwright MCP bounded search->PDP pilot flow.
 * Never weakens `validateAmazonUsProductUrl` (which continues to reject `/s?k=...` for product URLs).
 */
export function validateAmazonUsSearchUrl(
  rawUrl: string | null | undefined,
  finalUrl?: string | null
): AmazonSearchUrlValidationResult {
  if (!rawUrl || typeof rawUrl !== "string") {
    return {
      valid: false,
      normalizedSearchUrl: null,
      query: null,
      rejectionCode: "EMPTY_SEARCH_URL",
      rejectionReason: "Search URL is empty.",
    };
  }
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      normalizedSearchUrl: null,
      query: null,
      rejectionCode: "MALFORMED_SEARCH_URL",
      rejectionReason: "Search URL could not be parsed.",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      valid: false,
      normalizedSearchUrl: null,
      query: null,
      rejectionCode: "NON_HTTPS_SCHEME",
      rejectionReason: "Amazon US search URL must use https:.",
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      normalizedSearchUrl: null,
      query: null,
      rejectionCode: "URL_CREDENTIALS_FORBIDDEN",
      rejectionReason: "Credentials in URL are forbidden.",
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== "www.amazon.com" && host !== "amazon.com") {
    return {
      valid: false,
      normalizedSearchUrl: null,
      query: null,
      rejectionCode: "DISALLOWED_HOST",
      rejectionReason: `Host '${host}' is not an allowed US Amazon domain.`,
    };
  }

  if (parsed.pathname !== "/s" && parsed.pathname !== "/s/") {
    return {
      valid: false,
      normalizedSearchUrl: null,
      query: null,
      rejectionCode: "NOT_SEARCH_PATH",
      rejectionReason: `Path '${parsed.pathname}' is not /s.`,
    };
  }

  const q = (parsed.searchParams.get("k") || "").trim();
  if (!q || q.length < 2) {
    return {
      valid: false,
      normalizedSearchUrl: null,
      query: null,
      rejectionCode: "EMPTY_SEARCH_QUERY",
      rejectionReason: "Search query parameter k is missing or too short.",
    };
  }

  if (finalUrl && typeof finalUrl === "string" && finalUrl.trim()) {
    try {
      const fParsed = new URL(finalUrl.trim());
      const fHost = fParsed.hostname.toLowerCase();
      if (fHost !== "www.amazon.com" && fHost !== "amazon.com") {
        return {
          valid: false,
          normalizedSearchUrl: null,
          query: null,
          rejectionCode: "FINAL_URL_HOST_MISMATCH",
          rejectionReason: `Final URL redirected to non-US host '${fHost}'.`,
        };
      }
      if (/\/(?:ap\/signin|errors\/validateCaptcha)/i.test(fParsed.pathname)) {
        return {
          valid: false,
          normalizedSearchUrl: null,
          query: null,
          rejectionCode: "FINAL_URL_AUTH_OR_BOT_REDIRECT",
          rejectionReason: `Final URL redirected to auth/bot challenge '${fParsed.pathname}'.`,
        };
      }
    } catch {
      return {
        valid: false,
        normalizedSearchUrl: null,
        query: null,
        rejectionCode: "MALFORMED_FINAL_URL",
        rejectionReason: "Final URL is malformed.",
      };
    }
  }

  return {
    valid: true,
    normalizedSearchUrl: `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
    query: q,
  };
}

export interface ParsedAmazonSearchCard {
  asin: string;
  canonicalAmazonUrl: string;
  productTitle: string;
  brand: string | null;
  price: number | null;
  currency: "USD" | null;
  observedDeliveryPostalCode: string | null;
  isSponsored: false;
}

export interface ParsedAmazonSearchSnapshotResult {
  botWallDetected: boolean;
  botWallStatus: "CAPTCHA_BLOCKED" | "BLOCKED_PROVIDER" | "RATE_LIMITED" | null;
  botWallReason: string | null;
  observedDeliveryPostalCode: string | null;
  cards: ParsedAmazonSearchCard[];
  rejectedCards: Array<{
    asin: string | null;
    title: string | null;
    reason: string;
  }>;
}

/**
 * Parses an Amazon US search snapshot (`https://www.amazon.com/s?k=...`) captured via
 * the local Playwright MCP session.
 * - Detects CAPTCHA / Robot Check / automated access block first.
 * - Extracts non-sponsored search result cards with strict 10-char ASIN, product title,
 *   canonical `/dp/{ASIN}` URL, and optional observed USD price & US delivery ZIP.
 * - Rejects sponsored cards (`Sponsored`, `/sspa/click`, `gp/slredirect`, `AdHolder`)
 *   and non-ASIN 10-char tokens (`CATEGORIES`, `BESTSELLER`, etc.).
 */
export function parseAmazonSearchSnapshotCards(snapshot: {
  sourceUrl: string;
  finalUrl?: string | null;
  httpStatus?: number | null;
  pageTitle?: string | null;
  rawHtml?: string | null;
  accessibilityTreeText?: string | null;
  structuredData?: {
    deliveryLocationText?: string | null;
    deliveryPostalCode?: string | null;
    searchCards?: Array<{
      asin?: string | null;
      title?: string | null;
      brand?: string | null;
      price?: number | string | null;
      currency?: string | null;
      href?: string | null;
      isSponsored?: boolean;
    }>;
  } | null;
}): ParsedAmazonSearchSnapshotResult {
  const combinedText = `${snapshot.pageTitle || ""}\n${snapshot.rawHtml || ""}\n${
    snapshot.accessibilityTreeText || ""
  }`;
  const httpStatus =
    typeof snapshot.httpStatus === "number" && Number.isFinite(snapshot.httpStatus)
      ? snapshot.httpStatus
      : null;

  if (
    httpStatus === 429 ||
    /429\s+too\s+many\s+requests|rate\s+limit\s+exceeded/i.test(combinedText)
  ) {
    return {
      botWallDetected: true,
      botWallStatus: "RATE_LIMITED",
      botWallReason: "HTTP_429_OR_RATE_LIMITED",
      observedDeliveryPostalCode: null,
      cards: [],
      rejectedCards: [],
    };
  }

  if (
    /validateCaptcha|opfcaptcha|Enter the characters you see below|not a robot|api-services-support@amazon\.com|type the characters you see in this image|Robot Check/i.test(
      combinedText
    )
  ) {
    return {
      botWallDetected: true,
      botWallStatus: "CAPTCHA_BLOCKED",
      botWallReason: "AMAZON_CAPTCHA_CHALLENGE_DETECTED",
      observedDeliveryPostalCode: null,
      cards: [],
      rejectedCards: [],
    };
  }

  if (
    httpStatus === 403 ||
    httpStatus === 503 ||
    /To discuss automated access to Amazon data|Request blocked|Automated access|Sorry!\s+Something went wrong on our end/i.test(
      combinedText
    )
  ) {
    return {
      botWallDetected: true,
      botWallStatus: "BLOCKED_PROVIDER",
      botWallReason: `HTTP_${httpStatus ?? "UNOBSERVED"}_OR_BOT_WALL_BLOCKED`,
      observedDeliveryPostalCode: null,
      cards: [],
      rejectedCards: [],
    };
  }

  const observedDeliveryPostalCode =
    (snapshot.structuredData?.deliveryPostalCode &&
      String(snapshot.structuredData.deliveryPostalCode).trim().match(/^\d{5}$/)?.[0]) ||
    (snapshot.structuredData?.deliveryLocationText &&
      String(snapshot.structuredData.deliveryLocationText).match(/\b(\d{5})\b/)?.[1]) ||
    combinedText.match(
      /\bDeliver\s+to\s+(?:[A-Za-z][A-Za-z\s.]{1,28}\s+)?(\d{5})\b/i
    )?.[1] ||
    null;

  const cards: ParsedAmazonSearchCard[] = [];
  const rejectedCards: Array<{ asin: string | null; title: string | null; reason: string }> = [];
  const seenAsins = new Set<string>();

  const pushCandidateCard = (rawCard: {
    asin?: string | null;
    title?: string | null;
    brand?: string | null;
    price?: number | string | null;
    currency?: string | null;
    href?: string | null;
    isSponsored?: boolean;
    rawSnippet?: string;
  }) => {
    const rawAsin = String(rawCard.asin || "").trim().toUpperCase();
    const cleanTitle = sanitizeUntrustedAmazonText(rawCard.title).sanitized;
    const snippet = `${rawCard.rawSnippet || ""} ${rawCard.href || ""}`;
    const isSponsored =
      Boolean(rawCard.isSponsored) ||
      /\bSponsored\b|\/sspa\/click|\/gp\/slredirect|AdHolder|sp_atk/i.test(snippet);

    if (isSponsored) {
      rejectedCards.push({
        asin: rawAsin || null,
        title: cleanTitle,
        reason: "SPONSORED_SEARCH_CARD_REJECTED",
      });
      return;
    }

    if (!rawAsin || !isValidStrictAmazonAsin(rawAsin)) {
      rejectedCards.push({
        asin: rawAsin || null,
        title: cleanTitle,
        reason: `INVALID_OR_NON_PRODUCT_ASIN:${rawAsin || "EMPTY"}`,
      });
      return;
    }

    if (!cleanTitle || cleanTitle.length < 4) {
      rejectedCards.push({
        asin: rawAsin,
        title: cleanTitle,
        reason: "MISSING_CARD_PRODUCT_TITLE",
      });
      return;
    }

    if (seenAsins.has(rawAsin)) {
      return;
    }
    seenAsins.add(rawAsin);

    let parsedPrice: number | null = null;
    let parsedCurrency: "USD" | null = null;
    if (rawCard.price !== null && rawCard.price !== undefined && String(rawCard.price).trim() !== "") {
      const rawPriceStr = String(rawCard.price).trim();
      const explicitCurrency = rawCard.currency
        ? String(rawCard.currency).trim().toUpperCase()
        : rawPriceStr.includes("$")
        ? "USD"
        : null;
      if (explicitCurrency && explicitCurrency !== "USD") {
        rejectedCards.push({
          asin: rawAsin,
          title: cleanTitle,
          reason: `NON_USD_SEARCH_CARD_CURRENCY:${explicitCurrency}`,
        });
        return;
      }
      const num =
        typeof rawCard.price === "number"
          ? rawCard.price
          : Number(rawPriceStr.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(num) && num > 0) {
        parsedPrice = Math.round(num * 100) / 100;
        parsedCurrency = "USD";
      }
    }

    const cleanBrand = sanitizeUntrustedAmazonText(rawCard.brand).sanitized;
    cards.push({
      asin: rawAsin,
      canonicalAmazonUrl: `https://www.amazon.com/dp/${rawAsin}`,
      productTitle: cleanTitle,
      brand: cleanBrand,
      price: parsedPrice,
      currency: parsedCurrency,
      observedDeliveryPostalCode,
      isSponsored: false,
    });
  };

  // 1. Structured searchCards if provided
  if (Array.isArray(snapshot.structuredData?.searchCards)) {
    for (const sc of snapshot.structuredData!.searchCards!) {
      pushCandidateCard(sc);
    }
  }

  // 2. HTML search cards (`data-asin="..."`)
  if (snapshot.rawHtml) {
    const cardRegex = /<div[^>]*\bdata-asin=["']([^"']+)["'][^>]*>([\s\S]*?)(?=<div[^>]*\bdata-asin=["']|$)/gi;
    let match: RegExpExecArray | null;
    while ((match = cardRegex.exec(snapshot.rawHtml)) !== null) {
      const candidateAsin = match[1]?.trim() || "";
      const blockHtml = match[2] || "";
      if (!candidateAsin) continue;
      const h2Match =
        blockHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ||
        blockHtml.match(/class=["'][^"']*a-text-normal[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ||
        null;
      const priceMatch =
        blockHtml.match(/class=["'][^"']*a-offscreen[^"']*["'][^>]*>\s*(\$[0-9]+(?:\.[0-9]{2})?)\s*<\/span>/i)?.[1] ||
        blockHtml.match(/(\$[0-9]+(?:\.[0-9]{2})?)/)?.[1] ||
        null;
      const hrefMatch = blockHtml.match(/href=["']([^"']*\/dp\/[^"']+)["']/i)?.[1] || null;
      pushCandidateCard({
        asin: candidateAsin,
        title: h2Match,
        price: priceMatch,
        href: hrefMatch,
        rawSnippet: blockHtml,
      });
    }
  }

  // 3. Accessibility snapshot lines containing `/dp/ASIN` links and headings
  if (snapshot.accessibilityTreeText) {
    const dpRegex = /(?:heading|link)\s+["']([^"'\n]{6,240})["'][\s\S]{0,600}?\/dp\/([A-Z0-9]{10})\b/gi;
    let m: RegExpExecArray | null;
    while ((m = dpRegex.exec(snapshot.accessibilityTreeText)) !== null) {
      let titleText = m[1] || "";
      const asinCandidate = m[2] || "";
      let brandCandidate: string | null = null;
      const windowStart = Math.max(0, m.index - 160);
      const windowEnd = Math.min(
        snapshot.accessibilityTreeText.length,
        m.index + m[0].length + 900
      );
      const windowText = snapshot.accessibilityTreeText.slice(windowStart, windowEnd);
      const afterMatchText = snapshot.accessibilityTreeText.slice(
        m.index + m[0].length,
        Math.min(snapshot.accessibilityTreeText.length, m.index + m[0].length + 750)
      );
      const subHeadingMatch = afterMatchText.match(
        /heading\s+["']([^"'\n]{12,260})["']\s+\[level=2\]/i
      );
      if (subHeadingMatch?.[1] && !titleText.includes(subHeadingMatch[1])) {
        brandCandidate = titleText.length <= 40 ? titleText : null;
        titleText = `${titleText} ${subHeadingMatch[1]}`.trim();
      }
      const priceMatch = windowText.match(/\$[0-9]+(?:\.[0-9]{2})?/)?.[0] || null;
      pushCandidateCard({
        asin: asinCandidate,
        title: titleText,
        brand: brandCandidate,
        price: priceMatch,
        rawSnippet: windowText,
      });
    }

    // Fallback: direct `/dp/ASIN` URLs in accessibility tree with nearby link/heading title or URL slug
    const urlDpRegex = /\/([A-Za-z0-9-]{6,160})\/dp\/([A-Z0-9]{10})\b/g;
    let um: RegExpExecArray | null;
    while ((um = urlDpRegex.exec(snapshot.accessibilityTreeText)) !== null) {
      const slugText = (um[1] || "").replace(/-/g, " ").trim();
      const asinCandidate = um[2] || "";
      const windowStart = Math.max(0, um.index - 320);
      const windowEnd = Math.min(
        snapshot.accessibilityTreeText.length,
        um.index + um[0].length + 900
      );
      const windowText = snapshot.accessibilityTreeText.slice(windowStart, windowEnd);
      const headingsInWindow = Array.from(
        windowText.matchAll(/heading\s+["']([^"'\n]{6,260})["'](?:\s+\[level=2\])?/gi)
      ).map((hm) => hm[1].trim());
      const nearbyTitle =
        headingsInWindow.length >= 2
          ? `${headingsInWindow[0]} ${headingsInWindow[1]}`.trim()
          : headingsInWindow[0] ||
            windowText.match(/link\s+["']([^"'\n]{8,240})["']/i)?.[1] ||
            slugText;
      const priceMatch = windowText.match(/\$[0-9]+(?:\.[0-9]{2})?/)?.[0] || null;
      pushCandidateCard({
        asin: asinCandidate,
        title: nearbyTitle,
        brand: headingsInWindow.length >= 2 && headingsInWindow[0].length <= 40 ? headingsInWindow[0] : null,
        price: priceMatch,
        rawSnippet: windowText,
      });
    }
  }

  return {
    botWallDetected: false,
    botWallStatus: null,
    botWallReason: null,
    observedDeliveryPostalCode,
    cards,
    rejectedCards,
  };
}
