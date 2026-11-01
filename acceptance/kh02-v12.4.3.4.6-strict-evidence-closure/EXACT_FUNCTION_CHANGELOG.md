# KH-02 V12.4.3.4.6 — Exact Function Changelog & Strict Evidence Closure

## 1. Strict Live Observation Lineage, Merchant Proof & Top-3 Distinctness (`scripts/kh02/g16CandidateEvaluator.ts`)
- `normalizeObservationIdentity(observation)`: Normalizes observation IDs, source record IDs, run IDs, and cache flags without inflating unknown IDs.
- `isAuthenticallyLiveObservation(observation, evidenceIndex?)`: Requires explicit `LIVE_PROVIDER` / `REAL_UPSTREAM` provenance, `isCached !== true`, non-empty observation/source record ID, and request/evidence metadata. Never inspects `candidate.liveObservationsCount`.
- `belongsToCurrentResearchRun(observation, currentRunId, lineageIndex?)`: Requires exact nonblank `researchRunId` / `executionRunId` match or verified parent-child run linkage. Missing run IDs return `false`.
- `belongsToCandidateProduct(observation, candidate, identityIndex?)`: Verifies positive product/merchant linkage and rejects conflicting `candidateId`, `storeDomain`, or product URL handles.
- `hasVerifiedMerchantIdentity(candidate, merchantEvidenceIndex?)`: Requires independent merchant verification proof (`merchantProofRefs.length > 0`); rejects URL strings alone and CheckoutChamp funnels.
- `evaluateG16Top3(shortlistCandidates, currentResearchRunId, options?)`: Requires `verifiedLiveCount >= 3`, `distinctCanonicalProductsCount >= 3`, and `distinctFamiliesCount >= 3`.

## 2. True Three-System Parity & Read-Only Content Digest Integrity (`scripts/kh02/chromiumAcceptanceService.ts`)
- `loadPersistedRunSnapshotFromSqlite(workspaceId, runId)`: Independently queries `syncJob` and `researchProduct` from SQLite.
- `reconcileSqliteHttpChromium(input)`: Rejects uncommitted in-memory shortlists; computes independent `dbVsHttpVerdict`, `dbVsDomVerdict`, and `httpVsDomVerdict`; enforces required field presence and exact normalized title equality.
- `assessReadOnlyMutation(fn, db)`: Verifies HTTP 200 JSON response and compares both row counts and deterministic SHA-256 content digests across `syncJob`, `researchProduct`, `competitorStore`, `adProductLink`, and `evergreenProductScore`.

## 3. Google MCP Explicit Live Provenance, Set Reconciliation & Association Truth (`scripts/kh02/googleMcpGateEvaluator.ts`, `src/services/kh02/providers/googleTransparencyResearchAdapter.ts`, `src/services/kh02/evergreenResearchOrchestrator.ts`)
- Removed `!c.isCached` as standalone live proof; requires explicit `isCached === false`, live `sourceMode`/`provenance`, matching `researchRunId`, and `providerRequestId`.
- Replaced numeric count check with set-based creative ID reconciliation across raw, normalized, rejected, and association ledgers.
- Separated `GOOGLE_PRODUCT_ASSOCIATION` (pipeline integrity) from `GOOGLE_EXACT_PRODUCT_EVIDENCE` (product-specific SKU match).

## 4. Point-in-Time Joined Metadata Leakage Guard (`scripts/kh02/runBacktestV12_4_3_4_2.ts`)
- `resolvePointInTimeAdCandidateMetadata(ad, link, asOf)`: Rejects joined `ResearchProduct` metadata updated after `asOf` and falls back strictly to point-in-time ad observation fields.

## 5. Independent Acceptance Validator & 26 Physical-File Negative Controls (`scripts/kh02/acceptanceValidatorV12_4_3_4_5.ts`)
- Replaced hardcoded threshold count in `CHK_16` with recomputed gate consistency from raw artifacts.
- Expanded physical-file negative control suite to 26 mutations (`MUT_01` .. `MUT_26`).
