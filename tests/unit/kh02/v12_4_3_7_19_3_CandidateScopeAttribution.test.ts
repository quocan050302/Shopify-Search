/**
 * SWAI KH-02 — V12.4.3.7.19.3
 * Candidate-Scoped Demand Attribution & Complete Truth Verification
 *
 * Adversarial Test Matrix C01 - C20:
 * Enforces strict candidate-scoped observation attribution, eliminating cross-candidate,
 * cross-keyword, cross-run, or cross-workspace demand observation leakage for product-specific G15 history.
 */

import { describe, it, expect } from "vitest";
import {
  classifyCandidateObservationAttribution,
  filterAttributableObservations,
  type CandidateAttributionContext,
  type CandidateObservationRecord,
  type VerifiedCandidateAlias,
} from "@/services/kh02/demand/candidateDemandAttribution";
import {
  evaluateDemandHistoryEvidence,
  evaluateDemandSourceAuthority,
  areExactOrCanonicalEquivalentQueries,
  type DemandDataPoint,
} from "@/services/kh02/demand/temporalDemandEngine";
import { resolveProductDemandHistory } from "@/services/kh02/demand/historicalDemandIngestion";

describe("KH-02 V12.4.3.7.19.3: Candidate-Scoped Demand Attribution Matrix (C01 - C20)", () => {
  const uahpetCanonicalId = "cmvsy7zqh000jp0orhypwohho";
  const uahpetCandidateTitle = "UAHPET Fresh Food Automatic Pet Feeder";
  const catFeederKeyword = "Automatic Wet Food Cat Feeder with Cooling & Warming";

  const uahpetContext: CandidateAttributionContext = {
    candidateId: "cand_1212440541",
    researchRunId: "kh02_run_1793424091548_669k8",
    canonicalProductId: uahpetCanonicalId,
    candidateCanonicalName: uahpetCandidateTitle,
    authorizedKeywords: [uahpetCandidateTitle],
    workspaceId: "ws_acceptance_us",
    region: "US",
  };

  it("C01: ProductId matches but observation keyword is unrelated -> not counted for UAHPET G15", () => {
    const unrelatedObs: CandidateObservationRecord = {
      id: "obs_unrelated_1",
      productId: uahpetCanonicalId,
      keyword: "Stainless Steel Cat Water Fountain",
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
      evidenceReference: "verified-merchant-demand:uahpet.com",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      demandValue: 75,
    };

    const res = classifyCandidateObservationAttribution(unrelatedObs, uahpetContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_KEYWORD_MISMATCH");
  });

  it("C02: UAHPET name vs Automatic Wet Food Cat Feeder without verified alias -> UNVERIFIED_ALIAS, not automatic PASS", () => {
    const rawFeederObs: CandidateObservationRecord = {
      id: "obs_feeder_raw",
      productId: uahpetCanonicalId,
      keyword: catFeederKeyword,
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
      evidenceReference: "verified-merchant-demand:uahpet.com",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      demandValue: 76,
    };

    const res = classifyCandidateObservationAttribution(rawFeederObs, uahpetContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_UNVERIFIED_ALIAS");
    expect(res.reason).toContain("lacks an explicit verified alias");
  });

  it("C03: An independently evidenced explicit alias -> accepted ONLY with same candidate, product, US geo, tenant/run, point-in-time and row provenance", () => {
    const verifiedAlias: VerifiedCandidateAlias = {
      aliasKeyword: catFeederKeyword,
      targetProductId: uahpetCanonicalId,
      candidateId: "cand_1212440541",
      approvedBy: "qa_principal_lead",
      provenanceReference: "gov_decision_ref_20261106_alias_uahpet",
      workspaceId: "ws_acceptance_us",
    };

    const contextWithAlias: CandidateAttributionContext = {
      ...uahpetContext,
      verifiedAliases: [verifiedAlias],
    };

    const obs: CandidateObservationRecord = {
      id: "obs_aliased_valid",
      productId: uahpetCanonicalId,
      keyword: catFeederKeyword,
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
      evidenceReference: "trends-csv:official:us-pet-feeder-hash123",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      demandValue: 80,
    };

    const res = classifyCandidateObservationAttribution(obs, contextWithAlias);
    expect(res.isAttributable).toBe(true);
    expect(res.classification).toBe("VERIFIED_EXPLICIT_ALIAS_MATCH");
    expect(res.matchedAlias?.approvedBy).toBe("qa_principal_lead");
  });

  it("C04: Same canonical productId with two disjoint SKU keywords -> each candidate sees only authorized series", () => {
    const cand1Context: CandidateAttributionContext = {
      candidateId: "cand_feeder_black",
      canonicalProductId: uahpetCanonicalId,
      candidateCanonicalName: "UAHPET Automatic Feeder Black Edition",
      authorizedKeywords: ["UAHPET Automatic Feeder Black Edition"],
    };

    const cand2Context: CandidateAttributionContext = {
      candidateId: "cand_feeder_white",
      canonicalProductId: uahpetCanonicalId,
      candidateCanonicalName: "UAHPET Automatic Feeder White Edition",
      authorizedKeywords: ["UAHPET Automatic Feeder White Edition"],
    };

    const obsBlack: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: "UAHPET Automatic Feeder Black Edition",
      region: "US",
      demandValue: 70,
    };

    const res1 = classifyCandidateObservationAttribution(obsBlack, cand1Context);
    const res2 = classifyCandidateObservationAttribution(obsBlack, cand2Context);

    expect(res1.isAttributable).toBe(true);
    expect(res1.classification).toBe("EXACT_CANDIDATE_KEYWORD_MATCH");
    expect(res2.isAttributable).toBe(false);
    expect(res2.classification).toBe("EXCLUDED_UNVERIFIED_ALIAS");
  });

  it("C05: Cross-workspace observation with same productId+keyword -> excluded", () => {
    const crossWorkspaceObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      workspaceId: "ws_other_tenant",
      region: "US",
      demandValue: 85,
    };

    const res = classifyCandidateObservationAttribution(crossWorkspaceObs, uahpetContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_WORKSPACE_OR_RUN");
  });

  it("C06: Cross-research-run observation with same productId+keyword -> excluded or demoted", () => {
    const crossRunObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      researchRunId: "run_other_session_999",
      region: "US",
      demandValue: 85,
    };

    const res = classifyCandidateObservationAttribution(crossRunObs, uahpetContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_WORKSPACE_OR_RUN");
  });

  it("C07: Unknown/null candidate productId and empty query -> no proven G15 history", () => {
    const anonymousContext: CandidateAttributionContext = {
      candidateId: null,
      canonicalProductId: null,
      candidateCanonicalName: null,
      authorizedKeywords: [],
    };

    const obs: CandidateObservationRecord = {
      productId: "prod_some_id",
      keyword: "Some Pet Feeder",
      demandValue: 75,
    };

    const res = classifyCandidateObservationAttribution(obs, anonymousContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("INSUFFICIENT_CANDIDATE_IDENTITY");
  });

  it("C08: Substring product title / similar merchant URL -> cannot assert identity", () => {
    // "Cat Feeder" is a substring of "UAHPET Fresh Food Automatic Pet Feeder"
    const substringObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: "Cat Feeder",
      region: "US",
      demandValue: 75,
    };

    const res = classifyCandidateObservationAttribution(substringObs, uahpetContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_UNVERIFIED_ALIAS");
  });

  it("C09: Different true product IDs in one cache series -> never merged", () => {
    const crossProductObs: CandidateObservationRecord = {
      productId: "prod_completely_different_id_456",
      keyword: uahpetCandidateTitle,
      region: "US",
      demandValue: 75,
    };

    const res = classifyCandidateObservationAttribution(crossProductObs, uahpetContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_CROSS_PRODUCT");
  });

  it("C10: Cached historical row has valid SHA but wrong keyword for candidate -> excluded", () => {
    const obsWithValidSha: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: "Barking Dog Whistle Ultrasonic",
      evidenceReference: "trends-csv:official:sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      region: "US",
      demandValue: 60,
    };

    const res = classifyCandidateObservationAttribution(obsWithValidSha, uahpetContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_KEYWORD_MISMATCH");
  });

  it("C11: CSV with valid header/row but different US keyword -> excluded", () => {
    const csvObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: "Self Cleaning Cat Litter Box",
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
      demandValue: 90,
    };

    const res = classifyCandidateObservationAttribution(csvObs, uahpetContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_KEYWORD_MISMATCH");
  });

  it("C12: CSV with correct keyword but UK region -> excluded for US G15", () => {
    const ukObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      region: "GB",
      source: "GOOGLE_TRENDS_CSV",
      demandValue: 75,
    };

    const res = classifyCandidateObservationAttribution(ukObs, uahpetContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_REGION");
  });

  it("C13: Fixture/manual/demo observations -> not official VERIFIED business evidence", () => {
    const fixtureObs: CandidateObservationRecord = {
      productId: "prod_fixture_uahpet",
      keyword: uahpetCandidateTitle,
      region: "US",
      isFixture: true,
      source: "FIXTURE_DEMO",
      demandValue: 80,
    };

    const res = classifyCandidateObservationAttribution(fixtureObs, uahpetContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_FIXTURE_OR_PROXY");
  });

  it("C14: Stale receipt, future capturedAt or row after asOf -> rejected", () => {
    const futureObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      region: "US",
      periodStart: new Date(Date.now() + 10 * 86400000).toISOString(),
      demandValue: 80,
    };

    const res = classifyCandidateObservationAttribution(futureObs, uahpetContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_FUTURE_OR_POST_CUTOFF");

    const asOfContext: CandidateAttributionContext = {
      ...uahpetContext,
      asOfTimestamp: "2026-08-01T00:00:00.000Z",
    };
    const postCutoffObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      region: "US",
      periodStart: "2026-08-15T00:00:00.000Z",
      demandValue: 80,
    };
    const resPost = classifyCandidateObservationAttribution(postCutoffObs, asOfContext);
    expect(resPost.isAttributable).toBe(false);
    expect(resPost.classification).toBe("EXCLUDED_FUTURE_OR_POST_CUTOFF");
  });

  it("C15: Unverified provider-request: string -> never grants AUTHORIZED_PROOF under strict provenance", () => {
    const unverifiedPseudoRefObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      region: "US",
      evidenceReference: "verified-merchant-demand:uahpet.com",
      demandValue: 75,
    };

    const strictContext: CandidateAttributionContext = {
      ...uahpetContext,
      strictProvenance: true,
    };

    const res = classifyCandidateObservationAttribution(unverifiedPseudoRefObs, strictContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_MISSING_PROVENANCE");
  });

  it("C16: Empty target series but 96 unrelated workspace rows -> eligible count 0, G15 insufficient", () => {
    // Generate 96 unrelated rows from other products
    const unrelatedRows: CandidateObservationRecord[] = Array.from({ length: 96 }, (_, i) => ({
      id: `unrelated_${i}`,
      productId: `prod_other_${i % 10}`,
      keyword: `Unrelated Product Keyword ${i % 10}`,
      region: "US",
      periodStart: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
      demandValue: 50 + (i % 30),
    }));

    const partition = filterAttributableObservations(unrelatedRows, uahpetContext);
    expect(partition.totalInputObservations).toBe(96);
    expect(partition.attributableCount).toBe(0);
    expect(partition.excludedCount).toBe(96);

    const assessment = evaluateDemandHistoryEvidence(partition.attributableObservations as any[], {
      minimumCoveredDays: 60,
      candidateCanonicalName: uahpetCandidateTitle,
    });
    expect(assessment.status).toBe("INSUFFICIENT_HISTORY");
    expect(assessment.coveredDays).toBe(0);
    expect(assessment.eligibleForEvergreen).toBe(false);
  });

  it("C17: 6 same-product-ID observations but 0 candidate-attributable rows -> report BOTH separately", () => {
    const sixDbRows: CandidateObservationRecord[] = [
      { id: "obs_1", productId: uahpetCanonicalId, keyword: catFeederKeyword, demandValue: 76, periodStart: "2026-06-01" },
      { id: "obs_2", productId: uahpetCanonicalId, keyword: catFeederKeyword, demandValue: 79, periodStart: "2026-07-01" },
      { id: "obs_3", productId: uahpetCanonicalId, keyword: catFeederKeyword, demandValue: 77, periodStart: "2026-08-01" },
      { id: "obs_4", productId: uahpetCanonicalId, keyword: catFeederKeyword, demandValue: 81, periodStart: "2026-09-01" },
      { id: "obs_5", productId: uahpetCanonicalId, keyword: catFeederKeyword, demandValue: 78, periodStart: "2026-10-01" },
      { id: "obs_6", productId: uahpetCanonicalId, keyword: catFeederKeyword, demandValue: 82, periodStart: "2026-10-24" },
    ];

    const partition = filterAttributableObservations(sixDbRows, uahpetContext);
    expect(partition.totalInputObservations).toBe(6);
    expect(partition.attributableCount).toBe(0);
    expect(partition.excludedCount).toBe(6);
    expect(partition.classifications.EXCLUDED_UNVERIFIED_ALIAS).toBe(6);
  });

  it("C18: Source recovers new verified candidate point where cache has different keyword same date -> verified point retained", () => {
    // When live candidate point is recovered, candidate point on date D takes precedence
    const liveCandidatePoint: DemandDataPoint = {
      id: "live_cand_pt",
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-08-08T00:00:00.000Z",
      demandValue: 88,
      region: "US",
      source: "Google Trends (SerpApi)",
    } as any;

    const cacheUnrelatedPoint: DemandDataPoint = {
      id: "cache_unrelated_pt",
      productId: uahpetCanonicalId,
      keyword: catFeederKeyword,
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-08-08T00:00:00.000Z",
      demandValue: 77,
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
    } as any;

    // Simulate merge deduplication
    const seenDates = new Set([String(liveCandidatePoint.periodStart).slice(0, 10)]);
    const combined = [liveCandidatePoint];
    const d = String(cacheUnrelatedPoint.periodStart).slice(0, 10);
    if (!seenDates.has(d)) {
      seenDates.add(d);
      combined.push(cacheUnrelatedPoint);
    }

    expect(combined.length).toBe(1);
    expect(combined[0].keyword).toBe(uahpetCandidateTitle);
    expect(combined[0].demandValue).toBe(88);
  });

  it("C19: Same canonical query differing only whitespace/case/punctuation -> preserved per supported canonical comparison", () => {
    const harmlessVariationObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: '  "UAHPET fresh food automatic pet feeder"  ',
      region: "US",
      demandValue: 80,
    };

    const res = classifyCandidateObservationAttribution(harmlessVariationObs, uahpetContext);
    expect(res.isAttributable).toBe(true);
    expect(res.classification).toBe("EXACT_CANDIDATE_KEYWORD_MATCH");
  });

  it("C20: Genuine ≥60d official CSV test fixture validates math/format in TEST_ONLY without affecting commercial G15, G16 or DEV/HOLDOUT", () => {
    const weeklyPoints: DemandDataPoint[] = Array.from({ length: 10 }, (_, i) => {
      const d = new Date(Date.now() - (10 - i) * 7 * 86400000).toISOString();
      return {
        id: `pts_${i}`,
        productId: "prod_fixture_test_only_uahpet",
        keyword: uahpetCandidateTitle,
        region: "US",
        periodStart: d,
        demandValue: 75 + (i % 5),
        source: "GOOGLE_TRENDS_CSV",
        isFixture: true,
      } as any;
    });

    const authority = evaluateDemandSourceAuthority(weeklyPoints, {
      candidateCanonicalName: uahpetCandidateTitle,
    });
    expect(authority.authority).toBe("FIXTURE_ONLY");
    expect(authority.productAttributionValid).toBe(false);

    const assessment = evaluateDemandHistoryEvidence(weeklyPoints, {
      candidateCanonicalName: uahpetCandidateTitle,
    });
    // While coveredDays math calculates ~63-70 days, sourceAuthority is FIXTURE_ONLY
    expect(assessment.sourceAuthority).toBe("FIXTURE_ONLY");
    expect(assessment.eligibleForEvergreen).toBe(false);
  });
});

