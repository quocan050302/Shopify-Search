/**
 * GET /api/v1/evergreen/rankings
 * Returns ranked evergreen ads with scores and explanations.
 *
 * GET /api/v1/evergreen/scores/:entityId
 * Returns the evergreen score for a specific ad.
 *
 * These are unified in a single rankings route for simplicity.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { calculateAdLongevityScore, rankEvergreenAds, explainEvergreenRanking, type ResearchMode } from "@/services/evergreen/evergreenScoring";
import { isSyntheticAdId } from "@/services/video/videoSourceResolver";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = (searchParams.get("mode") || "EVERGREEN") as ResearchMode;
    const platform = searchParams.get("platform") || "ALL";
    const minAgeDays = searchParams.get("minAgeDays") ? parseInt(searchParams.get("minAgeDays")!, 10) : undefined;
    const minConfidence = searchParams.get("minConfidence") ? parseFloat(searchParams.get("minConfidence")!) : undefined;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(50, parseInt(searchParams.get("pageSize") || "20", 10));

    const where: any = {
      isSyntheticQuarantine: false,
      dataConfidence: { not: "UNAVAILABLE" },
      AND: [{ NOT: { headline: { startsWith: "[SYNTHETIC_DEMO]" } } }],
    };

    if (platform !== "ALL") where.platform = platform.toUpperCase();

    const ads = await prisma.competitorAd.findMany({
      where,
      include: {
        advertiser: true,
        mediaAssets: { take: 1 },
        observations: { orderBy: { observedAt: "desc" }, take: 100 },
      },
    });

    const scores = ads
      .filter((ad) => !isSyntheticAdId(ad.externalAdId ?? ""))
      .map((ad) =>
        calculateAdLongevityScore({
          adId: ad.id,
          platform: ad.platform,
          sourceReportedStartAt: ad.sourceReportedStartAt ?? null,
          isSyntheticQuarantine: ad.isSyntheticQuarantine,
          observations: ad.observations.map((o) => ({
            observedAt: new Date(o.observedAt),
            observationStatus: (o.observationStatus as any) ?? "UNKNOWN",
            confidence: o.confidence,
          })),
          sourceReliability: ad.dataConfidence === "VERIFIED" ? "OFFICIAL_PROVIDER" : "USER_IMPORT",
        })
      );

    const ranked = rankEvergreenAds(scores, {
      mode,
      minAgeDays,
      minEvidenceConfidence: minConfidence,
    });

    const adMap = new Map(ads.map((a) => [a.id, a]));

    const rankedWithDetails = ranked.map((score) => {
      const ad = adMap.get(score.adId);
      return {
        adId: score.adId,
        advertiserName: ad?.advertiser.name,
        platform: ad?.platform,
        headline: ad?.headline,
        tier: score.tier,
        totalScore: score.totalScore,
        calendarAgeDays: score.calendarAgeDays,
        ageEvidenceSource: score.ageEvidenceSource,
        longevityCategory: score.longevityCategory,
        coverageStatus: score.coverageStatus,
        evidenceConfidence: score.evidenceConfidence,
        explanation: explainEvergreenRanking(score),
        availableSignals: score.availableSignals,
        missingSignals: score.missingSignals,
      };
    });

    const total = rankedWithDetails.length;
    const paginated = rankedWithDetails.slice((page - 1) * pageSize, page * pageSize);

    return NextResponse.json({
      success: true,
      mode,
      data: paginated,
      pagination: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      meta: {
        timestamp: new Date().toISOString(),
        version: "v7",
        warning:
          "Rankings are RESEARCH PRIORITY signals. They do not confirm profitability, ROAS, or continuous delivery.",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: "RANKINGS_FAILED", message: error.message } },
      { status: 500 }
    );
  }
}
