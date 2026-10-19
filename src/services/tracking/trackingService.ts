import { prisma } from "@/lib/db";

/**
 * Creates a research watchlist.
 */
export async function createWatchlist(
  workspaceId: string,
  name: string,
  description?: string
) {
  return await prisma.watchlist.create({
    data: {
      workspaceId,
      name,
      description,
    },
  });
}

/**
 * Adds an ad or product to a research watchlist.
 */
export async function addWatchlistItem(
  watchlistId: string,
  itemType: "AD" | "PRODUCT",
  itemId: string
) {
  return await prisma.watchlistItem.create({
    data: {
      watchlistId,
      itemType,
      adId: itemType === "AD" ? itemId : undefined,
      productId: itemType === "PRODUCT" ? itemId : undefined,
    },
  });
}

/**
 * Removes an item from a watchlist.
 */
export async function removeWatchlistItem(watchlistItemId: string) {
  return await prisma.watchlistItem.delete({
    where: { id: watchlistItemId },
  });
}

/**
 * Saves a research note with tags and priority.
 */
export async function saveResearchNote(data: {
  title?: string;
  content: string;
  tags?: string;
  priority?: "HIGH" | "MEDIUM" | "LOW";
  adId?: string;
  productId?: string;
  userId?: string;
}) {
  return await prisma.researchNote.create({
    data: {
      title: data.title,
      content: data.content,
      tags: data.tags,
      priority: data.priority || "MEDIUM",
      adId: data.adId,
      productId: data.productId,
      userId: data.userId,
    },
  });
}

/**
 * Generates a source-backed research summary report.
 */
export async function generateDailyResearchReport() {
  const [totalAds, activeAds, totalProducts, totalAdvertisers, topScoreAds] =
    await Promise.all([
      prisma.competitorAd.count(),
      prisma.competitorAd.count({ where: { status: "ACTIVE" } }),
      prisma.researchProduct.count(),
      prisma.advertiser.count(),
      prisma.competitorAd.findMany({
        take: 5,
        orderBy: { daysRunning: "desc" },
        include: {
          advertiser: true,
          researchScores: { take: 1, orderBy: { createdAt: "desc" } },
        },
      }),
    ]);

  return {
    generatedAt: new Date().toISOString(),
    metrics: {
      totalAdsObserved: totalAds,
      activeAdsCurrentlyRunning: activeAds,
      productsIdentified: totalProducts,
      advertisersTracked: totalAdvertisers,
    },
    topObservedAds: topScoreAds.map((ad) => ({
      id: ad.id,
      headline: ad.headline || "Untitled Creative",
      advertiser: ad.advertiser.name,
      daysRunning: ad.daysRunning,
      platform: ad.platform,
      originalUrl: ad.originalAdUrl,
      score: ad.researchScores[0]?.totalScore || null,
      confidence: ad.dataConfidence,
    })),
  };
}

/**
 * Exports research data into CSV format with full source attribution.
 */
export async function exportResearchReport(entityType: "ads" | "products" = "ads"): Promise<string> {
  if (entityType === "ads") {
    const ads = await prisma.competitorAd.findMany({
      include: {
        advertiser: true,
        researchScores: { take: 1, orderBy: { createdAt: "desc" } },
      },
    });

    const headers = [
      "Ad_ID",
      "Platform",
      "Advertiser",
      "Headline",
      "Days_Running",
      "Status",
      "Category",
      "Research_Score",
      "Data_Confidence",
      "Original_Source_URL",
      "First_Seen",
      "Last_Seen",
    ];

    const rows = ads.map((ad) => [
      `"${ad.id}"`,
      `"${ad.platform}"`,
      `"${ad.advertiser.name.replace(/"/g, '""')}"`,
      `"${(ad.headline || "").replace(/"/g, '""')}"`,
      ad.daysRunning,
      `"${ad.status}"`,
      `"${ad.category}"`,
      ad.researchScores[0]?.totalScore ?? "N/A",
      `"${ad.dataConfidence}"`,
      `"${ad.originalAdUrl}"`,
      `"${ad.firstSeenAt.toISOString()}"`,
      `"${ad.lastSeenAt.toISOString()}"`,
    ]);

    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }

  // Products
  const products = await prisma.researchProduct.findMany({
    include: {
      store: true,
      adLinks: true,
    },
  });

  const headers = [
    "Product_ID",
    "Title",
    "Category",
    "Observed_Price",
    "Currency",
    "Store_Domain",
    "Commerce_Platform",
    "Linked_Ads_Count",
    "Product_URL",
  ];

  const rows = products.map((p) => [
    `"${p.id}"`,
    `"${p.title.replace(/"/g, '""')}"`,
    `"${p.category}"`,
    p.currentPrice ?? "N/A",
    `"${p.currency}"`,
    `"${p.store?.domain || "N/A"}"`,
    `"${p.store?.commercePlatform || "UNKNOWN"}"`,
    p.adLinks.length,
    `"${p.productUrl || ""}"`,
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}
