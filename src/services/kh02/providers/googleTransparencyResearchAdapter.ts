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
  };
  matchedTools: {
    domainLookupTool?: string;
    advertiserSearchTool?: string;
    adsRetrievalTool?: string;
    adDetailTool?: string;
  };
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
  verificationStatus:
    | "VERIFIED"
    | "FILTER_ONLY"
    | "INFERRED"
    | "UNVERIFIED";
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
  productRelevance: "PRODUCT_SPECIFIC" | "BRAND_RELATED" | "UNRELATED" | "UNKNOWN";
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
  advertiserFound: boolean;
  adsRetrieved: boolean;
  productAssociatedEvidence: boolean;
  empty: boolean;
  failed: boolean;
  cached: boolean;
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
  queryErrors: string[];
  queryTimestamp: string | null;
  stateBreakdown?: GoogleDiagnosticStateBreakdown;
}

/**
 * Extracts the canonical registrable domain from a hostname or URL.
 * Handles subdomains (e.g., cc.uprootclean.com -> uprootclean.com, store.brand.co.uk -> brand.co.uk).
 */
export function extractRegistrableDomain(domainOrUrl: string): string {
  if (!domainOrUrl) return "";
  const clean = domainOrUrl.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  const parts = clean.split(".");
  if (parts.length <= 2) return clean;
  const secondLast = parts[parts.length - 2];
  if (["co", "com", "net", "org", "gov", "edu"].includes(secondLast) && parts.length > 2) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
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
      : result.error || "Google Ads Transparency MCP tool returned isError: true";
    throw new Error(errorText);
  }

  // 1. Structured Content
  if (result.structuredContent !== undefined && result.structuredContent !== null) {
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
  argumentsValue: unknown
): ValidationResult {
  const errors: string[] = [];

  if (!toolSchema || typeof toolSchema !== "object") {
    return { valid: true, errors: [] };
  }

  if (argumentsValue === null || typeof argumentsValue !== "object") {
    return { valid: false, errors: ["Arguments must be a valid non-null object."] };
  }

  const argsObj = argumentsValue as Record<string, unknown>;

  // 1. Check required fields
  if (Array.isArray(toolSchema.required)) {
    for (const reqKey of toolSchema.required) {
      if (!(reqKey in argsObj) || argsObj[reqKey] === undefined || argsObj[reqKey] === null) {
        errors.push(`Missing required parameter: '${reqKey}'`);
      }
    }
  }

  // 2. Check property types
  if (toolSchema.properties && typeof toolSchema.properties === "object") {
    for (const [propName, propSchema] of Object.entries(toolSchema.properties)) {
      if (propName in argsObj && argsObj[propName] !== undefined && argsObj[propName] !== null) {
        const val = argsObj[propName];
        const expectedType = propSchema.type?.toLowerCase();

        if (expectedType === "string" && typeof val !== "string") {
          errors.push(`Parameter '${propName}' expected string, received ${typeof val}`);
        } else if (expectedType === "number" && typeof val !== "number") {
          errors.push(`Parameter '${propName}' expected number, received ${typeof val}`);
        } else if (expectedType === "integer" && (!Number.isInteger(val) || typeof val !== "number")) {
          errors.push(`Parameter '${propName}' expected integer, received ${typeof val}`);
        } else if (expectedType === "boolean" && typeof val !== "boolean") {
          errors.push(`Parameter '${propName}' expected boolean, received ${typeof val}`);
        } else if (expectedType === "array" && !Array.isArray(val)) {
          errors.push(`Parameter '${propName}' expected array, received ${typeof val}`);
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
  clientArg?: GoogleTransparencyMcpClient
): Promise<GoogleMcpCapabilities> {
  const discoveredAt = new Date().toISOString();
  const resolved = resolveGoogleMcpConfig();
  const mcpUrl = context.mcpUrl !== undefined ? context.mcpUrl : resolved.mcpUrl;
  const command = context.command !== undefined ? context.command : (context.mcpUrl ? undefined : resolved.command);
  const client = clientArg || createGoogleTransparencyMcpClient({
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
      toolDescriptors = toolNames.map((name) => ({ name, inputSchema: { type: "object" } }));
    }

    const advertiserSearchTool = toolDescriptors.find((t) =>
      /^search_advertiser$|^find_advertiser$|search.*advertiser/i.test(t.name)
    )?.name;

    const domainLookupTool = toolDescriptors.find((t) =>
      /domain/i.test(t.name)
    )?.name || advertiserSearchTool; // In gads-transparency-mcp, search_advertiser handles domain lookups

    const adsRetrievalTool = toolDescriptors.find((t) =>
      /^get_advertiser_ads$|(get|search|list).*ads/i.test(t.name)
    )?.name;

    const adDetailTool = toolDescriptors.find((t) =>
      /^get_ad_details?$|(get|find).*ad.*detail|creative.*detail/i.test(t.name)
    )?.name;

    return {
      transportConnected: isConnected,
      toolsDiscovered: toolDescriptors,
      supportedOperations: {
        domainLookup: Boolean(domainLookupTool),
        advertiserSearch: Boolean(advertiserSearchTool),
        adsRetrieval: Boolean(adsRetrievalTool),
        adDetail: Boolean(adDetailTool),
      },
      matchedTools: {
        domainLookupTool,
        advertiserSearchTool,
        adsRetrievalTool,
        adDetailTool,
      },
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
      },
      matchedTools: {},
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
  schema?: JsonSchema
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

  const client = clientArg || createGoogleTransparencyMcpClient({
    mcpUrl: context.mcpUrl,
    command: context.command,
    args: context.args,
  });

  try {
    if (!client.isAlive()) {
      await client.connect();
    }

    let resultData: any;
    if (toolName === "search_advertiser_by_domain" || /domain/i.test(toolName)) {
      resultData = await client.searchAdvertiserByDomain(String(args.domain || ""));
    } else if (toolName === "search_advertisers") {
      resultData = await client.searchAdvertisers(String(args.query || ""));
    } else if (toolName === "get_ads" || /ads/i.test(toolName)) {
      resultData = await client.getAds(String(args.advertiser_id || ""), String(args.region || "US"));
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
  metadata: GoogleSourceMetadata
): NormalizedAdsResult {
  const decoded = decodeCallToolResult(rawResponse);
  const adsArray: any[] = Array.isArray(decoded?.ads)
    ? decoded.ads
    : (Array.isArray(decoded)
      ? decoded
      : (Array.isArray(decoded?.data)
        ? decoded.data
        : (Array.isArray(decoded?.creatives) ? decoded.creatives : [])));

  const requestedMarket = decoded?.requested_region || metadata.requestedMarket || "US";
  const providerFilterMarket = decoded?.provider_filter_region || metadata.providerFilterMarket || (decoded?.requested_region ? decoded.requested_region : "US");

  const normalizedAds: NormalizedGoogleAd[] = [];
  const observations: SourceObservation[] = [];

  for (const ad of adsArray) {
    const creativeId = String(ad.creative_id || ad.id || "");
    if (!creativeId) continue;

    const format = ad.format === "video" ? "VIDEO" : (ad.format === "image" ? "IMAGE" : "TEXT");

    // Evaluate product relevance against topic and concrete product indicators (Section 7.3)
    const headline = ad.headline || ad.content?.headline || "";
    const body = ad.body || ad.content?.description || "";
    const destUrl = ad.destination_url || ad.content?.destination_url || ad.landing_page_url || null;
    let urlPathText = "";
    if (destUrl) {
      try {
        const parsedDest = new URL(destUrl);
        urlPathText = parsedDest.pathname.replace(/[\/_-]+/g, " ");
      } catch {
        urlPathText = destUrl;
      }
    }
    const domainPrefix = (metadata.requestedDomain || "").toLowerCase().split(".")[0];
    const textContent = `${headline} ${body} ${urlPathText}`.toLowerCase().trim();
    const topicWords = metadata.topic
      ? metadata.topic
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2 && w !== domainPrefix)
      : [];
    const hasTopicMatch = topicWords.length > 0 && topicWords.some((w) => textContent.includes(w));
    const hasSpecificProductSignal =
      Boolean(destUrl && /\/products\/|\/dp\/|\/p\/|\/item\//i.test(destUrl)) ||
      (hasTopicMatch && headline.trim().split(/\s+/).length >= 2);
    const relevance: "PRODUCT_SPECIFIC" | "BRAND_RELATED" | "UNRELATED" | "UNKNOWN" =
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
    let verificationStatus: "VERIFIED" | "FILTER_ONLY" | "INFERRED" | "UNVERIFIED" = "UNVERIFIED";

    if (providerReportedMarket === "US" || providerReportedMarket === "USA") {
      verifiedDeliveryMarket = "US";
      verificationStatus = "VERIFIED";
    } else if (providerReportedMarket && providerReportedMarket !== "US" && providerReportedMarket !== "USA") {
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
      providerFilterMarket: providerFilterMarket || (requestedMarket || "US"),
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
      googleSourceUrl: ad.source_url || `https://adstransparency.google.com/advertiser/${ad.advertiser_id || ""}`,
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
      evidenceReference: `GoogleAd:${creativeId}`,
    });
  }

  return {
    ads: normalizedAds,
    observations,
    totalExtracted: normalizedAds.length,
  };
}

function resolveLocalGoogleMcpDefaults(): { command?: string; args?: string[] } {
  try {
    const cwd = String(process.cwd());
    const venvParts = ["services", "google-transparency", [".", "venv"].join("")];
    const posixPy = path.join(cwd, ...venvParts, "bin", "python");
    const winPy = path.join(cwd, ...venvParts, "Scripts", "python.exe");
    const serverScript = path.join(cwd, "scripts", "googleTransparencyServer.py");
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
export function resolveGoogleMcpConfig(): { command?: string; args?: string[]; mcpUrl?: string } {
  const mcpUrl = process.env.GOOGLE_TRANSPARENCY_MCP_URL || process.env.GOOGLE_ADS_MCP_URL || undefined;

  let rawCommand = process.env.GOOGLE_TRANSPARENCY_MCP_COMMAND;
  let command: string | undefined = undefined;
  if (rawCommand && typeof rawCommand === "string") {
    let trimmed = rawCommand.trim();
    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
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
          if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
            s = s.slice(1, -1).trim();
          }
          return s;
        });
      } else if (typeof parsed === "string") {
        let s = parsed.trim();
        if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
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
        if ((clean.startsWith("'") && clean.endsWith("'")) || (clean.startsWith('"') && clean.endsWith('"'))) {
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
  const command = config?.command !== undefined ? config.command : (config?.mcpUrl ? undefined : resolved.command);
  const args = config?.args || resolved.args || [];

  let mcpClient: Client | null = null;
  let transport: StdioClientTransport | null = null;
  let connected = false;

  async function sendMcpJsonRpc(method: string, params: any = {}): Promise<any> {
    if (!mcpUrl) throw new Error("No MCP URL configured");
    const isSafe = isSafePublicUrl(mcpUrl);
    if (!isSafe) {
      throw new Error(`SSRF Security Guard: Blocked potential SSRF endpoint '${mcpUrl}'`);
    }

    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
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
      throw new Error(`Google Ads Transparency MCP transport error: HTTP ${res.status}`);
    }

    const json = await res.json();
    if (json.error) {
      throw new Error(json.error.message || `MCP Error ${json.error.code || ""}`);
    }

    return json.result;
  }

  return {
    async connect(): Promise<void> {
      if (connected) return;

      if (command) {
        if (/[;&|`$\n]/.test(command)) {
          throw new Error("Security Exception: Command contains forbidden shell metacharacters in MCP command");
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
          },
        });
        mcpClient = new Client(
          { name: "swai-google-transparency-client", version: "12.4.3" },
          { capabilities: {} }
        );
        await mcpClient.connect(transport);
        connected = true;
      } else if (mcpUrl) {
        // Standard MCP initialize negotiation lifecycle
        await sendMcpJsonRpc("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "swai-google-transparency-client", version: "12.2.2" },
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

    async callToolByName(name: string, argsObj: Record<string, unknown>): Promise<any> {
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
      return this.callToolByName!("search_advertiser", { query: queryText })
        .catch(() => this.callToolByName!("search_advertisers", { query: queryText }));
    },

    async searchAdvertiserByDomain(domain: string): Promise<any> {
      return this.callToolByName!("search_advertiser", { query: domain })
        .catch(() => this.callToolByName!("search_advertiser_by_domain", { domain }));
    },

    async getAds(advertiserId: string, region?: string): Promise<any> {
      return this.callToolByName!("get_advertiser_ads", { advertiser_id: advertiserId, region: region || "US" })
        .catch(() => this.callToolByName!("get_ads", { advertiser_id: advertiserId, region: region || "US" }));
    },

    async getAdDetail(creativeId: string): Promise<any> {
      return this.callToolByName!("get_ad_details", { creative_id: creativeId })
        .catch(() => this.callToolByName!("get_ad_detail", { creative_id: creativeId }));
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

/**
 * Collects Google Ads Transparency observations for known advertiser domains.
 * Executes full pipeline: Domain lookup -> Advertiser IDs -> Creatives -> Normalized Ad Observations.
 */
export async function collectGoogleAdvertiserSignals(
  query: IntelligenceQuery,
  customClient?: GoogleTransparencyMcpClient
): Promise<SourceResearchResult> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Google Ads research requires domains or advertiser names
  const targetDomains = query.advertiserDomains && query.advertiserDomains.length > 0
    ? query.advertiserDomains
    : [];

  if (targetDomains.length === 0) {
    warnings.push("Google Ads Transparency: No confirmed advertiser domains provided for lookup. Domain required.");
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
      warnings: ["Live Google Ads Transparency MCP skipped in automated Vitest environment."],
    };
  }

  // 2. Check if configured
  const resolvedMcp = resolveGoogleMcpConfig();
  const hasMcpUrl = Boolean(resolvedMcp.mcpUrl);
  const hasCommand = Boolean(resolvedMcp.command);

  if (!customClient && !hasMcpUrl && !hasCommand) {
    warnings.push("Google Ads Transparency Center MCP server is not configured in environment. Reporting unverified.");
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
        queryErrors: [],
        queryTimestamp: startedAt,
        stateBreakdown: {
          configured: false,
          transportConnected: false,
          toolDiscovered: false,
          operationSupported: false,
          advertiserLookupAttempted: false,
          advertiserFound: false,
          adsRetrieved: false,
          productAssociatedEvidence: false,
          empty: false,
          failed: false,
          cached: false,
        },
      },
    };
  }

  const client = customClient || createGoogleTransparencyMcpClient();

  try {
    await client.connect();
  } catch (connErr: any) {
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
      errors: [`Google Ads Transparency MCP transport connection failed: ${connErr.message}`],
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
        queryErrors: [`Google Ads Transparency MCP transport connection failed: ${connErr.message}`],
        queryTimestamp: startedAt,
        stateBreakdown: {
          configured: true,
          transportConnected: false,
          toolDiscovered: false,
          operationSupported: false,
          advertiserLookupAttempted: false,
          advertiserFound: false,
          adsRetrieved: false,
          productAssociatedEvidence: false,
          empty: false,
          failed: true,
          cached: false,
        },
      },
    };
  }

  try {
    const observations: SourceObservation[] = [];
    const caps = await discoverGoogleAdsMcpCapabilities({}, client);

    const searchTool = caps.matchedTools.advertiserSearchTool || "search_advertiser";
    const adsTool = caps.matchedTools.adsRetrievalTool || "get_advertiser_ads";

    let anyLookupSucceeded = false;
    let anyAdvertiserFound = false;
    let adsRetrievalFailed = false;
    let advertisersFoundCount = 0;
    let creativesReturnedCount = 0;
    let creativeQuerySucceeded = false;
    const attemptedDomains: string[] = [];

    for (const rawDomain of targetDomains.slice(0, 5)) {
      if (query.signal?.aborted) break;

      const domain = rawDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
      const regDomain = extractRegistrableDomain(domain);
      const lookupKeys = [domain];
      if (regDomain && regDomain !== domain && !domain.startsWith("www.")) {
        lookupKeys.push(regDomain);
      }

      for (const key of lookupKeys) {
        if (!attemptedDomains.includes(key)) {
          attemptedDomains.push(key);
        }

        try {
          // Step 1: Search advertiser by domain
          const advResult = client.callToolByName
            ? await client.callToolByName(searchTool, { query: key })
            : await client.searchAdvertiserByDomain(key);
          anyLookupSucceeded = true;

          const rawAdvList = Array.isArray(advResult)
            ? advResult
            : (Array.isArray(advResult?.advertisers)
              ? advResult.advertisers
              : (Array.isArray(advResult?.data) ? advResult.data : []));

          // Step 2: Extract advertiser ID(s)
          const advertiserIds: string[] = [];
          for (const adv of rawAdvList) {
            const id = adv?.advertiser_id || adv?.id || adv?.advertiserId;
            if (id) advertiserIds.push(String(id));
          }

          if (advertiserIds.length > 0) {
            anyAdvertiserFound = true;
            advertisersFoundCount += advertiserIds.length;
          }

          // Step 3: Retrieve actual ad creatives for the discovered advertiser(s)
          for (const advId of advertiserIds.slice(0, 2)) {
            if (query.signal?.aborted) break;
            try {
              const adsResult = client.callToolByName
                ? await client.callToolByName(adsTool, {
                    advertiser_id: advId,
                    region: query.market || "US",
                  })
                : await client.getAds(advId, query.market || "US");

              creativeQuerySucceeded = true;
              const rawAds = Array.isArray(adsResult) ? adsResult : (Array.isArray(adsResult?.ads) ? adsResult.ads : []);
              creativesReturnedCount += rawAds.length;

              const normResult = normalizeGoogleAdsResponse(adsResult, {
                requestedDomain: key,
                topic: query.topic,
                observedAt: new Date().toISOString(),
                toolName: adsTool,
                requestedMarket: query.market || "US",
                providerFilterMarket: query.market || "US",
              });

              for (const obs of normResult.observations) {
                observations.push(obs);
              }
            } catch (adsErr: any) {
              adsRetrievalFailed = true;
              errors.push(`Ads retrieval failed for advertiser ${advId}: ${adsErr.message}`);
            }
          }

          // If advertiser(s) were found with this key, don't fall back to broader domain
          if (advertiserIds.length > 0) {
            break;
          }
        } catch (domainErr: any) {
          errors.push(`Google Transparency advertiser lookup failed for ${key}: ${domainErr.message}`);
        }
      }
    }

    let status: SourceRunStatus = "NOT_CONFIGURED";
    if (observations.length > 0) {
      status = "PASSED";
    } else if (adsRetrievalFailed || errors.length > 0) {
      status = "QUERY_FAILED";
    } else if (anyAdvertiserFound || anyLookupSucceeded) {
      status = "QUERY_SUCCEEDED_EMPTY";
    } else if (errors.length > 0) {
      status = "QUERY_FAILED"; // Lookups genuinely failed with transport or server errors!
    } else {
      status = "NO_RESULTS";
    }

    const enrichmentExecution: GoogleEnrichmentExecution = {
      attemptedDomains,
      advertiserLookupSucceeded: anyLookupSucceeded,
      advertisersFound: advertisersFoundCount,
      creativeQuerySucceeded,
      creativesReturned: creativesReturnedCount,
      normalizedObservations: observations.length,
      productLevelMatches: observations.filter((o) => (o.metrics as any)?.productRelevance === "PRODUCT_SPECIFIC").length,
      brandLevelMatches: observations.filter((o) => (o.metrics as any)?.productRelevance === "BRAND_RELATED").length,
      productEvidenceIds: observations
        .filter((o) => (o.metrics as any)?.productRelevance === "PRODUCT_SPECIFIC")
        .map((o) => o.sourceRecordId),
      queryErrors: [...errors],
      queryTimestamp: startedAt,
      stateBreakdown: {
        configured: true,
        transportConnected: true,
        toolDiscovered: caps.toolsDiscovered.length > 0,
        operationSupported: Boolean(caps.supportedOperations.advertiserSearch && caps.supportedOperations.adsRetrieval),
        advertiserLookupAttempted: attemptedDomains.length > 0,
        advertiserFound: anyAdvertiserFound,
        adsRetrieved: observations.length > 0,
        productAssociatedEvidence: observations.some((o) => (o.metrics as any)?.productRelevance === "PRODUCT_SPECIFIC"),
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
        attempted: true,
        executed: anyLookupSucceeded,
        liveSucceeded: observations.length > 0 || (anyLookupSucceeded && errors.length === 0),
        startedAt,
        completedAt: new Date().toISOString(),
        upstreamReturnedCount: creativesReturnedCount,
        freshLiveObservedCount: observations.length,
        persistedInsertedCount: 0,
        persistedUpdatedCount: 0,
        cachedRecordsUsedCount: 0,
        fallbackToCache: false,
      },
    };
  } catch (err: any) {
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
      errors: [err.message || "Google Ads Transparency Center access was blocked or interrupted."],
      warnings,
    };
  } finally {
    if (!customClient) {
      await client.close().catch(() => {});
    }
  }
}
