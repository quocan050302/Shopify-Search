# SWAI V11.5.9.1 — FUNCTION-BY-FUNCTION CHANGELOG

**Release:** SWAI V11.5.9.1 — Runtime Research Authorization Hotfix  
**Audited SHA:** `f00a50bb50ee305c838659d087f72102166163fa`  
**Target Branch:** `feature/v11-meta-collector-remove-muse`  

---

### Function 1: `resolveSwaiLaunchConfiguration()`

- **FILE:** `src/services/security/adminAuth.ts`
- **FUNCTION:** `resolveSwaiLaunchConfiguration(input?: SwaiLaunchConfigInput): SwaiLaunchConfiguration`
- **ROOT CAUSE:** Next.js CLI flag `-H` does not propagate `HOST` into `process.env`. Without a synchronized startup configuration resolver, server binding and security policy became desynchronized.
- **OLD BEHAVIOR:** Did not exist. Startup relied directly on raw `process.env.HOST` which was undefined during standard `npm start`.
- **NEW BEHAVIOR:** Resolves launch exposure (`LOCAL_DESKTOP` vs `AUTHENTICATED_REMOTE`), validates listener interface against security requirements, prevents invalid local/public bindings, and produces sanitized launch configuration.
- **INPUT CONTRACT:** `input?: SwaiLaunchConfigInput` ({ mode, exposure, host, port, requestedMode, requestedHost, requestedPort })
- **OUTPUT CONTRACT:** `SwaiLaunchConfiguration` ({ mode, listenerHost, port, authenticationRequired, valid, errors })
- **EXACT EXECUTION STEPS:**
  1. Inspects explicit exposure or requested mode.
  2. Resolves requested listener interface from parameters or environment.
  3. Validates that `LOCAL_DESKTOP` is strictly bound to loopback (`127.0.0.1`, `localhost`, `[::1]`).
  4. Collects configuration errors on mismatch.
  5. Determines whether authentication is required.
  6. Returns structured configuration.
- **SECURITY BOUNDARY:** Rejects non-loopback bindings attempting to declare `LOCAL_DESKTOP`.
- **ERROR HANDLING:** Returns `valid: false` and populated `errors` array without throwing.
- **CALLERS:** `scripts/startSwaiServer.ts`, unit test harness.
- **TEST FILE:** `tests/unit/swaiRuntimeAuthorization.test.ts`
- **TEST NAME:** `AUTH-02: Default local launcher resolves valid LOCAL_DESKTOP configuration`, `AUTH-13: Conflicting local/public launch configuration is rejected`
- **ACTUAL TEST RESULT:** PASS
- **EVIDENCE PATH:** `tests/unit/swaiRuntimeAuthorization.test.ts`
- **IMPLEMENTATION SHA:** `fa219e8fa981146a485e2211aca9f9f9d04d933d`

---

### Function 2: `assertLaunchBindingMatchesPolicy()`

- **FILE:** `src/services/security/adminAuth.ts`
- **FUNCTION:** `assertLaunchBindingMatchesPolicy(listenerHost: string, policy: DeploymentSecurityPolicy): void`
- **ROOT CAUSE:** Prior code permitted potential silent policy drift if an external caller invoked `resolveDeploymentSecurityPolicy` under inconsistent configuration.
- **OLD BEHAVIOR:** Did not exist.
- **NEW BEHAVIOR:** Enforces that a public interface (`0.0.0.0` or external IP) can never operate in `LOCAL_ONLY` mode.
- **INPUT CONTRACT:** `listenerHost: string`, `policy: DeploymentSecurityPolicy`
- **OUTPUT CONTRACT:** `void` (throws if invalid)
- **EXACT EXECUTION STEPS:**
  1. Canonicalizes `listenerHost`.
  2. Detects if host is public or unspecified.
  3. If public/unspecified and policy is `LOCAL_ONLY`, throws `CRITICAL SECURITY CONFLICT`.
- **SECURITY BOUNDARY:** Hard assertion failing closed immediately on configuration tampering.
- **ERROR HANDLING:** Throws descriptive security `Error`.
- **CALLERS:** `resolveDeploymentSecurityPolicy()`.
- **TEST FILE:** `tests/unit/swaiRuntimeAuthorization.test.ts`
- **TEST NAME:** `throws if policy allows local bypass on a non-loopback host`
- **ACTUAL TEST RESULT:** PASS
- **EVIDENCE PATH:** `tests/unit/swaiRuntimeAuthorization.test.ts`
- **IMPLEMENTATION SHA:** `fa219e8fa981146a485e2211aca9f9f9d04d933d`

---

### Function 3: `resolveDeploymentSecurityPolicy()`

- **FILE:** `src/services/security/adminAuth.ts`
- **FUNCTION:** `resolveDeploymentSecurityPolicy(config?: AdminAuthConfig): DeploymentSecurityPolicy`
- **ROOT CAUSE:** Looked only at `process.env.HOST`. If undefined, defaulted to `AUTHENTICATED_REMOTE` even when running locally on loopback.
- **OLD BEHAVIOR:** Looked only at `process.env.HOST`.
- **NEW BEHAVIOR:** Checks `process.env.HOST ?? process.env.HOSTNAME`. Asserts binding policy matches with `assertLaunchBindingMatchesPolicy`. Preserves strict remote fail-closed rules.
- **INPUT CONTRACT:** `config?: AdminAuthConfig`
- **OUTPUT CONTRACT:** `DeploymentSecurityPolicy` ({ mode, localBypassAllowed, configurationValid, reason })
- **EXACT EXECUTION STEPS:**
  1. Reads configured host from config or environment (`HOST` / `HOSTNAME`).
  2. Resolves binding mode (loopback vs public vs LAN vs cloud).
  3. Validates against conflicting flags (`SWAI_REMOTE_ACCESS`, cloud environments).
  4. Calls `assertLaunchBindingMatchesPolicy`.
  5. Returns authoritative policy.
- **SECURITY BOUNDARY:** Invariant 1: Unverified bindings always return `localBypassAllowed: false`.
- **ERROR HANDLING:** Returns fail-closed policy with `configurationValid: false` on conflict.
- **CALLERS:** `resolveTrustedRequestContext()`, `isTrustedLocalDeployment()`.
- **TEST FILE:** `tests/unit/adminAuthTrustBoundary.test.ts`, `tests/unit/swaiRuntimeAuthorization.test.ts`
- **TEST NAME:** `AUTH-01: Verified local 127.0.0.1 gives LOCAL_ONLY with bypass allowed`
- **ACTUAL TEST RESULT:** PASS
- **EVIDENCE PATH:** `tests/unit/adminAuthTrustBoundary.test.ts`
- **IMPLEMENTATION SHA:** `fa219e8fa981146a485e2211aca9f9f9d04d933d`

---

### Function 4: `resolveVerifiedServerBinding()`

- **FILE:** `src/services/security/adminAuth.ts`
- **FUNCTION:** `resolveVerifiedServerBinding(config?: AdminAuthConfig): { verifiedLoopback: boolean; mode: string; localBypassAllowed: boolean }`
- **ROOT CAUSE:** Required verified loopback detection for server socket audit.
- **OLD BEHAVIOR:** Existing function verified host loopback status.
- **NEW BEHAVIOR:** Maintained and verified against new launcher invariants.
- **INPUT CONTRACT:** `config?: AdminAuthConfig`
- **OUTPUT CONTRACT:** `{ verifiedLoopback: boolean; mode: DeploymentSecurityMode; localBypassAllowed: boolean }`
- **EXACT EXECUTION STEPS:**
  1. Inspects `resolveDeploymentSecurityPolicy(config)`.
  2. Returns loopback verification flags.
- **SECURITY BOUNDARY:** Never marks `0.0.0.0` or unspecified as verified loopback.
- **ERROR HANDLING:** Returns `verifiedLoopback: false` on failure.
- **CALLERS:** Admin trust boundary verifiers, server diagnostics.
- **TEST FILE:** `tests/unit/adminAuthTrustBoundary.test.ts`
- **TEST NAME:** `approves 127.0.0.1 as verified loopback`, `rejects unspecified host as unverified`
- **ACTUAL TEST RESULT:** PASS
- **EVIDENCE PATH:** `tests/unit/adminAuthTrustBoundary.test.ts`
- **IMPLEMENTATION SHA:** `fa219e8fa981146a485e2211aca9f9f9d04d933d`

---

### Function 5: `resolveTrustedRequestContext()`

- **FILE:** `src/services/security/adminAuth.ts`
- **FUNCTION:** `resolveTrustedRequestContext(request: NextRequest): TrustedRequestContext`
- **ROOT CAUSE:** Needed to ensure malicious remote requests cannot spoof `Host: localhost` or `X-Forwarded-For`.
- **OLD BEHAVIOR:** Checked deployment policy, forwarded headers, and hostname.
- **NEW BEHAVIOR:** Preserved strict verification. Rejects untrusted proxies and ensures loopback trust is only established when server listener is verified loopback.
- **INPUT CONTRACT:** `request: NextRequest`
- **OUTPUT CONTRACT:** `TrustedRequestContext` ({ deploymentMode, trustEstablished, authenticationRequired, reason })
- **EXACT EXECUTION STEPS:**
  1. Evaluates server deployment security policy.
  2. Inspects `x-forwarded-for` and `x-real-ip`; rejects remote proxy metadata.
  3. Confirms request target hostname matches verified listener.
  4. Returns trusted context.
- **SECURITY BOUNDARY:** Spoofed client headers can never establish local trust.
- **ERROR HANDLING:** Fails closed to `{ trustEstablished: false, authenticationRequired: true }`.
- **CALLERS:** `resolveAdminPrincipal()`.
- **TEST FILE:** `tests/unit/swaiRuntimeAuthorization.test.ts`
- **TEST NAME:** `AUTH-07: Remote request claiming Host localhost does not bypass auth`, `AUTH-08: Spoofed X-Forwarded-For cannot grant local bypass`
- **ACTUAL TEST RESULT:** PASS
- **EVIDENCE PATH:** `tests/unit/swaiRuntimeAuthorization.test.ts`
- **IMPLEMENTATION SHA:** `fa219e8fa981146a485e2211aca9f9f9d04d933d`

---

### Function 6: `resolveAdminPrincipal()`

- **FILE:** `src/services/security/adminAuth.ts`
- **FUNCTION:** `resolveAdminPrincipal(request: NextRequest): AdminAuthResult`
- **ROOT CAUSE:** Core security primitive evaluating credentials and local desktop policy.
- **OLD BEHAVIOR:** Verified token/cookie credentials, followed by loopback check.
- **NEW BEHAVIOR:** Preserved with zero weakening. When invalid credentials are provided, denies authorization immediately without falling back to local desktop bypass.
- **INPUT CONTRACT:** `request: NextRequest`
- **OUTPUT CONTRACT:** `AdminAuthResult` ({ authorized, principalId, authMode, code, message })
- **EXACT EXECUTION STEPS:**
  1. Extracts Bearer token or `swai_admin_token` cookie.
  2. If credentials present, validates against server secret (constant-time comparison).
  3. If credentials invalid, returns `{ authorized: false, code: "INVALID_ADMIN_TOKEN" }`.
  4. If credentials valid, returns `{ authorized: true, authMode: "OWNER_ADMIN" }`.
  5. If no credentials, checks `resolveTrustedRequestContext(request)`.
  6. If trusted local desktop, returns `{ authorized: true, authMode: "LOCAL_DEV" }`.
  7. Else returns `{ authorized: false, code: "ADMIN_AUTH_REQUIRED" }`.
- **SECURITY BOUNDARY:** Invalid tokens are always rejected; uncredentialed remote is always rejected.
- **ERROR HANDLING:** Returns structured non-authorized result.
- **CALLERS:** `validateAdminRequest()`.
- **TEST FILE:** `tests/unit/swaiRuntimeAuthorization.test.ts`
- **TEST NAME:** `AUTH-10: Invalid admin cookie is denied even on loopback`, `AUTH-11: Invalid Bearer token is denied even on loopback`
- **ACTUAL TEST RESULT:** PASS
- **EVIDENCE PATH:** `tests/unit/swaiRuntimeAuthorization.test.ts`
- **IMPLEMENTATION SHA:** `fa219e8fa981146a485e2211aca9f9f9d04d933d`

---

### Function 7: `validateAdminRequest()`

- **FILE:** `src/services/security/adminAuth.ts`
- **FUNCTION:** `validateAdminRequest(request: NextRequest): AdminAuthResult`
- **ROOT CAUSE:** Standard export for validating admin requests across all API routes.
- **OLD BEHAVIOR:** Invoked `resolveAdminPrincipal(request)`.
- **NEW BEHAVIOR:** Preserved as single authoritative entry point for admin verification.
- **INPUT CONTRACT:** `request: NextRequest`
- **OUTPUT CONTRACT:** `AdminAuthResult`
- **EXACT EXECUTION STEPS:** Delegates to `resolveAdminPrincipal(request)`.
- **SECURITY BOUNDARY:** Central authentication gateway.
- **ERROR HANDLING:** Consistent `AdminAuthResult`.
- **CALLERS:** `GET /api/v1/auth/status`, `resolveResearchPrincipal()`.
- **TEST FILE:** `tests/integration/metaResearchAuthorization.test.ts`
- **TEST NAME:** `Test F: Advisory /api/v1/auth/status endpoint returns accurate sanitized states`
- **ACTUAL TEST RESULT:** PASS
- **EVIDENCE PATH:** `tests/integration/metaResearchAuthorization.test.ts`
- **IMPLEMENTATION SHA:** `fa219e8fa981146a485e2211aca9f9f9d04d933d`

---

### Function 8: `resolveResearchPrincipal()`

- **FILE:** `src/services/research/researchAuthService.ts`
- **FUNCTION:** `resolveResearchPrincipal(request: NextRequest): Promise<ResearchPrincipal>`
- **ROOT CAUSE:** Bridges low-level admin authentication with research tenant ownership.
- **OLD BEHAVIOR:** Called `validateAdminRequest(request)`. Threw `ResearchAuthError` on failure.
- **NEW BEHAVIOR:** Preserved with exact error code mappings (`UNAUTHORIZED` for 401, `FORBIDDEN` for 403).
- **INPUT CONTRACT:** `request: NextRequest`
- **OUTPUT CONTRACT:** `Promise<ResearchPrincipal>` ({ principalId, authMode, isAuthenticated, allowedWorkspaceIds, role })
- **EXACT EXECUTION STEPS:**
  1. Calls `validateAdminRequest(request)`.
  2. If not authorized, throws `ResearchAuthError`.
  3. Queries allowed workspaces for principal.
  4. Returns `ResearchPrincipal`.
- **SECURITY BOUNDARY:** Ensures unauthenticated research access is prohibited.
- **ERROR HANDLING:** Throws `ResearchAuthError` with status 401 or 403.
- **CALLERS:** `resolveAuthorizedResearchContext()`.
- **TEST FILE:** `tests/integration/metaResearchAuthorization.test.ts`
- **TEST NAME:** `Test A: Local authorized deployment creates a research job (HTTP 202)`, `Test B: Remote unauthorized request is blocked with HTTP 401`
- **ACTUAL TEST RESULT:** PASS
- **EVIDENCE PATH:** `tests/integration/metaResearchAuthorization.test.ts`
- **IMPLEMENTATION SHA:** `fa219e8fa981146a485e2211aca9f9f9d04d933d`

---

### Function 9: `resolveAuthorizedResearchContext()`

- **FILE:** `src/services/research/researchAuthService.ts`
- **FUNCTION:** `resolveAuthorizedResearchContext(request: NextRequest): Promise<ResearchAccessContext>`
- **ROOT CAUSE:** Resolves authorized tenant context for research jobs.
- **OLD BEHAVIOR:** Validated workspace against principal permissions.
- **NEW BEHAVIOR:** Preserved; guarantees cross-workspace isolation.
- **INPUT CONTRACT:** `request: NextRequest`
- **OUTPUT CONTRACT:** `Promise<ResearchAccessContext>` ({ workspaceId, actorId, accessMode, principal })
- **EXACT EXECUTION STEPS:**
  1. Resolves `principal` via `resolveResearchPrincipal(request)`.
  2. Validates requested workspace ID against principal's allowed workspaces.
  3. Returns `ResearchAccessContext`.
- **SECURITY BOUNDARY:** Cross-tenant boundary enforcement.
- **ERROR HANDLING:** Throws `ResearchAuthError("UNAUTHORIZED_WORKSPACE", 403)` on tenant mismatch.
- **CALLERS:** `POST /api/v1/discovery/meta/requests`.
- **TEST FILE:** `tests/integration/metaResearchAuthorization.test.ts`
- **TEST NAME:** `Test D: Unauthorized workspace mutation is rejected with HTTP 403`
- **ACTUAL TEST RESULT:** PASS
- **EVIDENCE PATH:** `tests/integration/metaResearchAuthorization.test.ts`
- **IMPLEMENTATION SHA:** `fa219e8fa981146a485e2211aca9f9f9d04d933d`

---

### Function 10: `GET()` (Authorization Status Route)

- **FILE:** `src/app/api/v1/auth/status/route.ts`
- **FUNCTION:** `GET(request: NextRequest): Promise<NextResponse>`
- **ROOT CAUSE:** Frontend had no mechanism to query research authorization readiness prior to user action.
- **OLD BEHAVIOR:** Did not exist.
- **NEW BEHAVIOR:** Executes `validateAdminRequest(request)`. Returns HTTP 200 with sanitized `{ success, authorized, authMode, code, message }` and `Cache-Control: no-store`. Never leaks secrets.
- **INPUT CONTRACT:** `request: NextRequest`
- **OUTPUT CONTRACT:** `NextResponse` with JSON `{ success: boolean, authorized: boolean, authMode: string | null, code: string, message: string }`
- **EXACT EXECUTION STEPS:**
  1. Calls `validateAdminRequest(request)`.
  2. Sets headers: `Cache-Control: no-store, no-cache, max-age=0, must-revalidate`.
  3. Returns sanitized JSON.
- **SECURITY BOUNDARY:** Advisory UI endpoint only; zero mutation; zero secret exposure.
- **ERROR HANDLING:** Returns fail-closed `{ authorized: false, code: "SERVER_ERROR" }` on unhandled exception.
- **CALLERS:** `useMetaDiscovery.fetchAuthStatus()`.
- **TEST FILE:** `tests/integration/metaResearchAuthorization.test.ts`, `tests/integration/metaResearchAuthorizationHttp.test.ts`
- **TEST NAME:** `Test F: Advisory /api/v1/auth/status endpoint returns accurate sanitized states`
- **ACTUAL TEST RESULT:** PASS
- **EVIDENCE PATH:** `tests/integration/metaResearchAuthorizationHttp.test.ts`
- **IMPLEMENTATION SHA:** `fa219e8fa981146a485e2211aca9f9f9d04d933d`

---

### Function 11: `fetchResearchAuthorizationStatus()` / `fetchAuthStatus()`

- **FILE:** `src/hooks/useMetaDiscovery.ts`
- **FUNCTION:** `fetchAuthStatus(): Promise<ResearchAuthorizationStatus | null>`
- **ROOT CAUSE:** Hook needed to model user authorization independently from collector health.
- **OLD BEHAVIOR:** Did not exist.
- **NEW BEHAVIOR:** Queries `/api/v1/auth/status`, parses structured result, maps into `ResearchAuthorizationStatus`, updates hook state, and clears stale errors.
- **INPUT CONTRACT:** None (uses active workspace and browser context)
- **OUTPUT CONTRACT:** `Promise<ResearchAuthorizationStatus | null>`
- **EXACT EXECUTION STEPS:**
  1. Dispatches `GET /api/v1/auth/status` with `AbortController`.
  2. Maps API response into UI states: `AUTHORIZED_LOCAL`, `AUTHORIZED_SESSION`, `AUTH_REQUIRED`, `INVALID_CREDENTIALS`, `FORBIDDEN`, `UNAVAILABLE`.
  3. Updates `setAuthorization(...)`.
  4. Returns status.
- **SECURITY BOUNDARY:** Fails closed to `UNAVAILABLE` on network/parsing failure.
- **ERROR HANDLING:** Catches network errors without crashing; updates authorization state to `UNAVAILABLE`.
- **CALLERS:** `useMetaDiscovery()`, `refreshWorkspace()`, page recheck button.
- **TEST FILE:** `tests/e2e/metaResearchAuthorization.test.ts`
- **TEST NAME:** `Scenario 1: Local desktop authorized`, `Scenario 2: Remote unauthenticated`
- **ACTUAL TEST RESULT:** PASS
- **EVIDENCE PATH:** `tests/e2e/metaResearchAuthorization.test.ts`
- **IMPLEMENTATION SHA:** `fa219e8fa981146a485e2211aca9f9f9d04d933d`

---

### Function 12: `useMetaDiscovery()`

- **FILE:** `src/hooks/useMetaDiscovery.ts`
- **FUNCTION:** `useMetaDiscovery(): MetaDiscoveryHookResult`
- **ROOT CAUSE:** Frontend hook only fetched collector health and did not track authorization state or handle auth errors on submission.
- **OLD BEHAVIOR:** Only tracked provider health. On POST failure, put errors into `errors.mutation` and form keyword errors.
- **NEW BEHAVIOR:** Tracks `authorization` state, runs `fetchAuthStatus()` concurrently on mount/refresh, guards `createJob()` against unauthorized submission, handles 401/403 without corrupting keyword field, and marks jobs ledger errors accurately on auth rejection.
- **INPUT CONTRACT:** None (React Hook)
- **OUTPUT CONTRACT:** Extended hook object including `authorization` and `fetchAuthStatus`.
- **EXACT EXECUTION STEPS:**
  1. Initializes `authorization` state to `{ state: "CHECKING", authorized: false }`.
  2. Runs `fetchHealth()`, `fetchJobs()`, `fetchAuthStatus()` in parallel.
  3. In `createJob()`, blocks submission if `!authorization.authorized`.
  4. On 401/403 response, updates `authorization` and preserves form inputs.
- **SECURITY BOUNDARY:** Frontend defense-in-depth preventing futile unauthorized POSTs.
- **ERROR HANDLING:** Distinguishes ledger auth errors from empty lists; preserves user form input on failure.
- **CALLERS:** `MetaDiscoveryPage`.
- **TEST FILE:** `tests/e2e/metaResearchAuthorization.test.ts`
- **TEST NAME:** `Scenario 2 & 5: Remote unauthenticated -> Access Auth Required -> No POST sent`
- **ACTUAL TEST RESULT:** PASS
- **EVIDENCE PATH:** `tests/e2e/metaResearchAuthorization.test.ts`
- **IMPLEMENTATION SHA:** `fa219e8fa981146a485e2211aca9f9f9d04d933d`

---

### Function 13: `deriveAuthorizedResearchAction()`

- **FILE:** `src/lib/meta/researchActionPolicy.ts`
- **FUNCTION:** `deriveAuthorizedResearchAction(collector: NormalizedReadiness, authorization?: ResearchAuthorizationStatus): ResearchAction`
- **ROOT CAUSE:** Action derivation only inspected collector readiness and ignored user authorization.
- **OLD BEHAVIOR:** Did not consider authorization.
- **NEW BEHAVIOR:** Evaluates authorization first. If checking, requires auth, or has invalid credentials, returns non-submitting action (`kind: "WAIT"`, `kind: "SETUP"`, `enabled: false`) with actionable label.
- **INPUT CONTRACT:** `collector: NormalizedReadiness`, `authorization?: ResearchAuthorizationStatus`
- **OUTPUT CONTRACT:** `ResearchAction` ({ kind, label, enabled, buttonType })
- **EXACT EXECUTION STEPS:**
  1. Checks `authorization`. If `!authorization.authorized`, switches on `authorization.state`.
  2. Returns appropriate action (`Checking Access…`, `Authentication Required`, `Reconnect / Fix Credentials`, `Access Restricted`, `Retry Access Check`).
  3. If authorized, falls back to collector readiness derivation (`Start Research`, `Queue for Later`, `Configure Collector`).
- **SECURITY BOUNDARY:** Prohibits enabling research submission when unauthorized.
- **ERROR HANDLING:** Defaults to `Authentication Required` with `enabled: false` on unknown state.
- **CALLERS:** `MetaResearchForm`.
- **TEST FILE:** `tests/unit/researchActionPolicy.test.ts`, `tests/e2e/metaResearchAuthorization.test.ts`
- **TEST NAME:** `Scenario 2 & 5: Remote unauthenticated -> Access Auth Required -> No POST sent`
- **ACTUAL TEST RESULT:** PASS
- **EVIDENCE PATH:** `tests/e2e/metaResearchAuthorization.test.ts`
- **IMPLEMENTATION SHA:** `fa219e8fa981146a485e2211aca9f9f9d04d933d`

---

### Function 14: `MetaResearchForm()`

- **FILE:** `src/components/meta/MetaResearchForm.tsx`
- **FUNCTION:** `MetaResearchForm(props: MetaResearchFormProps): JSX.Element`
- **ROOT CAUSE:** Form displayed `Start Research` when unauthorized and put server auth errors into `formErrors.keywords`.
- **OLD BEHAVIOR:** Derived action only from collector readiness; set `formErrors.keywords = result.error`.
- **NEW BEHAVIOR:** Accepts `authorization` prop, derives authorized research action, honors `disabled={!researchAction.enabled}`, renders server errors in a dedicated `submissionError` banner, and preserves all user inputs on failure.
- **INPUT CONTRACT:** `MetaResearchFormProps` ({ readiness, authorization?, onRefreshAuth?, maxBudget, isSubmitting, onSubmit, onOpenSetupGuide? })
- **OUTPUT CONTRACT:** `JSX.Element`
- **EXACT EXECUTION STEPS:**
  1. Computes `effectiveAction` via `deriveAuthorizedResearchAction(readiness, authorization)`.
  2. Binds submit button to `effectiveAction.enabled`.
  3. On submit error, renders `submissionError` banner without setting `formErrors.keywords`.
  4. Clears inputs only upon confirmed HTTP 202 success.
- **SECURITY BOUNDARY:** Does not trigger POST when action is disabled.
- **ERROR HANDLING:** Preserves input values and shows distinct error banner.
- **CALLERS:** `MetaDiscoveryPage`.
- **TEST FILE:** `tests/e2e/metaResearchAuthorization.test.ts`
- **TEST NAME:** `Scenario 2 & 5: Remote unauthenticated -> Access Auth Required -> No POST sent -> Clean error presentation`
- **ACTUAL TEST RESULT:** PASS
- **EVIDENCE PATH:** `tests/e2e/metaResearchAuthorization.test.ts`
- **IMPLEMENTATION SHA:** `fa219e8fa981146a485e2211aca9f9f9d04d933d`

---

### Function 15: `MetaDiscoveryPage()`

- **FILE:** `src/app/meta-discovery/page.tsx`
- **FUNCTION:** `MetaDiscoveryPage(): JSX.Element`
- **ROOT CAUSE:** Page did not connect authorization state to header, form, or feedback banners.
- **OLD BEHAVIOR:** Passed only collector readiness to child components.
- **NEW BEHAVIOR:** Passes `authorization` to `MetaWorkspaceHeader` and `MetaResearchForm`. Renders actionable authorization advisory banner when unauthorized.
- **INPUT CONTRACT:** Client Component (no props)
- **OUTPUT CONTRACT:** `JSX.Element`
- **EXACT EXECUTION STEPS:**
  1. Obtains `authorization` and `fetchAuthStatus` from `useMetaDiscovery()`.
  2. Passes `authorization` to `MetaWorkspaceHeader`.
  3. If `!authorization.authorized && authorization.state !== "CHECKING"`, renders amber access advisory banner with `Recheck` button.
  4. Passes `authorization` and `onRefreshAuth` to `MetaResearchForm`.
- **SECURITY BOUNDARY:** Independent visual representation of user access vs collector operational status.
- **ERROR HANDLING:** Displays user-friendly instructions on authorization requirements.
- **CALLERS:** Next.js App Router (`/meta-discovery`).
- **TEST FILE:** `tests/e2e/metaResearchAuthorization.test.ts`
- **TEST NAME:** `Scenario 1`, `Scenario 2`, `Scenario 3 & 4`
- **ACTUAL TEST RESULT:** PASS
- **EVIDENCE PATH:** `tests/e2e/metaResearchAuthorization.test.ts`
- **IMPLEMENTATION SHA:** `fa219e8fa981146a485e2211aca9f9f9d04d933d`

---

### Function 16: `POST()` (Meta Research Request API Route)

- **FILE:** `src/app/api/v1/discovery/meta/requests/route.ts`
- **FUNCTION:** `POST(request: NextRequest): Promise<NextResponse>`
- **ROOT CAUSE:** Protected API endpoint creating Meta discovery jobs.
- **OLD BEHAVIOR:** Enforced `resolveAuthorizedResearchContext(request)` and failed closed.
- **NEW BEHAVIOR:** Preserved 100% of security checks, workspace verification, and zod validation. Confirmed compatibility with corrected local launcher and structured error contracts.
- **INPUT CONTRACT:** `request: NextRequest` (JSON body: keywords, market, requestedLimit)
- **OUTPUT CONTRACT:** `NextResponse` with HTTP 202 Accepted on success ({ success: true, runId, status, ... }), or HTTP 400/401/403 on rejection.
- **EXACT EXECUTION STEPS:**
  1. Executes `const context = await resolveAuthorizedResearchContext(request)`.
  2. Parses and validates JSON payload with `CreateMetaRequestSchema`.
  3. Verifies target workspace is within principal's authorized workspaces.
  4. Creates discovery job via `discoveryOrchestrator.createDiscoveryJob(...)`.
  5. Returns HTTP 202 Accepted with pending run ID.
- **SECURITY BOUNDARY:** Authoritative server-side authorization enforcement.
- **ERROR HANDLING:** Catches `ResearchAuthError` and maps to 401/403 with machine-readable error codes.
- **CALLERS:** `useMetaDiscovery.createJob()`.
- **TEST FILE:** `tests/integration/metaResearchAuthorization.test.ts`, `tests/integration/metaResearchAuthorizationHttp.test.ts`
- **TEST NAME:** `Test A: Local authorized deployment creates a research job (HTTP 202)`, `Test B: Remote unauthorized request is blocked with HTTP 401`
- **ACTUAL TEST RESULT:** PASS
- **EVIDENCE PATH:** `tests/integration/metaResearchAuthorizationHttp.test.ts`
- **IMPLEMENTATION SHA:** `fa219e8fa981146a485e2211aca9f9f9d04d933d`
