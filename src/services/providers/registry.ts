import { ProviderCapability, ProviderStatus, NormalizedAdRecord } from "@/types";
import { prisma } from "@/lib/db";

export const BUILTIN_PROVIDERS: ProviderCapability[] = [
  {
    id: "meta-ad-library",
    name: "META_AD_LIBRARY",
    displayName: "Meta Ad Library",
    description: "Official public repository of active and inactive ads running across Facebook & Instagram.",
    status: "AVAILABLE",
    capabilities: [
      "SEARCH_PUBLIC_ADS",
      "GET_ADVERTISER_PAGES",
      "VIEW_SNAPSHOT_EMBED",
      "ACTIVE_DATE_RANGES",
    ],
    supportedRegions: ["US", "CA", "GB", "AU"],
    rateLimitInfo: "200 requests/hour per IP / App Token",
  },
  {
    id: "tiktok-creative-center",
    name: "TIKTOK_CREATIVE_CENTER",
    displayName: "TikTok Creative Center",
    description: "Public repository of high-performing, trending commercial ads on TikTok.",
    status: "AVAILABLE",
    capabilities: [
      "SEARCH_TOP_ADS",
      "FILTER_BY_INDUSTRY",
      "CTR_RANKING_BRACKETS",
      "EMBED_PLAYBACK",
    ],
    supportedRegions: ["US", "CA", "GB", "DE", "FR"],
    rateLimitInfo: "Session-based rate throttling",
  },
  {
    id: "user-observed",
    name: "USER_OBSERVED",
    displayName: "User Observed & Manual Import",
    description: "Direct ingestion of competitor ad links, manual notes, and observed storefront listings.",
    status: "AVAILABLE",
    capabilities: [
      "DIRECT_URL_IMPORT",
      "CSV_BULK_INGESTION",
      "MANUAL_METRICS_ENTRY",
      "CUSTOM_TAGGING",
    ],
    supportedRegions: ["US", "GLOBAL"],
    rateLimitInfo: "Unlimited local ingestion",
  },
  {
    id: "tiktok-commercial-api",
    name: "TIKTOK_COMMERCIAL_API",
    displayName: "TikTok Commercial Content API",
    description: "Official REST API for EU Digital Services Act ad repository.",
    status: "REQUIRES_LICENSE",
    capabilities: [
      "STRUCTURED_QUERY",
      "RAW_JSON_METADATA",
      "IMPRESSION_BUCKETS",
    ],
    supportedRegions: ["EU_ONLY"],
    rateLimitInfo: "Tiered enterprise developer quota",
  },
];

/**
 * Returns available research providers and their operational capabilities.
 */
export async function listResearchProviders(): Promise<ProviderCapability[]> {
  try {
    const dbSources = await prisma.dataSource.findMany();
    if (dbSources && dbSources.length > 0) {
      return dbSources.map((ds) => ({
        id: ds.id,
        name: ds.name,
        displayName: ds.displayName,
        description: ds.description || "",
        status: ds.status as ProviderStatus,
        capabilities: JSON.parse(ds.capabilities || "[]"),
        supportedRegions: JSON.parse(ds.supportedRegions || "[]"),
        rateLimitInfo: ds.rateLimitInfo || undefined,
      }));
    }
  } catch (err) {
    console.warn("Unable to fetch providers from DB, falling back to static registry:", err);
  }

  return BUILTIN_PROVIDERS;
}

/**
 * Validates provider configuration and credentials.
 */
export async function validateProviderConfiguration(providerId: string): Promise<{
  isValid: boolean;
  status: ProviderStatus;
  message: string;
}> {
  const provider = BUILTIN_PROVIDERS.find((p) => p.id === providerId || p.name === providerId);
  if (!provider) {
    return {
      isValid: false,
      status: "ERROR",
      message: `Unknown provider identifier: ${providerId}`,
    };
  }

  if (provider.name === "USER_OBSERVED") {
    return {
      isValid: true,
      status: "AVAILABLE",
      message: "Direct user URL ingestion is ready with zero credentials required.",
    };
  }

  if (provider.name === "META_AD_LIBRARY") {
    const token = process.env.META_AD_LIBRARY_ACCESS_TOKEN;
    if (token && token.trim().length > 0) {
      return {
        isValid: true,
        status: "CONNECTED",
        message: "Meta Ad Library access token is configured.",
      };
    }
    return {
      isValid: true,
      status: "AVAILABLE",
      message: "Public Meta Ad Library is available for direct URL and public research imports.",
    };
  }

  if (provider.name === "TIKTOK_CREATIVE_CENTER") {
    return {
      isValid: true,
      status: "AVAILABLE",
      message: "TikTok Creative Center is accessible for US video ad discovery & official embed playback.",
    };
  }

  if (provider.name === "TIKTOK_COMMERCIAL_API") {
    return {
      isValid: false,
      status: "REQUIRES_LICENSE",
      message: "TikTok Commercial Content API is restricted to EU DSA compliance. US commercial ads use Creative Center.",
    };
  }

  return {
    isValid: true,
    status: provider.status,
    message: "Provider status evaluated.",
  };
}

/**
 * Returns geographic coverage and documented limitations for a provider.
 */
export function getProviderCoverage(providerId: string): {
  supportedRegions: string[];
  primaryRegion: string;
  isUSSupported: boolean;
  notes: string;
} {
  const provider = BUILTIN_PROVIDERS.find((p) => p.id === providerId || p.name === providerId);
  const regions = provider ? provider.supportedRegions : ["US"];
  const isUSSupported = regions.includes("US") || regions.includes("GLOBAL");

  return {
    supportedRegions: regions,
    primaryRegion: "US",
    isUSSupported,
    notes: isUSSupported
      ? "Provider supports United States ecommerce advertisement research."
      : "Provider is restricted and does not support US advertising queries directly.",
  };
}

/**
 * Normalizes external raw advertising records into canonical internal schema.
 */
export function normalizeExternalAdRecord(
  provider: string,
  rawRecord: any
): NormalizedAdRecord {
  const now = new Date();
  const firstSeen = rawRecord.firstSeenAt ? new Date(rawRecord.firstSeenAt) : now;
  const lastSeen = rawRecord.lastSeenAt ? new Date(rawRecord.lastSeenAt) : now;

  return {
    platform: (rawRecord.platform || "META").toUpperCase() as any,
    externalAdId: String(rawRecord.externalAdId || `ad_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`),
    advertiserName: rawRecord.advertiserName || "Independent Merchant",
    advertiserExternalId: rawRecord.advertiserExternalId,
    advertiserProfileUrl: rawRecord.advertiserProfileUrl,
    advertiserDomain: rawRecord.advertiserDomain,
    headline: rawRecord.headline || "",
    bodyText: rawRecord.bodyText || "",
    callToAction: rawRecord.callToAction || "Shop Now",
    landingPageUrl: rawRecord.landingPageUrl || "",
    originalAdUrl: rawRecord.originalAdUrl || "",
    targetMarket: rawRecord.targetMarket || "US",
    category: rawRecord.category || "Other",
    firstSeenAt: firstSeen,
    lastSeenAt: lastSeen,
    status: rawRecord.status || "ACTIVE",
    dataConfidence: rawRecord.dataConfidence || "OBSERVED",
    media: {
      mediaType: rawRecord.mediaType || "VIDEO",
      videoUrl: rawRecord.videoUrl,
      embedUrl: rawRecord.embedUrl,
      thumbnailUrl: rawRecord.thumbnailUrl,
      aspectRatio: rawRecord.aspectRatio || "9:16",
      durationSeconds: rawRecord.durationSeconds || 30,
      availability: rawRecord.mediaAvailability || "READY",
    },
    metrics: rawRecord.metrics || [],
  };
}
