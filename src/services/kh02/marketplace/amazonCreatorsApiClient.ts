/**
 * SWAI KH-02 V12.4.3.5.0.3 — Official Amazon Associates Creators API Client (US Marketplace)
 *
 * Implements Official Amazon Creators API v1 Contracts:
 * - resolveCreatorsApiEligibility(env, registrationStatus): AmazonAccessDecision
 * - createCreatorsApiClient(config): CreatorsApiClient
 * - buildCreatorsSearchItemsPayload(intent, cfg)
 * - buildCreatorsGetItemsPayload(asins, cfg)
 * - parseCreatorsSearchItemsEnvelope(parsedJson, options)
 * - parseCreatorsGetItemsEnvelope(parsedJson, requestedAsins, options)
 * - normalizeCreatorsApiItemShape(rawItem, options)
 * - searchItemsByCandidateIntent(intent, context): Promise<SearchItemsResponse>
 * - getItemsByAsins(asins, context): Promise<GetItemsResponse>
 * - classifyCreatorsApiFailure(error, response): ClassifiedCreatorsApiStatus
 *
 * Hard Compliance Boundaries:
 * - Uses ONLY official Amazon Associates Creators API endpoints:
 *   - OAuth 2.0 token endpoint (3.1 NA default): https://api.amazon.com/auth/o2/token
 *   - OAuth 2.0 token endpoint (3.2 EU): https://api.amazon.co.uk/auth/o2/token
 *   - OAuth 2.0 token endpoint (3.3 FE): https://api.amazon.co.jp/auth/o2/token
 *   - SearchItems endpoint: https://creatorsapi.amazon/catalog/v1/searchItems
 *   - GetItems endpoint: https://creatorsapi.amazon/catalog/v1/getItems
 * - OAuth 2.0 request uses Content-Type: application/json with grant_type=client_credentials
 *   and scope="creatorsapi::default".
 * - Marketplace header & payload field: www.amazon.com
 * - Never writes credentials or bearer tokens to logs, telemetry, or returned objects.
 * - Never treats the mere presence of env vars as verified authentication or live success.
 */

import {
  AmazonAccessPolicyStatus,
  MarketplaceEvidenceStatus,
  computeDeterministicEvidenceHash,
} from "./marketplaceEvidenceTypes";
import { isValidStrictAmazonAsin } from "./amazonUsIdentity";
import { AmazonProviderBudget } from "./amazonUsBudget";

export const OFFICIAL_CREATORS_API_DOCS_VERIFIED = [
  "https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction",
  "https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-curl",
  "https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/search-items",
  "https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/get-items",
  "https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference",
  "https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-sdk",
  "https://affiliate-program.amazon.com/help/operating/policies",
] as const;

export const CREATORS_API_OAUTH_TOKEN_ENDPOINT_NA = "https://api.amazon.com/auth/o2/token";
export const CREATORS_API_OAUTH_TOKEN_ENDPOINT_EU = "https://api.amazon.co.uk/auth/o2/token";
export const CREATORS_API_OAUTH_TOKEN_ENDPOINT_FE = "https://api.amazon.co.jp/auth/o2/token";
export const CREATORS_API_OAUTH_TOKEN_ENDPOINT = CREATORS_API_OAUTH_TOKEN_ENDPOINT_NA;

export const CREATORS_API_OAUTH_SCOPE = "creatorsapi::default";
export const CREATORS_API_DEFAULT_CREDENTIAL_VERSION = "3.1";

export const CREATORS_API_SEARCH_ITEMS_ENDPOINT =
  "https://creatorsapi.amazon/catalog/v1/searchItems";
export const CREATORS_API_GET_ITEMS_ENDPOINT =
  "https://creatorsapi.amazon/catalog/v1/getItems";
export const CREATORS_API_US_MARKETPLACE = "www.amazon.com";

/**
 * Official lower-camel Amazon Creators API v1 resource names for SearchItems and GetItems.
 */
export const CREATORS_API_DEFAULT_RESOURCES = [
  "images.primary.medium",
  "itemInfo.title",
  "itemInfo.byLineInfo",
  "itemInfo.classifications",
  "itemInfo.externalIds",
  "itemInfo.features",
  "itemInfo.manufactureInfo",
  "itemInfo.productInfo",
  "offersV2.listings.availability",
  "offersV2.listings.condition",
  "offersV2.listings.isBuyBoxWinner",
  "offersV2.listings.merchantInfo",
  "offersV2.listings.price",
  "parentASIN",
] as const;

export type CreatorsApiCredentialVersion = "3.1" | "3.2" | "3.3";

export interface CreatorsApiRegistrationStatus {
  accountApproved?: boolean;
  marketplace?: string;
  transportVerified?: boolean;
  authenticated?: boolean;
  querySucceeded?: boolean;
  imageDisplayLicenseVerified?: boolean;
}

export interface AmazonAccessDecision {
  featureEnabled: boolean;
  liveAllowed: boolean;
  configured: boolean;
  hasCredentialId: boolean;
  hasCredentialSecret: boolean;
  hasPartnerTag: boolean;
  partnerTagMasked: string | null;
  credentialVersion: CreatorsApiCredentialVersion;
  tokenEndpoint: string;
  registeredMarketplace: string;
  transportVerified: boolean;
  authenticated: boolean;
  querySucceeded: boolean;
  eligibleForLiveRequests: boolean;
  imageDisplayLicenseVerified: boolean;
  status: MarketplaceEvidenceStatus;
  accessPolicyStatus: AmazonAccessPolicyStatus;
  permittedAccessRoute:
    | "OFFICIAL_CREATORS_API"
    | "USER_AUTHORIZED_URL"
    | "ISOLATED_FIXTURE_ONLY"
    | "NONE";
  reason: string;
  setupChecklist: string[];
  officialDocsChecked: readonly string[];
}

export interface CreatorsApiClientConfig {
  credentialId: string;
  credentialSecret: string;
  partnerTag: string;
  credentialVersion?: CreatorsApiCredentialVersion | string;
  marketplace?: string;
  tokenEndpoint?: string;
  searchItemsEndpoint?: string;
  getItemsEndpoint?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  allowIsolatedTestHost?: boolean;
  isIsolatedTestTransport?: boolean;
  allowLegacyPaApiShape?: boolean;
}

/**
 * Official lower-camel Amazon Creators API item representation (with optional legacy PA-API fields
 * kept on the TypeScript interface only for explicit legacy compatibility adapter tests).
 */
export interface RawCreatorsApiItem {
  asin?: string;
  parentASIN?: string;
  detailPageURL?: string;
  itemInfo?: {
    title?: { displayValue?: string; label?: string; locale?: string };
    byLineInfo?: {
      brand?: { displayValue?: string; label?: string; locale?: string };
      manufacturer?: { displayValue?: string; label?: string; locale?: string };
    };
    manufactureInfo?: {
      model?: { displayValue?: string; label?: string; locale?: string };
      itemPartNumber?: { displayValue?: string; label?: string; locale?: string };
    };
    externalIds?: {
      upcs?: { displayValues?: string[]; label?: string; locale?: string };
      eans?: { displayValues?: string[]; label?: string; locale?: string };
      isbns?: { displayValues?: string[]; label?: string; locale?: string };
    };
    classifications?: {
      binding?: { displayValue?: string };
      productGroup?: { displayValue?: string };
    };
    features?: { displayValues?: string[]; label?: string; locale?: string };
  };
  images?: {
    primary?: {
      medium?: { url?: string; width?: number; height?: number };
    };
  };
  offersV2?: {
    listings?: Array<{
      id?: string;
      isBuyBoxWinner?: boolean;
      price?: {
        amount?: number;
        currency?: string;
        displayAmount?: string;
      };
      availability?: {
        message?: string;
        type?: string;
        maxOrderQuantity?: number;
        minOrderQuantity?: number;
      };
      merchantInfo?: {
        id?: string;
        name?: string;
      };
      condition?: {
        value?: string;
      };
    }>;
  };
  // Legacy PA-API uppercase properties (ignored unless allowLegacyPaApiShape === true)
  ASIN?: string;
  ParentASIN?: string;
  DetailPageURL?: string;
  ItemInfo?: {
    Title?: { DisplayValue?: string };
    ByLineInfo?: {
      Brand?: { DisplayValue?: string };
      Manufacturer?: { DisplayValue?: string };
    };
    ManufactureInfo?: {
      Model?: { DisplayValue?: string };
      ItemPartNumber?: { DisplayValue?: string };
    };
    ExternalIds?: {
      UPCs?: { DisplayValues?: string[] };
      EANs?: { DisplayValues?: string[] };
      ISBNs?: { DisplayValues?: string[] };
    };
    Features?: { DisplayValues?: string[] };
  };
  Images?: {
    Primary?: {
      Medium?: { URL?: string; Width?: number; Height?: number };
    };
  };
  Offers?: {
    V2?: {
      Listings?: Array<{
        Price?: {
          Amount?: number;
          Currency?: string;
          DisplayAmount?: string;
        };
        Availability?: {
          Message?: string;
          Type?: string;
        };
        MerchantInfo?: {
          Name?: string;
          Id?: string;
        };
      }>;
    };
    Listings?: Array<{
      Price?: {
        Amount?: number;
        Currency?: string;
        DisplayAmount?: string;
      };
      Availability?: {
        Message?: string;
        Type?: string;
      };
      MerchantInfo?: {
        Name?: string;
        Id?: string;
      };
    }>;
  };
}

export interface CreatorsApiPartialError {
  code: string;
  message: string;
  itemId?: string | null;
}

export interface CreatorsApiSearchIntentInput {
  candidateId: string;
  normalizedKeywords: string;
  brand?: string | null;
  model?: string | null;
  itemCount?: number;
  searchIndex?: string;
}

export interface CreatorsApiRequestContext {
  workspaceId: string;
  researchRunId: string;
  candidateId: string;
  budget?: AmazonProviderBudget;
  signal?: AbortSignal;
}

export interface SearchItemsResponse {
  attempted: boolean;
  succeeded: boolean;
  status: MarketplaceEvidenceStatus;
  httpStatus: number | null;
  httpStatusOrigin: "OBSERVED" | "UNOBSERVED_NULL";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  providerInvocationRef: string;
  upstreamRequestId: string | null;
  requestHash: string;
  rawResponseHash: string | null;
  requestedKeywords: string;
  marketplace: string;
  totalResultCount: number | null;
  items: RawCreatorsApiItem[];
  partialErrors?: CreatorsApiPartialError[];
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
}

export interface GetItemsResponse {
  attempted: boolean;
  succeeded: boolean;
  status: MarketplaceEvidenceStatus;
  httpStatus: number | null;
  httpStatusOrigin: "OBSERVED" | "UNOBSERVED_NULL";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  providerInvocationRef: string;
  upstreamRequestId: string | null;
  requestHash: string;
  rawResponseHash: string | null;
  requestedAsins: string[];
  marketplace: string;
  items: RawCreatorsApiItem[];
  itemsByAsin?: Record<string, RawCreatorsApiItem>;
  missingAsins?: string[];
  partialErrors?: CreatorsApiPartialError[];
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
}

export interface ClassifiedCreatorsApiStatus {
  status: MarketplaceEvidenceStatus;
  errorCode: string;
  retryable: boolean;
  isEntitlementOrAuthError: boolean;
  sanitizedMessage: string;
}

export interface CreatorsApiTokenTelemetrySummary {
  tokenRequestsAttempted: number;
  tokenRequestsSucceeded: number;
  tokenCacheHits: number;
  concurrentDeduplicationsCount: number;
  tokenRefreshesOn401Count: number;
  lastTokenHttpStatus: number | null;
  lastTokenErrorCode: string | null;
}

export interface CreatorsApiClient {
  readonly marketplace: string;
  readonly partnerTagMasked: string;
  readonly credentialVersion?: CreatorsApiCredentialVersion;
  readonly isIsolatedTestTransport?: boolean;
  readonly transportProvenance?: "OFFICIAL_UPSTREAM" | "TEST_FIXTURE";
  searchItemsByCandidateIntent(
    intent: CreatorsApiSearchIntentInput,
    context: CreatorsApiRequestContext
  ): Promise<SearchItemsResponse>;
  getItemsByAsins(
    asins: string[],
    context: CreatorsApiRequestContext
  ): Promise<GetItemsResponse>;
  getTokenTelemetrySummary?(): CreatorsApiTokenTelemetrySummary;
}

function maskPartnerTag(tag: string | null | undefined): string | null {
  if (!tag || !tag.trim()) return null;
  const clean = tag.trim();
  if (clean.length <= 4) return "***";
  return `${clean.slice(0, 2)}***${clean.slice(-3)}`;
}

export function redactSecretsFromMessage(
  rawMessage: string,
  secrets: Array<string | undefined | null>
): string {
  let msg = String(rawMessage || "");
  for (const s of secrets) {
    if (s && s.trim().length >= 4) {
      const escaped = s.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      msg = msg.replace(new RegExp(escaped, "g"), "[REDACTED_SECRET]");
    }
  }
  msg = msg.replace(/Bearer\s+[A-Za-z0-9._~+/=|-]+/gi, "Bearer [REDACTED_TOKEN]");
  msg = msg.replace(/client_secret=[^&\s"]+/gi, "client_secret=[REDACTED_SECRET]");
  msg = msg.replace(/"client_secret"\s*:\s*"[^"]*"/gi, '"client_secret":"[REDACTED_SECRET]"');
  msg = msg.replace(/"access_token"\s*:\s*"[^"]*"/gi, '"access_token":"[REDACTED_TOKEN]"');
  return msg.slice(0, 400);
}

export function resolveCreatorsApiCredentialVersion(
  rawVersion?: string | null
): CreatorsApiCredentialVersion {
  const clean = String(rawVersion || CREATORS_API_DEFAULT_CREDENTIAL_VERSION).trim();
  if (clean === "3.2") return "3.2";
  if (clean === "3.3") return "3.3";
  return "3.1";
}

export function resolveCreatorsApiTokenEndpointByVersion(
  version: CreatorsApiCredentialVersion = "3.1"
): string {
  switch (version) {
    case "3.2":
      return CREATORS_API_OAUTH_TOKEN_ENDPOINT_EU;
    case "3.3":
      return CREATORS_API_OAUTH_TOKEN_ENDPOINT_FE;
    case "3.1":
    default:
      return CREATORS_API_OAUTH_TOKEN_ENDPOINT_NA;
  }
}

const OFFICIAL_ALLOWED_AMAZON_API_HOSTS = new Set([
  "api.amazon.com",
  "api.amazon.co.uk",
  "api.amazon.co.jp",
  "creatorsapi.amazon",
]);

export function isLocalhostEndpointUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

export function validateCreatorsApiEndpointUrl(
  rawUrl: string,
  options?: { allowIsolatedTestHost?: boolean }
): { valid: boolean; isLocalhost: boolean; reason: string | null } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      valid: false,
      isLocalhost: false,
      reason: `Invalid endpoint URL '${rawUrl}'.`,
    };
  }

  const host = parsed.hostname.toLowerCase();
  const isLocalhost = host === "127.0.0.1" || host === "localhost";

  if (isLocalhost) {
    if (
      options?.allowIsolatedTestHost &&
      (parsed.protocol === "http:" || parsed.protocol === "https:")
    ) {
      return { valid: true, isLocalhost: true, reason: null };
    }
    return {
      valid: false,
      isLocalhost: true,
      reason:
        "Localhost Creators API endpoint requires explicit allowIsolatedTestHost=true in isolated test mode.",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      valid: false,
      isLocalhost: false,
      reason: `CreatorsApiClient endpoints must use HTTPS (received '${parsed.protocol}').`,
    };
  }

  if (!OFFICIAL_ALLOWED_AMAZON_API_HOSTS.has(host)) {
    return {
      valid: false,
      isLocalhost: false,
      reason: `Untrusted CreatorsApiClient endpoint host '${host}'. Only official Amazon API hosts are permitted.`,
    };
  }

  return { valid: true, isLocalhost: false, reason: null };
}

/**
 * Pure request payload builder for official Amazon Creators API v1 SearchItems.
 */
export function buildCreatorsSearchItemsPayload(
  intent: CreatorsApiSearchIntentInput,
  cfg: {
    partnerTag: string;
    marketplace?: string;
    resources?: readonly string[];
  }
): {
  keywords: string;
  marketplace: string;
  partnerTag: string;
  partnerType: "Associates";
  searchIndex: string;
  itemCount: number;
  resources: string[];
  currencyOfPreference: "USD";
  languagesOfPreference: ["en_US"];
  brand?: string;
} {
  const rawWords = String(intent.normalizedKeywords || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 7);
  let cleanKeywords = rawWords.join(" ");
  if (cleanKeywords.length > 60) {
    cleanKeywords = cleanKeywords.slice(0, 60).trim();
  }
  const itemCount = Math.min(10, Math.max(1, Math.floor(intent.itemCount ?? 5)));
  const marketplace = String(cfg.marketplace || CREATORS_API_US_MARKETPLACE)
    .trim()
    .toLowerCase();
  const partnerTag = String(cfg.partnerTag || "").trim();
  const cleanBrand =
    typeof intent.brand === "string" && intent.brand.trim().length > 0
      ? intent.brand.trim()
      : undefined;

  return {
    keywords: cleanKeywords,
    marketplace,
    partnerTag,
    partnerType: "Associates",
    searchIndex: intent.searchIndex || "All",
    itemCount,
    resources: [...(cfg.resources || CREATORS_API_DEFAULT_RESOURCES)],
    currencyOfPreference: "USD",
    languagesOfPreference: ["en_US"],
    ...(cleanBrand ? { brand: cleanBrand } : {}),
  };
}

/**
 * Pure request payload builder for official Amazon Creators API v1 GetItems.
 */
export function buildCreatorsGetItemsPayload(
  asins: string[],
  cfg: {
    partnerTag: string;
    marketplace?: string;
    resources?: readonly string[];
  }
): {
  itemIds: string[];
  itemIdType: "ASIN";
  marketplace: string;
  partnerTag: string;
  partnerType: "Associates";
  resources: string[];
  currencyOfPreference: "USD";
  languagesOfPreference: ["en_US"];
} {
  const validAsins = Array.from(
    new Set(
      (asins || [])
        .map((a) => String(a || "").trim().toUpperCase())
        .filter((a) => isValidStrictAmazonAsin(a))
    )
  ).slice(0, 10);
  const marketplace = String(cfg.marketplace || CREATORS_API_US_MARKETPLACE)
    .trim()
    .toLowerCase();
  const partnerTag = String(cfg.partnerTag || "").trim();

  return {
    itemIds: validAsins,
    itemIdType: "ASIN",
    marketplace,
    partnerTag,
    partnerType: "Associates",
    resources: [...(cfg.resources || CREATORS_API_DEFAULT_RESOURCES)],
    currencyOfPreference: "USD",
    languagesOfPreference: ["en_US"],
  };
}

function extractPartialErrorsFromEnvelope(parsed: any): CreatorsApiPartialError[] {
  const rawErrors = Array.isArray(parsed?.errors)
    ? parsed.errors
    : Array.isArray(parsed?.Errors)
    ? parsed.Errors
    : [];
  const out: CreatorsApiPartialError[] = [];
  for (const e of rawErrors) {
    if (!e || typeof e !== "object") continue;
    const code = String(e.code || e.Code || "UNKNOWN_ERROR").trim();
    const message = String(e.message || e.Message || "").trim();
    const itemIdMatch = message.match(/\b([A-Z0-9]{10})\b/);
    out.push({
      code,
      message,
      itemId: itemIdMatch ? itemIdMatch[1] : null,
    });
  }
  return out;
}

export interface ParsedSearchItemsEnvelope {
  valid: boolean;
  status: MarketplaceEvidenceStatus;
  items: RawCreatorsApiItem[];
  totalResultCount: number | null;
  partialErrors: CreatorsApiPartialError[];
  errorCode: string | null;
  errorMessage: string | null;
  schemaOrigin:
    | "OFFICIAL_LOWER_CAMEL"
    | "OFFICIAL_ERROR_ENVELOPE"
    | "LEGACY_PAAPI_COMPAT"
    | "INVALID";
}

/**
 * Pure parser for official Amazon Creators API v1 SearchItems response envelope.
 * Rejects wrong top-level schemas (including uppercase PA-API `SearchResult.Items` unless
 * `allowLegacyPaApiShape: true` is explicitly passed) with `SCHEMA_MISMATCH` rather than
 * silently returning `QUERY_SUCCEEDED_EMPTY`.
 */
export function parseCreatorsSearchItemsEnvelope(
  parsedJson: unknown,
  options?: { allowLegacyPaApiShape?: boolean }
): ParsedSearchItemsEnvelope {
  if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
    return {
      valid: false,
      status: "PROVIDER_ERROR",
      items: [],
      totalResultCount: null,
      partialErrors: [],
      errorCode: "PARSE_FAILED",
      errorMessage: "PARSE_FAILED: SearchItems HTTP 200 body is not a JSON object.",
      schemaOrigin: "INVALID",
    };
  }

  const obj = parsedJson as Record<string, any>;
  const partialErrors = extractPartialErrorsFromEnvelope(obj);

  if (obj.searchResult && typeof obj.searchResult === "object") {
    if (!Array.isArray(obj.searchResult.items)) {
      return {
        valid: false,
        status: "PROVIDER_ERROR",
        items: [],
        totalResultCount: null,
        partialErrors,
        errorCode: "SCHEMA_MISMATCH",
        errorMessage:
          "SCHEMA_MISMATCH: searchResult object is missing lower-camel 'items' array.",
        schemaOrigin: "INVALID",
      };
    }

    const items: RawCreatorsApiItem[] = obj.searchResult.items;
    const totalResultCount =
      typeof obj.searchResult.totalResultCount === "number" &&
      Number.isFinite(obj.searchResult.totalResultCount)
        ? obj.searchResult.totalResultCount
        : items.length;

    if (items.length === 0) {
      return {
        valid: true,
        status: "QUERY_SUCCEEDED_EMPTY",
        items: [],
        totalResultCount: 0,
        partialErrors,
        errorCode: null,
        errorMessage: null,
        schemaOrigin: "OFFICIAL_LOWER_CAMEL",
      };
    }

    return {
      valid: true,
      status: "OBSERVED_UNVERIFIED",
      items,
      totalResultCount,
      partialErrors,
      errorCode: null,
      errorMessage: null,
      schemaOrigin: "OFFICIAL_LOWER_CAMEL",
    };
  }

  if (
    partialErrors.length > 0 &&
    partialErrors.some((e) => /^NoResults$/i.test(e.code))
  ) {
    return {
      valid: true,
      status: "QUERY_SUCCEEDED_EMPTY",
      items: [],
      totalResultCount: 0,
      partialErrors,
      errorCode: "NoResults",
      errorMessage: null,
      schemaOrigin: "OFFICIAL_ERROR_ENVELOPE",
    };
  }

  if (
    options?.allowLegacyPaApiShape === true &&
    obj.SearchResult &&
    Array.isArray(obj.SearchResult.Items)
  ) {
    const items: RawCreatorsApiItem[] = obj.SearchResult.Items;
    const totalResultCount =
      typeof obj.SearchResult.TotalResultCount === "number"
        ? obj.SearchResult.TotalResultCount
        : items.length;
    return {
      valid: true,
      status: items.length > 0 ? "OBSERVED_UNVERIFIED" : "QUERY_SUCCEEDED_EMPTY",
      items,
      totalResultCount: items.length > 0 ? totalResultCount : 0,
      partialErrors,
      errorCode: null,
      errorMessage: null,
      schemaOrigin: "LEGACY_PAAPI_COMPAT",
    };
  }

  if (obj.SearchResult) {
    return {
      valid: false,
      status: "PROVIDER_ERROR",
      items: [],
      totalResultCount: null,
      partialErrors,
      errorCode: "SCHEMA_MISMATCH",
      errorMessage:
        "SCHEMA_MISMATCH: Received legacy uppercase PA-API 'SearchResult' instead of official Creators API lower-camel 'searchResult.items'.",
      schemaOrigin: "INVALID",
    };
  }

  return {
    valid: false,
    status: "PROVIDER_ERROR",
    items: [],
    totalResultCount: null,
    partialErrors,
    errorCode: "SCHEMA_MISMATCH",
    errorMessage:
      "SCHEMA_MISMATCH: SearchItems response is missing official 'searchResult.items' envelope.",
    schemaOrigin: "INVALID",
  };
}

export interface ParsedGetItemsEnvelope {
  valid: boolean;
  status: MarketplaceEvidenceStatus;
  items: RawCreatorsApiItem[];
  itemsByAsin: Record<string, RawCreatorsApiItem>;
  missingAsins: string[];
  partialErrors: CreatorsApiPartialError[];
  errorCode: string | null;
  errorMessage: string | null;
  schemaOrigin:
    | "OFFICIAL_LOWER_CAMEL"
    | "OFFICIAL_ERROR_ENVELOPE"
    | "LEGACY_PAAPI_COMPAT"
    | "INVALID";
}

/**
 * Pure parser for official Amazon Creators API v1 GetItems response envelope.
 * Indexes returned items by normalized ASIN (`itemsByAsin`), tracks `missingAsins` and
 * `partialErrors`, and fails closed with `SCHEMA_MISMATCH` on unrecognized HTTP 200 envelopes.
 */
export function parseCreatorsGetItemsEnvelope(
  parsedJson: unknown,
  requestedAsins: string[] = [],
  options?: { allowLegacyPaApiShape?: boolean }
): ParsedGetItemsEnvelope {
  const cleanRequested = Array.from(
    new Set(
      (requestedAsins || [])
        .map((a) => String(a || "").trim().toUpperCase())
        .filter((a) => isValidStrictAmazonAsin(a))
    )
  );

  if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
    return {
      valid: false,
      status: "PROVIDER_ERROR",
      items: [],
      itemsByAsin: {},
      missingAsins: cleanRequested,
      partialErrors: [],
      errorCode: "PARSE_FAILED",
      errorMessage: "PARSE_FAILED: GetItems HTTP 200 body is not a JSON object.",
      schemaOrigin: "INVALID",
    };
  }

  const obj = parsedJson as Record<string, any>;
  const partialErrors = extractPartialErrorsFromEnvelope(obj);

  const indexItemsByAsin = (
    items: RawCreatorsApiItem[],
    allowLegacy: boolean
  ): Record<string, RawCreatorsApiItem> => {
    const map: Record<string, RawCreatorsApiItem> = {};
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const rawAsin =
        typeof item.asin === "string"
          ? item.asin
          : allowLegacy && typeof item.ASIN === "string"
          ? item.ASIN
          : "";
      const normAsin = rawAsin.trim().toUpperCase();
      if (isValidStrictAmazonAsin(normAsin)) {
        map[normAsin] = item;
      }
    }
    return map;
  };

  if (obj.itemResults && typeof obj.itemResults === "object") {
    if (!Array.isArray(obj.itemResults.items)) {
      return {
        valid: false,
        status: "PROVIDER_ERROR",
        items: [],
        itemsByAsin: {},
        missingAsins: cleanRequested,
        partialErrors,
        errorCode: "SCHEMA_MISMATCH",
        errorMessage:
          "SCHEMA_MISMATCH: itemResults object is missing lower-camel 'items' array.",
        schemaOrigin: "INVALID",
      };
    }

    const items: RawCreatorsApiItem[] = obj.itemResults.items;
    const itemsByAsin = indexItemsByAsin(items, Boolean(options?.allowLegacyPaApiShape));
    const missingAsins = cleanRequested.filter((a) => !itemsByAsin[a]);

    return {
      valid: true,
      status: items.length > 0 ? "OBSERVED_UNVERIFIED" : "QUERY_SUCCEEDED_EMPTY",
      items,
      itemsByAsin,
      missingAsins,
      partialErrors,
      errorCode: null,
      errorMessage: null,
      schemaOrigin: "OFFICIAL_LOWER_CAMEL",
    };
  }

  if (
    partialErrors.length > 0 &&
    partialErrors.some((e) =>
      /^(?:ItemNotAccessible|InvalidParameterValue|NoResults)$/i.test(e.code)
    )
  ) {
    return {
      valid: true,
      status: "QUERY_SUCCEEDED_EMPTY",
      items: [],
      itemsByAsin: {},
      missingAsins: cleanRequested,
      partialErrors,
      errorCode: partialErrors[0].code,
      errorMessage: partialErrors[0].message || null,
      schemaOrigin: "OFFICIAL_ERROR_ENVELOPE",
    };
  }

  if (
    options?.allowLegacyPaApiShape === true &&
    obj.ItemsResult &&
    Array.isArray(obj.ItemsResult.Items)
  ) {
    const items: RawCreatorsApiItem[] = obj.ItemsResult.Items;
    const itemsByAsin = indexItemsByAsin(items, true);
    const missingAsins = cleanRequested.filter((a) => !itemsByAsin[a]);
    return {
      valid: true,
      status: items.length > 0 ? "OBSERVED_UNVERIFIED" : "QUERY_SUCCEEDED_EMPTY",
      items,
      itemsByAsin,
      missingAsins,
      partialErrors,
      errorCode: null,
      errorMessage: null,
      schemaOrigin: "LEGACY_PAAPI_COMPAT",
    };
  }

  if (obj.ItemsResult) {
    return {
      valid: false,
      status: "PROVIDER_ERROR",
      items: [],
      itemsByAsin: {},
      missingAsins: cleanRequested,
      partialErrors,
      errorCode: "SCHEMA_MISMATCH",
      errorMessage:
        "SCHEMA_MISMATCH: Received legacy uppercase PA-API 'ItemsResult' instead of official Creators API lower-camel 'itemResults.items'.",
      schemaOrigin: "INVALID",
    };
  }

  return {
    valid: false,
    status: "PROVIDER_ERROR",
    items: [],
    itemsByAsin: {},
    missingAsins: cleanRequested,
    partialErrors,
    errorCode: "SCHEMA_MISMATCH",
    errorMessage:
      "SCHEMA_MISMATCH: GetItems response is missing official 'itemResults.items' envelope.",
    schemaOrigin: "INVALID",
  };
}

export interface NormalizedCreatorsApiItemShape {
  schemaValid: boolean;
  schemaOrigin: "OFFICIAL_LOWER_CAMEL" | "LEGACY_PAAPI_COMPAT" | "INVALID";
  asin: string | null;
  parentAsin: string | null;
  detailPageUrl: string | null;
  title: string | null;
  brand: string | null;
  manufacturer: string | null;
  modelNumber: string | null;
  partNumber: string | null;
  gtinList: string[];
  features: string[];
  primaryMediumImageUrl: string | null;
  priceAmount: number | null;
  priceCurrency: string | null;
  priceDisplayAmount: string | null;
  availabilityMessage: string | null;
  availabilityType: string | null;
  merchantName: string | null;
  merchantId: string | null;
}

/**
 * Pure item-level field normalizer for official Amazon Creators API v1 items.
 * Extracts lower-camel fields (`asin`, `parentASIN`, `detailPageURL`, `itemInfo.*`,
 * `offersV2.listings`, `images.primary.medium.url`). Rejects uppercase PA-API items
 * unless `options.allowLegacyPaApiShape === true`.
 */
export function normalizeCreatorsApiItemShape(
  rawItem: unknown,
  options?: { allowLegacyPaApiShape?: boolean }
): NormalizedCreatorsApiItemShape {
  const empty: NormalizedCreatorsApiItemShape = {
    schemaValid: false,
    schemaOrigin: "INVALID",
    asin: null,
    parentAsin: null,
    detailPageUrl: null,
    title: null,
    brand: null,
    manufacturer: null,
    modelNumber: null,
    partNumber: null,
    gtinList: [],
    features: [],
    primaryMediumImageUrl: null,
    priceAmount: null,
    priceCurrency: null,
    priceDisplayAmount: null,
    availabilityMessage: null,
    availabilityType: null,
    merchantName: null,
    merchantId: null,
  };

  if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
    return empty;
  }

  const item = rawItem as RawCreatorsApiItem;
  const hasLowerCamelAsin = typeof item.asin === "string" && item.asin.trim().length > 0;
  const hasLegacyUppercaseAsin =
    typeof item.ASIN === "string" && item.ASIN.trim().length > 0;

  if (!hasLowerCamelAsin && (!hasLegacyUppercaseAsin || !options?.allowLegacyPaApiShape)) {
    return empty;
  }

  const useLegacy = !hasLowerCamelAsin && Boolean(options?.allowLegacyPaApiShape);
  const schemaOrigin = useLegacy ? "LEGACY_PAAPI_COMPAT" : "OFFICIAL_LOWER_CAMEL";

  const rawAsin = (useLegacy ? item.ASIN : item.asin) || "";
  const asin = rawAsin.trim().toUpperCase() || null;

  const rawParentAsin =
    (typeof item.parentASIN === "string"
      ? item.parentASIN
      : useLegacy && typeof item.ParentASIN === "string"
      ? item.ParentASIN
      : "") || "";
  const parentAsin = rawParentAsin.trim().toUpperCase() || null;

  const rawDetailUrl =
    (typeof item.detailPageURL === "string"
      ? item.detailPageURL
      : useLegacy && typeof item.DetailPageURL === "string"
      ? item.DetailPageURL
      : "") || "";
  const detailPageUrl = rawDetailUrl.trim() || null;

  const title =
    (
      item.itemInfo?.title?.displayValue ??
      (useLegacy ? item.ItemInfo?.Title?.DisplayValue : undefined) ??
      ""
    ).trim() || null;

  const brand =
    (
      item.itemInfo?.byLineInfo?.brand?.displayValue ??
      (useLegacy ? item.ItemInfo?.ByLineInfo?.Brand?.DisplayValue : undefined) ??
      ""
    ).trim() || null;

  const manufacturer =
    (
      item.itemInfo?.byLineInfo?.manufacturer?.displayValue ??
      (useLegacy ? item.ItemInfo?.ByLineInfo?.Manufacturer?.DisplayValue : undefined) ??
      ""
    ).trim() || null;

  const modelNumber =
    (
      item.itemInfo?.manufactureInfo?.model?.displayValue ??
      (useLegacy ? item.ItemInfo?.ManufactureInfo?.Model?.DisplayValue : undefined) ??
      ""
    ).trim() || null;

  const partNumber =
    (
      item.itemInfo?.manufactureInfo?.itemPartNumber?.displayValue ??
      (useLegacy
        ? item.ItemInfo?.ManufactureInfo?.ItemPartNumber?.DisplayValue
        : undefined) ??
      ""
    ).trim() || null;

  const upcs =
    item.itemInfo?.externalIds?.upcs?.displayValues ??
    (useLegacy ? item.ItemInfo?.ExternalIds?.UPCs?.DisplayValues : undefined) ??
    [];
  const eans =
    item.itemInfo?.externalIds?.eans?.displayValues ??
    (useLegacy ? item.ItemInfo?.ExternalIds?.EANs?.DisplayValues : undefined) ??
    [];
  const isbns =
    item.itemInfo?.externalIds?.isbns?.displayValues ??
    (useLegacy ? item.ItemInfo?.ExternalIds?.ISBNs?.DisplayValues : undefined) ??
    [];
  const gtinList = [...upcs, ...eans, ...isbns]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  const rawFeatures =
    item.itemInfo?.features?.displayValues ??
    (useLegacy ? item.ItemInfo?.Features?.DisplayValues : undefined) ??
    [];
  const features = rawFeatures
    .map((f) => String(f || "").trim())
    .filter(Boolean);

  const primaryMediumImageUrl =
    (
      item.images?.primary?.medium?.url ??
      (useLegacy ? item.Images?.Primary?.Medium?.URL : undefined) ??
      ""
    ).trim() || null;

  // Prefer offersV2.listings (BuyBox winner or index 0)
  const lowerListings = Array.isArray(item.offersV2?.listings)
    ? item.offersV2!.listings!
    : [];
  const primaryLowerListing =
    lowerListings.find((l) => l && l.isBuyBoxWinner === true) || lowerListings[0] || null;

  const legacyListings = useLegacy
    ? item.Offers?.V2?.Listings || item.Offers?.Listings || []
    : [];
  const primaryLegacyListing = legacyListings[0] || null;

  const rawAmount =
    primaryLowerListing?.price?.amount ??
    (useLegacy ? primaryLegacyListing?.Price?.Amount : undefined);
  const priceAmount =
    typeof rawAmount === "number" && Number.isFinite(rawAmount) ? rawAmount : null;

  const rawCurrency =
    primaryLowerListing?.price?.currency ??
    (useLegacy ? primaryLegacyListing?.Price?.Currency : undefined) ??
    "";
  const priceCurrency = String(rawCurrency || "").trim().toUpperCase() || null;

  const rawDisplayAmount =
    primaryLowerListing?.price?.displayAmount ??
    (useLegacy ? primaryLegacyListing?.Price?.DisplayAmount : undefined) ??
    "";
  const priceDisplayAmount = String(rawDisplayAmount || "").trim() || null;

  const rawAvailabilityMsg =
    primaryLowerListing?.availability?.message ??
    (useLegacy ? primaryLegacyListing?.Availability?.Message : undefined) ??
    "";
  const availabilityMessage = String(rawAvailabilityMsg || "").trim() || null;

  const rawAvailabilityType =
    primaryLowerListing?.availability?.type ??
    (useLegacy ? primaryLegacyListing?.Availability?.Type : undefined) ??
    "";
  const availabilityType = String(rawAvailabilityType || "").trim() || null;

  const rawMerchantName =
    primaryLowerListing?.merchantInfo?.name ??
    (useLegacy ? primaryLegacyListing?.MerchantInfo?.Name : undefined) ??
    "";
  const merchantName = String(rawMerchantName || "").trim() || null;

  const rawMerchantId =
    primaryLowerListing?.merchantInfo?.id ??
    (useLegacy ? primaryLegacyListing?.MerchantInfo?.Id : undefined) ??
    "";
  const merchantId = String(rawMerchantId || "").trim() || null;

  return {
    schemaValid: true,
    schemaOrigin,
    asin,
    parentAsin,
    detailPageUrl,
    title,
    brand,
    manufacturer,
    modelNumber,
    partNumber,
    gtinList,
    features,
    primaryMediumImageUrl,
    priceAmount,
    priceCurrency,
    priceDisplayAmount,
    availabilityMessage,
    availabilityType,
    merchantName,
    merchantId,
  };
}

/**
 * Section 5B.6: Evaluates server-side Creators API eligibility without logging or exposing credentials.
 * Strictly separates configured != transportVerified != authenticated != querySucceeded.
 */
export function resolveCreatorsApiEligibility(
  env: Record<string, string | undefined> = process.env,
  registrationStatus: CreatorsApiRegistrationStatus = {}
): AmazonAccessDecision {
  const featureEnabled =
    String(env.KH02_AMAZON_US_ENABLED || "false").trim().toLowerCase() === "true";
  const liveAllowed =
    String(env.KH02_AMAZON_US_LIVE_ALLOWED || "false").trim().toLowerCase() === "true";
  const userAuthorizedUrlAttested =
    String(env.KH02_AMAZON_US_USER_AUTHORIZED_URLS_ATTESTED || "false")
      .trim()
      .toLowerCase() === "true";

  const credId = (
    env.KH02_AMAZON_CREATORS_API_CREDENTIAL_ID ||
    env.AMAZON_CREATORS_API_CREDENTIAL_ID ||
    ""
  ).trim();
  const credSecret = (
    env.KH02_AMAZON_CREATORS_API_CREDENTIAL_SECRET ||
    env.AMAZON_CREATORS_API_CREDENTIAL_SECRET ||
    ""
  ).trim();
  const partnerTag = (
    env.KH02_AMAZON_ASSOCIATES_PARTNER_TAG ||
    env.AMAZON_CREATORS_API_PARTNER_TAG ||
    ""
  ).trim();
  const credentialVersion = resolveCreatorsApiCredentialVersion(
    env.KH02_AMAZON_CREATORS_API_CREDENTIAL_VERSION ||
      env.AMAZON_CREATORS_API_CREDENTIAL_VERSION
  );
  const tokenEndpoint = resolveCreatorsApiTokenEndpointByVersion(credentialVersion);
  const registeredMarketplace = (
    registrationStatus.marketplace ||
    env.KH02_AMAZON_CREATORS_API_MARKETPLACE ||
    CREATORS_API_US_MARKETPLACE
  )
    .trim()
    .toLowerCase();

  const hasCredentialId = credId.length > 0;
  const hasCredentialSecret = credSecret.length > 0;
  const hasPartnerTag = partnerTag.length > 0;
  const configured = hasCredentialId && hasCredentialSecret && hasPartnerTag;

  const transportVerified = Boolean(registrationStatus.transportVerified);
  const authenticated = Boolean(configured && registrationStatus.authenticated);
  const querySucceeded = Boolean(authenticated && registrationStatus.querySucceeded);
  const imageDisplayLicenseVerified = Boolean(
    authenticated && registrationStatus.imageDisplayLicenseVerified
  );

  const setupChecklist: string[] = [
    "1. Enroll an eligible US Amazon Associates account at affiliate-program.amazon.com.",
    "2. Generate official Creators API OAuth 2.0 Credential ID and Credential Secret (version 3.1 NA for US).",
    "3. Set KH02_AMAZON_US_ENABLED=true and KH02_AMAZON_US_LIVE_ALLOWED=true on the server.",
    "4. Configure KH02_AMAZON_CREATORS_API_CREDENTIAL_ID, KH02_AMAZON_CREATORS_API_CREDENTIAL_SECRET, and KH02_AMAZON_ASSOCIATES_PARTNER_TAG in server-only environment.",
  ];

  if (!featureEnabled) {
    return {
      featureEnabled: false,
      liveAllowed: false,
      configured,
      hasCredentialId,
      hasCredentialSecret,
      hasPartnerTag,
      partnerTagMasked: maskPartnerTag(partnerTag),
      credentialVersion,
      tokenEndpoint,
      registeredMarketplace,
      transportVerified: false,
      authenticated: false,
      querySucceeded: false,
      eligibleForLiveRequests: false,
      imageDisplayLicenseVerified: false,
      status: "DISABLED",
      accessPolicyStatus: "DISABLED_BY_DEFAULT",
      permittedAccessRoute: "NONE",
      reason: "Amazon US pilot is disabled by default (KH02_AMAZON_US_ENABLED=false).",
      setupChecklist,
      officialDocsChecked: OFFICIAL_CREATORS_API_DOCS_VERIFIED,
    };
  }

  if (!liveAllowed) {
    return {
      featureEnabled: true,
      liveAllowed: false,
      configured,
      hasCredentialId,
      hasCredentialSecret,
      hasPartnerTag,
      partnerTagMasked: maskPartnerTag(partnerTag),
      credentialVersion,
      tokenEndpoint,
      registeredMarketplace,
      transportVerified,
      authenticated: false,
      querySucceeded: false,
      eligibleForLiveRequests: false,
      imageDisplayLicenseVerified: false,
      status: "BLOCKED_POLICY",
      accessPolicyStatus: "LIVE_NOT_ALLOWED",
      permittedAccessRoute: "ISOLATED_FIXTURE_ONLY",
      reason:
        "KH02_AMAZON_US_ENABLED=true but KH02_AMAZON_US_LIVE_ALLOWED=false. Live upstream calls are disabled by server policy.",
      setupChecklist,
      officialDocsChecked: OFFICIAL_CREATORS_API_DOCS_VERIFIED,
    };
  }

  if (registeredMarketplace !== CREATORS_API_US_MARKETPLACE) {
    return {
      featureEnabled: true,
      liveAllowed: false,
      configured,
      hasCredentialId,
      hasCredentialSecret,
      hasPartnerTag,
      partnerTagMasked: maskPartnerTag(partnerTag),
      credentialVersion,
      tokenEndpoint,
      registeredMarketplace,
      transportVerified,
      authenticated: false,
      querySucceeded: false,
      eligibleForLiveRequests: false,
      imageDisplayLicenseVerified: false,
      status: "BLOCKED_POLICY",
      accessPolicyStatus: "BLOCKED_POLICY",
      permittedAccessRoute: "NONE",
      reason: `Unsupported Amazon Creators API marketplace '${registeredMarketplace}'. Only US marketplace '${CREATORS_API_US_MARKETPLACE}' is permitted.`,
      setupChecklist,
      officialDocsChecked: OFFICIAL_CREATORS_API_DOCS_VERIFIED,
    };
  }

  if (!configured) {
    return {
      featureEnabled: true,
      liveAllowed: true,
      configured: false,
      hasCredentialId,
      hasCredentialSecret,
      hasPartnerTag,
      partnerTagMasked: maskPartnerTag(partnerTag),
      credentialVersion,
      tokenEndpoint,
      registeredMarketplace,
      transportVerified,
      authenticated: false,
      querySucceeded: false,
      eligibleForLiveRequests: false,
      imageDisplayLicenseVerified: false,
      status: "CREDENTIALS_REQUIRED",
      accessPolicyStatus: userAuthorizedUrlAttested
        ? "AUTHORIZED_USER_LIMITED_URL"
        : "CREDENTIALS_REQUIRED",
      permittedAccessRoute: userAuthorizedUrlAttested
        ? "USER_AUTHORIZED_URL"
        : "ISOLATED_FIXTURE_ONLY",
      reason:
        "CREDENTIALS_REQUIRED: Official Amazon Associates Creators API credentials (KH02_AMAZON_CREATORS_API_CREDENTIAL_ID, KH02_AMAZON_CREATORS_API_CREDENTIAL_SECRET, KH02_AMAZON_ASSOCIATES_PARTNER_TAG) are not configured in server environment.",
      setupChecklist,
      officialDocsChecked: OFFICIAL_CREATORS_API_DOCS_VERIFIED,
    };
  }

  if (registrationStatus.accountApproved === false) {
    return {
      featureEnabled: true,
      liveAllowed: true,
      configured: true,
      hasCredentialId,
      hasCredentialSecret,
      hasPartnerTag,
      partnerTagMasked: maskPartnerTag(partnerTag),
      credentialVersion,
      tokenEndpoint,
      registeredMarketplace,
      transportVerified,
      authenticated: false,
      querySucceeded: false,
      eligibleForLiveRequests: false,
      imageDisplayLicenseVerified: false,
      status: "ACCESS_NOT_GRANTED",
      accessPolicyStatus: "ACCESS_NOT_GRANTED",
      permittedAccessRoute: "NONE",
      reason:
        "ACCESS_NOT_GRANTED: Amazon Associates account is not yet approved for Creators API access.",
      setupChecklist,
      officialDocsChecked: OFFICIAL_CREATORS_API_DOCS_VERIFIED,
    };
  }

  return {
    featureEnabled: true,
    liveAllowed: true,
    configured: true,
    hasCredentialId,
    hasCredentialSecret,
    hasPartnerTag,
    partnerTagMasked: maskPartnerTag(partnerTag),
    credentialVersion,
    tokenEndpoint,
    registeredMarketplace,
    transportVerified,
    authenticated,
    querySucceeded,
    eligibleForLiveRequests: true,
    imageDisplayLicenseVerified,
    status: querySucceeded
      ? "IDENTITY_VERIFIED"
      : authenticated
      ? "NOT_ATTEMPTED"
      : "ACCESS_NOT_GRANTED",
    accessPolicyStatus: authenticated
      ? "AUTHORIZED_CREATORS_API"
      : "AUTHORIZED_CREATORS_API_CONFIGURED",
    permittedAccessRoute: "OFFICIAL_CREATORS_API",
    reason: authenticated
      ? "Official Amazon Creators API credentials configured and OAuth authentication verified."
      : "Official Amazon Creators API credentials configured; upstream OAuth token and entitlement verification required on actual request.",
    setupChecklist,
    officialDocsChecked: OFFICIAL_CREATORS_API_DOCS_VERIFIED,
  };
}

/**
 * Section 5B.10: Categorizes Creators API errors and HTTP responses with non-retryable auth/policy flags.
 */
export function classifyCreatorsApiFailure(
  error: unknown,
  response?: {
    httpStatus?: number | null;
    bodyText?: string | null;
    parsedJson?: any;
  } | null
): ClassifiedCreatorsApiStatus {
  const httpStatus =
    typeof response?.httpStatus === "number" && Number.isFinite(response.httpStatus)
      ? response.httpStatus
      : null;
  const errObj = response?.parsedJson?. errors?.[0] || response?.parsedJson?.Errors?.[0];
  const upstreamCode = String(
    errObj?.code || errObj?.Code || response?.parsedJson?.error || ""
  ).trim();
  const upstreamMsg = String(
    errObj?.message ||
      errObj?.Message ||
      response?.parsedJson?.error_description ||
      response?.bodyText ||
      (error instanceof Error ? error.message : String(error || ""))
  ).trim();
  const combined = `${upstreamCode} ${upstreamMsg}`.toLowerCase();

  if (
    httpStatus === 401 ||
    /invalid_client|unauthorized|invalid_token|expired_token|authentication_failed/i.test(
      combined
    )
  ) {
    return {
      status: "AUTHENTICATION_FAILED",
      errorCode: upstreamCode || "HTTP_401_UNAUTHORIZED",
      retryable: false,
      isEntitlementOrAuthError: true,
      sanitizedMessage: `AUTHENTICATION_FAILED: Upstream Amazon Creators API rejected credentials (${upstreamCode || "401"}).`,
    };
  }

  if (
    httpStatus === 403 ||
    /accessdenied|access_denied|invalidpartnertag|associatenoteligible|forbidden|not_authorized|invalid_scope/i.test(
      combined
    )
  ) {
    return {
      status: "ACCESS_NOT_GRANTED",
      errorCode: upstreamCode || "HTTP_403_ACCESS_NOT_GRANTED",
      retryable: false,
      isEntitlementOrAuthError: true,
      sanitizedMessage: `ACCESS_NOT_GRANTED: Amazon Associates partnerTag or account is not entitled for Creators API (${upstreamCode || "403"}).`,
    };
  }

  if (
    httpStatus === 429 ||
    /toomanyrequests|throttling|rate_limit|quota/i.test(combined)
  ) {
    return {
      status: "RATE_LIMITED",
      errorCode: upstreamCode || "HTTP_429_RATE_LIMITED",
      retryable: false,
      isEntitlementOrAuthError: false,
      sanitizedMessage: `RATE_LIMITED: Amazon Creators API quota/rate limit reached (${upstreamCode || "429"}).`,
    };
  }

  if (/abort|timed_out|timeout|etimedout|deadline/i.test(combined)) {
    return {
      status: "TIMED_OUT",
      errorCode: "REQUEST_TIMED_OUT",
      retryable: true,
      isEntitlementOrAuthError: false,
      sanitizedMessage: "TIMED_OUT: Amazon Creators API request timed out or was aborted.",
    };
  }

  if (httpStatus !== null && httpStatus >= 500) {
    return {
      status: "PROVIDER_ERROR",
      errorCode: upstreamCode || `HTTP_${httpStatus}_SERVER_ERROR`,
      retryable: true,
      isEntitlementOrAuthError: false,
      sanitizedMessage: `PROVIDER_ERROR: Amazon Creators API upstream HTTP ${httpStatus} error.`,
    };
  }

  if (
    httpStatus === 200 &&
    (/ItemNotAccessible|NoResults/i.test(upstreamCode) ||
      (Array.isArray(response?.parsedJson?.searchResult?.items) &&
        response?.parsedJson?.searchResult?.items.length === 0))
  ) {
    return {
      status: "QUERY_SUCCEEDED_EMPTY",
      errorCode: upstreamCode || "NO_RESULTS",
      retryable: false,
      isEntitlementOrAuthError: false,
      sanitizedMessage:
        "QUERY_SUCCEEDED_EMPTY: Amazon Creators API returned 0 matching items.",
    };
  }

  return {
    status: "PROVIDER_ERROR",
    errorCode: upstreamCode || (httpStatus ? `HTTP_${httpStatus}` : "CREATORS_API_ERROR"),
    retryable: false,
    isEntitlementOrAuthError: false,
    sanitizedMessage: `PROVIDER_ERROR: ${upstreamMsg.slice(0, 240) || "Unclassified Creators API failure"}`,
  };
}

/**
 * Section 5B.7: Creates an official Amazon Associates Creators API client with:
 * - Official OAuth 2.0 JSON body (`grant_type: "client_credentials"`, `scope: "creatorsapi::default"`)
 * - In-flight token promise deduplication + clock-skew caching
 * - Single automatic token refresh on 401 token expiry
 * - Official lower-camel SearchItems & GetItems payload builders and envelope parsers
 * - Strict US marketplace header (`x-marketplace: www.amazon.com`) & secret redaction
 */
export function createCreatorsApiClient(
  config: CreatorsApiClientConfig
): CreatorsApiClient {
  const credentialId = String(config.credentialId || "").trim();
  const credentialSecret = String(config.credentialSecret || "").trim();
  const partnerTag = String(config.partnerTag || "").trim();
  const credentialVersion = resolveCreatorsApiCredentialVersion(
    config.credentialVersion
  );
  const marketplace = String(config.marketplace || CREATORS_API_US_MARKETPLACE)
    .trim()
    .toLowerCase();
  const allowIsolatedTestHost = Boolean(config.allowIsolatedTestHost);
  const allowLegacyPaApiShape = Boolean(config.allowLegacyPaApiShape);

  const tokenEndpoint =
    config.tokenEndpoint || resolveCreatorsApiTokenEndpointByVersion(credentialVersion);
  const searchItemsEndpoint =
    config.searchItemsEndpoint || CREATORS_API_SEARCH_ITEMS_ENDPOINT;
  const getItemsEndpoint = config.getItemsEndpoint || CREATORS_API_GET_ITEMS_ENDPOINT;
  const timeoutMs = config.timeoutMs ?? 12_000;
  const fetchImpl = config.fetchFn || globalThis.fetch;

  if (!credentialId || !credentialSecret || !partnerTag) {
    throw new Error(
      "CREDENTIALS_REQUIRED: Cannot initialize CreatorsApiClient without credentialId, credentialSecret, and partnerTag."
    );
  }
  if (marketplace !== CREATORS_API_US_MARKETPLACE) {
    throw new Error(
      `BLOCKED_POLICY: CreatorsApiClient only supports '${CREATORS_API_US_MARKETPLACE}', received '${marketplace}'.`
    );
  }

  const tokenEndpointCheck = validateCreatorsApiEndpointUrl(tokenEndpoint, {
    allowIsolatedTestHost,
  });
  const searchEndpointCheck = validateCreatorsApiEndpointUrl(searchItemsEndpoint, {
    allowIsolatedTestHost,
  });
  const getItemsEndpointCheck = validateCreatorsApiEndpointUrl(getItemsEndpoint, {
    allowIsolatedTestHost,
  });

  if (
    !tokenEndpointCheck.valid ||
    !searchEndpointCheck.valid ||
    !getItemsEndpointCheck.valid
  ) {
    const errReason =
      tokenEndpointCheck.reason ||
      searchEndpointCheck.reason ||
      getItemsEndpointCheck.reason ||
      "Invalid Creators API endpoint";
    throw new Error(`BLOCKED_POLICY: ${errReason}`);
  }

  const isIsolatedTestTransport = Boolean(
    config.isIsolatedTestTransport ||
      allowIsolatedTestHost ||
      tokenEndpointCheck.isLocalhost ||
      searchEndpointCheck.isLocalhost ||
      getItemsEndpointCheck.isLocalhost
  );
  const transportProvenance: "OFFICIAL_UPSTREAM" | "TEST_FIXTURE" =
    isIsolatedTestTransport ? "TEST_FIXTURE" : "OFFICIAL_UPSTREAM";

  let cachedToken: { accessToken: string; expiresAtMs: number } | null = null;
  let inFlightTokenPromise: Promise<{
    ok: boolean;
    accessToken: string | null;
    httpStatus: number | null;
    classifiedError: ClassifiedCreatorsApiStatus | null;
  }> | null = null;

  const tokenTelemetry: CreatorsApiTokenTelemetrySummary = {
    tokenRequestsAttempted: 0,
    tokenRequestsSucceeded: 0,
    tokenCacheHits: 0,
    concurrentDeduplicationsCount: 0,
    tokenRefreshesOn401Count: 0,
    lastTokenHttpStatus: null,
    lastTokenErrorCode: null,
  };

  async function performOAuthTokenFetch(signal?: AbortSignal): Promise<{
    ok: boolean;
    accessToken: string | null;
    httpStatus: number | null;
    classifiedError: ClassifiedCreatorsApiStatus | null;
  }> {
    tokenTelemetry.tokenRequestsAttempted++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("TIMED_OUT")), timeoutMs);
    const onParentAbort = () => controller.abort(signal?.reason || new Error("ABORTED"));
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        const classified = classifyCreatorsApiFailure(new Error("TIMED_OUT"));
        tokenTelemetry.lastTokenErrorCode = classified.errorCode;
        return {
          ok: false,
          accessToken: null,
          httpStatus: null,
          classifiedError: classified,
        };
      }
      signal.addEventListener("abort", onParentAbort, { once: true });
    }

    try {
      const jsonBody = JSON.stringify({
        grant_type: "client_credentials",
        client_id: credentialId,
        client_secret: credentialSecret,
        scope: CREATORS_API_OAUTH_SCOPE,
      });

      const resp = await fetchImpl(tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: jsonBody,
        signal: controller.signal,
      });

      const httpStatus = typeof resp.status === "number" ? resp.status : null;
      tokenTelemetry.lastTokenHttpStatus = httpStatus;
      const bodyText = await resp.text();
      let parsedJson: any = null;
      try {
        parsedJson = JSON.parse(bodyText);
      } catch {
        parsedJson = null;
      }

      if (!resp.ok) {
        const classified = classifyCreatorsApiFailure(null, {
          httpStatus: httpStatus ?? 401,
          bodyText: redactSecretsFromMessage(bodyText, [
            credentialId,
            credentialSecret,
          ]),
          parsedJson,
        });
        tokenTelemetry.lastTokenErrorCode = classified.errorCode;
        return {
          ok: false,
          accessToken: null,
          httpStatus,
          classifiedError: classified,
        };
      }

      const rawAccessToken =
        typeof parsedJson?.access_token === "string"
          ? parsedJson.access_token.trim()
          : "";
      const rawExpiresIn = Number(parsedJson?.expires_in);
      if (
        !parsedJson ||
        !rawAccessToken ||
        !Number.isFinite(rawExpiresIn) ||
        rawExpiresIn <= 0
      ) {
        const malformedErr: ClassifiedCreatorsApiStatus = {
          status: "AUTHENTICATION_FAILED",
          errorCode: "OAUTH_TOKEN_PARSE_FAILED",
          retryable: false,
          isEntitlementOrAuthError: true,
          sanitizedMessage:
            "AUTHENTICATION_FAILED: OAuth 2.0 token response is missing required access_token or positive expires_in.",
        };
        tokenTelemetry.lastTokenErrorCode = malformedErr.errorCode;
        return {
          ok: false,
          accessToken: null,
          httpStatus,
          classifiedError: malformedErr,
        };
      }

      const skewBufferMs = Math.min(60_000, Math.floor((rawExpiresIn * 1000) / 3));
      cachedToken = {
        accessToken: rawAccessToken,
        expiresAtMs: Date.now() + rawExpiresIn * 1000 - skewBufferMs,
      };
      tokenTelemetry.tokenRequestsSucceeded++;
      tokenTelemetry.lastTokenErrorCode = null;
      return {
        ok: true,
        accessToken: rawAccessToken,
        httpStatus,
        classifiedError: null,
      };
    } catch (err) {
      const sanitizedErr = new Error(
        redactSecretsFromMessage(
          err instanceof Error ? err.message : String(err),
          [credentialId, credentialSecret]
        )
      );
      const classified = classifyCreatorsApiFailure(sanitizedErr);
      tokenTelemetry.lastTokenErrorCode = classified.errorCode;
      return {
        ok: false,
        accessToken: null,
        httpStatus: null,
        classifiedError: classified,
      };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onParentAbort);
    }
  }

  async function acquireBearerToken(
    signal?: AbortSignal,
    forceRefresh = false
  ): Promise<{
    ok: boolean;
    accessToken: string | null;
    httpStatus: number | null;
    classifiedError: ClassifiedCreatorsApiStatus | null;
  }> {
    if (forceRefresh) {
      cachedToken = null;
    }
    const now = Date.now();
    if (!forceRefresh && cachedToken && cachedToken.expiresAtMs > now) {
      tokenTelemetry.tokenCacheHits++;
      return {
        ok: true,
        accessToken: cachedToken.accessToken,
        httpStatus: 200,
        classifiedError: null,
      };
    }

    if (inFlightTokenPromise) {
      tokenTelemetry.concurrentDeduplicationsCount++;
      return inFlightTokenPromise;
    }

    inFlightTokenPromise = performOAuthTokenFetch(signal).finally(() => {
      inFlightTokenPromise = null;
    });
    return inFlightTokenPromise;
  }

  return {
    marketplace,
    partnerTagMasked: maskPartnerTag(partnerTag) || "***",
    credentialVersion,
    isIsolatedTestTransport,
    transportProvenance,

    getTokenTelemetrySummary() {
      return { ...tokenTelemetry };
    },

    async searchItemsByCandidateIntent(intent, context) {
      const startedAtMs = Date.now();
      const startedAt = new Date(startedAtMs).toISOString();
      const requestPayload = buildCreatorsSearchItemsPayload(intent, {
        partnerTag,
        marketplace,
        resources: CREATORS_API_DEFAULT_RESOURCES,
      });
      const cleanKeywords = requestPayload.keywords;

      const requestHash =
        computeDeterministicEvidenceHash({
          operation: "SearchItems",
          marketplace,
          keywords: cleanKeywords,
          itemCount: requestPayload.itemCount,
          resources: requestPayload.resources,
        }) || "req_hash";
      const providerInvocationRef = `amz_inv_${context.researchRunId}_${context.candidateId}_search_${requestHash.slice(0, 10)}`;

      if (!cleanKeywords) {
        const completedAt = new Date().toISOString();
        return {
          attempted: false,
          succeeded: false,
          status: "FAILED",
          httpStatus: null,
          httpStatusOrigin: "UNOBSERVED_NULL",
          startedAt,
          completedAt,
          durationMs: Math.max(0, Date.now() - startedAtMs),
          providerInvocationRef,
          upstreamRequestId: null,
          requestHash,
          rawResponseHash: null,
          requestedKeywords: cleanKeywords,
          marketplace,
          totalResultCount: null,
          items: [],
          partialErrors: [],
          errorCode: "EMPTY_SEARCH_KEYWORDS",
          errorMessage: "SearchItems keywords cannot be empty.",
          retryable: false,
        };
      }

      const executeHttpCall = async (opSignal?: AbortSignal): Promise<SearchItemsResponse> => {
        const activeSignal = opSignal || context.signal;
        let tokenRes = await acquireBearerToken(activeSignal, false);
        if (!tokenRes.ok || !tokenRes.accessToken) {
          const completedAt = new Date().toISOString();
          const errInfo = tokenRes.classifiedError!;
          return {
            attempted: true,
            succeeded: false,
            status: errInfo.status,
            httpStatus: tokenRes.httpStatus,
            httpStatusOrigin:
              tokenRes.httpStatus !== null ? "OBSERVED" : "UNOBSERVED_NULL",
            startedAt,
            completedAt,
            durationMs: Math.max(0, Date.now() - startedAtMs),
            providerInvocationRef,
            upstreamRequestId: null,
            requestHash,
            rawResponseHash: null,
            requestedKeywords: cleanKeywords,
            marketplace,
            totalResultCount: null,
            items: [],
            partialErrors: [],
            errorCode: errInfo.errorCode,
            errorMessage: errInfo.sanitizedMessage,
            retryable: errInfo.retryable,
          };
        }

        const sendCatalogPost = async (bearerToken: string) => {
          return fetchImpl(searchItemsEndpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${bearerToken}`,
              "Content-Type": "application/json",
              Accept: "application/json",
              "x-marketplace": marketplace,
              "x-amzn-credential-version": credentialVersion,
            },
            body: JSON.stringify(requestPayload),
            signal: activeSignal,
          });
        };

        let resp = await sendCatalogPost(tokenRes.accessToken);
        // Single refresh + retry on 401 expired token (R06)
        if (resp.status === 401) {
          tokenTelemetry.tokenRefreshesOn401Count++;
          const refreshedToken = await acquireBearerToken(activeSignal, true);
          if (refreshedToken.ok && refreshedToken.accessToken) {
            tokenRes = refreshedToken;
            resp = await sendCatalogPost(refreshedToken.accessToken);
          }
        }

        const httpStatus = typeof resp.status === "number" ? resp.status : null;
        const upstreamRequestId =
          resp.headers?.get?.("x-amzn-requestid") ||
          resp.headers?.get?.("x-amz-rid") ||
          null;
        const rawText = await resp.text();
        let parsedJson: any = null;
        try {
          parsedJson = JSON.parse(rawText);
        } catch {
          parsedJson = null;
        }

        const rawResponseHash = computeDeterministicEvidenceHash({
          httpStatus,
          upstreamRequestId,
          body: parsedJson ?? rawText,
        });
        const completedAt = new Date().toISOString();

        if (!resp.ok) {
          const classified = classifyCreatorsApiFailure(null, {
            httpStatus,
            bodyText: redactSecretsFromMessage(rawText, [
              credentialId,
              credentialSecret,
              tokenRes.accessToken,
            ]),
            parsedJson,
          });
          return {
            attempted: true,
            succeeded: false,
            status: classified.status,
            httpStatus,
            httpStatusOrigin: httpStatus !== null ? "OBSERVED" : "UNOBSERVED_NULL",
            startedAt,
            completedAt,
            durationMs: Math.max(0, Date.now() - startedAtMs),
            providerInvocationRef,
            upstreamRequestId,
            requestHash,
            rawResponseHash,
            requestedKeywords: cleanKeywords,
            marketplace,
            totalResultCount: null,
            items: [],
            partialErrors: [],
            errorCode: classified.errorCode,
            errorMessage: classified.sanitizedMessage,
            retryable: classified.retryable,
          };
        }

        const envelope = parseCreatorsSearchItemsEnvelope(parsedJson, {
          allowLegacyPaApiShape,
        });

        if (!envelope.valid) {
          return {
            attempted: true,
            succeeded: false,
            status: envelope.status,
            httpStatus,
            httpStatusOrigin: httpStatus !== null ? "OBSERVED" : "UNOBSERVED_NULL",
            startedAt,
            completedAt,
            durationMs: Math.max(0, Date.now() - startedAtMs),
            providerInvocationRef,
            upstreamRequestId,
            requestHash,
            rawResponseHash,
            requestedKeywords: cleanKeywords,
            marketplace,
            totalResultCount: null,
            items: [],
            partialErrors: envelope.partialErrors,
            errorCode: envelope.errorCode,
            errorMessage: envelope.errorMessage,
            retryable: false,
          };
        }

        return {
          attempted: true,
          succeeded: true,
          status: envelope.status,
          httpStatus,
          httpStatusOrigin: httpStatus !== null ? "OBSERVED" : "UNOBSERVED_NULL",
          startedAt,
          completedAt,
          durationMs: Math.max(0, Date.now() - startedAtMs),
          providerInvocationRef,
          upstreamRequestId,
          requestHash,
          rawResponseHash,
          requestedKeywords: cleanKeywords,
          marketplace,
          totalResultCount: envelope.totalResultCount,
          items: envelope.items,
          partialErrors: envelope.partialErrors,
          errorCode: envelope.errorCode,
          errorMessage: null,
          retryable: false,
        };
      };

      if (context.budget) {
        const budgetRes = await context.budget.executeBoundedOperation(
          `searchItems:${context.candidateId}:${requestHash.slice(0, 8)}`,
          async (_attempt, opSignal) => {
            const out = await executeHttpCall(opSignal);
            if (!out.succeeded && out.retryable) {
              throw new Error(out.errorMessage || "RETRYABLE_CREATORS_API_ERROR");
            }
            return out;
          },
          {
            isExternalBlockResult: (r) =>
              r.status === "AUTHENTICATION_FAILED" ||
              r.status === "ACCESS_NOT_GRANTED" ||
              r.status === "RATE_LIMITED",
          }
        );

        if (budgetRes.blockedDecision && !budgetRes.executed) {
          const completedAt = new Date().toISOString();
          return {
            attempted: false,
            succeeded: false,
            status: "RATE_LIMITED",
            httpStatus: null,
            httpStatusOrigin: "UNOBSERVED_NULL",
            startedAt,
            completedAt,
            durationMs: Math.max(0, Date.now() - startedAtMs),
            providerInvocationRef,
            upstreamRequestId: null,
            requestHash,
            rawResponseHash: null,
            requestedKeywords: cleanKeywords,
            marketplace,
            totalResultCount: null,
            items: [],
            partialErrors: [],
            errorCode: budgetRes.blockedDecision.reasonCode,
            errorMessage: budgetRes.blockedDecision.reason,
            retryable: false,
          };
        }

        if (budgetRes.result) {
          return budgetRes.result;
        }

        const classified = classifyCreatorsApiFailure(
          new Error(budgetRes.error || "SearchItems failed")
        );
        const completedAt = new Date().toISOString();
        return {
          attempted: budgetRes.attemptCount > 0,
          succeeded: false,
          status: classified.status,
          httpStatus: null,
          httpStatusOrigin: "UNOBSERVED_NULL",
          startedAt,
          completedAt,
          durationMs: Math.max(0, Date.now() - startedAtMs),
          providerInvocationRef,
          upstreamRequestId: null,
          requestHash,
          rawResponseHash: null,
          requestedKeywords: cleanKeywords,
          marketplace,
          totalResultCount: null,
          items: [],
          partialErrors: [],
          errorCode: classified.errorCode,
          errorMessage: classified.sanitizedMessage,
          retryable: classified.retryable,
        };
      }

      try {
        return await executeHttpCall(context.signal);
      } catch (err) {
        const classified = classifyCreatorsApiFailure(err);
        const completedAt = new Date().toISOString();
        return {
          attempted: true,
          succeeded: false,
          status: classified.status,
          httpStatus: null,
          httpStatusOrigin: "UNOBSERVED_NULL",
          startedAt,
          completedAt,
          durationMs: Math.max(0, Date.now() - startedAtMs),
          providerInvocationRef,
          upstreamRequestId: null,
          requestHash,
          rawResponseHash: null,
          requestedKeywords: cleanKeywords,
          marketplace,
          totalResultCount: null,
          items: [],
          partialErrors: [],
          errorCode: classified.errorCode,
          errorMessage: classified.sanitizedMessage,
          retryable: classified.retryable,
        };
      }
    },

    async getItemsByAsins(asins, context) {
      const startedAtMs = Date.now();
      const startedAt = new Date(startedAtMs).toISOString();
      const requestPayload = buildCreatorsGetItemsPayload(asins, {
        partnerTag,
        marketplace,
        resources: CREATORS_API_DEFAULT_RESOURCES,
      });
      const validAsins = requestPayload.itemIds;

      const requestHash =
        computeDeterministicEvidenceHash({
          operation: "GetItems",
          marketplace,
          itemIds: validAsins,
          resources: requestPayload.resources,
        }) || "getitems_hash";
      const providerInvocationRef = `amz_inv_${context.researchRunId}_${context.candidateId}_getitems_${requestHash.slice(0, 10)}`;

      if (validAsins.length === 0) {
        const completedAt = new Date().toISOString();
        return {
          attempted: false,
          succeeded: false,
          status: "FAILED",
          httpStatus: null,
          httpStatusOrigin: "UNOBSERVED_NULL",
          startedAt,
          completedAt,
          durationMs: Math.max(0, Date.now() - startedAtMs),
          providerInvocationRef,
          upstreamRequestId: null,
          requestHash,
          rawResponseHash: null,
          requestedAsins: [],
          marketplace,
          items: [],
          itemsByAsin: {},
          missingAsins: [],
          partialErrors: [],
          errorCode: "NO_VALID_ASINS",
          errorMessage: "GetItems requires at least one valid 10-character Amazon ASIN.",
          retryable: false,
        };
      }

      const executeHttpCall = async (opSignal?: AbortSignal): Promise<GetItemsResponse> => {
        const activeSignal = opSignal || context.signal;
        let tokenRes = await acquireBearerToken(activeSignal, false);
        if (!tokenRes.ok || !tokenRes.accessToken) {
          const completedAt = new Date().toISOString();
          const errInfo = tokenRes.classifiedError!;
          return {
            attempted: true,
            succeeded: false,
            status: errInfo.status,
            httpStatus: tokenRes.httpStatus,
            httpStatusOrigin:
              tokenRes.httpStatus !== null ? "OBSERVED" : "UNOBSERVED_NULL",
            startedAt,
            completedAt,
            durationMs: Math.max(0, Date.now() - startedAtMs),
            providerInvocationRef,
            upstreamRequestId: null,
            requestHash,
            rawResponseHash: null,
            requestedAsins: validAsins,
            marketplace,
            items: [],
            itemsByAsin: {},
            missingAsins: validAsins,
            partialErrors: [],
            errorCode: errInfo.errorCode,
            errorMessage: errInfo.sanitizedMessage,
            retryable: errInfo.retryable,
          };
        }

        const sendCatalogPost = async (bearerToken: string) => {
          return fetchImpl(getItemsEndpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${bearerToken}`,
              "Content-Type": "application/json",
              Accept: "application/json",
              "x-marketplace": marketplace,
              "x-amzn-credential-version": credentialVersion,
            },
            body: JSON.stringify(requestPayload),
            signal: activeSignal,
          });
        };

        let resp = await sendCatalogPost(tokenRes.accessToken);
        if (resp.status === 401) {
          tokenTelemetry.tokenRefreshesOn401Count++;
          const refreshedToken = await acquireBearerToken(activeSignal, true);
          if (refreshedToken.ok && refreshedToken.accessToken) {
            tokenRes = refreshedToken;
            resp = await sendCatalogPost(refreshedToken.accessToken);
          }
        }

        const httpStatus = typeof resp.status === "number" ? resp.status : null;
        const upstreamRequestId =
          resp.headers?.get?.("x-amzn-requestid") ||
          resp.headers?.get?.("x-amz-rid") ||
          null;
        const rawText = await resp.text();
        let parsedJson: any = null;
        try {
          parsedJson = JSON.parse(rawText);
        } catch {
          parsedJson = null;
        }

        const rawResponseHash = computeDeterministicEvidenceHash({
          httpStatus,
          upstreamRequestId,
          body: parsedJson ?? rawText,
        });
        const completedAt = new Date().toISOString();

        if (!resp.ok) {
          const classified = classifyCreatorsApiFailure(null, {
            httpStatus,
            bodyText: redactSecretsFromMessage(rawText, [
              credentialId,
              credentialSecret,
              tokenRes.accessToken,
            ]),
            parsedJson,
          });
          return {
            attempted: true,
            succeeded: false,
            status: classified.status,
            httpStatus,
            httpStatusOrigin: httpStatus !== null ? "OBSERVED" : "UNOBSERVED_NULL",
            startedAt,
            completedAt,
            durationMs: Math.max(0, Date.now() - startedAtMs),
            providerInvocationRef,
            upstreamRequestId,
            requestHash,
            rawResponseHash,
            requestedAsins: validAsins,
            marketplace,
            items: [],
            itemsByAsin: {},
            missingAsins: validAsins,
            partialErrors: [],
            errorCode: classified.errorCode,
            errorMessage: classified.sanitizedMessage,
            retryable: classified.retryable,
          };
        }

        const envelope = parseCreatorsGetItemsEnvelope(parsedJson, validAsins, {
          allowLegacyPaApiShape,
        });

        if (!envelope.valid) {
          return {
            attempted: true,
            succeeded: false,
            status: envelope.status,
            httpStatus,
            httpStatusOrigin: httpStatus !== null ? "OBSERVED" : "UNOBSERVED_NULL",
            startedAt,
            completedAt,
            durationMs: Math.max(0, Date.now() - startedAtMs),
            providerInvocationRef,
            upstreamRequestId,
            requestHash,
            rawResponseHash,
            requestedAsins: validAsins,
            marketplace,
            items: [],
            itemsByAsin: {},
            missingAsins: validAsins,
            partialErrors: envelope.partialErrors,
            errorCode: envelope.errorCode,
            errorMessage: envelope.errorMessage,
            retryable: false,
          };
        }

        return {
          attempted: true,
          succeeded: true,
          status: envelope.status,
          httpStatus,
          httpStatusOrigin: httpStatus !== null ? "OBSERVED" : "UNOBSERVED_NULL",
          startedAt,
          completedAt,
          durationMs: Math.max(0, Date.now() - startedAtMs),
          providerInvocationRef,
          upstreamRequestId,
          requestHash,
          rawResponseHash,
          requestedAsins: validAsins,
          marketplace,
          items: envelope.items,
          itemsByAsin: envelope.itemsByAsin,
          missingAsins: envelope.missingAsins,
          partialErrors: envelope.partialErrors,
          errorCode: envelope.errorCode,
          errorMessage: envelope.errorMessage,
          retryable: false,
        };
      };

      if (context.budget) {
        const budgetRes = await context.budget.executeBoundedOperation(
          `getItems:${context.candidateId}:${requestHash.slice(0, 8)}`,
          async (_attempt, opSignal) => {
            const out = await executeHttpCall(opSignal);
            if (!out.succeeded && out.retryable) {
              throw new Error(out.errorMessage || "RETRYABLE_CREATORS_API_ERROR");
            }
            return out;
          },
          {
            isExternalBlockResult: (r) =>
              r.status === "AUTHENTICATION_FAILED" ||
              r.status === "ACCESS_NOT_GRANTED" ||
              r.status === "RATE_LIMITED",
          }
        );

        if (budgetRes.blockedDecision && !budgetRes.executed) {
          const completedAt = new Date().toISOString();
          return {
            attempted: false,
            succeeded: false,
            status: "RATE_LIMITED",
            httpStatus: null,
            httpStatusOrigin: "UNOBSERVED_NULL",
            startedAt,
            completedAt,
            durationMs: Math.max(0, Date.now() - startedAtMs),
            providerInvocationRef,
            upstreamRequestId: null,
            requestHash,
            rawResponseHash: null,
            requestedAsins: validAsins,
            marketplace,
            items: [],
            itemsByAsin: {},
            missingAsins: validAsins,
            partialErrors: [],
            errorCode: budgetRes.blockedDecision.reasonCode,
            errorMessage: budgetRes.blockedDecision.reason,
            retryable: false,
          };
        }

        if (budgetRes.result) {
          return budgetRes.result;
        }
      }

      try {
        return await executeHttpCall(context.signal);
      } catch (err) {
        const classified = classifyCreatorsApiFailure(err);
        const completedAt = new Date().toISOString();
        return {
          attempted: true,
          succeeded: false,
          status: classified.status,
          httpStatus: null,
          httpStatusOrigin: "UNOBSERVED_NULL",
          startedAt,
          completedAt,
          durationMs: Math.max(0, Date.now() - startedAtMs),
          providerInvocationRef,
          upstreamRequestId: null,
          requestHash,
          rawResponseHash: null,
          requestedAsins: validAsins,
          marketplace,
          items: [],
          itemsByAsin: {},
          missingAsins: validAsins,
          partialErrors: [],
          errorCode: classified.errorCode,
          errorMessage: classified.sanitizedMessage,
          retryable: classified.retryable,
        };
      }
    },
  };
}
