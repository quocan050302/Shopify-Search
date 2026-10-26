import { describe, it, expect } from "vitest";
import {
  normalizeMetaCollectorAd,
  META_COLLECTOR_PROVIDER_ID,
} from "@/services/discovery/normalization/normalizeMetaCollectorAd";
import {
  isSafeHttpUrl,
  buildFacebookAdLibraryUrl,
  resolveFacebookAdvertiser,
  calculateMetaEvidenceConfidence,
} from "@/services/discovery/normalization/normalizeFacebookAd";

describe("MetaAdsCollector Normalization & Provenance", () => {
  it("normalizes a valid Meta Ad Library record with factual fields", () => {
    const raw: Record<string, unknown> = {
      library_id: "1234567890",
      advertiser_name: "Glow Beauty Labs",
      page_id: "987654321",
      title: "Crystal Hair Eraser V2",
      body: "Say goodbye to traditional hair removal methods. Painless and instant.",
      cta: "Shop Now",
      link_url: "https://example.com/products/eraser",
      media_type: "image",
      start_date: "2026-03-01T12:00:00Z",
      status: "ACTIVE",
    };

    const ad = normalizeMetaCollectorAd(raw, { queryMarket: "US" });

    expect(ad.platform).toBe("META");
    expect(ad.providerId).toBe(META_COLLECTOR_PROVIDER_ID);
    expect(ad.sourceExternalId).toBe("1234567890");
    expect(ad.sourceNamespace).toBe("META:META-ADS-COLLECTOR");
    expect(ad.creativeUrl).toBe("https://www.facebook.com/ads/library/?id=1234567890");
    expect(ad.headline).toBe("Crystal Hair Eraser V2");
    expect(ad.bodyText).toContain("Say goodbye");
    expect(ad.callToAction).toBe("Shop Now");
    expect(ad.landingPageUrl).toBe("https://example.com/products/eraser");
    expect(ad.mediaType).toBe("IMAGE");
    expect(ad.targetMarket).toBe("US");
    expect(ad.sourceReportedStartAt).toEqual(new Date("2026-03-01T12:00:00Z"));
    expect(ad.confidenceScore).toBeGreaterThanOrEqual(0.6);
    expect(ad.sourceEvidence?.observationMethod).toBe("META_COLLECTOR_PUBLIC_LIBRARY_OBSERVATION");
  });

  it("rejects invalid, missing, or malformed Library IDs", () => {
    expect(() =>
      normalizeMetaCollectorAd({ library_id: "" })
    ).toThrow(/missing or invalid Meta Library ID/);

    expect(() =>
      normalizeMetaCollectorAd({ library_id: "   " })
    ).toThrow(/missing or invalid Meta Library ID/);

    expect(() =>
      normalizeMetaCollectorAd({ library_id: "abc123" })
    ).toThrow(/missing or invalid Meta Library ID/);

    expect(() =>
      normalizeMetaCollectorAd({ library_id: "42" }) // under 5 digits
    ).toThrow(/missing or invalid Meta Library ID/);

    expect(() =>
      normalizeMetaCollectorAd({ library_id: "meta_12345" }) // non-numeric
    ).toThrow(/missing or invalid Meta Library ID/);
  });

  it("honest media type classification: never defaults to VIDEO", () => {
    // No media type specified
    const unk = normalizeMetaCollectorAd({ library_id: "9988776655" });
    expect(unk.mediaType).toBe("UNKNOWN");

    // Video explicitly specified
    const vid = normalizeMetaCollectorAd({
      library_id: "9988776656",
      media_type: "video",
      video_duration: 35,
    });
    expect(vid.mediaType).toBe("VIDEO");
    expect(vid.durationSeconds).toBe(35);

    // Image explicitly specified
    const img = normalizeMetaCollectorAd({
      library_id: "9988776657",
      media_type: "IMAGE",
    });
    expect(img.mediaType).toBe("IMAGE");

    // Carousel explicitly specified
    const car = normalizeMetaCollectorAd({
      library_id: "9988776658",
      media_type: "carousel",
    });
    expect(car.mediaType).toBe("CAROUSEL");
  });

  it("does not fabricate spend, impressions, ROAS, or conversions", () => {
    const rawWithUntrustedClaims: Record<string, unknown> = {
      library_id: "55566677788",
      advertiser_name: "Test Store",
      spend: 5000,
      roas: 4.5,
      sales: 1200,
      views: 90000,
    };

    const ad = normalizeMetaCollectorAd(rawWithUntrustedClaims);
    expect(ad.reportedMetrics.costScore).toBeUndefined();
    expect(ad.reportedMetrics.rawMetricsNotice).toContain("no spend/impressions");
    const untypedAd = ad as Record<string, unknown>;
    expect(untypedAd.spend).toBeUndefined();
    expect(untypedAd.roas).toBeUndefined();
    expect(untypedAd.sales).toBeUndefined();
  });

  it("safely validates URLs against SSRF and unsafe schemes", () => {
    expect(isSafeHttpUrl("https://facebook.com")).toBe(true);
    expect(isSafeHttpUrl("http://example.com/product")).toBe(true);
    expect(isSafeHttpUrl("http://localhost:3000")).toBe(false);
    expect(isSafeHttpUrl("http://127.0.0.1/admin")).toBe(false);
    expect(isSafeHttpUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("file:///etc/passwd")).toBe(false);
  });

  it("builds the canonical public Meta Ad Library URL", () => {
    expect(buildFacebookAdLibraryUrl("1234567890")).toBe(
      "https://www.facebook.com/ads/library/?id=1234567890"
    );
  });

  it("resolves advertiser identity gracefully without conflating unknown stores", () => {
    const named = resolveFacebookAdvertiser("Nike", "12345");
    expect(named.name).toBe("Nike");
    expect(named.externalId).toBe("12345");

    const pageOnly = resolveFacebookAdvertiser(null, "998877");
    expect(pageOnly.name).toBe("Facebook Page 998877");
    expect(pageOnly.externalId).toBe("998877");

    const unattributed = resolveFacebookAdvertiser("", "");
    expect(unattributed.name).toBe("Facebook Advertiser (Unattributed)");
    expect(unattributed.externalId).toBeNull();
  });

  it("computes transparent evidence confidence", () => {
    const highConf = calculateMetaEvidenceConfidence({
      isLibraryIdValid: true,
      hasAdvertiserPageId: true,
      hasAdvertiserName: true,
      hasValidStartDate: true,
      hasActiveStatus: true,
      hasCopy: true,
      hasValidLandingPage: true,
    });
    expect(highConf).toBeGreaterThanOrEqual(0.9);

    const invalid = calculateMetaEvidenceConfidence({
      isLibraryIdValid: false,
      hasAdvertiserPageId: true,
      hasAdvertiserName: true,
      hasValidStartDate: true,
      hasActiveStatus: true,
      hasCopy: true,
      hasValidLandingPage: true,
    });
    expect(invalid).toBe(0.0);
  });
});
