import { describe, it, expect } from "vitest";
import {
  evaluateGateG10,
  evaluateGateD07,
  evaluateGateD09,
  evaluateSourceDbReconciliation,
  evaluateHttpBrowserReconciliation,
} from "../../scripts/kh02/runAcceptanceV12_2_4";

describe("SWAI KH-02 V12.2.4 — Dynamic Release Gates & Exact Multi-Layer Reconciliation", () => {
  describe("Gate G10 — Google Pipeline Reconciliation", () => {
    it("G10 passes when all Google associations have valid source records and SKU grounding", () => {
      const candidates = [
        {
          candidateId: "cand_dog_collar",
          title: "Smart Pet Collar",
          sourceObservations: [
            {
              source: "GOOGLE_ADS",
              sourceRecordId: "google_ad_valid_01",
              productRelevance: "PRODUCT_SPECIFIC",
              isBrandOnly: false,
            },
          ],
        },
      ];

      const result = evaluateGateG10(candidates);
      expect(result.verdict).toBe("PASS");
      expect(result.observedValues.orphanAssociationsCount).toBe(0);
      expect(result.observedValues.brandLevelAsSkuViolationsCount).toBe(0);
      expect(result.reason).toBeNull();
    });

    it("G10 FAILS when an orphan Google association is detected (missing sourceRecordId)", () => {
      const candidates = [
        {
          candidateId: "cand_dog_feeder",
          title: "Automatic Pet Feeder",
          sourceObservations: [
            {
              source: "GOOGLE_ADS",
              sourceRecordId: "", // Orphan!
              productRelevance: "PRODUCT_SPECIFIC",
            },
          ],
        },
      ];

      const result = evaluateGateG10(candidates);
      expect(result.verdict).toBe("FAIL");
      expect(result.observedValues.orphanAssociationsCount).toBe(1);
      expect(result.reason).toContain("orphan associations");
    });

    it("G10 FAILS when a brand-level creative is attached directly as SKU evidence", () => {
      const candidates = [
        {
          candidateId: "cand_chewy_bed",
          title: "Chewy Orthopedic Bed",
          sourceObservations: [
            {
              source: "GOOGLE_ADS",
              sourceRecordId: "google_ad_chewy_brand",
              productRelevance: "BRAND_RELATED", // Brand-level ad cannot be SKU evidence!
            },
          ],
        },
      ];

      const result = evaluateGateG10(candidates);
      expect(result.verdict).toBe("FAIL");
      expect(result.observedValues.brandLevelAsSkuViolationsCount).toBe(1);
      expect(result.reason).toContain("brand-as-SKU violations");
    });
  });

  describe("Gate D07 — DB vs HTTP API Readback Reconciliation", () => {
    it("D07 passes when DB and HTTP return identical candidate IDs, ranks, and scores", () => {
      const dbSnapshot = {
        topThree: [
          { candidate: { candidateId: "cand_1", title: "Product A" }, score: { opportunityScore: 88 } },
          { candidate: { candidateId: "cand_2", title: "Product B" }, score: { opportunityScore: 82 } },
        ],
        remainingCandidates: [],
        provisionalCandidates: [],
      };

      const httpReadback = {
        topThree: [
          { candidate: { candidateId: "cand_1", title: "Product A" }, score: { opportunityScore: 88 } },
          { candidate: { candidateId: "cand_2", title: "Product B" }, score: { opportunityScore: 82 } },
        ],
        remainingCandidates: [],
        provisionalCandidates: [],
      };

      const result = evaluateGateD07(dbSnapshot, httpReadback);
      expect(result.verdict).toBe("PASS");
      expect(result.observedValues.exactMatch).toBe(true);
      expect(result.observedValues.scoreDiffsCount).toBe(0);
    });

    it("D07 FAILS when HTTP readback omits a candidate present in DB snapshot", () => {
      const dbSnapshot = {
        topThree: [
          { candidate: { candidateId: "cand_1" }, score: { opportunityScore: 88 } },
          { candidate: { candidateId: "cand_2" }, score: { opportunityScore: 82 } },
        ],
      };

      const httpReadback = {
        topThree: [
          { candidate: { candidateId: "cand_1" }, score: { opportunityScore: 88 } },
        ], // Missing cand_2!
      };

      const result = evaluateGateD07(dbSnapshot, httpReadback);
      expect(result.verdict).toBe("FAIL");
      expect(result.observedValues.exactMatch).toBe(false);
      expect(result.reason).toContain("idsMatch=false");
    });

    it("D07 FAILS when HTTP readback returns a mutated opportunity score", () => {
      const dbSnapshot = {
        topThree: [
          { candidate: { candidateId: "cand_1" }, score: { opportunityScore: 88 } },
        ],
      };

      const httpReadback = {
        topThree: [
          { candidate: { candidateId: "cand_1" }, score: { opportunityScore: 65 } }, // Mutated!
        ],
      };

      const result = evaluateGateD07(dbSnapshot, httpReadback);
      expect(result.verdict).toBe("FAIL");
      expect(result.observedValues.scoreDiffsCount).toBe(1);
    });

    it("D07 FAILS when HTTP readback is completely missing (null / HTTP error)", () => {
      const dbSnapshot = { topThree: [] };
      const result = evaluateGateD07(dbSnapshot, null);
      expect(result.verdict).toBe("FAIL");
      expect(result.reason).toContain("Missing database snapshot or HTTP readback");
    });
  });

  describe("Gate D09 — Strict Evergreen Gating Preservation", () => {
    it("D09 passes when all promoted winners have verified historical demand", () => {
      const resultJson = {
        topThree: [
          {
            candidate: { candidateId: "cand_winner_1", title: "Genuine Evergreen Winner" },
            score: {
              opportunityScore: 89,
              demandClass: "EVERGREEN_STABLE",
              demandStabilityScore: 22,
              evidenceConfidence: 85,
            },
          },
        ],
      };

      const result = evaluateGateD09(resultJson);
      expect(result.verdict).toBe("PASS");
      expect(result.observedValues.ungroundedWinnersCount).toBe(0);
    });

    it("D09 FAILS when a candidate lacking demand history is promoted to topThree winner", () => {
      const resultJson = {
        topThree: [
          {
            candidate: { candidateId: "cand_fake_winner", title: "Unproven Product" },
            score: {
              opportunityScore: 85,
              demandClass: "INSUFFICIENT_HISTORY", // Fatal violation for evergreen winner!
              demandStabilityScore: 0,
              evidenceConfidence: 50,
            },
          },
        ],
      };

      const result = evaluateGateD09(resultJson);
      expect(result.verdict).toBe("FAIL");
      expect(result.observedValues.ungroundedWinnersCount).toBe(1);
      expect(result.reason).toContain("INSUFFICIENT_HISTORY");
    });
  });

  describe("Layer 1 Reconciliation — Source to Database Exact Record Set", () => {
    it("Passes when exact set of source records from the run exist in database", () => {
      const runId = "kh02_run_test_01";
      const runSourceRecordIds = ["ad_rec_01", "ad_rec_02"];
      const dbRecords = [{ id: "ad_rec_01" }, { id: "ad_rec_02" }];

      const result = evaluateSourceDbReconciliation(runId, runSourceRecordIds, dbRecords);
      expect(result.exactMatch).toBe(true);
      expect(result.missingInDb).toHaveLength(0);
    });

    it("Detects when DB has older records but lacks records from the new research run", () => {
      const runId = "kh02_run_test_02";
      const runSourceRecordIds = ["ad_new_run_01", "ad_new_run_02"];
      const dbRecords = [{ id: "ad_old_historical_01" }, { id: "ad_new_run_01" }]; // Missing ad_new_run_02!

      const result = evaluateSourceDbReconciliation(runId, runSourceRecordIds, dbRecords);
      expect(result.exactMatch).toBe(false);
      expect(result.missingInDb).toContain("ad_new_run_02");
    });
  });

  describe("Layer 3 Reconciliation — HTTP API to Browser DOM", () => {
    it("Passes when browser renders exact candidate IDs in order matching HTTP", () => {
      const httpIds = ["cand_1", "cand_2"];
      const browserIds = ["cand_1", "cand_2"];

      const result = evaluateHttpBrowserReconciliation(httpIds, browserIds, false);
      expect(result.exactMatch).toBe(true);
      expect(result.reason).toBeNull();
    });

    it("Fails when browser is missing a card returned by HTTP", () => {
      const httpIds = ["cand_1", "cand_2"];
      const browserIds = ["cand_1"];

      const result = evaluateHttpBrowserReconciliation(httpIds, browserIds, false);
      expect(result.exactMatch).toBe(false);
      expect(result.reason).toContain("expected 2 from HTTP");
    });

    it("Passes empty state truthfully when HTTP has 0 candidates and empty state is rendered", () => {
      const httpIds: string[] = [];
      const browserIds: string[] = [];

      const result = evaluateHttpBrowserReconciliation(httpIds, browserIds, true);
      expect(result.exactMatch).toBe(true);
    });

    it("Fails when HTTP has candidates but browser rendered empty state", () => {
      const httpIds = ["cand_1"];
      const browserIds: string[] = [];

      const result = evaluateHttpBrowserReconciliation(httpIds, browserIds, true);
      expect(result.exactMatch).toBe(false);
    });
  });
});
