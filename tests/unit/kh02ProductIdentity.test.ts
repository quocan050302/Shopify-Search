import { describe, it, expect } from "vitest";
import {
  discoverProductCandidatesFromAds,
} from "@/services/kh02/identity/productCandidateDiscovery";
import {
  matchCrossPlatformProductEvidence,
  submitProductMatchReview,
} from "@/services/kh02/identity/crossPlatformProductMatcher";
import { SourceObservation } from "@/services/kh02/types";

describe("SWAI KH-02 — Product Identity & Candidate Deduplication", () => {
  it("groups 50 ad creatives for the same product into 1 Candidate without ad fragmentation", () => {
    // Generate 50 raw observations for the same product URL with varying UTM params and hooks
    const observations: SourceObservation[] = Array.from({ length: 50 }).map((_, i) => ({
      source: "META_ADS",
      sourceRecordId: `ad_meta_${i + 1}`,
      sourceUrl: `https://ergopaw.com/products/silent-dog-nail-grinder?utm_source=fb&utm_campaign=ad_${i + 1}`,
      advertiserOrCreator: "ErgoPaw Direct",
      advertiserDomain: "ergopaw.com",
      productMatchHint: `Hook #${i + 1}: Dogs hate nail clippers! Try silent grinding`,
      reportedPublishedAt: null,
      reportedFirstShownAt: "2026-08-01T00:00:00Z",
      reportedLastShownAt: "2026-10-25T00:00:00Z",
      observedAt: "2026-10-25T00:00:00Z",
      requestedMarket: "US",
      verifiedDeliveryMarket: "US",
      title: i % 2 === 0 ? "Silent Dog Nail Grinder - Buy Now 50% Off" : "Say goodbye to stressful nail clipping with ErgoPaw",
      description: "Tired of bleeding quicks and traumatized dogs? The diamond-bit motor trims gently.",
      metrics: { daysRunning: 85 },
      media: {
        thumbnailUrl: `https://cdn.shopify.com/products/grinder_thumb_${i % 3}.jpg`,
        videoUrl: `https://cdn.shopify.com/products/grinder_video_${i % 3}.mp4`,
        mediaType: "VIDEO",
      },
      provenance: "VERIFIED_SOURCE",
      evidenceReference: `CompetitorAd:ad_meta_${i + 1}`,
    }));

    const candidates = discoverProductCandidatesFromAds(observations, "Pet Gadgets");

    // Invariant: Must consolidate into exactly ONE product candidate
    expect(candidates).toHaveLength(1);
    const candidate = candidates[0];
    expect(candidate.canonicalProductUrl).toBe("https://ergopaw.com/products/silent-dog-nail-grinder");
    expect(candidate.storeDomain).toBe("ergopaw.com");
    expect(candidate.supportingAdIds).toHaveLength(50);
    expect(candidate.totalObservationCount).toBe(50);
    expect(candidate.identityConfidence).toBe("EXACT");

    // Title cleaning removes the clickbait suffix " - Buy Now 50% Off"
    expect(candidate.title).not.toContain("50% Off");
    expect(candidate.problemStatement).toContain("Tired of bleeding quicks");
  });

  it("evaluates cross-platform matches conservatively and enforces manual review on cross-store similarities", () => {
    const candidate = {
      candidateId: "cand_1",
      title: "Silent Dog Nail Grinder",
      category: "Pet Gadgets",
      problemStatement: "Trims pet nails without fear",
      targetAudience: "Pet Owners",
      thumbnailUrl: null,
      videoUrl: null,
      canonicalProductUrl: "https://ergopaw.com/products/silent-dog-nail-grinder",
      storeDomain: "ergopaw.com",
      advertiserNames: ["ErgoPaw"],
      supportingAdIds: ["ad_1"],
      supportingSourceTypes: ["META_ADS"],
      totalObservationCount: 1,
      distinctAdvertisersCount: 1,
      earliestObservationDate: null,
      latestObservationDate: null,
      identityConfidence: "EXACT" as const,
      sourceObservations: [],
    };

    // 1. Same URL -> EXACT
    const exactMatch = matchCrossPlatformProductEvidence(candidate, {
      url: "https://ergopaw.com/products/silent-dog-nail-grinder?fbclid=xyz",
      platform: "META_ADS",
    });
    expect(exactMatch.confidence).toBe("EXACT");
    expect(exactMatch.requiresManualReview).toBe(false);

    // 2. Different store with similar keywords -> PROBABLE with mandatory manual review
    const crossStoreMatch = matchCrossPlatformProductEvidence(candidate, {
      title: "Quiet Pet Nail Trimmer Grinder for Dogs",
      url: "https://competitorpets.com/products/quiet-dog-nail-trimmer",
      domain: "competitorpets.com",
      platform: "TIKTOK_ADS",
    });
    expect(crossStoreMatch.confidence).toBe("PROBABLE");
    expect(crossStoreMatch.requiresManualReview).toBe(true);
    expect(crossStoreMatch.matchReasons).toContain(
      "CROSS-STORE SAFETY: Different stores must NOT be merged into a single SKU without manual review."
    );

    // 3. Operator review persists decision
    const reviewed = submitProductMatchReview(crossStoreMatch, "CONFIRMED", "auditor_alice");
    expect(reviewed.userReviewDecision).toBe("CONFIRMED");
    expect(reviewed.confidence).toBe("HIGH_CONFIDENCE");
    expect(reviewed.requiresManualReview).toBe(false);
  });
});
