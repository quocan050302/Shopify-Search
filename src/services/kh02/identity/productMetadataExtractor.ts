/**
 * SWAI KH-02 — Product Metadata Extractor & Canonical URL Validator
 *
 * Implements URL parsing, Shopify product handle extraction, and SSRF security guards:
 * - Normalizes ecommerce URLs, removing tracking/UTM parameters and session IDs.
 * - Extracts clean product slug from Shopify `/products/<handle>` structures.
 * - Enforces SSRF protection: strictly rejects localhost, private subnets, and metadata endpoints.
 */

import { URL } from "url";
import dns from "dns";

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
  // 0.0.0.0/8
  if (p0 === 0) return true;
  // 10.0.0.0/8
  if (p0 === 10) return true;
  // 127.0.0.0/8
  if (p0 === 127) return true;
  // 169.254.0.0/16
  if (p0 === 169 && p1 === 254) return true;
  // 172.16.0.0/12 (172.16.0.0 to 172.31.255.255)
  if (p0 === 172 && p1 >= 16 && p1 <= 31) return true;
  // 192.168.0.0/16
  if (p0 === 192 && p1 === 168) return true;
  // 100.64.0.0/10 (Carrier-grade NAT)
  if (p0 === 100 && p1 >= 64 && p1 <= 127) return true;
  // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (TEST-NET)
  if (p0 === 192 && p1 === 0 && parts[2] === 2) return true;
  if (p0 === 198 && p1 === 51 && parts[2] === 100) return true;
  if (p0 === 203 && p1 === 0 && parts[2] === 113) return true;
  // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
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

export type ProductPageType =
  | "ACTUAL_PRODUCT_PAGE"
  | "COLLECTION_PAGE"
  | "HOMEPAGE"
  | "CAMPAIGN_LANDING_PAGE"
  | "REDIRECTED_PAGE"
  | "ERROR_PAGE"
  | "UNCLASSIFIED_PAGE";

export interface ProductMetadataContext {
  timeoutMs?: number;
  maxSizeBytes?: number;
  userAgent?: string;
  fetchFn?: typeof fetch;
}

export interface JsonLdProductInfo {
  name?: string;
  description?: string;
  brand?: string;
  image?: string;
  sku?: string;
  offers?: any;
}

export interface ProductMetadataEvidence {
  url: string;
  isSafe: boolean;
  pageType: ProductPageType;
  title: string | null;
  ogTitle: string | null;
  ogImage: string | null;
  canonicalUrl: string | null;
  brand: string | null;
  productName: string | null;
  description: string | null;
  jsonLdFound: boolean;
  jsonLdProduct?: JsonLdProductInfo | null;
  fetchError?: string;
}

/**
 * Safely and asynchronously inspects an authorized public merchant landing page to extract verified product metadata.
 * Strictly enforces SSRF defenses, max response size limits, and non-blocking timeouts.
 */
export async function fetchVerifiedProductPageMetadata(
  rawUrl?: string | null,
  context: ProductMetadataContext = {}
): Promise<ProductMetadataEvidence> {
  const url = rawUrl?.trim() || "";
  if (!url || !isSafePublicUrl(url)) {
    return {
      url,
      isSafe: false,
      pageType: "ERROR_PAGE",
      title: null,
      ogTitle: null,
      ogImage: null,
      canonicalUrl: null,
      brand: null,
      productName: null,
      description: null,
      jsonLdFound: false,
      jsonLdProduct: null,
      fetchError: "Blocked by SSRF or invalid URL security policy",
    };
  }

  const timeoutMs = context.timeoutMs || 3500;
  const maxBytes = context.maxSizeBytes || 256 * 1024; // 256KB cap
  const fetchImpl = context.fetchFn || fetch;
  const MAX_REDIRECTS = 5;

  let currentUrl = url;
  let redirectCount = 0;
  let res: any = null;

  try {
    while (true) {
      if (!isSafePublicUrl(currentUrl)) {
        return {
          url: currentUrl,
          isSafe: false,
          pageType: "ERROR_PAGE",
          title: null,
          ogTitle: null,
          ogImage: null,
          canonicalUrl: null,
          brand: null,
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
          "User-Agent": context.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SWAI-ProductBot/1.0",
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
            isSafe: true,
            pageType: "ERROR_PAGE",
            title: null,
            ogTitle: null,
            ogImage: null,
            canonicalUrl: null,
            brand: null,
            productName: null,
            description: null,
            jsonLdFound: false,
            jsonLdProduct: null,
            fetchError: `Exceeded redirect depth limit (${MAX_REDIRECTS} redirects)`,
          };
        }

        const location = res.headers?.get ? (res.headers.get("location") || res.headers.get("Location")) : res.headers?.location;
        if (!location) {
          return {
            url: currentUrl,
            isSafe: true,
            pageType: "ERROR_PAGE",
            title: null,
            ogTitle: null,
            ogImage: null,
            canonicalUrl: null,
            brand: null,
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
            isSafe: false,
            pageType: "ERROR_PAGE",
            title: null,
            ogTitle: null,
            ogImage: null,
            canonicalUrl: null,
            brand: null,
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

    if (!res.ok && res.status !== 200) {
      return {
        url: currentUrl,
        isSafe: true,
        pageType: "ERROR_PAGE",
        title: null,
        ogTitle: null,
        ogImage: null,
        canonicalUrl: null,
        brand: null,
        productName: null,
        description: null,
        jsonLdFound: false,
        jsonLdProduct: null,
        fetchError: `HTTP status ${res.status}`,
      };
    }

    const contentType = (res.headers?.get ? res.headers.get("content-type") : res.headers?.["content-type"]) || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return {
        url: currentUrl,
        isSafe: true,
        pageType: "UNCLASSIFIED_PAGE",
        title: null,
        ogTitle: null,
        ogImage: null,
        canonicalUrl: null,
        brand: null,
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
    const titleMatch = htmlText.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : null;

    // Extract OpenGraph Title
    const ogTitleMatch = htmlText.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      htmlText.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    const ogTitle = ogTitleMatch ? ogTitleMatch[1].trim() : null;

    // Extract OpenGraph Image
    const ogImageMatch = htmlText.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      htmlText.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const ogImage = ogImageMatch ? ogImageMatch[1].trim() : null;

    // Extract Canonical URL
    const canonicalMatch = htmlText.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
    const canonicalUrl = canonicalMatch ? canonicalMatch[1].trim() : null;

    // Extract JSON-LD Product blocks
    let jsonLdFound = false;
    let jsonLdProduct: JsonLdProductInfo | null = null;
    const jsonLdRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;

    while ((match = jsonLdRegex.exec(htmlText)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        const items = Array.isArray(parsed) ? parsed : (parsed["@graph"] ? parsed["@graph"] : [parsed]);
        for (const item of items) {
          if (item["@type"] === "Product" || (Array.isArray(item["@type"]) && item["@type"].includes("Product"))) {
            jsonLdFound = true;
            const brandVal = typeof item.brand === "string" ? item.brand : item.brand?.name || null;
            jsonLdProduct = {
              name: item.name ? String(item.name).trim() : undefined,
              description: item.description ? String(item.description).trim() : undefined,
              brand: brandVal,
              image: typeof item.image === "string" ? item.image : (Array.isArray(item.image) ? item.image[0] : item.image?.url),
              sku: item.sku ? String(item.sku) : undefined,
              offers: item.offers,
            };
            break;
          }
        }
        if (jsonLdFound) break;
      } catch {}
    }

    // Determine Page Type
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname.toLowerCase();
    let pageType: ProductPageType = "UNCLASSIFIED_PAGE";

    if (pathname === "" || pathname === "/") {
      pageType = "HOMEPAGE";
    } else if (pathname.includes("/collections/") || pathname.includes("/category/") || pathname.includes("/categories/")) {
      pageType = "COLLECTION_PAGE";
    } else if (jsonLdFound || pathname.includes("/products/") || pathname.match(/\/p\/[a-z0-9_-]+/)) {
      pageType = "ACTUAL_PRODUCT_PAGE";
    } else if (pathname.includes("/lp/") || pathname.includes("/pages/") || pathname.includes("/offer/")) {
      pageType = "CAMPAIGN_LANDING_PAGE";
    }

    const verifiedProductName = jsonLdProduct?.name || ogTitle || (pageTitle ? pageTitle.split(/[-–|]/)[0].trim() : null);

    return {
      url,
      isSafe: true,
      pageType,
      title: pageTitle,
      ogTitle,
      ogImage,
      canonicalUrl,
      brand: jsonLdProduct?.brand || null,
      productName: verifiedProductName,
      description: jsonLdProduct?.description || null,
      jsonLdFound,
      jsonLdProduct,
    };
  } catch (err: any) {
    return {
      url,
      isSafe: true,
      pageType: "ERROR_PAGE",
      title: null,
      ogTitle: null,
      ogImage: null,
      canonicalUrl: null,
      brand: null,
      productName: null,
      description: null,
      jsonLdFound: false,
      jsonLdProduct: null,
      fetchError: err?.message || String(err),
    };
  }
}
