# 01 — ROOT CAUSE & FUNCTION CHANGE MAP (KH-02 V12.4.3.5.1)

- **Branch**: `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`
- **Tested Source SHA (`CODE_SHA`)**: `c0993929500b3c37504a5aae8f7f559f18cedd84`
- **Tested Tree SHA**: `7096ddc630b9d78e7a9aa33141937ff6d6b9253c`

## 1. Root Causes Identified & Repaired
1. **Runner Truthy Defaults (Workstream A)**: `runControlledLiveAmazonPlaywrightMcpPilotWave` previously used `|| "SUCCEEDED"`, `|| "PUBLIC_PAGE_OBSERVED"`, `Math.max(1, operationLedger.length)`, and hardcoded `mcpSessionClosedCleanly: true` and `fabricatedLiveSuccess: false`. Replaced with fail-closed measured status extraction, exact ledger count, PID termination verification, and explicit anti-inflation/hash lineage checks.
2. **Walmart Probe Literal Shortcuts (Workstream A & E)**: `runControlledLiveWalmartJinaProbeWave` previously hardcoded `probeExecutionStatus: "DID_RUN"`, `classificationIntegrityStatus: "PASS"`, `freeReaderMode: true`, `apiKeyUsed: false`, and mapped all non-success to `BLOCKED_EXTERNAL_PROVIDER`. Replaced with ledger/header/policy inspection and distinct statuses (`BLOCKED_PROVIDER`, `RATE_LIMITED`, `NOT_ATTEMPTED`, `DISABLED`, `LIVE_VERIFIED`, `INSUFFICIENT_EVIDENCE`).
3. **Amazon Multi-Verdict Separation (Workstream B)**: `collectKh02AcceptanceDiagnostics` and `computeReleaseVerdicts` now separate `AMAZON_LOCAL_MCP_HANDSHAKE`, `AMAZON_LOCAL_MCP_LIVE_OBSERVATION`, `AMAZON_PRODUCT_IDENTITY_PILOT`, `AMAZON_US_DELIVERY_PROOF`, `AMAZON_USD_PRICE_PROOF`, and `AMAZON_CREATORS_API`, never reporting `AMAZON_LIVE_PILOT_VERDICT: "PASS"` unless `>= 3` distinct product families are verified.
4. **Canonical Product Family Deduplication (Workstream C)**: Added `computeAmazonCanonicalProductFamilyKey` in `src/services/kh02/marketplace/amazonUsIdentity.ts` and updated `evaluateAmazonUsEvidenceGate` in `src/services/kh02/marketplace/amazonUsEvidenceGate.ts` so same-family ASIN variants (e.g., ChomChom `B00BAGTNAQ` and `B07F178K9N`, or parent/child ASINs) count as `1` product family (`distinctVerifiedProductFamilies`).
5. **Strict USD & US Delivery ZIP Proof (Workstream D)**: Updated `parseAmazonProductEvidence` and `navigateAndCaptureProductSnapshot` so `currency: "USD"` requires explicit currency evidence (never bare `$` alone), carousel/suggested prices are excluded from the main ASIN, and unobserved US shipping ZIP remains `null` (`AMAZON_US_DELIVERY_PROOF: "UNKNOWN"`).

## 2. Modified Files & Functions
- `src/services/kh02/marketplace/marketplaceEvidenceTypes.ts`: `AmazonProductEvidence`, `AmazonEvidenceGateEvaluation`
- `src/services/kh02/marketplace/amazonUsIdentity.ts`: `computeAmazonCanonicalProductFamilyKey`, `canonicalizeAmazonProductIdentity`, `parseAmazonProductEvidence`
- `src/services/kh02/marketplace/amazonUsEvidenceGate.ts`: `evaluateAmazonUsEvidenceGate`
- `src/services/kh02/marketplace/amazonUsMcpTransport.ts`: `connectAmazonPlaywrightMcp`, `navigateAndCaptureProductSnapshot`
- `scripts/kh02/acceptanceTruth.ts`: `collectKh02AcceptanceDiagnostics`, `computeReleaseVerdicts`, `computeEngineeringVerdict`, `computeRequiredWaveCompletion`
- `scripts/kh02/runOriginalAmazonWalmartPilotAcceptanceV12_4_3_5_1.ts`: `runControlledLiveAmazonPlaywrightMcpPilotWave`, `runControlledLiveWalmartJinaProbeWave`, `main`
- `scripts/kh02/validateOriginalAmazonWalmartPilotAcceptanceV12_4_3_5_1.ts`: `validateOriginalAmazonWalmartPilotArtifacts`, `runOriginalPilotPhysicalNegativeMutationSuite36`
- `tests/unit/kh02/v12_4_3_5_1_OriginalAmazonWalmartPilotMatrix.test.ts`: `N01..N48` negative test matrix
