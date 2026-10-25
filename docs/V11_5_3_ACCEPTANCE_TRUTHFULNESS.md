# SWAI V11.5.3 — Acceptance Runner Truthfulness & Evidence Integrity
**Specification Protocol:** KH-01  
**Target Release:** V11.5.3  
**Audited Baseline SHA:** `ec291b06c0b7841fe8d28157d02582ce2844c58c`  
**Market Context:** United States (`RESEARCH_ONLY`)

---

## 1. Defect Analysis: Acceptance Gaps in V11.5.2

The audit of V11.5.2 identified critical flaws across the acceptance infrastructure:

1. **BUG-02 (Hard-Coded Acceptance Artifacts)**: `runFullKh01Acceptance()` wrote static JSON objects (`exactRunReconciliationData`, `browserResultsData`) with hard-coded counts (e.g. 25 retrieved, 25 valid, 8 browser tests passed) rather than extracting genuine observations from test execution.
2. **BUG-04 (Manifest Validation Blocking Failure)**: `validateKh01AcceptanceManifest()` returned `{ isValid, errors }`, but `runFullKh01Acceptance()` determined process exit solely from `overallStatus`. An invalid manifest could coexist with a 0 exit code.
3. **BUG-05 (Fuzzy Assertion Matching)**: `executeAcceptanceStage()` searched Vitest test maps using `key.includes(def.testTitleMatch)`. Overlapping test titles in different files could falsely satisfy gates.
4. **BUG-09 (Release SHA Traceability)**: Documentation referenced earlier commits (e.g. `ab409d2`) interchangeably with implementation commits (`66ebba0`), obscuring which commit was actually verified.
5. **BUG-10 (Declared vs Executed Results)**: Gates inherited `PASSED` status based on file existence or declared test counts rather than cryptographic or JSON-reported execution status.

---

## 2. Evidence Origin Model & Provenance Integrity

In V11.5.3, all evidence artifacts declare an unambiguous `EvidenceOrigin`:

```typescript
export type EvidenceOrigin =
  | "ACTUAL_PROCESS_EXECUTION"  // Process exit codes (git, tsc, next build)
  | "ACTUAL_DATABASE_QUERY"     // Real SQLite queries on isolated test database
  | "ACTUAL_HTTP_RESPONSE"      // Real TCP HTTP requests to localhost Next.js server
  | "ACTUAL_BROWSER_OBSERVATION"// Playwright Chromium DOM queries and screenshots
  | "ACTUAL_MCP_OBSERVATION"    // Live stdio/SSE responses from Meta collector MCP
  | "TEST_FIXTURE"              // Offline deterministic fixture data (offline gates only)
  | "NOT_EXECUTED";             // Skipped or optional uninvoked stages
```

---

## 3. Exact Identity Matching Model

To eliminate BUG-05, Vitest reports are indexed under exact composite keys:
- Primary key: `${path.basename(testFile)}::${fullName}`
- Secondary key: `${path.basename(testFile)}::${title}`
- Unambiguous candidate matching within `expectedTestFile`:
  - Exactly 1 match in target file -> resolves actual execution result.
  - Greater than 1 match -> strictly flags `BLOCKED` for ambiguity.
  - Zero matches -> flags `NOT_RUN` / `BLOCKED`.
  - Stale JSON reports are deleted before stage execution.

---

## 4. Manifest Invariants & Blocking Guarantee

In `validateKh01AcceptanceManifest(manifest)` and `finalizeAcceptanceVerdict()`:
1. **Mandatory Gate Invariant**: Any mandatory gate that is `FAILED` or `NOT_RUN` strictly forces the verdict to `BLOCKED`.
2. **Stage Exit Code Invariant**: Any stage with a non-zero exit code strictly forces `BLOCKED`.
3. **Target Branch Invariant**: Acceptance must be executed strictly on `feature/v11-meta-collector-remove-muse`.
4. **Tested SHA Invariant**: `testedCommitSha` must match the actual `git rev-parse HEAD` and cannot be `UNKNOWN`.
5. **No False Live PASS**: Live status cannot be `PASSED` without `ADS_COLLECTED`, `ADS_PERSISTED`, `RUN_RECONCILED`, positive counts, and verified `runId`.
6. **Artifact Write Integrity**: All 8 JSON artifacts in `artifacts/v11.5.3/<acceptanceRunId>/` are verified by reading them back. Any write failure forces `BLOCKED`.

---

## 5. Adversarial Self-Test Matrix

Implemented in `tests/unit/kh01AcceptanceTruthfulnessV1153.test.ts` (18 tests, 100% passing):

| Adversarial Invariant Scenario | Expected Decision | Result |
| :--- | :--- | :---: |
| **All Mandatory Pass, Live NOT_RUN** | `CONDITIONALLY_ACCEPTED` | **PASSED** |
| **One Mandatory Gate Fails** | `BLOCKED` | **PASSED** |
| **One Mandatory Gate Skipped** | `BLOCKED` | **PASSED** |
| **Missing Mandatory Gate** | `BLOCKED` | **PASSED** |
| **Duplicate Gate IDs in Manifest** | Rejected by Manifest Validator | **PASSED** |
| **Overlapping Test Names across Files** | Differentiated without collision | **PASSED** |
| **Corrupted Vitest Report JSON** | Safely handled without crash | **PASSED** |
| **Missing Vitest Report File** | Safely returns empty map | **PASSED** |
| **Non-Zero Stage Exit Code** | `BLOCKED` | **PASSED** |
| **Missing Required Assertion in Report** | Resolves as `NOT_RUN` | **PASSED** |
| **Zero Ads Persisted in Live Run** | Cannot award `ADS_PERSISTED` | **PASSED** |
| **Live Missing Required Levels** | Cannot award `ACCEPTED` | **PASSED** |
| **Target Branch Mismatch** | Rejected by Manifest Validator | **PASSED** |
| **Invalid Tested Commit SHA** | Rejected by Manifest Validator | **PASSED** |
| **Unresolved P1 Defect Present** | `BLOCKED` | **PASSED** |
| **Linked > Displayed Discrepancy** | `consistent: false` | **PASSED** |
