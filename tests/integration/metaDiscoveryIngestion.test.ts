import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { ingestDiscoveredAds } from "@/services/discovery/discoveryIngestionService";
import { NormalizedDiscoveredAd } from "@/services/discovery/types";
import { prisma } from "@/lib/db";

describe("Meta Discovery Ingestion & DiscoveryRunAd Relational Integrity", () => {
  const testLibraryId = "889977112233";
  const testSourceUrl = `https://www.facebook.com/ads/library/?id=${testLibraryId}`;
  const testRunId1 = "test_run_meta_001";
  const testRunId2 = "test_run_meta_002";
  const workspaceId = "default-workspace";

  const sampleMetaAd: NormalizedDiscoveredAd = {
    platform: "META",
    providerId: "meta-ads-collector",
    mediaType: "IMAGE",
    sourceNamespace: "META:META-ADS-COLLECTOR",
    sourceExternalId: testLibraryId,
    stableIdentityHash: "meta_test_hash_889977112233",
    advertiserName: "Meta Test Ecom Brand",
    headline: "Viral Crystal Hair Remover - 50% Off",
    bodyText: "Get smooth skin instantly without pain or burns.",
    callToAction: "Shop Now",
    landingPageUrl: "https://metatest.example.com/remover",
    creativeUrl: testSourceUrl,
    targetMarket: "US",
    marketEvidenceType: "QUERY_FILTER",
    aspectRatio: "1:1",
    sourceReportedStartAt: new Date("2026-02-15T00:00:00Z"),
    mediaAvailability: "RESTRICTED",
    confidenceScore: 0.85,
    retrievedAt: new Date("2026-10-24T00:00:00Z"),
    reportedMetrics: {
      rawMetricsNotice: "No spend/impressions for US commercial ads",
    },
    sourceEvidence: {
      sourceUrl: testSourceUrl,
      observedAt: new Date().toISOString(),
      observationMethod: "META_COLLECTOR_PUBLIC_LIBRARY_OBSERVATION",
      verifiedLibraryId: true,
      reportedStartDate: "2026-02-15T00:00:00Z",
      reportedStatus: "ACTIVE",
    },
  };

  beforeAll(async () => {
    // Clean up any stale test records from previous runs
    await prisma.discoveryRunAd.deleteMany({
      where: { runId: { in: [testRunId1, testRunId2] } },
    });
    const staleAd = await prisma.competitorAd.findFirst({
      where: { externalAdId: testLibraryId },
    });
    if (staleAd) {
      await prisma.adSourceIdentity.deleteMany({ where: { adId: staleAd.id } });
      await prisma.adMediaAsset.deleteMany({ where: { adId: staleAd.id } });
      await prisma.evergreenScore.deleteMany({ where: { adId: staleAd.id } });
      await prisma.discoveryRunAd.deleteMany({ where: { adId: staleAd.id } });
      await prisma.competitorAd.delete({ where: { id: staleAd.id } });
    }

    // Ensure test runs exist in db
    await prisma.discoveryRun.upsert({
      where: { id: testRunId1 },
      update: {},
      create: {
        id: testRunId1,
        workspaceId,
        providerId: "meta-ads-collector",
        status: "RUNNING",
        queryConfigJson: JSON.stringify({ keywords: ["hair remover"] }),
      },
    });

    await prisma.discoveryRun.upsert({
      where: { id: testRunId2 },
      update: {},
      create: {
        id: testRunId2,
        workspaceId,
        providerId: "meta-ads-collector",
        status: "RUNNING",
        queryConfigJson: JSON.stringify({ keywords: ["hair remover v2"] }),
      },
    });
  });

  afterAll(async () => {
    try {
      // Clean up run ads
      await prisma.discoveryRunAd.deleteMany({
        where: { runId: { in: [testRunId1, testRunId2] } },
      });
      // Clean up runs
      await prisma.discoveryRun.deleteMany({
        where: { id: { in: [testRunId1, testRunId2] } },
      });
      // Clean up ad
      const ad = await prisma.competitorAd.findFirst({
        where: { externalAdId: testLibraryId },
      });
      if (ad) {
        await prisma.discoveryRunAd.deleteMany({ where: { adId: ad.id } });
        await prisma.adObservation.deleteMany({ where: { adId: ad.id } });
        await prisma.adSourceIdentity.deleteMany({ where: { adId: ad.id } });
        await prisma.adMediaAsset.deleteMany({ where: { adId: ad.id } });
        await prisma.evergreenScore.deleteMany({ where: { adId: ad.id } });
        await prisma.competitorAd.delete({ where: { id: ad.id } });
      }
    } catch (err) {
      console.warn("Cleanup warning:", err);
    }
  });

  it("ingests a new Meta ad and creates a DiscoveryRunAd association", async () => {
    const result = await ingestDiscoveredAds([sampleMetaAd], {
      workspaceId,
      providerId: "meta-ads-collector",
      discoveryRunId: testRunId1,
      runMode: "MANUAL",
    });

    expect(result.rawCount).toBe(1);
    expect(result.newUniqueCount).toBe(1);
    expect(result.existingCount).toBe(0);
    expect(result.failedCount).toBe(0);

    // Verify DiscoveryRunAd relation was persisted
    const runAd = await prisma.discoveryRunAd.findFirst({
      where: { runId: testRunId1, libraryId: testLibraryId },
    });

    expect(runAd).toBeDefined();
    expect(runAd?.ingestOutcome).toBe("NEW");
    expect(runAd?.providerId).toBe("meta-ads-collector");
    expect(runAd?.sourceUrl).toBe(testSourceUrl);

    // Verify CompetitorAd
    const ad = await prisma.competitorAd.findFirst({
      where: { externalAdId: testLibraryId },
      include: { runAds: true, sourceIdentities: true },
    });
    expect(ad).toBeDefined();
    expect(ad?.platform).toBe("META");
    expect(ad?.runAds.length).toBeGreaterThanOrEqual(1);
  });

  it("deduplicates subsequent discovery across runs and creates second DiscoveryRunAd", async () => {
    // Ingest under testRunId2
    const result = await ingestDiscoveredAds([sampleMetaAd], {
      workspaceId,
      providerId: "meta-ads-collector",
      discoveryRunId: testRunId2,
      runMode: "MANUAL",
    });

    expect(result.rawCount).toBe(1);
    expect(result.newUniqueCount).toBe(0);
    expect(result.existingCount).toBe(1);
    expect(result.failedCount).toBe(0);

    // Verify DiscoveryRunAd for run 2
    const runAd2 = await prisma.discoveryRunAd.findFirst({
      where: { runId: testRunId2, libraryId: testLibraryId },
    });

    expect(runAd2).toBeDefined();
    expect(runAd2?.ingestOutcome).toBe("EXISTING");

    // Total ads with this externalAdId remains 1 (no duplicate rows)
    const adsCount = await prisma.competitorAd.count({
      where: { externalAdId: testLibraryId },
    });
    expect(adsCount).toBe(1);
  });
});
