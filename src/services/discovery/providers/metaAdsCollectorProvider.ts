/**
 * SWAI V11 — Self-Hosted MetaAdsCollector Provider
 *
 * Implements the AdDiscoveryProvider interface for researching the public Meta (Facebook) Ad Library
 * through the local Python MetaAdsCollector MCP server.
 *
 * Zero external paid API keys. Communicates via stdio directly to the local Python virtual environment.
 */

import fs from "fs";
import {
  AdDiscoveryProvider,
  ProviderAvailabilityResult,
  ProviderCostEstimate,
  ProviderRequestContext,
} from "../providerContract";
import {
  DiscoveryQuery,
  DiscoveryPageResult,
  DiscoveryProviderCapabilities,
  DiscoveryError,
} from "../types";
import {
  createMetaCollectorClient,
  MetaCollectorClient,
  getDetailedMetaAdsBatch,
} from "../metaCollector/metaCollectorMcpClient";
import { getMetaCollectorConfig } from "../metaCollector/metaCollectorConfig";
import { MetaCollectorFilters, MetaCollectorRawAd } from "../metaCollector/metaCollectorTypes";
import { normalizeMetaCollectorAd } from "../normalization/normalizeMetaCollectorAd";

interface MetaCursorPayload {
  resultSetId: string;
  offset: number;
  mode: "stored" | "upstream";
}

function parseCursor(cursor?: string | null): MetaCursorPayload | null {
  if (!cursor || typeof cursor !== "string") return null;
  const trimmed = cursor.trim();
  if (!trimmed) return null;

  // Try JSON base64
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.resultSetId === "string" && parsed.resultSetId.length > 0) {
      return {
        resultSetId: parsed.resultSetId,
        offset: typeof parsed.offset === "number" ? parsed.offset : 0,
        mode: parsed.mode === "stored" ? "stored" : "upstream",
      };
    }
  } catch {}

  // Try colon format "resultSetId:offset"
  if (trimmed.includes(":")) {
    const parts = trimmed.split(":");
    return {
      resultSetId: parts[0],
      offset: parseInt(parts[1], 10) || 0,
      mode: "stored",
    };
  }

  // Raw resultSetId (e.g. hex UUID)
  return {
    resultSetId: trimmed,
    offset: 0,
    mode: "upstream",
  };
}

function encodeCursor(resultSetId: string, offset: number, mode: "stored" | "upstream"): string {
  return Buffer.from(JSON.stringify({ resultSetId, offset, mode })).toString("base64");
}

export class MetaAdsCollectorProvider implements AdDiscoveryProvider {
  readonly id = "meta-ads-collector";
  readonly name = "Meta Ad Library (Local MCP Collector)";
  readonly version = "11.0.0";

  private cachedAvailability: {
    result: ProviderAvailabilityResult;
    timestamp: number;
  } | null = null;
  private readonly CACHE_TTL_MS = 30_000;

  getCapabilities(): DiscoveryProviderCapabilities {
    return {
      providerId: this.id,
      displayName: "Meta Ad Library (Local Collector)",
      description:
        "Self-hosted research engine accessing public Meta Ad Library endpoints via local Python MCP server. " +
        "Zero third-party scraping subscription fees, zero cloud tunnels.",
      supportsUS: true,
      supportsKeywordFiltering: true,
      supportsKeywords: true,
      supportsIndustryFiltering: false,
      supportsIndustries: false,
      supportsPagination: true,
      supportsAdDetails: true,
      supportsVideoMetadata: true,
      supportsLifecycleMetadata: true,
      requiresAuthentication: false,
      requiresAuth: false,
      isPaid: false,
      isLiveVerified: false,
      authMethod: "NONE",
      allowedDataAccess: "PUBLIC_AD_LIBRARY",
      supportedRegions: ["US", "GLOBAL"],
      sourceType: "INTERNAL_ENDPOINT",
      notes: "Local MCP stdio service running in services/meta-ads-collector/.venv",
    };
  }

  getProviderConfigurationStatus(): ProviderAvailabilityResult {
    if (process.env.SWAI_MOCK_META_BOUNDARY === "true") {
      return {
        status: "READY_UNVERIFIED",
        isAuthorized: true,
        requiresConfig: false,
        message: "Approved mock Meta boundary enabled for testing.",
      };
    }
    const config = getMetaCollectorConfig();

    if (!config.enabled) {
      return {
        status: "NOT_CONFIGURED",
        isAuthorized: false,
        requiresConfig: true,
        message: "MetaAdsCollector is disabled via META_COLLECTOR_ENABLED=false",
      };
    }

    if (!fs.existsSync(config.pythonBin)) {
      return {
        status: "NOT_CONFIGURED",
        isAuthorized: false,
        requiresConfig: true,
        message: `Python virtual environment binary not found at '${config.pythonBin}'. Run: bash scripts/meta-collector-setup.sh`,
      };
    }

    return {
      status: "READY_UNVERIFIED",
      isAuthorized: true,
      requiresConfig: false,
      message: `Python environment ready (${config.pythonBin}). MCP server ready for local requests.`,
    };
  }

  async checkAvailability(): Promise<ProviderAvailabilityResult> {
    const now = Date.now();
    if (this.cachedAvailability && now - this.cachedAvailability.timestamp < this.CACHE_TTL_MS) {
      return this.cachedAvailability.result;
    }

    const localConfig = this.getProviderConfigurationStatus();
    if (localConfig.status === "NOT_CONFIGURED") {
      return localConfig;
    }

    try {
      const client = await createMetaCollectorClient();
      try {
        const caps = await client.getCapabilities();
        const result: ProviderAvailabilityResult = {
          status: "AVAILABLE",
          isAuthorized: true,
          requiresConfig: false,
          message: `Local MetaAdsCollector MCP server responsive (Collector v${caps.collector_version}, Extension v${caps.extension_version}).`,
        };
        this.cachedAvailability = { result, timestamp: now };
        return result;
      } finally {
        await client.close();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isBlocked = msg.toLowerCase().includes("blocked") || msg.toLowerCase().includes("restricted");
      const result: ProviderAvailabilityResult = {
        status: isBlocked ? "BLOCKED_SOURCE" : "NOT_CONFIGURED",
        isAuthorized: false,
        requiresConfig: true,
        message: `Local MCP server check failed: ${msg}`,
      };
      this.cachedAvailability = { result, timestamp: now };
      return result;
    }
  }

  async verifyProviderConnection(): Promise<ProviderAvailabilityResult> {
    const startTime = Date.now();

    try {
      const client = await createMetaCollectorClient();
      try {
        // Run a small, bounded test search for a common commercial keyword
        const testRes = await client.searchAds({
          query: "pet hair remover",
          country: "US",
          status: "ACTIVE",
          maxResults: 5,
          maxRequests: 2,
          maxSeconds: 30,
          pageSize: 5,
        });

        const latencyMs = Date.now() - startTime;
        const retrieved = testRes.ads?.length || 0;

        if (retrieved > 0) {
          return {
            status: "LIVE_VERIFIED",
            isAuthorized: true,
            requiresConfig: false,
            message: `Live Meta Ad Library probe succeeded in ${latencyMs}ms. Retrieved ${retrieved} factual ad records from public endpoint.`,
          };
        }

        return {
          status: "AVAILABLE",
          isAuthorized: true,
          requiresConfig: false,
          message: `Live Meta Ad Library query completed in ${latencyMs}ms with 0 ads returned. Upstream source reachable and MCP responsive, but no ad records collected for test query.`,
        };
      } finally {
        await client.close();
      }
    } catch (err: unknown) {
      const latencyMs = Date.now() - startTime;
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.toLowerCase().includes("blocked") || msg.toLowerCase().includes("captcha") || msg.toLowerCase().includes("challenge")) {
        return {
          status: "BLOCKED_SOURCE",
          isAuthorized: false,
          requiresConfig: false,
          message: `Meta Ad Library access restricted by endpoint challenge (${latencyMs}ms): ${msg}`,
        };
      }

      if (msg.toLowerCase().includes("rate limit") || msg.toLowerCase().includes("too many")) {
        return {
          status: "RATE_LIMITED",
          isAuthorized: false,
          requiresConfig: false,
          message: `Meta Ad Library rate limited (${latencyMs}ms): ${msg}`,
        };
      }

      return {
        status: "NOT_CONFIGURED",
        isAuthorized: false,
        requiresConfig: true,
        message: `Live verification failed (${latencyMs}ms): ${msg}`,
      };
    }
  }

  estimateCost(query: DiscoveryQuery): ProviderCostEstimate {
    void query;
    return {
      estimatedCredits: 0,
      estimatedCostUsd: 0.0,
      isPaid: false,
      isMetered: false,
      isBudgetAvailable: true,
      budgetWarning: undefined,
    };
  }

  async discoverPage(
    query: DiscoveryQuery,
    cursor?: string | null,
    _context?: ProviderRequestContext
  ): Promise<DiscoveryPageResult> {
    const keyword = query.keywords && query.keywords.length > 0 ? query.keywords[0] : "";
    if (!keyword) {
      throw new DiscoveryError({
        code: "PROVIDER_RESPONSE_INVALID",
        message: "Meta Ad Library search requires at least one keyword.",
        providerId: this.id,
      });
    }

    const pageSize = Math.min(30, Math.max(5, query.pageSize || 20));
    const requestedLimit = Math.min(100, Math.max(1, query.requestedLimit || 25));

    let client: MetaCollectorClient | null = null;

    try {
      client = await createMetaCollectorClient();

      const cursorPayload = parseCursor(cursor);
      let rawAds: MetaCollectorRawAd[] = [];
      let resultSetId = "";
      let nextCursor: string | null = null;
      const warnings: string[] = [];

      let launchCutoffDate: Date | null = null;
      if (query.launchWithinDays) {
        launchCutoffDate = new Date(Date.now() - query.launchWithinDays * 24 * 60 * 60 * 1000);
      }

      if (cursorPayload) {
        resultSetId = cursorPayload.resultSetId;

        if (cursorPayload.mode === "stored" && cursorPayload.offset > 0) {
          // Paginating through already stored detailed results
          try {
            const stored = await client.getResults(resultSetId, cursorPayload.offset, pageSize, "detailed");
            rawAds = stored.ads || [];
            if (stored.next_offset) {
              nextCursor = encodeCursor(resultSetId, stored.next_offset, "stored");
            } else if (stored.continuation) {
              nextCursor = encodeCursor(resultSetId, 0, "upstream");
            }
          } catch (err: unknown) {
            warnings.push(`Failed to read stored results at offset ${cursorPayload.offset}: ${(err as Error).message}`);
          }
        }

        if (rawAds.length === 0) {
          // Upstream continuation: continueSearch takes raw resultSetId
          const continueRes = await client.continueSearch(resultSetId, pageSize);
          resultSetId = continueRes.result_set_id || resultSetId;

          try {
            // Always retrieve detailed view for real creative URLs
            rawAds = await getDetailedMetaAdsBatch(client, resultSetId, cursorPayload.offset || 0, pageSize);
          } catch {
            rawAds = continueRes.ads || [];
          }

          if (continueRes.next_offset) {
            nextCursor = encodeCursor(resultSetId, continueRes.next_offset, "stored");
          } else if (continueRes.continuation) {
            nextCursor = encodeCursor(resultSetId, 0, "upstream");
          }
        }
      } else {
        // New search with collector-side filters translation (Phase 9)
        const filters: MetaCollectorFilters = {};
        if (launchCutoffDate) {
          filters.start_date = launchCutoffDate.toISOString();
        }
        if (query.creativePreference === "VIDEO") {
          filters.has_video = true;
          filters.media_type = "VIDEO";
        } else if (query.creativePreference === "IMAGE") {
          filters.has_image = true;
          filters.media_type = "IMAGE";
        }

        const searchStatus =
          query.activeStatus === "ALL"
            ? "ALL"
            : query.activeStatus === "INACTIVE"
            ? "INACTIVE"
            : "ACTIVE";

        const mcpResponse = await client.searchAds({
          query: keyword,
          country: query.market || "US",
          status: searchStatus,
          maxResults: requestedLimit,
          maxRequests: 10,
          maxSeconds: 120,
          pageSize,
          filters,
        });

        resultSetId = mcpResponse.result_set_id;

        // Retrieve DETAILED batch using getDetailedMetaAdsBatch (Phase 2, Items 13-18)
        try {
          rawAds = await getDetailedMetaAdsBatch(client, resultSetId, 0, pageSize);
        } catch (detailErr: unknown) {
          warnings.push(
            `Detailed results fetch failed; using summary results with media marked restricted: ${(detailErr as Error).message}`
          );
          rawAds = (mcpResponse.ads || []).map((ad) => ({
            ...ad,
            thumbnail_url: null,
            video_url: null,
          }));
        }

        if (mcpResponse.next_offset) {
          nextCursor = encodeCursor(resultSetId, mcpResponse.next_offset, "stored");
        } else if (mcpResponse.continuation) {
          nextCursor = encodeCursor(resultSetId, 0, "upstream");
        }
      }

      const normalizedAds = [];
      for (const raw of rawAds) {
        try {
          const norm = normalizeMetaCollectorAd(raw, {
            queryMarket: query.market || "US",
            keyword,
          });

          // Strict freshness filter check: if launchWithinDays is requested, require usable start date within cutoff
          if (launchCutoffDate) {
            if (!norm.sourceReportedStartAt || norm.sourceReportedStartAt < launchCutoffDate) {
              continue;
            }
          }

          // Strict creative preference filter check
          if (query.creativePreference === "VIDEO" && norm.mediaType !== "VIDEO") {
            continue;
          }
          if (
            query.creativePreference === "IMAGE" &&
            norm.mediaType !== "IMAGE" &&
            norm.mediaType !== "CAROUSEL"
          ) {
            continue;
          }

          normalizedAds.push(norm);
        } catch (normErr: unknown) {
          warnings.push(`Record ${raw?.id || "unknown"} rejected: ${(normErr as Error).message}`);
        }
      }

      const hasMore = Boolean(nextCursor && normalizedAds.length > 0);

      return {
        items: normalizedAds,
        nextCursor,
        hasMore,
        requestId: resultSetId,
        usage: {
          creditsUsed: 0,
          costUsd: 0.0,
        },
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (err: unknown) {
      if (err instanceof DiscoveryError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("blocked") || msg.toLowerCase().includes("challenge")) {
        throw new DiscoveryError({
          code: "PROVIDER_PERMISSION_DENIED",
          message: `Meta Ad Library access restricted: ${msg}`,
          providerId: this.id,
        });
      }
      if (msg.toLowerCase().includes("rate limit")) {
        throw new DiscoveryError({
          code: "PROVIDER_RATE_LIMITED",
          message: `Meta Ad Library rate limit: ${msg}`,
          providerId: this.id,
        });
      }
      throw new DiscoveryError({
        code: "PROVIDER_UNAVAILABLE",
        message: `MetaAdsCollector execution error: ${msg}`,
        providerId: this.id,
      });
    } finally {
      if (client) {
        await client.close().catch(() => {});
      }
    }
  }
}
