import { NextRequest, NextResponse } from "next/server";
import {
  searchCompetitorAds,
  upsertCompetitorAd,
  importAdvertisementForWorkspace,
} from "@/services/ads/adService";
import { resolveAdSourceUrl } from "@/services/providers/urlResolver";
import { normalizeExternalAdRecord } from "@/services/providers/registry";
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
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
      workspaceId: context.workspaceId,
    });

    return NextResponse.json({
      success: true,
      data: results.ads,
      pagination: results.pagination,
      meta: {
        timestamp: new Date().toISOString(),
        version: "v1",
        workspaceId: context.workspaceId,
        dataNote:
          "All records are user-imported or seed data. No automatic ad search performed.",
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
    const context = await resolveAuthorizedResearchContext(request);
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

    const embedUrl =
      resolution.platform === "TIKTOK" && resolution.isEmbeddable && resolution.embedUrl
        ? resolution.embedUrl
        : undefined;

    const mediaAvailability = embedUrl ? "READY" : "RESTRICTED";

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
      status: "UNKNOWN",
      dataConfidence: "OBSERVED",
      mediaType: "VIDEO",
      embedUrl,
      mediaAvailability,
      thumbnailUrl: undefined,
    });

    const savedAd = await importAdvertisementForWorkspace(
      { workspaceId: context.workspaceId },
      normalized
    );
    if (!savedAd) {
      throw new Error("Failed to retrieve saved competitor advertisement");
    }

    // Attach imported ad to caller's authorized workspace via default watchlist
    let watchlist = await prisma.watchlist.findFirst({
      where: { workspaceId: context.workspaceId, name: "Imported Ads" },
    });
    if (!watchlist) {
      watchlist = await prisma.watchlist.create({
        data: {
          workspaceId: context.workspaceId,
          name: "Imported Ads",
          description: "Default watchlist for user-imported competitor advertisements",
        },
      });
    }

    const existingItem = await prisma.watchlistItem.findFirst({
      where: {
        watchlistId: watchlist.id,
        itemType: "AD",
        adId: savedAd.id,
      },
    });

    if (!existingItem) {
      await prisma.watchlistItem.create({
        data: {
          watchlistId: watchlist.id,
          itemType: "AD",
          adId: savedAd.id,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: savedAd,
      meta: {
        timestamp: new Date().toISOString(),
        version: "v1",
        workspaceId: context.workspaceId,
        dataNote:
          "Ad imported as OBSERVED. Status is UNKNOWN until source is verified. Attached to authorized workspace.",
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
