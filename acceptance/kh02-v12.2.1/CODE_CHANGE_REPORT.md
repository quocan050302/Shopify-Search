# SWAI KH-02 V12.2.1 — CODE CHANGE REPORT

**Release:** `KH-02 V12.2.1`  
**Working Branch:** `feature/kh02-v12.1.3-runtime-truth-closure`  
**Base Commit:** `4e6d4ba6e3842d8ae1b03be0680c74793e424c44`  
**Protected Module:** KH-01 Product Intelligence  

---

## 1. Summary of Changes

| File Path | Nature of Modification | Architectural Purpose |
|---|---|---|
| `src/services/kh02/types.ts` | Extended Types | Added `SourceRunStatus` values (`CREDENTIALS_REQUIRED`, `MCP_NOT_CONFIGURED`, `MCP_TRANSPORT_FAILURE`, `CONNECTING`, `AUTHENTICATED`, `CAPABILITY_VERIFIED`, `QUERY_EXECUTED`, `MANUAL_RESEARCH_ONLY`, `ENGINE_READY`) and `ProviderReadinessDimensions`. |
| `src/services/kh02/providers/hasDataCreditService.ts` | Cost Authority | Added `ProviderOperationCost` and `getHasDataOperationCost()` reflecting HasData's 10 credits per MCP tool invocation contract. |
| `src/services/kh02/providers/tiktokOrganicResearchAdapter.ts` | Credit Alignment | Corrected `TIKTOK_ORGANIC_COST_POLICY` creditsPerRequest to 10 and documented 1,000 monthly free credits allowance. |
| `src/services/kh02/providers/googleTransparencyResearchAdapter.ts` | Protocol & Security | Implemented compliant JSON-RPC 2.0 (`tools/list`, `tools/call`), removed guessed REST endpoints, added strict SSRF filtering and command injection prevention. |
| `src/services/kh02/providers/metaResearchAdapter.ts` | Provenance & Breakdown | Added `MetaLiveCollectionBreakdown` tracking `recordsInDbBeforeQuery`, `sourceRecordsReturned`, `newUniqueInserted`, and `recordsInDbAfterQuery`. |
| `src/services/kh02/providers/sourceRegistry.ts` | Status & Cost | Corrected status mapping bug: preserved specific diagnostic statuses instead of collapsing to generic `NOT_CONFIGURED`; updated cost per query credits to 10 for TikTok Organic. |
| `src/services/kh02/providers/providerHealthService.ts` | Health Accounting | Updated summary health counters for `SOURCE_DATA_VERIFIED`, `TRANSPORT_CONNECTED`, and `MCP_TRANSPORT_FAILURE`. |
| `src/app/api/v1/kh02/providers/status/route.ts` | API Contract | Exposed `dimensions` and `diagnosticStatus` in API response payload. |
| `src/app/products/page.tsx` | UI Diagnostics | Updated `getSourceBadge()` labels and integrated a 10-dimension Connection Details modal/panel with zero-cost diagnostic badge. |
| `tests/unit/kh02V12_2_1_ProviderActivation.test.ts` | Unit Testing | 13 comprehensive tests for status mappings, HasData credit policy, Google MCP protocol, SSRF, command injection, and acceptance truthfulness. |
| `scripts/kh02/runAcceptanceV12_2_1.ts` | Truthful Acceptance | Replaced all hardcoded `VERIFIED` and `PASS` declarations with real executed checks, Chromium E2E, adversarial mutation checks, and live collection evidence. |

---

## 2. Detailed Function-Level Report (Section 104)

### `getHasDataOperationCost(operation: string)`
- **File:** `src/services/kh02/providers/hasDataCreditService.ts`
- **Purpose:** Authoritatively determines estimated credit costs for HasData MCP tool invocations.
- **Parameters:** `operation: string`
- **Return Type:** `ProviderOperationCost`
- **Cost Policy:** Reports 10 credits for TikTok video searches per vendor documentation.
- **Error Handling:** Returns `knownCost: false` for unrecognized operations.

### `discoverGoogleAdsMcpCapabilities(context: GoogleMcpContext)`
- **File:** `src/services/kh02/providers/googleTransparencyResearchAdapter.ts`
- **Purpose:** Connects via stdio or JSON-RPC 2.0 to discover tools advertised by Google Transparency MCP server.
- **Parameters:** `context: GoogleMcpContext`
- **Return Type:** `Promise<GoogleMcpCapabilities>`
- **Security:** Validates command against `/[;&|`$\n]/` and URL against `isSafePublicUrl()`.
- **Error Handling:** Gracefully catches connection failures, returns `transportConnected: false` with exact `errorMessage`.

### `diagnoseKH02Source(source: IntelligenceSource, context?: SourceDiagnosticContext)`
- **File:** `src/services/kh02/providers/sourceRegistry.ts`
- **Purpose:** Truthfully probes source configuration, credentials, transport, and capabilities without assuming connectivity from key presence alone.
- **Parameters:** `source: IntelligenceSource`, `context?: SourceDiagnosticContext`
- **Return Type:** `Promise<SourceDiagnosticResult>`
- **Dimensions:** Returns 9 distinct `ProviderReadinessDimensions`.

### `checkKH02ProviderReadiness(source: IntelligenceSource, workspaceId?: string)`
- **File:** `src/services/kh02/providers/sourceRegistry.ts`
- **Purpose:** Evaluates source readiness for the research orchestrator while preserving actionable diagnostic statuses.
- **Parameters:** `source: IntelligenceSource`, `workspaceId?: string`
- **Return Type:** `Promise<ProviderReadinessResult>`
- **Fix:** Eliminates the mapping of `CREDENTIALS_REQUIRED` and `MCP_NOT_CONFIGURED` to generic `NOT_CONFIGURED`.
