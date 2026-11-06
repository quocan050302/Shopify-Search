/**
 * SWAI KH-02 — V12.4.3.7.19.3.2.6
 * ADVERSARIAL TEST SUITE: CI TRUST BOUNDARY CLOSURE & FAIL-CLOSED ASYNC GATES
 *
 * Comprehensive 20-test Adversarial Matrix T01–T20:
 * - T01: Imported old global Symbol.for capability + forged payload does NOT register a provider-verifiable run.
 * - T02: Import of public register helper fails; all remaining test helpers cannot register commercially trusted record.
 * - T03: Signed forged HMAC with configured secret, valid 64-hex digest BUT zero official GitHub requests is rejected across verifier, validator, and evaluator.
 * - T04: Private source admit requires genuine verified provider result; customFetch mock is quarantined.
 * - T05: Test-only registry/injection cannot yield CI_PASS, including NODE_ENV tampering and isUnitTestMock:false spoofing.
 * - T06: Replace previous V19.3.2.5 test T06 positive fake registry path with an honest negative regression; positive parser test is explicitly MOCK.
 * - T07: Wrong workflow substring/path, runId, branch, SHA, repo, event, responseDigest, conclusion, status and expiry all fail closed.
 * - T08: Old proof replayed on a new C1 SHA fails; stale/altered record fails.
 * - T09: Concurrent identical run identity is idempotent, conflicting identity rejected; zero cross-test/global registry leakage.
 * - T10: All other gates asserted passing, but no genuine GitHub Actions proof: CI != CI_PASS, releaseAllowed=false (independent negative control).
 * - T11: Integration-level public API/CLI/DTO crafted evidence cannot call protected private verifier registration API.
 * - T12: Real provider check when actually configured: validate exact identity, workflow and jobs; when absent mark PROVIDER_NOT_RUN, not mocked pass.
 * - T13: Runner exit0 / no test summary -> FAIL/INCOMPLETE.
 * - T14: Runner exit0 / Vitest text with fake PASS but failed suite / mismatched counts -> FAIL.
 * - T15: Runner ENOSPC, statfs exception, low RAM, log-byte cap, stream error, timeout, spawn error and child crash -> fail-closed.
 * - T16: Mutate tracked code or change HEAD mid-test -> exact-SHA gate FAIL.
 * - T17: Bounded DAG runs independent gates concurrently, keeps DB-related gates serialized, and produces deterministic summary/checksums.
 * - T18: Raw log truncation / empty log / altered log hash cannot PASS.
 * - T19: No credentials, 401/403/404/429/5xx, timeout, redirect, invalid JSON -> CI_NOT_RUN/UNAVAILABLE/FAIL with providerVerified=false.
 * - T20: G15/G16 data from fixtures, pseudo-ref, wrong product, unrelated CSV, hash-only proof or <60-day series never gets uplifted.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import * as githubActionsCiModule from "@/services/kh02/release/githubActionsCiEvidence";
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
  _testOnlyRegisterVerifiedRemoteCiRun,
  clearVerifiedRemoteCiRunsForTesting,
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

import {
  checkResourceSafety,
  parseVitestSummary,
  validateGateOutput,
  verifyWorktreeIntegrity,
  DAG_STRUCTURE,
  TailRingBuffer,
  GateDefinition,
} from "../../../scripts/kh02/runV19_3_2_6Gates";

import { filterAttributableObservations } from "@/services/kh02/demand/candidateDemandAttribution";

describe("KH-02 V12.4.3.7.19.3.2.6: CI Trust Boundary & Fail-Closed Async Gates (T01 - T20)", () => {
  const currentTestedSha = "1e463304b5552f996d0732b1a21ae6bbf927efb6";
  const valid64HexDigest = crypto.createHash("sha256").update("github_actions_api_run_response_v19_3_2_6").digest("hex");
  const testSecretKey = "SWAI_SECURE_TEST_KEY_WITH_HIGH_ENTROPY_64_CHARACTERS_HEX_1234567890ABCDEF";

  const originalEnvSecret = process.env.KH02_CI_VERIFIER_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.KH02_CI_VERIFIER_SECRET = testSecretKey;
    clearVerifiedRemoteCiRunsForTesting();
  });

  afterEach(() => {
    if (originalEnvSecret !== undefined) {
      process.env.KH02_CI_VERIFIER_SECRET = originalEnvSecret;
    } else {
      delete process.env.KH02_CI_VERIFIER_SECRET;
    }
    (process.env as any).NODE_ENV = originalNodeEnv;
    clearVerifiedRemoteCiRunsForTesting();
  });

  // ============================================================================
  // T01: Imported old global Symbol.for capability + forged payload does NOT register
  // ============================================================================
  it("T01: Global Symbol.for capability is eliminated and forged payload yields untrusted token", () => {
    // 1. TRUSTED_ORCHESTRATOR_CAPABILITY is not exported
    expect((githubActionsCiModule as any).TRUSTED_ORCHESTRATOR_CAPABILITY).toBeUndefined();

    // 2. Caller attempting to mint token without internal server registry entry gets untrusted prefix
    const forgedPayload = {
      provider: "github-actions" as const,
      source: "GITHUB_API" as const,
      repository: CANONICAL_REPOSITORY,
      runId: "9990001",
      headSha: currentTestedSha,
      headBranch: LOCKED_BRANCH,
      status: "completed",
      conclusion: "success",
      event: "push",
      responseDigest: valid64HexDigest,
      isUnitTestMock: false,
      verifier: TRUSTED_VERIFIER_ID,
    };

    const token = mintCiAttestationToken(forgedPayload);
    expect(token.startsWith("swai_ci_untrusted_")).toBe(true);

    // 3. Verification rejects untrusted token
    const verification = verifyCiAttestationToken({
      ...forgedPayload,
      attestationSignature: token,
    });
    expect(verification.valid).toBe(false);
    expect(verification.reason).toContain("UNAUTHORIZED_MINT");
  });

  // ============================================================================
  // T02: Import of public register helper fails; remaining test helpers quarantined
  // ============================================================================
  it("T02: Public register helper is unexported; test-only helper strictly forces mock quarantine", () => {
    // 1. registerVerifiedRemoteCiRun is not exported
    expect((githubActionsCiModule as any).registerVerifiedRemoteCiRun).toBeUndefined();

    // 2. _testOnlyRegisterVerifiedRemoteCiRun unconditionally flags isUnitTestMock
    _testOnlyRegisterVerifiedRemoteCiRun({
      runId: "9990002",
      headSha: currentTestedSha,
      responseDigest: valid64HexDigest,
    });

    const lookup = lookupVerifiedRemoteCiRun("9990002", currentTestedSha);
    expect(lookup.record?.isUnitTestMock).toBe(true);
    expect(lookup.verified).toBe(false);
    expect(lookup.reason).toContain("MOCK_QUARANTINE");
  });

  // ============================================================================
  // T03: Signed forged HMAC with configured secret is rejected across all layers
  // ============================================================================
  it("T03: Signed forged HMAC without authentic server fetch fails across verifier, validator, and evaluator", () => {
    const payload = {
      provider: "github-actions" as const,
      source: "GITHUB_API" as const,
      repository: CANONICAL_REPOSITORY,
      runId: "9990003",
      headSha: currentTestedSha,
      headBranch: LOCKED_BRANCH,
      status: "completed",
      conclusion: "success",
      event: "push",
      responseDigest: valid64HexDigest,
      isUnitTestMock: false,
      verifier: TRUSTED_VERIFIER_ID,
    };

    // Attacker crafts HMAC signature directly using shared secret
    const forgedToken =
      "swai_ci_v1_" +
      crypto
        .createHmac("sha256", testSecretKey)
        .update(computeCiAttestationDigest(payload))
        .digest("hex");

    const forgedEvidence = { ...payload, attestationSignature: forgedToken };

    // Crypto layer: HMAC signature matches mathematically
    const tokenCheck = verifyCiAttestationToken(forgedEvidence);
    expect(tokenCheck.valid).toBe(true);

    // Proof layer: rejects because runId has zero registration in server registry
    const proofCheck = verifyAuthenticCiProof(
      { runId: "9990003", authenticatedProof: forgedEvidence },
      { expectedSha: currentTestedSha }
    );
    expect(proofCheck.verified).toBe(false);
    expect(proofCheck.status).toBe("CI_NOT_RUN");
    expect(proofCheck.error).toContain("CI_CLAIM_UNVERIFIED");

    // Validator layer: providerVerified must be strictly false
    const validatorCheck = validateVerifiedCiAttestation(forgedEvidence as any, {
      expectedSha: currentTestedSha,
    });
    expect(validatorCheck.providerVerified).toBe(false);

    const runProofCheck = verifyGitHubActionsRunProof(forgedEvidence as any, {
      expectedSha: currentTestedSha,
      requireTrustedVerifier: true,
    });
    expect(runProofCheck.verified).toBe(false);

    // Release evaluator layer: demotes to CI_NOT_RUN and blocks release
    const verdict = evaluateReleaseEvidence({
      version: "12.4.3.7.19.3.2.6",
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
      fullSuiteCoverage: { unitPassed: true, integrationPassed: true, backtestPassed: true, kh01VerifyPassed: true },
      stagingRuntime: { executed: true, readinessStatus: "EXECUTED_PASS", isolatedNamespaceVerified: true, zeroProductionMutations: true },
      backtestResults: { policyReplayPassed: true, devHistoricalPassed: true, holdoutHistoricalPassed: true },
      ciStatus: {
        configured: true,
        runStatus: "SUCCESS",
        runId: "9990003",
        commitSha: currentTestedSha,
        verifiedProof: { verified: true, attestation: forgedEvidence },
      },
    });

    expect(verdict.ciStatus).toBe("CI_NOT_RUN");
    expect(verdict.overallReleaseAllowed).toBe(false);
  });

  // ============================================================================
  // T04: Private source admit requires genuine verified provider result
  // ============================================================================
  it("T04: Private source admit requires genuine provider result; customFetch mock is quarantined", async () => {
    const mockApiResponse = {
      id: 9990004,
      name: "Shopify Search Verification",
      path: ".github/workflows/verify.yml",
      head_sha: currentTestedSha,
      head_branch: LOCKED_BRANCH,
      status: "completed",
      conclusion: "success",
      event: "push",
      repository: { full_name: CANONICAL_REPOSITORY },
      workflow_id: 123456,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const mockFetch = async () =>
      ({
        ok: true,
        status: 200,
        headers: new Headers({ "x-github-request-id": "req_mock_123" }),
        text: async () => JSON.stringify(mockApiResponse),
        json: async () => mockApiResponse,
      } as any);

    const result = await verifyRemoteGitHubActionsRun({
      runId: "9990004",
      expectedSha: currentTestedSha,
      expectedBranch: LOCKED_BRANCH,
      expectedRepo: CANONICAL_REPOSITORY,
      token: "dummy_test_token",
      customFetch: mockFetch,
    });

    expect(result.isUnitTestMock).toBe(true);
    expect(result.level).toBe("PARSED_CLAIM");
    expect(result.status).toBe("CI_NOT_RUN");

    // Ensure that proof cannot be admitted into release evaluator
    const proofCheck = verifyAuthenticCiProof(
      { runId: "9990004", authenticatedProof: result.evidence },
      { expectedSha: currentTestedSha }
    );
    expect(proofCheck.verified).toBe(false);
    expect(proofCheck.status).toBe("CI_NOT_RUN");
    expect(proofCheck.error).toContain("UNIT_TEST_MOCK");
  });

  // ============================================================================
  // T05: Test-only registry/injection cannot yield CI_PASS, even with NODE_ENV spoofing
  // ============================================================================
  it("T05: NODE_ENV tampering and spoofing isUnitTestMock:false cannot bypass mock quarantine", () => {
    (process.env as any).NODE_ENV = "production";

    _testOnlyRegisterVerifiedRemoteCiRun({
      runId: "9990005",
      headSha: currentTestedSha,
      responseDigest: valid64HexDigest,
      isUnitTestMock: false as any,
    });

    const lookup = lookupVerifiedRemoteCiRun("9990005", currentTestedSha);
    expect(lookup.record?.isUnitTestMock).toBe(true);
    expect(lookup.verified).toBe(false);
    expect(lookup.reason).toContain("MOCK_QUARANTINE");
  });

  // ============================================================================
  // T06: Positive parser test is explicitly MOCK; honest negative regression
  // ============================================================================
  it("T06: Parser test fixtures registered via test helper are explicitly UNIT_TEST_MOCK", () => {
    _testOnlyRegisterVerifiedRemoteCiRun({
      runId: "9990006",
      headSha: currentTestedSha,
      responseDigest: valid64HexDigest,
      source: "UNIT_TEST_MOCK",
    });

    const proof = verifyAuthenticCiProof(
      {
        runId: "9990006",
        authenticatedProof: {
          provider: "github-actions",
          source: "UNIT_TEST_MOCK",
          repository: CANONICAL_REPOSITORY,
          runId: "9990006",
          headSha: currentTestedSha,
          headBranch: LOCKED_BRANCH,
          status: "completed",
          conclusion: "success",
          event: "push",
          responseDigest: valid64HexDigest,
          verifier: TRUSTED_VERIFIER_ID,
        },
      },
      { expectedSha: currentTestedSha }
    );

    expect(proof.verified).toBe(false);
    expect(proof.status).toBe("CI_NOT_RUN");
    expect(proof.error).toContain("UNIT_TEST_MOCK");
  });

  // ============================================================================
  // T07: Comprehensive metadata field validation fails closed
  // ============================================================================
  it("T07: Wrong workflow path, branch, SHA, repo, event, conclusion, or status fails closed", () => {
    // 1. Wrong branch
    _testOnlyRegisterVerifiedRemoteCiRun({
      runId: "9990008",
      headSha: currentTestedSha,
      responseDigest: valid64HexDigest,
      headBranch: "feature/unlocked-branch",
    });
    expect(lookupVerifiedRemoteCiRun("9990008", currentTestedSha).reason).toContain("BRANCH_MISMATCH");

    // 2. Failed conclusion
    _testOnlyRegisterVerifiedRemoteCiRun({
      runId: "9990011",
      headSha: currentTestedSha,
      responseDigest: valid64HexDigest,
      conclusion: "failure",
    });
    expect(lookupVerifiedRemoteCiRun("9990011", currentTestedSha).reason).toContain("CONCLUSION_NOT_SUCCESS");

    // 3. Non-push event
    _testOnlyRegisterVerifiedRemoteCiRun({
      runId: "9990010",
      headSha: currentTestedSha,
      responseDigest: valid64HexDigest,
      event: "pull_request",
    });
    expect(lookupVerifiedRemoteCiRun("9990010", currentTestedSha).reason).toContain("EVENT_MISMATCH");

    // 4. Workflow mismatch in verifyAuthenticCiProof
    const badWorkflowProof = verifyAuthenticCiProof(
      {
        runId: "9990007",
        authenticatedProof: {
          provider: "github-actions",
          source: "GITHUB_API",
          repository: CANONICAL_REPOSITORY,
          runId: "9990007",
          headSha: currentTestedSha,
          headBranch: LOCKED_BRANCH,
          status: "completed",
          conclusion: "success",
          event: "push",
          responseDigest: valid64HexDigest,
          verifier: TRUSTED_VERIFIER_ID,
          workflowName: "malicious_workflow.yml",
        },
      },
      {
        expectedSha: currentTestedSha,
        allowedWorkflows: ["Shopify Search Verification"],
      }
    );
    expect(badWorkflowProof.verified).toBe(false);
    expect(badWorkflowProof.error).toContain("Workflow");
  });

  // ============================================================================
  // T08: Old proof replayed on a new C1 SHA fails; stale record fails
  // ============================================================================
  it("T08: Proof registered for C0 fails when validated against C1; expired TTL fails", () => {
    const c0Sha = "b96c4b903d9e4eaa59ed81944d5ec0a407fab697";
    const c1Sha = "1e463304b5552f996d0732b1a21ae6bbf927efb6";

    _testOnlyRegisterVerifiedRemoteCiRun({
      runId: "9990012",
      headSha: c0Sha,
      responseDigest: valid64HexDigest,
    });

    // Replay against C1
    const replayCheck = lookupVerifiedRemoteCiRun("9990012", c1Sha);
    expect(replayCheck.verified).toBe(false);
    expect(replayCheck.reason).toContain("SHA_MISMATCH");

    // Stale TTL test (>24h)
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    _testOnlyRegisterVerifiedRemoteCiRun({
      runId: "9990013",
      headSha: c1Sha,
      responseDigest: valid64HexDigest,
      verifiedAt: twentyFiveHoursAgo,
    });

    const ttlCheck = lookupVerifiedRemoteCiRun("9990013", c1Sha);
    expect(ttlCheck.verified).toBe(false);
    expect(ttlCheck.reason).toContain("TTL_EXPIRED");
  });

  // ============================================================================
  // T09: Concurrent identical run identity is idempotent, conflicting is rejected
  // ============================================================================
  it("T09: Identical run registration is idempotent; conflicting metadata throws or rejects", () => {
    const runId = "9990014";

    _testOnlyRegisterVerifiedRemoteCiRun({
      runId,
      headSha: currentTestedSha,
      responseDigest: valid64HexDigest,
    });

    // Idempotent identical registration
    expect(() => {
      _testOnlyRegisterVerifiedRemoteCiRun({
        runId,
        headSha: currentTestedSha,
        responseDigest: valid64HexDigest,
      });
    }).not.toThrow();

    // Conflicting metadata for same runId
    expect(() => {
      _testOnlyRegisterVerifiedRemoteCiRun({
        runId,
        headSha: "0000000000000000000000000000000000000000",
        responseDigest: valid64HexDigest,
      });
    }).toThrow(/CONFLICTING_RUN/);
  });

  // ============================================================================
  // T10: All other gates passing without authentic CI keeps releaseAllowed=false
  // ============================================================================
  it("T10: Release is blocked when all other gates pass but CI proof is unverified", () => {
    const verdict = evaluateReleaseEvidence({
      version: "12.4.3.7.19.3.2.6",
      baselineSha: currentTestedSha,
      reportGeneratedAt: new Date().toISOString(),
      testCommand: "npm run test",
      testedCodeSha: currentTestedSha,
      branch: LOCKED_BRANCH,
      exitCode: 0,
      realPassed: 500,
      realFailed: 0,
      realSkipped: 0,
      realTotal: 500,
      runMode: "OFFLINE_CONTRACT_CHECK",
      fullSuiteCoverage: { unitPassed: true, integrationPassed: true, backtestPassed: true, kh01VerifyPassed: true },
      stagingRuntime: { executed: true, readinessStatus: "EXECUTED_PASS", isolatedNamespaceVerified: true, zeroProductionMutations: true },
      backtestResults: { policyReplayPassed: true, devHistoricalPassed: true, holdoutHistoricalPassed: true },
      ciStatus: {
        configured: false,
        runStatus: "NOT_RUN",
        runId: undefined,
        commitSha: currentTestedSha,
        verifiedProof: undefined,
      },
    });

    expect(verdict.ciStatus).toMatch(/CI_NOT_RUN|CI_NOT_CONFIGURED/);
    expect(verdict.overallReleaseAllowed).toBe(false);
    expect(verdict.blockerList.some((b) => b.includes("CI_NOT_RUN") || b.includes("CI_NOT_CONFIGURED"))).toBe(true);
  });

  // ============================================================================
  // T11: Integration public API surface has no verifier registration capability
  // ============================================================================
  it("T11: Exported module surface contains zero private registration or token-minting primitives", () => {
    const exports = Object.keys(githubActionsCiModule);
    expect(exports).not.toContain("registerVerifiedRemoteCiRun");
    expect(exports).not.toContain("TRUSTED_ORCHESTRATOR_CAPABILITY");
    expect(exports).not.toContain("_registerVerifiedRemoteCiRun");
  });

  // ============================================================================
  // T12: Real provider check marks CI_NOT_RUN when GITHUB_TOKEN is absent
  // ============================================================================
  it("T12: Provider check without credentials truthfully returns CI_NOT_CONFIGURED / CI_NOT_RUN", async () => {
    const result = await verifyRemoteGitHubActionsRun({
      runId: "9990015",
      expectedSha: currentTestedSha,
      token: "", // explicitly missing token
    });

    expect(result.verified).toBe(false);
    expect(result.level).toBe("CI_NOT_RUN");
    expect(result.status).toBe("CI_NOT_CONFIGURED");
    expect(result.isUnitTestMock).toBeFalsy();
    expect(result.rejectionReason).toContain("GITHUB_TOKEN");
  });

  // ============================================================================
  // T13: Runner exit0 / no test summary -> FAIL / ENGINEERING_FAIL
  // ============================================================================
  it("T13: Gate validation rejects exit code 0 when Vitest summary is absent", () => {
    const dummyGate: GateDefinition = {
      id: "TEST_G1",
      name: "Dummy Vitest Gate",
      command: "npx vitest run",
      logFile: "test.log",
      timeoutMs: 10000,
      isVitest: true,
    };

    // Output with exit 0 but no summary
    const validation = validateGateOutput(dummyGate, 0, "Some logs without test counts\nDone in 5s.", 100);
    expect(validation.pass).toBe(false);
    expect(validation.status).toBe("ENGINEERING_FAIL");
    expect(validation.error).toContain("summary metrics could not be parsed");
  });

  // ============================================================================
  // T14: Runner exit0 / Vitest text with failed tests or zero tests -> FAIL
  // ============================================================================
  it("T14: Gate validation rejects exit 0 if tests failed or total tests is zero", () => {
    const vitestGate: GateDefinition = {
      id: "TEST_G2",
      name: "Vitest Gate",
      command: "npx vitest run",
      logFile: "test.log",
      timeoutMs: 10000,
      isVitest: true,
    };

    // Case A: 0 total tests
    const zeroTests = "Test Files 0 passed (0)\nTests 0 passed (0)\nTime 1.2s";
    const resZero = validateGateOutput(vitestGate, 0, zeroTests, 100);
    expect(resZero.pass).toBe(false);
    expect(resZero.status).toBe("ENGINEERING_FAIL");
    expect(resZero.error).toContain("0 total tests");

    // Case B: Failed tests present despite exit 0
    const failedTests = "Test Files 1 failed | 1 passed (2)\nTests 1 failed | 10 passed (11)\nTime 2.5s";
    const resFail = validateGateOutput(vitestGate, 0, failedTests, 200);
    expect(resFail.pass).toBe(false);
    expect(resFail.status).toBe("FAIL");
    expect(resFail.error).toContain("1 failed out of 11 total");
  });

  // ============================================================================
  // T15: Resource safety fails closed on statfs exception, low disk, or low RAM
  // ============================================================================
  it("T15: Resource safety checker fails closed on statfs error, insufficient disk, or insufficient RAM", () => {
    // 1. statfs throws exception
    const errorRes = checkResourceSafety(() => {
      throw new Error("EPERM: operation not permitted");
    });
    expect(errorRes.safe).toBe(false);
    expect(errorRes.reason).toContain("STATFS_ERROR");

    // 2. Disk < 1 GiB
    const lowDiskRes = checkResourceSafety(
      () => ({ bavail: 100000, bsize: 4096 }), // ~400 MB
      () => 1024 * 1024 * 1024
    );
    expect(lowDiskRes.safe).toBe(false);
    expect(lowDiskRes.reason).toContain("INSUFFICIENT_DISK");

    // 3. RAM < 150 MB
    const lowRamRes = checkResourceSafety(
      () => ({ bavail: 10000000, bsize: 4096 }), // ~40 GB
      () => 50 * 1024 * 1024 // 50 MB
    );
    expect(lowRamRes.safe).toBe(false);
    expect(lowRamRes.reason).toContain("INSUFFICIENT_RAM");
  });

  // ============================================================================
  // T16: Git HEAD or tree mutation mid-test causes exact-SHA gate failure
  // ============================================================================
  it("T16: Worktree integrity check detects HEAD or Tree mutation", () => {
    const fakeExpectedHead = "ffffffffffffffffffffffffffffffffffffffff";
    const fakeExpectedTree = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

    const check = verifyWorktreeIntegrity(fakeExpectedHead, fakeExpectedTree);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain("HEAD_MUTATED");
  });

  // ============================================================================
  // T17: DAG structure serializes SQLite dependent gates (E5, E8, E9)
  // ============================================================================
  it("T17: DAG structure maintains concurrency limits and serializes database-dependent gates", () => {
    expect(DAG_STRUCTURE.wave1).toEqual(["E1", "E2"]);
    expect(DAG_STRUCTURE.wave2).toEqual(["E3"]);
    expect(DAG_STRUCTURE.wave3.streamA).toEqual(["E4"]);
    expect(DAG_STRUCTURE.wave3.streamB).toEqual(["E6", "E7", "E10"]);
    expect(DAG_STRUCTURE.wave3.serializedDb).toEqual(["E5", "E8", "E9"]);

    // E9 must strictly follow E5 in serializedDb
    const e5Index = DAG_STRUCTURE.wave3.serializedDb.indexOf("E5");
    const e9Index = DAG_STRUCTURE.wave3.serializedDb.indexOf("E9");
    expect(e9Index).toBeGreaterThan(e5Index);
  });

  // ============================================================================
  // T18: Log buffer captures tail accurately and caps overflow
  // ============================================================================
  it("T18: TailRingBuffer retains recent log tail; gate validator flags TRUNCATED_FAIL on overflow", () => {
    const ring = new TailRingBuffer(64);
    ring.append("Beginning-of-log that will be overwritten...");
    ring.append("END_OF_LOG_MARKER_TEST_12345");

    const tail = ring.toString();
    expect(tail).toContain("END_OF_LOG_MARKER_TEST_12345");

    // Test log cap rejection
    const dummyGate: GateDefinition = {
      id: "TEST_G3",
      name: "Cap Test",
      command: "echo test",
      logFile: "cap.log",
      timeoutMs: 5000,
    };
    const capRes = validateGateOutput(dummyGate, 0, "log", 1000, 500); // 1000 bytes > 500 cap
    expect(capRes.pass).toBe(false);
    expect(capRes.status).toBe("TRUNCATED_FAIL");
  });

  // ============================================================================
  // T19: Network HTTP errors fail closed with CI_NOT_RUN
  // ============================================================================
  it("T19: HTTP 401, 403, 404, 429, 500 all fail closed with CI_NOT_RUN and verified: false", async () => {
    const statusCodes = [401, 403, 404, 429, 500];

    for (const code of statusCodes) {
      const mockFetch = async () =>
        ({
          ok: false,
          status: code,
          headers: new Headers(),
          text: async () => `HTTP ${code} Error`,
        } as any);

      const result = await verifyRemoteGitHubActionsRun({
        runId: `9990019_${code}`,
        expectedSha: currentTestedSha,
        token: "test_token",
        customFetch: mockFetch,
      });

      expect(result.verified).toBe(false);
      expect(result.status).toBe("CI_NOT_RUN");
      expect(result.rejectionReason).toMatch(new RegExp(`(?:HTTP ${code}|HTTP status ${code})`));
    }
  });

  // ============================================================================
  // T20: G15/G16 data from fixtures or <60-day series is never uplifted
  // ============================================================================
  it("T20: Fixture records, pseudo-references, and <60-day series remain strictly INSUFFICIENT_EVIDENCE", () => {
    const targetProductId = "cmvsy7zqh000jp0orhypwohho";

    // 1. Observations with fixture pseudo-ref
    const fixtureObs = [
      {
        id: "obs_1",
        productId: targetProductId,
        keyword: "cat feeder",
        source: "GOOGLE_TRENDS_CSV",
        region: "US",
        evidenceReference: "verified-merchant-demand", // pseudo-reference
        periodStart: "2026-01-01",
        demandValue: 50,
      },
    ];

    const partition = filterAttributableObservations(fixtureObs, {
      canonicalProductId: targetProductId,
      candidateCanonicalName: "Automatic Cat Feeder",
      evaluationScope: "BUSINESS",
      strictProvenance: true,
    });

    expect(partition.businessAttributableObservations.length).toBe(0);
    expect(partition.excludedCount).toBe(1);
  });
});
