# SWAI KH-02 V12.1.4 — Code Change Report

## Repaired Files
1. `src/workers/kh02Worker.ts`:
   - Repaired `updateJobIfClaimOwned` with exact atomic CAS condition on dedicated columns (`id`, `status: RUNNING`, `workerId`, `claimToken`, `fencingGeneration`, `recordVersion`, `leaseExpiresAt > now`).
   - Removed unsafe `resultJson: { contains: ... }` substring fallback completely.
   - Added same-owner conflict retry for non-terminal updates to handle heartbeat vs progress races safely.
   - Repaired `renewResearchJobLease` to increment `recordVersion` while strictly preserving `fencingGeneration`.
   - Repaired `recoverStaleResearchJobs` with write-time atomic condition on `leaseExpiresAt <= now`, preventing race conditions with active worker heartbeats.
   - Added in-process `withJobLock` mutex for serializing mutations on the same job within the worker.
   - Repaired `failResearchJob` and `completeResearchJob` to use the exact same ownership authority.

2. `src/services/kh02/persistence/kh02PersistenceService.ts`:
   - Added `ensureSyncJobSchemaUpgraded(db)` for idempotent, non-destructive SQLite column additions on preexisting databases.
   - Expanded `reconcileResearchAcrossLayers` to verify exact candidate IDs, scores, ranks, and confidence across Database, HTTP, and Browser layers.
   - Added `BrowserReconciliationEvidence` and `SchemaUpgradeResult` interfaces.

3. `src/app/products/page.tsx`:
   - Added stable semantic data attributes to product cards: `data-candidate-id`, `data-opportunity-score`, `data-rank`.

4. `scripts/kh02/runKh02BrowserE2E.ts`:
   - Extracted `data-candidate-id` directly from rendered product cards.
   - Supported `expectedMinCards` option for dual-track testing (Track 1 Nonzero candidates vs Track 2 Truthful empty state).

5. `tests/unit/kh02V12_1_4_AtomicCas.test.ts`:
   - Created comprehensive unit and real SQLite concurrency test suite (7 tests) verifying CAS, monotonic versions, heartbeat vs progress race, recovery vs heartbeat race, and schema upgrade idempotency.
