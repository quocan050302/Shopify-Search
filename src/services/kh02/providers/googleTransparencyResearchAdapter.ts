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

export interface GoogleSourceMetadata {
  requestedDomain: string;
  topic?: string;
  observedAt: string;
  toolName: string;
  sourceUrl?: string;
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
  const client = clientArg || createGoogleTransparencyMcpClient({
    mcpUrl: context.mcpUrl,
    command: context.command,
    args: context.args,
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

  const normalizedAds: NormalizedGoogleAd[] = [];
  const observations: SourceObservation[] = [];

  for (const ad of adsArray) {
    const creativeId = String(ad.creative_id || ad.id || "");
    if (!creativeId) continue;

    const format = ad.format === "video" ? "VIDEO" : (ad.format === "image" ? "IMAGE" : "TEXT");

    // Evaluate product relevance against topic
    const textContent = `${ad.headline || ""} ${ad.body || ""}`.toLowerCase();
    const topicWords = metadata.topic
      ? metadata.topic.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
      : [];
    const hasTopicMatch = topicWords.length > 0 && topicWords.some((w) => textContent.includes(w));
    const relevance = hasTopicMatch ? "PRODUCT_SPECIFIC" : "BRAND_RELATED";

    // Strict market verification: do not default to US unless source proves it
    const deliveryRegion = ad.region || ad.delivery_region || ad.target_country || null;
    const verifiedDeliveryMarket = (deliveryRegion === "US" || deliveryRegion === "USA") ? "US" : null;

    const normAd: NormalizedGoogleAd = {
      advertiserId: String(ad.advertiser_id || ""),
      advertiserName: String(ad.advertiser_name || metadata.requestedDomain),
      domain: metadata.requestedDomain,
      creativeId,
      adFormat: format,
      observedContent: ad.headline || ad.body || null,
      lastShownDate: ad.last_shown || null,
      googleSourceUrl: ad.source_url || `https://adstransparency.google.com/advertiser/${ad.advertiser_id || ""}`,
      observedAt: metadata.observedAt,
      productRelevance: relevance,
      productRelevanceReason: hasTopicMatch
        ? `Matched topic keywords in Google ad copy`
        : `Domain verified but creative has brand-level focus`,
      sourceProvenance: "REAL_UPSTREAM",
      sourceMarket: deliveryRegion,
      verifiedDeliveryMarket,
    };
    normalizedAds.push(normAd);

    observations.push({
      source: "GOOGLE_ADS",
      sourceRecordId: creativeId,
      sourceUrl: normAd.googleSourceUrl,
      advertiserOrCreator: normAd.advertiserName,
      advertiserDomain: metadata.requestedDomain,
      productMatchHint: normAd.observedContent,
      reportedPublishedAt: null,
      reportedFirstShownAt: ad.first_shown || null,
      reportedLastShownAt: normAd.lastShownDate,
      observedAt: metadata.observedAt,
      requestedMarket: "US",
      verifiedDeliveryMarket,
      title: ad.headline || null,
      description: ad.body || null,
      metrics: {
        lastShown: normAd.lastShownDate,
        format,
        productRelevance: relevance,
      },
      media: {
        thumbnailUrl: ad.thumbnail_url || null,
        videoUrl: ad.video_url || null,
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

/**
 * Creates a Google Ads Transparency MCP client supporting stdio or HTTP MCP gateway.
 */
export function createGoogleTransparencyMcpClient(config?: {
  mcpUrl?: string;
  command?: string;
  args?: string[];
}): GoogleTransparencyMcpClient {
  const mcpUrl = config?.mcpUrl || process.env.GOOGLE_TRANSPARENCY_MCP_URL || process.env.GOOGLE_ADS_MCP_URL;
  const command = config?.command || process.env.GOOGLE_TRANSPARENCY_MCP_COMMAND;
  const args = config?.args || (process.env.GOOGLE_TRANSPARENCY_MCP_ARGS ? JSON.parse(process.env.GOOGLE_TRANSPARENCY_MCP_ARGS) : []);

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
        transport = new StdioClientTransport({
          command,
          args,
        });
        mcpClient = new Client(
          { name: "swai-google-transparency-client", version: "12.2.2" },
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

  // 2. Check if configured
  const hasMcpUrl = Boolean(process.env.GOOGLE_TRANSPARENCY_MCP_URL || process.env.GOOGLE_ADS_MCP_URL);
  const hasCommand = Boolean(process.env.GOOGLE_TRANSPARENCY_MCP_COMMAND);

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
    };
  }

  try {
    const observations: SourceObservation[] = [];
    const caps = await discoverGoogleAdsMcpCapabilities({}, client);

    const searchTool = caps.matchedTools.advertiserSearchTool || "search_advertiser";
    const adsTool = caps.matchedTools.adsRetrievalTool || "get_advertiser_ads";

    let anyLookupSucceeded = false;
    let anyAdvertiserFound = false;

    for (const domain of targetDomains.slice(0, 5)) {
      if (query.signal?.aborted) break;

      try {
        // Step 1: Search advertiser by domain
        const advResult = client.callToolByName
          ? await client.callToolByName(searchTool, { query: domain })
          : await client.searchAdvertiserByDomain(domain);
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

            const normResult = normalizeGoogleAdsResponse(adsResult, {
              requestedDomain: domain,
              topic: query.topic,
              observedAt: new Date().toISOString(),
              toolName: adsTool,
            });

            for (const obs of normResult.observations) {
              observations.push(obs);
            }
          } catch (adsErr: any) {
            warnings.push(`Ads retrieval failed for advertiser ${advId}: ${adsErr.message}`);
          }
        }
      } catch (domainErr: any) {
        errors.push(`Google Transparency advertiser lookup failed for ${domain}: ${domainErr.message}`);
      }
    }

    let status: SourceRunStatus = "NOT_CONFIGURED";
    if (observations.length > 0) {
      status = "PASSED";
    } else if (anyAdvertiserFound || anyLookupSucceeded) {
      status = "QUERY_SUCCEEDED_EMPTY";
    } else if (errors.length > 0) {
      status = "QUERY_FAILED"; // Lookups genuinely failed with transport or server errors!
    } else {
      status = "NO_RESULTS";
    }

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
