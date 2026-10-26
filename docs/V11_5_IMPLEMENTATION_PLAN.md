# SWAI V11.5 — Master Implementation Plan (KH-01 Hardening & UX Rebuild)
**Version Target**: V11.5  
**Audited Baseline Commit**: `90c2bfa74e45d3a03cf8228eff957a2c9a366f7e`  
**Branch**: `feature/v11-meta-collector-remove-muse`

---

## Checkpoint Overview & Sequencing

### Checkpoint A — Baseline Audit & Interaction Matrix (COMPLETE)
- [x] Run Git status & commit verification.
- [x] Inspect all core API routes, workers, services, and UI components.
- [x] Create `docs/V11_5_BASELINE_AUDIT.md`.
- [x] Create `docs/V11_5_UI_UX_PROBLEMS.md`.
- [x] Create `docs/V11_5_IMPLEMENTATION_PLAN.md`.

---

### Checkpoint B — Security: Meta API Authorization & Workspace Scoping
- [ ] Refactor `src/app/api/v1/discovery/meta/requests/route.ts`:
  - Enforce `resolveAuthorizedResearchContext(request)` in both `GET` and `POST`.
  - Disallow arbitrary client-supplied `workspaceId`. Use authorized `context.workspaceId`.
  - Filter `prisma.discoveryRun.findMany` and `count` strictly by `workspaceId: context.workspaceId`.
- [ ] Refactor `src/app/api/v1/discovery/meta/requests/[id]/route.ts`:
  - Assert workspace access on discovery run. Return 404 if not found or 403 if belonging to another workspace.
- [ ] Refactor `src/app/api/v1/discovery/meta/requests/[id]/cancel/route.ts`:
  - Assert workspace access before cancelling.
- [ ] Refactor `src/app/api/v1/discovery/meta/requests/[id]/retry/route.ts`:
  - Assert workspace access before retrying; propagate authorized `workspaceId`.
- [ ] Refactor `src/app/api/v1/discovery/meta/requests/[id]/ads/route.ts`:
  - Scope returned ads to authorized workspace run.
- [ ] Add adversarial multi-tenant integration test `tests/integration/metaDiscoverySecurity.test.ts`:
  - Prove workspace A cannot read, create, cancel, retry, or access ads of workspace B.

---

### Checkpoint C — KH-01 Reliability: Worker Fencing, Identity & Acceptance Truthfulness
- [ ] **Worker Fencing Hardening (`src/workers/kh01Worker.ts`)**:
  - In `acquireResearchSlot()`: reject takeover if active lease is owned by *another token*, even if workerId is identical.
  - Require explicit token and fencing version checks on slot release and updates.
- [ ] **Multi-Process Concurrency Test (`tests/integration/kh01WorkerConcurrency.test.ts`)**:
  - Implement real multi-process Node.js scenario with isolated SQLite database.
- [ ] **Product Identity Correctness (`src/services/research/productIdentityService.ts`)**:
  - Distinguish inferred vs confirmed identity; do not automatically set `EXACT` on unverified ad links.
  - Enforce workspace scoping before creating ad-product links.
- [ ] **Remove Hardcoded Landing Page Defaults (`src/services/research/opportunityAssessmentService.ts`)**:
  - Derive `hasProductHero` and structural elements from `croSignalsJson` or mark unknown/unverified.
- [ ] **User Override Safety (`src/app/api/v1/research/products/[id]/decisions/route.ts`)**:
  - Require non-empty reason when overriding algorithmic blocker.
  - Record `actorId` and timestamp.
- [ ] **Acceptance Truthfulness (`scripts/kh01/runFullAcceptance.ts`)**:
  - Implement explicit GateEvidence registry.
  - Compare Git branch against `feature/v11-meta-collector-remove-muse`.
  - Add real `verifyLiveMetaSource()` function that returns `NOT_RUN` unless explicit live option is passed and verified.

---

### Checkpoint D — Design System: Semantic Tokens & UI Primitives
- [ ] Create `src/styles/tokens.css` with semantic color tokens, surface elevations, and contrast ratios.
- [ ] Update `src/app/globals.css` to import and expose design tokens.
- [ ] Build reusable UI primitives in `src/components/ui/`:
  - `Badge.tsx`: Semantic statuses with contrast-tested colors and accessible icons.
  - `Button.tsx`: Primary, secondary, ghost, danger states with loading spinner and disabled handling.
  - `Drawer.tsx`: Accessible sliding panel with Escape key and focus restoration.
  - `Table.tsx`: Styled, responsive data table with empty/loading skeleton states.
  - `EmptyState.tsx`: Context-rich empty states with actionable primary buttons.

---

### Checkpoint E — Global Navigation & Layout Rebuild
- [ ] **Sidebar (`src/components/layout/Sidebar.tsx` & subcomponents)**:
  - Reorganize into WORKSPACE, RESEARCH, INTELLIGENCE, OPERATIONS, SYSTEM.
  - Fix active state matching with `useSearchParams()` so `/explorer?mode=EVERGREEN` highlights correctly.
  - Support desktop collapse (256px -> 68px) and mobile responsive overlay.
- [ ] **Header (`src/components/layout/Header.tsx`)**:
  - Replace inert search with functional entity search or clean shortcut palette.
  - Breadcrumb navigation and workspace indicator.
  - Contextual TikTok link relocation.
  - Preserve functional `ImportAdModal` flow.

---

### Checkpoint F & G — Meta Discovery & Research Jobs Rebuild
- [ ] Decompose `src/app/meta-discovery/page.tsx` into modular components:
  - `MetaWorkspaceHeader.tsx`: Title, status summary, quick actions.
  - `MetaSetupGuide.tsx`: Contextual setup guide (dependencies, python venv, worker, doctor).
  - `MetaResearchForm.tsx`: Clean keyword input, parsed chips, synchronized result budget.
  - `MetaAdvancedFilters.tsx`: Collapsible delivery status, format, freshness filters.
  - `MetaJobsTable.tsx`: Compact data table with scannable columns, pagination, and status filters.
  - `MetaJobDetailsDrawer.tsx`: Contextual drawer for full job run metadata, progress, and ad links.
  - `MetaDiagnosticsPanel.tsx`: Accurate runtime diagnostics checking python, data dir, heartbeat, and MCP transport.
- [ ] Supporting logic modules:
  - `src/lib/meta/normalizeMetaHealth.ts`: Real system readiness model (`READY`, `SETUP_REQUIRED`, `WORKER_OFFLINE`, `DEGRADED`).
  - `src/lib/meta/mapMetaJobStatus.ts`: Semantic status presentation and accessible badges.
  - `src/lib/meta/validateMetaResearchForm.ts`: Client-side validation matching Zod schema and provider budget.
  - `src/hooks/useMetaDiscovery.ts`: Independent polling and mutation hooks with abort controllers.

---

### Checkpoint H — Cross-Application Consistency
- [ ] Apply semantic tokens and updated layout to:
  - `/explorer` (Ads Explorer & Evergreen Research)
  - `/products` (Winning Product Finder)
  - `/products/[id]/intelligence` (Product Intelligence 6-Pillars)
  - `/reports` (Reports & Exports)
  - `/settings` (Settings & Provider Connections)

---

### Checkpoint I — Automated Testing & Verification
- [ ] Unit tests:
  - `tests/unit/metaReadiness.test.ts`
  - `tests/unit/metaResearchForm.test.ts`
  - `tests/unit/metaJobStatus.test.ts`
  - `tests/unit/kh01WorkerFencingHardened.test.ts`
- [ ] Integration tests:
  - `tests/integration/metaDiscoverySecurity.test.ts`
  - Multi-process concurrency scenario in `tests/integration/kh01WorkerConcurrency.test.ts`
- [ ] Acceptance suite:
  - `npm run kh01:acceptance:full`
  - `npm run kh01:verify`
  - `npm run build`
  - `npx tsc --noEmit`
  - `npm run lint`

---

### Checkpoint J — Visual Inspection & Final Release Deliverables
- [ ] Capture visual screenshots of all critical states:
  - `meta-setup-required-desktop.png`
  - `meta-ready-desktop.png`
  - `meta-jobs-populated.png`
  - `meta-job-details.png`
  - `meta-mobile.png`
- [ ] Author final documentation:
  - `docs/V11_5_FINAL_IMPLEMENTATION_REPORT.md`
  - `docs/V11_5_UI_UX_ACCEPTANCE.md`
  - `docs/V11_5_KH01_SECURITY_AUDIT.md`
  - `docs/V11_5_KNOWN_LIMITATIONS.md`
- [ ] Commit and push to `feature/v11-meta-collector-remove-muse`.
