# KH-02 V12.4.3.7.19.3.3.2 — Final Audit & Verification Report
**Patch Title**: CSV Official-Origin Binding + Google Upstream Trust Boundary  
**Date**: 2026-11-08  
**Repository**: `quocan050302/Shopify-Search`  
**Locked Branch**: `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`

---

## 1. Immutable Git Baseline & Tested Code Identity
| Item | Value |
|---|---|
| **Pre-Fix Baseline Commit (`C0`)** | `bb0414b5bcf9d8edccd67ad2f098eb3b0d0faef9` |
| **Pre-Fix Baseline Tree (`C0`)** | `7e730979c772990d6e7e74979769c7f8f0f12f27` |
| **Previous V19.3.3.1 Code Commit** | `79b248e79c56a0a549cc8d681fd6e67ad61762fc` |
| **Tested Code Commit (`C1`)** | `c856f5751f877e7249ea6739d41bf862922a003b` |
| **Tested Code Tree (`C1`)** | `bfab7262eeef3ead2f3ccaad28a1eced3c78f9e9` |
| **GitHub Actions CI Run on `C1`** | Run `42451749802` (`https://github.com/quocan050302/Shopify-Search/actions/runs/42451749802`) — **6/6 jobs `completed` / `success`** |
| **Paid API Spend / Calls** | `$0.00` (`0` paid API calls) |

---

## 2. Root Causes Closed in `C1` (`c856f5751f877e7249ea6739d41bf862922a003b`)

### 2.1 P1-A: CSV Official-Origin Binding & Schema v2 HMAC Authority (`src/services/kh02/demand/durableCsvImportAuthority.ts`)
1. **Closed Omitted-Property Bypass at Creation**:
   - In `C0`, `createSignedCsvImportAuthority` guarded `acquisitionSourceUrl` validation behind `if (!isTest && input.acquisitionSourceUrl !== undefined)`, allowing callers that omitted `acquisitionSourceUrl` (`undefined`) to mint `BUSINESS`-scope `AUTHENTICATED_OFFICIAL_EXPORT` authority records.
   - In `C1`, `validateOfficialGoogleTrendsAcquisitionUrl(input.acquisitionSourceUrl, input.query, input.geography)` is enforced unconditionally whenever `!isTest && input.originClassification === "AUTHENTICATED_OFFICIAL_EXPORT" && input.reviewStatus === "APPROVED"`.
2. **Strict URL & Query/Geo Validation**:
   - Rejects `undefined`, `null`, empty/whitespace strings, `http://`, non-`trends.google.com` hosts, subdomains (`trends.google.com.evil.com`), userinfo (`user:pass@`), IP literals (`142.250.190.46`, `127.0.0.1`), `localhost`, custom ports, paths outside `/trends/`, and mismatched `geo` or `q` query parameters.
3. **Schema v2 (`"2.0"`) Canonical HMAC-SHA256 Signing & Readback Re-Verification**:
   - `OfficialCsvImportAuthorityRecord` now persists `schemaVersion: "2.0"`, `acquisitionSourceUrl`, `acquisitionEvidenceRef`, `acquisitionCapturedAt`, and `acquisitionMethod`.
   - `computeCanonicalCsvAuthorityPayload` includes all four fields in the canonical HMAC-SHA256 payload for v2 records; any post-signing mutation or deletion of `acquisitionSourceUrl` fails HMAC verification (`HMAC_SIGNATURE_MISMATCH`).
   - On readback (`evaluateSingleCsvAuthorityRecord`), `BUSINESS`-scope evaluation re-verifies the approver principal against `getAuthorizedCsvApproverPrincipals()`, rejects legacy `schemaVersion: "1.0"` records without silent re-signing (`LEGACY_V1_MISSING_SIGNED_ACQUISITION_EVIDENCE`), and re-runs `validateOfficialGoogleTrendsAcquisitionUrl`.

### 2.2 P1-B: Google Ads Transparency Upstream Trust Boundary (`src/services/kh02/providers/googleTransparencyResearchAdapter.ts`, `src/services/kh02/scoring/evergreenOpportunityScoring.ts`)
1. **Closed Self-Asserted MCP JSON Upstream Request ID Promotion**:
   - In `C0`, `googleTransparencyResearchAdapter.ts` extracted `requestId` / `providerRequestId` / `rpcEnvelopeId` from the untrusted child MCP tool result JSON body and set `upstreamRequestVerified = true` and `providerVerified = true` whenever that string was non-empty.
   - In `C1`, self-asserted JSON fields inside the MCP child response never promote `upstreamRequestVerified` or `providerVerified`. When the local stdio FastMCP invocation ledger matches the tool call, the result is classified strictly as:
     - `localMcpToolResultVerified = true`
     - `upstreamRequestVerified = false`
     - `providerVerified = false`
     - `provenanceTier = "LOCAL_MCP_TOOL_RESULT_VERIFIED"`
     - `upstreamOriginStatus = "UPSTREAM_NOT_ATTESTED"`
2. **Hardened Local MCP Invocation Ledger & Persistence**:
   - Added duplicate `localInvocationId` collision rejection (`LOCAL_INVOCATION_ID_COLLISION`), workspace isolation verification (`WORKSPACE_MISMATCH`), strict rejection of `sourceMode !== "LIVE_PROVIDER"` (`NON_LIVE_SOURCE_MODE`), and fail-closed `JSON.parse` error throwing in `decodeCallToolResult`.
   - `persistGoogleTransparencyObservations` stores truthful `provenanceTier: "LOCAL_MCP_TOOL_RESULT_VERIFIED"`, `providerVerified: false`, `upstreamRequestVerified: false`, and `localMcpToolResultVerified: true` in `AdObservation.rawPayload`.
3. **Scoring Guard (`evergreenOpportunityScoring.ts`)**:
   - Google Ads Transparency observations with `productIdentityConfidence === "UNKNOWN"`, `resolvedPdpUrl === null`, or `usMarketVerificationSource === "FILTER_ONLY"` contribute `0` multi-platform boost points.

---

## 3. Pre-Fix RED vs Post-Fix GREEN Adversarial Verification
Test suite: `tests/unit/kh02/v19_3_3_2_CsvOriginAndGoogleUpstreamTrust.test.ts` (40 adversarial tests: `C01`..`C19`, `G01`..`G18`, `M01`..`M04`, `S01`..`S06`):
- **Pre-Fix on `C0` (`bb0414b5bcf9d8edccd67ad2f098eb3b0d0faef9`)**: **17 failed | 23 passed (40 total)** (`logs/PRE_FIX_RED_C0.log`, `logs/PRE_FIX_RED_C0.json`).
- **Post-Fix on `C1` (`c856f5751f877e7249ea6739d41bf862922a003b`)**: **40 passed | 0 failed (40 total)** (`logs/POST_FIX_GREEN_C1.log`, `logs/POST_FIX_GREEN_C1.json`).

---

## 4. Full Regression Matrix on Exact `C1` (`c856f5751f877e7249ea6739d41bf862922a003b`)
| Step | Command | Exit | Files | Tests Passed | Log |
|---|---|---:|---:|---:|---|
| `A1` | `npx tsc --noEmit` | `0` | — | — | `logs/TSC_NO_EMIT_C1.log` |
| `A1B` | `npx eslint <patched files> --quiet` | `0` | — | — | `logs/ESLINT_PATCHED_FILES_C1.log` |
| `A1C` | `npx prisma validate` | `0` | — | — | `logs/PRISMA_VALIDATE_C1.log` |
| `A2` | `npx vitest run tests/unit/kh02/v19_3_3_2_CsvOriginAndGoogleUpstreamTrust.test.ts` | `0` | `1` | `40 / 40` | `logs/POST_FIX_GREEN_C1.log` |
| `A3` | `npx vitest run tests/unit/kh02/v19_3_3_1_CsvTrustAndGoogleMetaProvenance.test.ts` | `0` | `1` | `34 / 34` | `logs/V19_3_3_1_SUITE_C1.log` |
| `A4` | `npx vitest run tests/unit/kh02/g15CsvOriginIntegrity.test.ts` | `0` | `1` | `36 / 36` | `logs/G15_CSV_ORIGIN_SUITE_C1.log` |
| `A5` | `npx vitest run tests/unit/kh02/metaGoogleProductionFlowClosure.test.ts` | `0` | `1` | `14 / 14` | `logs/A5_meta_google_production_flow.log` |
| `B1` | `npm run kh02:test:unit -- --maxWorkers=2` | `0` | `108` | `2,566 / 2,566` | `logs/B1_kh02_unit_all.log` |
| `C1` | `npx vitest run tests/integration/kh02 --no-file-parallelism` | `0` | `16` | `77 / 77` | `logs/C1_kh02_integration.log` |
| `D1` | `npm run kh01:verify` | `0` | `5` | `69 / 69` | `logs/D1_kh01_regression.log` |
| `D2` | `npx tsx scripts/kh02/runBacktestV12_4_3_4_2.ts` | `0` | — | Policy `PASS` | `logs/D2_dev_holdout_backtest.log` |
| `D3` | `npx tsx scripts/kh02/runCandidateDbReadback.ts` | `0` | — | DB Readback `SUCCESS` | `logs/D3_db_readback.log` |
| `D4` | `VITEST=1 npx tsx scripts/kh02/runThreeSourceFreeMcpSmoke.ts` | `0` | — | `$0.00` Smoke `OK` | `logs/D4_free_mcp_smoke.log` |
| `E1` | `npm run build` | `0` | — | Next.js Build `OK` | `logs/NEXT_BUILD_C1.log` |
| **Total** | **All Distinct Test Suites on `C1`** | **`0`** | **`129`** | **`2,712 / 2,712`** | **0 failed, 0 skipped, 0 todo** |

---

## 5. Five-Axis Release Readiness Verdict
| Axis / Gate | Verdict | Details |
|---|---|---|
| `ENGINEERING_SECURITY_AND_PROVENANCE_GATES` | **`PASS`** | P1-A (CSV Official-Origin Binding v2) & P1-B (Google Upstream Trust Boundary) closed and verified across 2,712 tests |
| `CI_WORKFLOW_PROVIDER` | **`CI_PASS`** | GitHub Actions Run `42451749802` on `c856f5751f877e7249ea6739d41bf862922a003b` — 6/6 jobs green |
| `LIVE_GOOGLE_ADS_UPSTREAM` | **`LOCAL_MCP_VERIFIED_ONLY`** | FastMCP stdio handshake & local tool ledger verified; `upstreamOriginStatus = UPSTREAM_NOT_ATTESTED` |
| `LIVE_META_ADS_UPSTREAM` | **`DIAGNOSTIC_ONLY_NO_LIVE_QUERY`** | Public Ad Library Python collector runtime verified (`v1.7.0`); zero live query ads claimed |
| `G15_60_DAY_DEMAND_GATE` | **`INSUFFICIENT_EVIDENCE`** | `0` candidates have >=60 days of official Google Trends CSV exports with Schema v2 `BUSINESS` authority |
| `G16_TOP3_DISTINCT_PRODUCTS_GATE` | **`0/3` (`INSUFFICIENT_EVIDENCE`)** | `0/3` candidates eligible for verified Evergreen Top 3 release |
| `PRODUCTION_RELEASE_VERDICT` | **`RELEASE_HOLD`** | Held truthfully pending real >=60-day official Google Trends CSV exports and upstream-attested live creative observations |
