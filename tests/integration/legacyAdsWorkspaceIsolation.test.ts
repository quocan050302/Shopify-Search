import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { GET as adsGet, POST as adsPost } from "@/app/api/v1/ads/route";
import { GET as adDetailGet } from "@/app/api/v1/ads/[id]/route";

describe("Legacy Ads API Workspace Scoping & Isolation Integration", () => {
  const wsA = "ws_legacy_ads_a";
  const wsB = "ws_legacy_ads_b";
  const adIdA = "ad_legacy_ws_a";
  const adIdB = "ad_legacy_ws_b";
  const advertiserId = "adv_legacy_scoped";
  const dataSourceId = "ds_legacy_scoped";

  beforeAll(async () => {
    // Clean up any existing records
    await prisma.watchlistItem.deleteMany({ where: { adId: { in: [adIdA, adIdB] } } });
    await prisma.discoveryRunAd.deleteMany({ where: { adId: { in: [adIdA, adIdB] } } });
    await prisma.competitorAd.deleteMany({ where: { id: { in: [adIdA, adIdB] } } });
    await prisma.watchlist.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [wsA, wsB] } } });

    // Create Workspaces
    await prisma.workspace.createMany({
      data: [
        { id: wsA, name: "Workspace Legacy A" },
        { id: wsB, name: "Workspace Legacy B" },
      ],
    });

    // Create Advertiser & DataSource
    await prisma.advertiser.upsert({
      where: { id: advertiserId },
      create: { id: advertiserId, platform: "META", name: "Scoped Advertiser" },
      update: {},
    });

    await prisma.dataSource.upsert({
      where: { id: dataSourceId },
      create: {
        id: dataSourceId,
        name: "META_LEGACY_SCOPED",
        displayName: "Scoped DataSource",
        capabilities: JSON.stringify(["SEARCH"]),
        supportedRegions: JSON.stringify(["US"]),
      },
      update: {},
    });

    // Create Ad A & Ad B
    await prisma.competitorAd.create({
      data: {
        id: adIdA,
        advertiserId,
        dataSourceId,
        platform: "META",
        headline: "Super Gadget Workspace A Exclusive",
        originalAdUrl: "https://facebook.com/ads/library/?id=1001",
        dataConfidence: "OBSERVED",
      },
    });

    await prisma.competitorAd.create({
      data: {
        id: adIdB,
        advertiserId,
        dataSourceId,
        platform: "META",
        headline: "Private Item Workspace B Exclusive",
        originalAdUrl: "https://facebook.com/ads/library/?id=1002",
        dataConfidence: "OBSERVED",
      },
    });

    // Link Ad A to Workspace A via Watchlist
    const wlA = await prisma.watchlist.create({
      data: { workspaceId: wsA, name: "Imported Ads" },
    });
    await prisma.watchlistItem.create({
      data: { watchlistId: wlA.id, itemType: "AD", adId: adIdA },
    });

    // Link Ad B to Workspace B via Watchlist
    const wlB = await prisma.watchlist.create({
      data: { workspaceId: wsB, name: "Imported Ads" },
    });
    await prisma.watchlistItem.create({
      data: { watchlistId: wlB.id, itemType: "AD", adId: adIdB },
    });
  });

  afterAll(async () => {
    await prisma.watchlistItem.deleteMany({ where: { adId: { in: [adIdA, adIdB] } } });
    await prisma.discoveryRunAd.deleteMany({ where: { adId: { in: [adIdA, adIdB] } } });
    await prisma.competitorAd.deleteMany({ where: { id: { in: [adIdA, adIdB] } } });
    await prisma.watchlist.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [wsA, wsB] } } });
  });

  it("Workspace A caller querying GET /api/v1/ads receives ONLY Workspace A ads", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/ads", {
      headers: { "x-workspace-id": wsA },
    });
    const res = await adsGet(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    const ids = json.data.map((a: any) => a.id);
    expect(ids).toContain(adIdA);
    expect(ids).not.toContain(adIdB);
  });

  it("Workspace B caller querying GET /api/v1/ads receives ONLY Workspace B ads", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/ads", {
      headers: { "x-workspace-id": wsB },
    });
    const res = await adsGet(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    const ids = json.data.map((a: any) => a.id);
    expect(ids).toContain(adIdB);
    expect(ids).not.toContain(adIdA);
  });

  it("Workspace A caller querying details of Workspace B ad is rejected with 403", async () => {
    const req = new NextRequest(`http://localhost:3000/api/v1/ads/${adIdB}`, {
      headers: { "x-workspace-id": wsA },
    });
    const res = await adDetailGet(req, { params: Promise.resolve({ id: adIdB }) });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("FORBIDDEN_WORKSPACE_AD");
  });

  it("Workspace A caller querying details of Workspace A ad succeeds with 200", async () => {
    const req = new NextRequest(`http://localhost:3000/api/v1/ads/${adIdA}`, {
      headers: { "x-workspace-id": wsA },
    });
    const res = await adDetailGet(req, { params: Promise.resolve({ id: adIdA }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.id).toBe(adIdA);
  });

  it("POST /api/v1/ads attaches imported ad strictly to caller's workspace", async () => {
    const importUrl = "https://www.facebook.com/ads/library/?id=9988776655";
    const req = new NextRequest("http://localhost:3000/api/v1/ads", {
      method: "POST",
      headers: { "x-workspace-id": wsA },
      body: JSON.stringify({
        url: importUrl,
        advertiserName: "Imported Brand",
        headline: "Newly Imported Item",
      }),
    });
    const res = await adsPost(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    const importedId = json.data.id;

    // Check visibility for Workspace A
    const reqA = new NextRequest(`http://localhost:3000/api/v1/ads/${importedId}`, {
      headers: { "x-workspace-id": wsA },
    });
    const resA = await adDetailGet(reqA, { params: Promise.resolve({ id: importedId }) });
    expect(resA.status).toBe(200);

    // Check visibility for Workspace B (MUST BE 403!)
    const reqB = new NextRequest(`http://localhost:3000/api/v1/ads/${importedId}`, {
      headers: { "x-workspace-id": wsB },
    });
    const resB = await adDetailGet(reqB, { params: Promise.resolve({ id: importedId }) });
    expect(resB.status).toBe(403);
  });
});
