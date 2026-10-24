import { NextRequest, NextResponse } from "next/server";
import { getAdvertisementDetailViewModel } from "@/services/ads/adService";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
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
        version: "v11.3",
        contract: "AdDetailViewModel",
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

