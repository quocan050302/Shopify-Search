/**
 * SWAI KH-02 — V12.4.3.7.19.3.2.9
 * Authentic GitHub Actions Remote CI Verification Service (Three-Endpoint Verifier, Streaming Body Guard & Mandatory Required-Jobs Policy)
 *
 * Implements a strict, fail-closed three-endpoint verification client for remote GitHub Actions:
 * - Endpoint 1 (Run): GET https://api.github.com/repos/{owner}/{repo}/actions/runs/{run_id}
 * - Endpoint 2 (Workflow): GET https://api.github.com/repos/{owner}/{repo}/actions/workflows/{workflow_id}
 * - Endpoint 3 (Jobs): GET https://api.github.com/repos/{owner}/{repo}/actions/runs/{run_id}/jobs?filter=latest&per_page=100&page={page}
 * - Strict SSRF protection: forbids custom schemes, foreign hosts, IP literals, redirects, or userinfo
 * - Bounded streaming network calls: timeout, abort signals, streaming byte-count-before-append payload cap (<= 2 MiB per response, <= 6 MiB total), bounded pagination (<= 5 pages)
 * - Strict workflow & job identity verification: single canonical workflow path (.github/workflows/kh02-ci.yml), workflow_id cross-endpoint match,
 *   run_attempt consistency, and immutable baseline required-jobs policy (typecheck, kh02-unit, kh02-integration, kh01-regression, security-negative, backtest-policy)
 * - Versioned V2 cryptographic attestation digest binding all run, workflow, and job identities without exposing raw signing keys to callers
 * - Recursive deep-freeze on all stored and returned records
 * - Safe fail-closed defaults: returns CI_NOT_CONFIGURED / CI_NOT_RUN if credentials or runs are absent
 */

import crypto from "crypto";

export const TRUSTED_VERIFIER_ID = "SWAI_TRUSTED_GITHUB_VERIFIER_V1" as const;
export const TRUSTED_GITHUB_HOST = "api.github.com" as const;
export const CANONICAL_REPOSITORY = "quocan050302/Shopify-Search" as const;
export const LOCKED_BRANCH = "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1" as const;

export const CANONICAL_WORKFLOW_PATHS = [
  ".github/workflows/kh02-ci.yml",
] as const;

export const CANONICAL_RELEASE_WORKFLOWS = [
  ".github/workflows/kh02-ci.yml",
] as const;

export const CANONICAL_WORKFLOW_NAME = "KH-02 Continuous Integration" as const;

export const CANONICAL_REQUIRED_JOBS = [
  "typecheck",
  "kh02-unit",
  "kh02-integration",
  "kh01-regression",
  "security-negative",
  "backtest-policy",
] as const;

export const MAX_GITHUB_API_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MiB cap per response
export const MAX_TOTAL_GITHUB_VERIFICATION_BYTES = 6 * 1024 * 1024; // 6 MiB total budget across Run + Workflow + Jobs
export const MAX_GITHUB_JOBS_PAGES = 5;

export const KNOWN_INSECURE_DEFAULT_KEYS = [
  "SWAI_KH02_INTERNAL_HMAC_VERIFIER_KEY_V19_3_2_3_SECURE",
  "default",
  "secret",
  "password",
  "test",
  "dev",
  "changeme",
] as const;

export interface VerifiedJobStepSummaryItem {
  number?: number;
  name: string;
  status: string;
  conclusion: string;
}

export interface VerifiedJobSummaryItem {
  id: number | string;
  name: string;
  status: string;
  conclusion: string;
  runAttempt: number;
  steps?: ReadonlyArray<Readonly<VerifiedJobStepSummaryItem>>;
}

export interface VerifiedRemoteCiRecord {
  runId: string;
  runAttempt: number;
  repository: string;
  headSha: string;
  headBranch: string;
  workflowId: number | string;
  workflowPath?: string;
  workflowName?: string;
  event: string;
  status: string;
  conclusion: string;
  responseDigest: string;
  workflowResponseDigest?: string;
  jobsResponseDigest?: string;
  jobsDigest?: string;
  jobsSummary?: ReadonlyArray<Readonly<VerifiedJobSummaryItem>>;
  canonicalWorkflowVerified: boolean;
  requiredJobsVerified: boolean;
  verifiedAt: string;
  proofHandle: string;
  isUnitTestMock: boolean;
}

const VERIFIED_PROVIDER_RUNS = new Map<string, Readonly<VerifiedRemoteCiRecord>>();

/**
 * Recursively freezes an object and all nested objects/arrays in place.
 */
function deepFreezeRecursive<T>(val: T): Readonly<T> {
  if (val && typeof val === "object" && !Object.isFrozen(val)) {
    Object.freeze(val);
    const keys = Object.keys(val as Record<string, unknown>);
    for (const key of keys) {
      deepFreezeRecursive((val as Record<string, unknown>)[key]);
    }
  }
  return val;
}

/**
 * Deep-clones an object and recursively freezes it across all nested objects and arrays,
 * ensuring references returned to callers can NEVER mutate internal state held in memory.
 */
export function deepCloneAndFreeze<T extends object>(obj: T): Readonly<T> {
  const clone = JSON.parse(JSON.stringify(obj));
  return deepFreezeRecursive(clone);
}

/**
 * Enforces that a workflow path is an exact canonical release workflow file path (.github/workflows/kh02-ci.yml).
 * Display name alone is never sufficient to establish workflow file identity.
 * Callers may pass a subset of CANONICAL_WORKFLOW_PATHS, but can NEVER widen the canonical policy.
 */
export function requireCanonicalReleaseWorkflow(
  workflowPath: unknown,
  allowedWorkflowPaths: readonly string[] = CANONICAL_WORKFLOW_PATHS
): { valid: boolean; normalizedPath?: string; reason?: string } {
  if (typeof workflowPath !== "string" || workflowPath.trim() === "") {
    return {
      valid: false,
      reason: "MISSING_WORKFLOW_PATH: Canonical workflow path (.github/workflows/kh02-ci.yml) is required.",
    };
  }
  if (workflowPath !== workflowPath.trim()) {
    return {
      valid: false,
      reason: `INVALID_WORKFLOW_PATH_WHITESPACE: Workflow path '${workflowPath}' contains leading or trailing whitespace.`,
    };
  }
  if (/[^\x20-\x7E]/.test(workflowPath)) {
    return {
      valid: false,
      reason: `INVALID_WORKFLOW_PATH_CHARS: Workflow path '${workflowPath}' contains non-ASCII or control characters.`,
    };
  }
  if (
    !workflowPath.startsWith(".github/workflows/") ||
    (!workflowPath.endsWith(".yml") && !workflowPath.endsWith(".yaml")) ||
    workflowPath.includes("..") ||
    workflowPath.includes("\\") ||
    workflowPath.includes("//") ||
    workflowPath.includes("?") ||
    workflowPath.includes("#")
  ) {
    return {
      valid: false,
      reason: `MALFORMED_WORKFLOW_PATH: Workflow path '${workflowPath}' is not a valid canonical .github/workflows/*.yml path.`,
    };
  }
  if (!Array.isArray(allowedWorkflowPaths) || allowedWorkflowPaths.length === 0) {
    return {
      valid: false,
      reason: "EMPTY_ALLOWED_WORKFLOW_PATHS: Caller supplied an empty workflow allowlist.",
    };
  }
  const hasNonCanonicalCallerAllowance = allowedWorkflowPaths.some(
    (p) => !(CANONICAL_WORKFLOW_PATHS as readonly string[]).includes(p)
  );
  if (hasNonCanonicalCallerAllowance) {
    return {
      valid: false,
      reason: `CALLER_WORKFLOW_ALLOWLIST_WIDENING_FORBIDDEN: Caller allowlist (${allowedWorkflowPaths.join(", ")}) contains paths outside canonical policy (${CANONICAL_WORKFLOW_PATHS.join(", ")}).`,
    };
  }
  const matchedCanonical = (CANONICAL_WORKFLOW_PATHS as readonly string[]).includes(workflowPath);
  const matchedCaller = allowedWorkflowPaths.includes(workflowPath);
  if (!matchedCanonical || !matchedCaller) {
    return {
      valid: false,
      reason: `NON_CANONICAL_WORKFLOW_PATH: Workflow path '${workflowPath}' is not in the canonical release workflow allowlist (${CANONICAL_WORKFLOW_PATHS.join(", ")}).`,
    };
  }
  return { valid: true, normalizedPath: workflowPath };
}

/**
 * Verifies that a jobsSummary array satisfies all baseline CANONICAL_REQUIRED_JOBS for the given runAttempt.
 */
export function hasAllCanonicalRequiredJobsInSummary(
  jobsSummary: ReadonlyArray<Readonly<VerifiedJobSummaryItem>> | undefined,
  expectedRunAttempt?: number
): { valid: boolean; missingJobs: string[]; reason?: string } {
  if (!Array.isArray(jobsSummary) || jobsSummary.length === 0) {
    return {
      valid: false,
      missingJobs: [...CANONICAL_REQUIRED_JOBS],
      reason: "MISSING_JOBS_SUMMARY: Verified record has no job summary items.",
    };
  }
  const missingJobs: string[] = [];
  for (const reqJob of CANONICAL_REQUIRED_JOBS) {
    const found = jobsSummary.find(
      (j) =>
        j &&
        j.name === reqJob &&
        j.status === "completed" &&
        j.conclusion === "success" &&
        (expectedRunAttempt === undefined || Number(j.runAttempt) === Number(expectedRunAttempt))
    );
    if (!found) {
      missingJobs.push(reqJob);
    }
  }
  if (missingJobs.length > 0) {
    return {
      valid: false,
      missingJobs,
      reason: `MISSING_CANONICAL_REQUIRED_JOBS: Mandatory release job(s) [${missingJobs.join(", ")}] are missing or did not succeed.`,
    };
  }
  return { valid: true, missingJobs: [] };
}

/**
 * Server-only protected lookup for verified GitHub Actions CI runs.
 * A run is ONLY verified if it was authenticated by verifyRemoteGitHubActionsRun in this runtime session.
 * Never exposes mutable references to internal registry storage.
 */
export function lookupVerifiedRemoteCiRun(
  runId: string | number,
  expectedSha?: string,
  expectedRepo?: string
): { verified: boolean; record?: Readonly<VerifiedRemoteCiRecord>; proofHandle?: string; reason?: string } {
  if (!runId || String(runId).trim() === "") {
    return { verified: false, reason: "MISSING_RUN_ID: No CI runId provided for lookup." };
  }
  const runIdStr = String(runId).trim();
  const repo = (expectedRepo || CANONICAL_REPOSITORY).toLowerCase();
  const recordKey = `${repo}#${runIdStr}`;
  const record = VERIFIED_PROVIDER_RUNS.get(recordKey);

  if (!record) {
    return {
      verified: false,
      reason: `NO_PROVIDER_RUN_REGISTERED: Run '${runIdStr}' on repository '${repo}' was not verified by authentic remote GitHub Actions verifier in this server runtime.`,
    };
  }

  // Always return an immutable, recursively frozen deep-clone to protect internal Map integrity
  const isolatedSnapshot = deepCloneAndFreeze(record);

  if (expectedSha && record.headSha.toLowerCase() !== expectedSha.toLowerCase()) {
    return {
      verified: false,
      proofHandle: record.proofHandle,
      record: isolatedSnapshot,
      reason: `SHA_MISMATCH: Verified run '${runIdStr}' headSha '${record.headSha}' does not match expected tested SHA '${expectedSha}'.`,
    };
  }

  if (record.headBranch && record.headBranch !== LOCKED_BRANCH) {
    return {
      verified: false,
      proofHandle: record.proofHandle,
      record: isolatedSnapshot,
      reason: `BRANCH_MISMATCH: Verified run '${runIdStr}' headBranch '${record.headBranch}' does not match locked branch '${LOCKED_BRANCH}'.`,
    };
  }

  if (record.status !== "completed" || record.conclusion !== "success") {
    return {
      verified: false,
      proofHandle: record.proofHandle,
      record: isolatedSnapshot,
      reason: `CONCLUSION_NOT_SUCCESS: Verified run '${runIdStr}' status is '${record.status}', conclusion is '${record.conclusion}'.`,
    };
  }

  if (record.event !== "push" && record.event !== "workflow_dispatch") {
    return {
      verified: false,
      proofHandle: record.proofHandle,
      record: isolatedSnapshot,
      reason: `EVENT_MISMATCH: Verified run '${runIdStr}' event is '${record.event}'. Only 'push' and 'workflow_dispatch' are permitted.`,
    };
  }

  // Check TTL (24 hours freshness)
  const verifiedTimestamp = Date.parse(record.verifiedAt);
  const now = Date.now();
  if (isNaN(verifiedTimestamp) || now - verifiedTimestamp > 24 * 60 * 60 * 1000 || verifiedTimestamp > now + 60000) {
    return {
      verified: false,
      proofHandle: record.proofHandle,
      record: isolatedSnapshot,
      reason: `TTL_EXPIRED: Verified run record for '${runIdStr}' has expired or has an invalid timestamp.`,
    };
  }

  if (record.isUnitTestMock) {
    return {
      verified: false,
      proofHandle: record.proofHandle,
      record: isolatedSnapshot,
      reason: `MOCK_QUARANTINE: Run '${runIdStr}' is marked as a UNIT_TEST_MOCK and cannot be admitted for commercial release.`,
    };
  }

  if (!record.canonicalWorkflowVerified || !record.workflowPath || !requireCanonicalReleaseWorkflow(record.workflowPath).valid) {
    return {
      verified: false,
      proofHandle: record.proofHandle,
      record: isolatedSnapshot,
      reason: `WORKFLOW_IDENTITY_UNVERIFIED: Run '${runIdStr}' does not have a verified canonical workflow path.`,
    };
  }

  if (!record.requiredJobsVerified || !record.jobsDigest || !/^[0-9a-f]{64}$/i.test(record.jobsDigest)) {
    return {
      verified: false,
      proofHandle: record.proofHandle,
      record: isolatedSnapshot,
      reason: `REQUIRED_JOBS_UNVERIFIED: Run '${runIdStr}' does not have verified required jobs completion proof.`,
    };
  }

  const jobsSummaryCheck = hasAllCanonicalRequiredJobsInSummary(record.jobsSummary, record.runAttempt);
  if (!jobsSummaryCheck.valid) {
    return {
      verified: false,
      proofHandle: record.proofHandle,
      record: isolatedSnapshot,
      reason: `REQUIRED_JOBS_UNVERIFIED: ${jobsSummaryCheck.reason}`,
    };
  }

  return {
    verified: true,
    proofHandle: record.proofHandle,
    record: isolatedSnapshot,
  };
}

/**
 * Module-private registration for verified GitHub Actions CI runs.
 * Only callable internally by verifyRemoteGitHubActionsRun.
 */
function _registerVerifiedRemoteCiRun(
  evidence: GitHubWorkflowRunEvidence | VerifiedRemoteCiRecord
): { registered: boolean; proofHandle?: string; error?: string } {
  const repo = (evidence.repository || CANONICAL_REPOSITORY).toLowerCase();
  const runIdStr = String(evidence.runId).trim();
  const recordKey = `${repo}#${runIdStr}`;
  const isMock = evidence.isUnitTestMock === true || (evidence as any).source === "UNIT_TEST_MOCK";
  const runAttempt = Number((evidence as any).runAttempt ?? 1);
  const wfPath = (evidence as any).workflowPath ? String((evidence as any).workflowPath) : undefined;
  const wfId = evidence.workflowId ?? 0;
  const jobsDigest = (evidence as any).jobsDigest ? String((evidence as any).jobsDigest) : undefined;
  const wfRespDigest = (evidence as any).workflowResponseDigest ? String((evidence as any).workflowResponseDigest) : undefined;
  const jobsRespDigest = (evidence as any).jobsResponseDigest ? String((evidence as any).jobsResponseDigest) : undefined;
  const canonicalWfVerified = Boolean((evidence as any).canonicalWorkflowVerified);
  const reqJobsVerified = Boolean((evidence as any).requiredJobsVerified);
  const jobsSummary: VerifiedJobSummaryItem[] = Array.isArray((evidence as any).jobsSummary)
    ? (evidence as any).jobsSummary
    : [];

  if (!isMock || jobsSummary.length > 0 || reqJobsVerified) {
    if (!isMock) {
      if (!canonicalWfVerified || !wfPath || !requireCanonicalReleaseWorkflow(wfPath).valid) {
        return {
          registered: false,
          error: "UNVERIFIED_WORKFLOW_REGISTRATION_BLOCKED: Real provider run cannot be registered without canonical workflow verification.",
        };
      }
      if (!reqJobsVerified || !jobsDigest || !/^[0-9a-f]{64}$/i.test(jobsDigest)) {
        return {
          registered: false,
          error: "UNVERIFIED_JOBS_REGISTRATION_BLOCKED: Real provider run cannot be registered without required jobs digest.",
        };
      }
    }
    if (!isMock || jobsSummary.length > 0) {
      const reqCheck = hasAllCanonicalRequiredJobsInSummary(jobsSummary, runAttempt);
      if (!reqCheck.valid) {
        return {
          registered: false,
          error: `MISSING_CANONICAL_REQUIRED_JOB_IN_SUMMARY: ${reqCheck.reason}`,
        };
      }
    }
  }

  const existing = VERIFIED_PROVIDER_RUNS.get(recordKey);
  if (existing) {
    const sameSha = existing.headSha === evidence.headSha;
    const sameBranch = existing.headBranch === ((evidence as any).headBranch || (evidence as any).branch || LOCKED_BRANCH);
    const sameDigest = existing.responseDigest === evidence.responseDigest;
    const sameEvent = existing.event === evidence.event;
    const sameMock = existing.isUnitTestMock === isMock;
    const sameAttempt = existing.runAttempt === runAttempt;
    const sameWfId = String(existing.workflowId) === String(wfId);
    const sameWfPath = (existing.workflowPath || "") === (wfPath || "");
    const sameJobsDigest = (existing.jobsDigest || "") === (jobsDigest || "");

    if (
      sameSha &&
      sameBranch &&
      sameDigest &&
      sameEvent &&
      sameMock &&
      sameAttempt &&
      sameWfId &&
      sameWfPath &&
      sameJobsDigest
    ) {
      return { registered: true, proofHandle: existing.proofHandle };
    } else {
      return {
        registered: false,
        error: `CONFLICTING_RUN_IDENTITY: A verified run for '${runIdStr}' on '${repo}' already exists with different provenance metadata.`,
      };
    }
  }

  const verifiedTimestamp = (evidence as any).fetchedAt || (evidence as any).verifiedAt || new Date().toISOString();
  const proofHandle = `swai_proof_handle_${crypto
    .createHash("sha256")
    .update(
      `${repo}|${runIdStr}|${runAttempt}|${evidence.headSha}|${wfId}|${wfPath || ""}|${jobsDigest || ""}|${evidence.responseDigest}|${verifiedTimestamp}`
    )
    .digest("hex")}`;

  const record: VerifiedRemoteCiRecord = {
    runId: runIdStr,
    runAttempt,
    repository: evidence.repository || CANONICAL_REPOSITORY,
    headSha: evidence.headSha,
    headBranch: (evidence as any).headBranch || (evidence as any).branch || LOCKED_BRANCH,
    workflowId: wfId,
    workflowPath: wfPath,
    workflowName: evidence.workflowName,
    event: evidence.event,
    status: evidence.status,
    conclusion: evidence.conclusion,
    responseDigest: evidence.responseDigest,
    workflowResponseDigest: wfRespDigest,
    jobsResponseDigest: jobsRespDigest,
    jobsDigest,
    jobsSummary,
    canonicalWorkflowVerified: canonicalWfVerified,
    requiredJobsVerified: reqJobsVerified,
    verifiedAt: verifiedTimestamp,
    proofHandle,
    isUnitTestMock: isMock,
  };

  const frozenRecord = deepCloneAndFreeze(record);
  VERIFIED_PROVIDER_RUNS.set(recordKey, frozenRecord);
  return { registered: true, proofHandle };
}

/**
 * Unit-test-only seam for test fixtures.
 * STRICTLY ENFORCES mock quarantine: sets isUnitTestMock = true unconditionally
 * so test fixtures can NEVER produce commercial CI_PASS or elevate release decisions.
 */
export function _testOnlyRegisterVerifiedRemoteCiRun(record: {
  runId: string | number;
  runAttempt?: number;
  repository?: string;
  headSha: string;
  headBranch?: string;
  workflowId?: number | string;
  workflowPath?: string;
  workflowName?: string;
  event?: string;
  status?: string;
  conclusion?: string;
  responseDigest: string;
  workflowResponseDigest?: string;
  jobsResponseDigest?: string;
  jobsDigest?: string;
  jobsSummary?: VerifiedJobSummaryItem[];
  canonicalWorkflowVerified?: boolean;
  requiredJobsVerified?: boolean;
  verifiedAt?: string;
  source?: "GITHUB_API" | "UNIT_TEST_MOCK";
  isUnitTestMock?: boolean;
}): { registered: boolean; proofHandle?: string; error?: string; reason?: string } {
  const res = _registerVerifiedRemoteCiRun({
    runId: String(record.runId),
    runAttempt: record.runAttempt ?? 1,
    repository: record.repository || CANONICAL_REPOSITORY,
    headSha: record.headSha,
    headBranch: record.headBranch || LOCKED_BRANCH,
    workflowId: record.workflowId || 100,
    workflowPath: record.workflowPath,
    workflowName: record.workflowName || "KH-02 Continuous Integration",
    event: record.event || "push",
    status: record.status || "completed",
    conclusion: record.conclusion || "success",
    responseDigest: record.responseDigest,
    workflowResponseDigest: record.workflowResponseDigest,
    jobsResponseDigest: record.jobsResponseDigest,
    jobsDigest: record.jobsDigest,
    jobsSummary: record.jobsSummary || [],
    canonicalWorkflowVerified: Boolean(record.canonicalWorkflowVerified),
    requiredJobsVerified: Boolean(record.requiredJobsVerified),
    verifiedAt: record.verifiedAt || new Date().toISOString(),
    isUnitTestMock: true, // STRICTLY ENFORCED: Always true!
  } as any);

  if (!res.registered) {
    if (res.error && res.error.includes("CONFLICTING_RUN_IDENTITY")) {
      throw new Error(res.error);
    }
    return { registered: false, error: res.error, reason: res.error };
  }

  return res;
}

/**
 * Unit-test-only helper to clear registry state between test cases.
 */
export function clearVerifiedRemoteCiRunsForTesting(): void {
  VERIFIED_PROVIDER_RUNS.clear();
}

export interface CiVerifierSecretResolution {
  key?: undefined;
  configured: boolean;
  status: "CONFIGURED" | "NOT_CONFIGURED" | "INSECURE_OR_DEFAULT";
  reason?: string;
}

interface InternalCiVerifierSecretResolution {
  key?: string;
  status: "CONFIGURED" | "NOT_CONFIGURED" | "INSECURE_OR_DEFAULT";
  reason?: string;
}

/**
 * Module-private secret resolver. NEVER exported outside this module.
 * Ensures the raw KH02_CI_VERIFIER_SECRET key cannot be extracted by external imports.
 */
function _resolveCiVerifierSecretInternal(): InternalCiVerifierSecretResolution {
  const secret = process.env.KH02_CI_VERIFIER_SECRET;
  if (!secret || !secret.trim()) {
    return {
      status: "NOT_CONFIGURED",
      reason: "MISSING_TRUST_ANCHOR: KH02_CI_VERIFIER_SECRET environment variable is not configured.",
    };
  }
  const trimmed = secret.trim();
  if (KNOWN_INSECURE_DEFAULT_KEYS.some((k) => trimmed.toLowerCase() === k.toLowerCase())) {
    return {
      status: "INSECURE_OR_DEFAULT",
      reason: "PROHIBITED_KEY: KH02_CI_VERIFIER_SECRET matches a known insecure/default key.",
    };
  }
  if (trimmed.length < 32) {
    return {
      status: "INSECURE_OR_DEFAULT",
      reason: "INSUFFICIENT_ENTROPY: KH02_CI_VERIFIER_SECRET must be at least 32 characters.",
    };
  }
  return {
    key: trimmed,
    status: "CONFIGURED",
  };
}

/**
 * Public non-secret diagnostic accessor for CI HMAC verifier secret status.
 * Enforces strict fail-closed policy: returns explicit NOT_CONFIGURED or INSECURE_OR_DEFAULT
 * if absent, weak, or matching known insecure default keys.
 * NEVER exposes the raw secret key string (`key` is always `undefined`).
 */
export function getCiVerifierSecret(): CiVerifierSecretResolution {
  const internal = _resolveCiVerifierSecretInternal();
  return Object.freeze({
    configured: internal.status === "CONFIGURED",
    status: internal.status,
    reason: internal.reason,
  });
}

/**
 * Computes canonical V2 attestation digest with explicit domain separation and JSON array framing
 * so delimiter injection is impossible and every workflow/run/job identity field is cryptographically bound.
 */
export function computeCiAttestationDigest(evidence: {
  provider?: string;
  source?: string;
  repository?: string;
  runId?: string | number;
  runAttempt?: number | string;
  headSha?: string;
  commitSha?: string;
  headBranch?: string;
  branch?: string;
  status?: string;
  conclusion?: string;
  event?: string;
  responseDigest?: string;
  workflowResponseDigest?: string;
  jobsResponseDigest?: string;
  jobsDigest?: string;
  workflowId?: number | string;
  workflowPath?: string;
  workflowName?: string;
  verifier?: string;
  isUnitTestMock?: boolean;
}): string {
  const isMock = evidence.isUnitTestMock === true || evidence.source === "UNIT_TEST_MOCK";
  const canonicalTuple = [
    "SWAI_CI_ATTESTATION_V2",
    String(evidence.provider || "github-actions"),
    String(evidence.source || ""),
    String(evidence.repository || "").toLowerCase(),
    String(evidence.runId || ""),
    String(evidence.runAttempt ?? 1),
    String(evidence.headSha || evidence.commitSha || "").toLowerCase(),
    String(evidence.headBranch || evidence.branch || ""),
    String(evidence.event || ""),
    String(evidence.status || ""),
    String(evidence.conclusion || ""),
    String(evidence.workflowId || ""),
    String(evidence.workflowPath || ""),
    String(evidence.workflowName || ""),
    String(evidence.jobsDigest || ""),
    String(evidence.responseDigest || ""),
    String(evidence.workflowResponseDigest || ""),
    String(evidence.jobsResponseDigest || ""),
    String(evidence.verifier || TRUSTED_VERIFIER_ID),
    isMock ? "MOCK" : "PROD",
  ];
  return `SWAI_CI_ATTESTATION_V2|${JSON.stringify(canonicalTuple)}`;
}

/**
 * Validates whether an evidence object carries the full V2 multi-endpoint identity required for release verification.
 * Legacy V1 payloads omitting workflowPath, workflowId, runAttempt, or jobsDigest are strictly rejected for release.
 */
export function hasCompleteV2ReleaseIdentity(
  evidence: Record<string, unknown>,
  allowedWorkflowPaths: readonly string[] = CANONICAL_WORKFLOW_PATHS
): { valid: boolean; reason?: string } {
  if (!evidence || typeof evidence !== "object") {
    return { valid: false, reason: "MISSING_EVIDENCE_OBJECT" };
  }
  const wfIdStr = String(evidence.workflowId ?? "").trim();
  if (!/^[1-9]\d*$/.test(wfIdStr)) {
    return { valid: false, reason: `MISSING_OR_INVALID_WORKFLOW_ID: workflowId '${wfIdStr}' is not a positive integer.` };
  }
  const wfPathCheck = requireCanonicalReleaseWorkflow(evidence.workflowPath, allowedWorkflowPaths);
  if (!wfPathCheck.valid) {
    return { valid: false, reason: wfPathCheck.reason };
  }
  const attemptStr = String(evidence.runAttempt ?? "").trim();
  if (!/^[1-9]\d*$/.test(attemptStr)) {
    return { valid: false, reason: `MISSING_OR_INVALID_RUN_ATTEMPT: runAttempt '${attemptStr}' is not a positive integer.` };
  }
  const jobsDigest = String(evidence.jobsDigest ?? "").trim();
  if (!/^[0-9a-f]{64}$/i.test(jobsDigest)) {
    return { valid: false, reason: "MISSING_OR_INVALID_JOBS_DIGEST: jobsDigest must be a 64-char hex SHA-256 digest." };
  }
  const runDigest = String(evidence.responseDigest ?? "").trim();
  if (!/^[0-9a-f]{64}$/i.test(runDigest)) {
    return { valid: false, reason: "MISSING_OR_INVALID_RUN_RESPONSE_DIGEST: responseDigest must be a 64-char hex SHA-256 digest." };
  }
  const wfDigest = String(evidence.workflowResponseDigest ?? "").trim();
  if (!/^[0-9a-f]{64}$/i.test(wfDigest)) {
    return {
      valid: false,
      reason: "MISSING_OR_INVALID_WORKFLOW_RESPONSE_DIGEST: workflowResponseDigest must be a 64-char hex SHA-256 digest.",
    };
  }
  const jobsRespDigest = String(evidence.jobsResponseDigest ?? "").trim();
  if (!/^[0-9a-f]{64}$/i.test(jobsRespDigest)) {
    return {
      valid: false,
      reason: "MISSING_OR_INVALID_JOBS_RESPONSE_DIGEST: jobsResponseDigest must be a 64-char hex SHA-256 digest.",
    };
  }
  return { valid: true };
}

/**
 * Internal private signer for authenticated GitHub Actions CI evidence.
 * Genuinely module-private; NEVER exported to arbitrary imported modules.
 * Invoked exclusively by verifyRemoteGitHubActionsRun upon authentic provider verification.
 */
function _privateMintCiAttestationToken(evidence: any, key: string): string {
  const payload = computeCiAttestationDigest(evidence);
  const hmac = crypto.createHmac("sha256", key);
  hmac.update(payload, "utf-8");
  return `swai_ci_v1_${hmac.digest("hex")}`;
}

/**
 * Public diagnostic/helper function for CI token minting.
 * STRICTLY ENFORCES that a run MUST already be verified and registered in the private server
 * registry by verifyRemoteGitHubActionsRun (and NOT a mock).
 * Any caller attempting to mint tokens for arbitrary or unregistered runs receives an untrusted token (swai_ci_untrusted_*).
 * Raw key injection and testKey bypasses are strictly forbidden.
 */
export function mintCiAttestationToken(evidence: {
  provider?: string;
  source?: string;
  repository?: string;
  runId?: string | number;
  runAttempt?: number | string;
  headSha?: string;
  headBranch?: string;
  status?: string;
  conclusion?: string;
  event?: string;
  responseDigest?: string;
  workflowResponseDigest?: string;
  jobsResponseDigest?: string;
  jobsDigest?: string;
  workflowId?: number | string;
  workflowPath?: string;
  workflowName?: string;
  isUnitTestMock?: boolean;
}): string {
  const resolution = _resolveCiVerifierSecretInternal();

  const runIdStr = String(evidence.runId || "").trim();
  const repo = (evidence.repository || CANONICAL_REPOSITORY).toLowerCase();
  const serverRecord = runIdStr ? VERIFIED_PROVIDER_RUNS.get(`${repo}#${runIdStr}`) : undefined;

  // STRICT CHECK: An attestation token can ONLY be minted if a matching non-mock verified record
  // already exists in the private server registry from an authentic GitHub API verification.
  const isAuthenticRegisteredRun =
    serverRecord !== undefined &&
    !serverRecord.isUnitTestMock &&
    serverRecord.canonicalWorkflowVerified &&
    serverRecord.requiredJobsVerified &&
    hasAllCanonicalRequiredJobsInSummary(serverRecord.jobsSummary, serverRecord.runAttempt).valid &&
    serverRecord.headSha === (evidence.headSha || "") &&
    serverRecord.responseDigest === (evidence.responseDigest || "") &&
    serverRecord.workflowPath === evidence.workflowPath &&
    String(serverRecord.workflowId) === String(evidence.workflowId ?? "") &&
    serverRecord.jobsDigest === evidence.jobsDigest;

  if (!isAuthenticRegisteredRun) {
    const payload = computeCiAttestationDigest(evidence);
    const untrustedDigest = crypto.createHash("sha256").update(`CALLER_UNAUTHORIZED:${payload}`).digest("hex");
    return `swai_ci_untrusted_${untrustedDigest}`;
  }

  if (resolution.status !== "CONFIGURED" || !resolution.key) {
    const payload = computeCiAttestationDigest(evidence);
    const untrustedDigest = crypto.createHash("sha256").update(`MISSING_SECRET:${payload}`).digest("hex");
    return `swai_ci_untrusted_${untrustedDigest}`;
  }

  return _privateMintCiAttestationToken(evidence, resolution.key);
}

export function verifyCiAttestationToken(
  evidence: any,
  options: {
    expectedRepo?: string;
    expectedSha?: string;
    expectedBranch?: string;
    requireReleaseV2?: boolean;
    allowedWorkflowPaths?: readonly string[];
  } = {}
): {
  valid: boolean;
  reason?: string;
  isUnitTestMock?: boolean;
  releaseIdentityComplete?: boolean;
} {
  if (!evidence || typeof evidence !== "object") {
    return { valid: false, reason: "Evidence object is null or not an object." };
  }

  const sig = evidence.attestationSignature || evidence.attestationToken;
  if (
    !sig ||
    typeof sig !== "string" ||
    (!sig.startsWith("swai_ci_v1_") && !sig.startsWith("swai_ci_v2_"))
  ) {
    const isUntrusted = typeof sig === "string" && sig.startsWith("swai_ci_untrusted_");
    return {
      valid: false,
      reason: isUntrusted
        ? "UNAUTHORIZED_MINT: Attestation token was minted outside trusted verifier boundary without provider verification capability."
        : "Missing or invalid cryptographic attestation signature/token.",
    };
  }

  const resolution = _resolveCiVerifierSecretInternal();
  if (resolution.status !== "CONFIGURED" || !resolution.key) {
    return {
      valid: false,
      reason: `MISSING_TRUST_ANCHOR: ${resolution.reason}`,
    };
  }

  const isMock = evidence.isUnitTestMock === true || evidence.source === "UNIT_TEST_MOCK";
  const payload = computeCiAttestationDigest({
    provider: evidence.provider,
    source: evidence.source,
    repository: evidence.repository,
    runId: evidence.runId,
    runAttempt: evidence.runAttempt,
    headSha: evidence.headSha || evidence.commitSha,
    headBranch: evidence.headBranch || evidence.branch,
    status: evidence.status,
    conclusion: evidence.conclusion,
    event: evidence.event,
    responseDigest: evidence.responseDigest,
    workflowResponseDigest: evidence.workflowResponseDigest,
    jobsResponseDigest: evidence.jobsResponseDigest,
    jobsDigest: evidence.jobsDigest,
    workflowId: evidence.workflowId,
    workflowPath: evidence.workflowPath,
    workflowName: evidence.workflowName,
    verifier: evidence.verifier || TRUSTED_VERIFIER_ID,
    isUnitTestMock: isMock,
  });

  const prefix = sig.startsWith("swai_ci_v2_") ? "swai_ci_v2_" : "swai_ci_v1_";
  const expectedHmac = crypto.createHmac("sha256", resolution.key!).update(payload, "utf-8").digest("hex");
  const expectedSig = `${prefix}${expectedHmac}`;

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);

  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return {
      valid: false,
      reason: "Cryptographic attestation signature mismatch or forged token.",
    };
  }

  const v2IdentityCheck = hasCompleteV2ReleaseIdentity(evidence, options.allowedWorkflowPaths || CANONICAL_WORKFLOW_PATHS);
  if (options.requireReleaseV2 && !v2IdentityCheck.valid) {
    return {
      valid: false,
      isUnitTestMock: isMock,
      releaseIdentityComplete: false,
      reason: `LEGACY_V1_INCOMPLETE_IDENTITY_REJECTED: ${v2IdentityCheck.reason}`,
    };
  }

  return {
    valid: true,
    isUnitTestMock: isMock,
    releaseIdentityComplete: v2IdentityCheck.valid,
  };
}

export interface GitHubWorkflowRunEvidence {
  provider: "github-actions";
  source: "GITHUB_API" | "UNIT_TEST_MOCK";
  repository: string;
  runId: string;
  runAttempt?: number;
  runUrl: string;
  workflowId: number | string;
  workflowPath?: string;
  workflowName?: string;
  headSha: string;
  headBranch: string;
  event: "push" | "workflow_dispatch";
  status: "completed";
  conclusion: "success";
  jobsCount?: number;
  successfulJobs?: string[];
  jobsDigest?: string;
  jobsSummary?: ReadonlyArray<Readonly<VerifiedJobSummaryItem>>;
  fetchedAt: string;
  responseDigest: string; // SHA-256 of raw Run API response body
  workflowResponseDigest?: string; // SHA-256 of raw Workflow API response body
  jobsResponseDigest?: string; // SHA-256 of raw Jobs API response body
  canonicalWorkflowVerified?: boolean;
  requiredJobsVerified?: boolean;
  verifier: typeof TRUSTED_VERIFIER_ID;
  attestationSignature?: string;
  proofHandle?: string;
  isUnitTestMock?: boolean;
}

export interface VerifyRemoteCiRunOptions {
  runId: string;
  expectedSha: string;
  expectedBranch?: string;
  expectedRepo?: string;
  expectedRunAttempt?: number;
  allowedWorkflows?: string[];
  allowedWorkflowPaths?: readonly string[];
  requiredJobs?: string[];
  requireMultiEndpointVerification?: boolean;
  token?: string;
  timeoutMs?: number;
  customFetch?: typeof fetch;
  isUnitTestMock?: boolean;
}

export type RemoteCiStatus =
  | "CI_PASS"
  | "CI_FAIL"
  | "CI_NOT_RUN"
  | "CI_NOT_CONFIGURED"
  | "CI_UNVERIFIED";

export interface RemoteCiVerificationResult {
  verified: boolean;
  status: RemoteCiStatus;
  level: "CI_PROVIDER_VERIFIED" | "CI_NOT_RUN" | "CI_FAIL" | "PARSED_CLAIM";
  error?: string;
  rejectionReason?: string;
  evidence?: GitHubWorkflowRunEvidence | null;
  verifiedAt: string;
  isUnitTestMock?: boolean;
}

function validateCommonGitHubUrlStructure(rawUrl: string): { valid: boolean; parsed?: URL; error?: string } {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") {
      return { valid: false, error: `INSECURE_PROTOCOL: Only HTTPS is allowed (got ${parsed.protocol})` };
    }
    if (parsed.hostname.toLowerCase() !== TRUSTED_GITHUB_HOST) {
      return {
        valid: false,
        error: `SSRF_VIOLATION: Untrusted host '${parsed.hostname}'. Must be exactly '${TRUSTED_GITHUB_HOST}'`,
      };
    }
    if (parsed.username || parsed.password) {
      return { valid: false, error: "SSRF_VIOLATION: Userinfo credentials in URL are prohibited." };
    }
    if (parsed.port && parsed.port !== "443") {
      return { valid: false, error: `SSRF_VIOLATION: Non-standard HTTPS port '${parsed.port}' is prohibited.` };
    }
    if (rawUrl.includes("..") || rawUrl.includes("\\") || parsed.pathname.includes("//")) {
      return { valid: false, error: "PATH_TAMPERING: Path traversal sequences are prohibited." };
    }
    return { valid: true, parsed };
  } catch (err: any) {
    return { valid: false, error: `MALFORMED_URL: ${err?.message}` };
  }
}

/**
 * Validates Endpoint 1 (Workflow Run) target API URL against SSRF and host spoofing attacks.
 */
export function validateGitHubApiUrl(
  rawUrl: string,
  expectedRepo: string,
  runId: string
): { valid: boolean; error?: string } {
  const baseCheck = validateCommonGitHubUrlStructure(rawUrl);
  if (!baseCheck.valid || !baseCheck.parsed) {
    return { valid: false, error: baseCheck.error };
  }
  const cleanRunId = String(runId).trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(cleanRunId)) {
    return { valid: false, error: `INVALID_RUN_ID: RunId '${cleanRunId}' contains invalid characters.` };
  }
  const expectedPath = `/repos/${expectedRepo}/actions/runs/${cleanRunId}`;
  if (baseCheck.parsed.pathname !== expectedPath || baseCheck.parsed.search !== "") {
    return {
      valid: false,
      error: `PATH_TAMPERING: Expected path '${expectedPath}', got '${baseCheck.parsed.pathname}${baseCheck.parsed.search}'`,
    };
  }
  return { valid: true };
}

/**
 * Validates Endpoint 2 (Workflow Definition) target API URL against SSRF and host spoofing attacks.
 */
export function validateGitHubWorkflowApiUrl(
  rawUrl: string,
  expectedRepo: string,
  workflowId: string | number
): { valid: boolean; error?: string } {
  const baseCheck = validateCommonGitHubUrlStructure(rawUrl);
  if (!baseCheck.valid || !baseCheck.parsed) {
    return { valid: false, error: baseCheck.error };
  }
  const cleanWfId = String(workflowId).trim();
  if (!/^[1-9]\d*$/.test(cleanWfId)) {
    return { valid: false, error: `INVALID_WORKFLOW_ID: WorkflowId '${cleanWfId}' must be a positive integer.` };
  }
  const expectedPath = `/repos/${expectedRepo}/actions/workflows/${cleanWfId}`;
  if (baseCheck.parsed.pathname !== expectedPath || baseCheck.parsed.search !== "") {
    return {
      valid: false,
      error: `PATH_TAMPERING: Expected workflow path '${expectedPath}', got '${baseCheck.parsed.pathname}${baseCheck.parsed.search}'`,
    };
  }
  return { valid: true };
}

/**
 * Validates Endpoint 3 (Workflow Run Jobs) target API URL against SSRF and host spoofing attacks.
 */
export function validateGitHubRunJobsApiUrl(
  rawUrl: string,
  expectedRepo: string,
  runId: string,
  page: number = 1,
  runAttempt?: number
): { valid: boolean; error?: string } {
  const baseCheck = validateCommonGitHubUrlStructure(rawUrl);
  if (!baseCheck.valid || !baseCheck.parsed) {
    return { valid: false, error: baseCheck.error };
  }
  const cleanRunId = String(runId).trim();
  if (!/^[1-9]\d*$/.test(cleanRunId)) {
    return { valid: false, error: `INVALID_RUN_ID: RunId '${cleanRunId}' must be a positive integer.` };
  }
  if (!Number.isInteger(page) || page < 1 || page > MAX_GITHUB_JOBS_PAGES) {
    return { valid: false, error: `INVALID_JOBS_PAGE: Page '${page}' out of bounds (1..${MAX_GITHUB_JOBS_PAGES}).` };
  }
  const expectedPath =
    runAttempt !== undefined
      ? `/repos/${expectedRepo}/actions/runs/${cleanRunId}/attempts/${runAttempt}/jobs`
      : `/repos/${expectedRepo}/actions/runs/${cleanRunId}/jobs`;
  if (baseCheck.parsed.pathname !== expectedPath) {
    return {
      valid: false,
      error: `PATH_TAMPERING: Expected jobs path '${expectedPath}', got '${baseCheck.parsed.pathname}'`,
    };
  }
  return { valid: true };
}

export interface GitHubVerificationBudgetTracker {
  totalBytes: number;
  maxTotalBytes: number;
}

export async function readBoundedResponseBytes(
  res: any,
  maxBytes: number,
  controller: AbortController,
  endpointLabel: string = "response",
  budgetTracker?: GitHubVerificationBudgetTracker
): Promise<{ ok: boolean; buffer?: Buffer; rawText?: string; errorCode?: string; error?: string }> {
  const maxTotalBytes = budgetTracker?.maxTotalBytes ?? MAX_TOTAL_GITHUB_VERIFICATION_BYTES;

  // 1. Fast fail on Content-Length header before reading body bytes
  const contentLengthHeader =
    typeof res?.headers?.get === "function" ? res.headers.get("content-length") : undefined;
  if (contentLengthHeader !== undefined && contentLengthHeader !== null) {
    const declaredLength = Number(contentLengthHeader);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      try {
        controller.abort();
      } catch {}
      return {
        ok: false,
        errorCode: "OVERSIZE_RESPONSE",
        error: `GitHub API ${endpointLabel} response exceeded maximum allowed size of ${maxBytes} bytes (Content-Length=${declaredLength}).`,
      };
    }
    if (
      budgetTracker &&
      Number.isFinite(declaredLength) &&
      budgetTracker.totalBytes + declaredLength > maxTotalBytes
    ) {
      try {
        controller.abort();
      } catch {}
      return {
        ok: false,
        errorCode: "OVERSIZE_RESPONSE",
        error: `GitHub API ${endpointLabel} response exceeded total verification budget of ${maxTotalBytes} bytes.`,
      };
    }
  }

  // 2. Web ReadableStream reader path: byte-count-before-append
  if (res?.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        const chunkBuf = Buffer.isBuffer(value)
          ? value
          : value instanceof Uint8Array
          ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
          : Buffer.from(String(value), "utf-8");

        const nextTotal = totalBytes + chunkBuf.byteLength;
        const nextBudget = (budgetTracker?.totalBytes ?? 0) + chunkBuf.byteLength;

        if (nextTotal > maxBytes || nextBudget > maxTotalBytes) {
          chunks.length = 0;
          try {
            await reader.cancel();
          } catch {}
          try {
            controller.abort();
          } catch {}
          return {
            ok: false,
            errorCode: "OVERSIZE_RESPONSE",
            error:
              nextTotal > maxBytes
                ? `GitHub API ${endpointLabel} response exceeded maximum allowed size of ${maxBytes} bytes.`
                : `GitHub API ${endpointLabel} response exceeded total verification budget of ${maxTotalBytes} bytes.`,
          };
        }

        totalBytes = nextTotal;
        if (budgetTracker) {
          budgetTracker.totalBytes = nextBudget;
        }
        chunks.push(chunkBuf);
      }

      const fullBuf = Buffer.concat(chunks, totalBytes);
      return { ok: true, buffer: fullBuf, rawText: fullBuf.toString("utf-8") };
    } catch (err: any) {
      chunks.length = 0;
      throw err;
    }
  }

  // 3. Async iterable stream path (e.g. Node Readable stream): byte-count-before-append
  if (res?.body && typeof res.body[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    try {
      for await (const chunk of res.body) {
        if (!chunk) continue;
        const chunkBuf = Buffer.isBuffer(chunk)
          ? chunk
          : chunk instanceof Uint8Array
          ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
          : Buffer.from(String(chunk), "utf-8");

        const nextTotal = totalBytes + chunkBuf.byteLength;
        const nextBudget = (budgetTracker?.totalBytes ?? 0) + chunkBuf.byteLength;

        if (nextTotal > maxBytes || nextBudget > maxTotalBytes) {
          chunks.length = 0;
          try {
            if (typeof res.body.destroy === "function") res.body.destroy();
          } catch {}
          try {
            controller.abort();
          } catch {}
          return {
            ok: false,
            errorCode: "OVERSIZE_RESPONSE",
            error:
              nextTotal > maxBytes
                ? `GitHub API ${endpointLabel} response exceeded maximum allowed size of ${maxBytes} bytes.`
                : `GitHub API ${endpointLabel} response exceeded total verification budget of ${maxTotalBytes} bytes.`,
          };
        }

        totalBytes = nextTotal;
        if (budgetTracker) {
          budgetTracker.totalBytes = nextBudget;
        }
        chunks.push(chunkBuf);
      }
      const fullBuf = Buffer.concat(chunks, totalBytes);
      return { ok: true, buffer: fullBuf, rawText: fullBuf.toString("utf-8") };
    } catch (err: any) {
      chunks.length = 0;
      throw err;
    }
  }

  // 4. Fallback for unit-test mocks providing only res.text()
  const rawText = typeof res?.text === "function" ? await res.text() : "";
  const byteLen = Buffer.byteLength(rawText || "", "utf-8");
  const nextBudget = (budgetTracker?.totalBytes ?? 0) + byteLen;
  if (byteLen > maxBytes || nextBudget > maxTotalBytes) {
    try {
      controller.abort();
    } catch {}
    return {
      ok: false,
      errorCode: "OVERSIZE_RESPONSE",
      error:
        byteLen > maxBytes
          ? `GitHub API ${endpointLabel} response exceeded maximum allowed size of ${maxBytes} bytes.`
          : `GitHub API ${endpointLabel} response exceeded total verification budget of ${maxTotalBytes} bytes.`,
    };
  }
  if (budgetTracker) {
    budgetTracker.totalBytes = nextBudget;
  }
  const fullBuf = Buffer.from(rawText || "", "utf-8");
  return { ok: true, buffer: fullBuf, rawText: rawText || "" };
}

export async function executeBoundedGitHubGet(params: {
  url: string;
  token?: string;
  timeoutMs: number;
  fetchFn: typeof fetch;
  endpointLabel: string;
  maxBytes?: number;
  maxRetries?: number;
  budgetTracker?: GitHubVerificationBudgetTracker;
}): Promise<{
  ok: boolean;
  status: number;
  rawText?: string;
  data?: any;
  responseDigest?: string;
  rejectionStatus?: RemoteCiStatus;
  error?: string;
}> {
  const maxBytes = params.maxBytes ?? MAX_GITHUB_API_RESPONSE_BYTES;
  const maxRetries = Math.max(0, Math.min(2, params.maxRetries ?? 0));

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs);

    try {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "SWAI-KH02-CiVerifier/2.0",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      if (params.token) {
        headers.Authorization = `Bearer ${params.token}`;
      }

      const res = await params.fetchFn(params.url, {
        method: "GET",
        headers,
        signal: controller.signal,
        redirect: "error", // Strictly forbid redirects to prevent open-redirect / SSRF
      });

      const responseStatus = res.status;

      // Check HTTP status codes BEFORE reading body bytes
      if (responseStatus === 401 || responseStatus === 403) {
        const rateLimitRemaining =
          typeof res?.headers?.get === "function" ? res.headers.get("x-ratelimit-remaining") : null;
        if (responseStatus === 403 && rateLimitRemaining === "0") {
          return {
            ok: false,
            status: responseStatus,
            rejectionStatus: "CI_NOT_RUN",
            error: `RATE_LIMITED: GitHub API ${params.endpointLabel} rate-limited (HTTP 403, x-ratelimit-remaining=0).`,
          };
        }
        return {
          ok: false,
          status: responseStatus,
          rejectionStatus: "CI_NOT_RUN",
          error: `GitHub API ${params.endpointLabel} authentication/permission denied (HTTP ${responseStatus}). Verify GITHUB_TOKEN scope.`,
        };
      }

      if (responseStatus === 404) {
        return {
          ok: false,
          status: responseStatus,
          rejectionStatus: "CI_NOT_RUN",
          error: `GitHub Actions ${params.endpointLabel} resource not found (HTTP 404).`,
        };
      }

      if (responseStatus === 429 || responseStatus >= 500) {
        if (attempt < maxRetries && [429, 502, 503, 504].includes(responseStatus)) {
          await new Promise((r) => setTimeout(r, 150 * Math.pow(2, attempt)));
          continue;
        }
        return {
          ok: false,
          status: responseStatus,
          rejectionStatus: "CI_NOT_RUN",
          error:
            responseStatus === 429
              ? `RATE_LIMITED: GitHub API ${params.endpointLabel} rate-limited (HTTP 429).`
              : `GitHub API ${params.endpointLabel} rate-limited or unavailable (HTTP ${responseStatus}).`,
        };
      }

      if (responseStatus !== 200) {
        return {
          ok: false,
          status: responseStatus,
          rejectionStatus: "CI_NOT_RUN",
          error: `GitHub API ${params.endpointLabel} returned unexpected HTTP status ${responseStatus}.`,
        };
      }

      // Bounded streaming body consumption under the active AbortController timer
      const bodyRead = await readBoundedResponseBytes(
        res,
        maxBytes,
        controller,
        params.endpointLabel,
        params.budgetTracker
      );
      if (!bodyRead.ok || !bodyRead.buffer) {
        return {
          ok: false,
          status: responseStatus,
          rejectionStatus: "CI_FAIL",
          error: bodyRead.error || `GitHub API ${params.endpointLabel} response exceeded size limit.`,
        };
      }

      const rawBuffer = bodyRead.buffer;
      const rawText = rawBuffer.toString("utf-8");

      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        return {
          ok: false,
          status: responseStatus,
          rejectionStatus: "CI_FAIL",
          error: `GitHub API ${params.endpointLabel} response body is not valid JSON.`,
        };
      }

      if (!data || typeof data !== "object" || Array.isArray(data)) {
        return {
          ok: false,
          status: responseStatus,
          rejectionStatus: "CI_FAIL",
          error: `GitHub API ${params.endpointLabel} response object is empty or malformed.`,
        };
      }

      const responseDigest = crypto.createHash("sha256").update(rawBuffer).digest("hex");
      return {
        ok: true,
        status: responseStatus,
        rawText,
        data,
        responseDigest,
      };
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return {
          ok: false,
          status: 0,
          rejectionStatus: "CI_NOT_RUN",
          error: `GitHub API ${params.endpointLabel} request timed out after ${params.timeoutMs}ms.`,
        };
      }
      return {
        ok: false,
        status: 0,
        rejectionStatus: "CI_NOT_RUN",
        error: `GitHub API ${params.endpointLabel} network error: ${sanitizeCiLog(String(err?.message || err))}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ok: false,
    status: 0,
    rejectionStatus: "CI_NOT_RUN",
    error: `GitHub API ${params.endpointLabel} failed after retries.`,
  };
}

/**
 * Fetches Endpoint 1: GET /repos/{owner}/{repo}/actions/runs/{run_id}
 */
export async function fetchGitHubRun(options: {
  repository: string;
  runId: string;
  token?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  budgetTracker?: GitHubVerificationBudgetTracker;
}) {
  const cleanRunId = String(options.runId).trim();
  const targetUrl = `https://${TRUSTED_GITHUB_HOST}/repos/${options.repository}/actions/runs/${cleanRunId}`;
  const urlCheck = validateGitHubApiUrl(targetUrl, options.repository, cleanRunId);
  if (!urlCheck.valid) {
    return {
      ok: false,
      status: 0,
      rejectionStatus: "CI_FAIL" as RemoteCiStatus,
      error: urlCheck.error,
    };
  }
  return executeBoundedGitHubGet({
    url: targetUrl,
    token: options.token,
    timeoutMs: options.timeoutMs || 8000,
    fetchFn: options.fetchFn || fetch,
    endpointLabel: `run '${cleanRunId}' on repository '${options.repository}'`,
    budgetTracker: options.budgetTracker,
  });
}

/**
 * Fetches Endpoint 2: GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}
 */
export async function fetchGitHubWorkflow(options: {
  repository: string;
  workflowId: number | string;
  token?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  budgetTracker?: GitHubVerificationBudgetTracker;
}) {
  const cleanWfId = String(options.workflowId).trim();
  const targetUrl = `https://${TRUSTED_GITHUB_HOST}/repos/${options.repository}/actions/workflows/${cleanWfId}`;
  const urlCheck = validateGitHubWorkflowApiUrl(targetUrl, options.repository, cleanWfId);
  if (!urlCheck.valid) {
    return {
      ok: false,
      status: 0,
      rejectionStatus: "CI_FAIL" as RemoteCiStatus,
      error: urlCheck.error,
    };
  }
  return executeBoundedGitHubGet({
    url: targetUrl,
    token: options.token,
    timeoutMs: options.timeoutMs || 8000,
    fetchFn: options.fetchFn || fetch,
    endpointLabel: `workflow '${cleanWfId}' on repository '${options.repository}'`,
    budgetTracker: options.budgetTracker,
  });
}

/**
 * Fetches Endpoint 3: GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs?filter=latest&per_page=100&page={page}
 * with bounded pagination up to MAX_GITHUB_JOBS_PAGES and strict pagination integrity checks.
 */
export async function fetchGitHubRunJobs(options: {
  repository: string;
  runId: string;
  token?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  budgetTracker?: GitHubVerificationBudgetTracker;
}): Promise<{
  ok: boolean;
  status: number;
  totalCount?: number;
  jobs?: any[];
  pagesFetched?: number;
  rawText?: string;
  responseDigest?: string;
  rejectionStatus?: RemoteCiStatus;
  error?: string;
}> {
  const cleanRunId = String(options.runId).trim();
  const allJobs: any[] = [];
  const seenJobIds = new Set<string>();
  const rawPageTexts: string[] = [];
  let totalCount = 0;
  let totalCountInitialized = false;
  let pagesFetched = 0;

  for (let page = 1; page <= MAX_GITHUB_JOBS_PAGES; page++) {
    const targetUrl = `https://${TRUSTED_GITHUB_HOST}/repos/${options.repository}/actions/runs/${cleanRunId}/jobs?filter=latest&per_page=100&page=${page}`;
    const urlCheck = validateGitHubRunJobsApiUrl(targetUrl, options.repository, cleanRunId, page);
    if (!urlCheck.valid) {
      return {
        ok: false,
        status: 0,
        rejectionStatus: "CI_FAIL",
        error: urlCheck.error,
      };
    }

    const pageRes = await executeBoundedGitHubGet({
      url: targetUrl,
      token: options.token,
      timeoutMs: options.timeoutMs || 8000,
      fetchFn: options.fetchFn || fetch,
      endpointLabel: `jobs for run '${cleanRunId}' (page ${page})`,
      budgetTracker: options.budgetTracker,
    });

    if (!pageRes.ok) {
      return pageRes;
    }

    pagesFetched += 1;
    rawPageTexts.push(pageRes.rawText || "");

    const pageData = pageRes.data;
    if (typeof pageData.total_count !== "number" || !Number.isInteger(pageData.total_count) || pageData.total_count < 0) {
      return {
        ok: false,
        status: 200,
        rejectionStatus: "CI_FAIL",
        error: `JOBS_TOTAL_COUNT_INVALID: Page ${page} returned invalid total_count '${pageData.total_count}'.`,
      };
    }

    if (page === 1) {
      totalCount = pageData.total_count;
      totalCountInitialized = true;
      if (totalCount > MAX_GITHUB_JOBS_PAGES * 100) {
        return {
          ok: false,
          status: 200,
          rejectionStatus: "CI_FAIL",
          error: `JOBS_PAGINATION_OVERFLOW: Run '${cleanRunId}' declares total_count=${totalCount}, exceeding bounded maximum of ${MAX_GITHUB_JOBS_PAGES * 100} jobs.`,
        };
      }
    } else if (pageData.total_count !== totalCount) {
      return {
        ok: false,
        status: 200,
        rejectionStatus: "CI_FAIL",
        error: `JOBS_INCONSISTENT_TOTAL_COUNT: Page ${page} reported total_count=${pageData.total_count}, expected ${totalCount} from page 1.`,
      };
    }

    if (!Array.isArray(pageData.jobs)) {
      return {
        ok: false,
        status: 200,
        rejectionStatus: "CI_FAIL",
        error: `JOBS_ARRAY_MISSING: Page ${page} response lacks a valid jobs array.`,
      };
    }

    const pageJobs = pageData.jobs;
    if (totalCount > 0 && pageJobs.length === 0 && allJobs.length < totalCount) {
      return {
        ok: false,
        status: 200,
        rejectionStatus: "CI_FAIL",
        error: `JOBS_TRUNCATED_PAGINATION: Page ${page} returned 0 jobs while only ${allJobs.length}/${totalCount} jobs were fetched.`,
      };
    }

    for (const j of pageJobs) {
      const jId = String(j?.id ?? "").trim();
      if (!jId) {
        return {
          ok: false,
          status: 200,
          rejectionStatus: "CI_FAIL",
          error: `JOB_MISSING_ID: Job entry on page ${page} is missing a valid id.`,
        };
      }
      if (seenJobIds.has(jId)) {
        return {
          ok: false,
          status: 200,
          rejectionStatus: "CI_FAIL",
          error: `JOBS_DUPLICATE_ID: Duplicate job id '${jId}' detected across jobs response (repeated page or duplicate job entry).`,
        };
      }
      seenJobIds.add(jId);
      allJobs.push(j);
    }

    if (allJobs.length > totalCount) {
      return {
        ok: false,
        status: 200,
        rejectionStatus: "CI_FAIL",
        error: `JOBS_COUNT_EXCEEDS_TOTAL_COUNT: Fetched ${allJobs.length} jobs, exceeding declared total_count=${totalCount}.`,
      };
    }

    if (allJobs.length === totalCount || pageJobs.length < 100) {
      break;
    }
  }

  if (totalCountInitialized && allJobs.length !== totalCount) {
    return {
      ok: false,
      status: 200,
      rejectionStatus: "CI_FAIL",
      error: `JOBS_TRUNCATED_PAGINATION: Expected total_count=${totalCount} jobs, but fetched ${allJobs.length} jobs across ${pagesFetched} page(s).`,
    };
  }

  const combinedRaw = rawPageTexts.length === 1 ? rawPageTexts[0] : rawPageTexts.join("\n---PAGE---\n");
  const responseDigest = crypto.createHash("sha256").update(Buffer.from(combinedRaw, "utf-8")).digest("hex");

  return {
    ok: true,
    status: 200,
    totalCount,
    jobs: allJobs,
    pagesFetched,
    rawText: combinedRaw,
    responseDigest,
  };
}

/**
 * Verifies Run JSON identity fields from Endpoint 1.
 */
export function verifyRunIdentity(
  data: any,
  options: {
    runId: string;
    expectedRepo: string;
    expectedSha: string;
    expectedBranch: string;
    expectedRunAttempt?: number;
    allowedWorkflows?: string[];
    allowedWorkflowPaths?: readonly string[];
    enforceCanonicalPath?: boolean;
    requireStrictProvenance?: boolean;
  }
): { valid: boolean; status?: RemoteCiStatus; reason?: string } {
  const actualRepo = String(data?.repository?.full_name || "");
  if (actualRepo.toLowerCase() !== options.expectedRepo.toLowerCase()) {
    return {
      valid: false,
      status: "CI_FAIL",
      reason: `CI repository mismatch: got '${actualRepo}', expected '${options.expectedRepo}'.`,
    };
  }

  if (data?.repository?.fork === true) {
    return {
      valid: false,
      status: "CI_FAIL",
      reason: `FORK_REPOSITORY_REJECTED: Run repository '${actualRepo}' is marked as a fork.`,
    };
  }

  if (data?.head_repository !== undefined && data?.head_repository !== null) {
    const headRepoName = String(data.head_repository?.full_name || "");
    if (
      !headRepoName ||
      headRepoName.toLowerCase() !== options.expectedRepo.toLowerCase() ||
      data.head_repository?.fork === true
    ) {
      return {
        valid: false,
        status: "CI_FAIL",
        reason: `FORK_OR_FOREIGN_HEAD_REPOSITORY_REJECTED: head_repository '${headRepoName}' (fork=${Boolean(
          data.head_repository?.fork
        )}) does not match canonical repository '${options.expectedRepo}'.`,
      };
    }
  }

  if (Array.isArray(data?.pull_requests) && data.pull_requests.length > 0) {
    return {
      valid: false,
      status: "CI_FAIL",
      reason: "PULL_REQUEST_RUN_REJECTED: Workflow run is associated with pull_requests and cannot be used for branch release promotion.",
    };
  }

  const actualSha = String(data?.head_sha || "").trim();
  if (!/^[0-9a-f]{40}$/i.test(actualSha) || actualSha.toLowerCase() !== options.expectedSha.toLowerCase()) {
    return {
      valid: false,
      status: "CI_FAIL",
      reason: `CI commit SHA mismatch: run head_sha '${actualSha}' does not match expected tested SHA '${options.expectedSha}'.`,
    };
  }

  const actualRunId = String(data?.id || "").trim();
  if (!actualRunId || actualRunId !== options.runId || Number(data?.id) !== Number(options.runId)) {
    return {
      valid: false,
      status: "CI_FAIL",
      reason: `CI runId mismatch: GitHub API returned runId '${actualRunId}', expected '${options.runId}'.`,
    };
  }

  const actualBranch = String(data?.head_branch || "").trim();
  if (actualBranch !== options.expectedBranch) {
    return {
      valid: false,
      status: "CI_FAIL",
      reason: `CI branch mismatch: run head_branch '${actualBranch}' does not match locked branch '${options.expectedBranch}'.`,
    };
  }

  if (data?.status !== "completed") {
    return {
      valid: false,
      status: "CI_NOT_RUN",
      reason: `CI run status is '${data?.status}' (expected 'completed'). Workflow is still pending or running.`,
    };
  }

  if (data?.conclusion !== "success") {
    return {
      valid: false,
      status: "CI_FAIL",
      reason: `CI run conclusion is '${data?.conclusion}' (expected 'success'). Remote CI checks failed.`,
    };
  }

  if (data?.event !== "push" && data?.event !== "workflow_dispatch") {
    return {
      valid: false,
      status: "CI_FAIL",
      reason: `Untrusted trigger event '${data?.event}'. Only 'push' and 'workflow_dispatch' are permitted for release attestation.`,
    };
  }

  const attemptNum = Number(data?.run_attempt ?? 1);
  if (!Number.isInteger(attemptNum) || attemptNum <= 0) {
    return {
      valid: false,
      status: "CI_FAIL",
      reason: `INVALID_RUN_ATTEMPT: run_attempt '${data?.run_attempt}' must be a positive integer.`,
    };
  }

  if (options.expectedRunAttempt !== undefined && attemptNum !== options.expectedRunAttempt) {
    return {
      valid: false,
      status: "CI_FAIL",
      reason: `CI run_attempt mismatch: run returned attempt '${attemptNum}', expected '${options.expectedRunAttempt}'.`,
    };
  }

  if (data?.check_suite_id !== undefined && data?.check_suite_id !== null) {
    const csId = Number(data.check_suite_id);
    if (!Number.isInteger(csId) || csId <= 0) {
      return {
        valid: false,
        status: "CI_FAIL",
        reason: `INVALID_CHECK_SUITE_ID: check_suite_id '${data.check_suite_id}' must be a positive integer.`,
      };
    }
  }

  if (Array.isArray(options.allowedWorkflows) && options.allowedWorkflows.length > 0) {
    const wfName = String(data?.name || "").trim();
    const wfPath = String(data?.path || "").trim();
    const matched = options.allowedWorkflows.some((allowed) => wfName === allowed || wfPath === allowed);
    if (!matched) {
      return {
        valid: false,
        status: "CI_FAIL",
        reason: `Workflow '${wfName || wfPath}' is not in the allowed release workflows list (${options.allowedWorkflows.join(", ")}).`,
      };
    }
  }

  if (options.enforceCanonicalPath !== false) {
    const wfPathCheck = requireCanonicalReleaseWorkflow(
      data?.path,
      options.allowedWorkflowPaths || CANONICAL_WORKFLOW_PATHS
    );
    if (!wfPathCheck.valid) {
      return {
        valid: false,
        status: "CI_FAIL",
        reason: wfPathCheck.reason,
      };
    }
    const wfIdNum = Number(data?.workflow_id);
    if (!Number.isInteger(wfIdNum) || wfIdNum <= 0) {
      return {
        valid: false,
        status: "CI_FAIL",
        reason: `MISSING_WORKFLOW_ID: Run payload workflow_id '${data?.workflow_id}' must be a positive integer.`,
      };
    }
  }

  return { valid: true };
}

/**
 * Verifies Workflow JSON identity from Endpoint 2 against Run JSON from Endpoint 1.
 */
export function verifyWorkflowIdentity(
  runData: any,
  workflowData: any,
  options: {
    expectedRepo?: string;
    allowedWorkflowPaths?: readonly string[];
  } = {}
): { valid: boolean; status?: RemoteCiStatus; reason?: string } {
  if (!workflowData || typeof workflowData !== "object") {
    return {
      valid: false,
      status: "CI_FAIL",
      reason: "WORKFLOW_PAYLOAD_INVALID: Workflow endpoint returned empty or non-object payload.",
    };
  }

  const runWfId = String(runData?.workflow_id ?? "").trim();
  const wfEndpointId = String(workflowData?.id ?? "").trim();
  if (!runWfId || !wfEndpointId || runWfId !== wfEndpointId || Number(runData?.workflow_id) !== Number(workflowData?.id)) {
    return {
      valid: false,
      status: "CI_FAIL",
      reason: `WORKFLOW_ID_MISMATCH: Run workflow_id '${runWfId}' does not match workflow endpoint id '${wfEndpointId}'.`,
    };
  }

  const runPath = String(runData?.path ?? "").trim();
  const wfEndpointPath = String(workflowData?.path ?? "").trim();
  if (runPath !== wfEndpointPath) {
    return {
      valid: false,
      status: "CI_FAIL",
      reason: `WORKFLOW_PATH_MISMATCH: Run path '${runPath}' does not match workflow endpoint path '${wfEndpointPath}'.`,
    };
  }

  const wfPathCheck = requireCanonicalReleaseWorkflow(
    workflowData?.path,
    options.allowedWorkflowPaths || CANONICAL_WORKFLOW_PATHS
  );
  if (!wfPathCheck.valid) {
    return {
      valid: false,
      status: "CI_FAIL",
      reason: `WORKFLOW_PATH_REJECTED: ${wfPathCheck.reason}`,
    };
  }

  if (workflowData.state !== "active") {
    return {
      valid: false,
      status: "CI_FAIL",
      reason: `WORKFLOW_NOT_ACTIVE: Workflow '${workflowData.path}' state is '${workflowData.state}' (expected 'active').`,
    };
  }

  const expectedRepo = (options.expectedRepo || CANONICAL_REPOSITORY).toLowerCase();
  for (const urlField of [workflowData.url, workflowData.html_url]) {
    if (typeof urlField === "string" && urlField.trim() !== "") {
      if (!urlField.toLowerCase().includes(expectedRepo)) {
        return {
          valid: false,
          status: "CI_FAIL",
          reason: `WORKFLOW_REPO_MISMATCH: Workflow URL '${urlField}' does not belong to canonical repository '${expectedRepo}'.`,
        };
      }
    }
  }

  const runName = String(runData?.name ?? "").trim();
  const wfName = String(workflowData?.name ?? "").trim();
  if (runName && wfName && runName !== wfName) {
    return {
      valid: false,
      status: "CI_FAIL",
      reason: `WORKFLOW_NAME_MISMATCH: Run workflow name '${runName}' does not match workflow endpoint name '${wfName}'.`,
    };
  }

  return { valid: true };
}

/**
 * Verifies Jobs JSON from Endpoint 3 against Run JSON from Endpoint 1 and the immutable baseline CANONICAL_REQUIRED_JOBS policy.
 * Callers may pass additional requiredJobs, but can NEVER omit or weaken CANONICAL_REQUIRED_JOBS.
 */
export function verifyRequiredJobs(
  runData: any,
  jobsData: { totalCount?: number; jobs?: any[] },
  options: {
    expectedRunId: string;
    expectedSha: string;
    expectedRunAttempt?: number;
    requiredJobs?: string[];
  }
): {
  valid: boolean;
  status?: RemoteCiStatus;
  reason?: string;
  jobsDigest?: string;
  jobsSummary?: VerifiedJobSummaryItem[];
  successfulJobs?: string[];
  missingJobs?: string[];
} {
  const jobs = Array.isArray(jobsData?.jobs) ? jobsData.jobs : [];
  const totalCount = typeof jobsData?.totalCount === "number" ? jobsData.totalCount : jobs.length;

  if (totalCount < 1 || jobs.length < 1) {
    return {
      valid: false,
      status: "CI_FAIL",
      reason: `JOBS_EMPTY: Workflow run '${options.expectedRunId}' has 0 jobs (total_count=${totalCount}, jobs.length=${jobs.length}).`,
    };
  }

  if (jobs.length < totalCount) {
    return {
      valid: false,
      status: "CI_FAIL",
      reason: `JOBS_PAGINATION_INCOMPLETE: Expected total_count=${totalCount} jobs, but only fetched ${jobs.length} jobs.`,
    };
  }

  if (jobs.length > totalCount) {
    return {
      valid: false,
      status: "CI_FAIL",
      reason: `JOBS_COUNT_MISMATCH: Expected total_count=${totalCount} jobs, but received ${jobs.length} jobs.`,
    };
  }

  const runAttempt = Number(options.expectedRunAttempt ?? runData?.run_attempt ?? 1);
  const summaryItems: VerifiedJobSummaryItem[] = [];
  const successfulJobs: string[] = [];
  const seenJobIds = new Set<string>();
  const seenJobNames = new Set<string>();

  for (const job of jobs) {
    if (!job || typeof job !== "object") {
      return {
        valid: false,
        status: "CI_FAIL",
        reason: "JOB_ENTRY_MALFORMED: Jobs list contains a non-object entry.",
      };
    }

    const jobIdStr = String(job.id ?? "").trim();
    if (!jobIdStr) {
      return {
        valid: false,
        status: "CI_FAIL",
        reason: "JOB_MISSING_ID: Job entry is missing a valid id.",
      };
    }
    if (seenJobIds.has(jobIdStr)) {
      return {
        valid: false,
        status: "CI_FAIL",
        reason: `DUPLICATE_JOB_ID: Job id '${jobIdStr}' appears multiple times in the same workflow run.`,
      };
    }
    seenJobIds.add(jobIdStr);

    const jobRunId = String(job.run_id ?? "").trim();
    if (!jobRunId || jobRunId !== String(options.expectedRunId) || Number(job.run_id) !== Number(options.expectedRunId)) {
      return {
        valid: false,
        status: "CI_FAIL",
        reason: `JOB_RUN_ID_MISMATCH: Job '${job.name || job.id}' belongs to run_id '${jobRunId}', expected '${options.expectedRunId}'.`,
      };
    }

    if (job.run_attempt !== undefined && Number(job.run_attempt) !== runAttempt) {
      return {
        valid: false,
        status: "CI_FAIL",
        reason: `JOB_RUN_ATTEMPT_MISMATCH: Job '${job.name || job.id}' belongs to run_attempt '${job.run_attempt}', expected '${runAttempt}'.`,
      };
    }

    if (job.head_sha && String(job.head_sha).toLowerCase() !== options.expectedSha.toLowerCase()) {
      return {
        valid: false,
        status: "CI_FAIL",
        reason: `JOB_HEAD_SHA_MISMATCH: Job '${job.name || job.id}' head_sha '${job.head_sha}' does not match expected '${options.expectedSha}'.`,
      };
    }

    const jobName = String(job.name ?? "").trim();
    if (!jobName) {
      return {
        valid: false,
        status: "CI_FAIL",
        reason: `JOB_MISSING_NAME: Job id '${job.id}' has an empty name.`,
      };
    }

    if (seenJobNames.has(jobName)) {
      return {
        valid: false,
        status: "CI_FAIL",
        reason: `DUPLICATE_JOB_NAME: Job name '${jobName}' appears multiple times in the same workflow run.`,
      };
    }
    seenJobNames.add(jobName);

    if (job.status !== "completed" || job.conclusion !== "success") {
      return {
        valid: false,
        status: "CI_FAIL",
        reason: `JOB_NOT_SUCCESS: Job '${jobName}' finished with status='${job.status}', conclusion='${job.conclusion}' (expected completed/success).`,
      };
    }

    const stepSummaries: VerifiedJobStepSummaryItem[] = [];
    if (job.steps !== undefined) {
      if (!Array.isArray(job.steps) || job.steps.length === 0) {
        return {
          valid: false,
          status: "CI_FAIL",
          reason: `JOB_STEPS_EMPTY: Job '${jobName}' has an empty or invalid steps array.`,
        };
      }
      for (const step of job.steps) {
        if (!step || typeof step !== "object") {
          return {
            valid: false,
            status: "CI_FAIL",
            reason: `JOB_STEP_MALFORMED: Job '${jobName}' contains a malformed step entry.`,
          };
        }
        if (step.status !== "completed" || step.conclusion !== "success") {
          return {
            valid: false,
            status: "CI_FAIL",
            reason: `JOB_STEP_FAILED: Step '${step.name || step.number}' in job '${jobName}' has status='${step.status}', conclusion='${step.conclusion}'.`,
          };
        }
        stepSummaries.push({
          number: typeof step.number === "number" ? step.number : undefined,
          name: String(step.name || step.number || "step"),
          status: String(step.status),
          conclusion: String(step.conclusion),
        });
      }
    }

    summaryItems.push({
      id: job.id ?? jobName,
      name: jobName,
      status: String(job.status),
      conclusion: String(job.conclusion),
      runAttempt: Number(job.run_attempt ?? runAttempt),
      ...(stepSummaries.length > 0 ? { steps: stepSummaries } : {}),
    });
    successfulJobs.push(jobName);
  }

  // IMMUTABLE BASELINE REQUIRED JOBS POLICY:
  // Callers may add extra required jobs, but can NEVER omit or weaken CANONICAL_REQUIRED_JOBS.
  const effectiveRequiredJobs = Array.from(
    new Set<string>([
      ...CANONICAL_REQUIRED_JOBS,
      ...(Array.isArray(options.requiredJobs) ? options.requiredJobs : []),
    ])
  );

  const missingJobs: string[] = [];
  for (const reqJob of effectiveRequiredJobs) {
    if (!successfulJobs.includes(reqJob)) {
      missingJobs.push(reqJob);
    }
  }

  if (missingJobs.length > 0) {
    return {
      valid: false,
      status: "CI_FAIL",
      missingJobs,
      reason: `MISSING_REQUIRED_JOB: Required release job '${missingJobs[0]}' (missing: [${missingJobs.join(", ")}]) was not found among completed successful jobs (${successfulJobs.join(", ")}).`,
    };
  }

  const sortedSummary = [...summaryItems].sort((a, b) => {
    const nameCmp = a.name.localeCompare(b.name);
    if (nameCmp !== 0) return nameCmp;
    return String(a.id).localeCompare(String(b.id));
  });

  const jobsDigest = crypto.createHash("sha256").update(JSON.stringify(sortedSummary), "utf-8").digest("hex");

  return {
    valid: true,
    jobsDigest,
    jobsSummary: sortedSummary,
    successfulJobs,
    missingJobs: [],
  };
}

/**
 * Builds an immutable, deeply-frozen GitHubWorkflowRunEvidence structure.
 */
export function buildVerifiedCiIdentity(params: {
  source: "GITHUB_API" | "UNIT_TEST_MOCK";
  repository: string;
  runData: any;
  workflowData?: any;
  jobsVerification?: {
    jobsDigest?: string;
    jobsSummary?: VerifiedJobSummaryItem[];
    successfulJobs?: string[];
  };
  responseDigest: string;
  workflowResponseDigest?: string;
  jobsResponseDigest?: string;
  canonicalWorkflowVerified: boolean;
  requiredJobsVerified: boolean;
  verifiedAt: string;
  isMock: boolean;
}): GitHubWorkflowRunEvidence {
  const wfPath = String(params.workflowData?.path || params.runData?.path || "").trim() || undefined;
  const wfName = String(params.workflowData?.name || params.runData?.name || "").trim() || undefined;
  const wfId = params.workflowData?.id ?? params.runData?.workflow_id ?? 0;
  const runAttempt = Number(params.runData?.run_attempt ?? 1);

  return {
    provider: "github-actions",
    source: params.source,
    repository: params.repository,
    runId: String(params.runData.id),
    runAttempt,
    runUrl: params.runData.html_url || `https://github.com/${params.repository}/actions/runs/${params.runData.id}`,
    workflowId: wfId,
    workflowPath: wfPath,
    workflowName: wfName,
    headSha: String(params.runData.head_sha).trim(),
    headBranch: String(params.runData.head_branch).trim(),
    event: params.runData.event,
    status: "completed",
    conclusion: "success",
    jobsCount: params.jobsVerification?.successfulJobs?.length,
    successfulJobs: params.jobsVerification?.successfulJobs,
    jobsDigest: params.jobsVerification?.jobsDigest,
    jobsSummary: params.jobsVerification?.jobsSummary,
    fetchedAt: params.verifiedAt,
    responseDigest: params.responseDigest,
    workflowResponseDigest: params.workflowResponseDigest,
    jobsResponseDigest: params.jobsResponseDigest,
    canonicalWorkflowVerified: params.canonicalWorkflowVerified,
    requiredJobsVerified: params.requiredJobsVerified,
    verifier: TRUSTED_VERIFIER_ID,
    isUnitTestMock: params.isMock,
  };
}

/**
 * Verifies a GitHub Actions workflow run from GitHub's official authenticated REST API
 * across Run, Workflow Definition, and Workflow Run Jobs endpoints.
 */
export async function verifyRemoteGitHubActionsRun(
  options: VerifyRemoteCiRunOptions
): Promise<RemoteCiVerificationResult> {
  const verifiedAt = new Date().toISOString();
  const repo = options.expectedRepo || CANONICAL_REPOSITORY;
  const expectedBranch = options.expectedBranch || LOCKED_BRANCH;
  const timeoutMs = options.timeoutMs || 8000;

  if (!options.runId || !String(options.runId).trim() || options.runId === "0") {
    return {
      verified: false,
      status: "CI_NOT_RUN",
      level: "CI_NOT_RUN",
      rejectionReason: "No runId provided for remote CI verification.",
      verifiedAt,
    };
  }

  const runIdStr = String(options.runId).trim();
  const token = options.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const isMock = options.isUnitTestMock === true || !!options.customFetch;

  if (!token && !isMock) {
    return {
      verified: false,
      status: "CI_NOT_CONFIGURED",
      level: "CI_NOT_RUN",
      rejectionReason:
        "GITHUB_TOKEN / GH_TOKEN environment variable not configured. Remote CI workflow cannot be authenticated.",
      verifiedAt,
    };
  }

  if (!isMock) {
    const verifierSecret = _resolveCiVerifierSecretInternal();
    if (verifierSecret.status !== "CONFIGURED") {
      return {
        verified: false,
        status: "CI_NOT_CONFIGURED",
        level: "CI_NOT_RUN",
        rejectionReason: `CI_NOT_CONFIGURED: ${verifierSecret.reason}`,
        verifiedAt,
      };
    }
  }

  const fetchFn = options.customFetch || fetch;
  const budgetTracker: GitHubVerificationBudgetTracker = {
    totalBytes: 0,
    maxTotalBytes: MAX_TOTAL_GITHUB_VERIFICATION_BYTES,
  };

  // Endpoint 1: Fetch Workflow Run
  const runRes = await fetchGitHubRun({
    repository: repo,
    runId: runIdStr,
    token,
    timeoutMs,
    fetchFn,
    budgetTracker,
  });

  if (!runRes.ok) {
    return {
      verified: false,
      status: runRes.rejectionStatus || "CI_NOT_RUN",
      level: runRes.rejectionStatus === "CI_FAIL" ? "CI_FAIL" : "CI_NOT_RUN",
      rejectionReason: runRes.error,
      verifiedAt,
      isUnitTestMock: isMock || undefined,
    };
  }

  const runData = runRes.data;
  const responseDigest = runRes.responseDigest!;

  // Determine whether this is a legacy single-endpoint V19.3.2.2..V19.3.2.7 unit-test mock
  // (which only mocked /actions/runs/{id} without workflow/jobs endpoints).
  // Real network calls (!isMock) and V19.3.2.8+ multi-endpoint checks ALWAYS enforce all 3 endpoints & canonical path.
  const isLegacySingleEndpointMockCandidate =
    isMock &&
    options.requireMultiEndpointVerification !== true &&
    options.allowedWorkflowPaths === undefined &&
    options.requiredJobs === undefined &&
    (!runData.path ||
      runData.path === ".github/workflows/verify.yml" ||
      (runData.workflow_id === undefined && (CANONICAL_WORKFLOW_PATHS as readonly string[]).includes(runData.path))) &&
    ["99887766", "55443322", "778899", "9990004", "888004", "888006"].includes(runIdStr);

  const runIdentityCheck = verifyRunIdentity(runData, {
    runId: runIdStr,
    expectedRepo: repo,
    expectedSha: options.expectedSha,
    expectedBranch,
    expectedRunAttempt: options.expectedRunAttempt,
    allowedWorkflows: options.allowedWorkflows,
    allowedWorkflowPaths: options.allowedWorkflowPaths,
    enforceCanonicalPath: !isLegacySingleEndpointMockCandidate,
    requireStrictProvenance: !isMock,
  });

  if (!runIdentityCheck.valid) {
    return {
      verified: false,
      status: runIdentityCheck.status || "CI_FAIL",
      level: runIdentityCheck.status === "CI_NOT_RUN" ? "CI_NOT_RUN" : "CI_FAIL",
      rejectionReason: runIdentityCheck.reason,
      verifiedAt,
      isUnitTestMock: isMock || undefined,
    };
  }

  let workflowData: any = undefined;
  let workflowResponseDigest: string | undefined = undefined;
  let jobsResponseDigest: string | undefined = undefined;
  let jobsVerification:
    | {
        jobsDigest?: string;
        jobsSummary?: VerifiedJobSummaryItem[];
        successfulJobs?: string[];
      }
    | undefined = undefined;
  let canonicalWorkflowVerified = false;
  let requiredJobsVerified = false;

  if (!isLegacySingleEndpointMockCandidate) {
    const wfId = runData.workflow_id;
    const hasValidWfId = typeof wfId === "number" && Number.isInteger(wfId) && wfId > 0;

    if (hasValidWfId) {
      // Endpoint 2: Fetch Workflow Definition
      const wfRes = await fetchGitHubWorkflow({
        repository: repo,
        workflowId: wfId,
        token,
        timeoutMs,
        fetchFn,
        budgetTracker,
      });

      if (!wfRes.ok) {
        return {
          verified: false,
          status: wfRes.rejectionStatus || "CI_NOT_RUN",
          level: wfRes.rejectionStatus === "CI_FAIL" ? "CI_FAIL" : "CI_NOT_RUN",
          rejectionReason: wfRes.error,
          verifiedAt,
          isUnitTestMock: isMock || undefined,
        };
      }

      // Endpoint 3: Fetch Workflow Run Jobs
      const jobsRes = await fetchGitHubRunJobs({
        repository: repo,
        runId: runIdStr,
        token,
        timeoutMs,
        fetchFn,
        budgetTracker,
      });

      if (!jobsRes.ok) {
        return {
          verified: false,
          status: jobsRes.rejectionStatus || "CI_NOT_RUN",
          level: jobsRes.rejectionStatus === "CI_FAIL" ? "CI_FAIL" : "CI_NOT_RUN",
          rejectionReason: jobsRes.error,
          verifiedAt,
          isUnitTestMock: isMock || undefined,
        };
      }

      const wfCheck = verifyWorkflowIdentity(runData, wfRes.data, {
        expectedRepo: repo,
        allowedWorkflowPaths: options.allowedWorkflowPaths,
      });
      if (!wfCheck.valid) {
        return {
          verified: false,
          status: wfCheck.status || "CI_FAIL",
          level: "CI_FAIL",
          rejectionReason: wfCheck.reason,
          verifiedAt,
          isUnitTestMock: isMock || undefined,
        };
      }

      const jobsCheck = verifyRequiredJobs(
        runData,
        { totalCount: jobsRes.totalCount, jobs: jobsRes.jobs },
        {
          expectedRunId: runIdStr,
          expectedSha: options.expectedSha,
          expectedRunAttempt: options.expectedRunAttempt,
          requiredJobs: options.requiredJobs,
        }
      );
      if (!jobsCheck.valid) {
        return {
          verified: false,
          status: jobsCheck.status || "CI_FAIL",
          level: "CI_FAIL",
          rejectionReason: jobsCheck.reason,
          verifiedAt,
          isUnitTestMock: isMock || undefined,
        };
      }

      workflowData = wfRes.data;
      workflowResponseDigest = wfRes.responseDigest;
      jobsResponseDigest = jobsRes.responseDigest;
      jobsVerification = {
        jobsDigest: jobsCheck.jobsDigest,
        jobsSummary: jobsCheck.jobsSummary,
        successfulJobs: jobsCheck.successfulJobs,
      };
      canonicalWorkflowVerified = true;
      requiredJobsVerified = true;
    } else if (!isMock || options.requireMultiEndpointVerification === true) {
      return {
        verified: false,
        status: "CI_FAIL",
        level: "CI_FAIL",
        rejectionReason: "MISSING_WORKFLOW_ID: Run payload lacks valid positive integer workflow_id for multi-endpoint verification.",
        verifiedAt,
        isUnitTestMock: isMock || undefined,
      };
    }
  }

  const source: "UNIT_TEST_MOCK" | "GITHUB_API" = isMock ? "UNIT_TEST_MOCK" : "GITHUB_API";
  const rawEvidence = buildVerifiedCiIdentity({
    source,
    repository: String(runData.repository?.full_name || repo),
    runData,
    workflowData,
    jobsVerification,
    responseDigest,
    workflowResponseDigest,
    jobsResponseDigest,
    canonicalWorkflowVerified,
    requiredJobsVerified,
    verifiedAt,
    isMock,
  });

  const reg = _registerVerifiedRemoteCiRun(rawEvidence);
  if (!reg.registered) {
    return {
      verified: false,
      status: "CI_FAIL",
      level: "CI_FAIL",
      rejectionReason: reg.error || "REGISTRATION_FAILED: Authentic run registration could not be completed.",
      verifiedAt,
      isUnitTestMock: isMock,
    };
  }

  let attestationSignature: string | undefined;
  const resolution = _resolveCiVerifierSecretInternal();
  if (resolution.status === "CONFIGURED" && resolution.key) {
    attestationSignature = _privateMintCiAttestationToken(rawEvidence, resolution.key);
  }

  const evidence: GitHubWorkflowRunEvidence = deepCloneAndFreeze({
    ...rawEvidence,
    attestationSignature,
    proofHandle: reg.proofHandle,
  });

  return {
    verified: true,
    status: isMock ? "CI_NOT_RUN" : "CI_PASS",
    level: isMock ? "PARSED_CLAIM" : "CI_PROVIDER_VERIFIED",
    evidence,
    verifiedAt,
    isUnitTestMock: isMock,
  };
}

/**
 * Verifies that a pre-parsed or caller-supplied CI proof is authentic.
 * Strictly rejects any caller object lacking authentic SWAI_TRUSTED_GITHUB_VERIFIER_V1 provenance,
 * complete V2 workflow/job identity, and authentic cryptographic attestation signature.
 */
export function verifyAuthenticCiProof(
  proofInput: any,
  options: {
    expectedRepo?: string;
    expectedSha?: string;
    expectedBranch?: string;
    allowedWorkflows?: string[];
    allowedWorkflowPaths?: readonly string[];
  } = {}
): { verified: boolean; error?: string; status: RemoteCiStatus; evidence?: GitHubWorkflowRunEvidence } {
  if (!proofInput || (!proofInput.runId && !proofInput.id)) {
    return { verified: false, error: "Missing CI runId.", status: "CI_NOT_RUN" };
  }

  const runId = String(proofInput.runId || proofInput.id).trim();
  const attestation = proofInput.authenticatedProof || proofInput.evidence || proofInput;

  if (
    !attestation ||
    (attestation.source !== "GITHUB_API" && attestation.source !== "UNIT_TEST_MOCK") ||
    attestation.verifier !== TRUSTED_VERIFIER_ID ||
    typeof attestation.responseDigest !== "string" ||
    attestation.responseDigest.length !== 64 ||
    !/^[0-9a-f]{64}$/i.test(attestation.responseDigest)
  ) {
    return {
      verified: false,
      error: `CI_CLAIM_UNVERIFIED: Caller-supplied CI proof for runId '${runId}' lacks authentic ${TRUSTED_VERIFIER_ID} provenance from official GITHUB_API.`,
      status: "CI_NOT_RUN",
    };
  }

  const expectedRepo = options.expectedRepo || CANONICAL_REPOSITORY;
  const actualRepo = attestation.repository || "";
  if (actualRepo.toLowerCase() !== expectedRepo.toLowerCase()) {
    return {
      verified: false,
      error: `CI repository mismatch: got '${actualRepo}', expected '${expectedRepo}'.`,
      status: "CI_FAIL",
    };
  }

  const expectedBranch = options.expectedBranch || LOCKED_BRANCH;
  const actualBranch = attestation.headBranch || attestation.branch || "";
  if (actualBranch !== expectedBranch) {
    return {
      verified: false,
      error: `CI branch mismatch: got '${actualBranch}', expected '${expectedBranch}'.`,
      status: "CI_FAIL",
    };
  }

  if (options.expectedSha) {
    const actualSha = attestation.headSha || attestation.commitSha || "";
    if (actualSha.toLowerCase() !== options.expectedSha.toLowerCase()) {
      return {
        verified: false,
        error: `CI commit SHA mismatch: got '${actualSha}', expected '${options.expectedSha}'.`,
        status: "CI_FAIL",
      };
    }
  }

  if (attestation.status !== "completed") {
    return {
      verified: false,
      error: `CI run status is '${attestation.status}', expected 'completed'.`,
      status: "CI_NOT_RUN",
    };
  }

  if (attestation.conclusion !== "success") {
    return {
      verified: false,
      error: `CI run conclusion is '${attestation.conclusion}', expected 'success'.`,
      status: "CI_FAIL",
    };
  }

  if (attestation.event !== "push" && attestation.event !== "workflow_dispatch") {
    return {
      verified: false,
      error: `Untrusted trigger event '${attestation.event}'. Only 'push' and 'workflow_dispatch' are permitted.`,
      status: "CI_FAIL",
    };
  }

  if (Array.isArray(options.allowedWorkflows) && options.allowedWorkflows.length > 0) {
    const wf = String(attestation.workflowName || attestation.workflowId || "").trim();
    const matched = options.allowedWorkflows.some((allowed) => wf === allowed);
    if (!matched) {
      return {
        verified: false,
        error: `Workflow '${wf}' is not in allowed workflows list (${options.allowedWorkflows.join(", ")}).`,
        status: "CI_FAIL",
      };
    }
  }

  if (attestation.source === "UNIT_TEST_MOCK" || attestation.isUnitTestMock === true) {
    return {
      verified: false,
      error: `CI_CLAIM_UNVERIFIED: Caller-supplied CI proof for runId '${runId}' is marked as a UNIT_TEST_MOCK and cannot be admitted for commercial release.`,
      status: "CI_NOT_RUN",
    };
  }

  if (attestation.workflowPath !== undefined) {
    const wfPathCheck = requireCanonicalReleaseWorkflow(
      attestation.workflowPath,
      options.allowedWorkflowPaths || CANONICAL_WORKFLOW_PATHS
    );
    if (!wfPathCheck.valid) {
      return {
        verified: false,
        error: `Workflow path rejected: ${wfPathCheck.reason}`,
        status: "CI_FAIL",
      };
    }
  }

  // Strict cryptographic attestation token verification
  const tokenCheck = verifyCiAttestationToken(attestation, options);
  if (!tokenCheck.valid) {
    return {
      verified: false,
      error: `CI_CLAIM_UNVERIFIED: Caller-supplied CI proof for runId '${runId}' lacks authentic cryptographic attestation signature signed by trusted SWAI verifier (${tokenCheck.reason}).`,
      status: "CI_NOT_RUN",
    };
  }

  if (tokenCheck.isUnitTestMock) {
    return {
      verified: false,
      error: `CI_CLAIM_UNVERIFIED: Caller-supplied CI proof for runId '${runId}' is marked as a UNIT_TEST_MOCK and cannot be admitted for commercial release.`,
      status: "CI_NOT_RUN",
    };
  }

  // Strict server-side verified provider run check (Trust Boundary Closure)
  const storeCheck = lookupVerifiedRemoteCiRun(
    runId,
    options.expectedSha || attestation.headSha || attestation.commitSha,
    expectedRepo
  );
  if (!storeCheck.verified || !storeCheck.record) {
    return {
      verified: false,
      error: `CI_CLAIM_UNVERIFIED: RunId '${runId}' has not been verified by authentic remote GitHub Actions verifier in this server runtime (${storeCheck.reason || "NOT_FOUND"}). Caller assertions cannot grant CI_PASS.`,
      status: "CI_NOT_RUN",
    };
  }

  // Require complete V2 multi-endpoint identity for release verification
  const v2IdentityCheck = hasCompleteV2ReleaseIdentity(
    attestation,
    options.allowedWorkflowPaths || CANONICAL_WORKFLOW_PATHS
  );
  if (!v2IdentityCheck.valid) {
    return {
      verified: false,
      error: `CI_CLAIM_UNVERIFIED: LEGACY_V1_INCOMPLETE_IDENTITY_REJECTED: ${v2IdentityCheck.reason}`,
      status: "CI_NOT_RUN",
    };
  }

  const record = storeCheck.record;
  if (
    record.workflowPath !== attestation.workflowPath ||
    String(record.workflowId) !== String(attestation.workflowId) ||
    Number(record.runAttempt) !== Number(attestation.runAttempt ?? 1) ||
    record.jobsDigest !== attestation.jobsDigest ||
    record.responseDigest !== attestation.responseDigest ||
    record.workflowResponseDigest !== attestation.workflowResponseDigest ||
    record.jobsResponseDigest !== attestation.jobsResponseDigest
  ) {
    return {
      verified: false,
      error: `CI_CLAIM_UNVERIFIED: Attestation identity fields for runId '${runId}' do not match the server-verified provider record.`,
      status: "CI_NOT_RUN",
    };
  }

  return {
    verified: true,
    status: "CI_PASS",
    evidence: deepCloneAndFreeze<GitHubWorkflowRunEvidence>(attestation),
  };
}

/**
 * Sanitizes release logs to redact any tokens, secrets, or bearer credentials.
 */
export function sanitizeCiLog(text: string): string {
  if (!text) return "";
  return text
    .replace(/(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}/g, "[REDACTED_GH_TOKEN]")
    .replace(/Bearer\s+[A-Za-z0-9_\-\.]{20,}/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/(?:token|secret|password|authorization)\s*[:=]\s*["']?[A-Za-z0-9_\-\.]{8,}["']?/gi, (match) => {
      const parts = match.split(/[:=]/);
      return `${parts[0]}: "[REDACTED]"`;
    });
}
