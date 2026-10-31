# SWAI KH-02 V12.1.4.2 — RESEARCH TIMEOUT ROOT CAUSE & DIAGNOSIS

**Date:** 2026-10-26T21:26:30Z  
**Component:** `src/app/products/page.tsx`, `src/workers/kh02Worker.ts`, `src/app/api/v1/kh02/research`  
**Target:** Elimination of False-Positive Frontend Timeout Failures  

---

## 1. Problem Statement

A user navigating to `http://127.0.0.1:3000/products` entered:
- **Niche:** Pet Gadgets
- **Market:** United States
- **Lookback:** 90D
- **Action:** Analyze Evergreen Niche

After exactly 60 seconds of waiting, the frontend threw:
```text
Research execution timed out waiting for worker snapshot.
```

---

## 2. Technical Investigation & Root Cause Breakdown

### Cause 1: Rigid Polling Loop Bounded at 60 Attempts in `src/app/products/page.tsx`
Lines 148–178 of `src/app/products/page.tsx`:
```typescript
const pollJobExecution = async (runId: string) => {
  let attempts = 0;
  const maxAttempts = 60;
  while (attempts < maxAttempts) {
    await new Promise((r) => setTimeout(r, 1000));
    attempts++;
    try {
      const runRes = await fetch(`/api/v1/kh02/research/runs/${runId}`);
      if (runRes.ok) {
        const runJson = await runRes.json();
        const status = runJson.data?.status;
        if (status === "COMPLETED" || status === "PARTIALLY_COMPLETED") {
          ...
          return;
        } else if (status === "FAILED") {
          throw new Error(runJson.data?.errorMessage || "Background research job failed.");
        }
      }
    } catch (err: any) { ... }
  }
  throw new Error("Research execution timed out waiting for worker snapshot.");
};
```
- **Flaw:** The frontend equated "60 seconds elapsed without terminal snapshot" to "The research failed".
- In reality, broad multi-platform competitor analysis across 90D or 365D (querying Meta, TikTok, Google MCP, and evaluating 15+ candidate SKUs) regularly takes between 45s and 120s depending on network latency and rate limits.
- When the 60th attempt finished, the frontend threw an unhandled exception, setting `researchError = "Research execution timed out waiting for worker snapshot."` and stopping the spinner, even while the backend worker was actively and legitimately processing the job.

### Cause 2: Separate Process Architecture Without Local Worker Supervision
- In development (`npm run dev`), `scripts/startSwaiServer.ts` only executes Next.js (`next dev`).
- The research worker (`src/workers/kh02Worker.ts`) is designed to run in a standalone daemon process via `npm run kh02:worker`.
- When users run `npm run dev`, no background worker was automatically spawned or supervised.
- As a consequence, `POST /api/v1/kh02/research` inserted a persistent `SyncJob` with `status: "PENDING"`, but no consumer was polling the queue.
- The job sat in `PENDING` indefinitely, and after 60 seconds, the frontend timed out.

### Cause 3: In-Memory Process-Local Worker Health Telemetry
- `getResearchWorkerHealth()` in `src/workers/kh02Worker.ts` tracked health variables in memory:
  ```typescript
  let isRunning = false;
  let activeJobId: string | null = null;
  let lastHeartbeat: string | null = null;
  ```
- Because Next.js runs in a distinct Node.js process from the worker, the Next.js API server had no cross-process visibility into whether a worker was actually running.
- The UI could not warn the user that the worker was offline, leading to a misleading timeout instead of an actionable diagnostic.

### Cause 4: Complete Loss of Research Context on Browser Reload
- The active `runId` was held solely in React component state (`pollJobExecution(runId)` in a local async function).
- If the user reloaded the page, navigated away, or switched tabs, the polling loop was terminated.
- On remount, `src/app/products/page.tsx` only called `fetchLatestLeaderboard()`, with no mechanism to discover or resume polling the active job.

### Cause 5: Incomplete Run Metadata in HTTP GET `/api/v1/kh02/research/runs/[runId]`
- `getKH02ResearchRunById` in `src/services/kh02/persistence/kh02PersistenceService.ts` omitted:
  - `errorMessage`: causing failed runs to display generic errors.
  - `startedAt` / `completedAt`: preventing the UI from computing actual duration.
  - `stage` progress: leaving the UI unaware of what stage the worker was currently executing.

---

## 3. Architecture Resolution

1. **Durable Asynchronous Job Tracking (`useKH02ResearchJob`):**
   - Decouple the frontend observation lifecycle from the backend job execution lifecycle.
   - Frontend polling must NEVER mark a job as failed due to a timer.
   - When polling reaches a threshold (e.g. 60s), switch to an unobtrusive background tracking mode:
     `"Research is taking longer than usual but is still running in the background. You can leave this page and return later."`
   - Store the active `runId` in session/local storage for the workspace.

2. **Workspace Active Job Recovery on Mount:**
   - Add endpoint `GET /api/v1/kh02/research/active` (or check on mount).
   - On page load, if an active job (`PENDING` or `RUNNING`) exists for this workspace, immediately resume tracking it without prompting the user to submit duplicate research.

3. **Database-Backed Observable Worker Heartbeat:**
   - Persist worker heartbeats in SQLite using `SyncJob` with `jobType: "KH02_WORKER_HEARTBEAT"` (mirroring KH-01).
   - Compute status:
     - `ALIVE`: Last heartbeat <= 30 seconds ago.
     - `STALE`: Last heartbeat between 30 and 60 seconds ago.
     - `OFFLINE`: Last heartbeat > 60 seconds ago or record absent.
   - Implement `GET /api/v1/kh02/worker/status` so Next.js and the UI can verify worker presence.
   - If a job is `PENDING` and the worker is `OFFLINE`, display:
     `"Research queued — background worker is not running. Start 'npm run kh02:worker' to begin processing."`

4. **Rich Stage & Progress Telemetry:**
   - Worker updates `SyncJob.progress` and `stage` (`QUEUED`, `WAITING_FOR_WORKER`, `COLLECTING_ADS`, `MATCHING_PRODUCTS`, `SCORING`, `SAVING_RESULTS`, `COMPLETED`).
   - `getKH02ResearchRunById` exposes `stage`, `startedAt`, `completedAt`, and `errorMessage`.
