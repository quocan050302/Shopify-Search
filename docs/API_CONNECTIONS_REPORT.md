# SWAI API Connections & Credential Management Specification

## Overview
This document specifies the secure server-side API credential management interface introduced in **SWAI Settings → API Connections**.

---

## 1. Supported Providers

| Provider | Environment Variable | Key Format | Test Method | Primary Use Case |
|---|---|---|---|---|
| **Google Gemini AI** | `GEMINI_API_KEY` | `AIzaSy...` | Live call to `model.generateContent()` | Multimodal video analysis, hook evaluation, script generation |
| **Meta Ad Library** | `META_AD_LIBRARY_ACCESS_TOKEN` | `EAAB...` | Live query to `/ads_archive` + `/me/permissions` | Ad search & observation across Facebook & Instagram |
| **Captapi Ads Intelligence** | `CAPTAPI_KEY` | `capt_live_...` | Live query to `https://api.captapi.com/v1/account/balance` (0 credits) | Third-party ad intelligence and cross-platform extraction |
| **Shopify Store** | N/A | N/A | Disabled | **NOT_CONNECTED** (Pre-Shopify Research Mode) |

---

## 2. Security Architecture

1. **Server-Side Only Storage:**
   - Credentials are stored exclusively in `.env.local` located in the root server directory (`process.cwd()`).
   - File permissions are set to `0o600` (readable/writable by owner only).
   - Dynamic in-memory registration ensures changes take effect immediately without server restarts.

2. **Zero Client Leakage:**
   - Raw credentials are **NEVER** returned in any HTTP response payload.
   - Frontend GET requests receive only masked representations (e.g. `••••••••••••3a9f`).
   - Zero storage in `localStorage`, `sessionStorage`, or cookies.

3. **Git Hygiene & Exclusion:**
   - `.env.local`, `.env*`, `.connection-status.json`, and `.credentials*` are strictly excluded in `.gitignore`.
   - No credentials are ever saved in Git history or pushed to remote repositories.

4. **Strict Verification State Machine:**
   - `NOT_CONFIGURED`: No credential present.
   - `KEY_PRESENT_UNVERIFIED`: Key saved on server, but live API test has not yet run.
   - `CONNECTED`: Verified only after an authenticated API test request returns HTTP 200 with valid payload.
   - `ERROR`: Authentication or permission failure with exact error code and missing scopes displayed.

5. **Meta US Commercial Ad Discovery Policy Notice:**
   - Meta's automated Ad Library API (`ads_archive`) in the United States requires explicit business verification and individual identity review.
   - Standard access covers political and social issue ads.
   - SWAI explicitly labels US Commercial Ad Discovery as `RESTRICTED BY META POLICY` and guides users to utilize SWAI's Manual URL Import for commercial ad research.

---

## 3. Endpoints

- **`GET /api/v1/settings/credentials`**
  - Returns connection states and masked keys for all providers. Never returns raw keys.
- **`POST /api/v1/settings/credentials`**
  - Securely writes key to `.env.local` and updates server environment in memory.
- **`DELETE /api/v1/settings/credentials`**
  - Removes provider key from `.env.local` and server environment.
- **`POST /api/v1/settings/credentials/test`**
  - Runs live authenticated request against the provider's API.
  - Returns latency (ms), connection status, missing permissions, and capability checklist.
