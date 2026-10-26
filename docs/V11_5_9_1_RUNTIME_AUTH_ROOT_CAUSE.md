# SWAI V11.5.9.1 — RUNTIME RESEARCH AUTHORIZATION ROOT CAUSE ANALYSIS & HOTFIX REPORT

**Project:** Shopify Winning Ads Intelligence (SWAI)  
**Version:** V11.5.9.1 Hotfix  
**Repository:** `quocan050302/Shopify-Search`  
**Branch:** `feature/v11-meta-collector-remove-muse`  
**Base SHA:** `f00a50bb50ee305c838659d087f72102166163fa`  
**Incident:** Runtime `UNAUTHORIZED` on Start Research (`/meta-discovery`)  

---

## 1. How the Application Was Launched

In production and local environments, the service was started using `pnpm start` (or `npm start` / `pnpm run dev`), which resolved to:

```json
{
  "dev": "next dev -H 127.0.0.1",
  "start": "next start -H 127.0.0.1"
}
```

This started the Next.js process with CLI arguments specifying the listener host (`-H 127.0.0.1`).

---

## 2. Actual Configured Server Host

Next.js CLI flag `-H 127.0.0.1` binds the internal HTTP server to `127.0.0.1`. However, passing `-H` on the CLI does **not** populate `process.env.HOST` or `process.env.HOSTNAME` inside the Node.js runtime environment.

Consequently, from Node's perspective:
- `process.env.HOST === undefined`
- `process.env.HOSTNAME === undefined`

---

## 3. Actual Next.js Bind Host

- **Physical Socket Binding:** `127.0.0.1:<PORT>` (verified TCP loopback listener).
- **Environment State:** Unset / undefined.

---

## 4. Actual Security Policy Evaluated at Runtime

The server authorization boundary in `src/services/security/adminAuth.ts` resolved the deployment policy via:

```typescript
const host = (
  config?.host ??
  process.env.HOST ??
  process.env.HOSTNAME ??
  ""
).trim().toLowerCase();
```

Because `host` was empty string `""`, `resolveDeploymentSecurityPolicy()` correctly failed closed according to security rules:

```typescript
mode: "AUTHENTICATED_REMOTE",
localBypassAllowed: false,
configurationValid: true,
reason: "Unspecified listener interface requires authentication"
```

The system interpreted the missing environment host as an untrusted, remote deployment.

---

## 5. Admin API Key Configuration Status

- In standard local desktop environments, `ADMIN_API_KEY` was not configured by the desktop user (which is expected under the local desktop zero-config contract).
- In remote environments, `ADMIN_API_KEY` is set in the server environment.

---

## 6. Admin Credentials Supplied by Browser

The browser accessed `http://localhost:3000/meta-discovery` without custom authorization headers or cookies. No `Authorization: Bearer ...` header or `swai_admin_token` cookie was provided.

---

## 7. Real HTTP Status & Body

When clicking **Start Research**, the browser dispatched:

```http
POST /api/v1/discovery/meta/requests HTTP/1.1
Host: localhost:3000
Content-Type: application/json

{"keywords":["gadget"],"market":"US","requestedLimit":25}
```

The server responded:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Cache-Control: no-store

{
  "success": false,
  "error": "UNAUTHORIZED",
  "message": "Administrator authorization required."
}
```

---

## 8. Real Error Code

- Internal security error code: `ADMIN_AUTH_REQUIRED`
- API payload error code: `UNAUTHORIZED`
- HTTP Status: `401 Unauthorized`

---

## 9. Exact Function That Denied Authorization

The rejection chain occurred sequentially:
1. `src/app/api/v1/discovery/meta/requests/route.ts` invoked:
   ```typescript
   const context = await resolveAuthorizedResearchContext(request);
   ```
2. `resolveAuthorizedResearchContext` in `src/services/research/researchAuthService.ts` called:
   ```typescript
   const principal = await resolveResearchPrincipal(request);
   ```
3. `resolveResearchPrincipal` called `validateAdminRequest(request)`.
4. `validateAdminRequest` called `resolveAdminPrincipal(request)`.
5. `resolveAdminPrincipal` called `resolveTrustedRequestContext(request)`.
6. `resolveTrustedRequestContext` called `resolveDeploymentSecurityPolicy()`.
7. `resolveDeploymentSecurityPolicy()` returned `localBypassAllowed: false` because `process.env.HOST` was undefined.
8. `resolveAdminPrincipal` returned `{ authorized: false, code: "ADMIN_AUTH_REQUIRED" }`.
9. `resolveResearchPrincipal` threw `new ResearchAuthError("...", "UNAUTHORIZED", 401)`.

---

## 10. Why the Frontend Still Displayed "Start Research" & Showed "UNAUTHORIZED" on Keyword Field

There were two coupled defects in the frontend:

1. **Lack of Independent Authorization Readiness Check:**
   `useMetaDiscovery.ts` previously only polled `GET /api/v1/discovery/meta/provider/health`. Because the Meta provider daemon was operational, health returned `READY`. The UI conflated collector readiness (`READY`) with user authorization readiness, deriving `Start Research` as enabled without checking if the user was authorized to submit research.

2. **Error State Misplacement:**
   When the POST failed with 401, `MetaResearchForm.tsx` executed:
   ```typescript
   setFormErrors({ keywords: result.error });
   ```
   This assigned the server's `"UNAUTHORIZED"` string to `formErrors.keywords`, causing the keyword validation `<p>` tag directly beneath the input to render:
   ```text
   UNAUTHORIZED
   ```
   Authentication errors were thus wrongly presented as keyword validation failures.

---

## 11. Which Functions Were Changed & Added

1. **`scripts/startSwaiServer.ts` (NEW):**
   A safe, cross-platform TypeScript launcher that validates listener security, ensures `HOST` (`127.0.0.1`), `SWAI_DEPLOYMENT_MODE`, and Next.js `-H` flags are identical and tamper-proof.
2. **`package.json`:**
   Updated `dev`, `dev:local`, `dev:remote`, `start`, `start:local`, `start:remote` scripts to execute via `scripts/startSwaiServer.ts`.
3. **`src/services/security/adminAuth.ts`:**
   - Added `SwaiLaunchConfigInput` & `SwaiLaunchConfiguration`.
   - Added `resolveSwaiLaunchConfiguration()` to ensure startup environment and listener parameters synchronize cleanly.
   - Added `assertLaunchBindingMatchesPolicy()` to fail closed if a public interface claims `LOCAL_ONLY`.
   - Updated `resolveDeploymentSecurityPolicy()` to check both `HOST` and `HOSTNAME` and enforce launch binding invariants.
   - Added `getResearchAuthorizationDiagnostics()` to provide sanitized diagnostics without secret leakage.
4. **`src/app/api/v1/auth/status/route.ts` (NEW):**
   A dedicated advisory endpoint providing `{ authorized, authMode, code, message }` using the authoritative `validateAdminRequest()` backend logic.
5. **`src/lib/meta/researchActionPolicy.ts`:**
   Added `ResearchAuthorizationStatus` and `deriveAuthorizedResearchAction()`. Authorization readiness now takes strict precedence over collector operational readiness.
6. **`src/hooks/useMetaDiscovery.ts`:**
   - Added `authorization` state and `fetchAuthStatus()`.
   - Prohibits submitting research when `authorization.authorized` is false.
   - Separated auth error reporting from form errors.
   - Preserves keyword values and filters on failure.
   - Accurately reports ledger access denial on 401/403.
7. **`src/components/meta/MetaResearchForm.tsx`:**
   - Evaluates `deriveAuthorizedResearchAction(readiness, authorization)`.
   - Added `submissionError` state to display server errors in a dedicated banner.
   - Preserves all input state on failure.
   - Disables submit button and shows "Authentication Required" when unauthorized.
8. **`src/components/meta/MetaWorkspaceHeader.tsx`:**
   - Displays dual status badges: `Collector: Operational` and `Access: Local Desktop` (or `Authorized` / `Auth Required`).
9. **`src/app/meta-discovery/page.tsx`:**
   - Renders access status and advisory guidance banner when authentication is required.

---

## 12. Why the Fix Does Not Weaken Remote Security

The hotfix strictly adheres to the KH-01 security invariants:
- **No Insecure Development Shortcuts:** Does not bypass auth based on `NODE_ENV === "development"`.
- **Fail-Closed Default:** If `HOST` is undefined, `0.0.0.0`, a LAN IP, or a cloud platform, `localBypassAllowed` remains `false`.
- **No Header Spoofing Vulnerability:** Remote requests asserting `Host: localhost` or spoofed `X-Forwarded-For` / `X-Real-IP` are rejected by `resolveTrustedRequestContext()`.
- **Invalid Credentials Still Blocked:** An invalid `swai_admin_token` cookie or Bearer token is immediately rejected with HTTP 403, and never downgraded to `LOCAL_DEV`.
- **Advisory Only Status Endpoint:** `/api/v1/auth/status` does not alter server state; protected routes (`/api/v1/discovery/meta/requests`) continue to execute full server-side authorization enforcement.

---

## 13. Actual HTTP Test Results

Executed via `tests/integration/metaResearchAuthorizationHttp.test.ts` against real Next.js server instances:
- **Local Desktop:** Real Next.js server bound to `127.0.0.1` -> `/api/v1/auth/status` returns HTTP 200 `authorized: true`, `authMode: "LOCAL_DEV"` -> POST `/api/v1/discovery/meta/requests` returns HTTP 202 Accepted -> SQLite `discoveryRun` persisted with exact keywords `gadget`, `US`, limit 25.
- **Remote Negative Test:** Real Next.js server in `REMOTE` mode -> `/api/v1/auth/status` returns `authorized: false`, `code: "ADMIN_AUTH_REQUIRED"` -> POST returns HTTP 401 Unauthorized -> Zero database mutation verified.
- **Result:** 2/2 tests passed (5075ms).

---

## 14. Actual Browser Test Results

Executed via `tests/e2e/metaResearchAuthorization.test.ts` using real Chromium:
- **Scenario 1 (Local Authorized):** Access badge displays `Access: Local Desktop`. `Start Research` enabled. Enters `gadget`, selects 25 ads, clicks Start Research. Receives HTTP 202, displays "Research task queued successfully", creates 1 job in SQLite.
- **Scenario 2 & 5 (Remote Unauthorized):** Access badge displays `Access: Auth Required`. Button displays `Authentication Required` and is disabled. No POST sent. Advisory banner displayed. Keyword field does NOT display `UNAUTHORIZED` error.
- **Scenario 3 & 4 (Invalid Credential & Recovery):** Stale cookie rejected with `Access: Invalid Token`. Updating cookie to valid token and rechecking immediately transitions Access to `Authorized`, enables `Start Research`, and allows submission with HTTP 202.
- **Result:** 3/3 tests passed (3973ms).
