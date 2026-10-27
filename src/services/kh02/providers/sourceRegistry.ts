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
import { buildAuthorizedAdWhere, buildAuthorizedProductWhere } from "@/services/research/authorizedScopeHelpers";

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
    estimatedCredits?: number | null;
    isPaid?: boolean;
    knownCost?: boolean;
    pricingSource?: string | null;
  };
  storedRecordCount?: number | null;
  lastLiveQueryRecordCount?: number | null;
  currentRunRecordCount?: number | null;
  lastSuccessfulLiveQueryAt?: string | null;
  lastProbeAt?: string | null;
  authStatus?: "AUTHENTICATED" | "AUTHENTICATION_FAILED" | "AUTH_NOT_REQUIRED" | "CREDENTIALS_REQUIRED" | "NOT_PROBED";
  transportStatus?: "CONNECTED" | "TRANSPORT_FAILED" | "NOT_CONFIGURED" | "NOT_TESTED";
  capabilityStatus?: "VERIFIED" | "UNSUPPORTED" | "NOT_TESTED";
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
      let recCount = 0;
      try {
        if (context?.workspaceId) {
          recCount = await prisma.competitorAd.count({
            where: {
              platform: { in: ["META", "FACEBOOK"] },
              isSyntheticQuarantine: false,
              ...buildAuthorizedAdWhere(context.workspaceId),
            },
          });
        } else {
          recCount = metaDiag.databaseRecordsIndexed || 0;
        }
      } catch {
        recCount = metaDiag.databaseRecordsIndexed || 0;
      }

      // Meta local stdio requires no external API key. Truthful auth model: AUTH_NOT_REQUIRED
      const authStatus = "AUTH_NOT_REQUIRED";
      const transportStatus = isConnected ? "CONNECTED" : "NOT_TESTED";

      const dimensions: ProviderReadinessDimensions = {
        adapterInstalled: true,
        configured: metaDiag.configured,
        transportConnected: metaDiag.transportConnected,
        authenticated: null, // No API key required in local stdio mode
        supportedOperationsVerified: isConnected,
        queryExecuted: false, // Do not infer from DB count!
        sourceDataVerified: recCount > 0,
        lastLiveQueryAt: null,
        blockerCode: isConnected ? null : (metaDiag.missingRequirements[0] || null),
        storedRecordCount: recCount,
        lastLiveQueryRecordCount: null,
        currentRunRecordCount: null,
        lastSuccessfulLiveQueryAt: null,
        lastProbeAt: lastCheckedAt,
        authStatus,
        transportStatus,
        capabilityStatus: isConnected ? "VERIFIED" : "NOT_TESTED",
      };

      return {
        ...metaDiag,
        authenticated: null,
        queryExecuted: false,
        recordsReturned: recCount,
        storedRecordCount: recCount,
        lastLiveQueryRecordCount: null,
        currentRunRecordCount: null,
        lastProbeAt: lastCheckedAt,
        authStatus,
        transportStatus,
        capabilityStatus: dimensions.capabilityStatus,
        dimensions,
        requiredAction: isConnected ? undefined : "Ensure Python virtualenv is set up for MetaAdsCollector MCP.",
        estimatedQueryCost: {
          estimatedCredits: 0,
          isPaid: false,
          knownCost: true,
          pricingSource: "Local MetaAdsCollector MCP (No external API key required)",
        },
      };
    }

    case "TIKTOK_ADS": {
      let recordCount = 0;
      try {
        if (context?.workspaceId) {
          recordCount = await prisma.competitorAd.count({
            where: {
              platform: "TIKTOK",
              isSyntheticQuarantine: false,
              ...buildAuthorizedAdWhere(context.workspaceId),
            },
          });
        }
      } catch {}

      const hasCcCookie = Boolean(process.env.TIKTOK_CC_COOKIE && process.env.TIKTOK_CC_COOKIE.trim().length > 0);
      const hasApifyToken = Boolean((process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN) && (process.env.ENABLE_APIFY_DISCOVERY === "true"));
      const isConfigured = hasCcCookie || hasApifyToken;

      const transportConnected: boolean | null = isConfigured ? null : false;
      const transportStatus: "CONNECTED" | "TRANSPORT_FAILED" | "NOT_CONFIGURED" | "NOT_TESTED" = isConfigured ? "NOT_TESTED" : "NOT_CONFIGURED";
      const authStatus: "AUTHENTICATED" | "AUTHENTICATION_FAILED" | "AUTH_NOT_REQUIRED" | "CREDENTIALS_REQUIRED" | "NOT_PROBED" = isConfigured ? "NOT_PROBED" : "CREDENTIALS_REQUIRED";

      const status = isConfigured ? "CONFIGURED" : (recordCount > 0 ? "MANUAL_ONLY" : "MANUAL_RESEARCH_ONLY");
      const reason = isConfigured
        ? (hasCcCookie ? "TikTok Creative Center session cookie configured." : "Apify Top Ads provider configured.")
        : "Automated TikTok US ad provider is unconfigured (TIKTOK_CC_COOKIE or APIFY_TOKEN required); database cache / manual Creative Center batch import available.";

      const dimensions: ProviderReadinessDimensions = {
        adapterInstalled: true,
        configured: isConfigured,
        transportConnected,
        authenticated: isConfigured ? null : false,
        supportedOperationsVerified: isConfigured,
        queryExecuted: false, // Do not infer from DB count!
        sourceDataVerified: recordCount > 0,
        lastLiveQueryAt: null,
        blockerCode: isConfigured ? null : "NO_AUTHORIZED_US_AD_PROVIDER",
        storedRecordCount: recordCount,
        lastLiveQueryRecordCount: null,
        currentRunRecordCount: null,
        lastSuccessfulLiveQueryAt: null,
        lastProbeAt: lastCheckedAt,
        authStatus,
        transportStatus,
        capabilityStatus: isConfigured ? "VERIFIED" : "UNSUPPORTED",
      };

      return {
        source: "TIKTOK_ADS",
        adapterInstalled: true,
        configured: isConfigured,
        transportConnected,
        authenticated: isConfigured ? null : false,
        discoverySupported: isConfigured,
        queryExecuted: false,
        recordsReturned: recordCount,
        storedRecordCount: recordCount,
        lastLiveQueryRecordCount: null,
        currentRunRecordCount: null,
        lastProbeAt: lastCheckedAt,
        authStatus,
        transportStatus,
        capabilityStatus: dimensions.capabilityStatus,
        provenanceVerified: recordCount > 0,
        lastCheckedAt,
        status,
        reason,
        missingRequirements: isConfigured ? [] : ["TIKTOK_CC_COOKIE_OR_APIFY_TOKEN", "TIKTOK_CREATIVE_CENTER_API_OR_MANUAL_IMPORT"],
        dimensions,
        requiredAction: isConfigured ? undefined : "Configure TIKTOK_CC_COOKIE in .env.local or import verified TikTok ad creatives manually.",
        estimatedQueryCost: {
          estimatedCredits: 0,
          isPaid: false,
          knownCost: true,
          pricingSource: hasCcCookie ? "TikTok Creative Center Direct (Free session)" : "Manual / Cached",
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
          storedRecordCount: 0,
          lastLiveQueryRecordCount: null,
          currentRunRecordCount: null,
          lastSuccessfulLiveQueryAt: null,
          lastProbeAt: lastCheckedAt,
          authStatus: "CREDENTIALS_REQUIRED",
          transportStatus: "NOT_TESTED",
          capabilityStatus: "NOT_TESTED",
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
          storedRecordCount: 0,
          lastLiveQueryRecordCount: null,
          currentRunRecordCount: null,
          lastProbeAt: lastCheckedAt,
          authStatus: "CREDENTIALS_REQUIRED",
          transportStatus: "NOT_TESTED",
          capabilityStatus: "NOT_TESTED",
          provenanceVerified: false,
          lastCheckedAt,
          status: "CREDENTIALS_REQUIRED",
          reason: "TikTok Organic API key (HASDATA_API_KEY) not configured in environment. Configuration: Missing, Authentication: Credentials required, Transport: Not tested.",
          missingRequirements: ["HASDATA_API_KEY"],
          dimensions,
          requiredAction: "Configure HASDATA_API_KEY in environment to enable live video queries.",
          estimatedQueryCost: {
            estimatedCredits: 10,
            isPaid: true,
            knownCost: true,
            pricingSource: "HasData Scraper API Documentation (10 credits/search)",
          },
        };
      }

      // Key is configured: verify live transport if requested, without assuming connected
      let transportConnected: boolean | null = null;
      let authenticated: boolean | null = null;
      let authStatus: "AUTHENTICATED" | "AUTHENTICATION_FAILED" | "AUTH_NOT_REQUIRED" | "CREDENTIALS_REQUIRED" | "NOT_PROBED" = "NOT_PROBED";
      let transportStatus: "CONNECTED" | "TRANSPORT_FAILED" | "NOT_CONFIGURED" | "NOT_TESTED" = "NOT_TESTED";
      let status = "CONFIGURED";
      let reason = "TikTok Organic API credentials configured (Paid queries gated by AUTO_PAID_RESEARCH policy).";

      if (context?.checkLiveTransport) {
        try {
          const creditStatus = await fetchHasDataCreditStatus({ apiKey: hasDataKey, timeoutMs: 3000 });
          if (creditStatus.verificationStatus === "BLOCKED") {
            transportConnected = true;
            transportStatus = "CONNECTED";
            authenticated = false;
            authStatus = "AUTHENTICATION_FAILED";
            status = "AUTHENTICATION_FAILED";
            reason = creditStatus.errorMessage || "HasData API key authentication failed.";
          } else if (creditStatus.remainingCredits !== null) {
            transportConnected = true;
            transportStatus = "CONNECTED";
            authenticated = true;
            authStatus = "AUTHENTICATED";
            status = "CONFIGURED";
            reason = `HasData TikTok Organic API authenticated (${creditStatus.remainingCredits} credits available).`;
          } else {
            transportConnected = true;
            transportStatus = "CONNECTED";
            authenticated = null;
            authStatus = "NOT_PROBED";
            reason = "HasData credentials configured. Live verification requires a metered search call (zero unapproved charges policy).";
          }
        } catch {
          transportConnected = false;
          transportStatus = "TRANSPORT_FAILED";
          authenticated = false;
          authStatus = "AUTHENTICATION_FAILED";
          status = "TRANSPORT_FAILED";
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
        blockerCode: authStatus === "AUTHENTICATION_FAILED" ? "AUTHENTICATION_FAILED" : null,
        storedRecordCount: 0,
        lastLiveQueryRecordCount: null,
        currentRunRecordCount: null,
        lastSuccessfulLiveQueryAt: null,
        lastProbeAt: lastCheckedAt,
        authStatus,
        transportStatus,
        capabilityStatus: authenticated === true ? "VERIFIED" : "NOT_TESTED",
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
        storedRecordCount: 0,
        lastLiveQueryRecordCount: null,
        currentRunRecordCount: null,
        lastProbeAt: lastCheckedAt,
        authStatus,
        transportStatus,
        capabilityStatus: dimensions.capabilityStatus,
        provenanceVerified: false,
        lastCheckedAt,
        status,
        reason,
        missingRequirements: authStatus === "AUTHENTICATION_FAILED" ? ["VALID_HASDATA_API_KEY"] : [],
        dimensions,
        requiredAction: authStatus === "AUTHENTICATION_FAILED" ? "Verify and update HASDATA_API_KEY." : undefined,
        estimatedQueryCost: {
          estimatedCredits: 10,
          isPaid: true,
          knownCost: true,
          pricingSource: "HasData Scraper API Documentation (10 credits/search)",
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
          storedRecordCount: 0,
          lastLiveQueryRecordCount: null,
          currentRunRecordCount: null,
          lastProbeAt: lastCheckedAt,
          authStatus: "NOT_PROBED",
          transportStatus: "NOT_CONFIGURED",
          capabilityStatus: "UNSUPPORTED",
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
            storedRecordCount: 0,
            lastLiveQueryRecordCount: null,
            currentRunRecordCount: null,
            lastSuccessfulLiveQueryAt: null,
            lastProbeAt: lastCheckedAt,
            authStatus: "NOT_PROBED",
            transportStatus: "NOT_CONFIGURED",
            capabilityStatus: "UNSUPPORTED",
          },
        };
      }

      // Check if MCP URL or stdio command is configured
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
          storedRecordCount: 0,
          lastLiveQueryRecordCount: null,
          currentRunRecordCount: null,
          lastSuccessfulLiveQueryAt: null,
          lastProbeAt: lastCheckedAt,
          authStatus: "NOT_PROBED",
          transportStatus: "NOT_CONFIGURED",
          capabilityStatus: "NOT_TESTED",
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
          storedRecordCount: 0,
          lastLiveQueryRecordCount: null,
          currentRunRecordCount: null,
          lastProbeAt: lastCheckedAt,
          authStatus: "NOT_PROBED",
          transportStatus: "NOT_CONFIGURED",
          capabilityStatus: "NOT_TESTED",
          provenanceVerified: false,
          lastCheckedAt,
          status: "MCP_NOT_CONFIGURED",
          reason: "Google Ads Transparency MCP server is not configured in environment. Configuration: Missing, Transport: Not configured.",
          missingRequirements: ["GOOGLE_TRANSPARENCY_MCP_URL"],
          dimensions,
          requiredAction: "Configure GOOGLE_TRANSPARENCY_MCP_URL or GOOGLE_TRANSPARENCY_MCP_COMMAND in .env.local.",
          estimatedQueryCost: {
            estimatedCredits: 0,
            isPaid: false,
            knownCost: true,
            pricingSource: "Google Ads Transparency MCP (Free public transparency index)",
          },
        };
      }

      // Endpoint configured: probe MCP connection if requested
      let transportConnected: boolean | null = null;
      let authenticated: boolean | null = null;
      let authStatus: "AUTHENTICATED" | "AUTHENTICATION_FAILED" | "AUTH_NOT_REQUIRED" | "CREDENTIALS_REQUIRED" | "NOT_PROBED" = "AUTH_NOT_REQUIRED";
      let transportStatus: "CONNECTED" | "TRANSPORT_FAILED" | "NOT_CONFIGURED" | "NOT_TESTED" = "NOT_TESTED";
      let supportedOperationsVerified = false;
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
          transportStatus = caps.transportConnected ? "CONNECTED" : "TRANSPORT_FAILED";
          supportedOperationsVerified = Boolean(caps.supportedOperations.advertiserSearch || caps.supportedOperations.domainLookup);
          authStatus = "AUTH_NOT_REQUIRED"; // Transparency Center requires no API keys
          authenticated = true;

          if (caps.transportConnected && supportedOperationsVerified) {
            status = "CONNECTED";
            reason = `Google Ads Transparency MCP server connected (${caps.toolsDiscovered.length} tools discovered). Operations verified.`;
          } else if (caps.transportConnected && !supportedOperationsVerified) {
            status = "UNSUPPORTED_CAPABILITY";
            reason = `Google Ads Transparency MCP server connected, but advertiser/ads discovery tools were not found among discovered tools (${caps.toolsDiscovered.map((t) => t.name).join(", ")}).`;
          } else {
            status = "TRANSPORT_FAILED";
            reason = caps.errorMessage || "Google Ads Transparency MCP server endpoint configured but transport probe failed.";
          }
        } catch (mcpErr: any) {
          transportConnected = false;
          transportStatus = "TRANSPORT_FAILED";
          authenticated = false;
          authStatus = "NOT_PROBED";
          status = "TRANSPORT_FAILED";
          reason = `Google Ads Transparency MCP server connection failed: ${mcpErr.message || String(mcpErr)}`;
        }
      }

      const dimensions: ProviderReadinessDimensions = {
        adapterInstalled: true,
        configured: true,
        transportConnected,
        authenticated,
        supportedOperationsVerified,
        queryExecuted: false,
        sourceDataVerified: false,
        lastLiveQueryAt: null,
        blockerCode: transportConnected === false ? "TRANSPORT_FAILED" : (!supportedOperationsVerified && transportConnected ? "UNSUPPORTED_CAPABILITY" : null),
        storedRecordCount: 0,
        lastLiveQueryRecordCount: null,
        currentRunRecordCount: null,
        lastSuccessfulLiveQueryAt: null,
        lastProbeAt: lastCheckedAt,
        authStatus,
        transportStatus,
        capabilityStatus: supportedOperationsVerified ? "VERIFIED" : (transportConnected ? "UNSUPPORTED" : "NOT_TESTED"),
      };

      return {
        source: "GOOGLE_ADS",
        adapterInstalled: true,
        configured: true,
        transportConnected,
        authenticated,
        discoverySupported: supportedOperationsVerified,
        queryExecuted: false,
        recordsReturned: null,
        storedRecordCount: 0,
        lastLiveQueryRecordCount: null,
        currentRunRecordCount: null,
        lastProbeAt: lastCheckedAt,
        authStatus,
        transportStatus,
        capabilityStatus: dimensions.capabilityStatus,
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
          pricingSource: "Google Ads Transparency MCP (Free public transparency index)",
        },
      };
    }

    case "DEMAND_HISTORY": {
      let demandCount = 0;
      try {
        if (context?.workspaceId) {
          demandCount = await prisma.productDemandObservation.count({
            where: {
              product: buildAuthorizedProductWhere(context.workspaceId),
            },
          });
        }
      } catch {}

      const hasUpstreamApiKey = Boolean(process.env.SERPAPI_API_KEY || process.env.GOOGLE_TRENDS_API_KEY);
      const upstreamStatus: "CONNECTED" | "TRANSPORT_FAILED" | "NOT_CONFIGURED" | "NOT_TESTED" = hasUpstreamApiKey ? "NOT_TESTED" : "NOT_CONFIGURED";
      const authStatus: "AUTHENTICATED" | "AUTHENTICATION_FAILED" | "AUTH_NOT_REQUIRED" | "CREDENTIALS_REQUIRED" | "NOT_PROBED" = hasUpstreamApiKey ? "NOT_PROBED" : "CREDENTIALS_REQUIRED";

      const dimensions: ProviderReadinessDimensions = {
        adapterInstalled: true,
        configured: true, // Local demand evaluation engine is installed and ready
        transportConnected: hasUpstreamApiKey ? null : false,
        authenticated: hasUpstreamApiKey ? null : false,
        supportedOperationsVerified: true, // Evaluation engine algorithms are verified
        queryExecuted: false, // Do not infer from DB count!
        sourceDataVerified: demandCount > 0,
        lastLiveQueryAt: null,
        blockerCode: hasUpstreamApiKey ? null : "UPSTREAM_PROVIDER_NOT_CONFIGURED",
        storedRecordCount: demandCount,
        lastLiveQueryRecordCount: null,
        currentRunRecordCount: null,
        lastSuccessfulLiveQueryAt: null,
        lastProbeAt: lastCheckedAt,
        authStatus,
        transportStatus: upstreamStatus,
        capabilityStatus: "VERIFIED",
      };

      return {
        source: "DEMAND_HISTORY",
        adapterInstalled: true,
        configured: true,
        transportConnected: hasUpstreamApiKey ? null : false,
        authenticated: hasUpstreamApiKey ? null : false,
        discoverySupported: true,
        queryExecuted: false,
        recordsReturned: demandCount,
        storedRecordCount: demandCount,
        lastLiveQueryRecordCount: null,
        currentRunRecordCount: null,
        lastProbeAt: lastCheckedAt,
        authStatus,
        transportStatus: upstreamStatus,
        capabilityStatus: "VERIFIED",
        provenanceVerified: demandCount > 0,
        lastCheckedAt,
        status: "ENGINE_READY",
        reason: `Demand stability policy engine is active (ENGINE_READY). Upstream live provider: ${hasUpstreamApiKey ? "Configured (Not tested)" : "Not configured"}. Workspace stored observations: ${demandCount}. Individual product policy requires 3+ temporal observations across 60+ days.`,
        missingRequirements: hasUpstreamApiKey ? [] : ["LIVE_TRENDS_PROVIDER_API_KEY"],
        dimensions,
        requiredAction: demandCount === 0 && !hasUpstreamApiKey ? "Configure SERPAPI_API_KEY / GOOGLE_TRENDS_API_KEY or import product demand observations via CSV." : undefined,
        estimatedQueryCost: {
          estimatedCredits: 0,
          isPaid: false,
          knownCost: true,
          pricingSource: "Internal Demand History & Policy Engine",
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
        storedRecordCount: 0,
        lastLiveQueryRecordCount: null,
        currentRunRecordCount: null,
        lastProbeAt: lastCheckedAt,
        authStatus: "NOT_PROBED",
        transportStatus: "NOT_CONFIGURED",
        capabilityStatus: "NOT_TESTED",
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

  const timeoutMs = context?.timeoutMs || 8000;
  let timeoutTimer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(() => {
      reject(new Error(`Connection test for ${source} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const diagPromise = diagnoseKH02Source(source, {
      workspaceId: context?.workspaceId,
      checkLiveTransport: true,
    });
    return await Promise.race([diagPromise, timeoutPromise]);
  } catch (err: any) {
    return {
      source,
      adapterInstalled: true,
      configured: false,
      transportConnected: false,
      authenticated: false,
      discoverySupported: false,
      queryExecuted: false,
      recordsReturned: 0,
      storedRecordCount: 0,
      lastLiveQueryRecordCount: null,
      currentRunRecordCount: null,
      lastProbeAt: new Date().toISOString(),
      authStatus: "AUTHENTICATION_FAILED",
      transportStatus: "TRANSPORT_FAILED",
      capabilityStatus: "UNSUPPORTED",
      provenanceVerified: false,
      lastCheckedAt: new Date().toISOString(),
      status: "FAILED",
      reason: err?.message || `Connection probe failed for ${source}`,
      missingRequirements: ["CONNECTION_FAILED"],
      dimensions: {
        adapterInstalled: true,
        configured: false,
        transportConnected: false,
        authenticated: false,
        supportedOperationsVerified: false,
        queryExecuted: false,
        sourceDataVerified: false,
        lastLiveQueryAt: null,
        blockerCode: "TRANSPORT_FAILED",
        storedRecordCount: 0,
        lastLiveQueryRecordCount: null,
        currentRunRecordCount: null,
        lastSuccessfulLiveQueryAt: null,
        lastProbeAt: new Date().toISOString(),
        authStatus: "AUTHENTICATION_FAILED",
        transportStatus: "TRANSPORT_FAILED",
        capabilityStatus: "UNSUPPORTED",
      },
    };
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
  }
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
  } else if (diag.status === "MCP_TRANSPORT_FAILURE" || diag.status === "TRANSPORT_FAILED") {
    status = "MCP_TRANSPORT_FAILURE";
  } else if (diag.status === "CONNECTED" || diag.status === "TRANSPORT_CONNECTED") {
    status = "TRANSPORT_CONNECTED";
  } else if (diag.status === "UNSUPPORTED_CAPABILITY") {
    status = "UNSUPPORTED_CAPABILITY";
  } else if (diag.status === "AUTHENTICATION_FAILED") {
    status = "FAILED";
  } else if (diag.status === "CONFIGURED" || diag.status === "ENGINE_READY") {
    status = "CONFIGURED";
  } else if (diag.status === "MANUAL_RESEARCH_ONLY" || diag.status === "MANUAL_ONLY" || diag.status === "NOT_VERIFIED") {
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
    diag.status === "CONNECTED" ||
    diag.status === "TRANSPORT_CONNECTED" ||
    diag.status === "ENGINE_READY" ||
    diag.status === "MANUAL_RESEARCH_ONLY" ||
    diag.status === "MANUAL_ONLY" ||
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
    storedRecordCount: diag.storedRecordCount,
    lastLiveQueryRecordCount: diag.lastLiveQueryRecordCount,
    currentRunRecordCount: diag.currentRunRecordCount,
    lastSuccessfulLiveQueryAt: diag.lastSuccessfulLiveQueryAt,
    lastProbeAt: diag.lastProbeAt,
    authStatus: diag.authStatus,
    transportStatus: diag.transportStatus,
    capabilityStatus: diag.capabilityStatus,
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

export {
  discoverAvailableKH02Providers,
  probeKH02ProviderCapabilities,
} from "./providerDiscoveryService";
