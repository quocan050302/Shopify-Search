import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import { GET as globalSearch } from "@/app/api/v1/search/route";

describe("Global Search Security & Multi-Tenant Workspace Isolation", () => {
  let dbHandle: TestDatabaseHandle;
  let previousTestDbUrl: string | undefined;

  const workspaceAlphaId = "ws_search_alpha";
  const workspaceBetaId = "ws_search_beta";

  let productAlphaId: string;
  let productBetaId: string;
  let adAlphaId: string;
  let adBetaId: string;

  beforeAll(async () => {
    dbHandle = await createIsolatedTestDatabase({ prefix: "search-security" });
    previousTestDbUrl = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = dbHandle.url;

    // 1. Create two isolated workspaces
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

    // 2. Data Sources & Advertisers
    const dsAlpha = await dbHandle.prisma.dataSource.create({
      data: {
        id: "ds_search_alpha",
        name: "META_SEARCH_ALPHA",
        displayName: "Meta Ad Library Alpha",
        capabilities: JSON.stringify(["KEYWORD_SEARCH"]),
        supportedRegions: JSON.stringify(["US"]),
      },
    });

    const dsBeta = await dbHandle.prisma.dataSource.create({
      data: {
        id: "ds_search_beta",
        name: "META_SEARCH_BETA",
        displayName: "Meta Ad Library Beta",
        capabilities: JSON.stringify(["KEYWORD_SEARCH"]),
        supportedRegions: JSON.stringify(["US"]),
      },
    });

    // Shared advertiser name across workspaces to verify cross-workspace isolation
    const advAlpha = await dbHandle.prisma.advertiser.create({
      data: {
        id: "adv_search_alpha",
        platform: "META",
        name: "Lumina Brands",
        externalId: "page_lumina_alpha",
      },
    });

    const advBeta = await dbHandle.prisma.advertiser.create({
      data: {
        id: "adv_search_beta",
        platform: "META",
        name: "Lumina Brands", // Same name, different workspace!
        externalId: "page_lumina_beta",
      },
    });

    // 3. Advertisements
    const adAlpha = await dbHandle.prisma.competitorAd.create({
      data: {
        id: "ad_search_alpha_01",
        advertiserId: advAlpha.id,
        dataSourceId: dsAlpha.id,
        headline: "Alpha Exclusive Ultrasonic Cleaner",
        bodyText: "High frequency ultrasonic sound waves for jewelry.",
        originalAdUrl: "https://facebook.com/ads/library/?id=alpha_ad_01",
        platform: "META",
        status: "ACTIVE",
      },
    });
    adAlphaId = adAlpha.id;

    const adBeta = await dbHandle.prisma.competitorAd.create({
      data: {
        id: "ad_search_beta_01",
        advertiserId: advBeta.id,
        dataSourceId: dsBeta.id,
        headline: "Beta Confidential Sonic Cleaner",
        bodyText: "Private competitor sonic vibration cleaner.",
        originalAdUrl: "https://facebook.com/ads/library/?id=beta_ad_01",
        platform: "META",
        status: "ACTIVE",
      },
    });
    adBetaId = adBeta.id;

    // 4. Discovery Runs & DiscoveryRunAd links
    const runAlpha = await dbHandle.prisma.discoveryRun.create({
      data: {
        id: "run_search_alpha_1",
        workspaceId: workspaceAlphaId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: JSON.stringify({ keywords: ["ultrasonic"] }),
      },
    });

    await dbHandle.prisma.discoveryRunAd.create({
      data: {
        id: "run_ad_search_alpha_1",
        runId: runAlpha.id,
        adId: adAlpha.id,
        workspaceId: workspaceAlphaId,
        providerId: "meta-ads-collector",
        ingestOutcome: "NEW",
      },
    });

    const runBeta = await dbHandle.prisma.discoveryRun.create({
      data: {
        id: "run_search_beta_1",
        workspaceId: workspaceBetaId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: JSON.stringify({ keywords: ["sonic"] }),
      },
    });

    await dbHandle.prisma.discoveryRunAd.create({
      data: {
        id: "run_ad_search_beta_1",
        runId: runBeta.id,
        adId: adBeta.id,
        workspaceId: workspaceBetaId,
        providerId: "meta-ads-collector",
        ingestOutcome: "NEW",
      },
    });

    // 5. Products
    const storeAlpha = await dbHandle.prisma.competitorStore.create({
      data: {
        id: "store_search_alpha",
        domain: "alphaclean.shop",
        storeName: "Alpha Clean Store",
      },
    });

    const productAlpha = await dbHandle.prisma.researchProduct.create({
      data: {
        id: "prod_search_alpha",
        title: "Pro Ultrasonic Jewelry Bath",
        description: "Deep ultrasonic cleaning chamber",
        storeId: storeAlpha.id,
      },
    });
    productAlphaId = productAlpha.id;

    await dbHandle.prisma.adProductLink.create({
      data: {
        id: "link_search_alpha",
        adId: adAlpha.id,
        productId: productAlpha.id,
        confidence: "CONFIRMED",
      },
    });

    const storeBeta = await dbHandle.prisma.competitorStore.create({
      data: {
        id: "store_search_beta",
        domain: "betasonic.shop",
        storeName: "Beta Sonic Store",
      },
    });

    const productBeta = await dbHandle.prisma.researchProduct.create({
      data: {
        id: "prod_search_beta",
        title: "Secret Sonic Pod Pro",
        description: "Confidential private beta cleaning pod",
        storeId: storeBeta.id,
      },
    });
    productBetaId = productBeta.id;

    await dbHandle.prisma.adProductLink.create({
      data: {
        id: "link_search_beta",
        adId: adBeta.id,
        productId: productBeta.id,
        confidence: "CONFIRMED",
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

  function makeSearchRequest(workspaceId: string, query: string, authHeader?: string): NextRequest {
    const headers: Record<string, string> = {
      "x-workspace-id": workspaceId,
      host: "localhost:3000",
    };
    if (authHeader) {
      headers["authorization"] = authHeader;
    }
    const url = `http://localhost:3000/api/v1/search?q=${encodeURIComponent(query)}`;
    return new NextRequest(new URL(url), { headers });
  }

  it("Workspace Alpha finds its own product and cannot find Workspace Beta product", async () => {
    // Search for "clean" which matches both Alpha ("Pro Ultrasonic Jewelry Bath" description / store) and Beta
    const reqAlpha = makeSearchRequest(workspaceAlphaId, "clean");
    const resAlpha = await globalSearch(reqAlpha);
    expect(resAlpha.status).toBe(200);

    const dataAlpha = await resAlpha.json();
    expect(dataAlpha.success).toBe(true);

    const foundProductIds = dataAlpha.data.products.map((p: any) => p.id);
    expect(foundProductIds).toContain(productAlphaId);
    expect(foundProductIds).not.toContain(productBetaId);
  });

  it("Workspace Beta finds its own product and cannot find Workspace Alpha product", async () => {
    const reqBeta = makeSearchRequest(workspaceBetaId, "clean");
    const resBeta = await globalSearch(reqBeta);
    expect(resBeta.status).toBe(200);

    const dataBeta = await resBeta.json();
    expect(dataBeta.success).toBe(true);

    const foundProductIds = dataBeta.data.products.map((p: any) => p.id);
    expect(foundProductIds).toContain(productBetaId);
    expect(foundProductIds).not.toContain(productAlphaId);
  });

  it("Workspace Alpha finds its own ad and cannot find Workspace Beta ad", async () => {
    // Both ads mention "cleaner"
    const reqAlpha = makeSearchRequest(workspaceAlphaId, "cleaner");
    const resAlpha = await globalSearch(reqAlpha);
    const dataAlpha = await resAlpha.json();

    const foundAdIds = dataAlpha.data.ads.map((a: any) => a.id);
    expect(foundAdIds).toContain(adAlphaId);
    expect(foundAdIds).not.toContain(adBetaId);
  });

  it("Workspace Beta finds its own ad and cannot find Workspace Alpha ad", async () => {
    const reqBeta = makeSearchRequest(workspaceBetaId, "cleaner");
    const resBeta = await globalSearch(reqBeta);
    const dataBeta = await resBeta.json();

    const foundAdIds = dataBeta.data.ads.map((a: any) => a.id);
    expect(foundAdIds).toContain(adBetaId);
    expect(foundAdIds).not.toContain(adAlphaId);
  });

  it("Searching by identical advertiser name ('Lumina Brands') does not leak cross-workspace ads", async () => {
    const reqAlpha = makeSearchRequest(workspaceAlphaId, "Lumina");
    const resAlpha = await globalSearch(reqAlpha);
    const dataAlpha = await resAlpha.json();

    const foundAdIds = dataAlpha.data.ads.map((a: any) => a.id);
    expect(foundAdIds).toContain(adAlphaId);
    expect(foundAdIds).not.toContain(adBetaId);
  });

  it("Rejects search query shorter than 2 characters gracefully", async () => {
    const req = makeSearchRequest(workspaceAlphaId, "a");
    const res = await globalSearch(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.products).toHaveLength(0);
    expect(data.data.ads).toHaveLength(0);
  });

  it("Rejects search query exceeding 100 characters", async () => {
    const longQuery = "x".repeat(101);
    const req = makeSearchRequest(workspaceAlphaId, longQuery);
    const res = await globalSearch(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  it("Rejects unauthorized request when invalid Bearer token is passed", async () => {
    const req = makeSearchRequest(workspaceAlphaId, "clean", "Bearer invalid_secret_token_123");
    const res = await globalSearch(req);
    expect([401, 403]).toContain(res.status);
    const data = await res.json();
    expect(data.success).toBe(false);
  });
});
