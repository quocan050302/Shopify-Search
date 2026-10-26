import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  resolveAuthorizedResearchContext,
  assertProductWorkspaceAccess,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import { createLandingPageResearchJob } from "@/services/research/landingPageInspectionService";

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const { id: productId } = await props.params;

    await assertProductWorkspaceAccess(productId, context);

    const body = await request.json().catch(() => ({}));
    const { landingPageUrl, forceRefresh } = body;

    // Resolve landing URL if not passed in body
    let targetUrl = landingPageUrl;
    if (!targetUrl) {
      const product = await prisma.researchProduct.findUnique({
        where: { id: productId },
        select: { productUrl: true },
      });
      targetUrl = product?.productUrl || undefined;
    }

    if (!targetUrl) {
      return NextResponse.json(
        { success: false, error: "Product does not have a landing page URL to inspect" },
        { status: 400 }
      );
    }

    const receipt = await createLandingPageResearchJob(
      {
        productId,
        targetUrl,
        forceRefresh: Boolean(forceRefresh),
      },
      context
    );

    const statusCode = receipt.status === "QUEUED" ? 202 : 200;

    return NextResponse.json(
      {
        success: true,
        data: receipt,
        meta: {
          timestamp: new Date().toISOString(),
          version: "11.4.0",
        },
      },
      { status: statusCode }
    );
  } catch (err: any) {
    if (err instanceof ResearchAuthError) {
      return NextResponse.json(
        { success: false, error: err.message, code: err.code },
        { status: err.statusCode }
      );
    }
    console.error("[Create Landing Page Job Error]:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
