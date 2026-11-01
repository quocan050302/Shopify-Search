/**
 * SWAI KH-02 V12.4.3.5.0.2 — Official Amazon Associates Creators API Client (US Marketplace)
 *
 * Implements Section 5B:
 * - resolveCreatorsApiEligibility(env, registrationStatus): AmazonAccessDecision
 * - createCreatorsApiClient(config): CreatorsApiClient
 * - searchItemsByCandidateIntent(intent, context): Promise<SearchItemsResponse>
 * - getItemsByAsins(asins, context): Promise<GetItemsResponse>
 * - classifyCreatorsApiFailure(error, response): ClassifiedCreatorsApiStatus
 *
 * Hard Compliance Boundaries:
 * - Uses ONLY official Amazon Associates Creators API endpoints:
 *   - OAuth 2.0 token endpoint (NA): https://api.amazon.com/auth/o2/token (grant_type=client_credentials)
 *   - SearchItems endpoint: https://creatorsapi.amazon/catalog/v1/searchItems
 *   - GetItems endpoint: https://creatorsapi.amazon/catalog/v1/getItems
 * - Marketplace header: x-marketplace: www.amazon.com
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
  "https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/search-items",
  "https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference",
  "https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-sdk",
  "https://affiliate-program.amazon.com/help/operating/policies",
] as const;

export const CREATORS_API_OAUTH_TOKEN_ENDPOINT = "https://api.amazon.com/auth/o2/token";
export const CREATORS_API_SEARCH_ITEMS_ENDPOINT =
  "https://creatorsapi.amazon/catalog/v1/searchItems";
export const CREATORS_API_GET_ITEMS_ENDPOINT =
  "https://creatorsapi.amazon/catalog/v1/getItems";
export const CREATORS_API_US_MARKETPLACE = "www.amazon.com";

export const CREATORS_API_DEFAULT_RESOURCES = [
  "ItemInfo.Title",
  "ItemInfo.ByLineInfo",
  "ItemInfo.Classifications",
  "ItemInfo.ExternalIds",
  "ItemInfo.ManufactureInfo",
  "ItemInfo.ProductInfo",
  "ItemInfo.Features",
  "Images.Primary.Medium",
  "Offers.V2.Listings.Price",
  "Offers.V2.Listings.Availability",
  "Offers.V2.Listings.MerchantInfo",
  "ParentASIN",
] as const;

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
  marketplace?: string;
  tokenEndpoint?: string;
  searchItemsEndpoint?: string;
  getItemsEndpoint?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export interface RawCreatorsApiItem {
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

export interface CreatorsApiClient {
  readonly marketplace: string;
  readonly partnerTagMasked: string;
  searchItemsByCandidateIntent(
    intent: CreatorsApiSearchIntentInput,
    context: CreatorsApiRequestContext
  ): Promise<SearchItemsResponse>;
  getItemsByAsins(
    asins: string[],
    context: CreatorsApiRequestContext
  ): Promise<GetItemsResponse>;
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
  msg = msg.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED_TOKEN]");
  msg = msg.replace(/client_secret=[^&\s]+/gi, "client_secret=[REDACTED_SECRET]");
  return msg.slice(0, 400);
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
    "2. Generate official Creators API OAuth 2.0 Credential ID and Credential Secret.",
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
  const errObj = response?.parsedJson?.Errors?.[0] || response?.parsedJson?.errors?.[0];
  const upstreamCode = String(
    errObj?.Code || errObj?.code || response?.parsedJson?.error || ""
  ).trim();
  const upstreamMsg = String(
    errObj?.Message ||
      errObj?.message ||
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
    /accessdenied|access_denied|invalidpartnertag|associatenoteligible|forbidden|not_authorized/i.test(
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

  if (
    /abort|timed_out|timeout|etimedout|deadline/i.test(combined)
  ) {
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
      (Array.isArray(response?.parsedJson?.SearchResult?.Items) &&
        response?.parsedJson?.SearchResult?.Items.length === 0))
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
 * Section 5B.7: Creates an official Amazon Associates Creators API client with short-lived OAuth 2.0
 * client_credentials token caching, strict US marketplace header, secret redaction, and shared budget integration.
 */
export function createCreatorsApiClient(
  config: CreatorsApiClientConfig
): CreatorsApiClient {
  const credentialId = String(config.credentialId || "").trim();
  const credentialSecret = String(config.credentialSecret || "").trim();
  const partnerTag = String(config.partnerTag || "").trim();
  const marketplace = String(config.marketplace || CREATORS_API_US_MARKETPLACE)
    .trim()
    .toLowerCase();
  const tokenEndpoint = config.tokenEndpoint || CREATORS_API_OAUTH_TOKEN_ENDPOINT;
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
  if (
    !tokenEndpoint.startsWith("https://") ||
    !searchItemsEndpoint.startsWith("https://") ||
    !getItemsEndpoint.startsWith("https://")
  ) {
    throw new Error(
      "BLOCKED_POLICY: CreatorsApiClient endpoints must use HTTPS."
    );
  }

  let cachedToken: { accessToken: string; expiresAtMs: number } | null = null;

  async function acquireBearerToken(signal?: AbortSignal): Promise<{
    ok: boolean;
    accessToken: string | null;
    httpStatus: number | null;
    classifiedError: ClassifiedCreatorsApiStatus | null;
  }> {
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAtMs - 60_000 > now) {
      return {
        ok: true,
        accessToken: cachedToken.accessToken,
        httpStatus: 200,
        classifiedError: null,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("TIMED_OUT")), timeoutMs);
    const onParentAbort = () => controller.abort(signal?.reason || new Error("ABORTED"));
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        return {
          ok: false,
          accessToken: null,
          httpStatus: null,
          classifiedError: classifyCreatorsApiFailure(new Error("TIMED_OUT")),
        };
      }
      signal.addEventListener("abort", onParentAbort, { once: true });
    }

    try {
      const formBody = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: credentialId,
        client_secret: credentialSecret,
      }).toString();

      const resp = await fetchImpl(tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: formBody,
        signal: controller.signal,
      });

      const httpStatus = typeof resp.status === "number" ? resp.status : null;
      const bodyText = await resp.text();
      let parsedJson: any = null;
      try {
        parsedJson = JSON.parse(bodyText);
      } catch {
        parsedJson = null;
      }

      if (!resp.ok || !parsedJson?.access_token) {
        const classified = classifyCreatorsApiFailure(null, {
          httpStatus: httpStatus ?? 401,
          bodyText: redactSecretsFromMessage(bodyText, [
            credentialId,
            credentialSecret,
          ]),
          parsedJson,
        });
        return {
          ok: false,
          accessToken: null,
          httpStatus,
          classifiedError: classified,
        };
      }

      const expiresInSec = Number(parsedJson.expires_in) || 3600;
      const accessToken = String(parsedJson.access_token).trim();
      cachedToken = {
        accessToken,
        expiresAtMs: Date.now() + Math.max(60, expiresInSec) * 1000,
      };
      return {
        ok: true,
        accessToken,
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
      return {
        ok: false,
        accessToken: null,
        httpStatus: null,
        classifiedError: classifyCreatorsApiFailure(sanitizedErr),
      };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onParentAbort);
    }
  }

  return {
    marketplace,
    partnerTagMasked: maskPartnerTag(partnerTag) || "***",

    async searchItemsByCandidateIntent(intent, context) {
      const startedAtMs = Date.now();
      const startedAt = new Date(startedAtMs).toISOString();
      const cleanKeywords = String(intent.normalizedKeywords || "").trim();
      const itemCount = Math.min(10, Math.max(1, intent.itemCount ?? 5));

      const requestPayload = {
        partnerTag,
        partnerType: "Associates",
        keywords: cleanKeywords,
        searchIndex: intent.searchIndex || "All",
        itemCount,
        resources: [...CREATORS_API_DEFAULT_RESOURCES],
      };

      const requestHash =
        computeDeterministicEvidenceHash({
          operation: "SearchItems",
          marketplace,
          keywords: cleanKeywords,
          itemCount,
          resources: CREATORS_API_DEFAULT_RESOURCES,
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
          errorCode: "EMPTY_SEARCH_KEYWORDS",
          errorMessage: "SearchItems keywords cannot be empty.",
          retryable: false,
        };
      }

      const executeHttpCall = async (opSignal?: AbortSignal): Promise<SearchItemsResponse> => {
        const tokenRes = await acquireBearerToken(opSignal || context.signal);
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
            errorCode: errInfo.errorCode,
            errorMessage: errInfo.sanitizedMessage,
            retryable: errInfo.retryable,
          };
        }

        const resp = await fetchImpl(searchItemsEndpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenRes.accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "x-marketplace": marketplace,
          },
          body: JSON.stringify(requestPayload),
          signal: opSignal || context.signal,
        });

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

        if (!resp.ok || !parsedJson) {
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
            errorCode: classified.errorCode,
            errorMessage: classified.sanitizedMessage,
            retryable: classified.retryable,
          };
        }

        const items: RawCreatorsApiItem[] = Array.isArray(
          parsedJson?.SearchResult?.Items
        )
          ? parsedJson.SearchResult.Items
          : [];
        const totalResultCount =
          typeof parsedJson?.SearchResult?.TotalResultCount === "number"
            ? parsedJson.SearchResult.TotalResultCount
            : items.length;

        if (items.length === 0) {
          return {
            attempted: true,
            succeeded: true,
            status: "QUERY_SUCCEEDED_EMPTY",
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
            totalResultCount: 0,
            items: [],
            errorCode: null,
            errorMessage: null,
            retryable: false,
          };
        }

        return {
          attempted: true,
          succeeded: true,
          status: "OBSERVED_UNVERIFIED",
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
          totalResultCount,
          items,
          errorCode: null,
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
          errorCode: classified.errorCode,
          errorMessage: classified.sanitizedMessage,
          retryable: classified.retryable,
        };
      }
    },

    async getItemsByAsins(asins, context) {
      const startedAtMs = Date.now();
      const startedAt = new Date(startedAtMs).toISOString();
      const validAsins = Array.from(
        new Set(
          (asins || [])
            .map((a) => String(a || "").trim().toUpperCase())
            .filter((a) => isValidStrictAmazonAsin(a))
        )
      ).slice(0, 10);

      const requestHash =
        computeDeterministicEvidenceHash({
          operation: "GetItems",
          marketplace,
          itemIds: validAsins,
          resources: CREATORS_API_DEFAULT_RESOURCES,
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
          errorCode: "NO_VALID_ASINS",
          errorMessage: "GetItems requires at least one valid 10-character Amazon ASIN.",
          retryable: false,
        };
      }

      const requestPayload = {
        partnerTag,
        partnerType: "Associates",
        itemIds: validAsins,
        itemIdType: "ASIN",
        resources: [...CREATORS_API_DEFAULT_RESOURCES],
      };

      const executeHttpCall = async (opSignal?: AbortSignal): Promise<GetItemsResponse> => {
        const tokenRes = await acquireBearerToken(opSignal || context.signal);
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
            errorCode: errInfo.errorCode,
            errorMessage: errInfo.sanitizedMessage,
            retryable: errInfo.retryable,
          };
        }

        const resp = await fetchImpl(getItemsEndpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenRes.accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "x-marketplace": marketplace,
          },
          body: JSON.stringify(requestPayload),
          signal: opSignal || context.signal,
        });

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

        if (!resp.ok || !parsedJson) {
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
            errorCode: classified.errorCode,
            errorMessage: classified.sanitizedMessage,
            retryable: classified.retryable,
          };
        }

        const items: RawCreatorsApiItem[] = Array.isArray(
          parsedJson?.ItemsResult?.Items
        )
          ? parsedJson.ItemsResult.Items
          : [];

        return {
          attempted: true,
          succeeded: true,
          status: items.length > 0 ? "OBSERVED_UNVERIFIED" : "QUERY_SUCCEEDED_EMPTY",
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
          items,
          errorCode: null,
          errorMessage: null,
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
          errorCode: classified.errorCode,
          errorMessage: classified.sanitizedMessage,
          retryable: classified.retryable,
        };
      }
    },
  };
}

