/**
 * SWAI V11 — MetaAdsCollector MCP Client
 *
 * Implements an official Model Context Protocol TypeScript client managing a local
 * Python stdio subprocess (`python -m meta_ads_collector_mcp serve`).
 *
 * Provides strongly-typed tools access for discover, search, continue_search,
 * results, and inspect_ads with robust error classification and process lifecycle safety.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getMetaCollectorConfig } from "./metaCollectorConfig";
import {
  MetaCollectorCapabilities,
  MetaCollectorSearchResponse,
  MetaCollectorStoredResults,
  MetaCollectorInspectedAd,
  MetaCollectorRawAd,
  MetaCollectorFilters,
  MetaCollectorInspectItem,
} from "./metaCollectorTypes";
import { DiscoveryError } from "../types";

export interface MetaCollectorClient {
  getCapabilities(): Promise<MetaCollectorCapabilities>;
  searchAds(input: {
    query: string;
    country?: "US" | string;
    status?: "ACTIVE" | "INACTIVE" | "ALL";
    maxResults?: number;
    maxRequests?: number;
    maxSeconds?: number;
    pageSize?: number;
    filters?: MetaCollectorFilters;
  }): Promise<MetaCollectorSearchResponse>;
  continueSearch(resultSetId: string, batchSize?: number): Promise<MetaCollectorSearchResponse>;
  getResults(resultSetId: string, offset?: number, limit?: number, view?: "summary" | "detailed" | "raw"): Promise<MetaCollectorStoredResults>;
  inspectAds(resultSetId: string, libraryIds: string[], options?: { enrich?: boolean; downloadMedia?: boolean }): Promise<MetaCollectorInspectedAd[]>;
  close(): Promise<void>;
  isAlive(): boolean;
}

let cachedCapabilities: { data: MetaCollectorCapabilities; timestamp: number } | null = null;
const CAPABILITY_CACHE_TTL_MS = 60_000;

interface UpstreamErrorPayload {
  code?: string;
  message?: string;
  error?: string | UpstreamErrorPayload;
  details?: unknown;
}

function parseToolTextResponse<T>(contentArray: unknown): T {
  if (!Array.isArray(contentArray) || contentArray.length === 0) {
    throw new Error("Empty MCP tool response content");
  }

  const textItem = contentArray.find(
    (c): c is { type: string; text: string } =>
      Boolean(c && typeof c === "object" && "text" in c && typeof (c as { text: unknown }).text === "string")
  );
  if (!textItem) {
    // If structured content was returned directly
    const first = contentArray[0];
    if (first && typeof first === "object") {
      return first as T;
    }
    throw new Error("No textual or structured payload in MCP tool response");
  }

  try {
    return JSON.parse(textItem.text) as T;
  } catch (err) {
    throw new Error(`Failed to parse MCP tool response JSON: ${(err as Error).message}`);
  }
}

function mapUpstreamError(errorObj: unknown): Error {
  if (!errorObj) return new Error("Unknown MetaAdsCollector error");

  const err = errorObj as UpstreamErrorPayload;
  const code = err.code || "unknown";
  const message =
    typeof err.message === "string"
      ? err.message
      : typeof err.error === "string"
      ? err.error
      : JSON.stringify(err);

  if (code === "rate_limited" || message.toLowerCase().includes("rate limit") || message.toLowerCase().includes("too many requests")) {
    return new DiscoveryError({
      code: "PROVIDER_RATE_LIMITED",
      message: `Meta Ad Library rate limit encountered: ${message}`,
      providerId: "meta-ads-collector",
    });
  }

  if (
    code === "blocked_source" ||
    code === "permission_denied" ||
    message.toLowerCase().includes("blocked") ||
    message.toLowerCase().includes("challenge") ||
    message.toLowerCase().includes("captcha")
  ) {
    return new DiscoveryError({
      code: "PROVIDER_PERMISSION_DENIED",
      message: `Meta Ad Library access restricted: ${message}`,
      providerId: "meta-ads-collector",
    });
  }

  if (code === "invalid_input") {
    return new DiscoveryError({
      code: "PROVIDER_RESPONSE_INVALID",
      message: `MetaAdsCollector input validation error: ${message}`,
      providerId: "meta-ads-collector",
    });
  }

  return new Error(`MetaAdsCollector MCP Error [${code}]: ${message}`);
}

export async function createMetaCollectorClient(): Promise<MetaCollectorClient> {
  if (process.env.SWAI_MOCK_META_BOUNDARY === "fail") {
    throw new DiscoveryError({
      code: "PROVIDER_PERMISSION_DENIED",
      message: "Meta Ad Library access restricted: challenge encountered",
      providerId: "meta-ads-collector",
    });
  }

  if (process.env.SWAI_MOCK_META_BOUNDARY === "true") {
    const mockAds: MetaCollectorRawAd[] = [
      {
        id: "90000000001",
        page: { id: "page_mock_001", name: "PupComfort Official" },
        creatives: [
          {
            title: "Orthopedic Memory Foam Pet Bed",
            body: "Give your pup the best sleep with our premium washable orthopedic pet bed.",
            link_url: "https://pupcomfort.example.com/bed",
            image_url: "https://pupcomfort.example.com/images/bed.jpg",
            cta_text: "Shop Now",
          },
        ],
        start_date: new Date().toISOString(),
        is_active: true,
        publisher_platforms: ["FACEBOOK", "INSTAGRAM"],
      },
      {
        id: "90000000002",
        page: { id: "page_mock_001", name: "PupComfort Official" },
        creatives: [
          {
            title: "Calming Dog Donut Bed",
            body: "Anti-anxiety faux fur dog bed with deep crevices for restful burrowing.",
            link_url: "https://pupcomfort.example.com/donut",
            image_url: "https://pupcomfort.example.com/images/donut.jpg",
            cta_text: "Buy Now",
          },
        ],
        start_date: new Date().toISOString(),
        is_active: true,
        publisher_platforms: ["INSTAGRAM"],
      },
      {
        id: "90000000003",
        page: { id: "page_mock_002", name: "SleepyPaws US" },
        creatives: [
          {
            title: "Waterproof Pet Blanket & Furniture Cover",
            body: "Protect your sofa and car seats from pet hair, drool, and accidental spills.",
            link_url: "https://sleepypaws.example.com/blanket",
            image_url: "https://sleepypaws.example.com/images/blanket.jpg",
            cta_text: "Learn More",
          },
        ],
        start_date: new Date().toISOString(),
        is_active: true,
        publisher_platforms: ["FACEBOOK"],
      },
    ];

    const mockCapabilities: MetaCollectorCapabilities = {
      extension_version: "1.7.0",
      collector_version: "1.7.0",
      transport: "mock_test_boundary",
      persistent_worker_alive: true,
      operations: ["discover", "search", "continue_search", "results", "inspect_ads"],
      supported: {
        ad_types: ["ALL"],
        statuses: ["ACTIVE"],
        search_types: ["KEYWORD_EXACT_PHRASE"],
        sort_modes: ["relevance"],
        export_formats: ["json"],
        fields: ["id", "creative", "page"],
        events: [],
      },
      limits: {
        default_batch: 25,
        maximum_batch: 50,
        maximum_meta_page: 5,
        max_concurrency: 1,
        maximum_response_bytes: 10485760,
        maximum_ad_batch: 50,
      },
    };

    return {
      isAlive: () => true,
      async getCapabilities(): Promise<MetaCollectorCapabilities> {
        return mockCapabilities;
      },
      async searchAds(input) {
        const count = Math.min(input.maxResults || 25, mockAds.length);
        const ads = mockAds.slice(0, count);
        return {
          result_set_id: "rs_mock_acceptance_1",
          job: {
            id: "job_mock_1",
            state: "COMPLETED",
            count: ads.length,
          },
          ads,
          retrieval_pending: false,
          data_status: "query_exhausted",
          untrusted_ad_content: false,
        };
      },
      async continueSearch() {
        return {
          result_set_id: "rs_mock_acceptance_1",
          job: {
            id: "job_mock_1",
            state: "COMPLETED",
            count: 0,
          },
          ads: [],
          retrieval_pending: false,
          data_status: "query_exhausted",
          untrusted_ad_content: false,
        };
      },
      async getResults(resultSetId, offset = 0, limit = 25) {
        const slice = mockAds.slice(offset, offset + limit);
        return {
          result_set_id: resultSetId,
          job: {
            id: "job_mock_1",
            state: "COMPLETED",
            count: mockAds.length,
          },
          ads: slice,
          retrieval_pending: false,
          data_status: "query_exhausted",
        };
      },
      async inspectAds(_resultSetId, libraryIds) {
        return libraryIds.map((id) => {
          const matchingAd = mockAds.find((a) => a.id === id) || mockAds[0];
          return {
            id,
            ad: matchingAd,
          };
        });
      },
      async close(): Promise<void> {},
    };
  }

  const config = getMetaCollectorConfig();

  if (!config.enabled) {
    throw new DiscoveryError({
      code: "PROVIDER_NOT_CONFIGURED",
      message: "MetaAdsCollector provider is disabled via META_COLLECTOR_ENABLED=false",
      providerId: "meta-ads-collector",
    });
  }

  const transport = new StdioClientTransport({
    command: config.pythonBin,
    args: ["-m", "meta_ads_collector_mcp", "serve", "--data-dir", config.dataDir],
    env: {
      ...process.env,
      METAADS_MCP_DATA_DIR: config.dataDir,
    },
    stderr: "inherit",
  });

  const client = new Client(
    {
      name: "swai-meta-collector-client",
      version: "11.0.0",
    },
    {
      capabilities: {},
    }
  );

  let connected = false;

  // Connection with timeout protection
  const connectPromise = client.connect(transport);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Timeout initializing MetaAdsCollector MCP server")), 15000)
  );

  try {
    await Promise.race([connectPromise, timeoutPromise]);
    connected = true;
  } catch (err: unknown) {
    try {
      await transport.close();
    } catch {}
    throw new DiscoveryError({
      code: "PROVIDER_UNAVAILABLE",
      message: `Failed to launch local MetaAdsCollector MCP subprocess: ${(err as Error).message}`,
      providerId: "meta-ads-collector",
    });
  }

  // Validate tools availability
  const tools = await client.listTools();
  const toolNames = new Set(tools.tools.map((t) => t.name));
  const requiredTools = ["discover", "search", "continue_search", "results", "inspect_ads"];

  for (const req of requiredTools) {
    if (!toolNames.has(req)) {
      await client.close().catch(() => {});
      throw new DiscoveryError({
        code: "PROVIDER_RESPONSE_INVALID",
        message: `MetaAdsCollector MCP server is missing required tool: '${req}'. Available: ${Array.from(toolNames).join(", ")}`,
        providerId: "meta-ads-collector",
      });
    }
  }

  const metaCollectorClient: MetaCollectorClient = {
    isAlive() {
      return connected;
    },

    async getCapabilities(): Promise<MetaCollectorCapabilities> {
      const now = Date.now();
      if (cachedCapabilities && now - cachedCapabilities.timestamp < CAPABILITY_CACHE_TTL_MS) {
        return cachedCapabilities.data;
      }

      const res = await client.callTool({
        name: "discover",
        arguments: {},
      });

      if (res.isError) {
        throw new Error("Failed to discover MetaAdsCollector capabilities");
      }

      const parsed = parseToolTextResponse<MetaCollectorCapabilities>(res.content);
      cachedCapabilities = {
        data: parsed,
        timestamp: now,
      };
      return parsed;
    },

    async searchAds(input: {
      query: string;
      country?: "US" | string;
      status?: "ACTIVE" | "INACTIVE" | "ALL";
      maxResults?: number;
      maxRequests?: number;
      maxSeconds?: number;
      pageSize?: number;
      filters?: MetaCollectorFilters;
    }): Promise<MetaCollectorSearchResponse> {
      // 1. Sanitize & clamp input parameters
      const cleanQuery = (input.query || "").trim().slice(0, 1000);
      const country = (input.country || config.defaultCountry || "US").toUpperCase().slice(0, 2);
      const status = input.status || "ACTIVE";
      const pageSize = Math.min(30, Math.max(1, input.pageSize || 20));
      const maxResults = Math.min(config.maxResults, Math.max(1, input.maxResults || 25));
      const maxRequests = Math.min(config.maxRequests, Math.max(1, input.maxRequests || 10));
      const maxSeconds = Math.min(config.maxSeconds, Math.max(10, input.maxSeconds || 300));

      const searchConfig: Record<string, unknown> = {
        query: cleanQuery,
        country,
        ad_type: "ALL",
        status,
        search_type: "KEYWORD_UNORDERED",
        page_size: pageSize,
        max_results: maxResults,
        max_requests: maxRequests,
        max_seconds: maxSeconds,
        timeout: 30,
      };

      if (input.filters && Object.keys(input.filters).length > 0) {
        searchConfig.filters = input.filters;
      }

      const payload = {
        search: searchConfig,
        batch_size: pageSize,
        background: false,
      };

      const res = await client.callTool({
        name: "search",
        arguments: payload,
      });

      if (res.isError) {
        const errPayload = parseToolTextResponse<UpstreamErrorPayload>(res.content);
        throw mapUpstreamError(errPayload?.error || errPayload);
      }

      const searchRes = parseToolTextResponse<MetaCollectorSearchResponse>(res.content);

      if (searchRes.job?.state === "FAILED" && searchRes.job.error) {
        throw mapUpstreamError(searchRes.job.error);
      }

      return searchRes;
    },

    async continueSearch(resultSetId: string, batchSize: number = 20): Promise<MetaCollectorSearchResponse> {
      const clampedBatch = Math.min(100, Math.max(1, batchSize));

      const res = await client.callTool({
        name: "continue_search",
        arguments: {
          result_set_id: resultSetId,
          batch_size: clampedBatch,
        },
      });

      if (res.isError) {
        const errPayload = parseToolTextResponse<UpstreamErrorPayload>(res.content);
        throw mapUpstreamError(errPayload?.error || errPayload);
      }

      const searchRes = parseToolTextResponse<MetaCollectorSearchResponse>(res.content);
      if (searchRes.job?.state === "FAILED" && searchRes.job.error) {
        throw mapUpstreamError(searchRes.job.error);
      }

      return searchRes;
    },

    async getResults(
      resultSetId: string,
      offset: number = 0,
      limit: number = 20,
      view: "summary" | "detailed" | "raw" = "detailed"
    ): Promise<MetaCollectorStoredResults> {
      const clampedLimit = Math.min(100, Math.max(1, limit));

      const res = await client.callTool({
        name: "results",
        arguments: {
          result_set_id: resultSetId,
          offset: Math.max(0, offset),
          limit: clampedLimit,
          view,
        },
      });

      if (res.isError) {
        const errPayload = parseToolTextResponse<UpstreamErrorPayload>(res.content);
        throw mapUpstreamError(errPayload?.error || errPayload);
      }

      return parseToolTextResponse<MetaCollectorStoredResults>(res.content);
    },

    async inspectAds(
      resultSetId: string,
      libraryIds: string[],
      options?: { enrich?: boolean; downloadMedia?: boolean }
    ): Promise<MetaCollectorInspectedAd[]> {
      const boundedIds = libraryIds.slice(0, 20);
      if (boundedIds.length === 0) return [];

      const res = await client.callTool({
        name: "inspect_ads",
        arguments: {
          result_set_id: resultSetId,
          ad_ids: boundedIds,
          enrich: Boolean(options?.enrich),
          download_media: Boolean(options?.downloadMedia),
          view: "detailed",
        },
      });

      if (res.isError) {
        const errPayload = parseToolTextResponse<UpstreamErrorPayload>(res.content);
        throw mapUpstreamError(errPayload?.error || errPayload);
      }

      const rawResult = parseToolTextResponse<{ items?: MetaCollectorInspectItem[]; ads?: MetaCollectorRawAd[] }>(res.content);
      if (Array.isArray(rawResult.items)) {
        return rawResult.items.map((item) => ({
          id: item.ad?.id,
          ad: item.ad,
          enrichment: item.enrichment,
          media: item.media,
          media_downloaded: Boolean(item.media && item.media.length > 0),
        }));
      }

      return (rawResult.ads || []).map((ad) => ({
        id: ad.id,
        ad,
      }));
    },

    async close(): Promise<void> {
      if (connected) {
        connected = false;
        try {
          await client.close();
        } catch {}
      }
    },
  };

  // Safe process shutdown hooks to prevent orphaned python processes
  const handleExit = () => {
    metaCollectorClient.close().catch(() => {});
  };
  process.once("exit", handleExit);
  process.once("SIGINT", handleExit);
  process.once("SIGTERM", handleExit);

  return metaCollectorClient;
}

export async function getMetaCollectorCapabilities(): Promise<MetaCollectorCapabilities> {
  const client = await createMetaCollectorClient();
  try {
    return await client.getCapabilities();
  } finally {
    await client.close();
  }
}

/**
 * Helper to fetch detailed records for a batch from stored MCP results.
 * Validates IDs and preserves ordering and batch boundaries (Phase 2, Items 17-18).
 */
export async function getDetailedMetaAdsBatch(
  client: MetaCollectorClient,
  resultSetId: string,
  offset: number,
  limit: number
): Promise<MetaCollectorRawAd[]> {
  try {
    const stored = await client.getResults(resultSetId, offset, limit, "detailed");
    const ads = stored.ads || [];
    return ads.filter((ad) => Boolean(ad && typeof ad.id === "string" && ad.id.trim().length > 0));
  } catch (err) {
    console.warn(`[getDetailedMetaAdsBatch] Failed fetching detailed batch for resultSet ${resultSetId} offset ${offset}:`, err);
    throw err;
  }
}

