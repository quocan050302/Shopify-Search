/**
 * Link Validation Service — SWAI V6.2
 *
 * Centralized, SSRF-safe external URL verification.
 * Media resolution now delegates to videoSourceResolver.ts (V6.2).
 */

import dns from "dns";
import net from "net";
import { validateExternalResourceUrl } from "@/lib/security";

// Re-export media resolution helpers from V6.2 resolver (single source of truth)
export {
  isSampleOrFakeMedia,
  isStockImage,
  resolvePlayableMedia,
  resolveVideoSource,
  classifySourceType,
  extractTikTokPostId,
  buildTikTokOEmbedUrl,
  isSyntheticAdId,
} from "@/services/video/videoSourceResolver";


// ─── Link Type Classifications ───────────────────────────────────────────────

export type LinkType =
  | "AD_SOURCE"
  | "VIDEO_SOURCE"
  | "VIDEO_EMBED"
  | "THUMBNAIL"
  | "PRODUCT_PAGE"
  | "STOREFRONT"
  | "ADVERTISER_PROFILE"
  | "EXTERNAL_REFERENCE";

// ─── Link Status States ───────────────────────────────────────────────────────

export type LinkStatus =
  | "VALID"
  | "REDIRECTED"
  | "NOT_FOUND"
  | "GONE"
  | "ACCESS_RESTRICTED"
  | "AUTH_REQUIRED"
  | "RATE_LIMITED"
  | "TEMPORARILY_UNAVAILABLE"
  | "UNSUPPORTED"
  | "UNVERIFIED"
  | "INVALID";

export interface LinkVerificationResult {
  originalUrl: string;
  resolvedUrl?: string;
  httpStatus?: number;
  verificationStatus: LinkStatus;
  verificationMethod: "HEAD" | "GET" | "DNS_ONLY" | "BLOCKED" | "CACHED";
  responseTimeMs?: number;
  errorCode?: string;
  errorMessage?: string;
  provider?: string;
  verifiedAt: string;
  notes?: string;
}

// ─── Private IP SSRF Blocklist ────────────────────────────────────────────────

const PRIVATE_IP_PATTERNS = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fe80:/i,
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "169.254.169.254",
  "metadata.google.internal",
  "169.254.170.2",
  "fd00:ec2::254",
]);

function isPrivateOrBlockedHost(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) return true;
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) return true;
  }
  return false;
}

// ─── Provider Detection ───────────────────────────────────────────────────────

function detectProvider(hostname: string): string | undefined {
  if (hostname.includes("facebook.com") || hostname.includes("meta.com"))
    return "META";
  if (hostname.includes("instagram.com")) return "META_INSTAGRAM";
  if (hostname.includes("tiktok.com") || hostname.includes("ads.tiktok.com"))
    return "TIKTOK";
  if (hostname.includes("shopify.com") || hostname.includes("myshopify.com"))
    return "SHOPIFY";
  if (hostname.includes("unsplash.com")) return "UNSPLASH";
  if (hostname.includes("googleapis.com") || hostname.includes("commondatastorage.googleapis.com"))
    return "GOOGLE_STORAGE";
  return undefined;
}

// ─── HTTP Status → LinkStatus Mapping ────────────────────────────────────────

function classifyHttpStatus(status: number): LinkStatus {
  if (status >= 200 && status < 300) return "VALID";
  if (status === 301 || status === 302 || status === 307 || status === 308)
    return "REDIRECTED";
  if (status === 401 || status === 403) return "ACCESS_RESTRICTED";
  if (status === 404) return "NOT_FOUND";
  if (status === 410) return "GONE";
  if (status === 429) return "RATE_LIMITED";
  if (status === 500 || status === 502 || status === 503 || status === 504)
    return "TEMPORARILY_UNAVAILABLE";
  if (status === 405) return "UNSUPPORTED";
  return "UNVERIFIED";
}

// ─── Safe URL Validation Entry Point ─────────────────────────────────────────

export function validateResearchUrl(rawUrl: string): {
  isValid: boolean;
  reason?: string;
  sanitizedUrl?: string;
  hostname?: string;
  provider?: string;
} {
  const securityCheck = validateExternalResourceUrl(rawUrl);
  if (!securityCheck.isValid || !securityCheck.sanitizedUrl) {
    return { isValid: false, reason: securityCheck.reason };
  }

  try {
    const parsed = new URL(securityCheck.sanitizedUrl);
    const hostname = parsed.hostname.toLowerCase();

    if (isPrivateOrBlockedHost(hostname)) {
      return {
        isValid: false,
        reason: `Blocked hostname for SSRF safety: ${hostname}`,
      };
    }

    return {
      isValid: true,
      sanitizedUrl: securityCheck.sanitizedUrl,
      hostname,
      provider: detectProvider(hostname),
    };
  } catch {
    return { isValid: false, reason: "URL parse error" };
  }
}

// ─── HTTP Check with SSRF Protection ─────────────────────────────────────────

export interface CheckLinkOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  allowGet?: boolean;
  linkType?: LinkType;
}

export async function checkExternalLink(
  url: string,
  options: CheckLinkOptions = {}
): Promise<LinkVerificationResult> {
  const { timeoutMs = 8000, allowGet = false } = options;
  const startTime = Date.now();
  const now = new Date().toISOString();

  const validation = validateResearchUrl(url);
  if (!validation.isValid || !validation.sanitizedUrl) {
    return {
      originalUrl: url,
      verificationStatus: "INVALID",
      verificationMethod: "BLOCKED",
      errorCode: "INVALID_URL",
      errorMessage: validation.reason,
      verifiedAt: now,
    };
  }

  const { sanitizedUrl, hostname = "", provider } = validation;

  try {
    if (hostname) {
      await resolveAndValidatePublicDestination(hostname);
    }
  } catch (destErr: any) {
    return {
      originalUrl: url,
      resolvedUrl: sanitizedUrl,
      verificationStatus: "INVALID",
      verificationMethod: "BLOCKED",
      errorCode: "SSRF_BLOCKED",
      errorMessage: destErr.message || "Destination IP validation failed.",
      provider,
      verifiedAt: now,
    };
  }

  // Detect known-inaccessible embed patterns without hitting network
  if (
    sanitizedUrl.includes("facebook.com/ads/archive/render_ad") ||
    sanitizedUrl.includes("ads.tiktok.com/business/creativecenter/inspiration/topads/embed/")
  ) {
    return {
      originalUrl: url,
      resolvedUrl: sanitizedUrl,
      verificationStatus: "ACCESS_RESTRICTED",
      verificationMethod: "BLOCKED",
      provider,
      notes: "Known embed endpoint: requires authenticated session or is not publicly embeddable",
      verifiedAt: now,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let method: "HEAD" | "GET" = "HEAD";
    let response: Response;

    try {
      response = await fetch(sanitizedUrl, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "SWAI-LinkValidator/6.2 (Research Tool; +https://github.com/quocan050302/Shopify-Search)",
        },
      });

      if (response.status === 405 && allowGet) {
        method = "GET";
        response = await fetch(sanitizedUrl, {
          method: "GET",
          redirect: "follow",
          signal: controller.signal,
          headers: {
            "User-Agent":
              "SWAI-LinkValidator/6.2 (Research Tool; +https://github.com/quocan050302/Shopify-Search)",
            Range: "bytes=0-0",
          },
        });
      }
    } catch (fetchErr: any) {
      const responseTimeMs = Date.now() - startTime;
      clearTimeout(timeout);
      if (fetchErr.name === "AbortError") {
        return {
          originalUrl: url,
          resolvedUrl: sanitizedUrl,
          verificationStatus: "TEMPORARILY_UNAVAILABLE",
          verificationMethod: method,
          responseTimeMs,
          errorCode: "TIMEOUT",
          errorMessage: `Request timed out after ${timeoutMs}ms`,
          provider,
          verifiedAt: now,
        };
      }
      return {
        originalUrl: url,
        resolvedUrl: sanitizedUrl,
        verificationStatus: "TEMPORARILY_UNAVAILABLE",
        verificationMethod: method,
        responseTimeMs,
        errorCode: "NETWORK_ERROR",
        errorMessage: fetchErr.message || "Network request failed",
        provider,
        verifiedAt: now,
      };
    }

    clearTimeout(timeout);

    const responseTimeMs = Date.now() - startTime;
    const resolvedUrl = response.url || sanitizedUrl;

    // SSRF check: verify redirect destination is also safe
    if (resolvedUrl !== sanitizedUrl) {
      const redirectValidation = validateResearchUrl(resolvedUrl);
      if (!redirectValidation.isValid) {
        return {
          originalUrl: url,
          resolvedUrl,
          verificationStatus: "INVALID",
          verificationMethod: method,
          responseTimeMs,
          errorCode: "UNSAFE_REDIRECT",
          errorMessage: `Redirect destination failed SSRF check: ${redirectValidation.reason}`,
          provider,
          verifiedAt: now,
        };
      }
    }

    return {
      originalUrl: url,
      resolvedUrl,
      httpStatus: response.status,
      verificationStatus: classifyHttpStatus(response.status),
      verificationMethod: method,
      responseTimeMs,
      provider,
      verifiedAt: now,
    };
  } catch (err: any) {
    clearTimeout(timeout);
    return {
      originalUrl: url,
      resolvedUrl: sanitizedUrl,
      verificationStatus: "TEMPORARILY_UNAVAILABLE",
      verificationMethod: "HEAD",
      responseTimeMs: Date.now() - startTime,
      errorCode: "UNEXPECTED_ERROR",
      errorMessage: err.message || "Unknown error",
      provider,
      verifiedAt: now,
    };
  }
}

// ─── KH-01.A2: Hardened Public Research URL & Bounded Page Fetcher ─────────────

export interface ValidatedResearchUrl {
  originalUrl: string;
  normalizedUrl: string;
  hostname: string;
  protocol: "http:" | "https:";
  isPublic: boolean;
}

export interface PublicFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  allowedContentTypes?: string[];
  signal?: AbortSignal;
  dnsLookupFn?: typeof dns.promises.lookup;
}

export interface ValidatedDestination {
  hostname: string;
  addresses: string[];
}

export interface PublicPageFetchResult {
  originalUrl: string;
  finalUrl: string;
  httpStatus: number;
  statusClassification:
    | "SUCCESS"
    | "REDIRECTED"
    | "ACCESS_RESTRICTED"
    | "RATE_LIMITED"
    | "NOT_FOUND"
    | "FAILED";
  contentType: string | null;
  contentLengthBytes: number;
  content: string | null;
  headers: Record<string, string>;
  isTruncated: boolean;
  durationMs: number;
  errorMessage?: string;
}

/**
 * Checks whether an IP or encoded IP string belongs to private, loopback, link-local,
 * CGNAT, or cloud-metadata address spaces.
 */
function isRestrictedIpOrEncodedHost(hostname: string): boolean {
  const clean = hostname.replace(/^\[|\]$/g, "").trim().toLowerCase();

  // Known metadata hostnames
  if (
    clean === "localhost" ||
    clean === "metadata" ||
    clean === "instance-data" ||
    clean.endsWith(".internal") ||
    clean.endsWith(".local") ||
    clean === "metadata.google.internal"
  ) {
    return true;
  }

  // IPv6 checks
  if (
    clean === "::1" ||
    clean === "::" ||
    clean.startsWith("fe80:") ||
    clean.startsWith("fc") ||
    clean.startsWith("fd") ||
    clean === "fd00:ec2::254"
  ) {
    return true;
  }

  // Handle decimal dword IP (e.g. 2130706433 -> 127.0.0.1)
  if (/^\d+$/.test(clean)) {
    const num = parseInt(clean, 10);
    if (!isNaN(num) && num >= 0 && num <= 4294967295) {
      const b1 = (num >>> 24) & 255;
      const b2 = (num >>> 16) & 255;
      const b3 = (num >>> 8) & 255;
      const b4 = num & 255;
      return isPrivateIpv4Octets(b1, b2, b3, b4);
    }
  }

  // Handle standard dotted IPv4 or hex/octal dotted parts
  const parts = clean.split(".");
  if (parts.length === 4) {
    const octets = parts.map((p) => {
      if (p.startsWith("0x") || p.startsWith("0X")) {
        return parseInt(p, 16);
      }
      if (p.startsWith("0") && p.length > 1 && !isNaN(parseInt(p, 8))) {
        return parseInt(p, 8);
      }
      return parseInt(p, 10);
    });

    if (octets.every((o) => !isNaN(o) && o >= 0 && o <= 255)) {
      return isPrivateIpv4Octets(octets[0], octets[1], octets[2], octets[3]);
    }
  }

  // Pattern checks on hostname string
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(clean)) return true;
  }

  return false;
}

function isPrivateIpv4Octets(b1: number, b2: number, b3: number, b4: number): boolean {
  if (b1 === 0) return true; // 0.0.0.0/8
  if (b1 === 10) return true; // 10.0.0.0/8
  if (b1 === 127) return true; // 127.0.0.0/8 (Loopback)
  if (b1 === 169 && b2 === 254) return true; // 169.254.0.0/16 (Link-local & cloud metadata)
  if (b1 === 172 && b2 >= 16 && b2 <= 31) return true; // 172.16.0.0/12
  if (b1 === 192 && b2 === 168) return true; // 192.168.0.0/16
  if (b1 === 100 && b2 >= 64 && b2 <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (b1 === 192 && b2 === 0 && b3 === 0) return true; // 192.0.0.0/24 (IETF)
  if (b1 === 192 && b2 === 0 && b3 === 2) return true; // 192.0.2.0/24 (TEST-NET-1)
  if (b1 === 198 && (b2 === 18 || b2 === 19)) return true; // 198.18.0.0/15 (Benchmarking)
  if (b1 === 198 && b2 === 51 && b3 === 100) return true; // 198.51.100.0/24 (TEST-NET-2)
  if (b1 === 203 && b2 === 0 && b3 === 113) return true; // 203.0.113.0/24 (TEST-NET-3)
  if (b1 >= 224) return true; // 224.0.0.0/4 Multicast & 240.0.0.0/4 Reserved & 255.255.255.255 Broadcast
  return false;
}

export function isRestrictedIpAddress(ip: string): boolean {
  let address = ip.trim();
  if (address.startsWith("[") && address.endsWith("]")) {
    address = address.slice(1, -1);
  }

  // IPv4-mapped IPv6 check (e.g. ::ffff:127.0.0.1 or ::ffff:192.168.1.1)
  const ipv4MappedMatch = address.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (ipv4MappedMatch) {
    address = ipv4MappedMatch[1];
  }

  if (net.isIPv4(address)) {
    const parts = address.split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }
    return isPrivateIpv4Octets(parts[0], parts[1], parts[2], parts[3]);
  }

  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80:") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // fe80::/10 link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 unique local
    if (lower.startsWith("ff")) return true; // ff00::/8 multicast
    if (lower.startsWith("2001:db8:")) return true; // 2001:db8::/32 documentation
    if (lower.startsWith("::ffff:")) return true; // any other IPv4-mapped IPv6
    if (lower === "fd00:ec2::254") return true; // AWS IMDSv6
    return false;
  }

  return false;
}

/**
 * Resolves destination IP addresses and validates against SSRF, DNS rebinding,
 * private networks, loopback, link-local, and cloud metadata.
 */
export async function resolveAndValidatePublicDestination(
  hostname: string,
  options?: { dnsLookupFn?: typeof dns.promises.lookup }
): Promise<ValidatedDestination> {
  const cleanHost = hostname.replace(/^\[|\]$/g, "").trim().toLowerCase();

  // If hostname is directly an IP or encoded host that is restricted
  if (isRestrictedIpOrEncodedHost(cleanHost) || isRestrictedIpAddress(cleanHost)) {
    throw new Error(
      `Access to restricted, local, private, or cloud metadata destination '${cleanHost}' is prohibited.`
    );
  }

  // If cleanHost is already a valid public IP literal (e.g. 8.8.8.8)
  if (net.isIP(cleanHost)) {
    return {
      hostname: cleanHost,
      addresses: [cleanHost],
    };
  }

  // Resolve DNS records (A and AAAA)
  const lookup = options?.dnsLookupFn || dns.promises.lookup;
  let records: dns.LookupAddress[] = [];

  try {
    const result = await lookup(cleanHost, { all: true });
    records = Array.isArray(result) ? result : [result];
  } catch (err: any) {
    throw new Error(`DNS resolution failed for host '${cleanHost}': ${err.message || "Unknown error"}`);
  }

  if (!records || records.length === 0) {
    throw new Error(`No DNS records found for host '${cleanHost}'.`);
  }

  const addresses: string[] = [];
  for (const record of records) {
    const ip = record.address;
    if (isRestrictedIpAddress(ip) || isRestrictedIpOrEncodedHost(ip)) {
      throw new Error(
        `DNS resolution for host '${cleanHost}' resolved to restricted destination IP '${ip}'. Connection prohibited.`
      );
    }
    addresses.push(ip);
  }

  return {
    hostname: cleanHost,
    addresses,
  };
}

/**
 * Validates a public research URL strictly according to KH-01.A2 requirements:
 * - Only http: and https: protocols allowed
 * - Rejects embedded credentials (username:password@)
 * - Rejects private, loopback, cloud metadata destinations
 * - Handles IPv4, IPv6, and numeric/encoded address forms
 * - Preserves original submitted URL
 */
export function validatePublicResearchUrl(rawUrl: string): ValidatedResearchUrl {
  if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error("URL must be a non-empty string.");
  }

  const trimmed = rawUrl.trim();
  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Malformed URL structure: '${rawUrl}'.`);
  }

  // Protocol check
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Unsupported URL scheme '${parsed.protocol}'. Only 'http:' and 'https:' are permitted.`
    );
  }

  // Embedded credentials check
  if (parsed.username || parsed.password) {
    throw new Error("URLs with embedded credentials (user:password@) are strictly prohibited.");
  }

  const hostname = parsed.hostname.toLowerCase();

  // SSRF check on hostname
  if (isRestrictedIpOrEncodedHost(hostname)) {
    throw new Error(
      `Access to restricted, local, private, or cloud metadata destination '${hostname}' is prohibited.`
    );
  }

  return {
    originalUrl: rawUrl,
    normalizedUrl: parsed.toString(),
    hostname,
    protocol: parsed.protocol as "http:" | "https:",
    isPublic: true,
  };
}

/**
 * Executes a bounded, safe HTTP fetch of a public landing page.
 *
 * Guarantees:
 * - Total timeout with AbortSignal cancellation
 * - Hop-by-hop redirect validation (prevents redirect bypass to internal networks)
 * - Max redirects enforcement (default 3)
 * - Max response byte bounding (default 2MB) to prevent memory exhaustion
 * - Content-Type validation
 * - Clear distinction of blocked / rate-limited sources (403, 429) without fake data
 */
export async function fetchPublicResearchPage(
  validatedUrl: ValidatedResearchUrl,
  options: PublicFetchOptions = {}
): Promise<PublicPageFetchResult> {
  const {
    timeoutMs = 8000,
    maxRedirects = 3,
    maxResponseBytes = 2 * 1024 * 1024, // 2 MB limit
    allowedContentTypes = ["text/html", "application/xhtml+xml", "application/json", "text/plain"],
    signal,
    dnsLookupFn,
  } = options;

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Link caller signal if provided
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  let currentUrl = validatedUrl.normalizedUrl;
  let redirectCount = 0;

  try {
    while (redirectCount <= maxRedirects) {
      // Re-validate current URL at each step (including redirects)
      const currentValidation = validatePublicResearchUrl(currentUrl);

      // Verify destination IP resolution to block DNS rebinding and private addresses
      try {
        await resolveAndValidatePublicDestination(currentValidation.hostname, { dnsLookupFn });
      } catch (destErr: any) {
        clearTimeout(timeoutId);
        return {
          originalUrl: validatedUrl.originalUrl,
          finalUrl: currentUrl,
          httpStatus: 0,
          statusClassification: "FAILED",
          contentType: null,
          contentLengthBytes: 0,
          content: null,
          headers: {},
          isTruncated: false,
          durationMs: Date.now() - startTime,
          errorMessage: destErr.message || "Destination IP validation failed.",
        };
      }

      const response = await fetch(currentValidation.normalizedUrl, {
        method: "GET",
        redirect: "manual", // Hop-by-hop manual verification
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (SWAI Research Bot; +https://github.com/quocan050302/Shopify-Search)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((val, key) => {
        responseHeaders[key.toLowerCase()] = val;
      });

      const httpStatus = response.status;

      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(httpStatus)) {
        redirectCount++;
        const location = response.headers.get("location");
        if (!location) {
          clearTimeout(timeoutId);
          return {
            originalUrl: validatedUrl.originalUrl,
            finalUrl: currentUrl,
            httpStatus,
            statusClassification: "FAILED",
            contentType: null,
            contentLengthBytes: 0,
            content: null,
            headers: responseHeaders,
            isTruncated: false,
            durationMs: Date.now() - startTime,
            errorMessage: "Redirect status received without Location header.",
          };
        }

        if (redirectCount > maxRedirects) {
          clearTimeout(timeoutId);
          return {
            originalUrl: validatedUrl.originalUrl,
            finalUrl: currentUrl,
            httpStatus,
            statusClassification: "FAILED",
            contentType: null,
            contentLengthBytes: 0,
            content: null,
            headers: responseHeaders,
            isTruncated: false,
            durationMs: Date.now() - startTime,
            errorMessage: `Exceeded maximum redirect limit of ${maxRedirects}.`,
          };
        }

        // Resolve target URL relative to current URL
        try {
          const resolvedTarget = new URL(location, currentUrl).toString();
          currentUrl = resolvedTarget;
          continue;
        } catch {
          clearTimeout(timeoutId);
          return {
            originalUrl: validatedUrl.originalUrl,
            finalUrl: currentUrl,
            httpStatus,
            statusClassification: "FAILED",
            contentType: null,
            contentLengthBytes: 0,
            content: null,
            headers: responseHeaders,
            isTruncated: false,
            durationMs: Date.now() - startTime,
            errorMessage: `Invalid redirect location header: '${location}'.`,
          };
        }
      }

      // Terminal response reached
      clearTimeout(timeoutId);

      // Check access restrictions
      if (httpStatus === 401 || httpStatus === 403) {
        return {
          originalUrl: validatedUrl.originalUrl,
          finalUrl: currentUrl,
          httpStatus,
          statusClassification: "ACCESS_RESTRICTED",
          contentType: responseHeaders["content-type"] || null,
          contentLengthBytes: 0,
          content: null,
          headers: responseHeaders,
          isTruncated: false,
          durationMs: Date.now() - startTime,
          errorMessage: `Source returned HTTP ${httpStatus}: Access restricted or forbidden.`,
        };
      }

      if (httpStatus === 429) {
        return {
          originalUrl: validatedUrl.originalUrl,
          finalUrl: currentUrl,
          httpStatus,
          statusClassification: "RATE_LIMITED",
          contentType: responseHeaders["content-type"] || null,
          contentLengthBytes: 0,
          content: null,
          headers: responseHeaders,
          isTruncated: false,
          durationMs: Date.now() - startTime,
          errorMessage: "Source returned HTTP 429: Rate limit exceeded.",
        };
      }

      if (httpStatus === 404 || httpStatus === 410) {
        return {
          originalUrl: validatedUrl.originalUrl,
          finalUrl: currentUrl,
          httpStatus,
          statusClassification: "NOT_FOUND",
          contentType: responseHeaders["content-type"] || null,
          contentLengthBytes: 0,
          content: null,
          headers: responseHeaders,
          isTruncated: false,
          durationMs: Date.now() - startTime,
          errorMessage: `Source returned HTTP ${httpStatus}: Page not found or removed.`,
        };
      }

      const contentType = responseHeaders["content-type"] || "";
      const isAllowedContent =
        !contentType ||
        allowedContentTypes.some((type) => contentType.toLowerCase().includes(type));

      if (!isAllowedContent) {
        return {
          originalUrl: validatedUrl.originalUrl,
          finalUrl: currentUrl,
          httpStatus,
          statusClassification: "FAILED",
          contentType,
          contentLengthBytes: 0,
          content: null,
          headers: responseHeaders,
          isTruncated: false,
          durationMs: Date.now() - startTime,
          errorMessage: `Unsupported content type '${contentType}'. Only text and html are permitted.`,
        };
      }

      // Read response body with byte cap
      if (!response.body) {
        return {
          originalUrl: validatedUrl.originalUrl,
          finalUrl: currentUrl,
          httpStatus,
          statusClassification: httpStatus >= 200 && httpStatus < 300 ? "SUCCESS" : "FAILED",
          contentType,
          contentLengthBytes: 0,
          content: "",
          headers: responseHeaders,
          isTruncated: false,
          durationMs: Date.now() - startTime,
        };
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let isTruncated = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.length;
          if (totalBytes > maxResponseBytes) {
            const allowed = value.slice(0, value.length - (totalBytes - maxResponseBytes));
            chunks.push(allowed);
            isTruncated = true;
            await reader.cancel("Response size exceeded threshold");
            break;
          } else {
            chunks.push(value);
          }
        }
      }

      const decoder = new TextDecoder("utf-8");
      let fullContent = "";
      for (const chunk of chunks) {
        fullContent += decoder.decode(chunk, { stream: true });
      }
      fullContent += decoder.decode();

      return {
        originalUrl: validatedUrl.originalUrl,
        finalUrl: currentUrl,
        httpStatus,
        statusClassification: httpStatus >= 200 && httpStatus < 300 ? "SUCCESS" : "FAILED",
        contentType,
        contentLengthBytes: totalBytes,
        content: fullContent,
        headers: responseHeaders,
        isTruncated,
        durationMs: Date.now() - startTime,
      };
    }

    clearTimeout(timeoutId);
    return {
      originalUrl: validatedUrl.originalUrl,
      finalUrl: currentUrl,
      httpStatus: 0,
      statusClassification: "FAILED",
      contentType: null,
      contentLengthBytes: 0,
      content: null,
      headers: {},
      isTruncated: false,
      durationMs: Date.now() - startTime,
      errorMessage: `Exceeded maximum redirect limit of ${maxRedirects}.`,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const durationMs = Date.now() - startTime;
    if (err.name === "AbortError") {
      return {
        originalUrl: validatedUrl.originalUrl,
        finalUrl: currentUrl,
        httpStatus: 0,
        statusClassification: "FAILED",
        contentType: null,
        contentLengthBytes: 0,
        content: null,
        headers: {},
        isTruncated: false,
        durationMs,
        errorMessage: `Request timed out after ${timeoutMs}ms or was cancelled.`,
      };
    }

    return {
      originalUrl: validatedUrl.originalUrl,
      finalUrl: currentUrl,
      httpStatus: 0,
      statusClassification: "FAILED",
      contentType: null,
      contentLengthBytes: 0,
      content: null,
      headers: {},
      isTruncated: false,
      durationMs,
      errorMessage: err.message || "Failed to fetch public research page.",
    };
  }
}

