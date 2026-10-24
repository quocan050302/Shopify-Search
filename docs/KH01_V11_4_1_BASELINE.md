# KH-01 V11.4.1 — Baseline Defect Audit & Security Hardening Report
**SWAI V11.4.1 — Competitor Product, Offer & Funnel Intelligence Engine**

## 1. Audit Context & Environment

- **Target Repository**: `quocan050302/Shopify-Search`
- **Verified Working Branch**: `feature/v11-meta-collector-remove-muse`
- **Initial Verification SHA**: `6ea32a980bcf4986bd320310ccb51039c250a550`
- **Node Version**: `v22.22.3`
- **npm Version**: `10.9.8`
- **Operating System**: macOS (Darwin 23.4.0 arm64)
- **Active Database**: SQLite `dev.db` (946,176 bytes)
- **Pre-Hardening Backup Created**: `dev.db.backup_kh01_v11_4_1_pre_hardening` (924 KB)

---

## 2. Baseline Record Counts (Pre-Hardening)

Before applying any code changes or database migrations, baseline row counts were captured directly from the active SQLite database:

| Model | Baseline Row Count | Notes |
|---|---|---|
| `CompetitorAd` | **59** | Authentic Meta Facebook/Instagram advertisements |
| `Advertiser` | **17** | Verified advertiser entities |
| `AdMediaAsset` | **59** | Stored image/video assets |
| `AdObservation` | **160** | Observed impression/activity records |
| `DiscoveryRun` | **64** | Historical collection runs |
| `DiscoveryRunAd` | **0** | Legacy linkage table (populated via ad relations) |
| `ResearchProduct` | **26** | Tracked products |
| `AdProductLink` | **6** | Verified ad-to-product links |
| `CompetitorOfferSnapshot` | **0** | Ready for live offer observations |
| `LandingPageSnapshot` | **0** | Ready for live page observations |
| `ResearchEvidence` | **0** | Ready for granular claim evidence |
| `ProductEconomicsScenario` | **0** | Ready for persisted scenarios |
| `SupplierQuote` | **0** | Ready for supplier invoice evidence |
| `FulfillmentAssessment` | **0** | Ready for logistics assessments |
| `ProductOpportunityAssessment` | **0** | Ready for six-pillar assessments |
| `ResearchDecision` | **12** | Historical user research decisions |
| `SyncJob` | **48** | Job queue entries |
| `Workspace` | **1** | Default: `'default-workspace'` (`"US Winning Ads Research Desk"`) |
| `WorkspaceMember` | **0** | Single-user / Admin ownership architecture |
| `User` | **0** | Admin credential authentication model |

---

## 3. Detected Critical Baseline Defects

### Defect A: Workspace Authorization Bypass via Unauthenticated Headers
- **Location**: `src/services/research/researchAuthService.ts` (`resolveAuthorizedResearchContext`)
- **Vulnerability**: Accepts caller-supplied `x-workspace-id` or query parameter and checks only whether the workspace exists in the database (`prisma.workspace.findUnique`), granting access without establishing whether the authenticated principal has permission for that workspace. Accepts untrusted `x-actor-id` directly.

### Defect B: Orphan Records Pass Access Checks (Fail-Open on Empty Sets)
- **Location**: `src/services/research/researchAuthService.ts` (`assertAdWorkspaceAccess`, `assertProductWorkspaceAccess`)
- **Vulnerability**: If an ad or product has zero workspace associations (`associatedWorkspaceIds.size === 0`), access is granted unconditionally rather than failing closed.

### Defect C: Job Status Endpoint Performs Expensive Mutations on GET
- **Location**: `src/app/api/v1/research/jobs/[jobId]/route.ts`
- **Vulnerability**: `GET /api/v1/research/jobs/:id?execute=true` triggers `executeLandingPageResearchJob(job.id)`. GET requests must be strictly read-only and idempotent.

### Defect D: Job Executor Does Not Validate Claim or Lease Ownership
- **Location**: `src/services/research/landingPageInspectionService.ts` (`executeLandingPageResearchJob`)
- **Vulnerability**: Directly updates `SyncJob` to `RUNNING` without validating an active worker claim or lease ownership token.

### Defect E: Interrupted Job Recovery Corrupts Job Payload
- **Location**: `src/workers/kh01Worker.ts` (`recoverInterruptedKh01Jobs`)
- **Vulnerability**: Recovery updates `resultJson` with retry metadata, overwriting `targetUrl`, `productId`, and `adId`.

### Defect F: Fabricated Scoring Inputs in Opportunity API
- **Location**: `src/app/api/v1/research/products/[id]/opportunity/route.ts`
- **Vulnerability**: Injects hardcoded default values: `identityConfidence: "EXACT"`, `clearCtaObserved: true`, video demo inferred from video duration/aspect ratio, `confidence: 0.8`, `croReadiness: cro.croReadinessScore || 65`, and default problem statement.

### Defect G: Missing Research Pillars Scored as Neutral (50)
- **Location**: `src/services/research/opportunityAssessmentService.ts` (`calculateOpportunityAssessment`)
- **Vulnerability**: Replaces missing or uninspected pillars with a score of 50. Missing data must be represented as `score: null` and `status: "INSUFFICIENT_DATA"`.

### Defect H: Inconsistent Decision Gates and Readiness Policy
- **Location**: `calculateOpportunityAssessment()` vs `evaluateSmallTestReadiness()`
- **Vulnerability**: Uses diverging logic for test readiness. Both must rely on one canonical eligibility policy.

### Defect I: Synthetic Integration Test Misrepresented as Live Acceptance
- **Location**: `tests/integration/kh01ProductIntelligenceWorkspace.test.ts`
- **Vulnerability**: Test uses fixture `test-kh01-meta-ad-1` and mocked network fetch. Must clearly distinguish fixture integration tests from live real-source verification.

### Defect J: Database Isolation Not Enforced During Tests
- **Location**: `src/lib/db.ts`
- **Vulnerability**: Vitest integration tests run against `DATABASE_URL` (defaulting to the active SQLite research database). Must enforce `assertSafeTestDatabase()` and use isolated test databases.

### Defect K: Fabricated Defaults in UI
- **Location**: `src/app/products/[id]/intelligence/page.tsx`
- **Vulnerability**: Renders fallback Evidence Readiness of 35% even when unassessed. Must render "Not Assessed".

### Defect L: Lack of IP Destination Resolution & SSRF Pinning
- **Location**: `src/services/links/linkValidationService.ts`
- **Vulnerability**: Validates URL text but does not verify resolved destination IP addresses on the actual connection, leaving window for DNS rebinding.

---

## 4. Remediation Plan

The implementation proceeds through 6 strict release checkpoints:
1. **P0.1–P0.2 Security**: Fix principal resolver, workspace authorization, and fail-closed orphan record policy.
2. **P0.3–P0.4 Job Engine**: Make GET status read-only, implement atomic claim leases, token verification, and payload-preserving recovery.
3. **P0.5 URL Security**: Enforce DNS IP destination validation and hop-by-hop redirect verification.
4. **P0.6–P0.7 Scoring**: Remove fabricated scoring inputs, unify readiness gates, and handle missing pillars honestly.
5. **P1.1–P1.3 Data, UI & Test Isolation**: Validate APIs with Zod, fix UI null/zero displays, and isolate test databases.
6. **P1.4–P1.5 Real-Source Acceptance & Benchmarks**: Execute bounded research on real Meta ads, measure performance, and produce final documentation.
