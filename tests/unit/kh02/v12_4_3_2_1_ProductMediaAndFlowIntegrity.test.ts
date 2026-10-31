import { describe, it, expect } from "vitest";
import {
  resolveProductMediaGallery,
  validateAndNormalizeMediaUrl,
  isStockOrPlaceholderMediaUrl,
  isPrivateOrLoopbackHost,
  buildCanonicalMediaDedupeKey,
  verifyMediaBelongsToProduct,
} from "@/services/kh02/media/productMediaResolver";
import {
  buildCanonicalRecommendedProducts,
  resolveCandidatePrimaryMedia,
  buildBuyerOrientedWhyItFits,
} from "@/services/kh02/presentation/productFinderViewModel";
import {
  evaluateMerchantPageHonesty,
  evaluateBuyerOrientedCopyPurity,
  evaluateKh02Kh01ScoreSeparation,
  evaluateDemandAuditValueIntegrity,
  runAdversarialFalsePassSuiteV12_4_3_2_1,
} from "@/services/kh02/acceptance/gateAndAsyncVerifierV12_4_3_2_1";
import { SWAI_KH02_RELEASE_VERSION } from "@/services/kh02/version/runtimeVersionService";

describe("SWAI KH-02 V12.4.3.2.1 — Product Media Gallery, End-to-End Flow & Visual Integrity", () => {
  it("Release version is 12.4.3.2.1, 12.4.3.3, 12.4.3.3.1, 12.4.3.3.2, 12.4.3.4.1, 12.4.3.4.2, 12.4.3.4.3, 12.4.3.4.4, or 12.4.3.4.5", () => {
    expect(["12.4.3.2.1", "12.4.3.3", "12.4.3.3.1", "12.4.3.3.2", "12.4.3.4.1", "12.4.3.4.2", "12.4.3.4.3", "12.4.3.4.4", "12.4.3.4.5"]).toContain(SWAI_KH02_RELEASE_VERSION);
  });

  describe("Section 17: 25 Media Regression Scenarios", () => {
    it("Scenario 01: Single merchant product image resolves as MERCHANT_PRODUCT_PAGE primaryImage", () => {
      const res = resolveProductMediaGallery({
        productId: "p_01",
        productTitle: "Automatic Wet Food Cat Feeder",
        storeDomain: "uahpet.com",
        canonicalProductUrl: "https://www.uahpet.com/products/feeder",
        productImageUrl:
          "https://www.uahpet.com/cdn/shop/files/uahpet-dual-bowl-fresh-food-feeder-heating-and-cooling.webp?v=1789713332",
      });
      expect(res.totalCount).toBe(1);
      expect(res.primaryImage?.sourceType).toBe("MERCHANT_PRODUCT_PAGE");
      expect(res.primaryImage?.sourceLabel).toBe("Merchant Product Image");
    });

    it("Scenario 02: Multiple merchant gallery images resolve with MERCHANT_PRODUCT_PAGE first and MERCHANT_GALLERY next", () => {
      const res = resolveProductMediaGallery({
        productId: "p_02",
        productTitle: "Automatic Wet Food Cat Feeder",
        storeDomain: "uahpet.com",
        productImageUrl: "https://www.uahpet.com/cdn/shop/files/feeder-1.webp",
        landingPageImageUrls: [
          "https://www.uahpet.com/cdn/shop/files/feeder-2.webp",
          "https://www.uahpet.com/cdn/shop/files/feeder-3.webp",
        ],
      });
      expect(res.totalCount).toBe(3);
      expect(res.items[0].sourceType).toBe("MERCHANT_PRODUCT_PAGE");
      expect(res.items[1].sourceType).toBe("MERCHANT_GALLERY");
      expect(res.items[2].sourceType).toBe("MERCHANT_GALLERY");
    });

    it("Scenario 03: Merchant images + direct MP4 ad video preserves merchant primary image and playable video", () => {
      const res = resolveProductMediaGallery({
        productId: "p_03",
        productTitle: "Automatic Wet Food Cat Feeder",
        storeDomain: "uahpet.com",
        candidateImageReferences: ["https://www.uahpet.com/cdn/shop/files/feeder-hero.webp"],
        adCreativeMedia: [
          {
            adId: "ad_03",
            mediaType: "VIDEO",
            url: "https://video.fbcdn.net/v/t42/feeder-demo.mp4",
            thumbnailUrl: "https://scontent.fbcdn.net/v/feeder-poster.jpg",
          },
        ],
      });
      expect(res.hasImages).toBe(true);
      expect(res.hasVideo).toBe(true);
      expect(res.primaryImage?.sourceType).toBe("MERCHANT_PRODUCT_PAGE");
      expect(res.primaryVideo?.mediaType).toBe("VIDEO");
      expect(res.primaryVideo?.posterUrl).toBe("https://scontent.fbcdn.net/v/feeder-poster.jpg");
    });

    it("Scenario 04: Multiple ad videos + posters deduplicate identical videos and preserve distinct videos", () => {
      const res = resolveProductMediaGallery({
        productId: "p_04",
        productTitle: "Smart Feeder",
        storeDomain: "uahpet.com",
        adCreativeMedia: [
          {
            adId: "ad_1",
            mediaType: "VIDEO",
            url: "https://video.fbcdn.net/v/t42/demo-a.mp4",
            thumbnailUrl: "https://scontent.fbcdn.net/v/poster-a.jpg",
          },
          {
            adId: "ad_2",
            mediaType: "VIDEO",
            url: "https://video.fbcdn.net/v/t42/demo-b.mp4",
            thumbnailUrl: "https://scontent.fbcdn.net/v/poster-b.jpg",
          },
          {
            adId: "ad_3_dup",
            mediaType: "VIDEO",
            url: "https://video.fbcdn.net/v/t42/demo-a.mp4",
            thumbnailUrl: "https://scontent.fbcdn.net/v/poster-a.jpg",
          },
        ],
      });
      expect(res.videoItems.length).toBe(2);
    });

    it("Scenario 05: Ad creative image only (when no merchant image exists) labels source as Meta Ad Creative", () => {
      const res = resolveProductMediaGallery({
        productId: "p_05",
        productTitle: "Automatic Dog Feeder for Easy Daily Meals",
        storeDomain: "kingspetboutique.info",
        candidateThumbnailUrl: "https://scontent.fbcdn.net/v/dog-feeder-ad.jpg",
      });
      expect(res.totalCount).toBe(1);
      expect(res.primaryImage?.sourceType).toBe("META_AD_CREATIVE");
      expect(res.primaryImage?.sourceLabel).toBe("Meta Ad Creative");
    });

    it("Scenario 06: Ad video only resolves playable video and poster", () => {
      const res = resolveProductMediaGallery({
        productId: "p_06",
        productTitle: "Automatic Dog Feeder",
        storeDomain: "kingspetboutique.info",
        candidateVideoUrl: "https://video.fbcdn.net/v/dog-feeder.mp4",
        candidateThumbnailUrl: "https://scontent.fbcdn.net/v/dog-poster.jpg",
      });
      expect(res.hasVideo).toBe(true);
      expect(res.primaryVideo?.url).toBe("https://video.fbcdn.net/v/dog-feeder.mp4");
    });

    it("Scenario 07: No media returns honest empty state without fabricating placeholders", () => {
      const res = resolveProductMediaGallery({
        productId: "p_07",
        productTitle: "No Media Product",
        storeDomain: "example-pet.com",
        canonicalProductUrl: "https://example-pet.com/products/feeder",
      });
      expect(res.emptyState.isEmpty).toBe(true);
      expect(res.totalCount).toBe(0);
      expect(res.primaryImage).toBeNull();
      expect(res.primaryVideo).toBeNull();
      expect(res.emptyState.headline).toBe("No verified product media available");
      expect(res.emptyState.merchantUrl).toBe("https://example-pet.com/products/feeder");
    });

    it("Scenario 08, 09, 10: Broken primary image URL, broken thumbnail URL, and broken video URL are rejected cleanly", () => {
      const res = resolveProductMediaGallery({
        productId: "p_08_10",
        productTitle: "Broken URLs Product",
        productImageUrl: "not-a-valid-image-url",
        candidateThumbnailUrl: "://bad-thumb",
        candidateVideoUrl: "ftp://unsupported-video-host.com/vid.mp4",
      });
      expect(res.emptyState.isEmpty).toBe(true);
      expect(res.rejectedItems.length).toBe(3);
    });

    it("Scenario 11 & 12: Duplicate URLs and Shopify CDN size variants (_400x400 vs _1024x1024) deduplicate to 1 item", () => {
      const key1 = buildCanonicalMediaDedupeKey(
        "https://www.uahpet.com/cdn/shop/files/feeder_400x400.webp?v=100"
      );
      const key2 = buildCanonicalMediaDedupeKey(
        "https://www.uahpet.com/cdn/shop/files/feeder_1024x1024.webp?v=200"
      );
      expect(key1).toBe(key2);

      const res = resolveProductMediaGallery({
        productId: "p_11_12",
        productTitle: "Dedupe Feeder",
        storeDomain: "uahpet.com",
        productImageUrl: "https://www.uahpet.com/cdn/shop/files/feeder_1024x1024.webp?v=1",
        candidateImageReferences: ["http://www.uahpet.com/cdn/shop/files/feeder_400x400.webp?v=2"],
        candidateThumbnailUrl: "https://www.uahpet.com/cdn/shop/files/feeder_large.webp?v=3",
      });
      expect(res.totalCount).toBe(1);
      expect(res.provenanceSummary.deduplicatedCount).toBe(2);
    });

    it("Scenario 13: Mixed HTTP/HTTPS Shopify CDN URLs upgrade http://.../cdn/shop/ to https://", () => {
      const check = validateAndNormalizeMediaUrl(
        "http://www.uahpet.com/cdn/shop/files/uahpet-dual-bowl-fresh-food-feeder-heating-and-cooling.webp?v=1789713332",
        "IMAGE"
      );
      expect(check.valid).toBe(true);
      expect(check.normalizedUrl).toBe(
        "https://www.uahpet.com/cdn/shop/files/uahpet-dual-bowl-fresh-food-feeder-heating-and-cooling.webp?v=1789713332"
      );
    });

    it("Scenario 14, 15, 16, 17: Portrait, landscape, small thumbnail, and long product title/alt text preserve metadata", () => {
      const longTitle =
        "Automatic Programmable Dual-Bowl Wet & Dry Pet Feeder with Semiconductor Cooling & Ice Pack Compartments for Cats and Small Dogs";
      const res = resolveProductMediaGallery({
        productId: "p_14_17",
        productTitle: longTitle,
        storeDomain: "uahpet.com",
        adLinks: [
          {
            productId: "p_14_17",
            confidence: "CONFIRMED",
            ad: {
              id: "ad_dim",
              landingPageUrl: "https://www.uahpet.com/products/feeder",
              mediaAssets: [
                {
                  id: "m_portrait",
                  mediaType: "IMAGE",
                  thumbnailUrl: "https://scontent.fbcdn.net/v/portrait.jpg",
                  width: 720,
                  height: 1280,
                  aspectRatio: "9:16",
                },
                {
                  id: "m_landscape",
                  mediaType: "IMAGE",
                  thumbnailUrl: "https://scontent.fbcdn.net/v/landscape.jpg",
                  width: 1920,
                  height: 1080,
                  aspectRatio: "16:9",
                },
              ],
            },
          },
        ],
      });
      expect(res.totalCount).toBe(2);
      expect(res.items[0].altText).toContain(longTitle);
    });

    it("Scenario 18: Rejects stock/placeholder image services (Unsplash, Picsum, Placehold, DummyImage, Example.com)", () => {
      const stockUrls = [
        "https://images.unsplash.com/photo-1517849845537-4d257902454a",
        "https://picsum.photos/500/500",
        "https://placehold.co/600x400",
        "https://via.placeholder.com/300",
        "https://dummyimage.com/600x400/000/fff",
        "https://example.com/fake.jpg",
      ];
      for (const u of stockUrls) {
        expect(isStockOrPlaceholderMediaUrl(u)).toBe(true);
        expect(validateAndNormalizeMediaUrl(u, "IMAGE").valid).toBe(false);
      }
    });

    it("Scenario 19: Rejects unrelated cross-product / cross-domain media", () => {
      const assoc = verifyMediaBelongsToProduct({
        targetProductId: "p_uahpet",
        targetStoreDomain: "uahpet.com",
        targetProductUrl: "https://www.uahpet.com/products/feeder",
        mediaStoreDomain: "other-fashion-brand.com",
        mediaLandingPageUrl: "https://other-fashion-brand.com/products/shoes",
      });
      expect(assoc.associated).toBe(false);
      expect(assoc.matched).toBe(false);
    });

    it("Scenario 20: Caps large media galleries at 16 items to prevent DOM bloat", () => {
      const manyUrls = Array.from(
        { length: 25 },
        (_, i) => `https://www.uahpet.com/cdn/shop/files/img_${i}.webp`
      );
      const res = resolveProductMediaGallery({
        productId: "p_20",
        productTitle: "Many Images Feeder",
        storeDomain: "uahpet.com",
        landingPageImageUrls: manyUrls,
      });
      expect(res.totalCount).toBe(16);
    });

    it("Scenario 21, 22, 23, 24, 25: Cross-surface consistency between Product Finder card and Product Intelligence", () => {
      const candidate = {
        candidateId: "cand_uahpet",
        canonicalProductName: "Automatic Wet Food Cat Feeder with Cooling & Warming",
        storeDomain: "uahpet.com",
        canonicalProductUrl: "https://www.uahpet.com/products/feeder",
        identityStatus: "VERIFIED" as const,
        fetchOutcome: "FETCH_OK" as const,
        imageReferences: [
          "http://www.uahpet.com/cdn/shop/files/uahpet-dual-bowl-fresh-food-feeder-heating-and-cooling.webp?v=1789713332",
        ],
        thumbnailUrl: "https://scontent.fbcdn.net/v/ad-thumb.jpg",
      };

      const cardMedia = resolveCandidatePrimaryMedia(candidate, true);
      const piGallery = resolveProductMediaGallery({
        productId: "prod_uahpet",
        candidateId: candidate.candidateId,
        productTitle: candidate.canonicalProductName,
        storeDomain: candidate.storeDomain,
        canonicalProductUrl: candidate.canonicalProductUrl,
        candidateImageReferences: candidate.imageReferences,
        candidateThumbnailUrl: candidate.thumbnailUrl,
      });

      expect(cardMedia.primaryImageUrl).toBe(piGallery.primaryImage?.url);
      expect(cardMedia.primaryMediaSourceLabel).toBe("Merchant Product Image");
    });
  });

  describe("Section 21: Security & Provenance Negative Tests", () => {
    it("Blocks unsafe schemes (javascript:, data:, file:, blob:) and private/loopback SSRF IPs", () => {
      expect(validateAndNormalizeMediaUrl("javascript:alert(1)", "IMAGE").valid).toBe(false);
      expect(
        validateAndNormalizeMediaUrl("data:text/html;base64,PHNjcmlwdD4=", "IMAGE").valid
      ).toBe(false);
      expect(validateAndNormalizeMediaUrl("file:///etc/passwd", "IMAGE").valid).toBe(false);
      expect(validateAndNormalizeMediaUrl("blob:https://evil.com/123", "VIDEO").valid).toBe(
        false
      );

      for (const host of [
        "localhost",
        "127.0.0.1",
        "10.0.0.1",
        "172.16.0.5",
        "192.168.1.1",
        "169.254.169.254",
        "[::1]",
      ]) {
        expect(isPrivateOrLoopbackHost(host)).toBe(true);
        expect(validateAndNormalizeMediaUrl(`http://${host}/secret.png`, "IMAGE").valid).toBe(
          false
        );
      }

      expect(
        validateAndNormalizeMediaUrl("https://evil-embed-host.com/embed/123", "VIDEO").valid
      ).toBe(false);
      const yt = validateAndNormalizeMediaUrl(
        "https://www.youtube.com/embed/dQw4w9WgXcQ",
        "VIDEO"
      );
      expect(yt.valid).toBe(true);
      expect(yt.isEmbed).toBe(true);
    });
  });

  describe("Sections 8, 9, 10, 11, 22 & Adversarial False-PASS Resistance", () => {
    it("Enforces truthful merchant page verification, buyer-oriented copy, KH-02/KH-01 score separation, and demand audit values", () => {
      const snapshot: any = {
        topic: "Automatic Pet Feeder",
        topThree: [],
        researchShortlist: {
          qualifiedCount: 2,
          requestedCount: 3,
          shortlist: [
            {
              candidateId: "cand_uahpet",
              canonicalProductName: "Automatic Wet Food Cat Feeder with Cooling & Warming",
              identityStatus: "VERIFIED",
              fetchOutcome: "FETCH_OK",
              productRealityStatus: "EVIDENCE_SUPPORTED_PHYSICAL_PRODUCT",
              storeDomain: "uahpet.com",
              canonicalProductUrl: "https://www.uahpet.com/products/feeder",
              verificationReason:
                "Resolved from OpenGraph/DOM title on https://www.uahpet.com/products/feeder",
              supportingAdIds: ["ad_1", "ad_2"],
              totalObservationCount: 4,
              distinctAdvertisersCount: 1,
              supportingSourceTypes: ["META_ADS"],
              imageReferences: [
                "https://www.uahpet.com/cdn/shop/files/uahpet-dual-bowl-fresh-food-feeder-heating-and-cooling.webp",
              ],
            },
            {
              candidateId: "cand_1783682388",
              canonicalProductName: "Automatic Dog Feeder for Easy Daily Meals",
              identityStatus: "PROBABLE",
              fetchOutcome: "HTTP_ERROR",
              productRealityStatus: "EVIDENCE_SUPPORTED_PHYSICAL_PRODUCT",
              storeDomain: "kingspetboutique.info",
              canonicalProductUrl: "https://kingspetboutique.info/products/automatic-dog-feeder",
              verificationReason:
                "Storefront product page fetch returned HTTP_ERROR; product identity inferred from ad creative.",
              supportingAdIds: ["ad_3"],
              totalObservationCount: 2,
              distinctAdvertisersCount: 1,
              supportingSourceTypes: ["META_ADS"],
              thumbnailUrl: "https://scontent.fbcdn.net/v/dog-feeder.jpg",
            },
          ],
        },
        provisionalCandidates: [],
      };

      const cards = buildCanonicalRecommendedProducts(snapshot);
      expect(cards.length).toBe(2);

      const honesty = evaluateMerchantPageHonesty(cards);
      expect(honesty.valid).toBe(true);

      const copyCheck = evaluateBuyerOrientedCopyPurity(cards);
      expect(copyCheck.valid).toBe(true);

      const scoreCheck = evaluateKh02Kh01ScoreSeparation({
        kh02Score: 74,
        kh02Confidence: 85,
        opportunityAssessment: null,
        displayedKh01Opportunity: "Not Assessed",
        displayedKh01Readiness: "Not Assessed",
      });
      expect(scoreCheck.valid).toBe(true);

      const demandCheck = evaluateDemandAuditValueIntegrity([
        {
          keyword: "Automatic Pet Feeder",
          rawValues: [76, 79, 77, 81, 78, 82],
          observations: [
            { demandValue: 76, value: 76 },
            { demandValue: 79, value: 79 },
          ],
        },
      ]);
      expect(demandCheck.valid).toBe(true);
    });

    it("Catches and rejects all 11 adversarial false-PASS mutations (A through K)", () => {
      const res = runAdversarialFalsePassSuiteV12_4_3_2_1();
      expect(res.mutations.length).toBe(11);
      expect(res.allMutationsCaught).toBe(true);
    });
  });
});
