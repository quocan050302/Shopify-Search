# KH-01 V11.4.4 — Real HTTP Server Acceptance Report

**Date**: 2026-10-24  
**Target Version**: V11.4.4  
**Branch**: `feature/v11-meta-collector-remove-muse`  

---

## 1. Executive Summary & Verification Gap Addressed
In previous versions (V11.4.3), `verifyHttpApiReadback()` in `scripts/kh01RealE2E.ts` created synthetic `NextRequest` instances in-process and invoked `getProductOverviewRoute()` directly. This proved that route handlers execute, but did **not** prove:
1. That a Next.js server can successfully start, bind to a network port, and serve requests over HTTP.
2. That standard HTTP networking, TCP/IP stack handling, connection timeouts, and headers function properly.
3. That security primitives (such as HTTP Bearer token validation and 401/403 negative rejection) hold over the wire.

In V11.4.4, we have decoupled test levels:
- **`ROUTE_HANDLER_TEST`**: Direct in-process execution via `verifyRouteHandlerReadback()`.
- **`HTTP_SERVER_E2E`**: Real HTTP/1.1 exchanges over `127.0.0.1:<port>` via `verifyHttpServerReadback()`.
- **`BROWSER_E2E`**: Full headless browser DOM rendering and interaction.

---

## 2. Implemented Architecture

### Test Server Lifecycle Harness: `startSwaiTestServer`
- **Location**: `tests/e2e/helpers/startSwaiTestServer.ts`
- **Port Allocation**: Dynamically reserves an open loopback port via an ephemeral Node `net.createServer()` instance on `127.0.0.1`.
- **Database Safety Guard**: Enforces `assertSafeTestDatabase()` before spawning, verifying that `TEST_DATABASE_URL` is an isolated SQLite database and does not collide with `dev.db`.
- **Server Process**: Spawns Next.js (`node_modules/next/dist/bin/next start` or `dev`) with `SWAI_DB_ROLE=INTEGRATION_TEST`, `SWAI_E2E_SERVER=true`, and strict isolation.
- **Readiness Polling**: Polls `/api/v1/health` until HTTP 200 is received with a 30s bounded timeout.
- **Teardown**: Gracefully signals `SIGTERM` with fallback to `SIGKILL`.

### Real HTTP Verifier: `verifyHttpServerReadback`
- **Location**: `scripts/kh01/verifyHttpServerReadback.ts`
- **Loopback Enforcement**: Asserts target hostname is `127.0.0.1`, `localhost`, or `[::1]`.
- **Negative Authentication Assertion**: Performs HTTP GET without valid credentials, asserting that the server returns HTTP 401 (missing credentials) or HTTP 403 (invalid token).
- **Positive Readback**:
  - `GET /api/v1/research/products/:id/overview` with `Authorization: Bearer <secret>` and `x-workspace-id: <workspaceId>`.
  - `GET /api/v1/research/jobs/:jobId` with authenticated context.
- **Snapshot ID Reconciliation**: Verifies that the `latestLandingPage.id` and `offerSnapshots[0].id` in the HTTP response match the database snapshot IDs.

---

## 3. Test Evidence & Results
- **Suite**: `tests/integration/kh01HttpServerE2E.test.ts`
- **Test Results**:
  - `verifies health check over actual HTTP transport`: **PASSED** (8ms)
  - `rejects unauthorized HTTP requests (negative authentication)`: **PASSED** (11ms, verified 401 for missing auth and 403 for invalid token)
  - `successfully reads back product overview and reconciles snapshots via actual HTTP`: **PASSED** (48ms, verified snapshot ID reconciliation)
- **Total Duration**: ~1.11s.
- **Commit Target**: Checkpoint 1 (`test(kh01): verify research APIs through a real Next.js server`).
