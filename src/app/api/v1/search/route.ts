import { NextRequest, NextResponse } from "next/server";
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import { prisma } from "@/lib/db";
import { searchCompetitorAds } from "@/services/ads/adService";
import { buildAuthorizedProductWhere } from "@/services/research/authorizedScopeHelpers";

export async function GET(request: NextRequest) {
  try {
    const authContext = await resolveAuthorizedResearchContext(request);
    const workspaceId = authContext.workspaceId;
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() || "";

    if (!q || q.length < 2) {
      return NextResponse.json({
        success: true,
        data: {
          ads: [],
          products: [],
        },
      });
    }

    if (q.length > 100) {
      return NextResponse.json(
        { success: false, error: "Query string too long (maximum 100 characters)" },
        { status: 400 }
      );
    }

    // Bounded search for products: strictly scoped to authorized workspace
    const productAuthScope = buildAuthorizedProductWhere(workspaceId);
    const products = await prisma.researchProduct.findMany({
      where: {
        AND: [
          productAuthScope,
          {
            OR: [
              { title: { contains: q } },
              { description: { contains: q } },
              { store: { domain: { contains: q } } },
            ],
          },
        ],
      },
      take: 5,
      orderBy: { createdAt: "desc" },
      include: {
        store: {
          select: {
            domain: true,
            storeName: true,
          },
        },
      },
    });

    // Bounded search for ads: strictly scoped to authorized workspace
    const adResults = await searchCompetitorAds({
      query: q,
      pageSize: 5,
      page: 1,
      workspaceId,
    });

    return NextResponse.json({
      success: true,
      data: {
        products: products.map((p) => ({
          id: p.id,
          title: p.title,
          category: p.category,
          domain: p.store?.domain || null,
          url: `/products/${p.id}/intelligence`,
          type: "PRODUCT" as const,
        })),
        ads: (adResults.ads || []).slice(0, 5).map((a: any) => ({
          id: a.id,
          title: a.headline || a.advertiser?.name || "Competitor Ad",
          advertiser: a.advertiser?.name || "Unknown Advertiser",
          platform: a.platform || "META",
          url: `/explorer?query=${encodeURIComponent(a.advertiser?.name || q)}`,
          type: "AD" as const,
        })),
      },
      meta: {
        query: q,
        workspaceId: authContext.workspaceId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    if (error instanceof ResearchAuthError) {
      return NextResponse.json(
        { success: false, error: error.code, message: error.message },
        { status: error.statusCode }
      );
    }
    if (error.statusCode === 401 || error.statusCode === 403 || error.status === 401 || error.status === 403) {
      const code = error.statusCode || error.status;
      return NextResponse.json(
        { success: false, error: error.message || "Unauthorized" },
        { status: code }
      );
    }
    return NextResponse.json(
      { success: false, error: error.message || "Search failed" },
      { status: 500 }
    );
  }
}
