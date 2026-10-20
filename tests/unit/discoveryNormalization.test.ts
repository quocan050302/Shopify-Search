import { describe, it, expect } from "vitest";
import {
  normalizeTikTokTopAd,
  validateSourceReportedDates,
  resolveAdvertiserIdentity,
} from "@/services/discovery/normalization/normalizeTikTokTopAd";
import { RawDiscoveredAd } from "@/services/discovery/types";

describe("TikTok Discovery Normalization & Data Integrity", () => {
  const baseRaw: RawDiscoveredAd = {
    providerId: "tiktok-topads",
    sourceUrl: "https://ads.tiktok.com/business/creativecenter/topads/7680863927458562066/pc/en",
    sourceId: "7680863927458562066",
    rawMetadata: {
      material_id: "7680863927458562066",
      brand_name: "Lumina Skin Care",
      title: "Get flawless glowing skin in 7 days",
      industry_key: "BEAUTY_PERSONAL_CARE",
      objective_key: "CONVERSIONS",
      landing_page_url: "https://luminaskin.example.com/shop",
      like_cnt: 45000,
      share_cnt: 3200,
      comment_cnt: 1100,
      video_duration: 25,
      cover_url: "https://p16.tiktokcdn.com/cover.jpg",
      first_shown_timestamp: 1710000000, // valid past timestamp
      last_shown_timestamp: 1712000000,
      country: "US",
    },
    retrievedAt: new Date("2026-10-20T10:00:00Z"),
  };

  it("maps real provider fields accurately to normalized structure", () => {
    const normalized = normalizeTikTokTopAd(baseRaw, {
      providerId: "tiktok-topads",
      queryMarket: "US",
    });

    expect(normalized.platform).toBe("TIKTOK");
    expect(normalized.providerId).toBe("tiktok-topads");
    expect(normalized.sourceExternalId).toBe("7680863927458562066");
    expect(normalized.advertiserName).toBe("Lumina Skin Care");
    expect(normalized.headline).toBe("Get flawless glowing skin in 7 days");
    expect(normalized.industry).toBe("BEAUTY_PERSONAL_CARE");
    expect(normalized.landingPageUrl).toBe("https://luminaskin.example.com/shop");
    expect(normalized.reportedMetrics.likes).toBe(45000);
  });

  it("never fabricates CTR, CVR, or spend metrics when missing from raw payload", () => {
    const normalized = normalizeTikTokTopAd(baseRaw);

    expect(normalized.reportedMetrics.ctr).toBeNull();
    expect(normalized.reportedMetrics.cvr).toBeNull();
  });

  it("marks Creative Center ads as RESTRICTED with isPlayable: false semantics", () => {
    const normalized = normalizeTikTokTopAd(baseRaw);

    expect(normalized.mediaAvailability).toBe("RESTRICTED");
    expect(normalized.creativeUrl).toContain("ads.tiktok.com");
  });

  it("validates source-reported dates and rejects reversed ranges", () => {
    // Valid dates
    const valid = validateSourceReportedDates(1710000000, 1712000000);
    expect(valid.sourceReportedFirstSeen).toBeInstanceOf(Date);
    expect(valid.sourceReportedLastSeen).toBeInstanceOf(Date);

    // Reversed dates (firstSeen > lastSeen)
    const reversed = validateSourceReportedDates(1712000000, 1710000000);
    expect(reversed.sourceReportedFirstSeen).toBeUndefined();
    expect(reversed.sourceReportedLastSeen).toBeUndefined();

    // Future dates
    const future = validateSourceReportedDates(Date.now() + 100000000000);
    expect(future.sourceReportedFirstSeen).toBeUndefined();
  });

  it("resolves advertiser identity safely without collapsing unrelated unknowns", () => {
    const adv1 = resolveAdvertiserIdentity("Brand A", "ext_123");
    expect(adv1.name).toBe("Brand A");
    expect(adv1.externalId).toBe("ext_123");

    const advUnknown1 = resolveAdvertiserIdentity("", "mat_999");
    expect(advUnknown1.name).toBe("TikTok Advertiser mat_999");

    const advUnknown2 = resolveAdvertiserIdentity("", "mat_888");
    expect(advUnknown2.name).toBe("TikTok Advertiser mat_888");
    expect(advUnknown1.name).not.toBe(advUnknown2.name);
  });

  it("handles raw payloads without numeric IDs by falling back to stable canonical URL hash", () => {
    const rawNoId: RawDiscoveredAd = {
      providerId: "tiktok-topads",
      sourceUrl: "https://ads.tiktok.com/business/creativecenter/topads/custom-creative-page",
      rawMetadata: { title: "Ad without explicit material ID" },
      retrievedAt: new Date(),
    };

    const normalized = normalizeTikTokTopAd(rawNoId);
    expect(normalized.stableIdentityHash).toMatch(/^[a-f0-9]{32}$/);
    expect(normalized.confidenceScore).toBeLessThanOrEqual(0.8);
  });
});
