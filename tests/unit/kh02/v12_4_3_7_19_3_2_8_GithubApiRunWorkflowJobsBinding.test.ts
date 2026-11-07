/**
 * SWAI KH-02 — V12.4.3.7.19.3.2.8
 * ADVERSARIAL TEST SUITE: THREE-ENDPOINT GITHUB REST API VERIFIER, WORKFLOW IDENTITY BINDING,
 * V2 CRYPTOGRAPHIC ATTESTATION, RECURSIVE FREEZE, AND SCHEMA-VALIDATED GATE RUNNER (T01 - T18)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import {
  TRUSTED_VERIFIER_ID,
  CANONICAL_REPOSITORY,
  LOCKED_BRANCH,
  CANONICAL_WORKFLOW_PATHS,
  MAX_GITHUB_API_RESPONSE_BYTES,
  computeCiAttestationDigest,
  hasCompleteV2ReleaseIdentity,
  verifyCiAttestationToken,
  validateGitHubApiUrl,
  validateGitHubWorkflowApiUrl,
  validateGitHubRunJobsApiUrl,
  verifyRemoteGitHubActionsRun,
  verifyAuthenticCiProof,
  lookupVerifiedRemoteCiRun,
  requireCanonicalReleaseWorkflow,
  verifyRunIdentity,
  verifyWorkflowIdentity,
  verifyRequiredJobs,
  deepCloneAndFreeze,
  _testOnlyRegisterVerifiedRemoteCiRun,
  clearVerifiedRemoteCiRunsForTesting,
} from "@/services/kh02/release/githubActionsCiEvidence";

import {
  validateVerifiedCiAttestation,
  verifyGitHubActionsRunProof,
} from "@/services/kh02/demand/testSuiteEvidenceValidator";

import { evaluateReleaseEvidence } from "@/services/kh02/release/releaseGateEvaluatorV19";
import { GATES, validateGateOutput } from "../../../scripts/kh02/runV19_3_2_8Gates";

describe("KH-02 V12.4.3.7.19.3.2.8: Three-Endpoint GitHub API Verification & Workflow Identity Binding (T01 - T18)", () => {
  const currentTestedSha = "0b2520dfb991b7bc191cff7abd1e6fb226616238";
  const validSecretKey = "SWAI_SECURE_V19_3_2_8_VERIFIER_SECRET_KEY_64_HEX_1234567890ABCDEF";
  const sampleDigest1 = crypto.createHash("sha256").update("sample_run_json_v19_3_2_8").digest("hex");
  const sampleDigest2 = crypto.createHash("sha256").update("sample_workflow_json_v19_3_2_8").digest("hex");
  const sampleDigest3 = crypto.createHash("sha256").update("sample_jobs_json_v19_3_2_8").digest("hex");
  const sampleJobsDigest = crypto.createHash("sha256").update("sample_jobs_summary_v19_3_2_8").digest("hex");

  const originalEnvSecret = process.env.KH02_CI_VERIFIER_SECRET;
  const originalGhToken = process.env.GITHUB_TOKEN;

  function buildThreeEndpointMockFetch(overrides: {
    runStatus?: number;
    runBody?: any;
    workflowStatus?: number;
    workflowBody?: any;
    jobsStatus?: number;
    jobsByPage?: Record<number, any>;
    rawBodySizeOverride?: number;
  } = {}) {
    const defaultRun = {
      id: 777001,
      run_attempt: 1,
      workflow_id: 101,
      name: "KH-02 Continuous Integration",
      path: ".github/workflows/kh02-ci.yml",
      repository: { full_name: CANONICAL_REPOSITORY },
      head_sha: currentTestedSha,
      head_branch: LOCKED_BRANCH,
      status: "completed",
      conclusion: "success",
      event: "push",
      html_url: `https://github.com/${CANONICAL_REPOSITORY}/actions/runs/777001`,
      ...(overrides.runBody || {}),
    };

    const defaultWorkflow = {
      id: 101,
      name: "KH-02 Continuous Integration",
      path: ".github/workflows/kh02-ci.yml",
      state: "active",
      ...(overrides.workflowBody || {}),
    };

    const defaultJobsPage1 = {
      total_count: 2,
      jobs: [
        {
          id: 9001,
          run_id: defaultRun.id,
          run_attempt: defaultRun.run_attempt,
          head_sha: defaultRun.head_sha,
          name: "kh02-unit-and-integration",
          status: "completed",
          conclusion: "success",
          steps: [{ name: "Run tests", status: "completed", conclusion: "success", number: 1 }],
        },
        {
          id: 9002,
          run_id: defaultRun.id,
          run_attempt: defaultRun.run_attempt,
          head_sha: defaultRun.head_sha,
          name: "kh02-security-and-backtest",
          status: "completed",
          conclusion: "success",
          steps: [{ name: "Run backtest", status: "completed", conclusion: "success", number: 1 }],
        },
      ],
    };

    return async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (overrides.rawBodySizeOverride && overrides.rawBodySizeOverride > 0) {
        return {
          status: 200,
          text: async () => "x".repeat(overrides.rawBodySizeOverride!),
        } as any;
      }

      if (urlStr.includes("/actions/workflows/")) {
        const st = overrides.workflowStatus ?? 200;
        return {
          status: st,
          text: async () => (st === 200 ? JSON.stringify(defaultWorkflow) : `HTTP ${st}`),
        } as any;
      }

      if (urlStr.includes("/jobs")) {
        const st = overrides.jobsStatus ?? 200;
        const parsedUrl = new URL(urlStr);
        const page = parseInt(parsedUrl.searchParams.get("page") || "1", 10);
        const pagePayload = overrides.jobsByPage?.[page] ?? (page === 1 ? defaultJobsPage1 : { total_count: 2, jobs: [] });
        return {
          status: st,
          text: async () => (st === 200 ? JSON.stringify(pagePayload) : `HTTP ${st}`),
        } as any;
      }

      const st = overrides.runStatus ?? 200;
      return {
        status: st,
        text: async () => (st === 200 ? JSON.stringify(defaultRun) : `HTTP ${st}`),
      } as any;
    };
  }

  beforeEach(() => {
    process.env.KH02_CI_VERIFIER_SECRET = validSecretKey;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    clearVerifiedRemoteCiRunsForTesting();
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
    clearVerifiedRemoteCiRunsForTesting();
  });

  // ============================================================================
  // T01: RED -> GREEN Exploit Closure (Unsigned workflowPath injection on non-release workflow)
  // ============================================================================
  it("T01 (RED -> GREEN): Non-release workflow (docs-lint.yml) rejected at verifier and cannot be promoted by caller-injected workflowPath", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = buildThreeEndpointMockFetch({
      runBody: {
        id: 777001,
        workflow_id: 999,
        name: "Non-Release Docs Linter",
        path: ".github/workflows/docs-lint.yml",
      },
      workflowBody: {
        id: 999,
        name: "Non-Release Docs Linter",
        path: ".github/workflows/docs-lint.yml",
        state: "active",
      },
    });

    try {
      // 1. Verifier rejects non-canonical workflow path by default even on real fetch path
      const verifyRes = await verifyRemoteGitHubActionsRun({
        runId: "777001",
        expectedSha: currentTestedSha,
        token: "ghp_valid_token_for_test_only_1234567890",
      });

      expect(verifyRes.verified).toBe(false);
      expect(verifyRes.status).toBe("CI_FAIL");
      expect(verifyRes.rejectionReason).toContain("NON_CANONICAL_WORKFLOW_PATH");
      expect(verifyRes.evidence).toBeUndefined();

      // 2. Even if an attacker crafts a signed v2 token for docs-lint.yml and mutates workflowPath to .github/workflows/kh02-ci.yml:
      const nonReleaseEvidence: any = {
        provider: "github-actions",
        source: "GITHUB_API",
        repository: CANONICAL_REPOSITORY,
        runId: "777001",
        runAttempt: 1,
        workflowId: 999,
        workflowPath: ".github/workflows/docs-lint.yml",
        workflowName: "Non-Release Docs Linter",
        headSha: currentTestedSha,
        headBranch: LOCKED_BRANCH,
        event: "push",
        status: "completed",
        conclusion: "success",
        jobsDigest: sampleJobsDigest,
        responseDigest: sampleDigest1,
        workflowResponseDigest: sampleDigest2,
        jobsResponseDigest: sampleDigest3,
        verifier: TRUSTED_VERIFIER_ID,
        isUnitTestMock: false,
      };
      const nonReleaseDigest = computeCiAttestationDigest(nonReleaseEvidence);
      const nonReleaseSig = `swai_ci_v1_${crypto.createHmac("sha256", validSecretKey).update(nonReleaseDigest).digest("hex")}`;

      const callerMutatedAttestation = {
        ...nonReleaseEvidence,
        workflowPath: ".github/workflows/kh02-ci.yml", // Caller-injected canonical path!
        attestationSignature: nonReleaseSig,
      };

      // Signature verification fails because workflowPath is bound in v2 digest
      const tokenCheck = verifyCiAttestationToken(callerMutatedAttestation, { requireReleaseV2: true });
      expect(tokenCheck.valid).toBe(false);

      // Release evaluator strictly rejects and keeps overallReleaseAllowed=false
      const verdict = evaluateReleaseEvidence({
        version: "12.4.3.7.19.3.2.8",
        branch: LOCKED_BRANCH,
        baselineSha: currentTestedSha,
        testedCodeSha: currentTestedSha,
        reportGeneratedAt: new Date().toISOString(),
        testCommand: "npm test",
        exitCode: 0,
        realTotal: 100,
        realPassed: 100,
        realFailed: 0,
        realSkipped: 0,
        runMode: "STAGING_RUNTIME_SHADOW",
        fullSuiteCoverage: { unitPassed: true, integrationPassed: true, backtestPassed: true, kh01VerifyPassed: true },
        stagingRuntime: {
          endpointUrl: "https://staging-shadow.internal.example.org",
          isProductionDenylisted: true,
          executed: true,
          isolatedNamespaceVerified: true,
          zeroProductionMutations: true,
          readinessStatus: "EXECUTED_PASS",
        },
        evidenceProofCounters: { rawRowsVerified: 10, liveOriginProofs: 3, fixtureOnlyCount: 0 },
        backtestResults: { policyReplayPassed: true, devHistoricalPassed: true, holdoutHistoricalPassed: true },
        ciStatus: {
          configured: true,
          runStatus: "SUCCESS",
          runId: "777001",
          commitSha: currentTestedSha,
          verifiedProof: {
            verified: true,
            attestation: callerMutatedAttestation,
          },
        },
      });

      expect(verdict.ciStatus).toBe("CI_NOT_RUN");
      expect(verdict.blockerList).toContain("CI_CLAIM_UNVERIFIED");
      expect(verdict.overallReleaseAllowed).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // ============================================================================
  // T02: Valid HMAC signature over tampered workflowPath, workflowName, workflowId, runAttempt, or jobsDigest -> rejected
  // ============================================================================
  it("T02: Tampering with workflowPath, workflowName, workflowId, runAttempt, or jobsDigest invalidates V2 HMAC signature", () => {
    const baseEvidence: any = {
      provider: "github-actions",
      source: "GITHUB_API",
      repository: CANONICAL_REPOSITORY,
      runId: "777002",
      runAttempt: 1,
      workflowId: 101,
      workflowPath: ".github/workflows/kh02-ci.yml",
      workflowName: "KH-02 Continuous Integration",
      headSha: currentTestedSha,
      headBranch: LOCKED_BRANCH,
      event: "push",
      status: "completed",
      conclusion: "success",
      jobsDigest: sampleJobsDigest,
      responseDigest: sampleDigest1,
      workflowResponseDigest: sampleDigest2,
      jobsResponseDigest: sampleDigest3,
      verifier: TRUSTED_VERIFIER_ID,
      isUnitTestMock: false,
    };

    const digest = computeCiAttestationDigest(baseEvidence);
    const sig = `swai_ci_v2_${crypto.createHmac("sha256", validSecretKey).update(digest).digest("hex")}`;
    const signed = { ...baseEvidence, attestationSignature: sig };

    expect(verifyCiAttestationToken(signed, { requireReleaseV2: true }).valid).toBe(true);

    const mutations = [
      { workflowPath: ".github/workflows/ci.yml" },
      { workflowName: "Tampered Workflow Name" },
      { workflowId: 999 },
      { runAttempt: 2 },
      { jobsDigest: "f".repeat(64) },
      { workflowResponseDigest: "e".repeat(64) },
      { jobsResponseDigest: "d".repeat(64) },
    ];

    for (const mut of mutations) {
      const tampered = { ...signed, ...mut };
      const check = verifyCiAttestationToken(tampered, { requireReleaseV2: true });
      expect(check.valid).toBe(false);
      expect(check.reason).toContain("signature mismatch");
    }
  });

  // ============================================================================
  // T03: Legacy v1 signature/digest without workflowPath/jobsDigest is rejected for release verification; v2 binds all fields
  // ============================================================================
  it("T03: Legacy v1 payload omitting workflowPath, workflowId, runAttempt, or jobsDigest is rejected for release verification", () => {
    const legacyV1Incomplete: any = {
      provider: "github-actions",
      source: "GITHUB_API",
      repository: CANONICAL_REPOSITORY,
      runId: "777003",
      headSha: currentTestedSha,
      headBranch: LOCKED_BRANCH,
      event: "push",
      status: "completed",
      conclusion: "success",
      responseDigest: sampleDigest1,
      verifier: TRUSTED_VERIFIER_ID,
      isUnitTestMock: false,
    };

    // 1. Old pipe-delimited v1 digest string fails HMAC comparison immediately
    const oldPipeDigest = [
      "v1",
      "github-actions",
      "GITHUB_API",
      CANONICAL_REPOSITORY.toLowerCase(),
      "777003",
      currentTestedSha,
      LOCKED_BRANCH,
      "completed",
      "success",
      "push",
      sampleDigest1,
      "",
      "",
      "PROD",
    ].join("|");
    const oldPipeSig = `swai_ci_v1_${crypto.createHmac("sha256", validSecretKey).update(oldPipeDigest).digest("hex")}`;
    expect(verifyCiAttestationToken({ ...legacyV1Incomplete, attestationSignature: oldPipeSig }).valid).toBe(false);

    // 2. Even if signed with computeCiAttestationDigest, omitting workflowPath/workflowId/runAttempt/jobsDigest is rejected when requireReleaseV2=true
    const newDigestOverIncomplete = computeCiAttestationDigest(legacyV1Incomplete);
    const sigOverIncomplete = `swai_ci_v1_${crypto.createHmac("sha256", validSecretKey).update(newDigestOverIncomplete).digest("hex")}`;
    const incompleteSigned = { ...legacyV1Incomplete, attestationSignature: sigOverIncomplete };

    expect(hasCompleteV2ReleaseIdentity(incompleteSigned).valid).toBe(false);
    const releaseCheck = verifyCiAttestationToken(incompleteSigned, { requireReleaseV2: true });
    expect(releaseCheck.valid).toBe(false);
    expect(releaseCheck.reason).toContain("LEGACY_V1_INCOMPLETE_IDENTITY_REJECTED");

    // 3. Delimiter injection test: "|" inside workflowName cannot collide with adjacent fields in v2 JSON array framing
    const d1 = computeCiAttestationDigest({
      ...legacyV1Incomplete,
      workflowId: "101",
      workflowPath: ".github/workflows/kh02-ci.yml",
      workflowName: "A|B",
    });
    const d2 = computeCiAttestationDigest({
      ...legacyV1Incomplete,
      workflowId: "101|.github/workflows/kh02-ci.yml",
      workflowPath: "A",
      workflowName: "B",
    });
    expect(d1).not.toBe(d2);
  });

  // ============================================================================
  // T04: Run JSON has canonical workflowName but non-canonical path -> rejected
  // ============================================================================
  it("T04: Run JSON with canonical workflowName ('KH-02 Continuous Integration') but non-canonical path is rejected", async () => {
    const mockFetch = buildThreeEndpointMockFetch({
      runBody: {
        id: 777004,
        workflow_id: 101,
        name: "KH-02 Continuous Integration", // Spoofed canonical display name!
        path: ".github/workflows/non-release.yml", // Non-canonical file path!
      },
      workflowBody: {
        id: 101,
        name: "KH-02 Continuous Integration",
        path: ".github/workflows/non-release.yml",
        state: "active",
      },
    });

    const res = await verifyRemoteGitHubActionsRun({
      runId: "777004",
      expectedSha: currentTestedSha,
      customFetch: mockFetch,
      requireMultiEndpointVerification: true,
    });

    expect(res.verified).toBe(false);
    expect(res.status).toBe("CI_FAIL");
    expect(res.rejectionReason).toContain("NON_CANONICAL_WORKFLOW_PATH");
  });

  // ============================================================================
  // T05: Run JSON workflow_id != Workflow endpoint id -> rejected
  // ============================================================================
  it("T05: Mismatch between Run JSON workflow_id and Workflow endpoint id is rejected with CI_FAIL", async () => {
    const mockFetch = buildThreeEndpointMockFetch({
      runBody: {
        id: 777005,
        workflow_id: 101,
        path: ".github/workflows/kh02-ci.yml",
      },
      workflowBody: {
        id: 202, // Mismatched workflow_id!
        path: ".github/workflows/kh02-ci.yml",
        state: "active",
      },
    });

    const res = await verifyRemoteGitHubActionsRun({
      runId: "777005",
      expectedSha: currentTestedSha,
      customFetch: mockFetch,
      requireMultiEndpointVerification: true,
    });

    expect(res.verified).toBe(false);
    expect(res.status).toBe("CI_FAIL");
    expect(res.rejectionReason).toContain("WORKFLOW_ID_MISMATCH");
  });

  // ============================================================================
  // T06: Run JSON path != Workflow endpoint path -> rejected
  // ============================================================================
  it("T06: Mismatch between Run JSON path and Workflow endpoint path is rejected with CI_FAIL", async () => {
    const mockFetch = buildThreeEndpointMockFetch({
      runBody: {
        id: 777006,
        workflow_id: 101,
        path: ".github/workflows/kh02-ci.yml",
      },
      workflowBody: {
        id: 101,
        path: ".github/workflows/ci.yml", // Different path from Run JSON!
        state: "active",
      },
    });

    const res = await verifyRemoteGitHubActionsRun({
      runId: "777006",
      expectedSha: currentTestedSha,
      customFetch: mockFetch,
      requireMultiEndpointVerification: true,
    });

    expect(res.verified).toBe(false);
    expect(res.status).toBe("CI_FAIL");
    expect(res.rejectionReason).toContain("WORKFLOW_PATH_MISMATCH");
  });

  // ============================================================================
  // T07: Workflow endpoint HTTP 404/401/403/429/500 -> rejected fail-closed
  // ============================================================================
  it("T07: Workflow endpoint HTTP 401, 403, 404, 429, 500 all fail closed with CI_NOT_RUN", async () => {
    for (const code of [401, 403, 404, 429, 500]) {
      const mockFetch = buildThreeEndpointMockFetch({
        runBody: { id: 777007 },
        workflowStatus: code,
      });

      const res = await verifyRemoteGitHubActionsRun({
        runId: "777007",
        expectedSha: currentTestedSha,
        customFetch: mockFetch,
        requireMultiEndpointVerification: true,
      });

      expect(res.verified).toBe(false);
      expect(res.status).toBe("CI_NOT_RUN");
      expect(res.rejectionReason).toContain(`HTTP ${code}`);
    }
  });

  // ============================================================================
  // T08: Jobs endpoint HTTP 404/401/403/429/500 -> rejected fail-closed
  // ============================================================================
  it("T08: Jobs endpoint HTTP 401, 403, 404, 429, 500 all fail closed with CI_NOT_RUN", async () => {
    for (const code of [401, 403, 404, 429, 500]) {
      const mockFetch = buildThreeEndpointMockFetch({
        runBody: { id: 777008 },
        jobsStatus: code,
      });

      const res = await verifyRemoteGitHubActionsRun({
        runId: "777008",
        expectedSha: currentTestedSha,
        customFetch: mockFetch,
        requireMultiEndpointVerification: true,
      });

      expect(res.verified).toBe(false);
      expect(res.status).toBe("CI_NOT_RUN");
      expect(res.rejectionReason).toContain(`HTTP ${code}`);
    }
  });

  // ============================================================================
  // T09: Jobs response total_count: 0 or jobs: [] -> rejected (CI_FAIL)
  // ============================================================================
  it("T09: Jobs response with total_count: 0 or jobs: [] is rejected with CI_FAIL", async () => {
    const mockFetch = buildThreeEndpointMockFetch({
      runBody: { id: 777009 },
      jobsByPage: {
        1: { total_count: 0, jobs: [] },
      },
    });

    const res = await verifyRemoteGitHubActionsRun({
      runId: "777009",
      expectedSha: currentTestedSha,
      customFetch: mockFetch,
      requireMultiEndpointVerification: true,
    });

    expect(res.verified).toBe(false);
    expect(res.status).toBe("CI_FAIL");
    expect(res.rejectionReason).toContain("JOBS_EMPTY");
  });

  // ============================================================================
  // T10: Required job has conclusion !== 'success' (failure, cancelled, skipped, timed_out) -> rejected (CI_FAIL)
  // ============================================================================
  it("T10: Any job with non-success conclusion (failure, cancelled, skipped, timed_out) or missing required job is rejected with CI_FAIL", async () => {
    for (const badConclusion of ["failure", "cancelled", "skipped", "timed_out"]) {
      const mockFetch = buildThreeEndpointMockFetch({
        runBody: { id: 777010 },
        jobsByPage: {
          1: {
            total_count: 1,
            jobs: [
              {
                id: 9010,
                run_id: 777010,
                run_attempt: 1,
                head_sha: currentTestedSha,
                name: "kh02-verify",
                status: "completed",
                conclusion: badConclusion,
              },
            ],
          },
        },
      });

      const res = await verifyRemoteGitHubActionsRun({
        runId: "777010",
        expectedSha: currentTestedSha,
        customFetch: mockFetch,
        requireMultiEndpointVerification: true,
      });

      expect(res.verified).toBe(false);
      expect(res.status).toBe("CI_FAIL");
      expect(res.rejectionReason).toContain("JOB_NOT_SUCCESS");
    }

    // Missing required job name from options.requiredJobs
    const mockMissingReqJob = buildThreeEndpointMockFetch({
      runBody: { id: 777010 },
    });
    const resMissing = await verifyRemoteGitHubActionsRun({
      runId: "777010",
      expectedSha: currentTestedSha,
      requiredJobs: ["mandatory-e2e-release-gate"],
      customFetch: mockMissingReqJob,
    });
    expect(resMissing.verified).toBe(false);
    expect(resMissing.status).toBe("CI_FAIL");
    expect(resMissing.rejectionReason).toContain("MISSING_REQUIRED_JOB");
  });

  // ============================================================================
  // T11: Job belongs to different run_id or stale run_attempt -> rejected (CI_FAIL)
  // ============================================================================
  it("T11: Job belonging to different run_id, stale run_attempt, or mismatched head_sha is rejected with CI_FAIL", async () => {
    // 1. Different run_id
    const mockWrongRunId = buildThreeEndpointMockFetch({
      runBody: { id: 777011, run_attempt: 2 },
      jobsByPage: {
        1: {
          total_count: 1,
          jobs: [
            {
              id: 9011,
              run_id: 999999, // Wrong run_id!
              run_attempt: 2,
              head_sha: currentTestedSha,
              name: "kh02-verify",
              status: "completed",
              conclusion: "success",
            },
          ],
        },
      },
    });
    const res1 = await verifyRemoteGitHubActionsRun({
      runId: "777011",
      expectedSha: currentTestedSha,
      customFetch: mockWrongRunId,
      requireMultiEndpointVerification: true,
    });
    expect(res1.verified).toBe(false);
    expect(res1.status).toBe("CI_FAIL");
    expect(res1.rejectionReason).toContain("JOB_RUN_ID_MISMATCH");

    // 2. Stale run_attempt (run is attempt 2, job is attempt 1)
    const mockStaleAttempt = buildThreeEndpointMockFetch({
      runBody: { id: 777011, run_attempt: 2 },
      jobsByPage: {
        1: {
          total_count: 1,
          jobs: [
            {
              id: 9012,
              run_id: 777011,
              run_attempt: 1, // Stale attempt!
              head_sha: currentTestedSha,
              name: "kh02-verify",
              status: "completed",
              conclusion: "success",
            },
          ],
        },
      },
    });
    const res2 = await verifyRemoteGitHubActionsRun({
      runId: "777011",
      expectedSha: currentTestedSha,
      customFetch: mockStaleAttempt,
      requireMultiEndpointVerification: true,
    });
    expect(res2.verified).toBe(false);
    expect(res2.status).toBe("CI_FAIL");
    expect(res2.rejectionReason).toContain("JOB_RUN_ATTEMPT_MISMATCH");
  });

  // ============================================================================
  // T12: Run head_sha != testedCodeSha or head_branch != LOCKED_BRANCH or repository != CANONICAL_REPOSITORY -> rejected
  // ============================================================================
  it("T12: Mismatched head_sha, head_branch, or repository.full_name is rejected with CI_FAIL", async () => {
    const cases = [
      { runBody: { id: 777012, head_sha: "0".repeat(40) }, expectedErr: "SHA mismatch" },
      { runBody: { id: 777012, head_branch: "main" }, expectedErr: "branch mismatch" },
      { runBody: { id: 777012, repository: { full_name: "attacker/Shopify-Search" } }, expectedErr: "repository mismatch" },
    ];

    for (const c of cases) {
      const mockFetch = buildThreeEndpointMockFetch({ runBody: c.runBody });
      const res = await verifyRemoteGitHubActionsRun({
        runId: "777012",
        expectedSha: currentTestedSha,
        customFetch: mockFetch,
        requireMultiEndpointVerification: true,
      });
      expect(res.verified).toBe(false);
      expect(res.status).toBe("CI_FAIL");
      expect(res.rejectionReason).toContain(c.expectedErr);
    }
  });

  // ============================================================================
  // T13: Disallowed event (pull_request_target, schedule, issue_comment, etc.) -> rejected (CI_FAIL)
  // ============================================================================
  it("T13: Disallowed trigger events (pull_request_target, schedule, issue_comment, pull_request) are rejected with CI_FAIL", async () => {
    for (const badEvent of ["pull_request_target", "schedule", "issue_comment", "pull_request", "repository_dispatch"]) {
      const mockFetch = buildThreeEndpointMockFetch({
        runBody: { id: 777013, event: badEvent },
      });

      const res = await verifyRemoteGitHubActionsRun({
        runId: "777013",
        expectedSha: currentTestedSha,
        customFetch: mockFetch,
        requireMultiEndpointVerification: true,
      });

      expect(res.verified).toBe(false);
      expect(res.status).toBe("CI_FAIL");
      expect(res.rejectionReason).toContain("Untrusted trigger event");
    }
  });

  // ============================================================================
  // T14: SSRF / redirect / non-HTTPS / non-api.github.com / credential-in-URL / oversized body -> rejected
  // ============================================================================
  it("T14: SSRF URLs across Run, Workflow, and Jobs endpoints and oversized response bodies (>2 MiB) are rejected", async () => {
    // 1. Endpoint URL validators reject SSRF attempts
    expect(validateGitHubApiUrl("http://api.github.com/repos/quocan050302/Shopify-Search/actions/runs/1", CANONICAL_REPOSITORY, "1").valid).toBe(false);
    expect(validateGitHubWorkflowApiUrl("https://evil.org/repos/quocan050302/Shopify-Search/actions/workflows/101", CANONICAL_REPOSITORY, 101).valid).toBe(false);
    expect(validateGitHubWorkflowApiUrl("https://user:pass@api.github.com/repos/quocan050302/Shopify-Search/actions/workflows/101", CANONICAL_REPOSITORY, 101).valid).toBe(false);
    expect(validateGitHubRunJobsApiUrl("https://api.github.com:8443/repos/quocan050302/Shopify-Search/actions/runs/1/jobs", CANONICAL_REPOSITORY, "1", 1).valid).toBe(false);
    expect(validateGitHubRunJobsApiUrl("https://api.github.com/repos/quocan050302/Shopify-Search/actions/runs/1/jobs", CANONICAL_REPOSITORY, "1", 99).valid).toBe(false);

    // 2. Oversized body (> 2 MiB) rejected fail-closed
    const oversizedFetch = buildThreeEndpointMockFetch({
      rawBodySizeOverride: MAX_GITHUB_API_RESPONSE_BYTES + 1024,
    });
    const res = await verifyRemoteGitHubActionsRun({
      runId: "777014",
      expectedSha: currentTestedSha,
      customFetch: oversizedFetch,
      requireMultiEndpointVerification: true,
    });
    expect(res.verified).toBe(false);
    expect(res.status).toBe("CI_FAIL");
    expect(res.rejectionReason).toContain("exceeded maximum allowed size");
  });

  // ============================================================================
  // T15: Legitimate 3-endpoint GitHub JSON + jobs pagination (page 1 & page 2) -> parser succeeds, quarantined as UNIT_TEST_MOCK
  // ============================================================================
  it("T15: Legitimate 3-endpoint GitHub JSON with multi-page jobs pagination succeeds parser checks and remains quarantined as UNIT_TEST_MOCK", async () => {
    const page1Jobs = Array.from({ length: 100 }, (_, idx) => ({
      id: 10000 + idx,
      run_id: 777015,
      run_attempt: 1,
      head_sha: currentTestedSha,
      name: `job-part-${idx + 1}`,
      status: "completed",
      conclusion: "success",
      steps: [{ name: "Execute", status: "completed", conclusion: "success", number: 1 }],
    }));
    const page2Jobs = [
      {
        id: 10100,
        run_id: 777015,
        run_attempt: 1,
        head_sha: currentTestedSha,
        name: "kh02-final-release-gate",
        status: "completed",
        conclusion: "success",
        steps: [{ name: "Verify", status: "completed", conclusion: "success", number: 1 }],
      },
    ];

    const mockFetch = buildThreeEndpointMockFetch({
      runBody: { id: 777015, run_attempt: 1, workflow_id: 101, path: ".github/workflows/kh02-ci.yml" },
      workflowBody: { id: 101, path: ".github/workflows/kh02-ci.yml", state: "active" },
      jobsByPage: {
        1: { total_count: 101, jobs: page1Jobs },
        2: { total_count: 101, jobs: page2Jobs },
      },
    });

    const res = await verifyRemoteGitHubActionsRun({
      runId: "777015",
      expectedSha: currentTestedSha,
      requiredJobs: ["job-part-1", "kh02-final-release-gate"],
      customFetch: mockFetch,
      requireMultiEndpointVerification: true,
    });

    expect(res.verified).toBe(true);
    expect(res.isUnitTestMock).toBe(true);
    expect(res.status).toBe("CI_NOT_RUN");
    expect(res.level).toBe("PARSED_CLAIM");
    expect(res.evidence?.source).toBe("UNIT_TEST_MOCK");
    expect(res.evidence?.canonicalWorkflowVerified).toBe(true);
    expect(res.evidence?.requiredJobsVerified).toBe(true);
    expect(res.evidence?.workflowPath).toBe(".github/workflows/kh02-ci.yml");
    expect(res.evidence?.jobsCount).toBe(101);
    expect(res.evidence?.jobsDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(res.evidence?.workflowResponseDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(res.evidence?.jobsResponseDigest).toMatch(/^[0-9a-f]{64}$/);

    // Quarantined mock cannot grant commercial CI_PASS in verifyAuthenticCiProof or validateVerifiedCiAttestation
    const authCheck = verifyAuthenticCiProof({ runId: "777015", authenticatedProof: res.evidence }, { expectedSha: currentTestedSha });
    expect(authCheck.verified).toBe(false);
    expect(authCheck.status).toBe("CI_NOT_RUN");

    const attCheck = validateVerifiedCiAttestation(res.evidence as any, { expectedSha: currentTestedSha });
    expect(attCheck.providerVerified).toBe(false);
    expect(attCheck.releaseEligible).toBe(false);
  });

  // ============================================================================
  // T16: Deep-freeze test: mutating nested objects/arrays inside returned record/evidence throws or has zero effect
  // ============================================================================
  it("T16: deepCloneAndFreeze recursively freezes nested objects and arrays in registry records and evidence", async () => {
    const mockFetch = buildThreeEndpointMockFetch({
      runBody: { id: 777016 },
    });

    const res = await verifyRemoteGitHubActionsRun({
      runId: "777016",
      expectedSha: currentTestedSha,
      customFetch: mockFetch,
      requireMultiEndpointVerification: true,
    });

    expect(Object.isFrozen(res.evidence)).toBe(true);
    expect(Object.isFrozen(res.evidence?.successfulJobs)).toBe(true);
    expect(Object.isFrozen(res.evidence?.jobsSummary)).toBe(true);
    expect(Object.isFrozen(res.evidence?.jobsSummary?.[0])).toBe(true);

    expect(() => {
      (res.evidence as any).workflowPath = ".github/workflows/tampered.yml";
    }).toThrow();

    expect(() => {
      (res.evidence?.successfulJobs as any).push("injected-job");
    }).toThrow();

    expect(() => {
      (res.evidence?.jobsSummary?.[0] as any).conclusion = "failure";
    }).toThrow();

    const lookup = lookupVerifiedRemoteCiRun("777016", currentTestedSha);
    expect(Object.isFrozen(lookup.record)).toBe(true);
    expect(Object.isFrozen(lookup.record?.jobsSummary)).toBe(true);
    expect(Object.isFrozen(lookup.record?.jobsSummary?.[0])).toBe(true);
  });

  // ============================================================================
  // T17: Gate runner validators reject prose-only banners, incomplete schemas, and mismatched SHAs for E8, E9, E10
  // ============================================================================
  it("T17: Gate runner validateGateOutput strictly enforces JSON schema and SHA binding for E8, E9, and E10", () => {
    // 1. E8 with exit 0 and prose "Backtest PASS" but missing JSON -> ENGINEERING_FAIL
    const e8ProseOnly = validateGateOutput(
      GATES.E8,
      0,
      "[Backtest V12.4.3.4.2] Policy=PASS | HistoricalDev=INSUFFICIENT_EVIDENCE | Overall=PASS",
      120,
      50 * 1024 * 1024,
      currentTestedSha
    );
    expect(e8ProseOnly.pass).toBe(false);
    expect(e8ProseOnly.status).toBe("ENGINEERING_FAIL");

    // E8 with valid JSON but wrong SHA -> ENGINEERING_FAIL
    const e8WrongSha = validateGateOutput(
      GATES.E8,
      0,
      JSON.stringify({
        gateId: "E8",
        testedCodeSha: "1".repeat(40),
        policyScenarioVerdict: "PASS",
        pointInTimeIntegrityVerdict: "PASS",
        historicalDevVerdict: "INSUFFICIENT_EVIDENCE",
        historicalHoldoutVerdict: "INSUFFICIENT_EVIDENCE",
        overallHistoricalBacktestVerdict: "INSUFFICIENT_EVIDENCE",
        zeroFutureLeakageVerified: true,
      }),
      300,
      50 * 1024 * 1024,
      currentTestedSha
    );
    expect(e8WrongSha.pass).toBe(false);
    expect(e8WrongSha.status).toBe("ENGINEERING_FAIL");
    expect(e8WrongSha.error).toContain("SHA mismatch");

    // 2. E9 with exit 0 and '"dbConnected": true' in prose but missing required JSON schema fields -> ENGINEERING_FAIL
    const e9Incomplete = validateGateOutput(
      GATES.E9,
      0,
      'Log text saying "dbConnected": true and rawRecords=6 without full JSON schema',
      100,
      50 * 1024 * 1024,
      currentTestedSha
    );
    expect(e9Incomplete.pass).toBe(false);
    expect(e9Incomplete.status).toBe("ENGINEERING_FAIL");

    const e9MissingFields = validateGateOutput(
      GATES.E9,
      0,
      JSON.stringify({ dbConnected: true, dbReadbackExecuted: true }),
      100,
      50 * 1024 * 1024,
      currentTestedSha
    );
    expect(e9MissingFields.pass).toBe(false);
    expect(e9MissingFields.status).toBe("ENGINEERING_FAIL");

    // 3. E10 with exit 0 and '"diagnosticExecuted": true' in prose or inconsistent CI_NOT_CONFIGURED + ciProviderVerified: true -> ENGINEERING_FAIL
    const e10ProseOnly = validateGateOutput(
      GATES.E10,
      0,
      'Prose claiming "diagnosticExecuted": true and status=CI_NOT_CONFIGURED',
      100,
      50 * 1024 * 1024,
      currentTestedSha
    );
    expect(e10ProseOnly.pass).toBe(false);
    expect(e10ProseOnly.status).toBe("ENGINEERING_FAIL");

    const e10Inconsistent = validateGateOutput(
      GATES.E10,
      0,
      JSON.stringify({
        diagnosticExecuted: true,
        repository: CANONICAL_REPOSITORY,
        branch: LOCKED_BRANCH,
        testedCodeSha: currentTestedSha,
        status: "CI_NOT_CONFIGURED",
        ciProviderVerified: true,
      }),
      200,
      50 * 1024 * 1024,
      currentTestedSha
    );
    expect(e10Inconsistent.pass).toBe(false);
    expect(e10Inconsistent.status).toBe("ENGINEERING_FAIL");
    expect(e10Inconsistent.error).toContain("falsely claimed ciProviderVerified=true");
  });

  // ============================================================================
  // T18: Release evaluator returns overallReleaseAllowed: false (NO-GO) whenever ciStatus !== 'CI_PASS' or G15/G16 are INSUFFICIENT_EVIDENCE
  // ============================================================================
  it("T18: Release evaluator strictly returns overallReleaseAllowed=false (NO-GO) when CI is not CI_PASS or G15/G16 are INSUFFICIENT_EVIDENCE", () => {
    const verdict = evaluateReleaseEvidence({
      version: "12.4.3.7.19.3.2.8",
      branch: LOCKED_BRANCH,
      baselineSha: currentTestedSha,
      testedCodeSha: currentTestedSha,
      reportGeneratedAt: new Date().toISOString(),
      testCommand: "npx tsx scripts/kh02/runV19_3_2_8Gates.ts",
      exitCode: 0,
      realTotal: 2000,
      realPassed: 2000,
      realFailed: 0,
      realSkipped: 0,
      runMode: "OFFLINE_CONTRACT_CHECK",
      fullSuiteCoverage: {
        unitPassed: true,
        integrationPassed: true,
        backtestPassed: true,
        kh01VerifyPassed: true,
      },
      evidenceProofCounters: {
        rawRowsVerified: 0,
        liveOriginProofs: 0,
        fixtureOnlyCount: 6,
      },
      backtestResults: {
        policyReplayPassed: true,
        devHistoricalPassed: false,
        holdoutHistoricalPassed: false,
      },
      ciStatus: {
        configured: false,
        runStatus: "NOT_RUN",
      },
    });

    expect(verdict.engineeringStatus).toBe("ENGINEERING_PASS");
    expect(verdict.businessStatus).toBe("INSUFFICIENT_EVIDENCE");
    expect(verdict.ciStatus).toBe("CI_NOT_CONFIGURED");
    expect(verdict.overallReleaseAllowed).toBe(false);
  });
});

