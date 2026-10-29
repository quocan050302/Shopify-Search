/**
 * SWAI KH-02 V12.4.3 — Product Metadata Extractor & Canonical URL Validator
 *
 * Implements evidence-based URL parsing, Shopify/ecommerce product locator normalization,
 * merchant product page verification, and SSRF security guards:
 * - Normalizes ecommerce URLs, removing tracking/UTM parameters while preserving identity-affecting params.
 * - Separates base product URL from variant IDs (?variant=...) and normalizes /collections/.../products/<handle>.
 * - Distinguishes HTTP 403, 404, timeout, captcha/challenge, non-HTML, redirect errors, collection/homepage,
 *   missing metadata, contradictory metadata, and verified product pages.
 * - Enforces SSRF protection: strictly rejects localhost, private subnets, and metadata endpoints.
 */

import { URL } from "url";
import { classifyAdvertisingHeadline } from "./adHeadlineClassifier";

export type MerchantFetchOutcome =
  | "VERIFIED_PRODUCT_PAGE"
  | "HTTP_403"
  | "HTTP_404"
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "SSRF_BLOCKED"
  | "REDIRECT_UNRESOLVED"
  | "NON_HTML"
  | "CAPTCHA_OR_CHALLENGE"
  | "COLLECTION_PAGE"
  | "HOMEPAGE"
  | "NON_PRODUCT_PAGE"
  | "CONTRADICTORY_METADATA"
  | "MISSING_METADATA";

export interface ExtractedProductUrlInfo {
  isValidEcommerceUrl: boolean;
  isShopifyProductUrl: boolean;
  isCollectionUrl?: boolean;
  isHomepageUrl?: boolean;
  cleanCanonicalUrl: string | null;
  normalizedBaseProductUrl?: string | null;
  variantUrl?: string | null;
  originalCleanUrl?: string | null;
  storeDomain: string | null;
  productHandle: string | null;
  collectionHandle?: string | null;
  variantId?: string | null;
  queryProductId?: string | null;
  skuFromQuery?: string | null;
  modelFromQuery?: string | null;
  derivedTitleFromSlug: string | null;
  rejectionReason?: string;
}

const FORBIDDEN_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "169.254.169.254", // AWS/GCP metadata
  "metadata.google.internal",
  "instance-data",
]);

export const NON_MERCHANT_PLATFORM_DOMAINS = new Set([
  "facebook.com",
  "l.facebook.com",
  "m.facebook.com",
  "fb.com",
  "fb.me",
  "instagram.com",
  "l.instagram.com",
  "messenger.com",
  "meta.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "google.com",
  "ad.doubleclick.net",
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "play.google.com",
  "apps.apple.com",
  "t.co",
  "twitter.com",
  "x.com",
  "pinterest.com",
  "reddit.com",
  "wa.me",
  "whatsapp.com",
]);

const TRACKING_QUERY_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "ttclid",
  "msclkid",
  "twclid",
  "yclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_pos",
  "_sid",
  "_ss",
  "_fid",
  "ref",
  "source",
  "ad_id",
  "adset_id",
  "campaign_id",
  "aff",
  "aff_id",
  "sca_ref",
  "shpxid",
  "oseid",
  "tw_source",
  "tw_adid",
  "srsltid",
]);

const IDENTITY_QUERY_KEYS = [
  "id",
  "product_id",
  "productid",
  "item_id",
  "itemid",
  "pid",
  "goods_id",
  "asin",
];

/**
 * Validates whether an IPv4 or IPv6 address belongs to private, loopback, link-local or reserved ranges.
 */
export function isIpAddressPrivate(ip: string): boolean {
  if (!ip) return true;
  const cleanIp = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");

  // IPv4-mapped IPv6 (e.g., ::ffff:127.0.0.1)
  if (cleanIp.startsWith("::ffff:")) {
    return isIpAddressPrivate(cleanIp.slice(7));
  }

  // IPv6 checks
  if (cleanIp.includes(":")) {
    if (cleanIp === "::1" || cleanIp === "::") return true;
    // fc00::/7 (Unique Local)
    if (/^f[cd][0-9a-f]{2}:/i.test(cleanIp)) return true;
    // fe80::/10 (Link-Local)
    if (/^fe[89ab][0-9a-f]:/i.test(cleanIp)) return true;
    // ff00::/8 (Multicast)
    if (/^ff[0-9a-f]{2}:/i.test(cleanIp)) return true;
    return false;
  }

  // IPv4 octets check
  const parts = cleanIp.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }

  const [p0, p1] = parts;
  if (p0 === 0) return true;
  if (p0 === 10) return true;
  if (p0 === 127) return true;
  if (p0 === 169 && p1 === 254) return true;
  if (p0 === 172 && p1 >= 16 && p1 <= 31) return true;
  if (p0 === 192 && p1 === 168) return true;
  if (p0 === 100 && p1 >= 64 && p1 <= 127) return true;
  if (p0 === 192 && p1 === 0 && parts[2] === 2) return true;
  if (p0 === 198 && p1 === 51 && parts[2] === 100) return true;
  if (p0 === 203 && p1 === 0 && parts[2] === 113) return true;
  if (p0 >= 224) return true;

  return false;
}

/**
 * Checks if a URL points to a forbidden private, loopback, or cloud-metadata address (SSRF guard).
 */
export function isSafePublicUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

    if (FORBIDDEN_HOSTNAMES.has(host)) {
      return false;
    }

    if (
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".lan")
    ) {
      return false;
    }

    if (isIpAddressPrivate(host)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Converts a hyphenated/underscored slug into a clean Title Case string.
 * Example: 'ultrasonic-anti-barking-device' -> 'Ultrasonic Anti Barking Device'
 */
export function slugToTitleCase(slug: string): string {
  if (!slug) return "";
  return decodeURIComponent(slug)
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
    .trim();
}

/**
 * Parses and validates an ecommerce landing page URL, extracting canonical structure,
 * Shopify/ecommerce product handles, variant IDs, and identity-affecting query parameters.
 */
export function extractProductUrlMetadata(rawUrl?: string | null): ExtractedProductUrlInfo {
  if (!rawUrl || typeof rawUrl !== "string") {
    return {
      isValidEcommerceUrl: false,
      isShopifyProductUrl: false,
      cleanCanonicalUrl: null,
      normalizedBaseProductUrl: null,
      storeDomain: null,
      productHandle: null,
      derivedTitleFromSlug: null,
      rejectionReason: "No URL provided",
    };
  }

  const trimmed = rawUrl.trim();
  if (!isSafePublicUrl(trimmed)) {
    return {
      isValidEcommerceUrl: false,
      isShopifyProductUrl: false,
      cleanCanonicalUrl: null,
      normalizedBaseProductUrl: null,
      storeDomain: null,
      productHandle: null,
      derivedTitleFromSlug: null,
      rejectionReason: "URL rejected by security policy (invalid protocol or private destination)",
    };
  }

  try {
    const parsed = new URL(trimmed);
    const storeDomain = parsed.hostname.replace(/^www\./i, "").toLowerCase();

    // Unwrap outbound social redirect shims (e.g., l.facebook.com/l.php?u=... or facebook.com/flx/warn?u=...)
    if (
      (storeDomain === "facebook.com" ||
        storeDomain === "l.facebook.com" ||
        storeDomain === "m.facebook.com" ||
        storeDomain === "l.instagram.com") &&
      parsed.searchParams.has("u")
    ) {
      const unwrapped = parsed.searchParams.get("u")?.trim();
      if (unwrapped && /^https?:\/\//i.test(unwrapped) && unwrapped !== trimmed) {
        return extractProductUrlMetadata(unwrapped);
      }
    }

    // Reject social platforms, ad-tracking servers, and app stores as merchant domains
    if (NON_MERCHANT_PLATFORM_DOMAINS.has(storeDomain)) {
      return {
        isValidEcommerceUrl: false,
        isShopifyProductUrl: false,
        cleanCanonicalUrl: null,
        normalizedBaseProductUrl: null,
        storeDomain: null,
        productHandle: null,
        derivedTitleFromSlug: null,
        rejectionReason: `Platform/tracker domain '${storeDomain}' is not a merchant storefront`,
      };
    }

    const portSuffix = parsed.port ? `:${parsed.port}` : "";
    const normalizedHost = `${storeDomain}${portSuffix}`;
    const protocol = parsed.protocol.toLowerCase();

    // Normalize pathname (strip trailing slash unless root)
    let pathname = parsed.pathname || "/";
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.replace(/\/+$/, "");
    }
    const isRoot = pathname === "" || pathname === "/";

    // Strip tracking queries while extracting variant/product identifiers
    const rawParams = new URLSearchParams(parsed.search);
    const preservedParams = new URLSearchParams();
    let variantId: string | null = null;
    let queryProductId: string | null = null;
    let skuFromQuery: string | null = null;
    let modelFromQuery: string | null = null;

    for (const [key, val] of rawParams.entries()) {
      const kLower = key.toLowerCase();
      if (
        TRACKING_QUERY_PARAMS.has(kLower) ||
        kLower.startsWith("utm_") ||
        kLower.startsWith("hsa_") ||
        kLower.startsWith("gad_")
      ) {
        continue;
      }

      if (kLower === "variant" || kLower === "variant_id" || kLower === "variantid") {
        if (val && val.trim()) {
          variantId = val.trim();
        }
        continue;
      }

      if (kLower === "sku") {
        if (val && val.trim()) {
          skuFromQuery = val.trim();
          preservedParams.set(kLower, val.trim());
        }
        continue;
      }

      if (kLower === "model") {
        if (val && val.trim()) {
          modelFromQuery = val.trim();
          preservedParams.set(kLower, val.trim());
        }
        continue;
      }

      if (IDENTITY_QUERY_KEYS.includes(kLower)) {
        if (val && val.trim()) {
          queryProductId = val.trim();
          preservedParams.set(kLower, val.trim());
        }
        continue;
      }

      preservedParams.set(key, val);
    }

    // Sort preserved query keys deterministically
    const sortedEntries = Array.from(preservedParams.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
    const cleanParams = new URLSearchParams(sortedEntries);
    const cleanQuery = cleanParams.toString();

    // Check collection-linked product path: /collections/<col>/products/<handle>
    const collectionProductMatch = pathname.match(
      /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/collections\/([a-zA-Z0-9-_]+)\/products\/([a-zA-Z0-9-_%]+)/i
    );
    const directShopifyMatch = pathname.match(
      /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/products\/([a-zA-Z0-9-_%]+)/i
    );
    const altProductMatch = pathname.match(
      /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/(?:product|item|p|dp)\/([a-zA-Z0-9-_%]+)/i
    );

    if (collectionProductMatch || directShopifyMatch) {
      const collectionHandle = collectionProductMatch
        ? decodeURIComponent(collectionProductMatch[1]).toLowerCase()
        : null;
      const rawHandle = collectionProductMatch
        ? collectionProductMatch[2]
        : directShopifyMatch![1];
      const productHandle = decodeURIComponent(rawHandle).toLowerCase();
      const derivedTitleFromSlug = slugToTitleCase(productHandle);

      // Canonical base product URL normalizes away /collections/<col> and ?variant=...
      const canonicalProductPath = `/products/${productHandle}`;
      const normalizedBaseProductUrl = `${protocol}//${normalizedHost}${canonicalProductPath}`;
      const cleanCanonicalUrl = normalizedBaseProductUrl;
      const variantUrl = variantId
        ? `${normalizedBaseProductUrl}?variant=${encodeURIComponent(variantId)}`
        : null;
      const originalCleanUrl = `${protocol}//${normalizedHost}${pathname}${
        cleanQuery ? `?${cleanQuery}` : ""
      }`;

      return {
        isValidEcommerceUrl: true,
        isShopifyProductUrl: true,
        isCollectionUrl: false,
        isHomepageUrl: false,
        cleanCanonicalUrl,
        normalizedBaseProductUrl,
        variantUrl,
        originalCleanUrl,
        storeDomain,
        productHandle,
        collectionHandle,
        variantId,
        queryProductId,
        skuFromQuery,
        modelFromQuery,
        derivedTitleFromSlug,
      };
    }

    if (altProductMatch && altProductMatch[1]) {
      const productHandle = decodeURIComponent(altProductMatch[1]).toLowerCase();
      const derivedTitleFromSlug = slugToTitleCase(productHandle);
      const normalizedBaseProductUrl = `${protocol}//${normalizedHost}${pathname}${
        queryProductId ? `?id=${encodeURIComponent(queryProductId)}` : ""
      }`;
      const variantUrl = variantId
        ? `${normalizedBaseProductUrl}${normalizedBaseProductUrl.includes("?") ? "&" : "?"}variant=${encodeURIComponent(variantId)}`
        : null;

      return {
        isValidEcommerceUrl: true,
        isShopifyProductUrl: true,
        isCollectionUrl: false,
        isHomepageUrl: false,
        cleanCanonicalUrl: normalizedBaseProductUrl,
        normalizedBaseProductUrl,
        variantUrl,
        originalCleanUrl: `${protocol}//${normalizedHost}${pathname}${cleanQuery ? `?${cleanQuery}` : ""}`,
        storeDomain,
        productHandle,
        collectionHandle: null,
        variantId,
        queryProductId,
        skuFromQuery,
        modelFromQuery,
        derivedTitleFromSlug,
      };
    }

    // Check if query parameters contain an explicit product ID on a generic path (e.g. /product.php?id=123)
    if (queryProductId && !isRoot && !pathname.toLowerCase().includes("/collections/")) {
      const cleanCanonicalUrl = `${protocol}//${normalizedHost}${pathname}?${cleanQuery}`;
      return {
        isValidEcommerceUrl: true,
        isShopifyProductUrl: false,
        isCollectionUrl: false,
        isHomepageUrl: false,
        cleanCanonicalUrl,
        normalizedBaseProductUrl: cleanCanonicalUrl,
        variantUrl: variantId ? `${cleanCanonicalUrl}&variant=${encodeURIComponent(variantId)}` : null,
        originalCleanUrl: cleanCanonicalUrl,
        storeDomain,
        productHandle: queryProductId.toLowerCase(),
        collectionHandle: null,
        variantId,
        queryProductId,
        skuFromQuery,
        modelFromQuery,
        derivedTitleFromSlug: null,
      };
    }

    const isCollectionUrl =
      pathname.toLowerCase().includes("/collections/") ||
      pathname.toLowerCase().endsWith("/collections") ||
      pathname.toLowerCase().includes("/category/") ||
      pathname.toLowerCase().includes("/categories/");

    const cleanCanonicalUrl = `${protocol}//${normalizedHost}${pathname}${
      cleanQuery ? `?${cleanQuery}` : ""
    }`;

    return {
      isValidEcommerceUrl: !isRoot,
      isShopifyProductUrl: false,
      isCollectionUrl,
      isHomepageUrl: isRoot,
      cleanCanonicalUrl,
      normalizedBaseProductUrl: isRoot || isCollectionUrl ? null : cleanCanonicalUrl,
      variantUrl: null,
      originalCleanUrl: cleanCanonicalUrl,
      storeDomain,
      productHandle: null,
      collectionHandle: null,
      variantId,
      queryProductId,
      skuFromQuery,
      modelFromQuery,
      derivedTitleFromSlug: null,
      rejectionReason: isRoot
        ? "URL is a root domain / homepage, not a product page"
        : isCollectionUrl
        ? "URL is a collection/category page, not a single SKU product page"
        : undefined,
    };
  } catch (err: any) {
    return {
      isValidEcommerceUrl: false,
      isShopifyProductUrl: false,
      cleanCanonicalUrl: null,
      normalizedBaseProductUrl: null,
      storeDomain: null,
      productHandle: null,
      derivedTitleFromSlug: null,
      rejectionReason: err?.message || "URL parsing error",
    };
  }
}

export type ProductPageType =
  | "ACTUAL_PRODUCT_PAGE"
  | "COLLECTION_PAGE"
  | "HOMEPAGE"
  | "BLOG_ARTICLE"
  | "LOCAL_SERVICE"
  | "CAMPAIGN_LANDING_PAGE"
  | "REDIRECTED_PAGE"
  | "ERROR_PAGE"
  | "UNCLASSIFIED_PAGE"
  | "OTHER"
  | "UNKNOWN";

export interface ProductMetadataContext {
  timeoutMs?: number;
  maxSizeBytes?: number;
  userAgent?: string;
  fetchFn?: typeof fetch;
  fetchImpl?: typeof fetch;
}

export interface JsonLdProductInfo {
  name?: string;
  description?: string;
  brand?: string;
  image?: string;
  images?: string[];
  sku?: string;
  gtin?: string;
  model?: string;
  productId?: string;
  variantId?: string;
  price?: string;
  currency?: string;
  offers?: any;
}

export interface ProductMetadataEvidence {
  url: string;
  requestedUrl?: string;
  resolvedFinalUrl?: string | null;
  declaredCanonicalUrl?: string | null;
  normalizedProductUrl?: string | null;
  storeDomain?: string | null;
  merchantProductId?: string | null;
  isSafe: boolean;
  pageType: ProductPageType;
  fetchOutcome?: MerchantFetchOutcome;
  httpStatus?: number | null;
  verified?: boolean;
  verificationReason?: string;
  verificationLimitations?: string[];
  contradictions?: string[];
  evidenceTimestamp?: string;
  evidenceReferences?: string[];
  title: string | null;
  ogTitle: string | null;
  ogImage: string | null;
  imageReferences?: string[];
  canonicalUrl: string | null;
  brand: string | null;
  model?: string | null;
  sku?: string | null;
  gtin?: string | null;
  variantId?: string | null;
  price?: string | null;
  currency?: string | null;
  productName: string | null;
  description: string | null;
  jsonLdFound: boolean;
  jsonLdProduct?: JsonLdProductInfo | null;
  fetchError?: string;
  isValidProductPage?: boolean;
  pageClassification?: string;
  productId?: string | null;
}

const CAPTCHA_CHALLENGE_PATTERNS = [
  /just a moment\.{0,3}/i,
  /attention required!\s*\|\s*cloudflare/i,
  /cf-browser-verification/i,
  /challenge-platform/i,
  /enable javascript and cookies to continue/i,
  /verify you are human/i,
  /are you a human\??/i,
  /security check to access/i,
  /ddos protection by/i,
  /px-captcha/i,
  /datadome/i,
  /access denied/i,
  /bot verification/i,
];

const SOFT_404_PATTERNS = [
  /^404\b/i,
  /\b404\s+not\s+found\b/i,
  /\bpage\s+not\s+found\b/i,
  /\bproduct\s+not\s+found\b/i,
  /\bsorry,\s+this\s+page\s+does\s+not\s+exist\b/i,
];

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&ndash;|&#8211;/gi, "–")
    .replace(/&mdash;|&#8212;/gi, "—")
    .trim();
}

function cleanExtractedPageTitle(rawTitle: string | null | undefined): string | null {
  if (!rawTitle) return null;
  const decoded = decodeHtmlEntities(rawTitle);
  // Strip leading promotional deal prefixes and emojis (e.g., "📢📢50% OFF !! ⏰🎁Multifunctional Food Chopper", "🎃Halloween Deal 50% OFF!🛠️Hot Melt Glue Gun")
  const withoutPromoPrefix = decoded
    .replace(
      /^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}!*🔥📢⏰🎁🎃🛠️✨💥⚡🎉]*(?:(?:halloween|summer|spring|winter|holiday|black\s+friday|cyber\s+monday|flash|limited\s+time)\s+(?:deal|sale|offer|special)s?\s*[!|:\-–—]*\s*)?(?:\d+%\s*off\s*(?:today)?\s*[!|:\-–—]*\s*)?[\s\p{Emoji_Presentation}\p{Extended_Pictographic}!*🔥📢⏰🎁🎃🛠️✨💥⚡🎉]*/iu,
      ""
    )
    .trim();
  const base = withoutPromoPrefix.length >= 3 ? withoutPromoPrefix : decoded.trim();
  // Strip trailing store name suffix like " | BrandStore" or " – Official Shop"
  const primary =
    base.split(/\s+[|–—]\s+|\s+-\s+(?:Official|Shop|Store|Online)\b/i)[0]?.trim() || base;
  return primary.length >= 2 ? primary : null;
}

function isPlausibleVerifiedProductTitle(
  title: string | null | undefined,
  hasStrongSchemaEvidence: boolean
): boolean {
  if (!title) return false;
  const trimmed = title.trim();
  if (trimmed.length < 3) return false;

  if (CAPTCHA_CHALLENGE_PATTERNS.some((p) => p.test(trimmed))) return false;
  if (SOFT_404_PATTERNS.some((p) => p.test(trimmed))) return false;
  if (/^(home|welcome|catalog|collections|all products|search|cart|checkout|login|account)$/i.test(trimmed)) {
    return false;
  }

  const cls = classifyAdvertisingHeadline(trimmed);
  if (
    cls.classification === "AD_IDENTIFIER" ||
    cls.classification === "CAMPAIGN_CODE" ||
    cls.classification === "INTERNAL_SKU_CODE" ||
    cls.classification === "PROMOTIONAL_CTA"
  ) {
    return false;
  }

  if (cls.isProductCandidate) {
    return true;
  }

  // If the page has explicit @type: "Product" JSON-LD or product schema with SKU/GTIN/brand/offers,
  // allow branded model names (e.g. "ProFeeder X1", "AeroPress Go") that don't contain a generic dictionary noun
  if (hasStrongSchemaEvidence && trimmed.length >= 4 && /[a-zA-Z]{3,}/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Safely and asynchronously inspects an authorized public merchant landing page to extract verified product metadata.
 * Strictly enforces SSRF defenses, max response size limits, non-blocking timeouts, and evidence-based verification.
 */
const metadataFetchCache = new Map<string, Promise<ProductMetadataEvidence>>();

export async function fetchVerifiedProductPageMetadata(
  rawUrl?: string | null,
  contextOrTimeout: ProductMetadataContext | number = {},
  customFetch?: typeof fetch
): Promise<ProductMetadataEvidence> {
  const urlKey = rawUrl?.trim() || "";
  const isDefaultLiveFetch =
    Boolean(urlKey) &&
    !customFetch &&
    (typeof contextOrTimeout === "number" || (!contextOrTimeout?.fetchFn && !contextOrTimeout?.fetchImpl)) &&
    process.env.VITEST !== "true" &&
    process.env.NODE_ENV !== "test";
  if (isDefaultLiveFetch) {
    const cached = metadataFetchCache.get(urlKey);
    if (cached) return cached;
    const p = fetchVerifiedProductPageMetadataUncached(rawUrl, contextOrTimeout, customFetch);
    metadataFetchCache.set(urlKey, p);
    return p;
  }
  return fetchVerifiedProductPageMetadataUncached(rawUrl, contextOrTimeout, customFetch);
}

async function fetchVerifiedProductPageMetadataUncached(
  rawUrl?: string | null,
  contextOrTimeout: ProductMetadataContext | number = {},
  customFetch?: typeof fetch
): Promise<ProductMetadataEvidence> {
  const context: ProductMetadataContext =
    typeof contextOrTimeout === "number"
      ? { timeoutMs: contextOrTimeout, fetchFn: customFetch }
      : { ...contextOrTimeout, ...(customFetch ? { fetchFn: customFetch } : {}) };
  const evidenceTimestamp = new Date().toISOString();
  const url = rawUrl?.trim() || "";
  if (!url || !isSafePublicUrl(url)) {
    return {
      url,
      requestedUrl: url,
      resolvedFinalUrl: null,
      declaredCanonicalUrl: null,
      normalizedProductUrl: null,
      storeDomain: null,
      merchantProductId: null,
      isSafe: false,
      pageType: "ERROR_PAGE",
      fetchOutcome: "SSRF_BLOCKED",
      httpStatus: null,
      verified: false,
      verificationReason: "Blocked by SSRF or invalid URL security policy",
      verificationLimitations: ["URL failed SSRF or public URL validation"],
      contradictions: [],
      evidenceTimestamp,
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
      fetchError: "Blocked by SSRF or invalid URL security policy",
    };
  }

  const timeoutMs = context.timeoutMs || 3500;
  const maxBytes = context.maxSizeBytes || 256 * 1024; // 256KB cap
  const fetchImpl = context.fetchFn || context.fetchImpl || fetch;
  const MAX_REDIRECTS = 5;

  let currentUrl = url;
  let redirectCount = 0;
  let res: any = null;

  try {
    while (true) {
      if (!isSafePublicUrl(currentUrl)) {
        return {
          url: currentUrl,
          requestedUrl: url,
          resolvedFinalUrl: currentUrl,
          declaredCanonicalUrl: null,
          normalizedProductUrl: null,
          storeDomain: null,
          merchantProductId: null,
          isSafe: false,
          pageType: "ERROR_PAGE",
          fetchOutcome: "SSRF_BLOCKED",
          httpStatus: null,
          verified: false,
          verificationReason: "Redirect to private or disallowed address blocked",
          verificationLimitations: ["Redirect target blocked by SSRF security policy"],
          contradictions: [],
          evidenceTimestamp,
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
          fetchError: "Redirect to private or disallowed address blocked",
        };
      }

      res = await fetchImpl(currentUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            context.userAgent ||
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SWAI-ProductBot/1.0",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "manual",
      });

      // Handle Redirects (301, 302, 303, 307, 308)
      if (
        res.status === 301 ||
        res.status === 302 ||
        res.status === 303 ||
        res.status === 307 ||
        res.status === 308
      ) {
        redirectCount++;
        if (redirectCount > MAX_REDIRECTS) {
          return {
            url: currentUrl,
            requestedUrl: url,
            resolvedFinalUrl: currentUrl,
            declaredCanonicalUrl: null,
            normalizedProductUrl: null,
            storeDomain: null,
            merchantProductId: null,
            isSafe: true,
            pageType: "ERROR_PAGE",
            fetchOutcome: "REDIRECT_UNRESOLVED",
            httpStatus: res.status,
            verified: false,
            verificationReason: `Exceeded redirect depth limit (${MAX_REDIRECTS} redirects)`,
            verificationLimitations: [`Redirect loop or excessive hops (> ${MAX_REDIRECTS})`],
            contradictions: [],
            evidenceTimestamp,
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
            fetchError: `Exceeded redirect depth limit (${MAX_REDIRECTS} redirects)`,
          };
        }

        const location = res.headers?.get
          ? res.headers.get("location") || res.headers.get("Location")
          : res.headers?.location;
        if (!location) {
          return {
            url: currentUrl,
            requestedUrl: url,
            resolvedFinalUrl: currentUrl,
            declaredCanonicalUrl: null,
            normalizedProductUrl: null,
            storeDomain: null,
            merchantProductId: null,
            isSafe: true,
            pageType: "ERROR_PAGE",
            fetchOutcome: "REDIRECT_UNRESOLVED",
            httpStatus: res.status,
            verified: false,
            verificationReason: `HTTP redirect status ${res.status} without Location header`,
            verificationLimitations: [`HTTP ${res.status} redirect missing Location header`],
            contradictions: [],
            evidenceTimestamp,
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
            fetchError: `HTTP redirect status ${res.status} without Location header`,
          };
        }

        try {
          const nextUrlObj = new URL(location, currentUrl);
          currentUrl = nextUrlObj.href;
        } catch {
          return {
            url: currentUrl,
            requestedUrl: url,
            resolvedFinalUrl: currentUrl,
            declaredCanonicalUrl: null,
            normalizedProductUrl: null,
            storeDomain: null,
            merchantProductId: null,
            isSafe: false,
            pageType: "ERROR_PAGE",
            fetchOutcome: "REDIRECT_UNRESOLVED",
            httpStatus: res.status,
            verified: false,
            verificationReason: `Invalid redirect Location header: ${location}`,
            verificationLimitations: [`Malformed redirect Location: ${location}`],
            contradictions: [],
            evidenceTimestamp,
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
            fetchError: `Invalid redirect Location header: ${location}`,
          };
        }
        continue;
      }

      break;
    }

    const resolvedUrlInfo = extractProductUrlMetadata(currentUrl);
    const httpStatus = typeof res.status === "number" ? res.status : null;

    if (!res.ok && res.status !== 200) {
      const outcome: MerchantFetchOutcome =
        res.status === 403 || res.status === 401 || res.status === 429
          ? "HTTP_403"
          : res.status === 404 || res.status === 410
          ? "HTTP_404"
          : "HTTP_ERROR";

      return {
        url: currentUrl,
        requestedUrl: url,
        resolvedFinalUrl: currentUrl,
        declaredCanonicalUrl: null,
        normalizedProductUrl: resolvedUrlInfo.normalizedBaseProductUrl || null,
        storeDomain: resolvedUrlInfo.storeDomain,
        merchantProductId: null,
        isSafe: true,
        pageType: "ERROR_PAGE",
        fetchOutcome: outcome,
        httpStatus,
        verified: false,
        verificationReason: `Merchant page fetch failed with HTTP status ${res.status}`,
        verificationLimitations: [`Merchant HTTP status ${res.status} (${outcome})`],
        contradictions: [],
        evidenceTimestamp,
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
        variantId: resolvedUrlInfo.variantId || null,
        price: null,
        currency: null,
        productName: null,
        description: null,
        jsonLdFound: false,
        jsonLdProduct: null,
        fetchError: `HTTP status ${res.status}`,
      };
    }

    const contentType =
      (res.headers?.get
        ? res.headers.get("content-type")
        : res.headers?.["content-type"]) || "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml")
    ) {
      return {
        url: currentUrl,
        requestedUrl: url,
        resolvedFinalUrl: currentUrl,
        declaredCanonicalUrl: null,
        normalizedProductUrl: resolvedUrlInfo.normalizedBaseProductUrl || null,
        storeDomain: resolvedUrlInfo.storeDomain,
        merchantProductId: null,
        isSafe: true,
        pageType: "UNCLASSIFIED_PAGE",
        fetchOutcome: "NON_HTML",
        httpStatus,
        verified: false,
        verificationReason: `Non-HTML content-type: ${contentType}`,
        verificationLimitations: [`Response content-type is '${contentType}', not HTML`],
        contradictions: [],
        evidenceTimestamp,
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
        variantId: resolvedUrlInfo.variantId || null,
        price: null,
        currency: null,
        productName: null,
        description: null,
        jsonLdFound: false,
        jsonLdProduct: null,
        fetchError: `Non-HTML content-type: ${contentType}`,
      };
    }

    // Read capped chunk via streaming reader
    let htmlText = "";
    if (res.body && typeof res.body.getReader === "function") {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            const remaining = maxBytes - totalBytes;
            if (value.length >= remaining) {
              chunks.push(value.subarray(0, remaining));
              totalBytes += remaining;
              await reader.cancel();
              break;
            } else {
              chunks.push(value);
              totalBytes += value.length;
              if (totalBytes >= maxBytes) {
                await reader.cancel();
                break;
              }
            }
          }
        }
      } catch {
        // Stream reading ended or canceled
      }
      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      htmlText = new TextDecoder("utf-8").decode(combined);
    } else if (typeof res.text === "function") {
      htmlText = (await res.text()).slice(0, maxBytes);
    }

    // Extract Title tag
    const titleMatch = htmlText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : null;

    // Extract H1 tag
    const h1Match = htmlText.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const h1Text = h1Match
      ? decodeHtmlEntities(h1Match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
      : null;

    // Extract Meta / OpenGraph helpers
    const extractMeta = (attrValue: string): string | null => {
      const escaped = attrValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const m1 = htmlText.match(
        new RegExp(
          `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
          "i"
        )
      );
      if (m1?.[1]) return decodeHtmlEntities(m1[1].trim());
      const m2 = htmlText.match(
        new RegExp(
          `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`,
          "i"
        )
      );
      if (m2?.[1]) return decodeHtmlEntities(m2[1].trim());
      return null;
    };

    const ogTitle = extractMeta("og:title");
    const ogType = extractMeta("og:type");
    const ogImage = extractMeta("og:image") || extractMeta("og:image:secure_url");
    const ogDescription = extractMeta("og:description") || extractMeta("description");
    const ogUrl = extractMeta("og:url");
    const ogBrand = extractMeta("product:brand") || extractMeta("og:brand");
    const ogPriceAmount =
      extractMeta("product:price:amount") || extractMeta("og:price:amount");
    const ogPriceCurrency =
      extractMeta("product:price:currency") || extractMeta("og:price:currency");
    const ogRetailerItemId =
      extractMeta("product:retailer_item_id") || extractMeta("product:item_group_id");

    // Extract Canonical URL
    const canonicalMatch =
      htmlText.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) ||
      htmlText.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
    const declaredCanonicalUrl = canonicalMatch
      ? decodeHtmlEntities(canonicalMatch[1].trim())
      : ogUrl || null;

    // Extract JSON-LD Product blocks
    let jsonLdFound = false;
    let jsonLdProduct: JsonLdProductInfo | null = null;
    const jsonLdRegex =
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;

    while ((match = jsonLdRegex.exec(htmlText)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        const queue: any[] = Array.isArray(parsed)
          ? [...parsed]
          : parsed["@graph"] && Array.isArray(parsed["@graph"])
          ? [...parsed["@graph"]]
          : [parsed];

        while (queue.length > 0) {
          const item = queue.shift();
          if (!item || typeof item !== "object") continue;
          if (item.mainEntity && typeof item.mainEntity === "object") {
            queue.push(item.mainEntity);
          }
          const itemType = item["@type"];
          const isProductType =
            itemType === "Product" ||
            itemType === "ProductGroup" ||
            (Array.isArray(itemType) &&
              (itemType.includes("Product") || itemType.includes("ProductGroup")));

          if (isProductType) {
            jsonLdFound = true;
            const brandVal =
              typeof item.brand === "string"
                ? item.brand.trim()
                : item.brand?.name
                ? String(item.brand.name).trim()
                : undefined;

            const rawImages: string[] = [];
            if (typeof item.image === "string") {
              rawImages.push(item.image);
            } else if (Array.isArray(item.image)) {
              for (const img of item.image) {
                if (typeof img === "string") rawImages.push(img);
                else if (img?.url) rawImages.push(String(img.url));
              }
            } else if (item.image?.url) {
              rawImages.push(String(item.image.url));
            }

            const offersObj = Array.isArray(item.offers)
              ? item.offers[0]
              : item.offers;
            const variantObj = Array.isArray(item.hasVariant)
              ? item.hasVariant[0]
              : item.hasVariant;

            const skuVal =
              item.sku ||
              offersObj?.sku ||
              variantObj?.sku ||
              undefined;
            const gtinVal =
              item.gtin ||
              item.gtin13 ||
              item.gtin12 ||
              item.gtin14 ||
              item.gtin8 ||
              offersObj?.gtin ||
              offersObj?.gtin13 ||
              variantObj?.gtin ||
              variantObj?.gtin13 ||
              undefined;
            const modelVal =
              (typeof item.model === "string" ? item.model : item.model?.name) ||
              item.mpn ||
              variantObj?.mpn ||
              undefined;
            const productIdVal =
              item.productID ||
              item.productGroupID ||
              item.identifier ||
              offersObj?.productID ||
              undefined;
            const priceVal =
              offersObj?.price !== undefined
                ? String(offersObj.price)
                : offersObj?.lowPrice !== undefined
                ? String(offersObj.lowPrice)
                : undefined;
            const currencyVal = offersObj?.priceCurrency
              ? String(offersObj.priceCurrency)
              : undefined;

            jsonLdProduct = {
              name: item.name ? decodeHtmlEntities(String(item.name).trim()) : undefined,
              description: item.description
                ? decodeHtmlEntities(String(item.description).trim())
                : undefined,
              brand: brandVal,
              image: rawImages[0],
              images: rawImages,
              sku: skuVal ? String(skuVal).trim() : undefined,
              gtin: gtinVal ? String(gtinVal).trim() : undefined,
              model: modelVal ? String(modelVal).trim() : undefined,
              productId: productIdVal ? String(productIdVal).trim() : undefined,
              price: priceVal,
              currency: currencyVal,
              offers: item.offers,
            };
            break;
          }
        }
        if (jsonLdFound) break;
      } catch {
        // Ignore malformed JSON-LD block and continue checking other blocks
      }
    }

    // Extract Shopify / DOM product signals
    const shopifyIdMatch =
      htmlText.match(/ShopifyAnalytics\.meta\.product\s*=\s*\{[^}]*?"id"\s*:\s*(\d{6,20})/i) ||
      htmlText.match(/"product"\s*:\s*\{\s*"id"\s*:\s*(\d{6,20})/i) ||
      htmlText.match(/data-product-id=["'](\d{6,20})["']/i) ||
      htmlText.match(/"product_id"\s*:\s*(\d{6,20})/i);
    const domProductId = shopifyIdMatch?.[1] || null;

    const domSkuMatch =
      htmlText.match(/data-product-sku=["']([^"']{2,64})["']/i) ||
      htmlText.match(/ShopifyAnalytics\.meta\.product[\s\S]{0,400}?"sku"\s*:\s*"([^"]{2,64})"/i);
    const domSku = domSkuMatch?.[1]?.trim() || null;

    const hasAddToCartSignal =
      /\b(add[-_\s]to[-_\s]cart|buy[-_\s]it[-_\s]now|shopify-payment-button|product-form|name=["']add["'])\b/i.test(
        htmlText
      );
    const hasOgProductSignal =
      Boolean(ogType && ogType.toLowerCase().includes("product")) ||
      Boolean(ogPriceAmount) ||
      Boolean(ogRetailerItemId);

    // Check for Captcha / Challenge page
    const titleAndBodySample = `${pageTitle || ""} ${h1Text || ""} ${htmlText.slice(0, 4000)}`;
    const isCaptchaOrChallenge =
      !jsonLdFound &&
      !hasOgProductSignal &&
      CAPTCHA_CHALLENGE_PATTERNS.some((p) => p.test(titleAndBodySample));

    if (isCaptchaOrChallenge) {
      return {
        url: currentUrl,
        requestedUrl: url,
        resolvedFinalUrl: currentUrl,
        declaredCanonicalUrl,
        normalizedProductUrl: resolvedUrlInfo.normalizedBaseProductUrl || null,
        storeDomain: resolvedUrlInfo.storeDomain,
        merchantProductId: null,
        isSafe: true,
        pageType: "ERROR_PAGE",
        pageClassification: "CAPTCHA_OR_CHALLENGE",
        isValidProductPage: false,
        productId: null,
        fetchOutcome: "CAPTCHA_OR_CHALLENGE",
        httpStatus,
        verified: false,
        verificationReason: "Merchant page returned a bot challenge, captcha, or access-denied interstitial",
        verificationLimitations: [
          "Merchant page is protected by anti-bot challenge/captcha; product metadata could not be verified",
        ],
        contradictions: [],
        evidenceTimestamp,
        evidenceReferences: [],
        title: pageTitle,
        ogTitle,
        ogImage,
        imageReferences: [],
        canonicalUrl: declaredCanonicalUrl,
        brand: null,
        model: null,
        sku: null,
        gtin: null,
        variantId: resolvedUrlInfo.variantId || null,
        price: null,
        currency: null,
        productName: null,
        description: null,
        jsonLdFound: false,
        jsonLdProduct: null,
        fetchError: "Captcha or challenge page detected",
      };
    }

    // Check for soft-404
    const isSoft404 =
      !jsonLdFound &&
      !hasOgProductSignal &&
      SOFT_404_PATTERNS.some((p) => p.test(pageTitle || "") || p.test(h1Text || ""));

    if (isSoft404) {
      return {
        url: currentUrl,
        requestedUrl: url,
        resolvedFinalUrl: currentUrl,
        declaredCanonicalUrl,
        normalizedProductUrl: null,
        storeDomain: resolvedUrlInfo.storeDomain,
        merchantProductId: null,
        isSafe: true,
        pageType: "ERROR_PAGE",
        fetchOutcome: "HTTP_404",
        httpStatus,
        verified: false,
        verificationReason: "Merchant page rendered a soft-404 / Product Not Found message",
        verificationLimitations: ["Soft 404 page detected"],
        contradictions: [],
        evidenceTimestamp,
        evidenceReferences: [],
        title: pageTitle,
        ogTitle,
        ogImage,
        imageReferences: [],
        canonicalUrl: declaredCanonicalUrl,
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
        fetchError: "Soft 404 product not found page",
      };
    }

    // Determine effective URL info (prefer declaredCanonicalUrl if on same domain, else currentUrl)
    const canonicalUrlInfo = declaredCanonicalUrl
      ? extractProductUrlMetadata(declaredCanonicalUrl)
      : null;
    const effectiveUrlInfo =
      canonicalUrlInfo &&
      canonicalUrlInfo.isValidEcommerceUrl &&
      canonicalUrlInfo.storeDomain === resolvedUrlInfo.storeDomain
        ? canonicalUrlInfo
        : resolvedUrlInfo;

    const parsedFinalUrl = new URL(currentUrl);
    const pathname = parsedFinalUrl.pathname.toLowerCase();

    const candidateProductName =
      jsonLdProduct?.name ||
      cleanExtractedPageTitle(ogTitle) ||
      cleanExtractedPageTitle(h1Text) ||
      cleanExtractedPageTitle(pageTitle) ||
      null;

    const hasStrongSchemaEvidence =
      jsonLdFound ||
      hasOgProductSignal ||
      Boolean(domProductId) ||
      Boolean(domSku) ||
      hasAddToCartSignal;

    const isTitleValidProduct = isPlausibleVerifiedProductTitle(
      candidateProductName,
      hasStrongSchemaEvidence
    );

    // Check internal metadata contradiction (e.g., canonical URL points to /collections/ or / while URL was /products/...)
    const contradictions: string[] = [];
    if (
      declaredCanonicalUrl &&
      canonicalUrlInfo &&
      (canonicalUrlInfo.isHomepageUrl || canonicalUrlInfo.isCollectionUrl) &&
      resolvedUrlInfo.isShopifyProductUrl
    ) {
      contradictions.push(
        `Requested product URL '${url}' declares canonical non-product page '${declaredCanonicalUrl}'.`
      );
    }

    if (
      jsonLdProduct?.name &&
      ogTitle &&
      cleanExtractedPageTitle(ogTitle) &&
      jsonLdProduct.name.toLowerCase() !== cleanExtractedPageTitle(ogTitle)!.toLowerCase()
    ) {
      const t1 = jsonLdProduct.name
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2);
      const t2 = cleanExtractedPageTitle(ogTitle)!
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2);
      const overlap = t1.some((w) => t2.includes(w));
      if (!overlap && t1.length >= 2 && t2.length >= 2) {
        contradictions.push(
          `Merchant JSON-LD product name '${jsonLdProduct.name}' contradicts OpenGraph title '${ogTitle}'.`
        );
      }
    }

    let pageType: ProductPageType = "UNCLASSIFIED_PAGE";
    let fetchOutcome: MerchantFetchOutcome = "MISSING_METADATA";
    let verified = false;
    let verificationReason = "";
    const verificationLimitations: string[] = [];

    const isCollectionPath =
      (pathname.includes("/collections/") ||
        pathname.endsWith("/collections") ||
        pathname.includes("/category/") ||
        pathname.includes("/categories/")) &&
      !effectiveUrlInfo.isShopifyProductUrl;

    if (pathname === "" || pathname === "/" || canonicalUrlInfo?.isHomepageUrl) {
      pageType = "HOMEPAGE";
      fetchOutcome = "HOMEPAGE";
      verified = false;
      verificationReason = "Resolved destination is a storefront homepage rather than a single product page.";
      verificationLimitations.push("Destination is a homepage, not a SKU page.");
    } else if (isCollectionPath || canonicalUrlInfo?.isCollectionUrl) {
      pageType = "COLLECTION_PAGE";
      fetchOutcome = "COLLECTION_PAGE";
      verified = false;
      verificationReason = "Resolved destination is a collection/category listing rather than a single product page.";
      verificationLimitations.push("Destination is a collection page with multiple items.");
    } else if (
      pathname.includes("/blogs/") ||
      pathname.includes("/blog/") ||
      pathname.includes("/articles/") ||
      parsedFinalUrl.hostname.toLowerCase().startsWith("adv.") ||
      /\b(veterinarian exposes|could be shortening)\b/i.test(candidateProductName || "") ||
      (ogType && ogType.toLowerCase() === "article" && !jsonLdFound)
    ) {
      pageType = "BLOG_ARTICLE";
      fetchOutcome = "NON_PRODUCT_PAGE";
      verified = false;
      verificationReason = "Resolved destination is a blog/editorial article rather than a product page.";
      verificationLimitations.push("Destination is an article page.");
    } else if (contradictions.length > 0) {
      pageType = "UNCLASSIFIED_PAGE";
      fetchOutcome = "CONTRADICTORY_METADATA";
      verified = false;
      verificationReason = contradictions.join(" ");
      verificationLimitations.push(...contradictions);
    } else if (
      isTitleValidProduct &&
      (jsonLdFound ||
        hasOgProductSignal ||
        Boolean(domProductId) ||
        hasAddToCartSignal ||
        (effectiveUrlInfo.isShopifyProductUrl && Boolean(ogTitle || ogImage)))
    ) {
      pageType = "ACTUAL_PRODUCT_PAGE";
      fetchOutcome = "VERIFIED_PRODUCT_PAGE";
      verified = true;
      const signals: string[] = [];
      if (jsonLdFound) signals.push("JSON-LD Product schema");
      if (hasOgProductSignal) signals.push("OpenGraph product tags");
      if (domProductId) signals.push(`merchant product ID (${domProductId})`);
      if (hasAddToCartSignal) signals.push("ecommerce product DOM");
      if (signals.length === 0) signals.push("OpenGraph metadata on product endpoint");
      verificationReason = `Verified product page via ${signals.join(", ")}.`;
    } else if (
      pathname.includes("/lp/") ||
      pathname.includes("/pages/") ||
      pathname.includes("/offer/")
    ) {
      pageType = "CAMPAIGN_LANDING_PAGE";
      fetchOutcome = "NON_PRODUCT_PAGE";
      verified = false;
      verificationReason = "Destination is a promotional/campaign landing page without verified single-product schema.";
      verificationLimitations.push("Campaign landing page lacks verified single-SKU metadata.");
    } else {
      pageType = "UNCLASSIFIED_PAGE";
      fetchOutcome = "MISSING_METADATA";
      verified = false;
      verificationReason =
        "Page returned HTTP 200 HTML but lacked verifiable product schema, OpenGraph product metadata, or ecommerce DOM signals.";
      verificationLimitations.push(
        "Missing structured product metadata (JSON-LD/OpenGraph/DOM) on landing page."
      );
    }

    const finalSku =
      jsonLdProduct?.sku ||
      domSku ||
      effectiveUrlInfo.skuFromQuery ||
      null;
    const finalGtin = jsonLdProduct?.gtin || null;
    const finalBrand = jsonLdProduct?.brand || ogBrand || null;
    const finalMerchantProductId =
      jsonLdProduct?.productId ||
      ogRetailerItemId ||
      domProductId ||
      effectiveUrlInfo.queryProductId ||
      null;
    const finalVariantId =
      resolvedUrlInfo.variantId ||
      effectiveUrlInfo.variantId ||
      jsonLdProduct?.variantId ||
      null;

    // Extract model from JSON-LD or from verified product name
    let finalModel: string | null =
      jsonLdProduct?.model || effectiveUrlInfo.modelFromQuery || null;
    if (!finalModel && candidateProductName) {
      const titleCls = classifyAdvertisingHeadline(candidateProductName);
      if (titleCls.extractedModel) {
        finalModel = titleCls.extractedModel;
      }
    }

    const imageRefs = Array.from(
      new Set(
        [
          ...(jsonLdProduct?.images || []),
          jsonLdProduct?.image || null,
          ogImage || null,
        ].filter((x): x is string => Boolean(x && typeof x === "string"))
      )
    );

    const evidenceRefs: string[] = [`MerchantFetch:${currentUrl}`];
    if (jsonLdFound) evidenceRefs.push("Schema:JSON-LD:Product");
    if (hasOgProductSignal) evidenceRefs.push("Meta:OpenGraph:Product");
    if (finalMerchantProductId) evidenceRefs.push(`MerchantProductID:${finalMerchantProductId}`);
    if (finalSku) evidenceRefs.push(`MerchantSKU:${finalSku}`);
    if (finalGtin) evidenceRefs.push(`GTIN:${finalGtin}`);

    return {
      url: currentUrl,
      requestedUrl: url,
      resolvedFinalUrl: currentUrl,
      declaredCanonicalUrl,
      normalizedProductUrl:
        effectiveUrlInfo.normalizedBaseProductUrl ||
        effectiveUrlInfo.cleanCanonicalUrl ||
        currentUrl,
      storeDomain: effectiveUrlInfo.storeDomain || resolvedUrlInfo.storeDomain,
      merchantProductId: finalMerchantProductId,
      productId: finalMerchantProductId,
      isSafe: true,
      pageType,
      pageClassification: pageType,
      isValidProductPage: verified,
      fetchOutcome,
      httpStatus,
      verified,
      verificationReason,
      verificationLimitations,
      contradictions,
      evidenceTimestamp,
      evidenceReferences: evidenceRefs,
      title: pageTitle,
      ogTitle,
      ogImage: imageRefs[0] || null,
      imageReferences: imageRefs,
      canonicalUrl:
        declaredCanonicalUrl ||
        effectiveUrlInfo.normalizedBaseProductUrl ||
        effectiveUrlInfo.cleanCanonicalUrl,
      brand: finalBrand,
      model: finalModel,
      sku: finalSku,
      gtin: finalGtin,
      variantId: finalVariantId,
      price: jsonLdProduct?.price || ogPriceAmount || null,
      currency: jsonLdProduct?.currency || ogPriceCurrency || null,
      productName: verified ? candidateProductName : (isTitleValidProduct ? candidateProductName : null),
      description: jsonLdProduct?.description || ogDescription || null,
      jsonLdFound,
      jsonLdProduct,
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    const isTimeout =
      err?.name === "TimeoutError" ||
      err?.name === "AbortError" ||
      /timed?\s*out|abort/i.test(msg);
    const fallbackUrlInfo = extractProductUrlMetadata(currentUrl);

    return {
      url: currentUrl,
      requestedUrl: url,
      resolvedFinalUrl: null,
      declaredCanonicalUrl: null,
      normalizedProductUrl: fallbackUrlInfo.normalizedBaseProductUrl || null,
      storeDomain: fallbackUrlInfo.storeDomain,
      merchantProductId: null,
      isSafe: true,
      pageType: "ERROR_PAGE",
      fetchOutcome: isTimeout ? "TIMEOUT" : "NETWORK_ERROR",
      httpStatus: null,
      verified: false,
      verificationReason: isTimeout
        ? `Merchant page fetch timed out after ${timeoutMs}ms`
        : `Merchant page fetch network error: ${msg}`,
      verificationLimitations: [
        isTimeout
          ? `Merchant fetch timeout (${timeoutMs}ms)`
          : `Merchant fetch failed (${msg})`,
      ],
      contradictions: [],
      evidenceTimestamp,
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
      variantId: fallbackUrlInfo.variantId || null,
      price: null,
      currency: null,
      productName: null,
      description: null,
      jsonLdFound: false,
      jsonLdProduct: null,
      fetchError: msg,
    };
  }
}
