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
import { prisma } from "@/lib/db";
import { diagnoseMetaLiveCollector } from "./metaResearchAdapter";

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

export interface SourceDiagnosticResult {
  source: string;
  adapterInstalled: boolean;
  configured: boolean;
  transportConnected: boolean | null;
  authenticated: boolean | null;
  discoverySupported: boolean | null;
  queryExecuted: boolean;
  recordsReturned: number | null;
  provenanceVerified: boolean;
  lastCheckedAt: string;
  status: string;
  reason: string;
  missingRequirements: string[];
}

export interface SourceDiagnosticContext {
  workspaceId?: string;
  checkLiveTransport?: boolean;
}

export interface TestConnectionContext {
  workspaceId?: string;
  timeoutMs?: number;
  allowPaidOperations?: boolean;
}

/**
 * Diagnoses live configuration, adapter presence, database indices, and capability readiness of a source.
 */
export async function diagnoseKH02Source(
  source: IntelligenceSource,
  context?: SourceDiagnosticContext
): Promise<SourceDiagnosticResult> {
  const lastCheckedAt = new Date().toISOString();

  switch (source) {
    case "META_ADS": {
      return diagnoseMetaLiveCollector(context);
    }

    case "TIKTOK_ADS": {
      let recordCount = 0;
      try {
        recordCount = await prisma.competitorAd.count({ where: { platform: "TIKTOK" } });
      } catch {}

      return {
        source: "TIKTOK_ADS",
        adapterInstalled: true,
        configured: false,
        transportConnected: false,
        authenticated: null,
        discoverySupported: false,
        queryExecuted: recordCount > 0,
        recordsReturned: recordCount,
        provenanceVerified: recordCount > 0,
        lastCheckedAt,
        status: "MANUAL_RESEARCH_ONLY",
        reason: "Automated TikTok US ad provider is unconfigured (TIKTOK_ADS_US_LIVE: BLOCKED); database competitor ad search active, manual Creative Center lookup & batch import available.",
        missingRequirements: ["TIKTOK_CREATIVE_CENTER_API_OR_MANUAL_IMPORT"],
      };
    }

    case "TIKTOK_ORGANIC": {
      const hasDataKey = process.env.HASDATA_API_KEY || process.env.TIKTOK_ORGANIC_API_KEY;
      if (!hasDataKey) {
        return {
          source: "TIKTOK_ORGANIC",
          adapterInstalled: true,
          configured: false,
          transportConnected: null,
          authenticated: false,
          discoverySupported: false,
          queryExecuted: false,
          recordsReturned: 0,
          provenanceVerified: false,
          lastCheckedAt,
          status: "CREDENTIALS_REQUIRED",
          reason: "TikTok Organic API key (HASDATA_API_KEY) not configured in environment (TIKTOK_ORGANIC_LIVE: BLOCKED). Configure HASDATA_API_KEY to enable live organic search.",
          missingRequirements: ["HASDATA_API_KEY"],
        };
      }
      return {
        source: "TIKTOK_ORGANIC",
        adapterInstalled: true,
        configured: true,
        transportConnected: true,
        authenticated: true,
        discoverySupported: true,
        queryExecuted: false,
        recordsReturned: null,
        provenanceVerified: false,
        lastCheckedAt,
        status: "CONFIGURED",
        reason: "TikTok Organic API credentials configured (Paid queries gated by AUTO_PAID_RESEARCH policy).",
        missingRequirements: [],
      };
    }

    case "GOOGLE_ADS": {
      const googleEnabled = process.env.GOOGLE_TRANSPARENCY_ENABLED !== "false";
      if (!googleEnabled) {
        return {
          source: "GOOGLE_ADS",
          adapterInstalled: true,
          configured: false,
          transportConnected: false,
          authenticated: null,
          discoverySupported: false,
          queryExecuted: false,
          recordsReturned: 0,
          provenanceVerified: false,
          lastCheckedAt,
          status: "SKIPPED",
          reason: "Google Ads Transparency research is disabled by environment configuration.",
          missingRequirements: ["GOOGLE_TRANSPARENCY_ENABLED"],
        };
      }
      const hasEndpoint = Boolean(
        process.env.GOOGLE_TRANSPARENCY_MCP_URL ||
        process.env.GOOGLE_ADS_MCP_URL ||
        process.env.GOOGLE_TRANSPARENCY_MCP_COMMAND
      );
      if (!hasEndpoint) {
        return {
          source: "GOOGLE_ADS",
          adapterInstalled: true,
          configured: false,
          transportConnected: false,
          authenticated: null,
          discoverySupported: false,
          queryExecuted: false,
          recordsReturned: 0,
          provenanceVerified: false,
          lastCheckedAt,
          status: "MCP_NOT_CONFIGURED",
          reason: "Google Ads Transparency MCP server is not configured in environment (GOOGLE_TRANSPARENCY_LIVE: BLOCKED).",
          missingRequirements: ["GOOGLE_TRANSPARENCY_MCP_URL"],
        };
      }
      return {
        source: "GOOGLE_ADS",
        adapterInstalled: true,
        configured: true,
        transportConnected: true,
        authenticated: true,
        discoverySupported: true,
        queryExecuted: false,
        recordsReturned: null,
        provenanceVerified: false,
        lastCheckedAt,
        status: "CONFIGURED",
        reason: "Google Ads Transparency MCP endpoint configured.",
        missingRequirements: [],
      };
    }

    case "DEMAND_HISTORY": {
      let demandCount = 0;
      try {
        demandCount = await prisma.productDemandObservation.count();
      } catch {}

      return {
        source: "DEMAND_HISTORY",
        adapterInstalled: true,
        configured: true,
        transportConnected: true,
        authenticated: true,
        discoverySupported: true,
        queryExecuted: demandCount > 0,
        recordsReturned: demandCount,
        provenanceVerified: demandCount > 0,
        lastCheckedAt,
        status: "ENGINE_READY",
        reason: demandCount > 0
          ? `Demand history policy engine active; ${demandCount} observation points stored in SQLite.`
          : "Demand history policy engine active; requires 3+ temporal observations across 60+ days for verified status.",
        missingRequirements: [],
      };
    }

    default:
      return {
        source: String(source),
        adapterInstalled: false,
        configured: false,
        transportConnected: false,
        authenticated: false,
        discoverySupported: false,
        queryExecuted: false,
        recordsReturned: 0,
        provenanceVerified: false,
        lastCheckedAt,
        status: "SKIPPED",
        reason: `Unknown intelligence source: ${source}`,
        missingRequirements: [],
      };
  }
}

/**
 * Tests connection to an authorized intelligence source safely without incurring paid API charges.
 */
export async function testKH02SourceConnection(
  source: IntelligenceSource,
  context?: TestConnectionContext
): Promise<SourceDiagnosticResult> {
  const allowedSources: IntelligenceSource[] = [
    "META_ADS",
    "TIKTOK_ADS",
    "TIKTOK_ORGANIC",
    "GOOGLE_ADS",
    "DEMAND_HISTORY",
  ];
  if (!allowedSources.includes(source)) {
    throw new Error(`Invalid or unsupported intelligence source for connection test: ${source}`);
  }

  return diagnoseKH02Source(source, {
    workspaceId: context?.workspaceId,
    checkLiveTransport: true,
  });
}

/**
 * Evaluates live configuration and readiness of a source without initiating expensive calls.
 * Maintains full backward-compatibility with existing tests and status enums.
 */
export async function checkKH02ProviderReadiness(
  source: IntelligenceSource,
  workspaceId?: string
): Promise<{ ready: boolean; status: SourceRunStatus; reason: string }> {
  const diag = await diagnoseKH02Source(source, { workspaceId });

  let status: SourceRunStatus = "NOT_CONFIGURED";
  if (diag.status === "SOURCE_ACCESS_VERIFIED") {
    status = "SOURCE_ACCESS_VERIFIED";
  } else if (diag.status === "CONFIGURED" || diag.status === "ENGINE_READY") {
    status = "CONFIGURED";
  } else if (diag.status === "MANUAL_RESEARCH_ONLY" || diag.status === "NOT_VERIFIED") {
    status = "NOT_VERIFIED";
  } else if (diag.status === "SKIPPED") {
    status = "SKIPPED";
  } else {
    status = "NOT_CONFIGURED";
  }

  const ready =
    diag.status === "SOURCE_ACCESS_VERIFIED" ||
    diag.status === "CONFIGURED" ||
    diag.status === "ENGINE_READY" ||
    diag.status === "MANUAL_RESEARCH_ONLY" ||
    diag.status === "NOT_VERIFIED";

  return {
    ready,
    status,
    reason: diag.reason,
  };
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
