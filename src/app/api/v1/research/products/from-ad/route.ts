import { NextRequest, NextResponse } from "next/server";
import {
  resolveAuthorizedResearchContext,
  assertAdWorkspaceAccess,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import { z } from "zod";
import {
  extractProductIdentityCandidate,
  resolveOrCreateResearchProduct,
  attachAdvertisementToProduct,
  ProductIdentitySelection,
} from "@/services/research/productIdentityService";

const FromAdRequestSchema = z.object({
  adId: z.string().min(1, "adId is required"),
  selection: z
    .object({
      action: z.enum(["LINK_EXISTING", "CREATE_NEW"]).optional(),
      mode: z.enum(["LINK_EXISTING", "CREATE_NEW"]).optional(),
      targetProductId: z.string().optional(),
      customTitle: z.string().optional(),
      title: z.string().optional(),
      category: z.string().optional(),
      description: z.string().optional(),
    })
    .optional(),
});

export async function POST(request: NextRequest) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const json = await request.json();
    const parseResult = FromAdRequestSchema.safeParse(json);

    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request payload", details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const { adId, selection } = parseResult.data;

    await assertAdWorkspaceAccess(adId, context);

    const candidate = await extractProductIdentityCandidate(adId, context);

    let product = null;
    let link = null;

    if (selection) {
      product = await resolveOrCreateResearchProduct(
        candidate,
        selection as ProductIdentitySelection,
        context
      );
      link = await attachAdvertisementToProduct(
        adId,
        product.productId,
        candidate.supportingEvidenceIds,
        context
      );
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
