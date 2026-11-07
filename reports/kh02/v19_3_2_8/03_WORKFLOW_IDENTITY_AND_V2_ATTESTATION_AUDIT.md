# KH-02 V12.4.3.7.19.3.2.8 — Workflow Identity & V2 Attestation Security Audit

## 1. Three-Endpoint GitHub Actions REST Verification Contract

`verifyRemoteGitHubActionsRun` in `src/services/kh02/release/githubActionsCiEvidence.ts` executes a fail-closed three-endpoint verification sequence against `https://api.github.com`:

1. **Endpoint 1 — Workflow Run (`fetchGitHubRun`)**:
   - `GET https://api.github.com/repos/quocan050302/Shopify-Search/actions/runs/{run_id}`
   - Validates `id === run_id`, `repository.full_name === "quocan050302/Shopify-Search"`, `head_Repository.full_name === "quocan050302/Shopify-Search"` (rejects fork runs), `pull_requests.length === 0`, `head_branch === "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1"`, `head_sha === expectedSha`, `event in ["push", "workflow_dispatch"]`, `status === "completed"`, `conclusion === "success"`, positive integer `workflow_id`, and positive integer `run_attempt`.
2. **Endpoint 2 — Workflow Definition (`fetchGitHubWorkflow`)**:
   - `GET https://api.github.com/repos/quocan050302/Shopify-Search/actions/workflows/{workflow_id}`
   - Validates `workflow.id === run.workflow_id`, `workflow.state === "active"`, `workflow.name === run.name` (when both present), and `requireCanonicalReleaseWorkflow(workflow.path, allowedWorkflowPaths)` against `CANONICAL_WORKFLOW_PATHS = [".github/workflows/kh02-ci.yml", ".github/workflows/ci.yml"]`.
   - Display name (`workflowName`) alone is never accepted as proof of canonical workflow identity.
3. **Endpoint 3 — Workflow Run Jobs (`fetchGitHubRunJobs`)**:
   - `GET https://api.github.com/repos/quocan050302/Shopify-Search/actions/runs/{run_id}/jobs?filter=latest&per_page=100&page={page}`
   - Paginates up to `MAX_GITHUB_JOBS_PAGES = 5` and verifies `total_count >= 1`, `jobs.length >= total_count`, and for every job: `job.run_id === run.id`, `job.run_attempt === run.run_attempt`, `job.head_sha === expectedSha` (when present), `job.status === "completed"`, `job.conclusion === "success"`, and no failed/cancelled/timed_out/skipped steps.
   - Verifies all `requiredJobs` (when specified) are present in completed successful jobs and computes a deterministic SHA-256 `jobsDigest` over the sorted job summary array (`{ id, name, status, conclusion, runAttempt }`).

## 2. Versioned `SWAI_CI_ATTESTATION_V2` Cryptographic Digest

`computeCiAttestationDigest(evidence)` produces a delimiter-injection-proof JSON array tuple prefixed by `SWAI_CI_ATTESTATION_V2|`:

```ts
const canonicalTuple = [
  "v2",
  String(evidence.provider || "github-actions"),
  String(evidence.source || "GITHUB_API"),
  String(evidence.repository || CANONICAL_REPOSITORY).toLowerCase(),
  String(evidence.runId || ""),
  String(evidence.runAttempt ?? 1),
  String(evidence.headSha || ""),
  String(evidence.headBranch || ""),
  String(evidence.status || ""),
  String(evidence.conclusion || ""),
  String(evidence.event || ""),
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
```

### Post-Signing Mutation Resistance
- Any mutation to `workflowPath`, `workflowId`, `workflowName`, `runAttempt`, `jobsDigest`, `responseDigest`, `workflowResponseDigest`, `jobsResponseDigest`, `headSha`, `headBranch`, `runId`, or `isUnitTestMock` changes the `SWAI_CI_ATTESTATION_V2` payload and invalidates the HMAC-SHA256 signature verified via `crypto.timingSafeEqual`.
- Legacy V1 tokens or incomplete evidence objects missing `workflowId`, `workflowPath`, `runAttempt`, `jobsDigest`, `workflowResponseDigest`, or `jobsResponseDigest` fail `hasCompleteV2ReleaseIdentity` (`LEGACY_V1_INCOMPLETE_IDENTITY_REJECTED`).

## 3. Recursive Deep-Freeze Protection

All evidence objects returned by `verifyRemoteGitHubActionsRun` and `lookupVerifiedRemoteCiRun`, as well as all records stored in `VERIFIED_PROVIDER_RUNS`, are passed through `deepCloneAndFreeze`, which clones and recursively calls `Object.freeze` on every nested object and array (`jobsSummary`, `successfulJobs`, etc.).
