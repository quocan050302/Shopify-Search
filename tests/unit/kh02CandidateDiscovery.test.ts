import { describe, it, expect } from "vitest";
import {
  discoverProductCandidatesFromAds,
} from "@/services/kh02/identity/productCandidateDiscovery";
import { SourceObservation } from "@/services/kh02/types";

describe("SWAI KH-02 — Product Candidate Discovery & Relevance Unit Tests", () => {
  const topic = "Pet Gadgets";

  const createMockObs = (overrides: Partial<SourceObservation>): SourceObservation => ({
    source: "META_ADS",
    sourceRecordId: "rec_" + Math.random().toString(36).slice(2, 7),
    sourceUrl: "https://facebook.com/ads/library/?id=123",
    landingPageUrl: null,
    advertiserOrCreator: "PetStoreDirect",
    advertiserDomain: "petstoredirect.com",
    observedAt: "2026-03-01T10:00:00Z",
    requestedMarket: "US",
    verifiedDeliveryMarket: null,
    title: null,
    description: null,
    provenance: "REAL_UPSTREAM",
    ...overrides,
  });

  it("extracts candidate from valid Shopify product URL", () => {
    const obs = createMockObs({
      landingPageUrl: "https://furryco.com/products/automatic-pet-feeder?variant=123",
      title: "Get 50% Off Today",
      description: "Our Automatic Pet Feeder keeps your dog fed on time.",
    });

    const candidates = discoverProductCandidatesFromAds([obs], topic);
    expect(candidates.length).toBe(1);
    expect(candidates[0].title).toBe("Automatic Pet Feeder");
    expect(candidates[0].identityStatus).toBe("VERIFIED");
    expect(candidates[0].relevanceStatus).toBe("RELEVANT");
    expect(candidates[0].isEligibleAsEvergreenWinner).toBe(true);
  });

  it("extracts candidate from descriptive headline when landing URL is missing", () => {
    const obs = createMockObs({
      landingPageUrl: null,
      title: "Dog Grooming Vacuum Pro",
      description: "Quiet vacuum for pet hair removal.",
    });

    const candidates = discoverProductCandidatesFromAds([obs], topic);
    expect(candidates.length).toBe(1);
    expect(candidates[0].title).toBe("Dog Grooming Vacuum Pro");
    expect(candidates[0].identityStatus).toBe("PROBABLE");
    expect(candidates[0].relevanceStatus).toBe("RELEVANT");
  });

  it("classifies candidate as UNRESOLVED when headline is only an ad ID or generic CTA", () => {
    const obs = createMockObs({
      sourceRecordId: "893760707134895",
      landingPageUrl: null,
      title: "Facebook Ad: 893760707134895",
      description: "Click here for 50% off everything in store!",
    });

    const candidates = discoverProductCandidatesFromAds([obs], topic);
    expect(candidates.length).toBe(1);
    expect(candidates[0].identityStatus).toBe("UNRESOLVED");
    expect(candidates[0].isEligibleAsEvergreenWinner).toBe(false);
    expect(candidates[0].title).toContain("Unidentified Product");
  });

  it("groups duplicate ads for the same Shopify product into 1 consolidated candidate", () => {
    const obs1 = createMockObs({
      sourceRecordId: "ad_1",
      landingPageUrl: "https://shop.com/products/cat-water-fountain?campaign=1",
      title: "Keep Cats Hydrated",
    });
    const obs2 = createMockObs({
      sourceRecordId: "ad_2",
      landingPageUrl: "https://shop.com/products/cat-water-fountain?campaign=2",
      title: "Stainless Steel Cat Fountain",
    });

    const candidates = discoverProductCandidatesFromAds([obs1, obs2], topic);
    expect(candidates.length).toBe(1);
    expect(candidates[0].supportingAdIds).toContain("ad_1");
    expect(candidates[0].supportingAdIds).toContain("ad_2");
    expect(candidates[0].totalObservationCount).toBe(2);
    expect(candidates[0].title).toBe("Cat Water Fountain");
  });

  it("keeps multiple distinct products from the same advertiser separate", () => {
    const obs1 = createMockObs({
      sourceRecordId: "ad_feeder",
      landingPageUrl: "https://petstore.com/products/smart-feeder",
      title: "Smart Pet Feeder",
    });
    const obs2 = createMockObs({
      sourceRecordId: "ad_tracker",
      landingPageUrl: "https://petstore.com/products/gps-pet-tracker",
      title: "GPS Dog Collar Tracker",
    });

    const candidates = discoverProductCandidatesFromAds([obs1, obs2], topic);
    expect(candidates.length).toBe(2);
    const titles = candidates.map((c) => c.title);
    expect(titles).toContain("Smart Feeder");
    expect(titles).toContain("Gps Pet Tracker");
  });

  it("evaluates niche relevance: accepts positive examples for Pet Gadgets", () => {
    const positiveCases = [
      "Automatic Pet Feeder",
      "Dog Grooming Vacuum",
      "Pet Hair Remover",
      "Cat Water Fountain",
      "GPS Pet Tracker",
    ];

    for (const title of positiveCases) {
      const obs = createMockObs({
        title,
        description: `High quality ${title} for pets.`,
      });
      const candidates = discoverProductCandidatesFromAds([obs], "Pet Gadgets");
      expect(candidates[0].relevanceStatus).toBe("RELEVANT");
    }
  });

  it("evaluates niche relevance: rejects human hair and unrelated products", () => {
    const negativeCases = [
      { title: "Crystal Hair Eraser for Strawberry Legs", desc: "Painless hair removal for bikini and legs" },
      { title: "Facial Hair Removal Cream", desc: "Depilatory for upper lip and facial hair" },
      { title: "Casino App Slots 777", desc: "Win real cash jackpot" },
      { title: "Mortgage Refinance Service", desc: "Lower your monthly home loan payment" },
    ];

    for (const { title, desc } of negativeCases) {
      const obs = createMockObs({ title, description: desc });
      const candidates = discoverProductCandidatesFromAds([obs], "Pet Gadgets");
      expect(candidates[0].relevanceStatus).toBe("IRRELEVANT");
      expect(candidates[0].isEligibleAsEvergreenWinner).toBe(false);
    }
  });

  it("evaluates niche relevance: marks generic non-pet tools as AMBIGUOUS or IRRELEVANT", () => {
    const ambiguousCases = [
      "Generic Cleaning Brush",
      "Household Lint Roller",
      "Multi-purpose Vacuum",
    ];

    for (const title of ambiguousCases) {
      const obs = createMockObs({ title, description: "Household cleaning product." });
      const candidates = discoverProductCandidatesFromAds([obs], "Pet Gadgets");
      expect(["AMBIGUOUS", "IRRELEVANT"]).toContain(candidates[0].relevanceStatus);
      expect(candidates[0].isEligibleAsEvergreenWinner).toBe(false);
    }
  });

  it("handles empty source observations gracefully with 0 candidates", () => {
    const candidates = discoverProductCandidatesFromAds([], "Pet Gadgets");
    expect(candidates).toEqual([]);
  });
});
