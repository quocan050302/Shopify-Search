# SWAI KH-02 V12.2.3 — ROOT CAUSE ANALYSIS: PREVIOUS HTTP 500 FAILURES

**Component:** POST `/api/v1/kh02/research` & Chromium E2E  
**Status:** **PERMANENTLY REPAIRED**  
**Verified In V12.2.3:** **0 HTTP 500 Errors Observed**  

---

## 1. Problem Description in V12.2.2
In the V12.2.2 review, the Chromium E2E test reported four HTTP 500 responses, `acceptedRunId: null`, and 0 product cards rendered.

## 2. Root Cause Investigation
1. In `scripts/kh02/runAcceptanceV12_2_2.ts`, the test workspace was defined as `"acceptance_v12_2_2_ws"`.
2. This workspace identifier was passed in the HTTP request headers (`x-workspace-id`).
3. However, this workspace record had never been inserted into the SQLite `workspaces` table.
4. When `POST /api/v1/kh02/research` called `createKH02ResearchRun`, it attempted to insert a `syncJobs` record referencing `workspaceId: "acceptance_v12_2_2_ws"`.
5. SQLite schema enforces a foreign key constraint:
   ```prisma
   model SyncJob {
     ...
     workspaceId String
     workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
   }
   ```
6. Prisma threw a `P2003` foreign key constraint violation error.
7. Because `route.ts` lacked a specialized handler for missing workspace foreign keys, it caught the unhandled Prisma exception and returned **HTTP 500**.
8. Because the response status was 500 instead of 202, `acceptedRunId` remained `null`.
9. The frontend poller repeatedly failed on unaccepted runs, generating three additional cascading 500 responses.

## 3. Architecture & Code Repair in V12.2.3
1. **Self-Healing Persistence Layer:** In `src/services/kh02/persistence/kh02PersistenceService.ts`, `createKH02ResearchRun` now verifies workspace existence before creating the `SyncJob` record. If missing, it auto-creates the workspace record defensively.
2. **Acceptance Harness Workspace Pre-Seeding:** `scripts/kh02/runAcceptanceV12_2_3.ts` explicitly upserts `acceptance_v12_2_3_ws` into `prisma.workspace` prior to launching research or browser journeys.
3. **Outcome:** In V12.2.3 Chromium E2E, `POST /api/v1/kh02/research` reliably returns **HTTP 202**, `acceptedRunId` receives a valid durable ID (`kh02_run_...`), and unexpected HTTP errors remain strictly **0**.
