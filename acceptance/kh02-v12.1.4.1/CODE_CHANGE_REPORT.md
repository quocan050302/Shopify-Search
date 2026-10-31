# SWAI KH-02 V12.1.4.1 — Code Change Report

## Repaired Files
1. `src/workers/kh02Worker.ts`:
   - Added `buildHeartbeatRetryPayload(freshPersistedRecord, heartbeatUpdate)` to merge heartbeat telemetry into fresh `resultJson` without overwriting concurrent progress.
   - Hardened `renewResearchJobLease` to reload fresh `resultJson` upon CAS contention and enforce exact ownership (`claimToken`, `fencingToken`, `fencingGeneration`, `workerId`, `recordVersion`, `leaseExpiresAt > now`).
   - Hardened `updateJobIfClaimOwned` with fresh-metadata reload on same-owner retry.

2. `src/services/kh02/persistence/kh02PersistenceService.ts`:
   - Added `ComparableResearchSnapshot`, `ReconciliationMismatch`, `LayerComparisonResult` interfaces.
   - Implemented `normalizeResearchSnapshotForComparison()` for canonical snapshot extraction.
   - Implemented `reconcileDatabaseAndHttp()` for deep DB-to-HTTP equality (identity, rank order, score tolerance 0.01).
   - Implemented `reconcileDatabaseAndBrowser()` rejecting partial matches and verifying complete set equality, rank order, and score tolerance.
   - Expanded `reconcileResearchAcrossLayers()` with independent layer flags and strict full-layer support.

3. `scripts/kh02/runKh02BrowserE2E.ts`:
   - Required HTTP 202 `acceptedRunId !== null`.
   - Polled authoritative job status via API before checking UI elements.
   - Removed title-as-ID fallback; strictly requires `data-candidate-id`.
   - Enforced `databaseMatch === true`, `hydrationErrors.length === 0`, and `unexpectedHttpErrors.length === 0`.

4. `tests/unit/kh02V12_1_4_1_HeartbeatRetry.test.ts`:
   - 7 unit tests verifying fresh payload builder, progress preservation, claimToken/fencingToken/owner mismatch rejection, terminal job safety, and concurrent SQLite processes.

5. `tests/unit/kh02V12_1_4_1_Reconciliation.test.ts`:
   - 16 unit tests verifying candidate set equality, rejection of partial overlap (1/3, 2/3), extra candidates, duplicate candidates, inverted ranks, score tolerance, and strict full-layer evaluation.

6. `tests/integration/kh02V12_1_4_1_LegacyMigration.test.ts`:
   - 2 integration tests verifying schema upgrade on genuine pre-V12.1.3 SQLite database missing 7 columns, PRAGMA checks, data preservation, and partial migration recovery.
