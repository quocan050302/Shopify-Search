import { describe, it, expect, vi, beforeEach } from "vitest";
import { runEvergreenProductResearch } from "@/services/kh02/evergreenResearchOrchestrator";
import { clearAIAnalysisCache } from "@/services/kh02/ai/aiAnalysisCache";
import * as geminiService from "@/services/kh02/ai/geminiProductIntelligenceService";

// Mock Meta Ads Signal collector to return controlled fixture ads
vi.mock("@/services/kh02/providers/metaResearchAdapter", () => ({
  collectMetaProductSignals: vi.fn().mockResolvedValue({
    source: "META_ADS",
    status: "PASSED",
    observations: [
      {
        source: "META_ADS",
        sourceRecordId: "meta_obs_pet_hair_roller",
        advertiserName: "PetCare Store",
        title: "Pet Hair Remover Roller",
        description: "Two-way self cleaning dog and cat hair removal roller for furniture and clothes.",
        landingPageUrl: "https://petcarestore.com/products/pet-hair-roller",
        observedAt: new Date().toISOString(),
        provenance: "LIVE_PROVIDER",
        media: { videoUrl: null, thumbnailUrl: "https://petcarestore.com/thumb.jpg" },
      },
      {
        source: "META_ADS",
        sourceRecordId: "meta_obs_er_vet_bill",
        advertiserName: "Emergency Pet Clinic Info",
        title: "Pet Care — ER Vet bill cost factors",
        description: "Guide explaining emergency veterinary bill cost factors, diagnostic rates, and pet clinic surgery estimates.",
        landingPageUrl: "https://petclinicinfo.com/er-costs-guide",
        observedAt: new Date().toISOString(),
        provenance: "LIVE_PROVIDER",
        media: { videoUrl: null, thumbnailUrl: null },
      },
    ],
    retrievedCount: 2,
    acceptedCount: 2,
    rejectedCount: 0,
    estimatedCredits: 0,
    consumedCredits: 0,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    errors: [],
    warnings: [],
    executionMetadata: {
      attempted: true,
      executed: true,
      liveSucceeded: true,
      upstreamReturnedCount: 2,
    },
  }),
}));

vi.mock("@/services/kh02/providers/sourceRegistry", () => ({
  diagnoseKH02Source: vi.fn().mockResolvedValue({
    source: "META_ADS",
    configured: true,
    status: "CONFIGURED",
  }),
  checkIntelligenceSourceReadiness: vi.fn().mockResolvedValue({
    source: "META_ADS",
    readiness: "READY",
  }),
}));

describe("SWAI KH-02 V12.4 — Production Worker Pipeline with Gemini AI Integration", () => {
  beforeEach(() => {
    clearAIAnalysisCache();
    vi.restoreAllMocks();
  });

  it("executes complete research orchestrator pipeline and applies AI Product Reality Gate", async () => {
    // Mock analyzeProductCandidatesWithAI to simulate completed semantic analysis
    vi.spyOn(geminiService, "analyzeProductCandidatesWithAI").mockImplementation(async (candidates) => {
      let physical = 0;
      let content = 0;

      for (const c of candidates) {
        const isErBill =
          (c.title || "").toLowerCase().includes("er vet") ||
          (c.originalAdHeadline || "").toLowerCase().includes("er vet") ||
          c.sourceObservations.some((o) => (o.title || "").toLowerCase().includes("er vet"));
        if (isErBill) {
          content++;
          (c as any).aiIntelligence = {
            candidateId: c.candidateId,
            commercialEntityType: "INFORMATIONAL_CONTENT",
            suggestedProductName: null,
            suggestedProductType: "Cost Guide",
            nicheRelevance: "MEDIUM",
            isLikelySellableProduct: false,
            identityEvidenceRefs: ["ref_1"],
            relevanceEvidenceRefs: ["ref_1"],
            directlyObservedClaims: [],
            inferredClaims: [],
            contradictions: [],
            uncertainties: ["Informational guide about vet bills, not a physical product."],
            aiConfidence: 0.95,
            needsHumanReview: false,
          };
          (c as any).aiShortlistEligible = false;
          (c as any).aiExclusionReason = "Excluded from product shortlist: Classified as INFORMATIONAL_CONTENT.";
        } else {
          physical++;
          (c as any).aiIntelligence = {
            candidateId: c.candidateId,
            commercialEntityType: "PHYSICAL_PRODUCT",
            suggestedProductName: "Pet Hair Remover Roller",
            suggestedProductType: "Pet Grooming Tool",
            nicheRelevance: "HIGH",
            isLikelySellableProduct: true,
            identityEvidenceRefs: ["ref_1"],
            relevanceEvidenceRefs: ["ref_1"],
            directlyObservedClaims: [],
            inferredClaims: [],
            contradictions: [],
            uncertainties: [],
            aiConfidence: 0.96,
            needsHumanReview: false,
          };
          (c as any).aiShortlistEligible = true;
          (c as any).aiExclusionReason = null;
        }
      }

      return {
        analyzedCandidates: candidates,
        modelsUsed: ["gemini-3.7-flash"],
        telemetry: {
          provider: "GOOGLE_GEMINI",
          aiStatus: "COMPLETED",
          authStatus: "AUTHENTICATED",
          modelsDiscoveredCount: 10,
          eligibleModelsCount: 5,
          primaryModelId: "gemini-3.7-flash",
          fallbackModels: ["gemini-3.6-flash"],
          actualModelUsed: "gemini-3.7-flash",
          fallbackUsed: false,
          totalAnalysesAttempted: candidates.length,
          totalAnalysesCompleted: candidates.length,
          totalAnalysesFailed: 0,
          physicalProductsCount: physical,
          servicesRejectedCount: 0,
          contentRejectedCount: content,
          insuranceLeadGenRejectedCount: 0,
          unknownClassificationsCount: 0,
          evidenceContradictionsCount: 0,
          invalidAIOutputsRejectedCount: 0,
        },
      };
    });

    const result = await runEvergreenProductResearch({
      workspaceId: "test_ws_ai_pipeline",
      topic: "pet",
      market: "US",
      lookbackDays: 90,
      maxCandidates: 10,
      runId: `run_ai_test_${Date.now()}`,
    });

    expect(result).toBeDefined();
    expect(result.topic).toBe("pet");
    expect(result.runStatus).toBe("PASSED");

    // Verify AI Telemetry is present and structured
    expect(result.aiTelemetry).toBeDefined();
    expect(result.aiTelemetry?.provider).toBe("GOOGLE_GEMINI");
    expect(result.aiTelemetry?.aiStatus).toBe("COMPLETED");
    expect(result.candidateFunnel?.aiAnalysesAttempted).toBe(2);
    expect(result.candidateFunnel?.aiContentRejected).toBe(1);

    // Verify Shortlist: 'ER Vet bill cost factors' MUST NOT be in research shortlist!
    const shortlist = result.researchShortlist?.shortlist || [];
    const shortlistTitles = shortlist.map((item) => (item.title || "").toLowerCase());
    
    // Explicit regression assertion: critical case excluded
    expect(shortlistTitles.some((t) => t.includes("er vet bill"))).toBe(false);

    // Only the genuine physical pet hair remover qualifies
    expect(shortlist.length).toBe(1);
    expect(shortlist[0].title).toContain("Pet Hair");
  }, 30000);

  it("gracefully completes with UNAVAILABLE telemetry when AI fails or key is missing", async () => {
    // Simulate analyzeProductCandidatesWithAI throwing or returning UNAVAILABLE
    vi.spyOn(geminiService, "analyzeProductCandidatesWithAI").mockResolvedValue({
      analyzedCandidates: [],
      modelsUsed: [],
      telemetry: {
        provider: "GOOGLE_GEMINI",
        aiStatus: "UNAVAILABLE",
        authStatus: "KEY_NOT_FOUND",
        modelsDiscoveredCount: 0,
        eligibleModelsCount: 0,
        primaryModelId: null,
        fallbackModels: [],
        actualModelUsed: null,
        fallbackUsed: false,
        totalAnalysesAttempted: 0,
        totalAnalysesCompleted: 0,
        totalAnalysesFailed: 0,
        physicalProductsCount: 0,
        servicesRejectedCount: 0,
        contentRejectedCount: 0,
        insuranceLeadGenRejectedCount: 0,
        unknownClassificationsCount: 0,
        evidenceContradictionsCount: 0,
        invalidAIOutputsRejectedCount: 0,
      },
    });

    const result = await runEvergreenProductResearch({
      workspaceId: "test_ws_ai_fail",
      topic: "pet",
      market: "US",
      lookbackDays: 90,
      maxCandidates: 10,
      runId: `run_ai_fail_${Date.now()}`,
    });

    expect(result).toBeDefined();
    expect(result.aiTelemetry?.aiStatus).toBe("UNAVAILABLE");
    expect(result.aiTelemetry?.actualModelUsed).toBeNull();
    // Orchestrator still succeeds with conservative deterministic evaluation
    expect(result.runStatus).toBe("PASSED");

    // CRITICAL V12.4.1 FAIL-SAFE INVARIANT:
    // Even when Gemini AI is UNAVAILABLE, 'ER Vet bill cost factors' MUST still be rejected from the shortlist!
    const shortlist = result.researchShortlist?.shortlist || [];
    const shortlistTitles = shortlist.map((item) => (item.title || "").toLowerCase());
    expect(shortlistTitles.some((t) => t.includes("er vet bill"))).toBe(false);
    expect(shortlist.length).toBe(1);
    expect(shortlist[0].title).toContain("Pet Hair");
  }, 30000);
});
