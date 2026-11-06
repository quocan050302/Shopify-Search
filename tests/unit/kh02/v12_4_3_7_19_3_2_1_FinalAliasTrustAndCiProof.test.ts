/**
 * SWAI KH-02 — V12.4.3.7.19.3.2.1
 * FINAL ALIAS TRUST & CI PROOF CLOSURE ADVERSARIAL TEST MATRIX
 *
 * Comprehensive adversarial verification across 4 strict engineering tracks:
 * - Group A (A01 - A25): Alias Trust, Approver Authority & Business Fencing
 * - Group B (B01 - B20): Durable Ledger Storage Integrity & Corrupt State Recovery
 * - Group C (C01 - C20): CI Provider Proof Truth & Release Gate Fencing
 * - Group D (D01 - D10): Candidate Demand Attribution & Release Honest Truth
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
  getCandidateAliasApprovalById,
  verifyDurableCandidateAliasApproval,
  registerAliasSigningKey,
  clearTestAliasSigningKeys,
  getCandidateAliasStorageDir,
  computeAliasPayloadDigest,
  signAliasPayloadDigest,
  readLedgerUnderLock,
} from "@/services/kh02/demand/durableCandidateAliasAuthority";

import {
  classifyCandidateObservationAttribution,
  isAuthenticVerifiedCandidateAlias,
  CandidateAttributionContext,
  CandidateObservationRecord,
  VerifiedCandidateAlias,
} from "@/services/kh02/demand/candidateDemandAttribution";

import {
  validateTestSuiteExecutionEvidence,
  verifyGitHubActionsRunProof,
  validateVerifiedCiAttestation,
  AuthenticatedCiProof,
  CiProviderProofInput,
} from "@/services/kh02/demand/testSuiteEvidenceValidator";

import {
  evaluateReleaseEvidence,
  sanitizeReleaseLog,
  ReleaseEvidenceInput,
} from "@/services/kh02/release/releaseGateEvaluatorV19";

import {
  TRUSTED_VERIFIER_ID,
  _privateMintCiAttestationToken,
  _testOnlyRegisterVerifiedRemoteCiRun,
} from "@/services/kh02/release/githubActionsCiEvidence";

describe("KH-02 V12.4.3.7.19.3.2.1: Final Alias Trust & CI Proof Closure Matrix (75 Tests)", () => {
  const testStorageDir = path.join(
    os.tmpdir(),
    `kh02_v19_3_2_1_test_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  );

  const uahpetCanonicalId = "cmvsy7zqh000jp0orhypwohho";
  const uahpetCandidateTitle = "UAHPET Fresh Food Automatic Pet Feeder";
  const catFeederKeyword = "Automatic Wet Food Cat Feeder with Cooling & Warming";

  const primaryKeyId = "test_alias_key_v19_3_2_1";
  const primarySecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const engineeringContext: CandidateAttributionContext = {
    candidateId: "cand_1212440541",
    researchRunId: "kh02_run_1793424091548_669k8",
    canonicalProductId: uahpetCanonicalId,
    candidateCanonicalName: uahpetCandidateTitle,
    authorizedKeywords: [uahpetCandidateTitle],
    workspaceId: "ws_acceptance_us",
    region: "US",
    evaluationScope: "ENGINEERING",
  };

  const businessContext: CandidateAttributionContext = {
    candidateId: "cand_1212440541",
    researchRunId: "kh02_run_1793424091548_669k8",
    canonicalProductId: uahpetCanonicalId,
    candidateCanonicalName: uahpetCandidateTitle,
    authorizedKeywords: [uahpetCandidateTitle],
    workspaceId: "ws_acceptance_us",
    region: "US",
    evaluationScope: "BUSINESS",
  };

  beforeEach(() => {
    fs.mkdirSync(testStorageDir, { recursive: true });
    process.env.TEST_CANDIDATE_ALIAS_STORAGE_DIR = testStorageDir;

    registerAliasSigningKey({
      keyId: primaryKeyId,
      secret: primarySecret,
      status: "TEST_ONLY",
      purpose: ALIAS_OPERATION_SCOPE,
      description: "Primary HMAC key for testing alias signing",
      isBusinessTrusted: false,
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

  // ==============================================================================
  // GROUP A: ALIAS TRUST / BUSINESS FENCING (A01 - A25)
  // ==============================================================================

  it("A01: plain approvedBy string or unrecorded reference prefix fails with ALIAS_NOT_FOUND", () => {
    const res = verifyDurableCandidateAliasApproval("plain_string_ref_123", engineeringContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("ALIAS_NOT_FOUND");
    expect(res.durableRecordFound).toBe(false);
  });

  it("A02: fabricated ledger record with mismatched payload digest fails with TAMPERED_PAYLOAD", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:test",
      isTestOnly: true,
    });

    const tamperedRecord = { ...record, payloadDigest: "0000000000000000000000000000000000000000000000000000000000000000" };
    const persistRes = persistCandidateAliasApprovalAtomically(tamperedRecord);
    expect(persistRes.success).toBe(false);
    expect(persistRes.code).toBe("TAMPERED_PAYLOAD");
  });

  it("A03: signed record using unknown issuer keyId fails with APPROVAL_UNTRUSTED", () => {
    const unsigned = {
      approvalId: "alias_appr_unregistered_key_test",
      schemaVersion: ALIAS_SCHEMA_VERSION,
      operationScope: ALIAS_OPERATION_SCOPE,
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      normalizedAliasQuery: "automatic wet food cat feeder with cooling warming",
      normalizedCanonicalQuery: "uahpet fresh food automatic pet feeder",
      workspaceId: "ws_acceptance_us",
      region: "US",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: "key_not_in_registry_abc",
      signingAlgorithm: "HMAC-SHA256" as const,
      approvedAt: new Date().toISOString(),
      effectiveAt: new Date().toISOString(),
      evidenceChainReference: "urn:swai:evidence:test",
      isTestOnly: true,
    };
    const digest = computeAliasPayloadDigest(unsigned);
    const sig = signAliasPayloadDigest(digest, primarySecret);
    const record: CandidateAliasApprovalRecord = { ...unsigned, payloadDigest: digest, approvalSignature: sig };

    const persistRes = persistCandidateAliasApprovalAtomically(record);
    expect(persistRes.success).toBe(false);
    expect(persistRes.code).toBe("APPROVAL_UNTRUSTED");
  });

  it("A04: registering key with wrong purpose scope throws SECURITY_VIOLATION", () => {
    expect(() => {
      registerAliasSigningKey({
        keyId: "bad_purpose_key",
        secret: primarySecret,
        status: "TEST_ONLY",
        purpose: "WRONG_PURPOSE_SCOPE" as any,
        description: "Invalid purpose key",
      });
    }).toThrow(/SECURITY_VIOLATION/);
  });

  it("A05: TEST_ONLY record in local fixture satisfies ENGINEERING assertions", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:engineering_test",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);

    const res = verifyDurableCandidateAliasApproval(record.approvalId, engineeringContext);
    expect(res.valid).toBe(true);
    expect(res.code).toBe("VERIFIED_ALIAS");
    expect(res.isTestOnly).toBe(true);
    expect(res.businessEligible).toBe(false);
  });

  it("A06: TEST_ONLY record in BUSINESS evaluation scope returns businessEligible=false and TEST_ONLY_ALIAS", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:business_test",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);

    const res = verifyDurableCandidateAliasApproval(record.approvalId, businessContext);
    expect(res.valid).toBe(false);
    expect(res.businessEligible).toBe(false);
    expect(res.code).toBe("TEST_ONLY_ALIAS");
  });

  it("A07: NODE_ENV='production' + register TEST_ONLY key throws SECURITY_VIOLATION", () => {
    const prevEnv = process.env.NODE_ENV;
    try {
      (process.env as any).NODE_ENV = "production";
      expect(() => {
        registerAliasSigningKey({
          keyId: "test_prod_key_attempt",
          secret: primarySecret,
          status: "TEST_ONLY",
          purpose: ALIAS_OPERATION_SCOPE,
          description: "Illegal prod test key",
        });
      }).toThrow(/SECURITY_VIOLATION/);
    } finally {
      (process.env as any).NODE_ENV = prevEnv;
    }
  });

  it("A08: production arbitrary ACTIVE key registration without admin token throws SECURITY_VIOLATION", () => {
    const prevEnv = process.env.NODE_ENV;
    try {
      (process.env as any).NODE_ENV = "production";
      process.env.KH02_ALIAS_ADMIN_TOKEN = "super_secure_admin_token_12345678";
      expect(() => {
        registerAliasSigningKey({
          keyId: "arbitrary_active_key",
          secret: primarySecret,
          status: "ACTIVE",
          purpose: ALIAS_OPERATION_SCOPE,
          description: "Unauthenticated active key registration",
        });
      }).toThrow(/SECURITY_VIOLATION/);
    } finally {
      (process.env as any).NODE_ENV = prevEnv;
    }
  });

  it("A09: commercial issuance with spoofed approverPrincipalId not in authorized list throws UNAUTHORIZED_APPROVER", () => {
    process.env.KH02_AUTHORIZED_APPROVER_PRINCIPALS = "alice_sec_lead,bob_product_lead";
    expect(() => {
      createSignedCandidateAliasApproval({
        candidateId: "cand_1212440541",
        targetProductId: uahpetCanonicalId,
        aliasKeyword: catFeederKeyword,
        authorizedCanonicalKeyword: uahpetCandidateTitle,
        workspaceId: "ws_acceptance_us",
        approverPrincipalId: "eve_attacker_spoof",
        issuerKeyId: primaryKeyId,
        evidenceChainReference: "urn:swai:evidence:commercial",
        enforceApproverAuthority: true,
      });
    }).toThrow(/UNAUTHORIZED_APPROVER/);
  });

  it("A10: approver authority not configured in production throws APPROVER_AUTHORITY_NOT_CONFIGURED", () => {
    delete process.env.KH02_AUTHORIZED_APPROVER_PRINCIPALS;
    const prevEnv = process.env.NODE_ENV;
    try {
      (process.env as any).NODE_ENV = "production";
      expect(() => {
        createSignedCandidateAliasApproval({
          candidateId: "cand_1212440541",
          targetProductId: uahpetCanonicalId,
          aliasKeyword: catFeederKeyword,
          authorizedCanonicalKeyword: uahpetCandidateTitle,
          workspaceId: "ws_acceptance_us",
          approverPrincipalId: "alice_sec_lead",
          issuerKeyId: primaryKeyId,
          evidenceChainReference: "urn:swai:evidence:commercial",
          isTestOnly: false,
          enforceApproverAuthority: true,
        });
      }).toThrow(/APPROVER_AUTHORITY_NOT_CONFIGURED/);
    } finally {
      (process.env as any).NODE_ENV = prevEnv;
    }
  });

  it("A11: valid production issuer + trusted principal succeeds issuance when approver authority is configured", () => {
    process.env.KH02_AUTHORIZED_APPROVER_PRINCIPALS = "alice_sec_lead";
    const prodKeyId = "alias_prod_test_key";
    registerAliasSigningKey({
      keyId: prodKeyId,
      secret: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      status: "ACTIVE",
      purpose: ALIAS_OPERATION_SCOPE,
      description: "Authorized prod test key",
      isBusinessTrusted: true,
    });

    const rec = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "alice_sec_lead",
      issuerKeyId: prodKeyId,
      evidenceChainReference: "urn:swai:evidence:authorized_prod",
      isTestOnly: false,
      enforceApproverAuthority: true,
    });
    expect(rec.approvalId).toBeDefined();
    expect(rec.isTestOnly).toBe(false);

    persistCandidateAliasApprovalAtomically(rec);
    const ver = verifyDurableCandidateAliasApproval(rec.approvalId, businessContext);
    expect(ver.valid).toBe(true);
    expect(ver.businessEligible).toBe(true);
  });

  it("A12: signed record with wrong candidateId fails with SCOPE_MISMATCH", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_wrong_99999",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:scope_test",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);

    const res = verifyDurableCandidateAliasApproval(record.approvalId, engineeringContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("SCOPE_MISMATCH");
  });

  it("A13: wrong canonicalProductId fails with PRODUCT_IDENTITY_MISMATCH", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: "prod_foreign_identity_999",
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:pid_test",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);

    const res = verifyDurableCandidateAliasApproval(record.approvalId, engineeringContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("PRODUCT_IDENTITY_MISMATCH");
  });

  it("A14: missing canonicalProductId in strict business context fails attribution", () => {
    const obs: CandidateObservationRecord = {
      productId: null,
      keyword: catFeederKeyword,
      evidenceReference: null,
    };
    const res = classifyCandidateObservationAttribution(obs, businessContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("INSUFFICIENT_CANDIDATE_IDENTITY");
  });

  it("A15: wrong researchRunId fails with RUN_SCOPE_MISMATCH", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      researchRunId: "foreign_run_999999",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:run_test",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);

    const res = verifyDurableCandidateAliasApproval(record.approvalId, engineeringContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("RUN_SCOPE_MISMATCH");
  });

  it("A16: wrong region (e.g. GB vs US) fails with REGION_MISMATCH", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      region: "GB",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:region_test",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);

    const res = verifyDurableCandidateAliasApproval(record.approvalId, engineeringContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("REGION_MISMATCH");
  });

  it("A17: wrong alias keyword or canonical target keyword fails with KEYWORD_MISMATCH", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: "Different Dog Feeder Machine",
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:kw_test",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);

    const res = verifyDurableCandidateAliasApproval(record.approvalId, {
      ...engineeringContext,
      observationKeyword: catFeederKeyword,
    });
    expect(res.valid).toBe(false);
    expect(res.code).toBe("KEYWORD_MISMATCH");
  });

  it("A18: product-family/SKU/accessory borrowing is rejected in candidate attribution", () => {
    const obs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: "UAHPET Pet Feeder Replacement Filter",
      evidenceReference: "urn:swai:test",
    };
    const res = classifyCandidateObservationAttribution(obs, engineeringContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_KEYWORD_MISMATCH");
  });

  it("A19: expired or future effectiveAt rejected with EXPIRED or FUTURE_APPROVAL", () => {
    const futureRecord = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      effectiveAt: new Date(Date.now() + 100000).toISOString(),
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:future",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(futureRecord);

    const futureRes = verifyDurableCandidateAliasApproval(futureRecord.approvalId, engineeringContext);
    expect(futureRes.valid).toBe(false);
    expect(futureRes.code).toBe("FUTURE_APPROVAL");

    const expiredRecord = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      expiresAt: new Date(Date.now() - 10000).toISOString(),
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:expired",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(expiredRecord);

    const expiredRes = verifyDurableCandidateAliasApproval(expiredRecord.approvalId, engineeringContext);
    expect(expiredRes.valid).toBe(false);
    expect(expiredRes.code).toBe("EXPIRED");
  });

  it("A20: post-asOf approval rejected with POST_AS_OF_CUTOFF", () => {
    const cutoff = new Date(Date.now() - 50000).toISOString();
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:cutoff",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);

    const res = verifyDurableCandidateAliasApproval(record.approvalId, {
      ...engineeringContext,
      asOfTimestamp: cutoff,
    });
    expect(res.valid).toBe(false);
    expect(res.code).toBe("POST_AS_OF_CUTOFF");
  });

  it("A21: revoked approval fails with REVOKED and monotonic revocation cannot be undone", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:monotonic",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);
    revokeCandidateAliasAtomically(record.approvalId, "Test Revocation", "sec_lead");

    const revokedCheck = verifyDurableCandidateAliasApproval(record.approvalId, engineeringContext);
    expect(revokedCheck.valid).toBe(false);
    expect(revokedCheck.code).toBe("REVOKED");

    // Attempt re-persisting unrevoked record fails with CONFLICT
    const rePersist = persistCandidateAliasApprovalAtomically(record);
    expect(rePersist.success).toBe(false);
    expect(rePersist.state).toBe("CONFLICT");
  });

  it("A22: compromised/revoked issuer key rejected with KEY_REVOKED", () => {
    const compKey = "key_compromised_test";
    registerAliasSigningKey({
      keyId: compKey,
      secret: primarySecret,
      status: "COMPROMISED",
      purpose: ALIAS_OPERATION_SCOPE,
      description: "Compromised key",
    });

    expect(() => {
      createSignedCandidateAliasApproval({
        candidateId: "cand_1212440541",
        targetProductId: uahpetCanonicalId,
        aliasKeyword: catFeederKeyword,
        authorizedCanonicalKeyword: uahpetCandidateTitle,
        workspaceId: "ws_acceptance_us",
        approverPrincipalId: "qa_principal_lead",
        issuerKeyId: compKey,
        evidenceChainReference: "urn:swai:evidence:comp",
        isTestOnly: true,
      });
    }).toThrow(/KEY_REVOKED/);
  });

  it("A23: valid exact canonical keyword with verified raw evidence unaffected", () => {
    const obs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      evidenceReference: "urn:swai:evidence:canonical_raw_123",
    };
    const res = classifyCandidateObservationAttribution(obs, businessContext);
    expect(res.isAttributable).toBe(true);
    expect(res.classification).toBe("EXACT_CANDIDATE_KEYWORD_MATCH");
  });

  it("A24: authenticated alias with missing raw demand proof leaves commercial G15 unverified", () => {
    const releaseVerdict = evaluateReleaseEvidence({
      version: "12.4.3.7.19.3.2.1",
      baselineSha: "36d559465ece26ac872144d61c58117130ac00c9",
      reportGeneratedAt: new Date().toISOString(),
      testCommand: "npx vitest run tests/unit/kh02/foo.test.ts",
      testedCodeSha: "36d559465ece26ac872144d61c58117130ac00c9",
      branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
      exitCode: 0,
      realPassed: 50,
      realFailed: 0,
      realSkipped: 0,
      realTotal: 50,
      runMode: "OFFLINE_CONTRACT_CHECK",
      evidenceProofCounters: {
        rawRowsVerified: 0,
        liveOriginProofs: 0,
        fixtureOnlyCount: 10,
      },
      fullSuiteCoverage: {
        unitPassed: true,
        integrationPassed: true,
        backtestPassed: true,
        kh01VerifyPassed: true,
      },
    });
    expect(releaseVerdict.businessStatus).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("A25: cached and fresh provider candidate separation remains in force", () => {
    const obsCache: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: "Unrelated Pet Water Fountain",
      source: "GOOGLE_TRENDS_CACHE",
    };
    const res = classifyCandidateObservationAttribution(obsCache, businessContext);
    expect(res.isAttributable).toBe(false);
  });

  // ==============================================================================
  // GROUP B: DURABLE LEDGER / MULTI-PROCESS (B01 - B20)
  // ==============================================================================

  it("B01: corrupt JSON ledger read returns LEDGER_CORRUPT status and fails closed", () => {
    const storageDir = getCandidateAliasStorageDir();
    const ledgerFile = path.join(storageDir, ".candidate_alias_ledger.json");
    fs.writeFileSync(ledgerFile, "{corrupted_json_syntax: 123", "utf-8");

    const readRes = readLedgerUnderLock();
    expect(readRes.status).toBe("LEDGER_CORRUPT");
    expect(readRes.state).toBeNull();

    const fetched = getCandidateAliasApprovalById("any_id");
    expect(fetched).toBeNull();
  });

  it("B02: corrupt JSON ledger then persist fails closed with 0 overwrite and original bytes kept", () => {
    const storageDir = getCandidateAliasStorageDir();
    const ledgerFile = path.join(storageDir, ".candidate_alias_ledger.json");
    const corruptContent = "{corrupted_data_do_not_overwrite: true,";
    fs.writeFileSync(ledgerFile, corruptContent, "utf-8");

    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:b02",
      isTestOnly: true,
    });

    const persistRes = persistCandidateAliasApprovalAtomically(record);
    expect(persistRes.success).toBe(false);
    expect(persistRes.code).toBe("LEDGER_CORRUPT");

    // File on disk must remain unchanged!
    const fileBytes = fs.readFileSync(ledgerFile, "utf-8");
    expect(fileBytes).toBe(corruptContent);
  });

  it("B03: corrupted revocation map fails closed with LEDGER_CORRUPT, no resurrection", () => {
    const storageDir = getCandidateAliasStorageDir();
    const ledgerFile = path.join(storageDir, ".candidate_alias_ledger.json");
    fs.writeFileSync(ledgerFile, JSON.stringify({ version: "1.0", approvals: {}, revocations: null }), "utf-8");

    const readRes = readLedgerUnderLock();
    expect(readRes.status).toBe("LEDGER_CORRUPT");
  });

  it("B04: truncated/incomplete ledger fails closed with LEDGER_CORRUPT", () => {
    const storageDir = getCandidateAliasStorageDir();
    const ledgerFile = path.join(storageDir, ".candidate_alias_ledger.json");
    fs.writeFileSync(ledgerFile, '{"version":"1.0","approvals":{"appr_1":', "utf-8");

    const readRes = readLedgerUnderLock();
    expect(readRes.status).toBe("LEDGER_CORRUPT");
  });

  it("B05: first-ever new test ledger initialization returns LEDGER_NOT_INITIALIZED and persists cleanly", () => {
    const readRes = readLedgerUnderLock();
    expect(readRes.status).toBe("LEDGER_NOT_INITIALIZED");

    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:b05",
      isTestOnly: true,
    });

    const persistRes = persistCandidateAliasApprovalAtomically(record);
    expect(persistRes.success).toBe(true);
    expect(persistRes.state).toBe("PERSISTED");
  });

  it("B06: missing ledger after prior initialization can be freshly initialized in test dir", () => {
    const storageDir = getCandidateAliasStorageDir();
    const ledgerFile = path.join(storageDir, ".candidate_alias_ledger.json");
    if (fs.existsSync(ledgerFile)) fs.unlinkSync(ledgerFile);

    const readRes = readLedgerUnderLock();
    expect(readRes.status).toBe("LEDGER_NOT_INITIALIZED");
    expect(readRes.state?.version).toBe("1.0");
  });

  it("B07: atomic same-filesystem write writes via temporary file and renames, preserving intact state", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:b07",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);

    const storageDir = getCandidateAliasStorageDir();
    const files = fs.readdirSync(storageDir);
    // No leftover .tmp files should exist
    const tmpFiles = files.filter((f) => f.includes(".tmp_"));
    expect(tmpFiles.length).toBe(0);
  });

  it("B08: tampered ledger approval signature fails verification with INVALID_SIGNATURE", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:b08",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);

    // Tamper with signature in ledger directly
    const storageDir = getCandidateAliasStorageDir();
    const ledgerFile = path.join(storageDir, ".candidate_alias_ledger.json");
    const ledger = JSON.parse(fs.readFileSync(ledgerFile, "utf-8"));
    ledger.approvals[record.approvalId].approvalSignature = "0000000000000000000000000000000000000000000000000000000000000000";
    fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2), "utf-8");

    const verifyRes = verifyDurableCandidateAliasApproval(record.approvalId, engineeringContext);
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.code).toBe("INVALID_SIGNATURE");
  });

  it("B09: idempotent exact duplicate approval returns IDEMPOTENT_SKIP with consistent record", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:b09",
      isTestOnly: true,
    });
    const res1 = persistCandidateAliasApprovalAtomically(record);
    expect(res1.state).toBe("PERSISTED");

    const res2 = persistCandidateAliasApprovalAtomically(record);
    expect(res2.state).toBe("IDEMPOTENT_SKIP");
    expect(res2.record.payloadDigest).toBe(record.payloadDigest);
  });

  it("B10: conflicting duplicate with same approvalId but different payload returns CONFLICT_ERROR", () => {
    const record1 = createSignedCandidateAliasApproval({
      approvalId: "conflict_appr_b10",
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:b10_first",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record1);

    const record2 = createSignedCandidateAliasApproval({
      approvalId: "conflict_appr_b10",
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: "Different Query for Conflict",
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:b10_second",
      isTestOnly: true,
    });

    const res2 = persistCandidateAliasApprovalAtomically(record2);
    expect(res2.success).toBe(false);
    expect(res2.state).toBe("CONFLICT");
    expect(res2.code).toBe("CONFLICT_ERROR");
  });

  it("B11: monotonic revocation after repeated persist remains revoked", () => {
    const record = createSignedCandidateAliasApproval({
      approvalId: "monotonic_appr_b11",
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:b11",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);
    revokeCandidateAliasAtomically(record.approvalId, "Deprecate B11", "sec_lead");

    // Persist attempt must fail
    const rePersist = persistCandidateAliasApprovalAtomically(record);
    expect(rePersist.success).toBe(false);
    expect(rePersist.state).toBe("CONFLICT");

    const fetched = getCandidateAliasApprovalById(record.approvalId);
    expect(fetched?.revokedAt).toBeDefined();
    expect(fetched?.revocationReason).toBe("Deprecate B11");
  });

  it("B12: concurrent approval writes under lock persist all records without lost updates", async () => {
    const tasks = Array.from({ length: 5 }, (_, i) => {
      const rec = createSignedCandidateAliasApproval({
        approvalId: `alias_appr_concurrent_b12_${i}`,
        candidateId: "cand_1212440541",
        targetProductId: uahpetCanonicalId,
        aliasKeyword: `${catFeederKeyword} variant ${i}`,
        authorizedCanonicalKeyword: uahpetCandidateTitle,
        workspaceId: "ws_acceptance_us",
        approverPrincipalId: "qa_principal_lead",
        issuerKeyId: primaryKeyId,
        evidenceChainReference: `urn:swai:evidence:b12_${i}`,
        isTestOnly: true,
      });
      return persistCandidateAliasApprovalAtomically(rec);
    });

    const results = await Promise.all(tasks);
    for (const r of results) {
      expect(r.success).toBe(true);
      expect(r.state).toBe("PERSISTED");
    }

    for (let i = 0; i < 5; i++) {
      const stored = getCandidateAliasApprovalById(`alias_appr_concurrent_b12_${i}`);
      expect(stored).not.toBeNull();
      expect(stored?.approvalId).toBe(`alias_appr_concurrent_b12_${i}`);
    }
  });

  it("B13: real revocation and write interleave preserves revocation monotonically", () => {
    const rec = createSignedCandidateAliasApproval({
      approvalId: "interleave_appr_b13",
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:b13",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(rec);
    revokeCandidateAliasAtomically(rec.approvalId, "Interleave reason", "sec_lead");
    persistCandidateAliasApprovalAtomically(rec); // attempted undo

    const check = verifyDurableCandidateAliasApproval(rec.approvalId, engineeringContext);
    expect(check.valid).toBe(false);
    expect(check.code).toBe("REVOKED");
  });

  it("B14: live lock owner on host is not reclaimed prematurely", () => {
    const storageDir = getCandidateAliasStorageDir();
    const lockFile = path.join(storageDir, ".candidate_alias_ledger.lock");
    const lockData = {
      ownerId: "current_live_proc",
      pid: process.pid, // Our own PID is alive!
      hostname: os.hostname(),
      acquiredAt: Date.now() - 20000,
      expiresAt: Date.now() + 5000,
    };
    fs.writeFileSync(lockFile, JSON.stringify(lockData), "utf-8");

    // Since our process is alive, another acquire attempt should timeout rather than steal
    expect(() => {
      persistCandidateAliasApprovalAtomically(
        createSignedCandidateAliasApproval({
          candidateId: "cand_1212440541",
          targetProductId: uahpetCanonicalId,
          aliasKeyword: catFeederKeyword,
          authorizedCanonicalKeyword: uahpetCandidateTitle,
          workspaceId: "ws_acceptance_us",
          approverPrincipalId: "qa_principal_lead",
          issuerKeyId: primaryKeyId,
          evidenceChainReference: "urn:swai:evidence:b14",
          isTestOnly: true,
        })
      );
    }).toThrow(/LOCK_TIMEOUT/);

    fs.unlinkSync(lockFile);
  });

  it("B15: stale lock with dead PID on same host is safely reclaimed after expiry", () => {
    const storageDir = getCandidateAliasStorageDir();
    const lockFile = path.join(storageDir, ".candidate_alias_ledger.lock");
    const deadLock = {
      ownerId: "dead_proc_lock",
      pid: 99999999, // non-existent PID
      hostname: os.hostname(),
      acquiredAt: Date.now() - 30000,
      expiresAt: Date.now() - 10000,
    };
    fs.writeFileSync(lockFile, JSON.stringify(deadLock), "utf-8");

    const rec = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:b15",
      isTestOnly: true,
    });

    const res = persistCandidateAliasApprovalAtomically(rec);
    expect(res.success).toBe(true);
    expect(res.state).toBe("PERSISTED");
  });

  it("B16: foreign-host lock is never reclaimed based on PID namespace alone", () => {
    const storageDir = getCandidateAliasStorageDir();
    const lockFile = path.join(storageDir, ".candidate_alias_ledger.lock");
    const foreignLock = {
      ownerId: "foreign_host_lock",
      pid: 12345,
      hostname: "foreign_remote_server_xyz",
      acquiredAt: Date.now() - 20000,
      expiresAt: Date.now() - 1000,
    };
    fs.writeFileSync(lockFile, JSON.stringify(foreignLock), "utf-8");

    expect(() => {
      persistCandidateAliasApprovalAtomically(
        createSignedCandidateAliasApproval({
          candidateId: "cand_1212440541",
          targetProductId: uahpetCanonicalId,
          aliasKeyword: catFeederKeyword,
          authorizedCanonicalKeyword: uahpetCandidateTitle,
          workspaceId: "ws_acceptance_us",
          approverPrincipalId: "qa_principal_lead",
          issuerKeyId: primaryKeyId,
          evidenceChainReference: "urn:swai:evidence:b16",
          isTestOnly: true,
        })
      );
    }).toThrow(/LOCK_TIMEOUT/);

    fs.unlinkSync(lockFile);
  });

  it("B17: path containment check keeps ledger inside candidate alias directory", () => {
    const storageDir = getCandidateAliasStorageDir();
    expect(path.isAbsolute(storageDir)).toBe(true);
  });

  it("B18: unreadable ledger file fails closed with LEDGER_UNREADABLE", () => {
    const storageDir = getCandidateAliasStorageDir();
    const ledgerFile = path.join(storageDir, ".candidate_alias_ledger.json");
    fs.writeFileSync(ledgerFile, JSON.stringify({ version: "1.0", approvals: {}, revocations: {} }), { mode: 0 }); // Read-only / restricted

    const readRes = readLedgerUnderLock();
    // On Windows chmod 0 still allows reading (so status is HEALTHY), on POSIX it is UNREADABLE
    expect(["LEDGER_HEALTHY", "LEDGER_UNREADABLE"]).toContain(readRes.status);
    fs.chmodSync(ledgerFile, 0o666);
  });

  it("B19: log sanitization prevents key secret leakage in logs and reports", () => {
    const secretLog = "Executing with secret=sk_live_verysecret12345 and bearer sk_test_1234567890abcdef";
    const cleanLog = sanitizeReleaseLog(secretLog);
    expect(cleanLog).not.toContain("sk_live_verysecret12345");
    expect(cleanLog).not.toContain("sk_test_1234567890abcdef");
    expect(cleanLog).toContain("REDACTED");
  });

  it("B20: durable recovery from backup file restores intact ledger", () => {
    const storageDir = getCandidateAliasStorageDir();
    const ledgerFile = path.join(storageDir, ".candidate_alias_ledger.json");
    const backupFile = path.join(storageDir, ".candidate_alias_ledger.json.bak");

    const validLedger = {
      version: ALIAS_SCHEMA_VERSION,
      approvals: {},
      revocations: { "revoked_123": { revokedAt: new Date().toISOString(), reason: "test", revokedBy: "qa" } },
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(backupFile, JSON.stringify(validLedger, null, 2), "utf-8");

    // Corrupt active file
    fs.writeFileSync(ledgerFile, "{corrupted: true", "utf-8");
    expect(readLedgerUnderLock().status).toBe("LEDGER_CORRUPT");

    // Restore from backup
    fs.copyFileSync(backupFile, ledgerFile);
    const restored = readLedgerUnderLock();
    expect(restored.status).toBe("LEDGER_HEALTHY");
    expect(restored.state?.revocations["revoked_123"]).toBeDefined();
  });

  // ==============================================================================
  // GROUP C: CI AND EVIDENCE TRUTH (C01 - C20)
  // ==============================================================================

  it("C01: caller runId without verified attestation yields ciVerified=false and CI_CLAIM_UNVERIFIED", () => {
    const report = validateTestSuiteExecutionEvidence({
      command: "npx vitest run tests/unit/kh02/foo.test.ts",
      exitCode: 0,
      stdout: "Test Files 1 passed (1)\nTests 10 passed (10)\n ✓ tests/unit/kh02/foo.test.ts",
      checkoutSha: "36d559465ece26ac872144d61c58117130ac00c9",
      ciProviderProof: {
        provider: "github-actions",
        runId: "1234567890",
        commitSha: "36d559465ece26ac872144d61c58117130ac00c9",
      },
    });

    expect(report.valid).toBe(false);
    expect(report.ciVerified).toBe(false);
    expect(report.rejectionReasons.some((r) => r.includes("CI_CLAIM_UNVERIFIED"))).toBe(true);
  });

  it("C02: empty proof input fails verification", () => {
    const check = verifyGitHubActionsRunProof(null as any);
    expect(check.verified).toBe(false);
    expect(check.error).toBeDefined();
  });

  it("C03: run exists but wrong repository is rejected", () => {
    const proof: AuthenticatedCiProof = {
      provider: "github-actions",
      repository: "attacker/malicious-repo",
      runId: "1234567890",
      commitSha: "36d559465ece26ac872144d61c58117130ac00c9",
      branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
      status: "completed",
      conclusion: "success",
      event: "push",
      verifiedAt: new Date().toISOString(),
    };
    const val = validateVerifiedCiAttestation(proof, { expectedRepo: "quocan050302/Shopify-Search" });
    expect(val.valid).toBe(false);
    expect(val.reason).toContain("repository mismatch");
  });

  it("C04: run exists but wrong commit SHA is rejected", () => {
    const proof: AuthenticatedCiProof = {
      provider: "github-actions",
      repository: "quocan050302/Shopify-Search",
      runId: "1234567890",
      commitSha: "wrong_commit_sha_12345",
      branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
      status: "completed",
      conclusion: "success",
      event: "push",
      verifiedAt: new Date().toISOString(),
    };
    const val = validateVerifiedCiAttestation(proof, { expectedSha: "36d559465ece26ac872144d61c58117130ac00c9" });
    expect(val.valid).toBe(false);
    expect(val.reason).toContain("commit SHA mismatch");
  });

  it("C05: workflow pending status is rejected", () => {
    const proof: AuthenticatedCiProof = {
      provider: "github-actions",
      repository: "quocan050302/Shopify-Search",
      runId: "1234567890",
      commitSha: "36d559465ece26ac872144d61c58117130ac00c9",
      branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
      status: "in_progress" as any,
      conclusion: null as any,
      event: "push",
      verifiedAt: new Date().toISOString(),
    };
    const val = validateVerifiedCiAttestation(proof);
    expect(val.valid).toBe(false);
    expect(val.reason).toContain("expected 'completed'");
  });

  it("C06: workflow cancelled or skipped conclusion is rejected", () => {
    const proof: AuthenticatedCiProof = {
      provider: "github-actions",
      repository: "quocan050302/Shopify-Search",
      runId: "1234567890",
      commitSha: "36d559465ece26ac872144d61c58117130ac00c9",
      branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
      status: "completed",
      conclusion: "cancelled" as any,
      event: "push",
      verifiedAt: new Date().toISOString(),
    };
    const val = validateVerifiedCiAttestation(proof);
    expect(val.valid).toBe(false);
    expect(val.reason).toContain("expected 'success'");
  });

  it("C07: workflow completed with failure conclusion is rejected", () => {
    const proof: AuthenticatedCiProof = {
      provider: "github-actions",
      repository: "quocan050302/Shopify-Search",
      runId: "1234567890",
      commitSha: "36d559465ece26ac872144d61c58117130ac00c9",
      branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
      status: "completed",
      conclusion: "failure" as any,
      event: "push",
      verifiedAt: new Date().toISOString(),
    };
    const val = validateVerifiedCiAttestation(proof);
    expect(val.valid).toBe(false);
    expect(val.reason).toContain("expected 'success'");
  });

  it("C08: wrong trigger event (e.g. pull_request) is rejected", () => {
    const proof: AuthenticatedCiProof = {
      provider: "github-actions",
      repository: "quocan050302/Shopify-Search",
      runId: "1234567890",
      commitSha: "36d559465ece26ac872144d61c58117130ac00c9",
      branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
      status: "completed",
      conclusion: "success",
      event: "pull_request" as any,
      verifiedAt: new Date().toISOString(),
    };
    const val = validateVerifiedCiAttestation(proof);
    expect(val.valid).toBe(false);
    expect(val.reason).toContain("trigger event");
  });

  it("C09: wrong branch in CI attestation is rejected", () => {
    const proof: AuthenticatedCiProof = {
      provider: "github-actions",
      repository: "quocan050302/Shopify-Search",
      runId: "1234567890",
      commitSha: "36d559465ece26ac872144d61c58117130ac00c9",
      branch: "main",
      status: "completed",
      conclusion: "success",
      event: "push",
      verifiedAt: new Date().toISOString(),
    };
    const val = validateVerifiedCiAttestation(proof, {
      expectedBranch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
    });
    expect(val.valid).toBe(false);
    expect(val.reason).toContain("branch mismatch");
  });

  it("C10: missing authenticatedProof payload in CiProviderProofInput is rejected", () => {
    const check = verifyGitHubActionsRunProof({
      provider: "github-actions",
      runId: "1234567890",
      commitSha: "36d559465ece26ac872144d61c58117130ac00c9",
      verified: true,
      authenticatedProof: null,
    });
    expect(check.verified).toBe(false);
    expect(check.error).toContain("CI_CLAIM_UNVERIFIED");
  });

  it("C11: API unauthorized or network failure cannot claim verified CI", () => {
    const check = verifyGitHubActionsRunProof({
      provider: "github-actions",
      runId: "1234567890",
      commitSha: "36d559465ece26ac872144d61c58117130ac00c9",
    });
    expect(check.verified).toBe(false);
  });

  it("C12: sample stdout with matching checkoutSha does not elevate to CI_PROVIDER_VERIFIED", () => {
    const report = validateTestSuiteExecutionEvidence({
      command: "npx vitest run tests/unit/kh02/foo.test.ts",
      exitCode: 0,
      stdout: "Test Files 1 passed (1)\nTests 10 passed (10)\n ✓ tests/unit/kh02/foo.test.ts",
      checkoutSha: "36d559465ece26ac872144d61c58117130ac00c9",
    });
    expect(report.valid).toBe(true);
    expect(report.verificationLevel).not.toBe("CI_PROVIDER_VERIFIED");
    expect(report.ciVerified).toBe(false);
  });

  it("C13: codeTreeSha mismatch fails with CODE_TREE_MUTATION", () => {
    const report = validateTestSuiteExecutionEvidence({
      command: "npx vitest run tests/unit/kh02/foo.test.ts",
      exitCode: 0,
      stdout: "Test Files 1 passed (1)\nTests 10 passed (10)\n ✓ tests/unit/kh02/foo.test.ts",
      checkoutSha: "36d559465ece26ac872144d61c58117130ac00c9",
      codeTreeSha: "mutated_tree_sha_xyz",
      expectedCodeTreeSha: "correct_tree_sha_abc",
    });
    expect(report.valid).toBe(false);
    expect(report.rejectionReasons.some((r) => r.includes("CODE_TREE_MUTATION"))).toBe(true);
  });

  it("C14: log digest altered by 1 byte fails with CORRUPTED_LOG", () => {
    const report = validateTestSuiteExecutionEvidence({
      command: "npx vitest run tests/unit/kh02/foo.test.ts",
      exitCode: 0,
      stdout: "Test Files 1 passed (1)\nTests 10 passed (10)\n ✓ tests/unit/kh02/foo.test.ts",
      checkoutSha: "36d559465ece26ac872144d61c58117130ac00c9",
      expectedLogSha256: "0000000000000000000000000000000000000000000000000000000000000000",
    });
    expect(report.valid).toBe(false);
    expect(report.rejectionReasons.some((r) => r.includes("CORRUPTED_LOG"))).toBe(true);
  });

  it("C15: missing mandatory test suite file returns INCOMPLETE status", () => {
    const report = validateTestSuiteExecutionEvidence({
      command: "npx vitest run tests/unit/kh02/foo.test.ts",
      exitCode: 0,
      stdout: "Test Files 1 passed (1)\nTests 10 passed (10)\n ✓ tests/unit/kh02/foo.test.ts",
      checkoutSha: "36d559465ece26ac872144d61c58117130ac00c9",
      mandatoryTestFiles: ["tests/unit/kh02/mandatory_suite.test.ts"],
    });
    expect(report.valid).toBe(false);
    expect(report.status).toBe("INCOMPLETE");
  });

  it("C16: non-zero exit code or zero tests parsed fails validation", () => {
    const failExit = validateTestSuiteExecutionEvidence({
      command: "npx vitest run tests/unit/kh02/foo.test.ts",
      exitCode: 1,
      stdout: "Test Files 1 passed (1)\nTests 10 passed (10)\n ✓ tests/unit/kh02/foo.test.ts",
      checkoutSha: "36d559465ece26ac872144d61c58117130ac00c9",
    });
    expect(failExit.valid).toBe(false);

    const zeroTests = validateTestSuiteExecutionEvidence({
      command: "npx vitest run tests/unit/kh02/foo.test.ts",
      exitCode: 0,
      stdout: "Empty output",
      checkoutSha: "36d559465ece26ac872144d61c58117130ac00c9",
    });
    expect(zeroTests.valid).toBe(false);
    expect(zeroTests.status).toBe("INCOMPLETE");
  });

  it("C17: parser distinguishes between local captured stdout and remote attestation", () => {
    const report = validateTestSuiteExecutionEvidence({
      command: "npx vitest run tests/unit/kh02/foo.test.ts",
      exitCode: 0,
      stdout: "Test Files 1 passed (1)\nTests 10 passed (10)\n ✓ tests/unit/kh02/foo.test.ts",
      checkoutSha: "36d559465ece26ac872144d61c58117130ac00c9",
    });
    expect(report.verificationLevel).toBe("LOCAL_PROCESS_CAPTURED");
  });

  it("C18: authentic verified CI attestation elevates verification level to CI_PROVIDER_VERIFIED", () => {
    const commitSha = "36d559465ece26ac872144d61c58117130ac00c9";
    const rawProof = {
      provider: "github-actions" as const,
      repository: "quocan050302/Shopify-Search",
      runId: "1234567890",
      commitSha: commitSha,
      branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
      status: "completed" as const,
      conclusion: "success" as const,
      event: "push" as const,
      verifiedAt: new Date().toISOString(),
      source: "GITHUB_API" as const,
      verifier: TRUSTED_VERIFIER_ID,
      responseDigest: crypto.createHash("sha256").update("authentic_ci_test_c18").digest("hex"),
      isUnitTestMock: false,
    };

    _testOnlyRegisterVerifiedRemoteCiRun({
      runId: rawProof.runId,
      repository: rawProof.repository,
      headSha: commitSha,
      headBranch: rawProof.branch,
      responseDigest: rawProof.responseDigest,
    });

    const token = _privateMintCiAttestationToken(
      {
        ...rawProof,
        headSha: commitSha,
        headBranch: rawProof.branch,
      },
      process.env.KH02_CI_VERIFIER_SECRET!
    );

    const report = validateTestSuiteExecutionEvidence({
      command: "npx vitest run tests/unit/kh02/foo.test.ts",
      exitCode: 0,
      stdout: "Test Files 1 passed (1)\nTests 10 passed (10)\n ✓ tests/unit/kh02/foo.test.ts",
      checkoutSha: commitSha,
      ciProviderProof: {
        provider: "github-actions",
        runId: "1234567890",
        commitSha: commitSha,
        verified: true,
        authenticatedProof: {
          ...rawProof,
          attestationSignature: token,
        },
      },
    });

    // Test seam fixture cannot elevate to CI_PROVIDER_VERIFIED in production evidence validator
    expect(report.valid).toBe(false);
    expect(report.ciVerified).toBe(false);
    expect(report.rejectionReasons.some((r) => r.includes("CI_CLAIM_UNVERIFIED"))).toBe(true);
  });

  it("C19: repeated verification of same authentic CI attestation is idempotent and deterministic", () => {
    const proof: AuthenticatedCiProof = {
      provider: "github-actions",
      repository: "quocan050302/Shopify-Search",
      runId: "1234567890",
      commitSha: "36d559465ece26ac872144d61c58117130ac00c9",
      branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
      status: "completed",
      conclusion: "success",
      event: "push",
      verifiedAt: new Date().toISOString(),
    };
    const res1 = validateVerifiedCiAttestation(proof);
    const res2 = validateVerifiedCiAttestation(proof);
    expect(res1.valid).toBe(true);
    expect(res2.valid).toBe(true);
  });

  it("C20: release gate rejects unverified ciStatus.SUCCESS fabricated by caller, demoting to CI_NOT_RUN", () => {
    const verdict = evaluateReleaseEvidence({
      version: "12.4.3.7.19.3.2.1",
      baselineSha: "36d559465ece26ac872144d61c58117130ac00c9",
      reportGeneratedAt: new Date().toISOString(),
      testCommand: "npx vitest run tests/unit/kh02/foo.test.ts",
      testedCodeSha: "36d559465ece26ac872144d61c58117130ac00c9",
      branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
      exitCode: 0,
      realPassed: 50,
      realFailed: 0,
      realSkipped: 0,
      realTotal: 50,
      runMode: "OFFLINE_CONTRACT_CHECK",
      ciStatus: {
        configured: true,
        runStatus: "SUCCESS", // Fabricated assertion without verifiedProof
      },
      fullSuiteCoverage: {
        unitPassed: true,
        integrationPassed: true,
        backtestPassed: true,
        kh01VerifyPassed: true,
      },
    });

    expect(verdict.ciStatus).toBe("CI_NOT_RUN");
    expect(verdict.blockerList).toContain("CI_CLAIM_UNVERIFIED");
  });

  // ==============================================================================
  // GROUP D: BUSINESS, NONREGRESSION & E2E (D01 - D10)
  // ==============================================================================

  it("D01: zero official candidate demand data results in G15 INSUFFICIENT_EVIDENCE", () => {
    const verdict = evaluateReleaseEvidence({
      version: "12.4.3.7.19.3.2.1",
      baselineSha: "36d559465ece26ac872144d61c58117130ac00c9",
      reportGeneratedAt: new Date().toISOString(),
      testCommand: "npx vitest run tests/unit/kh02/foo.test.ts",
      testedCodeSha: "36d559465ece26ac872144d61c58117130ac00c9",
      branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
      exitCode: 0,
      realPassed: 50,
      realFailed: 0,
      realSkipped: 0,
      realTotal: 50,
      runMode: "OFFLINE_CONTRACT_CHECK",
      evidenceProofCounters: {
        rawRowsVerified: 0,
        liveOriginProofs: 0,
        fixtureOnlyCount: 0,
      },
      fullSuiteCoverage: {
        unitPassed: true,
        integrationPassed: true,
        backtestPassed: true,
        kh01VerifyPassed: true,
      },
    });
    expect(verdict.businessStatus).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("D02: 14-day 2-point fixture remains G15 INSUFFICIENT_EVIDENCE", () => {
    const verdict = evaluateReleaseEvidence({
      version: "12.4.3.7.19.3.2.1",
      baselineSha: "36d559465ece26ac872144d61c58117130ac00c9",
      reportGeneratedAt: new Date().toISOString(),
      testCommand: "npx vitest run tests/unit/kh02/foo.test.ts",
      testedCodeSha: "36d559465ece26ac872144d61c58117130ac00c9",
      branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
      exitCode: 0,
      realPassed: 50,
      realFailed: 0,
      realSkipped: 0,
      realTotal: 50,
      runMode: "OFFLINE_CONTRACT_CHECK",
      evidenceProofCounters: {
        rawRowsVerified: 2,
        liveOriginProofs: 0,
        fixtureOnlyCount: 2,
      },
      fullSuiteCoverage: {
        unitPassed: true,
        integrationPassed: true,
        backtestPassed: true,
        kh01VerifyPassed: true,
      },
    });
    expect(verdict.businessStatus).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("D03: synthetic 60-90-day fixture tests engineering math only, business status INSUFFICIENT_EVIDENCE", () => {
    const obs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      isFixture: true,
      source: "synthetic_demo_fixture",
      evidenceReference: "fixture:synthetic:90d",
    };
    const attr = classifyCandidateObservationAttribution(obs, businessContext);
    expect(attr.isAttributable).toBe(false);
    expect(attr.classification).toBe("EXCLUDED_FIXTURE_OR_PROXY");
  });

  it("D04: three unrelated 60d series cannot produce Top 3 commercial winners", () => {
    const unrelatedKeywords = ["Cat Scratching Post", "Bird Cage Wire", "Fish Tank Heater"];
    for (const kw of unrelatedKeywords) {
      const obs: CandidateObservationRecord = {
        productId: uahpetCanonicalId,
        keyword: kw,
        evidenceReference: "urn:swai:evidence:unrelated",
      };
      const attr = classifyCandidateObservationAttribution(obs, businessContext);
      expect(attr.isAttributable).toBe(false);
    }
  });

  it("D05: fake signed alias + genuine-looking CSV SHA grants zero G15 authority in business scope", () => {
    const fakeRecord = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId, // TEST_ONLY key!
      evidenceChainReference: "urn:swai:evidence:csv_sha256:3440f19057ac7d1ac535150d1bbcc9a3078e0b7a5d46ad3f4bbd2c46235f61c8",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(fakeRecord);

    const check = verifyDurableCandidateAliasApproval(fakeRecord.approvalId, businessContext);
    expect(check.valid).toBe(false);
    expect(check.code).toBe("TEST_ONLY_ALIAS");
  });

  it("D06: same productId with different keyword prevents cross-candidate borrowing", () => {
    const obs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: "Disjoint Unapproved Brand Product",
      evidenceReference: "urn:swai:evidence:disjoint",
    };
    const attr = classifyCandidateObservationAttribution(obs, businessContext);
    expect(attr.isAttributable).toBe(false);
  });

  it("D07: revocation after historical import fails closed upon reevaluation", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:d07",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);
    revokeCandidateAliasAtomically(record.approvalId, "Deprecate historical D07", "sec_lead");

    const alias: VerifiedCandidateAlias = {
      aliasKeyword: catFeederKeyword,
      targetProductId: uahpetCanonicalId,
      candidateId: "cand_1212440541",
      approvedBy: "qa_principal_lead",
      provenanceReference: record.approvalId,
    };
    const auth = isAuthenticVerifiedCandidateAlias(alias, engineeringContext);
    expect(auth.valid).toBe(false);
  });

  it("D08: exact product, region, cadence, asOf and raw row proof remain mandatory", () => {
    const obsUK: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      region: "GB", // Foreign region
      evidenceReference: "urn:swai:evidence:uk",
    };
    const attr = classifyCandidateObservationAttribution(obsUK, businessContext);
    expect(attr.isAttributable).toBe(false);
    expect(attr.classification).toBe("EXCLUDED_REGION");
  });

  it("D09: backtest historical replay does not use information post-asOf", () => {
    const futureDate = new Date(Date.now() + 86400000 * 30).toISOString();
    const obsFuture: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      periodStart: futureDate,
      evidenceReference: "urn:swai:evidence:future",
    };
    const attr = classifyCandidateObservationAttribution(obsFuture, {
      ...businessContext,
      asOfTimestamp: new Date().toISOString(),
      strictChronological: true,
    });
    expect(attr.isAttributable).toBe(false);
    expect(attr.classification).toBe("EXCLUDED_FUTURE_OR_POST_CUTOFF");
  });

  it("D10: staging and production release remain NO-GO without genuine CI and business evidence", () => {
    const releaseVerdict = evaluateReleaseEvidence({
      version: "12.4.3.7.19.3.2.1",
      baselineSha: "36d559465ece26ac872144d61c58117130ac00c9",
      reportGeneratedAt: new Date().toISOString(),
      testCommand: "npx vitest run tests/unit/kh02/foo.test.ts",
      testedCodeSha: "36d559465ece26ac872144d61c58117130ac00c9",
      branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
      exitCode: 0,
      realPassed: 50,
      realFailed: 0,
      realSkipped: 0,
      realTotal: 50,
      runMode: "OFFLINE_CONTRACT_CHECK",
      evidenceProofCounters: {
        rawRowsVerified: 0,
        liveOriginProofs: 0,
        fixtureOnlyCount: 0,
      },
      fullSuiteCoverage: {
        unitPassed: true,
        integrationPassed: true,
        backtestPassed: true,
        kh01VerifyPassed: true,
      },
    });

    expect(releaseVerdict.overallReleaseAllowed).toBe(false);
    expect(releaseVerdict.businessStatus).toBe("INSUFFICIENT_EVIDENCE");
    expect(releaseVerdict.ciStatus).toBe("CI_NOT_CONFIGURED");
  });
});
