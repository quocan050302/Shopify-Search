import { describe, it, expect } from "vitest";
import { searchCompetitorAds, getAdvertisementDetails } from "@/services/ads/adService";

describe("Competitor Ads Service", () => {
  it("searches competitor ads with pagination", async () => {
    const result = await searchCompetitorAds({ page: 1, pageSize: 10 });
    expect(result.pagination.total).toBeGreaterThanOrEqual(6);
    expect(result.ads.length).toBeGreaterThanOrEqual(6);

    const first = result.ads[0];
    expect(first.advertiser).toBeDefined();
    expect(first.mediaAssets.length).toBeGreaterThan(0);
    expect(first.researchScores.length).toBeGreaterThan(0);
    expect(first.dataConfidence).toBeDefined();
  });

  it("filters ads by category and platform", async () => {
    const metaAds = await searchCompetitorAds({ platform: "META" });
    expect(metaAds.ads.every((a) => a.platform === "META")).toBe(true);

    const beautyAds = await searchCompetitorAds({ category: "Beauty & Personal Care" });
    expect(beautyAds.ads.some((a) => a.category === "Beauty & Personal Care")).toBe(true);
  });

  it("retrieves complete advertisement details and provenance links", async () => {
    const all = await searchCompetitorAds({ page: 1, pageSize: 1 });
    const id = all.ads[0].id;

    const details = await getAdvertisementDetails(id);
    expect(details).not.toBeNull();
    expect(details?.originalAdUrl).toContain("http");
    expect(Array.isArray(details?.analyses)).toBe(true);
  });
});
