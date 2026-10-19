import { prisma } from "@/lib/db";
import { NormalizedAdRecord } from "@/types";
import { calculateWinningPotentialScore } from "@/services/scoring/scoringEngine";

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

  if (filters.market) {
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
      analyses: true,
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
 */
export async function upsertCompetitorAd(record: NormalizedAdRecord) {
  // Ensure default data source exists
  let dataSource = await prisma.dataSource.findFirst({
    where: { name: record.platform === "META" ? "META_AD_LIBRARY" : "TIKTOK_CREATIVE_CENTER" },
  });

  if (!dataSource) {
    dataSource = await prisma.dataSource.create({
      data: {
        name: record.platform === "META" ? "META_AD_LIBRARY" : "TIKTOK_CREATIVE_CENTER",
        displayName: record.platform === "META" ? "Meta Ad Library" : "TikTok Creative Center",
        capabilities: JSON.stringify(["DIRECT_URL_IMPORT", "VIEW_SNAPSHOT_EMBED"]),
        supportedRegions: JSON.stringify(["US"]),
      },
    });
  }

  // Upsert Advertiser
  let advertiser = await prisma.advertiser.findFirst({
    where: {
      platform: record.platform,
      name: record.advertiserName,
    },
  });

  if (!advertiser) {
    advertiser = await prisma.advertiser.create({
      data: {
        name: record.advertiserName,
        platform: record.platform,
        profileUrl: record.advertiserProfileUrl,
        domain: record.advertiserDomain,
        country: record.targetMarket || "US",
        verifiedStatus: "OBSERVED",
      },
    });
  }

  // Calculate days running
  const daysRunning = Math.max(
    1,
    Math.round(
      (new Date(record.lastSeenAt).getTime() - new Date(record.firstSeenAt).getTime()) /
        (1000 * 60 * 60 * 24)
    ) + 1
  );

  // Check if ad exists
  let existingAd = await prisma.competitorAd.findFirst({
    where: {
      OR: [
        { externalAdId: record.externalAdId },
        { originalAdUrl: record.originalAdUrl },
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
        status: record.status,
      },
    });
  } else {
    const newAd = await prisma.competitorAd.create({
      data: {
        advertiserId: advertiser.id,
        dataSourceId: dataSource.id,
        externalAdId: record.externalAdId,
        platform: record.platform,
        targetMarket: record.targetMarket || "US",
        headline: record.headline,
        bodyText: record.bodyText,
        callToAction: record.callToAction,
        landingPageUrl: record.landingPageUrl,
        originalAdUrl: record.originalAdUrl,
        firstSeenAt: record.firstSeenAt,
        lastSeenAt: record.lastSeenAt,
        daysRunning,
        status: record.status,
        category: record.category || "Other",
        dataConfidence: record.dataConfidence,
      },
    });
    adId = newAd.id;
  }

  // Media Asset
  const existingMedia = await prisma.adMediaAsset.findFirst({
    where: { adId },
  });

  if (!existingMedia) {
    await prisma.adMediaAsset.create({
      data: {
        adId,
        mediaType: record.media.mediaType,
        videoUrl: record.media.videoUrl,
        embedUrl: record.media.embedUrl,
        thumbnailUrl: record.media.thumbnailUrl,
        aspectRatio: record.media.aspectRatio || "9:16",
        durationSeconds: record.media.durationSeconds || 30,
        availability: record.media.availability || "READY",
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
    status: record.status,
    hasLandingPage: Boolean(record.landingPageUrl),
    hasCallToAction: Boolean(record.callToAction),
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
