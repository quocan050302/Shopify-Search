/**
 * SWAI V11.6.0 — Live Meta Source Inspection Helper (Section 09)
 *
 * Authoritatively validates source observation evidence returned by the
 * MetaAdsCollector MCP client without assuming HTTP 200 contains real ads
 * or classifying unknown provenance as verified.
 */

import { MetaCollectorRawAd, MetaCollectorSearchResponse } from "./metaCollectorTypes";

export interface LiveSourceInspection {
  transport: string;
  requestedKeyword: string;
  requestedMarket: string;
  requestedLimit: number;
  resultSetId: string | null;
  upstreamRequestObserved: boolean;
  upstreamResponseObserved: boolean;
  isFixture: boolean;
  adsReturned: number;
  validSourceIds: number;
  missingLibraryIds: number;
  duplicateLibraryIds: string[];
  recordsWithAdvertisers: number;
  recordsWithSourceUrls: number;
  sourceClassification: "REAL_UPSTREAM" | "TEST_FIXTURE" | "UNKNOWN";
  status: "PASSED" | "FAILED" | "BLOCKED" | "NO_RESULTS";
  errors: string[];
}

export interface InspectLiveMetaSourceInput {
  transport?: string;
  requestedKeyword: string;
  requestedMarket?: string;
  requestedLimit?: number;
  resultSetId?: string | null;
  mcpResponse?: MetaCollectorSearchResponse | null;
  rawAds?: MetaCollectorRawAd[];
  error?: Error | unknown;
}

export function inspectLiveMetaSourceResult(input: InspectLiveMetaSourceInput): LiveSourceInspection {
  const errors: string[] = [];
  const rawAds = input.rawAds || input.mcpResponse?.ads || [];
  const resultSetId = input.resultSetId || input.mcpResponse?.result_set_id || null;

  const transport = input.transport || "unknown";
  const isFixture =
    transport === "mock_test_boundary" ||
    Boolean(process.env.SWAI_MOCK_META_BOUNDARY && process.env.SWAI_MOCK_META_BOUNDARY !== "false");

  // Authoritative MCP stats observation
  const stats = input.mcpResponse?.job?.stats as { requests_made?: number; ads_collected?: number } | undefined;
  const requestsMade = typeof stats?.requests_made === "number" ? stats.requests_made : (resultSetId && !isFixture ? 1 : 0);
  const adsCollectedStat = typeof stats?.ads_collected === "number" ? stats.ads_collected : rawAds.length;

  const upstreamRequestObserved = !isFixture && requestsMade > 0;
  const upstreamResponseObserved = !isFixture && upstreamRequestObserved && (adsCollectedStat > 0 || rawAds.length > 0);

  // Analyze raw ad identities
  const seenIds = new Set<string>();
  const duplicateLibraryIds: string[] = [];
  let validSourceIds = 0;
  let missingLibraryIds = 0;
  let recordsWithAdvertisers = 0;
  let recordsWithSourceUrls = 0;

  for (const ad of rawAds) {
    const rawAny = ad as unknown as Record<string, unknown>;
    const rawId = (ad?.id || rawAny?.library_id || "") as string;
    const cleanId = String(rawId).trim();

    // Check Meta Library ID format (Meta uses 5-25 digit numeric IDs)
    if (!cleanId || cleanId === "unknown") {
      missingLibraryIds++;
    } else if (/^\d{5,25}$/.test(cleanId)) {
      if (seenIds.has(cleanId)) {
        duplicateLibraryIds.push(cleanId);
      } else {
        seenIds.add(cleanId);
        validSourceIds++;
      }
    } else if (isFixture) {
      // Mock fixtures may use non-numeric IDs like mock_ad_1
      if (seenIds.has(cleanId)) {
        duplicateLibraryIds.push(cleanId);
      } else {
        seenIds.add(cleanId);
        validSourceIds++;
      }
    } else {
      missingLibraryIds++;
      errors.push(`Non-numeric Meta Library ID observed in real mode: "${cleanId}"`);
    }

    // Check advertiser provenance
    const advertiserName =
      ad?.page?.name ||
      rawAny?.advertiser_name ||
      rawAny?.page_name;
    if (typeof advertiserName === "string" && advertiserName.trim().length > 0) {
      recordsWithAdvertisers++;
    }

    // Check source URL provenance
    const sourceUrl =
      ad?.source_url ||
      ad?.snapshot_url ||
      rawAny?.ad_snapshot_url ||
      ad?.creatives?.[0]?.link_url;
    if (typeof sourceUrl === "string" && sourceUrl.trim().length > 0) {
      recordsWithSourceUrls++;
    }
  }

  // Classify source provenance
  let sourceClassification: "REAL_UPSTREAM" | "TEST_FIXTURE" | "UNKNOWN" = "UNKNOWN";
  if (isFixture) {
    sourceClassification = "TEST_FIXTURE";
  } else if (
    (transport === "stdio" || transport === "mcp_stdio") &&
    upstreamRequestObserved &&
    upstreamResponseObserved &&
    validSourceIds > 0
  ) {
    sourceClassification = "REAL_UPSTREAM";
  } else {
    sourceClassification = "UNKNOWN";
  }

  // Handle incoming errors
  if (input.error) {
    const errMsg = input.error instanceof Error ? input.error.message : String(input.error);
    errors.push(errMsg);
    const lower = errMsg.toLowerCase();
    const isBlocked = lower.includes("blocked") || lower.includes("challenge") || lower.includes("captcha") || lower.includes("403");
    const isRateLimited = lower.includes("rate limit") || lower.includes("too many") || lower.includes("429");

    return {
      transport,
      requestedKeyword: input.requestedKeyword,
      requestedMarket: input.requestedMarket || "US",
      requestedLimit: input.requestedLimit || 25,
      resultSetId,
      upstreamRequestObserved,
      upstreamResponseObserved,
      isFixture,
      adsReturned: rawAds.length,
      validSourceIds,
      missingLibraryIds,
      duplicateLibraryIds,
      recordsWithAdvertisers,
      recordsWithSourceUrls,
      sourceClassification,
      status: isBlocked || isRateLimited ? "BLOCKED" : "FAILED",
      errors,
    };
  }

  // Determine overall status
  let status: "PASSED" | "FAILED" | "BLOCKED" | "NO_RESULTS" = "FAILED";
  if (rawAds.length === 0) {
    status = "NO_RESULTS";
  } else if (isFixture) {
    status = validSourceIds > 0 ? "PASSED" : "FAILED";
  } else if (sourceClassification === "REAL_UPSTREAM" && validSourceIds > 0 && missingLibraryIds === 0) {
    status = "PASSED";
  } else if (sourceClassification === "REAL_UPSTREAM" && validSourceIds > 0) {
    status = "PASSED"; // Partial valid
  } else {
    status = "FAILED";
  }

  return {
    transport,
    requestedKeyword: input.requestedKeyword,
    requestedMarket: input.requestedMarket || "US",
    requestedLimit: input.requestedLimit || 25,
    resultSetId,
    upstreamRequestObserved,
    upstreamResponseObserved,
    isFixture,
    adsReturned: rawAds.length,
    validSourceIds,
    missingLibraryIds,
    duplicateLibraryIds,
    recordsWithAdvertisers,
    recordsWithSourceUrls,
    sourceClassification,
    status,
    errors,
  };
}
