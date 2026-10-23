/**
 * SWAI — Muse AI Meta Ad Library Provider (External Agent, Asynchronous)
 *
 * This provider represents Muse, an external AI agent that researches the
 * public Meta Ad Library (facebook.com/ads/library) with an authorized browser
 * and submits verified Facebook ads back into SWAI.
 *
 * WHY IT IS AN ASYNCHRONOUS EXTERNAL-AGENT PROVIDER:
 * 1. There is no official "Muse HTTP API". Muse is an external research agent.
 * 2. The Meta Graph Ad Library API (ads_archive) does NOT return US commercial ads,
 *    so token-based Meta providers cannot fulfil US Facebook competitor research.
 * 3. Therefore, discovery requests for this provider are executed ASYNCHRONOUSLY:
 *    - The app creates a request in DiscoveryRun (status PENDING, providerId "muse-ad-library").
 *    - The external Muse agent reads the request, conducts live browser research on facebook.com/ads/library,
 *      and submits source-verified records via POST /api/v1/discovery/muse/requests/:id/results.
 *    - The results endpoint validates, normalizes, dedupes, and commits the records.
 * 4. checkAvailability() strictly NEVER returns AVAILABLE: the local Node.js discovery
 *    worker must never claim or execute Muse jobs synchronously.
 *    discoverPage() throws an honest PROVIDER_UNAVAILABLE error instead of fabricating records.
 */

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
import { MUSE_PROVIDER_ID } from "../normalization/normalizeFacebookAd";

const ASYNC_MESSAGE =
  "Muse provider is asynchronous: research is conducted by the external Muse agent " +
  "via /api/v1/discovery/muse/requests and completed when Muse submits verified results. " +
  "The local background worker does not execute Muse jobs and no ads are fabricated while queued.";

export class MuseAdLibraryProvider implements AdDiscoveryProvider {
  readonly id = MUSE_PROVIDER_ID;
  readonly name = "Muse AI — Meta Ad Library Research (External Agent)";
  readonly version = "1.0.0";

  getCapabilities(): DiscoveryProviderCapabilities {
    return {
      providerId: this.id,
      displayName: this.name,
      description:
        "External-agent discovery of US Facebook ads from the public Meta Ad Library. " +
        "Muse verifies each ad in a real browser (Library ID, start date, advertiser page) " +
        "and submits source-backed records. Asynchronous: results arrive when Muse " +
        "completes the queued request, not during the HTTP call that creates it.",
      supportsUS: true,
      supportsKeywordFiltering: true,
      supportsKeywords: true,
      supportsIndustryFiltering: false,
      supportsIndustries: false,
      supportsPagination: false,
      supportsAdDetails: true,
      supportsVideoMetadata: false, // Ad Library web interface does not expose raw mp4 streams
      supportsLifecycleMetadata: true,
      requiresAuthentication: true, // Requires MUSE_INGESTION_TOKEN or ADMIN_API_KEY
      requiresAuth: true,
      isPaid: false,
      isLiveVerified: false,
      notes:
        "External agent research only. No Meta ads_archive access token is used (Meta does not return US commercial ads). " +
        "Ingestion endpoints are protected by MUSE_INGESTION_TOKEN or ADMIN_API_KEY.",
      authMethod: "BEARER_TOKEN",
      allowedDataAccess: "Public Meta Ad Library (facebook.com/ads/library), US, all ad types",
      supportedRegions: ["US"],
      termsBasis: "Public Ad Library website research by an external agent; no unofficial scraping by this server",
      sourceType: "MANUAL_IMPORT",
      apiDocumentationUrl: "https://www.facebook.com/ads/library/",
      lastLiveVerificationAt: null,
      lastVerificationError: null,
    };
  }

  getProviderConfigurationStatus(): ProviderAvailabilityResult {
    return {
      status: "READY_UNVERIFIED",
      message: ASYNC_MESSAGE,
      isAuthorized: false,
      requiresConfig: false,
    };
  }

  async checkAvailability(): Promise<ProviderAvailabilityResult> {
    // Deliberately never returns AVAILABLE: an external agent cannot be probed synchronously,
    // and returning AVAILABLE would cause the local worker to claim and attempt synchronous execution.
    return this.getProviderConfigurationStatus();
  }

  estimateCost(_query: DiscoveryQuery): ProviderCostEstimate {
    return {
      estimatedCredits: 0,
      estimatedCostUsd: 0,
      isPaid: false,
      isBudgetAvailable: true,
    };
  }

  async discoverPage(
    _query: DiscoveryQuery,
    _cursor?: string | null,
    _context?: ProviderRequestContext
  ): Promise<DiscoveryPageResult> {
    throw new DiscoveryError({
      code: "PROVIDER_UNAVAILABLE",
      message: ASYNC_MESSAGE,
      providerId: this.id,
    });
  }
}
