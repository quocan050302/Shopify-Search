/**
 * GET /api/v1/evergreen/ads
 *
 * Returns ranked evergreen ads from the local research database.
 * Excludes synthetic/quarantined records by default.
 * Supports Evergreen / Emerging / Trending research modes.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  calculateAdLongevityScore,
  rankEvergreenAds,
  type EvergreenRankingFilters,
  type ResearchMode,
} from "@/services/evergreen/evergreenScoring";
import { isSyntheticAdId } from "@/services/video/videoSourceResolver";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const mode = (searchParams.get("mode") || "EVERGREEN") as ResearchMode;
    const platform = searchParams.get("platform") || "ALL";
    const minAgeDays = searchParams.get("minAgeDays")
      ? parseInt(searchParams.get("minAgeDays")!, 10)
      : undefined;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get("pageSize") || "12", 10)));

    // Build DB where clause — always exclude synthetic records
    const where: any = {
      isSyntheticQuarantine: false,
      dataConfidence: { not: "UNAVAILABLE" },
      AND: [{ NOT: { headline: { startsWith: "[SYNTHETIC_DEMO]" } } }],
    };

    if (platform && platform !== "ALL") {
      where.platform = platform.toUpperCase();
    }

    const ads = await prisma.competitorAd.findMany({
      where,
      include: {
        advertiser: true,
        mediaAssets: true,
        observations: {
          orderBy: { observedAt: "desc" },
          take: 50,
        },
        lifecycleEvents: {
          orderBy: { occurredAt: "asc" },
        },
        evergreenScores: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        researchScores: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        productLinks: {
          include: { product: true },
        },
        creativeVariants: true,
      },
    });

    // Compute evergreen scores for each ad
    const scoredAds = ads
      .filter((ad) => !isSyntheticAdId(ad.externalAdId ?? ""))
      .map((ad) => {
        const scoreResult = calculateAdLongevityScore({
          adId: ad.id,
          platform: ad.platform,
          sourceReportedStartAt: ad.sourceReportedStartAt ?? null,
          sourceReportedEndAt: ad.sourceReportedEndAt ?? null,
          isSyntheticQuarantine: ad.isSyntheticQuarantine,
          observations: ad.observations.map((o) => ({
            observedAt: new Date(o.observedAt),
            observationStatus: (o.observationStatus as any) ?? "UNKNOWN",
            confidence: o.confidence,
          })),
          sourceReliability:
            ad.dataConfidence === "VERIFIED"
              ? "OFFICIAL_PROVIDER"
              : ad.dataConfidence === "OBSERVED"
              ? "USER_IMPORT"
              : "UNKNOWN",
        });


        const media = ad.mediaAssets[0];

        return {
          score: scoreResult,
          ad: {
            id: ad.id,
            platform: ad.platform,
            headline: ad.headline,
            bodyText: ad.bodyText,
            callToAction: ad.callToAction,
            originalAdUrl: ad.originalAdUrl,
            landingPageUrl: ad.landingPageUrl,
            status: ad.status,
            lifecycleStatus: ad.lifecycleStatus,
            longevityCategory: scoreResult.longevityCategory,
            calendarAgeDays: scoreResult.calendarAgeDays,
            ageEvidenceSource: scoreResult.ageEvidenceSource,
            category: ad.category,
            targetMarket: ad.targetMarket,
            observationCount: ad.observationCount,
            verifiedActiveCount: ad.verifiedActiveCount,
            advertiser: {
              id: ad.advertiser.id,
              name: ad.advertiser.name,
              platform: ad.advertiser.platform,
              profileUrl: ad.advertiser.profileUrl,
            },
            media: media
              ? {
                  mediaType: media.mediaType,
                  videoUrl: media.videoUrl,
                  embedUrl: media.embedUrl,
                  thumbnailUrl: media.thumbnailUrl,
                  aspectRatio: media.aspectRatio,
                  availability: media.availability,
                }
              : null,
            evergreenScore: {
              totalScore: scoreResult.totalScore,
              tier: scoreResult.tier,
              evidenceConfidence: scoreResult.evidenceConfidence,
              coverageStatus: scoreResult.coverageStatus,
              explanation: scoreResult.explanation,
            },
          },
        };
      });

    // Apply ranking
    const filters: EvergreenRankingFilters = {
      mode,
      platform: platform === "ALL" ? "ALL" : (platform as any),
      minAgeDays,
    };

    const ranked = rankEvergreenAds(
      scoredAds.map((s) => s.score),
      filters
    );

    // Map back to ad objects in ranked order
    const rankedAdIds = ranked.map((s) => s.adId);
    const adMap = new Map(scoredAds.map((s) => [s.score.adId, s.ad]));

    const rankedAds = rankedAdIds.map((id) => adMap.get(id)).filter(Boolean);

    // Unranked / INSUFFICIENT_EVIDENCE ads (appended at end)
    const insufficientIds = new Set(
      scoredAds
        .filter((s) => !s.score.eligible || s.score.tier === "INSUFFICIENT_EVIDENCE")
        .map((s) => s.score.adId)
    );
    const insufficientAds = [...insufficientIds]
      .map((id) => adMap.get(id))
      .filter(Boolean);

    const allAds = [...rankedAds, ...insufficientAds];

    // Pagination
    const total = allAds.length;
    const start = (page - 1) * pageSize;
    const pageAds = allAds.slice(start, start + pageSize);

    return NextResponse.json({
      success: true,
      mode,
      data: pageAds,
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "v7",
        researchMode: mode,
        dataNote:
          "Rankings are RESEARCH PRIORITY signals based on evidence quality and longevity. " +
          "They are NOT profitability indicators. Long-running ads are not confirmed profitable.",
        syntheticRecordsExcluded: true,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "EVERGREEN_SEARCH_FAILED",
          message: error.message,
          retryable: true,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
