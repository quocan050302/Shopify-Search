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
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "11.4.0",
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
