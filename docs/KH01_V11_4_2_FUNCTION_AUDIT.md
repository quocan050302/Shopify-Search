# KH-01 V11.4.2 — Function Inventory & Contract Audit

## Function Inventory

| File | Function | Signature | DB Operations | Network Operations | Current Failure Mode / Risk | Required V11.4.2 Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `src/lib/db.ts` | `resolveDatabaseConfiguration` | `(env: NodeJS.ProcessEnv): DatabaseConfiguration` | None | None | Missing function; raw fallback logic scattered | Strict resolution by execution role; fails closed if test points to active app DB |
| `src/lib/db.ts` | `canonicalizeSqliteDatabasePath` | `(url: string, baseDir: string): CanonicalDatabaseLocation` | None | None | Naive `.includes("production.db")` fails on symlinks / relative paths | Canonical path resolution resolving symlinks, drive letters, and encodings |
| `src/lib/db.ts` | `assertSafeTestDatabase` | `(url: string, env: NodeJS.ProcessEnv): void` | None | None | Allows test to target `dev.db` if not containing string `production.db` | Fails closed on any active application DB or missing test DB |
| `src/services/links/linkValidationService.ts` | `fetchPublicResearchPage` | `(url: ValidatedResearchUrl, opts?: PublicFetchOptions): Promise<PublicPageFetchResult>` | None | HTTP GET | DNS resolved before fetch, but underlying fetch re-resolves DNS (TOCTOU) | Binds socket connection directly to pre-validated IP address |
| `src/services/links/verifiedPublicTransport.ts` | `createVerifiedPublicDispatcher` | `(dest: VerifiedPublicDestination): Dispatcher` | None | Socket connect | Does not exist | Custom Undici / Node agent pinning connection to validated IP while preserving SNI & Host |
| `src/workers/kh01Worker.ts` | `claimPendingKh01Job` | `(workerId: string): Promise<ClaimedKh01Job \| null>` | `syncJob.findFirst`, `update` | None | Attempt number could double count if recovery pre-increments | Single atomic increment on claim with UUID token and 60s lease |
| `src/workers/kh01Worker.ts` | `recoverInterruptedKh01Jobs` | `(): Promise<RecoverySummary>` | `syncJob.findMany`, `updateMany` | None | Evaluated `startedAt` rather than actual `leaseExpiresAt` | Compares against `leaseExpiresAt`, preserves immutable payload envelope |
| `src/workers/kh01Worker.ts` | `renewKh01Lease` | `(claim: ClaimedKh01Job): Promise<void>` | `syncJob.update` | None | Did not fence on claim token, risking race with newer claim | Conditional update requiring matching `id`, `workerId`, and `claimToken` |
| `src/services/research/landingPageInspectionService.ts` | `executeLandingPageResearchJob` | `(claim: ClaimedKh01Job, signal?: AbortSignal): Promise<LandingPageResearchResult>` | `syncJob.update` | None | Multi-step uncoordinated writes; ACCESS_RESTRICTED reported completed | Atomic persistence via orchestration service; honest job status |
| `src/services/research/researchResultPersistenceService.ts` | `persistCompletedResearchResult` | `(claim: ClaimedKh01Job, res: ParsedResearchResult): Promise<PersistedResearchResult>` | Transaction across 4 models | None | Writes were separate; partial failure could leave orphaned records | Single database transaction saving offer, landing snapshot, evidence, and job status |
| `src/services/research/landingPageSnapshotService.ts` | `saveLandingPageSnapshot` | `(input: CreateLandingPageSnapshotInput): Promise<LandingPageSnapshot>` | `landingPageSnapshot.create` | None | Fallback `workspaceId \|\| "default-workspace"` | Requires verified workspace from context; no implicit fallback |
| `src/services/research/opportunityAssessmentService.ts` | `calculateOpportunityAssessment` | `(input: SixPillarOpportunityInput): ProductOpportunityAssessment` | None | None | Partial score not clearly labeled; heuristic thresholds unversioned | Explicit partial coverage flag; unified readiness gates |
| `src/app/products/[id]/intelligence/page.tsx` | `pollResearchJob` | `(jobId: string, signal: AbortSignal): Promise<ResearchJobStatusDTO>` | Via API | Via fetch | 18s elapsed time mislabeled worker as offline | Reads real heartbeat and lease timestamps to distinguish busy vs offline |

---

## Architecture Flow & Layer Separation
```
User / Worker Trigger
       ↓
API Route (`src/app/api/v1/research/...`)
       ↓
Authentication & Workspace Authorization (`researchAuthService.ts`)
       ↓
SyncJob Queue (`createLandingPageResearchJob`)
       ↓
Worker Claim with Fencing Token & Lease (`kh01Worker.ts`)
       ↓
Safe Network Transport (`verifiedPublicTransport.ts` with IP Pinning & SNI)
       ↓
Page Parser & Offer Extraction (`offerExtractionService.ts`)
       ↓
Funnel & CRO Analysis (`funnelAnalysisService.ts`)
       ↓
Transactional Persistence (`researchResultPersistenceService.ts`)
       ↓
Product Intelligence UI (`src/app/products/[id]/intelligence/page.tsx`)
```
