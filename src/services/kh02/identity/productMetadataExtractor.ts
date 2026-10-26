/**
 * SWAI KH-02 — Product Metadata Extractor & Canonical URL Validator
 *
 * Implements URL parsing, Shopify product handle extraction, and SSRF security guards:
 * - Normalizes ecommerce URLs, removing tracking/UTM parameters and session IDs.
 * - Extracts clean product slug from Shopify `/products/<handle>` structures.
 * - Enforces SSRF protection: strictly rejects localhost, private subnets, and metadata endpoints.
 */

import { URL } from "url";

export interface ExtractedProductUrlInfo {
  isValidEcommerceUrl: boolean;
  isShopifyProductUrl: boolean;
  cleanCanonicalUrl: string | null;
  storeDomain: string | null;
  productHandle: string | null;
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

/**
 * Checks if a URL points to a forbidden private, loopback, or cloud-metadata address (SSRF guard).
 */
export function isSafePublicUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    const host = parsed.hostname.toLowerCase();

    if (FORBIDDEN_HOSTNAMES.has(host)) {
      return false;
    }

    // Check private IPv4 ranges (10.x.x.x, 192.168.x.x, 172.16-31.x.x)
    if (/^10\./.test(host) || /^192\.168\./.test(host)) {
      return false;
    }
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) {
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
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
    .trim();
}

/**
 * Parses and validates an ecommerce landing page URL, extracting canonical structure and Shopify product handles.
 */
export function extractProductUrlMetadata(rawUrl?: string | null): ExtractedProductUrlInfo {
  if (!rawUrl || typeof rawUrl !== "string") {
    return {
      isValidEcommerceUrl: false,
      isShopifyProductUrl: false,
      cleanCanonicalUrl: null,
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
      storeDomain: null,
      productHandle: null,
      derivedTitleFromSlug: null,
      rejectionReason: "URL rejected by security policy (invalid protocol or private destination)",
    };
  }

  try {
    const parsed = new URL(trimmed);
    const storeDomain = parsed.hostname.replace(/^www\./i, "").toLowerCase();

    // Check for homepage or root path
    const pathname = parsed.pathname;
    const isRoot = pathname === "" || pathname === "/";

    // Strip tracking queries (utm_*, fbclid, gclid, etc.)
    const searchParams = new URLSearchParams(parsed.search);
    const trackingKeys = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "ttclid",
      "ref",
      "source",
      "ad_id",
    ];
    for (const key of trackingKeys) {
      searchParams.delete(key);
    }

    const cleanQuery = searchParams.toString();
    const cleanCanonicalUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}${cleanQuery ? `?${cleanQuery}` : ""}`;

    // Inspect Shopify `/products/<handle>` pattern
    const shopifyMatch = pathname.match(/\/products\/([a-zA-Z0-9-_]+)/i);
    if (shopifyMatch && shopifyMatch[1]) {
      const productHandle = shopifyMatch[1].toLowerCase();
      const derivedTitleFromSlug = slugToTitleCase(productHandle);

      return {
        isValidEcommerceUrl: true,
        isShopifyProductUrl: true,
        cleanCanonicalUrl,
        storeDomain,
        productHandle,
        derivedTitleFromSlug,
      };
    }

    // Generic collection or other ecommerce path
    return {
      isValidEcommerceUrl: !isRoot,
      isShopifyProductUrl: false,
      cleanCanonicalUrl,
      storeDomain,
      productHandle: null,
      derivedTitleFromSlug: null,
      rejectionReason: isRoot ? "URL is a root domain / homepage, not a product page" : undefined,
    };
  } catch (err: any) {
    return {
      isValidEcommerceUrl: false,
      isShopifyProductUrl: false,
      cleanCanonicalUrl: null,
      storeDomain: null,
      productHandle: null,
      derivedTitleFromSlug: null,
      rejectionReason: err?.message || "URL parsing error",
    };
  }
}
