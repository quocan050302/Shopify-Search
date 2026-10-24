import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AdViewModel } from "@/types/adViewModel";
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";

/**
 * GET /api/v1/discovery/meta/requests/:id/ads
 * Returns ONLY the advertisements linked to that exact research run via DiscoveryRunAd,
 * scoped strictly to the authorized workspace.
 * Excludes unrelated seed, test, or other-run records.
 */
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const { id } = await props.params;
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));

    const run = await prisma.discoveryRun.findUnique({
      where: { id },
      select: { id: true, workspaceId: true, providerId: true, status: true },
    });

    if (!run) {
      return NextResponse.json(
        { success: false, error: "NOT_FOUND", message: `Discovery run '${id}' not found.` },
        { status: 404 }
      );
    }

    if (run.workspaceId !== context.workspaceId) {
      return NextResponse.json(
        {
          success: false,
          error: "FORBIDDEN",
          message: `Access denied: Discovery run '${id}' belongs to another workspace.`,
        },
        { status: 403 }
      );
    }

    const [total, runAdRelations] = await Promise.all([
      prisma.discoveryRunAd.count({ where: { runId: id } }),
      prisma.discoveryRunAd.findMany({
        where: { runId: id },
        orderBy: { observedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          ad: {
            include: {
              advertiser: true,
              mediaAssets: true,
              evergreenScores: {
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          },
        },
      }),
    ]);

    const ads: AdViewModel[] = runAdRelations.map((rel) => {
      const ad = rel.ad;
      const media = ad.mediaAssets[0];
      const score = ad.evergreenScores[0];

      return {
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
        calendarAgeDays: ad.daysRunning,
        ageEvidenceSource: ad.sourceReportedStartAt ? "SOURCE_REPORTED" : "OBSERVED",
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
        score: score
          ? {
              totalScore: score.totalScore,
              tier: score.tier,
              evidenceConfidence: score.evidenceConfidence,
              coverageStatus: score.coverageStatus,
              explanation: score.explanation,
            }
          : null,
        isSyntheticQuarantine: ad.isSyntheticQuarantine,
      };
    });

    return NextResponse.json({
      success: true,
      runId: id,
      data: ads,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err: unknown) {
    if (err instanceof ResearchAuthError) {
      return NextResponse.json(
        { success: false, error: err.code, message: err.message },
        { status: err.statusCode }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: "FAILED_TO_LOAD_RUN_ADS", message: msg },
      { status: 500 }
    );
  }
}
