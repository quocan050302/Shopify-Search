# KH-01 V11.4.5 — Unified Continuous Journey (Queue-to-Browser) Acceptance

## Executive Summary
In KH-01 V11.4.4, separate tests validated HTTP transport and UI rendering, but did so using preseeded database records rather than executing the entire unbroken research pipeline from job queuing to browser rendering (Finding H).

In KH-01 V11.4.5, `tests/integration/kh01UnifiedJourney.test.ts` executes the complete, continuous end-to-end journey in an isolated environment without pre-seeding snapshots.

---

## 8-Stage Continuous Journey Verification

```
[1. Queue Job] 
       │ createLandingPageResearchJob()
       ▼
[2. Claim Job]
       │ claimPendingKh01Job() with fencing & token
       ▼
[3. Worker Execution]
       │ executeKh01Job() parses HTML & writes LandingPageSnapshot + CompetitorOfferSnapshot + Evidence
       ▼
[4. Isolated Server]
       │ startSwaiTestServer() launches Next.js on 127.0.0.1 against the same SQLite test database
       ▼
[5. Real HTTP Readback]
       │ verifyHttpServerReadback() fetches /api/v1/research/products/[id]/overview over loopback TCP
       │ Asserts exact matching snapshot IDs between worker output and HTTP response
       ▼
[6. Headless Browser]
       │ runBrowserE2E() launches Playwright Chromium to /products/[id]/intelligence
       │ Asserts UI displays worker-extracted price ($29.99), offer panel, landing page panel, 6 pillars
       ▼
[7. Economic Gating & Decision]
       │ Missing supplier cost enforces RESEARCH_MORE; persists ResearchDecision
       ▼
[8. Replay Idempotency]
       │ Re-executing completed job creates zero duplicate snapshots
```

---

## Detailed Step Results

1. **Step 1: Queues research job via production service**
   - API: `createLandingPageResearchJob`
   - Input: Product ID, Ad ID, target URL `https://cc.uprootclean.com/main/phr`, `forceRefresh: true`
   - Receipt Status: `QUEUED`, Database Status: `PENDING`
   - Result: **PASSED**

2. **Step 2: Claims queued job via production worker**
   - API: `claimPendingKh01Job("unified-journey-worker-1")`
   - Validated: `claimToken` generated, `attemptNumber === 1`, database status transitioned to `RUNNING`
   - Result: **PASSED**

3. **Step 3: Executes research job and persists real snapshots**
   - API: `executeKh01Job(claimedJob)`
   - Extracted: `sellingPrice: 29.99`, `currency: "USD"`
   - Database mutations:
     - `LandingPageSnapshot`: created and verified (`httpStatus: 200`, `accessStatus: "SUCCESS"`)
     - `CompetitorOfferSnapshot`: created and verified with price `$29.99 USD`
     - `ResearchEvidence`: created and associated with product
     - `SyncJob`: marked `COMPLETED` (`progress: 100`) referencing the generated snapshot ID
   - Result: **PASSED**

4. **Step 4: Starts Next.js test server on loopback**
   - API: `startSwaiTestServer({ databaseUrl, adminApiKey, mode: "production" })`
   - Health check: `GET /api/v1/health` returns HTTP 200 `success: true`
   - Result: **PASSED**

5. **Step 5: Verifies exact snapshot IDs via real HTTP API**
   - API: `verifyHttpServerReadback`
   - Network requests: Genuinely over TCP socket `http://127.0.0.1:<port>`
   - Authenticated: Validated with `ADMIN_API_KEY`
   - Assertions: `productIdVerified`, `jobIdVerified`, `snapshotIdsVerified`, `authorizationVerified` all `true`
   - Result: **PASSED**

6. **Step 6: Chromium browser validates UI displays worker-created data**
   - API: `runBrowserE2E`
   - Engine: Chromium headless
   - Assertions:
     - `productHeaderVerified`: Product title matches worker product
     - `pillarsVerified`: 6 pillars rendered
     - `offerPanelVerified`: Observed offer details ($29.99) rendered
     - `landingPagePanelVerified`: Landing page CRO observations rendered
     - `decisionPersistedVerified`: Decision persisted
   - Result: **PASSED**

7. **Step 7: Enforces economic gating and persists human research decision**
   - Algorithmic evaluation: `calculateOpportunityAssessment()`
   - Finding: Missing authentic supplier quote blocks `TEST_CANDIDATE`, returns `RESEARCH_MORE`
   - Mutation: Persisted `ResearchDecision` record
   - Readback: Verified decision persists in database
   - Result: **PASSED**

8. **Step 8: Replay idempotency verification**
   - Re-running `executeKh01Job` on the already completed job produced 0 additional snapshots
   - Initial count equals post-retry count
   - Result: **PASSED**

---

## Test Execution Summary
- Command: `npm run kh01:test:journey`
- Test File: `tests/integration/kh01UnifiedJourney.test.ts`
- Tests: 8 passed (8 total)
- Duration: 8.33 seconds
- Provenance: Authentically verified through production pipeline
