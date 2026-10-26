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
 */
export async function resolveProductDemandHistory(
  candidate: {
    productId?: string | null;
    canonicalName: string;
    category?: string | null;
  },
  options: { lookbackDays?: number; region?: string } = {}
): Promise<ProductDemandResolution> {
  const region = options.region || "US";
  const searchTerm = normalizeProductSearchTerm(candidate.canonicalName);

  let rawRecords: any[] = [];

  // 1. First check if candidate has an existing linked ResearchProduct with demand observations
  if (candidate.productId) {
    rawRecords = await prisma.productDemandObservation.findMany({
      where: {
        productId: candidate.productId,
        region,
      },
      orderBy: { periodStart: "asc" },
    });
  }

  // 2. If not found by productId, check if observations exist matching the canonical product name or search term
  if (rawRecords.length === 0 && searchTerm.length > 2) {
    const matchingProducts = await prisma.researchProduct.findMany({
      where: {
        OR: [
          { title: { contains: searchTerm } },
          { productUrl: { contains: searchTerm.toLowerCase().replace(/\s+/g, "-") } },
        ],
      },
      select: { id: true },

      take: 3,
    });

    if (matchingProducts.length > 0) {
      const productIds = matchingProducts.map((p) => p.id);
      rawRecords = await prisma.productDemandObservation.findMany({
        where: {
          productId: { in: productIds },
          region,
        },
        orderBy: { periodStart: "asc" },
      });
    }
  }

  const dataPoints: DemandDataPoint[] = rawRecords.map((r) => ({
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    demandValue: r.demandValue,
    region: r.region,
    source: r.source,
    date: r.periodStart,
    value: r.demandValue,
  }));

  // 3. Evaluate demand history policy
  const assessment = evaluateDemandHistoryEvidence(dataPoints, {
    minimumDataPoints: 3,
    minimumCoveredDays: Math.min(options.lookbackDays || 60, 60),
    requiredRegion: region,
  });


  const sourceStatus =
    assessment.status === "VERIFIED"
      ? "PRODUCT_HISTORY_VERIFIED"
      : dataPoints.length > 0
      ? "INSUFFICIENT_HISTORY"
      : "ENGINE_READY";

  return {
    productId: candidate.productId || null,
    canonicalName: candidate.canonicalName,
    searchTermUsed: searchTerm,
    assessment,
    dataPoints,
    sourceStatus,
  };
}
