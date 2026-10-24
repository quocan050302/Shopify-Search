import { NextRequest, NextResponse } from "next/server";
import { saveAdProductCandidate, SaveProductCandidateInput } from "@/services/products/productService";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    const result = await saveAdProductCandidate({
      adId: id,
      title: body.title,
      category: body.category,
      description: body.description,
      productUrl: body.productUrl,
      storeDomain: body.storeDomain,
      observedSellingPrice: body.observedSellingPrice != null ? Number(body.observedSellingPrice) : null,
      estimatedSupplierCost: body.estimatedSupplierCost != null ? Number(body.estimatedSupplierCost) : null,
      shippingCost: body.shippingCost != null ? Number(body.shippingCost) : null,
      platformFees: body.platformFees != null ? Number(body.platformFees) : null,
      returnAllowancePercent: body.returnAllowancePercent != null ? Number(body.returnAllowancePercent) : null,
      sourceStatus: body.sourceStatus || "USER_ENTERED",
      checklist: body.checklist,
      recommendation: body.recommendation,
      notes: body.notes,
    });

    return NextResponse.json({
      success: true,
      data: result,
      meta: {
        timestamp: new Date().toISOString(),
        note: "Product research recommendation is an evidence-based assessment, not a guarantee of sales or profit.",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "CANDIDATE_SAVE_FAILED",
          message: error.message || "Failed to save product candidate",
        },
      },
      { status: 500 }
    );
  }
}
