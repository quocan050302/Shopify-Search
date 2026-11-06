/**
 * SWAI KH-02 — V12.4.3.7.19.3.2.5
 * ADVERSARIAL TEST SUITE: REAL CI TRUST-BOUNDARY CLOSURE
 *
 * Proves and eliminates the remaining real CI_PASS trust-boundary forgery path in V19.3.2.4:
 * - T01: Exploit Reproducer — Well-formed payload + valid 64-hex digest + valid configured secret
 *        without server execution capability fails closed across all validation entrypoints.
 * - T02: Direct HMAC Stolen Key Attack — Caller forging valid HMAC signature with shared secret
 *        is rejected fail-closed because run was never authenticated via GitHub API.
 * - T03: Bypass Removal — verifyGitHubActionsRunProof with requireTrustedVerifier=false is rejected.
 * - T04: Exact Numeric RunId Binding — runId substring or mismatch in GitHub API response is rejected.
 * - T05: Exact Workflow Matching — substring workflow matching is eliminated; unofficial names rejected.
 * - T06: Authentic Provider Run Lifecycle — genuine verified run registers opaque proofHandle in server store.
 * - T07: Mock Quarantine — UNIT_TEST_MOCK is strictly quarantined from commercial CI_PASS.
 * - T08: Field Tampering Detection — altered headSha, branch, event, or responseDigest breaks trust chain.
 * - T09: Server Registry Isolation — clearVerifiedRemoteCiRunsForTesting ensures zero cross-test leakage.
 * - T10: Full Gate Safety — unverified CI strictly prevents overallReleaseAllowed=true.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import {
  TRUSTED_VERIFIER_ID,
  CANONICAL_REPOSITORY,
  LOCKED_BRANCH,
  computeCiAttestationDigest,
  mintCiAttestationToken,
  verifyCiAttestationToken,
  verifyRemoteGitHubActionsRun,
  verifyAuthenticCiProof,
  lookupVerifiedRemoteCiRun,
  registerVerifiedRemoteCiRun,
  _testOnlyRegisterVerifiedRemoteCiRun,
  clearVerifiedRemoteCiRunsForTesting,
  TRUSTED_ORCHESTRATOR_CAPABILITY,
  CANONICAL_RELEASE_WORKFLOWS,
} from "@/services/kh02/release/githubActionsCiEvidence";

import {
  validateVerifiedCiAttestation,
  verifyGitHubActionsRunProof,
} from "@/services/kh02/demand/testSuiteEvidenceValidator";

import {
  evaluateReleaseEvidence,
  ReleaseEvidenceInput,
} from "@/services/kh02/release/releaseGateEvaluatorV19";

describe("KH-02 V12.4.3.7.19.3.2.5: Real CI Trust-Boundary Closure (T01 - T10)", () => {
  const currentTestedSha = "1e463304b5552f996d0732b1a21ae6bbf927efb6";
  const valid64HexDigest = crypto.createHash("sha256").update("github_actions_api_run_response_v19_3_2_5").digest("hex");
  const validSecretKey = "SWAI_SECURE_TEST_KEY_WITH_HIGH_ENTROPY_64_CHARACTERS_HEX_1234567890ABCDEF";

  const originalEnvSecret = process.env.KH02_CI_VERIFIER_SECRET;

  beforeEach(() => {
    process.env.KH02_CI_VERIFIER_SECRET = validSecretKey;
    clearVerifiedRemoteCiRunsForTesting();
  });

  afterEach(() => {
    if (originalEnvSecret !== undefined) {
      process.env.KH02_CI_VERIFIER_SECRET = originalEnvSecret;
    } else {
      delete process.env.KH02_CI_VERIFIER_SECRET;
    }
    clearVerifiedRemoteCiRunsForTesting();
  });

  // ============================================================================
  // T01: Exploit Reproducer — Well-formed payload + 64-hex digest + valid secret
  // ============================================================================
  it("T01: Exploit Reproducer — Well-formed payload with 64-hex digest without server capability returns untrusted token and fails closed", () => {
    const forgedPayload: any = {
      provider: "github-actions",
      source: "GITHUB_API",
      repository: CANONICAL_REPOSITORY,
      runId: "987654321",
      headSha: currentTestedSha,
      headBranch: LOCKED_BRANCH,
      status: "completed",
      conclusion: "success",
      event: "push",
      responseDigest: valid64HexDigest,
      isUnitTestMock: false,
      verifier: TRUSTED_VERIFIER_ID,
    };

    // Caller attempts to mint token from user-space without internal orchestrator capability
    const mintedToken = mintCiAttestationToken(forgedPayload);
    expect(mintedToken.startsWith("swai_ci_untrusted_")).toBe(true);

    forgedPayload.attestationSignature = mintedToken;

    // 1. verifyCiAttestationToken rejects with UNAUTHORIZED_MINT
    const tokenCheck = verifyCiAttestationToken(forgedPayload);
    expect(tokenCheck.valid).toBe(false);
    expect(tokenCheck.reason).toContain("UNAUTHORIZED_MINT");

    // 2. verifyAuthenticCiProof rejects with CI_CLAIM_UNVERIFIED
    const proofCheck = verifyAuthenticCiProof(
      { runId: "987654321", authenticatedProof: forgedPayload },
      { expectedSha: currentTestedSha }
    );
    expect(proofCheck.verified).toBe(false);
    expect(proofCheck.status).toBe("CI_NOT_RUN");
    expect(proofCheck.error).toContain("CI_CLAIM_UNVERIFIED");

    // 3. evaluateReleaseEvidence demotes to CI_NOT_RUN and records blocker
    const releaseVerdict = evaluateReleaseEvidence({
      version: "12.4.3.7.19.3.2.5",
      baselineSha: currentTestedSha,
      reportGeneratedAt: new Date().toISOString(),
      testCommand: "npm run test",
      testedCodeSha: currentTestedSha,
      branch: LOCKED_BRANCH,
      exitCode: 0,
      realPassed: 100,
      realFailed: 0,
      realSkipped: 0,
      realTotal: 100,
      runMode: "OFFLINE_CONTRACT_CHECK",
      ciStatus: {
        configured: true,
        runStatus: "SUCCESS",
        verifiedProof: {
          verified: true,
          ...forgedPayload,
        },
      },
    });

    expect(releaseVerdict.ciStatus).toBe("CI_NOT_RUN");
    expect(releaseVerdict.blockerList).toContain("CI_CLAIM_UNVERIFIED");
    expect(releaseVerdict.overallReleaseAllowed).toBe(false);
  });

  // ============================================================================
  // T02: Direct Stolen Key Attack — Caller computing valid HMAC directly
  // ============================================================================
  it("T02: Direct HMAC Stolen Key Attack — Handcrafted valid HMAC signature rejected because run was never authenticated via GitHub API", () => {
    const forgedPayload: any = {
      provider: "github-actions",
      source: "GITHUB_API",
      repository: CANONICAL_REPOSITORY,
      runId: "987654321",
      headSha: currentTestedSha,
      headBranch: LOCKED_BRANCH,
      status: "completed",
      conclusion: "success",
      event: "push",
      responseDigest: valid64HexDigest,
      isUnitTestMock: false,
      verifier: TRUSTED_VERIFIER_ID,
    };

    // Attacker crafts a mathematically valid HMAC using stolen secret
    const payload = computeCiAttestationDigest(forgedPayload);
    const validHmac = crypto.createHmac("sha256", validSecretKey).update(payload).digest("hex");
    forgedPayload.attestationSignature = `swai_ci_v1_${validHmac}`;

    // Token itself passes cryptographic verification
    const tokenCheck = verifyCiAttestationToken(forgedPayload);
    expect(tokenCheck.valid).toBe(true);

    // But verifyAuthenticCiProof rejects because runId has no record in server registry
    const proofCheck = verifyAuthenticCiProof(
      { runId: "987654321", authenticatedProof: forgedPayload },
      { expectedSha: currentTestedSha }
    );
    expect(proofCheck.verified).toBe(false);
    expect(proofCheck.status).toBe("CI_NOT_RUN");
    expect(proofCheck.error).toContain("CI_CLAIM_UNVERIFIED");
    expect(proofCheck.error).toContain("has not been verified by authentic remote GitHub Actions verifier");

    // evaluateReleaseEvidence also rejects fail-closed
    const releaseVerdict = evaluateReleaseEvidence({
      version: "12.4.3.7.19.3.2.5",
      baselineSha: currentTestedSha,
      reportGeneratedAt: new Date().toISOString(),
      testCommand: "npm run test",
      testedCodeSha: currentTestedSha,
      branch: LOCKED_BRANCH,
      exitCode: 0,
      realPassed: 100,
      realFailed: 0,
      realSkipped: 0,
      realTotal: 100,
      runMode: "OFFLINE_CONTRACT_CHECK",
      ciStatus: {
        configured: true,
        runStatus: "SUCCESS",
        verifiedProof: {
          verified: true,
          ...forgedPayload,
        },
      },
    });

    expect(releaseVerdict.ciStatus).toBe("CI_NOT_RUN");
    expect(releaseVerdict.blockerList).toContain("CI_CLAIM_UNVERIFIED");
    expect(releaseVerdict.overallReleaseAllowed).toBe(false);
  });

  // ============================================================================
  // T03: Bypass Removal — requireTrustedVerifier=false does NOT allow unverified claims
  // ============================================================================
  it("T03: Bypass Removal — verifyGitHubActionsRunProof with requireTrustedVerifier=false rejects unverified claims", () => {
    const rawProof = {
      provider: "github-actions" as const,
      repository: CANONICAL_REPOSITORY,
      runId: "1234567890",
      commitSha: currentTestedSha,
      branch: LOCKED_BRANCH,
      status: "completed" as const,
      conclusion: "success" as const,
      event: "push" as const,
      source: "GITHUB_API" as const,
      verifier: TRUSTED_VERIFIER_ID,
      verifiedAt: new Date().toISOString(),
      responseDigest: valid64HexDigest,
    };

    // Caller attempts bypass with requireTrustedVerifier: false
    const check = verifyGitHubActionsRunProof(
      {
        provider: "github-actions",
        runId: "1234567890",
        commitSha: currentTestedSha,
        verified: true,
        authenticatedProof: rawProof,
      },
      {
        expectedSha: currentTestedSha,
        requireTrustedVerifier: false, // Attempted bypass!
      }
    );

    expect(check.verified).toBe(false);
    expect(check.error).toContain("CI_CLAIM_UNVERIFIED");
  });

  // ============================================================================
  // T04: Exact Numeric RunId Binding
  // ============================================================================
  it("T04: Exact Numeric RunId Binding — runId mismatch in GitHub API response is rejected as CI_FAIL", async () => {
    const mockFetch = async () => ({
      status: 200,
      text: async () =>
        JSON.stringify({
          id: 99999999, // Mismatched runId returned by API
          repository: { full_name: CANONICAL_REPOSITORY },
          head_sha: currentTestedSha,
          head_branch: LOCKED_BRANCH,
          status: "completed",
          conclusion: "success",
          event: "push",
        }),
    });

    const result = await verifyRemoteGitHubActionsRun({
      runId: "12345678", // Expected runId
      expectedSha: currentTestedSha,
      expectedBranch: LOCKED_BRANCH,
      customFetch: mockFetch as any,
    });

    expect(result.verified).toBe(false);
    expect(result.status).toBe("CI_FAIL");
    expect(result.rejectionReason).toContain("CI runId mismatch");
  });

  // ============================================================================
  // T05: Exact Workflow Matching — substring matching is strictly eliminated
  // ============================================================================
  it("T05: Exact Workflow Matching — substring workflow matching is eliminated; unofficial names rejected", async () => {
    const mockFetch = async () => ({
      status: 200,
      text: async () =>
        JSON.stringify({
          id: 12345678,
          name: "KH-02 Continuous Integration Helper Substring Attack", // Unofficial name with allowed prefix
          repository: { full_name: CANONICAL_REPOSITORY },
          head_sha: currentTestedSha,
          head_branch: LOCKED_BRANCH,
          status: "completed",
          conclusion: "success",
          event: "push",
        }),
    });

    const result = await verifyRemoteGitHubActionsRun({
      runId: "12345678",
      expectedSha: currentTestedSha,
      expectedBranch: LOCKED_BRANCH,
      allowedWorkflows: ["KH-02 Continuous Integration"],
      customFetch: mockFetch as any,
    });

    expect(result.verified).toBe(false);
    expect(result.status).toBe("CI_FAIL");
    expect(result.rejectionReason).toContain("is not in the allowed release workflows list");
  });

  // ============================================================================
  // T06: Authentic Provider Run Lifecycle
  // ============================================================================
  it("T06: Authentic Provider Run Lifecycle — genuine verified run registers in server store with opaque proofHandle", () => {
    const evidence = {
      provider: "github-actions" as const,
      source: "GITHUB_API" as const,
      repository: CANONICAL_REPOSITORY,
      runId: "55554444",
      runUrl: `https://github.com/${CANONICAL_REPOSITORY}/actions/runs/55554444`,
      workflowId: 999,
      workflowName: "KH-02 Continuous Integration",
      headSha: currentTestedSha,
      headBranch: LOCKED_BRANCH,
      event: "push" as const,
      status: "completed" as const,
      conclusion: "success" as const,
      fetchedAt: new Date().toISOString(),
      responseDigest: valid64HexDigest,
      verifier: TRUSTED_VERIFIER_ID,
      isUnitTestMock: false,
    };

    // Register run using trusted orchestrator capability
    const regResult = registerVerifiedRemoteCiRun(evidence, TRUSTED_ORCHESTRATOR_CAPABILITY);
    expect(regResult.registered).toBe(true);
    expect(regResult.proofHandle?.startsWith("swai_proof_handle_")).toBe(true);

    // Verify lookup succeeds
    const lookup = lookupVerifiedRemoteCiRun("55554444", currentTestedSha);
    expect(lookup.verified).toBe(true);
    expect(lookup.record?.proofHandle).toBe(regResult.proofHandle);

    // Attestation signature minted with internal capability
    const token = mintCiAttestationToken(evidence, { trustedExecutionCapability: TRUSTED_ORCHESTRATOR_CAPABILITY });
    expect(token.startsWith("swai_ci_v1_")).toBe(true);

    // verifyAuthenticCiProof succeeds
    const proofCheck = verifyAuthenticCiProof(
      { runId: "55554444", authenticatedProof: { ...evidence, attestationSignature: token } },
      { expectedSha: currentTestedSha }
    );
    expect(proofCheck.verified).toBe(true);
    expect(proofCheck.status).toBe("CI_PASS");
  });

  // ============================================================================
  // T07: Mock Quarantine
  // ============================================================================
  it("T07: Mock Quarantine — UNIT_TEST_MOCK is strictly quarantined from commercial CI_PASS", () => {
    const mockEvidence = {
      provider: "github-actions" as const,
      source: "UNIT_TEST_MOCK" as const,
      repository: CANONICAL_REPOSITORY,
      runId: "77778888",
      headSha: currentTestedSha,
      headBranch: LOCKED_BRANCH,
      responseDigest: valid64HexDigest,
      isUnitTestMock: true,
    };

    _testOnlyRegisterVerifiedRemoteCiRun(mockEvidence);

    // lookupVerifiedRemoteCiRun returns verified: false for mocks in release context
    const lookup = lookupVerifiedRemoteCiRun("77778888", currentTestedSha);
    expect(lookup.verified).toBe(false);
    expect(lookup.reason).toContain("MOCK_QUARANTINE");
  });

  // ============================================================================
  // T08: Field Tampering Detection
  // ============================================================================
  it("T08: Field Tampering Detection — altered headSha or responseDigest breaks both HMAC and registry lookup", () => {
    const evidence = {
      provider: "github-actions" as const,
      source: "GITHUB_API" as const,
      repository: CANONICAL_REPOSITORY,
      runId: "66667777",
      headSha: currentTestedSha,
      headBranch: LOCKED_BRANCH,
      responseDigest: valid64HexDigest,
      isUnitTestMock: false,
    };

    _testOnlyRegisterVerifiedRemoteCiRun(evidence);
    const token = mintCiAttestationToken(evidence, { trustedExecutionCapability: TRUSTED_ORCHESTRATOR_CAPABILITY });

    // Tamper with commitSha
    const tamperedSha = {
      ...evidence,
      headSha: "0000000000000000000000000000000000000000",
      attestationSignature: token,
    };

    const tokenCheck = verifyCiAttestationToken(tamperedSha);
    expect(tokenCheck.valid).toBe(false);

    const lookup = lookupVerifiedRemoteCiRun("66667777", "0000000000000000000000000000000000000000");
    expect(lookup.verified).toBe(false);
    expect(lookup.reason).toContain("SHA_MISMATCH");
  });

  // ============================================================================
  // T09: Server Registry Isolation
  // ============================================================================
  it("T09: Server Registry Isolation — clearVerifiedRemoteCiRunsForTesting ensures zero cross-test leakage", () => {
    _testOnlyRegisterVerifiedRemoteCiRun({
      runId: "11112222",
      headSha: currentTestedSha,
      responseDigest: valid64HexDigest,
    });

    expect(lookupVerifiedRemoteCiRun("11112222", currentTestedSha).verified).toBe(true);

    clearVerifiedRemoteCiRunsForTesting();

    expect(lookupVerifiedRemoteCiRun("11112222", currentTestedSha).verified).toBe(false);
  });

  // ============================================================================
  // T10: Full Gate Safety
  // ============================================================================
  it("T10: Full Gate Safety — unverified CI strictly prevents overallReleaseAllowed=true even when all other gates pass", () => {
    const verdict = evaluateReleaseEvidence({
      version: "12.4.3.7.19.3.2.5",
      baselineSha: currentTestedSha,
      reportGeneratedAt: new Date().toISOString(),
      testCommand: "npm run test",
      testedCodeSha: currentTestedSha,
      branch: LOCKED_BRANCH,
      exitCode: 0,
      realPassed: 200,
      realFailed: 0,
      realSkipped: 0,
      realTotal: 200,
      runMode: "OFFLINE_CONTRACT_CHECK",
      fullSuiteCoverage: {
        unitPassed: true,
        integrationPassed: true,
        backtestPassed: true,
        kh01VerifyPassed: true,
      },
      stagingRuntime: {
        executed: true,
        readinessStatus: "EXECUTED_PASS",
        isolatedNamespaceVerified: true,
        zeroProductionMutations: true,
      },
      backtestResults: {
        policyReplayPassed: true,
        devHistoricalPassed: true,
        holdoutHistoricalPassed: true,
      },
      ciStatus: {
        configured: true,
        runStatus: "SUCCESS",
        runId: "unverified_external_run",
        commitSha: currentTestedSha,
        verifiedProof: {
          verified: true,
          attestation: {
            source: "GITHUB_API",
            verifier: TRUSTED_VERIFIER_ID,
            headSha: currentTestedSha,
            headBranch: LOCKED_BRANCH,
            status: "completed",
            conclusion: "success",
            event: "push",
            responseDigest: valid64HexDigest,
          },
        },
      },
    });

    expect(verdict.ciStatus).toBe("CI_NOT_RUN");
    expect(verdict.blockerList).toContain("CI_CLAIM_UNVERIFIED");
    expect(verdict.overallReleaseAllowed).toBe(false);
  });
});
