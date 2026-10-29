import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  resolveAuthorizedResearchContext,
  assertProductWorkspaceAccess,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import { getProductAdvertisingProfile } from "@/services/research/productIdentityService";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const { id: productId } = await props.params;

    await assertProductWorkspaceAccess(productId, context);

    const product = await prisma.researchProduct.findUnique({
      where: { id: productId },
      include: {
        store: true,
        adLinks: {
          include: {
            ad: {
              include: {
                mediaAssets: true,
                advertiser: true,
                observations: { take: 1, orderBy: { observedAt: "desc" } },
              },
            },
          },
        },
      },
    });

    if (!product) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    // 1. Advertising profile
    const adProfile = await getProductAdvertisingProfile(productId);

    // 2. Offer snapshots
    const offerSnapshots = await prisma.competitorOfferSnapshot.findMany({
      where: { productId },
      orderBy: { observedAt: "desc" },
      take: 10,
    });

    // 3. Landing page snapshot
    const latestLandingPage = await prisma.landingPageSnapshot.findFirst({
      where: { productId },
      orderBy: { observedAt: "desc" },
    });

    // 4. Economics scenarios
    const economicsScenarios = await prisma.productEconomicsScenario.findMany({
      where: { productId },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    // 5. Supplier quotes
    const supplierQuotes = await prisma.supplierQuote.findMany({
      where: { productId },
      orderBy: { quoteDate: "desc" },
    });

    // 6. Fulfillment assessment
    const fulfillmentAssessment = await prisma.fulfillmentAssessment.findFirst({
      where: { productId },
      orderBy: { createdAt: "desc" },
    });

    // 7. Opportunity assessment
    const opportunityAssessment = await prisma.productOpportunityAssessment.findFirst({
      where: { productId },
      orderBy: { createdAt: "desc" },
    });

    // 8. Research evidence
    const evidenceRecords = await prisma.researchEvidence.findMany({
      where: { productId },
      orderBy: { observedAt: "desc" },
      take: 50,
    });

    // 9. Research decisions
    const decisions = await prisma.researchDecision.findMany({
      where: { productId },
      orderBy: { decidedAt: "desc" },
      take: 10,
    });

    // 10. V12.4.3.2 Section 6: Lookup shared KH-02 Research Qualification context
    const requestedRunId = request.nextUrl.searchParams.get("runId");
    const requestedCandidateId = request.nextUrl.searchParams.get("candidateId");
    const recentKh02Jobs = await prisma.syncJob.findMany({
      where: {
        workspaceId: context.workspaceId,
        jobType: "KH02_RESEARCH",
        status: { in: ["COMPLETED", "PARTIALLY_COMPLETED"] },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    const orderedJobs = requestedRunId
      ? [
          ...recentKh02Jobs.filter((j) => j.id === requestedRunId),
          ...recentKh02Jobs.filter((j) => j.id !== requestedRunId),
        ]
      : recentKh02Jobs;

    let kh02ResearchContext: any = null;
    const normProdUrl = (product.productUrl || "").trim().toLowerCase().replace(/\/+$/, "");
    const normProdTitle = (product.title || "").trim().toLowerCase();

    for (const job of orderedJobs) {
      if (!job.resultJson) continue;
      let parsed: any = null;
      try {
        parsed = JSON.parse(job.resultJson);
      } catch {
        continue;
      }
      const allRanked: any[] = [
        ...(Array.isArray(parsed.topThree) ? parsed.topThree : []),
        ...(Array.isArray(parsed.provisionalCandidates) ? parsed.provisionalCandidates : []),
        ...(Array.isArray(parsed.remainingCandidates) ? parsed.remainingCandidates : []),
        ...(Array.isArray(parsed.insufficientEvidenceCandidates) ? parsed.insufficientEvidenceCandidates : []),
        ...(Array.isArray(parsed.rejectedCandidates) ? parsed.rejectedCandidates : []),
      ];

      const matchedItem = allRanked.find((item) => {
        const c = item?.candidate;
        if (!c) return false;
        if (c.researchProductId && c.researchProductId === productId) return true;
        if (requestedCandidateId && c.candidateId === requestedCandidateId) return true;
        const candUrl = (c.canonicalProductUrl || "").trim().toLowerCase().replace(/\/+$/, "");
        if (normProdUrl && candUrl && normProdUrl === candUrl) return true;
        const candTitle = (c.canonicalProductName || c.title || "").trim().toLowerCase();
        if (normProdTitle && candTitle && normProdTitle === candTitle) return true;
        return false;
      });

      if (matchedItem && matchedItem.candidate && matchedItem.score) {
        const c = matchedItem.candidate;
        const s = matchedItem.score;
        kh02ResearchContext = {
          runId: job.id,
          topic: parsed.topic || "Product Research",
          market: parsed.market || "US",
          lookbackDays: parsed.lookbackDays || 90,
          sourceMode: parsed.sourceMode || "LIVE_WITH_CACHE_FALLBACK",
          candidateId: c.candidateId,
          canonicalProductName: c.canonicalProductName || c.title,
          opportunityScore: s.opportunityScore,
          evidenceConfidence: s.evidenceConfidence,
          scoreStatus: s.scoreStatus,
          tier: s.tier || (s.scoreStatus === "VERIFIED" ? "VERIFIED_EVERGREEN" : "PROVISIONAL"),
          demandClass: s.demandClass,
          identityStatus: c.identityStatus || "VERIFIED",
          storeDomain: c.storeDomain || product.store?.domain || null,
          canonicalProductUrl: c.canonicalProductUrl || product.productUrl || null,
          supportingAdsCount: Array.isArray(c.supportingAdIds) ? c.supportingAdIds.length : ((adProfile as any)?.distinctAdsCount ?? (adProfile as any)?.totalAdsCount ?? 0),
          distinctAdvertisersCount: c.distinctAdvertisersCount ?? ((adProfile as any)?.distinctAdvertisersCount ?? (adProfile as any)?.distinctAdvertisers ?? 0),
          strengths: Array.isArray(s.strengths) ? s.strengths : [],
          risks: Array.isArray(s.risks) ? s.risks : [],
          missingEvidence: Array.isArray(s.missingEvidence) ? s.missingEvidence : [],
          recommendation: s.recommendation,
          recommendationRationale: s.recommendationRationale,
        };
        break;
      }
    }

    const commercialReadinessSummary = {
      supplierQuoteEntered: supplierQuotes.length > 0,
      landedCostCalculated: economicsScenarios.some((s: any) => Boolean(s.inputsJson || s.supplierCostPerUnit !== null)),
      shippingEstimateEntered: economicsScenarios.some((s: any) => Boolean(s.inputsJson || s.actualShippingCostPaid !== null)),
      marginModelCompleted: economicsScenarios.length > 0,
      competitorOfferInspected: offerSnapshots.length > 0 || Boolean(latestLandingPage),
      opportunityAssessed: Boolean(opportunityAssessment),
      completedCount: [
        supplierQuotes.length > 0,
        economicsScenarios.length > 0,
        offerSnapshots.length > 0 || Boolean(latestLandingPage),
        Boolean(opportunityAssessment),
      ].filter(Boolean).length,
      totalSteps: 4,
      statusLabel:
        opportunityAssessment && supplierQuotes.length > 0 && economicsScenarios.length > 0
          ? "Commercial Model Complete"
          : "Commercial Validation Needed",
    };

    return NextResponse.json({
      success: true,
      data: {
        product,
        advertisingProfile: adProfile,
        offerSnapshots,
        latestLandingPage,
        economicsScenarios,
        supplierQuotes,
        fulfillmentAssessment,
        opportunityAssessment,
        evidenceRecords,
        decisions,
        kh02ResearchContext,
        commercialReadinessSummary,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "12.4.3.2",
      },
    });
  } catch (err: any) {
    if (err instanceof ResearchAuthError) {
      return NextResponse.json(
        { success: false, error: err.message, code: err.code },
        { status: err.statusCode }
      );
    }
    console.error("[Research Product Overview Error]:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
