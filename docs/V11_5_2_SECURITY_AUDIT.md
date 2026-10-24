# SWAI V11.5.2 — Security Audit & Trust Boundary Verification

**Release**: V11.5.2  
**Target Specification**: KH-01 Section 05 & 06  
**Audited Baseline**: `ab409d2a0e0ce560b4b2e7b62a62cdff21dc6a32`  
**Branch**: `feature/v11-meta-collector-remove-muse`  
**Mode**: `RESEARCH_ONLY` (US Market)

---

## 1. Executive Summary

This audit assesses the security boundary refactoring implemented in SWAI V11.5.2. Two major vulnerability classes have been completely remediated:
1. **P1 — Insecure Loopback Trust Assumption via Client Headers**: Elimination of header-based loopback spoofing in `src/services/security/adminAuth.ts`.
2. **P1 — Multi-Tenant Workspace Bypass via Legacy Ads API**: Enforcement of tenant scoping across `GET /api/v1/ads`, `POST /api/v1/ads`, and `GET /api/v1/ads/:id`.

---

## 2. Threat Model & Trust Boundary Analysis

### 2.1 The Header Spoofing Vulnerability (Remediated)
- **Vulnerability**: In previous versions, `isDemonstrablyLocalLoopback(request)` inspected `request.headers.get("host")`, `x-forwarded-for`, and `x-real-ip`. If a remote caller connected through a reverse proxy or public ingress, injecting `Host: localhost:3000` or omitting forwarded headers could cause the server to treat the remote caller as a local administrator.
- **Root Cause**: Conflating transport trust (actual network peer binding) with request-layer HTTP headers.
- **Remediation**:
  1. Introduced `isTrustedLocalDeployment()`: Examines server configuration directly (`SWAI_DEPLOYMENT_MODE`, `SWAI_REMOTE_ACCESS`, cloud environments `VERCEL`, `RENDER`, `FLY_APP_NAME`, `K_SERVICE`, and server binding `0.0.0.0`).
  2. Introduced `resolveTrustedRequestContext(request)`: Fails closed immediately if the server is in remote mode. Strictly rejects any request containing remote client IPs in `x-forwarded-for` or `x-real-ip`.
  3. Introduced `resolveAdminPrincipal(request)`: Uses constant-time `crypto.timingSafeEqual` (`safeSecretCompare`) for bearer tokens, `x-admin-token`, and cookies.
  4. Local desktop access on loopback without tokens is preserved only when the server environment confirms local desktop mode.

### 2.2 Legacy Ads Endpoint Exposure (Remediated)
- **Vulnerability**: `GET /api/v1/ads` invoked `searchCompetitorAds()` without providing `workspaceId`. Any tenant could query this endpoint and inspect competitor ads belonging to other workspaces.
- **Root Cause**: Incomplete migration when multi-tenant workspace isolation was introduced for Global Search and Evergreen APIs in V11.5.1.
- **Remediation**:
  1. `GET /api/v1/ads` now calls `resolveAuthorizedResearchContext(request)` to obtain the validated workspace ID.
  2. Calls `searchAuthorizedCompetitorAds(context, filters)` which automatically merges `buildAuthorizedAdWhere(context.workspaceId)` with all query filters using `AND` semantics.
  3. `POST /api/v1/ads` requires an authorized research context and attaches the imported ad to the caller's default "Imported Ads" watchlist.
  4. `GET /api/v1/ads/:id` invokes `assertAdWorkspaceAccess(id, researchContext)`, rejecting cross-workspace inspection with HTTP 403 `FORBIDDEN_WORKSPACE_AD`.

---

## 3. Security Verification Matrix

| Test ID | Scenario | Expected Result | Observed Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| `SEC-01` | Genuine loopback desktop request | `LOCAL_DEV` authorized | Authorized as `local_dev_admin` | **PASS** |
| `SEC-02` | Valid `ADMIN_API_KEY` Bearer token | `OWNER_ADMIN` authorized | Authorized as `admin_owner` | **PASS** |
| `SEC-03` | Invalid Bearer token on localhost | HTTP 403 `INVALID_ADMIN_TOKEN` | Rejected (403) | **PASS** |
| `SEC-04` | Remote mode request without token | HTTP 401 `ADMIN_AUTH_REQUIRED` | Rejected (401) | **PASS** |
| `SEC-05` | Spoofed `Host: localhost:3000` from remote | Rejected | `trustEstablished: false` | **PASS** |
| `SEC-06` | Spoofed `x-forwarded-for: 203.0.113.195` | Rejected | `reason: remote IP` | **PASS** |
| `SEC-07` | Spoofed `x-real-ip: 198.51.100.10` | Rejected | `reason: x-real-ip non-loopback` | **PASS** |
| `SEC-08` | Public server binding `0.0.0.0` | Rejected | `isTrustedLocalDeployment: false` | **PASS** |
| `SEC-09` | Workspace A querying `GET /api/v1/ads` | Only Workspace A ads returned | Only Workspace A ads returned | **PASS** |
| `SEC-10` | Workspace B querying `GET /api/v1/ads` | Only Workspace B ads returned | Only Workspace B ads returned | **PASS** |
| `SEC-11` | Workspace A requesting details of Workspace B ad | HTTP 403 `FORBIDDEN_WORKSPACE_AD` | Rejected (403) | **PASS** |
| `SEC-12` | Unauthenticated credential mutation | HTTP 401 `ADMIN_AUTH_REQUIRED` | Rejected (401) | **PASS** |

---

## 4. Test Suite References

- `tests/unit/adminAuthTrustBoundary.test.ts` (17 tests, 100% pass)
- `tests/integration/adminAccessSecurity.test.ts` (4 tests, 100% pass)
- `tests/integration/legacyAdsWorkspaceIsolation.test.ts` (5 tests, 100% pass)
- `tests/integration/kh01HttpServerE2E.test.ts` (3 tests, 100% pass)

---

## 5. Security Verdict

**Result**: **APPROVED**  
No unresolved P0 or P1 security defects remain. Transport security and tenant isolation are enforced at the server-side architectural boundary.
