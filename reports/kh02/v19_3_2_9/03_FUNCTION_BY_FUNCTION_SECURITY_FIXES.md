# KH-02 V12.4.3.7.19.3.2.9 — Function-by-Function Security & Runner Fixes

## 1. `src/services/kh02/release/githubActionsCiEvidence.ts`
1. **Single Canonical Workflow Whitelist (`CANONICAL_WORKFLOW_PATHS` & `requireCanonicalReleaseWorkflow`)**:
   - Narrowed `CANONICAL_WORKFLOW_PATHS` to `Object.freeze([".github/workflows/kh02-ci.yml"])` (removed non-existent `.github/workflows/ci.yml` and `.github/workflows/kh02-regression.yml`).
   - Enforced intersection semantics in `requireCanonicalReleaseWorkflow(workflowPath, allowedPaths)`: caller-supplied `allowedPaths` can only narrow the canonical whitelist and can never widen it to admit non-canonical workflows.
2. **Mandatory Baseline Required-Jobs Policy (`CANONICAL_REQUIRED_JOBS` & `verifyRequiredJobs`)**:
   - Defined `CANONICAL_REQUIRED_JOBS = Object.freeze(["typecheck", "kh02-unit", "kh02-integration", "kh01-regression", "security-negative", "backtest-policy"])`.
   - Fixed the V19.3.2.8 P1 defect where `const requiredJobs = options.requiredJobs || []` allowed callers omitting `requiredJobs` to pass with any single dummy/docs-only green job.
   - `verifyRequiredJobs` now computes `effectiveRequiredSet = CANONICAL_REQUIRED_JOBS ∪ callerRequiredJobs` and verifies that every mandatory job is present in `runData.run_attempt`, has `status === "completed"`, `conclusion === "success"`, non-empty `started_at`/`completed_at` (`completed_at >= started_at`), and has no failed steps (`steps[].conclusion` in `["failure", "cancelled", "timed_out", "action_required"]`).
3. **True Streaming Response Byte Reader (`readBoundedResponseBytes` & `executeBoundedGitHubGet`)**:
   - Replaced `await res.text()` with a Web-Streams `res.body.getReader()` loop that checks byte counts *before* appending chunks (`MAX_GITHUB_API_RESPONSE_BYTES = 2 MiB` per response, `MAX_TOTAL_VERIFICATION_BYTES = 6 MiB` cumulative across all 3 endpoints), immediately calling `reader.cancel()` and `controller.abort()` on overflow without retaining oversized buffers.
   - Checks HTTP status (`200` vs `401`/`403`/`404`/`429`/`5xx`) before reading full response bodies, and explicitly classifies `HTTP 429` or `HTTP 403` with `x-ratelimit-remaining: 0` as `RATE_LIMITED`.
4. **Pagination Integrity in `fetchGitHubRunJobs`**:
   - Enforces stable `total_count` across pages, rejects empty intermediate pages when `allJobs.length < totalCount`, rejects `allJobs.length !== totalCount` after final page, and rejects `total_count > maxPages * 100`.
5. **Secret Encapsulation (`_resolveCiVerifierSecretInternal` vs `getCiVerifierSecret`)**:
   - Made raw HMAC key resolution private to `githubActionsCiEvidence.ts`; public `getCiVerifierSecret()` returns `{ configured, source, key: undefined }` so external callers cannot extract the raw key to forge attestations.
6. **End-to-End Required-Jobs Enforcement in `_registerVerifiedRemoteCiRun`, `lookupVerifiedRemoteCiRun`, and `validateVerifiedCiAttestation`**:
   - `_registerVerifiedRemoteCiRun` rejects registration unless all `CANONICAL_REQUIRED_JOBS` are present in `jobsChecked` and `jobsMissing.length === 0`.
   - `lookupVerifiedRemoteCiRun` and `validateVerifiedCiAttestation` always verify the union of `CANONICAL_REQUIRED_JOBS` and any caller-requested jobs.

## 2. `src/services/kh02/demand/testSuiteEvidenceValidator.ts` & `src/services/kh02/release/releaseGateEvaluatorV19.ts`
- Both `validateCiRunBinding` and `evaluateReleaseEvidence` now pass the union of `CANONICAL_REQUIRED_JOBS` and any caller-provided `requiredJobs` into `validateVerifiedCiAttestation`.

## 3. `scripts/kh02/runV19_3_2_9Gates.ts`
- **Timeout Race Closure**: In `runSingleGate`, `if (timedOut)` is checked *before* exit code or `validateGateOutput`, unconditionally returning `status: "ABORTED_FAIL"`, `pass: false` even if the child process trapped `SIGTERM` and exited `0`.
- **Two-Way `CI_PASS` Invariant**: In `validateGateOutput` for `E10`/`E11`, enforces `status === "CI_PASS" <=> (ciProviderVerified === true && providerVerified === true)`.
- **Bounded Log Tail & Disk Flush Verification**: Uses `ByteTailRingBuffer` (64 KiB cap) + `sanitizeCiLog`, incremental SHA-256 hashing during stream writes, and post-close verification against disk file size and SHA-256 (`computeFileSha256Stream`).
- **Cross-Platform Resource Safety**: Supports Windows (`fs.statfsSync` + `os.freemem()`), Linux (`MemAvailable` from `/proc/meminfo` + cgroup v2 `memory.current`/`memory.max` + cgroup v1 `memory.usage_in_bytes`/`memory.limit_in_bytes`), and periodic 5s sampling during every gate.

## 4. CI Runner Portability Fixes (`scripts/kh02/setupCiEnvironmentV19_3_2_9.ts`, `scripts/kh02/runThreeSourceFreeMcpSmoke.ts`, `tests/e2e/helpers/startSwaiTestServer.ts`, `scripts/kh02/runKh02BrowserE2E.ts`)
- Added `scripts/kh02/setupCiEnvironmentV19_3_2_9.ts` to deterministically initialize `dev.db` and `prisma/dev.db` from `prisma/schema.sql` + canonical baseline seed rows on fresh CI checkouts (without overwriting existing local DBs) and bootstrap Python virtual environments (`services/meta-ads-collector/.venv` and `services/google-transparency/.venv`).
- Updated `tests/e2e/helpers/startSwaiTestServer.ts` to fall back to `development` mode (`next dev`) when `.next/BUILD_ID` is absent on fresh checkouts, and `scripts/kh02/runKh02BrowserE2E.ts` to pass `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage` on Linux runners.
