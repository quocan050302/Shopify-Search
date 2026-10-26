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
  ProviderReadinessDimensions,
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
    estimatedCostPerQueryCredits: 10,
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

import {
  fetchHasDataCreditStatus,
} from "./hasDataCreditService";
import {
  discoverGoogleAdsMcpCapabilities,
} from "./googleTransparencyResearchAdapter";

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
  dimensions?: ProviderReadinessDimensions;
  requiredAction?: string;
  estimatedQueryCost?: {
    estimatedCredits: number;
    isPaid: boolean;
    knownCost: boolean;
    pricingSource?: string;
  };
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
      const metaDiag = await diagnoseMetaLiveCollector(context);
      const isConnected = metaDiag.transportConnected === true;
      const recCount = metaDiag.databaseRecordsIndexed || 0;
      const dimensions: ProviderReadinessDimensions = {
        adapterInstalled: true,
        configured: metaDiag.configured,
        transportConnected: metaDiag.transportConnected,
        authenticated: metaDiag.authenticated,
        supportedOperationsVerified: true,
        queryExecuted: recCount > 0,
        sourceDataVerified: recCount > 0,
        lastLiveQueryAt: null,
        blockerCode: metaDiag.missingRequirements[0] || null,
      };

      return {
        ...metaDiag,
        dimensions,
        requiredAction: isConnected ? undefined : "Ensure Python virtualenv is set up for MetaAdsCollector MCP.",
        estimatedQueryCost: {
          estimatedCredits: 0,
          isPaid: false,
          knownCost: true,
          pricingSource: "Local MetaAdsCollector MCP (Free zero-cost)",
        },
      };
    }

    case "TIKTOK_ADS": {
      let recordCount = 0;
      try {
        recordCount = await prisma.competitorAd.count({ where: { platform: "TIKTOK" } });
      } catch {}

      const dimensions: ProviderReadinessDimensions = {
        adapterInstalled: true,
        configured: false,
        transportConnected: false,
        authenticated: null,
        supportedOperationsVerified: false,
        queryExecuted: recordCount > 0,
        sourceDataVerified: recordCount > 0,
        lastLiveQueryAt: null,
        blockerCode: "NO_AUTHORIZED_US_AD_PROVIDER",
      };

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
        dimensions,
        requiredAction: "Utilize manual Creative Center batch import or configure authorized US ad provider.",
        estimatedQueryCost: {
          estimatedCredits: 0,
          isPaid: false,
          knownCost: true,
        },
      };
    }

    case "TIKTOK_ORGANIC": {
      const hasDataKey = process.env.HASDATA_API_KEY || process.env.TIKTOK_ORGANIC_API_KEY;
      if (!hasDataKey) {
        const dimensions: ProviderReadinessDimensions = {
          adapterInstalled: true,
          configured: false,
          transportConnected: null,
          authenticated: false,
          supportedOperationsVerified: false,
          queryExecuted: false,
          sourceDataVerified: false,
          lastLiveQueryAt: null,
          blockerCode: "MISSING_CREDENTIALS",
        };

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
          dimensions,
          requiredAction: "Configure HASDATA_API_KEY in environment to enable live video queries.",
          estimatedQueryCost: {
            estimatedCredits: 10,
            isPaid: true,
            knownCost: true,
            pricingSource: "HasData MCP Vendor Documentation (10 credits/tool call)",
          },
        };
      }

      // Key is configured: verify live transport if requested, without assuming connected
      let transportConnected: boolean | null = null;
      let authenticated: boolean | null = null;
      let status = "CONFIGURED";
      let reason = "TikTok Organic API credentials configured (Paid queries gated by AUTO_PAID_RESEARCH policy).";

      if (context?.checkLiveTransport) {
        try {
          const creditStatus = await fetchHasDataCreditStatus({ apiKey: hasDataKey, timeoutMs: 3000 });
          if (creditStatus.verificationStatus === "BLOCKED") {
            transportConnected = true;
            authenticated = false;
            status = "FAILED";
            reason = creditStatus.errorMessage || "HasData API key authentication failed.";
          } else if (creditStatus.remainingCredits !== null) {
            transportConnected = true;
            authenticated = true;
            status = "CONFIGURED";
            reason = `HasData TikTok Organic API authenticated (${creditStatus.remainingCredits} credits available).`;
          } else {
            transportConnected = true;
            authenticated = null;
            reason = "HasData credentials configured. Live verification requires a metered search call (zero unapproved charges policy).";
          }
        } catch {
          transportConnected = false;
          authenticated = false;
          status = "FAILED";
          reason = "Failed to establish connection to HasData API.";
        }
      }

      const dimensions: ProviderReadinessDimensions = {
        adapterInstalled: true,
        configured: true,
        transportConnected,
        authenticated,
        supportedOperationsVerified: authenticated === true,
        queryExecuted: false,
        sourceDataVerified: false,
        lastLiveQueryAt: null,
        blockerCode: authenticated === false ? "AUTHENTICATION_FAILED" : null,
      };

      return {
        source: "TIKTOK_ORGANIC",
        adapterInstalled: true,
        configured: true,
        transportConnected,
        authenticated,
        discoverySupported: authenticated === true,
        queryExecuted: false,
        recordsReturned: null,
        provenanceVerified: false,
        lastCheckedAt,
        status,
        reason,
        missingRequirements: authenticated === false ? ["VALID_HASDATA_API_KEY"] : [],
        dimensions,
        requiredAction: authenticated === false ? "Verify and update HASDATA_API_KEY." : undefined,
        estimatedQueryCost: {
          estimatedCredits: 10,
          isPaid: true,
          knownCost: true,
          pricingSource: "HasData MCP Vendor Contract (10 credits per query)",
        },
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
          dimensions: {
            adapterInstalled: true,
            configured: false,
            transportConnected: false,
            authenticated: null,
            supportedOperationsVerified: false,
            queryExecuted: false,
            sourceDataVerified: false,
            lastLiveQueryAt: null,
            blockerCode: "DISABLED_BY_CONFIG",
          },
        };
      }
      const hasEndpoint = Boolean(
        process.env.GOOGLE_TRANSPARENCY_MCP_URL ||
        process.env.GOOGLE_ADS_MCP_URL ||
        process.env.GOOGLE_TRANSPARENCY_MCP_COMMAND
      );
      if (!hasEndpoint) {
        const dimensions: ProviderReadinessDimensions = {
          adapterInstalled: true,
          configured: false,
          transportConnected: false,
          authenticated: null,
          supportedOperationsVerified: false,
          queryExecuted: false,
          sourceDataVerified: false,
          lastLiveQueryAt: null,
          blockerCode: "MCP_NOT_CONFIGURED",
        };

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
          dimensions,
          requiredAction: "Deploy Google Ads Transparency MCP server and configure GOOGLE_TRANSPARENCY_MCP_URL.",
          estimatedQueryCost: {
            estimatedCredits: 0,
            isPaid: false,
            knownCost: true,
          },
        };
      }

      // Endpoint configured: probe MCP connection if requested
      let transportConnected: boolean | null = null;
      let authenticated: boolean | null = null;
      let status = "CONFIGURED";
      let reason = "Google Ads Transparency MCP endpoint configured.";

      if (context?.checkLiveTransport) {
        try {
          const caps = await discoverGoogleAdsMcpCapabilities({
            mcpUrl: process.env.GOOGLE_TRANSPARENCY_MCP_URL || process.env.GOOGLE_ADS_MCP_URL,
            command: process.env.GOOGLE_TRANSPARENCY_MCP_COMMAND,
            args: process.env.GOOGLE_TRANSPARENCY_MCP_ARGS ? JSON.parse(process.env.GOOGLE_TRANSPARENCY_MCP_ARGS) : undefined,
          });
          transportConnected = caps.transportConnected;
          authenticated = caps.transportConnected;
          if (caps.transportConnected) {
            status = "TRANSPORT_CONNECTED";
            reason = `Google Ads Transparency MCP server connected (${caps.toolsDiscovered.length} tools discovered).`;
          } else {
            status = "MCP_TRANSPORT_FAILURE";
            reason = "Google Ads Transparency MCP server endpoint configured but transport probe failed.";
          }
        } catch {
          transportConnected = false;
          authenticated = false;
          status = "MCP_TRANSPORT_FAILURE";
          reason = "Google Ads Transparency MCP server endpoint configured but connection failed.";
        }
      }

      const dimensions: ProviderReadinessDimensions = {
        adapterInstalled: true,
        configured: true,
        transportConnected,
        authenticated,
        supportedOperationsVerified: transportConnected === true,
        queryExecuted: false,
        sourceDataVerified: false,
        lastLiveQueryAt: null,
        blockerCode: transportConnected === false ? "MCP_TRANSPORT_FAILURE" : null,
      };

      return {
        source: "GOOGLE_ADS",
        adapterInstalled: true,
        configured: true,
        transportConnected,
        authenticated,
        discoverySupported: transportConnected === true,
        queryExecuted: false,
        recordsReturned: null,
        provenanceVerified: false,
        lastCheckedAt,
        status,
        reason,
        missingRequirements: transportConnected === false ? ["WORKING_MCP_SERVER"] : [],
        dimensions,
        requiredAction: transportConnected === false ? "Verify that the Google Ads Transparency MCP server is running and accessible." : undefined,
        estimatedQueryCost: {
          estimatedCredits: 0,
          isPaid: false,
          knownCost: true,
        },
      };
    }

    case "DEMAND_HISTORY": {
      let demandCount = 0;
      try {
        demandCount = await prisma.productDemandObservation.count();
      } catch {}

      const dimensions: ProviderReadinessDimensions = {
        adapterInstalled: true,
        configured: true,
        transportConnected: true,
        authenticated: true,
        supportedOperationsVerified: true,
        queryExecuted: demandCount > 0,
        sourceDataVerified: demandCount > 0,
        lastLiveQueryAt: null,
        blockerCode: null,
      };

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
        dimensions,
        requiredAction: demandCount > 0 ? undefined : "Provide product-specific search terms or import historical observations.",
        estimatedQueryCost: {
          estimatedCredits: 0,
          isPaid: false,
          knownCost: true,
        },
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
export interface ProviderReadinessResult {
  ready: boolean;
  status: SourceRunStatus;
  diagnosticStatus: string;
  reason: string;
  dimensions: ProviderReadinessDimensions;
  requiredAction?: string;
  missingRequirements: string[];
}

export async function checkKH02ProviderReadiness(
  source: IntelligenceSource,
  workspaceId?: string
): Promise<ProviderReadinessResult> {
  const diag = await diagnoseKH02Source(source, { workspaceId });

  let status: SourceRunStatus = "NOT_CONFIGURED";
  if (diag.status === "SOURCE_DATA_VERIFIED") {
    status = "SOURCE_DATA_VERIFIED";
  } else if (diag.status === "SOURCE_ACCESS_VERIFIED") {
    status = "SOURCE_ACCESS_VERIFIED";
  } else if (diag.status === "CREDENTIALS_REQUIRED") {
    status = "CREDENTIALS_REQUIRED";
  } else if (diag.status === "MCP_NOT_CONFIGURED") {
    status = "MCP_NOT_CONFIGURED";
  } else if (diag.status === "MCP_TRANSPORT_FAILURE") {
    status = "MCP_TRANSPORT_FAILURE";
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
    diag.status === "SOURCE_DATA_VERIFIED" ||
    diag.status === "CONFIGURED" ||
    diag.status === "ENGINE_READY" ||
    diag.status === "MANUAL_RESEARCH_ONLY" ||
    diag.status === "NOT_VERIFIED";

  const dimensions: ProviderReadinessDimensions = diag.dimensions || {
    adapterInstalled: diag.adapterInstalled,
    configured: diag.configured,
    transportConnected: diag.transportConnected,
    authenticated: diag.authenticated,
    supportedOperationsVerified: diag.discoverySupported ?? false,
    queryExecuted: diag.queryExecuted,
    sourceDataVerified: diag.provenanceVerified,
    lastLiveQueryAt: null,
    blockerCode: diag.missingRequirements[0] || null,
  };

  return {
    ready,
    status,
    diagnosticStatus: diag.status,
    reason: diag.reason,
    dimensions,
    requiredAction: diag.requiredAction,
    missingRequirements: diag.missingRequirements,
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
