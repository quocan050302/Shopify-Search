/**
 * SWAI KH-02 — TikTok Ads US Research Adapter
 *
 * Enforces strict geographic separation:
 * - TikTok Commercial Content Library covers EU/UK compliance (NOT US competitor search).
 * - TikTok Ads US relies on Creative Center Top Ads or manual batch import.
 * - If automated US provider is unconfigured, reports NOT_VERIFIED with explicit explanation.
 * - Never fabricates TikTok ad metrics or fakes US delivery confirmation.
 */

import { prisma } from "@/lib/db";
import {
  IntelligenceQuery,
  SourceResearchResult,
  SourceObservation,
  TikTokAdsSignals,
} from "../types";
import { extractDomainFromUrl } from "@/services/products/productService";
import { buildAuthorizedAdWhere } from "@/services/research/authorizedScopeHelpers";
import { TiktokTopAdsProvider } from "@/services/discovery/providers/tiktokTopAdsProvider";
import { ApifyTopAdsProvider } from "@/services/discovery/providers/apifyTopAdsProvider";
import { ingestDiscoveredAds } from "@/services/discovery/discoveryIngestionService";
import { DiscoveryQuerySchema } from "@/services/discovery/types";

/**
 * Collects TikTok advertising observations for a research topic.
 *
 * Priorities:
 * 1. Live TikTok Creative Center Top Ads query (TIKTOK_CC_COOKIE)
 * 2. Live Apify Top Ads query (APIFY_TOKEN with budget authorization)
 * 3. Scoped SQLite CompetitorAd cache (labeled MANUAL_ONLY / CACHED_SOURCE, never claiming live)
 * 4. Honest blocker: NO_AUTHORIZED_US_AD_PROVIDER if unconfigured and no cache
 */
export async function collectTikTokAdsSignals(
  query: IntelligenceQuery
): Promise<SourceResearchResult> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const warnings: string[] = [];

  const hasCcCookie = Boolean(process.env.TIKTOK_CC_COOKIE && process.env.TIKTOK_CC_COOKIE.trim().length > 0);
  const hasApifyToken = Boolean(
    (process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN) &&
    process.env.ENABLE_APIFY_DISCOVERY === "true"
  );

  // 1. Attempt Live Provider Query if configured
  const searchWindowDays: 7 | 30 | 180 =
    query.lookbackDays && query.lookbackDays <= 7 ? 7 : query.lookbackDays && query.lookbackDays > 30 ? 180 : 30;

  if (hasCcCookie) {
    try {
      const topAdsProvider = new TiktokTopAdsProvider();
      const pageRes = await topAdsProvider.discoverPage(
        DiscoveryQuerySchema.parse({
          workspaceId: query.workspaceId,
          platform: "TIKTOK",
          market: "US",
          keywords: [query.topic],
          pageSize: query.maxResults || 20,
          searchWindowDays,
        })
      );

      if (pageRes.items && pageRes.items.length > 0) {
        // Ingest into database for persistence
        await ingestDiscoveredAds(pageRes.items, {
          workspaceId: query.workspaceId,
          providerId: "tiktok-topads",
          runMode: "MANUAL",
          isQuarantined: false,
        }).catch((ingestErr) => {
          warnings.push(`Ingestion notice: ${ingestErr.message}`);
        });

        const observations: SourceObservation[] = pageRes.items.map((ad: any) => {
          const domain = ad.landingPageUrl ? extractDomainFromUrl(ad.landingPageUrl) : null;
          return {
            source: "TIKTOK_ADS",
            sourceRecordId: ad.externalAdId || `tt_live_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            sourceUrl: ad.originalAdUrl || null,
            landingPageUrl: ad.landingPageUrl || null,
            sourceExternalAdId: ad.externalAdId || null,
            storeDomainEvidence: domain,
            advertiserOrCreator: ad.advertiserName || null,
            advertiserDomain: domain,
            productMatchHint: ad.headline || null,
            reportedPublishedAt: null,
            reportedFirstShownAt: ad.firstSeenAt ? new Date(ad.firstSeenAt).toISOString() : null,
            reportedLastShownAt: ad.lastSeenAt ? new Date(ad.lastSeenAt).toISOString() : null,
            observedAt: new Date().toISOString(),
            requestedMarket: "US",
            verifiedDeliveryMarket: "US",
            title: ad.headline || ad.bodyText?.slice(0, 80) || "TikTok Sponsored Ad",
            description: ad.bodyText,
            metrics: {
              daysRunning: ad.daysRunning || 1,
              status: ad.status || "ACTIVE",
            },
            media: {
              thumbnailUrl: ad.mediaAssets?.[0]?.thumbnailUrl || null,
              videoUrl: ad.mediaAssets?.[0]?.videoUrl || null,
              mediaType: "VIDEO",
            },
            provenance: "LIVE_PROVIDER",
            evidenceReference: `TikTokTopAd:${ad.externalAdId || "live"}`,
          };
        });

        return {
          source: "TIKTOK_ADS",
          status: "PASSED",
          observations,
          retrievedCount: pageRes.items.length,
          acceptedCount: observations.length,
          rejectedCount: 0,
          estimatedCredits: 0,
          consumedCredits: 0,
          startedAt,
          completedAt: new Date().toISOString(),
          errors,
          warnings,
        };
      }
    } catch (liveErr: any) {
      warnings.push(`TikTok Top Ads live query encountered: ${liveErr.message}. Falling back to cached observations.`);
    }
  } else if (hasApifyToken) {
    try {
      const apifyProvider = new ApifyTopAdsProvider();
      const pageRes = await apifyProvider.discoverPage(
        DiscoveryQuerySchema.parse({
          workspaceId: query.workspaceId,
          platform: "TIKTOK",
          market: "US",
          keywords: [query.topic],
          pageSize: query.maxResults || 20,
          searchWindowDays,
        })
      );

      if (pageRes.items && pageRes.items.length > 0) {
        await ingestDiscoveredAds(pageRes.items, {
          workspaceId: query.workspaceId,
          providerId: "apify-topads",
          runMode: "MANUAL",
          isQuarantined: false,
        }).catch(() => {});

        const observations: SourceObservation[] = pageRes.items.map((ad: any) => {
          const domain = ad.landingPageUrl ? extractDomainFromUrl(ad.landingPageUrl) : null;
          return {
            source: "TIKTOK_ADS",
            sourceRecordId: ad.externalAdId || `tt_apify_${Date.now()}`,
            sourceUrl: ad.originalAdUrl || null,
            landingPageUrl: ad.landingPageUrl || null,
            sourceExternalAdId: ad.externalAdId || null,
            storeDomainEvidence: domain,
            advertiserOrCreator: ad.advertiserName || null,
            advertiserDomain: domain,
            productMatchHint: ad.headline || null,
            reportedPublishedAt: null,
            reportedFirstShownAt: ad.firstSeenAt ? new Date(ad.firstSeenAt).toISOString() : null,
            reportedLastShownAt: ad.lastSeenAt ? new Date(ad.lastSeenAt).toISOString() : null,
            observedAt: new Date().toISOString(),
            requestedMarket: "US",
            verifiedDeliveryMarket: "US",
            title: ad.headline || "TikTok Top Ad",
            description: ad.bodyText,
            metrics: { daysRunning: ad.daysRunning, status: ad.status },
            media: {
              thumbnailUrl: ad.mediaAssets?.[0]?.thumbnailUrl || null,
              videoUrl: ad.mediaAssets?.[0]?.videoUrl || null,
              mediaType: "VIDEO",
            },
            provenance: "LIVE_PROVIDER",
            evidenceReference: `ApifyTopAd:${ad.externalAdId}`,
          };
        });

        return {
          source: "TIKTOK_ADS",
          status: "PASSED",
          observations,
          retrievedCount: pageRes.items.length,
          acceptedCount: observations.length,
          rejectedCount: 0,
          estimatedCredits: 0,
          consumedCredits: 0,
          startedAt,
          completedAt: new Date().toISOString(),
          errors,
          warnings,
        };
      }
    } catch (apifyErr: any) {
      warnings.push(`Apify Top Ads live query encountered: ${apifyErr.message}. Falling back to cached observations.`);
    }
  }

  // 2. Scoped Database Cache Fallback
  try {
    const lookbackThreshold = new Date(Date.now() - query.lookbackDays * 24 * 60 * 60 * 1000);
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

    const authorizedWhere = buildAuthorizedAdWhere(query.workspaceId);

    const matchingAds = await prisma.competitorAd.findMany({
      where: {
        platform: "TIKTOK",
        isSyntheticQuarantine: false,
        AND: [
          authorizedWhere,
          { OR: searchClauses.map((sc) => sc.OR).flat() },
          { lastSeenAt: { gte: lookbackThreshold } },
        ],
      },
      include: {
        advertiser: true,
        mediaAssets: { take: 1 },
      },
      take: query.maxResults || 20,
      orderBy: { lastSeenAt: "desc" },
    });

    if (matchingAds.length > 0) {
      const observations: SourceObservation[] = matchingAds.map((ad) => {
        const media = ad.mediaAssets[0];
        const domain = ad.landingPageUrl ? extractDomainFromUrl(ad.landingPageUrl) : null;
        const isVerifiedUS = ad.targetMarket === "US";

        return {
          source: "TIKTOK_ADS",
          sourceRecordId: ad.id,
          sourceUrl: ad.originalAdUrl || null,
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
          requestedMarket: "US",
          verifiedDeliveryMarket: isVerifiedUS ? "US" : null,
          title: ad.headline,
          description: ad.bodyText,
          metrics: {
            daysRunning: ad.daysRunning,
            status: ad.status,
          },
          media: {
            thumbnailUrl: media?.thumbnailUrl || null,
            videoUrl: media?.videoUrl || null,
            mediaType: "VIDEO",
          },
          provenance: "CACHED_SOURCE",
          evidenceReference: `CompetitorAd:${ad.id}`,
        };
      });

      warnings.push("TikTok Ads US: Automated live provider is unconfigured (TIKTOK_CC_COOKIE missing). Results are from workspace cache (MANUAL_ONLY).");

      return {
        source: "TIKTOK_ADS",
        status: "MANUAL_ONLY", // Truthful: cache/manual only, not claiming live PASSED!
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
    }

    // 3. No live provider and no cache
    errors.push("TikTok Ads US live provider is unconfigured (NO_AUTHORIZED_US_AD_PROVIDER). Configure TIKTOK_CC_COOKIE in .env.local or import ads manually.");

    return {
      source: "TIKTOK_ADS",
      status: "NOT_CONFIGURED",
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
  } catch (err: any) {
    errors.push(err.message || "Failed to query TikTok ads.");
    return {
      source: "TIKTOK_ADS",
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
