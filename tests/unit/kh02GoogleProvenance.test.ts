import { describe, it, expect } from "vitest";
import {
  normalizeGoogleAdsResponse,
  GoogleSourceMetadata,
} from "@/services/kh02/providers/googleTransparencyResearchAdapter";

describe("SWAI KH-02 — Google US Delivery Provenance Unit Tests", () => {
  const baseMetadata: GoogleSourceMetadata = {
    requestedDomain: "chewy.com",
    topic: "Pet Gadgets",
    observedAt: new Date().toISOString(),
    toolName: "get_advertiser_ads",
    requestedMarket: "US",
    providerFilterMarket: "US",
  };

  it("US requested; no upstream delivery field yields FILTER_ONLY and verifiedDeliveryMarket = null", () => {
    const rawResponse = {
      requested_region: "US",
      provider_filter_region: "US",
      ads: [
        {
          advertiser_id: "AR01709643824168435713",
          creative_id: "CR01",
          format: "image",
          last_shown: "2026-03-01",
          content: { headline: "Automatic pet water fountain", description: "Fresh water for pets" },
        },
      ],
    };

    const result = normalizeGoogleAdsResponse(rawResponse, baseMetadata);
    expect(result.ads.length).toBe(1);
    const ad = result.ads[0];

    expect(ad.verifiedDeliveryMarket).toBeNull();
    expect(ad.marketProvenance.verificationStatus).toBe("FILTER_ONLY");
    expect(ad.marketProvenance.requestedMarket).toBe("US");
    expect(ad.marketProvenance.providerFilterMarket).toBe("US");
    expect(ad.marketProvenance.providerReportedMarket).toBeNull();

    expect(result.observations[0].verifiedDeliveryMarket).toBeNull();
    expect(result.observations[0].requestedMarket).toBe("US");
  });

  it("US requested; upstream reports another region yields UNVERIFIED and verifiedDeliveryMarket = null", () => {
    const rawResponse = {
      requested_region: "US",
      provider_filter_region: "US",
      ads: [
        {
          advertiser_id: "AR01709643824168435713",
          creative_id: "CR02",
          format: "video",
          reported_delivery_region: "GB",
          content: { headline: "Dog grooming vacuum", description: "Quiet vacuum" },
        },
      ],
    };

    const result = normalizeGoogleAdsResponse(rawResponse, baseMetadata);
    const ad = result.ads[0];

    expect(ad.verifiedDeliveryMarket).toBeNull();
    expect(ad.marketProvenance.verificationStatus).toBe("UNVERIFIED");
    expect(ad.marketProvenance.providerReportedMarket).toBe("GB");
  });

  it("US filter applied; no ad-level delivery evidence never derives verified US delivery", () => {
    const rawResponse = {
      requested_region: "US",
      provider_filter_region: "US",
      ads: [
        {
          advertiser_id: "AR01709643824168435713",
          creative_id: "CR03",
          format: "text",
          content: { headline: "Smart pet collar tracker" },
        },
      ],
    };

    const result = normalizeGoogleAdsResponse(rawResponse, baseMetadata);
    expect(result.ads[0].verifiedDeliveryMarket).toBeNull();
    expect(result.ads[0].marketProvenance.verificationStatus).toBe("FILTER_ONLY");
    expect(result.ads[0].marketProvenance.evidenceReference).toContain("GoogleQueryFilter");
  });

  it("Upstream explicitly reports verified US delivery yields VERIFIED and verifiedDeliveryMarket = US", () => {
    const rawResponse = {
      requested_region: "US",
      provider_filter_region: "US",
      ads: [
        {
          advertiser_id: "AR01709643824168435713",
          creative_id: "CR04",
          format: "image",
          reported_delivery_region: "US",
          content: { headline: "Automatic dog feeder" },
        },
      ],
    };

    const result = normalizeGoogleAdsResponse(rawResponse, baseMetadata);
    const ad = result.ads[0];

    expect(ad.verifiedDeliveryMarket).toBe("US");
    expect(ad.marketProvenance.verificationStatus).toBe("VERIFIED");
    expect(ad.marketProvenance.providerReportedMarket).toBe("US");
    expect(ad.marketProvenance.evidenceReference).toContain("GoogleReportedDelivery");
    expect(result.observations[0].verifiedDeliveryMarket).toBe("US");
  });

  it("Upstream reports delivery_country USA yields VERIFIED and verifiedDeliveryMarket = US", () => {
    const rawResponse = {
      ads: [
        {
          advertiser_id: "AR01709643824168435713",
          creative_id: "CR05",
          format: "image",
          delivery_country: "USA",
          content: { headline: "Cat water fountain" },
        },
      ],
    };

    const result = normalizeGoogleAdsResponse(rawResponse, baseMetadata);
    expect(result.ads[0].verifiedDeliveryMarket).toBe("US");
    expect(result.ads[0].marketProvenance.verificationStatus).toBe("VERIFIED");
  });

  it("Invalid provider geography string is handled without throwing", () => {
    const rawResponse = {
      ads: [
        {
          advertiser_id: "AR01",
          creative_id: "CR06",
          reported_delivery_region: "UNKNOWN_REGION_XYZ",
          content: { headline: "Test" },
        },
      ],
    };

    const result = normalizeGoogleAdsResponse(rawResponse, baseMetadata);
    expect(result.ads[0].verifiedDeliveryMarket).toBeNull();
    expect(result.ads[0].marketProvenance.verificationStatus).toBe("UNVERIFIED");
  });

  it("Bridge response containing request metadata does not fabricate ad delivery geography", () => {
    const bridgePayload = {
      requested_region: "US",
      provider_filter_region: "US",
      ads: [
        {
          advertiser_id: "AR01",
          creative_id: "CR07",
          format: "video",
          content: { headline: "Chewy Pet Care" },
        },
      ],
    };

    const result = normalizeGoogleAdsResponse(bridgePayload, baseMetadata);
    expect(result.ads[0].marketProvenance.requestedMarket).toBe("US");
    expect(result.ads[0].marketProvenance.providerFilterMarket).toBe("US");
    expect(result.ads[0].marketProvenance.providerReportedMarket).toBeNull();
    expect(result.ads[0].verifiedDeliveryMarket).toBeNull();
    expect(result.ads[0].marketProvenance.verificationStatus).toBe("FILTER_ONLY");
  });

  it("Nested creative metadata is extracted cleanly", () => {
    const rawResponse = {
      data: [
        {
          advertiser_id: "AR02",
          creative_id: "CR08",
          format: "video",
          last_shown: "2026-02-15",
          content: {
            headline: "Dog Grooming Vacuum Pro",
            description: "Low noise pet hair vacuum",
            video_url: "https://example.com/video.mp4",
            image_url: "https://example.com/thumb.jpg",
          },
        },
      ],
    };

    const result = normalizeGoogleAdsResponse(rawResponse, baseMetadata);
    expect(result.ads.length).toBe(1);
    expect(result.ads[0].adFormat).toBe("VIDEO");
    expect(result.ads[0].observedContent).toContain("Dog Grooming Vacuum Pro");
    expect(result.ads[0].productRelevance).toBe("PRODUCT_SPECIFIC");
    expect(result.observations[0].media?.videoUrl).toBe("https://example.com/video.mp4");
    expect(result.observations[0].media?.thumbnailUrl).toBe("https://example.com/thumb.jpg");
  });

  it("Missing creative ID is safely skipped", () => {
    const rawResponse = {
      ads: [
        { advertiser_id: "AR01", format: "image", content: { headline: "No creative ID" } },
        { advertiser_id: "AR01", creative_id: "CR09", format: "image", content: { headline: "Valid creative" } },
      ],
    };

    const result = normalizeGoogleAdsResponse(rawResponse, baseMetadata);
    expect(result.ads.length).toBe(1);
    expect(result.ads[0].creativeId).toBe("CR09");
  });

  it("Malformed upstream response produces safe empty result", () => {
    expect(normalizeGoogleAdsResponse(null, baseMetadata).ads).toEqual([]);
    expect(normalizeGoogleAdsResponse(undefined, baseMetadata).ads).toEqual([]);
    expect(normalizeGoogleAdsResponse("not json", baseMetadata).ads).toEqual([]);
    expect(normalizeGoogleAdsResponse({}, baseMetadata).ads).toEqual([]);
  });

  it("Request filter alone cannot produce verifiedDeliveryMarket = 'US'", () => {
    const filterOnlyPayload = {
      requested_region: "US",
      provider_filter_region: "US",
      ads: [
        {
          advertiser_id: "AR99",
          creative_id: "CR99",
          format: "image",
          content: { headline: "Pet gadget" },
        },
      ],
    };

    const result = normalizeGoogleAdsResponse(filterOnlyPayload, {
      ...baseMetadata,
      requestedMarket: "US",
      providerFilterMarket: "US",
    });

    expect(result.ads[0].verifiedDeliveryMarket).toBeNull();
    expect(result.ads[0].marketProvenance.verificationStatus).toBe("FILTER_ONLY");
    expect(result.ads[0].verifiedDeliveryMarket).not.toBe("US");
  });
});
