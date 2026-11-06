# KH-02 V12.4.3.7.19.3.2.3 — ROOT CAUSE & CI TRUST PATH AUDIT REPORT
**Target Repository:** `quocan050302/Shopify-Search`
**Locked Branch:** `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`
**Baseline Remote HEAD:** `f13cdf07b77c9ca92cae0585b0e33204ff7cad47`
**Tested Code Commit C1:** `27d3a5835dc055990f4b9d2b02b6fe44705f3626`
**Tested Code Tree C1:** `f4ecc2373fdd136176158c7b1812e6cd7f315869`
**Date:** 2026-11-06 (Asia/Ho_Chi_Minh)

---

## 1. Executive Summary

This engineering patch addresses two critical gaps identified in the KH-02 release verification and observability pipeline:
1. **Defect A (Vulnerability to Handcrafted CI Objects):** Handcrafted caller JavaScript objects could theoretically spoof authentic GitHub Actions CI verification by declaring `source: "GITHUB_API"`, `verifier: "SWAI_TRUSTED_GITHUB_VERIFIER_V1"`, `verified: true`, and a matching 64-character SHA-256 digest, bypassing commercial release boundary defenses. Furthermore, dependency-injected unit test mocks (`customFetch`) were not reliably quarantined from satisfying commercial release gates.
2. **Defect B (Fragile and Non-Observable E9/E10 Evidence Execution):** Release gates E9 (Candidate Database Readback) and E10 (Remote CI Proof Diagnostic) relied on ad-hoc inline node `-e` invocations or shell commands that could yield false-positive PASSes on empty outputs (`exit_code=0` with empty stdout), failing to provide durable, inspectable diagnostic JSON artifacts.

Both defects have been comprehensively resolved:
- Cryptographic HMAC-SHA256 attestation signing (`mintCiAttestationToken` / `verifyCiAttestationToken`) is now mandatory across all validation entrypoints. Handcrafted objects without an unforgeable signature are rejected fail-closed with `CI_CLAIM_UNVERIFIED`.
- Unit test mocks are strictly quarantined with `isUnitTestMock: true` and `source: "UNIT_TEST_MOCK"`. Commercial gate evaluators demote mock-verified runs to `CI_NOT_RUN`.
- Dedicated, checked-in TypeScript scripts (`scripts/kh02/runCandidateDbReadback.ts` and `scripts/kh02/runRemoteCiProofDiagnostic.ts`) have been added, providing rich structured JSON output to stdout and log files, with strict credential sanitization and fail-closed error handling.
- All 10 engineering gates (E1–E10) have been executed on the exact C1 commit SHA (`27d3a5835dc055990f4b9d2b02b6fe44705f3626`) and passed with 100% compliance.

---

## 2. Root Cause Analysis: CI Provenance & Attestation Boundary (Defect A)

### 2.1 The Vulnerability Path
Prior to V19.3.2.3, the verification function `verifyAuthenticCiProof` inspected caller-provided proof objects. If the caller passed an existing object:
```typescript
{
  verified: true,
  status: "SUCCESS",
  source: "GITHUB_API",
  verifier: "SWAI_TRUSTED_GITHUB_VERIFIER_V1",
  responseDigest: "<64-hex-chars>",
  runDetails: { headSha: commitSha, ... }
}
```
The evaluator accepted the caller's claim as long as `proof.verified === true` and `runDetails.headSha === commitSha`, without verifying whether the proof was actually minted by a genuine verification execution against the GitHub API or created by the caller in memory.

### 2.2 The Cryptographic HMAC-SHA256 Defense Architecture
In V19.3.2.3, we introduced an unforgeable cryptographic attestation boundary:
1. **Canonical Digest Computation (`computeCiAttestationDigest`):**
   Calculates a SHA-256 digest over the canonical string concatenation of all critical execution parameters:
   `sha|runId|status|conclusion|event|actor|workflowPath|branch|repository|isMock`
2. **Attestation Token Minting (`mintCiAttestationToken`):**
   Mints an HMAC-SHA256 signature using the server verifier secret key (`SWAI_CI_ATTESTATION_SECRET` or cryptographically random fallback key):
   `HMAC-SHA256(canonicalDigest, verifierKey)`
3. **Attestation Token Verification (`verifyCiAttestationToken`):**
   Recalculates the expected HMAC-SHA256 digest over the parameters and performs a constant-time comparison against the token. If any parameter is tampered with (e.g. altered commit SHA, runId, status, actor, or mock flag), verification immediately fails.
4. **Mandatory Token Enforcement:**
   `verifyAuthenticCiProof`, `evaluateReleaseGatesV19`, `validateVerifiedCiAttestation`, and `verifyGitHubActionsRunProof` all mandate `attestationToken`. Unsigned proofs fail-closed with `CI_CLAIM_UNVERIFIED`.

### 2.3 Unit Test Mock Quarantine
When `verifyRemoteGitHubActionsRun` executes with a mock fetch handler (`customFetch`), it explicitly sets:
- `isUnitTestMock: true`
- `source: "UNIT_TEST_MOCK"`
- Attestation token is minted with `isMock: true`

In `evaluateReleaseGatesV19`, if `isUnitTestMock === true` or `source === "UNIT_TEST_MOCK"`, the evaluator demotes `ciStatus.runStatus` to `CI_NOT_RUN` with blocker `CI_CLAIM_UNVERIFIED: Unit test mock CI proof cannot satisfy commercial release gate`. Mocks can safely test error handling and edge cases in unit tests, but are cryptographically prevented from bypassing commercial release gates.

---

## 3. Dedicated Diagnostic Scripts & Observable Execution (Defect B)

### 3.1 Candidate Database Readback Proof (`scripts/kh02/runCandidateDbReadback.ts`)
- **Direct Database Connectivity:** Uses `import { prisma } from "../../src/lib/db"` to query the real SQLite candidate store (`dev.db`).
- **Target Candidate Scoping:** Specifically inspects UAHPET Cat Feeder canonical ID `cmvsy7zqh000jp0orhypwohho`.
- **Business Scope Verification:** Invokes `filterAttributableObservations` with `evaluationScope: "BUSINESS"` to guarantee test-only aliases and cross-candidate data are excluded.
- **Credential Masking:** Sanitizes DSN/connection strings with `maskDsn()` to prevent credential leakage.
- **Truthful JSON Output:**
  ```json
  {
    "dbConnected": true,
    "dbReadbackExecuted": true,
    "rawRecordCount": 6,
    "candidateAttributableCount": 0,
    "businessAttributableCount": 0,
    "verifiedOfficialCsvRows": 0,
    "coveredCalendarDays": 0,
    "g15Verdict": "INSUFFICIENT_EVIDENCE",
    "g16Verdict": "INSUFFICIENT_EVIDENCE"
  }
  ```
- **Error Handling:** If database read fails, catches exception, logs JSON with `dbConnected: false`, and exits with code 1.

### 3.2 Remote GitHub Actions CI Diagnostic (`scripts/kh02/runRemoteCiProofDiagnostic.ts`)
- **Workflow & Environment Inspection:** Inspects local `.github/workflows` directory and CLI flags (`--run-id`, `--workflow`, `--token`).
- **Truthful Status Determination:** When no external run ID or active token is provided, truthfully outputs `status: "CI_NOT_CONFIGURED"`, `remoteVerificationLevel: "CI_NOT_RUN"`, `ciProviderVerified: false`.
- **Zero Fabrication:** Never claims success on unverified runs or private repositories without public Actions.
- **Fail-Closed Gate:** Emits structured JSON and exits with code 0 on successful diagnostic execution (or code 1 on unhandled exception).

---

## 4. Verification & Testing Matrix

### 4.1 Adversarial Test Suite (`v12_4_3_7_19_3_2_3_TrustedCiProofAndObservableExecution.test.ts`)
A dedicated adversarial test suite comprising 28 tests was implemented across 5 groups:
- **Group A (7 tests):** Handcrafted caller objects, unsigned claims, invalid tokens, SHA replay attacks, runId tampering, status alteration, and mock actor quarantine.
- **Group B (5 tests):** Commercial release gate mock quarantine, validator rejection of mock attestations, and fail-closed gate evaluation.
- **Group C (6 tests):** Database readback script existence, valid JSON stdout, mandatory schema fields, raw record count readback, business attribution exclusion, and DSN credential masking.
- **Group D (5 tests):** Remote CI diagnostic script existence, valid JSON stdout, schema validation, `CI_NOT_CONFIGURED` output, and mock stamping.
- **Group E (5 tests):** End-to-end release gate integrity, point-in-time timestamp tampering, candidate isolation, and unforgeable attestation chain.

### 4.2 Full Gate Execution (E1–E10)
All 10 gates executed on exact commit `27d3a5835dc055990f4b9d2b02b6fe44705f3626`:
- **E1 (TypeScript Check):** PASS (0 errors, 4520ms)
- **E2 (Whitespace Check):** PASS (0 whitespace errors, 54ms)
- **E3 (Targeted V19.3.2.x Suites):** PASS (3 test files, 155 tests passed, 16393ms)
- **E4 (Full KH-02 Unit Tests):** PASS (44 test files, 1072 tests passed, 226192ms)
- **E5 (Full KH-02 Integration Tests):** PASS (12 test files, 218 tests passed, 71989ms)
- **E6 (KH-01 Baseline Verification):** PASS (5 test files, 98 tests passed, 4269ms)
- **E7 (Security Negative Suites):** PASS (4 test files, 65 tests passed, 3283ms)
- **E8 (Backtest Dev & Holdout):** PASS (Policy=PASS, Dev=INSUFFICIENT, Holdout=INSUFFICIENT, 2411ms)
- **E9 (Candidate DB Readback Proof):** PASS (Observable JSON emitted, dbConnected=true, rawRecords=6, 1431ms)
- **E10 (Remote CI Diagnostic):** PASS (Observable JSON emitted, status=CI_NOT_CONFIGURED, 1084ms)

---

## 5. Commercial Release Truth & Spend Audit

| Dimension | Status / Verdict | Rationale |
|---|---|---|
| **Software Engineering Gates** | **PASS (10/10)** | Typecheck, whitespace, unit, integration, adversarial, security, backtest, and diagnostic gates pass 100%. |
| **Commercial Gate G15 (Demand History)** | **INSUFFICIENT_EVIDENCE** | Official US Google Trends Explore CSV with >=60 days authenticated longitudinal data not yet onboarded. |
| **Commercial Gate G16 (Proof Verification)** | **INSUFFICIENT_EVIDENCE** | Raw DB records use unverified pseudo-references; lack valid SHA-256 CSV checksums. |
| **Remote CI Status** | **CI_NOT_CONFIGURED** | Private repository feature branch has no active public Actions run; truthfully disclosed. |
| **Commercial Release Decision** | **NO-GO** | System strictly enforces `Engineering PASS != Commercial GO`. |
| **Unauthorized Spend** | **$0.00** | Zero paid API spend; SerpApi, BigQuery, and TikTok Ads US deferred. `DEMAND_PROVIDER_MODE=GOOGLE_FREE_ONLY`. |

---

## 6. Honest Next Engineering Steps

1. **GitHub Actions CI Configuration:** Configure authentic workflow execution in GitHub Actions on the target repository and supply genuine `--run-id` and workflow run credentials to convert `CI_NOT_CONFIGURED` to genuine `CI_PROVIDER_VERIFIED`.
2. **Official Candidate CSV Onboarding:** Obtain authentic Google Trends Explore CSV data for UAHPET Cat Feeder covering >=60 calendar days in US geography, sign with durable SHA-256 checksums, and ingest to transition G15/G16 from `INSUFFICIENT_EVIDENCE` to verified commercial pass.
