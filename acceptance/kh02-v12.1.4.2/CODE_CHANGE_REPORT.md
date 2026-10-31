# SWAI KH-02 V12.1.4.2 — Code Change Report

## Summary of Architectural Enhancements
1. **Shared Observable Worker Health**: Implemented persistent heartbeat in SQLite via `SyncJob` with `jobType: "KH02_WORKER_HEARTBEAT"`, evaluated dynamically by `getSharedResearchWorkerHealth` across idle and busy states.
2. **Resilient Long-Running Research Tracking**: Refactored frontend poller from rigid 60s timeout to resilient 300-attempt monitor with non-fatal background continuation messaging.
3. **Mount-Time Active Run Discovery**: Added `GET /api/v1/kh02/research/active` and `getKH02ActiveResearchRun` restoring running jobs instantly across browser reloads or page navigations.
4. **Central Source Diagnostic Service**: Added `diagnoseKH02Source` and `testKH02SourceConnection` delivering honest readiness statuses across Meta Ads, TikTok Ads US, TikTok Organic, Google Ads Transparency, and Demand History.
5. **Interactive UI Progress Panel**: Added live research progress card displaying niche, lookback, worker online status, current stage, and progress bar.
6. **Bounded Research Execution**: Added `withStageTimeout` per provider step and candidate pool bounding (`maxCandidates`).
7. **Local Supervisor Integration**: Added `--with-worker` flag to `scripts/startSwaiServer.ts` supervising Next.js and worker processes together in local dev.
