import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");
    const query = searchParams.get("query");
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "12", 10);

    const where: any = {};
    if (category && category !== "ALL") {
      where.category = category;
    }
    if (query && query.trim().length > 0) {
      where.OR = [
        { title: { contains: query.trim() } },
        { description: { contains: query.trim() } },
        { store: { domain: { contains: query.trim() } } },
      ];
    }

    const total = await prisma.researchProduct.count({ where });

    const products = await prisma.researchProduct.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
      include: {
        store: true,
        adLinks: {
          include: {
            ad: {
              include: { mediaAssets: true, researchScores: { take: 1, orderBy: { createdAt: "desc" } } },
            },
          },
        },
        priceHistory: {
          orderBy: { observedAt: "desc" },
          take: 1,
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: products,
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
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
          code: "PRODUCTS_FETCH_FAILED",
          message: error.message || "Failed to retrieve products",
        },
      },
      { status: 500 }
    );
  }
}
