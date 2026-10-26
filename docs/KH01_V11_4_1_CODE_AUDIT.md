# KH-01 V11.4.1 — Comprehensive Code & Contract Audit

## Executive Summary
This audit documents the systematic inspection, verification, and resolution of all critical integrity defects identified in SWAI V11.4.0 master plan KH-01.

Every defect identified in Section 01 of the master prompt was investigated in the active codebase, patched with strict type contracts, and validated with tests.

---

## Defect Inventory & Remediation Matrix

### Critical Defect A: Workspace Authorization & Actor Impersonation
- **Target File**: `src/services/research/researchAuthService.ts`
- **Initial Finding**: `resolveAuthorizedResearchContext()` accepted caller-provided `x-actor-id` directly and allowed arbitrary workspace selection if the workspace ID existed in the database.
- **Remediation**:
  - Implemented `resolveResearchPrincipal(request)` using timing-safe secret verification (`safeSecretCompare`).
  - Completely decoupled principal identity from `x-actor-id`. Principal is strictly bound to the authenticated server-side session or admin owner.
  - Restricted workspace selection to `principal.allowedWorkspaceIds`.
  - Added `assertWorkspaceMembership` with role hierarchy validation (`VIEWER < MEMBER < ADMIN < OWNER`).

### Critical Defect B: Orphan Records Access Bypass
- **Target File**: `src/services/research/researchAuthService.ts`
- **Initial Finding**: `assertAdWorkspaceAccess()` and `assertProductWorkspaceAccess()` only rejected requests when `associatedWorkspaceIds.size > 0`. If an ad or product had no associations, it passed access checks implicitly.
- **Remediation**:
  - Re-architected both assertions to **fail closed**.
  - Any ad or product with zero associated workspaces is classified as an orphan record and rejected (HTTP 403 `FORBIDDEN_WORKSPACE_AD` / `PRODUCT_NOT_FOUND`) unless accessed within the system default workspace under explicit legacy policy.

### Critical Defect C: GET Performs Heavy Crawler Mutations
- **Target File**: `src/app/api/v1/research/jobs/[jobId]/route.ts`
- **Initial Finding**: `GET /api/v1/research/jobs/:id?execute=true` triggered `executeLandingPageResearchJob()`, causing state mutations on read requests and race conditions with background workers.
- **Remediation**:
  - Completely removed execution invocation from `GET`.
  - `GET` is strictly read-only, idempotent, and returns `ResearchJobStatusDTO`.
  - Added bounded polling in `src/app/products/[id]/intelligence/page.tsx` with honest `Queued`, `Running`, `Worker Offline`, `Completed`, and `Access Restricted` states.

### Critical Defect D: Unclaimed Job Execution Without Active Lease
- **Target Files**: `src/services/research/landingPageInspectionService.ts`, `src/workers/kh01Worker.ts`
- **Initial Finding**: `executeLandingPageResearchJob()` wrote `RUNNING` status without checking active worker claim token or lease expiration.
- **Remediation**:
  - Added `ClaimedKh01Job` contract with cryptographically random `claimToken = crypto.randomUUID()` and lease expiration (`leaseExpiresAt = Date.now() + 60_000`).
  - Added `assertActiveJobLease(jobId, workerId, claimToken)` and `renewKh01Lease(claim)`.
  - Prohibited direct execution of unclaimed jobs.

### Critical Defect E: Recovery Replaces Payload and Discards Research Target
- **Target File**: `src/workers/kh01Worker.ts`
- **Initial Finding**: `recoverInterruptedKh01Jobs()` replaced `resultJson` with recovery metadata, discarding `targetUrl`, `productId`, and `adId`.
- **Remediation**:
  - Enforced immutable envelope parsing.
  - Recovery strictly preserves `targetUrl`, `productId`, `adId`, and `forceRefresh`, updating attempt counters without overwriting the research target.
  - Terminal failure enforced after 3 retry attempts.

### Critical Defect F: Opportunity Scoring Fabricates Evidence
- **Target File**: `src/app/api/v1/research/products/[id]/opportunity/route.ts`
- **Initial Finding**: Scoring route assigned hardcoded `identityConfidence = "EXACT"`, `hasVideoDemonstration = true` (inferred solely from aspect ratio or video asset presence), `clearCtaObserved = true`, `confidence = 0.8`, and fallback CRO score `65`.
- **Remediation**:
  - Implemented `buildProductOpportunityInput(productId, context)` which queries the database for genuine observed facts.
  - Identity defaults to `INSUFFICIENT_EVIDENCE` or `PROBABLE` unless independently verified.
  - Video demonstration is marked `false` unless explicitly observed during video inspection.
  - CRO readiness is `null` (not 65) when no landing page assessment exists.

### Critical Defect G: Missing Pillars Scored as Neutral 50
- **Target File**: `src/services/research/opportunityAssessmentService.ts`
- **Initial Finding**: Missing pillar scores were replaced by `50`.
- **Remediation**:
  - Missing pillars remain `score: null` and `status: "INSUFFICIENT_DATA"`.
  - Weighted total only includes assessed pillars, normalized by `totalAssessedWeight`.
  - If core pillars are unassessed, overall `opportunityScore` is `null`.

### Critical Defect H: Inconsistent Recommendation & Eligibility Gates
- **Target File**: `src/services/research/opportunityAssessmentService.ts`
- **Initial Finding**: `calculateOpportunityAssessment()` and `evaluateSmallTestReadiness()` had divergent rules. Unassessed fulfillment passed because status was not `FAIL`.
- **Remediation**:
  - Unified eligibility under canonical decision gates.
  - `recommendation = "TEST_CANDIDATE"` is strictly prohibited unless `evaluateSmallTestReadiness.isReadyForSmallTest` is `true`.
  - Unassessed fulfillment (`INSUFFICIENT_DATA`) blocks test readiness.

### Critical Defect I: Fixture Ads Claimed as Real Records
- **Target File**: `tests/integration/kh01ProductIntelligenceWorkspace.test.ts`
- **Initial Finding**: Synthetic ad `test-kh01-meta-ad-1` was referenced as a live record.
- **Remediation**:
  - Explicitly labeled synthetic test fixtures as `INTEGRATION_FIXTURE`.
  - Created dedicated `tests/integration/kh01LiveSourceAcceptance.test.ts` (`LIVE_SOURCE_ACCEPTANCE`) validating real Meta ad `1642750633880173` against its live storefront.

### Critical Defect J: Database Isolation Risk
- **Target File**: `src/lib/db.ts`
- **Initial Finding**: Tests could silently execute against production or default `dev.db`.
- **Remediation**:
  - Added `assertSafeTestDatabase(databaseUrl, environment)` and support for `TEST_DATABASE_URL`.
  - Test suites fail closed if run against production database files.

### Critical Defect K: Fabricated UI Defaults
- **Target File**: `src/app/products/[id]/intelligence/page.tsx`
- **Initial Finding**: Displayed fake default readiness `35%` when no assessment existed.
- **Remediation**:
  - Replaced fallback with `null`.
  - Renders "Not Assessed" when unassessed.
  - Fixed truthiness check for zero (`score !== null && score !== undefined`).
  - Reset form inputs on product ID change to prevent cross-product state pollution.

### Critical Defect L: Incomplete SSRF & DNS Destination Enforcement
- **Target File**: `src/services/links/linkValidationService.ts`
- **Initial Finding**: Hostname string regex checks without destination IP inspection allowed DNS rebinding and loopback bypass.
- **Remediation**:
  - Added `isRestrictedIpAddress()` covering RFC 1918, CGNAT, loopback, cloud metadata `169.254.169.254`, IPv4-mapped IPv6, and multicast.
  - Added `resolveAndValidatePublicDestination()` resolving all candidate A/AAAA records before connection.
  - Enforced destination IP validation on initial fetch and every redirect hop.
