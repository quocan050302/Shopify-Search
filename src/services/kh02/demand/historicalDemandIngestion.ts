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
  searchTermUsed: string;
  assessment: DemandHistoryAssessment;
  dataPoints: DemandDataPoint[];
  sourceStatus: "PRODUCT_HISTORY_VERIFIED" | "INSUFFICIENT_HISTORY" | "ENGINE_READY";
}

/**
 * Normalizes a product title into an optimal, disambiguated search term for historical demand.
 * Strips brand noise, promotional suffixes, and extracts core functional product noun phrase.
 */
export function normalizeProductSearchTerm(productTitle: string): string {
  if (!productTitle) return "";

  let cleaned = productTitle
    .replace(/^Facebook Ad:\s*\d+/i, "")
    .replace(/^Ad ID:\s*\d+/i, "")
    .replace(/\|\s*.*$/i, "")
    .replace(/-\s*(Official|Free Shipping|Sale|Shop Now).*$/i, "")
    .replace(/\b(50% off|bogo|buy now|limited time|free shipping)\b/gi, "")
    .trim();

  // If overly long, take the first 3-5 core words
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > 5) {
    cleaned = words.slice(0, 5).join(" ");
  }

  return cleaned || productTitle.trim();
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
  const searchTerm = normalizeProductSearchTerm(candidate.canonicalName);

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

  // 3. If no stored records exist, attempt real live provider query if configured
  if (rawRecords.length === 0 && searchTerm.length > 2) {
    try {
      const now = new Date();
      const lookbackDays = Math.max(options.lookbackDays || 90, 60);
      const startDate = new Date(now.getTime() - lookbackDays * 86400000);

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
                  methodologyVersion: "12.2.2",
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

        return {
          productId: targetProductId,
          canonicalName: candidate.canonicalName,
          searchTermUsed: searchTerm,
          assessment,
          dataPoints,
          sourceStatus: assessment.status === "VERIFIED" ? "PRODUCT_HISTORY_VERIFIED" : "INSUFFICIENT_HISTORY",
        };
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

  return {
    productId: targetProductId,
    canonicalName: candidate.canonicalName,
    searchTermUsed: searchTerm,
    assessment,
    dataPoints,
    sourceStatus,
  };
}
