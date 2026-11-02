/**
 * SWAI KH-02 V12.4.3.5.1 — Walmart US Jina Reader REST Client (Unauthenticated, Free Pilot)
 *
 * Source-of-truth method:
 *   SEARCH: GET https://r.jina.ai/https://www.walmart.com/search?q={encodedQuery}
 *   PDP:    GET https://r.jina.ai/https://www.walmart.com/ip/{itemId}
 *   HEADERS:
 *     Accept: application/json
 *     X-Cache-Tolerance: 0
 *     X-Respond-With: html
 *     X-Timeout: 25
 *
 * Strictly forbids Authorization, API keys, cookies, proxy headers, s.jina.ai,
 * or non-Walmart US targets. Enforces real AbortController timeout/cancellation
 * and bounded response reading.
 */

import {
  EvidenceOrigin,
  WalmartJinaEnvelopeData,
  WalmartJinaRequestOptions,
  WalmartJinaResponse,
  WalmartQueryExecutionStatus,
  computeWalmartDeterministicHash,
} from "./walmartJinaTypes";
import { DEFAULT_WALMART_PILOT_LIMITS } from "./walmartJinaPolicy";

export const JINA_READER_BASE_ORIGIN = "https://r.jina.ai";
export const WALMART_US_BASE_ORIGIN = "https://www.walmart.com";

const GENERIC_OR_FORBIDDEN_QUERIES = new Set([
  "all",
  "product",
  "products",
  "item",
  "items",
  "shop",
  "store",
  "walmart",
  "buy",
  "sale",
  "deal",
  "deals",
  "best",
  "winner",
  "winning",
  "trending",
  "null",
  "undefined",
  "test",
]);

const FORBIDDEN_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "x-jina-api-key",
  "x-proxy",
  "x-proxy-url",
  "proxy-authorization",
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
  "forwarded",
]);

export interface WalmartItemIdValidation {
  valid: boolean;
  itemId: string | null;
  rejectionCode:
    | "EMPTY_OR_NON_STRING"
    | "SCIENTIFIC_NOTATION_OR_NON_DIGITS"
    | "INVALID_LENGTH"
    | null;
  rejectionReason: string | null;
}

/**
 * Validates that a Walmart itemID is a safe digits-only string (e.g. "674275778", "16504921979").
 * Rejects numbers passed through scientific notation, negative signs, decimals, slashes, or URLs.
 */
export function validateWalmartItemIdString(input: unknown): WalmartItemIdValidation {
  if (typeof input !== "string") {
    return {
      valid: false,
      itemId: null,
      rejectionCode: "EMPTY_OR_NON_STRING",
      rejectionReason: "Walmart itemId must be provided as a string.",
    };
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      valid: false,
      itemId: null,
      rejectionCode: "EMPTY_OR_NON_STRING",
      rejectionReason: "Walmart itemId string is empty.",
    };
  }
  if (!/^[0-9]+$/.test(trimmed)) {
    return {
      valid: false,
      itemId: null,
      rejectionCode: "SCIENTIFIC_NOTATION_OR_NON_DIGITS",
      rejectionReason: `Walmart itemId '${trimmed.slice(0, 64)}' must contain ASCII digits only (0-9).`,
    };
  }
  if (trimmed.length < 4 || trimmed.length > 18) {
    return {
      valid: false,
      itemId: null,
      rejectionCode: "INVALID_LENGTH",
      rejectionReason: `Walmart itemId '${trimmed}' length (${trimmed.length}) is outside valid bounds (4..18 digits).`,
    };
  }
  return {
    valid: true,
    itemId: trimmed,
    rejectionCode: null,
    rejectionReason: null,
  };
}

export interface WalmartSearchUrlBuildResult {
  valid: boolean;
  normalizedQuery: string | null;
  encodedQuery: string | null;
  targetWalmartUrl: string | null;
  jinaReaderUrl: string | null;
  rejectionReason: string | null;
}

/**
 * Normalizes a candidate search query and constructs the exact Jina Reader REST URL:
 *   https://r.jina.ai/https://www.walmart.com/search?q={encodedQuery}
 */
export function buildWalmartJinaSearchUrl(query: string): WalmartSearchUrlBuildResult {
  if (typeof query !== "string") {
    return {
      valid: false,
      normalizedQuery: null,
      encodedQuery: null,
      targetWalmartUrl: null,
      jinaReaderUrl: null,
      rejectionReason: "Search query must be a string.",
    };
  }

  // Reject embedded URLs, traversal, null bytes, script tags, or credentials
  if (
    /https?:\/\/|file:\/\/|javascript:|<script|\.\.\/|\0|@/i.test(query)
  ) {
    return {
      valid: false,
      normalizedQuery: null,
      encodedQuery: null,
      targetWalmartUrl: null,
      jinaReaderUrl: null,
      rejectionReason: "Search query contains forbidden URL, script, credential, or path tokens.",
    };
  }

  const normalized = query
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[^\p{L}\p{N}\s+&-_.']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length < 3 || normalized.length > 120) {
    return {
      valid: false,
      normalizedQuery: null,
      encodedQuery: null,
      targetWalmartUrl: null,
      jinaReaderUrl: null,
      rejectionReason: `Search query length (${normalized.length}) must be between 3 and 120 characters.`,
    };
  }

  const lower = normalized.toLowerCase();
  if (GENERIC_OR_FORBIDDEN_QUERIES.has(lower)) {
    return {
      valid: false,
      normalizedQuery: null,
      encodedQuery: null,
      targetWalmartUrl: null,
      jinaReaderUrl: null,
      rejectionReason: `Search query '${normalized}' is too generic for specific product discovery.`,
    };
  }

  const encodedQuery = encodeURIComponent(normalized);
  const targetWalmartUrl = `${WALMART_US_BASE_ORIGIN}/search?q=${encodedQuery}`;
  const jinaReaderUrl = `${JINA_READER_BASE_ORIGIN}/${targetWalmartUrl}`;

  return {
    valid: true,
    normalizedQuery: normalized,
    encodedQuery,
    targetWalmartUrl,
    jinaReaderUrl,
    rejectionReason: null,
  };
}

export interface WalmartProductUrlBuildResult {
  valid: boolean;
  itemId: string | null;
  targetWalmartUrl: string | null;
  jinaReaderUrl: string | null;
  rejectionReason: string | null;
}

/**
 * Validates itemId as a safe digit-only string and constructs the exact Jina Reader REST URL:
 *   https://r.jina.ai/https://www.walmart.com/ip/{itemId}
 */
export function buildWalmartJinaProductUrl(itemId: string): WalmartProductUrlBuildResult {
  const idCheck = validateWalmartItemIdString(itemId);
  if (!idCheck.valid || !idCheck.itemId) {
    return {
      valid: false,
      itemId: null,
      targetWalmartUrl: null,
      jinaReaderUrl: null,
      rejectionReason: idCheck.rejectionReason || "Invalid Walmart itemId.",
    };
  }

  const targetWalmartUrl = `${WALMART_US_BASE_ORIGIN}/ip/${idCheck.itemId}`;
  const jinaReaderUrl = `${JINA_READER_BASE_ORIGIN}/${targetWalmartUrl}`;

  return {
    valid: true,
    itemId: idCheck.itemId,
    targetWalmartUrl,
    jinaReaderUrl,
    rejectionReason: null,
  };
}

/**
 * Returns the exact baseline headers verified in the owner's Walmart Jina Reader REST test.
 * Never includes Authorization, Cookie, API key, or X-Proxy headers.
 */
export function buildWalmartJinaHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "X-Cache-Tolerance": "0",
    "X-Respond-With": "html",
    "X-Timeout": "25",
  };
}

export function validateWalmartJinaHeaders(headers: Record<string, string>): {
  valid: boolean;
  reason: string | null;
} {
  for (const key of Object.keys(headers)) {
    const lower = key.trim().toLowerCase();
    if (FORBIDDEN_HEADER_NAMES.has(lower) || lower.startsWith("x-proxy")) {
      return {
        valid: false,
        reason: `Forbidden header '${key}' detected on free no-key Jina Reader request.`,
      };
    }
  }
  if (
    headers["Accept"] !== "application/json" ||
    headers["X-Cache-Tolerance"] !== "0" ||
    headers["X-Respond-With"] !== "html" ||
    headers["X-Timeout"] !== "25"
  ) {
    return {
      valid: false,
      reason: "Missing or altered mandatory baseline Jina Reader REST headers.",
    };
  }
  return { valid: true, reason: null };
}

export interface WalmartJinaTargetValidationResult {
  valid: boolean;
  operationKind: "SEARCH" | "PDP" | null;
  targetWalmartUrl: string | null;
  decodedSearchQuery: string | null;
  itemId: string | null;
  rejectionCode:
    | "EMPTY_OR_INVALID_URL"
    | "UNSAFE_PROTOCOL"
    | "CREDENTIALS_IN_URL"
    | "FORBIDDEN_OUTER_HOST"
    | "MISSING_INNER_WALMART_URL"
    | "FORBIDDEN_INNER_HOST"
    | "UNSUPPORTED_WALMART_ROUTE"
    | "INVALID_SEARCH_QUERY"
    | "INVALID_PDP_ITEM_ID"
    | null;
  rejectionReason: string | null;
}

/**
 * Strict allowlist validator for outgoing Jina Reader requests.
 * Permits ONLY:
 *   - https://r.jina.ai/https://www.walmart.com/search?q={encodedQuery}
 *   - https://r.jina.ai/https://www.walmart.com/ip/{itemId}
 * Rejects s.jina.ai, localhost, private IPs, file://, http://, embedded credentials,
 * non-US Walmart domains, or arbitrary paths/query params.
 */
export function validateWalmartJinaRequestTarget(
  rawUrl: unknown
): WalmartJinaTargetValidationResult {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return {
      valid: false,
      operationKind: null,
      targetWalmartUrl: null,
      decodedSearchQuery: null,
      itemId: null,
      rejectionCode: "EMPTY_OR_INVALID_URL",
      rejectionReason: "Request URL is empty or not a string.",
    };
  }

  const trimmed = rawUrl.trim();
  if (trimmed.includes("\0") || trimmed.includes("..") || trimmed.includes("\\")) {
    return {
      valid: false,
      operationKind: null,
      targetWalmartUrl: null,
      decodedSearchQuery: null,
      itemId: null,
      rejectionCode: "EMPTY_OR_INVALID_URL",
      rejectionReason: "Request URL contains path traversal or null bytes.",
    };
  }

  let outerParsed: URL;
  try {
    outerParsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      operationKind: null,
      targetWalmartUrl: null,
      decodedSearchQuery: null,
      itemId: null,
      rejectionCode: "EMPTY_OR_INVALID_URL",
      rejectionReason: "Malformed outer Jina Reader URL.",
    };
  }

  if (outerParsed.protocol !== "https:") {
    return {
      valid: false,
      operationKind: null,
      targetWalmartUrl: null,
      decodedSearchQuery: null,
      itemId: null,
      rejectionCode: "UNSAFE_PROTOCOL",
      rejectionReason: `Unsafe outer protocol '${outerParsed.protocol}'; only https: is permitted.`,
    };
  }

  if (outerParsed.username || outerParsed.password) {
    return {
      valid: false,
      operationKind: null,
      targetWalmartUrl: null,
      decodedSearchQuery: null,
      itemId: null,
      rejectionCode: "CREDENTIALS_IN_URL",
      rejectionReason: "Embedded credentials in outer URL are forbidden.",
    };
  }

  if (outerParsed.hostname.toLowerCase() !== "r.jina.ai" || outerParsed.port !== "") {
    return {
      valid: false,
      operationKind: null,
      targetWalmartUrl: null,
      decodedSearchQuery: null,
      itemId: null,
      rejectionCode: "FORBIDDEN_OUTER_HOST",
      rejectionReason: `Outer host '${outerParsed.host}' is not allowed; only r.jina.ai is permitted (s.jina.ai and custom proxies are forbidden).`,
    };
  }

  const prefix = `${JINA_READER_BASE_ORIGIN}/`;
  if (!trimmed.startsWith(prefix)) {
    return {
      valid: false,
      operationKind: null,
      targetWalmartUrl: null,
      decodedSearchQuery: null,
      itemId: null,
      rejectionCode: "MISSING_INNER_WALMART_URL",
      rejectionReason: "URL must start with https://r.jina.ai/.",
    };
  }

  const innerRaw = trimmed.slice(prefix.length);
  if (!innerRaw.startsWith("https://www.walmart.com/")) {
    return {
      valid: false,
      operationKind: null,
      targetWalmartUrl: null,
      decodedSearchQuery: null,
      itemId: null,
      rejectionCode: "FORBIDDEN_INNER_HOST",
      rejectionReason: `Inner target '${innerRaw.slice(0, 80)}' must start with https://www.walmart.com/.`,
    };
  }

  let innerParsed: URL;
  try {
    innerParsed = new URL(innerRaw);
  } catch {
    return {
      valid: false,
      operationKind: null,
      targetWalmartUrl: null,
      decodedSearchQuery: null,
      itemId: null,
      rejectionCode: "MISSING_INNER_WALMART_URL",
      rejectionReason: "Malformed inner Walmart target URL.",
    };
  }

  if (
    innerParsed.protocol !== "https:" ||
    innerParsed.hostname.toLowerCase() !== "www.walmart.com" ||
    innerParsed.port !== "" ||
    innerParsed.username ||
    innerParsed.password ||
    innerParsed.hash
  ) {
    return {
      valid: false,
      operationKind: null,
      targetWalmartUrl: null,
      decodedSearchQuery: null,
      itemId: null,
      rejectionCode: "FORBIDDEN_INNER_HOST",
      rejectionReason: "Inner URL must target https://www.walmart.com without credentials, port, or hash.",
    };
  }

  if (innerParsed.pathname === "/search") {
    const paramKeys = Array.from(innerParsed.searchParams.keys());
    if (paramKeys.length !== 1 || paramKeys[0] !== "q") {
      return {
        valid: false,
        operationKind: "SEARCH",
        targetWalmartUrl: null,
        decodedSearchQuery: null,
        itemId: null,
        rejectionCode: "INVALID_SEARCH_QUERY",
        rejectionReason: "Walmart search URL must contain exactly one query parameter 'q'.",
      };
    }
    const qVal = innerParsed.searchParams.get("q") || "";
    const rebuilt = buildWalmartJinaSearchUrl(qVal);
    if (!rebuilt.valid || !rebuilt.normalizedQuery) {
      return {
        valid: false,
        operationKind: "SEARCH",
        targetWalmartUrl: null,
        decodedSearchQuery: null,
        itemId: null,
        rejectionCode: "INVALID_SEARCH_QUERY",
        rejectionReason: rebuilt.rejectionReason || "Invalid search query in URL.",
      };
    }
    return {
      valid: true,
      operationKind: "SEARCH",
      targetWalmartUrl: innerRaw,
      decodedSearchQuery: rebuilt.normalizedQuery,
      itemId: null,
      rejectionCode: null,
      rejectionReason: null,
    };
  }

  const pdpMatch = innerParsed.pathname.match(/^\/ip\/([^/]+)$/);
  if (pdpMatch) {
    if (innerParsed.search !== "") {
      return {
        valid: false,
        operationKind: "PDP",
        targetWalmartUrl: null,
        decodedSearchQuery: null,
        itemId: null,
        rejectionCode: "INVALID_PDP_ITEM_ID",
        rejectionReason: "Walmart PDP URL must not include extra query parameters.",
      };
    }
    const idCheck = validateWalmartItemIdString(pdpMatch[1]);
    if (!idCheck.valid || !idCheck.itemId) {
      return {
        valid: false,
        operationKind: "PDP",
        targetWalmartUrl: null,
        decodedSearchQuery: null,
        itemId: null,
        rejectionCode: "INVALID_PDP_ITEM_ID",
        rejectionReason: idCheck.rejectionReason || "Invalid itemId in PDP URL.",
      };
    }
    return {
      valid: true,
      operationKind: "PDP",
      targetWalmartUrl: innerRaw,
      decodedSearchQuery: null,
      itemId: idCheck.itemId,
      rejectionCode: null,
      rejectionReason: null,
    };
  }

  return {
    valid: false,
    operationKind: null,
    targetWalmartUrl: null,
    decodedSearchQuery: null,
    itemId: null,
    rejectionCode: "UNSUPPORTED_WALMART_ROUTE",
    rejectionReason: `Walmart path '${innerParsed.pathname}' is not permitted; only /search?q=... and /ip/{itemId} are allowed.`,
  };
}

export interface RetryAfterParseResult {
  valid: boolean;
  delayMs: number | null;
  unblockAtMs: number | null;
  raw: string | null;
}

/**
 * Parses HTTP `Retry-After` header supporting both delta-seconds and HTTP-date formats.
 */
export function parseRetryAfter(
  headerValue: string | null | undefined,
  nowMs: number = Date.now()
): RetryAfterParseResult {
  if (typeof headerValue !== "string" || !headerValue.trim()) {
    return { valid: false, delayMs: null, unblockAtMs: null, raw: null };
  }
  const raw = headerValue.trim();

  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const seconds = Number.parseFloat(raw);
    if (Number.isFinite(seconds) && seconds >= 0) {
      const delayMs = Math.min(Math.ceil(seconds * 1000), 15 * 60 * 1000);
      return {
        valid: true,
        delayMs,
        unblockAtMs: nowMs + delayMs,
        raw,
      };
    }
  }

  const parsedDateMs = Date.parse(raw);
  if (Number.isFinite(parsedDateMs) && !Number.isNaN(parsedDateMs)) {
    const delayMs = Math.max(0, Math.min(parsedDateMs - nowMs, 15 * 60 * 1000));
    return {
      valid: true,
      delayMs,
      unblockAtMs: nowMs + delayMs,
      raw,
    };
  }

  return { valid: false, delayMs: null, unblockAtMs: null, raw };
}

export interface NormalizedJinaEnvelopeResult {
  valid: boolean;
  envelope: WalmartJinaEnvelopeData | null;
  errorCode: string | null;
  errorMessage: string | null;
}

/**
 * Validates and normalizes the JSON envelope returned by Jina Reader (`Accept: application/json` + `X-Respond-With: html`).
 * Baseline field is `data.html`. Allows explicitly verified compatible alias `data.content` ONLY when it contains actual HTML document/script content.
 * Rejects missing/empty HTML or unsupported shapes as `PARSE_ERROR` (never as an empty search array).
 */
export function normalizeWalmartJinaEnvelope(
  outerParsedJsonOrString: unknown
): NormalizedJinaEnvelopeResult {
  let outerParsedJson: unknown = outerParsedJsonOrString;
  if (typeof outerParsedJsonOrString === "string") {
    try {
      outerParsedJson = JSON.parse(outerParsedJsonOrString);
    } catch {
      return {
        valid: false,
        envelope: null,
        errorCode: "JINA_ENVELOPE_INVALID_JSON",
        errorMessage: "Outer Jina Reader response is not valid JSON.",
      };
    }
  }

  if (!outerParsedJson || typeof outerParsedJson !== "object" || Array.isArray(outerParsedJson)) {
    return {
      valid: false,
      envelope: null,
      errorCode: "JINA_ENVELOPE_NOT_OBJECT",
      errorMessage: "Outer Jina Reader JSON response is not an object.",
    };
  }

  const root = outerParsedJson as Record<string, unknown>;
  const dataObj =
    root.data && typeof root.data === "object" && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : null;

  // Check if Jina returned an explicit error envelope (e.g. code=401/402/429/403 with data=null)
  if (!dataObj) {
    return {
      valid: false,
      envelope: null,
      errorCode: "JINA_ENVELOPE_MISSING_DATA",
      errorMessage:
        typeof root.message === "string"
          ? `Jina Reader envelope missing data object: ${root.message}`
          : "Jina Reader JSON envelope is missing required 'data' object.",
    };
  }

  let html: string | null = null;
  let fieldAliasUsed: string | null = null;

  if (typeof dataObj.html === "string" && dataObj.html.trim().length > 0) {
    html = dataObj.html;
    fieldAliasUsed = "data.html";
  } else if (
    typeof dataObj.content === "string" &&
    dataObj.content.trim().length > 0 &&
    (/<html\b|<!doctype\s+html|<script[^>]+id=["']__NEXT_DATA__["']/i.test(dataObj.content))
  ) {
    html = dataObj.content;
    fieldAliasUsed = "data.content";
  }

  const rawInnerStatus =
    typeof dataObj.httpStatus === "number"
      ? dataObj.httpStatus
      : typeof dataObj.status === "number"
      ? dataObj.status
      : typeof root.status === "number" && root.status >= 100 && root.status < 600
      ? root.status
      : null;

  const finalUrl =
    typeof dataObj.finalUrl === "string" && dataObj.finalUrl.trim()
      ? dataObj.finalUrl.trim()
      : typeof dataObj.url === "string" && dataObj.url.trim()
      ? dataObj.url.trim()
      : null;

  const title =
    typeof dataObj.title === "string" ? dataObj.title.trim() : null;
  const description =
    typeof dataObj.description === "string" ? dataObj.description.trim() : null;
  const url =
    typeof dataObj.url === "string" ? dataObj.url.trim() : finalUrl;
  const publishedTime =
    typeof dataObj.publishedTime === "string" ? dataObj.publishedTime : null;
  const cacheStatus =
    typeof dataObj.cacheStatus === "string"
      ? dataObj.cacheStatus
      : typeof dataObj.cached === "boolean"
      ? dataObj.cached
        ? "HIT"
        : "MISS"
      : null;

  if (!html) {
    return {
      valid: false,
      envelope: {
        title,
        description,
        url,
        finalUrl,
        httpStatus: rawInnerStatus,
        html: null,
        publishedTime,
        cacheStatus,
        fieldAliasUsed: null,
      },
      errorCode: "JINA_ENVELOPE_MISSING_HTML",
      errorMessage:
        "Jina Reader response is missing baseline 'data.html' (and no verified HTML alias was present).",
    };
  }

  return {
    valid: true,
    envelope: {
      title,
      description,
      url,
      finalUrl,
      httpStatus: rawInnerStatus,
      html,
      publishedTime,
      cacheStatus,
      fieldAliasUsed,
    },
    errorCode: null,
    errorMessage: null,
  };
}

export interface WalmartJinaFailureClassification {
  queryStatus: WalmartQueryExecutionStatus;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
  stopFreePilot: boolean;
  isBotWall: boolean;
  isRateLimited: boolean;
  isTimeout: boolean;
  isAborted: boolean;
}

const BOT_WALL_PATTERNS: RegExp[] = [
  /robot\s+or\s+human\??/i,
  /activate\s+and\s+hold\s+the\s+button\s+to\s+confirm\s+that\s+you['’]?re\s+human/i,
  /press\s+&\s+hold\s+to\s+confirm\s+you\s+are\s+human/i,
  /px-captcha/i,
  /perimeterx/i,
  /verify\s+you\s+are\s+human/i,
  /automated\s+access\s+to\s+walmart/i,
];

const KEY_OR_PAYMENT_PATTERNS: RegExp[] = [
  /api\s*key\s+required/i,
  /insufficient\s+balance/i,
  /payment\s+required/i,
  /authentication\s+required/i,
  /invalid\s+api\s+key/i,
  /quota\s+exceeded.*upgrade/i,
];

export function detectWalmartBotWallInContent(
  htmlOrText: string | null | undefined,
  pageTitle?: string | null,
  finalUrl?: string | null
): { isBotWall: boolean; matchedSignal: string | null } {
  const combined = `${pageTitle || ""}\n${ (htmlOrText || "").slice(0, 120_000) }`;
  for (const pattern of BOT_WALL_PATTERNS) {
    if (pattern.test(combined)) {
      return { isBotWall: true, matchedSignal: pattern.source };
    }
  }
  if (finalUrl && /\/blocked(?:\?|\/|$)|\/captcha(?:\?|\/|$)/i.test(finalUrl)) {
    return { isBotWall: true, matchedSignal: `finalUrl:${finalUrl}` };
  }
  return { isBotWall: false, matchedSignal: null };
}

/**
 * Classifies outer HTTP status, inner Walmart `data.httpStatus`, HTML content, headers, and transport errors
 * into exact `WalmartQueryExecutionStatus` outcomes.
 * Note: `401/402` immediately stops free pilot (`stopFreePilot: true`) and never asks user for an API key.
 */
export function classifyWalmartJinaFailure(params: {
  error?: unknown;
  aborted?: boolean;
  timedOut?: boolean;
  outerStatus?: number | null;
  innerHttpStatus?: number | null;
  html?: string | null;
  pageTitle?: string | null;
  finalUrl?: string | null;
  rawBodyText?: string | null;
  envelopeErrorCode?: string | null;
  envelopeErrorMessage?: string | null;
}): WalmartJinaFailureClassification {
  if (params.timedOut) {
    return {
      queryStatus: "TIMED_OUT",
      errorCode: "JINA_HTTP_TIMEOUT",
      errorMessage:
        params.error instanceof Error
          ? params.error.message
          : "Jina Reader HTTP request timed out and was aborted.",
      retryable: true,
      stopFreePilot: false,
      isBotWall: false,
      isRateLimited: false,
      isTimeout: true,
      isAborted: true,
    };
  }

  if (params.aborted) {
    return {
      queryStatus: "CANCELLED",
      errorCode: "JINA_HTTP_ABORTED",
      errorMessage:
        params.error instanceof Error
          ? params.error.message
          : "Jina Reader HTTP request was cancelled by caller AbortSignal.",
      retryable: false,
      stopFreePilot: false,
      isBotWall: false,
      isRateLimited: false,
      isTimeout: false,
      isAborted: true,
    };
  }

  const outer = params.outerStatus ?? null;
  const inner = params.innerHttpStatus ?? null;
  const combinedText = `${params.pageTitle || ""} ${params.rawBodyText || ""} ${params.html || ""}`.slice(
    0,
    50_000
  );

  // 1. Check 401 / 402 key or payment required (outer or inner or explicit message)
  if (
    outer === 401 ||
    outer === 402 ||
    inner === 401 ||
    inner === 402 ||
    ((outer === 403 || outer === 429) &&
      KEY_OR_PAYMENT_PATTERNS.some((p) => p.test(combinedText)))
  ) {
    return {
      queryStatus: "KEY_OR_PAYMENT_REQUIRED",
      errorCode: `JINA_FREE_ACCESS_RESTRICTED_${outer || inner || 402}`,
      errorMessage:
        "Jina Reader returned 401/402 authentication or payment required; stopping no-key free pilot cleanly without requesting credentials.",
      retryable: false,
      stopFreePilot: true,
      isBotWall: false,
      isRateLimited: false,
      isTimeout: false,
      isAborted: false,
    };
  }

  // 2. Check 429 rate limit
  if (outer === 429 || inner === 429) {
    return {
      queryStatus: "RATE_LIMITED",
      errorCode: `HTTP_429_RATE_LIMITED_${outer === 429 ? "OUTER" : "INNER"}`,
      errorMessage: `Rate limited by ${outer === 429 ? "Jina Reader (outer 429)" : "Walmart upstream (inner 429)"}.`,
      retryable: true,
      stopFreePilot: false,
      isBotWall: false,
      isRateLimited: true,
      isTimeout: false,
      isAborted: false,
    };
  }

  // 3. Check bot wall / CAPTCHA in content or finalUrl (even when outer/inner HTTP status is 200!)
  const botCheck = detectWalmartBotWallInContent(
    params.html || params.rawBodyText,
    params.pageTitle,
    params.finalUrl
  );
  if (botCheck.isBotWall) {
    return {
      queryStatus: "BLOCKED_PROVIDER",
      errorCode: "WALMART_BOT_OR_CAPTCHA_WALL",
      errorMessage: `Walmart anti-bot / human verification challenge detected (${botCheck.matchedSignal}).`,
      retryable: false,
      stopFreePilot: false,
      isBotWall: true,
      isRateLimited: false,
      isTimeout: false,
      isAborted: false,
    };
  }

  // 4. Check 403 / 451 blocked provider
  if (outer === 403 || outer === 451 || inner === 403 || inner === 451) {
    return {
      queryStatus: "BLOCKED_PROVIDER",
      errorCode: `HTTP_${outer === 403 || outer === 451 ? outer : inner}_BLOCKED`,
      errorMessage: `Access blocked by ${
        outer === 403 || outer === 451 ? `Jina Reader (outer ${outer})` : `Walmart upstream (inner ${inner})`
      }.`,
      retryable: false,
      stopFreePilot: false,
      isBotWall: false,
      isRateLimited: false,
      isTimeout: false,
      isAborted: false,
    };
  }

  // 5. Check 5xx transient server errors (outer or inner)
  if (
    (outer !== null && outer >= 500 && outer < 600) ||
    (inner !== null && inner >= 500 && inner < 600)
  ) {
    return {
      queryStatus: "UNAVAILABLE",
      errorCode: `HTTP_${outer && outer >= 500 ? outer : inner}_UPSTREAM_5XX`,
      errorMessage: `Transient upstream 5xx error (outer=${outer ?? "none"}, inner=${inner ?? "none"}).`,
      retryable: true,
      stopFreePilot: false,
      isBotWall: false,
      isRateLimited: false,
      isTimeout: false,
      isAborted: false,
    };
  }

  // 6. Check envelope / JSON parse error
  if (params.envelopeErrorCode) {
    return {
      queryStatus: "PARSE_ERROR",
      errorCode: params.envelopeErrorCode,
      errorMessage:
        params.envelopeErrorMessage || "Failed to parse Jina Reader JSON envelope.",
      retryable: false,
      stopFreePilot: false,
      isBotWall: false,
      isRateLimited: false,
      isTimeout: false,
      isAborted: false,
    };
  }

  // 7. Check network/transport error (e.g. ECONNRESET, fetch failed)
  if (params.error) {
    const msg =
      params.error instanceof Error ? params.error.message : String(params.error);
    const isTransientNet =
      /econnreset|etimedout|eai_again|enotfound|socket hang up|fetch failed|network/i.test(
        msg
      );
    return {
      queryStatus: isTransientNet ? "UNAVAILABLE" : "FAILED",
      errorCode: isTransientNet ? "NETWORK_TRANSPORT_ERROR" : "REQUEST_FAILED",
      errorMessage: msg,
      retryable: isTransientNet,
      stopFreePilot: false,
      isBotWall: false,
      isRateLimited: false,
      isTimeout: false,
      isAborted: false,
    };
  }

  // 8. Check non-200 status codes
  if (outer !== null && (outer < 200 || outer >= 300)) {
    return {
      queryStatus: "UNAVAILABLE",
      errorCode: `OUTER_HTTP_${outer}`,
      errorMessage: `Jina Reader returned unexpected HTTP status ${outer}.`,
      retryable: false,
      stopFreePilot: false,
      isBotWall: false,
      isRateLimited: false,
      isTimeout: false,
      isAborted: false,
    };
  }

  if (inner !== null && (inner < 200 || inner >= 300)) {
    return {
      queryStatus: inner === 404 ? "UNAVAILABLE" : "BLOCKED_PROVIDER",
      errorCode: `INNER_WALMART_HTTP_${inner}`,
      errorMessage: `Walmart inner page returned HTTP status ${inner}.`,
      retryable: false,
      stopFreePilot: false,
      isBotWall: false,
      isRateLimited: false,
      isTimeout: false,
      isAborted: false,
    };
  }

  return {
    queryStatus: "SUCCEEDED",
    errorCode: "NONE",
    errorMessage: "",
    retryable: false,
    stopFreePilot: false,
    isBotWall: false,
    isRateLimited: false,
    isTimeout: false,
    isAborted: false,
  };
}

async function readResponseTextBounded(
  response: Response,
  maxBytes: number,
  signal: AbortSignal
): Promise<{ text: string; byteLength: number; exceededMaxBytes: boolean }> {
  if (!response.body) {
    const text = await response.text();
    const byteLength = Buffer.byteLength(text, "utf8");
    if (byteLength > maxBytes) {
      return { text: "", byteLength, exceededMaxBytes: true };
    }
    return { text, byteLength, exceededMaxBytes: false };
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      if (signal.aborted) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Request aborted while reading response body.");
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return { text: "", byteLength: totalBytes, exceededMaxBytes: true };
        }
        chunks.push(Buffer.from(value));
      }
    }
  } finally {
    reader.releaseLock();
  }

  const fullBuffer = Buffer.concat(chunks, totalBytes);
  return {
    text: fullBuffer.toString("utf8"),
    byteLength: totalBytes,
    exceededMaxBytes: false,
  };
}

/**
 * Executes a single bounded GET request against Jina Reader REST for Walmart US search or PDP.
 * Uses real AbortController cancellation, strict URL/header validation, and bounded response reading.
 */
export async function requestWalmartJinaReader(
  options: WalmartJinaRequestOptions
): Promise<WalmartJinaResponse> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const timeoutMs =
    options.timeoutMs ?? DEFAULT_WALMART_PILOT_LIMITS.httpTimeoutMs;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_WALMART_PILOT_LIMITS.maxResponseBytes;

  // Determine evidenceOrigin truthfully: if customFetch is supplied or explicitly marked fixture, it is TEST_FIXTURE
  const isCustomTransport = typeof options.customFetch === "function";
  const effectiveOrigin: EvidenceOrigin =
    isCustomTransport || options.evidenceOrigin === "TEST_FIXTURE"
      ? "TEST_FIXTURE"
      : options.evidenceOrigin || "REAL_JINA_READER";

  const localRequestRef = `wmt_req_${options.researchRunId}_${
    options.logicalOperationId || options.operationKind
  }_att${options.attemptNumber || 1}_gen${options.attemptGeneration || 1}`;

  // 1. Build URL from operationKind
  let requestUrl = "";
  let targetWalmartUrl = "";

  if (options.operationKind === "SEARCH") {
    const built = buildWalmartJinaSearchUrl(options.query || "");
    if (!built.valid || !built.jinaReaderUrl || !built.targetWalmartUrl) {
      const completedAt = new Date().toISOString();
      return {
        ok: false,
        queryStatus: "FAILED",
        operationKind: "SEARCH",
        requestUrl: "",
        targetWalmartUrl: "",
        requestHeadersSent: {},
        outerHttpStatus: null,
        innerHttpStatus: null,
        contentType: null,
        retryAfterMs: null,
        retryAfterRaw: null,
        requestedNoCache: true,
        observedCacheMetadata: null,
        envelope: null,
        rawBodyBytes: 0,
        requestHash: computeWalmartDeterministicHash({
          operationKind: "SEARCH",
          query: options.query || null,
        }),
        responseHash: computeWalmartDeterministicHash({ error: built.rejectionReason }),
        upstreamRequestId: null,
        localRequestRef,
        startedAt,
        completedAt,
        durationMs: Math.max(0, Date.now() - startedAtMs),
        aborted: false,
        timedOut: false,
        retryable: false,
        stopFreePilot: false,
        errorCode: "INVALID_SEARCH_QUERY",
        errorMessage: built.rejectionReason || "Invalid Walmart search query.",
        evidenceOrigin: effectiveOrigin,
      };
    }
    requestUrl = built.jinaReaderUrl;
    targetWalmartUrl = built.targetWalmartUrl;
  } else {
    const built = buildWalmartJinaProductUrl(options.itemId || "");
    if (!built.valid || !built.jinaReaderUrl || !built.targetWalmartUrl) {
      const completedAt = new Date().toISOString();
      return {
        ok: false,
        queryStatus: "FAILED",
        operationKind: "PDP",
        requestUrl: "",
        targetWalmartUrl: "",
        requestHeadersSent: {},
        outerHttpStatus: null,
        innerHttpStatus: null,
        contentType: null,
        retryAfterMs: null,
        retryAfterRaw: null,
        requestedNoCache: true,
        observedCacheMetadata: null,
        envelope: null,
        rawBodyBytes: 0,
        requestHash: computeWalmartDeterministicHash({
          operationKind: "PDP",
          itemId: options.itemId || null,
        }),
        responseHash: computeWalmartDeterministicHash({ error: built.rejectionReason }),
        upstreamRequestId: null,
        localRequestRef,
        startedAt,
        completedAt,
        durationMs: Math.max(0, Date.now() - startedAtMs),
        aborted: false,
        timedOut: false,
        retryable: false,
        stopFreePilot: false,
        errorCode: "INVALID_PDP_ITEM_ID",
        errorMessage: built.rejectionReason || "Invalid Walmart PDP itemId.",
        evidenceOrigin: effectiveOrigin,
      };
    }
    requestUrl = built.jinaReaderUrl;
    targetWalmartUrl = built.targetWalmartUrl;
  }

  // 2. Validate allowlist target and outgoing headers
  const targetValidation = validateWalmartJinaRequestTarget(requestUrl);
  const headers = buildWalmartJinaHeaders();
  const headerValidation = validateWalmartJinaHeaders(headers);

  const requestHash = computeWalmartDeterministicHash({
    method: "GET",
    requestUrl,
    targetWalmartUrl,
    headers,
  });

  if (!targetValidation.valid || !headerValidation.valid) {
    const completedAt = new Date().toISOString();
    const errMsg =
      targetValidation.rejectionReason ||
      headerValidation.reason ||
      "Target or header validation failed.";
    return {
      ok: false,
      queryStatus: "FAILED",
      operationKind: options.operationKind,
      requestUrl,
      targetWalmartUrl,
      requestHeadersSent: headers,
      outerHttpStatus: null,
      innerHttpStatus: null,
      contentType: null,
      retryAfterMs: null,
      retryAfterRaw: null,
      requestedNoCache: true,
      observedCacheMetadata: null,
      envelope: null,
      rawBodyBytes: 0,
      requestHash,
      responseHash: computeWalmartDeterministicHash({ error: errMsg }),
      upstreamRequestId: null,
      localRequestRef,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      aborted: false,
      timedOut: false,
      retryable: false,
      stopFreePilot: false,
      errorCode: targetValidation.rejectionCode || "HEADER_VALIDATION_FAILED",
      errorMessage: errMsg,
      evidenceOrigin: effectiveOrigin,
    };
  }

  // 3. Setup AbortController combining parent signal and per-attempt timeout
  const controller = new AbortController();
  let timedOut = false;
  let abortedByCaller = false;

  const onParentAbort = () => {
    abortedByCaller = true;
    controller.abort(new Error("Parent AbortSignal cancelled Walmart Jina Reader request."));
  };

  if (options.signal) {
    if (options.signal.aborted) {
      onParentAbort();
    } else {
      options.signal.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  const timeoutHandle = setTimeout(() => {
    if (!controller.signal.aborted) {
      timedOut = true;
      controller.abort(
        new Error(`Walmart Jina Reader HTTP attempt exceeded timeout of ${timeoutMs}ms.`)
      );
    }
  }, timeoutMs);

  const fetchImpl = options.customFetch || globalThis.fetch;

  let outerHttpStatus: number | null = null;
  let contentType: string | null = null;
  let retryAfterRaw: string | null = null;
  let retryAfterMs: number | null = null;
  let observedCacheMetadata: string | null = null;
  let upstreamRequestId: string | null = null;
  let rawBodyText = "";
  let rawBodyBytes = 0;

  try {
    if (controller.signal.aborted) {
      throw controller.signal.reason || new Error("Request aborted before fetch start.");
    }

    const response = await fetchImpl(requestUrl, {
      method: "GET",
      headers,
      redirect: "error",
      signal: controller.signal,
    });

    outerHttpStatus = response.status;
    contentType = response.headers.get("content-type");
    retryAfterRaw = response.headers.get("retry-after");
    if (retryAfterRaw) {
      const parsedRetry = parseRetryAfter(retryAfterRaw, Date.now());
      retryAfterMs = parsedRetry.delayMs;
    }

    const cacheHeaderParts: string[] = [];
    for (const hName of ["x-cache", "cf-cache-status", "x-jina-cache", "age"]) {
      const val = response.headers.get(hName);
      if (val) {
        cacheHeaderParts.push(`${hName}:${val}`);
      }
    }
    if (cacheHeaderParts.length > 0) {
      observedCacheMetadata = cacheHeaderParts.join("; ");
    }

    const rawUpstreamId =
      response.headers.get("x-request-id") ||
      response.headers.get("x-jina-request-id") ||
      response.headers.get("cf-ray");
    if (
      rawUpstreamId &&
      rawUpstreamId.trim() &&
      !rawUpstreamId.trim().startsWith("wmt_req_")
    ) {
      upstreamRequestId = rawUpstreamId.trim();
    }

    const bodyRead = await readResponseTextBounded(
      response,
      maxResponseBytes,
      controller.signal
    );
    rawBodyText = bodyRead.text;
    rawBodyBytes = bodyRead.byteLength;

    if (bodyRead.exceededMaxBytes) {
      const completedAt = new Date().toISOString();
      return {
        ok: false,
        queryStatus: "PARSE_ERROR",
        operationKind: options.operationKind,
        requestUrl,
        targetWalmartUrl,
        requestHeadersSent: headers,
        outerHttpStatus,
        innerHttpStatus: null,
        contentType,
        retryAfterMs,
        retryAfterRaw,
        requestedNoCache: headers["X-Cache-Tolerance"] === "0",
        observedCacheMetadata,
        envelope: null,
        rawBodyBytes,
        requestHash,
        responseHash: computeWalmartDeterministicHash({
          outerHttpStatus,
          exceededMaxBytes: true,
          rawBodyBytes,
        }),
        upstreamRequestId,
        localRequestRef,
        startedAt,
        completedAt,
        durationMs: Math.max(0, Date.now() - startedAtMs),
        aborted: false,
        timedOut: false,
        retryable: false,
        stopFreePilot: false,
        errorCode: "RESPONSE_EXCEEDS_MAX_BYTES",
        errorMessage: `Jina Reader response exceeded maxResponseBytes (${maxResponseBytes}).`,
        evidenceOrigin: effectiveOrigin,
      };
    }

    const responseHash = computeWalmartDeterministicHash({
      outerHttpStatus,
      contentType,
      bodySha256: computeWalmartDeterministicHash(rawBodyText),
    });

    // If outer status is 401/402/429/403/5xx before JSON parsing, try parsing JSON for extra diagnostics, but classify status properly
    let parsedJson: unknown = null;
    let jsonParseError: Error | null = null;
    try {
      parsedJson = JSON.parse(rawBodyText);
    } catch (err: any) {
      jsonParseError = err instanceof Error ? err : new Error(String(err));
    }

    if (outerHttpStatus < 200 || outerHttpStatus >= 300) {
      const innerStatusFromErr =
        parsedJson &&
        typeof parsedJson === "object" &&
        (parsedJson as any).data &&
        typeof (parsedJson as any).data.httpStatus === "number"
          ? (parsedJson as any).data.httpStatus
          : null;

      const classification = classifyWalmartJinaFailure({
        outerStatus: outerHttpStatus,
        innerHttpStatus: innerStatusFromErr,
        rawBodyText,
      });

      const completedAt = new Date().toISOString();
      return {
        ok: false,
        queryStatus: classification.queryStatus,
        operationKind: options.operationKind,
        requestUrl,
        targetWalmartUrl,
        requestHeadersSent: headers,
        outerHttpStatus,
        innerHttpStatus: innerStatusFromErr,
        contentType,
        retryAfterMs,
        retryAfterRaw,
        requestedNoCache: headers["X-Cache-Tolerance"] === "0",
        observedCacheMetadata,
        envelope: null,
        rawBodyBytes,
        requestHash,
        responseHash,
        upstreamRequestId,
        localRequestRef,
        startedAt,
        completedAt,
        durationMs: Math.max(0, Date.now() - startedAtMs),
        aborted: false,
        timedOut: false,
        retryable: classification.retryable,
        stopFreePilot: classification.stopFreePilot,
        errorCode: classification.errorCode,
        errorMessage: classification.errorMessage,
        evidenceOrigin: effectiveOrigin,
      };
    }

    // Outer HTTP status is 2xx -> JSON must be valid
    if (jsonParseError) {
      const completedAt = new Date().toISOString();
      return {
        ok: false,
        queryStatus: "PARSE_ERROR",
        operationKind: options.operationKind,
        requestUrl,
        targetWalmartUrl,
        requestHeadersSent: headers,
        outerHttpStatus,
        innerHttpStatus: null,
        contentType,
        retryAfterMs,
        retryAfterRaw,
        requestedNoCache: headers["X-Cache-Tolerance"] === "0",
        observedCacheMetadata,
        envelope: null,
        rawBodyBytes,
        requestHash,
        responseHash,
        upstreamRequestId,
        localRequestRef,
        startedAt,
        completedAt,
        durationMs: Math.max(0, Date.now() - startedAtMs),
        aborted: false,
        timedOut: false,
        retryable: false,
        stopFreePilot: false,
        errorCode: "MALFORMED_JINA_JSON",
        errorMessage: `Jina Reader returned HTTP ${outerHttpStatus} with malformed JSON: ${jsonParseError.message}`,
        evidenceOrigin: effectiveOrigin,
      };
    }

    const normEnvelope = normalizeWalmartJinaEnvelope(parsedJson);
    const innerHttpStatus = normEnvelope.envelope?.httpStatus ?? null;
    if (normEnvelope.envelope?.cacheStatus && !observedCacheMetadata) {
      observedCacheMetadata = `envelope.cacheStatus:${normEnvelope.envelope.cacheStatus}`;
    }

    const classification = classifyWalmartJinaFailure({
      outerStatus: outerHttpStatus,
      innerHttpStatus,
      html: normEnvelope.envelope?.html ?? null,
      pageTitle: normEnvelope.envelope?.title ?? null,
      finalUrl: normEnvelope.envelope?.finalUrl ?? null,
      rawBodyText,
      envelopeErrorCode: normEnvelope.errorCode,
      envelopeErrorMessage: normEnvelope.errorMessage,
    });

    const completedAt = new Date().toISOString();
    const isOk =
      normEnvelope.valid && classification.queryStatus === "SUCCEEDED";

    return {
      ok: isOk,
      queryStatus: classification.queryStatus,
      operationKind: options.operationKind,
      requestUrl,
      targetWalmartUrl,
      requestHeadersSent: headers,
      outerHttpStatus,
      innerHttpStatus,
      contentType,
      retryAfterMs,
      retryAfterRaw,
      requestedNoCache: headers["X-Cache-Tolerance"] === "0",
      observedCacheMetadata,
      envelope: normEnvelope.envelope,
      rawBodyBytes,
      requestHash,
      responseHash,
      upstreamRequestId,
      localRequestRef,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      aborted: false,
      timedOut: false,
      retryable: classification.retryable,
      stopFreePilot: classification.stopFreePilot,
      errorCode: isOk ? null : classification.errorCode,
      errorMessage: isOk ? null : classification.errorMessage,
      evidenceOrigin: effectiveOrigin,
    };
  } catch (err: unknown) {
    const isAborted = controller.signal.aborted || abortedByCaller || timedOut;
    const classification = classifyWalmartJinaFailure({
      error: err,
      aborted: isAborted && !timedOut,
      timedOut,
      outerStatus: outerHttpStatus,
    });
    const completedAt = new Date().toISOString();
    return {
      ok: false,
      queryStatus: classification.queryStatus,
      operationKind: options.operationKind,
      requestUrl,
      targetWalmartUrl,
      requestHeadersSent: headers,
      outerHttpStatus,
      innerHttpStatus: null,
      contentType,
      retryAfterMs,
      retryAfterRaw,
      requestedNoCache: headers["X-Cache-Tolerance"] === "0",
      observedCacheMetadata,
      envelope: null,
      rawBodyBytes,
      requestHash,
      responseHash: computeWalmartDeterministicHash({
        aborted: isAborted,
        timedOut,
        error: classification.errorMessage,
      }),
      upstreamRequestId,
      localRequestRef,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      aborted: isAborted,
      timedOut,
      retryable: classification.retryable,
      stopFreePilot: classification.stopFreePilot,
      errorCode: classification.errorCode,
      errorMessage: classification.errorMessage,
      evidenceOrigin: effectiveOrigin,
    };
  } finally {
    clearTimeout(timeoutHandle);
    if (options.signal) {
      options.signal.removeEventListener("abort", onParentAbort);
    }
  }
}
