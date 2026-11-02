# 01 — ROOT CAUSE & FUNCTION CHANGE MAP (KH-02 V12.4.3.5.1)

- **Branch**: `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`
- **Tested Source SHA (`CODE_SHA`)**: `075b7669d18b231168550c0be6f7153bb748f73c`
- **Tested Tree SHA**: `453a4e23a2addd3542988444cd8a5ac494918a11`

## 1. Root Causes Identified & Repaired
1. **P0-A — Fail-Closed Verdict & Summary Contract (`scripts/kh02/acceptanceTruth.ts`)**: Removed fail-open fallbacks in `computeReleaseVerdicts` (`!e2eSummary ? engineeringVerdict === "PASS" ? "PASS" : "INCOMPLETE"`, `nicheTestsPassed ?? true`, `holdoutNicheMatchedCount ?? 3`, `holdoutShortlistCount ?? 3`). Added `RequiredEvidenceSummary<T>` and `validateRequiredEvidenceSummary<T>` enforcing `status === "MEASURED"` and `sourceSha === codeSha`. Separated `NICHE_RELEVANCE` from `HISTORICAL_NICHE_SHORTLIST_COVERAGE`.
2. **P0-B — Authentic Same-Session MCP Lifecycle & Closure Proof (`amazonUsMcpTransport.ts`, `amazonUsEvidenceAdapter.ts`, `amazonUsEvidenceGate.ts`)**: Reordered `runAmazonUsPilotEnrichment` so `ownedSession.close()` executes in `finally` FIRST, constructs `AmazonMcpSessionLifecycleProof` (`sessionId`, `ownedChildPid`, `lastToolCompletedAt`, `closeStartedAt`, `closeFinishedAt`, `closedCleanly`, `ownedChildPidTerminated`), and ONLY THEN calls `evaluateAmazonUsEvidenceGate`. Tightened `evaluateAmazonUsEvidenceGate` so `mcpSessionClosedCleanly === true` (strict boolean `true`) and `op.transportSessionId === mcpSessionLifecycle.sessionId` for all live MCP operations are required for `REAL_PROVIDER_VERIFIED`. Updated `runControlledLiveAmazonPlaywrightMcpPilotWave` to derive session closure strictly from `liveAmzResult.marketplaceTelemetry.mcpSessionLifecycle`, never from the separate handshake probe session.
3. **P0-C — Authentic Live Amazon Evidence -> SQLite DB -> Authorized GET API -> Headless Chromium DOM & Reload 3-Way Parity (`runOriginalAmazonWalmartPilotAcceptanceV12_4_3_5_1.ts`)**: Extended `runCombinedHeadlessChromiumUiAndReloadParityWave` to persist the current run's 3 live Amazon rows (`B00BAGTNAQ`, `B01FXC7JWQ`, `B0FDKQGRCK`) into SQLite via `persistAmazonEvidenceAtomically`, verify idempotency and read-only `GET /api/v1/kh02/marketplace/amazon` DB digest + cross-workspace 403/404 denial, and verify Chromium `/products?runId=...` DOM attributes before and after `page.reload()` (`AMAZON_REAL_LIVE_DB_API_DOM_PARITY = "PASS"`, `WALMART_REAL_LIVE_DB_API_DOM_PARITY = "BLOCKED_PROVIDER"`).
4. **Canonical Product Family Deduplication & Strict USD/US ZIP Truth**: Preserved `computeAmazonCanonicalProductFamilyKey` (`>= 3` distinct product families required for `AMAZON_PRODUCT_IDENTITY_PILOT = "PASS"`) and strict `null` preservation for unobserved US shipping ZIP and VND/non-USD prices.

## 2. Modified Files & Functions
- `src/services/kh02/marketplace/marketplaceEvidenceTypes.ts`: `AmazonMcpSessionLifecycleProof`, `AmazonEvidenceGateEvaluation`, `AmazonMarketplaceTelemetry`
- `src/services/kh02/marketplace/amazonUsMcpTransport.ts`: `connectAmazonPlaywrightMcp`, `getSessionLifecycleProof`
- `src/services/kh02/marketplace/amazonUsEvidenceAdapter.ts`: `runAmazonUsPilotEnrichment`, `fetchAuthorizedAmazonProductEvidence`
- `src/services/kh02/marketplace/amazonUsEvidenceGate.ts`: `evaluateAmazonUsEvidenceGate`
- `scripts/kh02/acceptanceTruth.ts`: `validateRequiredEvidenceSummary`, `collectKh02AcceptanceDiagnostics`, `computeReleaseVerdicts`
- `scripts/kh02/runOriginalAmazonWalmartPilotAcceptanceV12_4_3_5_1.ts`: `runControlledLiveAmazonPlaywrightMcpPilotWave`, `runCombinedHeadlessChromiumUiAndReloadParityWave`, `main`
- `scripts/kh02/validateOriginalAmazonWalmartPilotAcceptanceV12_4_3_5_1.ts`: `validateOriginalAmazonWalmartPilotArtifacts`, `runOriginalPilotPhysicalNegativeMutationSuite36`
- `tests/unit/kh02/v12_4_3_5_1_OriginalAmazonWalmartPilotMatrix.test.ts`: `N01..N48` + `F02..F07` fail-closed & live parity tests
