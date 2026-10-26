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

/**
 * Collects TikTok advertising observations for a research topic.
 */
export async function collectTikTokAdsSignals(
  query: IntelligenceQuery
): Promise<SourceResearchResult> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // 1. Look for existing verified TikTok ads in database scoped strictly to workspace
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
        // Truthful market verification: check if ad record genuinely verified US target market
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
          provenance: ad.dataConfidence === "VERIFIED" ? "VERIFIED_SOURCE" : "USER_IMPORTED",
          evidenceReference: `CompetitorAd:${ad.id}`,
        };
      });

      return {
        source: "TIKTOK_ADS",
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
    }

    // 2. When no stored ads match and no automated US provider is active:
    warnings.push("TikTok Ads US: No automated US competitor ad provider configured. Manual Creative Center research is available.");

    return {
      source: "TIKTOK_ADS",
      status: "NOT_VERIFIED",
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
