/**
 * GET /api/v1/evergreen/ads/[id]
 * Returns full evergreen intelligence for a single ad.
 * Uses Next.js 16 async params pattern.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  calculateAdLongevityScore,
  explainEvergreenRanking,
} from "@/services/evergreen/evergreenScoring";
import { buildAdLifecycleTimeline } from "@/services/evergreen/longevityEngine";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const ad = await prisma.competitorAd.findUnique({
      where: { id },
      include: {
        advertiser: true,
        mediaAssets: true,
        observations: { orderBy: { observedAt: "desc" } },
        lifecycleEvents: { orderBy: { occurredAt: "asc" } },
        evergreenScores: { orderBy: { createdAt: "desc" }, take: 1 },
        researchScores: { orderBy: { createdAt: "desc" }, take: 1 },
        productLinks: {
          include: {
            product: {
              include: { priceHistory: { take: 5, orderBy: { observedAt: "desc" } } },
            },
          },
        },
        creativeVariants: true,
        analyses: { orderBy: { createdAt: "desc" }, take: 1 },
        notes: { orderBy: { createdAt: "desc" } },
        researchDecisions: { orderBy: { decidedAt: "desc" }, take: 1 },
      },
    });

    if (!ad) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Ad not found" } },
        { status: 404 }
      );
    }

    const scoreResult = calculateAdLongevityScore({
      adId: ad.id,
      platform: ad.platform,
      sourceReportedStartAt: ad.sourceReportedStartAt ?? null,
      isSyntheticQuarantine: ad.isSyntheticQuarantine,
      observations: ad.observations.map((o) => ({
        observedAt: new Date(o.observedAt),
        observationStatus: (o.observationStatus as any) ?? "UNKNOWN",
        confidence: o.confidence,
      })),
      sourceReliability:
        ad.dataConfidence === "VERIFIED" ? "OFFICIAL_PROVIDER" : "USER_IMPORT",
    });

    const timeline = buildAdLifecycleTimeline(
      ad.lifecycleEvents.map((e) => ({
        eventType: e.eventType,
        occurredAt: new Date(e.occurredAt),
        sourceTimestamp: e.sourceTimestamp ? new Date(e.sourceTimestamp) : null,
        evidenceReference: e.evidenceReference,
        confidence: e.confidence,
        notes: e.notes,
      })),
      ad.observations.map((o) => ({
        observedAt: new Date(o.observedAt),
        observationStatus: (o.observationStatus as any) ?? "UNKNOWN",
        evidenceType: o.evidenceType,
        evidenceReference: o.evidenceReference,
      }))
    );

    const rankExplanation = explainEvergreenRanking(scoreResult);

    return NextResponse.json({
      success: true,
      data: {
        id: ad.id,
        platform: ad.platform,
        externalAdId: ad.externalAdId,
        headline: ad.headline,
        bodyText: ad.bodyText,
        callToAction: ad.callToAction,
        originalAdUrl: ad.originalAdUrl,
        landingPageUrl: ad.landingPageUrl,
        status: ad.status,
        lifecycleStatus: ad.lifecycleStatus,
        category: ad.category,
        targetMarket: ad.targetMarket,
        dataConfidence: ad.dataConfidence,
        isSyntheticQuarantine: ad.isSyntheticQuarantine,
        sourceReportedStartAt: ad.sourceReportedStartAt,
        sourceReportedEndAt: ad.sourceReportedEndAt,
        lastVerifiedActiveAt: ad.lastVerifiedActiveAt,
        lastVerifiedInactiveAt: ad.lastVerifiedInactiveAt,
        firstObservedAt: ad.firstObservedAt,
        lastObservedAt: ad.lastObservedAt,
        observationCount: ad.observationCount,
        verifiedActiveCount: ad.verifiedActiveCount,
        evergreenScore: scoreResult,
        rankingExplanation: rankExplanation,
        lifecycleTimeline: timeline,
        advertiser: ad.advertiser,
        mediaAssets: ad.mediaAssets,
        productLinks: ad.productLinks,
        creativeVariants: ad.creativeVariants,
        legacyScore: ad.researchScores[0] ?? null,
        analysis: ad.analyses[0] ?? null,
        notes: ad.notes,
        researchDecision: ad.researchDecisions[0] ?? null,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "v7",
        warning:
          "Evergreen score is a RESEARCH PRIORITY signal, not a profitability indicator. " +
          "Long-running ads do not confirm profitable delivery.",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: "AD_DETAIL_FAILED", message: error.message } },
      { status: 500 }
    );
  }
}
