import { describe, it, expect } from "vitest";
import { normalizeMetaCollectorAd } from "@/services/discovery/normalization/normalizeMetaCollectorAd";
import { rankEvergreenAds } from "@/services/evergreen/evergreenScoring";

describe("SWAI V11.2 — Meta Creative & Freshness Normalization", () => {
  it("Phase 2 & 3: Handles summary creative with has_image=true but no URL gracefully without synthetic fabrication", () => {
    const rawSummary: Record<string, unknown> = {
      library_id: "12345678901",
      advertiser_name: "Brand Summary",
      creatives: [
        {
          has_image: true,
          has_video: false,
          // Notice: no thumbnail_url or image_url in summary projection
        },
      ],
      media_type: "image",
    };

    const normalized = normalizeMetaCollectorAd(rawSummary);

    expect(normalized.mediaType).toBe("IMAGE");
    expect(normalized.thumbnailUrl).toBeNull();
    expect(normalized.mediaAvailability).toBe("RESTRICTED");
    expect(normalized.creativeUrl).toBe("https://www.facebook.com/ads/library/?id=12345678901");
  });

  it("Phase 2 & 3: Normalizes detailed creative with genuine Facebook CDN media URLs and video preview image", () => {
    const rawDetailed: Record<string, unknown> = {
      library_id: "98765432109",
      advertiser_name: "Kitchen Pro",
      creatives: [
        {
          has_image: true,
          has_video: true,
          thumbnail_url: "https://scontent.xx.fbcdn.net/v/t39.35426-6/preview.jpg?token=abc",
          video_sd_url: "https://video.xx.fbcdn.net/sd.mp4?token=def",
          video_hd_url: "https://video.xx.fbcdn.net/hd.mp4?token=ghi",
          width: 1080,
          height: 1080,
        },
      ],
      media_type: "video",
      start_date: "2026-10-15T10:00:00Z",
      status: "ACTIVE",
    };

    const normalized = normalizeMetaCollectorAd(rawDetailed);

    expect(normalized.mediaType).toBe("VIDEO");
    expect(normalized.thumbnailUrl).toBe("https://scontent.xx.fbcdn.net/v/t39.35426-6/preview.jpg?token=abc");
    // HD video prioritized over SD
    expect(normalized.videoUrl).toBe("https://video.xx.fbcdn.net/hd.mp4?token=ghi");
    expect(normalized.mediaAvailability).toBe("READY");
    expect(normalized.aspectRatio).toBe("1:1");
    expect(normalized.sourceReportedStartAt).toEqual(new Date("2026-10-15T10:00:00Z"));
  });

  it("Phase 3: Preserves multiple creative variants without silently discarding elements after index 0", () => {
    const rawMulti: Record<string, unknown> = {
      library_id: "55544433322",
      advertiser_name: "Fashion Hub",
      creatives: [
        {
          has_image: true,
          image_url: "https://scontent.xx.fbcdn.net/img1.jpg",
          body: "Variant 1 copy",
          width: 1080,
          height: 1350, // 4:5
        },
        {
          has_image: true,
          image_url: "https://scontent.xx.fbcdn.net/img2.jpg",
          body: "Variant 2 copy",
          width: 1080,
          height: 1350,
        },
      ],
      display_format: "IMAGE",
    };

    const normalized = normalizeMetaCollectorAd(rawMulti);

    // Primary media
    expect(normalized.thumbnailUrl).toBe("https://scontent.xx.fbcdn.net/img1.jpg");
    expect(normalized.aspectRatio).toBe("4:5");
    // Must NOT be falsely classified as CAROUSEL unless display_format indicates carousel
    expect(normalized.mediaType).toBe("IMAGE");

    // All creative variants preserved in source evidence
    const variants = normalized.sourceEvidence?.creativeVariants;
    expect(variants).toBeDefined();
    expect(variants?.length).toBe(2);
    expect(variants?.[0].thumbnailUrl).toBe("https://scontent.xx.fbcdn.net/img1.jpg");
    expect(variants?.[1].thumbnailUrl).toBe("https://scontent.xx.fbcdn.net/img2.jpg");
  });

  it("Phase 3: Correctly classifies genuine CAROUSEL ads when display_format is CAROUSEL", () => {
    const rawCarousel: Record<string, unknown> = {
      library_id: "77788899900",
      advertiser_name: "Multi-Product Store",
      display_format: "CAROUSEL",
      creatives: [
        { image_url: "https://scontent.xx.fbcdn.net/card1.jpg" },
        { image_url: "https://scontent.xx.fbcdn.net/card2.jpg" },
      ],
    };

    const normalized = normalizeMetaCollectorAd(rawCarousel);
    expect(normalized.mediaType).toBe("CAROUSEL");
  });

  it("Phase 2: Upstream inspect_ads response contract parsing (items array containing { ad, enrichment, media })", () => {
    const mockInspectResponse: Record<string, unknown> = {
      result_set_id: "c8e6587d-897b-4bc9-880c-0be896fef1da",
      items: [
        {
          ad: {
            library_id: "12345678901",
            advertiser_name: "Inspect Brand",
            thumbnail_url: "https://scontent.xx.fbcdn.net/thumb.jpg",
          },
          enrichment: {
            quality_score: 85,
          },
          media: {
            preview_image: "https://scontent.xx.fbcdn.net/thumb.jpg",
          },
        },
      ],
      untrusted_ad_content: true,
    };

    const items = mockInspectResponse.items as Array<{
      ad: { library_id: string; advertiser_name: string; thumbnail_url: string };
      enrichment: Record<string, unknown>;
      media: Record<string, unknown>;
    }>;

    expect(items).toBeDefined();
    expect(Array.isArray(items)).toBe(true);
    expect(items[0].ad.library_id).toBe("12345678901");
    expect(items[0].ad.thumbnail_url).toBe("https://scontent.xx.fbcdn.net/thumb.jpg");
  });

  it("Phase 8: rankEvergreenAds sorts NEWLY_LAUNCHED by lowest calendarAgeDays (newest first)", () => {
    const scores = [
      {
        adId: "old-ad",
        eligible: true,
        totalScore: 90,
        calendarAgeDays: 120,
        evidenceConfidence: 0.9,
        eligibilityReason: "ok",
        availableSignals: [],
        missingSignals: [],
        longevityComponent: 30,
        observationComponent: 25,
        coverageComponent: 15,
        sourceReliabilityComponent: 15,
        componentWeights: { longevity: 35, observation: 30, coverage: 20, sourceReliability: 15 },
        longevityCategory: "LONG_TERM_REFERENCE" as const,
        coverageStatus: "HIGH_COVERAGE" as const,
        ageEvidenceSource: "SOURCE_REPORTED" as const,
        scoreBreakdown: {},
        formulaVersion: "7.0.0",
        explanation: "",
        calculatedAt: new Date().toISOString(),
        tier: "HIGH_RESEARCH_PRIORITY" as const,
      },
      {
        adId: "new-ad-3d",
        eligible: true,
        totalScore: 70,
        calendarAgeDays: 3,
        evidenceConfidence: 0.7,
        eligibilityReason: "ok",
        availableSignals: [],
        missingSignals: [],
        longevityComponent: 15,
        observationComponent: 20,
        coverageComponent: 10,
        sourceReliabilityComponent: 15,
        componentWeights: { longevity: 35, observation: 30, coverage: 20, sourceReliability: 15 },
        longevityCategory: "NEW_TESTING" as const,
        coverageStatus: "MODERATE_COVERAGE" as const,
        ageEvidenceSource: "SOURCE_REPORTED" as const,
        scoreBreakdown: {},
        formulaVersion: "7.0.0",
        explanation: "",
        calculatedAt: new Date().toISOString(),
        tier: "MEDIUM_RESEARCH_PRIORITY" as const,
      },
      {
        adId: "new-ad-15d",
        eligible: true,
        totalScore: 80,
        calendarAgeDays: 15,
        evidenceConfidence: 0.8,
        eligibilityReason: "ok",
        availableSignals: [],
        missingSignals: [],
        longevityComponent: 20,
        observationComponent: 20,
        coverageComponent: 15,
        sourceReliabilityComponent: 15,
        componentWeights: { longevity: 35, observation: 30, coverage: 20, sourceReliability: 15 },
        longevityCategory: "EARLY_POTENTIAL" as const,
        coverageStatus: "MODERATE_COVERAGE" as const,
        ageEvidenceSource: "SOURCE_REPORTED" as const,
        scoreBreakdown: {},
        formulaVersion: "7.0.0",
        explanation: "",
        calculatedAt: new Date().toISOString(),
        tier: "HIGH_RESEARCH_PRIORITY" as const,
      },
    ];

    const ranked = rankEvergreenAds(scores, { mode: "NEWLY_LAUNCHED" });

    expect(ranked[0].adId).toBe("new-ad-3d");
    expect(ranked[1].adId).toBe("new-ad-15d");
    expect(ranked[2].adId).toBe("old-ad");
  });
});
