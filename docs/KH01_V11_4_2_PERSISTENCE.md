# KH-01 V11.4.2 — Transactional & Idempotent Research Persistence

## 1. Overview
In KH-01 V11.4.1, landing-page research persistence was split across several uncoordinated database calls. If a failure or interruption occurred midway through, the database was left in an inconsistent state: an offer snapshot might be created, but landing page snapshot failed or was missing, or evidence failed, or `SyncJob` remained `RUNNING`.
Furthermore, `saveLandingPageSnapshot` possessed an insecure implicit fallback (`workspaceId || "default-workspace"`), `contentHash` ignored price values, and the `ACCESS_RESTRICTED` branch recorded `status: "COMPLETED"` in `SyncJob`, confusing UI consumers into believing a page analysis was successfully performed.

In KH-01 V11.4.2 (Checkpoint 4), all research artifacts (`LandingPageSnapshot`, `CompetitorOfferSnapshot`, `ResearchEvidence`, and terminal `SyncJob` outcome) are orchestrated in a single atomic database transaction (`prisma.$transaction`) via `researchResultPersistenceService.ts`.

## 2. Functions Audited & Modified

| File | Function / Symbol | Changes |
| :--- | :--- | :--- |
| `src/services/research/researchResultPersistenceService.ts` | `persistCompletedResearchResult` | **New service**: Transactionally coordinates snapshots, evidence, and terminal job updates under active worker claim with idempotency support. |
| `src/services/research/landingPageSnapshotService.ts` | `saveLandingPageSnapshot` | Removed `default-workspace` fallback; requires explicit authorized `workspaceId`. Enriched `contentHash` with actual observed price, currency, bundle quantity, and shipping threshold. Added `tx` transaction support. |
| `src/services/research/offerExtractionService.ts` | `persistCompetitorOfferSnapshot` | Added `tx` transaction support. Avoids redundant out-of-transaction read locks during write transactions. |
| `src/services/research/evidenceService.ts` | `createResearchEvidence` | Added `tx` transaction support. Added duplicate prevention on job re-executions. |
| `src/services/research/landingPageInspectionService.ts` | `executeLandingPageResearchJob` | Replaced 4 uncoordinated write operations with a single call to `persistCompletedResearchResult`. Restricted sources write terminal `ACCESS_RESTRICTED` status (not falsely `COMPLETED`). |

## 3. Strict Rules Enforced
1. **Transaction Boundary (Task 096)**:
   - For successful research, `CompetitorOfferSnapshot`, `LandingPageSnapshot`, `ResearchEvidence`, and terminal `SyncJob` status update commit atomically in a single `$transaction`.
   - If any step fails, the entire transaction rolls back cleanly.
2. **Canonical Blocked-Source Policy (Task 092 & 093)**:
   - When a competitor storefront blocks access (HTTP 401/403/Cloudflare challenge), `SyncJob` status is set to `ACCESS_RESTRICTED`.
   - It is never falsely marked as `COMPLETED`.
   - No fabricated offer, CRO score, or demand claims are generated.
3. **Idempotency & Replay Safety (Task 097 & 098)**:
   - If `persistCompletedResearchResult` is called for a job that already completed and persisted its snapshots, it immediately returns the existing snapshot IDs with `isIdempotentReplay: true` rather than duplicating rows.
4. **Commercial Content Fingerprinting (Task 100)**:
   - `contentHash` incorporates the actual observed price, currency, bundle quantity, and shipping threshold.
   - A price change from $19.99 to $24.99 produces a distinct content hash.
5. **No Implicit Default Workspace Fallback (Task 099)**:
   - `saveLandingPageSnapshot` throws an error if `workspaceId` is empty or missing.

## 4. Test Verification
Test suite: `tests/unit/researchPersistence.test.ts`
- `persists research result atomically, linking snapshots, evidence, and completed job` (PASSED)
- `handles ACCESS_RESTRICTED source truthfully with ACCESS_RESTRICTED job status` (PASSED)
- `saveLandingPageSnapshot rejects missing workspaceId fail-closed` (PASSED)
- `contentHash incorporates observed price changes` (PASSED)

Total: 4/4 tests passed.
All 57 unit tests across the 5 core suites pass cleanly with 0 failures.
