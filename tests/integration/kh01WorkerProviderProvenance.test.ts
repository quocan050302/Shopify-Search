import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  captureWorkerProviderProvenance,
  assertNoMockSourceForLiveAcceptance,
  executeLiveResearchThroughWorker,
} from "../../scripts/kh01/runFullAcceptance";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";

describe("KH-01 Worker Provider Provenance (FINAL-08-02)", () => {
  let testDb: TestDatabaseHandle;
  const workspaceId = "ws_worker_prov_test";

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase({ prefix: "worker-prov" });
    await testDb.prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "Worker Provenance Workspace",
        operatingMode: "RESEARCH_ONLY",
        targetMarket: "US",
      },
    });

    await testDb.prisma.dataSource.create({
      data: {
        id: "ds_meta_collector",
        name: "meta-ads-collector",
        displayName: "Meta Ads Collector",
        capabilities: JSON.stringify(["KEYWORD_SEARCH"]),
        supportedRegions: JSON.stringify(["US"]),
      },
    });

    await testDb.prisma.discoveryRun.deleteMany({});
    await testDb.prisma.syncJob.deleteMany({});

    process.env.TEST_DATABASE_URL = testDb.url;
    process.env.SWAI_DB_ROLE = "LIVE_ACCEPTANCE";
    process.env.SWAI_TEST_ISOLATION = "strict";
  });

  afterEach(async () => {
    delete process.env.SWAI_MOCK_META_BOUNDARY;
    delete process.env.TEST_DATABASE_URL;
    delete process.env.SWAI_DB_ROLE;
    delete process.env.SWAI_TEST_ISOLATION;
    if (testDb) {
      await testDb.teardown();
    }
  });

  it("captureWorkerProviderProvenance accurately classifies TEST_FIXTURE when mock boundary was active", () => {
    const prov = captureWorkerProviderProvenance({
      acceptanceRunId: "acc_prov_001",
      discoveryRunId: "run_prov_001",
      workerPid: 12345,
      requestedMode: "OFFLINE_FIXTURE",
      providerId: "meta-ads-collector",
      transport: "mock_test_boundary",
      isFixture: true,
      upstreamRequestExecuted: true,
      upstreamResponseObserved: true,
      resultSetId: "rs_mock_1",
      adIds: ["mock_ad_1", "mock_ad_2"],
      validCount: 2,
    });

    expect(prov.observedSourceType).toBe("TEST_FIXTURE");
    expect(prov.fixtureDetected).toBe(true);
    expect(prov.actualTransport).toBe("mock_test_boundary");
    expect(prov.workerPid).toBe(12345);
    expect(prov.discoveryRunId).toBe("run_prov_001");
    expect(prov.evidenceOrigin).toBe("ACTUAL_PROVIDER_EXECUTION");
  });

  it("captureWorkerProviderProvenance accurately classifies REAL_UPSTREAM only when real stdio transport and upstream response observed", () => {
    const prov = captureWorkerProviderProvenance({
      acceptanceRunId: "acc_prov_002",
      discoveryRunId: "run_prov_002",
      workerPid: 12345,
      requestedMode: "REAL_LIVE_META",
      providerId: "meta-ads-collector",
      transport: "stdio",
      isFixture: false,
      upstreamRequestExecuted: true,
      upstreamResponseObserved: true,
      resultSetId: "rs_upstream_999",
      adIds: ["live_ad_1", "live_ad_2"],
      validCount: 2,
    });

    expect(prov.observedSourceType).toBe("REAL_UPSTREAM");
    expect(prov.fixtureDetected).toBe(false);
    expect(prov.actualTransport).toBe("stdio");
    expect(prov.upstreamResponseObserved).toBe(true);
  });

  it("captureWorkerProviderProvenance classifies UNKNOWN when transport is unknown or ambiguous", () => {
    const prov = captureWorkerProviderProvenance({
      acceptanceRunId: "acc_prov_003",
      discoveryRunId: "run_prov_003",
      workerPid: 12345,
      requestedMode: "REAL_LIVE_META",
      providerId: "meta-ads-collector",
      transport: "custom_unverified_proxy",
      isFixture: false,
      upstreamRequestExecuted: true,
      upstreamResponseObserved: false,
      resultSetId: null,
      adIds: [],
      validCount: 0,
    });

    expect(prov.observedSourceType).toBe("UNKNOWN");
    expect(prov.fixtureDetected).toBe(false);
  });

  it("real worker subprocess execution returns non-null providerEvidence matching executed run", async () => {
    process.env.SWAI_MOCK_META_BOUNDARY = "true";

    const context = {
      acceptanceRunId: `run_prov_e2e_${Date.now()}`,
      workspaceId,
      databaseUrl: testDb.url,
      startedAt: new Date().toISOString(),
      liveDbHandle: testDb,
      cleanup: async () => {},
    };

    const workerResult = await executeLiveResearchThroughWorker(context, {
      market: "US",
      keywords: ["orthopedic dog bed"],
      limit: 5,
    });

    expect(workerResult.success).toBe(true);
    expect(workerResult.providerEvidence).not.toBeNull();
    expect(workerResult.providerEvidence?.discoveryRunId).toBe(workerResult.runId);
    expect(workerResult.providerEvidence?.workerPid).toBe(workerResult.workerPid);
    expect(workerResult.providerEvidence?.fixtureDetected).toBe(true);
    expect(workerResult.providerEvidence?.observedSourceType).toBe("TEST_FIXTURE");
  });
});
