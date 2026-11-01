/**
 * SWAI KH-02 V12.4.3.5.1 — Walmart US `__NEXT_DATA__` HTML Extractor & Schema Parser
 *
 * Implements:
 * - extractNextDataScript(html, maxBytes)
 * - inspectWalmartSchemaCompatibility(nextData, expectedKind)
 * - assertWalmartPageIdentity(page, expectedKind, expectedQueryOrItemId)
 * - parseWalmartSearchNextData(nextData, requestContext)
 * - parseWalmartPdpNextData(nextData, requestContext)
 *
 * Safety & Data Honesty Guarantees:
 * - No JS eval() or Function() execution; linear-time deterministic tag scanner.
 * - Preserves UPC/GTIN strictly as string including leading zeros (e.g. "027242930698").
 * - Missing price => null (never 0); never reads prices from recommendations, ads, or reviews.
 * - Missing currency => null; never infers "USD" from a '$' symbol.
 * - Deduplicates organic + sponsored listings by itemId while preserving both in appearanceProvenance.
 * - Keeps product existence (FOUND) independent from stock state (OUT_OF_STOCK).
 */

import {
  MarketplacePresence,
  StockState,
  WalmartAppearanceProvenance,
  WalmartPdpProduct,
  WalmartQueryExecutionStatus,
  WalmartSchemaCompatibility,
  WalmartSearchListing,
  computeWalmartDeterministicHash,
} from "./walmartJinaTypes";
import { DEFAULT_WALMART_PILOT_LIMITS } from "./walmartJinaPolicy";
import {
  detectWalmartBotWallInContent,
  validateWalmartItemIdString,
} from "./walmartJinaReaderClient";

export interface ExtractedNextDataScriptResult {
  ok: boolean;
  queryStatus: WalmartQueryExecutionStatus;
  rawScriptText: string | null;
  parsedJson: Record<string, unknown> | null;
  byteLength: number;
  errorCode:
    | "EMPTY_HTML"
    | "BOT_OR_CAPTCHA_WALL"
    | "MISSING_NEXT_DATA_SCRIPT"
    | "UNCLOSED_NEXT_DATA_SCRIPT"
    | "NEXT_DATA_EXCEEDS_MAX_BYTES"
    | "INVALID_NEXT_DATA_JSON"
    | null;
  errorMessage: string | null;
}

function decodeMinimalHtmlEntitiesIfEscapedJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    return trimmed;
  }
  if (trimmed.startsWith("&quot;") || trimmed.includes("&quot;props&quot;")) {
    return trimmed
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  }
  return trimmed;
}

/**
 * Safely locates `<script id="__NEXT_DATA__" ...>` in HTML using a deterministic linear scanner,
 * enforces a byte-size cap, and parses the JSON payload without `eval`.
 */
export function extractNextDataScript(
  html: unknown,
  maxBytes: number = DEFAULT_WALMART_PILOT_LIMITS.maxNextDataBytes
): ExtractedNextDataScriptResult {
  if (typeof html !== "string" || !html.trim()) {
    return {
      ok: false,
      queryStatus: "PARSE_ERROR",
      rawScriptText: null,
      parsedJson: null,
      byteLength: 0,
      errorCode: "EMPTY_HTML",
      errorMessage: "HTML payload is empty or not a string.",
    };
  }

  const lowerHtml = html.toLowerCase();
  let searchPos = 0;
  let scriptBodyStart = -1;
  let scriptBodyEnd = -1;

  while (searchPos < lowerHtml.length) {
    const openIdx = lowerHtml.indexOf("<script", searchPos);
    if (openIdx === -1) break;

    const tagCloseIdx = lowerHtml.indexOf(">", openIdx + 7);
    if (tagCloseIdx === -1) break;

    const openTagHeader = html.slice(openIdx, tagCloseIdx + 1);
    const hasNextDataId =
      /\bid\s*=\s*(?:["']__NEXT_DATA__["']|__NEXT_DATA__)(?:\s|>|\/)/i.test(
        openTagHeader
      );

    if (hasNextDataId) {
      scriptBodyStart = tagCloseIdx + 1;
      scriptBodyEnd = lowerHtml.indexOf("</script", scriptBodyStart);
      break;
    }

    searchPos = tagCloseIdx + 1;
  }

  if (scriptBodyStart === -1) {
    // Check if HTML is a bot wall before returning missing __NEXT_DATA__
    const botCheck = detectWalmartBotWallInContent(html);
    if (botCheck.isBotWall) {
      return {
        ok: false,
        queryStatus: "BLOCKED_PROVIDER",
        rawScriptText: null,
        parsedJson: null,
        byteLength: 0,
        errorCode: "BOT_OR_CAPTCHA_WALL",
        errorMessage: `Walmart bot/human verification page detected instead of __NEXT_DATA__ (${botCheck.matchedSignal}).`,
      };
    }

    return {
      ok: false,
      queryStatus: "PARSE_ERROR",
      rawScriptText: null,
      parsedJson: null,
      byteLength: 0,
      errorCode: "MISSING_NEXT_DATA_SCRIPT",
      errorMessage: "HTML does not contain a <script id=\"__NEXT_DATA__\"> element.",
    };
  }

  if (scriptBodyEnd === -1) {
    return {
      ok: false,
      queryStatus: "PARSE_ERROR",
      rawScriptText: null,
      parsedJson: null,
      byteLength: 0,
      errorCode: "UNCLOSED_NEXT_DATA_SCRIPT",
      errorMessage: "<script id=\"__NEXT_DATA__\"> tag is not properly closed.",
    };
  }

  const rawInner = html.slice(scriptBodyStart, scriptBodyEnd);
  const byteLength = Buffer.byteLength(rawInner, "utf8");
  if (byteLength > maxBytes) {
    return {
      ok: false,
      queryStatus: "PARSE_ERROR",
      rawScriptText: null,
      parsedJson: null,
      byteLength,
      errorCode: "NEXT_DATA_EXCEEDS_MAX_BYTES",
      errorMessage: `script#__NEXT_DATA__ payload (${byteLength} bytes) exceeds limit (${maxBytes} bytes).`,
    };
  }

  const normalizedJsonText = decodeMinimalHtmlEntitiesIfEscapedJson(rawInner);
  try {
    const parsed = JSON.parse(normalizedJsonText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        queryStatus: "PARSE_ERROR",
        rawScriptText: rawInner,
        parsedJson: null,
        byteLength,
        errorCode: "INVALID_NEXT_DATA_JSON",
        errorMessage: "Parsed script#__NEXT_DATA__ root is not a JSON object.",
      };
    }
    return {
      ok: true,
      queryStatus: "SUCCEEDED",
      rawScriptText: rawInner,
      parsedJson: parsed as Record<string, unknown>,
      byteLength,
      errorCode: null,
      errorMessage: null,
    };
  } catch (err: any) {
    return {
      ok: false,
      queryStatus: "PARSE_ERROR",
      rawScriptText: rawInner,
      parsedJson: null,
      byteLength,
      errorCode: "INVALID_NEXT_DATA_JSON",
      errorMessage: `Failed to JSON.parse script#__NEXT_DATA__: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

export interface WalmartSchemaDiagnostic {
  compatibility: WalmartSchemaCompatibility;
  fieldPaths: string[];
  reason: string | null;
}

/**
 * Inspects parsed `__NEXT_DATA__` to determine whether it conforms to the observed baseline
 * Walmart US schema, an explicitly verified variant, or an unsupported/broken schema.
 */
export function inspectWalmartSchemaCompatibility(
  nextData: unknown,
  expectedKind?: "SEARCH" | "PDP"
): WalmartSchemaDiagnostic {
  if (!nextData || typeof nextData !== "object" || Array.isArray(nextData)) {
    return {
      compatibility: "UNSUPPORTED_SCHEMA",
      fieldPaths: [],
      reason: "__NEXT_DATA__ is null or not an object.",
    };
  }

  const root = nextData as Record<string, any>;
  const initialData = root?.props?.pageProps?.initialData;
  if (!initialData || typeof initialData !== "object") {
    return {
      compatibility: "UNSUPPORTED_SCHEMA",
      fieldPaths: [],
      reason: "Missing props.pageProps.initialData in __NEXT_DATA__.",
    };
  }

  const fieldPaths: string[] = ["props.pageProps.initialData"];

  // Check SEARCH schema
  const searchResult = initialData.searchResult;
  if (expectedKind === "SEARCH" || (!expectedKind && searchResult)) {
    if (searchResult && typeof searchResult === "object") {
      fieldPaths.push("props.pageProps.initialData.searchResult");
      if (Array.isArray(searchResult.itemStacks)) {
        fieldPaths.push("props.pageProps.initialData.searchResult.itemStacks");
        return {
          compatibility: "OBSERVED_BASELINE_SCHEMA",
          fieldPaths,
          reason: null,
        };
      }
      if (Array.isArray(searchResult.items)) {
        fieldPaths.push("props.pageProps.initialData.searchResult.items");
        return {
          compatibility: "SUPPORTED_VARIANT",
          fieldPaths,
          reason:
            "Using verified variant path props.pageProps.initialData.searchResult.items",
        };
      }
    }
    if (expectedKind === "SEARCH") {
      return {
        compatibility: "UNSUPPORTED_SCHEMA",
        fieldPaths,
        reason:
          "Missing props.pageProps.initialData.searchResult.itemStacks[] in search __NEXT_DATA__.",
      };
    }
  }

  // Check PDP schema
  const pdpDataProduct = initialData?.data?.product;
  const variantProduct = initialData?.product;

  if (pdpDataProduct && typeof pdpDataProduct === "object") {
    fieldPaths.push("props.pageProps.initialData.data.product");
    if (
      typeof pdpDataProduct.usItemId === "string" ||
      typeof pdpDataProduct.id === "string"
    ) {
      fieldPaths.push("props.pageProps.initialData.data.product.usItemId");
      return {
        compatibility: "OBSERVED_BASELINE_SCHEMA",
        fieldPaths,
        reason: null,
      };
    }
    return {
      compatibility: "UNSUPPORTED_SCHEMA",
      fieldPaths,
      reason:
        "props.pageProps.initialData.data.product is missing string usItemId.",
    };
  }

  if (variantProduct && typeof variantProduct === "object") {
    fieldPaths.push("props.pageProps.initialData.product");
    if (typeof variantProduct.usItemId === "string") {
      fieldPaths.push("props.pageProps.initialData.product.usItemId");
      return {
        compatibility: "SUPPORTED_VARIANT",
        fieldPaths,
        reason: "Using verified variant path props.pageProps.initialData.product",
      };
    }
  }

  return {
    compatibility: "UNSUPPORTED_SCHEMA",
    fieldPaths,
    reason:
      expectedKind === "PDP"
        ? "Missing or null props.pageProps.initialData.data.product in PDP __NEXT_DATA__."
        : "Neither searchResult.itemStacks nor data.product found in __NEXT_DATA__.",
  };
}

export interface WalmartPageIdentityCheckInput {
  finalUrl?: string | null;
  pageTitle?: string | null;
  html?: string | null;
  nextData?: Record<string, any> | null;
}

export interface WalmartPageIdentityAssertionResult {
  valid: boolean;
  queryStatus: WalmartQueryExecutionStatus;
  presenceIfInvalid: MarketplacePresence;
  observedQueryOrItemId: string | null;
  rejectionCode:
    | "BOT_OR_CAPTCHA_WALL"
    | "SIGNIN_OR_ACCOUNT_REDIRECT"
    | "NON_WALMART_US_FINAL_URL"
    | "SPONSORED_OR_CATEGORY_REDIRECT"
    | "WRONG_ROUTE_KIND"
    | "WRONG_SEARCH_QUERY"
    | "MISSING_SEARCH_QUERY_SIGNAL"
    | "PDP_ITEM_ID_MISMATCH"
    | "UNSUPPORTED_SCHEMA"
    | null;
  rejectionReason: string | null;
}

function normalizeQueryTokensForComparison(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function extractObservedSearchQueryFromNextData(
  nextData: Record<string, any> | null | undefined,
  finalUrl?: string | null
): string | null {
  if (nextData && typeof nextData === "object") {
    const queryFromRoot = nextData?.query?.q || nextData?.query?.query;
    if (typeof queryFromRoot === "string" && queryFromRoot.trim()) {
      return queryFromRoot.trim();
    }
    const sr = nextData?.props?.pageProps?.initialData?.searchResult;
    if (sr && typeof sr === "object") {
      for (const candidateField of [
        sr.query,
        sr.searchQuery,
        sr.originalQuery,
        sr.correctedQuery,
        sr.requestContext?.searchQuery,
        sr.title,
      ]) {
        if (typeof candidateField === "string" && candidateField.trim()) {
          return candidateField
            .replace(/^results\s+for\s+/i, "")
            .replace(/^["']|["']$/g, "")
            .trim();
        }
      }
    }
  }

  if (typeof finalUrl === "string" && finalUrl.trim()) {
    try {
      const u = new URL(finalUrl);
      const q = u.searchParams.get("q");
      if (q && q.trim()) return q.trim();
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Validates that a fetched Walmart page is genuinely a Walmart US SEARCH or PDP page
 * matching the requested search query or itemId.
 * - Detects robot wall, CAPTCHA, login redirects, sponsored redirects, category pages.
 * - For SEARCH: verifies the returned query inside `__NEXT_DATA__` matches `expectedQueryOrItemId`.
 *   An unrelated or wrong-query page returns `valid: false, presenceIfInvalid: "UNKNOWN"` (never `NO_MATCH_IN_SCOPE`).
 * - For PDP: verifies `usItemId` matches `expectedQueryOrItemId`.
 */
export function assertWalmartPageIdentity(
  page: WalmartPageIdentityCheckInput,
  expectedKind: "SEARCH" | "PDP",
  expectedQueryOrItemId: string
): WalmartPageIdentityAssertionResult {
  const botCheck = detectWalmartBotWallInContent(
    page.html,
    page.pageTitle,
    page.finalUrl
  );
  if (botCheck.isBotWall) {
    return {
      valid: false,
      queryStatus: "BLOCKED_PROVIDER",
      presenceIfInvalid: "UNKNOWN",
      observedQueryOrItemId: null,
      rejectionCode: "BOT_OR_CAPTCHA_WALL",
      rejectionReason: `Walmart anti-bot / human verification wall detected (${botCheck.matchedSignal}).`,
    };
  }

  if (typeof page.finalUrl === "string" && page.finalUrl.trim()) {
    let parsedFinal: URL;
    try {
      parsedFinal = new URL(page.finalUrl.trim());
    } catch {
      return {
        valid: false,
        queryStatus: "PARSE_ERROR",
        presenceIfInvalid: "UNKNOWN",
        observedQueryOrItemId: null,
        rejectionCode: "NON_WALMART_US_FINAL_URL",
        rejectionReason: `Malformed finalUrl '${page.finalUrl}'.`,
      };
    }

    const host = parsedFinal.hostname.toLowerCase();
    if (
      parsedFinal.protocol !== "https:" ||
      (host !== "www.walmart.com" && host !== "walmart.com")
    ) {
      return {
        valid: false,
        queryStatus: "BLOCKED_PROVIDER",
        presenceIfInvalid: "UNKNOWN",
        observedQueryOrItemId: null,
        rejectionCode: "NON_WALMART_US_FINAL_URL",
        rejectionReason: `Final URL redirected off Walmart US allowlist to '${parsedFinal.origin}'.`,
      };
    }

    const pathname = parsedFinal.pathname;
    if (/^\/(?:account|signin|login|blocked|captcha)(?:\/|$)/i.test(pathname)) {
      return {
        valid: false,
        queryStatus: "BLOCKED_PROVIDER",
        presenceIfInvalid: "UNKNOWN",
        observedQueryOrItemId: null,
        rejectionCode: "SIGNIN_OR_ACCOUNT_REDIRECT",
        rejectionReason: `Final URL redirected to sign-in or blocked path '${pathname}'.`,
      };
    }

    if (/^\/(?:cp|browse|shop|deals|sp\/track)(?:\/|$)/i.test(pathname)) {
      return {
        valid: false,
        queryStatus: "PARSE_ERROR",
        presenceIfInvalid: "UNKNOWN",
        observedQueryOrItemId: null,
        rejectionCode: "SPONSORED_OR_CATEGORY_REDIRECT",
        rejectionReason: `Final URL redirected to category or sponsored landing path '${pathname}' instead of ${expectedKind}.`,
      };
    }

    if (expectedKind === "SEARCH" && pathname !== "/search") {
      return {
        valid: false,
        queryStatus: "PARSE_ERROR",
        presenceIfInvalid: "UNKNOWN",
        observedQueryOrItemId: null,
        rejectionCode: "WRONG_ROUTE_KIND",
        rejectionReason: `Expected Walmart /search route, but finalUrl path was '${pathname}'.`,
      };
    }

    if (expectedKind === "PDP" && !pathname.startsWith("/ip/")) {
      return {
        valid: false,
        queryStatus: "PARSE_ERROR",
        presenceIfInvalid: "UNKNOWN",
        observedQueryOrItemId: null,
        rejectionCode: "WRONG_ROUTE_KIND",
        rejectionReason: `Expected Walmart /ip/{itemId} route, but finalUrl path was '${pathname}'.`,
      };
    }
  }

  const schemaCheck = inspectWalmartSchemaCompatibility(
    page.nextData,
    expectedKind
  );
  if (schemaCheck.compatibility === "UNSUPPORTED_SCHEMA") {
    return {
      valid: false,
      queryStatus: "PARSE_ERROR",
      presenceIfInvalid: "UNKNOWN",
      observedQueryOrItemId: null,
      rejectionCode: "UNSUPPORTED_SCHEMA",
      rejectionReason:
        schemaCheck.reason ||
        `Unsupported __NEXT_DATA__ schema for ${expectedKind}.`,
    };
  }

  if (expectedKind === "SEARCH") {
    const observedQuery = extractObservedSearchQueryFromNextData(
      page.nextData,
      page.finalUrl
    );
    if (!observedQuery) {
      return {
        valid: false,
        queryStatus: "PARSE_ERROR",
        presenceIfInvalid: "UNKNOWN",
        observedQueryOrItemId: null,
        rejectionCode: "MISSING_SEARCH_QUERY_SIGNAL",
        rejectionReason:
          "Search page __NEXT_DATA__ is missing observable search query confirmation.",
      };
    }

    const expectedTokens = normalizeQueryTokensForComparison(
      expectedQueryOrItemId
    );
    const observedTokens = new Set(
      normalizeQueryTokensForComparison(observedQuery)
    );
    const matchingTokenCount = expectedTokens.filter((t) =>
      observedTokens.has(t)
    ).length;
    const overlapRatio =
      expectedTokens.length > 0 ? matchingTokenCount / expectedTokens.length : 0;

    if (overlapRatio < 0.6) {
      return {
        valid: false,
        queryStatus: "PARSE_ERROR",
        presenceIfInvalid: "UNKNOWN",
        observedQueryOrItemId: observedQuery,
        rejectionCode: "WRONG_SEARCH_QUERY",
        rejectionReason: `Search page query '${observedQuery}' does not match requested query '${expectedQueryOrItemId}' (token overlap ${(
          overlapRatio * 100
        ).toFixed(0)}%).`,
      };
    }

    return {
      valid: true,
      queryStatus: "SUCCEEDED",
      presenceIfInvalid: "UNKNOWN",
      observedQueryOrItemId: observedQuery,
      rejectionCode: null,
      rejectionReason: null,
    };
  }

  // Expected PDP
  const idValidation = validateWalmartItemIdString(expectedQueryOrItemId);
  const root = page.nextData as Record<string, any>;
  const productObj =
    root?.props?.pageProps?.initialData?.data?.product ||
    root?.props?.pageProps?.initialData?.product;

  const rawUsItemId =
    typeof productObj?.usItemId === "string"
      ? productObj.usItemId.trim()
      : typeof productObj?.id === "string"
      ? productObj.id.trim()
      : null;

  if (!idValidation.valid || !rawUsItemId || rawUsItemId !== idValidation.itemId) {
    return {
      valid: false,
      queryStatus: "PARSE_ERROR",
      presenceIfInvalid: "UNKNOWN",
      observedQueryOrItemId: rawUsItemId,
      rejectionCode: "PDP_ITEM_ID_MISMATCH",
      rejectionReason: `PDP product.usItemId '${rawUsItemId || "null"}' does not match requested itemId '${expectedQueryOrItemId}'.`,
    };
  }

  return {
    valid: true,
    queryStatus: "SUCCEEDED",
    presenceIfInvalid: "UNKNOWN",
    observedQueryOrItemId: rawUsItemId,
    rejectionCode: null,
    rejectionReason: null,
  };
}

function normalizeExplicitCurrencyCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toUpperCase();
  // Explicitly reject currency symbols like "$" — require a 3-letter ISO 4217 code (e.g. "USD")
  if (/^[A-Z]{3}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function normalizePositivePrice(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return null;
  }
  if (raw <= 0) {
    return null;
  }
  return Math.round(raw * 100) / 100;
}

function normalizeStockState(rawStatus: unknown): StockState {
  if (typeof rawStatus !== "string") return "UNKNOWN";
  const upper = rawStatus.trim().toUpperCase();
  if (upper === "IN_STOCK" || upper === "AVAILABLE") {
    return "IN_STOCK";
  }
  if (
    upper === "OUT_OF_STOCK" ||
    upper === "OUT_OF_STOCK_ONLINE" ||
    upper === "UNAVAILABLE" ||
    upper === "NOT_AVAILABLE"
  ) {
    return "OUT_OF_STOCK";
  }
  return "UNKNOWN";
}

function normalizeUpcBarcodeString(rawUpc: unknown): string | null {
  // Strictly require a string from JSON so leading zeros (e.g. "027242930698") are never lost via JS Number coercion
  if (typeof rawUpc !== "string") {
    return null;
  }
  const trimmed = rawUpc.trim();
  if (!trimmed) return null;
  // Must be ASCII digits only (standard GTIN-8, UPC-12, EAN-13, GTIN-14)
  if (!/^[0-9]{8,14}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export interface WalmartSearchParseContext {
  expectedQuery: string;
  finalUrl?: string | null;
  pageTitle?: string | null;
}

export interface WalmartSearchParseResult {
  ok: boolean;
  queryStatus: WalmartQueryExecutionStatus;
  presence: MarketplacePresence;
  observedQuery: string | null;
  listings: WalmartSearchListing[];
  rawItemCount: number;
  dedupedItemCount: number;
  checkedStacksCount: number;
  completeSearchScope: boolean;
  schemaCompatibility: WalmartSchemaCompatibility;
  schemaFieldPaths: string[];
  errorCode: string | null;
  errorMessage: string | null;
}

/**
 * Parses Walmart search `__NEXT_DATA__` (`props.pageProps.initialData.searchResult.itemStacks[].items[]`).
 * - Verifies query identity before accepting results or empty state.
 * - Deduplicates listings by `itemId` while retaining both `ORGANIC` and `SPONSORED` in `appearanceProvenance`.
 * - Returns `presence: "NO_MATCH_IN_SCOPE"` ONLY when the search page is complete, query matches, and 0 matching product items exist.
 * - Returns `presence: "UNKNOWN"` on schema errors or query mismatches.
 */
export function parseWalmartSearchNextData(
  nextDataOrHtml: unknown,
  requestContext: WalmartSearchParseContext
): WalmartSearchParseResult {
  let nextData: unknown = nextDataOrHtml;
  if (typeof nextDataOrHtml === "string") {
    const extracted = extractNextDataScript(nextDataOrHtml);
    if (!extracted.ok || !extracted.parsedJson) {
      return {
        ok: false,
        queryStatus: extracted.queryStatus,
        presence: "UNKNOWN",
        observedQuery: null,
        listings: [],
        rawItemCount: 0,
        dedupedItemCount: 0,
        checkedStacksCount: 0,
        completeSearchScope: false,
        schemaCompatibility: "UNSUPPORTED_SCHEMA",
        schemaFieldPaths: [],
        errorCode: extracted.errorCode || "MISSING_NEXT_DATA_SCRIPT",
        errorMessage: extracted.errorMessage || "Failed to extract __NEXT_DATA__ from HTML.",
      };
    }
    nextData = extracted.parsedJson;
  }

  const schemaDiag = inspectWalmartSchemaCompatibility(nextData, "SEARCH");
  if (schemaDiag.compatibility === "UNSUPPORTED_SCHEMA") {
    return {
      ok: false,
      queryStatus: "PARSE_ERROR",
      presence: "UNKNOWN",
      observedQuery: null,
      listings: [],
      rawItemCount: 0,
      dedupedItemCount: 0,
      checkedStacksCount: 0,
      completeSearchScope: false,
      schemaCompatibility: "UNSUPPORTED_SCHEMA",
      schemaFieldPaths: schemaDiag.fieldPaths,
      errorCode: "UNSUPPORTED_SEARCH_SCHEMA",
      errorMessage:
        schemaDiag.reason || "Unsupported Walmart search __NEXT_DATA__ schema.",
    };
  }

  const root = nextData as Record<string, any>;
  const identityCheck = assertWalmartPageIdentity(
    {
      finalUrl: requestContext.finalUrl,
      pageTitle: requestContext.pageTitle,
      nextData: root,
    },
    "SEARCH",
    requestContext.expectedQuery
  );

  if (!identityCheck.valid) {
    return {
      ok: false,
      queryStatus: identityCheck.queryStatus,
      presence: "UNKNOWN",
      observedQuery: identityCheck.observedQueryOrItemId,
      listings: [],
      rawItemCount: 0,
      dedupedItemCount: 0,
      checkedStacksCount: 0,
      completeSearchScope: false,
      schemaCompatibility: schemaDiag.compatibility,
      schemaFieldPaths: schemaDiag.fieldPaths,
      errorCode: identityCheck.rejectionCode || "SEARCH_IDENTITY_REJECTED",
      errorMessage:
        identityCheck.rejectionReason ||
        "Search page identity verification failed.",
    };
  }

  const searchResult = root.props.pageProps.initialData.searchResult;
  const rawStacks: any[] = Array.isArray(searchResult.itemStacks)
    ? searchResult.itemStacks
    : Array.isArray(searchResult.items)
    ? [{ items: searchResult.items }]
    : [];

  let rawItemCount = 0;
  const byItemId = new Map<string, WalmartSearchListing>();
  let positionCounter = 0;

  for (const stack of rawStacks) {
    const items = Array.isArray(stack?.items) ? stack.items : [];
    for (const rawItem of items) {
      if (!rawItem || typeof rawItem !== "object") continue;

      // Skip non-product tiles (e.g. horizontal ad banners, facet prompts) unless they carry a valid usItemId and title
      const typename =
        typeof rawItem.__typename === "string" ? rawItem.__typename : "";
      if (
        typename &&
        typename !== "Product" &&
        typename !== "SponsoredProduct" &&
        !rawItem.usItemId
      ) {
        continue;
      }

      const rawId =
        typeof rawItem.usItemId === "string"
          ? rawItem.usItemId
          : typeof rawItem.id === "string"
          ? rawItem.id
          : null;
      const idCheck = validateWalmartItemIdString(rawId);
      if (!idCheck.valid || !idCheck.itemId) {
        continue;
      }

      const title =
        typeof rawItem.name === "string" && rawItem.name.trim()
          ? rawItem.name.trim()
          : typeof rawItem.title === "string" && rawItem.title.trim()
          ? rawItem.title.trim()
          : null;
      if (!title) continue;

      rawItemCount++;
      positionCounter++;

      const isSponsored = Boolean(
        rawItem.isSponsoredFlag === true ||
          rawItem.sponsoredProduct === true ||
          typename === "SponsoredProduct" ||
          (typeof rawItem.adUuid === "string" && rawItem.adUuid.trim().length > 0)
      );
      const appearance: WalmartAppearanceProvenance = isSponsored
        ? "SPONSORED"
        : "ORGANIC";

      const currentPriceObj = rawItem.priceInfo?.currentPrice;
      const price = normalizePositivePrice(
        currentPriceObj?.price ?? rawItem.price
      );
      const currency = normalizeExplicitCurrencyCode(
        currentPriceObj?.currencyUnit ??
          rawItem.priceInfo?.currencyCode ??
          rawItem.currencyUnit
      );

      const brand =
        typeof rawItem.brand === "string" && rawItem.brand.trim()
          ? rawItem.brand.trim()
          : null;
      const sellerName =
        typeof rawItem.sellerName === "string" && rawItem.sellerName.trim()
          ? rawItem.sellerName.trim()
          : null;
      const availability = normalizeStockState(
        rawItem.availabilityStatusV2?.value ??
          rawItem.availabilityStatusV2 ??
          rawItem.availabilityStatus
      );
      const rawCanonicalUrl =
        typeof rawItem.canonicalUrl === "string" && rawItem.canonicalUrl.trim()
          ? rawItem.canonicalUrl.trim()
          : null;
      const modelNumber =
        typeof rawItem.model === "string" && rawItem.model.trim()
          ? rawItem.model.trim()
          : null;
      const upc = normalizeUpcBarcodeString(rawItem.upc ?? rawItem.gtin);

      const existing = byItemId.get(idCheck.itemId);
      if (existing) {
        if (!existing.appearanceProvenance.includes(appearance)) {
          existing.appearanceProvenance.push(appearance);
        }
        // Keep organic flag if appeared organically at least once, but record both provenances
        existing.isSponsored =
          existing.appearanceProvenance.length === 1 &&
          existing.appearanceProvenance[0] === "SPONSORED";
        if (existing.price === null && price !== null) {
          existing.price = price;
        }
        if (existing.currency === null && currency !== null) {
          existing.currency = currency;
        }
        if (existing.brand === null && brand !== null) {
          existing.brand = brand;
        }
        if (existing.sellerName === null && sellerName !== null) {
          existing.sellerName = sellerName;
        }
        if (existing.upc === null && upc !== null) {
          existing.upc = upc;
        }
        if (existing.modelNumber === null && modelNumber !== null) {
          existing.modelNumber = modelNumber;
        }
      } else {
        const listing: WalmartSearchListing = {
          itemId: idCheck.itemId,
          usItemId: idCheck.itemId,
          title,
          brand,
          canonicalProductUrl: `https://www.walmart.com/ip/${idCheck.itemId}`,
          rawCanonicalUrl,
          price,
          currency,
          sellerName,
          availability,
          isSponsored,
          appearanceProvenance: [appearance],
          positionIndex: positionCounter - 1,
          modelNumber,
          upc,
          variantSummary:
            typeof rawItem.variantCriteria === "string"
              ? rawItem.variantCriteria
              : null,
          rawItemHash: computeWalmartDeterministicHash({
            usItemId: idCheck.itemId,
            title,
            price,
            currency,
            sellerName,
            appearance,
          }),
        };
        byItemId.set(idCheck.itemId, listing);
      }
    }
  }

  const listings = Array.from(byItemId.values());
  const completeSearchScope = rawStacks.length > 0 || searchResult.aggregatedCount === 0;
  const presence: MarketplacePresence =
    listings.length > 0
      ? "FOUND"
      : completeSearchScope
      ? "NO_MATCH_IN_SCOPE"
      : "UNKNOWN";

  return {
    ok: true,
    queryStatus: "SUCCEEDED",
    presence,
    observedQuery: identityCheck.observedQueryOrItemId,
    listings,
    rawItemCount,
    dedupedItemCount: listings.length,
    checkedStacksCount: rawStacks.length,
    completeSearchScope,
    schemaCompatibility: schemaDiag.compatibility,
    schemaFieldPaths: schemaDiag.fieldPaths,
    errorCode: null,
    errorMessage: null,
  };
}

export interface WalmartPdpParseContext {
  expectedItemId: string;
  finalUrl?: string | null;
  pageTitle?: string | null;
}

export interface WalmartPdpParseResult {
  ok: boolean;
  queryStatus: WalmartQueryExecutionStatus;
  presence: MarketplacePresence;
  product: WalmartPdpProduct | null;
  schemaCompatibility: WalmartSchemaCompatibility;
  schemaFieldPaths: string[];
  errorCode: string | null;
  errorMessage: string | null;
}

function detectConditionFromText(
  title: string,
  conditionRaw?: unknown
): "NEW" | "REFURBISHED" | "USED" | "UNKNOWN" {
  if (typeof conditionRaw === "string") {
    const u = conditionRaw.trim().toUpperCase();
    if (u.includes("REFURB") || u.includes("RESTORED") || u.includes("RENEWED")) {
      return "REFURBISHED";
    }
    if (u.includes("USED") || u.includes("PRE-OWNED") || u.includes("OPEN BOX")) {
      return "USED";
    }
    if (u === "NEW") return "NEW";
  }
  const lowerTitle = title.toLowerCase();
  if (
    /\b(?:refurbished|restored|renewed|reconditioned)\b/i.test(lowerTitle)
  ) {
    return "REFURBISHED";
  }
  if (/\b(?:pre-owned|used|open[\s-]box)\b/i.test(lowerTitle)) {
    return "USED";
  }
  return "NEW";
}

function extractPackSizeFromTitle(title: string): number | null {
  const m =
    title.match(/\b(\d+)\s*[-\s]?(?:pack|count|ct|pk|pcs|pieces)\b/i) ||
    title.match(/\bpack\s+of\s+(\d+)\b/i) ||
    title.match(/\bset\s+of\s+(\d+)\b/i);
  if (m && m[1]) {
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1 && n <= 1000) return n;
  }
  return null;
}

function detectAccessoryOrPartFromTitle(title: string): boolean {
  return /\b(?:replacement\s+(?:part|filter|brush|blade|head|battery|belt|bag|pad|cap|cord|charger|adapter)|carrying\s+case\s+for|protective\s+cover\s+for|silicone\s+case\s+for|screen\s+protector\s+for|wall\s+mount\s+for|compatible\s+with|fits\s+models?|refill\s+only|attachment\s+only)\b/i.test(
    title
  );
}

/**
 * Parses Walmart PDP `__NEXT_DATA__` (`props.pageProps.initialData.data.product`).
 * - Verifies `usItemId` equals `requestContext.expectedItemId`.
 * - Extracts price ONLY from `product.priceInfo.currentPrice.price` (never from recommendations, reviews, or secondary modules).
 * - Extracts currency ONLY from `product.priceInfo.currentPrice.currencyUnit` (never inferred from '$').
 * - Preserves `upc` as string including leading zeros (e.g. Sony `"027242930698"`).
 * - Extracts observed `location.postalCode` and `location.storeIds` without fabricating nationwide availability.
 * - Keeps `presence: "FOUND"` even when `availability === "OUT_OF_STOCK"`.
 */
export function parseWalmartPdpNextData(
  nextDataOrHtml: unknown,
  requestContext: WalmartPdpParseContext
): WalmartPdpParseResult {
  let nextData: unknown = nextDataOrHtml;
  if (typeof nextDataOrHtml === "string") {
    const extracted = extractNextDataScript(nextDataOrHtml);
    if (!extracted.ok || !extracted.parsedJson) {
      return {
        ok: false,
        queryStatus: extracted.queryStatus,
        presence: "UNKNOWN",
        product: null,
        schemaCompatibility: "UNSUPPORTED_SCHEMA",
        schemaFieldPaths: [],
        errorCode: extracted.errorCode || "MISSING_NEXT_DATA_SCRIPT",
        errorMessage: extracted.errorMessage || "Failed to extract __NEXT_DATA__ from HTML.",
      };
    }
    nextData = extracted.parsedJson;
  }

  const schemaDiag = inspectWalmartSchemaCompatibility(nextData, "PDP");
  if (schemaDiag.compatibility === "UNSUPPORTED_SCHEMA") {
    return {
      ok: false,
      queryStatus: "PARSE_ERROR",
      presence: "UNKNOWN",
      product: null,
      schemaCompatibility: "UNSUPPORTED_SCHEMA",
      schemaFieldPaths: schemaDiag.fieldPaths,
      errorCode: "UNSUPPORTED_PDP_SCHEMA",
      errorMessage:
        schemaDiag.reason || "Unsupported Walmart PDP __NEXT_DATA__ schema.",
    };
  }

  const root = nextData as Record<string, any>;
  const identityCheck = assertWalmartPageIdentity(
    {
      finalUrl: requestContext.finalUrl,
      pageTitle: requestContext.pageTitle,
      nextData: root,
    },
    "PDP",
    requestContext.expectedItemId
  );

  if (!identityCheck.valid) {
    return {
      ok: false,
      queryStatus: identityCheck.queryStatus,
      presence: "UNKNOWN",
      product: null,
      schemaCompatibility: schemaDiag.compatibility,
      schemaFieldPaths: schemaDiag.fieldPaths,
      errorCode: identityCheck.rejectionCode || "PDP_IDENTITY_REJECTED",
      errorMessage:
        identityCheck.rejectionReason || "PDP identity verification failed.",
    };
  }

  const initialData = root.props.pageProps.initialData;
  const rawProduct = initialData?.data?.product || initialData?.product;
  const usItemId = String(rawProduct.usItemId || rawProduct.id).trim();

  const title =
    typeof rawProduct.name === "string" && rawProduct.name.trim()
      ? rawProduct.name.trim()
      : null;

  if (!title) {
    return {
      ok: false,
      queryStatus: "PARSE_ERROR",
      presence: "UNKNOWN",
      product: null,
      schemaCompatibility: schemaDiag.compatibility,
      schemaFieldPaths: schemaDiag.fieldPaths,
      errorCode: "PDP_MISSING_PRODUCT_NAME",
      errorMessage: "Walmart PDP product object is missing 'name'.",
    };
  }

  const fieldPaths = [...schemaDiag.fieldPaths, "props.pageProps.initialData.data.product.name"];

  const brand =
    typeof rawProduct.brand === "string" && rawProduct.brand.trim()
      ? rawProduct.brand.trim()
      : null;
  if (brand) fieldPaths.push("props.pageProps.initialData.data.product.brand");

  const model =
    typeof rawProduct.model === "string" && rawProduct.model.trim()
      ? rawProduct.model.trim()
      : typeof rawProduct.manufacturerProductId === "string" &&
        rawProduct.manufacturerProductId.trim()
      ? rawProduct.manufacturerProductId.trim()
      : null;
  if (model) fieldPaths.push("props.pageProps.initialData.data.product.model");

  const upc = normalizeUpcBarcodeString(rawProduct.upc);
  const gtin = normalizeUpcBarcodeString(rawProduct.gtin ?? rawProduct.upc);
  if (upc) fieldPaths.push("props.pageProps.initialData.data.product.upc");

  // Strictly read ONLY primary product.priceInfo.currentPrice — never recommendations, reviews, or related items
  const currentPriceObj = rawProduct.priceInfo?.currentPrice;
  const price = normalizePositivePrice(currentPriceObj?.price);
  const currency = normalizeExplicitCurrencyCode(currentPriceObj?.currencyUnit);
  if (price !== null) {
    fieldPaths.push(
      "props.pageProps.initialData.data.product.priceInfo.currentPrice.price"
    );
  }
  if (currency !== null) {
    fieldPaths.push(
      "props.pageProps.initialData.data.product.priceInfo.currentPrice.currencyUnit"
    );
  }

  const sellerDisplayName =
    typeof rawProduct.sellerDisplayName === "string" &&
    rawProduct.sellerDisplayName.trim()
      ? rawProduct.sellerDisplayName.trim()
      : typeof rawProduct.sellerName === "string" && rawProduct.sellerName.trim()
      ? rawProduct.sellerName.trim()
      : null;
  if (sellerDisplayName) {
    fieldPaths.push(
      "props.pageProps.initialData.data.product.sellerDisplayName"
    );
  }

  const rawAvailV2 =
    typeof rawProduct.availabilityStatusV2?.value === "string"
      ? rawProduct.availabilityStatusV2.value.trim()
      : typeof rawProduct.availabilityStatusV2 === "string"
      ? rawProduct.availabilityStatusV2.trim()
      : typeof rawProduct.availabilityStatus === "string"
      ? rawProduct.availabilityStatus.trim()
      : null;
  const availability = normalizeStockState(rawAvailV2);
  if (rawAvailV2) {
    fieldPaths.push(
      "props.pageProps.initialData.data.product.availabilityStatusV2"
    );
  }

  const rawCanonicalUrl =
    typeof rawProduct.canonicalUrl === "string" && rawProduct.canonicalUrl.trim()
      ? rawProduct.canonicalUrl.trim()
      : null;

  // Location extraction from product.location (observed baseline path)
  const locObj = rawProduct.location || initialData?.data?.location || null;
  const locationPostalCode =
    locObj &&
    typeof locObj.postalCode === "string" &&
    /^[0-9]{5}(?:-[0-9]{4})?$/.test(locObj.postalCode.trim())
      ? locObj.postalCode.trim()
      : null;

  const locationStoreIds: string[] = [];
  if (locObj && Array.isArray(locObj.storeIds)) {
    for (const sid of locObj.storeIds) {
      const sStr =
        typeof sid === "string" || typeof sid === "number"
          ? String(sid).trim()
          : "";
      if (/^[0-9]{1,8}$/.test(sStr) && !locationStoreIds.includes(sStr)) {
        locationStoreIds.push(sStr);
      }
    }
  } else if (
    locObj &&
    (typeof locObj.storeId === "string" || typeof locObj.storeId === "number")
  ) {
    const sStr = String(locObj.storeId).trim();
    if (/^[0-9]{1,8}$/.test(sStr)) {
      locationStoreIds.push(sStr);
    }
  }

  if (locationPostalCode) {
    fieldPaths.push("props.pageProps.initialData.data.product.location.postalCode");
  }
  if (locationStoreIds.length > 0) {
    fieldPaths.push("props.pageProps.initialData.data.product.location.storeIds");
  }

  const locationCityOrState =
    locObj &&
    (typeof locObj.city === "string" || typeof locObj.stateOrProvinceCode === "string")
      ? [locObj.city, locObj.stateOrProvinceCode].filter(Boolean).join(", ") || null
      : null;

  const variantAttributes: Record<string, string> = {};
  if (Array.isArray(rawProduct.selectedVariantIds) || Array.isArray(rawProduct.variantsMap)) {
    // Optional structured variant map
  }
  if (
    rawProduct.variantCriteria &&
    Array.isArray(rawProduct.variantCriteria)
  ) {
    for (const vc of rawProduct.variantCriteria) {
      if (vc && typeof vc.name === "string" && typeof vc.selectedValue === "string") {
        variantAttributes[vc.name.trim().toLowerCase()] = vc.selectedValue.trim();
      }
    }
  }

  const condition = detectConditionFromText(
    title,
    rawProduct.condition ?? rawProduct.conditionType
  );
  const packSizeCount =
    typeof rawProduct.multipackQuantity === "number" &&
    rawProduct.multipackQuantity >= 1
      ? rawProduct.multipackQuantity
      : extractPackSizeFromTitle(title);

  const isAccessoryOrPart = detectAccessoryOrPartFromTitle(title);

  const pdpProduct: WalmartPdpProduct = {
    itemId: usItemId,
    usItemId,
    title,
    brand,
    model,
    upc: upc || gtin,
    gtin: gtin || upc,
    price,
    currency,
    sellerDisplayName,
    availabilityStatusV2: rawAvailV2,
    availability,
    canonicalUrl: `https://www.walmart.com/ip/${usItemId}`,
    rawCanonicalUrl,
    locationPostalCode,
    locationStoreIds,
    locationCityOrState,
    variantAttributes,
    condition,
    packSizeCount,
    isAccessoryOrPart,
    schemaCompatibility: schemaDiag.compatibility,
    schemaFieldPaths: fieldPaths,
    rawProductHash: computeWalmartDeterministicHash({
      usItemId,
      title,
      brand,
      model,
      upc: upc || gtin,
      price,
      currency,
      sellerDisplayName,
      availability,
      locationPostalCode,
      locationStoreIds,
    }),
  };

  return {
    ok: true,
    queryStatus: "SUCCEEDED",
    presence: "FOUND",
    product: pdpProduct,
    schemaCompatibility: schemaDiag.compatibility,
    schemaFieldPaths: fieldPaths,
    errorCode: null,
    errorMessage: null,
  };
}
