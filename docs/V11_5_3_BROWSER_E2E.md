# SWAI V11.5.3 — Real Browser E2E Coverage & Interaction Verification
**Specification Protocol:** KH-01  
**Target Release:** V11.5.3  
**Audited Baseline SHA:** `ec291b06c0b7841fe8d28157d02582ce2844c58c`  
**Market Context:** United States (`RESEARCH_ONLY`)

---

## 1. Defect Analysis: BUG-08 in V11.5.2

In SWAI V11.5.2, browser tests in `tests/e2e/metaDiscoveryFinalAcceptance.test.ts` verified that the page rendered, buttons had text, and mobile view had no horizontal overflow. However, they did not prove interactive user workflows:
- Form submission did not verify actual run creation and ledger row insertion.
- The UI did not prove that `UNKNOWN` collector status prevented form submission.
- Exact-run navigation did not prove that older ads (>30 days) remained displayed.
- The UI lacked standardized, stable `data-testid` selectors.

---

## 2. Stable Selector Inventory

To support robust, non-fragile E2E browser automation without altering application semantics, standard `data-testid` attributes were integrated:

| Component | Selector (`data-testid`) | Description |
| :--- | :--- | :--- |
| `MetaResearchForm.tsx` | `meta-keyword-input` | Primary research query input |
| `MetaResearchForm.tsx` | `meta-research-submit` | "Start Meta Research" button |
| `MetaResearchForm.tsx` | `meta-diagnostics-open`| "Run Diagnostics" button when unready |
| `MetaJobsTable.tsx` | `research-job-row` | Ledger row for a research job |
| `MetaJobsTable.tsx` | `research-job-status` | Badge displaying job status |
| `MetaJobsTable.tsx` | `research-job-view-ads` | Action link navigating to exact-run Explorer |
| `explorer/page.tsx` | `exact-run-context-banner`| Blue exact-run context banner |
| `explorer/page.tsx` | `exact-run-exit` | Link to exit exact-run filtered view |
| `explorer/page.tsx` | `exact-run-ad-card` | Rendered ad card belonging to the exact run |

---

## 3. Real Browser Scenarios Tested

Executed using Playwright Chromium against an authentic Next.js server on loopback:

### Scenario 1: READY State Research Submission
- **Flow**: User enters keyword `pet hair remover` into `[data-testid="meta-keyword-input"]`. Form submits via POST to `/api/v1/discovery/meta/requests`.
- **Assertion**: Button shows loading state; request succeeds; newly created research run appears in the research jobs ledger.

### Scenario 2: UNKNOWN Diagnostics Policy
- **Flow**: Collector health returns `UNKNOWN`.
- **Assertion**: Submit button is disabled; "Run Diagnostics" button (`[data-testid="meta-diagnostics-open"]`) is visible and active. Form submission is blocked.

### Scenario 3: Exact-Run Explorer Navigation & Display Completeness
- **Flow**: User clicks "View Ads" (`[data-testid="research-job-view-ads"]`) from a completed research job in the ledger.
- **Assertion**:
  - URL updates to `/explorer?requestId=<runId>`.
  - Context banner (`[data-testid="exact-run-context-banner"]`) appears displaying the exact Run ID.
  - All associated ads render (`[data-testid="exact-run-ad-card"]`).
  - Ads older than 30 days are NOT dropped or hidden.
  - Clicking "Exit Exact Run View" (`[data-testid="exact-run-exit"]`) restores the full catalog.

### Scenario 4: Cross-Workspace Research Isolation
- **Flow**: User in Workspace A attempts to view a research run belonging to Workspace B via URL parameter `?requestId=<foreignRunId>`.
- **Assertion**: API returns 404 or 403; Explorer displays an empty state or error rather than falling back to general catalog ads.

---

## 4. Test Execution Evidence

- `tests/e2e/metaDiscoveryFinalAcceptance.test.ts`: **3/3 passed** in 2.5s.
- `tests/e2e/exactRunExplorerAcceptance.test.ts`: **2/2 passed** in 3.4s.
- `tests/integration/kh01UnifiedJourney.test.ts` (Step 6): **Passed** in 6.3s with authentic Chromium DOM inspection.
