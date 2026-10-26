import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import { GET as getRunAds } from "@/app/api/v1/discovery/meta/requests/[id]/ads/route";
import { reconcileResearchRunCounts } from "@/services/research/runReconciliationService";

describe("Exact Research Run Completeness & Canonical Scoping (/api/v1/discovery/meta/requests/:id/ads)", () => {
  let dbHandle: TestDatabaseHandle;
  let previousTestDbUrl: string | undefined;

  const wsAlphaId = "ws_exact_alpha";
  const wsBetaId = "ws_exact_beta";

  const runAId = "run_exact_a_25";
  const runBId = "run_exact_b_same_kw";
  const runEmptyId = "run_exact_empty";
  const runBetaId = "run_exact_beta";

  const runAAdIds: string[] = [];
  let oldAd180Id: string;
  let unknownDateAdId: string;
  let yesterdayAdId: string;

  beforeAll(async () => {
    dbHandle = await createIsolatedTestDatabase({ prefix: "exact-run-completeness" });
    previousTestDbUrl = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = dbHandle.url;

    // 1. Workspaces
    await dbHandle.prisma.workspace.createMany({
      data: [
        { id: wsAlphaId, name: "Workspace Alpha", operatingMode: "RESEARCH_ONLY", targetMarket: "US" },
        { id: wsBetaId, name: "Workspace Beta", operatingMode: "RESEARCH_ONLY", targetMarket: "US" },
      ],
    });

    // 2. Data Source
    await dbHandle.prisma.dataSource.create({
      data: {
        id: "ds_meta_exact",
        name: "META_COLLECTOR",
        displayName: "Meta Collector Exact",
        capabilities: JSON.stringify(["KEYWORD_SEARCH"]),
        supportedRegions: JSON.stringify(["US"]),
      },
    });

    // 3. Advertisers
    const adv1 = await dbHandle.prisma.advertiser.create({
      data: { name: "Alpha Pet Supplies", platform: "META", verifiedStatus: "VERIFIED" },
    });
    const adv2 = await dbHandle.prisma.advertiser.create({
      data: { name: "Alpha Home Essentials", platform: "META", verifiedStatus: "VERIFIED" },
    });

    // 4. Discovery Runs
    await dbHandle.prisma.discoveryRun.create({
      data: {
        id: runAId,
        workspaceId: wsAlphaId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: JSON.stringify({ keywords: ["pet hair remover"], market: "US" }),
        requestedLimit: 25,
        actualRetrievedCount: 25,
        validCount: 25,
        newUniqueCount: 25,
        existingDuplicateCount: 0,
      },
    });

    await dbHandle.prisma.discoveryRun.create({
      data: {
        id: runBId,
        workspaceId: wsAlphaId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: JSON.stringify({ keywords: ["pet hair remover"], market: "US" }),
        requestedLimit: 5,
        actualRetrievedCount: 5,
        validCount: 5,
        newUniqueCount: 5,
        existingDuplicateCount: 0,
      },
    });

    await dbHandle.prisma.discoveryRun.create({
      data: {
        id: runEmptyId,
        workspaceId: wsAlphaId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: JSON.stringify({ keywords: ["nonexistent item"], market: "US" }),
        requestedLimit: 10,
        actualRetrievedCount: 0,
        validCount: 0,
        newUniqueCount: 0,
        existingDuplicateCount: 0,
      },
    });

    await dbHandle.prisma.discoveryRun.create({
      data: {
        id: runBetaId,
        workspaceId: wsBetaId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: JSON.stringify({ keywords: ["pet hair remover"], market: "US" }),
        requestedLimit: 5,
        actualRetrievedCount: 5,
        validCount: 5,
        newUniqueCount: 5,
        existingDuplicateCount: 0,
      },
    });

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const oneEightyDaysAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

    // 5. Create 25 ads for Run A
    for (let i = 1; i <= 25; i++) {
      let sourceDate: Date | null = new Date(now.getTime() - i * 2 * 24 * 60 * 60 * 1000);
      let daysRunning = i * 2;

      if (i === 1) {
        sourceDate = oneDayAgo;
        daysRunning = 1;
      } else if (i === 2) {
        sourceDate = ninetyDaysAgo;
        daysRunning = 90;
      } else if (i === 3) {
        sourceDate = oneEightyDaysAgo;
        daysRunning = 180;
      } else if (i === 4) {
        sourceDate = null; // UNKNOWN launch date
        daysRunning = 0;
      }

      const ad = await dbHandle.prisma.competitorAd.create({
        data: {
          id: `ad_exact_a_${i}`,
          platform: "META",
          dataSourceId: "ds_meta_exact",
          originalAdUrl: `https://facebook.com/ads/library/?id=exact_a_${i}`,
          externalAdId: `ext_exact_a_${i}`,
          headline: `Run A Pet Roller Ad ${i}`,
          bodyText: `High efficiency pet hair roller item #${i}`,
          category: "PET_SUPPLIES",
          advertiserId: i % 2 === 0 ? adv1.id : adv2.id,
          targetMarket: "US",
          dataConfidence: "VERIFIED",
          sourceReportedStartAt: sourceDate,
          daysRunning,
          isSyntheticQuarantine: false,
          runAds: {
            create: {
              runId: runAId,
              workspaceId: wsAlphaId,
              providerId: "meta-ads-collector",
              libraryId: `lib_exact_a_${i}`,
              ingestOutcome: "NEW",
            },
          },
        },
      });

      runAAdIds.push(ad.id);
      if (i === 1) yesterdayAdId = ad.id;
      if (i === 3) oldAd180Id = ad.id;
      if (i === 4) unknownDateAdId = ad.id;
    }

    // 6. Create 5 ads for Run B
    for (let i = 1; i <= 5; i++) {
      await dbHandle.prisma.competitorAd.create({
        data: {
          id: `ad_exact_b_${i}`,
          platform: "META",
          dataSourceId: "ds_meta_exact",
          originalAdUrl: `https://facebook.com/ads/library/?id=exact_b_${i}`,
          externalAdId: `ext_exact_b_${i}`,
          headline: `Run B Pet Brush Ad ${i}`,
          bodyText: `Run B brush scraper #${i}`,
          category: "PET_SUPPLIES",
          advertiserId: adv1.id,
          targetMarket: "US",
          dataConfidence: "VERIFIED",
          daysRunning: 5,
          isSyntheticQuarantine: false,
          runAds: {
            create: {
              runId: runBId,
              workspaceId: wsAlphaId,
              providerId: "meta-ads-collector",
              libraryId: `lib_exact_b_${i}`,
              ingestOutcome: "NEW",
            },
          },
        },
      });
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

  it("retrieves all 25 linked ads across pagination without 30-day age filtering", async () => {
    // Page 1: 15 ads
    const req1 = makeRequest(`/api/v1/discovery/meta/requests/${runAId}/ads?page=1&pageSize=15`, wsAlphaId);
    const res1 = await getRunAds(req1, { params: Promise.resolve({ id: runAId }) });
    expect(res1.status).toBe(200);

    const json1 = await res1.json();
    expect(json1.success).toBe(true);
    expect(json1.pagination.total).toBe(25);
    expect(json1.pagination.totalPages).toBe(2);
    expect(json1.data.length).toBe(15);

    // Page 2: 10 ads
    const req2 = makeRequest(`/api/v1/discovery/meta/requests/${runAId}/ads?page=2&pageSize=15`, wsAlphaId);
    const res2 = await getRunAds(req2, { params: Promise.resolve({ id: runAId }) });
    expect(res2.status).toBe(200);

    const json2 = await res2.json();
    expect(json2.success).toBe(true);
    expect(json2.data.length).toBe(10);

    const allRetrievedIds = [...json1.data.map((d: any) => d.id), ...json2.data.map((d: any) => d.id)];
    expect(allRetrievedIds.sort()).toEqual(runAAdIds.sort());

    // CRITICAL INVARIANT: 180-day-old ad and unknown-date ad are both present!
    expect(allRetrievedIds).toContain(oldAd180Id);
    expect(allRetrievedIds).toContain(unknownDateAdId);
    expect(allRetrievedIds).toContain(yesterdayAdId);
  });

  it("returns 404 for a nonexistent research run", async () => {
    const nonexistentRunId = "run_nonexistent_9999";
    const req = makeRequest(`/api/v1/discovery/meta/requests/${nonexistentRunId}/ads`, wsAlphaId);
    const res = await getRunAds(req, { params: Promise.resolve({ id: nonexistentRunId }) });
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.code || json.error).toBe("RUN_NOT_FOUND");
  });

  it("returns 403 when a foreign workspace attempts to read Run A's ads", async () => {
    const req = makeRequest(`/api/v1/discovery/meta/requests/${runAId}/ads`, wsBetaId);
    const res = await getRunAds(req, { params: Promise.resolve({ id: runAId }) });
    expect(res.status).toBe(403);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.code || json.error).toBe("FORBIDDEN_WORKSPACE_RUN");
  });

  it("returns 200 with empty list for an authorized run that genuinely has 0 ads", async () => {
    const req = makeRequest(`/api/v1/discovery/meta/requests/${runEmptyId}/ads`, wsAlphaId);
    const res = await getRunAds(req, { params: Promise.resolve({ id: runEmptyId }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual([]);
    expect(json.pagination.total).toBe(0);
  });

  it("reconciles run counts truthfully across ledger, relations, and display", async () => {
    const reconciliation = await reconcileResearchRunCounts(runAId);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.retrieved).toBe(25);
    expect(reconciliation.valid).toBe(25);
    expect(reconciliation.linked).toBe(25);
    expect(reconciliation.displayed).toBe(25);
    expect(reconciliation.excluded).toBe(0);
  });
});
