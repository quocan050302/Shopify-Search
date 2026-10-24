# SWAI V11.5.2 — Browser & Responsive Layout Acceptance Report

**Release**: V11.5.2  
**Target Specification**: KH-01 Section 17, 18 & 19  
**Branch**: `feature/v11-meta-collector-remove-muse`  
**Application Mode**: `RESEARCH_ONLY`  
**Browser Engine**: Chromium via Playwright Core

---

## 1. Executive Summary

Visual and functional browser acceptance in V11.5.2 targeted specific regressions and requirements:
1. **Consolidated Exact-Run Banner**: Replaced duplicate overlapping run banners in `/explorer` with a single, clear `ExactRunContextBanner` displaying the run ID, ad count, and an explicit `Exit Run View` button.
2. **Older & Unknown Date Retention**: Verified via browser tests that ads launched 90 days ago, 180 days ago, and ads with unknown launch dates render cleanly in the exact run view without being eliminated by the 30-day filter.
3. **Readiness Actions in Meta Discovery Form**: Verified `/meta-discovery` submit button updates label, state, and click handlers according to actual system readiness (`Start Research`, `Queue for Later`, `Configure Collector`, `Run Diagnostics`).
4. **Responsive Layouts**: Validated desktop and mobile viewports with zero horizontal scroll overflow.

---

## 2. Tested Viewports & Visual Verification

| Viewport | Device Profile | Page Tested | Layout Integrity | Horizontal Scrollbar? | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `1920 × 1080` | Large Desktop | `/explorer`, `/meta-discovery`, `/products` | Fluid grid, balanced margins | No | **PASS** |
| `1440 × 900` | Standard Laptop | `/explorer`, `/meta-discovery`, `/tracker` | Optimal density, legible cards | No | **PASS** |
| `1280 × 800` | Compact Laptop | `/explorer`, `/meta-discovery` | Proper sidebar folding | No | **PASS** |
| `1024 × 768` | Tablet Landscape | `/explorer`, `/meta-discovery` | Responsive card columns | No | **PASS** |
| `768 × 1024` | Tablet Portrait | `/explorer`, `/meta-discovery` | Touch targets $\ge 44$px | No | **PASS** |
| `390 × 844` | Mobile (iPhone 14) | `/explorer`, `/meta-discovery` | Stacked form controls, readable text | No | **PASS** |

---

## 3. Playwright E2E Suite Results

### 3.1 `tests/e2e/metaRunExplorer.test.ts`
- `loads Explorer with requestId and shows active exact run scope banner and all ads including 180d and unknown date`: **PASSED** (all 4 run ads rendered, 180d ad visible, unknown-date ad visible).
- `clears run-specific view when clicking Exit Run View`: **PASSED** (URL updated, general discovery restored).
- `handles empty research run truthfully without fallback to unrelated ads`: **PASSED** (truthful empty state banner).

### 3.2 `tests/e2e/exactRunExplorerAcceptance.test.ts`
- `navigates to Explorer with exact run scope and displays all ads without 30-day cutoff`: **PASSED** (`data-testid="exact-run-context-banner"` verified).
- `exits run view cleanly using Exit Run View button`: **PASSED**.

### 3.3 `tests/e2e/metaDiscoveryFinalAcceptance.test.ts`
- `renders Meta Discovery research page with truthful readiness action button`: **PASSED**.
- `preserves keyword input upon typing and honors form submission boundaries`: **PASSED**.
- `renders cleanly on mobile viewport (390 x 844) without horizontal overflow`: **PASSED**.

---

## 4. Visual Evidence Artifacts

Archived under `artifacts/v11.5.2/screenshots/`:
- `meta-ready-desktop.png` (Operational state, "Start Research" action)
- `meta-setup-required-desktop.png` (Collector missing, "Configure Collector" action)
- `meta-error-state.png` (Truthful diagnostic presentation)
- `meta-jobs-populated.png` (Job ledger with real counts and exact-run links)
- `meta-mobile.png` (Mobile layout on 390x844 with stacked controls)
- `global-navigation-desktop.png` (Desktop layout on 1440x900)
- `global-navigation-mobile.png` (Mobile menu on 390x844)
- `product-intelligence-redesigned.png` (Product intelligence readback)
