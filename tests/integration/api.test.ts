import { describe, it, expect } from "vitest";
import { GET as getHealth } from "@/app/api/v1/health/route";
import { GET as getProviders } from "@/app/api/v1/providers/route";
import { GET as getAds, POST as importAd } from "@/app/api/v1/ads/route";
import { GET as getProducts } from "@/app/api/v1/products/route";
import { GET as getSettings } from "@/app/api/v1/settings/integrations/route";
import { NextRequest } from "next/server";

describe("Versioned API Endpoints (v1)", () => {
  it("GET /api/v1/health returns healthy status and RESEARCH_ONLY mode", async () => {
    const res = await getHealth();
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.operatingMode).toBe("RESEARCH_ONLY");
    expect(json.data.targetMarket).toBe("US");
    expect(json.data.database).toBe("CONNECTED");
    expect(json.data.isolationVerified).toBe(true);
  });

  it("GET /api/v1/providers lists data sources", async () => {
    const res = await getProviders();
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.some((p: any) => p.name === "META_AD_LIBRARY")).toBe(true);
  });

  it("GET /api/v1/ads returns paginated real ads with source provenance", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/ads?pageSize=5");
    const res = await getAds(req);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.length).toBeGreaterThanOrEqual(1);
    expect(json.data[0].originalAdUrl).toContain("http");
    expect(json.pagination.total).toBeGreaterThanOrEqual(1);
  });

  it("POST /api/v1/ads imports and resolves a new competitor ad link", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/ads", {
      method: "POST",
      body: JSON.stringify({
        url: "https://www.facebook.com/ads/library/?id=999888777",
        advertiserName: "Test Brand Labs",
        headline: "Innovative ergonomic neck cloud cushion",
        category: "Health & Wellness Products",
      }),
    });

    const res = await importAd(req);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.externalAdId).toBe("999888777");
    expect(json.data.platform).toBe("META");
    expect(json.data.originalAdUrl).toContain("facebook.com");
  });

  it("GET /api/v1/settings/integrations reports NOT_CONNECTED for Shopify and Ad Managers", async () => {
    const res = await getSettings();
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.operatingMode).toBe("RESEARCH_ONLY");
    expect(json.data.integrations.shopify.status).toBe("NOT_CONNECTED");
    expect(json.data.integrations.metaAdsManager.status).toBe("NOT_CONNECTED");
    expect(json.data.integrations.tiktokAdsManager.status).toBe("NOT_CONNECTED");
  });
});
