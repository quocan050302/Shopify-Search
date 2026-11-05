# KH-02 V12.4.3.7.18.1 — TRUST BOUNDARY, RETRY EXHAUSTION & MANDATORY PROVENANCE AUDIT

- **Date:** 2026-11-05 (Asia/Ho_Chi_Minh)
- **Repository:** `quocan050302/Shopify-Search`
- **Locked Branch:** `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`
- **Baseline Remote HEAD:** `5aea548de6d1e83b317db3d9f4c7fd2839d5524a`
- **Tested Code Commit SHA:** `25b9be5617f1b238ded64b7a599c7aae8aa297f2`
- **Target Version:** `V12.4.3.7.18.1`
- **Engineering Verdict:** `GO / PASS`

---

## 1. Executive Summary & Provenance Verification

This engineering patch (V12.4.3.7.18.1) strictly resolves trust boundary and evidence lineage vulnerabilities identified across Workstreams A, B, C, and D:
1. **Actual Socket Trust & Zero Test Bypass (Workstream A):**
   - Eliminated the dangerous `new URL(finalUrl).protocol === "https:"` fallback that allowed mock fetches to masquerade as verified TLS connections.
   - Pinned IP validation strictly requires caller-provided IPs to be validated against SSRF rules and to exist within vetted DNS resolution records, throwing `BLOCKED_PRIVATE_HOST` or `SOCKET_PEER_MISMATCH` on any deviation.
   - Comprehensive test-override detector (`hasTestOverrides`) detects any mock fetch, DNS mock, loopback, simulated IP/URL, or pinned IP, unconditionally forcing `isLiveExternalProof: false`.
   - Guaranteed that any unverified PDP result (`isVerifiedPdp: false`) unconditionally strips `tlsVerified` and `isLiveExternalProof`.
2. **Retry Exhaustion & Guaranteed Commit (Workstream B):**
   - Exported explicit constant `MAX_DB_ATTEMPTS = 5`.
   - Transaction loop tracks durable commit completion. When lock contention (e.g., `SQLITE_BUSY`, `P1008`) persists through all attempts, throws a clean HTTP 503 `DATABASE_BUSY_RETRY_EXHAUSTED` error instead of falling through to phantom success.
   - Enforced post-commit readback count verification to guarantee persisted records exist prior to returning success.
3. **OS-Process Concurrency & Conflicting Duplicate Detection (Workstream C):**
   - Implemented `assertIdenticalOrThrowConflict` comparing `demandValue` (including null vs number and float tolerance > 0.001), `evidenceReference`, `periodEnd`, and `methodologyVersion`.
   - When concurrent OS child processes insert differing values for the same key, exactly one process commits while the other fails with HTTP 409 `CONFLICTING_DUPLICATE_OBSERVATION`.
4. **Mandatory Provenance at Deepest Write Path (Workstream D):**
   - `GOOGLE_TRENDS_CSV` unconditionally requires `evidenceReference` with 64-hex SHA-256 and validates row existence/attributes via `verifyDemandObservationAgainstRawCsv` regardless of `strictProvenance` flag.
   - `PROVIDER_API` unconditionally requires authentic provider receipts on disk via `resolveVerifiedDemandEvidence`, throwing HTTP 422 `PROVIDER_RECEIPT_REQUIRED` on unbacked claims.
   - Pure CSV parser `parseGoogleTrendsCsvBytes` guarantees zero disk mutation side-effects and byte-for-byte SHA-256 idempotency.

---

## 2. Production Code Changes

### `src/services/kh02/identity/verifiedMerchantPdpResolver.ts`
- Added auditable helper `evaluateLivePdpEligibility(params)`.
- Defined `hasTestOverrides` checking `fetchFn`, `dnsLookupFn`, `allowSelfSignedTestCert`, `allowLoopbackForTest`, `simulateFinalUrl`, `simulateConnectedPeerIp`, `pinnedIp`, and simulation transport modes.
- Hardened caller-supplied `pinnedIp`: must pass SSRF validation and must match vetted DNS answers; otherwise returns `BLOCKED_PRIVATE_HOST` or `SOCKET_PEER_MISMATCH`.
- Replaced URL protocol fallback with strict socket-attested TLS check: `Boolean(isRealSocketConnection && observedTlsAuthorized && !options?.allowSelfSignedTestCert)`.
- Encapsulated resolver in `finalizeResult` ensuring any failed PDP verification strips `tlsVerified` and `isLiveExternalProof`.

### `src/services/kh02/demand/demandObservationBatchImport.ts`
- Exported constant `MAX_DB_ATTEMPTS = 5`.
- Implemented `assertIdenticalOrThrowConflict` validating semantic consistency between existing DB rows and incoming points. Differing values, references, date ranges, or methodologies trigger HTTP 409 `CONFLICTING_DUPLICATE_OBSERVATION`.
- Enforced mandatory row-level provenance checks for both `GOOGLE_TRENDS_CSV` and `PROVIDER_API` prior to any DB write, ignoring any relaxed `strictProvenance: false` flag.
- Hardened retry loop: on SQLite busy/timeout, rolls back transaction and retries with exponential backoff up to `MAX_DB_ATTEMPTS`. If exhausted, throws 503 `DATABASE_BUSY_RETRY_EXHAUSTED`.
- Post-commit readback verification ensures database row count matches inserted count.

### `scripts/kh02/multiProcessImportWorker.ts`
- Added `--valueFixed <number>` CLI flag to enable testing concurrent conflicting value injection from independent OS child processes.

---

## 3. Test Verification Matrix

All 53 newly introduced V18.1 tests across 5 test files, along with all 122 V18/V18.1 tests, 135 regression tests, and 69 KH-01 tests PASSED with zero failures, skips, or timeouts.

| Suite | File | Tests | Duration | Status |
|---|---|---|---|---|
| Workstream A | `tests/unit/kh02/v12_4_3_7_18_1_SocketTrustNoTestBypass.test.ts` | 16/16 | 19ms | PASS |
| Workstream A | `tests/integration/kh02/v12_4_3_7_18_1_RealTlsPeerCertIsolation.test.ts` | 5/5 | 174ms | PASS |
| Workstream B | `tests/unit/kh02/v12_4_3_7_18_1_RetryExhaustion.test.ts` | 8/8 | 3.01s | PASS |
| Workstream C | `tests/integration/kh02/v12_4_3_7_18_1_OsProcessConflict.test.ts` | 10/10 | 3.03s | PASS |
| Workstream D | `tests/unit/kh02/v12_4_3_7_18_1_MandatoryProvenance.test.ts` | 14/14 | 154ms | PASS |
| **Total V18.1** | **5 Suites** | **53/53** | **~6.5s** | **PASS** |

### Regression Verification Gates
1. **Type & Syntax Gate:** `npx tsc --noEmit && git diff --check` -> 0 errors, 0 diff check warnings.
2. **V18 & V18.1 Combined Regression:** `npx vitest run tests/unit/kh02/v12_4_3_7_18_* tests/integration/kh02/v12_4_3_7_18_*` -> 11 files, 122/122 tests PASS (12.91s).
3. **V17 & Flow02 Regression:** `npx vitest run tests/unit/kh02/v12_4_3_7_17_* tests/unit/kh02/v12_4_3_5_3_Flow02CsvProvenanceAndGoogleExactPdp.test.ts` -> 6 files, 135/135 tests PASS (3.79s).
4. **KH-01 Cross-Regression:** `npm run kh01:verify` -> 5 files, 69/69 tests PASS (1.71s).
5. **Point-in-Time Backtest:** `npx tsx scripts/kh02/runBacktestV12_4_3_4_2.ts` -> Exit 0, Policy=PASS, Dev=INSUFFICIENT, Holdout=INSUFFICIENT (zero lookahead leakage).

---

## 4. Provider Sentinel Integrity

Bitwise verification of static provider receipt artifacts confirms zero tampering:
- `data/provider_receipts/04f4d039...`: `04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14` (INTACT)
- `data/provider_receipts/3440f190...`: `3440f19057ac7d1ac535150d1bbcc9a3078e0b7a5d46ad3f4bbd2c46235f61c8` (INTACT)
- `data/provider_receipts/366cfeb1...`: `366cfeb156347d783c227be3fd7e10e397c8cd00c49c909673fc5208f36b841f` (INTACT)

---

## 5. Business Gate Fail-Closed Evaluation

Business evaluation criteria remain strictly enforced with zero optimistic fabrication:
- **G06 (Google Ads Transparency):** `TRANSPORT_READY_NOT_VERIFIED` (live network transport disabled in test environment; zero unverified claims).
- **G07 (TikTok Ads Library):** `BLOCKED` (no live TikTok Ads API integration authorized).
- **G15 (Longitudinal Demand):** `INSUFFICIENT_EVIDENCE` (historical demand ground truth preserved without synthetic fabrication).
- **G16 (Top 3 Evergreen Winners):** `INSUFFICIENT_EVIDENCE` (strictly blocked until both G06 and G15 are satisfied by live external proofs).

**Verdict:** The patch strictly meets all engineering mandates and passes all verification gates.

