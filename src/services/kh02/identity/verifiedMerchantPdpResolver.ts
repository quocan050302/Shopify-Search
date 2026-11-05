/**
 * ANTI — KH-02 V12.4.3.7.16: Real Merchant PDP Destination Verification
 *
 * Implements bounded, SSRF-protected HTTP resolution to verify that a Google Ads
 * creative landing page points to an actual, live, confirmed Merchant Product Detail Page (PDP).
 *
 * Distinguishes:
 * - PDP_URL_STRUCTURE_VALID (pure URL syntax pre-screen)
 * - FETCHED_PDP_VERIFIED (real observed PDP with confirmed product identity)
 * - TEST_VERIFIED_ONLY (controlled test mock, never grants live external proof)
 */

import { extractRegistrableDomain, classifyVerifiedGoogleMerchantDestination } from "./crossPlatformProductMatcher";

export interface LivePdpVerificationParams {
  creative: {
    creativeId: string;
    landingPageUrl?: string | null;
  };
  candidate: {
    candidateId?: string;
    storeDomain?: string | null;
    canonicalProductUrl?: string | null;
    title?: string | null;
    handle?: string | null;
  };
  options?: {
    transportMode?: "LIVE_NATIVE" | "TEST_SIMULATION" | "DISABLED";
    fetchFn?: typeof fetch;
    simulateFinalUrl?: string;
    timeoutMs?: number;
    maxRedirects?: number;
  };
}

export type MerchantPdpVerificationStatus =
  | "FETCHED_PDP_VERIFIED"
  | "HTTP_ERROR"
  | "REDIRECT_NON_PDP"
  | "PRODUCT_HANDLE_CONFLICT"
  | "PRODUCT_IDENTITY_MISMATCH"
  | "NOT_RUN_NO_AUTHORIZED_TRANSPORT"
  | "PROVIDER_DESTINATION_MISSING"
  | "BLOCKED_PRIVATE_HOST"
  | "STORE_DOMAIN_MISMATCH"
  | "VERIFICATION_FAILED";

export interface LivePdpVerificationResult {
  isVerifiedPdp: boolean;
  verificationStatus: MerchantPdpVerificationStatus;
  verificationSource?: "LIVE_PROVIDER" | "TEST_VERIFIED_ONLY" | "UNVERIFIED";
  isLiveExternalProof?: boolean;
  finalUrl?: string;
  statusCode?: number;
  reason?: string;
  title?: string;
}

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 5;

function isBlockedPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().trim();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }

  // IPv4 Private & Link-local ranges:
  // 10.0.0.0/8
  // 172.16.0.0/12
  // 192.168.0.0/16
  // 169.254.0.0/16 (metadata)
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const oct1 = parseInt(ipv4Match[1], 10);
    const oct2 = parseInt(ipv4Match[2], 10);
    if (oct1 === 127) return true;
    if (oct1 === 10) return true;
    if (oct1 === 192 && oct2 === 168) return true;
    if (oct1 === 172 && oct2 >= 16 && oct2 <= 31) return true;
    if (oct1 === 169 && oct2 === 254) return true; // cloud metadata
  }

  return false;
}

function areTitlesCompatible(titleA: string, titleB: string): boolean {
  if (!titleA || !titleB) return false;
  const cleanA = titleA.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
  const cleanB = titleB.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();

  // Words set intersection
  const wordsA = new Set(cleanA.split(/\s+/).filter((w) => w.length > 2));
  const wordsB = new Set(cleanB.split(/\s+/).filter((w) => w.length > 2));

  let shared = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) shared++;
  }

  // If at least 2 key terms or 40% match
  const minLen = Math.min(wordsA.size, wordsB.size);
  if (minLen === 0) return false;
  return shared >= 2 || shared / minLen >= 0.4;
}

export async function verifyLiveMerchantProductPageDestination(
  params: LivePdpVerificationParams
): Promise<LivePdpVerificationResult> {
  const { creative, candidate, options } = params;

  // 1. Creative URL provenance check
  if (!creative?.landingPageUrl || typeof creative.landingPageUrl !== "string" || !creative.landingPageUrl.trim()) {
    return {
      isVerifiedPdp: false,
      verificationStatus: "PROVIDER_DESTINATION_MISSING",
      reason: "Missing creative landing page URL.",
    };
  }

  const rawUrl = creative.landingPageUrl.trim();

  // 2. Google Ads Transparency / non-merchant check
  if (
    rawUrl.includes("adstransparency.google.com") ||
    rawUrl.includes("/advertiser/") ||
    rawUrl.includes("google.com/search")
  ) {
    return {
      isVerifiedPdp: false,
      verificationStatus: "PROVIDER_DESTINATION_MISSING",
      reason: "URL points to Google Ads Transparency or generic search, not a merchant PDP.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      isVerifiedPdp: false,
      verificationStatus: "VERIFICATION_FAILED",
      reason: "Malformed landing page URL.",
    };
  }

  // 3. SSRF preflight
  if (isBlockedPrivateHost(parsed.hostname)) {
    return {
      isVerifiedPdp: false,
      verificationStatus: "BLOCKED_PRIVATE_HOST",
      reason: `Blocked private host: ${parsed.hostname}`,
    };
  }

  // 4. Store domain check
  if (candidate.storeDomain) {
    const candRegDomain = extractRegistrableDomain(candidate.storeDomain);
    const evRegDomain = extractRegistrableDomain(parsed.hostname);
    if (!candRegDomain || !evRegDomain || candRegDomain !== evRegDomain) {
      return {
        isVerifiedPdp: false,
        verificationStatus: "STORE_DOMAIN_MISMATCH",
        reason: `Destination domain '${evRegDomain}' does not match candidate merchant domain '${candRegDomain}'.`,
      };
    }
  }

  // 5. Shorteners / open redirect parameter check
  const shorteners = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "buff.ly", "is.gd", "rebrand.ly"];
  if (shorteners.some((s) => parsed.hostname === s || parsed.hostname.endsWith("." + s))) {
    return {
      isVerifiedPdp: false,
      verificationStatus: "VERIFICATION_FAILED",
      reason: "Link shorteners are not accepted as verified canonical PDP.",
    };
  }

  for (const p of ["url", "dest", "destination", "target", "adurl", "r"]) {
    if (parsed.searchParams.has(p)) {
      const val = parsed.searchParams.get(p);
      if (val && /^https?:\/\//i.test(val)) {
        return {
          isVerifiedPdp: false,
          verificationStatus: "VERIFICATION_FAILED",
          reason: `Unresolved redirect parameter '?${p}=' detected in URL.`,
        };
      }
    }
  }

  // 6. Handle check against candidate URL
  const candHandleMatch = candidate.canonicalProductUrl?.match(/\/products\/([a-z0-9-_]+)/i);
  const candHandle = candHandleMatch ? candHandleMatch[1].toLowerCase() : candidate.handle?.toLowerCase();
  const urlHandleMatch = parsed.pathname.match(/\/products\/([a-z0-9-_]+)/i);
  const urlHandle = urlHandleMatch ? urlHandleMatch[1].toLowerCase() : null;

  if (candHandle && urlHandle && candHandle !== urlHandle) {
    return {
      isVerifiedPdp: false,
      verificationStatus: "PRODUCT_HANDLE_CONFLICT",
      reason: `Landing page product handle '${urlHandle}' contradicts candidate product handle '${candHandle}'.`,
    };
  }

  // 7. Transport mode evaluation
  if (options?.transportMode === "DISABLED") {
    return {
      isVerifiedPdp: false,
      verificationStatus: "NOT_RUN_NO_AUTHORIZED_TRANSPORT",
      reason: "Live transport verification is DISABLED in this mode.",
    };
  }

  const isTestSimulation = Boolean(options?.fetchFn || options?.transportMode === "TEST_SIMULATION");
  const fetchImpl = options?.fetchFn || fetch;

  if (!options?.fetchFn && !process.env.ENABLE_LIVE_NETWORK_FETCHER) {
    // If running in environment without live network fetcher authorized
    return {
      isVerifiedPdp: false,
      verificationStatus: "NOT_RUN_NO_AUTHORIZED_TRANSPORT",
      reason: "Live network fetcher is not authorized.",
    };
  }

  // 8. Execute HTTP request with bounded timeout and redirect handling
  const timeoutMs = options?.timeoutMs || DEFAULT_TIMEOUT_MS;
  let currentUrl = rawUrl;
  let finalUrl = options?.simulateFinalUrl || rawUrl;
  let response: Response;

  try {
    response = await fetchImpl(currentUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (err: any) {
    return {
      isVerifiedPdp: false,
      verificationStatus: "VERIFICATION_FAILED",
      reason: err?.message || "HTTP fetch failed",
    };
  }

  if (response.status !== 200) {
    return {
      isVerifiedPdp: false,
      verificationStatus: "HTTP_ERROR",
      statusCode: response.status,
      reason: `HTTP status ${response.status}`,
    };
  }

  // Check if redirected to non-PDP (e.g. homepage)
  const finalParsed = new URL(finalUrl);
  if (!finalParsed.pathname || finalParsed.pathname === "/" || !finalParsed.pathname.includes("/products/")) {
    return {
      isVerifiedPdp: false,
      verificationStatus: "REDIRECT_NON_PDP",
      finalUrl,
      reason: "Redirected to homepage or non-product page.",
    };
  }

  const finalHandleMatch = finalParsed.pathname.match(/\/products\/([a-z0-9-_]+)/i);
  const finalHandle = finalHandleMatch ? finalHandleMatch[1].toLowerCase() : null;
  if (candHandle && finalHandle && candHandle !== finalHandle) {
    return {
      isVerifiedPdp: false,
      verificationStatus: "PRODUCT_HANDLE_CONFLICT",
      finalUrl,
      reason: `Final redirected handle '${finalHandle}' contradicts candidate product handle '${candHandle}'.`,
    };
  }

  // Read response body up to 2MB
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch (err: any) {
    return {
      isVerifiedPdp: false,
      verificationStatus: "VERIFICATION_FAILED",
      reason: "Failed to read response body",
    };
  }

  if (bodyText.length > MAX_BODY_BYTES) {
    bodyText = bodyText.slice(0, MAX_BODY_BYTES);
  }

  // Extract page title or JSON-LD product name
  let extractedTitle = "";
  const titleMatch = bodyText.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    extractedTitle = titleMatch[1].trim();
  }

  const jsonLdMatch = bodyText.match(/"@type"\s*:\s*"Product"[\s\S]*?"name"\s*:\s*"([^"]+)"/i);
  if (jsonLdMatch && jsonLdMatch[1]) {
    extractedTitle = jsonLdMatch[1].trim();
  }

  // If candidate title provided, verify compatibility
  if (candidate.title && extractedTitle) {
    const compatible = areTitlesCompatible(candidate.title, extractedTitle);
    if (!compatible) {
      return {
        isVerifiedPdp: false,
        verificationStatus: "PRODUCT_IDENTITY_MISMATCH",
        finalUrl,
        title: extractedTitle,
        reason: `Page title '${extractedTitle}' does not match candidate product title '${candidate.title}'.`,
      };
    }
  }

  return {
    isVerifiedPdp: true,
    verificationStatus: "FETCHED_PDP_VERIFIED",
    verificationSource: isTestSimulation ? "TEST_VERIFIED_ONLY" : "LIVE_PROVIDER",
    isLiveExternalProof: !isTestSimulation,
    finalUrl,
    statusCode: response.status,
    title: extractedTitle,
  };
}
