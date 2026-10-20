import { NextRequest, NextResponse } from "next/server";
import { searchCompetitorAds, upsertCompetitorAd } from "@/services/ads/adService";
import { resolveAdSourceUrl } from "@/services/providers/urlResolver";
import { normalizeExternalAdRecord } from "@/services/providers/registry";
import { isSampleOrFakeMedia, isStockImage } from "@/services/links/linkValidationService";

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
      // Do NOT force market = US — let the user's research context set this
      // market: "US",
    });

    return NextResponse.json({
      success: true,
      data: results.ads,
      pagination: results.pagination,
      meta: {
        timestamp: new Date().toISOString(),
        version: "v1",
        dataNote:
          "All records are user-imported or seed data. No automatic ad search performed.",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SEARCH_FAILED",
          message: error.message || "Failed to search competitor ads",
          retryable: true,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      url,
      advertiserName,
      headline,
      bodyText,
      callToAction,
      landingPageUrl,
      category,
      targetMarket,
    } = body;

    if (!url) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "MISSING_URL",
            message: "Advertisement source URL is required.",
            retryable: false,
            timestamp: new Date().toISOString(),
          },
        },
        { status: 400 }
      );
    }

    const resolution = resolveAdSourceUrl(url);
    if (!resolution.isValid) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_URL",
            message: resolution.notes || "Invalid or restricted URL.",
            retryable: false,
            timestamp: new Date().toISOString(),
          },
        },
        { status: 400 }
      );
    }

    // Validate advertiser name is not a fabricated placeholder
    const validatedAdvertiserName =
      advertiserName && advertiserName.trim().length > 0
        ? advertiserName.trim()
        : "UNKNOWN";

    // Do NOT fabricate a Facebook render_ad embed — these require authentication
    // and are not public embeds
    // Support official TikTok post embeds where valid (Requirement 7)
    // Never assume TikTok Creative Center ads are embeddable (Requirement 8)
    const embedUrl =
      resolution.platform === "TIKTOK" && resolution.isEmbeddable && resolution.embedUrl
        ? resolution.embedUrl
        : undefined;

    const mediaAvailability = embedUrl ? "READY" : "RESTRICTED";

    // Respect user market or extract genuine US region from Creative Center URL (Requirement 6)
    const resolvedTargetMarket =
      targetMarket && targetMarket.trim().length > 0
        ? targetMarket.trim().toUpperCase()
        : resolution.region === "US"
        ? "US"
        : "UNKNOWN";

    const normalized = normalizeExternalAdRecord(resolution.platform, {
      platform: resolution.platform,
      externalAdId: resolution.externalId,
      advertiserName: validatedAdvertiserName,
      headline: headline || "",
      bodyText: bodyText || "",
      callToAction: callToAction || "",
      landingPageUrl: landingPageUrl || "",
      originalAdUrl: resolution.canonicalUrl,
      targetMarket: resolvedTargetMarket,
      category: category || "Other",
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      // Status remains UNKNOWN until verified active
      status: "UNKNOWN",
      dataConfidence: "OBSERVED",
      mediaType: "VIDEO",
      embedUrl,
      mediaAvailability,
      thumbnailUrl: undefined,
    });

    const savedAd = await upsertCompetitorAd(normalized);

    return NextResponse.json({
      success: true,
      data: savedAd,
      meta: {
        timestamp: new Date().toISOString(),
        version: "v1",
        dataNote:
          "Ad imported as OBSERVED. Status is UNKNOWN until source is verified. No media has been validated.",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "IMPORT_FAILED",
          message: error.message || "Failed to import advertisement",
          retryable: false,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
