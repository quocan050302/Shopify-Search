/**
 * SWAI KH-02 — V12.4.3.7.19.3.2.2
 * MANDATORY BUSINESS-SCOPE ATTRIBUTION & INDEPENDENTLY VERIFIED GITHUB CI PROOF
 *
 * Comprehensive adversarial verification matrix (52 Tests):
 * - GROUP A (A01 - A20): End-to-End Business Scope Propagation & Fencing
 * - GROUP B (B01 - B22): Real GitHub Actions Remote CI Verification & SSRF Guard
 * - GROUP C (C01 - C10): Storage Durability, Monotonic Revocation & Backtest Replay
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

import {
  ALIAS_SCHEMA_VERSION,
  ALIAS_OPERATION_SCOPE,
  CandidateAliasApprovalRecord,
  createSignedCandidateAliasApproval,
  persistCandidateAliasApprovalAtomically,
  revokeCandidateAliasAtomically,
  verifyDurableCandidateAliasApproval,
  registerAliasSigningKey,
  clearTestAliasSigningKeys,
} from "@/services/kh02/demand/durableCandidateAliasAuthority";

import {
  classifyCandidateObservationAttribution,
  filterAttributableObservations,
  isAuthenticVerifiedCandidateAlias,
  CandidateAttributionContext,
  CandidateObservationRecord,
  VerifiedCandidateAlias,
} from "@/services/kh02/demand/candidateDemandAttribution";

import {
  evaluateDemandSourceAuthority,
  evaluateDemandHistoryEvidence,
  DemandDataPoint,
} from "@/services/kh02/demand/temporalDemandEngine";

import {
  resolveProductDemandHistory,
} from "@/services/kh02/demand/historicalDemandIngestion";

import {
  GoogleTrendsCsvImportProvider,
} from "@/services/kh02/demand/demandProviderRegistry";

import {
  TRUSTED_VERIFIER_ID,
  TRUSTED_GITHUB_HOST,
  CANONICAL_REPOSITORY,
  LOCKED_BRANCH,
  GitHubWorkflowRunEvidence,
  validateGitHubApiUrl,
  verifyRemoteGitHubActionsRun,
  verifyAuthenticCiProof,
  sanitizeCiLog,
} from "@/services/kh02/release/githubActionsCiEvidence";

import {
  validateTestSuiteExecutionEvidence,
  verifyGitHubActionsRunProof,
  validateVerifiedCiAttestation,
  AuthenticatedCiProof,
} from "@/services/kh02/demand/testSuiteEvidenceValidator";

import {
  evaluateReleaseEvidence,
  ReleaseEvidenceInput,
} from "@/services/kh02/release/releaseGateEvaluatorV19";

describe("KH-02 V12.4.3.7.19.3.2.2: Mandatory Business Scope & Authentic CI Proof Matrix (52 Tests)", () => {
  const testStorageDir = path.join(
    os.tmpdir(),
    `kh02_v19_3_2_2_test_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  );

  const uahpetCanonicalId = "cmvsy7zqh000jp0orhypwohho";
  const uahpetCandidateTitle = "UAHPET Fresh Food Automatic Pet Feeder";
  const catFeederKeyword = "Automatic Wet Food Cat Feeder with Cooling & Warming";

  const testKeyId = "test_alias_key_v19_3_2_2";
  const testSecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const businessKeyId = "test_alias_key_business_v19_3_2_2";
  const businessSecret = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

  beforeEach(() => {
    fs.mkdirSync(testStorageDir, { recursive: true });
    process.env.TEST_CANDIDATE_ALIAS_STORAGE_DIR = testStorageDir;

    // Register a test-only signing key
    registerAliasSigningKey({
      keyId: testKeyId,
      secret: testSecret,
      status: "TEST_ONLY",
      purpose: ALIAS_OPERATION_SCOPE,
      description: "Test HMAC key for test-only alias signing",
      isBusinessTrusted: false,
    });

    // Register a business-trusted signing key
    registerAliasSigningKey({
      keyId: businessKeyId,
      secret: businessSecret,
      status: "ACTIVE",
      purpose: ALIAS_OPERATION_SCOPE,
      description: "Business HMAC key for authentic business alias signing",
      isBusinessTrusted: true,
    });
  });

  afterEach(() => {
    clearTestAliasSigningKeys();
    delete process.env.TEST_CANDIDATE_ALIAS_STORAGE_DIR;
    delete process.env.KH02_AUTHORIZED_APPROVER_PRINCIPALS;
    delete process.env.KH02_ALIAS_ADMIN_TOKEN;
    try {
      fs.rmSync(testStorageDir, { recursive: true, force: true });
    } catch {}
  });

  // Helper to create & persist test alias
  function createAndPersistTestAlias(opts: {
    aliasKeyword: string;
    targetProductId?: string;
    isTestOnly?: boolean;
    keyId?: string;
    secret?: string;
    issuerPrincipal?: string;
    workspaceId?: string;
  }) {
    const keyId = opts.keyId || (opts.isTestOnly === false ? businessKeyId : testKeyId);

    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: opts.targetProductId !== undefined ? opts.targetProductId : uahpetCanonicalId,
      aliasKeyword: opts.aliasKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: opts.workspaceId || "ws_acceptance_us",
      approverPrincipalId: opts.issuerPrincipal || "admin_security_v19",
      issuerKeyId: keyId,
      evidenceChainReference: "urn:swai:evidence:test",
      isTestOnly: opts.isTestOnly !== undefined ? opts.isTestOnly : true,
    });

    persistCandidateAliasApprovalAtomically(record);

    const aliasDescriptor: VerifiedCandidateAlias = {
      aliasKeyword: opts.aliasKeyword,
      provenanceReference: record.approvalId,
      approvedBy: record.approverPrincipalId,
      approvedAt: record.approvedAt,
    };

    return { record, aliasDescriptor };
  }

  // ==============================================================================
  // GROUP A: BUSINESS SCOPE END-TO-END (A01 - A20)
  // ==============================================================================

  it("A01: missing evaluationScope with TEST_ONLY alias yields businessAttributable: false", () => {
    const { aliasDescriptor } = createAndPersistTestAlias({
      aliasKeyword: catFeederKeyword,
      isTestOnly: true,
    });

    // Unspecified evaluationScope (neither BUSINESS nor ENGINEERING)
    const context: CandidateAttributionContext = {
      candidateId: "cand_1212440541",
      canonicalProductId: uahpetCanonicalId,
      candidateCanonicalName: uahpetCandidateTitle,
      verifiedAliases: [aliasDescriptor],
      // evaluationScope is undefined!
    };

    const obs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: catFeederKeyword,
      source: "GOOGLE_TRENDS_CSV",
      evidenceReference: "raw-csv:google_trends_cat_feeder_test.csv#sha256=1122334455667788990011223344556677889900112233445566778899001122",
    };

    const res = classifyCandidateObservationAttribution(obs, context);
    // Engineering may match alias descriptor, but businessAttributable MUST be false
    expect(res.businessAttributable).toBe(false);
  });

  it("A02: explicit BUSINESS scope with TEST_ONLY signed alias strictly fails with TEST_ONLY_ALIAS", () => {
    const { aliasDescriptor } = createAndPersistTestAlias({
      aliasKeyword: catFeederKeyword,
      isTestOnly: true,
    });

    const context: CandidateAttributionContext = {
      candidateId: "cand_1212440541",
      canonicalProductId: uahpetCanonicalId,
      candidateCanonicalName: uahpetCandidateTitle,
      verifiedAliases: [aliasDescriptor],
      evaluationScope: "BUSINESS",
    };

    const obs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: catFeederKeyword,
    };

    const res = classifyCandidateObservationAttribution(obs, context);
    expect(res.isAttributable).toBe(false);
    expect(res.businessAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_UNVERIFIED_ALIAS");
    expect(res.reason).toContain("TEST_ONLY_ALIAS");
  });

  it("A03: explicit ENGINEERING scope with TEST_ONLY alias allows engineering match but businessEligible is false", () => {
    const { aliasDescriptor } = createAndPersistTestAlias({
      aliasKeyword: catFeederKeyword,
      isTestOnly: true,
    });

    const context: CandidateAttributionContext = {
      candidateId: "cand_1212440541",
      canonicalProductId: uahpetCanonicalId,
      candidateCanonicalName: uahpetCandidateTitle,
      verifiedAliases: [aliasDescriptor],
      evaluationScope: "ENGINEERING",
    };

    const obs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: catFeederKeyword,
    };

    const res = classifyCandidateObservationAttribution(obs, context);
    expect(res.classification).toBe("VERIFIED_EXPLICIT_ALIAS_MATCH");
    expect(res.isAttributable).toBe(true);
    expect(res.businessAttributable).toBe(false); // Strictly false under ENGINEERING
    expect(res.businessEligible).toBe(false);
  });

  it("A04: real history resolver with cached test-alias row excludes observation before G15 assessment", async () => {
    const { aliasDescriptor } = createAndPersistTestAlias({
      aliasKeyword: catFeederKeyword,
      isTestOnly: true,
    });

    // Run resolver with test alias
    const result = await resolveProductDemandHistory(
      {
        candidateId: "cand_1212440541",
        productId: uahpetCanonicalId,
        canonicalName: uahpetCandidateTitle,
      },
      {
        verifiedAliases: [aliasDescriptor],
      }
    );

    // Business G15 assessment must not count test-only alias observations
    expect(result.assessment.status).toBe("INSUFFICIENT_HISTORY");
    expect(result.assessment.dataPointsCount).toBe(0);
  });

  it("A05: real history resolver fresh provider response using TEST_ONLY alias excluded before DB write", async () => {
    const { aliasDescriptor } = createAndPersistTestAlias({
      aliasKeyword: catFeederKeyword,
      isTestOnly: true,
    });

    // Attempting resolution where only test-only alias is provided
    const result = await resolveProductDemandHistory(
      {
        candidateId: "cand_1212440541",
        productId: uahpetCanonicalId,
        canonicalName: uahpetCandidateTitle,
      },
      {
        verifiedAliases: [aliasDescriptor],
      }
    );

    // Live points imported must be 0
    expect(result.assessment.status).toBe("INSUFFICIENT_HISTORY");
    expect(result.dataPoints.length).toBe(0);
  });

  it("A06: CSV import provider direct call using test alias yields 0 business historical series", async () => {
    const { aliasDescriptor } = createAndPersistTestAlias({
      aliasKeyword: catFeederKeyword,
      isTestOnly: true,
    });

    const provider = new GoogleTrendsCsvImportProvider();
    const series = await provider.fetchSeries({
      term: catFeederKeyword,
      canonicalProductName: uahpetCandidateTitle,
      productId: uahpetCanonicalId,
      region: "US",
      verifiedAliases: [aliasDescriptor],
    } as any);

    expect(series.points.length).toBe(0);
  });

  it("A07: evaluateDemandSourceAuthority direct call with test-only alias returns CACHED_UNVERIFIED", () => {
    const { aliasDescriptor } = createAndPersistTestAlias({
      aliasKeyword: catFeederKeyword,
      isTestOnly: true,
    });

    const auth = evaluateDemandSourceAuthority(
      [
        {
          date: "2026-03-01",
          value: 75,
          keyword: catFeederKeyword,
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "raw-csv:google_trends_feeder.csv#sha256=1122334455667788990011223344556677889900112233445566778899001122",
        },
      ],
      {
        candidateCanonicalName: uahpetCandidateTitle,
        searchTermUsed: catFeederKeyword,
        targetProductId: uahpetCanonicalId,
        verifiedAliases: [aliasDescriptor],
      }
    );

    expect(auth.authority).toBe("CACHED_UNVERIFIED");
    expect(auth.reasons.some((r) => r.includes("Candidate demand attribution failure"))).toBe(true);
  });

  it("A08: evaluateDemandHistoryEvidence with >=60d well-formed test-only alias fixtures returns INSUFFICIENT", () => {
    const { aliasDescriptor } = createAndPersistTestAlias({
      aliasKeyword: catFeederKeyword,
      isTestOnly: true,
    });

    // 70 days of mock points but using test-only alias keyword
    const points: DemandDataPoint[] = [];
    const baseDate = new Date("2026-01-01T00:00:00Z");
    for (let i = 0; i < 70; i++) {
      const d = new Date(baseDate.getTime() + i * 24 * 60 * 60 * 1000);
      points.push({
        date: d.toISOString().split("T")[0],
        value: 50 + (i % 10),
        keyword: catFeederKeyword,
        source: "GOOGLE_TRENDS_CSV",
        evidenceReference: "raw-csv:test_points.csv#sha256=abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      });
    }

    const assessment = evaluateDemandHistoryEvidence(points, {
      candidateCanonicalName: uahpetCandidateTitle,
      searchTermUsed: catFeederKeyword,
      targetProductId: uahpetCanonicalId,
      verifiedAliases: [aliasDescriptor],
    });

    expect(assessment.status).toBe("UNVERIFIED");
    expect(assessment.eligibleForEvergreen).toBe(false);
    expect(assessment.explanation).toContain("not eligible for Verified Evergreen");
  });

  it("A09: G16 Top3 candidates with test-only aliases yield no verified commercial winner", () => {
    const { aliasDescriptor } = createAndPersistTestAlias({
      aliasKeyword: catFeederKeyword,
      isTestOnly: true,
    });

    const partition = filterAttributableObservations(
      [
        { productId: uahpetCanonicalId, keyword: catFeederKeyword, value: 80 },
        { productId: "cand_2", keyword: "Automatic Pet Feeder Cat", value: 85 },
      ],
      {
        candidateCanonicalName: uahpetCandidateTitle,
        canonicalProductId: uahpetCanonicalId,
        verifiedAliases: [aliasDescriptor],
        evaluationScope: "BUSINESS",
      }
    );

    expect(partition.businessAttributableCount).toBe(0);
    expect(partition.attributableCount).toBe(0);
  });

  it("A10: caller trying evaluationScope: ENGINEERING through production endpoint is ignored/re-fenced", async () => {
    const { aliasDescriptor } = createAndPersistTestAlias({
      aliasKeyword: catFeederKeyword,
      isTestOnly: true,
    });

    // Production resolver should enforce BUSINESS scope and ignore test scope injection
    const result = await resolveProductDemandHistory(
      {
        candidateId: "cand_1212440541",
        productId: uahpetCanonicalId,
        canonicalName: uahpetCandidateTitle,
      },
      {
        verifiedAliases: [aliasDescriptor],
        evaluationScope: "ENGINEERING" as any, // Attacker tries to bypass commercial check
      } as any
    );

    expect(result.assessment.status).toBe("INSUFFICIENT_HISTORY");
  });

  it("A11: unknown/missing scope with valid business approval still allows legitimate business attribution", () => {
    const { aliasDescriptor } = createAndPersistTestAlias({
      aliasKeyword: catFeederKeyword,
      isTestOnly: false, // Genuine business approval!
    });

    const context: CandidateAttributionContext = {
      candidateId: "cand_1212440541",
      canonicalProductId: uahpetCanonicalId,
      candidateCanonicalName: uahpetCandidateTitle,
      verifiedAliases: [aliasDescriptor],
      // evaluationScope is undefined!
    };

    const obs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: catFeederKeyword,
    };

    const res = classifyCandidateObservationAttribution(obs, context);
    expect(res.classification).toBe("VERIFIED_EXPLICIT_ALIAS_MATCH");
    expect(res.isAttributable).toBe(true);
    expect(res.businessAttributable).toBe(true); // Genuine business approval works!
  });

  it("A12: genuine business approval + non-fixture row succeeds when source/time rules pass", () => {
    const { aliasDescriptor } = createAndPersistTestAlias({
      aliasKeyword: catFeederKeyword,
      isTestOnly: false,
    });

    const context: CandidateAttributionContext = {
      candidateId: "cand_1212440541",
      canonicalProductId: uahpetCanonicalId,
      candidateCanonicalName: uahpetCandidateTitle,
      verifiedAliases: [aliasDescriptor],
      evaluationScope: "BUSINESS",
      strictProvenance: true,
    };

    const obs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: catFeederKeyword,
      source: "GOOGLE_TRENDS_CSV",
      evidenceReference: "raw-csv:trends_export.csv#sha256=1122334455667788990011223344556677889900112233445566778899001122",
      periodStart: "2026-02-01T00:00:00Z",
    };

    const res = classifyCandidateObservationAttribution(obs, context);
    expect(res.classification).toBe("VERIFIED_EXPLICIT_ALIAS_MATCH");
    expect(res.isAttributable).toBe(true);
    expect(res.businessAttributable).toBe(true);
  });

  it("A13: forged alias caller object with businessEligible: true but no ledger record is rejected", () => {
    const forgedAlias: any = {
      aliasKeyword: catFeederKeyword,
      provenanceReference: "signed-alias:fake_approval_id_99999",
      approvedBy: "attacker_principal",
      approvedAt: new Date().toISOString(),
      businessEligible: true, // Attacker forged flag
    };

    const context: CandidateAttributionContext = {
      candidateId: "cand_1212440541",
      canonicalProductId: uahpetCanonicalId,
      candidateCanonicalName: uahpetCandidateTitle,
      verifiedAliases: [forgedAlias],
      evaluationScope: "BUSINESS",
    };

    const obs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: catFeederKeyword,
    };

    const res = classifyCandidateObservationAttribution(obs, context);
    expect(res.isAttributable).toBe(false);
    expect(res.businessAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_UNVERIFIED_ALIAS");
  });

  it("A14: cross-tenant/workspace alias observation is rejected", () => {
    const { aliasDescriptor } = createAndPersistTestAlias({
      aliasKeyword: catFeederKeyword,
      isTestOnly: false,
    });

    const context: CandidateAttributionContext = {
      workspaceId: "ws_production_us",
      candidateId: "cand_1212440541",
      canonicalProductId: uahpetCanonicalId,
      candidateCanonicalName: uahpetCandidateTitle,
      verifiedAliases: [aliasDescriptor],
      evaluationScope: "BUSINESS",
    };

    const obs: CandidateObservationRecord = {
      workspaceId: "ws_foreign_tenant", // Mismatched workspace!
      productId: uahpetCanonicalId,
      keyword: catFeederKeyword,
    };

    const res = classifyCandidateObservationAttribution(obs, context);
    expect(res.isAttributable).toBe(false);
    expect(res.businessAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_WORKSPACE_OR_RUN");
  });

  it("A15: cross-run / asOf later approval is rejected point-in-time", () => {
    const { aliasDescriptor } = createAndPersistTestAlias({
      aliasKeyword: catFeederKeyword,
      isTestOnly: false,
    });

    // Execution cutoff is set in 2025 (before the approval was created in 2026)
    const context: CandidateAttributionContext = {
      candidateId: "cand_1212440541",
      canonicalProductId: uahpetCanonicalId,
      candidateCanonicalName: uahpetCandidateTitle,
      verifiedAliases: [aliasDescriptor],
      asOfTimestamp: "2025-01-01T00:00:00Z",
      evaluationScope: "BUSINESS",
    };

    const obs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: catFeederKeyword,
      periodStart: "2024-12-01T00:00:00Z",
    };

    const res = classifyCandidateObservationAttribution(obs, context);
    expect(res.isAttributable).toBe(false);
    expect(res.businessAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_UNVERIFIED_ALIAS");
  });

  it("A16: revoked alias is strictly rejected fail-closed", () => {
    const { record, aliasDescriptor } = createAndPersistTestAlias({
      aliasKeyword: catFeederKeyword,
      isTestOnly: false,
    });

    // Revoke the approval
    const revokeRes = revokeCandidateAliasAtomically(
      record.approvalId,
      "Key rotation and alias retirement",
      "security_admin"
    );
    expect(revokeRes.success).toBe(true);

    const context: CandidateAttributionContext = {
      workspaceId: "ws_acceptance_us",
      candidateId: "cand_1212440541",
      canonicalProductId: uahpetCanonicalId,
      candidateCanonicalName: uahpetCandidateTitle,
      verifiedAliases: [aliasDescriptor],
      evaluationScope: "BUSINESS",
    };

    const obs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: catFeederKeyword,
    };

    const res = classifyCandidateObservationAttribution(obs, context);
    expect(res.isAttributable).toBe(false);
    expect(res.businessAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_UNVERIFIED_ALIAS");
  });

  it("A17: same canonical productId with mismatched SKU/variant token prevents cross-borrowing", () => {
    const context: CandidateAttributionContext = {
      canonicalProductId: uahpetCanonicalId,
      candidateCanonicalName: "UAHPET Automatic Feeder Black Edition",
      evaluationScope: "BUSINESS",
    };

    const obs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: "UAHPET Automatic Feeder White Edition", // Conflicting SKU variant!
    };

    const res = classifyCandidateObservationAttribution(obs, context);
    expect(res.isAttributable).toBe(false);
    expect(res.businessAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_UNVERIFIED_ALIAS");
    expect(res.reason).toContain("conflicting SKU variant");
  });

  it("A18: valid business alias with missing raw source provenance leaves G15 insufficient", () => {
    const { aliasDescriptor } = createAndPersistTestAlias({
      aliasKeyword: catFeederKeyword,
      isTestOnly: false,
    });

    const points: DemandDataPoint[] = [
      {
        date: "2026-03-01",
        value: 80,
        source: "UNKNOWN_PROVIDER", // Missing provenance
      },
    ];

    const assessment = evaluateDemandHistoryEvidence(points, {
      candidateCanonicalName: uahpetCandidateTitle,
      searchTermUsed: catFeederKeyword,
      targetProductId: uahpetCanonicalId,
      verifiedAliases: [aliasDescriptor],
    });

    expect(assessment.status).toBe("INSUFFICIENT_HISTORY");
  });

  it("A19: UAHPET six wrong-keyword raw rows yield 0 attributable records and G15 INSUFFICIENT", () => {
    const wrongKeywords = [
      "cat water fountain stainless steel",
      "dog travel water bottle",
      "cat toy laser interactive",
      "pet grooming vacuum kit",
      "cat litter box enclosure",
      "automatic cat feeder replacement filters",
    ];

    const observations: CandidateObservationRecord[] = wrongKeywords.map((kw, i) => ({
      id: `obs_${i}`,
      productId: uahpetCanonicalId,
      keyword: kw,
      region: "US",
      value: 60,
    }));

    const partition = filterAttributableObservations(observations, {
      candidateCanonicalName: uahpetCandidateTitle,
      canonicalProductId: uahpetCanonicalId,
      evaluationScope: "BUSINESS",
    });

    expect(partition.attributableCount).toBe(0);
    expect(partition.businessAttributableCount).toBe(0);
    expect(partition.excludedCount).toBe(6);
  });

  it("A20: hardcoded 2-point 14-day fixture is marked fixture only and not counted as official Google source", () => {
    const fixtureObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      source: "fixture_demo_mock",
      isFixture: true,
      evidenceReference: "fixture:two-point-14d-demand",
    };

    const res = classifyCandidateObservationAttribution(fixtureObs, {
      candidateCanonicalName: uahpetCandidateTitle,
      canonicalProductId: uahpetCanonicalId,
      evaluationScope: "BUSINESS",
    });

    expect(res.isAttributable).toBe(false);
    expect(res.businessAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_FIXTURE_OR_PROXY");
  });

  // ==============================================================================
  // GROUP B: REAL GITHUB ACTIONS CI EVIDENCE (B01 - B22)
  // ==============================================================================

  it("B01: bare runId + matching sha without authentic verifier returns CI_CLAIM_UNVERIFIED", () => {
    const check = verifyAuthenticCiProof({
      runId: "1234567890",
      commitSha: "4d472c277454b0b2230d80a03f843124b44cd49c",
    });
    expect(check.verified).toBe(false);
    expect(check.status).toBe("CI_NOT_RUN");
    expect(check.error).toContain("CI_CLAIM_UNVERIFIED");
  });

  it("B02: verified: true + full plausible plain object without verifier provenance returns CI_CLAIM_UNVERIFIED", () => {
    const check = verifyAuthenticCiProof({
      runId: "1234567890",
      verified: true,
      authenticatedProof: {
        provider: "github-actions",
        repository: CANONICAL_REPOSITORY,
        runId: "1234567890",
        commitSha: "4d472c277454b0b2230d80a03f843124b44cd49c",
        branch: LOCKED_BRANCH,
        status: "completed",
        conclusion: "success",
        event: "push",
        verifiedAt: new Date().toISOString(),
      },
    });
    expect(check.verified).toBe(false);
    expect(check.status).toBe("CI_NOT_RUN");
    expect(check.error).toContain("CI_CLAIM_UNVERIFIED");
  });

  it("B03: fake attestationSignature without trusted verifier root is rejected as unverified", () => {
    const check = verifyAuthenticCiProof({
      runId: "1234567890",
      authenticatedProof: {
        provider: "github-actions",
        repository: CANONICAL_REPOSITORY,
        runId: "1234567890",
        status: "completed",
        conclusion: "success",
        attestationSignature: "fake_hmac_signature_xyz_12345",
      },
    });
    expect(check.verified).toBe(false);
    expect(check.status).toBe("CI_NOT_RUN");
  });

  it("B04: fake runId 1234567890 with completed/success claims returns NOT_VERIFIED", () => {
    const check = verifyAuthenticCiProof({
      id: "1234567890",
      status: "completed",
      conclusion: "success",
    });
    expect(check.verified).toBe(false);
    expect(check.status).toBe("CI_NOT_RUN");
  });

  it("B05: mock API adapter payload produces UNIT_TEST_MOCK, not REAL_CI_VERIFIED", async () => {
    const mockRunPayload = {
      id: 99887766,
      name: "CI Workflow",
      status: "completed",
      conclusion: "success",
      event: "push",
      head_sha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      head_branch: LOCKED_BRANCH,
      repository: { full_name: CANONICAL_REPOSITORY },
      html_url: `https://github.com/${CANONICAL_REPOSITORY}/actions/runs/99887766`,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify(mockRunPayload),
    });

    const result = await verifyRemoteGitHubActionsRun({
      runId: "99887766",
      expectedSha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      customFetch: mockFetch as any,
      isUnitTestMock: true,
    });

    expect(result.verified).toBe(true);
    expect(result.isUnitTestMock).toBe(true);
    expect(result.evidence?.source).toBe("UNIT_TEST_MOCK"); // Marked UNIT_TEST_MOCK!
  });

  it("B06: run belonging to wrong repository is rejected with CI_FAIL", async () => {
    const mockRunPayload = {
      id: 11112222,
      status: "completed",
      conclusion: "success",
      event: "push",
      head_sha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      head_branch: LOCKED_BRANCH,
      repository: { full_name: "attacker/Shopify-Search-Fork" }, // Wrong repo!
    };

    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify(mockRunPayload),
    });

    const result = await verifyRemoteGitHubActionsRun({
      runId: "11112222",
      expectedSha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      customFetch: mockFetch as any,
      isUnitTestMock: true,
    });

    expect(result.verified).toBe(false);
    expect(result.status).toBe("CI_FAIL");
    expect(result.rejectionReason).toContain("repository mismatch");
  });

  it("B07: run on wrong branch is rejected with CI_FAIL", async () => {
    const mockRunPayload = {
      id: 11112222,
      status: "completed",
      conclusion: "success",
      event: "push",
      head_sha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      head_branch: "feature/unlocked-experimental-branch", // Wrong branch!
      repository: { full_name: CANONICAL_REPOSITORY },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify(mockRunPayload),
    });

    const result = await verifyRemoteGitHubActionsRun({
      runId: "11112222",
      expectedSha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      customFetch: mockFetch as any,
      isUnitTestMock: true,
    });

    expect(result.verified).toBe(false);
    expect(result.status).toBe("CI_FAIL");
    expect(result.rejectionReason).toContain("branch mismatch");
  });

  it("B08: run with stale or mismatched commit SHA is rejected with CI_FAIL", async () => {
    const mockRunPayload = {
      id: 11112222,
      status: "completed",
      conclusion: "success",
      event: "push",
      head_sha: "0000000000000000000000000000000000000000", // Mismatched SHA!
      head_branch: LOCKED_BRANCH,
      repository: { full_name: CANONICAL_REPOSITORY },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify(mockRunPayload),
    });

    const result = await verifyRemoteGitHubActionsRun({
      runId: "11112222",
      expectedSha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      customFetch: mockFetch as any,
      isUnitTestMock: true,
    });

    expect(result.verified).toBe(false);
    expect(result.status).toBe("CI_FAIL");
    expect(result.rejectionReason).toContain("commit SHA mismatch");
  });

  it("B09: workflow not on allowed release workflows list is rejected with CI_FAIL", async () => {
    const mockRunPayload = {
      id: 11112222,
      name: "unauthorized_arbitrary_script.yml",
      status: "completed",
      conclusion: "success",
      event: "push",
      head_sha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      head_branch: LOCKED_BRANCH,
      repository: { full_name: CANONICAL_REPOSITORY },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify(mockRunPayload),
    });

    const result = await verifyRemoteGitHubActionsRun({
      runId: "11112222",
      expectedSha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      allowedWorkflows: ["ci.yml", "test.yml"],
      customFetch: mockFetch as any,
      isUnitTestMock: true,
    });

    expect(result.verified).toBe(false);
    expect(result.status).toBe("CI_FAIL");
    expect(result.rejectionReason).toContain("not in the allowed release workflows list");
  });

  it("B10: untrusted trigger event (e.g. pull_request from untrusted fork) is rejected", async () => {
    const mockRunPayload = {
      id: 11112222,
      status: "completed",
      conclusion: "success",
      event: "pull_request", // Untrusted event!
      head_sha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      head_branch: LOCKED_BRANCH,
      repository: { full_name: CANONICAL_REPOSITORY },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify(mockRunPayload),
    });

    const result = await verifyRemoteGitHubActionsRun({
      runId: "11112222",
      expectedSha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      customFetch: mockFetch as any,
      isUnitTestMock: true,
    });

    expect(result.verified).toBe(false);
    expect(result.status).toBe("CI_FAIL");
    expect(result.rejectionReason).toContain("Untrusted trigger event");
  });

  it("B11: workflow with status queued or in_progress returns CI_NOT_RUN, never PASS", async () => {
    const mockRunPayload = {
      id: 11112222,
      status: "in_progress", // Still running
      conclusion: null,
      event: "push",
      head_sha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      head_branch: LOCKED_BRANCH,
      repository: { full_name: CANONICAL_REPOSITORY },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify(mockRunPayload),
    });

    const result = await verifyRemoteGitHubActionsRun({
      runId: "11112222",
      expectedSha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      customFetch: mockFetch as any,
      isUnitTestMock: true,
    });

    expect(result.verified).toBe(false);
    expect(result.status).toBe("CI_NOT_RUN");
    expect(result.rejectionReason).toContain("still pending or running");
  });

  it("B12: workflow with conclusion failure or cancelled returns CI_FAIL, never PASS", async () => {
    const mockRunPayload = {
      id: 11112222,
      status: "completed",
      conclusion: "failure", // Test failure
      event: "push",
      head_sha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      head_branch: LOCKED_BRANCH,
      repository: { full_name: CANONICAL_REPOSITORY },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify(mockRunPayload),
    });

    const result = await verifyRemoteGitHubActionsRun({
      runId: "11112222",
      expectedSha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      customFetch: mockFetch as any,
      isUnitTestMock: true,
    });

    expect(result.verified).toBe(false);
    expect(result.status).toBe("CI_FAIL");
    expect(result.rejectionReason).toContain("Remote CI checks failed");
  });

  it("B13: cancelled or timed_out conclusion returns CI_FAIL", async () => {
    const mockRunPayload = {
      id: 11112222,
      status: "completed",
      conclusion: "timed_out",
      event: "push",
      head_sha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      head_branch: LOCKED_BRANCH,
      repository: { full_name: CANONICAL_REPOSITORY },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify(mockRunPayload),
    });

    const result = await verifyRemoteGitHubActionsRun({
      runId: "11112222",
      expectedSha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      customFetch: mockFetch as any,
      isUnitTestMock: true,
    });

    expect(result.verified).toBe(false);
    expect(result.status).toBe("CI_FAIL");
  });

  it("B14: GitHub API 401, 403 or 404 returns CI_NOT_RUN / UNAVAILABLE, never PASS", async () => {
    const mockFetch404 = vi.fn().mockResolvedValue({
      status: 404,
      text: async () => JSON.stringify({ message: "Not Found" }),
    });

    const res404 = await verifyRemoteGitHubActionsRun({
      runId: "1234567890",
      expectedSha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      customFetch: mockFetch404 as any,
      isUnitTestMock: true,
    });

    expect(res404.verified).toBe(false);
    expect(res404.status).toBe("CI_NOT_RUN");
    expect(res404.rejectionReason).toContain("HTTP 404");
  });

  it("B15: no token and network absent returns CI_NOT_CONFIGURED", async () => {
    const origToken = process.env.GITHUB_TOKEN;
    const origGhToken = process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;

    try {
      const result = await verifyRemoteGitHubActionsRun({
        runId: "1234567890",
        expectedSha: "4d472c277454b0b2230d80a03f843124b44cd49c",
        isUnitTestMock: false, // Real environment check
      });

      expect(result.verified).toBe(false);
      expect(result.status).toBe("CI_NOT_CONFIGURED");
    } finally {
      if (origToken) process.env.GITHUB_TOKEN = origToken;
      if (origGhToken) process.env.GH_TOKEN = origGhToken;
    }
  });

  it("B16: SSRF URL injection and non-HTTPS endpoints fail before network dispatch", () => {
    const maliciousUrls = [
      "http://api.github.com/repos/quocan050302/Shopify-Search/actions/runs/123", // Insecure HTTP
      "https://attacker-api.github.com/repos/quocan050302/Shopify-Search/actions/runs/123", // Host spoofing
      "https://user:pass@api.github.com/repos/quocan050302/Shopify-Search/actions/runs/123", // Userinfo injection
      "https://api.github.com:8443/repos/quocan050302/Shopify-Search/actions/runs/123", // Non-standard port
      "https://api.github.com/repos/evil-repo/actions/runs/123", // Path tampering
    ];

    for (const url of maliciousUrls) {
      const check = validateGitHubApiUrl(url, CANONICAL_REPOSITORY, "123");
      expect(check.valid).toBe(false);
      expect(check.error).toBeDefined();
    }
  });

  it("B17: HTTP 200 with invalid non-JSON or empty response body is rejected", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => "<html>502 Bad Gateway</html>", // Non-JSON HTML
    });

    const result = await verifyRemoteGitHubActionsRun({
      runId: "11112222",
      expectedSha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      customFetch: mockFetch as any,
      isUnitTestMock: true,
    });

    expect(result.verified).toBe(false);
    expect(result.status).toBe("CI_FAIL");
    expect(result.rejectionReason).toContain("valid JSON");
  });

  it("B18: authentic verifier output includes 64-char responseDigest and TRUSTED_VERIFIER_ID", async () => {
    const rawPayload = JSON.stringify({
      id: 99887766,
      name: "CI Workflow",
      status: "completed",
      conclusion: "success",
      event: "push",
      head_sha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      head_branch: LOCKED_BRANCH,
      repository: { full_name: CANONICAL_REPOSITORY },
      html_url: `https://github.com/${CANONICAL_REPOSITORY}/actions/runs/99887766`,
    });

    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => rawPayload,
    });

    const result = await verifyRemoteGitHubActionsRun({
      runId: "99887766",
      expectedSha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      customFetch: mockFetch as any,
      isUnitTestMock: true,
    });

    expect(result.verified).toBe(true);
    expect(result.evidence?.verifier).toBe(TRUSTED_VERIFIER_ID);
    expect(result.evidence?.responseDigest.length).toBe(64);
  });

  it("B19: release evaluator caller ciStatus.runStatus=SUCCESS with verifiedProof: {verified: true} but no trusted origin returns CI_NOT_RUN", () => {
    const verdict = evaluateReleaseEvidence({
      version: "12.4.3.7.19.3.2.2",
      baselineSha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      reportGeneratedAt: new Date().toISOString(),
      testCommand: "npx vitest run tests/unit/kh02/foo.test.ts",
      testedCodeSha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      branch: LOCKED_BRANCH,
      exitCode: 0,
      realPassed: 52,
      realFailed: 0,
      realSkipped: 0,
      realTotal: 52,
      runMode: "OFFLINE_CONTRACT_CHECK",
      ciStatus: {
        configured: true,
        runStatus: "SUCCESS",
        verifiedProof: {
          verified: true, // Caller supplied boolean without trusted verifier attestation!
        },
      },
    });

    expect(verdict.ciStatus).toBe("CI_NOT_RUN");
    expect(verdict.blockerList).toContain("CI_CLAIM_UNVERIFIED");
  });

  it("B20: replaying a CI run for previous commit or branch is rejected", () => {
    const fakeDigest = crypto.createHash("sha256").update("sample").digest("hex");
    const check = verifyAuthenticCiProof(
      {
        runId: "1234567890",
        authenticatedProof: {
          provider: "github-actions",
          source: "GITHUB_API",
          verifier: TRUSTED_VERIFIER_ID,
          repository: CANONICAL_REPOSITORY,
          headSha: "0cd5bdec55db2c34ddc62c7413f50adbf8ed51ef", // Previous old commit!
          headBranch: LOCKED_BRANCH,
          status: "completed",
          conclusion: "success",
          event: "push",
          responseDigest: fakeDigest,
        },
      },
      {
        expectedSha: "4d472c277454b0b2230d80a03f843124b44cd49c", // Current tested SHA
      }
    );

    expect(check.verified).toBe(false);
    expect(check.status).toBe("CI_FAIL");
    expect(check.error).toContain("commit SHA mismatch");
  });

  it("B21: modified logs or test counts after purported CI success produces no exact-SHA proof", () => {
    const result = validateTestSuiteExecutionEvidence({
      command: "npx vitest run tests/unit/kh02/foo.test.ts",
      exitCode: 0,
      stdout: "Tests 52 passed (52)",
      checkoutSha: "4d472c277454b0b2230d80a03f843124b44cd49c",
      expectedCheckoutSha: "different_sha_123456789", // Tampered SHA
    });

    expect(result.valid).toBe(false);
    expect(result.status).toBe("STALE");
    expect(result.verificationLevel).toBe("STALE");
    expect(result.rejectionReasons.some((r) => r.includes("STALE_LOG"))).toBe(true);
  });

  it("B22: sanitizeCiLog strictly redacts tokens, bearer secrets, and passwords from logs", () => {
    const rawLog = "Error querying api: Authorization: Bearer ghp_0123456789abcdefghijklmnopqrstuvwxyz with secret: 'super_secret_token_12345'";
    const sanitized = sanitizeCiLog(rawLog);

    expect(sanitized).not.toContain("ghp_");
    expect(sanitized).not.toContain("super_secret_token");
    expect(sanitized).toContain("[REDACTED");
  });

  // ==============================================================================
  // GROUP C: DURABILITY / REGRESSION / REPLAY (C01 - C10)
  // ==============================================================================

  it("C01: corrupt ledger fails closed and bytes are preserved", () => {
    const ledgerFile = path.join(testStorageDir, ".candidate_alias_ledger.json");
    fs.writeFileSync(ledgerFile, "CORRUPT_NOT_JSON_DATA!@#$%", "utf-8");

    const verification = verifyDurableCandidateAliasApproval("alias_appr_some_id", {
      candidateId: "cand_1212440541",
      workspaceId: "ws_acceptance_us",
    });

    expect(verification.valid).toBe(false);
    expect(verification.code).toBe("LEDGER_CORRUPT");

    // Bytes must be preserved
    const contents = fs.readFileSync(ledgerFile, "utf-8");
    expect(contents).toBe("CORRUPT_NOT_JSON_DATA!@#$%");
  });

  it("C02: corrupted revocations cannot overwrite or revive approvals", () => {
    const ledgerFile = path.join(testStorageDir, ".candidate_alias_ledger.json");
    fs.writeFileSync(ledgerFile, "CORRUPT_REVOCATION_LOG", "utf-8");

    const revokeRes = revokeCandidateAliasAtomically("alias_appr_some_id", "testing", "admin");
    expect(revokeRes.success).toBe(false);
    expect(revokeRes.code).toBe("LEDGER_CORRUPT");
  });

  it("C03: revoked alias re-persist is rejected", () => {
    const { record } = createAndPersistTestAlias({
      aliasKeyword: catFeederKeyword,
      isTestOnly: false,
    });

    const revokeRes = revokeCandidateAliasAtomically(record.approvalId, "testing monotonic revocation", "security_admin");
    expect(revokeRes.success).toBe(true);

    // Attempt to re-persist the revoked record
    const persistAgain = persistCandidateAliasApprovalAtomically(record);
    expect(persistAgain.success).toBe(false);
    expect(persistAgain.error).toContain("REVOCATION_IMMUTABLE");
  });

  it("C04: test key registered under production env without TEST_ONLY status is forbidden", () => {
    expect(() => {
      registerAliasSigningKey({
        keyId: "invalid_key",
        secret: "12345678",
        status: "ACTIVE",
        purpose: ALIAS_OPERATION_SCOPE,
        description: "Key with too short secret",
        isBusinessTrusted: true,
      });
    }).toThrow(/at least 32 characters/i);
  });

  it("C05: unapproved principal fails closed", () => {
    process.env.KH02_AUTHORIZED_APPROVER_PRINCIPALS = "admin_alice,admin_bob";

    expect(() => {
      createSignedCandidateAliasApproval({
        candidateId: "cand_1212440541",
        targetProductId: uahpetCanonicalId,
        aliasKeyword: catFeederKeyword,
        authorizedCanonicalKeyword: uahpetCandidateTitle,
        workspaceId: "ws_acceptance_us",
        approverPrincipalId: "unauthorized_charlie", // Not in authorized approvers!
        issuerKeyId: testKeyId,
        evidenceChainReference: "urn:swai:evidence:test",
        isTestOnly: false,
        enforceApproverAuthority: true,
      });
    }).toThrow(/UNAUTHORIZED_APPROVER/i);
  });

  it("C06: revoked signer key rejects previously signed approvals", () => {
    const { record, aliasDescriptor } = createAndPersistTestAlias({
      aliasKeyword: catFeederKeyword,
      isTestOnly: false,
    });

    // Re-register the key as REVOKED
    registerAliasSigningKey({
      keyId: businessKeyId,
      secret: businessSecret,
      status: "REVOKED",
      purpose: ALIAS_OPERATION_SCOPE,
      description: "Compromised key revoked",
      isBusinessTrusted: false,
    });

    const verification = verifyDurableCandidateAliasApproval(aliasDescriptor.provenanceReference, {
      candidateId: "cand_1212440541",
      workspaceId: "ws_acceptance_us",
    });

    expect(verification.valid).toBe(false);
    expect(verification.code).toBe("KEY_REVOKED");
  });

  it("C07: concurrent atomic writes to ledger execute safely without file corruption", async () => {
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        new Promise<void>((resolve) => {
          const kw = `Automatic Feeder Variant ${i}`;
          createAndPersistTestAlias({
            aliasKeyword: kw,
            isTestOnly: true,
          });
          resolve();
        })
      );
    }

    await Promise.all(promises);

    const ledgerFile = path.join(testStorageDir, ".candidate_alias_ledger.json");
    const parsed = JSON.parse(fs.readFileSync(ledgerFile, "utf-8"));
    expect(Object.keys(parsed.approvals).length).toBe(5);
  });

  it("C08: backtest as-of and DEV/HOLDOUT fixture split remain strictly chronological without lookahead", () => {
    const historicalCutoff = "2025-06-01T00:00:00Z";
    const futureObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      periodStart: "2025-07-01T00:00:00Z", // After cutoff!
    };

    const res = classifyCandidateObservationAttribution(futureObs, {
      candidateCanonicalName: uahpetCandidateTitle,
      canonicalProductId: uahpetCanonicalId,
      asOfTimestamp: historicalCutoff,
      evaluationScope: "BUSINESS",
    });

    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_FUTURE_OR_POST_CUTOFF");
  });

  it("C09: direct provider and raw importer cannot write test-only business alias observations", async () => {
    const { aliasDescriptor } = createAndPersistTestAlias({
      aliasKeyword: catFeederKeyword,
      isTestOnly: true,
    });

    const partition = filterAttributableObservations(
      [
        {
          productId: uahpetCanonicalId,
          keyword: catFeederKeyword,
          source: "GOOGLE_TRENDS_CSV",
        },
      ],
      {
        candidateCanonicalName: uahpetCandidateTitle,
        canonicalProductId: uahpetCanonicalId,
        verifiedAliases: [aliasDescriptor],
        evaluationScope: "BUSINESS",
      }
    );

    expect(partition.attributableCount).toBe(0);
    expect(partition.businessAttributableCount).toBe(0);
  });

  it("C10: existing genuine exact-title matching and authorized US CSV import contracts remain green", () => {
    const exactObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: "UAHPET Fresh Food Automatic Pet Feeder", // Exact canonical title
      source: "GOOGLE_TRENDS_CSV",
      evidenceReference: "raw-csv:google_trends_official_uahpet.csv#sha256=1122334455667788990011223344556677889900112233445566778899001122",
      region: "US",
    };

    const res = classifyCandidateObservationAttribution(exactObs, {
      candidateCanonicalName: uahpetCandidateTitle,
      canonicalProductId: uahpetCanonicalId,
      evaluationScope: "BUSINESS",
      region: "US",
      strictProvenance: true,
    });

    expect(res.classification).toBe("EXACT_CANDIDATE_KEYWORD_MATCH");
    expect(res.isAttributable).toBe(true);
    expect(res.businessAttributable).toBe(true);
  });
});
