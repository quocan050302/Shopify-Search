import { describe, it, expect } from "vitest";
import { searchCompetitorAds, getAdvertisementDetails } from "@/services/ads/adService";
import {
  isSampleOrFakeMedia,
  isSyntheticAdId,
} from "@/services/video/videoSourceResolver";

describe("Competitor Ads Service", () => {
  it("searches production records (excludes SYNTHETIC_DEMO by default)", async () => {
    // Default search excludes quarantined synthetic records
    const result = await searchCompetitorAds({ page: 1, pageSize: 20 });

    // The Test Brand Labs record (UNKNOWN status, UNVERIFIED confidence) may appear
    // All 6 original seed records (UNAVAILABLE confidence) must NOT appear
    for (const ad of result.ads) {
      expect(ad.dataConfidence).not.toBe("UNAVAILABLE");
      expect(ad.headline?.startsWith("[SYNTHETIC_DEMO]")).toBe(false);
    }

    // isSyntheticAdId correctly identifies synthetic IDs
    expect(isSyntheticAdId("meta_bleame_crystal_hair_eraser_01")).toBe(true);
    expect(isSyntheticAdId("tiktok_ridge_wallet_titanium_02")).toBe(true);
    expect(isSyntheticAdId("999888777")).toBe(false);
    expect(isSyntheticAdId("7123456789012345")).toBe(false);
  });

  it("includes synthetic records when explicitly requested", async () => {
    const withSynthetic = await searchCompetitorAds({ includeSynthetic: true, pageSize: 20 });
    const withoutSynthetic = await searchCompetitorAds({ includeSynthetic: false, pageSize: 20 });

    // Must find MORE records when including synthetic
    expect(withSynthetic.pagination.total).toBeGreaterThan(withoutSynthetic.pagination.total);

    // Synthetic records must be INACTIVE with UNAVAILABLE confidence
    const syntheticAds = withSynthetic.ads.filter((a) => a.dataConfidence === "UNAVAILABLE");
    for (const ad of syntheticAds) {
      expect(ad.status).toBe("INACTIVE");
    }
  });

  it("filters platform correctly", async () => {
    const metaAds = await searchCompetitorAds({ platform: "META", includeSynthetic: true });
    expect(metaAds.ads.every((a) => a.platform === "META")).toBe(true);

    const tiktokAds = await searchCompetitorAds({ platform: "TIKTOK", includeSynthetic: true });
    expect(tiktokAds.ads.every((a) => a.platform === "TIKTOK")).toBe(true);
  });

  it("isSampleOrFakeMedia correctly identifies sample videos", () => {
    expect(
      isSampleOrFakeMedia(
        "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
      )
    ).toBe(true);
    expect(isSampleOrFakeMedia(null)).toBe(false);
    expect(isSampleOrFakeMedia("https://example.com/video.mp4")).toBe(false);
  });
});
