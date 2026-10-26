/**
 * SWAI KH-02 V12.1 — Research Persistence & Workspace Isolation Integration Tests
 *
 * Verifies:
 * 1. Persistent KH-02 research runs using database SyncJob records.
 * 2. Immutable ranking snapshots preserved across runs.
 * 3. Page reload restoration via getKH02Leaderboard without re-running network queries.
 * 4. Strict workspace isolation: Workspace B cannot see Workspace A's research runs or rankings.
 * 5. Persistent cross-store product match review decisions stored in researchEvidence.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  createKH02ResearchRun,
  updateKH02ResearchRunStatus,
  persistKH02RankingSnapshot,
  getKH02Leaderboard,
  getKH02ResearchRuns,
  getKH02ResearchRunById,
} from "@/services/kh02/persistence/kh02PersistenceService";
import {
  persistProductMatchReview,
  getStoredProductMatchReview,
} from "@/services/kh02/identity/crossPlatformProductMatcher";
import { EvergreenLeaderboardResult } from "@/services/kh02/evergreenResearchOrchestrator";

describe("SWAI KH-02 V12.1 — Persistence & Workspace Isolation", () => {
  const WORKSPACE_A = `ws_test_a_${Date.now()}`;
  const WORKSPACE_B = `ws_test_b_${Date.now()}`;

  beforeEach(async () => {
    // Seed test workspaces
    await prisma.workspace.createMany({
      data: [
        { id: WORKSPACE_A, name: "Workspace Alpha", operatingMode: "RESEARCH_ONLY" },
        { id: WORKSPACE_B, name: "Workspace Beta", operatingMode: "RESEARCH_ONLY" },
      ],
    });
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.syncJob.deleteMany({
      where: { workspaceId: { in: [WORKSPACE_A, WORKSPACE_B] } },
    });
    await prisma.researchEvidence.deleteMany({
      where: { workspaceId: { in: [WORKSPACE_A, WORKSPACE_B] } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: [WORKSPACE_A, WORKSPACE_B] } },
    });
  });

  it("creates a persistent research run with PENDING status and tracks progress", async () => {
    const runId = await createKH02ResearchRun({
      workspaceId: WORKSPACE_A,
      topic: "Pet Gadgets",
      market: "US",
      lookbackDays: 90,
    });

    expect(runId).toContain("kh02_run_");

    // Verify record in database
    const run = await getKH02ResearchRunById(runId, WORKSPACE_A);
    expect(run).not.toBeNull();
    expect(run?.status).toBe("PENDING");
    expect(run?.progress).toBe(0);

    // Update status to RUNNING
    await updateKH02ResearchRunStatus({
      runId,
      workspaceId: WORKSPACE_A,
      status: "RUNNING",
      progress: 50,
      startedAt: new Date(),
    });

    const updated = await getKH02ResearchRunById(runId, WORKSPACE_A);
    expect(updated?.status).toBe("RUNNING");
    expect(updated?.progress).toBe(50);
  });

  it("persists an immutable ranking snapshot and restores it on reload", async () => {
    const runId = await createKH02ResearchRun({
      workspaceId: WORKSPACE_A,
      topic: "Pet Gadgets",
    });

    const mockResult: EvergreenLeaderboardResult = {
      researchRunId: runId,
      topic: "Pet Gadgets",
      market: "US",
      lookbackDays: 90,
      formulaVersion: "12.1.0",
      runStatus: "PASSED",
      sourceStatuses: {
        META_ADS: "SOURCE_DATA_VERIFIED",
        TIKTOK_ADS: "NOT_VERIFIED",
        TIKTOK_ORGANIC: "NOT_CONFIGURED",
        GOOGLE_ADS: "NOT_CONFIGURED",
        DEMAND_HISTORY: "SOURCE_DATA_VERIFIED",
      },
      topThree: [
        {
          rank: 1,
          candidate: {
            candidateId: "cand_1",
            researchProductId: "prod_1",
            title: "Pet Hair Roller",
            category: "Pet Gadgets",
            problemStatement: "Removes stubborn pet hair",
            targetAudience: "Pet Owners",
            thumbnailUrl: "https://example.com/thumb.jpg",
            videoUrl: "https://example.com/video.mp4",
            canonicalProductUrl: "https://furryclean.com/products/roller",
            storeDomain: "furryclean.com",
            advertiserNames: ["FurryClean"],
            supportingAdIds: ["ad_1", "ad_2"],
            supportingSourceTypes: ["META_ADS"],
            totalObservationCount: 5,
            distinctAdvertisersCount: 2,
            earliestObservationDate: "2026-01-01T00:00:00Z",
            latestObservationDate: "2026-03-01T00:00:00Z",
            identityConfidence: "HIGH_CONFIDENCE",
            sourceObservations: [],
          },
          score: {
            candidateId: "cand_1",
            formulaVersion: "12.1.0",
            opportunityScore: 84,
            evidenceConfidence: 75,
            scoreStatus: "VERIFIED",
            tier: "VERIFIED_EVERGREEN",
            demandClass: "EVERGREEN_STABLE",
            strengths: ["Multi-month demand stability"],
            risks: [],
            missingEvidence: [],
            recommendation: "TEST_CANDIDATE",
            recommendationRationale: "High confidence evergreen winner",
            pillars: {
              demandStability: { score: 22, maxWeight: 25, status: "PASS", explanation: "Stable" },
              problemSolutionFit: { score: 18, maxWeight: 20, status: "PASS", explanation: "Clear problem" },
              multiPlatformValidation: { score: 14, maxWeight: 20, status: "PASS", explanation: "Multi-platform" },
              brandabilityStoreFit: { score: 13, maxWeight: 15, status: "PASS", explanation: "Branded store" },
              creativeDepth: { score: 8, maxWeight: 10, status: "PASS", explanation: "Video demo" },
              competitionSustainability: { score: 9, maxWeight: 10, status: "PASS", explanation: "2 advertisers" },
            },
            evaluatedAt: new Date().toISOString(),
          },
        },
      ],
      provisionalCandidates: [],
      remainingCandidates: [],
      insufficientEvidenceCandidates: [],
      totalCandidatesDiscovered: 1,
      generatedAt: new Date().toISOString(),
      warnings: [],
      errors: [],
    };

    // Persist snapshot
    await persistKH02RankingSnapshot(runId, WORKSPACE_A, mockResult);

    // Simulate page reload: restore latest leaderboard
    const restored = await getKH02Leaderboard(WORKSPACE_A);
    expect(restored).not.toBeNull();
    expect(restored?.researchRunId).toBe(runId);
    expect(restored?.topic).toBe("Pet Gadgets");
    expect(restored?.topThree).toHaveLength(1);
    expect(restored?.topThree[0].candidate.title).toBe("Pet Hair Roller");
    expect(restored?.topThree[0].score.opportunityScore).toBe(84);
  });

  it("enforces workspace isolation: Workspace B cannot access Workspace A research runs or snapshots", async () => {
    const runIdA = await createKH02ResearchRun({
      workspaceId: WORKSPACE_A,
      topic: "Pet Gadgets Alpha",
    });

    // Check from Workspace B
    const runFromB = await getKH02ResearchRunById(runIdA, WORKSPACE_B);
    expect(runFromB).toBeNull();

    // Check leaderboard from Workspace B
    const leaderboardB = await getKH02Leaderboard(WORKSPACE_B);
    expect(leaderboardB).toBeNull();

    // List runs from Workspace B
    const runsB = await getKH02ResearchRuns(WORKSPACE_B);
    expect(runsB).toHaveLength(0);
  });

  it("persists operator product match review decisions in researchEvidence table", async () => {
    const matchId = `match_${Date.now()}`;
    const review = await persistProductMatchReview(
      matchId,
      "CONFIRMED",
      "operator_alice",
      WORKSPACE_A,
      "Confirmed identical pet hair roller across storefronts"
    );

    expect(review.userReviewDecision).toBe("CONFIRMED");
    expect(review.reviewedBy).toBe("operator_alice");

    // Fetch stored review from Workspace A
    const stored = await getStoredProductMatchReview(matchId, WORKSPACE_A);
    expect(stored).not.toBeNull();
    expect(stored?.userReviewDecision).toBe("CONFIRMED");
    expect(stored?.reviewedBy).toBe("operator_alice");

    // Verify Workspace B cannot access review from Workspace A
    const crossWorkspaceReview = await getStoredProductMatchReview(matchId, WORKSPACE_B);
    expect(crossWorkspaceReview).toBeNull();
  });
});
