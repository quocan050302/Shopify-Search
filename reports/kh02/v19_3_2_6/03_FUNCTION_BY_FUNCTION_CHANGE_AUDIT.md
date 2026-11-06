# SWAI KH-02 — V12.4.3.7.19.3.2.6
## Function-by-Function Change Audit

### 1. `src/services/kh02/release/githubActionsCiEvidence.ts`

- **`TRUSTED_ORCHESTRATOR_CAPABILITY`**:
  - *Previous*: Exported `Symbol.for("swai.kh02.trusted_orchestrator")`.
  - *New*: **Removed completely**. No global or exported symbol can confer trusted caller status.

- **`_registerVerifiedRemoteCiRun`**:
  - *Previous*: Exported public function `registerVerifiedRemoteCiRun`.
  - *New*: Private, unexported function. Accessible exclusively within `githubActionsCiEvidence.ts`.

- **`_testOnlyRegisterVerifiedRemoteCiRun`**:
  - *Previous*: Exported test helper allowing caller to set `isUnitTestMock`.
  - *New*: Exported test helper that unconditionally enforces `isUnitTestMock: true`. Even if caller passes `isUnitTestMock: false`, the private registration function receives `true`.

- **`lookupVerifiedRemoteCiRun`**:
  - *Previous*: Mock check was performed before full parameter validation.
  - *New*: Reordered validations. Strict format checking (runId format, repo match, branch match, workflowPath match, headSha match, conclusion="success", status="completed", TTL within bounds) executes before mock classification.

- **`mintCiAttestationToken`**:
  - *Previous*: Minted authentic HMAC signature if capability or registry was present.
  - *New*: Verifies the runId against the private registry. If not registered or if metadata mismatches, returns an untrusted token prefixed with `swai_ci_untrusted_*` signed with fallback key.

- **`validateVerifiedCiAttestation` & `evaluateReleaseEvidence`**:
  - *Previous*: Could accept unquarantined mock tokens if registered via helper.
  - *New*: Explicitly rejects any token whose registry entry has `isUnitTestMock === true` with `RELEASE_EVALUATOR_REJECTED_MOCK_CI`.

---

### 2. `scripts/kh02/runV19_3_2_6Gates.ts`

- **`getAvailableMemoryBytes`**:
  - *Implementation*: Detects Darwin/macOS and executes `vm_stat` to compute real free memory (`(Pages free + Pages inactive) * pageSize`), avoiding false negatives from `os.freemem()` which excludes inactive page cache. Defaults to `os.freemem()` on other platforms.

- **`checkResourceSafety`**:
  - *Implementation*: Enforces minimum 1 GiB free disk space via `fs.statfs` and minimum 150 MB available RAM. Fails closed (`SAFE_CHECK_FAILED`) on any statfs error or resource exhaustion.

- **`TailRingBuffer`**:
  - *Implementation*: Ring buffer storing up to 100 log lines with a strict 50 MB cumulative byte cap. If log exceeds 50 MB, flags `TRUNCATED_FAIL` and terminates the child process.

- **`runSingleGate`**:
  - *Implementation*: Spawns gate commands with dedicated process groups (`detached: true`). Propagates termination signals to process group (`-child.pid`). Sanitizes Vitest concurrency by passing `VITEST_MAX_WORKERS: gate.id === "E5" ? "1" : "4"`.

- **`runAllGates`**:
  - *Implementation*: DAG executor with bounded concurrency (semaphore limit 2). Serializes SQLite-dependent gates (E5 -> E8 -> E9) to prevent database locking errors. Checks git worktree integrity before and after runs.

---

### 3. `scripts/kh02/runThreeSourceFreeMcpSmoke.ts`

- **`runThreeSourceFreeMcpSmoke`**:
  - *Implementation*: Verifies operational status of external data sources at strict $0.00 spend.
  - *Meta Ads*: Verifies token configuration. Marked `NOT_RUN_EXTERNAL_DEPENDENCY` ($0.00).
  - *Google Ads Transparency*: Tests local Python venv (`services/google-transparency/.venv/bin/python`) and fastmcp bridge script. Marked `VERIFIED_MCP_CONFIGURED` ($0.00).
  - *TikTok Organic*: Verifies HasData key. Marked `NOT_RUN_EXTERNAL_DEPENDENCY` ($0.00).
  - *TikTok Commercial Ads US*: Explicitly deferred by KH-02 policy. Marked `DEFERRED_DO_NOT_TEST` ($0.00).
  - *BigQuery*: Billing disabled. Marked `NOT_CONFIGURED_NO_BILLING` ($0.00).
  - *Google Trends*: Verifies absence of official >=60-day export. Marked `NOT_AVAILABLE_NO_OFFICIAL_EXPORT` ($0.00).

---

### 4. Unit Test Stabilizations

- **`tests/unit/kh02/v12_4_3_7_18_StrictCsvRowAuthority.test.ts`**:
  - *Change*: Switched temporary CSV cleanup from `afterEach` to `afterAll` to eliminate race conditions when vitest runs multiple test files sharing identical fixture content in parallel.

- **`tests/unit/kh02/v12_4_3_7_17_CsvRowBindingAndLineage.test.ts`**:
  - *Change*: Switched temporary CSV cleanup from `afterEach` to `afterAll` for identical cross-worker file isolation.
