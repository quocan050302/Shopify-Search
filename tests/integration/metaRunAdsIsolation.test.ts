import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import { GET as getEvergreenAds } from "@/app/api/v1/evergreen/ads/route";

describe("Exact Research Run Results & Workspace Isolation (/api/v1/evergreen/ads)", () => {
  let dbHandle: TestDatabaseHandle;
  let previousTestDbUrl: string | undefined;

  const workspaceAlphaId = "ws_run_alpha";
  const workspaceBetaId = "ws_run_beta";

  const runAId = "run_alpha_001";
  const runBId = "run_alpha_002";
  const runEmptyId = "run_alpha_empty";
  const runBetaId = "run_beta_001";

  const runAAdIds: string[] = [];
  const runBAdIds: string[] = [];
  const runBetaAdIds: string[] = [];

  beforeAll(async () => {
    dbHandle = await createIsolatedTestDatabase({ prefix: "run-ads-isolation" });
    previousTestDbUrl = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = dbHandle.url;

    // 1. Workspaces
    await dbHandle.prisma.workspace.createMany({
      data: [
        {
          id: workspaceAlphaId,
          name: "Workspace Alpha",
          operatingMode: "RESEARCH_ONLY",
          targetMarket: "US",
        },
        {
          id: workspaceBetaId,
          name: "Workspace Beta",
          operatingMode: "RESEARCH_ONLY",
          targetMarket: "US",
        },
      ],
    });

    // 2. Data Source
    await dbHandle.prisma.dataSource.create({
      data: {
        id: "ds_meta_collector",
        name: "META_COLLECTOR",
        displayName: "Meta Ads Collector",
        capabilities: JSON.stringify(["KEYWORD_SEARCH"]),
        supportedRegions: JSON.stringify(["US"]),
      },
    });

    // 3. Advertisers
    const advAlpha = await dbHandle.prisma.advertiser.create({
      data: {
        name: "Alpha Pet Store",
        platform: "META",
        verifiedStatus: "VERIFIED",
      },
    });

    const advBeta = await dbHandle.prisma.advertiser.create({
      data: {
        name: "Beta Gadget Co",
        platform: "META",
        verifiedStatus: "VERIFIED",
      },
    });

    // 4. Discovery Runs for Workspace Alpha
    // Run A (5 ads for "pet hair remover")
    await dbHandle.prisma.discoveryRun.create({
      data: {
        id: runAId,
        workspaceId: workspaceAlphaId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: JSON.stringify({ keywords: ["pet hair remover"], market: "US" }),
        requestedLimit: 25,
        actualRetrievedCount: 5,
        validCount: 5,
        newUniqueCount: 5,
        existingDuplicateCount: 0,
      },
    });

    // Run B (7 ads for "pet hair remover" - same keyword, different run!)
    await dbHandle.prisma.discoveryRun.create({
      data: {
        id: runBId,
        workspaceId: workspaceAlphaId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: JSON.stringify({ keywords: ["pet hair remover"], market: "US" }),
        requestedLimit: 25,
        actualRetrievedCount: 7,
        validCount: 7,
        newUniqueCount: 7,
        existingDuplicateCount: 0,
      },
    });

    // Empty Run (0 ads)
    await dbHandle.prisma.discoveryRun.create({
      data: {
        id: runEmptyId,
        workspaceId: workspaceAlphaId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: JSON.stringify({ keywords: ["rare unheard niche"], market: "US" }),
        requestedLimit: 10,
        actualRetrievedCount: 0,
        validCount: 0,
        newUniqueCount: 0,
        existingDuplicateCount: 0,
      },
    });

    // Discovery Run for Workspace Beta
    await dbHandle.prisma.discoveryRun.create({
      data: {
        id: runBetaId,
        workspaceId: workspaceBetaId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: JSON.stringify({ keywords: ["pet hair remover"], market: "US" }),
        requestedLimit: 25,
        actualRetrievedCount: 3,
        validCount: 3,
        newUniqueCount: 3,
        existingDuplicateCount: 0,
      },
    });

    // 5. Create 5 CompetitorAds linked to Run A
    for (let i = 1; i <= 5; i++) {
      const ad = await dbHandle.prisma.competitorAd.create({
        data: {
          id: `ad_run_a_${i}`,
          platform: "META",
          dataSourceId: "ds_meta_collector",
          originalAdUrl: `https://facebook.com/ads/library/?id=run_a_${i}`,
          externalAdId: `ext_meta_a_${i}`,
          headline: `Run A Pet Hair Roller Ad ${i}`,
          bodyText: "Effortlessly remove pet hair from clothes and sofa",
          category: "PET_SUPPLIES",
          advertiserId: advAlpha.id,
          targetMarket: "US",
          dataConfidence: "VERIFIED",
          isSyntheticQuarantine: false,
          runAds: {
            create: {
              runId: runAId,
              workspaceId: workspaceAlphaId,
              providerId: "meta-ads-collector",
              libraryId: `lib_a_${i}`,
              ingestOutcome: "NEW",
            },
          },
        },
      });
      runAAdIds.push(ad.id);
    }

    // 6. Create 7 CompetitorAds linked to Run B
    for (let i = 1; i <= 7; i++) {
      const ad = await dbHandle.prisma.competitorAd.create({
        data: {
          id: `ad_run_b_${i}`,
          platform: "META",
          dataSourceId: "ds_meta_collector",
          originalAdUrl: `https://facebook.com/ads/library/?id=run_b_${i}`,
          externalAdId: `ext_meta_b_${i}`,
          headline: `Run B Pet Lint Sweeper Ad ${i}`,
          bodyText: "Advanced reusable pet hair scraper tool",
          category: "PET_SUPPLIES",
          advertiserId: advAlpha.id,
          targetMarket: "US",
          dataConfidence: "VERIFIED",
          isSyntheticQuarantine: false,
          runAds: {
            create: {
              runId: runBId,
              workspaceId: workspaceAlphaId,
              providerId: "meta-ads-collector",
              libraryId: `lib_b_${i}`,
              ingestOutcome: "NEW",
            },
          },
        },
      });
      runBAdIds.push(ad.id);
    }

    // 7. Create 3 CompetitorAds linked to Beta's Run
    for (let i = 1; i <= 3; i++) {
      const ad = await dbHandle.prisma.competitorAd.create({
        data: {
          id: `ad_run_beta_${i}`,
          platform: "META",
          dataSourceId: "ds_meta_collector",
          originalAdUrl: `https://facebook.com/ads/library/?id=run_beta_${i}`,
          externalAdId: `ext_meta_beta_${i}`,
          headline: `Beta Secret Pet Brush Ad ${i}`,
          bodyText: "Workspace Beta confidential pet brush",
          category: "PET_SUPPLIES",
          advertiserId: advBeta.id,
          targetMarket: "US",
          dataConfidence: "VERIFIED",
          isSyntheticQuarantine: false,
          runAds: {
            create: {
              runId: runBetaId,
              workspaceId: workspaceBetaId,
              providerId: "meta-ads-collector",
              libraryId: `lib_beta_${i}`,
              ingestOutcome: "NEW",
            },
          },
        },
      });
      runBetaAdIds.push(ad.id);
    }
  });

  afterAll(async () => {
    if (previousTestDbUrl !== undefined) {
      process.env.TEST_DATABASE_URL = previousTestDbUrl;
    } else {
      delete process.env.TEST_DATABASE_URL;
    }
    await dbHandle?.teardown();
  });

  function makeRequest(url: string, workspaceId: string): NextRequest {
    return new NextRequest(new URL(url, "http://localhost:3000"), {
      headers: {
        host: "localhost:3000",
        "x-workspace-id": workspaceId,
      },
    });
  }

  it("returns exactly Run A's 5 ads when requestId=Run A is provided", async () => {
    const req = makeRequest(`/api/v1/evergreen/ads?requestId=${runAId}`, workspaceAlphaId);
    const res = await getEvergreenAds(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(5);

    const returnedIds = json.data.map((ad: any) => ad.id);
    expect(returnedIds.sort()).toEqual(runAAdIds.sort());

    // None of Run B's ads appear in Run A results
    for (const bId of runBAdIds) {
      expect(returnedIds).not.toContain(bId);
    }
  });

  it("returns exactly Run B's 7 ads when requestId=Run B is provided", async () => {
    const req = makeRequest(`/api/v1/evergreen/ads?requestId=${runBId}`, workspaceAlphaId);
    const res = await getEvergreenAds(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(7);

    const returnedIds = json.data.map((ad: any) => ad.id);
    expect(returnedIds.sort()).toEqual(runBAdIds.sort());

    // None of Run A's ads appear in Run B results
    for (const aId of runAAdIds) {
      expect(returnedIds).not.toContain(aId);
    }
  });

  it("returns 0 ads for an empty run and does not fall back to unrelated ads", async () => {
    const req = makeRequest(`/api/v1/evergreen/ads?requestId=${runEmptyId}`, workspaceAlphaId);
    const res = await getEvergreenAds(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(0);
    expect(json.pagination.total).toBe(0);
  });

  it("rejects with 403 when Workspace Beta attempts to access Workspace Alpha's Run A", async () => {
    // Principal belongs to Workspace Beta, but requests Run A (owned by Alpha)
    const req = makeRequest(`/api/v1/evergreen/ads?requestId=${runAId}`, workspaceBetaId);
    const res = await getEvergreenAds(req);
    expect(res.status).toBe(403);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("FORBIDDEN_WORKSPACE_RUN");
  });

  it("returns only Workspace Beta ads when Workspace Beta requests general ads without requestId", async () => {
    const req = makeRequest(`/api/v1/evergreen/ads`, workspaceBetaId);
    const res = await getEvergreenAds(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(3);

    const returnedIds = json.data.map((ad: any) => ad.id);
    expect(returnedIds.sort()).toEqual(runBetaAdIds.sort());

    // None of Workspace Alpha's ads appear
    for (const aId of runAAdIds) {
      expect(returnedIds).not.toContain(aId);
    }
    for (const bId of runBAdIds) {
      expect(returnedIds).not.toContain(bId);
    }
  });
});
