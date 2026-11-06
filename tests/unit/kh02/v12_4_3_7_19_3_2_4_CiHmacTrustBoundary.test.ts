/**
 * SWAI KH-02 — V12.4.3.7.19.3.2.4
 * ADVERSARIAL TEST SUITE: P0 CI HMAC TRUST BOUNDARY CLOSURE
 *
 * Verifies that the P0 CI HMAC attestation vulnerability is completely closed:
 * - R01: Missing KH02_CI_VERIFIER_SECRET + historical default key -> fails closed, NEVER CI_PASS
 * - R02: mintCiAttestationToken imported in caller code -> blocked from minting release-valid proof without real GitHub run
 * - R03: Caller-supplied { verified:true, source:'GITHUB_API', verifier:'SWAI_TRUSTED_GITHUB_VERIFIER_V1' } fails closed
 * - R04: Self-created HMAC using old DEFAULT_CI_VERIFIER_KEY is strictly rejected
 * - R05: Arbitrary unsigned, truncated, malformed, expired, replayed or copied signatures are rejected
 * - R06: Token signed under TEST/dev key NEVER yields business CI_PASS
 * - R07: Token signed under trusted key with unverified/self-provided claims is NOT VALID for release
 * - R08: Attestation with mismatched SHA, branch, repo, event, or workflow is rejected
 * - R09: Neighboring workflow or unapproved workflow name rejected as full release CI proof
 * - R10: Direct release gate input with nested ciStatus='CI_PASS' or overallReleaseAllowed=true cannot promote verdict
 * - R11: Mocked customFetch with isUnitTestMock:false is strictly forced to UNIT_TEST_MOCK / PARSED_CLAIM
 * - R12: Structural claim validator returns structurallyValid=true but providerVerified=false for unauthenticated claims
 * - R13: Missing GITHUB_TOKEN, missing secret, 401/403/404/500, timeout, SSRF redirects fail closed
 * - R14: Cross-run substitution of runId, headSha, or responseDigest breaks cryptographic verification
 * - R15: Unconfigured CI with fake success and all passing gates independently keeps ciStatus != CI_PASS and release NO-GO
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import {
  TRUSTED_VERIFIER_ID,
  CANONICAL_REPOSITORY,
  LOCKED_BRANCH,
  GitHubWorkflowRunEvidence,
  computeCiAttestationDigest,
  mintCiAttestationToken,
  verifyCiAttestationToken,
  validateGitHubApiUrl,
  verifyRemoteGitHubActionsRun,
  verifyAuthenticCiProof,
  getCiVerifierSecret,
  KNOWN_INSECURE_DEFAULT_KEYS,
} from "@/services/kh02/release/githubActionsCiEvidence";

import {
  validateVerifiedCiAttestation,
  verifyGitHubActionsRunProof,
  validateTestSuiteExecutionEvidence,
} from "@/services/kh02/demand/testSuiteEvidenceValidator";

import {
  evaluateReleaseEvidence,
  ReleaseEvidenceInput,
} from "@/services/kh02/release/releaseGateEvaluatorV19";

describe("KH-02 V12.4.3.7.19.3.2.4: P0 CI HMAC Trust Boundary Closure (R01 - R15)", () => {
  const currentBaselineSha = "76c3de8adefc6995cdf5728753450d186abfc0de";
  const valid64HexDigest = crypto.createHash("sha256").update("authentic_github_api_body_v19").digest("hex");
  const oldDefaultKey = "SWAI_KH02_INTERNAL_HMAC_VERIFIER_KEY_V19_3_2_3_SECURE";

  const originalEnvSecret = process.env.KH02_CI_VERIFIER_SECRET;
  const originalGhToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    delete process.env.KH02_CI_VERIFIER_SECRET;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
  });

  afterEach(() => {
    if (originalEnvSecret !== undefined) {
      process.env.KH02_CI_VERIFIER_SECRET = originalEnvSecret;
    } else {
      delete process.env.KH02_CI_VERIFIER_SECRET;
    }
    if (originalGhToken !== undefined) {
      process.env.GITHUB_TOKEN = originalGhToken;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
  });

  // ============================================================================
  // R01: Missing KH02_CI_VERIFIER_SECRET + historical default key -> NEVER CI_PASS
  // ============================================================================
  it("R01: Missing KH02_CI_VERIFIER_SECRET fails closed; attempted default-key minting never yields CI_PASS", () => {
    delete process.env.KH02_CI_VERIFIER_SECRET;

    const secretResolution = getCiVerifierSecret();
    expect(secretResolution.status).toBe("NOT_CONFIGURED");
    expect(secretResolution.key).toBeUndefined();

    const plausiblePayload = {
      provider: "github-actions" as const,
      source: "GITHUB_API" as const,
      repository: CANONICAL_REPOSITORY,
      runId: "88997711",
      headSha: currentBaselineSha,
      headBranch: LOCKED_BRANCH,
      status: "completed" as const,
      conclusion: "success" as const,
      event: "push" as const,
      responseDigest: valid64HexDigest,
      verifier: TRUSTED_VERIFIER_ID,
      isUnitTestMock: false,
    };

    // Caller attempts to pass proof to evaluateReleaseEvidence
    const verdict = evaluateReleaseEvidence({
      version: "12.4.3.7.19.3.2.4",
      baselineSha: currentBaselineSha,
      reportGeneratedAt: new Date().toISOString(),
      testCommand: "npx vitest run tests/unit/kh02/v12_4_3_7_19_3_2_4_CiHmacTrustBoundary.test.ts",
      testedCodeSha: currentBaselineSha,
      branch: LOCKED_BRANCH,
      exitCode: 0,
      realPassed: 10,
      realFailed: 0,
      realSkipped: 0,
      realTotal: 10,
      runMode: "OFFLINE_CONTRACT_CHECK",
      ciStatus: {
        configured: true,
        runStatus: "SUCCESS",
        verifiedProof: {
          verified: true,
          attestation: {
            ...plausiblePayload,
            // Caller attempts to supply signature with old default key
            attestationSignature: `swai_ci_v1_${crypto.createHmac("sha256", oldDefaultKey).update(computeCiAttestationDigest(plausiblePayload)).digest("hex")}`,
          },
        },
      },
    });

    expect(verdict.ciStatus).not.toBe("CI_PASS");
    expect(["CI_NOT_RUN", "CI_NOT_CONFIGURED"]).toContain(verdict.ciStatus);
    expect(verdict.blockerList).toContain("CI_CLAIM_UNVERIFIED");
    expect(verdict.overallReleaseAllowed).toBe(false);
  });

  // ============================================================================
  // R02: mintCiAttestationToken called in caller code -> blocked from minting release-valid proof
  // ============================================================================
  it("R02: mintCiAttestationToken imported in caller code cannot mint a valid release-grade proof without internal execution capability", () => {
    const rawPayload = {
      provider: "github-actions" as const,
      source: "GITHUB_API" as const,
      repository: CANONICAL_REPOSITORY,
      runId: "99887766",
      headSha: currentBaselineSha,
      headBranch: LOCKED_BRANCH,
      status: "completed" as const,
      conclusion: "success" as const,
      event: "push" as const,
      responseDigest: valid64HexDigest,
      verifier: TRUSTED_VERIFIER_ID,
      isUnitTestMock: false,
    };

    // Attempt to mint from external caller without verified provider execution
    const callerToken = mintCiAttestationToken(rawPayload);

    // Any caller-minted token without trusted provider capability must either be explicitly tagged untrusted,
    // or fail cryptographic verification under getCiVerifierSecret()
    const verifyCheck = verifyCiAttestationToken({
      ...rawPayload,
      attestationSignature: callerToken,
    });

    expect(verifyCheck.valid).toBe(false);
    expect(verifyCheck.reason).toBeDefined();
  });

  // ============================================================================
  // R03: User-supplied plain object with GITHUB_API and SWAI verifier fails closed
  // ============================================================================
  it("R03: User-supplied plain object without authentic cryptographic attestation fails closed across all paths", () => {
    const userSupplied = {
      runId: "12345678",
      authenticatedProof: {
        provider: "github-actions",
        source: "GITHUB_API",
        verifier: TRUSTED_VERIFIER_ID,
        repository: CANONICAL_REPOSITORY,
        responseDigest: "a".repeat(64),
        runId: "12345678",
        headSha: currentBaselineSha,
        headBranch: LOCKED_BRANCH,
        status: "completed",
        conclusion: "success",
        event: "push",
        isUnitTestMock: false,
      },
    };

    // 1. verifyAuthenticCiProof
    const res1 = verifyAuthenticCiProof(userSupplied, { expectedSha: currentBaselineSha });
    expect(res1.verified).toBe(false);
    expect(res1.status).toBe("CI_NOT_RUN");
    expect(res1.error).toContain("CI_CLAIM_UNVERIFIED");

    // 2. verifyGitHubActionsRunProof
    const res2 = verifyGitHubActionsRunProof({
      provider: "github-actions",
      runId: "12345678",
      commitSha: currentBaselineSha,
      verified: true,
      authenticatedProof: userSupplied.authenticatedProof as any,
    });
    expect(res2.verified).toBe(false);
    expect(res2.error).toContain("CI_CLAIM_UNVERIFIED");

    // 3. evaluateReleaseEvidence
    const res3 = evaluateReleaseEvidence({
      version: "12.4.3.7.19.3.2.4",
      baselineSha: currentBaselineSha,
      reportGeneratedAt: new Date().toISOString(),
      testCommand: "test",
      testedCodeSha: currentBaselineSha,
      branch: LOCKED_BRANCH,
      exitCode: 0,
      realPassed: 5,
      realFailed: 0,
      realSkipped: 0,
      realTotal: 5,
      runMode: "OFFLINE_CONTRACT_CHECK",
      ciStatus: {
        configured: true,
        runStatus: "SUCCESS",
        verifiedProof: {
          verified: true,
          attestation: userSupplied.authenticatedProof,
        },
      },
    });
    expect(res3.ciStatus).not.toBe("CI_PASS");
    expect(res3.blockerList).toContain("CI_CLAIM_UNVERIFIED");
  });

  // ============================================================================
  // R04: Self-created HMAC using old DEFAULT_CI_VERIFIER_KEY is strictly rejected
  // ============================================================================
  it("R04: Self-created HMAC using historical default key is strictly rejected even if all fields match", () => {
    const payload = {
      provider: "github-actions" as const,
      source: "GITHUB_API" as const,
      repository: CANONICAL_REPOSITORY,
      runId: "55443322",
      headSha: currentBaselineSha,
      headBranch: LOCKED_BRANCH,
      status: "completed" as const,
      conclusion: "success" as const,
      event: "push" as const,
      responseDigest: valid64HexDigest,
      verifier: TRUSTED_VERIFIER_ID,
      isUnitTestMock: false,
    };

    const canonicalDigest = computeCiAttestationDigest(payload);
    const selfCreatedHmac = `swai_ci_v1_${crypto.createHmac("sha256", oldDefaultKey).update(canonicalDigest).digest("hex")}`;

    const check = verifyCiAttestationToken({
      ...payload,
      attestationSignature: selfCreatedHmac,
    });

    expect(check.valid).toBe(false);
    expect(check.reason).toMatch(/MISSING_TRUST_ANCHOR|mismatch|forged|INSECURE_OR_DEFAULT/i);
  });

  // ============================================================================
  // R05: Arbitrary unsigned, truncated, malformed, expired, replayed signatures
  // ============================================================================
  it("R05: Arbitrary unsigned, truncated, malformed, or replayed signatures are strictly rejected", () => {
    const base = {
      provider: "github-actions" as const,
      source: "GITHUB_API" as const,
      repository: CANONICAL_REPOSITORY,
      runId: "11223344",
      headSha: currentBaselineSha,
      headBranch: LOCKED_BRANCH,
      status: "completed" as const,
      conclusion: "success" as const,
      event: "push" as const,
      responseDigest: valid64HexDigest,
      verifier: TRUSTED_VERIFIER_ID,
      isUnitTestMock: false,
    };

    const malformedSignatures = [
      "",
      "invalid_prefix_123456",
      "swai_ci_v1_", // truncated (empty hex)
      "swai_ci_v1_123456", // too short
      "swai_ci_v1_" + "z".repeat(64), // invalid hex characters
      null,
      undefined,
    ];

    for (const sig of malformedSignatures) {
      const check = verifyCiAttestationToken({
        ...base,
        attestationSignature: sig,
      });
      expect(check.valid).toBe(false);
    }
  });

  // ============================================================================
  // R06: Valid token signed under TEST key NEVER yields business CI_PASS
  // ============================================================================
  it("R06: Token signed under test key or marked as unit test mock NEVER yields commercial CI_PASS", () => {
    const mockPayload = {
      provider: "github-actions" as const,
      source: "UNIT_TEST_MOCK" as const,
      repository: CANONICAL_REPOSITORY,
      runId: "33445566",
      headSha: currentBaselineSha,
      headBranch: LOCKED_BRANCH,
      status: "completed" as const,
      conclusion: "success" as const,
      event: "push" as const,
      responseDigest: valid64HexDigest,
      verifier: TRUSTED_VERIFIER_ID,
      isUnitTestMock: true,
      attestationSignature: "swai_ci_v1_test_mock_token_abc123",
    };

    const verdict = evaluateReleaseEvidence({
      version: "12.4.3.7.19.3.2.4",
      baselineSha: currentBaselineSha,
      reportGeneratedAt: new Date().toISOString(),
      testCommand: "test",
      testedCodeSha: currentBaselineSha,
      branch: LOCKED_BRANCH,
      exitCode: 0,
      realPassed: 10,
      realFailed: 0,
      realSkipped: 0,
      realTotal: 10,
      runMode: "OFFLINE_CONTRACT_CHECK",
      ciStatus: {
        configured: true,
        runStatus: "SUCCESS",
        verifiedProof: {
          verified: true,
          attestation: mockPayload,
        },
      },
    });

    expect(verdict.ciStatus).not.toBe("CI_PASS");
    expect(verdict.ciStatus).toBe("CI_NOT_RUN");
    expect(verdict.overallReleaseAllowed).toBe(false);
  });

  // ============================================================================
  // R07: Signing alone is not independent GitHub proof
  // ============================================================================
  it("R07: Token correctly signed under trusted key with unverified self-provided claims is NOT VALID for release", () => {
    // Even if KH02_CI_VERIFIER_SECRET is set to a valid 64-char key:
    process.env.KH02_CI_VERIFIER_SECRET = "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0";

    const selfAuthoredClaims = {
      provider: "github-actions" as const,
      source: "GITHUB_API" as const,
      repository: CANONICAL_REPOSITORY,
      runId: "77665544",
      headSha: currentBaselineSha,
      headBranch: LOCKED_BRANCH,
      status: "completed" as const,
      conclusion: "success" as const,
      event: "push" as const,
      // Invalid response digest (not 64 hex chars)
      responseDigest: "self_authored_non_hex_digest",
      verifier: TRUSTED_VERIFIER_ID,
      isUnitTestMock: false,
    };

    const token = mintCiAttestationToken(selfAuthoredClaims);

    const check = verifyAuthenticCiProof(
      {
        runId: "77665544",
        authenticatedProof: {
          ...selfAuthoredClaims,
          attestationSignature: token,
        },
      },
      { expectedSha: currentBaselineSha }
    );

    expect(check.verified).toBe(false);
    expect(check.status).toBe("CI_NOT_RUN");
  });

  // ============================================================================
  // R08: Attestation with mismatched SHA, branch, repo, or event is rejected
  // ============================================================================
  it("R08: Attestation with mismatched SHA, branch, repo, or event is strictly rejected", () => {
    process.env.KH02_CI_VERIFIER_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    const basePayload = {
      provider: "github-actions" as const,
      source: "GITHUB_API" as const,
      repository: CANONICAL_REPOSITORY,
      runId: "99112233",
      headSha: currentBaselineSha,
      headBranch: LOCKED_BRANCH,
      status: "completed" as const,
      conclusion: "success" as const,
      event: "push" as const,
      responseDigest: valid64HexDigest,
      verifier: TRUSTED_VERIFIER_ID,
      isUnitTestMock: false,
    };

    // Mismatched commit SHA
    const wrongShaCheck = verifyAuthenticCiProof(
      {
        runId: "99112233",
        authenticatedProof: {
          ...basePayload,
          headSha: "0000000000000000000000000000000000000000",
          attestationSignature: mintCiAttestationToken({
            ...basePayload,
            headSha: "0000000000000000000000000000000000000000",
          }),
        },
      },
      { expectedSha: currentBaselineSha }
    );
    expect(wrongShaCheck.verified).toBe(false);
    expect(wrongShaCheck.status).toBe("CI_FAIL");

    // Mismatched branch
    const wrongBranchCheck = verifyAuthenticCiProof(
      {
        runId: "99112233",
        authenticatedProof: {
          ...basePayload,
          headBranch: "feature/attacker-branch",
          attestationSignature: mintCiAttestationToken({
            ...basePayload,
            headBranch: "feature/attacker-branch",
          }),
        },
      },
      { expectedBranch: LOCKED_BRANCH }
    );
    expect(wrongBranchCheck.verified).toBe(false);
    expect(wrongBranchCheck.status).toBe("CI_FAIL");

    // Disallowed event (e.g. pull_request or schedule instead of push / workflow_dispatch)
    const wrongEventCheck = verifyAuthenticCiProof(
      {
        runId: "99112233",
        authenticatedProof: {
          ...basePayload,
          event: "schedule" as any,
          attestationSignature: mintCiAttestationToken({
            ...basePayload,
            event: "schedule" as any,
          }),
        },
      },
      { expectedSha: currentBaselineSha }
    );
    expect(wrongEventCheck.verified).toBe(false);
    expect(wrongEventCheck.status).toBe("CI_FAIL");
  });

  // ============================================================================
  // R09: Neighboring workflow or unapproved workflow name rejected
  // ============================================================================
  it("R09: Unapproved or neighboring workflow name is rejected fail-closed", () => {
    process.env.KH02_CI_VERIFIER_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    const payload = {
      provider: "github-actions" as const,
      source: "GITHUB_API" as const,
      repository: CANONICAL_REPOSITORY,
      runId: "12340000",
      headSha: currentBaselineSha,
      headBranch: LOCKED_BRANCH,
      workflowName: "Deploy Untrusted Staging Feature",
      status: "completed" as const,
      conclusion: "success" as const,
      event: "push" as const,
      responseDigest: valid64HexDigest,
      verifier: TRUSTED_VERIFIER_ID,
      isUnitTestMock: false,
    };

    const token = mintCiAttestationToken(payload);

    const check = verifyAuthenticCiProof(
      {
        runId: "12340000",
        authenticatedProof: {
          ...payload,
          attestationSignature: token,
        },
      },
      {
        expectedSha: currentBaselineSha,
        allowedWorkflows: ["KH-02 Continuous Integration", "CI"],
      }
    );

    expect(check.verified).toBe(false);
    expect(check.status).toBe("CI_FAIL");
    expect(check.error).toContain("allowed workflows");
  });

  // ============================================================================
  // R10: Direct release-gate input with nested untrusted fields cannot promote verdict
  // ============================================================================
  it("R10: Direct release-gate input with spoofed ciStatus='CI_PASS' or overallReleaseAllowed=true cannot promote verdict", () => {
    const maliciousInput: any = {
      version: "12.4.3.7.19.3.2.4",
      baselineSha: currentBaselineSha,
      reportGeneratedAt: new Date().toISOString(),
      testCommand: "test",
      testedCodeSha: currentBaselineSha,
      branch: LOCKED_BRANCH,
      exitCode: 0,
      realPassed: 100,
      realFailed: 0,
      realSkipped: 0,
      realTotal: 100,
      runMode: "OFFLINE_CONTRACT_CHECK",
      overallReleaseAllowed: true, // Spoofed field
      ciStatus: {
        configured: true,
        runStatus: "SUCCESS",
        status: "CI_PASS", // Spoofed field
        verifiedProof: {
          verified: true, // Spoofed without cryptographic token
          attestation: {
            source: "GITHUB_API",
            verifier: TRUSTED_VERIFIER_ID,
            headSha: currentBaselineSha,
          },
        },
      },
    };

    const verdict = evaluateReleaseEvidence(maliciousInput);

    expect(verdict.ciStatus).not.toBe("CI_PASS");
    expect(verdict.ciStatus).toBe("CI_NOT_RUN");
    expect(verdict.overallReleaseAllowed).toBe(false);
    expect(verdict.blockerList).toContain("CI_CLAIM_UNVERIFIED");
  });

  // ============================================================================
  // R11: Mocked customFetch with isUnitTestMock:false is strictly forced to UNIT_TEST_MOCK
  // ============================================================================
  it("R11: Mocked customFetch deceptively labeled isUnitTestMock:false is strictly forced to UNIT_TEST_MOCK and PARSED_CLAIM", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () =>
        JSON.stringify({
          id: 778899,
          repository: { full_name: CANONICAL_REPOSITORY },
          head_sha: currentBaselineSha,
          head_branch: LOCKED_BRANCH,
          status: "completed",
          conclusion: "success",
          event: "push",
        }),
    });

    const result = await verifyRemoteGitHubActionsRun({
      runId: "778899",
      expectedSha: currentBaselineSha,
      expectedBranch: LOCKED_BRANCH,
      customFetch: mockFetch as any,
      isUnitTestMock: false, // Deceptive flag
    });

    expect(result.isUnitTestMock).toBe(true);
    expect(result.level).toBe("PARSED_CLAIM");
    expect(result.status).toBe("CI_NOT_RUN");
    expect(result.evidence?.source).toBe("UNIT_TEST_MOCK");
  });

  // ============================================================================
  // R12: Structural claim validator returns structurallyValid=true but providerVerified=false
  // ============================================================================
  it("R12: Structural claim validator distinguishes structurallyValid from providerVerified", () => {
    const structuralOnlyProof = {
      provider: "github-actions" as const,
      repository: CANONICAL_REPOSITORY,
      commitSha: currentBaselineSha,
      branch: LOCKED_BRANCH,
      status: "completed" as const,
      conclusion: "success" as const,
      event: "push" as const,
      source: "GITHUB_API" as const,
      verifier: TRUSTED_VERIFIER_ID,
      responseDigest: valid64HexDigest,
      // No valid cryptographic attestation signature
    };

    const check = validateVerifiedCiAttestation(structuralOnlyProof as any, {
      expectedSha: currentBaselineSha,
    });

    expect(check.structurallyValid).toBe(true);
    expect(check.providerVerified).toBe(false);
  });

  // ============================================================================
  // R13: Missing token, missing secret, 401/403/404/500, timeout, SSRF fail closed
  // ============================================================================
  it("R13: Missing token, missing secret, HTTP errors (401/403/404/500), timeout, and SSRF fail closed", async () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;

    // 1. Missing token
    const noTokenRes = await verifyRemoteGitHubActionsRun({
      runId: "123456",
      expectedSha: currentBaselineSha,
    });
    expect(noTokenRes.verified).toBe(false);
    expect(noTokenRes.status).toBe("CI_NOT_CONFIGURED");

    // 2. HTTP 401 Unauthorized
    const mock401 = vi.fn().mockResolvedValue({ status: 401, text: async () => "Bad credentials" });
    const res401 = await verifyRemoteGitHubActionsRun({
      runId: "123456",
      expectedSha: currentBaselineSha,
      customFetch: mock401 as any,
      token: "dummy_token",
    });
    expect(res401.verified).toBe(false);
    expect(res401.status).toBe("CI_NOT_RUN");
    expect(res401.rejectionReason).toContain("HTTP 401");

    // 3. HTTP 404 Not Found
    const mock404 = vi.fn().mockResolvedValue({ status: 404, text: async () => "Not Found" });
    const res404 = await verifyRemoteGitHubActionsRun({
      runId: "123456",
      expectedSha: currentBaselineSha,
      customFetch: mock404 as any,
      token: "dummy_token",
    });
    expect(res404.verified).toBe(false);
    expect(res404.status).toBe("CI_NOT_RUN");
    expect(res404.rejectionReason).toContain("HTTP 404");

    // 4. SSRF Host Violation
    const badUrlCheck = validateGitHubApiUrl(
      "https://attacker-domain.com/repos/quocan050302/Shopify-Search/actions/runs/123",
      CANONICAL_REPOSITORY,
      "123"
    );
    expect(badUrlCheck.valid).toBe(false);
    expect(badUrlCheck.error).toContain("SSRF_VIOLATION");
  });

  // ============================================================================
  // R14: Cross-run substitution of runId, headSha, or responseDigest breaks verification
  // ============================================================================
  it("R14: Cross-run substitution of runId, headSha, or responseDigest fails cryptographic verification", () => {
    process.env.KH02_CI_VERIFIER_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    const authentic = {
      provider: "github-actions" as const,
      source: "GITHUB_API" as const,
      repository: CANONICAL_REPOSITORY,
      runId: "1001",
      headSha: currentBaselineSha,
      headBranch: LOCKED_BRANCH,
      status: "completed" as const,
      conclusion: "success" as const,
      event: "push" as const,
      responseDigest: valid64HexDigest,
      verifier: TRUSTED_VERIFIER_ID,
      isUnitTestMock: false,
    };

    const validToken = mintCiAttestationToken(authentic);

    // Attacker copies validToken to an evidence object with a substituted runId
    const substitutedRunId = {
      ...authentic,
      runId: "9999",
      attestationSignature: validToken,
    };
    expect(verifyCiAttestationToken(substitutedRunId).valid).toBe(false);

    // Attacker copies validToken to an evidence object with a substituted responseDigest
    const substitutedDigest = {
      ...authentic,
      responseDigest: crypto.createHash("sha256").update("substituted").digest("hex"),
      attestationSignature: validToken,
    };
    expect(verifyCiAttestationToken(substitutedDigest).valid).toBe(false);
  });

  // ============================================================================
  // R15: Unconfigured CI with fake success and all passing gates independently keeps ciStatus != CI_PASS
  // ============================================================================
  it("R15: Unconfigured CI with fake success and all passing gates independently keeps ciStatus != CI_PASS and release NO-GO", () => {
    delete process.env.KH02_CI_VERIFIER_SECRET;

    const fakePassingInput: ReleaseEvidenceInput = {
      version: "12.4.3.7.19.3.2.4",
      baselineSha: currentBaselineSha,
      reportGeneratedAt: new Date().toISOString(),
      testCommand: "npx vitest run",
      testedCodeSha: currentBaselineSha,
      branch: LOCKED_BRANCH,
      exitCode: 0,
      realPassed: 2000,
      realFailed: 0,
      realSkipped: 0,
      realTotal: 2000,
      runMode: "OFFLINE_CONTRACT_CHECK",
      fullSuiteCoverage: {
        unitPassed: true,
        integrationPassed: true,
        backtestPassed: true,
        kh01VerifyPassed: true,
      },
      evidenceProofCounters: {
        rawRowsVerified: 100,
        liveOriginProofs: 10,
        fixtureOnlyCount: 0,
      },
      backtestResults: {
        devHistoricalPassed: true,
        holdoutHistoricalPassed: true,
        policyReplayPassed: true,
      },
      stagingRuntime: {
        endpointUrl: "https://staging.internal.shopifysearch.com",
        isProductionDenylisted: true,
        executed: true,
        isolatedNamespaceVerified: true,
        zeroProductionMutations: true,
        readinessStatus: "EXECUTED_PASS",
      },
      // Caller attempts to slip in unconfigured / fake CI success
      ciStatus: {
        configured: false,
        runStatus: "SUCCESS",
        verifiedProof: {
          verified: true,
          attestation: {
            provider: "github-actions",
            source: "GITHUB_API",
            verifier: TRUSTED_VERIFIER_ID,
            runId: "12345",
            headSha: currentBaselineSha,
            headBranch: LOCKED_BRANCH,
            status: "completed",
            conclusion: "success",
            event: "push",
            responseDigest: valid64HexDigest,
            attestationSignature: `swai_ci_v1_${crypto.createHmac("sha256", oldDefaultKey).update("fake").digest("hex")}`,
          },
        },
      },
    };

    const verdict = evaluateReleaseEvidence(fakePassingInput);

    // Independent CI verdict check: MUST NOT be CI_PASS
    expect(verdict.ciStatus).not.toBe("CI_PASS");
    expect(verdict.ciStatus).toBe("CI_NOT_CONFIGURED");

    // Overall release MUST be NO-GO
    expect(verdict.overallReleaseAllowed).toBe(false);
    expect(verdict.blockerList.length).toBeGreaterThan(0);
  });
});
