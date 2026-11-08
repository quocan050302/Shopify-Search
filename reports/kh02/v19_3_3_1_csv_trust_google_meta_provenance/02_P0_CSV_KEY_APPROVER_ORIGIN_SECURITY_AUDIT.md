# 02 — P0 CSV Key, Approver, and Origin Security Audit (KH-02 V12.4.3.7.19.3.3.1)

- **Tested Code Commit (`C1`)**: `79b248e79c56a0a549cc8d681fd6e67ad61762fc`
- **Tested Tree (`C1`)**: `afdf6da09961f358e9010fc0d4547ebcb6d56cbc`
- **Parent Baseline (`C0`)**: `b36c2e4b3704d8fc44a5d99a240da5caeda0dd1b`

---

## 1. P0 Vulnerabilities Identified on `C0` and Root-Cause Fixes in `C1`

### 1.1 P0-1: In-Process `registerCsvAuthoritySigningKey({ isBusinessTrusted: true })` Bypass
- **Vulnerability on `C0`**: [`registerCsvAuthoritySigningKey`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/durableCsvImportAuthority.ts#L283-L310) accepted caller-supplied `isBusinessTrusted: true` and `status: "ACTIVE"`, storing the key in `IN_MEMORY_KEY_REGISTRY` and returning it during `BUSINESS`-scope evaluation in [`getCsvAuthorityKeyRegistry`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/durableCsvImportAuthority.ts#L199-L263). Any in-process caller could mint an arbitrary key and sign a `BUSINESS`-scope G15 CSV authority record without server environment credentials.
- **Fix in `C1`**:
  1. `registerCsvAuthoritySigningKey` now throws `PRODUCTION_TEST_KEY_REGISTRATION_FORBIDDEN` when `NODE_ENV === "production"`, and throws `KEY_SHADOWING_FORBIDDEN` if a caller attempts to register the same `keyId` as `process.env.KH02_CSV_AUTHORITY_KEY_ID`.
  2. Every key registered via `registerCsvAuthoritySigningKey` is forced to `status: "TEST_ONLY"` (unless `REVOKED` or `COMPROMISED`) and `isBusinessTrusted: false`.
  3. `getCsvAuthorityKeyRegistry("BUSINESS")` only loads keys from server environment (`KH02_CSV_AUTHORITY_KEY_ID` + `KH02_CSV_AUTHORITY_HMAC_SECRET`), ignoring `IN_MEMORY_KEY_REGISTRY` for active business trust while still honoring `REVOKED`/`COMPROMISED` status overrides.

### 1.2 P0-2: Approver Allowlist Bypass When `KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS` Is Unset
- **Vulnerability on `C0`**: In [`createSignedCsvImportAuthority`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/durableCsvImportAuthority.ts#L646-L660) and [`verifyDurableCsvImportAuthority`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/durableCsvImportAuthority.ts#L1035-L1060), the approver allowlist check only ran if `authorizedApprovers.length > 0 || process.env.NODE_ENV === "production" || input.enforceApproverAuthority === true`. In non-production `BUSINESS` scope with `KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS` unset, any arbitrary `approverPrincipalId` was accepted.
- **Fix in `C1`**:
  1. In `createSignedCsvImportAuthority`, whenever `!isTest` (`BUSINESS` scope) or `input.enforceApproverAuthority === true`, `getAuthorizedCsvApproverPrincipals()` MUST be non-empty (`APPROVER_AUTHORITY_NOT_CONFIGURED`) and MUST contain `input.approverPrincipalId` (`UNAUTHORIZED_APPROVER`).
  2. In `verifyDurableCsvImportAuthority`, whenever `scope === "BUSINESS"`, `getAuthorizedCsvApproverPrincipals()` MUST be non-empty (`APPROVER_AUTHORITY_NOT_CONFIGURED`) and MUST contain `record.approverPrincipalId` (`UNAUTHORIZED_APPROVER`).

### 1.3 P0-3: Unverified Acquisition Source URL & Silent `productId` Substitution
- **Vulnerability on `C0`**:
  1. `createSignedCsvImportAuthority` and `verifyDurableCsvImportAuthority` did not validate `acquisitionSourceUrl` (`https://trends.google.com/...`) when supplied on a `BUSINESS`-scope `AUTHENTICATED_OFFICIAL_EXPORT`.
  2. [`temporalDemandEngine.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/temporalDemandEngine.ts#L4481) (`obs.productId ?? expectedProductId`) and [`historicalDemandIngestion.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/demand/historicalDemandIngestion.ts#L1217) (`r.productId || targetProductId`) silently substituted `targetProductId` onto observations whose `productId` was `null`/`undefined`.
  3. [`kh02PersistenceService.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/kh02/persistence/kh02PersistenceService.ts#L140-L152) (`requalifyHistoricalEvergreenSnapshot`) did not pass `asOfTimestamp` (`snapshot.createdAt`) into `hasVerifiableCsvOrProviderLineage`, allowing a CSV imported after a historical run to retroactively verify that historical snapshot.
- **Fix in `C1`**:
  1. Added `acquisitionSourceUrl` validation (`^https://trends\.google\.com/` with `geo=US` when `geo=` is present) in both `createSignedCsvImportAuthority` (`ACQUISITION_SOURCE_REQUIRED`) and `verifyDurableCsvImportAuthority` (`ORIGIN_NOT_OFFICIAL_EXPORT`).
  2. Removed silent `productId` substitution in `temporalDemandEngine.ts` and `historicalDemandIngestion.ts`, and added explicit rejection in `evaluateDemandSourceAuthority` when an observation lacks `productId` in `BUSINESS` / strict provenance scope.
  3. Passed `asOfTimestamp` (`snapshot.createdAt`) and `candidateId` into `hasVerifiableCsvOrProviderLineage` in `requalifyHistoricalEvergreenSnapshot`.

### 1.4 P0-4: Symlinked Ledger File / Storage Directory Protection
- **Vulnerability on `C0`**: `readCsvAuthorityLedgerUnderLock` and `writeCsvAuthorityLedgerUnderLock` did not inspect `fs.lstatSync` on the storage directory or ledger file path, allowing a symlinked ledger file to redirect authority reads/writes.
- **Fix in `C1`**: Added `fs.lstatSync(dir).isSymbolicLink()` and `fs.lstatSync(p).isSymbolicLink()` checks in both `readCsvAuthorityLedgerUnderLock` and `writeCsvAuthorityLedgerUnderLock`, returning `LEDGER_UNREADABLE` fail-closed.

---

## 2. Explicit Cryptographic Honesty Invariant

All local Google Trends CSV exports do **not** carry a cryptographic signature from Google LLC servers. Therefore:
- Even when `verifyDurableCsvImportAuthority` returns `verified: true`, `sourceOriginVerified: true`, and `businessEligible: true` (attesting internal HMAC-SHA256 approval record integrity, allowlisted principal review, raw SHA-256 disk parity, and query/geography/cadence bindings), **`providerOriginVerified` is ALWAYS `false`**.
- Raw local CSV files in `data/google_trends_imports/*.csv` without a valid authority record are classified strictly as `LOCAL_INTEGRITY_ONLY` (`verified: false`, `businessEligible: false`).
