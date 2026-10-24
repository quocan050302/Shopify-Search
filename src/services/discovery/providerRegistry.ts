/**
 * SWAI V9.2 — Discovery Provider Registry & Selection Hierarchy
 *
 * Manages registered discovery provider adapters.
 * Separates automated discovery engines from manual research tools.
 * Enforces zero-cost free-first priority and strictly prevents silent fallback to paid providers.
 */

import { AdDiscoveryProvider, ProviderAvailabilityResult } from "./providerContract";
import { TiktokTopAdsProvider } from "./providers/tiktokTopAdsProvider";
import { ApifyTopAdsProvider } from "./providers/apifyTopAdsProvider";
import { TiktokOfficialProvider } from "./providers/tiktokOfficialProvider";
import { MetaAdsCollectorProvider } from "./providers/metaAdsCollectorProvider";
import { DiscoveryQuery, DiscoveryError } from "./types";

export interface ProviderRegistryEntry {
  provider: AdDiscoveryProvider;
  category: "AUTOMATED_DISCOVERY" | "MANUAL_RESEARCH" | "OFFICIAL_COMPLIANCE";
  registeredAt: Date;
  lastHealthCheckAt?: Date;
  lastHealthResult?: ProviderAvailabilityResult;
}

const registry = new Map<string, ProviderRegistryEntry>();

// Register default built-in providers
const defaultProviders: Array<{
  provider: AdDiscoveryProvider;
  category: ProviderRegistryEntry["category"];
}> = [
  { provider: new TiktokTopAdsProvider(), category: "AUTOMATED_DISCOVERY" },
  { provider: new ApifyTopAdsProvider(), category: "AUTOMATED_DISCOVERY" },
  { provider: new TiktokOfficialProvider(), category: "OFFICIAL_COMPLIANCE" },
  // Self-hosted Meta Ad Library research via local MetaAdsCollector MCP server
  { provider: new MetaAdsCollectorProvider(), category: "AUTOMATED_DISCOVERY" },
];

for (const { provider, category } of defaultProviders) {
  registry.set(provider.id, {
    provider,
    category,
    registeredAt: new Date(),
  });
}

/**
 * Registers an ad discovery provider with categorization.
 */
export function registerDiscoveryProvider(
  provider: AdDiscoveryProvider,
  category: ProviderRegistryEntry["category"] = "AUTOMATED_DISCOVERY"
): void {
  registry.set(provider.id, {
    provider,
    category,
    registeredAt: new Date(),
  });
}

/**
 * Retrieves a discovery provider by ID.
 */
export function getDiscoveryProvider(id: string): AdDiscoveryProvider | undefined {
  return registry.get(id)?.provider;
}

/**
 * Lists all registered discovery providers.
 */
export function listDiscoveryProviders(): AdDiscoveryProvider[] {
  return Array.from(registry.values()).map((e) => e.provider);
}

/**
 * Lists detailed registry entries with category and registration timestamp.
 */
export function listDiscoveryRegistryEntries(): ProviderRegistryEntry[] {
  return Array.from(registry.values());
}

/**
 * Verifies that a specific provider supports the query requirements (e.g. US market, keywords).
 */
export function verifyDiscoveryProviderCapabilities(
  providerId: string,
  query: DiscoveryQuery
): { capable: boolean; reason?: string } {
  const provider = getDiscoveryProvider(providerId);
  if (!provider) {
    return { capable: false, reason: `Provider '${providerId}' is not registered.` };
  }

  const caps = provider.getCapabilities();

  if (query.market?.toUpperCase() === "US" && !caps.supportsUS) {
    return {
      capable: false,
      reason: `Provider '${caps.displayName}' does not support United States commercial ad discovery.`,
    };
  }

  if (query.keywords && query.keywords.length > 0 && !caps.supportsKeywordFiltering) {
    return {
      capable: false,
      reason: `Provider '${caps.displayName}' does not support keyword filtering.`,
    };
  }

  return { capable: true };
}

/**
 * Selects the optimal discovery provider based on query and environment.
 * Enforces zero-cost free-first priority.
 * NEVER falls back to a paid provider automatically.
 */
export async function selectDiscoveryProvider(query: DiscoveryQuery): Promise<AdDiscoveryProvider> {
  // 1. If explicit provider requested by user, respect user choice strictly
  if (query.providerId) {
    const prov = getDiscoveryProvider(query.providerId);
    if (!prov) {
      throw new DiscoveryError({
        code: "PROVIDER_NOT_CONFIGURED",
        message: `Requested discovery provider '${query.providerId}' is not registered in the system.`,
        providerId: query.providerId,
      });
    }

    const capCheck = verifyDiscoveryProviderCapabilities(query.providerId, query);
    if (!capCheck.capable) {
      throw new DiscoveryError({
        code: "PROVIDER_REGION_UNSUPPORTED",
        message: capCheck.reason || `Provider '${query.providerId}' cannot satisfy the query requirements.`,
        providerId: query.providerId,
      });
    }

    return prov;
  }

  // 1B. Platform META: MetaAdsCollector Provider
  if (query.platform === "META") {
    const metaCollector = getDiscoveryProvider("meta-ads-collector");
    if (metaCollector) return metaCollector;
  }

  // 2. Primary Free Automated: TikTok Top Ads Direct
  const topAds = getDiscoveryProvider("tiktok-topads");
  if (topAds) {
    const avail = await topAds.checkAvailability();
    // Record health check timestamp
    const entry = registry.get("tiktok-topads");
    if (entry) {
      entry.lastHealthCheckAt = new Date();
      entry.lastHealthResult = avail;
    }

    if (avail.isAuthorized && avail.status === "AVAILABLE") {
      return topAds;
    }
  }

  // 3. User-Authorized Paid Provider (ONLY if explicitly opted-in via ENABLE_APIFY_DISCOVERY=true).
  //    Under zero-cost policy, paid providers are NEVER automatically selected as fallback.
  if (process.env.ENABLE_APIFY_DISCOVERY === "true" && process.env.FREE_DISCOVERY_MODE !== "true") {
    const apify = getDiscoveryProvider("apify-topads");
    if (apify) {
      const avail = await apify.checkAvailability();
      const entry = registry.get("apify-topads");
      if (entry) {
        entry.lastHealthCheckAt = new Date();
        entry.lastHealthResult = avail;
      }
      if (avail.isAuthorized && avail.status === "AVAILABLE") {
        return apify;
      }
    }
  }

  // 4. Default back to topAds (will report honest NOT_CONFIGURED / BLOCKED_SOURCE without fake data)
  if (topAds) {
    return topAds;
  }

  throw new DiscoveryError({
    code: "NO_AUTHORIZED_PROVIDER",
    message:
      "No authorized discovery provider available for United States TikTok research. " +
      "Configure TIKTOK_CC_COOKIE in .env.local or use Manual URL Import.",
  });
}
