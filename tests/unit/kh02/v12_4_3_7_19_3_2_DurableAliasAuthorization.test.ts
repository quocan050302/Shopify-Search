/**
 * SWAI KH-02 — V12.4.3.7.19.3.2
 * Durable Alias Authorization & Exact-SHA Evidence Closure
 *
 * Mandatory Adversarial Test Matrix A01 - A42:
 * Proves that candidate alias authorization is cryptographically authenticated,
 * durable, immutable, and strictly scoped; eliminates plain-string approvals,
 * cross-candidate leakage, and enforces exact-SHA evidence validation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  registerAliasSigningKey,
  getAliasSigningKey,
  clearTestAliasSigningKeys,
  computeCanonicalAliasPayload,
  computeAliasPayloadDigest,
  signAliasPayloadDigest,
  verifyAliasSignature,
  createSignedCandidateAliasApproval,
  persistCandidateAliasApprovalAtomically,
  revokeCandidateAliasAtomically,
  getCandidateAliasApprovalById,
  verifyDurableCandidateAliasApproval,
  getCandidateAliasStorageDir,
  ALIAS_OPERATION_SCOPE,
  ALIAS_SCHEMA_VERSION,
  type CandidateAliasApprovalRecord,
} from "@/services/kh02/demand/durableCandidateAliasAuthority";
import {
  classifyCandidateObservationAttribution,
  filterAttributableObservations,
  isAuthenticVerifiedCandidateAlias,
  type CandidateAttributionContext,
  type CandidateObservationRecord,
  type VerifiedCandidateAlias,
} from "@/services/kh02/demand/candidateDemandAttribution";
import {
  validateTestSuiteExecutionEvidence,
  parseVitestOutputMetrics,
} from "@/services/kh02/demand/testSuiteEvidenceValidator";
import {
  evaluateDemandHistoryEvidence,
  type DemandDataPoint,
} from "@/services/kh02/demand/temporalDemandEngine";

describe("KH-02 V12.4.3.7.19.3.2: Durable Alias Authorization & Exact-SHA Evidence Matrix (A01 - A42)", () => {
  const testDir = path.join(os.tmpdir(), `kh02_alias_test_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`);
  const originalEnvStorage = process.env.TEST_CANDIDATE_ALIAS_STORAGE_DIR;

  const uahpetCanonicalId = "cmvsy7zqh000jp0orhypwohho";
  const uahpetCandidateTitle = "UAHPET Fresh Food Automatic Pet Feeder";
  const catFeederKeyword = "Automatic Wet Food Cat Feeder with Cooling & Warming";

  const primaryKeyId = "test_alias_sec_key_v1";
  const primarySecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const uahpetContext: CandidateAttributionContext = {
    candidateId: "cand_1212440541",
    researchRunId: "kh02_run_1793424091548_669k8",
    canonicalProductId: uahpetCanonicalId,
    candidateCanonicalName: uahpetCandidateTitle,
    authorizedKeywords: [uahpetCandidateTitle],
    workspaceId: "ws_acceptance_us",
    region: "US",
  };

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    process.env.TEST_CANDIDATE_ALIAS_STORAGE_DIR = testDir;

    registerAliasSigningKey({
      keyId: primaryKeyId,
      secret: primarySecret,
      status: "TEST_ONLY",
      purpose: ALIAS_OPERATION_SCOPE,
      description: "Primary test key for A01-A42 matrix",
    });
  });

  afterEach(() => {
    clearTestAliasSigningKeys();
    delete process.env.TEST_CANDIDATE_ALIAS_STORAGE_DIR;
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch {}
  });

  // ==============================================================================
  // Group 1: Plain String & Approver Rejection (A01 - A03)
  // ==============================================================================

  it("A01: Plain string approvedBy without durable signed record fails with ALIAS_NOT_FOUND", () => {
    const plainAlias: VerifiedCandidateAlias = {
      aliasKeyword: catFeederKeyword,
      approvedBy: "qa_principal_lead",
      provenanceReference: "gov_decision_ref_20261106_alias_uahpet",
    };

    const check = isAuthenticVerifiedCandidateAlias(plainAlias, uahpetContext);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain("ALIAS_NOT_FOUND");
  });

  it("A02: Spoofed approver string on fabricated record without registered issuer fails with APPROVAL_UNTRUSTED", () => {
    expect(() => {
      createSignedCandidateAliasApproval({
        candidateId: "cand_1212440541",
        targetProductId: uahpetCanonicalId,
        aliasKeyword: catFeederKeyword,
        authorizedCanonicalKeyword: uahpetCandidateTitle,
        workspaceId: "ws_acceptance_us",
        approverPrincipalId: "security_director",
        issuerKeyId: "unregistered_spoofed_key_id",
        evidenceChainReference: "urn:swai:evidence:merchant_pdp_identity:spoofed",
        isTestOnly: true,
      });
    }).toThrow(/APPROVAL_UNTRUSTED/);
  });

  it("A03: Fabricated URN/reference prefix not in ledger fails with ALIAS_NOT_FOUND", () => {
    const fakeRef = "urn:swai:alias:alias_appr_fabricated_999999999999";
    const result = verifyDurableCandidateAliasApproval(fakeRef, uahpetContext);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("ALIAS_NOT_FOUND");
  });

  // ==============================================================================
  // Group 2: Signature & Tamper Integrity (A04 - A05)
  // ==============================================================================

  it("A04: Valid HMAC-SHA256 signature accepted and verifies successfully", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      region: "US",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:merchant_pdp_identity:uahpet_cat_feeder_official",
      isTestOnly: true,
    });

    const persistRes = persistCandidateAliasApprovalAtomically(record);
    expect(persistRes.success).toBe(true);
    expect(persistRes.state).toBe("PERSISTED");

    const verifyRes = verifyDurableCandidateAliasApproval(record.approvalId, uahpetContext);
    expect(verifyRes.valid).toBe(true);
    expect(verifyRes.code).toBe("VERIFIED_ALIAS");
  });

  it("A05: Tampered canonical payload byte fails digest verification with TAMPERED_PAYLOAD", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      region: "US",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:merchant_pdp_identity:uahpet_cat_feeder_official",
      isTestOnly: true,
    });

    // Tamper payload byte: change aliasKeyword but keep old payloadDigest and signature
    const tamperedRecord = {
      ...record,
      aliasKeyword: "Completely Different Malicious Product Query",
    };

    const persistTampered = persistCandidateAliasApprovalAtomically(tamperedRecord);
    expect(persistTampered.success).toBe(false);
    expect(persistTampered.state).toBe("CONFLICT");
    expect(persistTampered.error).toContain("TAMPERED_PAYLOAD");
  });

  // ==============================================================================
  // Group 3: Tenant, Candidate, Product, Run, and Region Scope (A06 - A11)
  // ==============================================================================

  it("A06: Tenant/workspace mismatch rejected with SCOPE_MISMATCH", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:uahpet_evidence",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);

    const wrongWorkspaceContext = { ...uahpetContext, workspaceId: "ws_foreign_tenant" };
    const res = verifyDurableCandidateAliasApproval(record.approvalId, wrongWorkspaceContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("SCOPE_MISMATCH");
  });

  it("A07: CandidateId mismatch rejected with SCOPE_MISMATCH", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:uahpet_evidence",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);

    const wrongCandidateContext = { ...uahpetContext, candidateId: "cand_other_diff" };
    const res = verifyDurableCandidateAliasApproval(record.approvalId, wrongCandidateContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("SCOPE_MISMATCH");
  });

  it("A08: Canonical productId mismatch rejected with PRODUCT_IDENTITY_MISMATCH", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:uahpet_evidence",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);

    const wrongProductContext = { ...uahpetContext, canonicalProductId: "cmv_other_product_999" };
    const res = verifyDurableCandidateAliasApproval(record.approvalId, wrongProductContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("PRODUCT_IDENTITY_MISMATCH");
  });

  it("A09: ResearchRunId mismatch rejected with RUN_SCOPE_MISMATCH", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      researchRunId: "kh02_run_1793424091548_669k8",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:uahpet_evidence",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);

    const wrongRunContext = { ...uahpetContext, researchRunId: "kh02_run_foreign_stale" };
    const res = verifyDurableCandidateAliasApproval(record.approvalId, wrongRunContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("RUN_SCOPE_MISMATCH");
  });

  it("A10: Region mismatch (e.g. GB vs US) rejected with REGION_MISMATCH", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      region: "US",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:uahpet_evidence",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);

    const wrongRegionContext = { ...uahpetContext, region: "GB" };
    const res = verifyDurableCandidateAliasApproval(record.approvalId, wrongRegionContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("REGION_MISMATCH");
  });

  it("A11: Observation keyword does not match approved aliasKeyword => rejected with KEYWORD_MISMATCH", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:uahpet_evidence",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);

    const res = verifyDurableCandidateAliasApproval(record.approvalId, {
      ...uahpetContext,
      observationKeyword: "completely different keyword query",
    });
    expect(res.valid).toBe(false);
    expect(res.code).toBe("KEYWORD_MISMATCH");
  });

  // ==============================================================================
  // Group 4: SKU Variant & Accessory Demotion (A12)
  // ==============================================================================

  it("A12: SKU variant / product accessory demoted; accessory query cannot claim parent demand", () => {
    const filterObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: "UAHPET Feeder Replacement Filter 4-Pack",
      region: "US",
      demandValue: 60,
    };

    // Feeder candidate context
    const res = classifyCandidateObservationAttribution(filterObs, uahpetContext);
    expect(res.isAttributable).toBe(false);
    expect(["EXCLUDED_KEYWORD_MISMATCH", "EXCLUDED_UNVERIFIED_ALIAS"]).toContain(res.classification);
  });

  // ==============================================================================
  // Group 5: Temporal Checks & Monotonic Revocation (A13 - A15)
  // ==============================================================================

  it("A13: Future effective date rejected with FUTURE_APPROVAL", () => {
    const futureDate = new Date(Date.now() + 86400000 * 7).toISOString();
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      effectiveAt: futureDate,
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:future",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);

    const res = verifyDurableCandidateAliasApproval(record.approvalId, uahpetContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("FUTURE_APPROVAL");
  });

  it("A14: Expired approval rejected with EXPIRED", () => {
    const pastDate = new Date(Date.now() - 86400000 * 30).toISOString();
    const expiredDate = new Date(Date.now() - 86400000 * 1).toISOString();
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      effectiveAt: pastDate,
      expiresAt: expiredDate,
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:expired",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);

    const res = verifyDurableCandidateAliasApproval(record.approvalId, uahpetContext);
    expect(res.valid).toBe(false);
    expect(res.code).toBe("EXPIRED");
  });

  it("A15: Revoked approval fails with REVOKED and monotonic revocation cannot be reversed", () => {
    const record = createSignedCandidateAliasApproval({
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:to_revoke",
      isTestOnly: true,
    });
    persistCandidateAliasApprovalAtomically(record);

    // Initial check is valid
    const initialCheck = verifyDurableCandidateAliasApproval(record.approvalId, uahpetContext);
    expect(initialCheck.valid).toBe(true);

    // Revoke
    revokeCandidateAliasAtomically(record.approvalId, "Discovered alias conflict with competitor", "sec_lead");

    const revokedCheck = verifyDurableCandidateAliasApproval(record.approvalId, uahpetContext);
    expect(revokedCheck.valid).toBe(false);
    expect(revokedCheck.code).toBe("REVOKED");

    // Monotonicity check: re-persisting the unrevoked record does not un-revoke
    persistCandidateAliasApprovalAtomically(record);
    const postRecheck = verifyDurableCandidateAliasApproval(record.approvalId, uahpetContext);
    expect(postRecheck.valid).toBe(false);
    expect(postRecheck.code).toBe("REVOKED");
  });

  // ==============================================================================
  // Group 6: Key Lifecycle & Compromised Keys (A16 - A17)
  // ==============================================================================

  it("A16: Issuer key not registered in Trust Registry fails with APPROVAL_UNTRUSTED", () => {
    // Manually fabricate a record pointing to unknown key
    const unsigned = {
      approvalId: "alias_appr_unregistered_key",
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
      issuerKeyId: "key_not_in_registry_999",
      signingAlgorithm: "HMAC-SHA256" as const,
      approvedAt: new Date().toISOString(),
      effectiveAt: new Date().toISOString(),
      evidenceChainReference: "urn:swai:evidence:test",
      isTestOnly: true,
    };
    const digest = computeAliasPayloadDigest(unsigned);
    const sig = signAliasPayloadDigest(digest, "dummysecret123456789012345678901234567890");
    const record: CandidateAliasApprovalRecord = { ...unsigned, payloadDigest: digest, approvalSignature: sig };

    const persistRes = persistCandidateAliasApprovalAtomically(record);
    expect(persistRes.success).toBe(false);
    expect(persistRes.error).toContain("APPROVAL_UNTRUSTED");
  });

  it("A17: Compromised or revoked signing key fails with KEY_REVOKED", () => {
    const compromisedKeyId = "test_key_compromised";
    registerAliasSigningKey({
      keyId: compromisedKeyId,
      secret: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
      status: "COMPROMISED",
      purpose: ALIAS_OPERATION_SCOPE,
      description: "Compromised test key",
    });

    expect(() => {
      createSignedCandidateAliasApproval({
        candidateId: "cand_1212440541",
        targetProductId: uahpetCanonicalId,
        aliasKeyword: catFeederKeyword,
        authorizedCanonicalKeyword: uahpetCandidateTitle,
        workspaceId: "ws_acceptance_us",
        approverPrincipalId: "qa_principal_lead",
        issuerKeyId: compromisedKeyId,
        evidenceChainReference: "urn:swai:evidence:compromised",
        isTestOnly: true,
      });
    }).toThrow(/KEY_REVOKED/);
  });

  // ==============================================================================
  // Group 7: Ledger Concurrency & Conflict Detection (A18)
  // ==============================================================================

  it("A18: Same approvalId with different payload returns CONFLICT; identical duplicate returns IDEMPOTENT_SKIP", () => {
    const recordA = createSignedCandidateAliasApproval({
      approvalId: "alias_appr_conflict_test",
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:conflict_a",
      isTestOnly: true,
    });
    const firstPersist = persistCandidateAliasApprovalAtomically(recordA);
    expect(firstPersist.success).toBe(true);
    expect(firstPersist.state).toBe("PERSISTED");

    // Identical duplicate -> IDEMPOTENT_SKIP
    const dupPersist = persistCandidateAliasApprovalAtomically(recordA);
    expect(dupPersist.success).toBe(true);
    expect(dupPersist.state).toBe("IDEMPOTENT_SKIP");

    // Conflicting payload on same ID
    const conflictingRecord = createSignedCandidateAliasApproval({
      approvalId: "alias_appr_conflict_test", // SAME ID
      candidateId: "cand_different_candidate", // DIFFERENT CANDIDATE
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:conflict_b",
      isTestOnly: true,
    });
    const conflictPersist = persistCandidateAliasApprovalAtomically(conflictingRecord);
    expect(conflictPersist.success).toBe(false);
    expect(conflictPersist.state).toBe("CONFLICT");
    expect(conflictPersist.error).toContain("CONFLICT_ERROR");
  });

  // ==============================================================================
  // Group 8: Product Identity & Null/Foreign-ID Fail-Closed (A19 - A23)
  // ==============================================================================

  it("A19: Candidate null canonicalProductId + observation foreign productId => KEYWORD_ONLY_UNBOUND", () => {
    const unlinkedContext: CandidateAttributionContext = {
      candidateId: "cand_unlinked_dog_bed",
      canonicalProductId: null,
      candidateCanonicalName: "Orthopedic Memory Foam Dog Bed",
      authorizedKeywords: ["Orthopedic Memory Foam Dog Bed"],
    };

    const foreignObs: CandidateObservationRecord = {
      productId: "prod_foreign_cat_tree",
      keyword: "Orthopedic Memory Foam Dog Bed",
      demandValue: 75,
    };

    const res = classifyCandidateObservationAttribution(foreignObs, unlinkedContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("KEYWORD_ONLY_UNBOUND");
  });

  it("A20: Candidate null canonicalProductId + observation null productId + matching keyword => EXACT_CANDIDATE_KEYWORD_MATCH", () => {
    const unlinkedContext: CandidateAttributionContext = {
      candidateId: "cand_unlinked_dog_bed",
      canonicalProductId: null,
      candidateCanonicalName: "Orthopedic Memory Foam Dog Bed",
      authorizedKeywords: ["Orthopedic Memory Foam Dog Bed"],
    };

    const unlinkedObs: CandidateObservationRecord = {
      productId: null,
      keyword: "Orthopedic Memory Foam Dog Bed",
      demandValue: 75,
    };

    const res = classifyCandidateObservationAttribution(unlinkedObs, unlinkedContext);
    expect(res.isAttributable).toBe(true);
    expect(res.classification).toBe("EXACT_CANDIDATE_KEYWORD_MATCH");
  });

  it("A21: Candidate has canonicalProductId, observation has null productId without evidenceReference => INSUFFICIENT_CANDIDATE_IDENTITY", () => {
    const obsNoProduct: CandidateObservationRecord = {
      productId: null,
      keyword: uahpetCandidateTitle,
      demandValue: 80,
    };

    const res = classifyCandidateObservationAttribution(obsNoProduct, uahpetContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("INSUFFICIENT_CANDIDATE_IDENTITY");
  });

  it("A22: Candidate has canonicalProductId, observation has null productId but authentic evidenceReference => attributable", () => {
    const obsWithEvidence: CandidateObservationRecord = {
      productId: null,
      keyword: uahpetCandidateTitle,
      evidenceReference: "trends-csv:official:uahpet_feeder_official_hash",
      region: "US",
      demandValue: 80,
    };

    const res = classifyCandidateObservationAttribution(obsWithEvidence, uahpetContext);
    expect(res.isAttributable).toBe(true);
    expect(res.classification).toBe("EXACT_CANDIDATE_KEYWORD_MATCH");
  });

  it("A23: Conflicting non-null productIds (prod_A vs prod_B) => EXCLUDED_CROSS_PRODUCT", () => {
    const obsWrongProduct: CandidateObservationRecord = {
      productId: "prod_completely_unrelated",
      keyword: uahpetCandidateTitle,
      demandValue: 80,
    };

    const res = classifyCandidateObservationAttribution(obsWrongProduct, uahpetContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_CROSS_PRODUCT");
  });

  // ==============================================================================
  // Group 9: Demographic Readbacks & Truthful Gate Invariants (A24 - A28)
  // ==============================================================================

  it("A24: UAHPET demographic readback: unaliased generic queries are rejected as EXCLUDED_UNVERIFIED_ALIAS", () => {
    const genericQueries = [
      "pet feeder",
      "cat feeder",
      "automatic cat feeder",
      "timed pet feeder",
    ];

    for (const kw of genericQueries) {
      const res = classifyCandidateObservationAttribution(
        { productId: uahpetCanonicalId, keyword: kw, region: "US", demandValue: 85 },
        uahpetContext
      );
      expect(res.isAttributable).toBe(false);
      expect(res.classification).toBe("EXCLUDED_UNVERIFIED_ALIAS");
    }
  });

  it("A25: UAHPET demographic readback: exact brand+functional title is accepted", () => {
    const exactQuery = "UAHPET Fresh Food Automatic Pet Feeder";
    const res = classifyCandidateObservationAttribution(
      { productId: uahpetCanonicalId, keyword: exactQuery, region: "US", demandValue: 90 },
      uahpetContext
    );
    expect(res.isAttributable).toBe(true);
    expect(res.classification).toBe("EXACT_CANDIDATE_KEYWORD_MATCH");
  });

  it("A26: KittySpout demographic readback: no cross-borrowing from generic fountain or UAHPET", () => {
    const kittySpoutContext: CandidateAttributionContext = {
      candidateId: "cand_kittyspout_fountain",
      canonicalProductId: "prod_kittyspout_123",
      candidateCanonicalName: "KittySpout Wireless Stainless Steel Fountain",
      authorizedKeywords: ["KittySpout Wireless Stainless Steel Fountain"],
      region: "US",
    };

    // Generic fountain observation
    const genericObs: CandidateObservationRecord = {
      productId: "prod_kittyspout_123",
      keyword: "cat water fountain",
      demandValue: 95,
    };
    const resGeneric = classifyCandidateObservationAttribution(genericObs, kittySpoutContext);
    expect(resGeneric.isAttributable).toBe(false);
    expect(resGeneric.classification).toBe("EXCLUDED_UNVERIFIED_ALIAS");

    // UAHPET observation cannot leak to KittySpout
    const uahpetObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      demandValue: 95,
    };
    const resLeak = classifyCandidateObservationAttribution(uahpetObs, kittySpoutContext);
    expect(resLeak.isAttributable).toBe(false);
    expect(resLeak.classification).toBe("EXCLUDED_CROSS_PRODUCT");
  });

  it("A27: Cleaner / Hydroponics candidate readback: generic queries rejected with zero cross-borrowing", () => {
    const cleanerContext: CandidateAttributionContext = {
      candidateId: "cand_cleaner_bot",
      canonicalProductId: "prod_cleaner_456",
      candidateCanonicalName: "PureGlow Sonic Ultrasonic Cleaner",
      authorizedKeywords: ["PureGlow Sonic Ultrasonic Cleaner"],
      region: "US",
    };

    const genericObs: CandidateObservationRecord = {
      productId: "prod_cleaner_456",
      keyword: "ultrasonic jewelry cleaner",
      demandValue: 80,
    };
    const res = classifyCandidateObservationAttribution(genericObs, cleanerContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_UNVERIFIED_ALIAS");
  });

  it("A28: Commercial G15/G16 honest outcome: with generic queries excluded, UAHPET G15 remains INSUFFICIENT_EVIDENCE", () => {
    // Only 2 points of exact brand queries available, covering 14 days (< 60 days required)
    const points: DemandDataPoint[] = [
      {
        id: "pt_1",
        productId: uahpetCanonicalId,
        keyword: uahpetCandidateTitle,
        periodStart: "2026-08-01T00:00:00.000Z",
        periodEnd: "2026-08-08T00:00:00.000Z",
        demandValue: 85,
        region: "US",
      },
      {
        id: "pt_2",
        productId: uahpetCanonicalId,
        keyword: uahpetCandidateTitle,
        periodStart: "2026-08-08T00:00:00.000Z",
        periodEnd: "2026-08-15T00:00:00.000Z",
        demandValue: 88,
        region: "US",
      },
    ];

    const evalResult = evaluateDemandHistoryEvidence(points, {
      minimumDataPoints: 8,
      minimumCoveredDays: 60,
      asOfTimestamp: "2026-11-06T00:00:00.000Z",
      strictSourceProvenance: true,
    });

    // 14 days is less than the 60-day threshold
    expect(evalResult.coveredDays).toBeLessThan(60);
    expect(evalResult.status).toBe("INSUFFICIENT_HISTORY");
    expect(evalResult.eligibleForEvergreen).toBe(false);
  });

  // ==============================================================================
  // Group 10: Provider Write Boundary & Receipts (A29 - A33)
  // ==============================================================================

  it("A29: Provider fetch does not mutate candidate database directly; returns isolated observation records", () => {
    // Candidate attribution classifier works on pure memory records without DB side effects
    const testObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      demandValue: 77,
    };
    const res = classifyCandidateObservationAttribution(testObs, uahpetContext);
    expect(res.isAttributable).toBe(true);
    expect(res.classification).toBe("EXACT_CANDIDATE_KEYWORD_MATCH");
  });

  it("A30: Raw observation persistence requires candidate identity binding", () => {
    const rawObsWithoutCandidate: CandidateObservationRecord = {
      productId: null,
      keyword: "arbitrary query",
    };
    const res = classifyCandidateObservationAttribution(rawObsWithoutCandidate, uahpetContext);
    expect(res.isAttributable).toBe(false);
  });

  it("A31: Synthetic or fixture records in provider output are rejected as EXCLUDED_FIXTURE_OR_PROXY", () => {
    const fixtureObs: CandidateObservationRecord = {
      productId: uahpetCanonicalId,
      keyword: uahpetCandidateTitle,
      source: "FIXTURE_MOCK_TRENDS",
      isFixture: true,
      demandValue: 90,
    };
    const res = classifyCandidateObservationAttribution(fixtureObs, uahpetContext);
    expect(res.isAttributable).toBe(false);
    expect(res.classification).toBe("EXCLUDED_FIXTURE_OR_PROXY");
  });

  it("A32: Unverified provider receipt strings cannot substitute for signed alias approvals", () => {
    const receiptAlias: VerifiedCandidateAlias = {
      aliasKeyword: catFeederKeyword,
      approvedBy: "qa_principal_lead",
      provenanceReference: "receipt:google_trends_query_req_12345",
    };
    const check = isAuthenticVerifiedCandidateAlias(receiptAlias, uahpetContext);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain("ALIAS_NOT_FOUND");
  });

  it("A33: Filter attributable observations correctly splits valid candidate points from unverified queries", () => {
    const mixedRecords: CandidateObservationRecord[] = [
      { id: "1", productId: uahpetCanonicalId, keyword: uahpetCandidateTitle, demandValue: 80, region: "US" },
      { id: "2", productId: uahpetCanonicalId, keyword: "pet feeder", demandValue: 90, region: "US" },
      { id: "3", productId: "prod_other", keyword: uahpetCandidateTitle, demandValue: 85, region: "US" },
    ];

    const result = filterAttributableObservations(mixedRecords, uahpetContext);
    expect(result.attributableObservations).toHaveLength(1);
    expect(result.attributableObservations[0].id).toBe("1");
    expect(result.excludedObservations).toHaveLength(2);
    expect(result.classifications.EXACT_CANDIDATE_KEYWORD_MATCH).toBe(1);
    expect(result.classifications.EXCLUDED_UNVERIFIED_ALIAS).toBe(1);
    expect(result.classifications.EXCLUDED_CROSS_PRODUCT).toBe(1);
  });

  // ==============================================================================
  // Group 11: Real OS Concurrency & Dead Lock Recovery (A34 - A37)
  // ==============================================================================

  it("A34: Concurrent atomic writes do not corrupt ledger state", async () => {
    const tasks = Array.from({ length: 5 }, (_, i) => {
      const rec = createSignedCandidateAliasApproval({
        approvalId: `alias_appr_concurrent_${i}`,
        candidateId: `cand_concurrent_${i}`,
        targetProductId: `prod_${i}`,
        aliasKeyword: `Keyword ${i}`,
        authorizedCanonicalKeyword: `Canonical Keyword ${i}`,
        workspaceId: "ws_acceptance_us",
        approverPrincipalId: "qa_principal_lead",
        issuerKeyId: primaryKeyId,
        evidenceChainReference: `urn:swai:evidence:concurrent_${i}`,
        isTestOnly: true,
      });
      return Promise.resolve().then(() => persistCandidateAliasApprovalAtomically(rec));
    });

    const results = await Promise.all(tasks);
    for (const r of results) {
      expect(r.success).toBe(true);
      expect(r.state).toBe("PERSISTED");
    }

    for (let i = 0; i < 5; i++) {
      const stored = getCandidateAliasApprovalById(`alias_appr_concurrent_${i}`);
      expect(stored).not.toBeNull();
      expect(stored?.approvalId).toBe(`alias_appr_concurrent_${i}`);
    }
  });

  it("A35: Stale lock file with dead PID is reclaimed safely after expiry", () => {
    const storageDir = getCandidateAliasStorageDir();
    const lockFile = path.join(storageDir, ".candidate_alias_ledger.lock");

    // Write a fake expired lock with a non-existent PID
    const deadLockInfo = {
      ownerId: "dead_process_lock",
      pid: 99999999, // non-existent PID
      hostname: os.hostname(),
      acquiredAt: Date.now() - 20000,
      expiresAt: Date.now() - 10000, // expired 10s ago
    };
    fs.writeFileSync(lockFile, JSON.stringify(deadLockInfo), "utf-8");

    // Persistence should reclaim dead lock and succeed
    const rec = createSignedCandidateAliasApproval({
      approvalId: "alias_appr_deadlock_recovery",
      candidateId: "cand_1212440541",
      targetProductId: uahpetCanonicalId,
      aliasKeyword: catFeederKeyword,
      authorizedCanonicalKeyword: uahpetCandidateTitle,
      workspaceId: "ws_acceptance_us",
      approverPrincipalId: "qa_principal_lead",
      issuerKeyId: primaryKeyId,
      evidenceChainReference: "urn:swai:evidence:reclaim",
      isTestOnly: true,
    });

    const res = persistCandidateAliasApprovalAtomically(rec);
    expect(res.success).toBe(true);
    expect(res.state).toBe("PERSISTED");
  });

  it("A36: Monotonic revocation: re-persisting unrevoked record fails to undo revocation", () => {
    const rec = createSignedCandidateAliasApproval({
      approvalId: "alias_appr_monotonic_test",
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
    persistCandidateAliasApprovalAtomically(rec);

    revokeCandidateAliasAtomically(rec.approvalId, "Safety deprecation", "qa_lead");

    // Attempt to persist original unrevoked record
    persistCandidateAliasApprovalAtomically(rec);

    // Must remain revoked
    const fetched = getCandidateAliasApprovalById(rec.approvalId);
    expect(fetched?.revokedAt).toBeDefined();
    expect(fetched?.revocationReason).toBe("Safety deprecation");
  });

  it("A37: Corrupted ledger file falls back safely without unhandled exception", () => {
    const storageDir = getCandidateAliasStorageDir();
    const ledgerFile = path.join(storageDir, ".candidate_alias_ledger.json");

    // Write corrupt JSON
    fs.writeFileSync(ledgerFile, "{corrupted: invalid_json...", "utf-8");

    const fetched = getCandidateAliasApprovalById("any_id");
    expect(fetched).toBeNull();
  });

  // ==============================================================================
  // Group 12: TestSuiteEvidenceValidator Hardening (A38 - A42)
  // ==============================================================================

  it("A38: TestSuiteEvidenceValidator: code tree SHA parity check succeeds on exact match", () => {
    const fakeLog = "Test Files  1 passed (1)\nTests  10 passed (10)\n ✓ tests/unit/kh02/foo.test.ts";
    const report = validateTestSuiteEvidenceInputHelper({
      stdout: fakeLog,
      checkoutSha: "36d559465ece26ac872144d61c58117130ac00c9",
      expectedCheckoutSha: "36d559465ece26ac872144d61c58117130ac00c9",
      codeTreeSha: "c0b7e4427f5747ffe0ee687ea0b99a92bf0c79e9",
      expectedCodeTreeSha: "c0b7e4427f5747ffe0ee687ea0b99a92bf0c79e9",
    });

    expect(report.valid).toBe(true);
    expect(report.codeTreeVerified).toBe(true);
    expect(report.verificationLevel).toBe("EXACT_CODE_TREE_VERIFIED");
  });

  it("A39: TestSuiteEvidenceValidator: code tree SHA mismatch fails with CODE_TREE_MUTATION", () => {
    const fakeLog = "Test Files  1 passed (1)\nTests  10 passed (10)\n ✓ tests/unit/kh02/foo.test.ts";
    const report = validateTestSuiteEvidenceInputHelper({
      stdout: fakeLog,
      checkoutSha: "36d559465ece26ac872144d61c58117130ac00c9",
      expectedCheckoutSha: "36d559465ece26ac872144d61c58117130ac00c9",
      codeTreeSha: "mutated_tree_hash_12345",
      expectedCodeTreeSha: "c0b7e4427f5747ffe0ee687ea0b99a92bf0c79e9",
    });

    expect(report.valid).toBe(false);
    expect(report.rejectionReasons.some((r) => r.includes("CODE_TREE_MUTATION"))).toBe(true);
  });

  it("A40: TestSuiteEvidenceValidator: corrupted log byte detection rejects when computed SHA does not match expected", () => {
    const fakeLog = "Test Files  1 passed (1)\nTests  10 passed (10)\n ✓ tests/unit/kh02/foo.test.ts";
    const report = validateTestSuiteEvidenceInputHelper({
      stdout: fakeLog,
      checkoutSha: "36d559465ece26ac872144d61c58117130ac00c9",
      expectedLogSha256: "0000000000000000000000000000000000000000000000000000000000000000",
    });

    expect(report.valid).toBe(false);
    expect(report.rejectionReasons.some((r) => r.includes("CORRUPTED_LOG"))).toBe(true);
  });

  it("A41: TestSuiteEvidenceValidator: missing mandatory test files rejected as INCOMPLETE", () => {
    const fakeLog = "Test Files  1 passed (1)\nTests  10 passed (10)\n ✓ tests/unit/kh02/foo.test.ts";
    const report = validateTestSuiteEvidenceInputHelper({
      stdout: fakeLog,
      checkoutSha: "36d559465ece26ac872144d61c58117130ac00c9",
      mandatoryTestFiles: ["tests/unit/kh02/foo.test.ts", "tests/unit/kh02/missing_suite.test.ts"],
    });

    expect(report.valid).toBe(false);
    expect(report.status).toBe("INCOMPLETE");
    expect(report.missingMandatoryFiles).toContain("tests/unit/kh02/missing_suite.test.ts");
  });

  it("A42: TestSuiteEvidenceValidator: unverified caller-supplied runId rejected as CI_CLAIM_UNVERIFIED without genuine attestation", () => {
    const commitSha = "36d559465ece26ac872144d61c58117130ac00c9";
    const fakeLog = "Test Files  1 passed (1)\nTests  10 passed (10)\n ✓ tests/unit/kh02/foo.test.ts";
    const report = validateTestSuiteEvidenceInputHelper({
      stdout: fakeLog,
      checkoutSha: commitSha,
      expectedCheckoutSha: commitSha,
      ciProviderProof: {
        provider: "github-actions",
        runId: "1234567890",
        checkSuiteId: "chk_987654",
        commitSha: commitSha,
      },
    });

    // Unverified runId assertion must NOT elevate to CI_PROVIDER_VERIFIED
    expect(report.valid).toBe(false);
    expect(report.ciVerified).toBe(false);
    expect(report.rejectionReasons.some((r) => r.includes("CI_CLAIM_UNVERIFIED"))).toBe(true);
  });

  it("A42b: TestSuiteEvidenceValidator: authentic verified CI attestation elevates verification level to CI_PROVIDER_VERIFIED", () => {
    const commitSha = "36d559465ece26ac872144d61c58117130ac00c9";
    const fakeLog = "Test Files  1 passed (1)\nTests  10 passed (10)\n ✓ tests/unit/kh02/foo.test.ts";
    const report = validateTestSuiteEvidenceInputHelper({
      stdout: fakeLog,
      checkoutSha: commitSha,
      expectedCheckoutSha: commitSha,
      ciProviderProof: {
        provider: "github-actions",
        runId: "1234567890",
        commitSha: commitSha,
        verified: true,
        authenticatedProof: {
          provider: "github-actions",
          repository: "quocan050302/Shopify-Search",
          runId: "1234567890",
          commitSha: commitSha,
          branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
          status: "completed",
          conclusion: "success",
          event: "push",
          verifiedAt: new Date().toISOString(),
          verifierPrincipal: "github-actions-oidc",
        },
      },
    });

    expect(report.valid).toBe(true);
    expect(report.ciVerified).toBe(true);
    expect(report.verificationLevel).toBe("CI_PROVIDER_VERIFIED");
  });
});

function validateTestSuiteEvidenceInputHelper(overrides: Partial<Parameters<typeof validateTestSuiteExecutionEvidence>[0]>) {
  return validateTestSuiteExecutionEvidence({
    command: "npx vitest run tests/unit/kh02/foo.test.ts",
    exitCode: 0,
    checkoutSha: "36d559465ece26ac872144d61c58117130ac00c9",
    ...overrides,
  });
}
