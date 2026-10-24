/**
 * GET /api/v1/evergreen/ads
 *
 * Returns ranked research ads from the local database formatted as AdViewModel.
 * Excludes synthetic/quarantined records by default.
 * Supports:
 * - Research modes: EVERGREEN, EMERGING, TRENDING
 * - Platform filter: META, TIKTOK, ALL
 * - Keyword search filter: matches headline, bodyText, externalAdId, or advertiser name
 * - Category filter
 * - requestId filter: returns ONLY ads linked to that exact research run via DiscoveryRunAd
 * - Pagination
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
import { AdViewModel } from "@/types/adViewModel";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const mode = (searchParams.get("mode") || "EVERGREEN") as ResearchMode;
    const platform = searchParams.get("platform") || "ALL";
    const query = searchParams.get("query")?.trim() || "";
    const category = searchParams.get("category");
    const requestId = searchParams.get("requestId")?.trim();
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

    if (category && category !== "ALL") {
      where.category = category;
    }

    // Exact research run filter (Part 10 & 15)
    if (requestId) {
      where.runAds = {
        some: { runId: requestId },
      };
    }

    // Keyword query filtering (headline, bodyText, externalAdId, advertiser name)
    if (query) {
      where.OR = [
        { headline: { contains: query } },
        { bodyText: { contains: query } },
        { externalAdId: { contains: query } },
        { advertiser: { name: { contains: query } } },
      ];
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
        runAds: {
          where: requestId ? { runId: requestId } : undefined,
          select: { runId: true, ingestOutcome: true, libraryId: true },
        },
      },
    });

    // Compute longevity & evidence scores for each ad
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

        // Calendar age in days calculation
        let calendarAgeDays: number | null = null;
        if (scoreResult.calendarAgeDays != null && scoreResult.calendarAgeDays > 0) {
          calendarAgeDays = scoreResult.calendarAgeDays;
        } else if (ad.sourceReportedStartAt) {
          const diffMs = Date.now() - new Date(ad.sourceReportedStartAt).getTime();
          calendarAgeDays = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
        }

        const viewModel: AdViewModel = {
          id: ad.id,
          externalAdId: ad.externalAdId,
          platform: ad.platform,
          headline: ad.headline,
          bodyText: ad.bodyText,
          callToAction: ad.callToAction,
          landingPageUrl: ad.landingPageUrl,
          originalAdUrl: ad.originalAdUrl,
          status: ad.status,
          lifecycleStatus: ad.lifecycleStatus,
          category: ad.category,
          targetMarket: ad.targetMarket,
          calendarAgeDays,
          ageEvidenceSource: scoreResult.ageEvidenceSource,
          sourceReportedStartAt: ad.sourceReportedStartAt ? ad.sourceReportedStartAt.toISOString() : null,
          sourceReportedEndAt: ad.sourceReportedEndAt ? ad.sourceReportedEndAt.toISOString() : null,
          firstSeenAt: ad.firstSeenAt ? ad.firstSeenAt.toISOString() : null,
          lastSeenAt: ad.lastSeenAt ? ad.lastSeenAt.toISOString() : null,
          observationCount: ad.observationCount,
          verifiedActiveCount: ad.verifiedActiveCount,
          advertiser: {
            id: ad.advertiser?.id,
            name: ad.advertiser?.name || "Unknown Advertiser",
            externalId: ad.advertiser?.externalId,
            platform: ad.advertiser?.platform,
            profileUrl: ad.advertiser?.profileUrl,
          },
          media: media
            ? {
                mediaType: (media.mediaType as any) || "UNKNOWN",
                videoUrl: media.videoUrl,
                embedUrl: media.embedUrl,
                thumbnailUrl: media.thumbnailUrl,
                aspectRatio: media.aspectRatio || "9:16",
                availability: (media.availability as any) || "RESTRICTED",
              }
            : null,
          score: {
            totalScore: scoreResult.totalScore,
            tier: scoreResult.tier,
            evidenceConfidence: scoreResult.evidenceConfidence,
            coverageStatus: scoreResult.coverageStatus,
            explanation: scoreResult.explanation,
          },
          isSyntheticQuarantine: ad.isSyntheticQuarantine,
        };

        return {
          score: scoreResult,
          ad: viewModel,
        };
      });

    // Apply mode ranking
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

    const rankedAds = rankedAdIds.map((id) => adMap.get(id)).filter(Boolean) as AdViewModel[];

    // Unranked / INSUFFICIENT_EVIDENCE ads (appended at end)
    const insufficientIds = new Set(
      scoredAds
        .filter((s) => !s.score.eligible || s.score.tier === "INSUFFICIENT_EVIDENCE")
        .map((s) => s.score.adId)
    );
    const insufficientAds = [...insufficientIds]
      .map((id) => adMap.get(id))
      .filter(Boolean) as AdViewModel[];

    const allAds = [...rankedAds, ...insufficientAds];

    // Pagination
    const total = allAds.length;
    const start = (page - 1) * pageSize;
    const pageAds = allAds.slice(start, start + pageSize);

    return NextResponse.json({
      success: true,
      mode,
      requestId: requestId || null,
      data: pageAds,
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "v11",
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
