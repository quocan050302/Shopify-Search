import { NextRequest, NextResponse } from "next/server";
import {
  resolveAuthorizedResearchContext,
  assertAdWorkspaceAccess,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import {
  extractProductIdentityCandidate,
  resolveOrCreateResearchProduct,
  attachAdvertisementToProduct,
  ProductIdentitySelection,
} from "@/services/research/productIdentityService";

export async function POST(request: NextRequest) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const body = await request.json();
    const { adId, selection } = body;

    if (!adId || typeof adId !== "string") {
      return NextResponse.json(
        { success: false, error: "adId is required" },
        { status: 400 }
      );
    }

    await assertAdWorkspaceAccess(adId, context);

    const candidate = await extractProductIdentityCandidate(adId, context);

    let product = null;
    let link = null;

    if (selection) {
      product = await resolveOrCreateResearchProduct(candidate, selection as ProductIdentitySelection, context);
      link = await attachAdvertisementToProduct(adId, product.productId, candidate.supportingEvidenceIds, context);
    }

    return NextResponse.json({
      success: true,
      data: {
        candidate,
        product,
        link,
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
    console.error("[Research Products From-Ad Error]:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
