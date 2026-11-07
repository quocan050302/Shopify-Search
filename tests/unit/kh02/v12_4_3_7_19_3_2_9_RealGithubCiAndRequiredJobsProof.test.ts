/**
 * SWAI KH-02 — V12.4.3.7.19.3.2.9
 * ADVERSARIAL TEST SUITE: REAL GITHUB ACTIONS CI WORKFLOW CONTRACT, MANDATORY 6-JOBS POLICY,
 * STREAMING BYTE-CAP READER, SECRET ENCAPSULATION, AND BOUNDED ASYNC RUNNER (A01 - A24)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  CANONICAL_REPOSITORY,
  LOCKED_BRANCH,
  CANONICAL_WORKFLOW_PATHS,
  CANONICAL_REQUIRED_JOBS,
  MAX_GITHUB_API_RESPONSE_BYTES,
  getCiVerifierSecret,
  readBoundedResponseBytes,
  requireCanonicalReleaseWorkflow,
  verifyRequiredJobs,
  verifyRemoteGitHubActionsRun,
  verifyAuthenticCiProof,
  verifyCiAttestationToken,
  lookupVerifiedRemoteCiRun,
  _testOnlyRegisterVerifiedRemoteCiRun,
  clearVerifiedRemoteCiRunsForTesting,
} from "@/services/kh02/release/githubActionsCiEvidence";

import { validateVerifiedCiAttestation } from "@/services/kh02/demand/testSuiteEvidenceValidator";
import { evaluateReleaseEvidence } from "@/services/kh02/release/releaseGateEvaluatorV19";
import { executeRemoteCiProofDiagnostic } from "../../../scripts/kh02/runRemoteCiProofDiagnostic";
import { verifyWorkflowContract } from "../../../scripts/kh02/verifyWorkflowContractV19_3_2_9";
import {
  GATES,
  DEFAULT_TAIL_BUFFER_BYTES,
  ByteTailRingBuffer,
  sanitizeCiLog,
  validateGateOutput,
  runSingleGate,
} from "../../../scripts/kh02/runV19_3_2_9Gates";

describe("KH-02 V12.4.3.7.19.3.2.9: Real GitHub CI, Mandatory Required-Jobs Policy & Bounded Runner (A01 - A24)", () => {
  const currentTestedSha = "3c60dfc7c1657c8c3c3e6bbeee19809e29a49df4";
  const validSecretKey = "SWAI_SECURE_V19_3_2_9_VERIFIER_SECRET_KEY_64_HEX_ABCDEF0123456789";

  const originalEnvSecret = process.env.KH02_CI_VERIFIER_SECRET;
  const originalGhToken = process.env.GITHUB_TOKEN;

  function buildCanonicalSixJobs(
    runId: number = 888001,
    runAttempt: number = 1,
    headSha: string = currentTestedSha
  ) {
    return CANONICAL_REQUIRED_JOBS.map((jobName, idx) => ({
      id: 20001 + idx,
      run_id: runId,
      run_attempt: runAttempt,
      head_sha: headSha,
      name: jobName,
      status: "completed",
      conclusion: "success",
      steps: [
        {
          name: `Execute ${jobName}`,
          status: "completed",
          conclusion: "success",
          number: 1,
        },
      ],
    }));
  }

  function buildThreeEndpointMockFetch(
    overrides: {
      runStatus?: number;
      runHeaders?: Record<string, string>;
      runBody?: any;
      workflowStatus?: number;
      workflowHeaders?: Record<string, string>;
      workflowBody?: any;
      jobsStatus?: number;
      jobsHeaders?: Record<string, string>;
      jobsByPage?: Record<number, any>;
    } = {}
  ) {
    const defaultRun = {
      id: 888001,
      run_attempt: 1,
      workflow_id: 201,
      name: "KH-02 Continuous Integration",
      path: ".github/workflows/kh02-ci.yml",
      repository: { full_name: CANONICAL_REPOSITORY },
      head_sha: currentTestedSha,
      head_branch: LOCKED_BRANCH,
      status: "completed",
      conclusion: "success",
      event: "push",
      html_url: `https://github.com/${CANONICAL_REPOSITORY}/actions/runs/888001`,
      ...(overrides.runBody || {}),
    };

    const defaultWorkflow = {
      id: 201,
      name: "KH-02 Continuous Integration",
      path: ".github/workflows/kh02-ci.yml",
      state: "active",
      ...(overrides.workflowBody || {}),
    };

    const defaultJobsPage1 = {
      total_count: 6,
      jobs: buildCanonicalSixJobs(defaultRun.id, defaultRun.run_attempt, defaultRun.head_sha),
    };

    const makeHeaders = (hdrs?: Record<string, string>) => ({
      get: (name: string) => {
        if (!hdrs) return null;
        const found = Object.entries(hdrs).find(([k]) => k.toLowerCase() === name.toLowerCase());
        return found ? found[1] : null;
      },
    });

    return async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("/actions/workflows/")) {
        const st = overrides.workflowStatus ?? 200;
        return {
          status: st,
          headers: makeHeaders(overrides.workflowHeaders),
          text: async () => (st === 200 ? JSON.stringify(defaultWorkflow) : `HTTP ${st}`),
        } as any;
      }

      if (urlStr.includes("/jobs")) {
        const st = overrides.jobsStatus ?? 200;
        const parsedUrl = new URL(urlStr);
        const page = parseInt(parsedUrl.searchParams.get("page") || "1", 10);
        const pagePayload =
          overrides.jobsByPage?.[page] ??
          (page === 1 ? defaultJobsPage1 : { total_count: 6, jobs: [] });
        return {
          status: st,
          headers: makeHeaders(overrides.jobsHeaders),
          text: async () => (st === 200 ? JSON.stringify(pagePayload) : `HTTP ${st}`),
        } as any;
      }

      const st = overrides.runStatus ?? 200;
      return {
        status: st,
        headers: makeHeaders(overrides.runHeaders),
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
  // A01 (RED -> GREEN): 1-job workflow ("smoke-lint") with requiredJobs: [] -> rejected (CI_FAIL, MISSING_REQUIRED_JOB)
  // ============================================================================
  it("A01 (RED -> GREEN): Run from .github/workflows/kh02-ci.yml with only 1 passing job ('smoke-lint') and requiredJobs: [] is rejected with MISSING_REQUIRED_JOB", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = buildThreeEndpointMockFetch({
      runBody: { id: 888001 },
      jobsByPage: {
        1: {
          total_count: 1,
          jobs: [
            {
              id: 20099,
              run_id: 888001,
              run_attempt: 1,
              head_sha: currentTestedSha,
              name: "smoke-lint",
              status: "completed",
              conclusion: "success",
              steps: [{ name: "Lint", status: "completed", conclusion: "success", number: 1 }],
            },
          ],
        },
      },
    });

    try {
      const res = await verifyRemoteGitHubActionsRun({
        runId: "888001",
        expectedSha: currentTestedSha,
        token: "ghp_test_token_a01_1234567890abcdef",
        requiredJobs: [], // Caller attempts to pass empty requiredJobs!
      });

      expect(res.verified).toBe(false);
      expect(res.status).toBe("CI_FAIL");
      expect(res.rejectionReason).toContain("MISSING_REQUIRED_JOB");
      expect(res.evidence).toBeUndefined();
      expect(lookupVerifiedRemoteCiRun("888001", currentTestedSha).verified).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // ============================================================================
  // A02 (RED -> GREEN): Run from .github/workflows/ci.yml -> rejected (NON_CANONICAL_WORKFLOW_PATH)
  // ============================================================================
  it("A02 (RED -> GREEN): Run from .github/workflows/ci.yml is rejected as NON_CANONICAL_WORKFLOW_PATH even with all 6 jobs passing", async () => {
    expect(CANONICAL_WORKFLOW_PATHS).toEqual([".github/workflows/kh02-ci.yml"]);

    const mockFetch = buildThreeEndpointMockFetch({
      runBody: {
        id: 888002,
        workflow_id: 202,
        path: ".github/workflows/ci.yml",
      },
      workflowBody: {
        id: 202,
        path: ".github/workflows/ci.yml",
        state: "active",
      },
    });

    const res = await verifyRemoteGitHubActionsRun({
      runId: "888002",
      expectedSha: currentTestedSha,
      customFetch: mockFetch,
      requireMultiEndpointVerification: true,
    });

    expect(res.verified).toBe(false);
    expect(res.status).toBe("CI_FAIL");
    expect(res.rejectionReason).toContain("NON_CANONICAL_WORKFLOW_PATH");
  });

  // ============================================================================
  // A03 (RED -> GREEN): Caller passes allowedWorkflowPaths: [".github/workflows/non-release.yml"] -> rejected
  // ============================================================================
  it("A03 (RED -> GREEN): Caller cannot widen canonical workflow policy via allowedWorkflowPaths", () => {
    const wfCheck = requireCanonicalReleaseWorkflow(
      ".github/workflows/non-release.yml",
      [".github/workflows/non-release.yml"]
    );
    expect(wfCheck.valid).toBe(false);
    expect(wfCheck.reason).toContain("CALLER_WORKFLOW_ALLOWLIST_WIDENING_FORBIDDEN");
  });

  // ============================================================================
  // A04 (RED -> GREEN): getCiVerifierSecret() never exposes raw key to external callers
  // ============================================================================
  it("A04 (RED -> GREEN): Public getCiVerifierSecret() returns status and configured boolean with key === undefined", () => {
    process.env.KH02_CI_VERIFIER_SECRET = validSecretKey;
    const resolution = getCiVerifierSecret();
    expect(resolution.status).toBe("CONFIGURED");
    expect(resolution.configured).toBe(true);
    expect(resolution.key).toBeUndefined();
    expect(JSON.stringify(resolution)).not.toContain(validSecretKey);
  });

  // ============================================================================
  // A05: All 6 CANONICAL_REQUIRED_JOBS required; missing any 1 of 6 fails with exact missing job name
  // ============================================================================
  it("A05: verifyRequiredJobs succeeds when all 6 CANONICAL_REQUIRED_JOBS pass and fails with exact job name if any 1 of 6 is missing", () => {
    const allSix = buildCanonicalSixJobs(888005, 1, currentTestedSha);
    const okRes = verifyRequiredJobs(
      { id: 888005, run_attempt: 1 },
      { totalCount: 6, jobs: allSix },
      { expectedRunId: "888005", expectedSha: currentTestedSha, expectedRunAttempt: 1, requiredJobs: [] }
    );
    expect(okRes.valid).toBe(true);
    expect(okRes.successfulJobs).toEqual([...CANONICAL_REQUIRED_JOBS]);

    for (const missingJobName of CANONICAL_REQUIRED_JOBS) {
      const fiveJobs = allSix.filter((j) => j.name !== missingJobName);
      const failRes = verifyRequiredJobs(
        { id: 888005, run_attempt: 1 },
        { totalCount: 5, jobs: fiveJobs },
        { expectedRunId: "888005", expectedSha: currentTestedSha, expectedRunAttempt: 1, requiredJobs: [] }
      );
      expect(failRes.valid).toBe(false);
      expect(failRes.reason).toContain("MISSING_REQUIRED_JOB");
      expect(failRes.reason).toContain(missingJobName);
    }
  });

  // ============================================================================
  // A06: Any 1 of 6 CANONICAL_REQUIRED_JOBS has non-success conclusion -> fails (CI_FAIL)
  // ============================================================================
  it("A06: Any 1 of the 6 CANONICAL_REQUIRED_JOBS with conclusion failure/cancelled/skipped/timed_out/neutral/action_required fails", () => {
    const badConclusions = [
      "failure",
      "cancelled",
      "skipped",
      "timed_out",
      "neutral",
      "action_required",
    ];

    for (const badConclusion of badConclusions) {
      const jobs = buildCanonicalSixJobs(888006, 1, currentTestedSha);
      jobs[2] = { ...jobs[2], conclusion: badConclusion };
      const res = verifyRequiredJobs(
        { id: 888006, run_attempt: 1 },
        { totalCount: 6, jobs },
        { expectedRunId: "888006", expectedSha: currentTestedSha, expectedRunAttempt: 1 }
      );
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("JOB_NOT_SUCCESS");
      expect(res.reason).toContain(badConclusion);
    }
  });

  // ============================================================================
  // A07: Required job has conclusion: "success" in a stale run_attempt -> fails (JOB_RUN_ATTEMPT_MISMATCH)
  // ============================================================================
  it("A07: Required job with conclusion 'success' in stale run_attempt (1 vs 2) is rejected with JOB_RUN_ATTEMPT_MISMATCH", () => {
    const jobs = buildCanonicalSixJobs(888007, 2, currentTestedSha);
    jobs[4] = { ...jobs[4], run_attempt: 1 }; // Stale attempt 1 on run_attempt 2
    const res = verifyRequiredJobs(
      { id: 888007, run_attempt: 2 },
      { totalCount: 6, jobs },
      { expectedRunId: "888007", expectedSha: currentTestedSha, expectedRunAttempt: 2 }
    );
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("JOB_RUN_ATTEMPT_MISMATCH");
  });

  // ============================================================================
  // A08: Required job has conclusion: "success" but contains a step with conclusion: "failure" -> fails (JOB_STEP_FAILED)
  // ============================================================================
  it("A08: Required job with conclusion 'success' but a step having conclusion 'failure' (continue-on-error) is rejected with JOB_STEP_FAILED", () => {
    const jobs = buildCanonicalSixJobs(888008, 1, currentTestedSha);
    jobs[1] = {
      ...jobs[1],
      steps: [
        { name: "Checkout", status: "completed", conclusion: "success", number: 1 },
        { name: "Unit tests (masked)", status: "completed", conclusion: "failure", number: 2 },
      ],
    };
    const res = verifyRequiredJobs(
      { id: 888008, run_attempt: 1 },
      { totalCount: 6, jobs },
      { expectedRunId: "888008", expectedSha: currentTestedSha, expectedRunAttempt: 1 }
    );
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("JOB_STEP_FAILED");
  });

  // ============================================================================
  // A09: Streaming response reader aborts immediately when chunked stream exceeds 2 MiB without Content-Length
  // ============================================================================
  it("A09: readBoundedResponseBytes aborts chunked stream immediately on byte-cap overflow (> 2 MiB) without buffering full payload", async () => {
    let chunksPulled = 0;
    const chunkSize = 512 * 1024; // 512 KiB per chunk; 5 chunks = 2.5 MiB (> 2 MiB cap)
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksPulled += 1;
        if (chunksPulled <= 10) {
          controller.enqueue(new Uint8Array(chunkSize).fill(65));
        } else {
          controller.close();
        }
      },
    });

    const abortController = new AbortController();
    const fakeResponse = {
      status: 200,
      headers: { get: () => null }, // No Content-Length header!
      body: stream,
    } as unknown as Response;

    const result = await readBoundedResponseBytes(
      fakeResponse,
      MAX_GITHUB_API_RESPONSE_BYTES,
      abortController
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("OVERSIZE_RESPONSE");
    }
    // Should abort at chunk 5 (2.5 MiB > 2.0 MiB), never pulling chunks 6..10
    expect(chunksPulled).toBeLessThanOrEqual(5);
    expect(abortController.signal.aborted).toBe(true);
  });

  // ============================================================================
  // A10: Jobs pagination returns total_count: 150, page 1 has 100 jobs, page 2 has 20 jobs -> fails (JOBS_TRUNCATED_PAGINATION)
  // ============================================================================
  it("A10: Jobs pagination with fewer collected jobs (120) than total_count (150) fails with JOBS_TRUNCATED_PAGINATION", async () => {
    const page1Jobs = Array.from({ length: 100 }, (_, i) => ({
      id: 30000 + i,
      run_id: 888010,
      run_attempt: 1,
      head_sha: currentTestedSha,
      name: i < 6 ? CANONICAL_REQUIRED_JOBS[i] : `extra-job-${i}`,
      status: "completed",
      conclusion: "success",
    }));
    const page2Jobs = Array.from({ length: 20 }, (_, i) => ({
      id: 30100 + i,
      run_id: 888010,
      run_attempt: 1,
      head_sha: currentTestedSha,
      name: `extra-job-p2-${i}`,
      status: "completed",
      conclusion: "success",
    }));

    const mockFetch = buildThreeEndpointMockFetch({
      runBody: { id: 888010 },
      jobsByPage: {
        1: { total_count: 150, jobs: page1Jobs },
        2: { total_count: 150, jobs: page2Jobs },
      },
    });

    const res = await verifyRemoteGitHubActionsRun({
      runId: "888010",
      expectedSha: currentTestedSha,
      customFetch: mockFetch,
      requireMultiEndpointVerification: true,
    });

    expect(res.verified).toBe(false);
    expect(res.status).toBe("CI_FAIL");
    expect(res.rejectionReason).toContain("JOBS_TRUNCATED_PAGINATION");
  });

  // ============================================================================
  // A11: Jobs pagination returns inconsistent total_count across pages or duplicate job ID -> fails
  // ============================================================================
  it("A11: Jobs pagination with inconsistent total_count across pages or duplicate job ID fails closed", async () => {
    const page1Jobs = Array.from({ length: 100 }, (_, i) => ({
      id: 40000 + i,
      run_id: 888011,
      run_attempt: 1,
      head_sha: currentTestedSha,
      name: i < 6 ? CANONICAL_REQUIRED_JOBS[i] : `extra-job-${i}`,
      status: "completed",
      conclusion: "success",
    }));
    const page2Jobs = [
      {
        id: 40100,
        run_id: 888011,
        run_attempt: 1,
        head_sha: currentTestedSha,
        name: "extra-job-100",
        status: "completed",
        conclusion: "success",
      },
    ];

    // 1. Inconsistent total_count between page 1 (101) and page 2 (105)
    const mockInconsistentCount = buildThreeEndpointMockFetch({
      runBody: { id: 888011 },
      jobsByPage: {
        1: { total_count: 101, jobs: page1Jobs },
        2: { total_count: 105, jobs: page2Jobs },
      },
    });
    const res1 = await verifyRemoteGitHubActionsRun({
      runId: "888011",
      expectedSha: currentTestedSha,
      customFetch: mockInconsistentCount,
      requireMultiEndpointVerification: true,
    });
    expect(res1.verified).toBe(false);
    expect(res1.status).toBe("CI_FAIL");
    expect(res1.rejectionReason).toContain("JOBS_INCONSISTENT_TOTAL_COUNT");

    // 2. Duplicate job ID across pages
    const mockDuplicateJobId = buildThreeEndpointMockFetch({
      runBody: { id: 888011 },
      jobsByPage: {
        1: { total_count: 101, jobs: page1Jobs },
        2: {
          total_count: 101,
          jobs: [{ ...page2Jobs[0], id: 40000 }], // Duplicate ID 40000 from page 1!
        },
      },
    });
    const res2 = await verifyRemoteGitHubActionsRun({
      runId: "888011",
      expectedSha: currentTestedSha,
      customFetch: mockDuplicateJobId,
      requireMultiEndpointVerification: true,
    });
    expect(res2.verified).toBe(false);
    expect(res2.status).toBe("CI_FAIL");
    expect(res2.rejectionReason).toContain("JOBS_DUPLICATE_ID");
  });

  // ============================================================================
  // A12: GitHub API returns 429 or 403 with x-ratelimit-remaining: 0 -> classified as CI_NOT_RUN with RATE_LIMITED
  // ============================================================================
  it("A12: GitHub API HTTP 429 or 403 with x-ratelimit-remaining: 0 is classified as CI_NOT_RUN with RATE_LIMITED", async () => {
    const mock429 = buildThreeEndpointMockFetch({
      runStatus: 429,
      runHeaders: { "retry-after": "60" },
    });
    const res429 = await verifyRemoteGitHubActionsRun({
      runId: "888012",
      expectedSha: currentTestedSha,
      customFetch: mock429,
    });
    expect(res429.verified).toBe(false);
    expect(res429.status).toBe("CI_NOT_RUN");
    expect(res429.rejectionReason).toContain("RATE_LIMITED");

    const origFetch = globalThis.fetch;
    globalThis.fetch = buildThreeEndpointMockFetch({
      runStatus: 403,
      runHeaders: { "x-ratelimit-remaining": "0" },
    });
    process.env.GITHUB_TOKEN = "ghp_rate_limit_test_token_123456";
    try {
      const diag = await executeRemoteCiProofDiagnostic({
        runId: "888012",
        commitSha: currentTestedSha,
      });
      expect(diag.status).toBe("CI_NOT_RUN");
      expect(diag.ciProviderVerified).toBe(false);
      expect(diag.errorClassification).toBe("RATE_LIMITED");
    } finally {
      globalThis.fetch = origFetch;
      delete process.env.GITHUB_TOKEN;
    }
  });

  // ============================================================================
  // A13: Workflow contract test: real .github/workflows/kh02-ci.yml passes all contract checks
  // ============================================================================
  it("A13: Real .github/workflows/kh02-ci.yml passes all security, SHA-pinning, cost guard, and 6-required-jobs contract checks", () => {
    const contract = verifyWorkflowContract({ expectedSha: currentTestedSha });
    expect(contract.verdict).toBe("PASS");
    expect(contract.workflowFileExists).toBe(true);
    expect(contract.workflowPath).toBe(".github/workflows/kh02-ci.yml");
    expect(contract.permissionsValid).toBe(true);
    expect(contract.actionsShaPinned).toBe(true);
    expect(contract.continueOnErrorAbsent).toBe(true);
    expect(contract.publicVisibilityGuardPresent).toBe(true);
    expect(contract.triggersValid).toBe(true);
    expect(contract.concurrencyBounded).toBe(true);
    expect(contract.requiredJobsConfigured).toEqual([...CANONICAL_REQUIRED_JOBS]);
    expect(contract.missingRequiredJobs).toEqual([]);
    expect(contract.errors).toEqual([]);
  });

  // ============================================================================
  // A14: Adversarial workflow contract test: unpinned action tag (actions/checkout@v4) -> rejected (FAIL)
  // ============================================================================
  it("A14: Workflow contract validator rejects YAML containing unpinned action tag (actions/checkout@v4)", () => {
    const realYaml = fs.readFileSync(
      path.resolve(process.cwd(), ".github/workflows/kh02-ci.yml"),
      "utf-8"
    );
    const unpinnedYaml = realYaml.replace(
      "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
      "actions/checkout@v4"
    );
    const res = verifyWorkflowContract({ yamlContent: unpinnedYaml, expectedSha: currentTestedSha });
    expect(res.verdict).toBe("FAIL");
    expect(res.actionsShaPinned).toBe(false);
  });

  // ============================================================================
  // A15: Adversarial workflow contract test: continue-on-error: true or permissions: contents: write -> rejected (FAIL)
  // ============================================================================
  it("A15: Workflow contract validator rejects YAML containing continue-on-error: true or write permissions", () => {
    const realYaml = fs.readFileSync(
      path.resolve(process.cwd(), ".github/workflows/kh02-ci.yml"),
      "utf-8"
    );

    const continueOnErrorYaml = realYaml.replace(
      "timeout-minutes: 10",
      "timeout-minutes: 10\n    continue-on-error: true"
    );
    const res1 = verifyWorkflowContract({
      yamlContent: continueOnErrorYaml,
      expectedSha: currentTestedSha,
    });
    expect(res1.verdict).toBe("FAIL");
    expect(res1.continueOnErrorAbsent).toBe(false);

    const writePermYaml = realYaml.replace("contents: read", "contents: write");
    const res2 = verifyWorkflowContract({
      yamlContent: writePermYaml,
      expectedSha: currentTestedSha,
    });
    expect(res2.verdict).toBe("FAIL");
    expect(res2.permissionsValid).toBe(false);
  });

  // ============================================================================
  // A16: Adversarial workflow contract test: missing any 1 of the 6 required jobs -> rejected (FAIL)
  // ============================================================================
  it("A16: Workflow contract validator rejects YAML missing any 1 of the 6 CANONICAL_REQUIRED_JOBS", () => {
    const realYaml = fs.readFileSync(
      path.resolve(process.cwd(), ".github/workflows/kh02-ci.yml"),
      "utf-8"
    );
    const missingJobYaml = realYaml.replace("  backtest-policy:", "  non-canonical-backtest:");
    const res = verifyWorkflowContract({
      yamlContent: missingJobYaml,
      expectedSha: currentTestedSha,
    });
    expect(res.verdict).toBe("FAIL");
    expect(res.missingRequiredJobs).toContain("backtest-policy");
  });

  // ============================================================================
  // A17: Adversarial workflow contract test: missing public visibility cost guard -> rejected (FAIL)
  // ============================================================================
  it("A17: Workflow contract validator rejects YAML missing if: github.repository_visibility == 'public' guard", () => {
    const realYaml = fs.readFileSync(
      path.resolve(process.cwd(), ".github/workflows/kh02-ci.yml"),
      "utf-8"
    );
    const noGuardYaml = realYaml.replace("if: github.repository_visibility == 'public'", "");
    const res = verifyWorkflowContract({
      yamlContent: noGuardYaml,
      expectedSha: currentTestedSha,
    });
    expect(res.verdict).toBe("FAIL");
    expect(res.publicVisibilityGuardPresent).toBe(false);
  });

  // ============================================================================
  // A18: validateGateOutput for E10/E11 enforces two-way CI_PASS <=> ciProviderVerified && providerVerified
  // ============================================================================
  it("A18: validateGateOutput rejects both { status: 'CI_PASS', ciProviderVerified: false } and { status: 'CI_NOT_CONFIGURED', ciProviderVerified: true }", () => {
    const falseCiPass = validateGateOutput(
      GATES.E10,
      0,
      JSON.stringify({
        diagnosticExecuted: true,
        repository: CANONICAL_REPOSITORY,
        branch: LOCKED_BRANCH,
        testedCodeSha: currentTestedSha,
        status: "CI_PASS",
        ciProviderVerified: false,
        providerVerified: false,
      }),
      200,
      50 * 1024 * 1024,
      currentTestedSha
    );
    expect(falseCiPass.pass).toBe(false);
    expect(falseCiPass.status).toBe("ENGINEERING_FAIL");
    expect(falseCiPass.error).toContain("Contradictory CI_PASS claim rejected");

    const falseProviderVerified = validateGateOutput(
      GATES.E11,
      0,
      JSON.stringify({
        diagnosticExecuted: true,
        repository: CANONICAL_REPOSITORY,
        branch: LOCKED_BRANCH,
        testedCodeSha: currentTestedSha,
        status: "CI_NOT_CONFIGURED",
        ciProviderVerified: true,
        providerVerified: false,
      }),
      200,
      50 * 1024 * 1024,
      currentTestedSha
    );
    expect(falseProviderVerified.pass).toBe(false);
    expect(falseProviderVerified.status).toBe("ENGINEERING_FAIL");
  });

  // ============================================================================
  // A19: runSingleGate timeout race: child exits 0 after timeout fires -> result is ABORTED_FAIL (pass: false)
  // ============================================================================
  it("A19: runSingleGate forces status='ABORTED_FAIL' and pass=false when timeout fires even if child exits 0", async () => {
    const tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02-a19-"));
    try {
      const slowGate = {
        id: "E1_TIMEOUT_TEST",
        name: "Simulated Slow Gate Exiting 0 After Timeout",
        command: `node -e "process.on('SIGTERM', () => process.exit(0)); setTimeout(() => process.exit(0), 1500);"`,
        logFile: "a19_timeout.log",
        timeoutMs: 150,
        isVitest: false,
      };

      const res = await runSingleGate(slowGate, currentTestedSha, { logDir: tmpLogDir });
      expect(res.pass).toBe(false);
      expect(res.status).toBe("ABORTED_FAIL");
      expect(res.error).toContain("GATE_TIMEOUT_ABORTED");
    } finally {
      fs.rmSync(tmpLogDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // A20: ByteTailRingBuffer fed 1 MiB of text without newlines -> retained buffer size stays <= 64 KiB
  // ============================================================================
  it("A20: ByteTailRingBuffer strictly caps memory at 64 KiB even when fed 1 MiB of newline-free text", () => {
    const ring = new ByteTailRingBuffer(DEFAULT_TAIL_BUFFER_BYTES);
    const chunk256KiB = "A".repeat(256 * 1024);
    for (let i = 0; i < 4; i++) {
      ring.append(chunk256KiB);
    }
    expect(ring.getByteLength()).toBe(DEFAULT_TAIL_BUFFER_BYTES);
    expect(Buffer.byteLength(ring.getTail(), "utf-8")).toBe(DEFAULT_TAIL_BUFFER_BYTES);
  });

  // ============================================================================
  // A21: runSingleGate log stream integrity & credential redaction (sanitizeCiLog)
  // ============================================================================
  it("A21: runSingleGate flushes log stream, matches incremental SHA-256 against disk file, and redacts credentials", async () => {
    const rawSecretLine =
      "Authorization: Bearer ghp_1234567890abcdef1234567890abcdef1234 KH02_CI_VERIFIER_SECRET=my_super_secret_value_123";
    const sanitized = sanitizeCiLog(rawSecretLine);
    expect(sanitized).not.toContain("ghp_1234567890abcdef1234567890abcdef1234");
    expect(sanitized).not.toContain("my_super_secret_value_123");
    expect(sanitized).toContain("[REDACTED]");
    expect(sanitized).toContain("[REDACTED_SECRET]");

    const tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02-a21-"));
    try {
      const echoGate = {
        id: "E1_LOG_TEST",
        name: "Log Integrity & Redaction Gate",
        command: `node -e "console.log('GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890');"`,
        logFile: "a21_redaction.log",
        timeoutMs: 10000,
        isVitest: false,
      };
      const res = await runSingleGate(echoGate, currentTestedSha, { logDir: tmpLogDir });
      expect(res.pass).toBe(true);
      expect(res.status).toBe("PASS");
      expect(res.logSha256).toMatch(/^[0-9a-f]{64}$/);

      const diskText = fs.readFileSync(path.join(tmpLogDir, "a21_redaction.log"), "utf-8");
      expect(diskText).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz1234567890");
      expect(diskText).toContain("[REDACTED_SECRET]");
    } finally {
      fs.rmSync(tmpLogDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // A22: _testOnlyRegisterVerifiedRemoteCiRun rejects record missing any of the 6 CANONICAL_REQUIRED_JOBS
  // ============================================================================
  it("A22: _testOnlyRegisterVerifiedRemoteCiRun rejects registration when jobsSummary lacks any of the 6 CANONICAL_REQUIRED_JOBS", () => {
    const incompleteSummary = CANONICAL_REQUIRED_JOBS.slice(0, 5).map((name, idx) => ({
      id: 50001 + idx,
      name,
      runId: 888022,
      runAttempt: 1,
      headSha: currentTestedSha,
      status: "completed",
      conclusion: "success",
    }));

    const reg = _testOnlyRegisterVerifiedRemoteCiRun({
      runId: "888022",
      runAttempt: 1,
      workflowId: 201,
      workflowPath: ".github/workflows/kh02-ci.yml",
      workflowName: "KH-02 Continuous Integration",
      headSha: currentTestedSha,
      headBranch: LOCKED_BRANCH,
      repository: CANONICAL_REPOSITORY,
      status: "completed",
      conclusion: "success",
      event: "push",
      jobsSummary: incompleteSummary,
      jobsDigest: "a".repeat(64),
      responseDigest: "b".repeat(64),
      workflowResponseDigest: "c".repeat(64),
      jobsResponseDigest: "d".repeat(64),
      verifiedAt: new Date().toISOString(),
    });

    expect(reg.registered).toBe(false);
    expect(reg.reason).toContain("MISSING_CANONICAL_REQUIRED_JOB_IN_SUMMARY");
    expect(reg.reason).toContain("backtest-policy");
  });

  // ============================================================================
  // A23: validateVerifiedCiAttestation and evaluateReleaseEvidence reject attestations lacking any of the 6 CANONICAL_REQUIRED_JOBS
  // ============================================================================
  it("A23: validateVerifiedCiAttestation and evaluateReleaseEvidence reject CI proof when any of the 6 CANONICAL_REQUIRED_JOBS is missing", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = buildThreeEndpointMockFetch({
      runBody: { id: 888023 },
      jobsByPage: {
        1: {
          total_count: 5,
          jobs: buildCanonicalSixJobs(888023, 1, currentTestedSha).slice(0, 5), // Missing backtest-policy
        },
      },
    });

    try {
      const verifyRes = await verifyRemoteGitHubActionsRun({
        runId: "888023",
        expectedSha: currentTestedSha,
        token: "ghp_test_token_a23_1234567890",
      });
      expect(verifyRes.verified).toBe(false);
      expect(verifyRes.status).toBe("CI_FAIL");

      const attCheck = validateVerifiedCiAttestation(
        {
          provider: "github-actions",
          source: "GITHUB_API",
          repository: CANONICAL_REPOSITORY,
          runId: "888023",
          runAttempt: 1,
          workflowId: 201,
          workflowPath: ".github/workflows/kh02-ci.yml",
          workflowName: "KH-02 Continuous Integration",
          headSha: currentTestedSha,
          headBranch: LOCKED_BRANCH,
          event: "push",
          status: "completed",
          conclusion: "success",
          jobsDigest: "a".repeat(64),
          responseDigest: "b".repeat(64),
          workflowResponseDigest: "c".repeat(64),
          jobsResponseDigest: "d".repeat(64),
          verifier: "SWAI_GITHUB_ACTIONS_VERIFIER_V2",
          attestationSignature: "swai_ci_v2_" + "0".repeat(64),
        } as any,
        { expectedSha: currentTestedSha }
      );
      expect(attCheck.providerVerified).toBe(false);
      expect(attCheck.releaseEligible).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // ============================================================================
  // A24: End-to-end 3-endpoint verification with all 6 CANONICAL_REQUIRED_JOBS passing:
  //      - customFetch -> quarantined as UNIT_TEST_MOCK (CI_NOT_RUN)
  //      - globalThis.fetch + KH02_CI_VERIFIER_SECRET -> CI_PASS, while overallReleaseAllowed remains false when G15/G16 are INSUFFICIENT_EVIDENCE
  // ============================================================================
  it("A24: End-to-end 3-endpoint verification with all 6 CANONICAL_REQUIRED_JOBS passing quarantines customFetch and authenticates real fetch route while preserving NO-GO on G15/G16", async () => {
    // Part 1: customFetch is quarantined as UNIT_TEST_MOCK
    const mockFetch = buildThreeEndpointMockFetch({ runBody: { id: 888024 } });
    const mockRes = await verifyRemoteGitHubActionsRun({
      runId: "888024",
      expectedSha: currentTestedSha,
      customFetch: mockFetch,
    });
    expect(mockRes.verified).toBe(true);
    expect(mockRes.isUnitTestMock).toBe(true);
    expect(mockRes.status).toBe("CI_NOT_RUN");
    expect(mockRes.level).toBe("PARSED_CLAIM");
    expect(verifyAuthenticCiProof({ runId: "888024", authenticatedProof: mockRes.evidence }, { expectedSha: currentTestedSha }).verified).toBe(false);

    // Part 2: Official globalThis.fetch route with configured KH02_CI_VERIFIER_SECRET and all 6 required jobs
    const origFetch = globalThis.fetch;
    globalThis.fetch = buildThreeEndpointMockFetch({ runBody: { id: 888025 } });
    try {
      const liveRes = await verifyRemoteGitHubActionsRun({
        runId: "888025",
        expectedSha: currentTestedSha,
        token: "ghp_live_route_token_888025_abcdef",
      });
      expect(liveRes.verified).toBe(true);
      expect(liveRes.isUnitTestMock).toBe(false);
      expect(liveRes.status).toBe("CI_PASS");
      expect(liveRes.level).toBe("CI_PROVIDER_VERIFIED");
      expect(liveRes.evidence?.successfulJobs).toEqual([...CANONICAL_REQUIRED_JOBS]);
      expect(verifyCiAttestationToken(liveRes.evidence!, { requireReleaseV2: true }).valid).toBe(true);

      const releaseVerdict = evaluateReleaseEvidence({
        version: "12.4.3.7.19.3.2.9",
        branch: LOCKED_BRANCH,
        baselineSha: currentTestedSha,
        testedCodeSha: currentTestedSha,
        reportGeneratedAt: new Date().toISOString(),
        testCommand: "npx tsx scripts/kh02/runV19_3_2_9Gates.ts",
        exitCode: 0,
        realTotal: 2050,
        realPassed: 2050,
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
          configured: true,
          runStatus: "SUCCESS",
          runId: "888025",
          commitSha: currentTestedSha,
          verifiedProof: {
            verified: true,
            attestation: liveRes.evidence,
          },
        },
      });

      expect(releaseVerdict.ciStatus).toBe("CI_PASS");
      expect(releaseVerdict.engineeringStatus).toBe("ENGINEERING_PASS");
      expect(releaseVerdict.businessStatus).toBe("INSUFFICIENT_EVIDENCE");
      expect(releaseVerdict.overallReleaseAllowed).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
