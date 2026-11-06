# SWAI KH-02 — V12.4.3.7.19.3.2.7
## Function-by-Function Change Audit

### 1. `src/services/kh02/release/githubActionsCiEvidence.ts`

- **`deepCloneAndFreeze`**:
  - *Added*: Recursively deep-clones objects and arrays, applying `Object.freeze` to every level.
  - *Impact*: Guarantees that references returned to callers cannot mutate state stored within the internal CI registry.

- **`_registerVerifiedRemoteCiRun`**:
  - *Modified*: Accepts record, computes opaque proof handle, applies `deepCloneAndFreeze(record)`, and stores frozen copy in `verifiedRemoteRuns` map.

- **`lookupVerifiedRemoteCiRun`**:
  - *Modified*: Validates format, repo, branch, workflowPath, conclusion, status, and TTL. Returns `proofHandle` and `deepCloneAndFreeze(record)`.
  - *Security Guarantee*: Callers receive an immutable snapshot. Mutating the returned record does not alter registry integrity.

- **`_privateMintCiAttestationToken`**:
  - *Modified*: Removed `export`. This function is now private to `githubActionsCiEvidence.ts` and cannot be invoked from other application modules or external callers.

- **`mintCiAttestationToken`**:
  - *Modified*: Signature changed from `(runId, evidence, testKey?)` to `(runId, evidence)`. Removed `testKey` argument entirely. Enforces that signing keys are strictly controlled by internal environment secrets.

- **`verifyRemoteGitHubActionsRun`**:
  - *Modified*: Added fail-closed check: if `!reg.registered`, immediately returns `{ verificationLevel: "CI_FAIL", authenticCiProof: null }`.

- **`verifyAuthenticCiProof`**:
  - *Modified*: When `allowedWorkflows` is provided, enforces exact equality (`allowed === evidence.workflowName || allowed === evidence.workflowPath`) instead of loose substring matching.

---

### 2. `src/services/kh02/release/releaseGateEvaluatorV19.ts`

- **`evaluateReleaseEvidence`**:
  - *Modified*: Enforces that authentic CI attestations must match exact entries in `CANONICAL_RELEASE_WORKFLOWS`:
    `CANONICAL_RELEASE_WORKFLOWS.some(w => w === att.workflowName || w === att.workflowPath)`.
  - *Impact*: Eliminates any risk of non-canonical or forged workflow paths passing the release gate.

---

### 3. `tests/setupTestEnvironment.ts`

- **`testMintCiAttestationToken`**:
  - *Added*: Isolated test fixture signer helper strictly confined to the test environment harness. Allows existing unit test mocks to generate test tokens with controlled keys without polluting production source exports.

---

### 4. `scripts/kh02/runThreeSourceFreeMcpSmoke.ts`

- **`runThreeSourceFreeMcpSmoke`**:
  - *Modified*: Integrates `createGoogleTransparencyMcpClient` from `src/services/kh02/transparency/googleTransparencyMcpClient.ts`.
  - *Protocol Verification*: Executes genuine local stdio FastMCP handshake: `connect()`, `listTools()`, `close()`.
  - *Cost & Policy Enforcement*: Verifies discovered tools (`search_advertiser`, `get_advertiser_ads`), records status as `PROTOCOL_HANDSHAKE_VERIFIED`, and strictly maintains `providerVerified: false` and `totalCostUsd: 0.00`.

---

### 5. `scripts/kh02/runV19_3_2_7Gates.ts`

- **`parseVitestSummary`**:
  - *Added*: Strips ANSI color escape sequences, matches the final `Tests` and `Test Files` summary line, and extracts counts including parenthesized totals like `(69)`.

- **`validateGateOutput`**:
  - *Added*: Enforces typed validation for all gates:
    - Vitest: arithmetic consistency (`passed + failed + skipped === total`), zero-test rejection, failed-test detection.
    - Gate E8 (Backtest): JSON output validation and summary banner check.
    - Gate E9 (Candidate DB Readback): JSON parsing, `dbConnected === true`, `dbReadbackExecuted === true`, and candidate attribution tracking.
    - Gate E10 (Remote CI Diagnostic): JSON parsing, `diagnosticExecuted === true`, and rejection of false `ciProviderVerified: true` claims.
    - Log Size: Enforces strict 50 MB truncation threshold (`TRUNCATED_FAIL`).

- **`verifyWorktreeIntegrity`**:
  - *Modified*: Verifies git HEAD and Tree SHA match expected baseline. Filters out non-source transient outputs (`reports/kh02/`, `acceptance/`, `data/google_trends_imports/`) with line-level substring filtering resilient to porcelain v1 whitespace trimming.
