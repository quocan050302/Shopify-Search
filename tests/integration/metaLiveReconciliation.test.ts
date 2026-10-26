import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import { ingestDiscoveredAds } from "@/services/discovery/discoveryIngestionService";
import { reconcileResearchRunCounts } from "@/services/research/runReconciliationService";
import { normalizeMetaCollectorAd } from "@/services/discovery/normalization/normalizeMetaCollectorAd";

describe("Deterministic Meta Ingestion & Evidence Reconciliation (Section 25)", () => {
  let dbHandle: TestDatabaseHandle;
  let previousTestDbUrl: string | undefined;

  const workspaceId = "ws_recon_test";
  const runId = "run_recon_001";

  beforeAll(async () => {
    dbHandle = await createIsolatedTestDatabase({ prefix: "meta-recon" });
    previousTestDbUrl = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = dbHandle.url;

    // 1. Workspace
    await dbHandle.prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "Reconciliation Test Workspace",
        operatingMode: "RESEARCH_ONLY",
        targetMarket: "US",
      },
    });

    // 2. Data Source
    await dbHandle.prisma.dataSource.upsert({
      where: { name: "META_AD_LIBRARY" },
      create: {
        id: "ds_meta_recon",
        name: "META_AD_LIBRARY",
        displayName: "Meta Collector Recon",
        capabilities: JSON.stringify(["KEYWORD_SEARCH"]),
        supportedRegions: JSON.stringify(["US"]),
      },
      update: {},
    });

    // 3. Discovery Run
    await dbHandle.prisma.discoveryRun.create({
      data: {
        id: runId,
        workspaceId,
        providerId: "meta-ads-collector",
        status: "RUNNING",
        queryConfigJson: JSON.stringify({ keywords: ["pet hair remover"], market: "US" }),
        requestedLimit: 25,
        actualRetrievedCount: 5,
        validCount: 5,
        newUniqueCount: 0,
        existingDuplicateCount: 0,
      },
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

  const rawAds = [
    {
      id: "99000000000001",
      page: { id: "1001", name: "Pet Pro Tools" },
      headline: "Reusable Fur Roller Pro",
      body: "Effortlessly clean pet fur from furniture",
      source_url: "https://facebook.com/ads/library/?id=99000000000001",
      start_date: "2026-08-01T00:00:00Z",
      publisher_platform: ["facebook"],
      is_active: true,
      media_type: "image",
      image_url: "https://petpro.com/img1.jpg",
    },
    {
      id: "99000000000002",
      page: { id: "1002", name: "Clean Living Co" },
      headline: "Electrostatic Pet Hair Scraper",
      body: "Dual-blade hair remover for carpets and cars",
      source_url: "https://facebook.com/ads/library/?id=99000000000002",
      start_date: "2026-09-01T00:00:00Z",
      publisher_platform: ["facebook"],
      is_active: true,
    },
    {
      id: "99000000000003",
      page: { id: "1003", name: "FurFree Home" },
      headline: "Lint & Hair Sweeper Deluxe",
      body: "Keep upholstery spotless without sticky sheets",
      source_url: "https://facebook.com/ads/library/?id=99000000000003",
      start_date: "2026-07-15T00:00:00Z",
      publisher_platform: ["facebook"],
      is_active: true,
    },
    {
      id: "99000000000004",
      page: { id: "1004", name: "Pet Brush Lab" },
      headline: "Multi-Surface Hair Roller",
      body: "Self-cleaning lint remover with disposal chamber",
      source_url: "https://facebook.com/ads/library/?id=99000000000004",
      start_date: "2026-10-01T00:00:00Z",
      publisher_platform: ["facebook"],
      is_active: true,
    },
    {
      id: "99000000000005",
      page: { id: "1005", name: "Uproot Clean" },
      headline: "Ultimate Pet Hair Cleaner",
      body: "The original copper edge cleaner for tough fur",
      source_url: "https://facebook.com/ads/library/?id=99000000000005",
      start_date: "2026-04-10T00:00:00Z",
      publisher_platform: ["facebook"],
      is_active: true,
    },
  ];

  it("ingests 5 candidates and links them cleanly to the discovery run", async () => {
    const normalized = rawAds.map((a) => normalizeMetaCollectorAd(a));
    const summary = await ingestDiscoveredAds(normalized, {
      workspaceId,
      runId,
      providerId: "meta-ads-collector",
      runMode: "MANUAL",
    });

    expect(summary.totalProcessed).toBe(5);
    expect(summary.newUniqueInserted).toBe(5);
    expect(summary.errors.length).toBe(0);

    // Update discoveryRun ledger to reflect validated counts
    await dbHandle.prisma.discoveryRun.update({
      where: { id: runId },
      data: {
        status: "COMPLETED",
        actualRetrievedCount: 5,
        validCount: 5,
        newUniqueCount: 5,
        existingDuplicateCount: 0,
      },
    });

    // Reconcile counts
    const recon = await reconcileResearchRunCounts(runId);
    expect(recon.consistent).toBe(true);
    expect(recon.retrieved).toBe(5);
    expect(recon.valid).toBe(5);
    expect(recon.linked).toBe(5);
    expect(recon.displayed).toBe(5);
    expect(recon.excluded).toBe(0);
  });

  it("handles duplicate ingestion idempotently and updates duplicate ledger", async () => {
    const normalized = rawAds.map((a) => normalizeMetaCollectorAd(a));
    const summary = await ingestDiscoveredAds(normalized, {
      workspaceId,
      runId,
      providerId: "meta-ads-collector",
      runMode: "MANUAL",
    });

    expect(summary.totalProcessed).toBe(5);
    expect(summary.newUniqueInserted).toBe(0);
    expect(summary.existingUpdated).toBe(5);

    // Reconcile counts: still 5 linked relations, fully consistent
    const recon = await reconcileResearchRunCounts(runId);
    expect(recon.consistent).toBe(true);
    expect(recon.linked).toBe(5);
  });
});
