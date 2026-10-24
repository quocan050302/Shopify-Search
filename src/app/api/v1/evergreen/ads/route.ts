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
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import {
  buildAuthorizedAdWhere,
  resolveAuthorizedDiscoveryRun,
} from "@/services/research/authorizedScopeHelpers";

export async function GET(request: NextRequest) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const { searchParams } = new URL(request.url);

    const mode = (searchParams.get("mode") || "EVERGREEN") as ResearchMode;
    const platform = searchParams.get("platform") || "ALL";
    const query = searchParams.get("query")?.trim() || "";
    const category = searchParams.get("category");
    const requestId = searchParams.get("requestId")?.trim();
    const minAgeDays = searchParams.get("minAgeDays")
      ? parseInt(searchParams.get("minAgeDays")!, 10)
      : undefined;
    const rawLaunch = searchParams.get("launchWithinDays");
    const launchWithinDays = rawLaunch
      ? parseInt(rawLaunch, 10)
      : (mode === "NEWLY_LAUNCHED" ? 30 : undefined);
    const sortBy = searchParams.get("sortBy") || (mode === "NEWLY_LAUNCHED" ? "launch_date" : "default");
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

    // Workspace-scoped exact run or general ads filtering
    if (requestId) {
      await resolveAuthorizedDiscoveryRun(requestId, context);

      where.runAds = {
        some: {
          runId: requestId,
          OR: [
            { workspaceId: context.workspaceId },
            { run: { workspaceId: context.workspaceId } },
          ],
        },
      };
    } else {
      where.AND.push(buildAuthorizedAdWhere(context.workspaceId));
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
                aspectRatio: media.aspectRatio || "1:1",
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

    let allAds: AdViewModel[] = [];
    let unknownDateCount = 0;

    if (requestId) {
      // Exact-run mode: return 100% of ads linked to this research run without 30-day cutoff or date exclusion
      allAds = scoredAds.map((q) => q.ad);
    } else if (mode === "NEWLY_LAUNCHED") {
      const days = launchWithinDays || 30;
      const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

      const qualifying: typeof scoredAds = [];

      for (const item of scoredAds) {
        if (!item.ad.sourceReportedStartAt) {
          unknownDateCount++;
          continue;
        }
        const startMs = new Date(item.ad.sourceReportedStartAt).getTime();
        if (startMs >= cutoffMs) {
          qualifying.push(item);
        }
      }

      // Sort qualifying ads
      if (sortBy === "first_seen") {
        qualifying.sort((a, b) => {
          const aMs = a.ad.firstSeenAt ? new Date(a.ad.firstSeenAt).getTime() : 0;
          const bMs = b.ad.firstSeenAt ? new Date(b.ad.firstSeenAt).getTime() : 0;
          return bMs - aMs;
        });
      } else if (sortBy === "score") {
        qualifying.sort((a, b) => (b.score.totalScore ?? 0) - (a.score.totalScore ?? 0));
      } else {
        // Default "launch_date": newest launch date first
        qualifying.sort((a, b) => {
          const aMs = new Date(a.ad.sourceReportedStartAt!).getTime();
          const bMs = new Date(b.ad.sourceReportedStartAt!).getTime();
          return bMs - aMs;
        });
      }

      allAds = qualifying.map((q) => q.ad);
    } else {
      // Apply standard mode ranking
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

      allAds = [...rankedAds, ...insufficientAds];
    }

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
        version: "v11.2",
        researchMode: mode,
        launchWithinDays: mode === "NEWLY_LAUNCHED" ? (launchWithinDays || 30) : null,
        sortBy,
        unknownDateCount,
        dataNote:
          "Rankings are RESEARCH PRIORITY signals based on evidence quality and longevity. " +
          "They are NOT profitability indicators. Long-running ads are not confirmed profitable.",
        syntheticRecordsExcluded: true,
      },
    });
  } catch (error: any) {
    if (error instanceof ResearchAuthError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            retryable: false,
            timestamp: new Date().toISOString(),
          },
        },
        { status: error.statusCode }
      );
    }
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
