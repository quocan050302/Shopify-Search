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
} from "./temporalDemandEngine";
import { defaultDemandProvider, DemandQuery } from "./demandProviderRegistry";
import { buildAuthorizedProductWhere } from "@/services/research/authorizedScopeHelpers";

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

  // If overly long, take the core words (up to 6 words)
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > 6) {
    cleaned = words.slice(0, 6).join(" ");
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
    const matchingProduct = await prisma.researchProduct.findFirst({
      where: {
        AND: [
          ...(options.workspaceId ? [buildAuthorizedProductWhere(options.workspaceId)] : []),
          {
            OR: [
              { title: { contains: searchTerm } },
              { productUrl: { contains: searchTerm.toLowerCase().replace(/\s+/g, "-") } },
            ],
          },
        ],
      },
      select: { id: true },
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
    sourceStatus: "PRODUCT_HISTORY_VERIFIED" | "INSUFFICIENT_HISTORY" | "ENGINE_READY"
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
    };
  };

  // 3. If no stored records exist, attempt real live provider query if configured
  if (rawRecords.length === 0 && searchTerm.length > 2) {
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

      if (seriesResult.status === "SUCCESS" && seriesResult.points.length > 0) {
        if (targetProductId) {
          for (const pt of seriesResult.points) {
            try {
              await prisma.productDemandObservation.create({
                data: {
                  productId: targetProductId,
                  source: pt.source || "PROVIDER_API",
                  region: pt.region || region,
                  keyword: searchTerm,
                  periodStart: new Date(pt.periodStart),
                  periodEnd: new Date(pt.periodEnd),
                  demandValue: pt.demandValue,
                  valueType: "RELATIVE_INTEREST",
                  evidenceReference: options.queryId || options.researchRunId || "DEMAND_API_INGESTION",
                  methodologyVersion: "12.4.3",
                },
              });
            } catch {
              // ignore duplicate key or constraint violation
            }
          }
        }

        const dataPoints: DemandDataPoint[] = seriesResult.points.map((p) => ({
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
          demandValue: p.demandValue,
          region: p.region,
          source: p.source,
          date: p.periodStart,
          value: p.demandValue,
        }));

        const assessment = evaluateDemandHistoryEvidence(dataPoints, {
          minimumDataPoints: 3,
          minimumCoveredDays: 60,
          requiredRegion: region,
        });

        return buildResolution(
          dataPoints,
          assessment,
          assessment.status === "VERIFIED" ? "PRODUCT_HISTORY_VERIFIED" : "INSUFFICIENT_HISTORY"
        );
      }
    } catch {
      // Live provider lookup failed or unconfigured; proceed with local assessment
    }
  }

  const dataPoints: DemandDataPoint[] = rawRecords.map((r) => ({
    periodStart: r.periodStart.toISOString ? r.periodStart.toISOString() : String(r.periodStart),
    periodEnd: r.periodEnd.toISOString ? r.periodEnd.toISOString() : String(r.periodEnd),
    demandValue: r.demandValue,
    region: r.region,
    source: r.source,
    date: r.periodStart.toISOString ? r.periodStart.toISOString() : String(r.periodStart),
    value: r.demandValue,
  }));

  // 4. Evaluate demand history policy (Strict 60-day requirement: never silently reduce)
  const assessment = evaluateDemandHistoryEvidence(dataPoints, {
    minimumDataPoints: 3,
    minimumCoveredDays: 60,
    requiredRegion: region,
  });

  const sourceStatus =
    assessment.status === "VERIFIED"
      ? "PRODUCT_HISTORY_VERIFIED"
      : dataPoints.length > 0
      ? "INSUFFICIENT_HISTORY"
      : "ENGINE_READY";

  return buildResolution(dataPoints, assessment, sourceStatus);
}
