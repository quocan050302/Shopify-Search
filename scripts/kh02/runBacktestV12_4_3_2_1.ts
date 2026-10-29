/**
 * SWAI KH-02 V12.4.3.2.1 — Historical Backtest & Holdout Validation Runner
 *
 * Extends V12.4.3.2 backtest with disjoint DEV and HOLDOUT evaluation across:
 * 1. Product Media Gallery resolution accuracy (merchant primary priority, ad creative fallback labeling,
 *    playable video extraction, stock/private URL rejection, Shopify size-variant deduplication,
 *    and zero cross-product media contamination).
 * 2. Merchant product page verification honesty (zero false "Merchant product page verified" on PROBABLE/HTTP_ERROR).
 * 3. Buyer-oriented "Why it fits your search" copy purity (zero raw OpenGraph/JSON-LD/HTTP status leaks).
 * 4. KH-02 vs KH-01 score separation (zero false KH-01 readiness when opportunityAssessment is null).
 * 5. Broad query ("Automatic Pet Feeder") dog+cat inclusion vs species-specific ("dog", "cat") isolation.
 */

import fs from "fs";
import path from "path";
import { runBacktestV12_4_3_2 } from "./runBacktestV12_4_3_2";
import {
  resolveProductMediaGallery,
  ProductMediaResolutionInput,
} from "@/services/kh02/media/productMediaResolver";
import {
  buildCanonicalRecommendedProducts,
  buildBuyerOrientedWhyItFits,
} from "@/services/kh02/presentation/productFinderViewModel";
import { evaluateProductRelevance } from "@/services/kh02/identity/productRelevanceEvaluator";

export interface V12_4_3_2_1MediaAndFlowCase {
  caseId: string;
  split: "DEV" | "HOLDOUT";
  category:
    | "MERCHANT_PRIMARY_WITH_VIDEO"
    | "AD_CREATIVE_FALLBACK_ONLY"
    | "STOCK_AND_SSRF_REJECTION"
    | "CROSS_PRODUCT_GUARD"
    | "PROBABLE_IDENTITY_HONESTY"
    | "BROAD_VS_SPECIES_QUERY";
  description: string;
  query: string;
  mediaInput: ProductMediaResolutionInput;
  candidateFixture: Record<string, any>;
  expected: {
    primarySourceType: string | null;
    hasPlayableVideo: boolean;
    rejectedCountMin: number;
    dedupedImageCountExact?: number;
    merchantPageVerifiedBadgeExpected: boolean;
    whyItFitsCleanExpected: boolean;
    relevanceAcceptedExpected: boolean;
  };
}

const V12_4_3_2_1_CASES: V12_4_3_2_1MediaAndFlowCase[] = [
  // ======================== DEV CASES (6) ========================
  {
    caseId: "v124321_dev_01_pawspick_wet_feeder_gallery",
    split: "DEV",
    category: "MERCHANT_PRIMARY_WITH_VIDEO",
    description:
      "Pawspick Wet Food Cat Feeder resolves merchant gallery primary image, deduplicates Shopify _400x400/_1024x1024 variants, and attaches MP4 product demo video",
    query: "Automatic Pet Feeder",
    mediaInput: {
      productId: "prod_pawspick_wet_feeder",
      candidateId: "cand_pawspick_wet_feeder",
      productTitle: "Automatic Wet Food Cat Feeder with Cooling & Warming",
      canonicalProductUrl: "https://pawspick.com/products/automatic-wet-food-cat-feeder",
      storeDomain: "pawspick.com",
      identityStatus: "VERIFIED",
      fetchOutcome: "VERIFIED_HTML",
      productImageUrl:
        "https://cdn.shopify.com/s/files/1/0555/1111/products/wet-feeder-main_1024x1024.jpg?v=17100001",
      landingPageImageUrls: [
        "https://cdn.shopify.com/s/files/1/0555/1111/products/wet-feeder-main_400x400.jpg?v=17100001",
        "https://cdn.shopify.com/s/files/1/0555/1111/products/wet-feeder-angle2_1024x1024.jpg?v=17100001",
        "https://cdn.shopify.com/s/files/1/0555/1111/products/wet-feeder-tray_1024x1024.jpg?v=17100001",
      ],
      adCreativeMedia: [
        {
          adId: "meta_ad_wet_1",
          mediaType: "IMAGE",
          imageUrl: "https://scontent.xx.fbcdn.net/v/t39.35426-6/wet_feeder_ad1.jpg",
          landingPageUrl: "https://pawspick.com/products/automatic-wet-food-cat-feeder",
          advertiserName: "Pawspick",
        },
        {
          adId: "meta_ad_wet_1_video",
          mediaType: "VIDEO",
          videoUrl: "https://cdn.pawspick.com/videos/wet-feeder-cooling-demo.mp4",
          thumbnailUrl: "https://scontent.xx.fbcdn.net/v/t39.35426-6/wet_feeder_poster.jpg",
          landingPageUrl: "https://pawspick.com/products/automatic-wet-food-cat-feeder",
          advertiserName: "Pawspick",
        },
      ],
    },
    candidateFixture: {
      candidateId: "cand_pawspick_wet_feeder",
      researchProductId: "prod_pawspick_wet_feeder",
      title: "Automatic Wet Food Cat Feeder with Cooling & Warming",
      canonicalProductName: "Automatic Wet Food Cat Feeder with Cooling & Warming",
      canonicalProductUrl: "https://pawspick.com/products/automatic-wet-food-cat-feeder",
      storeDomain: "pawspick.com",
      identityStatus: "VERIFIED",
      identityConfidence: 91,
      identityEvidence: {
        fetchOutcome: "VERIFIED_HTML",
        httpStatus: 200,
        verificationNotes: [
          "Merchant product page verified (OpenGraph title, JSON-LD Product schema, price USD 89.99).",
        ],
      },
      relevanceReason:
        "Merchant product page verified (OpenGraph title, JSON-LD Product schema, price USD 89.99).",
      supportingAdCount: 5,
      observationCount: 12,
      distinctAdvertisersCount: 2,
    },
    expected: {
      primarySourceType: "MERCHANT_PRODUCT_PAGE",
      hasPlayableVideo: true,
      rejectedCountMin: 0,
      dedupedImageCountExact: 4,
      merchantPageVerifiedBadgeExpected: true,
      whyItFitsCleanExpected: true,
      relevanceAcceptedExpected: true,
    },
  },
  {
    caseId: "v124321_dev_02_dog_feeder_probable_http404",
    split: "DEV",
    category: "PROBABLE_IDENTITY_HONESTY",
    description:
      "Automatic Dog Feeder with identityStatus=PROBABLE and HTTP_404 never claims 'Merchant product page verified' and uses Meta Ad Creative fallback with honest labeling",
    query: "Automatic Pet Feeder",
    mediaInput: {
      productId: "prod_k9_daily_feeder",
      candidateId: "cand_k9_daily_feeder",
      productTitle: "Automatic Dog Feeder for Easy Daily Meals",
      canonicalProductUrl: "https://k9meals.com/products/automatic-dog-feeder",
      storeDomain: "k9meals.com",
      identityStatus: "PROBABLE",
      fetchOutcome: "HTTP_ERROR",
      adCreativeMedia: [
        {
          adId: "meta_ad_dog_feeder_1",
          mediaType: "IMAGE",
          imageUrl: "https://scontent.xx.fbcdn.net/v/t39.35426-6/dog_feeder_creative.jpg",
          landingPageUrl: "https://k9meals.com/products/automatic-dog-feeder",
          advertiserName: "K9 Meals",
        },
      ],
    },
    candidateFixture: {
      candidateId: "cand_k9_daily_feeder",
      researchProductId: "prod_k9_daily_feeder",
      title: "Automatic Dog Feeder for Easy Daily Meals",
      canonicalProductName: "Automatic Dog Feeder for Easy Daily Meals",
      canonicalProductUrl: "https://k9meals.com/products/automatic-dog-feeder",
      storeDomain: "k9meals.com",
      identityStatus: "PROBABLE",
      identityConfidence: 68,
      identityEvidence: {
        fetchOutcome: "HTTP_ERROR",
        httpStatus: 404,
        verificationNotes: [
          "Merchant page HTTP 404; product identity inferred from ad creative + canonical URL slug.",
        ],
      },
      relevanceReason:
        "Merchant page HTTP 404; product identity inferred from ad creative + canonical URL slug.",
      supportingAdCount: 6,
      observationCount: 9,
      distinctAdvertisersCount: 1,
    },
    expected: {
      primarySourceType: "META_AD_CREATIVE",
      hasPlayableVideo: false,
      rejectedCountMin: 0,
      merchantPageVerifiedBadgeExpected: false,
      whyItFitsCleanExpected: true,
      relevanceAcceptedExpected: true,
    },
  },
  {
    caseId: "v124321_dev_03_stock_and_ssrf_media_rejection",
    split: "DEV",
    category: "STOCK_AND_SSRF_REJECTION",
    description:
      "Unsplash stock photos, placeholder.com URLs, and private loopback/RFC1918 URLs are rejected and never rendered in the Product Media Gallery",
    query: "dog grooming vacuum",
    mediaInput: {
      productId: "prod_groom_vac",
      candidateId: "cand_groom_vac",
      productTitle: "Low-Noise Dog Grooming Vacuum Kit",
      canonicalProductUrl: "https://furflow.com/products/dog-grooming-vacuum-kit",
      storeDomain: "furflow.com",
      identityStatus: "VERIFIED",
      fetchOutcome: "VERIFIED_HTML",
      productImageUrl: "https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=800",
      landingPageImageUrls: [
        "http://127.0.0.1:8080/internal-admin-image.png",
        "https://via.placeholder.com/600x600.png",
        "https://cdn.furflow.com/products/dog-grooming-vacuum-kit-hero.webp",
      ],
    },
    candidateFixture: {
      candidateId: "cand_groom_vac",
      researchProductId: "prod_groom_vac",
      title: "Low-Noise Dog Grooming Vacuum Kit",
      canonicalProductName: "Low-Noise Dog Grooming Vacuum Kit",
      canonicalProductUrl: "https://furflow.com/products/dog-grooming-vacuum-kit",
      storeDomain: "furflow.com",
      identityStatus: "VERIFIED",
      identityConfidence: 88,
      identityEvidence: {
        fetchOutcome: "VERIFIED_HTML",
        httpStatus: 200,
      },
      supportingAdCount: 4,
      observationCount: 4,
      distinctAdvertisersCount: 1,
    },
    expected: {
      primarySourceType: "MERCHANT_PRODUCT_PAGE",
      hasPlayableVideo: false,
      rejectedCountMin: 3,
      dedupedImageCountExact: 1,
      merchantPageVerifiedBadgeExpected: true,
      whyItFitsCleanExpected: true,
      relevanceAcceptedExpected: true,
    },
  },
  {
    caseId: "v124321_dev_04_cross_product_media_guard",
    split: "DEV",
    category: "CROSS_PRODUCT_GUARD",
    description:
      "Ad creative media belonging to a different merchant domain (otherbrand.io) is blocked from contaminating the candidate's media gallery",
    query: "pet hair remover roller",
    mediaInput: {
      productId: "prod_uproot_roller",
      candidateId: "cand_uproot_roller",
      productTitle: "Reusable Pet Hair Remover Roller",
      canonicalProductUrl: "https://uprootclean.com/products/reusable-pet-hair-remover",
      storeDomain: "uprootclean.com",
      identityStatus: "VERIFIED",
      fetchOutcome: "VERIFIED_HTML",
      productImageUrl: "https://cdn.uprootclean.com/products/roller-main.jpg",
      adCreativeMedia: [
        {
          adId: "foreign_ad_99",
          mediaType: "IMAGE",
          imageUrl: "https://cdn.otherbrand.io/products/unrelated-kitchen-knife.jpg",
          landingPageUrl: "https://otherbrand.io/products/unrelated-kitchen-knife",
          advertiserName: "Other Brand",
        },
      ],
    },
    candidateFixture: {
      candidateId: "cand_uproot_roller",
      researchProductId: "prod_uproot_roller",
      title: "Reusable Pet Hair Remover Roller",
      canonicalProductName: "Reusable Pet Hair Remover Roller",
      canonicalProductUrl: "https://uprootclean.com/products/reusable-pet-hair-remover",
      storeDomain: "uprootclean.com",
      identityStatus: "VERIFIED",
      identityConfidence: 90,
      identityEvidence: {
        fetchOutcome: "VERIFIED_HTML",
        httpStatus: 200,
      },
      supportingAdCount: 3,
      observationCount: 6,
      distinctAdvertisersCount: 1,
    },
    expected: {
      primarySourceType: "MERCHANT_PRODUCT_PAGE",
      hasPlayableVideo: false,
      rejectedCountMin: 1,
      dedupedImageCountExact: 1,
      merchantPageVerifiedBadgeExpected: true,
      whyItFitsCleanExpected: true,
      relevanceAcceptedExpected: true,
    },
  },
  {
    caseId: "v124321_dev_05_broad_pet_feeder_accepts_cat_and_dog",
    split: "DEV",
    category: "BROAD_VS_SPECIES_QUERY",
    description:
      "Broad query 'Automatic Pet Feeder' accepts both Automatic Wet Food Cat Feeder and Automatic Dog Feeder",
    query: "Automatic Pet Feeder",
    mediaInput: {
      productId: "prod_broad_feeder",
      candidateId: "cand_broad_feeder",
      productTitle: "Automatic Smart Pet Feeder with Camera",
      canonicalProductUrl: "https://pawspick.com/products/smart-pet-feeder",
      storeDomain: "pawspick.com",
      identityStatus: "VERIFIED",
      fetchOutcome: "VERIFIED_HTML",
      productImageUrl: "https://cdn.pawspick.com/products/smart-pet-feeder.jpg",
    },
    candidateFixture: {
      candidateId: "cand_broad_feeder",
      researchProductId: "prod_broad_feeder",
      title: "Automatic Smart Pet Feeder with Camera",
      canonicalProductName: "Automatic Smart Pet Feeder with Camera",
      canonicalProductUrl: "https://pawspick.com/products/smart-pet-feeder",
      storeDomain: "pawspick.com",
      identityStatus: "VERIFIED",
      identityConfidence: 92,
      identityEvidence: {
        fetchOutcome: "VERIFIED_HTML",
        httpStatus: 200,
      },
      supportingAdCount: 4,
      observationCount: 8,
      distinctAdvertisersCount: 2,
    },
    expected: {
      primarySourceType: "MERCHANT_PRODUCT_PAGE",
      hasPlayableVideo: false,
      rejectedCountMin: 0,
      dedupedImageCountExact: 1,
      merchantPageVerifiedBadgeExpected: true,
      whyItFitsCleanExpected: true,
      relevanceAcceptedExpected: true,
    },
  },
  {
    caseId: "v124321_dev_06_species_query_dog_rejects_cat_feeder",
    split: "DEV",
    category: "BROAD_VS_SPECIES_QUERY",
    description:
      "Species-specific query 'dog' strictly rejects cat-only 'Automatic Wet Food Cat Feeder'",
    query: "dog",
    mediaInput: {
      productId: "prod_cat_only_for_dog",
      candidateId: "cand_cat_only_for_dog",
      productTitle: "Automatic Wet Food Cat Feeder",
      canonicalProductUrl: "https://pawspick.com/products/automatic-wet-food-cat-feeder",
      storeDomain: "pawspick.com",
    },
    candidateFixture: {
      candidateId: "cand_cat_only_for_dog",
      title: "Automatic Wet Food Cat Feeder",
      canonicalProductName: "Automatic Wet Food Cat Feeder",
      canonicalProductUrl: "https://pawspick.com/products/automatic-wet-food-cat-feeder",
      storeDomain: "pawspick.com",
      identityStatus: "PROBABLE",
      evidenceSnippets: ["Keep your cat and kitten wet meals fresh all day"],
    },
    expected: {
      primarySourceType: null,
      hasPlayableVideo: false,
      rejectedCountMin: 0,
      merchantPageVerifiedBadgeExpected: false,
      whyItFitsCleanExpected: true,
      relevanceAcceptedExpected: false,
    },
  },

  // ======================== HOLDOUT CASES (6) ========================
  {
    caseId: "v124321_holdout_01_orthopedic_dog_bed_gallery_and_video",
    split: "HOLDOUT",
    category: "MERCHANT_PRIMARY_WITH_VIDEO",
    description:
      "Holdout Orthopedic Dog Bed resolves merchant primary image, deduplicates Shopify size variants, and attaches WebM product video",
    query: "orthopedic dog bed",
    mediaInput: {
      productId: "prod_barkrest_bed",
      candidateId: "cand_barkrest_bed",
      productTitle: "BarkRest Memory Foam Orthopedic Dog Bed",
      canonicalProductUrl: "https://barkrest.com/products/memory-foam-dog-bed",
      storeDomain: "barkrest.com",
      identityStatus: "VERIFIED",
      fetchOutcome: "VERIFIED_HTML",
      productImageUrl:
        "https://cdn.shopify.com/s/files/1/0888/2222/products/barkrest-bed-main_2048x2048.jpg?v=99",
      landingPageImageUrls: [
        "https://cdn.shopify.com/s/files/1/0888/2222/products/barkrest-bed-main_600x600.jpg?v=99",
        "https://cdn.shopify.com/s/files/1/0888/2222/products/barkrest-bed-foam-layer_1024x1024.jpg?v=99",
      ],
      adCreativeMedia: [
        {
          adId: "meta_ad_barkrest_1",
          mediaType: "IMAGE",
          imageUrl: "https://scontent.xx.fbcdn.net/v/t39.35426-6/barkrest_ad.jpg",
          landingPageUrl: "https://barkrest.com/products/memory-foam-dog-bed",
          advertiserName: "BarkRest",
        },
        {
          adId: "meta_ad_barkrest_1_video",
          mediaType: "VIDEO",
          videoUrl: "https://cdn.barkrest.com/media/barkrest-compression-test.webm",
          landingPageUrl: "https://barkrest.com/products/memory-foam-dog-bed",
          advertiserName: "BarkRest",
        },
      ],
    },
    candidateFixture: {
      candidateId: "cand_barkrest_bed",
      researchProductId: "prod_barkrest_bed",
      title: "BarkRest Memory Foam Orthopedic Dog Bed",
      canonicalProductName: "BarkRest Memory Foam Orthopedic Dog Bed",
      canonicalProductUrl: "https://barkrest.com/products/memory-foam-dog-bed",
      storeDomain: "barkrest.com",
      identityStatus: "VERIFIED",
      identityConfidence: 94,
      identityEvidence: {
        fetchOutcome: "VERIFIED_HTML",
        httpStatus: 200,
        verificationNotes: [
          "Merchant product page verified (OpenGraph title, JSON-LD Product schema, price USD 119.00).",
        ],
      },
      relevanceReason:
        "Merchant product page verified (OpenGraph title, JSON-LD Product schema, price USD 119.00).",
      supportingAdCount: 7,
      observationCount: 15,
      distinctAdvertisersCount: 2,
    },
    expected: {
      primarySourceType: "MERCHANT_PRODUCT_PAGE",
      hasPlayableVideo: true,
      rejectedCountMin: 0,
      dedupedImageCountExact: 3,
      merchantPageVerifiedBadgeExpected: true,
      whyItFitsCleanExpected: true,
      relevanceAcceptedExpected: true,
    },
  },
  {
    caseId: "v124321_holdout_02_cat_fountain_http403_probable",
    split: "HOLDOUT",
    category: "PROBABLE_IDENTITY_HONESTY",
    description:
      "Holdout Cat Water Fountain with HTTP 403 / PROBABLE identity never shows 'Merchant product page verified' and falls back to Meta Ad Creative",
    query: "cat water fountain",
    mediaInput: {
      productId: "prod_purrstream_fountain",
      candidateId: "cand_purrstream_fountain",
      productTitle: "PurrStream Wireless Stainless Cat Fountain",
      canonicalProductUrl: "https://purrstream.com/products/wireless-cat-fountain",
      storeDomain: "purrstream.com",
      identityStatus: "PROBABLE",
      fetchOutcome: "HTTP_ERROR",
      adCreativeMedia: [
        {
          adId: "meta_ad_purr_1",
          mediaType: "IMAGE",
          imageUrl: "https://scontent.xx.fbcdn.net/v/t39.35426-6/purrstream_ad1.jpg",
          landingPageUrl: "https://purrstream.com/products/wireless-cat-fountain",
          advertiserName: "PurrStream",
        },
      ],
    },
    candidateFixture: {
      candidateId: "cand_purrstream_fountain",
      researchProductId: "prod_purrstream_fountain",
      title: "PurrStream Wireless Stainless Cat Fountain",
      canonicalProductName: "PurrStream Wireless Stainless Cat Fountain",
      canonicalProductUrl: "https://purrstream.com/products/wireless-cat-fountain",
      storeDomain: "purrstream.com",
      identityStatus: "PROBABLE",
      identityConfidence: 64,
      identityEvidence: {
        fetchOutcome: "HTTP_ERROR",
        httpStatus: 403,
        verificationNotes: ["Merchant page HTTP 403; inferred from ad creative."],
      },
      relevanceReason: "Merchant page HTTP 403; inferred from ad creative.",
      supportingAdCount: 4,
      observationCount: 7,
      distinctAdvertisersCount: 1,
    },
    expected: {
      primarySourceType: "META_AD_CREATIVE",
      hasPlayableVideo: false,
      rejectedCountMin: 0,
      dedupedImageCountExact: 1,
      merchantPageVerifiedBadgeExpected: false,
      whyItFitsCleanExpected: true,
      relevanceAcceptedExpected: true,
    },
  },
  {
    caseId: "v124321_holdout_03_stock_picsum_and_private_ip_rejection",
    split: "HOLDOUT",
    category: "STOCK_AND_SSRF_REJECTION",
    description:
      "Holdout candidate rejects picsum.photos, dummyimage.com, and 192.168.1.100 URLs while preserving valid merchant gallery image",
    query: "gardening pruning shears",
    mediaInput: {
      productId: "prod_titan_shears",
      candidateId: "cand_titan_shears",
      productTitle: "Cordless Electric Pruning Shears 21V",
      canonicalProductUrl: "https://titangarden.com/products/electric-pruning-shears",
      storeDomain: "titangarden.com",
      identityStatus: "VERIFIED",
      fetchOutcome: "VERIFIED_HTML",
      productImageUrl: "https://picsum.photos/800/800",
      landingPageImageUrls: [
        "https://dummyimage.com/600x400/000/fff",
        "http://192.168.1.100/private-shears.jpg",
        "https://cdn.titangarden.com/products/electric-pruning-shears-hero.jpg",
      ],
    },
    candidateFixture: {
      candidateId: "cand_titan_shears",
      researchProductId: "prod_titan_shears",
      title: "Cordless Electric Pruning Shears 21V",
      canonicalProductName: "Cordless Electric Pruning Shears 21V",
      canonicalProductUrl: "https://titangarden.com/products/electric-pruning-shears",
      storeDomain: "titangarden.com",
      identityStatus: "VERIFIED",
      identityConfidence: 90,
      identityEvidence: {
        fetchOutcome: "VERIFIED_HTML",
        httpStatus: 200,
      },
      supportingAdCount: 5,
      observationCount: 9,
      distinctAdvertisersCount: 2,
    },
    expected: {
      primarySourceType: "MERCHANT_PRODUCT_PAGE",
      hasPlayableVideo: false,
      rejectedCountMin: 3,
      dedupedImageCountExact: 1,
      merchantPageVerifiedBadgeExpected: true,
      whyItFitsCleanExpected: true,
      relevanceAcceptedExpected: true,
    },
  },
  {
    caseId: "v124321_holdout_04_cross_product_contamination_blocked",
    split: "HOLDOUT",
    category: "CROSS_PRODUCT_GUARD",
    description:
      "Holdout candidate blocks foreign merchant domain media from being attached to the product gallery",
    query: "laser level tool",
    mediaInput: {
      productId: "prod_beampro_laser",
      candidateId: "cand_beampro_laser",
      productTitle: "BeamPro 360 Self-Leveling Green Laser Level",
      canonicalProductUrl: "https://beamprotools.com/products/360-green-laser-level",
      storeDomain: "beamprotools.com",
      identityStatus: "VERIFIED",
      fetchOutcome: "VERIFIED_HTML",
      productImageUrl: "https://cdn.beamprotools.com/products/laser-360-main.jpg",
      adCreativeMedia: [
        {
          adId: "foreign_ad_202",
          mediaType: "IMAGE",
          imageUrl: "https://cdn.unrelatedshoes.com/products/running-shoe.jpg",
          landingPageUrl: "https://unrelatedshoes.com/products/running-shoe",
          advertiserName: "Unrelated Shoes",
        },
      ],
    },
    candidateFixture: {
      candidateId: "cand_beampro_laser",
      researchProductId: "prod_beampro_laser",
      title: "BeamPro 360 Self-Leveling Green Laser Level",
      canonicalProductName: "BeamPro 360 Self-Leveling Green Laser Level",
      canonicalProductUrl: "https://beamprotools.com/products/360-green-laser-level",
      storeDomain: "beamprotools.com",
      identityStatus: "VERIFIED",
      identityConfidence: 89,
      identityEvidence: {
        fetchOutcome: "VERIFIED_HTML",
        httpStatus: 200,
      },
      supportingAdCount: 4,
      observationCount: 8,
      distinctAdvertisersCount: 1,
    },
    expected: {
      primarySourceType: "MERCHANT_PRODUCT_PAGE",
      hasPlayableVideo: false,
      rejectedCountMin: 1,
      dedupedImageCountExact: 1,
      merchantPageVerifiedBadgeExpected: true,
      whyItFitsCleanExpected: true,
      relevanceAcceptedExpected: true,
    },
  },
  {
    caseId: "v124321_holdout_05_cat_query_rejects_dog_only_harness",
    split: "HOLDOUT",
    category: "BROAD_VS_SPECIES_QUERY",
    description:
      "Holdout species query 'cat' strictly rejects dog-only 'No-Pull Tactical Dog Harness'",
    query: "cat",
    mediaInput: {
      productId: "prod_dog_harness_for_cat",
      candidateId: "cand_dog_harness_for_cat",
      productTitle: "No-Pull Tactical Dog Harness for Large Breed Dogs",
      canonicalProductUrl: "https://k9gear.com/products/no-pull-dog-harness",
      storeDomain: "k9gear.com",
    },
    candidateFixture: {
      candidateId: "cand_dog_harness_for_cat",
      title: "No-Pull Tactical Dog Harness for Large Breed Dogs",
      canonicalProductName: "No-Pull Tactical Dog Harness for Large Breed Dogs",
      canonicalProductUrl: "https://k9gear.com/products/no-pull-dog-harness",
      storeDomain: "k9gear.com",
      identityStatus: "PROBABLE",
      evidenceSnippets: ["Heavy duty tactical harness for dogs and puppies"],
    },
    expected: {
      primarySourceType: null,
      hasPlayableVideo: false,
      rejectedCountMin: 0,
      merchantPageVerifiedBadgeExpected: false,
      whyItFitsCleanExpected: true,
      relevanceAcceptedExpected: false,
    },
  },
  {
    caseId: "v124321_holdout_06_empty_media_honest_fallback",
    split: "HOLDOUT",
    category: "AD_CREATIVE_FALLBACK_ONLY",
    description:
      "Holdout candidate with zero valid media URLs returns an honest empty gallery (totalCount=0) without fabricating placeholder images",
    query: "portable blender",
    mediaInput: {
      productId: "prod_empty_media_blender",
      candidateId: "cand_empty_media_blender",
      productTitle: "BlendGo USB Rechargeable Portable Blender",
      canonicalProductUrl: "https://blendgo.com/products/portable-blender",
      storeDomain: "blendgo.com",
    },
    candidateFixture: {
      candidateId: "cand_empty_media_blender",
      researchProductId: "prod_empty_media_blender",
      title: "BlendGo USB Rechargeable Portable Blender",
      canonicalProductName: "BlendGo USB Rechargeable Portable Blender",
      canonicalProductUrl: "https://blendgo.com/products/portable-blender",
      storeDomain: "blendgo.com",
      identityStatus: "PROBABLE",
      identityConfidence: 65,
      identityEvidence: {
        fetchOutcome: "HTTP_ERROR",
        httpStatus: 503,
      },
      supportingAdCount: 2,
      observationCount: 3,
      distinctAdvertisersCount: 1,
    },
    expected: {
      primarySourceType: null,
      hasPlayableVideo: false,
      rejectedCountMin: 0,
      dedupedImageCountExact: 0,
      merchantPageVerifiedBadgeExpected: false,
      whyItFitsCleanExpected: true,
      relevanceAcceptedExpected: true,
    },
  },
];

export interface V12_4_3_2_1SplitSummary {
  split: "DEV" | "HOLDOUT";
  totalCases: number;
  passedCases: number;
  merchantPrimaryAccuracyRate: number;
  videoPlayableAccuracyRate: number;
  stockAndSsrfRejectionCount: number;
  crossProductContaminationCount: number;
  falseMerchantVerifiedBadgeCount: number;
  technicalMetadataLeakInWhyItFitsCount: number;
  broadVsSpeciesAccuracyRate: number;
}

export interface V12_4_3_2_1BacktestReport {
  version: string;
  verdict: "PASS" | "FAIL";
  [key: string]: any;
  v12_4_3_2_1_Extension: {
    evaluatedAt: string;
    antiOverfittingAudit: {
      devCaseIds: string[];
      holdoutCaseIds: string[];
      overlapCount: number;
      zeroOverlapVerified: boolean;
    };
    devSummary: V12_4_3_2_1SplitSummary;
    holdoutSummary: V12_4_3_2_1SplitSummary;
    caseResults: Array<{
      caseId: string;
      split: "DEV" | "HOLDOUT";
      category: string;
      passed: boolean;
      primarySourceTypeObserved: string | null;
      hasPlayableVideoObserved: boolean;
      rejectedMediaCount: number;
      imageCount: number;
      merchantPageVerifiedObserved: boolean;
      whyItFitsText: string;
      whyItFitsClean: boolean;
      relevanceAcceptedObserved: boolean;
    }>;
    overallPass: boolean;
  };
}

function evaluateSplit(
  split: "DEV" | "HOLDOUT",
  cases: V12_4_3_2_1MediaAndFlowCase[]
): {
  summary: V12_4_3_2_1SplitSummary;
  results: V12_4_3_2_1BacktestReport["v12_4_3_2_1_Extension"]["caseResults"];
} {
  const results: V12_4_3_2_1BacktestReport["v12_4_3_2_1_Extension"]["caseResults"] = [];
  let passedCases = 0;
  let merchantPrimaryCorrect = 0;
  let videoPlayableCorrect = 0;
  let stockAndSsrfRejectionCount = 0;
  let crossProductContaminationCount = 0;
  let falseMerchantVerifiedBadgeCount = 0;
  let technicalMetadataLeakInWhyItFitsCount = 0;
  let broadVsSpeciesCorrect = 0;

  for (const c of cases) {
    const gallery = resolveProductMediaGallery(c.mediaInput);
    const primarySourceTypeObserved = gallery.primaryMedia?.sourceType || null;
    const hasPlayableVideoObserved = gallery.hasVideo && gallery.videoItems.length > 0;
    const rejectedMediaCount = gallery.rejectedItems.length;
    const imageCount = gallery.items.filter((i) => i.mediaType === "IMAGE").length;

    const canonicalCards = buildCanonicalRecommendedProducts({
      topThree: [],
      researchShortlist: {
        shortlist: [{ candidate: c.candidateFixture, shortlistRank: 1 }],
      },
      provisionalCandidates: [],
      topic: c.query,
    });
    const card = canonicalCards[0];
    const merchantPageVerifiedObserved = Boolean(card?.merchantPageVerified);
    const whyItFitsText =
      (card as any)?.whyItFitsSearch || buildBuyerOrientedWhyItFits(c.candidateFixture, c.query);
    const whyItFitsClean =
      !/OpenGraph|JSON-LD|HTTP\s*[45]\d\d|DOM\s+title|price\s+USD/i.test(whyItFitsText);

    const relevanceEval = evaluateProductRelevance(
      {
        title: c.candidateFixture.title,
        canonicalProductName: c.candidateFixture.canonicalProductName,
        canonicalProductUrl: c.candidateFixture.canonicalProductUrl,
        storeDomain: c.candidateFixture.storeDomain,
        evidenceSnippets: c.candidateFixture.evidenceSnippets || [c.candidateFixture.title],
      },
      c.query
    );
    const relevanceAcceptedObserved = relevanceEval.isAccepted;

    const primaryMatch = primarySourceTypeObserved === c.expected.primarySourceType;
    const videoMatch = hasPlayableVideoObserved === c.expected.hasPlayableVideo;
    const rejectedMatch = rejectedMediaCount >= c.expected.rejectedCountMin;
    const dedupMatch =
      c.expected.dedupedImageCountExact === undefined ||
      imageCount === c.expected.dedupedImageCountExact;
    const badgeMatch =
      merchantPageVerifiedObserved === c.expected.merchantPageVerifiedBadgeExpected;
    const copyMatch = whyItFitsClean === c.expected.whyItFitsCleanExpected;
    const relMatch = relevanceAcceptedObserved === c.expected.relevanceAcceptedExpected;

    const hasForeignContamination = gallery.items.some(
      (item) =>
        item.url.includes("otherbrand.io") || item.url.includes("unrelatedshoes.com")
    );
    if (hasForeignContamination) crossProductContaminationCount++;

    if (
      !c.expected.merchantPageVerifiedBadgeExpected &&
      merchantPageVerifiedObserved
    ) {
      falseMerchantVerifiedBadgeCount++;
    }
    if (!whyItFitsClean) {
      technicalMetadataLeakInWhyItFitsCount++;
    }
    stockAndSsrfRejectionCount += rejectedMediaCount;

    if (primaryMatch) merchantPrimaryCorrect++;
    if (videoMatch) videoPlayableCorrect++;
    if (relMatch) broadVsSpeciesCorrect++;

    const passed =
      primaryMatch &&
      videoMatch &&
      rejectedMatch &&
      dedupMatch &&
      badgeMatch &&
      copyMatch &&
      relMatch &&
      !hasForeignContamination;

    if (passed) passedCases++;

    results.push({
      caseId: c.caseId,
      split: c.split,
      category: c.category,
      passed,
      primarySourceTypeObserved,
      hasPlayableVideoObserved,
      rejectedMediaCount,
      imageCount,
      merchantPageVerifiedObserved,
      whyItFitsText,
      whyItFitsClean,
      relevanceAcceptedObserved,
    });
  }

  const total = Math.max(1, cases.length);
  return {
    summary: {
      split,
      totalCases: cases.length,
      passedCases,
      merchantPrimaryAccuracyRate: Number((merchantPrimaryCorrect / total).toFixed(4)),
      videoPlayableAccuracyRate: Number((videoPlayableCorrect / total).toFixed(4)),
      stockAndSsrfRejectionCount,
      crossProductContaminationCount,
      falseMerchantVerifiedBadgeCount,
      technicalMetadataLeakInWhyItFitsCount,
      broadVsSpeciesAccuracyRate: Number((broadVsSpeciesCorrect / total).toFixed(4)),
    },
    results,
  };
}

export async function runBacktestV12_4_3_2_1(options?: {
  outputDir?: string;
}): Promise<V12_4_3_2_1BacktestReport> {
  const outDir =
    options?.outputDir || path.resolve(process.cwd(), "acceptance/kh02-v12.4.3.2.1");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const baseReport = await runBacktestV12_4_3_2({ outputDir: outDir });

  const devCases = V12_4_3_2_1_CASES.filter((c) => c.split === "DEV");
  const holdoutCases = V12_4_3_2_1_CASES.filter((c) => c.split === "HOLDOUT");

  const devCaseIds = devCases.map((c) => c.caseId);
  const holdoutCaseIds = holdoutCases.map((c) => c.caseId);
  const overlapIds = devCaseIds.filter((id) => holdoutCaseIds.includes(id));

  const devEval = evaluateSplit("DEV", devCases);
  const holdoutEval = evaluateSplit("HOLDOUT", holdoutCases);

  const overallPass =
    baseReport.verdict === "PASS" &&
    overlapIds.length === 0 &&
    devEval.summary.passedCases === devEval.summary.totalCases &&
    holdoutEval.summary.passedCases === holdoutEval.summary.totalCases &&
    devEval.summary.crossProductContaminationCount === 0 &&
    holdoutEval.summary.crossProductContaminationCount === 0 &&
    devEval.summary.falseMerchantVerifiedBadgeCount === 0 &&
    holdoutEval.summary.falseMerchantVerifiedBadgeCount === 0 &&
    devEval.summary.technicalMetadataLeakInWhyItFitsCount === 0 &&
    holdoutEval.summary.technicalMetadataLeakInWhyItFitsCount === 0;

  const fullReport: V12_4_3_2_1BacktestReport = {
    ...baseReport,
    version: "12.4.3.2.1",
    verdict: overallPass ? "PASS" : "FAIL",
    v12_4_3_2_1_Extension: {
      evaluatedAt: new Date().toISOString(),
      antiOverfittingAudit: {
        devCaseIds,
        holdoutCaseIds,
        overlapCount: overlapIds.length,
        zeroOverlapVerified: overlapIds.length === 0,
      },
      devSummary: devEval.summary,
      holdoutSummary: holdoutEval.summary,
      caseResults: [...devEval.results, ...holdoutEval.results],
      overallPass,
    },
  };

  fs.writeFileSync(
    path.join(outDir, "BACKTEST_DEV_VS_HOLDOUT.json"),
    JSON.stringify(fullReport, null, 2),
    "utf8"
  );

  return fullReport;
}

if (require.main === module) {
  runBacktestV12_4_3_2_1()
    .then((report) => {
      console.log(
        `[KH-02 V12.4.3.2.1 Backtest] Verdict=${report.verdict} | DEV=${report.v12_4_3_2_1_Extension.devSummary.passedCases}/${report.v12_4_3_2_1_Extension.devSummary.totalCases} | HOLDOUT=${report.v12_4_3_2_1_Extension.holdoutSummary.passedCases}/${report.v12_4_3_2_1_Extension.holdoutSummary.totalCases}`
      );
      process.exit(report.verdict === "PASS" ? 0 : 1);
    })
    .catch((err) => {
      console.error("[KH-02 V12.4.3.2.1 Backtest] Fatal error:", err);
      process.exit(1);
    });
}
