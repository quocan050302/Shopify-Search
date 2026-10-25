# SWAI V11.5.7 — LIVE SOURCE INTEGRITY AUDIT (FINAL-01)
## Strict Rejection of Mock/Fixture Meta Sources in Live Acceptance

**Defect ID:** FINAL-01  
**Severity:** P1 (Highest Integrity Defect)  
**Status:** FIXED_VERIFIED  
**Target Release:** V11.5.7 — Final Evidence Integrity Hotfix  
**Tested Commit SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`  
**Acceptance Run ID:** `kh01_rel_1792914049487_4baa2295`  

---

## 1. THE PROBLEM & ROOT CAUSE

In earlier versions, `src/services/discovery/metaCollector/metaCollectorMcpClient.ts` contained an approved fixture mock collector returning three predefined commercial ads (PupComfort beds and SleepyPaws blankets). While essential for deterministic offline integration tests, the live acceptance pipeline (`--live-meta`) did not strictly prohibit this fixture boundary.

Because `startIsolatedAcceptanceWorker()` forwarded environment variables including `SWAI_MOCK_META_BOUNDARY`, a live acceptance run could theoretically:
1. Launch a real Discovery Worker child process.
2. Ingest three fixture advertisements into real isolated SQLite.
3. Serve them via real Next.js HTTP server.
4. Render them in real Chromium headless browser.
5. Award `LIVE_RECONCILED` despite zero live upstream network requests to Meta.

**Core Fundamental Invariant:**  
*Real persistence of fake source data is NOT live-source verification.*

---

## 2. THE ENGINEERING SOLUTION

### 2.1 Explicit Source Modes
We established a strict two-mode execution contract:
```typescript
export type AcceptanceSourceMode = "OFFLINE_FIXTURE" | "REAL_LIVE_META";

export function resolveAcceptanceSourceMode(
  options: FullKh01AcceptanceOptions
): AcceptanceSourceMode {
  if (options.runLiveSource) {
    return "REAL_LIVE_META";
  }
  return "OFFLINE_FIXTURE";
}
```

### 2.2 Authoritative Guard: `assertNoMockSourceForLiveAcceptance()`
All entry points to live source research enforce:
```typescript
export function assertNoMockSourceForLiveAcceptance(input: {
  sourceMode: AcceptanceSourceMode;
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>;
  providerTransport?: string;
  providerSourceType?: string;
}): void {
  if (input.sourceMode === "REAL_LIVE_META") {
    const mockVal = input.environment.SWAI_MOCK_META_BOUNDARY;
    if (mockVal && mockVal !== "" && mockVal !== "false" && mockVal !== "0" && mockVal !== "off") {
      throw new Error(
        "LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN: Mock/fixture boundary cannot be active during REAL_LIVE_META verification"
      );
    }
    if (input.providerTransport === "mock_test_boundary") {
      throw new Error(
        "LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN: Provider returned mock_test_boundary transport"
      );
    }
    if (input.providerSourceType === "TEST_FIXTURE") {
      throw new Error(
        "LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN: Fixture provenance cannot satisfy live acceptance"
      );
    }
  }
}
```

### 2.3 Defense-in-Depth in `createMetaCollectorClient()`
The client factory itself throws if mock mode is attempted under `REAL_LIVE_META`:
```typescript
const mockRequested =
  process.env.SWAI_MOCK_META_BOUNDARY === "true" ||
  process.env.SWAI_MOCK_META_BOUNDARY === "fail";
const liveRequested =
  process.env.SWAI_ACCEPTANCE_SOURCE_MODE === "REAL_LIVE_META";

if (mockRequested && liveRequested) {
  throw new DiscoveryError({
    code: "PROVIDER_RESPONSE_INVALID",
    message: "LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN: Fixture Meta collector cannot be used for live verification",
    providerId: "meta-ads-collector",
  });
}
```

### 2.4 Worker Environment Sanitization
`startIsolatedAcceptanceWorker()` sanitizes the child process environment:
```typescript
SWAI_ACCEPTANCE_SOURCE_MODE: sourceMode,
SWAI_MOCK_META_BOUNDARY:
  sourceMode === "REAL_LIVE_META" ? "" : (process.env.SWAI_MOCK_META_BOUNDARY || ""),
```

### 2.5 Provider Origin Observation: `ProviderSourceEvidence`
`verifyLiveMetaSource()` validates `validCount > 0` before awarding `ADS_COLLECTED`, and emits structured provider provenance evidence:
```typescript
interface ProviderSourceEvidence {
  requestedMode: AcceptanceSourceMode;
  actualTransport: string;
  providerId: string;
  fixtureDetected: boolean;
  observedSourceType: "REAL_UPSTREAM" | "TEST_FIXTURE" | "UNKNOWN";
  sourceAccessible: boolean;
  validAdsCollected: number;
  verifiedAt: string;
  evidenceReferences: string[];
}
```

---

## 3. ADVERSARIAL TEST VERIFICATION

Tested in `tests/unit/kh01LiveSourceIntegrity.test.ts` (14/14 passed):

| Scenario | Execution Condition | Expected Result | Verified Status |
|---|---|---|---|
| Live with `SWAI_MOCK_META_BOUNDARY=true` | `--live-meta` + mock enabled | Throws `LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN` | PASSED |
| Live with `SWAI_MOCK_META_BOUNDARY=fail` | `--live-meta` + simulated failure | Throws `LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN` | PASSED |
| Provider transport is mock | Transport is `mock_test_boundary` | Rejected from `LIVE_VERIFIED` | PASSED |
| Provider source is fixture | Source type is `TEST_FIXTURE` | Rejected from `LIVE_VERIFIED` | PASSED |
| Offline mode with mock | `--offline-only` + mock enabled | Allowed for offline integration testing | PASSED |
| Default run without live flag | `runLiveSource: false` | Returns `NOT_RUN` with 0 counts | PASSED |

---

## 4. FINAL VERIFICATION IN ACCEPTANCE RUN

In acceptance run `kh01_rel_1792914049487_4baa2295`:
- **Requested Scope:** `OFFLINE`
- **Source Mode:** `OFFLINE_FIXTURE`
- **Live Meta Status:** `NOT_RUN`
- **Detailed Outcome:** `NOT_RUN`
- **Gate 14 (`GATE_14_LIVE_META_SOURCE`):** `NOT_RUN` (Truthfully recorded, not fabricated)
- **Overall Release Status:** `CONDITIONALLY_ACCEPTED`
