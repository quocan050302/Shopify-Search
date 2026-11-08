# 01 — Baseline Branch, HEAD, Code Tree & Trust Boundary Call Graph

## 1. Repository & Immutable Git Baseline
- **Repository**: `quocan050302/Shopify-Search`
- **Locked Branch**: `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`
- **Pre-Fix Baseline Commit (`C0`)**: `bb0414b5bcf9d8edccd67ad2f098eb3b0d0faef9`
- **Pre-Fix Baseline Tree (`C0`)**: `7e730979c772990d6e7e74979769c7f8f0f12f27`
- **Prior V19.3.3.1 Tested Code Commit**: `79b248e79c56a0a549cc8d681fd6e67ad61762fc`
- **Tested Code Commit (`C1`)**: `c856f5751f877e7249ea6739d41bf862922a003b`
- **Tested Code Tree (`C1`)**: `bfab7262eeef3ead2f3ccaad28a1eced3c78f9e9`
- **Worktree Cleanliness During `C1` Regression Execution**: `true` (`git status --porcelain=v1` empty)

## 2. Trust Boundary Call Graph & Identified Static-Audit Gaps in `C0`

### 2.1 P1-A: CSV Official-Origin Binding & Acquisition Evidence Call Graph
```
createSignedCsvImportAuthority(input)
  ├── getCsvAuthoritySigningKey(issuerKeyId, scope)
  │     ├── Env key (KH02_CSV_AUTHORITY_KEY_ID / KH02_CSV_AUTHORITY_HMAC_SECRET) -> isBusinessTrusted = (status === "ACTIVE")
  │     └── In-memory test key registry -> forced status="TEST_ONLY", isBusinessTrusted=false
  ├── getAuthorizedCsvApproverPrincipals() -> enforced unconditionally for !isTest
  ├── [GAP-1 IN C0, FIXED IN C1] validateOfficialGoogleTrendsAcquisitionUrl(input.acquisitionSourceUrl, input.query, input.geography)
  │     ├── In C0: guarded by `if (!isTest && input.acquisitionSourceUrl !== undefined)` -> omitted property bypassed validation!
  │     └── In C1: unconditionally enforced when `!isTest && originClassification === "AUTHENTICATED_OFFICIAL_EXPORT" && reviewStatus === "APPROVED"`.
  │                Strictly validates `https://trends.google.com/trends/...` via `new URL()`, rejects HTTP, foreign hosts, subdomains,
  │                userinfo (`user:pass@`), IP literals, custom ports, and mismatched `geo` / `q` parameters.
  ├── [GAP-2 IN C0, FIXED IN C1] computeCanonicalCsvAuthorityPayload(record)
  │     ├── In C0: `acquisitionSourceUrl`, `acquisitionEvidenceRef`, `acquisitionCapturedAt`, `acquisitionMethod` were NOT stored on record
  │     │          and NOT included in the HMAC-SHA256 canonical payload!
  │     └── In C1: Schema v2 (`schemaVersion: "2.0"`, domain separator `SWAI_KH02_CSV_IMPORT_AUTHORITY_V2\n`) persists and signs
  │                `acquisitionSourceUrl`, `acquisitionEvidenceRef`, `acquisitionCapturedAt`, `acquisitionMethod`.
  └── verifyDurableCsvImportAuthority(params) -> evaluateSingleCsvAuthorityRecord(record, ledger, params)
        ├── Recomputes `expectedDigest = computeCsvAuthorityPayloadDigest(record)`
        ├── Verifies `verifyCsvAuthoritySignature(signCsvAuthorityPayloadDigest(expectedDigest, key.secret), record.authoritySignature)`
        ├── [GAP-3 IN C0, FIXED IN C1] In `BUSINESS` scope:
        │     1. Re-verifies `getAuthorizedCsvApproverPrincipals()` includes `record.approverPrincipalId` on readback.
        │     2. Rejects legacy `schemaVersion === "1.0"` records as `ORIGIN_NOT_OFFICIAL_EXPORT` without silent re-signing.
        │     3. Re-validates `validateOfficialGoogleTrendsAcquisitionUrl(record.acquisitionSourceUrl, record.query, record.geography)`.
        └── Always returns `providerOriginVerified: false` (local HMAC-SHA256 is an internal review attestation, never a Google LLC signature).
```

### 2.2 P1-B: Google Ads Transparency MCP Upstream Provenance Call Graph
```
collectGoogleAdvertiserSignals / recordActualGoogleMcpInvocation(invocation, upstreamResponse)
  ├── decodeCallToolResult(upstreamResponse)
  │     ├── Enforces 2 MiB payload ceiling (`assertBoundedGoogleMcpPayloadSize`)
  │     └── [FIXED IN C1] Throws `MALFORMED_GOOGLE_MCP_JSON` when JSON-prefixed text (`{...` or `[...`) is malformed.
  ├── [GAP-4 IN C0, FIXED IN C1] Collision & Request ID Extraction
  │     ├── Detects if caller/response `request_id`/`providerRequestId` collides with `mcpInvocationRef`/`invocationId`
  │     │   (`collidesWithLocalInvocationId = true`, `providerRequestIdOrigin = "ABSENT"`, `upstreamProviderRequestId = null`).
  │     └── Sets `independentUpstreamCaptureVerified: false` on MCP tool invocation records.
  ├── attachGoogleMcpCreativeProvenance(rawCreative, invocationRecord)
  │     └── Quarantines any non-`LIVE_PROVIDER` (`CACHE`, `CACHED`, `CACHE_ONLY`) or cross-run record.
  └── verifyGoogleInvocationLineage(creative, invocationLedger, targetRunId, options)
        ├── Verifies `creative.workspaceId === matchedRecord.workspaceId` even when `options.expectedWorkspaceId` is omitted.
        ├── Verifies `matchedRecord.sourceMode === "LIVE_PROVIDER"` and rejects `collidesWithLocalInvocationId`.
        └── [GAP-5 IN C0, FIXED IN C1] `buildResult`:
              ├── Because an in-band MCP JSON `request_id` is controlled by the untrusted MCP response and is NOT an independent
              │   out-of-band Google cryptographic capture, `upstreamRequestVerified` and `providerVerified` remain strictly `false`
              │   (`provenanceTier: "LOCAL_MCP_TOOL_RESULT_VERIFIED"`, `upstreamOriginStatus: "UPSTREAM_NOT_ATTESTED"`).
              └── `persistGoogleObservationsToDatabase` persists `provenanceTier: "LOCAL_MCP_TOOL_RESULT_VERIFIED"`,
                  `providerVerified: false`, `upstreamRequestVerified: false`, `upstreamOriginStatus: "UPSTREAM_NOT_ATTESTED"`.
```
