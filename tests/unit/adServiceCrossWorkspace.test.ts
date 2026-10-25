import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import { importAdvertisementForWorkspace, upsertCompetitorAd } from "@/services/ads/adService";
import { NormalizedAdRecord } from "@/types";

describe("Shared Ad Upsert Safety & Cross-Workspace Isolation (Section 11)", () => {
  let dbHandle: TestDatabaseHandle;
  let previousTestDbUrl: string | undefined;

  const wsAId = "ws_cross_a";
  const wsBId = "ws_cross_b";

  beforeAll(async () => {
    dbHandle = await createIsolatedTestDatabase({ prefix: "shared-ad-safety" });
    previousTestDbUrl = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = dbHandle.url;

    // Create Workspaces
    await dbHandle.prisma.workspace.createMany({
      data: [
        { id: wsAId, name: "Workspace Alpha", operatingMode: "RESEARCH_ONLY", targetMarket: "US" },
        { id: wsBId, name: "Workspace Beta", operatingMode: "RESEARCH_ONLY", targetMarket: "US" },
      ],
    });

    // Upsert DataSource
    await dbHandle.prisma.dataSource.upsert({
      where: { name: "META_AD_LIBRARY" },
      create: {
        id: "ds_cross_test",
        name: "META_AD_LIBRARY",
        displayName: "Meta Ad Library",
        capabilities: JSON.stringify(["DIRECT_URL_IMPORT"]),
        supportedRegions: JSON.stringify(["US"]),
      },
      update: {},
    });
  });

  afterAll(async () => {
    if (previousTestDbUrl !== undefined) {
      process.env.TEST_DATABASE_URL = previousTestDbUrl;
    } else {
      delete process.env.TEST_DATABASE_URL;
    }
    await dbHandle?.teardown();
  });

  const baseRecord: NormalizedAdRecord = {
    platform: "META",
    externalAdId: "meta_ad_shared_1001",
    originalAdUrl: "https://facebook.com/ads/library/?id=meta_ad_shared_1001",
    headline: "Universal Dog Harness",
    bodyText: "Comfortable ergonomic harness for all breeds",
    callToAction: "Shop Now",
    landingPageUrl: "https://shop.petcare.com/harness",
    category: "PET_SUPPLIES",
    firstSeenAt: new Date("2026-06-01T00:00:00Z"),
    lastSeenAt: new Date("2026-08-01T00:00:00Z"),
    status: "ACTIVE",
    targetMarket: "US",
    dataConfidence: "VERIFIED",
    advertiserName: "PetCare Direct",
    advertiserProfileUrl: "https://facebook.com/petcaredirect",
    media: {
      mediaType: "IMAGE",
      thumbnailUrl: "https://cdn.petcare.com/harness.jpg",
      availability: "READY",
    },
  };

  it("preserves canonical identity across separate workspace imports", async () => {
    const runAId = "run_ws_a_01";
    const runBId = "run_ws_b_01";

    await dbHandle.prisma.discoveryRun.createMany({
      data: [
        { id: runAId, workspaceId: wsAId, providerId: "meta-collector", status: "COMPLETED", queryConfigJson: "{}" },
        { id: runBId, workspaceId: wsBId, providerId: "meta-collector", status: "COMPLETED", queryConfigJson: "{}" },
      ],
    });

    // Workspace A imports ad
    const adA = await importAdvertisementForWorkspace({ workspaceId: wsAId, runId: runAId }, baseRecord);
    expect(adA).not.toBeNull();
    expect(adA?.externalAdId).toBe("meta_ad_shared_1001");
    expect(adA?.dataConfidence).toBe("VERIFIED");

    // Workspace B imports the exact same ad
    const adB = await importAdvertisementForWorkspace({ workspaceId: wsBId, runId: runBId }, baseRecord);
    expect(adB).not.toBeNull();
    expect(adB?.id).toBe(adA?.id); // Identical canonical entity

    // Verify distinct DiscoveryRunAd associations
    const relA = await dbHandle.prisma.discoveryRunAd.findUnique({
      where: { runId_adId: { runId: runAId, adId: adA!.id } },
    });
    const relB = await dbHandle.prisma.discoveryRunAd.findUnique({
      where: { runId_adId: { runId: runBId, adId: adB!.id } },
    });
    expect(relA?.workspaceId).toBe(wsAId);
    expect(relB?.workspaceId).toBe(wsBId);
  });

  it("does not downgrade VERIFIED data confidence or advance to earlier dates with weaker imports", async () => {
    const weakerRecord: NormalizedAdRecord = {
      ...baseRecord,
      dataConfidence: "OBSERVED",
      // Weaker import has an earlier lastSeenAt
      lastSeenAt: new Date("2026-07-01T00:00:00Z"),
      // Weaker import has a later firstSeenAt
      firstSeenAt: new Date("2026-06-15T00:00:00Z"),
    };

    const updated = await upsertCompetitorAd(weakerRecord);
    expect(updated?.dataConfidence).toBe("VERIFIED"); // Must NOT downgrade to OBSERVED
    // Must preserve earlier firstSeenAt (2026-06-01) and latest lastSeenAt (2026-08-01)
    expect(new Date(updated!.firstSeenAt).toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(new Date(updated!.lastSeenAt).toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("advances lastSeenAt truthfully when a newer observation arrives", async () => {
    const newerRecord: NormalizedAdRecord = {
      ...baseRecord,
      lastSeenAt: new Date("2026-09-15T00:00:00Z"),
    };

    const updated = await upsertCompetitorAd(newerRecord);
    expect(new Date(updated!.lastSeenAt).toISOString()).toBe("2026-09-15T00:00:00.000Z");
  });

  it("does not allow one workspace to mutate another workspace's research observations or runs", async () => {
    // Look up canonical ad
    const ad = await dbHandle.prisma.competitorAd.findFirst({
      where: { externalAdId: "meta_ad_shared_1001" },
    });
    expect(ad).not.toBeNull();

    // Verify Workspace A and Workspace B have isolated run relations
    const runAdsA = await dbHandle.prisma.discoveryRunAd.findMany({
      where: { adId: ad!.id, workspaceId: wsAId },
    });
    const runAdsB = await dbHandle.prisma.discoveryRunAd.findMany({
      where: { adId: ad!.id, workspaceId: wsBId },
    });
    expect(runAdsA).toHaveLength(1);
    expect(runAdsB).toHaveLength(1);

    // Workspace A deleting or updating its run does not affect Workspace B
    await dbHandle.prisma.discoveryRunAd.delete({
      where: {
        runId_adId: {
          runId: "run_ws_a_01",
          adId: ad!.id,
        },
      },
    });

    const checkRunAdsA = await dbHandle.prisma.discoveryRunAd.findMany({
      where: { adId: ad!.id, workspaceId: wsAId },
    });
    const checkRunAdsB = await dbHandle.prisma.discoveryRunAd.findMany({
      where: { adId: ad!.id, workspaceId: wsBId },
    });
    expect(checkRunAdsA).toHaveLength(0);
    expect(checkRunAdsB).toHaveLength(1); // Workspace B still intact
  });
});
