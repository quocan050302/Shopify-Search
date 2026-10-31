import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getKH02SourceCapabilities,
  listKH02SourceCapabilities,
  checkKH02ProviderReadiness,
  estimateResearchProviderCost,
} from "@/services/kh02/providers/sourceRegistry";
import { normalizeTikTokOrganicVideo } from "@/services/kh02/providers/tiktokOrganicResearchAdapter";

describe("SWAI KH-02 — Multi-Source Adapters & Readiness", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("lists all 5 intelligence sources with truthful geographic and cost capability declarations", () => {
    const capabilities = listKH02SourceCapabilities();
    expect(capabilities).toHaveLength(5);

    const meta = getKH02SourceCapabilities("META_ADS");
    expect(meta.supportsUS).toBe(true);
    expect(meta.isPaidOrMetered).toBe(false);

    const ttAds = getKH02SourceCapabilities("TIKTOK_ADS");
    expect(ttAds.supportsUS).toBe(true);
    expect(ttAds.coverageDescription).toContain("TikTok Creative Center Top Ads for US commercial trends");

    const ttOrganic = getKH02SourceCapabilities("TIKTOK_ORGANIC");
    expect(ttOrganic.supportsUS).toBe(false); // Global public videos
    expect(ttOrganic.isPaidOrMetered).toBe(true); // Metered HasData API

    const google = getKH02SourceCapabilities("GOOGLE_ADS");
    expect(google.supportsAdvertiserSearch).toBe(true);
    expect(google.supportsKeywordSearch).toBe(false); // Lookup by advertiser domain only
  });

  it("safeguards against unapproved paid research by blocking metered queries when AUTO_PAID_RESEARCH is false", () => {
    delete process.env.AUTO_PAID_RESEARCH;

    const estimate = estimateResearchProviderCost("TIKTOK_ORGANIC", {
      workspaceId: "ws_test",
      researchRunId: "run_test",
      topic: "Pet Gadgets",
      market: "US",
      lookbackDays: 90,
      maxResults: 20,
    });

    expect(estimate.requiresPaidApproval).toBe(true);
    expect(estimate.isAllowed).toBe(false);
    expect(estimate.reason).toContain("Automatic paid research is disabled by default");
  });

  it("normalizes TikTok organic video metrics without fabricating engagement", () => {
    const rawVideo = {
      id: "7123456789012345678",
      desc: "This viral pet hair roller literally saved my velvet sofa #petgadgets #cleaninghacks",
      create_time: Math.floor(Date.now() / 1000) - (10 * 24 * 60 * 60), // 10 days ago
      play_count: 500000,
      digg_count: 25000,
      comment_count: 1500,
      share_count: 3500,
      collect_count: 8000,
      author: {
        unique_id: "cleanwithchloe",
        uid: "user_8899",
      },
      video: {
        cover: { url_list: ["https://p16-sign.tiktokcdn.com/thumb.jpg"] },
      },
    };

    const normalized = normalizeTikTokOrganicVideo(rawVideo);
    expect(normalized.videoId).toBe("7123456789012345678");
    expect(normalized.creatorHandle).toBe("cleanwithchloe");
    expect(normalized.views).toBe(500000);
    expect(normalized.likes).toBe(25000);

    // Engagement ratio = (25000 + 1500 + 3500) / 500000 = 30000 / 500000 = 6.00%
    expect(normalized.observedEngagementRatio).toBe(6);

    // Lifetime views/day estimate = 500,000 / 10 days = 50,000/day
    expect(normalized.lifetimeViewsPerDayEstimate).toBe(50000);

    // Regional market is unconfirmed from global public payload
    expect(normalized.targetMarketEvidence).toBeNull();
  });

  it("checks readiness and reports NOT_VERIFIED truthfully for TikTok Ads US when automated provider is unconfigured", async () => {
    const readiness = await checkKH02ProviderReadiness("TIKTOK_ADS");
    expect(readiness.ready).toBe(true);
    expect(readiness.status).toBe("NOT_VERIFIED");
    expect(readiness.reason).toContain("Automated TikTok US ad provider is unconfigured");
  });
});
