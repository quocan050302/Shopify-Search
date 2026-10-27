import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDemandProvider } from "@/services/kh02/demand/demandProviderRegistry";
import { collectGoogleAdvertiserSignals, normalizeGoogleAdsResponse } from "@/services/kh02/providers/googleTransparencyResearchAdapter";
import { collectTikTokOrganicEvidence, normalizeTikTokOrganicVideo } from "@/services/kh02/providers/tiktokOrganicResearchAdapter";
import { diagnoseKH02Source } from "@/services/kh02/providers/sourceRegistry";

const query = { term: "dog grooming brush", region: "US", startDate: new Date("2026-06-01"), endDate: new Date("2026-09-01") };
const freeAccount = { account_status: "Active", plan_id: "free", plan_name: "Free", plan_monthly_price: 0, total_searches_left: 250 };
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.stubEnv("SERPAPI_API_KEY", "test-private-key");
  vi.stubEnv("AUTO_PAID_RESEARCH", "false");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Free provider contracts", () => {
  it("requests exact date range and persists epoch timestamps, never display ranges", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(freeAccount)).mockResolvedValueOnce(response({ interest_over_time: { timeline_data: [
      { date: "Jun 7 - 13, 2026", timestamp: "1780790400", values: [{ extracted_value: 80 }] },
      { timestamp: "1781395200", values: [{ value: "<1" }] },
      { timestamp: "invalid", values: [{ extracted_value: 70 }] },
      { timestamp: "1781395200", values: [{ extracted_value: -1 }] },
    ] } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await defaultDemandProvider.fetchSeries(query);
    expect(result.status).toBe("SUCCESS");
    expect(result.points).toHaveLength(2);
    expect(result.points[0].periodStart).toBe("2026-06-07T00:00:00.000Z");
    expect(result.points[1].demandValue).toBe(0.5);
    const url = new URL(String(fetchMock.mock.calls[1][0]));
    expect(url.searchParams.get("date")).toBe("2026-06-01 2026-09-01");
    expect(url.searchParams.get("data_type")).toBe("TIMESERIES");
  });

  it.each([
    { ...freeAccount, plan_id: "starter", plan_name: "Starter", plan_monthly_price: 25 },
    { ...freeAccount, total_searches_left: 0 },
    { ...freeAccount, total_searches_left: undefined },
  ])("does not query a paid, exhausted, or unknown account: %j", async account => {
    const fetchMock = vi.fn().mockResolvedValue(response(account));
    vi.stubGlobal("fetch", fetchMock);
    expect((await defaultDemandProvider.fetchSeries(query)).status).toBe("BLOCKED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not mark the unimplemented Google alpha key as an active provider", async () => {
    vi.stubEnv("SERPAPI_API_KEY", ""); vi.stubEnv("GOOGLE_TRENDS_API_KEY", "alpha-key");
    expect((await defaultDemandProvider.diagnose()).configured).toBe(false);
    const diag = await diagnoseKH02Source("DEMAND_HISTORY");
    expect(diag.transportStatus).toBe("NOT_CONFIGURED");
    expect(diag.transportConnected).toBeNull();
    expect(diag.missingRequirements).toContain("SERPAPI_API_KEY");
  });

  it("tests the non-metered account endpoint without spending search quota", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(freeAccount)); vi.stubGlobal("fetch", fetchMock);
    const diag = await diagnoseKH02Source("DEMAND_HISTORY", { checkLiveTransport: true });
    expect(diag.transportConnected).toBe(true);
    expect(diag.authenticated).toBe(true);
    expect(diag.queryExecuted).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/account.json");
  });

  it("does not leak a key when fetch errors contain URLs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("https://serpapi.com/account.json?api_key=test-private-key")));
    expect(JSON.stringify(await defaultDemandProvider.fetchSeries(query))).not.toContain("test-private-key");
  });

  it("reads the actual nested creative contract from the free Google MCP", () => {
    const result = normalizeGoogleAdsResponse({ ads: [{ advertiser_id: "AR1", creative_id: "CR1", format: "image", delivery_region: "US", content: { headline: "Dog grooming brush", description: "For pets", image_url: "https://example.com/brush.jpg" } }] }, { requestedDomain: "example.com", topic: "dog grooming", observedAt: new Date().toISOString(), toolName: "get_advertiser_ads" });
    expect(result.observations[0].title).toBe("Dog grooming brush");
    expect(result.observations[0].media?.thumbnailUrl).toBe("https://example.com/brush.jpg");
    expect(result.observations[0].verifiedDeliveryMarket).toBe("US");
  });

  it("does not label a failed creative lookup as a successful empty search", async () => {
    const client = {
      connect: vi.fn(), close: vi.fn(), isAlive: () => true,
      listTools: async () => ["search_advertiser", "get_advertiser_ads"],
      callToolByName: async (name: string) => { if (name === "search_advertiser") return { advertisers: [{ advertiser_id: "AR1" }] }; throw new Error("upstream blocked"); },
      searchAdvertisers: vi.fn(), searchAdvertiserByDomain: vi.fn(), getAds: vi.fn(), getAdDetail: vi.fn(),
    };
    const result = await collectGoogleAdvertiserSignals({ topic: "dog", market: "US", workspaceId: "test", lookbackDays: 90, researchRunId: "test-run", maxResults: 5, advertiserDomains: ["example.com"] }, client);
    expect(result.status).toBe("QUERY_FAILED");
  });
});


describe("HasData real response contract and free quota", () => {
  it("preserves plays, saves, captions, author and playable URLs from HasData fields", () => {
    const normalized = normalizeTikTokOrganicVideo({ id: "7675122879293410591", description: "A dog brush", plays: 10600, likes: 495, comments: 31, shares: 36, collects: 137, coverUrl: "https://example.com/cover.jpg", playUrl: "https://example.com/play.mp4", url: "https://www.tiktok.com/@person/video/7675122879293410591", author: { id: "7330816931056845866", username: "person" } });
    expect(normalized.views).toBe(10600);
    expect(normalized.saves).toBe(137);
    expect(normalized.caption).toBe("A dog brush");
    expect(normalized.creatorHandle).toBe("person");
    expect(normalized.videoUrl).toBe("https://example.com/play.mp4");
    expect(normalized.thumbnailUrl).toBe("https://example.com/cover.jpg");
  });

  it("allows verified Free credits while keeping AUTO_PAID_RESEARCH false", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ plan: "Free", remaining_credits: 1000 })).mockResolvedValueOnce(response({ videos: [{ id: "123", description: "Dog brush", plays: 500, likes: 20 }] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await collectTikTokOrganicEvidence({ topic: "dog brush" }, { apiKey: "test-hasdata-key" });
    expect(result.success).toBe(true);
    expect(result.videos[0].views).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).not.toContain("count=");
  });

  it.each(["Startup", undefined])("does not search with an unverified free plan: %s", async plan => {
    const fetchMock = vi.fn().mockResolvedValue(response({ plan, remaining_credits: 1000 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await collectTikTokOrganicEvidence({ topic: "dog brush" }, { apiKey: "test-hasdata-key" });
    expect(result.success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
