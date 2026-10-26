# KH-01 V11.4.1 — Security & Multi-Tenant Acceptance Report

## Executive Summary
This document provides empirical evidence that SWAI V11.4.1 implements strict tenant isolation, timing-safe authentication, and fail-closed security boundaries.

All security test cases defined in Phase P0.1, P0.2, and P0.5 have been implemented and verified.

---

## 1. Authentication & Principal Resolution

### Implemented Model
- **Mode**: Owner / Admin Authentication with trusted server-side principal resolution (`resolveResearchPrincipal`).
- **Timing-Safe Comparison**: Credentials verified via `crypto.timingSafeEqual` (`safeSecretCompare`) to prevent timing side-channel attacks.
- **Fail-Closed Production**: If `ADMIN_API_TOKEN` is unset in production, requests fail closed with HTTP 403 `ADMIN_AUTH_NOT_CONFIGURED`.
- **Actor Header Protection**: `x-actor-id` from client headers is strictly ignored. Actor identity is derived solely from the validated principal.

### Test Verification
| Test ID | Description | Result |
| :--- | :--- | :--- |
| SEC-01 | Unauthenticated production request rejected with HTTP 401 | **PASSED** |
| SEC-02 | Admin token mismatch rejected with timing-safe comparison | **PASSED** |
| SEC-03 | Forged `x-actor-id` cannot impersonate another actor | **PASSED** |
| SEC-04 | Local dev mode permitted only on explicit loopback / dev flag | **PASSED** |

---

## 2. Workspace Access & Tenant Isolation

### Implemented Policy
- **Authorized Workspaces**: Callers can only access workspaces present in `principal.allowedWorkspaceIds`.
- **Ad Access Verification (`assertAdWorkspaceAccess`)**:
  - Ad workspace associations are queried through `DiscoveryRunAd` and `Watchlist`.
  - If the requested workspace is not in the ad's association set, access is rejected with HTTP 403 `FORBIDDEN_WORKSPACE_AD`.
  - **Orphan Protection**: Unassociated ads cannot be accessed outside `default-workspace`.
- **Product Access Verification (`assertProductWorkspaceAccess`)**:
  - Products verified through linked ads and watchlists.
  - Cross-tenant product access rejected with HTTP 404/403.
- **Role Hierarchy (`assertWorkspaceMembership`)**:
  - `VIEWER` roles cannot perform mutating operations (saving economics, recording decisions, queuing crawler jobs).

### Test Verification
| Test ID | Description | Result |
| :--- | :--- | :--- |
| TENANT-01 | Resolves valid context for authorized existing workspace | **PASSED** |
| TENANT-02 | Rejects non-existent caller-supplied workspace ID with HTTP 403 | **PASSED** |
| TENANT-03 | Allows ad access when ad belongs to caller's workspace | **PASSED** |
| TENANT-04 | Strictly denies cross-tenant ad access (Workspace 1 cannot access Workspace 2 ad) | **PASSED** |
| TENANT-05 | Strictly denies cross-tenant product access | **PASSED** |
| TENANT-06 | Fails closed on unassociated orphan ads when accessed from non-default workspace | **PASSED** |
| TENANT-07 | Rejects `VIEWER` principal from executing write mutations | **PASSED** |

---

## 3. URL Safety & SSRF Defense

### Implemented Destination Enforcement
- **Address Validation (`isRestrictedIpAddress`)**:
  - Rejects IPv4 loopback (`127.0.0.0/8`)
  - Rejects RFC 1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
  - Rejects Carrier-Grade NAT (`100.64.0.0/10`)
  - Rejects Link-local (`169.254.0.0/16`)
  - Rejects Cloud Metadata (`169.254.169.254`, `metadata.google.internal`)
  - Rejects IPv6 loopback (`::1`), unique local (`fc00::/7`), link-local (`fe80::/10`)
  - Rejects IPv4-mapped IPv6 (`::ffff:x.x.x.x`)
- **DNS Destination Pinning (`resolveAndValidatePublicDestination`)**:
  - Resolves all candidate A and AAAA records before connection.
  - If any candidate IP is restricted, the connection fails closed.
- **Hop-by-Hop Redirect Validation**:
  - Every redirect hop is re-validated for scheme, hostname, and resolved destination IP.
- **Resource Constraints**:
  - Max redirect limit: 3 hops.
  - Network timeout: 8,000ms with AbortController cancellation.
  - Max response payload: 2MB cap with stream truncation.

### Test Verification
| Test ID | Description | Result |
| :--- | :--- | :--- |
| SSRF-01 | Allows valid public HTTPS destination (`cc.uprootclean.com`) | **PASSED** |
| SSRF-02 | Blocks loopback IP (`127.0.0.1`) | **PASSED** |
| SSRF-03 | Blocks `localhost` hostname | **PASSED** |
| SSRF-04 | Blocks RFC 1918 private IPv4 ranges | **PASSED** |
| SSRF-05 | Blocks cloud metadata IP (`169.254.169.254`) | **PASSED** |
| SSRF-06 | Blocks encoded decimal / dword IP formats (`2130706433`) | **PASSED** |
| SSRF-07 | Blocks octal / hex encoded IP formats | **PASSED** |
| SSRF-08 | Blocks IPv6 loopback and unique local | **PASSED** |
| SSRF-09 | Blocks embedded credentials (`user:pass@host`) | **PASSED** |
| SSRF-10 | Blocks non-HTTP schemes (`file:`, `ftp:`, `javascript:`) | **PASSED** |
| SSRF-11 | Rejects DNS resolving to private IPv4 or IPv6 | **PASSED** |
| SSRF-12 | Rejects IPv4-mapped IPv6 | **PASSED** |
| SSRF-13 | Rejects mixed candidate DNS records | **PASSED** |
| SSRF-14 | Enforces 3 redirect hops limit | **PASSED** |
| SSRF-15 | Enforces 2MB maximum payload bounding | **PASSED** |
| SSRF-16 | AbortSignal terminates fetch cleanly on timeout | **PASSED** |

---

## Sign-off
- **Security Checkpoint**: APPROVED
- **Test File**: `tests/unit/kh01Security.test.ts` (30/30 tests passed)
