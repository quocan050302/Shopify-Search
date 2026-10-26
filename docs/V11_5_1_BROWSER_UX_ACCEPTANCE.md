# SWAI V11.5.1 — Browser UX & Playwright E2E Acceptance Report

**Project:** Shopify Winning Ads Intelligence (SWAI)  
**Target Release:** V11.5.1  
**Specification:** KH-01  
**Test Harness:** Playwright with Chromium (Desktop & Mobile Viewports)  

---

## 1. Test Harness & Methodology

All user workflows and visual artifacts were verified against a live Next.js production build (`http://localhost:3000`). Tests exercised the complete DOM hierarchy, CSS layout, responsive breakpoints, focus states, interactive drawers, and modal accessibility.

### Tested Viewports:
- **Desktop:** `1920 × 1080`, `1440 × 900`, `1280 × 800`
- **Tablet:** `1024 × 768`, `768 × 1024`
- **Mobile:** `390 × 844` (iPhone 14 standard)

---

## 2. Screenshot Manifest & Visual Inspection Results

All 11 required screenshots were captured and visually audited in `artifacts/v11.5.1/screenshots/`:

| Filename | Viewport | Verified State & Visual Invariants | Audit Result |
| :--- | :---: | :--- | :---: |
| `meta-ready-desktop.png` | 1440 × 900 | System Operational status pill (`READY`), Meta form with US market and 25 ads, clean spacing. | **PASS** |
| `meta-setup-required.png` | 1440 × 900 | Setup Guide visible with clean step-by-step instructions, copy buttons, and terminal command styling. | **PASS** |
| `meta-worker-offline.png` | 1440 × 900 | Honest offline alert banner: "Worker Offline - Background discovery worker is not polling". | **PASS** |
| `meta-form-failure.png` | 1440 × 900 | Error alert banner displayed; keywords and options strictly preserved; retry button ready. | **PASS** |
| `meta-job-success.png` | 1440 × 900 | Success confirmation toast / banner with active run ID; job appears immediately in table. | **PASS** |
| `meta-jobs-pagination.png` | 1440 × 900 | Server-side pagination controls: "Showing 1–10 of 12 research jobs", page numbers, Previous/Next buttons. | **PASS** |
| `meta-exact-run-results.png` | 1440 × 900 | Explorer loaded with run banner: "Viewing advertisements from Research Run: run_iso_001 [Exit Run View ✕]". | **PASS** |
| `meta-job-details.png` | 1440 × 900 | Slide-over drawer with run metadata, status badges, timestamps, and direct "View Ads" action. | **PASS** |
| `global-search.png` | 1440 × 900 | Global search modal open with workspace-scoped products and ads; no cross-tenant leakage. | **PASS** |
| `global-search-mobile.png` | 390 × 844 | Mobile layout for search modal; responsive inputs and cards with no horizontal clipping. | **PASS** |
| `meta-mobile.png` | 390 × 844 | Mobile responsive Meta Discovery page: stacked form inputs, accessible buttons, full-width cards. | **PASS** |

---

## 3. Playwright E2E Scenarios Executed

1. **Scenario 1 — Healthy Meta Discovery Submission:**
   - Navigated to `/meta-discovery`.
   - Confirmed `READY` readiness indicator.
   - Entered keyword `"pet hair remover"`, selected US market and 25 ads limit.
   - Submitted form; verified HTTP 202 response.
   - Confirmed new job row rendered in the jobs table with status badge.

2. **Scenario 2 — Form Failure & Input Preservation:**
   - Simulated backend rejection.
   - Verified that all inputs remained in the form fields without reset.
   - Verified error message displayed prominently.

3. **Scenario 3 — Exact Research Run Navigation to Explorer:**
   - Clicked "View Ads" on `run_e2e_001`.
   - Explorer opened at `/explorer?platform=META&requestId=run_e2e_001`.
   - Verified banner: `Viewing advertisements from Research Run: run_e2e_001`.
   - Verified that ONLY ads belonging to `run_e2e_001` rendered.
   - Verified clicking "Exit Run View ✕" cleared the run filter.

4. **Scenario 4 — Cross-Tenant Workspace Isolation:**
   - Attempted access to unauthorized run `run_iso_002` from Workspace 1.
   - Confirmed 403 / 404 response; verified no fallback exposed foreign data.

---

## 4. Verdict
All browser UX, responsive layout, and visual fidelity criteria are PASSED.
