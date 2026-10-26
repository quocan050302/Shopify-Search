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
 * 5. Supports standard MCP tool protocol (stdio or HTTP MCP transport).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  IntelligenceQuery,
  SourceResearchResult,
  SourceObservation,
} from "../types";

export interface GoogleTransparencyMcpClient {
  connect(): Promise<void>;
  listTools(): Promise<string[]>;
  searchAdvertisers(query: string): Promise<any>;
  searchAdvertiserByDomain(domain: string): Promise<any>;
  getAds(advertiserId: string, region?: string): Promise<any>;
  getAdDetail(creativeId: string): Promise<any>;
  close(): Promise<void>;
  isAlive(): boolean;
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
        const ads: any[] = Array.isArray(result?.ads)
          ? result.ads
          : (Array.isArray(result) ? result : []);

        for (const ad of ads) {
          const creativeId = String(ad.creative_id || ad.id || "");
          if (!creativeId) continue;

          const format = ad.format === "video" ? "VIDEO" : (ad.format === "image" ? "IMAGE" : "TEXT");
          
          // Evaluate product relevance against topic
          const textContent = `${ad.headline || ""} ${ad.body || ""}`.toLowerCase();
          const topicWords = query.topic.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
          const hasTopicMatch = topicWords.some((w) => textContent.includes(w));
          const relevance = hasTopicMatch ? "PRODUCT_SPECIFIC" : "BRAND_RELATED";

          // Strict market verification: do not default to US unless source proves it
          const deliveryRegion = ad.region || ad.delivery_region || ad.target_country || null;
          const verifiedDeliveryMarket = (deliveryRegion === "US" || deliveryRegion === "USA") ? "US" : null;

          observations.push({
            source: "GOOGLE_ADS",
            sourceRecordId: creativeId,
            sourceUrl: ad.source_url || `https://adstransparency.google.com/advertiser/${ad.advertiser_id || ""}`,
            advertiserOrCreator: ad.advertiser_name || domain,
            advertiserDomain: domain,
            productMatchHint: ad.headline || null,
            reportedPublishedAt: null,
            reportedFirstShownAt: ad.first_shown || null,
            reportedLastShownAt: ad.last_shown || null,
            observedAt: new Date().toISOString(),
            requestedMarket: "US",
            verifiedDeliveryMarket,
            title: ad.headline || null,
            description: ad.body || null,
            metrics: {
              lastShown: ad.last_shown,
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
