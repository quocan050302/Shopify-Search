import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import { verifyLivePersistence, LiveWorkerExecutionResult } from "../../scripts/kh01/runFullAcceptance";

describe("KH-01 Persistence Readback (Part 05, FIX-02, Invariant 2)", () => {
  let testDb: TestDatabaseHandle;
  const workspaceId = "ws_test_persistence";

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase({ prefix: "kh01-persist-test" });
    await testDb.prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "Persistence Test Workspace",
        operatingMode: "RESEARCH_ONLY",
        targetMarket: "US",
      },
    });
    await testDb.prisma.discoveryRun.deleteMany({});
    await testDb.prisma.syncJob.deleteMany({});

    await testDb.prisma.dataSource.create({
      data: {
        id: "ds_test",
        name: "meta-ads-collector",
        displayName: "Meta Ads Collector",
        capabilities: JSON.stringify(["KEYWORD_SEARCH"]),
        supportedRegions: JSON.stringify(["US"]),
      },
    });
  });

  afterEach(async () => {
    await testDb.teardown();
  });

  it("verifies authentic persisted run, linked ads, and exact counts (read-only)", async () => {
    // 1. Create a completed run in SQLite
    const run = await testDb.prisma.discoveryRun.create({
      data: {
        workspaceId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: JSON.stringify({ keywords: ["shoes"] }),
        actualRetrievedCount: 2,
        validCount: 2,
      },
    });

    // 2. Create advertiser and competitor ads
    const adv = await testDb.prisma.advertiser.create({
      data: {
        id: "adv_test_persist_01",
        name: "Shoe Co",
        domain: "shoeco.com",
        platform: "META",
      },
    });

    const ad1 = await testDb.prisma.competitorAd.create({
      data: {
        id: "ad_persist_001",
        advertiserId: adv.id,
        dataSourceId: "ds_test",
        platform: "META",
        externalAdId: "meta_ad_001",
        originalAdUrl: "https://www.facebook.com/ads/library/?id=meta_ad_001",
        headline: "Running Shoe 1",
        bodyText: "High performance running shoe",
        callToAction: "Shop Now",
        status: "ACTIVE",
        targetMarket: "US",
        dataConfidence: "VERIFIED",
      },
    });

    const ad2 = await testDb.prisma.competitorAd.create({
      data: {
        id: "ad_persist_002",
        advertiserId: adv.id,
        dataSourceId: "ds_test",
        platform: "META",
        externalAdId: "meta_ad_002",
        originalAdUrl: "https://www.facebook.com/ads/library/?id=meta_ad_002",
        headline: "Running Shoe 2",
        bodyText: "High performance running shoe 2",
        callToAction: "Shop Now",
        status: "ACTIVE",
        targetMarket: "US",
        dataConfidence: "VERIFIED",
      },
    });

    // 3. Create run relations
    await testDb.prisma.discoveryRunAd.create({
      data: {
        runId: run.id,
        adId: ad1.id,
        workspaceId,
        providerId: "meta-ads-collector",
        sourceUrl: "https://www.facebook.com/ads/library/?id=meta_ad_001",
        ingestOutcome: "NEW",
      },
    });
    await testDb.prisma.discoveryRunAd.create({
      data: {
        runId: run.id,
        adId: ad2.id,
        workspaceId,
        providerId: "meta-ads-collector",
        sourceUrl: "https://www.facebook.com/ads/library/?id=meta_ad_002",
        ingestOutcome: "NEW",
      },
    });

    const workerResult: LiveWorkerExecutionResult = {
      success: true,
      runId: run.id,
      workerId: "test-worker",
      initialStatus: "PENDING",
      finalStatus: "COMPLETED",
      claimedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      retrievedCount: 2,
      validCount: 2,
      evidenceReferences: ["Simulated execution"],
    };

    const context = {
      workspaceId,
      liveDbHandle: testDb,
      databaseUrl: testDb.url,
      startedAt: new Date().toISOString(),
      cleanup: async () => {},
    };

    // Record pre-verification counts to prove read-only behavior
    const preRunCount = await testDb.prisma.discoveryRun.count();
    const preAdCount = await testDb.prisma.competitorAd.count();
    const preRelationCount = await testDb.prisma.discoveryRunAd.count();

    const evidence = await verifyLivePersistence(context as any, workerResult);

    expect(evidence.status).toBe("PASSED");
    expect(evidence.runId).toBe(run.id);
    expect(evidence.workspaceId).toBe(workspaceId);
    expect(evidence.linkedAdIds).toEqual([ad1.id, ad2.id]);
    expect(evidence.retrievedCount).toBe(2);
    expect(evidence.validCount).toBe(2);
    expect(evidence.linkedCount).toBe(2);
    expect(evidence.missingReferences).toHaveLength(0);
    expect(evidence.evidenceOrigin).toBe("ACTUAL_DATABASE_QUERY");

    // Strictly Read-Only Assertion: Database counts are 100% unchanged
    const postRunCount = await testDb.prisma.discoveryRun.count();
    const postAdCount = await testDb.prisma.competitorAd.count();
    const postRelationCount = await testDb.prisma.discoveryRunAd.count();

    expect(postRunCount).toBe(preRunCount);
    expect(postAdCount).toBe(preAdCount);
    expect(postRelationCount).toBe(preRelationCount);
  });

  it("fails when runId is missing from worker result", async () => {
    const context = {
      workspaceId,
      liveDbHandle: testDb,
      databaseUrl: testDb.url,
      startedAt: new Date().toISOString(),
      cleanup: async () => {},
    };

    const evidence = await verifyLivePersistence(context as any, {
      success: false,
      runId: null,
      workerId: null,
      initialStatus: null,
      finalStatus: null,
      claimedAt: null,
      completedAt: null,
      retrievedCount: 0,
      validCount: 0,
      evidenceReferences: [],
    });

    expect(evidence.status).toBe("FAILED");
    expect(evidence.error).toContain("No runId provided");
  });

  it("fails when run does not exist in isolated database", async () => {
    const context = {
      workspaceId,
      liveDbHandle: testDb,
      databaseUrl: testDb.url,
      startedAt: new Date().toISOString(),
      cleanup: async () => {},
    };

    const evidence = await verifyLivePersistence(context as any, {
      success: true,
      runId: "non_existent_run_id",
      workerId: "worker_1",
      initialStatus: "PENDING",
      finalStatus: "COMPLETED",
      claimedAt: null,
      completedAt: null,
      retrievedCount: 1,
      validCount: 1,
      evidenceReferences: [],
    });

    expect(evidence.status).toBe("FAILED");
    expect(evidence.error).toContain("not found in database");
  });

  it("fails when run belongs to a foreign workspace (isolation breach)", async () => {
    const run = await testDb.prisma.discoveryRun.create({
      data: {
        workspaceId: "ws_foreign_attacker",
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: "{}",
      },
    });

    const context = {
      workspaceId,
      liveDbHandle: testDb,
      databaseUrl: testDb.url,
      startedAt: new Date().toISOString(),
      cleanup: async () => {},
    };

    const evidence = await verifyLivePersistence(context as any, {
      success: true,
      runId: run.id,
      workerId: "worker_1",
      initialStatus: "PENDING",
      finalStatus: "COMPLETED",
      claimedAt: null,
      completedAt: null,
      retrievedCount: 0,
      validCount: 0,
      evidenceReferences: [],
    });

    expect(evidence.status).toBe("FAILED");
    expect(evidence.error).toContain("Workspace isolation boundary violation");
  });

  it("fails when run contains orphan relations (missing competitorAd rows)", async () => {
    const run = await testDb.prisma.discoveryRun.create({
      data: {
        workspaceId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: "{}",
        validCount: 1,
      },
    });

    // Directly insert orphan relation with non-existent adId by disabling FKs temporarily
    await testDb.prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF;");
    await testDb.prisma.discoveryRunAd.create({
      data: {
        runId: run.id,
        adId: "orphan_ad_id_999",
        workspaceId,
        providerId: "meta-ads-collector",
        sourceUrl: "https://facebook.com/ads/orphan",
        ingestOutcome: "NEW",
      },
    });
    await testDb.prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON;");

    const context = {
      workspaceId,
      liveDbHandle: testDb,
      databaseUrl: testDb.url,
      startedAt: new Date().toISOString(),
      cleanup: async () => {},
    };

    const evidence = await verifyLivePersistence(context as any, {
      success: true,
      runId: run.id,
      workerId: "worker_1",
      initialStatus: "PENDING",
      finalStatus: "COMPLETED",
      claimedAt: null,
      completedAt: null,
      retrievedCount: 1,
      validCount: 1,
      evidenceReferences: [],
    });

    expect(evidence.status).toBe("FAILED");
    expect(evidence.missingReferences.some((r) => r.includes("Orphan link"))).toBe(true);
  });

  it("fails when run has 0 linked ads despite claiming success", async () => {
    const run = await testDb.prisma.discoveryRun.create({
      data: {
        workspaceId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: "{}",
        actualRetrievedCount: 5,
        validCount: 0,
      },
    });

    const context = {
      workspaceId,
      liveDbHandle: testDb,
      databaseUrl: testDb.url,
      startedAt: new Date().toISOString(),
      cleanup: async () => {},
    };

    const evidence = await verifyLivePersistence(context as any, {
      success: true,
      runId: run.id,
      workerId: "worker_1",
      initialStatus: "PENDING",
      finalStatus: "COMPLETED",
      claimedAt: null,
      completedAt: null,
      retrievedCount: 5,
      validCount: 0,
      evidenceReferences: [],
    });

    expect(evidence.status).toBe("FAILED");
    expect(evidence.linkedCount).toBe(0);
  });
});
