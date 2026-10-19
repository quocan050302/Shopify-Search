import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { calculateProductResearchTrend } from "@/services/products/productService";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    const product = await prisma.researchProduct.findUnique({
      where: { id },
      include: {
        store: true,
        priceHistory: {
          orderBy: { observedAt: "asc" },
        },
        adLinks: {
          include: {
            ad: {
              include: {
                advertiser: true,
                mediaAssets: true,
                researchScores: { take: 1, orderBy: { createdAt: "desc" } },
              },
            },
          },
        },
      },
    });

    if (!product) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: `Product not found with ID: ${id}` },
        },
        { status: 404 }
      );
    }

    const trend = await calculateProductResearchTrend(id);

    return NextResponse.json({
      success: true,
      data: {
        ...product,
        trend,
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
          code: "PRODUCT_RETRIEVAL_FAILED",
          message: error.message || "Failed to retrieve product details",
        },
      },
      { status: 500 }
    );
  }
}
