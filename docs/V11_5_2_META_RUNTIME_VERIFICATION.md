# SWAI V11.5.2 — Meta Discovery Runtime & Action Policy Verification

**Release**: V11.5.2  
**Target Specification**: KH-01 Section 09 & 10  
**Baseline Tested**: `ab409d2a0e0ce560b4b2e7b62a62cdff21dc6a32`  
**Branch**: `feature/v11-meta-collector-remove-muse`  
**Mode**: `RESEARCH_ONLY` (US Market)

---

## 1. Executive Summary

In V11.5.1, the research submission button on `/meta-discovery` remained `type="submit"` even when the collector readiness state was `UNKNOWN`, `LOADING`, or `SETUP_REQUIRED`. This could lead to accidental form submission or misleading diagnostics actions.

V11.5.2 implements an explicit research action policy (`deriveResearchAction`) and binds form submission guards to both client-side and server-side boundaries.

---

## 2. Readiness State Machine & Button Behavior

| Normalized Readiness State | Effective Action Kind | Display Label | Button Type | Submission Enabled? | Target Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `READY` | `START` | "Start Research" | `submit` | **Yes** | Submits job for active collection |
| `WORKER_OFFLINE` | `QUEUE` | "Queue for Later" | `submit` | **Yes** (if durable queue allowed) | Creates job in queue for worker claim |
| `SETUP_REQUIRED` | `SETUP` | "Configure Collector" | `button` | **No** | Opens collector setup guide |
| `UNKNOWN` | `DIAGNOSTICS` | "Run Diagnostics" | `button` | **No** | Opens diagnostic modal |
| `LOADING` | `WAIT` | "Checking..." | `button` | **No** | Disabled button |
| `SOURCE_RESTRICTED` | `DIAGNOSTICS` / `QUEUE` | "Run Diagnostics" / "Queue" | Dependent on backend | **No** / Queued only | Prevents false immediate collection |

---

## 3. Server-Side Submission Guards

File: `src/app/api/v1/discovery/meta/requests/route.ts`
- Requires authorized workspace and authenticated principal.
- Rejects requests from unauthorized workspaces with HTTP 403 `UNAUTHORIZED_WORKSPACE`.
- Validates keyword list non-emptiness.
- Persists request in SQLite database with status `PENDING` (never falsely marked `COMPLETED` upon creation).

---

## 4. Test Results

### 4.1 Unit Test: `tests/unit/researchActionPolicy.test.ts`
- `returns START with submit button when READY`: **PASSED**
- `returns QUEUE with submit button when WORKER_OFFLINE and canQueueForLater is true`: **PASSED**
- `returns SETUP with non-submitting button when SETUP_REQUIRED`: **PASSED**
- `returns DIAGNOSTICS with non-submitting button when UNKNOWN`: **PASSED**
- `returns WAIT with disabled button when LOADING`: **PASSED**
- `returns DIAGNOSTICS with non-submitting button when SOURCE_RESTRICTED and cannot queue`: **PASSED**
- `defaults safely when readiness is undefined`: **PASSED**

### 4.2 Integration Test: `tests/integration/metaReadinessSubmission.test.ts`
- `allows submission and queues job when collector is operational`: **PASSED**
- `allows durable queueing when worker is offline if queueing is supported`: **PASSED**
- `rejects submission when workspace is not authorized`: **PASSED**
- `rejects submission when keywords payload is empty or invalid`: **PASSED**

### 4.3 Browser E2E Test: `tests/e2e/metaDiscoveryFinalAcceptance.test.ts`
- `renders Meta Discovery research page with truthful readiness action button`: **PASSED**
- `preserves keyword input upon typing and honors form submission boundaries`: **PASSED**
- `renders cleanly on mobile viewport (390 x 844) without horizontal overflow`: **PASSED**
