/**
 * SWAI KH-02 — Google Ads Transparency Center Adapter
 *
 * Queries Google Ads Transparency Center records by confirmed
 * advertiser domain or brand name to identify cross-platform commercial activity.
 *
 * Rules:
 * 1. Requires a confirmed landing page or advertiser domain from product candidates.
 * 2. Does not infer spend, conversion rates, ROAS, or product revenue.
 * 3. Classifies product relevance: PRODUCT_SPECIFIC vs BRAND_RELATED vs UNRELATED.
 * 4. Honest geographic market: unless delivery to US is confirmed in the record,
 *    verifiedDeliveryMarket remains null (never assumed "US").
 * 5. Supports standard MCP tool protocol (stdio or HTTP MCP transport) with
 *    capability discovery, schema validation, and fail-closed error handling.
 */

import fs from "fs";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { prisma } from "@/lib/db";
import { isSafePublicUrl } from "@/services/kh02/identity/productMetadataExtractor";
import {
  IntelligenceQuery,
  SourceResearchResult,
  SourceObservation,
  SourceRunStatus,
} from "../types";

export interface JsonSchemaProperty {
  type?: string;
  description?: string;
  enum?: string[];
  [key: string]: any;
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  [key: string]: any;
}

export interface GoogleMcpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
}

export interface GoogleMcpCapabilities {
  transportConnected: boolean;
  toolsDiscovered: GoogleMcpToolDescriptor[];
  supportedOperations: {
    domainLookup: boolean;
    advertiserSearch: boolean;
    adsRetrieval: boolean;
    adDetail: boolean;
    productDiscovery?: boolean;
    productEnrichment?: boolean;
  };
  matchedTools: {
    domainLookupTool?: string;
    advertiserSearchTool?: string;
    adsRetrievalTool?: string;
    adDetailTool?: string;
  };
  // V12.4.3.3 Section 4.1 Explicit Capability Flags
  TRANSPORT_CONNECTED: boolean;
  ADVERTISER_LOOKUP_SUPPORTED: boolean;
  AD_CREATIVE_RETRIEVAL_SUPPORTED: boolean;
  PRODUCT_DISCOVERY_SUPPORTED: boolean;
  PRODUCT_ENRICHMENT_SUPPORTED: boolean;
  capabilityClassification: "ENRICHMENT_ONLY" | "UNAVAILABLE";
  discoveredAt: string;
  errorMessage?: string;
}

export interface GoogleMcpContext {
  mcpUrl?: string;
  command?: string;
  args?: string[];
  timeoutMs?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface McpToolResult {
  success: boolean;
  toolName: string;
  data: any;
  error?: string;
  durationMs: number;
}

export interface AdMarketProvenance {
  requestedMarket: string | null;
  providerFilterMarket: string | null;
  providerReportedMarket: string | null;
  verifiedDeliveryMarket: string | null;
  verificationStatus: "VERIFIED" | "FILTER_ONLY" | "INFERRED" | "UNVERIFIED";
  evidenceReference: string | null;
}

export interface GoogleSourceMetadata {
  requestedDomain: string;
  topic?: string;
  observedAt: string;
  toolName: string;
  sourceUrl?: string;
  requestedMarket?: string;
  providerFilterMarket?: string;
}

export interface NormalizedGoogleAd {
  advertiserId: string;
  advertiserName: string;
  domain: string;
  creativeId: string;
  adFormat: "VIDEO" | "IMAGE" | "TEXT" | "UNKNOWN";
  observedContent: string | null;
  lastShownDate: string | null;
  googleSourceUrl: string | null;
  observedAt: string;
  productRelevance:
    | "PRODUCT_SPECIFIC"
    | "BRAND_RELATED"
    | "UNRELATED"
    | "UNKNOWN";
  productRelevanceReason?: string;
  sourceProvenance: string;
  sourceMarket: string | null;
  verifiedDeliveryMarket: string | null;
  marketProvenance: AdMarketProvenance;
}

export interface GoogleDiagnosticStateBreakdown {
  configured: boolean;
  transportConnected: boolean;
  toolDiscovered: boolean;
  operationSupported: boolean;
  advertiserLookupAttempted: boolean;
  queryAttempted?: boolean;
  querySucceeded?: boolean;
  advertiserFound: boolean;
  adsRetrieved: boolean;
  creativesReturned?: boolean;
  brandLevelMatch?: boolean;
  productLevelMatch?: boolean;
  productAssociatedEvidence: boolean;
  productEvidencePersisted?: boolean;
  currentRunProductEvidenceAvailable?: boolean;
  empty: boolean;
  failed: boolean;
  cached: boolean;
}

export interface GoogleDomainEnrichmentOutcome {
  domain: string;
  registrableDomain: string;
  attempted: boolean;
  status:
    | "SUCCEEDED_WITH_CREATIVES"
    | "SUCCEEDED_ADVERTISER_ONLY_NO_ADS"
    | "SUCCEEDED_NO_ADVERTISER"
    | "RATE_LIMITED"
    | "BLOCKED"
    | "TRANSPORT_FAILED"
    | "QUERY_FAILED"
    | "SKIPPED_COOLDOWN"
    | "SKIPPED_BUDGET";
  advertisersFound: number;
  creativesReturned: number;
  errorMessage: string | null;
}

export interface GoogleMcpProviderInvocationRecord {
  invocationId: string;
  providerRequestId: string | null;
  transportId: string;
  researchRunId: string | null;
  toolName: string;
  advertiserId: string | null;
  domain: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  sourceMode: "LIVE_PROVIDER" | "CACHED" | "UNKNOWN";
  status: "SUCCEEDED" | "FAILED" | "TIMED_OUT";
  returnedCreativeIds: string[];
  missingCreativeIdCount: number;
  responseEvidenceRef: string | null;
  lineageAvailable: boolean;
}

export interface GoogleEnrichmentExecution {
  attemptedDomains: string[];
  advertiserLookupSucceeded: boolean;
  advertisersFound: number;
  creativeQuerySucceeded: boolean;
  creativesReturned: number;
  normalizedObservations: number;
  productLevelMatches: number;
  brandLevelMatches: number;
  productEvidenceIds: string[];
  persistedRecordIds?: string[];
  domainOutcomes?: GoogleDomainEnrichmentOutcome[];
  queryErrors: string[];
  queryTimestamp: string | null;
  isControlledMcp?: boolean;
  stateBreakdown?: GoogleDiagnosticStateBreakdown;
  /** V12.4.3.3.1 Section 6 & 7: Separate counters and step timeline for per-operation diagnostics */
  domainsPlanned?: number;
  domainsAttempted?: number;
  domainsSucceeded?: number;
  domainsEmpty?: number;
  domainsRateLimited?: number;
  domainsFailed?: number;
  creativesRetrievedCount?: number;
  rawCreatives?: any[];
  normalizedDistinct?: number;
  rejectedBeforeNormalization?: number;
  classifiedDistinct?: number;
  normalizedRecords?: any[];
  mcpCallsStarted?: number;
  mcpCallsCompleted?: number;
  cleanupCompleted?: boolean;
  mcpInvocations?: Array<{
    domain: string;
    toolName: string;
    arguments: Record<string, unknown>;
    startedAt: string;
    completedAt: string;
    durationMs: number;
    status: "SUCCEEDED" | "FAILED" | "TIMED_OUT";
    returnedCount: number;
    errorMessage?: string | null;
  }>;
  stepTimeline?: Array<{
    step: string;
    status: "COMPLETED" | "FAILED" | "TIMED_OUT" | "SKIPPED";
    startedAt: string;
    completedAt: string;
    durationMs: number;
    detail?: string;
  }>;
  /** V12.4.3.4.1 Section 7.2: Forensic per-creative association ledger and telemetry */
  productAssociatedCount?: number;
  brandOnlyCount?: number;
  rejectedCount?: number;
  unmatchedCount?: number;
  timeoutCount?: number;
  creativeAssociationLedger?: Array<{
    creativeId: string;
    advertiserDomain: string | null;
    sourceMarket: string;
    rawLandingUrl: string | null;
    finalDestination: string | null;
    normalizedProductUrl: string | null;
    creativeTitle: string | null;
    candidateIdsEvaluated: string[];
    exactMatchingClassification: string | null;
    associationClassification?: string;
    sourceMode?: "LIVE_PROVIDER" | "CACHED" | "UNKNOWN";
    matchingEvidence: string | null;
    rejectionReason: string | null;
    associationVerdict:
      | "EXACT_PRODUCT_MATCH"
      | "PROBABLE_PRODUCT_MATCH"
      | "BRAND_ONLY_MATCH"
      | "REJECTED_UNRELATED_CREATIVE"
      | "UNMATCHED"
      | "MISSING_DESTINATION"
      | "UPSTREAM_TIMEOUT";
  }>;
  creativeRejections?: Array<{
    creativeId: string;
    advertiserDomain: string | null;
    rejectionReason: string;
    matchedCandidateId: string | null;
  }>;
  providerInvocationRecords?: GoogleMcpProviderInvocationRecord[];
  rejectedRecords?: Array<{
    creativeId: string | null;
    advertiserId?: string | null;
    domain: string;
    researchRunId: string | null;
    rejectionReason: string;
  }>;
}

async function withOperationDeadline<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  parentSignal?: AbortSignal
): Promise<T> {
  if (parentSignal?.aborted) {
    throw new Error("Operation cancelled by parent signal");
  }
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    if (parentSignal) {
      onAbort = () => {
        if (timer !== undefined) clearTimeout(timer);
        reject(new Error("Operation cancelled by parent signal"));
      };
      parentSignal.addEventListener("abort", onAbort, { once: true });
    }
  });
  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (parentSignal && onAbort) {
      parentSignal.removeEventListener("abort", onAbort);
    }
  }
}

const PLATFORM_AND_REDIRECT_DOMAINS = new Set([
  "facebook.com",
  "fb.com",
  "fb.me",
  "m.facebook.com",
  "l.facebook.com",
  "lm.facebook.com",
  "instagram.com",
  "google.com",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "pinterest.com",
  "twitter.com",
  "x.com",
  "reddit.com",
  "linkedin.com",
  "lnkd.in",
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "linktr.ee",
  "ow.ly",
  "buff.ly",
  "localhost",
]);

/**
 * Extracts the canonical registrable domain from a hostname or URL.
 * V12.4.3.3 Section 4.2:
 * - Unwraps redirect URLs (e.g. l.facebook.com/l.php?u=..., google.com/url?q=...).
 * - Rejects platform-owned and link-shortener domains (returns "").
 * - Rejects invalid hostnames, IPs, and strings without a valid TLD (returns "").
 * - Strips subdomains (e.g., cc.uprootclean.com -> uprootclean.com, store.brand.co.uk -> brand.co.uk).
 */
export function extractRegistrableDomain(domainOrUrl: string): string {
  if (!domainOrUrl || typeof domainOrUrl !== "string") return "";
  let candidate = domainOrUrl.trim();
  if (!candidate) return "";

  // Attempt to unwrap redirect URLs (l.facebook.com/l.php?u=..., google.com/url?q=...)
  if (/^https?:\/\//i.test(candidate) || candidate.includes("?")) {
    try {
      const parsed = new URL(
        /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`
      );
      const hostLower = parsed.hostname.toLowerCase();
      if (
        hostLower.endsWith("facebook.com") ||
        hostLower.endsWith("fb.com") ||
        hostLower.endsWith("google.com") ||
        hostLower.endsWith("tiktok.com")
      ) {
        const redirectTarget =
          parsed.searchParams.get("u") ||
          parsed.searchParams.get("q") ||
          parsed.searchParams.get("url") ||
          parsed.searchParams.get("target");
        if (redirectTarget) {
          try {
            candidate = decodeURIComponent(redirectTarget).trim();
          } catch {
            candidate = redirectTarget.trim();
          }
        }
      }
    } catch {
      // Fallback to string cleanup below
    }
  }

  const clean = candidate
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/^\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^\.+|\.+$/g, "");

  if (!clean || !clean.includes(".") || /\s/.test(clean)) return "";
  // Reject IPv4 addresses or invalid characters
  if (/^\d+(\.\d+){3}$/.test(clean) || !/^[a-z0-9.-]+$/.test(clean)) return "";

  const parts = clean.split(".").filter(Boolean);
  if (parts.length < 2) return "";
  const tld = parts[parts.length - 1];
  if (!/^[a-z]{2,18}$/.test(tld)) return "";

  let regDomain: string;
  if (parts.length <= 2) {
    regDomain = parts.join(".");
  } else {
    const secondLast = parts[parts.length - 2];
    if (
      ["co", "com", "net", "org", "gov", "edu", "ac"].includes(secondLast) &&
      tld.length === 2 &&
      parts.length >= 3
    ) {
      regDomain = parts.slice(-3).join(".");
    } else {
      regDomain = parts.slice(-2).join(".");
    }
  }

  if (
    PLATFORM_AND_REDIRECT_DOMAINS.has(clean) ||
    PLATFORM_AND_REDIRECT_DOMAINS.has(regDomain)
  ) {
    return "";
  }

  return regDomain;
}

export function clearGoogleRateLimitCooldown(): void {
  delete (globalThis as any).__swaiGoogleRateLimitUntil;
}

export function isGoogleRateLimitCooldownActive(): boolean {
  const until = (globalThis as any).__swaiGoogleRateLimitUntil;
  return typeof until === "number" && Date.now() < until;
}

export interface NormalizedAdsResult {
  ads: NormalizedGoogleAd[];
  observations: SourceObservation[];
  totalExtracted: number;
}

export interface GoogleTransparencyMcpClient {
  connect(): Promise<void>;
  listTools(): Promise<string[]>;
  listToolsWithSchemas?(): Promise<GoogleMcpToolDescriptor[]>;
  callToolByName?(name: string, args: Record<string, unknown>): Promise<any>;
  searchAdvertisers(query: string): Promise<any>;
  searchAdvertiserByDomain(domain: string): Promise<any>;
  getAds(advertiserId: string, region?: string): Promise<any>;
  getAdDetail(creativeId: string): Promise<any>;
  close(): Promise<void>;
  isAlive(): boolean;
}

/**
 * Decodes MCP CallToolResult payload:
 * Handles structuredContent, content text JSON, isError, and raw responses.
 */
export function decodeCallToolResult(result: any): any {
  if (!result) return null;

  // Check if provider explicitly returned an MCP execution error
  if (result.isError) {
    const errorText = Array.isArray(result.content)
      ? result.content.map((c: any) => c.text || JSON.stringify(c)).join("; ")
      : result.error ||
        "Google Ads Transparency MCP tool returned isError: true";
    throw new Error(errorText);
  }

  // 1. Structured Content
  if (
    result.structuredContent !== undefined &&
    result.structuredContent !== null
  ) {
    return result.structuredContent;
  }

  // 2. Content array with JSON in text
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item && item.type === "text" && typeof item.text === "string") {
        try {
          return JSON.parse(item.text);
        } catch {
          if (result.content.length === 1) return item.text;
        }
      }
    }
  }

  // 3. Fallback to direct data payload
  if (result.data !== undefined) return result.data;
  return result;
}

/**
 * Validates tool arguments against an advertised JSON Schema.
 */
export function validateGoogleMcpToolArguments(
  toolSchema: JsonSchema | undefined,
  argumentsValue: unknown,
): ValidationResult {
  const errors: string[] = [];

  if (!toolSchema || typeof toolSchema !== "object") {
    return { valid: true, errors: [] };
  }

  if (argumentsValue === null || typeof argumentsValue !== "object") {
    return {
      valid: false,
      errors: ["Arguments must be a valid non-null object."],
    };
  }

  const argsObj = argumentsValue as Record<string, unknown>;

  // 1. Check required fields
  if (Array.isArray(toolSchema.required)) {
    for (const reqKey of toolSchema.required) {
      if (
        !(reqKey in argsObj) ||
        argsObj[reqKey] === undefined ||
        argsObj[reqKey] === null
      ) {
        errors.push(`Missing required parameter: '${reqKey}'`);
      }
    }
  }

  // 2. Check property types
  if (toolSchema.properties && typeof toolSchema.properties === "object") {
    for (const [propName, propSchema] of Object.entries(
      toolSchema.properties,
    )) {
      if (
        propName in argsObj &&
        argsObj[propName] !== undefined &&
        argsObj[propName] !== null
      ) {
        const val = argsObj[propName];
        const expectedType = propSchema.type?.toLowerCase();

        if (expectedType === "string" && typeof val !== "string") {
          errors.push(
            `Parameter '${propName}' expected string, received ${typeof val}`,
          );
        } else if (expectedType === "number" && typeof val !== "number") {
          errors.push(
            `Parameter '${propName}' expected number, received ${typeof val}`,
          );
        } else if (
          expectedType === "integer" &&
          (!Number.isInteger(val) || typeof val !== "number")
        ) {
          errors.push(
            `Parameter '${propName}' expected integer, received ${typeof val}`,
          );
        } else if (expectedType === "boolean" && typeof val !== "boolean") {
          errors.push(
            `Parameter '${propName}' expected boolean, received ${typeof val}`,
          );
        } else if (expectedType === "array" && !Array.isArray(val)) {
          errors.push(
            `Parameter '${propName}' expected array, received ${typeof val}`,
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Discovers advertised capabilities from an active Google Ads MCP server.
 */
export async function discoverGoogleAdsMcpCapabilities(
  context: GoogleMcpContext = {},
  clientArg?: GoogleTransparencyMcpClient,
): Promise<GoogleMcpCapabilities> {
  const discoveredAt = new Date().toISOString();
  const resolved = resolveGoogleMcpConfig();
  const mcpUrl =
    context.mcpUrl !== undefined ? context.mcpUrl : resolved.mcpUrl;
  const command =
    context.command !== undefined
      ? context.command
      : context.mcpUrl
        ? undefined
        : resolved.command;
  const client =
    clientArg ||
    createGoogleTransparencyMcpClient({
      mcpUrl,
      command,
      args: context.args || resolved.args,
    });

  try {
    await client.connect();
    const isConnected = client.isAlive();

    let toolDescriptors: GoogleMcpToolDescriptor[] = [];
    if (typeof client.listToolsWithSchemas === "function") {
      toolDescriptors = await client.listToolsWithSchemas();
    } else {
      const toolNames = await client.listTools();
      toolDescriptors = toolNames.map((name) => ({
        name,
        inputSchema: { type: "object" },
      }));
    }

    const advertiserSearchTool = toolDescriptors.find((t) =>
      /^search_advertiser$|^find_advertiser$|search.*advertiser/i.test(t.name),
    )?.name;

    const domainLookupTool =
      toolDescriptors.find((t) => /domain/i.test(t.name))?.name ||
      advertiserSearchTool; // In gads-transparency-mcp, search_advertiser handles domain lookups

    const adsRetrievalTool = toolDescriptors.find((t) =>
      /^get_advertiser_ads$|(get|search|list).*ads/i.test(t.name),
    )?.name;

    const adDetailTool = toolDescriptors.find((t) =>
      /^get_ad_details?$|(get|find).*ad.*detail|creative.*detail/i.test(t.name),
    )?.name;

    const advLookupSupported = Boolean(domainLookupTool || advertiserSearchTool);
    const creativeRetrievalSupported = Boolean(adsRetrievalTool);
    const enrichmentSupported = Boolean(isConnected && advLookupSupported && creativeRetrievalSupported);

    return {
      transportConnected: isConnected,
      toolsDiscovered: toolDescriptors,
      supportedOperations: {
        domainLookup: Boolean(domainLookupTool),
        advertiserSearch: Boolean(advertiserSearchTool),
        adsRetrieval: Boolean(adsRetrievalTool),
        adDetail: Boolean(adDetailTool),
        productDiscovery: false,
        productEnrichment: enrichmentSupported,
      },
      matchedTools: {
        domainLookupTool,
        advertiserSearchTool,
        adsRetrievalTool,
        adDetailTool,
      },
      TRANSPORT_CONNECTED: isConnected,
      ADVERTISER_LOOKUP_SUPPORTED: advLookupSupported,
      AD_CREATIVE_RETRIEVAL_SUPPORTED: creativeRetrievalSupported,
      PRODUCT_DISCOVERY_SUPPORTED: false,
      PRODUCT_ENRICHMENT_SUPPORTED: enrichmentSupported,
      capabilityClassification: enrichmentSupported ? "ENRICHMENT_ONLY" : "UNAVAILABLE",
      discoveredAt,
    };
  } catch (err: any) {
    return {
      transportConnected: false,
      toolsDiscovered: [],
      supportedOperations: {
        domainLookup: false,
        advertiserSearch: false,
        adsRetrieval: false,
        adDetail: false,
        productDiscovery: false,
        productEnrichment: false,
      },
      matchedTools: {},
      TRANSPORT_CONNECTED: false,
      ADVERTISER_LOOKUP_SUPPORTED: false,
      AD_CREATIVE_RETRIEVAL_SUPPORTED: false,
      PRODUCT_DISCOVERY_SUPPORTED: false,
      PRODUCT_ENRICHMENT_SUPPORTED: false,
      capabilityClassification: "UNAVAILABLE",
      discoveredAt,
      errorMessage: err?.message || String(err),
    };
  } finally {
    // Probes own their subprocess; research callers retain their shared client.
    if (!clientArg) await client.close().catch(() => {});
  }
}

/**
 * Invokes an MCP tool with schema validation and deadline control.
 */
export async function invokeGoogleMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  context: GoogleMcpContext = {},
  clientArg?: GoogleTransparencyMcpClient,
  schema?: JsonSchema,
): Promise<McpToolResult> {
  const start = Date.now();
  const validation = validateGoogleMcpToolArguments(schema, args);
  if (!validation.valid) {
    return {
      success: false,
      toolName,
      data: null,
      error: `Schema validation failed: ${validation.errors.join("; ")}`,
      durationMs: Date.now() - start,
    };
  }

  const client =
    clientArg ||
    createGoogleTransparencyMcpClient({
      mcpUrl: context.mcpUrl,
      command: context.command,
      args: context.args,
    });

  try {
    if (!client.isAlive()) {
      await client.connect();
    }

    let resultData: any;
    if (
      toolName === "search_advertiser_by_domain" ||
      /domain/i.test(toolName)
    ) {
      resultData = await client.searchAdvertiserByDomain(
        String(args.domain || ""),
      );
    } else if (toolName === "search_advertisers") {
      resultData = await client.searchAdvertisers(String(args.query || ""));
    } else if (toolName === "get_ads" || /ads/i.test(toolName)) {
      resultData = await client.getAds(
        String(args.advertiser_id || ""),
        String(args.region || "US"),
      );
    } else if (toolName === "get_ad_detail" || /detail/i.test(toolName)) {
      resultData = await client.getAdDetail(String(args.creative_id || ""));
    } else {
      throw new Error(`Unsupported tool name: ${toolName}`);
    }

    return {
      success: true,
      toolName,
      data: resultData,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      success: false,
      toolName,
      data: null,
      error: err.message || "MCP invocation error",
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Normalizes raw Google Ads response into typed ads and SourceObservations.
 */
export function normalizeGoogleAdsResponse(
  rawResponse: unknown,
  metadata: GoogleSourceMetadata,
): NormalizedAdsResult {
  const decoded = decodeCallToolResult(rawResponse);
  const adsArray: any[] = Array.isArray(decoded?.ads)
    ? decoded.ads
    : Array.isArray(decoded)
      ? decoded
      : Array.isArray(decoded?.data)
        ? decoded.data
        : Array.isArray(decoded?.creatives)
          ? decoded.creatives
          : [];

  const requestedMarket =
    decoded?.requested_region || metadata.requestedMarket || "US";
  const providerFilterMarket =
    decoded?.provider_filter_region ||
    metadata.providerFilterMarket ||
    (decoded?.requested_region ? decoded.requested_region : "US");

  const normalizedAds: NormalizedGoogleAd[] = [];
  const observations: SourceObservation[] = [];

  for (const ad of adsArray) {
    const creativeId = String(ad.creative_id || ad.id || "");
    if (!creativeId) continue;

    const format =
      ad.format === "video"
        ? "VIDEO"
        : ad.format === "image"
          ? "IMAGE"
          : "TEXT";

    // Evaluate product relevance against topic and concrete product indicators (Section 7.3)
    const headline = ad.headline || ad.content?.headline || "";
    const body = ad.body || ad.content?.description || "";
    const destUrl =
      ad.destination_url ||
      ad.content?.destination_url ||
      ad.landing_page_url ||
      null;
    let urlPathText = "";
    if (destUrl) {
      try {
        const parsedDest = new URL(destUrl);
        urlPathText = parsedDest.pathname.replace(/[\/_-]+/g, " ");
      } catch {
        urlPathText = destUrl;
      }
    }
    const domainPrefix = (metadata.requestedDomain || "")
      .toLowerCase()
      .split(".")[0];
    const textContent = `${headline} ${body} ${urlPathText}`
      .toLowerCase()
      .trim();
    const topicWords = metadata.topic
      ? metadata.topic
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2 && w !== domainPrefix)
      : [];
    const hasTopicMatch =
      topicWords.length > 0 && topicWords.some((w) => textContent.includes(w));
    const hasSpecificProductSignal =
      Boolean(destUrl && /\/products\/|\/dp\/|\/p\/|\/item\//i.test(destUrl)) ||
      (hasTopicMatch && headline.trim().split(/\s+/).length >= 2);
    const relevance:
      | "PRODUCT_SPECIFIC"
      | "BRAND_RELATED"
      | "UNRELATED"
      | "UNKNOWN" =
      hasSpecificProductSignal || hasTopicMatch
        ? "PRODUCT_SPECIFIC"
        : "BRAND_RELATED";

    // Strict market verification:
    // A request filter or query parameter ("US") is FILTER_ONLY.
    // verifiedDeliveryMarket is ONLY populated if the upstream provider explicitly and independently
    // reports delivery geography for this specific ad (e.g. reported_delivery_region, delivery_country, verified_region).
    const providerReportedMarket: string | null =
      ad.reported_delivery_region ||
      ad.delivery_region ||
      ad.delivery_country ||
      ad.verified_region ||
      ad.region ||
      null;

    let verifiedDeliveryMarket: string | null = null;
    let verificationStatus:
      | "VERIFIED"
      | "FILTER_ONLY"
      | "INFERRED"
      | "UNVERIFIED" = "UNVERIFIED";

    if (providerReportedMarket === "US" || providerReportedMarket === "USA") {
      verifiedDeliveryMarket = "US";
      verificationStatus = "VERIFIED";
    } else if (
      providerReportedMarket &&
      providerReportedMarket !== "US" &&
      providerReportedMarket !== "USA"
    ) {
      verifiedDeliveryMarket = null;
      verificationStatus = "UNVERIFIED";
    } else if (providerFilterMarket === "US" || requestedMarket === "US") {
      // Query filter requested US delivery, but ad-level delivery evidence was not reported by upstream
      verifiedDeliveryMarket = null;
      verificationStatus = "FILTER_ONLY";
    } else {
      verifiedDeliveryMarket = null;
      verificationStatus = "UNVERIFIED";
    }

    const marketProvenance: AdMarketProvenance = {
      requestedMarket: requestedMarket || "US",
      providerFilterMarket: providerFilterMarket || requestedMarket || "US",
      providerReportedMarket,
      verifiedDeliveryMarket,
      verificationStatus,
      evidenceReference: verifiedDeliveryMarket
        ? `GoogleReportedDelivery:${creativeId}`
        : `GoogleQueryFilter:${creativeId}`,
    };

    const normAd: NormalizedGoogleAd = {
      advertiserId: String(ad.advertiser_id || ""),
      advertiserName: String(ad.advertiser_name || metadata.requestedDomain),
      domain: metadata.requestedDomain,
      creativeId,
      adFormat: format,
      observedContent: [headline, body].filter(Boolean).join(" ") || null,
      lastShownDate: ad.last_shown || null,
      googleSourceUrl:
        ad.source_url ||
        `https://adstransparency.google.com/advertiser/${ad.advertiser_id || ""}`,
      observedAt: metadata.observedAt,
      productRelevance: relevance,
      productRelevanceReason: hasTopicMatch
        ? `Matched topic keywords in Google ad copy`
        : `Domain verified but creative has brand-level focus`,
      sourceProvenance: "REAL_UPSTREAM",
      sourceMarket: providerReportedMarket,
      verifiedDeliveryMarket,
      marketProvenance,
    };
    normalizedAds.push(normAd);

    observations.push({
      source: "GOOGLE_ADS",
      sourceRecordId: creativeId,
      sourceUrl: normAd.googleSourceUrl,
      landingPageUrl: destUrl,
      advertiserOrCreator: normAd.advertiserName,
      advertiserDomain: metadata.requestedDomain,
      productMatchHint: normAd.observedContent,
      reportedPublishedAt: null,
      reportedFirstShownAt: ad.first_shown || null,
      reportedLastShownAt: normAd.lastShownDate,
      observedAt: metadata.observedAt,
      requestedMarket: requestedMarket || "US",
      verifiedDeliveryMarket,
      title: headline || null,
      description: body || null,
      metrics: {
        lastShown: normAd.lastShownDate,
        format,
        productRelevance: relevance,
        marketProvenance,
      },
      media: {
        thumbnailUrl: ad.thumbnail_url || ad.content?.image_url || null,
        videoUrl: ad.video_url || ad.content?.video_url || null,
        mediaType: format,
      },
      provenance: "REAL_UPSTREAM",
      sourceMode: "LIVE_PROVIDER",
      sourceType: "LIVE_PROVIDER",
      isCached: false,
      isLiveRecord: true,
      sourceObservationId: `sobs_google_${creativeId}`,
      evidenceReference: `GoogleAd:${creativeId}`,
    });
  }

  return {
    ads: normalizedAds,
    observations,
    totalExtracted: normalizedAds.length,
  };
}

function resolveLocalGoogleMcpDefaults(): {
  command?: string;
  args?: string[];
} {
  try {
    const cwd = String(process.cwd());
    const venvParts = [
      "services",
      "google-transparency",
      [".", "venv"].join(""),
    ];
    const posixPy = path.join(cwd, ...venvParts, "bin", "python");
    const winPy = path.join(cwd, ...venvParts, "Scripts", "python.exe");
    const serverScript = path.join(
      cwd,
      "scripts",
      "googleTransparencyServer.py",
    );
    if (!fs.existsSync(serverScript)) return {};
    if (fs.existsSync(posixPy)) {
      return { command: posixPy, args: [serverScript] };
    }
    if (fs.existsSync(winPy)) {
      return { command: winPy, args: [serverScript] };
    }
  } catch {}
  return {};
}

/**
 * Resolves Google MCP configuration from environment or parameters safely,
 * stripping outer quotes from executable paths and parsing JSON or bracketed arguments.
 */
export function resolveGoogleMcpConfig(): {
  command?: string;
  args?: string[];
  mcpUrl?: string;
} {
  const mcpUrl =
    process.env.GOOGLE_TRANSPARENCY_MCP_URL ||
    process.env.GOOGLE_ADS_MCP_URL ||
    undefined;

  let rawCommand = process.env.GOOGLE_TRANSPARENCY_MCP_COMMAND;
  let command: string | undefined = undefined;
  if (rawCommand && typeof rawCommand === "string") {
    let trimmed = rawCommand.trim();
    if (
      (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
    ) {
      trimmed = trimmed.slice(1, -1).trim();
    }
    if (trimmed.length > 0) command = trimmed;
  }

  let args: string[] | undefined = undefined;
  const rawArgs = process.env.GOOGLE_TRANSPARENCY_MCP_ARGS;
  if (rawArgs && typeof rawArgs === "string") {
    const trimmed = rawArgs.trim();
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        args = parsed.map((item) => {
          let s = String(item).trim();
          if (
            (s.startsWith("'") && s.endsWith("'")) ||
            (s.startsWith('"') && s.endsWith('"'))
          ) {
            s = s.slice(1, -1).trim();
          }
          return s;
        });
      } else if (typeof parsed === "string") {
        let s = parsed.trim();
        if (
          (s.startsWith("'") && s.endsWith("'")) ||
          (s.startsWith('"') && s.endsWith('"'))
        ) {
          s = s.slice(1, -1).trim();
        }
        args = [s];
      }
    } catch {
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try {
          const cleaned = trimmed.slice(1, -1).replace(/'/g, '"');
          const parsed = JSON.parse(`[${cleaned}]`);
          if (Array.isArray(parsed)) args = parsed.map(String);
        } catch {}
      }
      if (!args && trimmed.length > 0) {
        let clean = trimmed;
        if (
          (clean.startsWith("'") && clean.endsWith("'")) ||
          (clean.startsWith('"') && clean.endsWith('"'))
        ) {
          clean = clean.slice(1, -1).trim();
        }
        args = [clean];
      }
    }
  }

  // Outside unit tests, if env vars were not loaded (e.g. standalone CLI script reading .env without .env.local),
  // auto-detect the local Google Transparency virtualenv and bridge script if installed.
  if (
    !mcpUrl &&
    !command &&
    !process.env.VITEST &&
    process.env.NODE_ENV !== "test" &&
    process.env.GOOGLE_TRANSPARENCY_ENABLED !== "false"
  ) {
    const localDefaults = resolveLocalGoogleMcpDefaults();
    if (localDefaults.command) {
      command = localDefaults.command;
      args = localDefaults.args;
    }
  }

  return { command, args, mcpUrl };
}

/**
 * Creates a Google Ads Transparency MCP client supporting stdio or HTTP MCP gateway.
 */
export function createGoogleTransparencyMcpClient(config?: {
  mcpUrl?: string;
  command?: string;
  args?: string[];
}): GoogleTransparencyMcpClient {
  const resolved = resolveGoogleMcpConfig();
  const mcpUrl = config?.mcpUrl !== undefined ? config.mcpUrl : resolved.mcpUrl;
  const command =
    config?.command !== undefined
      ? config.command
      : config?.mcpUrl
        ? undefined
        : resolved.command;
  const args = config?.args || resolved.args || [];

  let mcpClient: Client | null = null;
  let transport: StdioClientTransport | null = null;
  let connected = false;

  async function sendMcpJsonRpc(
    method: string,
    params: any = {},
  ): Promise<any> {
    if (!mcpUrl) throw new Error("No MCP URL configured");
    const isSafe = isSafePublicUrl(mcpUrl);
    if (!isSafe) {
      throw new Error(
        `SSRF Security Guard: Blocked potential SSRF endpoint '${mcpUrl}'`,
      );
    }

    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      throw new Error(
        `Google Ads Transparency MCP transport error: HTTP ${res.status}`,
      );
    }

    const json = await res.json();
    if (json.error) {
      throw new Error(
        json.error.message || `MCP Error ${json.error.code || ""}`,
      );
    }

    return json.result;
  }

  return {
    async connect(): Promise<void> {
      if (connected) return;

      if (command) {
        if (/[;&|`$\n]/.test(command)) {
          throw new Error(
            "Security Exception: Command contains forbidden shell metacharacters in MCP command",
          );
        }
        let effectiveCommand = command;
        let effectiveArgs = args;
        try {
          if (
            !fs.existsSync(effectiveCommand) &&
            effectiveCommand.includes("services/google-transparency")
          ) {
            const localDefaults = resolveLocalGoogleMcpDefaults();
            if (localDefaults.command) {
              effectiveCommand = localDefaults.command;
              effectiveArgs = localDefaults.args || args;
            }
          }
        } catch {}

        transport = new StdioClientTransport({
          command: effectiveCommand,
          args: effectiveArgs,
          env: {
            ...process.env,
            PYTHONUNBUFFERED: "1",
            PYTHONUTF8: "1",
            PYTHONIOENCODING: "utf-8",
            LANG: "en_US.UTF-8",
          },
        });
        mcpClient = new Client(
          { name: "swai-google-transparency-client", version: "12.4.3" },
          { capabilities: {} },
        );
        await mcpClient.connect(transport);
        connected = true;
      } else if (mcpUrl) {
        // Standard MCP initialize negotiation lifecycle
        await sendMcpJsonRpc("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "swai-google-transparency-client",
            version: "12.2.2",
          },
        });
        await sendMcpJsonRpc("notifications/initialized", {}).catch(() => {});
        await sendMcpJsonRpc("tools/list", {});
        connected = true;
      } else {
        throw new Error("No Google Transparency MCP URL or command configured");
      }
    },

    async listTools(): Promise<string[]> {
      if (!connected) throw new Error("Client not connected");
      if (mcpClient) {
        const toolsResult = await mcpClient.listTools();
        return toolsResult.tools.map((t) => t.name);
      }
      if (mcpUrl) {
        const result = await sendMcpJsonRpc("tools/list", {});
        const tools = result?.tools || [];
        return Array.isArray(tools) ? tools.map((t: any) => t.name || t) : [];
      }
      return [];
    },

    async listToolsWithSchemas(): Promise<GoogleMcpToolDescriptor[]> {
      if (!connected) throw new Error("Client not connected");
      if (mcpClient) {
        const toolsResult = await mcpClient.listTools();
        return toolsResult.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as JsonSchema,
        }));
      }
      if (mcpUrl) {
        const result = await sendMcpJsonRpc("tools/list", {});
        const tools = result?.tools || [];
        return Array.isArray(tools)
          ? tools.map((t: any) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema || { type: "object" },
            }))
          : [];
      }
      return [];
    },

    async callToolByName(
      name: string,
      argsObj: Record<string, unknown>,
    ): Promise<any> {
      if (!connected) throw new Error("Client not connected");
      let rawResult: any;
      if (mcpClient) {
        rawResult = await mcpClient.callTool({
          name,
          arguments: argsObj,
        });
      } else if (mcpUrl) {
        rawResult = await sendMcpJsonRpc("tools/call", {
          name,
          arguments: argsObj,
        });
      } else {
        throw new Error("No transport available");
      }
      return decodeCallToolResult(rawResult);
    },

    async searchAdvertisers(queryText: string): Promise<any> {
      return this.callToolByName!("search_advertiser", {
        query: queryText,
      }).catch(() =>
        this.callToolByName!("search_advertisers", { query: queryText }),
      );
    },

    async searchAdvertiserByDomain(domain: string): Promise<any> {
      return this.callToolByName!("search_advertiser", { query: domain }).catch(
        () => this.callToolByName!("search_advertiser_by_domain", { domain }),
      );
    },

    async getAds(advertiserId: string, region?: string): Promise<any> {
      return this.callToolByName!("get_advertiser_ads", {
        advertiser_id: advertiserId,
        region: region || "US",
      }).catch(() =>
        this.callToolByName!("get_ads", {
          advertiser_id: advertiserId,
          region: region || "US",
        }),
      );
    },

    async getAdDetail(creativeId: string): Promise<any> {
      return this.callToolByName!("get_ad_details", {
        creative_id: creativeId,
      }).catch(() =>
        this.callToolByName!("get_ad_detail", { creative_id: creativeId }),
      );
    },

    async close(): Promise<void> {
      if (transport) {
        await transport.close().catch(() => {});
        transport = null;
      }
      mcpClient = null;
      connected = false;
    },

    isAlive(): boolean {
      return connected;
    },
  };
}

export interface GoogleEnrichmentOptions {
  maxDomains?: number;
  maxAdsCallsPerDomain?: number;
  persistToDatabase?: boolean;
  /** V12.4.3.3.1: Per-operation deadline (ms) for MCP client.connect() — default 8 000 */
  connectTimeoutMs?: number;
  /** V12.4.3.3.1: Per-operation deadline (ms) for tool-discovery — default 5 000 */
  toolDiscoveryTimeoutMs?: number;
  /** V12.4.3.3.1: Per-operation deadline (ms) per domain lookup (advertiser search + ads retrieval) — default 15 000 */
  perDomainTimeoutMs?: number;
}

/**
 * Persists normalized Google Transparency observations into SQLite (`CompetitorAd` & `AdObservation`)
 * so that product-level and brand-level Google evidence survives database reload.
 */
export async function persistGoogleObservationsToDatabase(
  observations: SourceObservation[],
  workspaceId?: string
): Promise<string[]> {
  if (!workspaceId || workspaceId === "test" || observations.length === 0) {
    return [];
  }

  const persistedIds: string[] = [];
  try {
    let dataSource = await prisma.dataSource.findFirst({
      where: { name: "GOOGLE_ADS_TRANSPARENCY" },
    });
    if (!dataSource) {
      dataSource = await prisma.dataSource.create({
        data: {
          name: "GOOGLE_ADS_TRANSPARENCY",
          displayName: "Google Ads Transparency Center",
          description:
            "Public Google Ads Transparency Center advertiser & creative enrichment via gads-transparency-mcp.",
          status: "AVAILABLE",
          capabilities: JSON.stringify([
            "ADVERTISER_ENRICHMENT",
            "CREATIVE_RETRIEVAL",
          ]),
          supportedRegions: JSON.stringify(["US"]),
        },
      });
    }

    for (const obs of observations) {
      const extId = `GOOGLE:${obs.sourceRecordId}`;
      const domain =
        extractRegistrableDomain(obs.advertiserDomain || obs.storeDomainEvidence || "") ||
        obs.advertiserDomain ||
        "google-transparency-advertiser.com";
      const advName = obs.advertiserOrCreator || obs.advertiserName || domain;

      let advertiser = await prisma.advertiser.findFirst({
        where: { platform: "GOOGLE", domain },
      });
      if (!advertiser) {
        advertiser = await prisma.advertiser.create({
          data: {
            platform: "GOOGLE",
            name: advName,
            domain,
            country: obs.verifiedDeliveryMarket || "US",
          },
        });
      }

      const now = new Date();
      let adRow = await prisma.competitorAd.findUnique({
        where: { externalAdId: extId },
      });

      if (!adRow) {
        adRow = await prisma.competitorAd.create({
          data: {
            advertiserId: advertiser.id,
            dataSourceId: dataSource.id,
            externalAdId: extId,
            platform: "GOOGLE",
            targetMarket: obs.verifiedDeliveryMarket || "UNKNOWN",
            headline: obs.title || `Google Ad: ${obs.sourceRecordId}`,
            bodyText: obs.description || obs.observedContent || "",
            callToAction: "Shop Now",
            landingPageUrl: obs.landingPageUrl || `https://${domain}`,
            originalAdUrl:
              obs.sourceUrl ||
              `https://adstransparency.google.com/?domain=${encodeURIComponent(domain)}`,
            category: "Retail",
            firstSeenAt: now,
            lastSeenAt: now,
            firstObservedAt: now,
            lastObservedAt: now,
            observationCount: 1,
            status: "ACTIVE",
            lifecycleStatus: "ACTIVE",
            dataConfidence: "OBSERVED",
            isSyntheticQuarantine: false,
          },
        });
      } else {
        adRow = await prisma.competitorAd.update({
          where: { id: adRow.id },
          data: {
            lastSeenAt: now,
            lastObservedAt: now,
            observationCount: { increment: 1 },
          },
        });
      }

      obs.evidenceReference = `CompetitorAd:${adRow.id}`;
      if (obs.metrics && typeof obs.metrics === "object") {
        (obs.metrics as Record<string, unknown>).persistedAdId = adRow.id;
      }
      persistedIds.push(adRow.id);
    }
  } catch {
    // Non-fatal if test DB or read-only context rejects persistence
  }

  return persistedIds;
}

/**
 * Collects Google Ads Transparency observations for known advertiser domains.
 * Executes full pipeline: Domain lookup -> Advertiser IDs -> Creatives -> Normalized Ad Observations.
 */
export async function collectGoogleAdvertiserSignals(
  query: IntelligenceQuery,
  customClient?: GoogleTransparencyMcpClient,
  options?: GoogleEnrichmentOptions,
): Promise<SourceResearchResult> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Google Ads research requires domains or advertiser names
  const rawInputDomains =
    query.advertiserDomains && query.advertiserDomains.length > 0
      ? query.advertiserDomains
      : [];

  // Deduplicate and sanitize domains by registrable domain (Section 4.2 & 4.3)
  const targetDomains: string[] = [];
  const seenRegistrable = new Set<string>();
  for (const rawDom of rawInputDomains) {
    const reg = extractRegistrableDomain(rawDom);
    if (!reg) continue;
    if (!seenRegistrable.has(reg)) {
      seenRegistrable.add(reg);
      const cleanedHost = String(rawDom)
        .trim()
        .toLowerCase()
        .replace(/^[a-z]+:\/\//i, "")
        .replace(/[/?#].*$/, "")
        .replace(/:\d+$/, "")
        .replace(/^www\./, "");
      targetDomains.push(cleanedHost && !PLATFORM_AND_REDIRECT_DOMAINS.has(cleanedHost) ? cleanedHost : reg);
    }
  }

  if (targetDomains.length === 0) {
    warnings.push(
      "Google Ads Transparency: No confirmed advertiser domains provided for lookup. Domain required.",
    );
    return {
      source: "GOOGLE_ADS",
      status: "SKIPPED",
      observations: [],
      retrievedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      estimatedCredits: 0,
      consumedCredits: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      errors,
      warnings,
    };
  }

  // In automated Vitest runs without an injected customClient, do not spawn external live browser MCP processes
  const isVitestRun =
    (process.env.VITEST === "true" || process.env.NODE_ENV === "test") &&
    process.env.SWAI_ALLOW_LIVE_GOOGLE_MCP_IN_VITEST !== "true" &&
    !customClient;
  if (isVitestRun) {
    return {
      source: "GOOGLE_ADS",
      status: "SKIPPED",
      observations: [],
      retrievedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      estimatedCredits: 0,
      consumedCredits: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      errors,
      warnings: [
        "Live Google Ads Transparency MCP skipped in automated Vitest environment.",
      ],
    };
  }

  // 2. Check if configured
  const resolvedMcp = resolveGoogleMcpConfig();
  const hasMcpUrl = Boolean(resolvedMcp.mcpUrl);
  const hasCommand = Boolean(resolvedMcp.command);

  if (!customClient && !hasMcpUrl && !hasCommand) {
    warnings.push(
      "Google Ads Transparency Center MCP server is not configured in environment. Reporting unverified.",
    );
    return {
      source: "GOOGLE_ADS",
      status: "NOT_CONFIGURED",
      observations: [],
      retrievedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      estimatedCredits: 0,
      consumedCredits: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      errors,
      warnings,
      enrichmentExecution: {
        attemptedDomains: [],
        advertiserLookupSucceeded: false,
        advertisersFound: 0,
        creativeQuerySucceeded: false,
        creativesReturned: 0,
        normalizedObservations: 0,
        productLevelMatches: 0,
        brandLevelMatches: 0,
        productEvidenceIds: [],
        domainOutcomes: [],
        queryErrors: [],
        queryTimestamp: startedAt,
        isControlledMcp: Boolean(customClient),
        stateBreakdown: {
          configured: false,
          transportConnected: false,
          toolDiscovered: false,
          operationSupported: false,
          advertiserLookupAttempted: false,
          queryAttempted: false,
          querySucceeded: false,
          advertiserFound: false,
          adsRetrieved: false,
          creativesReturned: false,
          brandLevelMatch: false,
          productLevelMatch: false,
          productAssociatedEvidence: false,
          productEvidencePersisted: false,
          currentRunProductEvidenceAvailable: false,
          empty: false,
          failed: false,
          cached: false,
        },
      },
    };
  }

  if (
    !customClient &&
    process.env.VITEST !== "true" &&
    process.env.NODE_ENV !== "test" &&
    Date.now() < (globalThis as any).__swaiGoogleRateLimitUntil
  ) {
    const firstDom = (targetDomains[0] || "advertiser.com")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
    const errMsg = `Google Transparency advertiser lookup failed for ${firstDom}: HTTP 429 upstream rate-limit cooldown active`;
    return {
      source: "GOOGLE_ADS",
      status: "QUERY_FAILED",
      observations: [],
      retrievedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      estimatedCredits: 0,
      consumedCredits: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      errors: [errMsg],
      warnings,
      enrichmentExecution: {
        attemptedDomains: [firstDom],
        advertiserLookupSucceeded: false,
        advertisersFound: 0,
        creativeQuerySucceeded: false,
        creativesReturned: 0,
        normalizedObservations: 0,
        productLevelMatches: 0,
        brandLevelMatches: 0,
        productEvidenceIds: [],
        domainOutcomes: [
          {
            domain: firstDom,
            registrableDomain: extractRegistrableDomain(firstDom) || firstDom,
            attempted: false,
            status: "SKIPPED_COOLDOWN",
            advertisersFound: 0,
            creativesReturned: 0,
            errorMessage: errMsg,
          },
        ],
        queryErrors: [errMsg],
        queryTimestamp: startedAt,
        isControlledMcp: Boolean(customClient),
        stateBreakdown: {
          configured: true,
          transportConnected: true,
          toolDiscovered: true,
          operationSupported: true,
          advertiserLookupAttempted: true,
          queryAttempted: true,
          querySucceeded: false,
          advertiserFound: false,
          adsRetrieved: false,
          creativesReturned: false,
          brandLevelMatch: false,
          productLevelMatch: false,
          productAssociatedEvidence: false,
          productEvidencePersisted: false,
          currentRunProductEvidenceAvailable: false,
          empty: false,
          failed: true,
          cached: false,
        },
      },
    };
  }

  const client = customClient || createGoogleTransparencyMcpClient();

  // V12.4.3.3.1 Section 6 & 7 fix: Per-operation deadlines for MCP connect, tool discovery,
  // advertiser lookup, and creative retrieval with guaranteed timer cleanup and child-process teardown.
  const CONNECT_DEADLINE_MS = options?.connectTimeoutMs ?? 8_000;
  const TOOL_DISCOVERY_DEADLINE_MS = options?.toolDiscoveryTimeoutMs ?? 5_000;
  const PER_DOMAIN_DEADLINE_MS = options?.perDomainTimeoutMs ?? 15_000;

  const stepTimeline: NonNullable<GoogleEnrichmentExecution["stepTimeline"]> = [];
  const mcpInvocations: NonNullable<GoogleEnrichmentExecution["mcpInvocations"]> = [];
  const providerInvocationRecords: GoogleMcpProviderInvocationRecord[] = [];
  const adapterRejectedRecords: NonNullable<GoogleEnrichmentExecution["rejectedRecords"]> = [];
  const transportSessionId = `mcp_transport_${Date.now()}`;
  const recordStep = (
    step: string,
    status: "COMPLETED" | "FAILED" | "TIMED_OUT" | "SKIPPED",
    stepStartMs: number,
    detail?: string
  ) => {
    const nowMs = Date.now();
    stepTimeline.push({
      step,
      status,
      startedAt: new Date(stepStartMs).toISOString(),
      completedAt: new Date(nowMs).toISOString(),
      durationMs: Math.max(0, nowMs - stepStartMs),
      detail,
    });
  };

  let mcpCallsStarted = 0;
  let mcpCallsCompleted = 0;
  const allRawAds: any[] = [];

  recordStep("startup", "COMPLETED", Date.now(), `domainsPlanned=${targetDomains.length}`);

  const connectStartMs = Date.now();
  try {
    await withOperationDeadline(
      () => client.connect(),
      CONNECT_DEADLINE_MS,
      `MCP connect timeout after ${CONNECT_DEADLINE_MS}ms`,
      query.signal
    );
    recordStep("connect", "COMPLETED", connectStartMs);
  } catch (connErr: any) {
    const isTimeout = /timeout/i.test(String(connErr?.message || ""));
    recordStep(
      "connect",
      isTimeout ? "TIMED_OUT" : "FAILED",
      connectStartMs,
      connErr?.message || String(connErr)
    );
    const cleanupStartMs = Date.now();
    if (!customClient) {
      await client.close().catch(() => {});
    }
    recordStep("cleanup", "COMPLETED", cleanupStartMs, "Closed client after connect failure");
    return {
      source: "GOOGLE_ADS",
      status: "BLOCKED_SOURCE",
      observations: [],
      retrievedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      estimatedCredits: 0,
      consumedCredits: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      errors: [
        `Google Ads Transparency MCP transport connection failed: ${connErr.message}`,
      ],
      warnings,
      enrichmentExecution: {
        attemptedDomains: [],
        advertiserLookupSucceeded: false,
        advertisersFound: 0,
        creativeQuerySucceeded: false,
        creativesReturned: 0,
        creativesRetrievedCount: 0,
        normalizedObservations: 0,
        productLevelMatches: 0,
        brandLevelMatches: 0,
        productEvidenceIds: [],
        domainOutcomes: [],
        queryErrors: [
          `Google Ads Transparency MCP transport connection failed: ${connErr.message}`,
        ],
        queryTimestamp: startedAt,
        isControlledMcp: Boolean(customClient),
        domainsPlanned: targetDomains.length,
        domainsAttempted: 0,
        domainsSucceeded: 0,
        domainsEmpty: 0,
        domainsRateLimited: 0,
        domainsFailed: 0,
        mcpCallsStarted: 0,
        mcpCallsCompleted: 0,
        cleanupCompleted: true,
        mcpInvocations,
        stepTimeline,
        stateBreakdown: {
          configured: true,
          transportConnected: false,
          toolDiscovered: false,
          operationSupported: false,
          advertiserLookupAttempted: false,
          queryAttempted: false,
          querySucceeded: false,
          advertiserFound: false,
          adsRetrieved: false,
          creativesReturned: false,
          brandLevelMatch: false,
          productLevelMatch: false,
          productAssociatedEvidence: false,
          productEvidencePersisted: false,
          currentRunProductEvidenceAvailable: false,
          empty: false,
          failed: true,
          cached: false,
        },
      },
    };
  }

  try {
    const observations: SourceObservation[] = [];
    // V12.4.3.3.1 Section 6 & 7: Bounded tool-discovery with timer-safe per-operation deadline
    const tdStartMs = Date.now();
    const caps = await withOperationDeadline(
      () => discoverGoogleAdsMcpCapabilities({}, client),
      TOOL_DISCOVERY_DEADLINE_MS,
      `MCP tool discovery timeout after ${TOOL_DISCOVERY_DEADLINE_MS}ms`,
      query.signal
    );
    recordStep(
      "toolDiscovery",
      "COMPLETED",
      tdStartMs,
      `toolsDiscovered=${caps.toolsDiscovered.length}`
    );

    const searchTool =
      caps.matchedTools.advertiserSearchTool || "search_advertiser";
    const adsTool = caps.matchedTools.adsRetrievalTool || "get_advertiser_ads";

    let anyLookupSucceeded = false;
    let anyAdvertiserFound = false;
    let adsRetrievalFailed = false;
    let advertisersFoundCount = 0;
    let creativesReturnedCount = 0;
    let creativeQuerySucceeded = false;
    const attemptedDomains: string[] = [];
    const domainOutcomes: GoogleDomainEnrichmentOutcome[] = [];
    let upstreamRateLimitedOrBlocked = false;

    const isRateLimitError = (msg: string) =>
      /\b(429|too many requests|rate.?limit)\b/i.test(msg);
    const isBlockError = (msg: string) =>
      /\b(403|sorry\/index|captcha|anti[-_\s]?bot|blocked)\b/i.test(msg);
    const isRateLimitOrBlockError = (msg: string) =>
      isRateLimitError(msg) || isBlockError(msg);

    // V12.4.3.3 Section 4.3: Bounded multi-domain enrichment queue for Top-3 merchant domains
    const configuredMaxDomains =
      options?.maxDomains ??
      query.maxLiveDomains ??
      (query as any)?.maxGoogleDomains ??
      (!customClient &&
      process.env.VITEST !== "true" &&
      process.env.NODE_ENV !== "test"
        ? 3
        : 5);
    const maxLiveDomains = Math.max(1, Math.min(configuredMaxDomains, 5));
    const maxAdsCallsPerDomain = options?.maxAdsCallsPerDomain ?? 2;

    for (let dIdx = 0; dIdx < targetDomains.length; dIdx++) {
      const rawDomain = targetDomains[dIdx];
      const domain = rawDomain
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "")
        .replace(/:\d+$/, "");
      const regDomain = extractRegistrableDomain(domain) || domain;

      if (dIdx >= maxLiveDomains) {
        domainOutcomes.push({
          domain,
          registrableDomain: regDomain,
          attempted: false,
          status: "SKIPPED_BUDGET",
          advertisersFound: 0,
          creativesReturned: 0,
          errorMessage: "Skipped due to multi-domain enrichment budget limit",
        });
        continue;
      }

      if (query.signal?.aborted || upstreamRateLimitedOrBlocked) {
        domainOutcomes.push({
          domain,
          registrableDomain: regDomain,
          attempted: false,
          status: "SKIPPED_COOLDOWN",
          advertisersFound: 0,
          creativesReturned: 0,
          errorMessage: query.signal?.aborted
            ? "Operation cancelled"
            : "Skipped after upstream rate-limit or block on earlier domain",
        });
        continue;
      }

      const lookupKeys = [regDomain];
      if (domain && domain !== regDomain && !domain.startsWith("www.")) {
        lookupKeys.unshift(domain);
      }

      let domainAdvFound = 0;
      let domainCreativesReturned = 0;
      let domainLookupOk = false;
      let domainErrorMsg: string | null = null;
      let domainStatus: GoogleDomainEnrichmentOutcome["status"] = "SUCCEEDED_NO_ADVERTISER";

      for (const key of lookupKeys) {
        if (!attemptedDomains.includes(key)) {
          attemptedDomains.push(key);
        }

        try {
          // Step 1: Search advertiser by domain — V12.4.3.3.1: bounded by PER_DOMAIN_DEADLINE_MS
          const lookupStartMs = Date.now();
          mcpCallsStarted++;
          const advResult = await withOperationDeadline(
            () =>
              client.callToolByName
                ? client.callToolByName(searchTool, { query: key })
                : client.searchAdvertiserByDomain(key),
            PER_DOMAIN_DEADLINE_MS,
            `Advertiser lookup timeout for ${key} after ${PER_DOMAIN_DEADLINE_MS}ms`,
            query.signal
          );
          mcpCallsCompleted++;
          anyLookupSucceeded = true;
          domainLookupOk = true;
          recordStep("advertiserLookup", "COMPLETED", lookupStartMs, `domain=${key}`);

          const rawAdvList = Array.isArray(advResult)
            ? advResult
            : Array.isArray(advResult?.advertisers)
              ? advResult.advertisers
              : Array.isArray(advResult?.data)
                ? advResult.data
                : [];

          mcpInvocations.push({
            domain: regDomain,
            toolName: searchTool,
            arguments: { query: key },
            startedAt: new Date(lookupStartMs).toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: Math.max(0, Date.now() - lookupStartMs),
            status: "SUCCEEDED",
            returnedCount: rawAdvList.length,
            errorMessage: null,
          });

          // Step 2: Extract advertiser ID(s)
          const advertiserIds: string[] = [];
          for (const adv of rawAdvList) {
            const id = adv?.advertiser_id || adv?.id || adv?.advertiserId;
            if (id) advertiserIds.push(String(id));
          }

          if (advertiserIds.length > 0) {
            anyAdvertiserFound = true;
            advertisersFoundCount += advertiserIds.length;
            domainAdvFound += advertiserIds.length;
          }

          // Step 3: Retrieve actual ad creatives for the discovered advertiser(s)
          for (const advId of advertiserIds.slice(0, maxAdsCallsPerDomain)) {
            if (query.signal?.aborted || upstreamRateLimitedOrBlocked) break;
            const crStartMs = Date.now();
            try {
              mcpCallsStarted++;
              const adsResult = await withOperationDeadline(
                () =>
                  client.callToolByName
                    ? client.callToolByName(adsTool, {
                        advertiser_id: advId,
                        region: query.market || "US",
                      })
                    : client.getAds(advId, query.market || "US"),
                PER_DOMAIN_DEADLINE_MS,
                `Creative retrieval timeout for advertiser ${advId} after ${PER_DOMAIN_DEADLINE_MS}ms`,
                query.signal
              );
              mcpCallsCompleted++;
              recordStep("creativeRetrieval", "COMPLETED", crStartMs, `advertiserId=${advId}`);

              creativeQuerySucceeded = true;
              const rawAds = Array.isArray(adsResult)
                ? adsResult
                : Array.isArray(adsResult?.ads)
                  ? adsResult.ads
                  : [];
              const hasRunLineage = Boolean(query.researchRunId && String(query.researchRunId).trim());
              const invocationId = `google_mcp_inv_${regDomain}_${advId}_${crStartMs}`;
              const upstreamReqId =
                (typeof adsResult?.requestId === "string" && adsResult.requestId.trim()) ||
                (typeof adsResult?.providerRequestId === "string" && adsResult.providerRequestId.trim()) ||
                (hasRunLineage ? `google_mcp_${query.researchRunId}_${regDomain}_${advId}_${crStartMs}` : null);
              const observedIso = new Date().toISOString();
              const returnedCreativeIds: string[] = [];
              let missingCreativeIdCount = 0;

              const stampedRawAds = rawAds.map((rawAd: any) => {
                const rawCid = rawAd?.creative_id ?? rawAd?.creativeId ?? rawAd?.id;
                const actualCreativeId =
                  typeof rawCid === "string" || typeof rawCid === "number"
                    ? String(rawCid).trim() || null
                    : null;
                if (actualCreativeId) {
                  returnedCreativeIds.push(actualCreativeId);
                } else {
                  missingCreativeIdCount++;
                  adapterRejectedRecords.push({
                    creativeId: null,
                    advertiserId: advId,
                    domain: regDomain,
                    researchRunId: query.researchRunId || null,
                    rejectionReason: "MISSING_UPSTREAM_CREATIVE_ID",
                  });
                }
                const adReqId =
                  (typeof rawAd?.providerRequestId === "string" && rawAd.providerRequestId.trim()) ||
                  upstreamReqId ||
                  null;
                return {
                  ...rawAd,
                  creative_id: actualCreativeId,
                  creativeId: actualCreativeId,
                  advertiser_id: rawAd?.advertiser_id || advId,
                  domain: rawAd?.domain || regDomain,
                  sourceMode: "LIVE_PROVIDER",
                  provenance: "REAL_UPSTREAM",
                  isCached: false,
                  researchRunId: query.researchRunId || null,
                  observedAt: observedIso,
                  providerRequestId: adReqId,
                  mcpInvocationRef: invocationId,
                  missingProvenanceReason: !actualCreativeId
                    ? "MISSING_UPSTREAM_CREATIVE_ID"
                    : !adReqId
                    ? "MISSING_PROVIDER_REQUEST_ID"
                    : null,
                };
              });
              creativesReturnedCount += stampedRawAds.length;
              domainCreativesReturned += stampedRawAds.length;
              allRawAds.push(...stampedRawAds);

              mcpInvocations.push({
                domain: regDomain,
                toolName: adsTool,
                arguments: { advertiser_id: advId, region: query.market || "US" },
                startedAt: new Date(crStartMs).toISOString(),
                completedAt: observedIso,
                durationMs: Math.max(0, Date.now() - crStartMs),
                status: "SUCCEEDED",
                returnedCount: stampedRawAds.length,
                errorMessage: null,
              });

              providerInvocationRecords.push({
                invocationId,
                providerRequestId: upstreamReqId,
                transportId: transportSessionId,
                researchRunId: query.researchRunId || null,
                toolName: adsTool,
                advertiserId: advId,
                domain: regDomain,
                startedAt: new Date(crStartMs).toISOString(),
                completedAt: observedIso,
                durationMs: Math.max(0, Date.now() - crStartMs),
                sourceMode: "LIVE_PROVIDER",
                status: "SUCCEEDED",
                returnedCreativeIds,
                missingCreativeIdCount,
                responseEvidenceRef: `mcp:${adsTool}:${advId}:${returnedCreativeIds.length}`,
                lineageAvailable: Boolean(upstreamReqId && hasRunLineage && missingCreativeIdCount === 0),
              });

              const normStartMs = Date.now();
              const normResult = normalizeGoogleAdsResponse(adsResult, {
                requestedDomain: regDomain,
                topic: query.topic,
                observedAt: observedIso,
                toolName: adsTool,
                requestedMarket: query.market || "US",
                providerFilterMarket: query.market || "US",
              });
              recordStep(
                "normalize",
                "COMPLETED",
                normStartMs,
                `normalized=${normResult.observations.length}`
              );

              for (const obs of normResult.observations) {
                obs.researchRunId = query.researchRunId || null;
                obs.sourceMode = "LIVE_PROVIDER";
                obs.sourceType = "LIVE_PROVIDER";
                obs.isCached = false;
                obs.isLiveRecord = true;
                obs.providerRequestId = upstreamReqId || undefined;
                obs.sourceObservationId = obs.sourceObservationId || `sobs_google_${obs.sourceRecordId}`;
                observations.push(obs);
              }
            } catch (adsErr: any) {
              adsRetrievalFailed = true;
              const msg = String(adsErr?.message || adsErr);
              domainErrorMsg = msg;
              const isTimeout = /timeout/i.test(msg);
              mcpInvocations.push({
                domain: regDomain,
                toolName: adsTool,
                arguments: { advertiser_id: advId, region: query.market || "US" },
                startedAt: new Date(crStartMs).toISOString(),
                completedAt: new Date().toISOString(),
                durationMs: Math.max(0, Date.now() - crStartMs),
                status: isTimeout ? "TIMED_OUT" : "FAILED",
                returnedCount: 0,
                errorMessage: msg,
              });
              recordStep(
                "creativeRetrieval",
                isTimeout ? "TIMED_OUT" : "FAILED",
                crStartMs,
                msg
              );
              errors.push(`Ads retrieval failed for advertiser ${advId}: ${msg}`);
              if (isRateLimitOrBlockError(msg)) {
                upstreamRateLimitedOrBlocked = true;
                domainStatus = isRateLimitError(msg) ? "RATE_LIMITED" : "BLOCKED";
                if (isRateLimitError(msg)) {
                  (globalThis as any).__swaiGoogleRateLimitUntil =
                    Date.now() + 120_000;
                }
                break;
              } else {
                domainStatus = "QUERY_FAILED";
              }
            }
          }

          // If advertiser(s) were found with this key, don't fall back to broader domain
          if (advertiserIds.length > 0 || upstreamRateLimitedOrBlocked) {
            break;
          }
        } catch (domainErr: any) {
          const msg = String(domainErr?.message || domainErr);
          domainErrorMsg = msg;
          const isTimeout = /timeout/i.test(msg);
          mcpInvocations.push({
            domain: regDomain,
            toolName: searchTool,
            arguments: { query: key },
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: 0,
            status: isTimeout ? "TIMED_OUT" : "FAILED",
            returnedCount: 0,
            errorMessage: msg,
          });
          recordStep(
            "advertiserLookup",
            isTimeout ? "TIMED_OUT" : "FAILED",
            Date.now(),
            `domain=${key}: ${msg}`
          );
          errors.push(
            `Google Transparency advertiser lookup failed for ${key}: ${msg}`,
          );
          if (isRateLimitOrBlockError(msg)) {
            upstreamRateLimitedOrBlocked = true;
            domainStatus = isRateLimitError(msg) ? "RATE_LIMITED" : "BLOCKED";
            if (isRateLimitError(msg)) {
              (globalThis as any).__swaiGoogleRateLimitUntil =
                Date.now() + 120_000;
            }
            break;
          } else {
            domainStatus = "QUERY_FAILED";
          }
        }
      }

      if (!domainErrorMsg && domainLookupOk) {
        if (domainCreativesReturned > 0) {
          domainStatus = "SUCCEEDED_WITH_CREATIVES";
        } else if (domainAdvFound > 0) {
          domainStatus = "SUCCEEDED_ADVERTISER_ONLY_NO_ADS";
        } else {
          domainStatus = "SUCCEEDED_NO_ADVERTISER";
        }
      }

      domainOutcomes.push({
        domain,
        registrableDomain: regDomain,
        attempted: true,
        status: domainStatus,
        advertisersFound: domainAdvFound,
        creativesReturned: domainCreativesReturned,
        errorMessage: domainErrorMsg,
      });
    }

    // V12.4.3.3 Section 4.4: NEVER set rate-limit cooldown merely because observations.length === 0!
    // Cooldown is ONLY set above when an actual 429/rate-limit or anti-bot block error is returned.

    // Persist Google observations to SQLite when workspaceId is provided (Section 4.7)
    let persistedRecordIds: string[] = [];
    const shouldPersist =
      options?.persistToDatabase !== undefined
        ? options.persistToDatabase
        : Boolean(query.workspaceId && query.workspaceId !== "test");
    if (shouldPersist && observations.length > 0) {
      persistedRecordIds = await persistGoogleObservationsToDatabase(
        observations,
        query.workspaceId
      );
    }

    let status: SourceRunStatus = "NOT_CONFIGURED";
    if (observations.length > 0) {
      status = "PASSED";
    } else if (adsRetrievalFailed || errors.length > 0) {
      status = "QUERY_FAILED";
    } else if (anyAdvertiserFound || anyLookupSucceeded) {
      status = "QUERY_SUCCEEDED_EMPTY";
    } else {
      status = "NO_RESULTS";
    }

    const hasProductSpecificMatch = observations.some(
      (o) => (o.metrics as any)?.productRelevance === "PRODUCT_SPECIFIC"
    );
    const hasPersistedProductEvidence =
      hasProductSpecificMatch && persistedRecordIds.length > 0;

    const domainsAttemptedCount = domainOutcomes.filter((d) => d.attempted).length;
    const domainsSucceededCount = domainOutcomes.filter(
      (d) =>
        d.status === "SUCCEEDED_WITH_CREATIVES" ||
        d.status === "SUCCEEDED_ADVERTISER_ONLY_NO_ADS" ||
        d.status === "SUCCEEDED_NO_ADVERTISER"
    ).length;
    const domainsEmptyCount = domainOutcomes.filter(
      (d) =>
        d.status === "SUCCEEDED_ADVERTISER_ONLY_NO_ADS" ||
        d.status === "SUCCEEDED_NO_ADVERTISER"
    ).length;
    const domainsRateLimitedCount = domainOutcomes.filter(
      (d) => d.status === "RATE_LIMITED"
    ).length;
    const domainsFailedCount = domainOutcomes.filter(
      (d) =>
        d.status === "RATE_LIMITED" ||
        d.status === "BLOCKED" ||
        d.status === "TRANSPORT_FAILED" ||
        d.status === "QUERY_FAILED"
    ).length;

    const enrichmentExecution: GoogleEnrichmentExecution = {
      attemptedDomains,
      advertiserLookupSucceeded: anyLookupSucceeded,
      advertisersFound: advertisersFoundCount,
      creativeQuerySucceeded,
      creativesReturned: creativesReturnedCount,
      creativesRetrievedCount: creativesReturnedCount,
      rawCreatives: allRawAds,
      normalizedDistinct: observations.length,
      rejectedBeforeNormalization: Math.max(0, allRawAds.length - observations.length),
      classifiedDistinct: 0,
      normalizedRecords: observations,
      normalizedObservations: observations.length,
      productLevelMatches: observations.filter(
        (o) => (o.metrics as any)?.productRelevance === "PRODUCT_SPECIFIC",
      ).length,
      brandLevelMatches: observations.filter(
        (o) => (o.metrics as any)?.productRelevance === "BRAND_RELATED",
      ).length,
      productEvidenceIds: observations
        .filter(
          (o) => (o.metrics as any)?.productRelevance === "PRODUCT_SPECIFIC",
        )
        .map((o) => o.sourceRecordId),
      persistedRecordIds,
      domainOutcomes,
      queryErrors: [...errors],
      queryTimestamp: startedAt,
      isControlledMcp: Boolean(customClient),
      // V12.4.3.3.1 Section 6 & 7: per-operation counters for acceptance gate diagnostics
      domainsPlanned: targetDomains.length,
      domainsAttempted: domainsAttemptedCount,
      domainsSucceeded: domainsSucceededCount,
      domainsEmpty: domainsEmptyCount,
      domainsRateLimited: domainsRateLimitedCount,
      domainsFailed: domainsFailedCount,
      mcpCallsStarted,
      mcpCallsCompleted,
      cleanupCompleted: true,
      mcpInvocations,
      providerInvocationRecords,
      rejectedRecords: adapterRejectedRecords,
      stepTimeline,
      stateBreakdown: {
        configured: true,
        transportConnected: true,
        toolDiscovered: caps.toolsDiscovered.length > 0,
        operationSupported: Boolean(
          caps.supportedOperations.advertiserSearch &&
          caps.supportedOperations.adsRetrieval,
        ),
        advertiserLookupAttempted: attemptedDomains.length > 0,
        queryAttempted: attemptedDomains.length > 0,
        querySucceeded: status !== "QUERY_FAILED" && (anyLookupSucceeded || creativeQuerySucceeded),
        advertiserFound: anyAdvertiserFound,
        adsRetrieved: observations.length > 0,
        creativesReturned: creativesReturnedCount > 0,
        brandLevelMatch: observations.some(
          (o) => (o.metrics as any)?.productRelevance === "BRAND_RELATED",
        ),
        productLevelMatch: hasProductSpecificMatch,
        productAssociatedEvidence: hasProductSpecificMatch,
        productEvidencePersisted: hasPersistedProductEvidence,
        currentRunProductEvidenceAvailable: hasProductSpecificMatch,
        empty: status === "QUERY_SUCCEEDED_EMPTY" || status === "NO_RESULTS",
        failed: status === "QUERY_FAILED",
        cached: false,
      },
    };

    return {
      source: "GOOGLE_ADS",
      status,
      observations,
      retrievedCount: observations.length,
      acceptedCount: observations.length,
      rejectedCount: 0,
      estimatedCredits: 0,
      consumedCredits: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      errors,
      warnings,
      enrichmentExecution,
      executionMetadata: {
        attempted: domainsAttemptedCount > 0,
        executed: anyLookupSucceeded,
        liveSucceeded:
          observations.length > 0 ||
          (anyLookupSucceeded && errors.length === 0),
        startedAt,
        completedAt: new Date().toISOString(),
        upstreamReturnedCount: creativesReturnedCount,
        freshLiveObservedCount: observations.length,
        currentRunLiveAdsCount: observations.length,
        persistedInsertedCount: persistedRecordIds.length,
        persistedUpdatedCount: 0,
        cachedRecordsUsedCount: 0,
        fallbackToCache: false,
        domainsAttempted: domainsAttemptedCount,
        domainsSucceeded: domainsSucceededCount,
        domainsEmpty: domainsEmptyCount,
        domainsRateLimited: domainsRateLimitedCount,
        domainsFailed: domainsFailedCount,
        productEvidencePersisted: hasPersistedProductEvidence,
        domainOutcomes,
      },
    };
  } catch (err: any) {
    const errMsg =
      err.message ||
      "Google Ads Transparency Center access was blocked or interrupted.";
    recordStep(
      "toolDiscovery",
      /timeout/i.test(errMsg) ? "TIMED_OUT" : "FAILED",
      Date.now(),
      errMsg
    );
    return {
      source: "GOOGLE_ADS",
      status: "BLOCKED_SOURCE",
      observations: [],
      retrievedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      estimatedCredits: 0,
      consumedCredits: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      errors: [errMsg],
      warnings,
      enrichmentExecution: {
        attemptedDomains: [],
        advertiserLookupSucceeded: false,
        advertisersFound: 0,
        creativeQuerySucceeded: false,
        creativesReturned: 0,
        normalizedObservations: 0,
        productLevelMatches: 0,
        brandLevelMatches: 0,
        productEvidenceIds: [],
        domainOutcomes: [],
        queryErrors: [errMsg],
        queryTimestamp: startedAt,
        isControlledMcp: Boolean(customClient),
        domainsPlanned: targetDomains.length,
        domainsAttempted: 0,
        mcpCallsStarted,
        mcpCallsCompleted,
        cleanupCompleted: true,
        stepTimeline,
        stateBreakdown: {
          configured: true,
          transportConnected: true,
          toolDiscovered: false,
          operationSupported: false,
          advertiserLookupAttempted: false,
          queryAttempted: false,
          querySucceeded: false,
          advertiserFound: false,
          adsRetrieved: false,
          creativesReturned: false,
          brandLevelMatch: false,
          productLevelMatch: false,
          productAssociatedEvidence: false,
          productEvidencePersisted: false,
          currentRunProductEvidenceAvailable: false,
          empty: false,
          failed: true,
          cached: false,
        },
      },
    };
  } finally {
    if (!customClient) {
      await client.close().catch(() => {});
    }
  }
}
