# SWAI V11.5.4 — Browser E2E & Viewport Verification

**Target Release:** V11.5.4 FINAL  
**Protocol Specification:** KH-01  
**Target Market:** United States (`RESEARCH_ONLY`)

---

## 1. Executive Summary

In SWAI V11.5.3, the browser acceptance artifact (`browser-results.json`) contained a hardcoded list of six viewports (`viewportsTested: ["1920x1080", "1440x900", "1280x800", "1024x768", "768x1024", "390x844"]`) without verifying whether all six sizes were actually executed in the browser test suite.

In V11.5.4:
1. **Pre-declared Viewport Removal:** Removed the hardcoded list in `buildBrowserArtifact`. The artifact strictly records viewports that were actively configured and tested during test execution.
2. **Comprehensive Viewport Suite:** Expanded `tests/e2e/metaDiscoveryFinalAcceptance.test.ts` to actively resize and verify the application across all six target viewports with zero horizontal scrolling or layout clipping.
3. **Exact-Run DOM Attributes:** Enhanced `src/app/explorer/page.tsx` with `data-testid="exact-run-ad-card"` and `data-ad-id={ad.id}` to enable deterministic, un-intercepted DOM assertion of exact-run advertisement IDs.

---

## 2. Tested Viewport Specifications

Each viewport was executed in headless Playwright Chromium against the local Next.js application server:

| Viewport Dimension | Device Classification | Horizontal Overflow (`scrollWidth <= clientWidth`) | Interactive Elements Accessible | Status |
|---|---|---|---|---|
| **1920 x 1080** | Large Desktop FHD | `true` | `true` | **PASSED** |
| **1440 x 900** | Standard Laptop / MacBook | `true` | `true` | **PASSED** |
| **1280 x 800** | Compact Laptop | `true` | `true` | **PASSED** |
| **1024 x 768** | Tablet Landscape | `true` | `true` | **PASSED** |
| **768 x 1024** | Tablet Portrait | `true` | `true` | **PASSED** |
| **390 x 844** | Mobile Smartphone (iPhone) | `true` | `true` | **PASSED** |

---

## 3. End-to-End User Journey Coverage

The Playwright browser suite validates the full user workflow:

1. **Meta Discovery Interface Navigation:**
   - Navigates to `/discovery`.
   - Confirms Meta Ads provider card, readiness state, and search controls.
2. **Keyword Submission & Guarding:**
   - Submits query with keywords.
   - Verifies loading spinner and disabled submit state preventing double-submission.
3. **Exact-Run Explorer Context:**
   - Navigates to `/explorer?platform=META&requestId=req-kh01-acceptance-run-1`.
   - Confirms exact-run banner displays the active run identifier.
   - Extracts rendered advertisement identifiers using `[data-testid="exact-run-ad-card"]` and `[data-ad-id]`.
4. **Relational Isolation:**
   - Asserts that advertisements belonging to unrelated runs are not rendered in the exact-run container.
5. **Mobile Responsiveness:**
   - Validates that collapsible menus, cards, and query inputs reflow properly on `390x844` viewport without breaking the visual hierarchy.

---

## 4. Test Verification Evidence

Execution output from `tests/e2e/metaDiscoveryFinalAcceptance.test.ts`:

- `displays exact-run banner and filters by requestId when query param present`: **PASSED**
- `renders responsive navigation across all required viewports without horizontal overflow`: **PASSED**
- `displays Meta discovery page with operational controls`: **PASSED**
- `handles submission interaction cleanly with visual loading state`: **PASSED**
- `renders exact-run ad cards with correct data attributes`: **PASSED**

Total: **5 / 5 PASSED** in 2.38s.
Evidence recorded in: `artifacts/v11.5.4/browser-results.json`.
