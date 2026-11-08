# 02 — CSV Acquisition Evidence Schema & Signature Audit (P1-A)

## 1. Root Cause Analysis of V19.3.3.1 P1-A Gap
In commit `bb0414b5bcf9d8edccd67ad2f098eb3b0d0faef9` (`C0`, code `79b248e79c56a0a549cc8d681fd6e67ad61762fc`):
1. **Omitted-Property Bypass at Creation (`durableCsvImportAuthority.ts` L661)**:
   `createSignedCsvImportAuthority` guarded the `acquisitionSourceUrl` check with:
   ```ts
   if (!isTest && input.acquisitionSourceUrl !== undefined) { ... }
   ```
   When a caller omitted `acquisitionSourceUrl` entirely (`input.acquisitionSourceUrl === undefined`), `createSignedCsvImportAuthority` succeeded and minted a `BUSINESS`-scope `AUTHENTICATED_OFFICIAL_EXPORT` authority record without any official acquisition URL.
2. **Unsigned / Unpersisted Acquisition Metadata**:
   `OfficialCsvImportAuthorityRecord` did not persist `acquisitionSourceUrl`, `acquisitionEvidenceRef`, `acquisitionCapturedAt`, or `acquisitionMethod`, and `computeCanonicalCsvAuthorityPayload` did not include them in the canonical HMAC-SHA256 digest. Post-signing mutation or deletion of `acquisitionSourceUrl` on disk could not be detected by HMAC verification.
3. **Missing Readback Re-Verification & Legacy v1 Handling**:
   `evaluateSingleCsvAuthorityRecord` did not re-verify `acquisitionSourceUrl` or `getAuthorizedCsvApproverPrincipals()` on readback, nor did it block legacy `schemaVersion: "1.0"` records lacking signed v2 acquisition evidence in `BUSINESS` scope.

## 2. V19.3.3.2 P1-A Production Fix (`c856f5751f877e7249ea6739d41bf862922a003b`)
1. **Unconditional URL Validation (`validateOfficialGoogleTrendsAcquisitionUrl`)**:
   - Enforced unconditionally for `!isTest && originClassification === "AUTHENTICATED_OFFICIAL_EXPORT" && reviewStatus === "APPROVED"`.
   - Rejects `undefined`, `null`, `""`, whitespace, `http://`, non-`trends.google.com` hosts, subdomains (`trends.google.com.evil.com`), userinfo (`user:pass@trends.google.com`), IP literals (`142.250.190.46`, `127.0.0.1`, `localhost`), custom ports (`:8443`), non-`/trends/` paths, mismatched `geo` query parameter (`ACQUISITION_GEO_MISMATCH`), and mismatched `q` query parameter (`ACQUISITION_QUERY_MISMATCH`).
2. **Schema Version `2.0` Canonical HMAC-SHA256 Binding**:
   - `CSV_AUTHORITY_SCHEMA_VERSION = "2.0"` with domain separator `SWAI_KH02_CSV_IMPORT_AUTHORITY_V2\n`.
   - Binds 33 canonical fields including `acquisitionSourceUrl`, `acquisitionEvidenceRef`, `acquisitionCapturedAt`, and `acquisitionMethod` into `computeCanonicalCsvAuthorityPayload` -> `payloadDigest` -> `authoritySignature`.
   - Preserves `schemaVersion: "1.0"` canonical verification (`SWAI_KH02_CSV_IMPORT_AUTHORITY_V1\n`) so legacy v1 records have their cryptographic signature checked first and are then deterministically rejected in `BUSINESS` scope as `ORIGIN_NOT_OFFICIAL_EXPORT` with zero silent re-signing.
3. **Readback Enforcement in `evaluateSingleCsvAuthorityRecord`**:
   - Recomputes `expectedDigest` and `expectedSigOverRecomputed = signCsvAuthorityPayloadDigest(expectedDigest, key.secret)`; any mutation of `acquisitionSourceUrl` or `acquisitionEvidenceRef` on disk fails closed with `code: "INVALID_SIGNATURE"` (`tamperDetected: true`).
   - Re-verifies `getAuthorizedCsvApproverPrincipals()` on readback in `BUSINESS` scope.
   - Re-verifies `record.schemaVersion === "2.0"` and `validateOfficialGoogleTrendsAcquisitionUrl(record.acquisitionSourceUrl, record.query, record.geography)` on readback in `BUSINESS` scope.
   - Keeps `providerOriginVerified: false` in all cases because local HMAC-SHA256 attests internal review/import integrity, not a Google LLC server signature.
