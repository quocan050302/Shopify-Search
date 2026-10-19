import { NextRequest, NextResponse } from "next/server";
import { getAdvertisementDetails, findRelatedCreativeVariants } from "@/services/ads/adService";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const ad = await getAdvertisementDetails(id);

    if (!ad) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: `Ad not found with ID: ${id}` },
        },
        { status: 400 }
      );
    }

    const variants = await findRelatedCreativeVariants(id);

    return NextResponse.json({
      success: true,
      data: {
        ...ad,
        relatedVariants: variants,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "v1",
      },
    });
  } catch (error: any) {
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
