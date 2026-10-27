/**
 * SWAI KH-02 — Zero-Key Provider Auto-Discovery & Capability Probing Engine
 *
 * Implements automated discovery, capability probing, and classification
 * for intelligence sources under zero-unapproved-spend and truth-in-advertising constraints.
 */

import {
  IntelligenceSource,
  ProviderAccessClass,
  ProviderReadiness,
  ProviderCapabilities,
  ProviderDiscoveryResult,
  ProviderDiscoveryContext,
  ProviderProbeContext,
} from "../types";
import { prisma } from "@/lib/db";
import { diagnoseMetaLiveCollector } from "./metaResearchAdapter";
import { discoverGoogleAdsMcpCapabilities } from "./googleTransparencyResearchAdapter";
import { fetchHasDataCreditStatus } from "./hasDataCreditService";
import { buildAuthorizedAdWhere, buildAuthorizedProductWhere } from "@/services/research/authorizedScopeHelpers";

/**
 * Discovers and inspects all available KH-02 intelligence providers without incurring costs.
 */
export async function discoverAvailableKH02Providers(
  context: ProviderDiscoveryContext = {}
): Promise<ProviderDiscoveryResult[]> {
  const providerIds: IntelligenceSource[] = [
    "META_ADS",
    "TIKTOK_ADS",
    "TIKTOK_ORGANIC",
    "GOOGLE_ADS",
    "DEMAND_HISTORY",
  ];

  const results = await Promise.all(
    providerIds.map(async (providerId) => {
      const capabilities = await probeKH02ProviderCapabilities(providerId, {
        workspaceId: context.workspaceId,
        allowPaidOperations: context.allowPaidOperations,
        timeoutMs: 4000,
      });

      const readiness = await evaluateProviderReadiness(providerId, capabilities, context);

      let displayName = providerId as string;
      let recommendedAction: string | undefined;

      switch (providerId) {
        case "META_ADS":
          displayName = "Meta Ad Library (Facebook / Instagram)";
          if (!readiness.transportConnected) {
            recommendedAction = "Run scripts/meta-collector-setup.ps1 or .sh to initialize local Python collector.";
          }
          break;
        case "TIKTOK_ADS":
          displayName = "TikTok Ads US (Creative Center)";
          if (!readiness.configured) {
            recommendedAction = "Configure TIKTOK_CC_COOKIE in .env.local or import verified creative URLs manually.";
          }
          break;
        case "TIKTOK_ORGANIC":
          displayName = "TikTok Organic Video Research (HasData)";
          if (!readiness.configured) {
            recommendedAction = "Configure HASDATA_API_KEY in .env.local (free tier includes 1,000 credits/mo at hasdata.com).";
          }
          break;
        case "GOOGLE_ADS":
          displayName = "Google Ads Transparency Center";
          if (!readiness.configured) {
            recommendedAction = "Configure GOOGLE_TRANSPARENCY_MCP_URL or command in .env.local for competitor transparency.";
          }
          break;
        case "DEMAND_HISTORY":
          displayName = "Historical Demand & Trend Stability (Google Trends)";
          if (readiness.realRecordsObserved === 0) {
            recommendedAction = "Import product demand CSV or execute evergreen research to build temporal history.";
          }
          break;
      }

      return {
        providerId,
        displayName,
        accessClass: capabilities.accessClass,
        readiness,
        capabilities,
        recommendedAction,
      };
    })
  );

  return results;
}

/**
 * Probes the actual capabilities of a specific provider.
 */
export async function probeKH02ProviderCapabilities(
  providerId: string,
  context: ProviderProbeContext = {}
): Promise<ProviderCapabilities> {
  const normId = providerId.toUpperCase() as IntelligenceSource;

  switch (normId) {
    case "META_ADS": {
      const metaDiag = await diagnoseMetaLiveCollector({ workspaceId: context.workspaceId });
      const isConnected = metaDiag.transportConnected === true;
      const supportedTools = isConnected
        ? [
            "search_ads",
            "fetch_ad_details",
            "extract_landing_page",
            "diagnose_collector",
            "get_collector_health",
            "check_rate_limits",
            "export_ads",
            "import_ads",
            "reset_rate_limits",
            "search_advertisers",
          ]
        : [];

      return {
        providerId: "META_ADS",
        accessClass: "LOCAL_COLLECTOR_AVAILABLE",
        installed: true,
        configured: metaDiag.configured,
        transportConnected: isConnected,
        supportedTools,
        supportsUS: true,
        supportsKeywordSearch: true,
        supportsDateFiltering: true,
        estimatedCostPerQueryCredits: 0,
        pricingSource: "Local MetaAdsCollector MCP (No external API key required)",
        blockerReason: isConnected
          ? null
          : (metaDiag.missingRequirements[0] || "MetaAdsCollector Python MCP stdio transport not reachable."),
      };
    }

    case "TIKTOK_ADS": {
      const hasCcCookie = Boolean(process.env.TIKTOK_CC_COOKIE && process.env.TIKTOK_CC_COOKIE.trim().length > 0);
      const hasApifyToken = Boolean(
        (process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN) &&
        process.env.ENABLE_APIFY_DISCOVERY === "true"
      );
      const isConfigured = hasCcCookie || hasApifyToken;

      let accessClass: ProviderAccessClass = "MANUAL_IMPORT_ONLY";
      if (hasCcCookie) {
        accessClass = "FREE_ACCOUNT_REQUIRED";
      } else if (hasApifyToken) {
        accessClass = "PAID_CREDENTIAL_REQUIRED";
      }

      const supportedTools: string[] = [];
      if (hasCcCookie) supportedTools.push("tiktok_cc_top_ads_search");
      if (hasApifyToken) supportedTools.push("apify_tiktok_scraper");
      supportedTools.push("manual_creative_import");

      return {
        providerId: "TIKTOK_ADS",
        accessClass,
        installed: true,
        configured: isConfigured,
        transportConnected: false, // Not live-tested during basic probe to protect session
        supportedTools,
        supportsUS: true,
        supportsKeywordSearch: true,
        supportsDateFiltering: true,
        estimatedCostPerQueryCredits: 0,
        pricingSource: hasCcCookie ? "TikTok Creative Center Direct (Free session cookie)" : "Manual / Cached Import",
        blockerReason: isConfigured
          ? null
          : "Automated TikTok US ad provider is unconfigured (TIKTOK_CC_COOKIE or APIFY_TOKEN required); manual import available.",
      };
    }

    case "TIKTOK_ORGANIC": {
      const hasDataKey = process.env.HASDATA_API_KEY || process.env.TIKTOK_ORGANIC_API_KEY;
      const isConfigured = Boolean(hasDataKey && hasDataKey.trim().length > 0);

      let transportConnected = false;
      let blockerReason: string | null = null;

      if (!isConfigured) {
        blockerReason = "HASDATA_API_KEY not configured in environment (1,000 free monthly credits available).";
      } else if (context.allowPaidOperations) {
        try {
          const creditStatus = await fetchHasDataCreditStatus({
            apiKey: hasDataKey,
            timeoutMs: context.timeoutMs || 3000,
          });
          transportConnected = creditStatus.verificationStatus !== "BLOCKED";
          if (!transportConnected) {
            blockerReason = creditStatus.errorMessage || "HasData authentication failed.";
          }
        } catch {
          transportConnected = false;
          blockerReason = "HasData connection timeout or network failure.";
        }
      }

      return {
        providerId: "TIKTOK_ORGANIC",
        accessClass: "FREE_API_KEY_REQUIRED",
        installed: true,
        configured: isConfigured,
        transportConnected,
        supportedTools: isConfigured ? ["hasdata_tiktok_search"] : [],
        supportsUS: false, // Global public video search; US audience must be observed or confirmed
        supportsKeywordSearch: true,
        supportsDateFiltering: true,
        estimatedCostPerQueryCredits: 10,
        pricingSource: "HasData Scraper API Documentation (10 credits/search)",
        blockerReason,
      };
    }

    case "GOOGLE_ADS": {
      const hasEndpoint = Boolean(
        process.env.GOOGLE_TRANSPARENCY_MCP_URL ||
        process.env.GOOGLE_ADS_MCP_URL ||
        process.env.GOOGLE_TRANSPARENCY_MCP_COMMAND
      );

      let transportConnected = false;
      let supportedTools: string[] = [];
      let blockerReason: string | null = null;

      if (!hasEndpoint) {
        blockerReason = "Google Ads Transparency MCP server is not configured in environment (GOOGLE_TRANSPARENCY_MCP_URL).";
      } else {
        try {
          const caps = await discoverGoogleAdsMcpCapabilities({
            mcpUrl: process.env.GOOGLE_TRANSPARENCY_MCP_URL || process.env.GOOGLE_ADS_MCP_URL,
            command: process.env.GOOGLE_TRANSPARENCY_MCP_COMMAND,
            args: process.env.GOOGLE_TRANSPARENCY_MCP_ARGS ? JSON.parse(process.env.GOOGLE_TRANSPARENCY_MCP_ARGS) : undefined,
          });
          transportConnected = caps.transportConnected;
          supportedTools = caps.toolsDiscovered.map((t) => t.name);
          if (!transportConnected) {
            blockerReason = caps.errorMessage || "Google Ads Transparency MCP transport probe failed.";
          }
        } catch (err: any) {
          transportConnected = false;
          blockerReason = err.message || "Failed to reach Google Ads Transparency MCP server.";
        }
      }

      return {
        providerId: "GOOGLE_ADS",
        accessClass: hasEndpoint ? "ZERO_KEY_AUTHORIZED" : "UNSUPPORTED",
        installed: true,
        configured: hasEndpoint,
        transportConnected,
        supportedTools,
        supportsUS: true,
        supportsKeywordSearch: false, // Lookups require confirmed advertiser name or domain
        supportsDateFiltering: true,
        estimatedCostPerQueryCredits: 0,
        pricingSource: "Google Ads Transparency MCP (Free public transparency index)",
        blockerReason,
      };
    }

    case "DEMAND_HISTORY": {
      return {
        providerId: "DEMAND_HISTORY",
        accessClass: "ZERO_KEY_AUTHORIZED",
        installed: true,
        configured: true,
        transportConnected: true,
        supportedTools: [
          "temporal_demand_analysis",
          "stability_scoring",
          "trend_persistence_evaluation",
        ],
        supportsUS: true,
        supportsKeywordSearch: true,
        supportsDateFiltering: true,
        estimatedCostPerQueryCredits: 0,
        pricingSource: "Internal Demand History & Temporal Stability Policy Engine",
        blockerReason: null,
      };
    }

    default:
      return {
        providerId,
        accessClass: "UNSUPPORTED",
        installed: false,
        configured: false,
        transportConnected: false,
        supportedTools: [],
        supportsUS: false,
        supportsKeywordSearch: false,
        supportsDateFiltering: false,
        estimatedCostPerQueryCredits: 0,
        pricingSource: "Unknown",
        blockerReason: `Unsupported intelligence source: ${providerId}`,
      };
  }
}

/**
 * Evaluates provider readiness dimensions.
 */
async function evaluateProviderReadiness(
  providerId: IntelligenceSource,
  capabilities: ProviderCapabilities,
  context: ProviderDiscoveryContext
): Promise<ProviderReadiness> {
  let realRecordsObserved = 0;
  let dataFreshness: string | null = null;
  let lastSuccessfulQueryAt: string | null = null;

  try {
    if (context.workspaceId) {
      if (providerId === "META_ADS") {
        realRecordsObserved = await prisma.competitorAd.count({
          where: {
            platform: { in: ["META", "FACEBOOK"] },
            isSyntheticQuarantine: false,
            ...buildAuthorizedAdWhere(context.workspaceId),
          },
        });
        const latestAd = await prisma.competitorAd.findFirst({
          where: {
            platform: { in: ["META", "FACEBOOK"] },
            isSyntheticQuarantine: false,
            ...buildAuthorizedAdWhere(context.workspaceId),
          },
          orderBy: { lastSeenAt: "desc" },
          select: { lastSeenAt: true },
        });
        if (latestAd?.lastSeenAt) {
          dataFreshness = latestAd.lastSeenAt.toISOString();
          lastSuccessfulQueryAt = latestAd.lastSeenAt.toISOString();
        }
      } else if (providerId === "TIKTOK_ADS") {
        realRecordsObserved = await prisma.competitorAd.count({
          where: {
            platform: "TIKTOK",
            isSyntheticQuarantine: false,
            ...buildAuthorizedAdWhere(context.workspaceId),
          },
        });
        const latestAd = await prisma.competitorAd.findFirst({
          where: {
            platform: "TIKTOK",
            isSyntheticQuarantine: false,
            ...buildAuthorizedAdWhere(context.workspaceId),
          },
          orderBy: { lastSeenAt: "desc" },
          select: { lastSeenAt: true },
        });
        if (latestAd?.lastSeenAt) {
          dataFreshness = latestAd.lastSeenAt.toISOString();
          lastSuccessfulQueryAt = latestAd.lastSeenAt.toISOString();
        }
      } else if (providerId === "DEMAND_HISTORY") {
        realRecordsObserved = await prisma.productDemandObservation.count({
          where: {
            product: buildAuthorizedProductWhere(context.workspaceId),
          },
        });
        const latestObs = await prisma.productDemandObservation.findFirst({
          where: {
            product: buildAuthorizedProductWhere(context.workspaceId),
          },
          orderBy: { observedAt: "desc" },
          select: { observedAt: true },
        });
        if (latestObs?.observedAt) {
          dataFreshness = latestObs.observedAt.toISOString();
          lastSuccessfulQueryAt = latestObs.observedAt.toISOString();
        }
      }
    }
  } catch {
    // Database queries are best-effort for readiness telemetry
  }

  const authenticated =
    capabilities.accessClass === "LOCAL_COLLECTOR_AVAILABLE" ||
    capabilities.accessClass === "ZERO_KEY_AUTHORIZED"
      ? null
      : capabilities.configured
      ? capabilities.transportConnected
      : false;

  const costApprovalRequired =
    capabilities.estimatedCostPerQueryCredits > 0 &&
    process.env.AUTO_PAID_RESEARCH !== "true";

  const blockerCode = capabilities.blockerReason
    ? capabilities.accessClass === "FREE_API_KEY_REQUIRED" && !capabilities.configured
      ? "MISSING_CREDENTIALS"
      : capabilities.providerId === "TIKTOK_ADS" && !capabilities.configured
      ? "NO_AUTHORIZED_US_AD_PROVIDER"
      : capabilities.providerId === "GOOGLE_ADS" && !capabilities.configured
      ? "MCP_NOT_CONFIGURED"
      : "CONFIGURATION_REQUIRED"
    : null;

  return {
    providerId: capabilities.providerId,
    accessClass: capabilities.accessClass,
    installed: capabilities.installed,
    configured: capabilities.configured,
    transportConnected: capabilities.transportConnected,
    authenticated,
    requiredCapabilityAvailable: capabilities.supportedTools.length > 0 || capabilities.providerId === "DEMAND_HISTORY",
    realQueryExecuted: false,
    realQuerySucceeded: false,
    realRecordsObserved,
    lastSuccessfulQueryAt,
    dataFreshness,
    costApprovalRequired,
    blockerCode,
    blockerReason: capabilities.blockerReason,
  };
}
