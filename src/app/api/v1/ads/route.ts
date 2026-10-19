import { NextRequest, NextResponse } from "next/server";
import { searchCompetitorAds, upsertCompetitorAd } from "@/services/ads/adService";
import { resolveAdSourceUrl } from "@/services/providers/urlResolver";
import { normalizeExternalAdRecord } from "@/services/providers/registry";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const query = searchParams.get("query") || undefined;
    const platform = searchParams.get("platform") || undefined;
    const category = searchParams.get("category") || undefined;
    const status = searchParams.get("status") || undefined;
    const sortBy = (searchParams.get("sortBy") as any) || "newest";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "12", 10);

    const results = await searchCompetitorAds({
      query,
      platform,
      category,
      status,
      sortBy,
      page,
      pageSize,
      market: "US",
    });

    return NextResponse.json({
      success: true,
      data: results.ads,
      pagination: results.pagination,
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
          code: "SEARCH_FAILED",
          message: error.message || "Failed to search competitor ads",
        },
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, advertiserName, headline, bodyText, landingPageUrl, category, price } = body;

    if (!url) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "MISSING_URL", message: "Advertisement URL is required." },
        },
        { status: 400 }
      );
    }

    const resolution = resolveAdSourceUrl(url);
    if (!resolution.isValid) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "INVALID_URL", message: resolution.notes || "Invalid or restricted URL." },
        },
        { status: 400 }
      );
    }

    const normalized = normalizeExternalAdRecord(resolution.platform, {
      platform: resolution.platform,
      externalAdId: resolution.externalId,
      advertiserName: advertiserName || (resolution.platform === "META" ? "Meta Advertiser" : "TikTok Merchant"),
      headline: headline || "Observed Video Advertisement",
      bodyText: bodyText || "",
      landingPageUrl: landingPageUrl || "",
      originalAdUrl: resolution.canonicalUrl,
      targetMarket: "US",
      category: category || "Other",
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      status: "ACTIVE",
      dataConfidence: "OBSERVED",
      mediaType: "VIDEO",
      embedUrl: resolution.platform === "META"
        ? `https://www.facebook.com/ads/archive/render_ad/?id=${resolution.externalId || ""}`
        : resolution.canonicalUrl,
      thumbnailUrl: "https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=800&auto=format&fit=crop&q=80",
    });

    const savedAd = await upsertCompetitorAd(normalized);

    return NextResponse.json({
      success: true,
      data: savedAd,
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
          code: "IMPORT_FAILED",
          message: error.message || "Failed to import advertisement",
        },
      },
      { status: 500 }
    );
  }
}
