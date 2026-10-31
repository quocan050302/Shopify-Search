# SWAI KH-02 V12.1.3 — Function Dependency & Job-Writer Map

## Research Execution Flow
```text
UI (/products)
  ↓ POST { mode: "async" }
Route Handler (src/app/api/v1/kh02/research/route.ts)
  ↓ Enqueue PENDING
SyncJob Table (SQLite)
  ↓ Atomic Claim (claimNextResearchJob)
Worker (src/workers/kh02Worker.ts)
  ↓ Heartbeat + Progress (updateJobIfClaimOwned)
Pure Orchestrator (src/services/kh02/evergreenResearchOrchestrator.ts)
  ↓ Source Collection & Scoring
Worker Terminal Commit (completeResearchJob)
  ↓ Immutable Snapshot
SyncJob Table
  ↓ HTTP Readback (GET /runs/[runId])
UI Polling Resolution (pollJobExecution)
```

## Job-State Writer Classification
1. `claimNextResearchJob` (Worker): Owned atomic transition (PENDING -> RUNNING).
2. `updateJobIfClaimOwned` (Worker): Owned atomic CAS with `fencingGeneration` and `recordVersion`.
3. `renewResearchJobLease` (Worker Heartbeat): Owned lease renewal incrementing `recordVersion`.
4. `completeResearchJob` (Worker): Owned terminal completion committing snapshot.
5. `failResearchJob` (Worker): Owned failure transition.
6. `recoverStaleResearchJobs` (Worker Crash Recovery): Administrative recovery of expired leases.
7. `runEvergreenProductResearch` (Orchestrator): Pure research engine — ZERO unowned direct writes.
