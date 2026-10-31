import { describe, it, expect, vi, afterEach } from "vitest";
import {
  reconcileDatabaseAndHttp,
  reconcileDatabaseAndBrowser,
  reconcileResearchAcrossLayers,
  ComparableResearchSnapshot,
  BrowserReconciliationEvidence,
} from "../../src/services/kh02/persistence/kh02PersistenceService";

describe("SWAI KH-02 V12.1.4.1 — Exact Cross-Layer Reconciliation Suite", () => {
  const mockDbSnapshot: ComparableResearchSnapshot = {
    runId: "run_test_001",
    workspaceId: "ws_alpha",
    status: "COMPLETED",
    candidateIds: ["cand_A", "cand_B", "cand_C"],
    rankedCandidateIds: ["cand_A", "cand_B", "cand_C"],
    provisionalCandidateIds: [],
    rankedScores: {
      cand_A: 88.5,
      cand_B: 76.2,
      cand_C: 65.0,
    },
    confidenceStatuses: {
      cand_A: "VERIFIED",
      cand_B: "VERIFIED",
      cand_C: "VERIFIED",
    },
    sourceObservationIds: ["obs_1", "obs_2", "obs_3"],
    rawObservationsCount: 15,
    candidateCount: 3,
  };

  describe("1. Database to Browser Candidate Set Equality & Partial Match Rejection", () => {
    it("PASSES when browser displays exact same candidate set and rank order", () => {
      const evidence: BrowserReconciliationEvidence = {
        runId: "run_test_001",
        workspaceId: "ws_alpha",
        terminalStatus: "COMPLETED",
        displayedCandidateIds: ["cand_A", "cand_B", "cand_C"],
        displayedRankOrder: ["cand_A", "cand_B", "cand_C"],
        displayedScores: { cand_A: 88.5, cand_B: 76.2, cand_C: 65.0 },
        displayedConfidence: { cand_A: "VERIFIED", cand_B: "VERIFIED", cand_C: "VERIFIED" },
        cardCount: 3,
        emptyStateRendered: false,
      };

      const result = reconcileDatabaseAndBrowser(mockDbSnapshot, evidence);
      expect(result.reconciled).toBe(true);
      expect(result.mismatches).toHaveLength(0);
    });

    it("REJECTS partial candidate overlap (1 of 3 displayed: cand_A only)", () => {
      const evidence: BrowserReconciliationEvidence = {
        runId: "run_test_001",
        terminalStatus: "COMPLETED",
        displayedCandidateIds: ["cand_A"], // Missing cand_B and cand_C!
        displayedRankOrder: ["cand_A"],
        cardCount: 1,
      };

      const result = reconcileDatabaseAndBrowser(mockDbSnapshot, evidence);
      expect(result.reconciled).toBe(false);
      const mismatch = result.mismatches.find((m) => m.field === "displayedCandidateIds");
      expect(mismatch).toBeDefined();
      expect(mismatch?.reason).toContain("missing in browser [cand_B, cand_C]");
    });

    it("REJECTS partial candidate overlap (2 of 3 displayed: cand_A and cand_B)", () => {
      const evidence: BrowserReconciliationEvidence = {
        runId: "run_test_001",
        terminalStatus: "COMPLETED",
        displayedCandidateIds: ["cand_A", "cand_B"], // Missing cand_C!
        displayedRankOrder: ["cand_A", "cand_B"],
        cardCount: 2,
      };

      const result = reconcileDatabaseAndBrowser(mockDbSnapshot, evidence);
      expect(result.reconciled).toBe(false);
      const mismatch = result.mismatches.find((m) => m.field === "displayedCandidateIds");
      expect(mismatch).toBeDefined();
      expect(mismatch?.reason).toContain("missing in browser [cand_C]");
    });

    it("REJECTS extra unexpected candidate in browser", () => {
      const evidence: BrowserReconciliationEvidence = {
        runId: "run_test_001",
        terminalStatus: "COMPLETED",
        displayedCandidateIds: ["cand_A", "cand_B", "cand_C", "cand_EXTRA"],
        displayedRankOrder: ["cand_A", "cand_B", "cand_C"],
        cardCount: 4,
      };

      const result = reconcileDatabaseAndBrowser(mockDbSnapshot, evidence);
      expect(result.reconciled).toBe(false);
      const mismatch = result.mismatches.find((m) => m.field === "displayedCandidateIds");
      expect(mismatch?.reason).toContain("extra in browser [cand_EXTRA]");
    });

    it("REJECTS duplicate candidate IDs rendered in browser", () => {
      const evidence: BrowserReconciliationEvidence = {
        runId: "run_test_001",
        terminalStatus: "COMPLETED",
        displayedCandidateIds: ["cand_A", "cand_A", "cand_B"],
        cardCount: 3,
      };

      const result = reconcileDatabaseAndBrowser(mockDbSnapshot, evidence);
      expect(result.reconciled).toBe(false);
      const dupMismatch = result.mismatches.find((m) => m.field === "duplicateBrowserCandidates");
      expect(dupMismatch).toBeDefined();
      expect(dupMismatch?.reason).toContain("duplicate candidate IDs: [cand_A]");
    });

    it("REJECTS inverted rank order in browser", () => {
      const evidence: BrowserReconciliationEvidence = {
        runId: "run_test_001",
        terminalStatus: "COMPLETED",
        displayedCandidateIds: ["cand_B", "cand_A", "cand_C"],
        displayedRankOrder: ["cand_B", "cand_A", "cand_C"], // Inverted!
        cardCount: 3,
      };

      const result = reconcileDatabaseAndBrowser(mockDbSnapshot, evidence);
      expect(result.reconciled).toBe(false);
      const rankMismatch = result.mismatches.find((m) => m.field === "displayedRankOrder");
      expect(rankMismatch).toBeDefined();
      expect(rankMismatch?.reason).toContain("rank order mismatch");
    });

    it("REJECTS browser runId mismatch", () => {
      const evidence: BrowserReconciliationEvidence = {
        runId: "run_stale_999", // Different run ID!
        terminalStatus: "COMPLETED",
        displayedCandidateIds: ["cand_A", "cand_B", "cand_C"],
      };

      const result = reconcileDatabaseAndBrowser(mockDbSnapshot, evidence);
      expect(result.reconciled).toBe(false);
      const runMismatch = result.mismatches.find((m) => m.field === "browserRunId");
      expect(runMismatch).toBeDefined();
    });

    it("REJECTS browser score exceeding display tolerance", () => {
      const evidence: BrowserReconciliationEvidence = {
        runId: "run_test_001",
        terminalStatus: "COMPLETED",
        displayedCandidateIds: ["cand_A", "cand_B", "cand_C"],
        displayedScores: { cand_A: 95.0 }, // DB score is 88.5, difference > 1.0!
      };

      const result = reconcileDatabaseAndBrowser(mockDbSnapshot, evidence);
      expect(result.reconciled).toBe(false);
      const scoreMismatch = result.mismatches.find((m) => m.field === "displayedScores.cand_A");
      expect(scoreMismatch).toBeDefined();
      expect(scoreMismatch?.reason).toContain("DB score is 88.5");
    });

    it("REJECTS confidence status mismatch (PROVISIONAL shown for VERIFIED)", () => {
      const evidence: BrowserReconciliationEvidence = {
        runId: "run_test_001",
        terminalStatus: "COMPLETED",
        displayedCandidateIds: ["cand_A", "cand_B", "cand_C"],
        displayedConfidence: { cand_A: "PROVISIONAL" }, // DB is VERIFIED!
      };

      const result = reconcileDatabaseAndBrowser(mockDbSnapshot, evidence);
      expect(result.reconciled).toBe(false);
      const confMismatch = result.mismatches.find((m) => m.field === "displayedConfidence.cand_A");
      expect(confMismatch).toBeDefined();
      expect(confMismatch?.reason).toContain("Browser confidence for 'cand_A' is 'PROVISIONAL', but DB is 'VERIFIED'");
    });

    it("PASSES empty-state consistency when 0 candidates discovered and emptyState rendered", () => {
      const emptyDbSnapshot: ComparableResearchSnapshot = {
        runId: "run_empty_002",
        workspaceId: "ws_alpha",
        status: "COMPLETED",
        candidateIds: [],
        rankedCandidateIds: [],
        provisionalCandidateIds: [],
        rankedScores: {},
        confidenceStatuses: {},
        sourceObservationIds: [],
        rawObservationsCount: 0,
        candidateCount: 0,
      };

      const emptyEvidence: BrowserReconciliationEvidence = {
        runId: "run_empty_002",
        terminalStatus: "COMPLETED",
        displayedCandidateIds: [],
        cardCount: 0,
        emptyStateRendered: true,
      };

      const result = reconcileDatabaseAndBrowser(emptyDbSnapshot, emptyEvidence);
      expect(result.reconciled).toBe(true);
      expect(result.mismatches).toHaveLength(0);
    });
  });

  describe("2. Database to HTTP Content Equality & Rejection", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("PASSES when HTTP returns matching canonical payload", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            runId: "run_test_001",
            workspaceId: "ws_alpha",
            status: "COMPLETED",
            topThree: [
              { candidate: { candidateId: "cand_A" }, score: { opportunityScore: 88.5 } },
              { candidate: { candidateId: "cand_B" }, score: { opportunityScore: 76.2 } },
              { candidate: { candidateId: "cand_C" }, score: { opportunityScore: 65.0 } },
            ],
            provisionalCandidates: [],
          },
        }),
      } as any);

      const result = await reconcileDatabaseAndHttp(mockDbSnapshot, "http://localhost:3000/api/v1/kh02/research/runs/run_test_001", {
        workspaceId: "ws_alpha",
      });

      expect(result.reconciled).toBe(true);
      expect(result.mismatches).toHaveLength(0);
    });

    it("REJECTS HTTP missing a candidate from DB snapshot", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            runId: "run_test_001",
            workspaceId: "ws_alpha",
            status: "COMPLETED",
            topThree: [
              { candidate: { candidateId: "cand_A" }, score: { opportunityScore: 88.5 } },
              // cand_B is missing!
              { candidate: { candidateId: "cand_C" }, score: { opportunityScore: 65.0 } },
            ],
          },
        }),
      } as any);

      const result = await reconcileDatabaseAndHttp(mockDbSnapshot, "http://localhost:3000/api/v1/kh02/research/runs/run_test_001", {
        workspaceId: "ws_alpha",
      });

      expect(result.reconciled).toBe(false);
      const candMismatch = result.mismatches.find((m) => m.field === "candidateIds");
      expect(candMismatch?.reason).toContain("missing [cand_B]");
    });

    it("REJECTS HTTP with wrong rank order", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            runId: "run_test_001",
            workspaceId: "ws_alpha",
            status: "COMPLETED",
            topThree: [
              { candidate: { candidateId: "cand_B" }, score: { opportunityScore: 76.2 } }, // Inverted!
              { candidate: { candidateId: "cand_A" }, score: { opportunityScore: 88.5 } },
              { candidate: { candidateId: "cand_C" }, score: { opportunityScore: 65.0 } },
            ],
          },
        }),
      } as any);

      const result = await reconcileDatabaseAndHttp(mockDbSnapshot, "http://localhost:3000/api/v1/kh02/research/runs/run_test_001", {
        workspaceId: "ws_alpha",
      });

      expect(result.reconciled).toBe(false);
      const rankMismatch = result.mismatches.find((m) => m.field === "rankedCandidateIds");
      expect(rankMismatch?.reason).toContain("HTTP ranked candidates order/set mismatch");
    });

    it("REJECTS HTTP score difference exceeding 0.01 tolerance", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            runId: "run_test_001",
            workspaceId: "ws_alpha",
            status: "COMPLETED",
            topThree: [
              { candidate: { candidateId: "cand_A" }, score: { opportunityScore: 88.55 } }, // 88.55 vs 88.50 > 0.01
              { candidate: { candidateId: "cand_B" }, score: { opportunityScore: 76.2 } },
              { candidate: { candidateId: "cand_C" }, score: { opportunityScore: 65.0 } },
            ],
          },
        }),
      } as any);

      const result = await reconcileDatabaseAndHttp(mockDbSnapshot, "http://localhost:3000/api/v1/kh02/research/runs/run_test_001", {
        workspaceId: "ws_alpha",
      });

      expect(result.reconciled).toBe(false);
      const scoreMismatch = result.mismatches.find((m) => m.field === "rankedScores.cand_A");
      expect(scoreMismatch).toBeDefined();
    });

    it("REJECTS HTTP workspace mismatch", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            runId: "run_test_001",
            workspaceId: "ws_unauthorized", // Mismatch!
            status: "COMPLETED",
            topThree: [
              { candidate: { candidateId: "cand_A" }, score: { opportunityScore: 88.5 } },
              { candidate: { candidateId: "cand_B" }, score: { opportunityScore: 76.2 } },
              { candidate: { candidateId: "cand_C" }, score: { opportunityScore: 65.0 } },
            ],
          },
        }),
      } as any);

      const result = await reconcileDatabaseAndHttp(mockDbSnapshot, "http://localhost:3000/api/v1/kh02/research/runs/run_test_001", {
        workspaceId: "ws_alpha",
      });

      expect(result.reconciled).toBe(false);
      const wsMismatch = result.mismatches.find((m) => m.field === "workspaceId");
      expect(wsMismatch).toBeDefined();
    });
  });

  describe("3. Strict Full Cross-Layer Requirements", () => {
    it("fails full cross-layer reconciliation when strictFullLayers is true and HTTP or Browser is missing", async () => {
      const mockDb = {
        syncJob: {
          findUnique: vi.fn().mockResolvedValue({
            id: "job_reconcile_001",
            workspaceId: "ws_alpha",
            status: "COMPLETED",
            resultJson: JSON.stringify({
              topThree: [
                { candidate: { id: "c1", title: "Product 1" }, score: { opportunityScore: 80 } },
              ],
              totalCandidatesDiscovered: 1,
            }),
          }),
        },
      };

      const resultWithoutHttp = await reconcileResearchAcrossLayers("job_reconcile_001", {
        db: mockDb,
        strictFullLayers: true, // Requires all 3 layers!
      });

      expect(resultWithoutHttp.reconciliationVerdict).toBe("MISMATCH");
      expect(resultWithoutHttp.httpStatus).toBe("NOT_RUN");
      expect(resultWithoutHttp.browserStatus).toBe("NOT_RUN");
      expect(resultWithoutHttp.httpReconciled).toBe(false);
      expect(resultWithoutHttp.browserReconciled).toBe(false);
      expect(resultWithoutHttp.reconciled).toBe(false);
      expect(resultWithoutHttp.notes.some((n) => n.includes("HTTP layer check skipped"))).toBe(true);
    });
  });
});
