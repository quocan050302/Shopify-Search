import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import { GET as getRequests, POST as postRequests } from "@/app/api/v1/discovery/meta/requests/route";
import { GET as getRequestDetails } from "@/app/api/v1/discovery/meta/requests/[id]/route";
import { POST as cancelRequest } from "@/app/api/v1/discovery/meta/requests/[id]/cancel/route";
import { POST as retryRequest } from "@/app/api/v1/discovery/meta/requests/[id]/retry/route";
import { GET as getRequestAds } from "@/app/api/v1/discovery/meta/requests/[id]/ads/route";

describe("Meta Discovery Security & Multi-Tenant Isolation", () => {
  let dbHandle: TestDatabaseHandle;
  let previousTestDbUrl: string | undefined;

  const workspaceAlphaId = "ws_security_alpha";
  const workspaceBetaId = "ws_security_beta";

  let alphaRunId: string;

  beforeAll(async () => {
    dbHandle = await createIsolatedTestDatabase({ prefix: "meta-security" });
    previousTestDbUrl = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = dbHandle.url;

    // Create two independent workspaces
    await dbHandle.prisma.workspace.createMany({
      data: [
        {
          id: workspaceAlphaId,
          name: "Workspace Alpha (Tenant A)",
          operatingMode: "RESEARCH_ONLY",
          targetMarket: "US",
        },
        {
          id: workspaceBetaId,
          name: "Workspace Beta (Tenant B)",
          operatingMode: "RESEARCH_ONLY",
          targetMarket: "US",
        },
      ],
    });

    // Create an advertiser, ad, and a completed discovery run in Workspace Alpha
    const advertiser = await dbHandle.prisma.advertiser.create({
      data: {
        id: "adv_alpha",
        platform: "META",
        name: "Alpha Brand",
        externalId: "page_alpha_123",
      },
    });

    const dataSource = await dbHandle.prisma.dataSource.create({
      data: {
        id: "ds_meta_alpha",
        name: "META_AD_LIBRARY_ALPHA",
        displayName: "Meta Ad Library",
        capabilities: JSON.stringify(["KEYWORD_SEARCH"]),
        supportedRegions: JSON.stringify(["US"]),
      },
    });

    const ad = await dbHandle.prisma.competitorAd.create({
      data: {
        id: "ad_alpha_001",
        advertiserId: advertiser.id,
        dataSourceId: dataSource.id,
        externalAdId: "meta_ext_alpha_001",
        platform: "META",
        originalAdUrl: "https://facebook.com/ads/library/?id=meta_ext_alpha_001",
        status: "ACTIVE",
      },
    });

    const runAlpha = await dbHandle.prisma.discoveryRun.create({
      data: {
        id: "run_alpha_security_1",
        workspaceId: workspaceAlphaId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: JSON.stringify({ keywords: ["alpha gadget"], market: "US" }),
        actualRetrievedCount: 1,
        validCount: 1,
        newUniqueCount: 1,
      },
    });
    alphaRunId = runAlpha.id;

    await dbHandle.prisma.discoveryRunAd.create({
      data: {
        id: "run_ad_alpha_1",
        runId: runAlpha.id,
        adId: ad.id,
        workspaceId: workspaceAlphaId,
        providerId: "meta-ads-collector",
        ingestOutcome: "NEW",
      },
    });

    // Create a run in Workspace Beta
    await dbHandle.prisma.discoveryRun.create({
      data: {
        id: "run_beta_security_1",
        workspaceId: workspaceBetaId,
        providerId: "meta-ads-collector",
        status: "PENDING",
        queryConfigJson: JSON.stringify({ keywords: ["beta gadget"], market: "US" }),
        actualRetrievedCount: 0,
        validCount: 0,
      },
    });
  });

  afterAll(async () => {
    if (previousTestDbUrl) {
      process.env.TEST_DATABASE_URL = previousTestDbUrl;
    }
    if (dbHandle) {
      await dbHandle.teardown();
    }
  });

  function makeRequest(
    url: string,
    workspaceId: string,
    method = "GET",
    body?: any
  ): NextRequest {
    const init: RequestInit = {
      method,
      headers: {
        "x-workspace-id": workspaceId,
        "content-type": "application/json",
      },
    };
    if (body) {
      init.body = JSON.stringify(body);
    }
    return new NextRequest(new URL(url, "http://localhost:3000"), init as any);
  }

  it("lists only workspace-scoped discovery runs in GET /requests", async () => {
    // Request as Workspace Alpha
    const reqAlpha = makeRequest("/api/v1/discovery/meta/requests", workspaceAlphaId);
    const resAlpha = await getRequests(reqAlpha);
    expect(resAlpha.status).toBe(200);
    const jsonAlpha = await resAlpha.json();
    expect(jsonAlpha.success).toBe(true);
    expect(jsonAlpha.data.length).toBe(1);
    expect(jsonAlpha.data[0].id).toBe("run_alpha_security_1");

    // Request as Workspace Beta
    const reqBeta = makeRequest("/api/v1/discovery/meta/requests", workspaceBetaId);
    const resBeta = await getRequests(reqBeta);
    expect(resBeta.status).toBe(200);
    const jsonBeta = await resBeta.json();
    expect(jsonBeta.success).toBe(true);
    expect(jsonBeta.data.length).toBe(1);
    expect(jsonBeta.data[0].id).toBe("run_beta_security_1");
  });

  it("prevents Workspace Beta from reading Workspace Alpha's run details", async () => {
    const reqBeta = makeRequest(
      `/api/v1/discovery/meta/requests/${alphaRunId}`,
      workspaceBetaId
    );
    const resBeta = await getRequestDetails(reqBeta, {
      params: Promise.resolve({ id: alphaRunId }),
    });

    expect(resBeta.status).toBe(403);
    const jsonBeta = await resBeta.json();
    expect(jsonBeta.success).toBe(false);
    expect(jsonBeta.error).toBe("FORBIDDEN");
  });

  it("allows Workspace Alpha to read its own run details", async () => {
    const reqAlpha = makeRequest(
      `/api/v1/discovery/meta/requests/${alphaRunId}`,
      workspaceAlphaId
    );
    const resAlpha = await getRequestDetails(reqAlpha, {
      params: Promise.resolve({ id: alphaRunId }),
    });

    expect(resAlpha.status).toBe(200);
    const jsonAlpha = await resAlpha.json();
    expect(jsonAlpha.success).toBe(true);
    expect(jsonAlpha.data.id).toBe(alphaRunId);
    expect(jsonAlpha.data.workspaceId).toBe(workspaceAlphaId);
  });

  it("prevents Workspace Beta from cancelling Workspace Alpha's run", async () => {
    const reqBeta = makeRequest(
      `/api/v1/discovery/meta/requests/${alphaRunId}/cancel`,
      workspaceBetaId,
      "POST"
    );
    const resBeta = await cancelRequest(reqBeta, {
      params: Promise.resolve({ id: alphaRunId }),
    });

    expect(resBeta.status).toBe(403);
    const jsonBeta = await resBeta.json();
    expect(jsonBeta.success).toBe(false);
    expect(jsonBeta.error).toBe("FORBIDDEN");
  });

  it("prevents Workspace Beta from retrying Workspace Alpha's run", async () => {
    const reqBeta = makeRequest(
      `/api/v1/discovery/meta/requests/${alphaRunId}/retry`,
      workspaceBetaId,
      "POST"
    );
    const resBeta = await retryRequest(reqBeta, {
      params: Promise.resolve({ id: alphaRunId }),
    });

    expect(resBeta.status).toBe(403);
    const jsonBeta = await resBeta.json();
    expect(jsonBeta.success).toBe(false);
    expect(jsonBeta.error).toBe("FORBIDDEN");
  });

  it("prevents Workspace Beta from viewing advertisements from Workspace Alpha's run", async () => {
    const reqBeta = makeRequest(
      `/api/v1/discovery/meta/requests/${alphaRunId}/ads`,
      workspaceBetaId
    );
    const resBeta = await getRequestAds(reqBeta, {
      params: Promise.resolve({ id: alphaRunId }),
    });

    expect(resBeta.status).toBe(403);
    const jsonBeta = await resBeta.json();
    expect(jsonBeta.success).toBe(false);
    expect(jsonBeta.error).toBe("FORBIDDEN");
  });

  it("allows Workspace Alpha to view advertisements from its own run", async () => {
    const reqAlpha = makeRequest(
      `/api/v1/discovery/meta/requests/${alphaRunId}/ads`,
      workspaceAlphaId
    );
    const resAlpha = await getRequestAds(reqAlpha, {
      params: Promise.resolve({ id: alphaRunId }),
    });

    expect(resAlpha.status).toBe(200);
    const jsonAlpha = await resAlpha.json();
    expect(jsonAlpha.success).toBe(true);
    expect(jsonAlpha.data.length).toBe(1);
    expect(jsonAlpha.data[0].id).toBe("ad_alpha_001");
  });
});
