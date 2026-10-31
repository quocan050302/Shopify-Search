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

  describe("Provenance Negative Tests (Section 26: PROV-01 to PROV-07)", () => {
    // PROV-01: transport = stdio, resultSetId exists, requests_made missing, ads present
    it("PROV-01: rejects upstream request when requests_made is missing even if resultSetId exists", () => {
      const rawAds: MetaCollectorRawAd[] = [
        { id: "123456789012345", page: { id: "p1", name: "Real Advertiser" } },
      ];
      const mcpResponse: MetaCollectorSearchResponse = {
        result_set_id: "rs_existing_cached_set",
        job: {
          id: "job_cached",
          state: "COMPLETED",
          count: 1,
          stats: {}, // requests_made is MISSING!
        },
        ads: rawAds,
        retrieval_pending: false,
        data_status: "partial",
        untrusted_ad_content: false,
      };

      const result = inspectLiveMetaSourceResult({
        transport: "stdio",
        requestedKeyword: "gadget",
        resultSetId: "rs_existing_cached_set",
        mcpResponse,
        rawAds,
      });

      expect(result.upstreamRequestObserved).toBe(false);
      expect(result.sourceClassification).toBe("UNKNOWN");
      expect(result.status).toBe("FAILED");
    });

    // PROV-02: requests_made = 0, ads present
    it("PROV-02: cannot claim fresh upstream request when requests_made = 0", () => {
      const rawAds: MetaCollectorRawAd[] = [
        { id: "123456789012345", page: { id: "p1", name: "Real Advertiser" } },
      ];
      const mcpResponse: MetaCollectorSearchResponse = {
        result_set_id: "rs_cached_0_req",
        job: {
          id: "job_0_req",
          state: "COMPLETED",
          count: 1,
          stats: { requests_made: 0, ads_collected: 1 },
        },
        ads: rawAds,
        retrieval_pending: false,
        data_status: "partial",
        untrusted_ad_content: false,
      };

      const result = inspectLiveMetaSourceResult({
        transport: "stdio",
        requestedKeyword: "gadget",
        mcpResponse,
        rawAds,
      });

      expect(result.upstreamRequestObserved).toBe(false);
      expect(result.sourceClassification).toBe("UNKNOWN");
      expect(result.status).toBe("FAILED");
    });

    // PROV-03: requests_made = 1, ads_collected = 2, real numeric IDs, transport = stdio
    it("PROV-03: eligible for REAL_UPSTREAM when requests_made >= 1 and valid numeric IDs exist", () => {
      const rawAds: MetaCollectorRawAd[] = [
        { id: "123456789012345", page: { id: "p1", name: "Real Advertiser" } },
        { id: "987654321098765", page: { id: "p2", name: "Real Advertiser 2" } },
      ];
      const mcpResponse: MetaCollectorSearchResponse = {
        result_set_id: "rs_live_123",
        job: {
          id: "job_live_123",
          state: "COMPLETED",
          count: 2,
          stats: { requests_made: 1, ads_collected: 2 },
        },
        ads: rawAds,
        retrieval_pending: false,
        data_status: "partial",
        untrusted_ad_content: false,
      };

      const result = inspectLiveMetaSourceResult({
        transport: "stdio",
        requestedKeyword: "gadget",
        mcpResponse,
        rawAds,
      });

      expect(result.upstreamRequestObserved).toBe(true);
      expect(result.upstreamResponseObserved).toBe(true);
      expect(result.sourceClassification).toBe("REAL_UPSTREAM");
      expect(result.status).toBe("PASSED");
    });

    // PROV-04: mock_test_boundary, requests_made = 100
    it("PROV-04: classifies mock_test_boundary as TEST_FIXTURE regardless of requests_made", () => {
      const rawAds: MetaCollectorRawAd[] = [
        { id: "mock_ad_1", page: { id: "p1", name: "Mock Advertiser" } },
      ];
      const mcpResponse: MetaCollectorSearchResponse = {
        result_set_id: "rs_mock",
        job: {
          id: "job_mock",
          state: "COMPLETED",
          count: 1,
          stats: { requests_made: 100, ads_collected: 1 },
        },
        ads: rawAds,
        retrieval_pending: false,
        data_status: "partial",
        untrusted_ad_content: false,
      };

      const result = inspectLiveMetaSourceResult({
        transport: "mock_test_boundary",
        requestedKeyword: "gadget",
        mcpResponse,
        rawAds,
      });

      expect(result.sourceClassification).toBe("TEST_FIXTURE");
      expect(result.isFixture).toBe(true);
      expect(result.upstreamRequestObserved).toBe(false);
    });

    // PROV-05: Stored/cached result page (no new upstream request)
    it("PROV-05: does not falsely claim fresh upstream request on stored/cached results", () => {
      const rawAds: MetaCollectorRawAd[] = [
        { id: "123456789012345", page: { id: "p1", name: "Ad from cache" } },
      ];
      // Job with 0 requests made (read directly from local sqlite)
      const mcpResponse: MetaCollectorSearchResponse = {
        result_set_id: "rs_stored_cache",
        job: {
          id: "job_cache_read",
          state: "COMPLETED",
          count: 1,
          stats: { requests_made: 0, ads_collected: 1 },
        },
        ads: rawAds,
        retrieval_pending: false,
        data_status: "partial",
        untrusted_ad_content: false,
      };

      const result = inspectLiveMetaSourceResult({
        transport: "stdio",
        requestedKeyword: "gadget",
        mcpResponse,
        rawAds,
      });

      expect(result.upstreamRequestObserved).toBe(false);
      expect(result.sourceClassification).toBe("UNKNOWN");
    });

    // PROV-06: Non-numeric ID in real mode marks invalid
    it("PROV-06: rejects non-numeric Meta Library IDs in real live mode", () => {
      const rawAds: MetaCollectorRawAd[] = [
        { id: "synthetic_fake_ad_123", page: { id: "p1", name: "Fake" } },
      ];
      const mcpResponse: MetaCollectorSearchResponse = {
        result_set_id: "rs_fake",
        job: {
          id: "job_fake",
          state: "COMPLETED",
          count: 1,
          stats: { requests_made: 1, ads_collected: 1 },
        },
        ads: rawAds,
        retrieval_pending: false,
        data_status: "partial",
        untrusted_ad_content: false,
      };

      const result = inspectLiveMetaSourceResult({
        transport: "stdio",
        requestedKeyword: "gadget",
        mcpResponse,
        rawAds,
      });

      expect(result.validSourceIds).toBe(0);
      expect(result.missingLibraryIds).toBe(1);
      expect(result.status).toBe("FAILED");
    });

    // PROV-07: Error or rate limit leads to BLOCKED status
    it("PROV-07: classifies upstream rate limiting or blocking as BLOCKED status", () => {
      const result = inspectLiveMetaSourceResult({
        transport: "stdio",
        requestedKeyword: "gadget",
        error: new Error("Rate limit exceeded: 429 Too Many Requests"),
      });

      expect(result.status).toBe("BLOCKED");
      expect(result.sourceClassification).toBe("UNKNOWN");
    });
  });
});
