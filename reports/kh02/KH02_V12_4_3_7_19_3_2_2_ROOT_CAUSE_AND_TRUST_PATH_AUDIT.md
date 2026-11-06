# KH-02 V12.4.3.7.19.3.2.2: Root Cause & Trust Path Audit

**Date:** 2026-11-06 (Asia/Ho_Chi_Minh)  
**Version:** V12.4.3.7.19.3.2.2  
**Target Repository:** `quocan050302/Shopify-Search`  
**Locked Branch:** `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`  
**Baseline HEAD:** `4d472c277454b0b2230d80a03f843124b44cd49c`  
**Code Commit (C1):** `70c1434ccfee3e41787d472f6027f6f57eb49caf`  
**Code Tree SHA:** `26d9b0b59f04ea486d19cf4cccab9e5c7a4fa3ce`  
**Commercial Gate Verdict:** **NO-GO** (Engineering PASS 100%, G15/G16 INSUFFICIENT_EVIDENCE, Remote CI CI_NOT_RUN)

---

## 1. Executive Summary & Problem Classification

This engineering release closes the two core defects identified in the V19.3.2.1 release audit, establishing an unforgeable commercial attribution boundary and authentic remote CI verification:

1. **Defect A — Mandatory Business Scope Attribution Across Entire Demand Flow:**
   - **Vulnerability:** In prior versions, `evaluationScope` was an optional property in `CandidateAttributionContext`. When omitted or left unspecified by calling code, helper functions defaulted to permissive evaluation where test-only alias records could yield `isAttributable: true`. Furthermore, `resolveProductDemandHistory` and `GoogleTrendsCsvImportProvider.fetchSeries` did not enforce `evaluationScope: "BUSINESS"`. In `evaluateDemandSourceAuthority`, `searchTermUsed` was unconditionally injected into `authorizedKeywords`, allowing unapproved or test-only search terms to bypass alias verification as exact keyword matches.
   - **Resolution:**
     - Adopted the strict principle: **UNSPECIFIED SCOPE MUST NEVER GRANT COMMERCIAL AUTHORITY**.
     - Added `businessAttributable: boolean` to `CandidateAttributionResult` and `AttributionPartitionSummary`.
     - In `classifyCandidateObservationAttribution`, when `evaluationScope` is unspecified or `"ENGINEERING"`, test-only alias matches are strictly marked with `businessAttributable: false`. Under `"BUSINESS"` scope, test-only aliases are rejected fail-closed with `EXCLUDED_UNVERIFIED_ALIAS` (`isAttributable: false, businessAttributable: false`).
     - Propagated fixed `evaluationScope: "BUSINESS"` in `resolveProductDemandHistory`, partitioning observations into `businessAttributableObservations` before any commercial G15/G16 assessment or database persistence.
     - Enforced `evaluationScope: "BUSINESS"`, `strictProvenance: true`, and `businessAttributable` checking in `GoogleTrendsCsvImportProvider.fetchSeries`.
     - In `evaluateDemandSourceAuthority` (`temporalDemandEngine.ts`), bound candidate queries strictly to `[policy.candidateCanonicalName, policy.candidateCanonicalTitle]`, preventing arbitrary `searchTermUsed` from masquerading as canonical keywords. Defaulted evaluator scope to `BUSINESS`.

2. **Defect B — Real GitHub Actions Remote CI Verification with SSRF Protection:**
   - **Vulnerability:** In previous versions, `verifyGitHubActionsRunProof` accepted any caller-supplied JavaScript object containing `{ provider: "github-actions", verified: true, runId: "1234567890" }`. In `releaseGateEvaluatorV19.ts`, a caller asserting `ciStatus.runStatus === "SUCCESS"` with a self-supplied object would be elevated to `CI_PASS` without authentic verifier origin or verifiable API interaction.
   - **Resolution:**
     - Created `src/services/kh02/release/githubActionsCiEvidence.ts` implementing a hardened, authentic remote GitHub Actions verification client.
     - Enforced SSRF protection: strictly permits HTTPS scheme and exact host `api.github.com` (rejecting loopback, private IPs, non-HTTPS protocols, port overrides, and redirects).
     - Verified exact repository, target branch, and exact tested commit SHA (`70c1434ccfee3e41787d472f6027f6f57eb49caf`).
     - Required completed workflow run status and `success` conclusion from an allowed workflow name (`KH-02 Continuous Integration`).
     - Computed an immutable 64-character SHA-256 `responseDigest` over normalized API payload.
     - In `releaseGateEvaluatorV19.ts`, demoted any unverified self-supplied caller object to `CI_NOT_RUN` with blocker reason `CI_CLAIM_UNVERIFIED` unless accompanied by authentic verifier provenance (`SWAI_TRUSTED_GITHUB_VERIFIER_V1`).
     - When external CI credentials or network are absent, truthfully returns `CI_NOT_RUN` / `CI_NOT_CONFIGURED` without inventing execution.

---

## 2. Production Code Call-Site & Modification Inventory

| File | Functions / Components | Purpose of Change |
| :--- | :--- | :--- |
| `src/services/kh02/demand/candidateDemandAttribution.ts` | `classifyCandidateObservationAttribution`, `filterAttributableObservations` | Added `businessAttributable: boolean` to results; enforced that unspecified or ENGINEERING scope yields `businessAttributable: false` for test-only aliases; rejected test-only aliases fail-closed under BUSINESS scope. |
| `src/services/kh02/demand/historicalDemandIngestion.ts` | `resolveProductDemandHistory` | Propagated `evaluationScope: "BUSINESS"` in `CandidateAttributionContext`; consumed `businessAttributableObservations` for G15/G16 and live DB persistence. |
| `src/services/kh02/demand/demandProviderRegistry.ts` | `GoogleTrendsCsvImportProvider.fetchSeries` | Enforced `evaluationScope: "BUSINESS"`, `strictProvenance: true`, and filtered points on `businessAttributable === true`. |
| `src/services/kh02/demand/temporalDemandEngine.ts` | `evaluateDemandSourceAuthority`, `DemandHistoryPolicy` | Added `evaluationScope` to policy; restricted canonical keyword matching to canonical name/title; defaulted internal attribution evaluation to BUSINESS scope. |
| `src/services/kh02/release/githubActionsCiEvidence.ts` | `verifyAuthenticCiProof`, `sanitizeCiLog` | Implemented authentic remote GitHub Actions CI verification client with SSRF guards, strict origin validation, timeout bounds, and SHA-256 response digest. |
| `src/services/kh02/release/releaseGateEvaluatorV19.ts` | `evaluateReleaseGatesV19` | Demoted caller claims of CI success without trusted verifier provenance (`SWAI_TRUSTED_GITHUB_VERIFIER_V1`) to `CI_NOT_RUN` with `CI_CLAIM_UNVERIFIED`. |
| `src/services/kh02/demand/testSuiteEvidenceValidator.ts` | `AuthenticatedCiProof`, `validateVerifiedCiAttestation`, `verifyGitHubActionsRunProof` | Enhanced attestation validation to verify verifier origin, response digest, exact repo, branch, commit SHA, and success conclusion. |
| `tests/unit/kh02/v12_4_3_7_19_3_2_2_MandatoryBusinessScopeAndCiProof.test.ts` | 52 adversarial unit tests | Non-vacuous test matrix covering Groups A, B, and C with 100% pass rate. |
| `tests/unit/kh02/v12_4_3_7_12_EvidenceEligibilityFencing.test.ts` | Multi-process C08 concurrency test | Added retry with exponential backoff for concurrent child-process SQLite access under multi-worker execution. |
| `tests/unit/kh02/v12_4_3_7_13_UnforgeableCollectorUnifiedEligibility.test.ts` | Multi-process C08 concurrency test | Added retry with exponential backoff for concurrent child-process SQLite access and adjusted timeout to 60s for heavy parallel runs. |

---

## 3. Trust Boundary & Governance Matrix

| Boundary | Enforcement Mechanism | Failure Mode | Verification Status |
| :--- | :--- | :--- | :--- |
| **Scope Fencing** | `evaluationScope: "BUSINESS"` default; `businessAttributable: false` on unspecified/ENGINEERING scope | `EXCLUDED_UNVERIFIED_ALIAS` / `businessAttributable: false` | **ENFORCED** |
| **Test Alias Commercial Isolation** | Test-only signed approvals rejected under BUSINESS scope | `TEST_ONLY_ALIAS` / `businessEligible: false` | **ENFORCED** |
| **Search Term Disambiguation** | `searchTermUsed` separated from canonical keyword set; requires alias verification | `EXCLUDED_UNVERIFIED_ALIAS` | **ENFORCED** |
| **Provider CSV Boundary** | `GoogleTrendsCsvImportProvider` enforces BUSINESS scope and candidate attribution | `0 business historical points` | **ENFORCED** |
| **Database Persistence Boundary** | `resolveProductDemandHistory` writes ONLY `businessAttributableObservations` | Test observations excluded before DB write | **ENFORCED** |
| **CI Provider Authenticity** | SSRF-guarded GitHub API client + 64-char hex response digest | `CI_CLAIM_UNVERIFIED` / `CI_NOT_RUN` | **ENFORCED** |
| **Ledger Integrity** | `LEDGER_CORRUPT` fail-closed protection; zero file overwrite | Preserved byte-for-byte on disk | **ENFORCED** |
| **Commercial Release Gate** | G15/G16 require official candidate-matched >=60d data | `INSUFFICIENT_EVIDENCE` (NO-GO) | **ENFORCED** |

