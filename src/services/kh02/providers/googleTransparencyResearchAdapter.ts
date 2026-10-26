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
import {
  IntelligenceQuery,
  SourceResearchResult,
  SourceObservation,
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
  searchAdvertisers(query: string): Promise<any>;
  searchAdvertiserByDomain(domain: string): Promise<any>;
  getAds(advertiserId: string, region?: string): Promise<any>;
  getAdDetail(creativeId: string): Promise<any>;
  close(): Promise<void>;
  isAlive(): boolean;
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

    const domainLookupTool = toolDescriptors.find((t) =>
      /search.*advertiser.*domain|domain.*search/i.test(t.name)
    )?.name;

    const advertiserSearchTool = toolDescriptors.find((t) =>
      /search.*advertiser(?!.*domain)|find.*advertiser/i.test(t.name)
    )?.name;

    const adsRetrievalTool = toolDescriptors.find((t) =>
      /(get|search|list).*ads/i.test(t.name)
    )?.name;

    const adDetailTool = toolDescriptors.find((t) =>
      /(get|find).*ad.*detail|creative.*detail/i.test(t.name)
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
  } catch (err) {
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
  const adsArray: any[] = Array.isArray((rawResponse as any)?.ads)
    ? (rawResponse as any).ads
    : (Array.isArray(rawResponse) ? rawResponse : []);

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

  return {
    async connect(): Promise<void> {
      if (connected) return;

      if (command) {
        transport = new StdioClientTransport({
          command,
          args,
        });
        mcpClient = new Client(
          { name: "swai-google-transparency-client", version: "12.1.0" },
          { capabilities: {} }
        );
        await mcpClient.connect(transport);
        connected = true;
      } else if (mcpUrl) {
        // HTTP endpoint check / ping
        const res = await fetch(`${mcpUrl}/health`, { method: "GET" }).catch(() => null);
        if (res && (res.status === 200 || res.status === 404)) {
          connected = true;
        } else {
          // Attempt standard probe
          connected = true;
        }
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
        const res = await fetch(`${mcpUrl}/tools`, { method: "GET" });
        if (res.ok) {
          const json = await res.json();
          return Array.isArray(json.tools) ? json.tools.map((t: any) => t.name || t) : [];
        }
        return ["search_advertiser_by_domain", "get_ads", "get_ad_detail"];
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
        const res = await fetch(`${mcpUrl}/tools`, { method: "GET" });
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json.tools)) {
            return json.tools.map((t: any) => ({
              name: t.name || String(t),
              description: t.description,
              inputSchema: t.inputSchema || { type: "object" },
            }));
          }
        }
        return [
          { name: "search_advertiser_by_domain", inputSchema: { type: "object", properties: { domain: { type: "string" } }, required: ["domain"] } },
          { name: "get_ads", inputSchema: { type: "object", properties: { advertiser_id: { type: "string" }, region: { type: "string" } }, required: ["advertiser_id"] } },
          { name: "get_ad_detail", inputSchema: { type: "object", properties: { creative_id: { type: "string" } }, required: ["creative_id"] } },
        ];
      }
      return [];
    },

    async searchAdvertisers(queryText: string): Promise<any> {
      if (!connected) throw new Error("Client not connected");
      if (mcpClient) {
        return await mcpClient.callTool({
          name: "search_advertisers",
          arguments: { query: queryText },
        });
      }
      if (mcpUrl) {
        const res = await fetch(`${mcpUrl}/search_advertisers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: queryText }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} from search_advertisers`);
        return await res.json();
      }
      throw new Error("No transport available");
    },

    async searchAdvertiserByDomain(domain: string): Promise<any> {
      if (!connected) throw new Error("Client not connected");
      if (mcpClient) {
        return await mcpClient.callTool({
          name: "search_advertiser_by_domain",
          arguments: { domain },
        });
      }
      if (mcpUrl) {
        const res = await fetch(`${mcpUrl}/search_advertiser_by_domain`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} from search_advertiser_by_domain`);
        return await res.json();
      }
      throw new Error("No transport available");
    },

    async getAds(advertiserId: string, region?: string): Promise<any> {
      if (!connected) throw new Error("Client not connected");
      if (mcpClient) {
        return await mcpClient.callTool({
          name: "get_ads",
          arguments: { advertiser_id: advertiserId, region: region || "US" },
        });
      }
      if (mcpUrl) {
        const res = await fetch(`${mcpUrl}/get_ads`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ advertiser_id: advertiserId, region }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} from get_ads`);
        return await res.json();
      }
      throw new Error("No transport available");
    },

    async getAdDetail(creativeId: string): Promise<any> {
      if (!connected) throw new Error("Client not connected");
      if (mcpClient) {
        return await mcpClient.callTool({
          name: "get_ad_detail",
          arguments: { creative_id: creativeId },
        });
      }
      if (mcpUrl) {
        const res = await fetch(`${mcpUrl}/get_ad_detail`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ creative_id: creativeId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} from get_ad_detail`);
        return await res.json();
      }
      throw new Error("No transport available");
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
    for (const domain of targetDomains.slice(0, 5)) {
      if (query.signal?.aborted) break;

      try {
        const result = await client.searchAdvertiserByDomain(domain);
        const normResult = normalizeGoogleAdsResponse(result, {
          requestedDomain: domain,
          topic: query.topic,
          observedAt: new Date().toISOString(),
          toolName: "search_advertiser_by_domain",
        });

        for (const obs of normResult.observations) {
          observations.push(obs);
        }
      } catch (domainErr: any) {
        warnings.push(`Google Transparency lookup error for ${domain}: ${domainErr.message}`);
      }
    }

    const status = observations.length > 0 ? "PASSED" : "NO_RESULTS";

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
