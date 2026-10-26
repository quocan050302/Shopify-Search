/**
 * SWAI KH-02 — Multi-Source Registry, Capabilities & Readiness Evaluator
 *
 * Enforces zero-cost default protection, truthful capability disclosures,
 * and transparent source status indicators across all 4 platforms + historical demand.
 */

import {
  IntelligenceSource,
  SourceCapabilities,
  SourceRunStatus,
  IntelligenceQuery,
} from "../types";
import { getProviderBudget } from "@/services/providers/budgetService";

export const KH02_SOURCE_CAPABILITIES: Record<IntelligenceSource, SourceCapabilities> = {
  META_ADS: {
    source: "META_ADS",
    displayName: "Meta Ad Library (Facebook / Instagram)",
    supportsUS: true,
    supportsKeywordSearch: true,
    supportsAdvertiserSearch: true,
    supportsPagination: true,
    supportsDateFiltering: true,
    supportsNewestSorting: true,
    supportsVideoMetadata: true,
    supportsEngagementMetrics: false, // Meta Ad Library does not disclose private ROAS/impressions
    supportsHistoricalObservations: true,
    coverageDescription: "Comprehensive US competitor advertising intelligence via verified Meta Ad Library observations.",
    isOfficialAPI: false, // Powered by local self-hosted MetaAdsCollector MCP
    isPaidOrMetered: false, // Free zero-cost local research
    estimatedCostPerQueryCredits: 0,
  },
  TIKTOK_ADS: {
    source: "TIKTOK_ADS",
    displayName: "TikTok Ads US (Creative Center)",
    supportsUS: true,
    supportsKeywordSearch: true,
    supportsAdvertiserSearch: false,
    supportsPagination: false,
    supportsDateFiltering: true,
    supportsNewestSorting: false,
    supportsVideoMetadata: true,
    supportsEngagementMetrics: true, // Relative CTR / Top percentage buckets
    supportsHistoricalObservations: false,
    coverageDescription: "TikTok Creative Center Top Ads for US commercial trends. Note: Official Commercial Content Library covers EU/UK; US requires verified Creative Center research or manual URL import.",
    isOfficialAPI: false,
    isPaidOrMetered: false,
    estimatedCostPerQueryCredits: 0,
  },
  TIKTOK_ORGANIC: {
    source: "TIKTOK_ORGANIC",
    displayName: "TikTok Organic Video Research",
    supportsUS: false, // Global public video search; US audience must be observed or confirmed
    supportsKeywordSearch: true,
    supportsAdvertiserSearch: false,
    supportsPagination: true,
    supportsDateFiltering: true,
    supportsNewestSorting: true,
    supportsVideoMetadata: true,
    supportsEngagementMetrics: true, // Views, likes, comments, shares, saves
    supportsHistoricalObservations: true, // Multiple observations evaluate real view velocity
    coverageDescription: "Public TikTok product video intelligence, play counts, observed engagement ratios, and creator diversity.",
    isOfficialAPI: false,
    isPaidOrMetered: true, // Metered API allowance (e.g. HasData credits)
    estimatedCostPerQueryCredits: 1,
  },
  GOOGLE_ADS: {
    source: "GOOGLE_ADS",
    displayName: "Google Ads Transparency Center",
    supportsUS: true,
    supportsKeywordSearch: false, // Lookups require confirmed advertiser name or landing page domain
    supportsAdvertiserSearch: true,
    supportsPagination: true,
    supportsDateFiltering: true, // Returns last shown date when available
    supportsNewestSorting: false,
    supportsVideoMetadata: true,
    supportsEngagementMetrics: false, // Google Transparency Center does not disclose spend or conversion metrics
    supportsHistoricalObservations: true,
    coverageDescription: "Commercial advertiser presence and active creative formats via Google Ads Transparency Center.",
    isOfficialAPI: false, // Unofficial public transparency center interface
    isPaidOrMetered: false,
    estimatedCostPerQueryCredits: 0,
  },
  DEMAND_HISTORY: {
    source: "DEMAND_HISTORY",
    displayName: "Historical Demand & Trend Stability (Google Trends)",
    supportsUS: true,
    supportsKeywordSearch: true,
    supportsAdvertiserSearch: false,
    supportsPagination: true,
    supportsDateFiltering: true,
    supportsNewestSorting: true,
    supportsVideoMetadata: false,
    supportsEngagementMetrics: true, // Relative search index (0-100)
    supportsHistoricalObservations: true,
    coverageDescription: "Multi-month time series tracking relative search interest, persistence, and seasonality in the US.",
    isOfficialAPI: false,
    isPaidOrMetered: false,
    estimatedCostPerQueryCredits: 0,
  },
};

/**
 * Returns static capabilities and limitations for a specific intelligence source.
 */
export function getKH02SourceCapabilities(source: IntelligenceSource): SourceCapabilities {
  return KH02_SOURCE_CAPABILITIES[source];
}

/**
 * Lists all KH-02 source capabilities.
 */
export function listKH02SourceCapabilities(): SourceCapabilities[] {
  return Object.values(KH02_SOURCE_CAPABILITIES);
}

/**
 * Evaluates live configuration and readiness of a source without initiating expensive calls.
 */
export async function checkKH02ProviderReadiness(
  source: IntelligenceSource,
  workspaceId?: string
): Promise<{ ready: boolean; status: SourceRunStatus; reason: string }> {
  switch (source) {
    case "META_ADS": {
      return {
        ready: true,
        status: "SOURCE_ACCESS_VERIFIED",
        reason: "Meta competitor ads indexed in database; live collection requires authorized collector.",
      };
    }

    case "TIKTOK_ADS": {
      // Automated US competitor ad coverage is not universally verified; manual research / link import is ready
      return {
        ready: true,
        status: "NOT_VERIFIED",
        reason: "Automated TikTok US ad provider is unconfigured; manual Creative Center lookup & batch import available.",
      };
    }

    case "TIKTOK_ORGANIC": {
      // Check if TikTok organic provider / key is configured
      const hasDataKey = process.env.HASDATA_API_KEY || process.env.TIKTOK_ORGANIC_API_KEY;
      if (!hasDataKey) {
        return {
          ready: false,
          status: "NOT_CONFIGURED",
          reason: "TikTok Organic API key (HASDATA_API_KEY) not configured in environment.",
        };
      }
      return {
        ready: true,
        status: "CONFIGURED",
        reason: "TikTok Organic API credentials configured.",
      };
    }

    case "GOOGLE_ADS": {
      // Check if Google Ads Transparency proxy/server is reachable or configured
      const googleEnabled = process.env.GOOGLE_TRANSPARENCY_ENABLED !== "false";
      if (!googleEnabled) {
        return {
          ready: false,
          status: "SKIPPED",
          reason: "Google Ads Transparency research is disabled by environment configuration.",
        };
      }
      const hasEndpoint = Boolean(process.env.GOOGLE_TRANSPARENCY_MCP_URL || process.env.GOOGLE_ADS_MCP_URL || process.env.GOOGLE_TRANSPARENCY_MCP_COMMAND);
      if (!hasEndpoint) {
        return {
          ready: false,
          status: "NOT_CONFIGURED",
          reason: "Google Ads Transparency MCP server is not configured in environment.",
        };
      }
      return {
        ready: true,
        status: "CONFIGURED",
        reason: "Google Ads Transparency MCP endpoint configured.",
      };
    }

    case "DEMAND_HISTORY": {
      return {
        ready: true,
        status: "CONFIGURED",
        reason: "Demand history policy engine active; requires 3+ temporal observations across 60+ days for verified status.",
      };
    }

    default:
      return {
        ready: false,
        status: "SKIPPED",
        reason: `Unknown intelligence source: ${source}`,
      };
  }
}

/**
 * Calculates projected credit consumption and checks paid authorization safeguards.
 */
export function estimateResearchProviderCost(
  source: IntelligenceSource,
  query: IntelligenceQuery
): { estimatedCredits: number; requiresPaidApproval: boolean; isAllowed: boolean; reason?: string } {
  const capabilities = getKH02SourceCapabilities(source);
  if (!capabilities.isPaidOrMetered) {
    return {
      estimatedCredits: 0,
      requiresPaidApproval: false,
      isAllowed: true,
    };
  }

  // Calculate estimated credit cost based on maxResults
  const units = Math.ceil(query.maxResults / 10);
  const estimatedCredits = units * capabilities.estimatedCostPerQueryCredits;

  // In zero-cost mode, check if automatic paid API requests are allowed
  const autoPaidAllowed = process.env.AUTO_PAID_RESEARCH === "true";
  if (!autoPaidAllowed) {
    return {
      estimatedCredits,
      requiresPaidApproval: true,
      isAllowed: false,
      reason: "Automatic paid research is disabled by default. Configure budget in Settings to enable metered queries.",
    };
  }

  return {
    estimatedCredits,
    requiresPaidApproval: false,
    isAllowed: true,
  };
}
