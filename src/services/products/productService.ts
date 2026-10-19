import { prisma } from "@/lib/db";

/**
 * Groups advertisement IDs into linked product clusters based on landing page domains or titles.
 */
export async function groupAdsByProduct(adIds: string[]): Promise<{
  groupedCount: number;
  clusters: { productId: string; productTitle: string; adCount: number }[];
}> {
  if (!adIds || adIds.length === 0) {
    return { groupedCount: 0, clusters: [] };
  }

  const ads = await prisma.competitorAd.findMany({
    where: { id: { in: adIds } },
    include: { productLinks: true },
  });

  const clustersMap = new Map<string, { title: string; count: number }>();

  for (const ad of ads) {
    if (ad.productLinks.length > 0) {
      for (const link of ad.productLinks) {
        const existing = clustersMap.get(link.productId) || { title: "Tracked Product", count: 0 };
        existing.count += 1;
        clustersMap.set(link.productId, existing);
      }
    }
  }

  const clusters = Array.from(clustersMap.entries()).map(([productId, val]) => ({
    productId,
    productTitle: val.title,
    adCount: val.count,
  }));

  return {
    groupedCount: clusters.length,
    clusters,
  };
}

/**
 * Records a verified price observation for a product.
 */
export async function recordProductPriceObservation(
  productId: string,
  price: number,
  currency: string = "USD",
  source: string = "STOREFRONT_HTTP"
) {
  return await prisma.productPriceObservation.create({
    data: {
      productId,
      price,
      currency,
      source,
      observedAt: new Date(),
    },
  });
}

/**
 * Calculates observable activity trends for a research product.
 */
export async function calculateProductResearchTrend(
  productId: string,
  periodDays: number = 30
): Promise<{
  activeAdsCount: number;
  distinctCreativesCount: number;
  priceObservationsCount: number;
  trendVelocity: "SURGING" | "STEADY" | "COOLING" | "NEW";
  summary: string;
}> {
  const cutoff = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const product = await prisma.researchProduct.findUnique({
    where: { id: productId },
    include: {
      adLinks: {
        include: {
          ad: {
            include: { mediaAssets: true },
          },
        },
      },
      priceHistory: {
        where: { observedAt: { gte: cutoff } },
      },
    },
  });

  if (!product) {
    return {
      activeAdsCount: 0,
      distinctCreativesCount: 0,
      priceObservationsCount: 0,
      trendVelocity: "NEW",
      summary: "Product not found in library",
    };
  }

  const activeAds = product.adLinks.filter((l) => l.ad.status === "ACTIVE");
  const totalCreatives = product.adLinks.reduce(
    (acc, l) => acc + (l.ad.mediaAssets?.length || 1),
    0
  );

  let trendVelocity: "SURGING" | "STEADY" | "COOLING" | "NEW" = "STEADY";
  if (activeAds.length >= 5) trendVelocity = "SURGING";
  else if (activeAds.length === 0) trendVelocity = "COOLING";
  else if (product.createdAt >= cutoff) trendVelocity = "NEW";

  return {
    activeAdsCount: activeAds.length,
    distinctCreativesCount: totalCreatives,
    priceObservationsCount: product.priceHistory.length,
    trendVelocity,
    summary: `${activeAds.length} active ads and ${totalCreatives} creative variations observed in the last ${periodDays} days.`,
  };
}
