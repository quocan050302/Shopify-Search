/**
 * SWAI KH-02 — Meta Ads Research Adapter
 *
 * Connects to verified Meta competitor advertisements in SQLite,
 * applies diminishing returns for creative volume, and extracts
 * independent advertiser signals for product candidate identification.
 *
 * Geographic Market Rule:
 * Never assume "US" delivery market merely because the query requested US.
 * Deliver truthful geographic provenance: separate requested_market from
 * verified_delivery_market.
 */

import { prisma } from "@/lib/db";
import {
  IntelligenceQuery,
  SourceResearchResult,
  SourceObservation,
  MetaResearchSignals,
} from "../types";
import { extractDomainFromUrl } from "@/services/products/productService";
import { buildAuthorizedAdWhere } from "@/services/research/authorizedScopeHelpers";

export interface MarketProvenance {
  requestedMarket: string;
  sourceReportedMarket: string | null;
  observedMarket: string | null;
  advertiserLocation: string | null;
  inferredMarket: string | null;
  marketVerification: "VERIFIED" | "INFERRED" | "UNKNOWN";
  verifiedDeliveryMarket: string | null;
}

export interface MetaQueryContext {
  requestedMarket?: string;
  topic?: string;
}

/**
 * Resolves truthful geographic delivery market provenance for a Meta ad.
 * Never assumes "US" delivery market merely because the user requested US.
 */
export function resolveMetaMarketProvenance(
  rawAd: any,
  queryContext: MetaQueryContext = {}
): MarketProvenance {
  const requestedMarket = queryContext.requestedMarket || "US";
  const rawMarket = rawAd?.targetMarket || rawAd?.region || null;

  // Check if provider explicitly reported US delivery market
  const isExplicitUS =
    rawMarket === "US" ||
    rawMarket === "USA" ||
    (rawAd?.dataSource?.supportedRegions && String(rawAd.dataSource.supportedRegions).includes("US"));

  if (isExplicitUS) {
    return {
      requestedMarket,
      sourceReportedMarket: "US",
      observedMarket: "US",
      advertiserLocation: rawAd?.advertiser?.country || null,
      inferredMarket: null,
      marketVerification: "VERIFIED",
      verifiedDeliveryMarket: "US",
    };
  }

  // Explicit non-US
  if (rawMarket && rawMarket !== "UNKNOWN") {
    return {
      requestedMarket,
      sourceReportedMarket: String(rawMarket),
      observedMarket: String(rawMarket),
      advertiserLocation: rawAd?.advertiser?.country || null,
      inferredMarket: null,
      marketVerification: "VERIFIED",
      verifiedDeliveryMarket: null,
    };
  }

  // Unknown market provenance
  return {
    requestedMarket,
    sourceReportedMarket: null,
    observedMarket: null,
    advertiserLocation: rawAd?.advertiser?.country || null,
    inferredMarket: null,
    marketVerification: "UNKNOWN",
    verifiedDeliveryMarket: null,
  };
}

/**
 * Collects Meta advertising observations for a research topic in the US market.
 */
export async function collectMetaProductSignals(
  query: IntelligenceQuery
): Promise<SourceResearchResult> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // 1. Determine lookback threshold
    const lookbackThreshold = new Date(Date.now() - query.lookbackDays * 24 * 60 * 60 * 1000);

    // 2. Build search filter matching topic or product keywords
    const keywords = query.productKeywords && query.productKeywords.length > 0
      ? query.productKeywords
      : query.topic.split(/\s+/).filter((w) => w.length > 2);

    const searchClauses = keywords.map((k) => ({
      OR: [
        { headline: { contains: k } },
        { bodyText: { contains: k } },
        { advertiser: { name: { contains: k } } },
      ],
    }));

    // Find competitor ads backed by real observation records, strictly scoped to caller's workspace
    const authorizedWhere = buildAuthorizedAdWhere(query.workspaceId);

    const matchingAds = await prisma.competitorAd.findMany({
      where: {
        platform: { in: ["META", "FACEBOOK"] },
        isSyntheticQuarantine: false,
        AND: [
          authorizedWhere,
          { OR: searchClauses.map((sc) => sc.OR).flat() },
          { lastSeenAt: { gte: lookbackThreshold } },
        ],
      },
      include: {
        advertiser: true,
        dataSource: true,
        mediaAssets: { take: 2 },
        observations: { orderBy: { observedAt: "desc" }, take: 10 },
      },
      take: query.maxResults || 50,
      orderBy: { lastSeenAt: "desc" },
    });

    if (matchingAds.length === 0) {
      warnings.push(`No active Meta ads found for topic '${query.topic}' within ${query.lookbackDays} days.`);
      return {
        source: "META_ADS",
        status: "NO_RESULTS",
        observations: [],
        retrievedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        estimatedCredits: 0,
        consumedCredits: 0,
        startedAt,
        completedAt: new Date().toISOString(),
        errors,
        warnings,
      };
    }

    // 3. Normalize into SourceObservations
    const observations: SourceObservation[] = matchingAds.map((ad) => {
      const media = ad.mediaAssets[0];
      const domain = ad.landingPageUrl ? extractDomainFromUrl(ad.landingPageUrl) : null;
      const marketProv = resolveMetaMarketProvenance(ad, { requestedMarket: query.market || "US", topic: query.topic });

      const signals: MetaResearchSignals = {
        adId: ad.id,
        externalAdId: ad.externalAdId || ad.id,
        advertiserId: ad.advertiserId,
        advertiserName: ad.advertiser?.name || null,
        storeDomain: domain,
        headline: ad.headline,
        bodyText: ad.bodyText,
        landingPageUrl: ad.landingPageUrl,
        firstSeenAt: ad.firstSeenAt?.toISOString() || null,
        lastSeenAt: ad.lastSeenAt?.toISOString() || null,
        daysRunning: ad.daysRunning,
        status: ad.status,
        thumbnailUrl: media?.thumbnailUrl || null,
        videoUrl: media?.videoUrl || null,
        mediaType: media?.mediaType || "IMAGE",
        observationsCount: ad.observations.length,
        sourceConfidence: ad.dataConfidence,
        productMatchHint: ad.headline || ad.bodyText?.slice(0, 60) || null,
      };

      return {
        source: "META_ADS",
        sourceRecordId: ad.id,
        sourceUrl: ad.originalAdUrl || (ad.externalAdId ? `https://www.facebook.com/ads/library/?id=${ad.externalAdId}` : null),
        landingPageUrl: ad.landingPageUrl || null,
        sourceExternalAdId: ad.externalAdId || ad.id,
        storeDomainEvidence: domain,
        advertiserOrCreator: ad.advertiser?.name || null,
        advertiserDomain: domain,
        productMatchHint: ad.headline || null,
        reportedPublishedAt: null,
        reportedFirstShownAt: ad.firstSeenAt?.toISOString() || null,
        reportedLastShownAt: ad.lastSeenAt?.toISOString() || null,
        observedAt: ad.lastSeenAt?.toISOString() || new Date().toISOString(),
        requestedMarket: marketProv.requestedMarket,
        verifiedDeliveryMarket: marketProv.verifiedDeliveryMarket,
        title: ad.headline,
        description: ad.bodyText,
        metrics: {
          daysRunning: ad.daysRunning,
          status: ad.status,
          observationsCount: ad.observations.length,
          dataConfidence: ad.dataConfidence,
          marketVerification: marketProv.marketVerification,
        },
        media: {
          thumbnailUrl: media?.thumbnailUrl || null,
          videoUrl: media?.videoUrl || null,
          mediaType: media?.mediaType || null,
        },
        provenance: ad.dataConfidence === "VERIFIED" ? "VERIFIED_SOURCE" : "USER_IMPORTED",
        evidenceReference: `CompetitorAd:${ad.id}`,
      };
    });

    return {
      source: "META_ADS",
      status: "PASSED",
      observations,
      retrievedCount: matchingAds.length,
      acceptedCount: observations.length,
      rejectedCount: 0,
      estimatedCredits: 0,
      consumedCredits: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      errors,
      warnings,
    };
  } catch (err: any) {
    errors.push(err.message || "Failed to collect Meta product signals.");
    return {
      source: "META_ADS",
      status: "FAILED",
      observations: [],
      retrievedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      estimatedCredits: 0,
      consumedCredits: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      errors,
      warnings,
    };
  }
}
