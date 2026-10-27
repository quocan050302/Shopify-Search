import { describe, it, expect } from "vitest";
import {
  evaluateGateG10,
  evaluateGateD07,
  evaluateGateD09,
  evaluateSourceDbReconciliation,
  resolveRunUpstreamTraces,
  evaluateHttpBrowserReconciliation,
  UpstreamRecordTrace,
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
              matchingEvidence: "Keyword and domain grounded SKU match",
              isBrandOnly: false,
            },
          ],
        },
      ];

      const result = evaluateGateG10(candidates, {
        validCreativeIds: new Set(["google_ad_valid_01"]),
      });
      expect(result.verdict).toBe("PASS");
      expect(result.observedValues.orphanAssociationsCount).toBe(0);
      expect(result.observedValues.nonExistentRecordCount).toBe(0);
      expect(result.observedValues.brandLevelAsSkuViolationsCount).toBe(0);
      expect(result.observedValues.ungroundedMatchCount).toBe(0);
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
              matchingEvidence: "Valid query text",
            },
          ],
        },
      ];

      const result = evaluateGateG10(candidates);
      expect(result.verdict).toBe("FAIL");
      expect(result.observedValues.orphanAssociationsCount).toBe(1);
      expect(result.reason).toContain("orphan");
    });

    it("G10 FAILS when Google sourceRecordId does not exist in known run creatives", () => {
      const candidates = [
        {
          candidateId: "cand_fake_ref",
          title: "Dog Harness",
          sourceObservations: [
            {
              source: "GOOGLE_ADS",
              sourceRecordId: "does-not-exist", // Non-existent creative!
              productRelevance: "PRODUCT_SPECIFIC",
              matchingEvidence: "Query match",
            },
          ],
        },
      ];

      const result = evaluateGateG10(candidates, {
        validCreativeIds: new Set(["known_cr_01", "known_cr_02"]),
      });
      expect(result.verdict).toBe("FAIL");
      expect(result.observedValues.nonExistentRecordCount).toBe(1);
      expect(result.reason).toContain("non-existent or foreign Google creative ID 'does-not-exist'");
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
      expect(result.reason).toContain("brand-as-SKU");
    });

    it("G10 FAILS when PRODUCT_SPECIFIC label lacks matching or grounding evidence", () => {
      const candidates = [
        {
          candidateId: "cand_ungrounded",
          title: "Pet GPS Tracker",
          sourceObservations: [
            {
              source: "GOOGLE_ADS",
              sourceRecordId: "google_ad_01",
              productRelevance: "PRODUCT_SPECIFIC", // No matchingEvidence or groundingQuery!
            },
          ],
        },
      ];

      const result = evaluateGateG10(candidates, {
        validCreativeIds: new Set(["google_ad_01"]),
      });
      expect(result.verdict).toBe("FAIL");
      expect(result.observedValues.ungroundedMatchCount).toBe(1);
      expect(result.reason).toContain("without matching/grounding evidence");
    });
  });

  describe("Gate D07 — DB vs HTTP API Readback Reconciliation", () => {
    it("D07 passes when DB and HTTP return identical candidate IDs, ranks, scores, and confidence", () => {
      const dbSnapshot = {
        topThree: [
          { candidate: { candidateId: "cand_1", rank: 1, title: "Product A" }, score: { opportunityScore: 88, evidenceConfidence: 85, demandClass: "EVERGREEN_STABLE" } },
          { candidate: { candidateId: "cand_2", rank: 2, title: "Product B" }, score: { opportunityScore: 82, evidenceConfidence: 80, demandClass: "EVERGREEN_STABLE" } },
        ],
        remainingCandidates: [],
        provisionalCandidates: [],
      };

      const httpReadback = {
        topThree: [
          { candidate: { candidateId: "cand_1", rank: 1, title: "Product A" }, score: { opportunityScore: 88, evidenceConfidence: 85, demandClass: "EVERGREEN_STABLE" } },
          { candidate: { candidateId: "cand_2", rank: 2, title: "Product B" }, score: { opportunityScore: 82, evidenceConfidence: 80, demandClass: "EVERGREEN_STABLE" } },
        ],
        remainingCandidates: [],
        provisionalCandidates: [],
      };

      const result = evaluateGateD07(dbSnapshot, httpReadback);
      expect(result.verdict).toBe("PASS");
      expect(result.observedValues.exactMatch).toBe(true);
      expect(result.observedValues.diffsCount).toBe(0);
    });

    it("D07 FAILS when an item changes candidate group (e.g. winner in DB becomes provisional in HTTP)", () => {
      const item = {
        candidate: { candidateId: "cand_1", title: "Product A" },
        score: { opportunityScore: 88, evidenceConfidence: 85, demandClass: "EVERGREEN_STABLE" },
      };

      const dbSnapshot = {
        topThree: [item],
        provisionalCandidates: [],
      };

      const httpReadback = {
        topThree: [],
        provisionalCandidates: [item], // Swapped group!
      };

      const result = evaluateGateD07(dbSnapshot, httpReadback);
      expect(result.verdict).toBe("FAIL");
      expect(result.observedValues.exactMatch).toBe(false);
      expect(result.reason).toContain("group membership changed: DB=topThree vs HTTP=provisionalCandidates");
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
      expect(result.reason).toContain("missing in HTTP");
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
      expect(result.reason).toContain("opportunityScore changed");
    });

    it("D07 FAILS when candidate confidence score differs between DB and HTTP API", () => {
      const dbSnapshot = {
        topThree: [
          { candidate: { candidateId: "cand_1" }, score: { opportunityScore: 88, evidenceConfidence: 90 } },
        ],
      };

      const httpReadback = {
        topThree: [
          { candidate: { candidateId: "cand_1" }, score: { opportunityScore: 88, evidenceConfidence: 60 } },
        ],
      };

      const result = evaluateGateD07(dbSnapshot, httpReadback);
      expect(result.verdict).toBe("FAIL");
      expect(result.reason).toContain("evidenceConfidence changed");
    });

    it("D07 FAILS when candidate rank differs between DB and HTTP API", () => {
      const dbSnapshot = {
        topThree: [
          { candidate: { candidateId: "cand_1", rank: 1 }, score: { opportunityScore: 88 } },
        ],
      };

      const httpReadback = {
        topThree: [
          { candidate: { candidateId: "cand_1", rank: 3 }, score: { opportunityScore: 88 } },
        ],
      };

      const result = evaluateGateD07(dbSnapshot, httpReadback);
      expect(result.verdict).toBe("FAIL");
      expect(result.reason).toContain("rank changed");
    });

    it("D07 FAILS when candidate source associations differ between DB and HTTP API", () => {
      const dbSnapshot = {
        topThree: [
          {
            candidate: {
              candidateId: "cand_1",
              sourceObservations: [{ source: "META_ADS", sourceRecordId: "meta_100" }],
            },
            score: { opportunityScore: 88 },
          },
        ],
      };

      const httpReadback = {
        topThree: [
          {
            candidate: {
              candidateId: "cand_1",
              sourceObservations: [{ source: "GOOGLE_ADS", sourceRecordId: "google_200" }],
            },
            score: { opportunityScore: 88 },
          },
        ],
      };

      const result = evaluateGateD07(dbSnapshot, httpReadback);
      expect(result.verdict).toBe("FAIL");
      expect(result.reason).toContain("sourceAssociations mismatch");
    });

    it("D07 FAILS when item.rank changes (e.g. 1 to 99) under the RankedLeaderboardItem contract", () => {
      const item = {
        candidate: { candidateId: "c1" },
        rank: 1,
        score: { opportunityScore: 88, evidenceConfidence: 80 },
      };
      const result = evaluateGateD07(
        { topThree: [item] },
        { topThree: [{ ...item, rank: 99 }] }
      );
      expect(result.verdict).toBe("FAIL");
      expect(result.reason).toContain("rank changed: DB=1 vs HTTP=99");
    });

    it("D07 FAILS when inputs have invalid schema shape without candidate containers", () => {
      const dbSnapshot = { notACandidateList: true };
      const httpReadback = { alsoInvalid: "no_candidates" };

      const result = evaluateGateD07(dbSnapshot, httpReadback);
      expect(result.verdict).toBe("FAIL");
      expect(result.reason).toContain("Invalid schema shape");
    });

    it("D07 FAILS when HTTP readback is completely missing (null / HTTP error)", () => {
      const dbSnapshot = { topThree: [] };
      const result = evaluateGateD07(dbSnapshot, null);
      expect(result.verdict).toBe("FAIL");
      expect(result.reason).toContain("Invalid schema shape");
    });
  });

  describe("Gate D09 — Strict Evergreen Gating Preservation", () => {
    it("D09 passes when all promoted winners have verified historical demand and production pillar structure", () => {
      const resultJson = {
        topThree: [
          {
            candidate: { candidateId: "cand_winner_1", title: "Genuine Evergreen Winner" },
            score: {
              opportunityScore: 89,
              demandClass: "EVERGREEN_STABLE",
              pillars: {
                demandStability: { score: 22, max: 25, status: "PASS" },
              },
              evidenceConfidence: 85,
            },
          },
        ],
      };

      const result = evaluateGateD09(resultJson);
      expect(result.verdict).toBe("PASS");
      expect(result.observedValues.violationsCount).toBe(0);
      expect(result.reason).toBeNull();
    });

    it("D09 FAILS when candidate in topThree has demandStability pillar score null", () => {
      const resultJson = {
        topThree: [
          {
            candidate: { candidateId: "c1", title: "Null Pillar Winner" },
            score: {
              opportunityScore: 88,
              demandClass: "EVERGREEN_STABLE",
              pillars: { demandStability: { score: null } },
              evidenceConfidence: 80,
            },
          },
        ],
      };

      const result = evaluateGateD09(resultJson);
      expect(result.verdict).toBe("FAIL");
      expect(result.observedValues.violationsCount).toBe(1);
      expect(result.reason).toContain("lacks verified demand stability pillar score");
    });

    it("D09 FAILS when candidate in topThree has demandStability pillar score < 15", () => {
      const resultJson = {
        topThree: [
          {
            candidate: { candidateId: "c1", title: "Weak Stability Winner" },
            score: {
              opportunityScore: 88,
              demandClass: "EVERGREEN_STABLE",
              pillars: { demandStability: { score: 12 } },
              evidenceConfidence: 80,
            },
          },
        ],
      };

      const result = evaluateGateD09(resultJson);
      expect(result.verdict).toBe("FAIL");
      expect(result.reason).toContain("below required threshold (15/25)");
    });

    it("D09 FAILS when candidate has DECLINING or TREND_DEPENDENT or INSUFFICIENT_HISTORY demand class", () => {
      for (const badClass of ["DECLINING", "TREND_DEPENDENT", "INSUFFICIENT_HISTORY"]) {
        const resultJson = {
          topThree: [
            {
              candidate: { candidateId: "c1", title: "Volatile Product" },
              score: {
                opportunityScore: 85,
                demandClass: badClass,
                pillars: { demandStability: { score: 20 } },
                evidenceConfidence: 80,
              },
            },
          ],
        };

        const result = evaluateGateD09(resultJson);
        expect(result.verdict).toBe("FAIL");
        expect(result.reason).toContain(badClass);
      }
    });

    it("D09 FAILS when candidate has evidenceConfidence < 65", () => {
      const resultJson = {
        topThree: [
          {
            candidate: { candidateId: "c1", title: "Low Confidence Winner" },
            score: {
              opportunityScore: 85,
              demandClass: "EVERGREEN_STABLE",
              pillars: { demandStability: { score: 20 } },
              evidenceConfidence: 55, // Below 65!
            },
          },
        ],
      };

      const result = evaluateGateD09(resultJson);
      expect(result.verdict).toBe("FAIL");
      expect(result.reason).toContain("evidence confidence 55/100 below verified threshold");
    });

    it("D09 FAILS when candidate lacks score object entirely", () => {
      const resultJson = {
        topThree: [
          { candidate: { candidateId: "c1", title: "Unscored Winner" } },
        ],
      };

      const result = evaluateGateD09(resultJson);
      expect(result.verdict).toBe("FAIL");
      expect(result.reason).toContain("without valid score object");
    });
  });

  describe("Layer 1 Reconciliation — Source to Database Exact Record Set", () => {
    it("Passes when exact set of source records from the run exist in database", () => {
      const runId = "kh02_run_test_01";
      const upstreamTraces: UpstreamRecordTrace[] = [
        { rawId: "ad_rec_01", decision: "ACCEPTED", persistedId: "ad_rec_01" },
        { rawId: "ad_rec_02", decision: "ACCEPTED", persistedId: "ad_rec_02" },
      ];
      const dbRecords = [{ id: "ad_rec_01" }, { id: "ad_rec_02" }];

      const result = evaluateSourceDbReconciliation(runId, upstreamTraces, dbRecords);
      expect(result.exactMatch).toBe(true);
      expect(result.missingInDb).toHaveLength(0);
      expect(result.unexplainedLostCount).toBe(0);
    });

    it("FAILS when an upstream record is lost before persisting without explanation", () => {
      const runId = "kh02_run_test_02";
      const upstreamTraces: UpstreamRecordTrace[] = [
        { rawId: "ad_up_01", decision: "ACCEPTED", persistedId: "ad_up_01" },
        { rawId: "ad_up_02", decision: "ACCEPTED", persistedId: "ad_up_02" }, // Disappeared!
      ];
      const dbRecords = [{ id: "ad_up_01" }];

      const result = evaluateSourceDbReconciliation(runId, upstreamTraces, dbRecords);
      expect(result.exactMatch).toBe(false);
      expect(result.unexplainedLostCount).toBe(1);
      expect(result.missingInDb).toContain("ad_up_02");
    });

    it("Passes when rejected upstream records have explicit reasons and duplicates are handled", () => {
      const runId = "kh02_run_test_03";
      const upstreamTraces: UpstreamRecordTrace[] = [
        { rawId: "ad_up_01", decision: "ACCEPTED", persistedId: "ad_up_01" },
        { rawId: "ad_up_02", decision: "DUPLICATE", persistedId: "ad_up_01" },
        { rawId: "ad_up_03", decision: "REJECTED", rejectionReason: "AD_OUTSIDE_LOOKBACK_WINDOW" },
      ];
      const dbRecords = [{ id: "ad_up_01" }];

      const result = evaluateSourceDbReconciliation(runId, upstreamTraces, dbRecords);
      expect(result.exactMatch).toBe(true);
      expect(result.acceptedCount).toBe(1);
      expect(result.updatedCount).toBe(1);
      expect(result.rejectedCount).toBe(1);
      expect(result.unexplainedLostCount).toBe(0);
    });

    it("FAILS when DB contains foreign extra records not originating from the research run", () => {
      const runId = "kh02_run_test_04";
      const upstreamTraces: UpstreamRecordTrace[] = [
        { rawId: "ad_up_01", decision: "ACCEPTED", persistedId: "ad_up_01" },
      ];
      const dbRecords = [{ id: "ad_up_01" }, { id: "foreign_ad_from_other_run" }];

      const result = evaluateSourceDbReconciliation(runId, upstreamTraces, dbRecords);
      expect(result.exactMatch).toBe(false);
      expect(result.extraInDb).toContain("foreign_ad_from_other_run");
    });

    it("FAILS when upstream count is 2 and DB is 1 without audit trace decision for the 2nd record", () => {
      const runId = "kh02_run_test_unaccounted";
      const { traces, unaccountedCount } = resolveRunUpstreamTraces([], 2, ["ad_rec_01"]);
      expect(unaccountedCount).toBe(1);

      const dbRecords = [{ id: "ad_rec_01" }];
      const result = evaluateSourceDbReconciliation(runId, traces, dbRecords);
      expect(result.exactMatch).toBe(false);
      expect(result.unexplainedLostCount).toBe(1);
    });

    it("PASSES when upstream record has real duplicate/rejection audit trace with raw identity", () => {
      const runId = "kh02_run_test_audited_rejection";
      const auditTraces: UpstreamRecordTrace[] = [
        { rawId: "meta_raw_01", digest: "hash1", decision: "ACCEPTED", persistedId: "ad_rec_01" },
        { rawId: "meta_raw_02", digest: "hash2", decision: "REJECTED", rejectionReason: "AD_OUTSIDE_LOOKBACK_WINDOW" },
      ];
      const { traces, unaccountedCount } = resolveRunUpstreamTraces(auditTraces, 2, ["ad_rec_01"]);
      expect(unaccountedCount).toBe(0);

      const dbRecords = [{ id: "ad_rec_01" }];
      const result = evaluateSourceDbReconciliation(runId, traces, dbRecords);
      expect(result.exactMatch).toBe(true);
      expect(result.acceptedCount).toBe(1);
      expect(result.rejectedCount).toBe(1);
      expect(result.unexplainedLostCount).toBe(0);
    });
  });

  describe("Layer 3 Reconciliation — HTTP API to Browser DOM", () => {
    it("Passes when browser renders exact candidate IDs in order matching HTTP", () => {
      const httpResult = {
        topThree: [{ candidate: { candidateId: "cand_1" } }],
        provisionalCandidates: [{ candidate: { candidateId: "cand_2" } }],
      };
      const browserRendered = ["cand_1", "cand_2"];

      const result = evaluateHttpBrowserReconciliation(httpResult, browserRendered, browserRendered, false);
      expect(result.exactMatch).toBe(true);
      expect(result.reloadConsistent).toBe(true);
      expect(result.reason).toBeNull();
    });

    it("Enforces UI subset rule: renders all topThree + max 6 provisional cards", () => {
      const httpResult = {
        topThree: [{ candidate: { candidateId: "w1" } }, { candidate: { candidateId: "w2" } }],
        provisionalCandidates: Array.from({ length: 12 }, (_, i) => ({ candidate: { candidateId: `p${i + 1}` } })),
      };
      // Expected cards: w1, w2, p1..p6 = 8 cards
      const browserRendered = ["w1", "w2", "p1", "p2", "p3", "p4", "p5", "p6"];

      const result = evaluateHttpBrowserReconciliation(httpResult, browserRendered, browserRendered, false);
      expect(result.exactMatch).toBe(true);
      expect(result.cardsExpected).toBe(8);
      expect(result.cardsRendered).toBe(8);
    });

    it("FAILS when browser is missing a card returned by HTTP", () => {
      const httpResult = {
        topThree: [{ candidate: { candidateId: "cand_1" } }, { candidate: { candidateId: "cand_2" } }],
      };
      const browserRendered = ["cand_1"];

      const result = evaluateHttpBrowserReconciliation(httpResult, browserRendered, false);
      expect(result.exactMatch).toBe(false);
      expect(result.reason).toContain("Card count mismatch");
    });

    it("FAILS when cards are lost or mutated after page reload", () => {
      const httpResult = {
        topThree: [{ candidate: { candidateId: "cand_1" } }, { candidate: { candidateId: "cand_2" } }],
      };
      const preReload = ["cand_1", "cand_2"];
      const postReload = ["cand_1"]; // cand_2 lost on reload!

      const result = evaluateHttpBrowserReconciliation(httpResult, preReload, postReload, false);
      expect(result.exactMatch).toBe(false);
      expect(result.reloadConsistent).toBe(false);
      expect(result.reason).toContain("Post-reload count mismatch");
    });

    it("FAILS when candidate card score on DOM does not match HTTP readback", () => {
      const httpResult = {
        topThree: [
          { candidate: { candidateId: "cand_1" }, score: { opportunityScore: 88 } },
        ],
      };
      const browserCards = [
        { candidateId: "cand_1", score: 65 }, // Score mismatch!
      ];

      const result = evaluateHttpBrowserReconciliation(httpResult, browserCards, browserCards, false);
      expect(result.exactMatch).toBe(false);
      expect(result.reason).toContain("Score mismatch for 'cand_1': HTTP=88 vs DOM=65");
    });

    it("FAILS when candidate card confidence on DOM is 'WRONG' or does not match HTTP", () => {
      const httpResult = {
        topThree: [{ candidate: { candidateId: "cand_1" }, score: { opportunityScore: 88, evidenceConfidence: 80 } }],
      };
      const browserCards = [{ candidateId: "cand_1", score: 88, confidence: "WRONG" }];
      const result = evaluateHttpBrowserReconciliation(httpResult, browserCards, browserCards, false);
      expect(result.exactMatch).toBe(false);
      expect(result.reason).toContain("Confidence mismatch for 'cand_1': HTTP=80 vs DOM=WRONG");
    });

    it("FAILS when expected has cards but postReloadCards is empty []", () => {
      const httpResult = {
        topThree: [{ candidate: { candidateId: "cand_1" }, score: { opportunityScore: 88, evidenceConfidence: 80 } }],
      };
      const preReload = [{ candidateId: "cand_1", score: 88, confidence: 80 }];
      const postReload: any[] = [];
      const result = evaluateHttpBrowserReconciliation(httpResult, preReload, postReload, false);
      expect(result.exactMatch).toBe(false);
      expect(result.reloadConsistent).toBe(false);
      expect(result.reason).toContain("Post-reload cards is empty [] while expected 1 cards");
    });

    it("FAILS when card score mutates after page reload", () => {
      const httpResult = {
        topThree: [{ candidate: { candidateId: "cand_1" }, score: { opportunityScore: 88, evidenceConfidence: 80 } }],
      };
      const preReload = [{ candidateId: "cand_1", score: 88, confidence: 80 }];
      const postReload = [{ candidateId: "cand_1", score: 40, confidence: 80 }];
      const result = evaluateHttpBrowserReconciliation(httpResult, preReload, postReload, false);
      expect(result.exactMatch).toBe(false);
      expect(result.reloadConsistent).toBe(false);
      expect(result.reason).toContain("Post-reload score mismatch for 'cand_1': pre=88 vs post=40");
    });

    it("Passes empty state truthfully when HTTP has 0 candidates and empty state is rendered", () => {
      const httpResult = { topThree: [], provisionalCandidates: [] };
      const browserCards: string[] = [];

      const result = evaluateHttpBrowserReconciliation(httpResult, browserCards, browserCards, true);
      expect(result.exactMatch).toBe(true);
      expect(result.cardsExpected).toBe(0);
      expect(result.cardsRendered).toBe(0);
    });

    it("FAILS when HTTP has 0 candidates but browser rendered cards", () => {
      const httpResult = { topThree: [], provisionalCandidates: [] };
      const browserCards = ["phantom_card"];

      const result = evaluateHttpBrowserReconciliation(httpResult, browserCards, browserCards, false);
      expect(result.exactMatch).toBe(false);
      expect(result.reason).toContain("HTTP has 0 candidates, but browser rendered 1 cards");
    });
  });
});
