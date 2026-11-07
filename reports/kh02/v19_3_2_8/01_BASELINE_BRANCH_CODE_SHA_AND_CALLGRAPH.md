# KH-02 V12.4.3.7.19.3.2.8 — Baseline Branch, Code SHA, and Call-Graph Audit

## 1. Repository & Locked Branch Provenance

- **Repository**: `quocan050302/Shopify-Search`
- **Locked Branch**: `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`
- **Observed Remote Baseline HEAD (`C0`)**: `0b2520dfb991b7bc191cff7abd1e6fb226616238`
- **Observed Remote Baseline Tree (`Tree(C0)`)**: `104ee6fd0d73b779201040b36cc23bd69d3fa8f4`
- **Prior V19.3.2.7 Tested Code Commit**: `63555f847761dc96fa39042706007022fae56e00`
- **V19.3.2.8 Tested Code Commit (`C1`)**: `16e6f1ca3ea5ab08d9b40afe89795c050e7545e3`
- **V19.3.2.8 Tested Tree SHA (`Tree(C1)`)**: `2f9adfbaf91ca986929d6972c8b6e800051215f6`

## 2. Exact Line-Numbered Pre-Fix Vulnerability Call-Graph

### 2.1 Single-Endpoint GitHub API Verification & Missing Workflow/Jobs Verification (`githubActionsCiEvidence.ts`)
- **Pre-fix behavior**: `verifyRemoteGitHubActionsRun` only fetched `GET https://api.github.com/repos/{owner}/{repo}/actions/runs/{run_id}` and never queried `GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}` or `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs?filter=latest&per_page=100&page={page}`.
- **V19.3.2.8 remediation**:
  - `validateGitHubApiUrl`, `validateGitHubWorkflowApiUrl`, and `validateGitHubRunJobsApiUrl` enforce strict HTTPS `api.github.com` path validation with `redirect: "error"` and `<= 2 MiB` payload limits (`src/services/kh02/release/githubActionsCiEvidence.ts:750-1003`).
  - `fetchGitHubRun`, `fetchGitHubWorkflow`, and `fetchGitHubRunJobs` (with bounded pagination up to `MAX_GITHUB_JOBS_PAGES = 5`) execute the three-endpoint verification flow (`src/services/kh02/release/githubActionsCiEvidence.ts:1008-1231`).
  - `verifyRunIdentity`, `verifyWorkflowIdentity`, and `verifyRequiredJobs` cross-verify `workflow_id`, canonical `workflowPath` (`CANONICAL_WORKFLOW_PATHS = [".github/workflows/kh02-ci.yml", ".github/workflows/ci.yml"]`), `run_attempt` consistency, `head_sha`, and required jobs completion (`src/services/kh02/release/githubActionsCiEvidence.ts:1236-1517`).

### 2.2 V1 Attestation Digest Omission & Workflow Path Spoofing Exploit (`githubActionsCiEvidence.ts` & `releaseGateEvaluatorV19.ts`)
- **Pre-fix vulnerability**:
  1. `computeCiAttestationDigest` in V19.3.2.7 omitted `workflowId`, `workflowPath`, `workflowName`, `runAttempt`, `jobsDigest`, `workflowResponseDigest`, and `jobsResponseDigest`.
  2. `evaluateReleaseEvidence` checked `CANONICAL_RELEASE_WORKFLOWS.some((w) => w === att.workflowName || w === att.workflowPath)` without verifying `att.workflowPath` against the signed HMAC digest or the server-side `VERIFIED_PROVIDER_RUNS` registry. An attacker or buggy caller could take a valid token from a non-canonical workflow (or spoof `workflowPath: ".github/workflows/kh02-ci.yml"` post-signing) and obtain `ciStatus: "CI_PASS"`.
- **V19.3.2.8 remediation**:
  - `computeCiAttestationDigest` (`src/services/kh02/release/githubActionsCiEvidence.ts:471-501`) uses versioned `SWAI_CI_ATTESTATION_V2` with JSON array framing binding all 20 identity fields (`provider`, `source`, `repository`, `runId`, `runAttempt`, `headSha`, `headBranch`, `status`, `conclusion`, `event`, `workflowId`, `workflowPath`, `workflowName`, `jobsDigest`, `responseDigest`, `workflowResponseDigest`, `jobsResponseDigest`, `verifier`, and `MOCK`/`PROD`).
  - `hasCompleteV2ReleaseIdentity` (`src/services/kh02/release/githubActionsCiEvidence.ts:507-549`) rejects any V1/incomplete attestation lacking positive integer `workflowId` and `runAttempt`, canonical `workflowPath`, or 64-hex `jobsDigest`, `responseDigest`, `workflowResponseDigest`, and `jobsResponseDigest`.
  - `evaluateReleaseEvidence` (`src/services/kh02/release/releaseGateEvaluatorV19.ts:290-335`) enforces `requireCanonicalReleaseWorkflow(att?.workflowPath)`, `verifyCiAttestationToken(..., { requireReleaseV2: true })`, `verifyAuthenticCiProof(...)`, and exact server-registry equality across `workflowPath`, `workflowId`, `runAttempt`, and `jobsDigest`.

### 2.3 Shallow `Object.freeze` on Registry Snapshots (`githubActionsCiEvidence.ts`)
- **Pre-fix behavior**: `deepCloneAndFreeze` used top-level `Object.freeze( JSON.parse(JSON.stringify(obj)) )`, leaving nested arrays/objects (such as `jobsSummary` or `successfulJobs`) mutable if added.
- **V19.3.2.8 remediation**: `deepFreezeRecursive` and `deepCloneAndFreeze` (`src/services/kh02/release/githubActionsCiEvidence.ts:86-104`) recursively freeze every nested object and array before storing in `VERIFIED_PROVIDER_RUNS` or returning from `lookupVerifiedRemoteCiRun` and `verifyRemoteGitHubActionsRun`.

### 2.4 Gate Runner E8/E9/E10 Output Validation (`scripts/kh02/runV19_3_2_8Gates.ts`)
- **Pre-fix behavior**: Gate output validation relied on substring checks rather than parsing balanced JSON and verifying exact SHA/schema fields.
- **V19.3.2.8 remediation**: `extractLastJsonObject` and `validateGateOutput` (`scripts/kh02/runV19_3_2_8Gates.ts:353-745`) parse balanced JSON from gate logs and enforce exact `testedCodeSha === expectedSha`, `policyScenarioVerdict === "PASS"`, `pointInTimeIntegrityVerdict === "PASS"`, `dbConnected === true`, `dbReadbackExecuted === true`, and `diagnosticExecuted === true` with `status === "CI_PASS"` iff `ciProviderVerified === true`.
