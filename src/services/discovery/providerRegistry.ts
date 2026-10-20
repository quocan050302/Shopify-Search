/**
 * SWAI V9 — Discovery Provider Registry
 *
 * Manages registered discovery provider adapters.
 * Provides lookup, capability inspection, and provider selection hierarchy.
 */

import { AdDiscoveryProvider } from "./providerContract";
import { TiktokTopAdsProvider } from "./providers/tiktokTopAdsProvider";
import { ApifyTopAdsProvider } from "./providers/apifyTopAdsProvider";
import { TiktokOfficialProvider } from "./providers/tiktokOfficialProvider";
import { DiscoveryQuery, DiscoveryError } from "./types";

const registry = new Map<string, AdDiscoveryProvider>();

// Register default built-in providers
const defaultProviders: AdDiscoveryProvider[] = [
  new TiktokTopAdsProvider(),
  new ApifyTopAdsProvider(),
  new TiktokOfficialProvider(),
];

for (const p of defaultProviders) {
  registry.set(p.id, p);
}

/**
 * Registers an ad discovery provider.
 */
export function registerDiscoveryProvider(provider: AdDiscoveryProvider): void {
  registry.set(provider.id, provider);
}

/**
 * Retrieves a discovery provider by ID.
 */
export function getDiscoveryProvider(id: string): AdDiscoveryProvider | undefined {
  return registry.get(id);
}

/**
 * Lists all registered discovery providers.
 */
export function listDiscoveryProviders(): AdDiscoveryProvider[] {
  return Array.from(registry.values());
}

/**
 * Selects the optimal discovery provider based on query and environment.
 * Enforces zero-cost free-first priority.
 */
export async function selectDiscoveryProvider(query: DiscoveryQuery): Promise<AdDiscoveryProvider> {
  // 1. If explicit provider requested, check if it exists
  if (query.providerId) {
    const prov = getDiscoveryProvider(query.providerId);
    if (!prov) {
      throw new DiscoveryError({
        code: "PROVIDER_NOT_CONFIGURED",
        message: `Requested discovery provider '${query.providerId}' is not registered.`,
        providerId: query.providerId,
      });
    }
    return prov;
  }

  // 2. Primary Free Automated: TikTok Top Ads Direct
  const topAds = getDiscoveryProvider("tiktok-topads");
  if (topAds) {
    const avail = await topAds.checkAvailability();
    if (avail.isAuthorized && avail.status === "AVAILABLE") {
      return topAds;
    }
  }

  // 3. User-Authorized Paid Provider (only if explicitly enabled by user)
  if (process.env.ENABLE_APIFY_DISCOVERY === "true" || process.env.APIFY_TOKEN) {
    const apify = getDiscoveryProvider("apify-topads");
    if (apify) {
      const avail = await apify.checkAvailability();
      if (avail.isAuthorized && avail.status === "AVAILABLE") {
        return apify;
      }
    }
  }

  // 4. Default back to topAds (will report honest REQUIRES_AUTH/BLOCKED_SOURCE)
  if (topAds) {
    return topAds;
  }

  throw new DiscoveryError({
    code: "NO_AUTHORIZED_PROVIDER",
    message: "No suitable discovery provider available for the requested query.",
  });
}
