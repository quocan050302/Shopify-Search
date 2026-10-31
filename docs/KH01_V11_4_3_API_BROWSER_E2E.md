# KH-01 V11.4.3 — Real HTTP API & Browser Acceptance Verification

## 1. Overview
Previously, `apiReadbackVerified: true` was set simply after a direct Prisma query (`prisma.researchProduct.findUnique()`). A database read is NOT an HTTP API readback. Furthermore, browser acceptance was sometimes conflated with unit test status.

## 2. Verification Isolation in V11.4.3
In V11.4.3:
1. **Independent Verification Flags**:
   - `databaseReadbackVerified`: boolean (asserts direct Prisma relationships, foreign keys, snapshots, and evidence).
   - `httpApiReadbackVerified`: boolean (asserts real HTTP responses from Next.js Route Handlers).
   - `browserReadbackVerified`: boolean | "NOT_RUN" (marked `NOT_RUN` when headless browser session is not invoked, avoiding false pass claims).
2. **Real HTTP API Verification**:
   - `verifyHttpApiReadback()` invokes production Next.js Route Handlers (`GET /api/v1/research/products/:id/overview` and `GET /api/v1/research/jobs/:jobId`) using `NextRequest`.
   - Asserts:
     - HTTP 200 OK.
     - Authenticated context resolution via `x-workspace-id`.
     - `data.product.id` matches target product ID.
     - `data.latestLandingPage.id` matches the stored `LandingPageSnapshot.id`.
     - `data.jobId` matches the claimed `SyncJob.id`.
   - `httpApiReadbackVerified` is set to `true` strictly when all HTTP assertions succeed.
3. **Production Opportunity Aggregation**:
   - Replaced handcrafted scoring inputs in E2E with production `buildProductOpportunityInput(productId, context)`.
   - Enforces economic gating: when supplier costs (COGS) are unknown, algorithmic test readiness is blocked (`RESEARCH_MORE`).

## 3. Test Verification
Verified via:
- `npm run kh01:acceptance` (PASSED with 10/10 steps, `httpApiReadbackVerified: true`, `databaseReadbackVerified: true`).
- `tests/integration/kh01RealE2E.test.ts` (PASSED).
