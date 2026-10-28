import { describe, it, expect } from "vitest";
import { verifyAIEvidence } from "@/services/kh02/ai/aiEvidenceVerifier";
import {
  AIProductAnalysisInput,
  GeminiProductIntelligenceResult,
} from "@/services/kh02/ai/aiProductIntelligenceTypes";

describe("SWAI KH-02 V12.4 — Commercial Entity Classification & Critical Regression", () => {
  it("approves genuine physical products with verified evidence", () => {
    const input: AIProductAnalysisInput = {
      researchRunId: "run_test_1",
      candidateId: "cand_pet_hair_remover",
      topic: "pet",
      market: "US",
      observations: [
        {
          source: "META_ADS",
          sourceRecordId: "meta_obs_101",
          advertiser: "FurRelief Pets",
          headline: "Reusable Pet Hair Remover Roller",
          description: "Effortlessly removes dog and cat hair from couches, beds, and clothes without sticky tape.",
          landingPageUrl: "https://furreliefpets.com/products/pet-hair-roller",
          creativeReference: "ad_101",
        },
      ],
      merchantEvidence: {
        canonicalUrl: "https://furreliefpets.com/products/pet-hair-roller",
        pageType: "SHOPIFY_STORE",
        productName: "Reusable Pet Hair Remover Roller",
        brand: "FurRelief Pets",
        description: "Two-way roller mechanism picks up pet fur instantly.",
        evidenceRefs: ["meta_obs_101"],
      },
    };

    const aiResult: GeminiProductIntelligenceResult = {
      candidateId: "cand_pet_hair_remover",
      commercialEntityType: "PHYSICAL_PRODUCT",
      suggestedProductName: "Pet Hair Remover Roller",
      suggestedProductType: "Pet Grooming Tool",
      nicheRelevance: "HIGH",
      isLikelySellableProduct: true,
      identityEvidenceRefs: ["meta_obs_101"],
      relevanceEvidenceRefs: ["meta_obs_101"],
      directlyObservedClaims: [
        {
          claim: "Removes dog and cat hair from couches",
          sourceRef: "meta_obs_101",
          supportingQuote: "removes dog and cat hair from couches",
        },
      ],
      inferredClaims: ["High repeat demand during seasonal shedding."],
      contradictions: [],
      uncertainties: [],
      aiConfidence: 0.95,
      needsHumanReview: false,
    };

    const ver = verifyAIEvidence(input, aiResult);
    expect(ver.verified).toBe(true);
    expect(ver.shortlistEligible).toBe(true);
    expect(ver.sanitizedResult.commercialEntityType).toBe("PHYSICAL_PRODUCT");
    expect(ver.sanitizedResult.isLikelySellableProduct).toBe(true);
  });

  it("CRITICAL REGRESSION: Rejects 'ER Vet bill cost factors' from shortlist", () => {
    const input: AIProductAnalysisInput = {
      researchRunId: "run_test_2",
      candidateId: "cand_er_vet_bill",
      topic: "pet",
      market: "US",
      observations: [
        {
          source: "META_ADS",
          sourceRecordId: "meta_obs_202",
          advertiser: "Pet Health Guides",
          headline: "ER Vet bill cost factors — What to expect in an emergency",
          description: "Understanding average emergency veterinary costs, diagnostic fees, and surgery breakdown for dogs and cats.",
          landingPageUrl: "https://pethealthguides.org/articles/er-vet-costs",
          creativeReference: "ad_202",
        },
      ],
      merchantEvidence: {
        canonicalUrl: "https://pethealthguides.org/articles/er-vet-costs",
        pageType: "BLOG_ARTICLE",
        productName: "ER Vet bill cost factors",
        brand: "Pet Health Guides",
        description: "Informational guide about emergency veterinary hospital expenses.",
        evidenceRefs: ["meta_obs_202"],
      },
    };

    const aiResult: GeminiProductIntelligenceResult = {
      candidateId: "cand_er_vet_bill",
      commercialEntityType: "INFORMATIONAL_CONTENT",
      suggestedProductName: null,
      suggestedProductType: "Informational Article / Guide",
      nicheRelevance: "MEDIUM",
      isLikelySellableProduct: false,
      identityEvidenceRefs: ["meta_obs_202"],
      relevanceEvidenceRefs: ["meta_obs_202"],
      directlyObservedClaims: [
        {
          claim: "Discusses average emergency veterinary costs",
          sourceRef: "meta_obs_202",
          supportingQuote: "average emergency veterinary costs",
        },
      ],
      inferredClaims: [],
      contradictions: [],
      uncertainties: ["Not a purchasable physical product; informational article about vet bills."],
      aiConfidence: 0.92,
      needsHumanReview: false,
    };

    const ver = verifyAIEvidence(input, aiResult);
    expect(ver.verified).toBe(true);
    expect(ver.shortlistEligible).toBe(false);
    expect(ver.exclusionReason).toContain("INFORMATIONAL_CONTENT");
  });

  it("rejects veterinary clinic services and insurance plans from physical product shortlist", () => {
    const serviceInput: AIProductAnalysisInput = {
      researchRunId: "run_test_3",
      candidateId: "cand_vet_clinic",
      topic: "pet",
      market: "US",
      observations: [
        {
          source: "GOOGLE_ADS",
          sourceRecordId: "google_obs_303",
          advertiser: "Downtown Pet Hospital",
          headline: "24/7 Emergency Veterinary Care",
          description: "Compassionate vet surgeries and overnight hospitalization for sick pets.",
          landingPageUrl: "https://downtownpethospital.com/appointments",
          creativeReference: "google_303",
        },
      ],
      merchantEvidence: {
        canonicalUrl: "https://downtownpethospital.com/appointments",
        pageType: "LOCAL_SERVICE",
        productName: "24/7 Emergency Vet Services",
        brand: "Downtown Pet Hospital",
        description: "Clinic services and doctor appointments",
        evidenceRefs: ["google_obs_303"],
      },
    };

    const serviceAiResult: GeminiProductIntelligenceResult = {
      candidateId: "cand_vet_clinic",
      commercialEntityType: "SERVICE",
      suggestedProductName: null,
      suggestedProductType: "Veterinary Healthcare Service",
      nicheRelevance: "HIGH",
      isLikelySellableProduct: false,
      identityEvidenceRefs: ["google_obs_303"],
      relevanceEvidenceRefs: ["google_obs_303"],
      directlyObservedClaims: [],
      inferredClaims: [],
      contradictions: [],
      uncertainties: ["Local veterinary service, not a physical product."],
      aiConfidence: 0.97,
      needsHumanReview: false,
    };

    const ver = verifyAIEvidence(serviceInput, serviceAiResult);
    expect(ver.shortlistEligible).toBe(false);
    expect(ver.exclusionReason).toContain("SERVICE");
  });

  it("enforces semantic consistency: rejects candidate if model claimed SERVICE but isLikelySellableProduct was true", () => {
    const input: AIProductAnalysisInput = {
      researchRunId: "run_test_4",
      candidateId: "cand_bad_output",
      topic: "pet",
      market: "US",
      observations: [
        {
          source: "META_ADS",
          sourceRecordId: "meta_obs_404",
          advertiser: "Pet Insurance Pros",
          headline: "Get a Pet Insurance Quote Today",
          description: "Plans starting at $15/mo.",
          landingPageUrl: "https://petinsurance.com",
          creativeReference: "ad_404",
        },
      ],
      merchantEvidence: {
        canonicalUrl: "https://petinsurance.com",
        pageType: "LEAD_GEN",
        productName: "Pet Insurance",
        brand: "Pet Insurance Pros",
        description: null,
        evidenceRefs: ["meta_obs_404"],
      },
    };

    const contradictoryAiResult: GeminiProductIntelligenceResult = {
      candidateId: "cand_bad_output",
      commercialEntityType: "INSURANCE",
      suggestedProductName: "Pet Insurance Policy",
      suggestedProductType: "Insurance",
      nicheRelevance: "MEDIUM",
      isLikelySellableProduct: true, // Contradiction!
      identityEvidenceRefs: ["meta_obs_404"],
      relevanceEvidenceRefs: ["meta_obs_404"],
      directlyObservedClaims: [],
      inferredClaims: [],
      contradictions: [],
      uncertainties: [],
      aiConfidence: 0.8,
      needsHumanReview: false,
    };

    const ver = verifyAIEvidence(input, contradictoryAiResult);
    // Verifier must detect contradiction, override isLikelySellableProduct to false, and reject from shortlist
    expect(ver.sanitizedResult.isLikelySellableProduct).toBe(false);
    expect(ver.shortlistEligible).toBe(false);
    expect(ver.contradictions.length).toBeGreaterThan(0);
    expect(ver.exclusionReason).toContain("INSURANCE");
  });
});
