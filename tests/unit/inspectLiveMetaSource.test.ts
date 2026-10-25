import { describe, it, expect } from "vitest";
import { inspectLiveMetaSourceResult } from "@/services/discovery/metaCollector/inspectLiveMetaSource";
import { MetaCollectorRawAd, MetaCollectorSearchResponse } from "@/services/discovery/metaCollector/metaCollectorTypes";

describe("inspectLiveMetaSourceResult Helper (Section 09)", () => {
  it("classifies genuine real upstream response with numeric Meta Library IDs as REAL_UPSTREAM and PASSED", () => {
    const rawAds: MetaCollectorRawAd[] = [
      {
        id: "1536941208479218",
        source_url: "https://www.facebook.com/ads/library/?id=1536941208479218",
        page: {
          id: "10987654321",
          name: "Innovative Gadgets Inc",
        },
        creatives: [
          {
            title: "Smart Home Gadget",
            body: "The best gadget in 2026",
            image_url: "https://scontent.xx.fbcdn.net/img.jpg",
          },
        ],
      },
      {
        id: "1464108218882438",
        source_url: "https://www.facebook.com/ads/library/?id=1464108218882438",
        page: {
          id: "10987654322",
          name: "Kitchen Gadgets Co",
        },
        creatives: [
          {
            title: "Multi-tool gadget",
            body: "Great gadget for home",
          },
        ],
      },
    ];

    const mcpResponse: MetaCollectorSearchResponse = {
      result_set_id: "rs_genuine_12345",
      job: {
        id: "job_genuine_12345",
        state: "LIMIT_REACHED",
        count: 2,
        stats: {
          requests_made: 2,
          ads_collected: 2,
        },
      },
      ads: rawAds,
      retrieval_pending: false,
      data_status: "partial",
      untrusted_ad_content: false,
    };

    const result = inspectLiveMetaSourceResult({
      transport: "stdio",
      requestedKeyword: "gadget",
      requestedMarket: "US",
      requestedLimit: 25,
      mcpResponse,
      rawAds,
    });

    expect(result.sourceClassification).toBe("REAL_UPSTREAM");
    expect(result.status).toBe("PASSED");
    expect(result.upstreamRequestObserved).toBe(true);
    expect(result.upstreamResponseObserved).toBe(true);
    expect(result.isFixture).toBe(false);
    expect(result.adsReturned).toBe(2);
    expect(result.validSourceIds).toBe(2);
    expect(result.missingLibraryIds).toBe(0);
    expect(result.duplicateLibraryIds).toHaveLength(0);
    expect(result.recordsWithAdvertisers).toBe(2);
    expect(result.recordsWithSourceUrls).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it("classifies test fixture transport as TEST_FIXTURE", () => {
    const rawAds: MetaCollectorRawAd[] = [
      {
        id: "mock_ad_1",
        page: { id: "p1", name: "Mock Advertiser" },
      },
    ];

    const result = inspectLiveMetaSourceResult({
      transport: "mock_test_boundary",
      requestedKeyword: "gadget",
      rawAds,
    });

    expect(result.sourceClassification).toBe("TEST_FIXTURE");
    expect(result.isFixture).toBe(true);
    expect(result.upstreamRequestObserved).toBe(false);
    expect(result.upstreamResponseObserved).toBe(false);
    expect(result.status).toBe("PASSED");
  });

  it("detects empty results and classifies as NO_RESULTS", () => {
    const mcpResponse: MetaCollectorSearchResponse = {
      result_set_id: "rs_empty",
      job: {
        id: "job_empty",
        state: "COMPLETED",
        count: 0,
        stats: { requests_made: 1, ads_collected: 0 },
      },
      ads: [],
      retrieval_pending: false,
      data_status: "query_exhausted",
      untrusted_ad_content: false,
    };

    const result = inspectLiveMetaSourceResult({
      transport: "stdio",
      requestedKeyword: "nonexistentquery123xyz",
      mcpResponse,
      rawAds: [],
    });

    expect(result.adsReturned).toBe(0);
    expect(result.status).toBe("NO_RESULTS");
    expect(result.sourceClassification).toBe("UNKNOWN");
  });

  it("detects rate limits or upstream blocks and classifies as BLOCKED", () => {
    const resultBlocked = inspectLiveMetaSourceResult({
      transport: "stdio",
      requestedKeyword: "gadget",
      error: new Error("Meta Ad Library access restricted: blocked captcha challenge"),
    });

    expect(resultBlocked.status).toBe("BLOCKED");
    expect(resultBlocked.errors.length).toBeGreaterThan(0);

    const resultRateLimited = inspectLiveMetaSourceResult({
      transport: "stdio",
      requestedKeyword: "gadget",
      error: new Error("HTTP 429 rate limit exceeded"),
    });

    expect(resultRateLimited.status).toBe("BLOCKED");
  });

  it("detects duplicate and missing library IDs in real mode", () => {
    const rawAds: MetaCollectorRawAd[] = [
      { id: "123456789012345", page: { id: "p1", name: "Ad 1" } },
      { id: "123456789012345", page: { id: "p1", name: "Ad 1 duplicate" } },
      { id: "invalid-id-xyz", page: { id: "p2", name: "Ad 2" } },
      { id: "", page: { id: "p3", name: "Ad 3" } },
    ];

    const result = inspectLiveMetaSourceResult({
      transport: "stdio",
      requestedKeyword: "gadget",
      rawAds,
    });

    expect(result.adsReturned).toBe(4);
    expect(result.validSourceIds).toBe(1);
    expect(result.missingLibraryIds).toBe(2); // invalid-id-xyz and empty string
    expect(result.duplicateLibraryIds).toEqual(["123456789012345"]);
  });
});
