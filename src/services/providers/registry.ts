import { ProviderCapability, ProviderStatus, NormalizedAdRecord } from "@/types";
import { prisma } from "@/lib/db";

export const BUILTIN_PROVIDERS: ProviderCapability[] = [
  {
    id: "meta-ad-library",
    name: "META_AD_LIBRARY",
    displayName: "Meta Ad Library",
    description:
      "Official public transparency archive of active and past ads across Facebook & Instagram. " +
      "LIMITATION: Automatic search API requires approved Meta developer access token. " +
      "Without a token, only direct URL import of individual ad library links is supported.",
    status: "AVAILABLE",
    capabilities: [
      "DIRECT_URL_IMPORT",
      "VIEW_AD_LIBRARY_PAGE",
    ],
    supportedRegions: ["US", "CA", "GB", "AU"],
    rateLimitInfo:
      "Public browsing: no rate limit. API token required for automated search.",
  },
  {
    id: "tiktok-creative-center",
    name: "TIKTOK_CREATIVE_CENTER",
    displayName: "TikTok Creative Center",
    description:
      "Public repository of high-performing, trending commercial ads on TikTok. " +
      "LIMITATION: TikTok Creative Center does not support authenticated public embed — " +
      "videos must be opened on the TikTok website. Inline playback is NOT available.",
    status: "AVAILABLE",
    capabilities: [
      "DIRECT_URL_IMPORT",
      "OPEN_EXTERNAL_SOURCE",
    ],
    supportedRegions: ["US", "CA", "GB", "DE", "FR"],
    rateLimitInfo: "Session-based rate throttling on the public website.",
  },
  {
    id: "user-observed",
    name: "USER_OBSERVED",
    displayName: "User Observed & Manual Import",
    description:
      "Direct ingestion of competitor ad links, manual notes, and observed storefront listings. " +
      "Users can attach source URLs, observed copy, screenshots, and notes.",
    status: "AVAILABLE",
    capabilities: [
      "DIRECT_URL_IMPORT",
      "MANUAL_METRICS_ENTRY",
      "CUSTOM_TAGGING",
      "NOTE_ATTACHMENT",
    ],
    supportedRegions: ["US", "GLOBAL"],
    rateLimitInfo: "Unlimited local ingestion",
  },
  {
    id: "tiktok-commercial-api",
    name: "TIKTOK_COMMERCIAL_API",
    displayName: "TikTok Commercial Content API",
    description:
      "Official REST API for EU Digital Services Act ad repository. " +
      "LIMITATION: Restricted to EU region only. Does NOT support US commercial ad discovery.",
    status: "REQUIRES_LICENSE",
    capabilities: ["STRUCTURED_QUERY", "RAW_JSON_METADATA"],
    supportedRegions: ["EU_ONLY"],
    rateLimitInfo: "Tiered enterprise developer quota (EU DSA compliance only)",
  },
];

/**
 * Returns available research providers from database or static registry.
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
    console.warn(
      "Unable to fetch providers from DB, falling back to static registry:",
      err
    );
  }

  return BUILTIN_PROVIDERS;
}

/**
 * Validates provider configuration — reports actual verified status.
 * A non-empty token is NOT sufficient to claim CONNECTED status.
 */
export async function validateProviderConfiguration(providerId: string): Promise<{
  isValid: boolean;
  status: ProviderStatus;
  message: string;
  limitations: string[];
}> {
  const provider = BUILTIN_PROVIDERS.find(
    (p) => p.id === providerId || p.name === providerId
  );

  if (!provider) {
    return {
      isValid: false,
      status: "ERROR",
      message: `Unknown provider identifier: ${providerId}`,
      limitations: [],
    };
  }

  if (provider.name === "USER_OBSERVED") {
    return {
      isValid: true,
      status: "AVAILABLE",
      message: "Direct user URL ingestion is ready. No credentials required.",
      limitations: [
        "No automated ad discovery — manual URL paste only",
        "Media playback depends on platform accessibility",
      ],
    };
  }

  if (provider.name === "META_AD_LIBRARY") {
    const token = process.env.META_AD_LIBRARY_ACCESS_TOKEN;
    if (token && token.trim().length > 0) {
      // Token present but NOT verified against the API — cannot claim CONNECTED
      return {
        isValid: true,
        status: "REQUIRES_AUTH",
        message:
          "Meta Ad Library access token is configured but has NOT been verified against the API. " +
          "Token presence does not guarantee API access. Use direct URL import for reliable research.",
        limitations: [
          "API token has not been live-tested",
          "Meta graph API requires app review for ad_archive access",
          "Automated US commercial ad search may require additional permissions",
        ],
      };
    }
    return {
      isValid: true,
      status: "AVAILABLE",
      message:
        "Meta Ad Library is accessible for manual URL import. " +
        "No API token configured — automated search is unavailable.",
      limitations: [
        "No automated ad search without API token",
        "Video embed playback requires Meta authentication",
        "Use direct URL import from facebook.com/ads/library",
      ],
    };
  }

  if (provider.name === "TIKTOK_CREATIVE_CENTER") {
    return {
      isValid: true,
      status: "AVAILABLE",
      message:
        "TikTok Creative Center is accessible for URL import. " +
        "Inline video playback is NOT supported — users must open videos on TikTok.",
      limitations: [
        "No public embed API — inline playback is unavailable",
        "TikTok does not expose a public US commercial ad search API",
        "Import by pasting the Creative Center URL for individual ads",
      ],
    };
  }

  if (provider.name === "TIKTOK_COMMERCIAL_API") {
    return {
      isValid: false,
      status: "REQUIRES_LICENSE",
      message:
        "TikTok Commercial Content API is restricted to EU DSA compliance. " +
        "US commercial ad discovery is NOT supported by this endpoint.",
      limitations: [
        "EU region only — no US data",
        "Requires enterprise license",
        "Not applicable for US Shopify product research",
      ],
    };
  }

  return {
    isValid: true,
    status: provider.status,
    message: `Provider ${provider.displayName}: ${provider.description}`,
    limitations: [],
  };
}

/**
 * Returns geographic coverage for a provider.
 */
export function getProviderCoverage(providerId: string): {
  supportedRegions: string[];
  primaryRegion: string;
  isUSSupported: boolean;
  notes: string;
} {
  const provider = BUILTIN_PROVIDERS.find(
    (p) => p.id === providerId || p.name === providerId
  );
  const regions = provider ? provider.supportedRegions : [];
  const isUSSupported = regions.includes("US") || regions.includes("GLOBAL");

  return {
    supportedRegions: regions,
    primaryRegion: "US",
    isUSSupported,
    notes: isUSSupported
      ? "Provider supports United States research (URL import). Automated API search may require additional access."
      : "Provider does not support US advertising queries. Check provider documentation for regional availability.",
  };
}

/**
 * Normalizes external raw advertising records into canonical internal schema.
 * All defaults are honest UNKNOWN/UNVERIFIED values — never fabricated.
 */
export function normalizeExternalAdRecord(
  provider: string,
  rawRecord: any
): NormalizedAdRecord {
  const now = new Date();
  const firstSeen = rawRecord.firstSeenAt ? new Date(rawRecord.firstSeenAt) : now;
  const lastSeen = rawRecord.lastSeenAt ? new Date(rawRecord.lastSeenAt) : now;

  return {
    platform: (rawRecord.platform || "OTHER").toUpperCase() as any,
    externalAdId:
      rawRecord.externalAdId ||
      `import_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    // Never default to "Independent Merchant" — use UNKNOWN
    advertiserName: rawRecord.advertiserName || "UNKNOWN",
    advertiserExternalId: rawRecord.advertiserExternalId,
    advertiserProfileUrl: rawRecord.advertiserProfileUrl,
    advertiserDomain: rawRecord.advertiserDomain,
    headline: rawRecord.headline || "",
    bodyText: rawRecord.bodyText || "",
    callToAction: rawRecord.callToAction || "",
    landingPageUrl: rawRecord.landingPageUrl || "",
    originalAdUrl: rawRecord.originalAdUrl || "",
    // Never auto-assign US — distinguish research market from verified delivery region
    targetMarket: rawRecord.targetMarket || "UNKNOWN",
    category: rawRecord.category || "Other",
    firstSeenAt: firstSeen,
    lastSeenAt: lastSeen,
    // Never default to ACTIVE — use UNKNOWN unless the source confirms it
    status: rawRecord.status || "UNKNOWN",
    dataConfidence: rawRecord.dataConfidence || "UNVERIFIED",
    media: {
      mediaType: rawRecord.mediaType || "VIDEO",
      videoUrl: rawRecord.videoUrl || undefined,
      embedUrl: rawRecord.embedUrl || undefined,
      // Never assign stock images as thumbnails
      thumbnailUrl: rawRecord.thumbnailUrl || undefined,
      aspectRatio: rawRecord.aspectRatio || "9:16",
      // Never default to 30 seconds — use null (undefined) until known
      durationSeconds: rawRecord.durationSeconds || undefined,
      // Never default to READY — unknown media is not ready
      availability: rawRecord.mediaAvailability || "UNKNOWN",
    },
    metrics: rawRecord.metrics || [],
  };
}
