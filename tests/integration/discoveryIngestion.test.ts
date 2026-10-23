import { describe, it, expect, afterAll } from "vitest";
import { ingestDiscoveredAds } from "@/services/discovery/discoveryIngestionService";
import { NormalizedDiscoveredAd } from "@/services/discovery/types";
import { prisma } from "@/lib/db";

describe("Discovery Ingestion Pipeline & Transactional Integrity", () => {
  const testMaterialId = "9876543210123456789";
  const testSourceUrl = `https://ads.tiktok.com/business/creativecenter/topads/${testMaterialId}/pc/en`;

  const sampleAd: NormalizedDiscoveredAd = {
    platform: "TIKTOK",
    providerId: "tiktok-topads",
    mediaType: "VIDEO",
    sourceNamespace: "TIKTOK:TIKTOK-TOPADS",
    sourceExternalId: testMaterialId,
    stableIdentityHash: "test_stable_hash_9876543210123456789",
    advertiserName: "Integration Test Brand",
    headline: "Best tested organic serum for daily use",
    industry: "BEAUTY_PERSONAL_CARE",
    objective: "CONVERSIONS",
    landingPageUrl: "https://integrationbrand.example.com/serum",
    creativeUrl: testSourceUrl,
    targetMarket: "US",
    marketEvidenceType: "CONFIRMED_DELIVERY",
    sourceReportedStartAt: new Date("2026-09-01T00:00:00Z"),
    sourceReportedEndAt: new Date("2026-10-15T00:00:00Z"),
    reportedMetrics: {
      likes: 8500,
      comments: 110,
      shares: 420,
    },
    mediaAvailability: "RESTRICTED",
    aspectRatio: "9:16",
    confidenceScore: 0.9,
    retrievedAt: new Date("2026-10-20T10:00:00Z"),
  };

  afterAll(async () => {
    // Cleanup test ad data safely
    try {
      const ad = await prisma.competitorAd.findFirst({
        where: { externalAdId: testMaterialId },
      });
      if (ad) {
        await prisma.adMetricObservation.deleteMany({ where: { adId: ad.id } });
        await prisma.adObservation.deleteMany({ where: { adId: ad.id } });
        await prisma.adLifecycleEvent.deleteMany({ where: { adId: ad.id } });
        await prisma.adSourceIdentity.deleteMany({ where: { adId: ad.id } });
        await prisma.adMediaAsset.deleteMany({ where: { adId: ad.id } });
        await prisma.evergreenScore.deleteMany({ where: { adId: ad.id } });
        await prisma.competitorAd.delete({ where: { id: ad.id } });
      }
    } catch (err) {
      console.warn("Cleanup warning:", err);
    }
  });

  it("ingests a new normalized ad atomically into database with stable identity", async () => {
    const result = await ingestDiscoveredAds([sampleAd], {
      workspaceId: "ws_default",
      providerId: "tiktok-topads",
      runMode: "MANUAL",
    });

    expect(result.rawCount).toBe(1);
    expect(result.newUniqueCount).toBe(1);
    expect(result.existingCount).toBe(0);
    expect(result.failedCount).toBe(0);

    // Verify database record
    const ad = await prisma.competitorAd.findFirst({
      where: { externalAdId: testMaterialId },
      include: {
        advertiser: true,
        sourceIdentities: true,
        mediaAssets: true,
        observations: true,
        metricObservations: true,
      },
    });

    expect(ad).toBeDefined();
    expect(ad?.platform).toBe("TIKTOK");
    expect(ad?.advertiser.name).toBe("Integration Test Brand");
    expect(ad?.sourceIdentities.length).toBeGreaterThanOrEqual(1);
    expect(ad?.sourceIdentities[0].providerId).toBe("tiktok-topads");
    expect(ad?.observations.length).toBeGreaterThanOrEqual(1);
  });

  it("deduplicates subsequent discoveries and preserves initial observation", async () => {
    // Second ingestion with updated likes
    const updatedAd: NormalizedDiscoveredAd = {
      ...sampleAd,
      reportedMetrics: {
        ...sampleAd.reportedMetrics,
        likes: 9200,
      },
      retrievedAt: new Date("2026-10-21T10:00:00Z"),
    };

    const result = await ingestDiscoveredAds([updatedAd], {
      workspaceId: "ws_default",
      providerId: "tiktok-topads",
      runMode: "MANUAL",
    });

    expect(result.rawCount).toBe(1);
    expect(result.newUniqueCount).toBe(0);
    expect(result.existingCount).toBe(1);

    // Ensure ad record was not duplicated
    const count = await prisma.competitorAd.count({
      where: { externalAdId: testMaterialId },
    });
    expect(count).toBe(1);

    // Ensure sourceReportedStartAt is preserved
    const ad = await prisma.competitorAd.findFirst({
      where: { externalAdId: testMaterialId },
    });
    expect(ad?.sourceReportedStartAt).toEqual(new Date("2026-09-01T00:00:00Z"));
  });

  it("handles DRY_RUN mode without modifying the database", async () => {
    const dryRunMaterialId = "8887776665554443321";
    const dryRunAd: NormalizedDiscoveredAd = {
      ...sampleAd,
      sourceExternalId: dryRunMaterialId,
      stableIdentityHash: "dry_run_hash_8887776665554443321",
      creativeUrl: `https://ads.tiktok.com/business/creativecenter/topads/${dryRunMaterialId}/pc/en`,
    };

    const result = await ingestDiscoveredAds([dryRunAd], {
      workspaceId: "ws_default",
      providerId: "tiktok-topads",
      runMode: "DRY_RUN",
    });

    expect(result.rawCount).toBe(1);
    expect(result.newUniqueCount).toBe(1);

    // Verify it was NOT persisted to DB
    const found = await prisma.competitorAd.findFirst({
      where: { externalAdId: dryRunMaterialId },
    });
    expect(found).toBeNull();
  });
});
