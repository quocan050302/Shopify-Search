import { describe, it, expect } from "vitest";
import {
  parseAndValidateTikTokUrl,
  buildTikTokPlayerUrl,
} from "@/services/tiktok/tiktokUrlParser";
import {
  buildTikTokTopAdsUrl,
  TIKTOK_TOP_ADS_US_DEFAULT_URL,
  validateTikTokMetadataIntegrity,
} from "@/services/tiktok/tiktokResearchService";
import {
  calculateAdLongevity,
} from "@/services/evergreen/longevityEngine";
import { resolveAdSourceUrl } from "@/services/providers/urlResolver";
import { POST as batchImportPost } from "@/app/api/v1/ads/batch/route";
import { NextRequest } from "next/server";

describe("TikTok Creative Center US & Genuine Post URL Parsing", () => {
  it("generates correct US prefiltered TikTok Top Ads URL", () => {
    expect(TIKTOK_TOP_ADS_US_DEFAULT_URL).toBe(
      "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US"
    );

    const customUrl = buildTikTokTopAdsUrl({ period: 180, region: "US" });
    expect(customUrl).toBe(
      "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=180&region=US"
    );
  });

  it("parses and validates TikTok Creative Center Top Ads detail URL", () => {
    const ccUrl = "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?id=7234567890123456789&period=30&region=US";
    const parsed = parseAndValidateTikTokUrl(ccUrl);

    expect(parsed.isValid).toBe(true);
    expect(parsed.isTikTok).toBe(true);
    expect(parsed.isCreativeCenter).toBe(true);
    expect(parsed.creativeId).toBe("7234567890123456789");
    expect(parsed.targetRegion).toBe("US");
    expect(parsed.searchWindowPeriodDays).toBe(30);
    // Creative Center ads are protected by TikTok and cannot be embedded
    expect(parsed.isEmbeddable).toBe(false);
    expect(parsed.embedUrl).toBeNull();
  });

  it("parses genuine TikTok public video post permalink and marks embeddable", () => {
    const postUrl = "https://www.tiktok.com/@glowskinco/video/7234567890987654321";
    const parsed = parseAndValidateTikTokUrl(postUrl);

    expect(parsed.isValid).toBe(true);
    expect(parsed.isTikTok).toBe(true);
    expect(parsed.isCreativeCenter).toBe(false);
    expect(parsed.postId).toBe("7234567890987654321");
    expect(parsed.authorHandle).toBe("glowskinco");
    expect(parsed.isEmbeddable).toBe(true);
    expect(parsed.embedUrl).toBe("https://www.tiktok.com/player/v1/7234567890987654321");
  });

  it("builds official TikTok player embed URL for valid post IDs", () => {
    expect(buildTikTokPlayerUrl("7234567890987654321")).toBe(
      "https://www.tiktok.com/player/v1/7234567890987654321"
    );
    expect(buildTikTokPlayerUrl("invalid_id")).toBeNull();
  });

  it("handles short links (vt.tiktok.com) and mobile shares safely", () => {
    const shortUrl = "https://vt.tiktok.com/ZS2abcd12/";
    const parsed = parseAndValidateTikTokUrl(shortUrl);

    expect(parsed.isValid).toBe(true);
    expect(parsed.isTikTok).toBe(true);
    expect(parsed.isCreativeCenter).toBe(false);
    // Short link does not have an immediate numeric post ID without follow redirect
    expect(parsed.isEmbeddable).toBe(false);
  });

  it("rejects non-TikTok or malicious URLs", () => {
    expect(parseAndValidateTikTokUrl("https://fake-tiktok.com/ad/123").isValid).toBe(false);
    expect(parseAndValidateTikTokUrl("not-a-url").isValid).toBe(false);
  });
});

describe("Metadata Integrity & 180-Day Search Window Separation", () => {
  it("warns when period=180 is present and explains search window boundary", () => {
    const ccUrl180 = "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?id=7234567890123456789&period=180&region=US";
    const parsed = parseAndValidateTikTokUrl(ccUrl180);

    expect(parsed.searchWindowPeriodDays).toBe(180);
    expect(parsed.searchWindowWarning).toBeDefined();
    expect(parsed.searchWindowWarning).toContain("180-day search window");
    expect(parsed.searchWindowWarning).toContain("does NOT verify 180 days of active ad delivery");
  });

  it("NEVER claims 180 days of active delivery or LONG_TERM_REFERENCE simply because of period=180", () => {
    const now = new Date("2026-10-20T10:00:00Z");

    // Ad discovered today with period=180 in the search query URL
    const result = calculateAdLongevity({
      adId: "tiktok-cc-test-1",
      platform: "TIKTOK",
      observations: [
        {
          observedAt: now,
          observationStatus: "ACTIVE",
        },
      ],
      searchWindowPeriodDays: 180,
      referenceDate: now,
    });

    // Calendar age should be based on observation (0 days), NOT 180 days!
    expect(result.calendarAgeDays).toBe(0);
    expect(result.longevityCategory).toBe("NEW_TESTING");
    expect(result.longevityCategory).not.toBe("LONG_TERM_REFERENCE");
    expect(result.longevityCategory).not.toBe("EVERGREEN_CANDIDATE");

    // Age note and explanation must explicitly clarify search window filter
    expect(result.ageNote).toContain("Search window filter was 180 days (never treated as verified delivery age)");
    expect(result.explanation).toContain("180-day search window filter — query window boundaries do NOT verify active delivery duration");
  });

  it("strictly separates observation time span from provider-reported calendar age", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    const sixtyDaysAgo = new Date("2026-08-21T10:00:00Z");
    const twoDaysAgo = new Date("2026-10-18T10:00:00Z");

    const result = calculateAdLongevity({
      adId: "tiktok-cc-test-2",
      platform: "TIKTOK",
      sourceReportedStartAt: sixtyDaysAgo, // Provider claims it started 60 days ago
      observations: [
        { observedAt: twoDaysAgo, observationStatus: "ACTIVE" },
        { observedAt: now, observationStatus: "ACTIVE" },
      ], // SWAI has only observed it for 2 days
      searchWindowPeriodDays: 180,
      referenceDate: now,
    });

    // Calendar age: 60 days (source reported)
    expect(result.calendarAgeDays).toBe(60);
    expect(result.ageEvidenceSource).toBe("SOURCE_REPORTED");

    // Observation span: only 2 days!
    expect(result.observationCoverageDays).toBe(2);
    expect(result.totalObservationCount).toBe(2);

    // Continuous delivery across the unobserved 58 days must NOT be assumed
    expect(result.explanation).toContain("Provider-reported dates are not independently verified");
  });

  it("validates TikTok metadata integrity and flags missing or spoofed metrics", () => {
    const check1 = validateTikTokMetadataIntegrity({
      creativeId: "7234567890123456789",
      targetRegion: "US",
      authorHandle: "honest_merchant",
    });
    expect(check1.isValid).toBe(true);
    expect(check1.confidence).toBeGreaterThan(0.8);

    const check2 = validateTikTokMetadataIntegrity({
      creativeId: "unknown",
      reportedImpressions: -50,
    });
    expect(check2.isValid).toBe(false);
    expect(check2.issues).toContain("Reported impressions cannot be negative");
  });
});

describe("URL Resolver & Batch Import Integration", () => {
  it("resolves TikTok Creative Center URL with full provenance details", async () => {
    const url = "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?id=7234567890123456789&period=30&region=US";
    const res = await resolveAdSourceUrl(url);

    expect(res.resolved).toBe(true);
    expect(res.platform).toBe("TIKTOK");
    expect(res.extractedAdId).toBe("7234567890123456789");
    expect(res.isCreativeCenter).toBe(true);
    expect(res.targetRegion).toBe("US");
    expect(res.searchWindowPeriodDays).toBe(30);
    expect(res.isEmbeddable).toBe(false);
  });

  it("handles batch import API route with validation and deduplication", async () => {
    const urls = [
      "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?id=7234567890111111111&period=30&region=US",
      "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?id=7234567890222222222&period=180&region=US",
    ];

    const req = new NextRequest("http://localhost:3000/api/v1/ads/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        urls,
        productCategory: "BEAUTY",
        country: "US",
        source: "TIKTOK_TOP_ADS_US",
      }),
    });

    const response = await batchImportPost(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.total).toBe(2);
    expect(data.data.importedCount).toBeGreaterThanOrEqual(1);

    // Verify 180-day search window warning is present in the response
    const has180Warning = data.data.results.some((item: any) =>
      item.warning?.includes("period=180d")
    );
    expect(has180Warning).toBe(true);
  });

  it("rejects batch import when exceeding maximum batch size of 50", async () => {
    const tooManyUrls = Array.from({ length: 55 }, (_, i) => `https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?id=${i}`);

    const req = new NextRequest("http://localhost:3000/api/v1/ads/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: tooManyUrls }),
    });

    const response = await batchImportPost(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.message).toContain("50 URLs");
  });
});
