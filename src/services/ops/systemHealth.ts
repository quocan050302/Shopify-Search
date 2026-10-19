import { prisma } from "@/lib/db";
import { SystemHealthReport, OperatingMode } from "@/types";
import { verifyApplicationIsolation } from "@/lib/security";

/**
 * Returns comprehensive system diagnostics and operating mode.
 */
export async function getSystemHealth(): Promise<SystemHealthReport> {
  const isolation = verifyApplicationIsolation();
  let dbStatus: "CONNECTED" | "DISCONNECTED" = "DISCONNECTED";
  let activeProviders = 0;
  let totalAds = 0;
  let totalProducts = 0;

  try {
    const [providersCount, adsCount, productsCount] = await Promise.all([
      prisma.dataSource.count(),
      prisma.competitorAd.count(),
      prisma.researchProduct.count(),
    ]);

    dbStatus = "CONNECTED";
    activeProviders = providersCount;
    totalAds = adsCount;
    totalProducts = productsCount;
  } catch (err) {
    console.error("Health check database query error:", err);
  }

  const operatingMode = (process.env.APP_OPERATING_MODE as OperatingMode) || "RESEARCH_ONLY";
  const targetMarket = process.env.DEFAULT_TARGET_MARKET || "US";

  const isHealthy = dbStatus === "CONNECTED" && isolation.isIsolated;

  return {
    status: isHealthy ? "HEALTHY" : "DEGRADED",
    operatingMode,
    targetMarket,
    database: dbStatus,
    activeProviders,
    totalAdsObserved: totalAds,
    totalProductsIdentified: totalProducts,
    isolationVerified: isolation.isIsolated,
  };
}

/**
 * Audits stored records to verify that every metric and ad has an authentic source trail.
 */
export async function auditDataProvenance(): Promise<{
  totalAudited: number;
  validProvenanceCount: number;
  unattributedCount: number;
  classificationBreakdown: Record<string, number>;
}> {
  const ads = await prisma.competitorAd.findMany({
    select: { id: true, originalAdUrl: true, dataConfidence: true },
  });

  let valid = 0;
  let unattributed = 0;
  const breakdown: Record<string, number> = {
    VERIFIED: 0,
    OBSERVED: 0,
    ESTIMATED: 0,
    UNAVAILABLE: 0,
  };

  for (const ad of ads) {
    if (ad.originalAdUrl && ad.originalAdUrl.length > 5) {
      valid += 1;
    } else {
      unattributed += 1;
    }
    breakdown[ad.dataConfidence] = (breakdown[ad.dataConfidence] || 0) + 1;
  }

  return {
    totalAudited: ads.length,
    validProvenanceCount: valid,
    unattributedCount: unattributed,
    classificationBreakdown: breakdown,
  };
}
