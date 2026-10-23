import { describe, it, expect } from "vitest";
import {
  MUSE_PROVIDER_ID,
  buildFacebookAdLibraryUrl,
  normalizeFacebookAd,
  isSafeHttpUrl,
  calculateMetaEvidenceConfidence,
  resolveFacebookAdvertiser,
} from "@/services/discovery/normalization/normalizeFacebookAd";
import { DiscoveryQuerySchema } from "@/services/discovery/types";
import { getDiscoveryProvider } from "@/services/discovery/providerRegistry";
import { generateStableSourceHash } from "@/services/tiktok/tiktokUrlParser";

describe("Muse Facebook Normalizer & Data Provenance (Part 17)", () => {
  // Test 206: Successful Facebook record normalization
  it("Test 206: normalizes a verified Facebook record with complete provenance", () => {
    const ad = normalizeFacebookAd({
      libraryId: "1642750633880173",
      advertiserName: "Uproot Clean",
      advertiserPageId: "109823481234",
      headline: "Uproot Clean Pet Hair Remover",
      bodyText: "Removes pet hair in seconds from couches and carpets.",
      callToAction: "Shop Now",
      landingPageUrl: "https://cc.uprootclean.com/main/phr",
      mediaType: "VIDEO",
      durationSeconds: 41,
      thumbnailUrl: "https://images.checkoutchamp.com/uproot_lint_llc/product11.jpeg",
      category: "Pet Supplies",
      sourceReportedStartAt: "2025-11-02",
      activeStatus: "ACTIVE",
      facebookPlacement: "CONFIRMED",
    });

    expect(ad.platform).toBe("META");
    expect(ad.providerId).toBe(MUSE_PROVIDER_ID);
    expect(ad.sourceExternalId).toBe("1642750633880173");
    expect(ad.creativeUrl).toBe(buildFacebookAdLibraryUrl("1642750633880173"));
    expect(ad.embedUrl).toBeNull();
    expect(ad.mediaAvailability).toBe("RESTRICTED");
    expect(ad.mediaType).toBe("VIDEO");
    expect(ad.thumbnailUrl).toContain("product11.jpeg");
    expect(ad.sourceReportedStartAt?.toISOString().startsWith("2025-11-02")).toBe(true);
    expect(ad.sourceEvidence).toBeDefined();
    expect(ad.sourceEvidence?.verifiedLibraryId).toBe(true);
    expect(ad.sourceEvidence?.facebookPlacement).toBe("CONFIRMED");
    expect(ad.confidenceScore).toBeGreaterThanOrEqual(0.9);
  });

  // Test 207: Missing and malformed Library IDs
  it("Test 207: rejects missing and malformed Library IDs", () => {
    expect(() => normalizeFacebookAd({ libraryId: "" })).toThrow(/missing or invalid Meta Library ID/);
    expect(() => normalizeFacebookAd({ libraryId: "   " })).toThrow(/missing or invalid Meta Library ID/);
    expect(() => normalizeFacebookAd({ libraryId: "abc123" })).toThrow(/missing or invalid Meta Library ID/);
    expect(() => normalizeFacebookAd({ libraryId: "42" })).toThrow(/missing or invalid Meta Library ID/);
    expect(() => normalizeFacebookAd({ libraryId: "meta_12345" })).toThrow(/missing or invalid Meta Library ID/);
  });

  // Test 208: Cross-platform hash isolation
  it("Test 208: ensures TikTok and Meta ads with identical numeric IDs have completely isolated hashes", () => {
    const sharedId = "98765432101234";
    const metaHash = generateStableSourceHash("META", MUSE_PROVIDER_ID, sharedId);
    const tiktokHash = generateStableSourceHash("TIKTOK", "tiktok-topads", sharedId);

    expect(metaHash).not.toBe(tiktokHash);
    expect(metaHash.length).toBe(32);
    expect(tiktokHash.length).toBe(32);

    const metaAd = normalizeFacebookAd({ libraryId: sharedId });
    expect(metaAd.stableIdentityHash).toBe(metaHash);
    expect(metaAd.stableIdentityHash).not.toBe(tiktokHash);
  });

  // Test 209: Unknown media honesty
  it("Test 209: preserves UNKNOWN media type when creative format is not confirmed", () => {
    const adWithoutMedia = normalizeFacebookAd({
      libraryId: "1642750633880173",
      headline: "Headline only ad",
    });

    // Crucial: Must NEVER default to VIDEO when media is unknown!
    expect(adWithoutMedia.mediaType).toBe("UNKNOWN");
    expect(adWithoutMedia.videoUrl).toBeNull();
    expect(adWithoutMedia.durationSeconds).toBeNull();

    const imageAd = normalizeFacebookAd({
      libraryId: "1642750633880173",
      mediaType: "IMAGE",
    });
    expect(imageAd.mediaType).toBe("IMAGE");

    const carouselAd = normalizeFacebookAd({
      libraryId: "1642750633880173",
      mediaType: "CAROUSEL",
    });
    expect(carouselAd.mediaType).toBe("CAROUSEL");
  });

  // Test 210: Unsupported metrics rejection
  it("Test 210: rejects fabricated financial and performance claims for US commercial ads", () => {
    const ad = normalizeFacebookAd({
      libraryId: "1642750633880173",
      roas: 4.8,
      revenue: 125000,
      spend: 25000,
      cpa: 12.5,
      sales: 850,
      views: 1200000,
      conversions: 450,
    });

    // Raw metrics notice must state honesty
    expect(ad.reportedMetrics.likes).toBeUndefined();
    expect(ad.reportedMetrics.ctr).toBeUndefined();
    expect(ad.reportedMetrics.cvr).toBeUndefined();
    expect((ad as Record<string, unknown>).roas).toBeUndefined();
    expect((ad as Record<string, unknown>).revenue).toBeUndefined();
    expect((ad as Record<string, unknown>).spend).toBeUndefined();
    expect(ad.reportedMetrics.rawMetricsNotice).toContain("Meta Ad Library exposes no spend/impressions");
  });

  // Test 211: Source identity and canonical URL consistency
  it("Test 211: verifies canonical URL strictly reflects the verified Library ID", () => {
    const id = "77889900112233";
    const ad = normalizeFacebookAd({ libraryId: id });
    expect(ad.creativeUrl).toBe(`https://www.facebook.com/ads/library/?id=${id}`);
    expect(ad.rawEvidenceReference).toBe(ad.creativeUrl);
    expect(ad.sourceEvidence?.sourceUrl).toBe(ad.creativeUrl);
  });

  // Test 212: Missing advertiser attribution
  it("Test 212: resolves unattributed advertisers cleanly without false collapsing", () => {
    const emptyAdvertiser = resolveFacebookAdvertiser(undefined, undefined);
    expect(emptyAdvertiser.name).toBe("Facebook Advertiser (Unattributed)");
    expect(emptyAdvertiser.externalId).toBeNull();

    const pageIdOnly = resolveFacebookAdvertiser(undefined, "9988776655");
    expect(pageIdOnly.name).toBe("Facebook Page 9988776655");
    expect(pageIdOnly.externalId).toBe("9988776655");

    const named = resolveFacebookAdvertiser("Ridge Wallet", "12345");
    expect(named.name).toBe("Ridge Wallet");
    expect(named.externalId).toBe("12345");
  });

  // Test 213: Provider capabilities
  it("Test 213: verifies Muse provider capability declarations and async-only contract", async () => {
    const provider = getDiscoveryProvider(MUSE_PROVIDER_ID);
    expect(provider).toBeDefined();

    const caps = provider!.getCapabilities();
    expect(caps.supportsUS).toBe(true);
    expect(caps.supportsVideoMetadata).toBe(false);
    expect(caps.supportsPagination).toBe(false);
    expect(caps.isPaid).toBe(false);
    expect(caps.isLiveVerified).toBe(false);
    expect(caps.requiresAuthentication).toBe(true);

    const availability = await provider!.checkAvailability();
    expect(availability.status).not.toBe("AVAILABLE");
    expect(availability.isAuthorized).toBe(false);

    await expect(
      provider!.discoverPage(
        DiscoveryQuerySchema.parse({ platform: "META", providerId: MUSE_PROVIDER_ID })
      )
    ).rejects.toThrow(/asynchronous/);
  });

  // Test 214: Evidence confidence transparency
  it("Test 214: grades confidence transparently based on actual supporting evidence", () => {
    // Bare minimum valid ID format with no extra evidence
    const bareScore = calculateMetaEvidenceConfidence({
      isLibraryIdValid: true,
      hasAdvertiserPageId: false,
      hasAdvertiserName: false,
      hasValidStartDate: false,
      hasActiveStatus: false,
      hasCopy: false,
      hasValidLandingPage: false,
    });
    expect(bareScore).toBe(0.65);

    // Full evidence
    const fullScore = calculateMetaEvidenceConfidence({
      isLibraryIdValid: true,
      hasAdvertiserPageId: true,
      hasAdvertiserName: true,
      hasValidStartDate: true,
      hasActiveStatus: true,
      hasCopy: true,
      hasValidLandingPage: true,
    });
    expect(fullScore).toBe(0.95);

    expect(fullScore).toBeGreaterThan(bareScore);
  });

  // Safe URL verification
  it("safely validates URLs against SSRF and unsupported schemes", () => {
    expect(isSafeHttpUrl("https://example.com/product")).toBe(true);
    expect(isSafeHttpUrl("http://shop.brand.com/sale")).toBe(true);

    // Rejects SSRF / illegal protocols
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeHttpUrl("http://localhost:3000/admin")).toBe(false);
    expect(isSafeHttpUrl("http://127.0.0.1:8080")).toBe(false);
    expect(isSafeHttpUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafeHttpUrl("")).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
  });
});
