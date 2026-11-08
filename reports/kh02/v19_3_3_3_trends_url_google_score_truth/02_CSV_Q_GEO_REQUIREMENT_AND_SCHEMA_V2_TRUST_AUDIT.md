# KH-02 V12.4.3.7.19.3.3.3 — CSV `q` & `geo` Requirement & Schema v2 Trust Audit

## 1. Root Cause Audited on Baseline `C0` (`af1f6d0dcdbecc18ebbd3736f07c365b830f5b39`)

In `src/services/kh02/demand/durableCsvImportAuthority.ts` on `C0`:
1. **Optional `geo` parameter**: `if (parsedUrl.searchParams.has("geo")) { ... }` allowed `https://trends.google.com/trends/explore` or `https://trends.google.com/trends/explore?q=cat%20feeder` (missing `geo`) to pass `validateOfficialGoogleTrendsAcquisitionUrl()`.
2. **Optional `q` parameter**: `if (parsedUrl.searchParams.has("q") && expectedQuery && expectedQuery.trim()) { ... }` allowed `https://trends.google.com/trends/explore?geo=US` (missing `q`) to pass `validateOfficialGoogleTrendsAcquisitionUrl()`.
3. **Substring `q` matching**: `if (urlQ && expQ && !urlQ.includes(expQ) && !expQ.includes(urlQ))` accepted prefix/substring queries (`q=cat` when `expectedQuery="cat feeder"`) and superstring queries (`q=cat feeder accessories` when `expectedQuery="cat feeder"`).
4. **Duplicate query parameters (`getAll`)**: `parsedUrl.searchParams.get("geo")` and `parsedUrl.searchParams.get("q")` returned only the first occurrence, allowing ambiguous duplicate parameters (`?geo=US&geo=GB` or `?q=cat%20feeder&q=dog%20toy`).

---

## 2. Hardened Implementation on `C1` (`4ac0df13cb190aac01ce6094caa299f0da1defe0`)

In `validateOfficialGoogleTrendsAcquisitionUrl(rawUrl, expectedQuery, expectedGeo)` (`src/services/kh02/demand/durableCsvImportAuthority.ts`, lines `259–357`):

1. **Strict Origin & Path**:
   - `parsedUrl.origin.toLowerCase() === "https://trends.google.com"`
   - `parsedUrl.protocol === "https:"`
   - `parsedUrl.hostname.toLowerCase() === "trends.google.com"`
   - `parsedUrl.username === "" && parsedUrl.password === "" && parsedUrl.port === ""`
   - `/^\/trends\/explore(?:\/|$)/i.test(parsedUrl.pathname)`
   - Fragment-only parameters (`https://trends.google.com/trends/explore#?geo=US&q=cat%20feeder`) leave `parsedUrl.searchParams` empty and are rejected.

2. **Mandatory Single `geo` Parameter**:
   - `const geoValues = parsedUrl.searchParams.getAll("geo");`
   - `geoValues.length === 0` -> throws `ACQUISITION_GEO_REQUIRED`.
   - `geoValues.length > 1` -> throws `AMBIGUOUS_ACQUISITION_PARAMETERS`.
   - Blank/whitespace `rawGeo` -> throws `ACQUISITION_GEO_REQUIRED`.
   - Double-encoded (`/%[0-9a-fA-F]{2}/`) or comma-separated `rawGeo` -> throws `AMBIGUOUS_ACQUISITION_PARAMETERS`.
   - `normalizeCsvAuthorityGeography(rawGeo)` must equal `normalizeCsvAuthorityGeography(expectedGeo || "US")` and `"US"` -> otherwise throws `ACQUISITION_GEO_MISMATCH` (rejecting `"GB"`, `"CA"`, `"US-CA"`, `"WORLDWIDE"`).

3. **Mandatory Single `q` Parameter with Whole-Term Normalized Equality**:
   - `const qValues = parsedUrl.searchParams.getAll("q");`
   - `qValues.length === 0` -> throws `ACQUISITION_QUERY_REQUIRED`.
   - `qValues.length > 1` -> throws `AMBIGUOUS_ACQUISITION_PARAMETERS`.
   - Blank/whitespace `rawQ` -> throws `ACQUISITION_QUERY_REQUIRED`.
   - Double-encoded (`/%[0-9a-fA-F]{2}/`) or multi-keyword comma-separated (`rawQ.includes(",")`) -> throws `AMBIGUOUS_ACQUISITION_PARAMETERS`.
   - `const urlQ = normalizeCsvAuthorityQuery(rawQ);`
   - `const expQ = normalizeCsvAuthorityQuery(expectedQuery);`
   - Requires `urlQ === expQ` (exact normalized whole-term match) -> otherwise throws `ACQUISITION_QUERY_MISMATCH`.

---

## 3. Schema v2 Canonical Digest & Readback Enforcement

- **Issuance (`createSignedCsvImportAuthority`)**:
  - Any `AUTHENTICATED_OFFICIAL_EXPORT` with `!isTestOnly` must pass `validateOfficialGoogleTrendsAcquisitionUrl(input.acquisitionSourceUrl, input.query, input.geography)` before signing.
  - `computeCsvAuthorityPayloadDigest` binds `schemaVersion: "2.0"`, `acquisitionSourceUrl`, `acquisitionEvidenceRef`, `acquisitionCapturedAt`, and `acquisitionMethod` into the canonical JSON payload signed via `HMAC-SHA256`.
- **Readback (`verifyDurableCsvImportAuthority`)**:
  - Rejects legacy `schemaVersion !== "2.0"` in `BUSINESS` scope (`LEGACY_SCHEMA_VERSION_NOT_BUSINESS_ELIGIBLE`).
  - Re-computes `computeCsvAuthorityPayloadDigest` and verifies `signature` in constant time (`crypto.timingSafeEqual`).
  - Re-executes `validateOfficialGoogleTrendsAcquisitionUrl(record.acquisitionSourceUrl, record.query, record.geography)` on readback so any previously persisted record missing `q` or `geo` (even if its HMAC signature matches its stored fields) fails closed (`ORIGIN_NOT_OFFICIAL_EXPORT`, `verified: false`, `businessEligible: false`).
  - Always preserves `providerOriginVerified: false` because a local server HMAC attests internal operator review/import governance, never a cryptographic signature from Google LLC.
