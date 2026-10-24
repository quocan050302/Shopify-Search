import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  resolveAuthorizedResearchContext,
  assertProductWorkspaceAccess,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import { compareCompetitorOffers } from "@/services/research/offerExtractionService";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const { id: productId } = await props.params;

    await assertProductWorkspaceAccess(productId, context);

    const snapshots = await prisma.competitorOfferSnapshot.findMany({
      where: { productId },
      include: {
        store: true,
      },
      orderBy: { observedAt: "desc" },
      take: 20,
    });

    const comparison = compareCompetitorOffers(snapshots);

    return NextResponse.json({
      success: true,
      data: {
        snapshots,
        comparison,
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
    console.error("[Get Offers Error]:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
