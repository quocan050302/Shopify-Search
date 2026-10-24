import { NextRequest, NextResponse } from "next/server";
import { getAdvertisementDetailViewModel } from "@/services/ads/adService";
import {
  resolveAuthorizedResearchContext,
  assertAdWorkspaceAccess,
  ResearchAuthError,
} from "@/services/research/researchAuthService";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const researchContext = await resolveAuthorizedResearchContext(request);
    const { id } = await context.params;

    // Enforce workspace authorization check
    await assertAdWorkspaceAccess(id, researchContext);

    const detail = await getAdvertisementDetailViewModel(id);

    if (!detail) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: `Ad not found with ID: ${id}` },
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: detail,
      meta: {
        timestamp: new Date().toISOString(),
        version: "v11.5.2",
        workspaceId: researchContext.workspaceId,
        contract: "AdDetailViewModel",
      },
    });
  } catch (error: any) {
    if (error instanceof ResearchAuthError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            statusCode: error.statusCode,
          },
        },
        { status: error.statusCode }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RETRIEVAL_FAILED",
          message: error.message || "Failed to retrieve ad details",
        },
      },
      { status: 500 }
    );
  }
}
