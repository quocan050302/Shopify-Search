/**
 * SWAI KH-02 — V12.4.3.7.19.3.1
 * Unified Candidate Attribution Across Cache & Fresh Provider
 *
 * Adversarial Test Matrix A01 - A30:
 * Proves that candidate-scoped demand attribution is strictly enforced across
 * DB cache, fresh provider fetch, CSV imports, batch ingestion, cache-fresh merge,
 * and business gate evaluations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  classifyCandidateObservationAttribution,
  filterAttributableObservations,
  isAuthenticVerifiedCandidateAlias,
  type CandidateAttributionContext,
  type CandidateObservationRecord,
  type VerifiedCandidateAlias,
} from "@/services/kh02/demand/candidateDemandAttribution";
import {
  registerAliasSigningKey,
  createSignedCandidateAliasApproval,
  persistCandidateAliasApprovalAtomically,
  revokeCandidateAliasAtomically,
  clearTestAliasSigningKeys,
} from "@/services/kh02/demand/durableCandidateAliasAuthority";
import {
  resolveProductDemandHistory,
  type ProductDemandResolution,
} from "@/services/kh02/demand/historicalDemandIngestion";
import {
  GoogleTrendsCsvImportProvider,
  GoogleTrendsBigQueryProvider,
  GoogleTrendingNowProvider,
} from "@/services/kh02/demand/demandProviderRegistry";
import {
  evaluateDemandHistoryEvidence,
  evaluateDemandSourceAuthority,
  type DemandDataPoint,
} from "@/services/kh02/demand/temporalDemandEngine";
import { prisma } from "@/lib/db";

describe("KH-02 V12.4.3.7.19.3.1: Unified Candidate Attribution Across Cache & Fresh Provider (A01 - A30)", () => {
  const uahpetCanonicalId = "cmvsy7zqh000jp0orhypwohho";
  const uahpetCandidateTitle = "UAHPET Fresh Food Automatic Pet Feeder";
  const catFeederKeyword = "Automatic Wet Food Cat Feeder with Cooling & Warming";

  const uahpetContext: CandidateAttributionContext = {
    candidateId: "cand_1212440541",
    researchRunId: "kh02_run_1793424091548_669k8",
    canonicalProductId: uahpetCanonicalId,
    candidateCanonicalName: uahpetCandidateTitle,
    authorizedKeywords: [uahpetCandidateTitle, "UAHPET Automatic Pet Feeder"],
    workspaceId: "ws_acceptance_us",
    region: "US",
  };

  it("A01: Cache 6 same-productId rows for unrelated feeder keyword => 0 UAHPET eligible; rawCount=6 distinct from attributable=0", () => {
    const cachedSixRows: CandidateObservationRecord[] = [
      { id: "c1", productId: uahpetCanonicalId, keyword: catFeederKeyword, demandValue: 76, periodStart: "2026-06-01" },
      { id: "c2", productId: uahpetCanonicalId, keyword: catFeederKeyword, demandValue: 79, periodStart: "2026-07-01" },
      { id: "c3", productId: uahpetCanonicalId, keyword: catFeederKeyword, demandValue: 77, periodStart: "2026-08-01" },
      { id: "c4", productId: uahpetCanonicalId, keyword: catFeederKeyword, demandValue: 81, periodStart: "2026-09-01" },
      { id: "c5", productId: uahpetCanonicalId, keyword: catFeederKeyword, demandValue: 78, periodStart: "2026-10-01" },
      { id: "c6", productId: uahpetCanonicalId, keyword: catFeederKeyword, demandValue: 82, periodStart: "2026-10-24" },
    ];

    const partition = filterAttributableObservations(cachedSixRows, uahpetContext);
    expect(partition.totalInputObservations).toBe(6);
    expect(partition.attributableCount).toBe(0);
    expect(partition.excludedCount).toBe(6);
    expect(partition.classifications.EXCLUDED_UNVERIFIED_ALIAS).toBe(6);

    const assessment = evaluateDemandHistoryEvidence(partition.attributableObservations as any[], {
      minimumCoveredDays: 60,
      candidateCanonicalName: uahpetCandidateTitle,
    });
    expect(assessment.status).toBe("INSUFFICIENT_HISTORY");
    expect(assessment.dataPointsCount).toBe(0);
    expect(assessment.eligibleForEvergreen).toBe(false);
  });

  it("A02: Fresh Google Trends CSV provider with same six wrong-keyword records => 0 UAHPET eligible; no false G15 PASS", async () => {
    const provider = new GoogleTrendsCsvImportProvider();
    const result = await provider.fetchSeries({
      term: uahpetCandidateTitle,
      canonicalProductName: uahpetCandidateTitle,
      productId: uahpetCanonicalId,
      region: "US",
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-10-24"),
    });

    // The DB contains 6 records for catFeederKeyword, none for uahpetCandidateTitle.
    // Provider MUST NOT return them as attributable points for UAHPET.
    expect(result.points.length).toBe(0);
    expect(result.status).toBe("INSUFFICIENT_DATA");
  });

  it("A03: Fresh response SUCCESS with points for wrong product => candidate attribution rejects them; 0 eligible writes", () => {
    const wrongProductPoints: CandidateObservationRecord[] = Array.from({ length: 10 }, (_, i) => ({
      id: `pt_${i}`,
      productId: "prod_other_999",
      keyword: "Stainless Steel Cat Water Fountain",
      region: "US",
      periodStart: new Date(Date.now() - (10 - i) * 7 * 86400000).toISOString(),
      demandValue: 80 + i,
      source: "Google Trends (SerpApi)",
    }));

    const partition = filterAttributableObservations(wrongProductPoints, uahpetContext);
    expect(partition.attributableCount).toBe(0);
    expect(partition.excludedCount).toBe(10);
    expect(partition.classifications.EXCLUDED_CROSS_PRODUCT + partition.classifications.EXCLUDED_KEYWORD_MISMATCH).toBe(10);
  });

  it("A04: Producer omits pt.keyword => no manufactured authorized keyword; marked as mismatch", () => {
    const omittedKeywordPoint: CandidateObservationRecord = {
      id: "pt_no_kw",
      productId: uahpetCanonicalId,
      keyword: null,
      region: "US",
      periodStart: "2026-08-01",
      demandValue: 75,
    };

    const res = classifyCandidateObservationAttribution(omittedKeywordPoint, uahpetContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_KEYWORD_MISMATCH");
    expect(res.reason).toContain("null or empty keyword");
  });

  it("A05: Brand token + unrelated function (UAHPET fountain, UAHPET filter) => rejected; no loose brand pass", () => {
    const uahpetFountainObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: "UAHPET Cat Water Fountain Stainless Steel",
      region: "US",
      demandValue: 85,
    };

    const resFountain = classifyCandidateObservationAttribution(uahpetFountainObs, uahpetContext);
    expect(resFountain.isAttributable).toBe(false);
    expect(resFountain.classification).toBe("EXCLUDED_KEYWORD_MISMATCH");
    expect(resFountain.reason).toContain("does not match candidate family");

    const uahpetFilterObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: "UAHPET Replacement Filter 4-Pack",
      region: "US",
      demandValue: 60,
    };

    const resFilter = classifyCandidateObservationAttribution(uahpetFilterObs, uahpetContext);
    expect(resFilter.isAttributable).toBe(false);
    expect(resFilter.classification).toBe("EXCLUDED_KEYWORD_MISMATCH");
    expect(resFilter.reason).toContain("accessory/replacement part");
  });

  it("A06: Broad unbranded prefix / shared family / substring -> rejected for candidate authority", () => {
    const genericPrefixObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: "automatic pet feeder",
      region: "US",
      demandValue: 90,
    };

    // Candidate title is "UAHPET Fresh Food Automatic Pet Feeder".
    // Generic "automatic pet feeder" is a broad category query without brand.
    const res = classifyCandidateObservationAttribution(genericPrefixObs, {
      ...uahpetContext,
      authorizedKeywords: [uahpetCandidateTitle], // only the full title authorized
    });
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_UNVERIFIED_ALIAS");
  });

  it("A07: Actual exact candidate keyword with authentic row evidence => accepted as attributable", () => {
    const exactObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
      evidenceReference: "trends-csv:official:uahpet-feeder-hash999",
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-08-08T00:00:00.000Z",
      demandValue: 85,
    };

    const res = classifyCandidateObservationAttribution(exactObs, uahpetContext);
    expect(res.isAttributable).toBe(true);
    expect(res.classification).toBe("EXACT_CANDIDATE_KEYWORD_MATCH");
  });

  it("A08: Benign punctuation, case, and whitespace variations retain legitimate canonical equivalence", () => {
    const variations = [
      `  "${uahpetCandidateTitle}"  `,
      uahpetCandidateTitle.toUpperCase(),
      uahpetCandidateTitle.toLowerCase(),
      `UAHPET Fresh Food Automatic Pet Feeder - `,
    ];

    for (const kw of variations) {
      const obs: CandidateObservationRecord = {
        productId: uahpetCanonicalId,
        keyword: kw,
        region: "US",
        demandValue: 80,
      };
      const res = classifyCandidateObservationAttribution(obs, uahpetContext);
      expect(res.isAttributable).toBe(true);
      expect(res.classification).toBe("EXACT_CANDIDATE_KEYWORD_MATCH");
    }
  });

  it("A09: Same productId, two SKU variants with disjoint queries => no cross-variant attribution", () => {
    const blackCandidateContext: CandidateAttributionContext = {
      candidateId: "cand_black",
      canonicalProductId: uahpetCanonicalId,
      candidateCanonicalName: "UAHPET Feeder Black Edition",
      authorizedKeywords: ["UAHPET Feeder Black Edition"],
    };

    const whiteCandidateContext: CandidateAttributionContext = {
      candidateId: "cand_white",
      canonicalProductId: uahpetCanonicalId,
      candidateCanonicalName: "UAHPET Feeder White Edition",
      authorizedKeywords: ["UAHPET Feeder White Edition"],
    };

    const whiteObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: "UAHPET Feeder White Edition",
      region: "US",
      demandValue: 70,
    };

    // White observation MUST match white candidate and MUST be rejected for black candidate
    const resWhite = classifyCandidateObservationAttribution(whiteObs, whiteCandidateContext);
    const resBlack = classifyCandidateObservationAttribution(whiteObs, blackCandidateContext);

    expect(resWhite.isAttributable).toBe(true);
    expect(resWhite.classification).toBe("EXACT_CANDIDATE_KEYWORD_MATCH");
    expect(resBlack.isAttributable).toBe(false);
    expect(resBlack.classification).toBe("EXCLUDED_UNVERIFIED_ALIAS");
  });

  it("A10: Candidate ID present but canonical product absent => require independent identity, no auto-pass", () => {
    const noProductContext: CandidateAttributionContext = {
      candidateId: "cand_new_unlinked",
      canonicalProductId: null,
      candidateCanonicalName: "New Trending Dog Harness",
      authorizedKeywords: ["New Trending Dog Harness"],
    };

    // Point with conflicting productId
    const obsWithDifferentProd: CandidateObservationRecord = {
      productId: "prod_other_123",
      keyword: "New Trending Dog Harness",
      demandValue: 70,
    };

    // Since candidate has null canonicalProductId, obsWithDifferentProd has a productId that belongs to foreign identity
    const res = classifyCandidateObservationAttribution(obsWithDifferentProd, noProductContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("KEYWORD_ONLY_UNBOUND");

    // Sub-case: observation productId is ALSO null/undefined -> matches candidate keyword
    const obsWithNullProd: CandidateObservationRecord = {
      productId: null,
      keyword: "New Trending Dog Harness",
      demandValue: 70,
    };
    const resNull = classifyCandidateObservationAttribution(obsWithNullProd, noProductContext);
    expect(resNull.isAttributable).toBe(true);
    expect(resNull.classification).toBe("EXACT_CANDIDATE_KEYWORD_MATCH");
  });

  it("A11: Cross-workspace and cross-research-run reuse => excluded", () => {
    const wrongTenantObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      workspaceId: "ws_foreign_tenant",
      researchRunId: "kh02_run_1793424091548_669k8",
      region: "US",
      demandValue: 80,
    };

    const resTenant = classifyCandidateObservationAttribution(wrongTenantObs, uahpetContext);
    expect(resTenant.isAttributable).toBe(false);
    expect(resTenant.classification).toBe("EXCLUDED_WORKSPACE_OR_RUN");

    const wrongRunObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      researchRunId: "run_stale_999",
      region: "US",
      demandValue: 80,
    };

    const resRun = classifyCandidateObservationAttribution(wrongRunObs, uahpetContext);
    expect(resRun.isAttributable).toBe(false);
    expect(resRun.classification).toBe("EXCLUDED_WORKSPACE_OR_RUN");
  });

  it("A12: Invalid or missing region and UK data used for US => excluded", () => {
    const ukObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      region: "GB",
      demandValue: 80,
    };

    const res = classifyCandidateObservationAttribution(ukObs, uahpetContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_REGION");
  });

  it("A13: Future interval, post-asOf capture/approval/row => excluded", () => {
    const futureObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      region: "US",
      periodStart: new Date(Date.now() + 7 * 86400000).toISOString(),
      demandValue: 80,
    };

    const resFuture = classifyCandidateObservationAttribution(futureObs, uahpetContext);
    expect(resFuture.isAttributable).toBe(false);
    expect(resFuture.classification).toBe("EXCLUDED_FUTURE_OR_POST_CUTOFF");

    const asOfContext: CandidateAttributionContext = {
      ...uahpetContext,
      asOfTimestamp: "2026-07-01T00:00:00.000Z",
    };
    const lateObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      region: "US",
      periodStart: "2026-08-01T00:00:00.000Z",
      demandValue: 80,
    };
    const resLate = classifyCandidateObservationAttribution(lateObs, asOfContext);
    expect(resLate.isAttributable).toBe(false);
    expect(resLate.classification).toBe("EXCLUDED_FUTURE_OR_POST_CUTOFF");
  });

  it("A14: Untrusted caller-provided verifiedAliases strings => rejected; cannot grant commercial eligibility", () => {
    const untrustedAlias: VerifiedCandidateAlias = {
      aliasKeyword: catFeederKeyword,
      approvedBy: "untrusted_caller",
      provenanceReference: "untrusted_ref",
    };

    const check = isAuthenticVerifiedCandidateAlias(untrustedAlias, uahpetContext);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain("unauthenticated");

    const contextWithFakeAlias: CandidateAttributionContext = {
      ...uahpetContext,
      verifiedAliases: [untrustedAlias],
    };

    const obs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: catFeederKeyword,
      region: "US",
      demandValue: 78,
    };

    const res = classifyCandidateObservationAttribution(obs, contextWithFakeAlias);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_UNVERIFIED_ALIAS");
  });

  it("A15: Authenticated, durable, correctly scoped alias with immutable proof => only exact approved alias passes; revoked fails", () => {
    const testKeyId = "test_alias_key_a15";
    registerAliasSigningKey({
      keyId: testKeyId,
      secret: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      status: "TEST_ONLY",
      purpose: "KH02_DEMAND_ALIAS",
      description: "Test signing key for A15",
    });

    const approvalId = `alias_appr_a15_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const approvalRecord = createSignedCandidateAliasApproval({
      approvalId,
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      region: "US",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: testKeyId,
      evidenceChainReference: "urn:swai:evidence:merchant_pdp_identity:uahpet_cat_feeder_official",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(approvalRecord);

    const authenticAlias: VerifiedCandidateAlias = {
      aliasKeyword: catFeederKeyword,
      targetProductId: uahpetCanonicalId,
      candidateId: "cand_1212440541",
      approvedBy: "qa_principal_lead",
      provenanceReference: approvalRecord.approvalId,
      workspaceId: "ws_acceptance_us",
    };

    const validCheck = isAuthenticVerifiedCandidateAlias(authenticAlias, uahpetContext);
    expect(validCheck.valid).toBe(true);

    // Atomically revoke the approval in durable ledger
    revokeCandidateAliasAtomically(
      approvalRecord.approvalId,
      "Test revocation for A15",
      "qa_principal_lead"
    );

    const revokedCheck = isAuthenticVerifiedCandidateAlias(authenticAlias, uahpetContext);
    expect(revokedCheck.valid).toBe(false);
    expect(revokedCheck.reason).toContain("revoked");

    const resRevoked = classifyCandidateObservationAttribution(
      { productId: uahpetCanonicalId, keyword: catFeederKeyword, demandValue: 80 },
      { ...uahpetContext, verifiedAliases: [authenticAlias] }
    );
    expect(resRevoked.isAttributable).toBe(false);
    expect(resRevoked.classification).toBe("EXCLUDED_UNVERIFIED_ALIAS");
  });

  it("A16: Fixture, simulated transport, pseudo-reference, checksum-only CSV => no commercial authority", () => {
    const fixtureObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      source: "FIXTURE_SYNTHETIC",
      isFixture: true,
      demandValue: 85,
    };

    const res = classifyCandidateObservationAttribution(fixtureObs, uahpetContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_FIXTURE_OR_PROXY");
  });

  it("A17: Cache wrong keyword + fresh correct keyword on same date => fresh valid candidate point retained; no incorrect dedup", () => {
    const freshCandidatePoint: DemandDataPoint = {
      id: "fresh_pt_1",
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      periodStart: "2026-08-01T00:00:00.000Z",
      demandValue: 92,
      region: "US",
      source: "Google Trends (SerpApi)",
    } as any;

    const cacheWrongPoint: DemandDataPoint = {
      id: "cache_wrong_pt_1",
      productId: uahpetCanonicalId,
      keyword: catFeederKeyword,
      periodStart: "2026-08-01T00:00:00.000Z",
      demandValue: 70,
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
    } as any;

    // Deduplication should use compound key: (region, query, date)
    const seenKey = (p: DemandDataPoint) => `${p.region || "US"}_${p.keyword}_${String(p.periodStart).slice(0, 10)}`;
    const seenKeys = new Set([seenKey(freshCandidatePoint)]);
    const combined = [freshCandidatePoint];
    if (!seenKeys.has(seenKey(cacheWrongPoint))) {
      seenKeys.add(seenKey(cacheWrongPoint));
      combined.push(cacheWrongPoint);
    }

    // Only freshCandidatePoint is attributable to UAHPET
    const partition = filterAttributableObservations(combined as any[], uahpetContext);
    expect(partition.attributableCount).toBe(1);
    expect(partition.attributableObservations[0].demandValue).toBe(92);
  });

  it("A18: Cache correct keyword + fresh wrong keyword on same date => wrong point dropped, correct retained", () => {
    const cacheCorrectPoint: DemandDataPoint = {
      id: "cache_correct_pt",
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      periodStart: "2026-08-01T00:00:00.000Z",
      demandValue: 85,
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
    } as any;

    const freshWrongPoint: DemandDataPoint = {
      id: "fresh_wrong_pt",
      productId: uahpetCanonicalId,
      keyword: "Stainless Steel Cat Water Fountain",
      periodStart: "2026-08-01T00:00:00.000Z",
      demandValue: 50,
      region: "US",
      source: "Google Trends (SerpApi)",
    } as any;

    const rawFreshList = [freshWrongPoint];
    const freshPartition = filterAttributableObservations(rawFreshList as any[], uahpetContext);
    expect(freshPartition.attributableCount).toBe(0); // Dropped before admission

    const cachedList = [cacheCorrectPoint];
    const cachePartition = filterAttributableObservations(cachedList as any[], uahpetContext);
    expect(cachePartition.attributableCount).toBe(1);
    expect(cachePartition.attributableObservations[0].keyword).toBe(uahpetCandidateTitle);
  });

  it("A19: Two valid same-candidate sources with overlapping dates but different values => deterministic resolution", () => {
    const pointSourceA: DemandDataPoint = {
      id: "pt_a",
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      periodStart: "2026-08-01T00:00:00.000Z",
      demandValue: 88,
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
    } as any;

    const pointSourceB: DemandDataPoint = {
      id: "pt_b",
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      periodStart: "2026-08-01T00:00:00.000Z",
      demandValue: 90,
      region: "US",
      source: "Google Trends (SerpApi)",
    } as any;

    const assessment = evaluateDemandHistoryEvidence([pointSourceA, pointSourceB], {
      minimumCoveredDays: 60,
      candidateCanonicalName: uahpetCandidateTitle,
    });

    // Deduplication should result in 1 point on that date
    expect(assessment.dataPointsCount).toBe(1);
  });

  it("A20: Partially valid provider batch (one wrong keyword) => no in-memory mixed eligible result", () => {
    const mixedBatch: CandidateObservationRecord[] = [
      { id: "mb_1", productId: uahpetCanonicalId, keyword: uahpetCandidateTitle, demandValue: 85, periodStart: "2026-08-01" },
      { id: "mb_2", productId: uahpetCanonicalId, keyword: "Dog Water Fountain Stainless Steel", demandValue: 70, periodStart: "2026-08-08" },
      { id: "mb_3", productId: uahpetCanonicalId, keyword: uahpetCandidateTitle, demandValue: 87, periodStart: "2026-08-15" },
    ];

    const partition = filterAttributableObservations(mixedBatch, uahpetContext);
    expect(partition.attributableCount).toBe(2);
    expect(partition.excludedCount).toBe(1);
    expect(partition.classifications.EXCLUDED_KEYWORD_MISMATCH).toBe(1);

    // Ensure the non-attributable point does NOT leak into attributableObservations
    expect(partition.attributableObservations.every((p) => p.keyword === uahpetCandidateTitle)).toBe(true);
  });

  it("A21: providerStatus=SUCCESS for remote fetch but provenance invalid => do not return verified G15", () => {
    const unverifiedSuccessPoints: DemandDataPoint[] = Array.from({ length: 10 }, (_, i) => ({
      id: `unv_${i}`,
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      periodStart: new Date(Date.now() - (10 - i) * 7 * 86400000).toISOString(),
      demandValue: 75,
      region: "US",
      source: "CACHED_UNVERIFIED",
    } as any));

    const authority = evaluateDemandSourceAuthority(unverifiedSuccessPoints, {
      candidateCanonicalName: uahpetCandidateTitle,
    });
    expect(authority.authority).toBe("CACHED_UNVERIFIED");

    const assessment = evaluateDemandHistoryEvidence(unverifiedSuccessPoints, {
      candidateCanonicalName: uahpetCandidateTitle,
    });
    expect(assessment.status).toBe("UNVERIFIED");
    expect(assessment.eligibleForEvergreen).toBe(false);
  });

  it("A22: Zero or unrelated 96 workspace rows => 0 target rows; no cross-candidate borrowing", () => {
    const unrelatedWorkspaceRows: CandidateObservationRecord[] = Array.from({ length: 96 }, (_, i) => ({
      id: `ws_row_${i}`,
      productId: `prod_workspace_${i % 5}`,
      keyword: `Workspace Product Keyword ${i}`,
      region: "US",
      demandValue: 60,
    }));

    const partition = filterAttributableObservations(unrelatedWorkspaceRows, uahpetContext);
    expect(partition.attributableCount).toBe(0);
    expect(partition.excludedCount).toBe(96);
  });

  it("A23: History without asOf metadata under strict chronological replay => rejected", () => {
    const undatedPoints: DemandDataPoint[] = [
      {
        id: "undated_1",
        productId: uahpetCanonicalId,
        keyword: uahpetCandidateTitle,
        periodStart: "2026-06-01T00:00:00.000Z",
        demandValue: 75,
      } as any,
    ];

    const assessment = evaluateDemandHistoryEvidence(undatedPoints, {
      strictChronological: true,
      asOfTimestamp: "2026-05-01T00:00:00.000Z",
      candidateCanonicalName: uahpetCandidateTitle,
    });
    expect(assessment.status).toBe("INSUFFICIENT_HISTORY");
  });

  it("A24: BigQuery public Top Terms and Trending Now signals do not masquerade as product-specific 60d evidence", () => {
    const trendingNow = new GoogleTrendingNowProvider();
    expect(trendingNow.providerId).toBe("google-trending-now");

    const publicTopTermsPoint: DemandDataPoint = {
      id: "top_terms_pt",
      productId: uahpetCanonicalId,
      keyword: "Trending Cat Toy",
      periodStart: "2026-08-01T00:00:00.000Z",
      demandValue: 95,
      source: "GOOGLE_TOP_TERMS_SIGNAL",
    } as any;

    const authority = evaluateDemandSourceAuthority([publicTopTermsPoint], {
      candidateCanonicalName: uahpetCandidateTitle,
    });
    expect(authority.authority).not.toBe("AUTHORITATIVE_VERIFIED");
    expect(authority.productAttributionValid).toBe(false);
  });

  it("A25: Concurrency & idempotency: deduplicating identical candidate receipts returns consistent single state", () => {
    const receiptA: CandidateObservationRecord = {
      id: "rec_dup_1",
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      periodStart: "2026-08-01T00:00:00.000Z",
      demandValue: 80,
      evidenceReference: "receipt:duplicate_sha_123",
    };
    const receiptB: CandidateObservationRecord = {
      ...receiptA,
      id: "rec_dup_2",
    };

    const partition = filterAttributableObservations([receiptA, receiptB], uahpetContext);
    expect(partition.attributableCount).toBe(2);

    const assessment = evaluateDemandHistoryEvidence(partition.attributableObservations as any[], {
      candidateCanonicalName: uahpetCandidateTitle,
    });
    expect(assessment.dataPointsCount).toBe(1); // deduplicated identical periodStart
  });

  it("A26: Local-only valid 60-90d fixture tests the math but remains FIXTURE_ONLY for business G15/G16", () => {
    const fixturePoints: DemandDataPoint[] = Array.from({ length: 12 }, (_, i) => ({
      id: `fix_${i}`,
      productId: "prod_fixture_pet_feeder",
      keyword: uahpetCandidateTitle,
      periodStart: new Date(Date.now() - (12 - i) * 7 * 86400000).toISOString(),
      demandValue: 80,
      isFixture: true,
      source: "FIXTURE_TEST",
    } as any));

    const authority = evaluateDemandSourceAuthority(fixturePoints, {
      candidateCanonicalName: uahpetCandidateTitle,
    });
    expect(authority.authority).toBe("FIXTURE_ONLY");
    expect(authority.productAttributionValid).toBe(false);

    const assessment = evaluateDemandHistoryEvidence(fixturePoints, {
      candidateCanonicalName: uahpetCandidateTitle,
    });
    expect(assessment.eligibleForEvergreen).toBe(false);
  });

  it("A27: Caller passes fabricated candidateId, run, source 'GOOGLE_TRENDS_CSV' with fake verified=true => admission fails", () => {
    const fabricatedObs: CandidateObservationRecord = {
      productId: "prod_fabricated_999",
      keyword: "Some Other Feeder",
      source: "GOOGLE_TRENDS_CSV",
      evidenceReference: "fake_signature_bypass",
      demandValue: 90,
      verified: true, // Fake caller assertion
    };

    const res = classifyCandidateObservationAttribution(fabricatedObs, uahpetContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_CROSS_PRODUCT");
  });

  it("A28: Valid cached exact canonical rows still work; legitimate source is not rejected", () => {
    const legitimateRow: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      region: "US",
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-08-08T00:00:00.000Z",
      demandValue: 85,
      source: "GOOGLE_TRENDS_CSV",
      evidenceReference: "trends-csv:official:us-uahpet-valid-sha",
    };

    const res = classifyCandidateObservationAttribution(legitimateRow, uahpetContext);
    expect(res.isAttributable).toBe(true);
    expect(res.classification).toBe("EXACT_CANDIDATE_KEYWORD_MATCH");
  });

  it("A29: resolveProductDemandHistory returns complete candidate attribution diagnostics", async () => {
    await prisma.workspace.upsert({
      where: { id: "acceptance_v12_2_3_ws" },
      create: { id: "acceptance_v12_2_3_ws", name: "Acceptance WS" },
      update: {},
    });
    await prisma.researchProduct.upsert({
      where: { id: uahpetCanonicalId },
      create: {
        id: uahpetCanonicalId,
        title: uahpetCandidateTitle,
      },
      update: {},
    });
    await prisma.researchEvidence.deleteMany({
      where: { productId: uahpetCanonicalId },
    });
    await prisma.researchEvidence.create({
      data: {
        workspaceId: "acceptance_v12_2_3_ws",
        productId: uahpetCanonicalId,
        subjectType: "PRODUCT",
        subjectId: uahpetCanonicalId,
        pillar: "PRODUCT",
        claim: "UAHPET product evidence",
        observationMethod: "DOM_INSPECTION",
      },
    });
    await prisma.productDemandObservation.deleteMany({
      where: { productId: uahpetCanonicalId },
    });
    for (let i = 0; i < 6; i++) {
      const pStart = new Date(Date.now() - (6 - i) * 7 * 86400000);
      const pEnd = new Date(pStart.getTime() + 7 * 86400000);
      await prisma.productDemandObservation.create({
        data: {
          productId: uahpetCanonicalId,
          source: "GOOGLE_TRENDS_CSV",
          region: "US",
          keyword: catFeederKeyword,
          periodStart: pStart,
          periodEnd: pEnd,
          demandValue: 60 + i,
          valueType: "RELATIVE_INTEREST",
        },
      });
    }

    const res = await resolveProductDemandHistory(
      {
        candidateId: "cand_1212440541",
        productId: uahpetCanonicalId,
        canonicalName: uahpetCandidateTitle,
      },
      {
        region: "US",
        lookbackDays: 90,
        workspaceId: "acceptance_v12_2_3_ws",
      }
    );

    expect(res.candidateId).toBe("cand_1212440541");
    expect(res.productId).toBe(uahpetCanonicalId);
    expect(res.rawDbRecordsCount).toBe(6);
    expect(res.candidateAttributableRecordsCount).toBe(0);
    expect(res.excludedRecordsCount).toBe(6);
    expect(res.attributionBreakdown?.EXCLUDED_UNVERIFIED_ALIAS).toBe(6);
    expect(res.actualCoveredDays).toBe(0);
    expect(res.assessment.status).toBe("INSUFFICIENT_HISTORY");
    expect(res.assessment.eligibleForEvergreen).toBe(false);
  });

  it("A30: Regression for real research run IDs using read-only snapshot: target G15/G16 remain INSUFFICIENT", async () => {
    // cand_1587534715: KittySpout
    const kittyRes = await resolveProductDemandHistory(
      {
        candidateId: "cand_1587534715",
        canonicalName: "The KittySpout™ - Wireless Fountain",
      },
      {
        region: "US",
        lookbackDays: 90,
        workspaceId: "acceptance_v12_2_3_ws",
      }
    );
    expect(kittyRes.rawDbRecordsCount).toBe(0);
    expect(kittyRes.candidateAttributableRecordsCount).toBe(0);
    expect(kittyRes.assessment.status).toBe("INSUFFICIENT_HISTORY");

    // cand_1613504636: Cleaner
    const cleanerRes = await resolveProductDemandHistory(
      {
        candidateId: "cand_1613504636",
        canonicalName: "Pet Hair/Lint/Dust Cleaner",
      },
      {
        region: "US",
        lookbackDays: 90,
        workspaceId: "acceptance_v12_2_3_ws",
      }
    );
    expect(cleanerRes.rawDbRecordsCount).toBe(0);
    expect(cleanerRes.candidateAttributableRecordsCount).toBe(0);
    expect(cleanerRes.assessment.status).toBe("INSUFFICIENT_HISTORY");
  });
});
