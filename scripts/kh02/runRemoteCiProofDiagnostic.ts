/**
 * SWAI KH-02 — V12.4.3.7.19.3.2.9
 * Dedicated Remote GitHub Actions CI Proof Diagnostic Script (Gate E10 / E11)
 *
 * Truthfully inspects GitHub Actions configuration, trust anchor state, and remote CI workflow runs
 * across Run, Workflow, and Jobs endpoints for the current locked branch and tested commit SHA.
 * If remote CI is unconfigured or token is absent, outputs structured fail-closed diagnostic JSON.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import {
  verifyRemoteGitHubActionsRun,
  getCiVerifierSecret,
  readBoundedResponseBytes,
  CANONICAL_REPOSITORY,
  LOCKED_BRANCH,
  TRUSTED_GITHUB_HOST,
  CANONICAL_REQUIRED_JOBS,
  MAX_GITHUB_API_RESPONSE_BYTES,
  RemoteCiStatus,
} from "../../src/services/kh02/release/githubActionsCiEvidence";

export type RemoteCiErrorClassification =
  | "NONE"
  | "NO_RUN_ID"
  | "NO_TOKEN"
  | "HTTP_ERROR"
  | "RATE_LIMITED"
  | "WORKFLOW_MISMATCH"
  | "JOBS_INCOMPLETE"
  | "SECRET_NOT_CONFIGURED";

export interface PublicGitHubApiProbeSummary {
  attempted: boolean;
  workflowsEndpointStatus: number | null;
  workflowsTotalCount: number | null;
  runsEndpointStatus: number | null;
  runsTotalCount: number | null;
  latestRunId?: number | null;
  latestRunStatus?: string | null;
  latestRunConclusion?: string | null;
  latestRunHeadSha?: string | null;
  latestRunWorkflowId?: number | null;
  error?: string;
}

export interface RemoteCiDiagnosticResult {
  diagnosticExecuted: boolean;
  workflowFileConfigured: boolean;
  networkAttempted: boolean;
  transportAttempted: boolean;
  remoteRunObserved: boolean;
  remoteRunCompleted: boolean;
  requiredJobsVerified: boolean;
  requiredJobsChecked: string[];
  requiredJobsMissing: string[];
  jobsDigest: string | null;
  errorClassification: RemoteCiErrorClassification;
  remoteVerificationLevel: "CI_PROVIDER_VERIFIED" | "CI_NOT_RUN" | "CI_FAIL" | "PARSED_CLAIM";
  status: RemoteCiStatus;
  ciProviderVerified: boolean;
  providerVerified: boolean;
  trustAnchorConfigured: boolean;
  providerHttpStatus: number | null;
  workflowId: number | string | null;
  workflowPath: string | null;
  workflowName: string | null;
  runId: string | null;
  runAttempt: number | null;
  headSha: string | null;
  testedCodeSha: string;
  testedTreeSha: string;
  repository: string;
  branch: string;
  event: string | null;
  conclusion: string | null;
  jobsChecked: string[];
  jobsMissing: string[];
  source: "GITHUB_API" | "UNIT_TEST_MOCK" | "NONE";
  isUnitTestMock: boolean;
  publicApiProbe?: PublicGitHubApiProbeSummary;
  elapsedMs: number;
  evidenceSha256: string | null;
  reason: string;
  executedAt: string;
}

export async function probePublicGitHubActionsState(
  options: {
    repo?: string;
    branch?: string;
    headSha?: string;
    timeoutMs?: number;
  } = {}
): Promise<PublicGitHubApiProbeSummary> {
  const repo = options.repo || CANONICAL_REPOSITORY;
  const branch = options.branch || LOCKED_BRANCH;
  const timeoutMs = options.timeoutMs || 6000;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "SWAI-KH02-CiVerifier/2.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  let workflowsEndpointStatus: number | null = null;
  let workflowsTotalCount: number | null = null;
  let runsEndpointStatus: number | null = null;
  let runsTotalCount: number | null = null;
  let latestRunId: number | null = null;
  let latestRunStatus: string | null = null;
  let latestRunConclusion: string | null = null;
  let latestRunHeadSha: string | null = null;
  let latestRunWorkflowId: number | null = null;

  try {
    const wfController = new AbortController();
    const wfTimer = setTimeout(() => wfController.abort(), timeoutMs);
    try {
      const wfRes = await fetch(`https://${TRUSTED_GITHUB_HOST}/repos/${repo}/actions/workflows`, {
        method: "GET",
        headers,
        signal: wfController.signal,
        redirect: "error",
      });
      workflowsEndpointStatus = wfRes.status;
      if (wfRes.status === 200) {
        const bodyRes = await readBoundedResponseBytes(wfRes, MAX_GITHUB_API_RESPONSE_BYTES, wfController);
        if (bodyRes.ok && bodyRes.rawText) {
          const wfJson = JSON.parse(bodyRes.rawText);
          workflowsTotalCount = typeof wfJson?.total_count === "number" ? wfJson.total_count : null;
        }
      }
    } finally {
      clearTimeout(wfTimer);
    }

    const runsController = new AbortController();
    const runsTimer = setTimeout(() => runsController.abort(), timeoutMs);
    try {
      const query = options.headSha
        ? `head_sha=${encodeURIComponent(options.headSha)}&per_page=5`
        : `branch=${encodeURIComponent(branch)}&per_page=5`;
      const runsRes = await fetch(`https://${TRUSTED_GITHUB_HOST}/repos/${repo}/actions/runs?${query}`, {
        method: "GET",
        headers,
        signal: runsController.signal,
        redirect: "error",
      });
      runsEndpointStatus = runsRes.status;
      if (runsRes.status === 200) {
        const bodyRes = await readBoundedResponseBytes(runsRes, MAX_GITHUB_API_RESPONSE_BYTES, runsController);
        if (bodyRes.ok && bodyRes.rawText) {
          const runsJson = JSON.parse(bodyRes.rawText);
          runsTotalCount = typeof runsJson?.total_count === "number" ? runsJson.total_count : null;
          if (Array.isArray(runsJson?.workflow_runs) && runsJson.workflow_runs.length > 0) {
            const firstRun = runsJson.workflow_runs[0];
            latestRunId = typeof firstRun?.id === "number" ? firstRun.id : null;
            latestRunStatus = typeof firstRun?.status === "string" ? firstRun.status : null;
            latestRunConclusion = typeof firstRun?.conclusion === "string" ? firstRun.conclusion : null;
            latestRunHeadSha = typeof firstRun?.head_sha === "string" ? firstRun.head_sha : null;
            latestRunWorkflowId = typeof firstRun?.workflow_id === "number" ? firstRun.workflow_id : null;
          }
        }
      }
    } finally {
      clearTimeout(runsTimer);
    }

    return {
      attempted: true,
      workflowsEndpointStatus,
      workflowsTotalCount,
      runsEndpointStatus,
      runsTotalCount,
      latestRunId,
      latestRunStatus,
      latestRunConclusion,
      latestRunHeadSha,
      latestRunWorkflowId,
    };
  } catch (err: any) {
    return {
      attempted: true,
      workflowsEndpointStatus,
      workflowsTotalCount,
      runsEndpointStatus,
      runsTotalCount,
      latestRunId,
      latestRunStatus,
      latestRunConclusion,
      latestRunHeadSha,
      latestRunWorkflowId,
      error: String(err?.message || err),
    };
  }
}

function classifyVerificationError(
  verified: boolean,
  status: RemoteCiStatus,
  rejectionReason?: string,
  trustAnchorConfigured?: boolean
): RemoteCiErrorClassification {
  if (verified && status === "CI_PASS") {
    return "NONE";
  }
  const r = String(rejectionReason || "");
  if (r.includes("RATE_LIMITED")) {
    return "RATE_LIMITED";
  }
  if (r.includes("WORKFLOW_")) {
    return "WORKFLOW_MISMATCH";
  }
  if (r.includes("JOB_") || r.includes("JOBS_") || r.includes("REQUIRED_JOB")) {
    return "JOBS_INCOMPLETE";
  }
  if (r.includes("SECRET_NOT_CONFIGURED") || (verified && status !== "CI_PASS" && !trustAnchorConfigured)) {
    return "SECRET_NOT_CONFIGURED";
  }
  return "HTTP_ERROR";
}

export async function executeRemoteCiProofDiagnostic(
  options: {
    runId?: string | null;
    commitSha?: string;
    branch?: string;
    repo?: string;
    probePublicApi?: boolean;
  } = {}
): Promise<RemoteCiDiagnosticResult> {
  const startMs = Date.now();
  const executedAt = new Date().toISOString();
  let testedCodeSha = options.commitSha || "";
  let testedTreeSha = "0000000000000000000000000000000000000000";
  if (!testedCodeSha) {
    try {
      testedCodeSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    } catch (_) {
      testedCodeSha = "UNKNOWN_SHA";
    }
  }
  try {
    testedTreeSha = execSync("git log -1 --format=%T HEAD", { encoding: "utf-8" }).trim();
  } catch (_) {}

  const repo = options.repo || CANONICAL_REPOSITORY;
  const branch = options.branch || LOCKED_BRANCH;
  const secretResolution = getCiVerifierSecret();
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const trustAnchorConfigured = Boolean(token) && secretResolution.status === "CONFIGURED";

  // 1. Check for canonical local workflow configuration in repository (.github/workflows/kh02-ci.yml)
  const canonicalWorkflowFsPath = path.resolve(process.cwd(), ".github/workflows/kh02-ci.yml");
  const workflowFileConfigured = fs.existsSync(canonicalWorkflowFsPath);
  const workflowPath: string | null = workflowFileConfigured ? ".github/workflows/kh02-ci.yml" : null;

  // 2. Resolve runId from options, CLI arguments, or environment
  let targetRunId = options.runId || process.env.GITHUB_RUN_ID || process.env.CI_RUN_ID || null;
  const args = process.argv.slice(2);
  const runIdArgIndex = args.indexOf("--run-id");
  if (runIdArgIndex !== -1 && args[runIdArgIndex + 1]) {
    targetRunId = args[runIdArgIndex + 1];
  }
  const shouldProbePublic = options.probePublicApi === true || args.includes("--probe-public");
  let publicApiProbe: PublicGitHubApiProbeSummary | undefined = undefined;
  if (shouldProbePublic) {
    publicApiProbe = await probePublicGitHubActionsState({
      repo,
      branch,
      headSha: testedCodeSha,
    });
  }

  // 3. Case A: No target runId configured
  if (!targetRunId) {
    const remoteRunObservedFromProbe = Boolean(
      publicApiProbe && typeof publicApiProbe.runsTotalCount === "number" && publicApiProbe.runsTotalCount > 0
    );
    const remoteRunCompletedFromProbe = Boolean(
      remoteRunObservedFromProbe && publicApiProbe?.latestRunStatus === "completed"
    );
    return {
      diagnosticExecuted: true,
      workflowFileConfigured,
      networkAttempted: false,
      transportAttempted: Boolean(publicApiProbe?.attempted),
      remoteRunObserved: remoteRunObservedFromProbe,
      remoteRunCompleted: remoteRunCompletedFromProbe,
      requiredJobsVerified: false,
      requiredJobsChecked: [],
      requiredJobsMissing: [...CANONICAL_REQUIRED_JOBS],
      jobsDigest: null,
      errorClassification: "NO_RUN_ID",
      remoteVerificationLevel: "CI_NOT_RUN",
      status: "CI_NOT_CONFIGURED",
      ciProviderVerified: false,
      providerVerified: false,
      trustAnchorConfigured,
      providerHttpStatus: publicApiProbe?.runsEndpointStatus ?? null,
      workflowId: publicApiProbe?.latestRunWorkflowId ?? null,
      workflowPath,
      workflowName: null,
      runId: publicApiProbe?.latestRunId ? String(publicApiProbe.latestRunId) : null,
      runAttempt: null,
      headSha: publicApiProbe?.latestRunHeadSha ?? null,
      testedCodeSha,
      testedTreeSha,
      repository: repo,
      branch,
      event: null,
      conclusion: publicApiProbe?.latestRunConclusion ?? null,
      jobsChecked: [],
      jobsMissing: [...CANONICAL_REQUIRED_JOBS],
      source: "NONE",
      isUnitTestMock: false,
      publicApiProbe,
      elapsedMs: Date.now() - startMs,
      evidenceSha256: null,
      reason:
        "No remote GitHub Actions workflow runId specified, and authenticated 3-endpoint verification was not invoked. Truthfully classified as CI_NOT_CONFIGURED.",
      executedAt,
    };
  }

  // 4. Case B: runId specified but no GITHUB_TOKEN configured
  if (!token) {
    return {
      diagnosticExecuted: true,
      workflowFileConfigured,
      networkAttempted: false,
      transportAttempted: Boolean(publicApiProbe?.attempted),
      remoteRunObserved: false,
      remoteRunCompleted: false,
      requiredJobsVerified: false,
      requiredJobsChecked: [],
      requiredJobsMissing: [...CANONICAL_REQUIRED_JOBS],
      jobsDigest: null,
      errorClassification: "NO_TOKEN",
      remoteVerificationLevel: "CI_NOT_RUN",
      status: "CI_NOT_CONFIGURED",
      ciProviderVerified: false,
      providerVerified: false,
      trustAnchorConfigured,
      providerHttpStatus: publicApiProbe?.runsEndpointStatus ?? null,
      workflowId: null,
      workflowPath,
      workflowName: null,
      runId: targetRunId,
      runAttempt: null,
      headSha: null,
      testedCodeSha,
      testedTreeSha,
      repository: repo,
      branch,
      event: null,
      conclusion: null,
      jobsChecked: [],
      jobsMissing: [...CANONICAL_REQUIRED_JOBS],
      source: "NONE",
      isUnitTestMock: false,
      publicApiProbe,
      elapsedMs: Date.now() - startMs,
      evidenceSha256: null,
      reason:
        "GITHUB_TOKEN / GH_TOKEN environment variable is not configured; remote GitHub Actions API authentication cannot be performed.",
      executedAt,
    };
  }

  // 5. Case C: runId and token both configured — execute authentic 3-endpoint network verification
  const verification = await verifyRemoteGitHubActionsRun({
    runId: targetRunId,
    expectedSha: testedCodeSha,
    expectedBranch: branch,
    expectedRepo: repo,
    token,
  });

  const providerVerified = verification.verified && !verification.isUnitTestMock && verification.status === "CI_PASS";
  const ev = verification.evidence;
  const evidenceSha256 = ev
    ? crypto.createHash("sha256").update(JSON.stringify(ev), "utf-8").digest("hex")
    : null;

  const checkedJobs = ev?.successfulJobs ? [...ev.successfulJobs] : [];
  const missingJobs = CANONICAL_REQUIRED_JOBS.filter((reqJob) => !checkedJobs.includes(reqJob));
  const errorClassification = classifyVerificationError(
    verification.verified,
    verification.status,
    verification.rejectionReason,
    trustAnchorConfigured
  );

  return {
    diagnosticExecuted: true,
    workflowFileConfigured,
    networkAttempted: true,
    transportAttempted: true,
    remoteRunObserved: Boolean(ev),
    remoteRunCompleted: Boolean(ev && ev.status === "completed"),
    requiredJobsVerified: Boolean(ev?.requiredJobsVerified && missingJobs.length === 0),
    requiredJobsChecked: checkedJobs,
    requiredJobsMissing: missingJobs,
    jobsDigest: ev?.jobsDigest ?? null,
    errorClassification,
    remoteVerificationLevel: verification.level,
    status: verification.status,
    ciProviderVerified: providerVerified,
    providerVerified,
    trustAnchorConfigured,
    providerHttpStatus: verification.verified ? 200 : null,
    workflowId: ev?.workflowId ?? null,
    workflowPath: ev?.workflowPath || workflowPath,
    workflowName: ev?.workflowName || null,
    runId: targetRunId,
    runAttempt: ev?.runAttempt ?? null,
    headSha: ev?.headSha || null,
    testedCodeSha,
    testedTreeSha,
    repository: repo,
    branch,
    event: ev?.event || null,
    conclusion: ev?.conclusion || null,
    jobsChecked: checkedJobs,
    jobsMissing: missingJobs,
    source: ev?.source || "NONE",
    isUnitTestMock: verification.isUnitTestMock || false,
    publicApiProbe,
    elapsedMs: Date.now() - startMs,
    evidenceSha256,
    reason:
      verification.rejectionReason || "Remote GitHub Actions run successfully authenticated against official API.",
    executedAt,
  };
}

async function main() {
  try {
    const result = await executeRemoteCiProofDiagnostic();
    console.log("=== REMOTE GITHUB ACTIONS CI PROOF DIAGNOSTIC (GATE E10) ===");
    console.log(JSON.stringify(result, null, 2));
    console.log(`STATUS: SUCCESS (status=${result.status}, ciProviderVerified=${result.ciProviderVerified})`);
    process.exit(0);
  } catch (err: any) {
    console.error("=== REMOTE GITHUB ACTIONS CI PROOF DIAGNOSTIC FAILED ===");
    console.error(err?.message || err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
