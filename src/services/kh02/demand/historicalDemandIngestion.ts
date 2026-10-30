/**
 * SWAI KH-02 — Historical Demand Ingestion & Product Time-Series Matcher
 *
 * Links historical search interest observations to validated product identities:
 * - Queries ProductDemandObservation by product ID or canonical product title
 * - Enforces multi-observation coverage across 60+ days
 * - Evaluates temporal demand stability for evergreen qualification
 */

import { prisma } from "@/lib/db";
import {
  DemandDataPoint,
  DemandHistoryAssessment,
  evaluateDemandHistoryEvidence,
  evaluateDemandSourceAuthority,
  detectSpecificProductFamily,
} from "./temporalDemandEngine";
import {
  defaultDemandProvider,
  resolveDemandProviderMode,
  DemandQuery,
} from "./demandProviderRegistry";
import { buildAuthorizedProductWhere } from "@/services/research/authorizedScopeHelpers";

export type DemandCacheAuthorityClassification =
  | "CACHE_AUTHORITATIVE_FRESH"
  | "CACHE_AUTHORITATIVE_STALE"
  | "CACHE_UNVERIFIED"
  | "CACHE_INSUFFICIENT"
  | "LIVE_PROVIDER_AVAILABLE"
  | "LIVE_PROVIDER_BLOCKED"
  | "LIVE_PROVIDER_FAILED"
  | "NO_VALID_DEMAND_EVIDENCE";

export interface ProductDemandResolution {
  productId: string | null;
  canonicalName: string;
  rawTerm: string;
  normalizedTerm: string;
  searchTermUsed: string;
  mappingReason: string;
  requestedLookbackDays: number;
  actualCoveredDays: number;
  observationPointsCount: number;
  coverageGaps: string[];
  assessment: DemandHistoryAssessment;
  dataPoints: DemandDataPoint[];
  sourceStatus: "PRODUCT_HISTORY_VERIFIED" | "INSUFFICIENT_HISTORY" | "ENGINE_READY";
  cacheClassification?: DemandCacheAuthorityClassification;
  providerAttempted?: boolean;
  providerStatus?: "SUCCESS" | "INSUFFICIENT_DATA" | "BLOCKED" | "FAILED" | "NOT_CONFIGURED" | "SKIPPED";
  providerError?: string | null;
}

/**
 * Normalizes a product title into an optimal, disambiguated search term for historical demand.
 * Strips brand noise, promotional suffixes, capacities/model codes, and extracts core functional product noun phrase.
 */
export function normalizeProductSearchTerm(productTitle: string): string {
  if (!productTitle) return "";

  let cleaned = productTitle
    .replace(/^(?:Facebook\s+Ad|Ad\s+ID|Meta\s+Ad|Creative\s+ID)\s*[:#]?\s*[A-Za-z0-9_-]+\s*(?:[|:\-–—]+\s*)?/i, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, " ");

  // If pipe-separated segments remain, pick the segment with the most descriptive product words
  if (cleaned.includes("|")) {
    const parts = cleaned
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s.length >= 3 && !/^(?:facebook\s+ad|ad\s+id|free\s+shipping|official|shop\s+now|buy\s+now|\d+%\s*off)/i.test(s));
    if (parts.length > 0) {
      cleaned = parts.sort((a, b) => b.length - a.length)[0];
    } else {
      cleaned = cleaned.replace(/\|/g, " ");
    }
  }

  cleaned = cleaned
    .replace(/\s+[-–—]\s*(?:Official|Free Shipping|Sale|Shop Now|Buy Now|Limited Time).*$/i, "")
    .replace(/\b(\d+%\s*off(\s+today)?!?|today!|bogo|buy\s+\d+\s+get\s+\d+(\s+free)?|buy now|shop now|limited time(\s+offer)?|free shipping|official store|hot deal|flash sale)\b/gi, "")
    .replace(/\b\d+(?:\.\d+)?\s*(?:ml|oz|fl\s*oz|l|liter|mm|cm|in|inch|pcs|pack)\b/gi, "")
    .replace(/[!#*|:]+/g, " ")
    .replace(/^\s*[-–—]+\s*|\s*[-–—]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // If overly long, take the core words (up to 8 words)
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > 8) {
    cleaned = words.slice(0, 8).join(" ");
  }

  return cleaned || productTitle.trim();
}

export function normalizeDemandQueryTerm(rawTerm: string): {
  rawTerm: string;
  normalizedTerm: string;
  mappingReason: string;
} {
  const normalizedTerm = normalizeProductSearchTerm(rawTerm);
  const mappingReason =
    normalizedTerm !== rawTerm.trim()
      ? `Normalized '${rawTerm}' -> '${normalizedTerm}' (stripped promotional suffixes/campaign codes/capacities)`
      : `Used clean product name '${normalizedTerm}' directly`;
  return {
    rawTerm,
    normalizedTerm,
    mappingReason,
  };
}

/**
 * Resolves historical demand for a product candidate, using stored time series or provider lookup.
 * Strictly respects workspace authorization and never merges unrelated product series.
 */
export async function resolveProductDemandHistory(
  candidate: {
    productId?: string | null;
    canonicalName: string;
    category?: string | null;
  },
  options: {
    lookbackDays?: number;
    region?: string;
    workspaceId?: string;
    researchRunId?: string;
    queryId?: string;
  } = {}
): Promise<ProductDemandResolution> {
  const region = options.region || "US";
  const requestedLookbackDays = options.lookbackDays || 90;
  const rawTerm = candidate.canonicalName || "";
  const searchTerm = normalizeProductSearchTerm(rawTerm);
  const mappingReason =
    searchTerm !== rawTerm.trim()
      ? `Normalized '${rawTerm}' -> '${searchTerm}' (stripped promotional suffixes/capacities for clean product demand query)`
      : `Used clean product name '${searchTerm}' directly`;

  let rawRecords: any[] = [];
  let targetProductId = candidate.productId || null;

  // 1. First check if candidate has an existing linked ResearchProduct with demand observations
  if (targetProductId) {
    rawRecords = await prisma.productDemandObservation.findMany({
      where: {
        productId: targetProductId,
        region,
        ...(options.workspaceId ? { product: buildAuthorizedProductWhere(options.workspaceId) } : {}),
      },
      orderBy: { periodStart: "asc" },
    });
  }

  // 2. If not found by productId, check if observations exist matching a single canonical product
  // CRITICAL: NEVER merge multiple distinct products into one time series
  if (rawRecords.length === 0 && searchTerm.length > 2) {
    const candidateProducts = await prisma.researchProduct.findMany({
      where: {
        AND: [
          { id: { not: { startsWith: "prod_fixture_" } } },
          ...(options.workspaceId ? [buildAuthorizedProductWhere(options.workspaceId)] : []),
          {
            OR: [
              { title: { contains: searchTerm } },
              { productUrl: { contains: searchTerm.toLowerCase().replace(/\s+/g, "-") } },
            ],
          },
        ],
      },
      select: { id: true, title: true, productUrl: true },
      take: 5,
    });

    const candFamily = detectSpecificProductFamily(candidate.canonicalName);
    const matchingProduct = candidateProducts.find((mp) => {
      const mpFamily = detectSpecificProductFamily(mp.title);
      if (candFamily && mpFamily && candFamily !== mpFamily) return false;
      return true;
    });

    if (matchingProduct) {
      targetProductId = matchingProduct.id;
      rawRecords = await prisma.productDemandObservation.findMany({
        where: {
          productId: matchingProduct.id,
          region,
        },
        orderBy: { periodStart: "asc" },
      });
    }
  }

  const buildResolution = (
    dataPoints: DemandDataPoint[],
    assessment: DemandHistoryAssessment,
    sourceStatus: "PRODUCT_HISTORY_VERIFIED" | "INSUFFICIENT_HISTORY" | "ENGINE_READY",
    resolutionMeta?: {
      cacheClassification?: DemandCacheAuthorityClassification;
      providerAttempted?: boolean;
      providerStatus?: "SUCCESS" | "INSUFFICIENT_DATA" | "BLOCKED" | "FAILED" | "NOT_CONFIGURED" | "SKIPPED";
      providerError?: string | null;
    }
  ): ProductDemandResolution => {
    const coverageGaps: string[] = [...(assessment.missingEvidence || [])];
    if (requestedLookbackDays < 60) {
      coverageGaps.push(
        `Requested lookback window is ${requestedLookbackDays}D, which is shorter than the mandatory 60D minimum required for Verified Evergreen qualification.`
      );
    }
    if (dataPoints.length > assessment.dataPointsCount) {
      coverageGaps.push(
        `Deduplicated ${dataPoints.length - assessment.dataPointsCount} duplicate timestamp observation(s).`
      );
    }
    if (
      assessment.coveredDays > 0 &&
      assessment.coveredDays < requestedLookbackDays
    ) {
      coverageGaps.push(
        `Observed series covers ${assessment.coveredDays}D out of requested ${requestedLookbackDays}D window.`
      );
    }

    if (resolutionMeta?.cacheClassification === "CACHE_UNVERIFIED") {
      coverageGaps.push(
        "Stored cache observations are CACHED_UNVERIFIED and cannot verify production Evergreen demand without authoritative provider refresh."
      );
    }
    const isGoogleFreeMode = resolveDemandProviderMode() === "GOOGLE_FREE_ONLY";
    if (resolutionMeta?.providerStatus === "NOT_CONFIGURED") {
      coverageGaps.push(
        isGoogleFreeMode
          ? "Google free demand sources (BigQuery public datasets / official Trends CSV import) have insufficient historical coverage for this product. Import an official Google Trends CSV export or configure BigQuery sandbox."
          : "Demand provider credentials (SERPAPI_API_KEY) are not configured. To enable live Google Trends verification, set SERPAPI_API_KEY from the SerpApi Free plan."
      );
    } else if (resolutionMeta?.providerStatus === "INSUFFICIENT_DATA") {
      coverageGaps.push(
        resolutionMeta.providerError ||
          `Google demand sources returned insufficient time-series data for '${searchTerm}'.`
      );
    } else if (resolutionMeta?.providerStatus === "BLOCKED") {
      coverageGaps.push(
        `Demand provider is BLOCKED: ${resolutionMeta.providerError || "Quota exhausted or paid research blocked."}`
      );
    } else if (resolutionMeta?.providerStatus === "FAILED") {
      coverageGaps.push(
        `Demand provider call failed: ${resolutionMeta.providerError || "Network error or provider timeout."}`
      );
    }

    return {
      productId: targetProductId,
      canonicalName: candidate.canonicalName,
      rawTerm,
      normalizedTerm: searchTerm,
      searchTermUsed: searchTerm,
      mappingReason,
      requestedLookbackDays,
      actualCoveredDays: assessment.coveredDays,
      observationPointsCount: assessment.dataPointsCount,
      coverageGaps,
      assessment,
      dataPoints,
      sourceStatus,
      cacheClassification: resolutionMeta?.cacheClassification,
      providerAttempted: resolutionMeta?.providerAttempted,
      providerStatus: resolutionMeta?.providerStatus,
      providerError: resolutionMeta?.providerError,
    };
  };

  // 3. Convert stored raw records to demand data points and evaluate authority/coverage
  let currentPoints: DemandDataPoint[] = rawRecords.map((r) => ({
    id: r.id,
    productId: r.productId,
    keyword: r.keyword,
    evidenceReference: r.evidenceReference,
    methodologyVersion: r.methodologyVersion,
    isFixture: String(r.productId || "").startsWith("prod_fixture_"),
    periodStart: r.periodStart.toISOString ? r.periodStart.toISOString() : String(r.periodStart),
    periodEnd: r.periodEnd.toISOString ? r.periodEnd.toISOString() : String(r.periodEnd),
    demandValue: r.demandValue,
    region: r.region,
    source: r.source,
    date: r.periodStart.toISOString ? r.periodStart.toISOString() : String(r.periodStart),
    value: r.demandValue,
  }));

  const initialAssessment = evaluateDemandHistoryEvidence(currentPoints, {
    minimumDataPoints: 3,
    minimumCoveredDays: requestedLookbackDays,
    requiredRegion: region,
    candidateCanonicalName: candidate.canonicalName,
    searchTermUsed: searchTerm,
  });

  const initialAuth = evaluateDemandSourceAuthority(currentPoints, {
    candidateCanonicalName: candidate.canonicalName,
    searchTermUsed: searchTerm,
  });

  let cacheClassification: DemandCacheAuthorityClassification;
  if (rawRecords.length === 0) {
    cacheClassification = "NO_VALID_DEMAND_EVIDENCE";
  } else if (
    initialAuth.authority === "AUTHORITATIVE_VERIFIED" ||
    initialAuth.authority === "HISTORICAL_SOURCE_VERIFIED"
  ) {
    if (initialAssessment.status === "VERIFIED" && initialAssessment.coveredDays >= requestedLookbackDays) {
      cacheClassification = "CACHE_AUTHORITATIVE_FRESH";
    } else if (initialAssessment.coveredDays < requestedLookbackDays) {
      cacheClassification = "CACHE_AUTHORITATIVE_STALE";
    } else {
      cacheClassification = "CACHE_INSUFFICIENT";
    }
  } else {
    // Unverified, synthetic, proxy, or fixture series
    cacheClassification = "CACHE_UNVERIFIED";
  }

  // 4. Determine whether live provider query is required:
  // Never let CACHED_UNVERIFIED or CACHE_INSUFFICIENT block live query if provider is available
  let providerAttempted = false;
  let providerStatus: "SUCCESS" | "INSUFFICIENT_DATA" | "BLOCKED" | "FAILED" | "NOT_CONFIGURED" | "SKIPPED" = "SKIPPED";
  let providerError: string | null = null;

  const isGoogleFreeMode = resolveDemandProviderMode() === "GOOGLE_FREE_ONLY";
  const needsLiveQuery =
    cacheClassification !== "CACHE_AUTHORITATIVE_FRESH" && searchTerm.length > 2;

  if (needsLiveQuery) {
    let diag: any = { configured: false, status: "NOT_CONFIGURED" };
    try {
      diag = await defaultDemandProvider.diagnose();
    } catch {
      diag = { configured: false, status: "NOT_CONFIGURED" };
    }

    if (!diag.configured) {
      providerAttempted = false;
      providerStatus = "NOT_CONFIGURED";
      providerError = isGoogleFreeMode
        ? "Google Free demand sources have no active configuration."
        : "Demand provider credentials (SERPAPI_API_KEY) are not configured.";
    } else {
      providerAttempted = true;
      try {
        const now = new Date();
        const startDate = new Date(now.getTime() - requestedLookbackDays * 86400000);

        const seriesResult = await defaultDemandProvider.fetchSeries({
          term: searchTerm,
          canonicalProductName: candidate.canonicalName,
          productId: targetProductId || undefined,
          region,
          startDate,
          endDate: now,
        });

        providerStatus = seriesResult.status;
        providerError = seriesResult.error || null;

        if (seriesResult.status === "SUCCESS" && seriesResult.points.length > 0) {
          if (targetProductId) {
            for (const pt of seriesResult.points) {
              try {
                await prisma.productDemandObservation.create({
                  data: {
                    productId: targetProductId,
                    source: pt.source || "Google Trends (SerpApi)",
                    region: pt.region || region,
                    keyword: searchTerm,
                    periodStart: new Date(pt.periodStart),
                    periodEnd: new Date(pt.periodEnd),
                    demandValue: pt.demandValue,
                    valueType: "RELATIVE_INTEREST",
                    evidenceReference: options.queryId || options.researchRunId || "DEMAND_API_INGESTION",
                    methodologyVersion: "serpapi_google_trends_live",
                  },
                });
              } catch {
                // Ignore duplicate constraint violation
              }
            }
          }

          const livePoints: DemandDataPoint[] = seriesResult.points.map((p) => ({
            periodStart: p.periodStart,
            periodEnd: p.periodEnd,
            demandValue: p.demandValue,
            region: p.region,
            source: p.source,
            date: p.periodStart,
            value: p.demandValue,
            methodologyVersion: "serpapi_google_trends_live",
            evidenceReference: options.queryId || options.researchRunId || "DEMAND_API_INGESTION",
          }));

          // Merge live points with existing valid (non-fixture, non-synthetic) points
          const existingValid = currentPoints.filter(
            (p) => !p.isFixture && p.source !== "CACHED_UNVERIFIED"
          );
          const seenDates = new Set(livePoints.map((p) => String(p.periodStart).slice(0, 10)));
          const combined = [...livePoints];
          for (const ep of existingValid) {
            const d = String(ep.periodStart).slice(0, 10);
            if (!seenDates.has(d)) {
              seenDates.add(d);
              combined.push(ep);
            }
          }
          combined.sort((a, b) => String(a.periodStart).localeCompare(String(b.periodStart)));
          currentPoints = combined;
        }
      } catch (err: any) {
        providerStatus = "FAILED";
        providerError = err?.message || "Live demand provider fetch threw an unexpected error.";
      }
    }
  }

  // 5. Final demand history assessment across all valid data points
  const assessment = evaluateDemandHistoryEvidence(currentPoints, {
    minimumDataPoints: 3,
    minimumCoveredDays: 60,
    requiredRegion: region,
    candidateCanonicalName: candidate.canonicalName,
    searchTermUsed: searchTerm,
  });

  const sourceStatus =
    assessment.status === "VERIFIED"
      ? "PRODUCT_HISTORY_VERIFIED"
      : currentPoints.length > 0
      ? "INSUFFICIENT_HISTORY"
      : "ENGINE_READY";

  return buildResolution(currentPoints, assessment, sourceStatus, {
    cacheClassification,
    providerAttempted,
    providerStatus,
    providerError,
  });
}
