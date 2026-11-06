# KH-02 V12.4.3.7.19.3.2.1: Root Cause & Trust Boundary Audit

**Date:** 2026-11-06 (Asia/Ho_Chi_Minh)  
**Version:** V12.4.3.7.19.3.2.1  
**Repository:** `quocan050302/Shopify-Search`  
**Locked Branch:** `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`  
**Baseline HEAD:** `06d70c4fe87d67b9a0e2e05067b2172f2ac0467e`  
**Code Commit (C1):** `10384d3799084e648b37721a794cdb8b149acda3`  
**Code Tree SHA:** `9c94346fbf0d01b22f37f7f1284d225703f2e052`  
**Release Decision:** **NO-GO** (Engineering PASS 100%, Commercial G15/G16 INSUFFICIENT_EVIDENCE)

---

## 1. Executive Summary & Problem Classification

This patch closes the final trust, durability, and evidence boundaries identified in the V19.3.2 release audit:

1. **Defect A — TEST_ONLY Alias & Approver Fencing:**
   - **Vulnerability:** Previously, `createSignedCandidateAliasApproval` and `verifyDurableCandidateAliasApproval` did not strictly fence test-only aliases from commercial demand attribution. A record created with a test key could satisfy verification without distinguishing between engineering unit test validity and commercial business demand eligibility.
   - **Resolution:** Separated decision dimensions: `cryptographicSignatureValid`, `durableRecordFound`, `issuerKeyPurposeAuthorized`, `issuerKeyStatusActive`, `issuerKeyBusinessTrusted`, `approverPrincipalAuthorized`, `scopeValid`, `isTestOnly`, and `businessEligible`. In business evaluation scope (`evaluationScope: "BUSINESS"`), test-only records fail-closed with `TEST_ONLY_ALIAS` (`businessEligible: false`), preventing unverified commercial demand attribution.
   - **Approver Authority:** Enforced `KH02_AUTHORIZED_APPROVER_PRINCIPALS`. Production commercial issuance fails closed with `APPROVER_AUTHORITY_NOT_CONFIGURED` if approver list is missing, or `UNAUTHORIZED_APPROVER` if principal is unauthorized. Registering `ACTIVE` keys in production requires `KH02_ALIAS_ADMIN_TOKEN`.

2. **Defect B — Genuine CI Provider Proof & Zero Fake CI Pass:**
   - **Vulnerability:** In `testSuiteEvidenceValidator.ts`, any caller providing `{ provider: "github-actions", runId: "1234567890", commitSha: checkoutSha }` was elevated to `ciVerified = true` and `verificationLevel = "CI_PROVIDER_VERIFIED"` without authentic provider attestation.
   - **Resolution:** Replaced unverified caller claims with `verifyGitHubActionsRunProof` and `validateVerifiedCiAttestation`. Unverified claims set `ciVerified = false` with rejection reason `CI_CLAIM_UNVERIFIED`. Fixed false-positive test A42. In `releaseGateEvaluatorV19.ts`, caller-asserted `ciStatus.runStatus === "SUCCESS"` without verified attestation is demoted to `CI_NOT_RUN` with blocker `CI_CLAIM_UNVERIFIED`.

3. **Defect C — Corrupt Ledger Durability & Monotonic Revocation:**
   - **Vulnerability:** `readLedgerUnderLock()` previously caught JSON parsing errors and returned a blank ledger `{ version: "1.0", approvals: {}, revocations: {} }`. A subsequent persistence call would overwrite the corrupted file, destroying existing approvals and revocation records.
   - **Resolution:** Structured ledger storage statuses: `LEDGER_HEALTHY`, `LEDGER_NOT_INITIALIZED`, `LEDGER_CORRUPT`, `LEDGER_UNREADABLE`. Fail-closed on corruption: write operations NEVER overwrite corrupted ledger files. Monotonic revocation prevents re-persisting an unrevoked record after revocation (`CONFLICT_ERROR`). Same-host PID liveness check prevents premature lock stealing while foreign-host locks are never reclaimed on PID alone.

---

## 2. Production Code Changes

| File | Changes |
| :--- | :--- |
| `src/services/kh02/demand/durableCandidateAliasAuthority.ts` | Added `ReadLedgerResult`, `LedgerStorageStatus`; protected against corrupt ledger overwrites; added `TEST_ONLY_ALIAS` fencing, admin token authorization, approver authority checks, same-host stale lock reclaim. |
| `src/services/kh02/demand/candidateDemandAttribution.ts` | Added `evaluationScope?: "ENGINEERING" \| "BUSINESS"` to context; enforced `businessEligible` in `isAuthenticVerifiedCandidateAlias`; excluded test-only aliases under business scope. |
| `src/services/kh02/demand/testSuiteEvidenceValidator.ts` | Added `AuthenticatedCiProof`, `CiProviderProofInput`; implemented `verifyGitHubActionsRunProof` and `validateVerifiedCiAttestation`; rejected unverified caller `runId` claims with `ciVerified = false` and `CI_CLAIM_UNVERIFIED`. |
| `src/services/kh02/release/releaseGateEvaluatorV19.ts` | Enforced `verifiedProof.verified === true` for `ciStatus.runStatus === "SUCCESS"`; demoted unverified assertions to `CI_NOT_RUN` with blocker `CI_CLAIM_UNVERIFIED`; enhanced log secret redaction. |
| `tests/unit/kh02/v12_4_3_7_19_3_2_DurableAliasAuthorization.test.ts` | Fixed test A42 (unverified runId fails with `CI_CLAIM_UNVERIFIED`); added test A42b for authentic attestation. |
| `tests/unit/kh02/v12_4_3_7_19_3_2_1_FinalAliasTrustAndCiProof.test.ts` | Created new 75-test adversarial test suite covering Groups A, B, C, D with 100% pass rate. |

---

## 3. Trust Boundary Matrix

| Boundary | Enforcement Mechanism | Failure Mode | Status |
| :--- | :--- | :--- | :--- |
| **Alias Key Registration** | Purpose check + `KH02_ALIAS_ADMIN_TOKEN` for prod ACTIVE keys; `TEST_ONLY` forbidden in prod | `SECURITY_VIOLATION` | **SECURED** |
| **Key Immutability** | Keys with status `REVOKED` or `COMPROMISED` cannot be re-registered | `KEY_IMMUTABLE_ERROR` | **SECURED** |
| **Approver Authority** | `KH02_AUTHORIZED_APPROVER_PRINCIPALS` check on commercial issuance | `UNAUTHORIZED_APPROVER` / `APPROVER_AUTHORITY_NOT_CONFIGURED` | **SECURED** |
| **Scope Fencing** | BUSINESS scope rejects test keys and test records | `TEST_ONLY_ALIAS` (`businessEligible: false`) | **SECURED** |
| **Ledger Corruption** | `readLedgerUnderLock` returns `LEDGER_CORRUPT`; write ops abort | Zero overwrite; preserved on disk | **SECURED** |
| **Monotonic Revocation** | Revocation ledger map checked before write | `CONFLICT_ERROR` | **SECURED** |
| **CI Provider Proof** | Exact repository, commit SHA, completed status, success conclusion | `CI_CLAIM_UNVERIFIED` / demoted to `CI_NOT_RUN` | **SECURED** |
| **Zero Spend Gate** | Google Free Mode only; no SerpApi, BigQuery, TikTok Ads US | Blocked upfront ($0.00 spend) | **SECURED** |
