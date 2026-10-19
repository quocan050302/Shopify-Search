import { prisma } from "@/lib/db";
import { NormalizedAdRecord } from "@/types";
import { calculateWinningPotentialScore } from "@/services/scoring/scoringEngine";
import { isSampleOrFakeMedia, isStockImage } from "@/services/links/linkValidationService";

export interface SearchAdsFilters {
  query?: string;
  platform?: string;
  category?: string;
  market?: string;
  minScore?: number;
  status?: string;
  page?: number;
  pageSize?: number;
  sortBy?: "newest" | "score" | "longevity" | "variants";
}

/**
 * Searches stored competitor ads backed by real observation records.
 */
export async function searchCompetitorAds(filters: SearchAdsFilters = {}) {
  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(50, Math.max(1, filters.pageSize || 12));
  const skip = (page - 1) * pageSize;

  const whereClause: any = {};

  if (filters.platform && filters.platform !== "ALL") {
    whereClause.platform = filters.platform.toUpperCase();
  }

  if (filters.category && filters.category !== "ALL") {
    whereClause.category = filters.category;
  }

  if (filters.status && filters.status !== "ALL") {
    whereClause.status = filters.status.toUpperCase();
  }

  // Only filter by market when explicitly requested — do NOT assume US
  if (filters.market && filters.market !== "ALL" && filters.market !== "UNKNOWN") {
    whereClause.targetMarket = filters.market.toUpperCase();
  }

  if (filters.query && filters.query.trim().length > 0) {
    const q = filters.query.trim();
    whereClause.OR = [
      { headline: { contains: q } },
      { bodyText: { contains: q } },
      { advertiser: { name: { contains: q } } },
      { category: { contains: q } },
    ];
  }

  // Count total matching
  const total = await prisma.competitorAd.count({ where: whereClause });

  let orderBy: any = { createdAt: "desc" };
  if (filters.sortBy === "longevity") {
    orderBy = { daysRunning: "desc" };
  } else if (filters.sortBy === "newest") {
    orderBy = { firstSeenAt: "desc" };
  }
  // Note: 'score' sort is NOT implemented in DB — not exposed as a sort option

  const ads = await prisma.competitorAd.findMany({
    where: whereClause,
    skip,
    take: pageSize,
    orderBy,
    include: {
      advertiser: true,
      mediaAssets: true,
      researchScores: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      productLinks: {
        include: { product: true },
      },
      analyses: {
        take: 1,
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return {
    ads,
    pagination: {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

/**
 * Retrieves full details for a single competitor advertisement.
 */
export async function getAdvertisementDetails(adId: string) {
  return await prisma.competitorAd.findUnique({
    where: { id: adId },
    include: {
      advertiser: true,
      mediaAssets: true,
      observations: { orderBy: { observedAt: "desc" } },
      metricObservations: { orderBy: { observedAt: "desc" } },
      researchScores: { orderBy: { createdAt: "desc" }, take: 1 },
      analyses: { orderBy: { createdAt: "desc" }, take: 1 },
      productLinks: {
        include: {
          product: {
            include: {
              priceHistory: { orderBy: { observedAt: "desc" }, take: 5 },
            },
          },
        },
      },
      notes: { orderBy: { createdAt: "desc" } },
    },
  });
}

/**
 * Upserts a normalized competitor ad record idempotently.
 * Media defaults are honest: no sample videos, no stock images.
 */
export async function upsertCompetitorAd(record: NormalizedAdRecord) {
  // Ensure default data source exists
  let dataSource = await prisma.dataSource.findFirst({
    where: {
      name:
        record.platform === "META"
          ? "META_AD_LIBRARY"
          : record.platform === "TIKTOK"
          ? "TIKTOK_CREATIVE_CENTER"
          : "USER_OBSERVED",
    },
  });

  if (!dataSource) {
    dataSource = await prisma.dataSource.create({
      data: {
        name:
          record.platform === "META"
            ? "META_AD_LIBRARY"
            : record.platform === "TIKTOK"
            ? "TIKTOK_CREATIVE_CENTER"
            : "USER_OBSERVED",
        displayName:
          record.platform === "META"
            ? "Meta Ad Library"
            : record.platform === "TIKTOK"
            ? "TikTok Creative Center"
            : "User Observed Import",
        capabilities: JSON.stringify(["DIRECT_URL_IMPORT"]),
        supportedRegions: JSON.stringify(["GLOBAL"]),
      },
    });
  }

  // Upsert Advertiser — do NOT use "Independent Merchant" as a default
  const advertiserName =
    record.advertiserName && record.advertiserName !== "UNKNOWN"
      ? record.advertiserName
      : "UNKNOWN";

  let advertiser = await prisma.advertiser.findFirst({
    where: {
      platform: record.platform,
      name: advertiserName,
    },
  });

  if (!advertiser) {
    advertiser = await prisma.advertiser.create({
      data: {
        name: advertiserName,
        platform: record.platform,
        profileUrl: record.advertiserProfileUrl,
        domain: record.advertiserDomain,
        // Do not claim a country without evidence
        country: record.targetMarket !== "UNKNOWN" ? record.targetMarket : null,
        verifiedStatus: "OBSERVED",
      },
    });
  }

  // Days running: only calculate if firstSeen !== lastSeen, else 0
  const firstSeenMs = new Date(record.firstSeenAt).getTime();
  const lastSeenMs = new Date(record.lastSeenAt).getTime();
  const daysRunning =
    lastSeenMs > firstSeenMs
      ? Math.round((lastSeenMs - firstSeenMs) / (1000 * 60 * 60 * 24)) + 1
      : 1;

  // Check if ad exists by external ID or original URL
  let existingAd = await prisma.competitorAd.findFirst({
    where: {
      OR: [
        ...(record.externalAdId ? [{ externalAdId: record.externalAdId }] : []),
        ...(record.originalAdUrl
          ? [{ originalAdUrl: record.originalAdUrl }]
          : []),
      ],
    },
  });

  let adId: string;

  if (existingAd) {
    adId = existingAd.id;
    await prisma.competitorAd.update({
      where: { id: adId },
      data: {
        lastSeenAt: record.lastSeenAt,
        daysRunning,
        // Only update status if new record has a definitive status
        ...(record.status !== "UNKNOWN" ? { status: record.status } : {}),
      },
    });
  } else {
    const newAd = await prisma.competitorAd.create({
      data: {
        advertiserId: advertiser.id,
        dataSourceId: dataSource.id,
        externalAdId: record.externalAdId,
        platform: record.platform,
        targetMarket: record.targetMarket || "UNKNOWN",
        headline: record.headline,
        bodyText: record.bodyText,
        callToAction: record.callToAction,
        landingPageUrl: record.landingPageUrl,
        originalAdUrl: record.originalAdUrl,
        firstSeenAt: record.firstSeenAt,
        lastSeenAt: record.lastSeenAt,
        daysRunning,
        status: record.status || "UNKNOWN",
        category: record.category || "Other",
        dataConfidence: record.dataConfidence || "UNVERIFIED",
      },
    });
    adId = newAd.id;
  }

  // Media Asset — validate: no sample videos, no stock images
  const existingMedia = await prisma.adMediaAsset.findFirst({
    where: { adId },
  });

  if (!existingMedia) {
    const videoUrl = isSampleOrFakeMedia(record.media.videoUrl)
      ? null // Strip sample videos
      : record.media.videoUrl || null;

    const thumbnailUrl = isStockImage(record.media.thumbnailUrl)
      ? null // Strip stock images
      : record.media.thumbnailUrl || null;

    // Strip known-invalid embed URLs (Meta render_ad and TikTok Creative Center embed)
    const embedUrl =
      record.media.embedUrl?.includes("facebook.com/ads/archive/render_ad") ||
      record.media.embedUrl?.includes(
        "creativecenter/inspiration/topads/embed/"
      )
        ? null
        : record.media.embedUrl || null;

    await prisma.adMediaAsset.create({
      data: {
        adId,
        mediaType: record.media.mediaType,
        videoUrl,
        embedUrl,
        thumbnailUrl,
        aspectRatio: record.media.aspectRatio || "9:16",
        // Do NOT default duration to 30 — leave null if unknown
        durationSeconds: record.media.durationSeconds ?? null,
        // Only mark READY if we have a real, non-sample video URL
        availability:
          videoUrl && !isSampleOrFakeMedia(videoUrl)
            ? "READY"
            : "FALLBACK_ONLY",
      },
    });
  }

  // Observation log
  await prisma.adObservation.create({
    data: {
      adId,
      observedAt: new Date(),
      isActive: record.status === "ACTIVE",
      evidenceType: "USER_OBSERVED",
    },
  });

  // Calculate and store Research Score
  const scoreResult = calculateWinningPotentialScore({
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    variantCount: 1,
    status: record.status as "ACTIVE" | "INACTIVE" | "UNKNOWN",
    hasLandingPage: Boolean(record.landingPageUrl),
    hasCallToAction: Boolean(record.callToAction),
    // aiQualityScore intentionally omitted — no AI analysis performed at import time
  });

  await prisma.researchScore.create({
    data: {
      adId,
      totalScore: scoreResult.totalScore,
      tier: scoreResult.tier,
      longevityScore: scoreResult.components.longevity.score,
      diversityScore: scoreResult.components.diversity.score,
      performanceScore: scoreResult.components.performance.score,
      recencyScore: scoreResult.components.recency.score,
      clarityScore: scoreResult.components.clarity.score,
      aiQualityScore: scoreResult.components.aiQuality.score,
      confidenceScore: scoreResult.confidenceScore,
      formulaVersion: scoreResult.formulaVersion,
      scoreBreakdown: JSON.stringify(scoreResult),
    },
  });

  return await getAdvertisementDetails(adId);
}

/**
 * Discovers real related creative variants by the same advertiser.
 */
export async function findRelatedCreativeVariants(adId: string) {
  const currentAd = await prisma.competitorAd.findUnique({
    where: { id: adId },
    select: { advertiserId: true },
  });

  if (!currentAd) return [];

  return await prisma.competitorAd.findMany({
    where: {
      advertiserId: currentAd.advertiserId,
      id: { not: adId },
    },
    include: {
      mediaAssets: true,
      researchScores: { take: 1, orderBy: { createdAt: "desc" } },
    },
    take: 8,
  });
}

/**
 * Audit existing records for data integrity issues.
 * Returns structured report without modifying any data.
 */
export async function auditResearchDataIntegrity(): Promise<{
  totalAudited: number;
  issues: {
    adId: string;
    advertiserName: string;
    issues: string[];
    severity: "HIGH" | "MEDIUM" | "LOW";
  }[];
  summary: {
    hasSampleMedia: number;
    hasStockThumbnail: number;
    hasFakeEmbed: number;
    hasUnverifiedStatus: number;
    hasUnknownAdvertiser: number;
    hasMissingSource: number;
  };
}> {
  const ads = await prisma.competitorAd.findMany({
    include: { advertiser: true, mediaAssets: true },
  });

  const issues: {
    adId: string;
    advertiserName: string;
    issues: string[];
    severity: "HIGH" | "MEDIUM" | "LOW";
  }[] = [];

  const summary = {
    hasSampleMedia: 0,
    hasStockThumbnail: 0,
    hasFakeEmbed: 0,
    hasUnverifiedStatus: 0,
    hasUnknownAdvertiser: 0,
    hasMissingSource: 0,
  };

  for (const ad of ads) {
    const adIssues: string[] = [];
    const media = ad.mediaAssets?.[0];

    if (isSampleOrFakeMedia(media?.videoUrl)) {
      adIssues.push("VIDEO_URL_IS_SAMPLE_MEDIA: Google GTV sample video");
      summary.hasSampleMedia++;
    }

    if (isStockImage(media?.thumbnailUrl)) {
      adIssues.push("THUMBNAIL_IS_STOCK_IMAGE: Unsplash/Pexels stock photo");
      summary.hasStockThumbnail++;
    }

    if (
      media?.embedUrl?.includes("facebook.com/ads/archive/render_ad") ||
      media?.embedUrl?.includes("creativecenter/inspiration/topads/embed/")
    ) {
      adIssues.push("EMBED_URL_IS_INVALID: Not a public embed endpoint");
      summary.hasFakeEmbed++;
    }

    if (ad.status === "ACTIVE" && ad.dataConfidence === "VERIFIED") {
      adIssues.push(
        "UNVERIFIED_ACTIVE_STATUS: Marked ACTIVE/VERIFIED without live evidence"
      );
      summary.hasUnverifiedStatus++;
    }

    if (
      ad.advertiser?.name === "UNKNOWN" ||
      ad.advertiser?.name === "Independent Merchant"
    ) {
      adIssues.push(
        "UNKNOWN_ADVERTISER: Advertiser could not be identified from source"
      );
      summary.hasUnknownAdvertiser++;
    }

    if (!ad.originalAdUrl || ad.originalAdUrl.length < 5) {
      adIssues.push("MISSING_SOURCE_URL: No verifiable original ad URL");
      summary.hasMissingSource++;
    }

    if (adIssues.length > 0) {
      issues.push({
        adId: ad.id,
        advertiserName: ad.advertiser?.name || "UNKNOWN",
        issues: adIssues,
        severity:
          adIssues.some(
            (i) =>
              i.includes("SAMPLE_MEDIA") ||
              i.includes("STOCK_IMAGE") ||
              i.includes("EMBED_URL_IS_INVALID")
          )
            ? "HIGH"
            : "MEDIUM",
      });
    }
  }

  return {
    totalAudited: ads.length,
    issues,
    summary,
  };
}
