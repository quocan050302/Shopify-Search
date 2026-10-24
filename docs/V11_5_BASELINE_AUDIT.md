# SWAI V11.5 — Baseline Technical Audit
**Date**: 2026-10-24  
**Audited Git SHA**: `90c2bfa74e45d3a03cf8228eff957a2c9a366f7e`  
**Audited Branch**: `feature/v11-meta-collector-remove-muse`  
**Operating Mode**: `RESEARCH_ONLY`  
**Primary Target Market**: United States (US)

---

## 1. Executive Summary
The audited baseline establishes the foundation for SWAI V11.5. This audit investigates the exact source code across security, data integrity, concurrency fencing, acceptance truthfulness, and frontend user experience.

All findings below are traced directly to actual source files, functions, lines, and database models.

---

## 2. Git Invariants & Repository Status
- **Current HEAD**: `90c2bfa74e45d3a03cf8228eff957a2c9a366f7e`
- **Active Branch**: `feature/v11-meta-collector-remove-muse`
- **Status Against Baseline 90c2bfa**: HEAD matches the audited baseline commit exactly.
- **Untracked Artifacts**: Minimal local artifacts (`pnpm-lock.yaml`, `pnpm-workspace.yaml`).

---

## 3. Confirmed Security Vulnerabilities (Meta Discovery API)

### 3.1 Unscoped and Unauthenticated `GET /api/v1/discovery/meta/requests`
- **File**: `src/app/api/v1/discovery/meta/requests/route.ts` (lines 89–167)
- **Vulnerability**: 
  - Handler does not invoke `resolveAuthorizedResearchContext(request)`.
  - `prisma.discoveryRun.findMany` query only filters by `providerId: { in: [...] }` without scoping by `workspaceId`.
  - Any caller can list all discovery runs across all workspaces.

### 3.2 Caller-Supplied Workspace ID and Unauthenticated `POST /api/v1/discovery/meta/requests`
- **File**: `src/app/api/v1/discovery/meta/requests/route.ts` (lines 22–83)
- **Vulnerability**:
  - Accepts arbitrary client-supplied `workspaceId` in body (`validated.workspaceId`).
  - Does not authenticate caller or verify tenant membership.
  - Allows cross-workspace injection of discovery runs.

### 3.3 Unauthenticated and Unscoped Run Sub-routes
- **Files**:
  - `src/app/api/v1/discovery/meta/requests/[id]/route.ts`: Reads discovery run without tenant verification.
  - `src/app/api/v1/discovery/meta/requests/[id]/cancel/route.ts`: Cancels runs without verifying workspace ownership.
  - `src/app/api/v1/discovery/meta/requests/[id]/retry/route.ts`: Retries jobs without asserting workspace ownership.
  - `src/app/api/v1/discovery/meta/requests/[id]/ads/route.ts`: Returns competitor ads without verifying workspace scoping.

---

## 4. Confirmed KH-01 Reliability & Data Integrity Defects

### 4.1 Acceptance Truthfulness & Gate Derivation Defect
- **File**: `scripts/kh01/runFullAcceptance.ts` (lines 193–218, 390–425)
- **Issue**:
  - All 13 mandatory gates are derived from suite-level stage exit codes (`exitCode === 0`).
  - `git branch --show-current` uses a shell fallback that silently returns default string on error.
  - Live source gate (`liveSource.status`) unconditionally returns `options.runLiveSource ? "PASSED" : "NOT_RUN"` without executing real network validation.

### 4.2 Worker Claim Fencing: Same Worker ID with Different Token Hijack Risk
- **File**: `src/workers/kh01Worker.ts` (lines 387–391)
- **Issue**:
  - `acquireResearchSlot()` checks `if (meta.workerId && meta.workerId !== workerId && isLeaseActive) { return null; }`.
  - If a caller uses the *same* `workerId` with a *different* `claimToken`, the check passes and overwrites the active lease.
  - Worker ID alone is insufficient proof of lease ownership.

### 4.3 Inferred Product Identity Overstatement
- **File**: `src/services/research/productIdentityService.ts` (lines 114–116)
- **Issue**:
  - `if (existingLinks.length > 0) { identityConfidence = "EXACT"; }` sets confidence to `EXACT` even if existing links are merely inferred or unverified.
  - Linking actions do not strictly verify tenant workspace boundaries before attaching ads.

### 4.4 Hardcoded Landing Page Signal Defaults
- **File**: `src/services/research/opportunityAssessmentService.ts` (line 877)
- **Issue**:
  - Sets `hasProductHero: true` as a hardcoded static boolean in `buildProductOpportunityInput()` instead of deriving it from actual `croSignalsJson`.

### 4.5 User Override Safety in Product Decisions
- **File**: `src/app/api/v1/research/products/[id]/decisions/route.ts` (lines 42–50)
- **Issue**:
  - Overriding an algorithmic blocker allows empty `notes` (`.default("")`), does not record the acting principal's `actorId`, and lacks explicit unmet requirements tracking.

---

## 5. Confirmed Frontend Information Architecture & UX Defects

### 5.1 Monolithic Architecture in `MetaDiscoveryPage`
- **File**: `src/app/meta-discovery/page.tsx` (771 lines)
- **Issue**: Combines health polling, request fetching, form validation, job mutation, diagnostics modal, and table rendering in a single client component with excessive rerenders.

### 5.2 Inert Global Search Input
- **File**: `src/components/layout/Header.tsx` (lines 16–21)
- **Issue**: Plain HTML input with no state, handlers, or form action. It misleadingly suggests search functionality without doing anything.

### 5.3 Active Navigation Parameter Blindness
- **File**: `src/components/layout/Sidebar.tsx` (lines 70–85)
- **Issue**: Only checks `usePathname()`. Navigating to `/explorer?mode=EVERGREEN` highlights both `/explorer` and fails to distinguish `mode=EVERGREEN`.

### 5.4 Misleading Diagnostics Modal
- **File**: `src/app/meta-discovery/page.tsx` (line 716)
- **Issue**: Displays hardcoded `READY (stdio transport)` for MCP client without verifying runtime process health.

### 5.5 Incoherent System Readiness State
- **File**: `src/app/meta-discovery/page.tsx`
- **Issue**: When collector is unconfigured or worker is offline, the page displays 4 alarming cards while keeping the primary "Queue Meta Research Task" button active, leading to confusing user failures.
