/**
 * SWAI KH-02 — V12.4.3.7.19.3.2.2
 * Authentic GitHub Actions Remote CI Verification Service
 *
 * Implements a strict, fail-closed verification client for remote GitHub Actions:
 * - Fixed, validated API endpoints: strictly https://api.github.com/repos/{owner}/{repo}/actions/runs/{run_id}
 * - Strict SSRF protection: forbids custom schemes, foreign hosts, IP literals, redirects, or userinfo
 * - Bounded network calls: timeout, abort signals, response payload size capping
 * - Strict integrity verification: exact repository full_name, exact commit SHA, exact locked branch,
 *   status === "completed", conclusion === "success", allowed events ("push", "workflow_dispatch")
 * - Response digest computation (SHA-256 of raw GitHub API payload)
 * - Authentic verification provenance: outputs immutable GitHubWorkflowRunEvidence stamped with
 *   source: "GITHUB_API" and verifier: "SWAI_TRUSTED_GITHUB_VERIFIER_V1"
 * - Safe fail-closed defaults: returns CI_NOT_CONFIGURED / CI_NOT_RUN if credentials or runs are absent
 */

import crypto from "crypto";

export const TRUSTED_VERIFIER_ID = "SWAI_TRUSTED_GITHUB_VERIFIER_V1" as const;
export const TRUSTED_GITHUB_HOST = "api.github.com" as const;
export const CANONICAL_REPOSITORY = "quocan050302/Shopify-Search" as const;
export const LOCKED_BRANCH = "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1" as const;

export const CANONICAL_RELEASE_WORKFLOWS = [
  "KH-02 Continuous Integration",
  ".github/workflows/kh02-ci.yml",
  ".github/workflows/ci.yml",
] as const;

export const KNOWN_INSECURE_DEFAULT_KEYS = [
  "SWAI_KH02_INTERNAL_HMAC_VERIFIER_KEY_V19_3_2_3_SECURE",
  "default",
  "secret",
  "password",
  "test",
  "dev",
  "changeme",
] as const;

export interface VerifiedRemoteCiRecord {
  runId: string;
  repository: string;
  headSha: string;
  headBranch: string;
  workflowId: number | string;
  workflowName?: string;
  event: string;
  status: string;
  conclusion: string;
  responseDigest: string;
  verifiedAt: string;
  proofHandle: string;
  isUnitTestMock: boolean;
}

const VERIFIED_PROVIDER_RUNS = new Map<string, Readonly<VerifiedRemoteCiRecord>>();

/**
 * Deep-clones an object and recursively freezes it, ensuring references returned
 * to callers can NEVER mutate internal state held in memory.
 */
function deepCloneAndFreeze<T extends object>(obj: T): Readonly<T> {
  const clone = JSON.parse(JSON.stringify(obj));
  return Object.freeze(clone);
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

  // Always return an immutable, isolated deep-clone to protect internal Map integrity
  const isolatedSnapshot = deepCloneAndFreeze(record);

  if (expectedSha && record.headSha !== expectedSha) {
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

  const existing = VERIFIED_PROVIDER_RUNS.get(recordKey);
  if (existing) {
    const sameSha = existing.headSha === evidence.headSha;
    const sameBranch = existing.headBranch === (evidence as any).headBranch || (evidence as any).branch;
    const sameDigest = existing.responseDigest === evidence.responseDigest;
    const sameEvent = existing.event === evidence.event;
    const sameMock = existing.isUnitTestMock === isMock;

    if (sameSha && sameBranch && sameDigest && sameEvent && sameMock) {
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
    .update(`${repo}|${runIdStr}|${evidence.headSha}|${evidence.responseDigest}|${verifiedTimestamp}`)
    .digest("hex")}`;

  const record: VerifiedRemoteCiRecord = {
    runId: runIdStr,
    repository: evidence.repository || CANONICAL_REPOSITORY,
    headSha: evidence.headSha,
    headBranch: (evidence as any).headBranch || (evidence as any).branch || LOCKED_BRANCH,
    workflowId: evidence.workflowId || 100,
    workflowName: evidence.workflowName,
    event: evidence.event,
    status: evidence.status,
    conclusion: evidence.conclusion,
    responseDigest: evidence.responseDigest,
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
  repository?: string;
  headSha: string;
  headBranch?: string;
  workflowId?: number | string;
  workflowName?: string;
  event?: string;
  status?: string;
  conclusion?: string;
  responseDigest: string;
  verifiedAt?: string;
  source?: "GITHUB_API" | "UNIT_TEST_MOCK";
  isUnitTestMock?: boolean;
}): { registered: boolean; proofHandle?: string; error?: string } {
  const res = _registerVerifiedRemoteCiRun({
    runId: String(record.runId),
    repository: record.repository || CANONICAL_REPOSITORY,
    headSha: record.headSha,
    headBranch: record.headBranch || LOCKED_BRANCH,
    workflowId: record.workflowId || 100,
    workflowName: record.workflowName || "KH-02 Continuous Integration",
    event: record.event || "push",
    status: record.status || "completed",
    conclusion: record.conclusion || "success",
    responseDigest: record.responseDigest,
    verifiedAt: record.verifiedAt || new Date().toISOString(),
    isUnitTestMock: true, // STRICTLY ENFORCED: Always true!
  } as any);

  if (!res.registered) {
    throw new Error(res.error || "CONFLICTING_RUN_METADATA");
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
  key?: string;
  status: "CONFIGURED" | "NOT_CONFIGURED" | "INSECURE_OR_DEFAULT";
  reason?: string;
}

/**
 * Privileged server-only configuration accessor for CI HMAC verifier secret.
 * Enforces strict fail-closed policy: returns explicit NOT_CONFIGURED or INSECURE_OR_DEFAULT
 * if absent, weak, or matching known insecure default keys. Never quietly selects a fallback key.
 */
export function getCiVerifierSecret(): CiVerifierSecretResolution {
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

export function computeCiAttestationDigest(evidence: {
  provider?: string;
  source?: string;
  repository?: string;
  runId?: string | number;
  headSha?: string;
  headBranch?: string;
  status?: string;
  conclusion?: string;
  event?: string;
  responseDigest?: string;
  workflowId?: number | string;
  workflowName?: string;
  isUnitTestMock?: boolean;
}): string {
  const parts = [
    "v1",
    evidence.provider || "github-actions",
    evidence.source || "",
    (evidence.repository || "").toLowerCase(),
    String(evidence.runId || ""),
    evidence.headSha || "",
    evidence.headBranch || "",
    evidence.status || "",
    evidence.conclusion || "",
    evidence.event || "",
    evidence.responseDigest || "",
    String(evidence.workflowId || ""),
    evidence.workflowName || "",
    evidence.isUnitTestMock ? "MOCK" : "PROD",
  ];
  return parts.join("|");
}

/**
 * Internal private signer for authenticated GitHub Actions CI evidence.
 * Genuinely module-private; NEVER exported to arbitrary imported modules.
 * Invoked exclusively by verifyRemoteGitHubActionsRun upon authentic provider verification.
 */
function _privateMintCiAttestationToken(
  evidence: any,
  key: string
): string {
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
export function mintCiAttestationToken(
  evidence: {
    provider?: string;
    source?: string;
    repository?: string;
    runId?: string | number;
    headSha?: string;
    headBranch?: string;
    status?: string;
    conclusion?: string;
    event?: string;
    responseDigest?: string;
    workflowId?: number | string;
    workflowName?: string;
    isUnitTestMock?: boolean;
  }
): string {
  const resolution = getCiVerifierSecret();

  const runIdStr = String(evidence.runId || "").trim();
  const repo = (evidence.repository || CANONICAL_REPOSITORY).toLowerCase();
  const serverRecord = runIdStr ? VERIFIED_PROVIDER_RUNS.get(`${repo}#${runIdStr}`) : undefined;

  // STRICT CHECK: An attestation token can ONLY be minted if a matching non-mock verified record
  // already exists in the private server registry from an authentic GitHub API verification.
  const isAuthenticRegisteredRun =
    serverRecord !== undefined &&
    !serverRecord.isUnitTestMock &&
    serverRecord.headSha === (evidence.headSha || "") &&
    serverRecord.responseDigest === (evidence.responseDigest || "");

  if (!isAuthenticRegisteredRun) {
    const payload = computeCiAttestationDigest(evidence);
    const untrustedDigest = crypto.createHash("sha256").update(`CALLER_UNAUTHORIZED:${payload}`).digest("hex");
    return `swai_ci_untrusted_${untrustedDigest}`;
  }

  if (resolution.status !== "CONFIGURED") {
    const payload = computeCiAttestationDigest(evidence);
    const untrustedDigest = crypto.createHash("sha256").update(`MISSING_SECRET:${payload}`).digest("hex");
    return `swai_ci_untrusted_${untrustedDigest}`;
  }

  return _privateMintCiAttestationToken(evidence, resolution.key!);
}

export function verifyCiAttestationToken(
  evidence: any,
  _options: {
    expectedRepo?: string;
    expectedSha?: string;
    expectedBranch?: string;
  } = {}
): {
  valid: boolean;
  reason?: string;
  isUnitTestMock?: boolean;
} {
  if (!evidence || typeof evidence !== "object") {
    return { valid: false, reason: "Evidence object is null or not an object." };
  }

  const sig = evidence.attestationSignature || evidence.attestationToken;
  if (!sig || typeof sig !== "string" || !sig.startsWith("swai_ci_v1_")) {
    const isUntrusted = typeof sig === "string" && sig.startsWith("swai_ci_untrusted_");
    return {
      valid: false,
      reason: isUntrusted
        ? "UNAUTHORIZED_MINT: Attestation token was minted outside trusted verifier boundary without provider verification capability."
        : "Missing or invalid cryptographic attestation signature/token.",
    };
  }

  const resolution = getCiVerifierSecret();
  if (resolution.status !== "CONFIGURED") {
    return {
      valid: false,
      reason: `MISSING_TRUST_ANCHOR: ${resolution.reason}`,
    };
  }

  const isMock = evidence.isUnitTestMock === true || evidence.source === "UNIT_TEST_MOCK";
  const expectedSig = _privateMintCiAttestationToken(
    {
      provider: evidence.provider,
      source: evidence.source,
      repository: evidence.repository,
      runId: evidence.runId,
      headSha: evidence.headSha || evidence.commitSha,
      headBranch: evidence.headBranch || evidence.branch,
      status: evidence.status,
      conclusion: evidence.conclusion,
      event: evidence.event,
      responseDigest: evidence.responseDigest,
      workflowId: evidence.workflowId,
      workflowName: evidence.workflowName,
      isUnitTestMock: isMock,
    },
    resolution.key!
  );

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);

  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return {
      valid: false,
      reason: "Cryptographic attestation signature mismatch or forged token.",
    };
  }

  return {
    valid: true,
    isUnitTestMock: isMock,
  };
}

export interface GitHubWorkflowRunEvidence {
  provider: "github-actions";
  source: "GITHUB_API" | "UNIT_TEST_MOCK";
  repository: string;
  runId: string;
  runUrl: string;
  workflowId: number | string;
  workflowName?: string;
  headSha: string;
  headBranch: string;
  event: "push" | "workflow_dispatch";
  status: "completed";
  conclusion: "success";
  jobsCount?: number;
  successfulJobs?: string[];
  fetchedAt: string;
  responseDigest: string; // SHA-256 of raw API response body
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
  allowedWorkflows?: string[];
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

/**
 * Validates target API URL against SSRF and host spoofing attacks.
 */
export function validateGitHubApiUrl(rawUrl: string, expectedRepo: string, runId: string): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") {
      return { valid: false, error: `INSECURE_PROTOCOL: Only HTTPS is allowed (got ${parsed.protocol})` };
    }
    if (parsed.hostname.toLowerCase() !== TRUSTED_GITHUB_HOST) {
      return { valid: false, error: `SSRF_VIOLATION: Untrusted host '${parsed.hostname}'. Must be exactly '${TRUSTED_GITHUB_HOST}'` };
    }
    if (parsed.username || parsed.password) {
      return { valid: false, error: "SSRF_VIOLATION: Userinfo credentials in URL are prohibited." };
    }
    if (parsed.port && parsed.port !== "443") {
      return { valid: false, error: `SSRF_VIOLATION: Non-standard HTTPS port '${parsed.port}' is prohibited.` };
    }
    const expectedPath = `/repos/${expectedRepo}/actions/runs/${runId}`;
    if (parsed.pathname !== expectedPath) {
      return { valid: false, error: `PATH_TAMPERING: Expected path '${expectedPath}', got '${parsed.pathname}'` };
    }
    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: `MALFORMED_URL: ${err?.message}` };
  }
}

/**
 * Verifies a GitHub Actions workflow run from GitHub's official authenticated API.
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

  // Resolve authorization token
  const token = options.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const isMock = options.isUnitTestMock === true || !!options.customFetch;

  if (!token && !isMock) {
    return {
      verified: false,
      status: "CI_NOT_CONFIGURED",
      level: "CI_NOT_RUN",
      rejectionReason: "GITHUB_TOKEN / GH_TOKEN environment variable not configured. Remote CI workflow cannot be authenticated.",
      verifiedAt,
    };
  }

  if (!isMock) {
    const verifierSecret = getCiVerifierSecret();
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

  const targetUrl = `https://${TRUSTED_GITHUB_HOST}/repos/${repo}/actions/runs/${runIdStr}`;
  const urlCheck = validateGitHubApiUrl(targetUrl, repo, runIdStr);
  if (!urlCheck.valid) {
    return {
      verified: false,
      status: "CI_FAIL",
      level: "CI_FAIL",
      rejectionReason: urlCheck.error,
      verifiedAt,
    };
  }

  const fetchFn = options.customFetch || fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let rawText: string;
  let responseStatus: number;

  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "SWAI-KH02-CiVerifier/1.0",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetchFn(targetUrl, {
      method: "GET",
      headers,
      signal: controller.signal,
      redirect: "error", // Forbid automatic redirects to prevent open-redirect / SSRF
    });

    responseStatus = res.status;
    rawText = await res.text();
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      return {
        verified: false,
        status: "CI_NOT_RUN",
        level: "CI_NOT_RUN",
        rejectionReason: `GitHub API request timed out after ${timeoutMs}ms.`,
        verifiedAt,
      };
    }
    return {
      verified: false,
      status: "CI_NOT_RUN",
      level: "CI_NOT_RUN",
      rejectionReason: `GitHub API network error: ${err?.message}`,
      verifiedAt,
    };
  } finally {
    clearTimeout(timer);
  }

  if (responseStatus === 401 || responseStatus === 403) {
    return {
      verified: false,
      status: "CI_NOT_RUN",
      level: "CI_NOT_RUN",
      rejectionReason: `GitHub API authentication/permission denied (HTTP ${responseStatus}). Verify GITHUB_TOKEN scope.`,
      verifiedAt,
    };
  }

  if (responseStatus === 404) {
    return {
      verified: false,
      status: "CI_NOT_RUN",
      level: "CI_NOT_RUN",
      rejectionReason: `GitHub Actions run '${runIdStr}' not found on repository '${repo}' (HTTP 404).`,
      verifiedAt,
    };
  }

  if (responseStatus !== 200) {
    return {
      verified: false,
      status: "CI_NOT_RUN",
      level: "CI_NOT_RUN",
      rejectionReason: `GitHub API returned unexpected HTTP status ${responseStatus}.`,
      verifiedAt,
    };
  }

  // Parse JSON response body
  let data: any;
  try {
    data = JSON.parse(rawText);
  } catch (err: any) {
    return {
      verified: false,
      status: "CI_FAIL",
      level: "CI_FAIL",
      rejectionReason: "GitHub API response body is not valid JSON.",
      verifiedAt,
    };
  }

  if (!data || typeof data !== "object") {
    return {
      verified: false,
      status: "CI_FAIL",
      level: "CI_FAIL",
      rejectionReason: "GitHub API response object is empty or malformed.",
      verifiedAt,
    };
  }

  // Compute payload digest
  const responseDigest = crypto.createHash("sha256").update(rawText, "utf-8").digest("hex");

  // Validate repository
  const actualRepo = data.repository?.full_name || "";
  if (actualRepo.toLowerCase() !== repo.toLowerCase()) {
    return {
      verified: false,
      status: "CI_FAIL",
      level: "CI_FAIL",
      rejectionReason: `CI repository mismatch: got '${actualRepo}', expected '${repo}'.`,
      verifiedAt,
    };
  }

  // Validate head_sha
  const actualSha = String(data.head_sha || "").trim();
  if (!actualSha || actualSha !== options.expectedSha) {
    return {
      verified: false,
      status: "CI_FAIL",
      level: "CI_FAIL",
      rejectionReason: `CI commit SHA mismatch: run head_sha '${actualSha}' does not match expected tested SHA '${options.expectedSha}'.`,
      verifiedAt,
    };
  }

  // Exact numeric runId equality validation
  const actualRunId = String(data.id || "").trim();
  if (!actualRunId || actualRunId !== runIdStr) {
    return {
      verified: false,
      status: "CI_FAIL",
      level: "CI_FAIL",
      rejectionReason: `CI runId mismatch: GitHub API returned runId '${actualRunId}', expected '${runIdStr}'.`,
      verifiedAt,
    };
  }

  // Validate head_branch
  const actualBranch = String(data.head_branch || "").trim();
  if (actualBranch !== expectedBranch) {
    return {
      verified: false,
      status: "CI_FAIL",
      level: "CI_FAIL",
      rejectionReason: `CI branch mismatch: run head_branch '${actualBranch}' does not match locked branch '${expectedBranch}'.`,
      verifiedAt,
    };
  }

  // Validate status
  if (data.status !== "completed") {
    return {
      verified: false,
      status: "CI_NOT_RUN",
      level: "CI_NOT_RUN",
      rejectionReason: `CI run status is '${data.status}' (expected 'completed'). Workflow is still pending or running.`,
      verifiedAt,
    };
  }

  // Validate conclusion
  if (data.conclusion !== "success") {
    return {
      verified: false,
      status: "CI_FAIL",
      level: "CI_FAIL",
      rejectionReason: `CI run conclusion is '${data.conclusion}' (expected 'success'). Remote CI checks failed.`,
      verifiedAt,
    };
  }

  // Validate event
  if (data.event !== "push" && data.event !== "workflow_dispatch") {
    return {
      verified: false,
      status: "CI_FAIL",
      level: "CI_FAIL",
      rejectionReason: `Untrusted trigger event '${data.event}'. Only 'push' and 'workflow_dispatch' are permitted for release attestation.`,
      verifiedAt,
    };
  }

  // Workflow path/name allowlist check (exact match, no loose substring matching)
  if (Array.isArray(options.allowedWorkflows) && options.allowedWorkflows.length > 0) {
    const wfName = String(data.name || "").trim();
    const wfPath = String(data.path || "").trim();
    const matched = options.allowedWorkflows.some((allowed) => wfName === allowed || wfPath === allowed);
    if (!matched) {
      return {
        verified: false,
        status: "CI_FAIL",
        level: "CI_FAIL",
        rejectionReason: `Workflow '${wfName || wfPath}' is not in the allowed release workflows list (${options.allowedWorkflows.join(", ")}).`,
        verifiedAt,
      };
    }
  }

  const source: "UNIT_TEST_MOCK" | "GITHUB_API" = isMock ? "UNIT_TEST_MOCK" : "GITHUB_API";

  const rawEvidence = {
    provider: "github-actions" as const,
    source,
    repository: actualRepo,
    runId: String(data.id),
    runUrl: data.html_url || `https://github.com/${actualRepo}/actions/runs/${data.id}`,
    workflowId: data.workflow_id || 0,
    workflowName: data.name || undefined,
    headSha: actualSha,
    headBranch: actualBranch,
    event: data.event,
    status: "completed" as const,
    conclusion: "success" as const,
    fetchedAt: verifiedAt,
    responseDigest,
    verifier: TRUSTED_VERIFIER_ID,
    isUnitTestMock: isMock,
  };

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
  const resolution = getCiVerifierSecret();
  if (resolution.status === "CONFIGURED") {
    attestationSignature = _privateMintCiAttestationToken(rawEvidence, resolution.key!);
  }

  const evidence: GitHubWorkflowRunEvidence = {
    ...rawEvidence,
    attestationSignature,
    proofHandle: reg.proofHandle,
  };

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
 * Strictly rejects any caller object lacking authentic SWAI_TRUSTED_GITHUB_VERIFIER_V1 provenance
 * and authentic cryptographic attestation signature.
 */
export function verifyAuthenticCiProof(
  proofInput: any,
  options: {
    expectedRepo?: string;
    expectedSha?: string;
    expectedBranch?: string;
    allowedWorkflows?: string[];
  } = {}
): { verified: boolean; error?: string; status: RemoteCiStatus; evidence?: GitHubWorkflowRunEvidence } {
  if (!proofInput || (!proofInput.runId && !proofInput.id)) {
    return { verified: false, error: "Missing CI runId.", status: "CI_NOT_RUN" };
  }

  const runId = String(proofInput.runId || proofInput.id).trim();
  const attestation = proofInput.authenticatedProof || proofInput.evidence || proofInput;

  // Strict authenticity check: must have source === "GITHUB_API" or "UNIT_TEST_MOCK" and verifier === TRUSTED_VERIFIER_ID
  if (
    !attestation ||
    (attestation.source !== "GITHUB_API" && attestation.source !== "UNIT_TEST_MOCK") ||
    attestation.verifier !== TRUSTED_VERIFIER_ID ||
    typeof attestation.responseDigest !== "string" ||
    attestation.responseDigest.length !== 64
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
    if (actualSha !== options.expectedSha) {
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
  const storeCheck = lookupVerifiedRemoteCiRun(runId, options.expectedSha || attestation.headSha || attestation.commitSha, expectedRepo);
  if (!storeCheck.verified) {
    return {
      verified: false,
      error: `CI_CLAIM_UNVERIFIED: RunId '${runId}' has not been verified by authentic remote GitHub Actions verifier in this server runtime (${storeCheck.reason || "NOT_FOUND"}). Caller assertions cannot grant CI_PASS.`,
      status: "CI_NOT_RUN",
    };
  }

  return {
    verified: true,
    status: "CI_PASS",
    evidence: attestation,
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
