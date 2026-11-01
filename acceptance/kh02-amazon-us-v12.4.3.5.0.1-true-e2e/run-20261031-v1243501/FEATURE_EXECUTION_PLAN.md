# KH-02 V12.4.3.5.0.1 — Amazon US Real End-to-End Integration & Honest Acceptance Closure

## 1. Baseline & Target Provenance
- **Repository**: `quocan050302/Shopify-Search`
- **Branch**: `feature/kh02-amazon-us-pilot-v12.4.3.5.0`
- **Base (`origin/master`)**: `c1833362cf6634917f2ff94df19d97c393247d94`
- **Previous Observed HEAD**: `30d13d0ca4fd0d9dce901a8eca5fbb53163c007d`
- **Previous Tested Code SHA**: `93dbb717fa4a778c21baa5a0412225b7632f8688`
- **Current Frozen `CODE_SHA_A`**: `75de4e26cbef061e2fe000a0ade0b711a9bd5e38`
- **Release Version**: `12.4.3.5.0.1`

## 2. Four P0 Defects & Product-Flow Gap Closed
1. **P0-A (`src/services/kh02/marketplace/amazonUsEvidenceAdapter.ts`)**:
   - `runAmazonUsPilotEnrichment()` automatically creates and closes an owned Playwright MCP session when `hasCandidateUrls && policy.featureEnabled && policy.liveAllowed && policy.allowedAccessRoute === "USER_AUTHORIZED_URL"`.
   - `fetchAuthorizedAmazonProductEvidence()` only registers budget cleanup when `ownsMcpSession === true` (`N20`), enforces non-empty `toolInvocations` (`browser_navigate` + `browser_snapshot`) so handshake-only sessions are `NOT_EXECUTED` (`N15`, `N40`), and classifies unimplemented Creators API route as `NOT_IMPLEMENTED` (`N19`).
2. **P0-B (`src/app/products/page.tsx`)**:
   - `handleRunEvergreenResearch()` sends `enableAmazonUsPilot` in `POST /api/v1/kh02/research` and renders the Amazon US Pilot control bar (`data-testid="pf-amazon-pilot-control"`) and disabled reason (`data-testid="pf-amazon-pilot-disabled-reason"`).
3. **P0-C (`src/workers/kh02Worker.ts` & `src/services/kh02/persistence/kh02PersistenceService.ts`)**:
   - Removed `.catch(() => null)` around `persistAmazonEvidenceAtomically` (`N26`), added inside-transaction lease/fencing ownership verification (`N28`), and downgraded DB persistence failures to `PARTIALLY_COMPLETED` with `AMAZON_EVIDENCE_PERSISTENCE_FAILED` while stripping unpersisted evidence (`N25`, `N27`).
4. **P0-D (`POST /api/v1/kh02/marketplace/amazon`, `src/workers/kh02Worker.ts`, `src/app/products/page.tsx`)**:
   - Implemented post-run per-candidate **"Verify Amazon US Listing"** child job lifecycle (`jobType: "KH02_AMAZON_VERIFY"`, `verifyJobId !== researchRunId`, `1..3` candidate URLs), worker claim/lease/recovery, `attachAmazonEvidenceToExistingResearchRun()`, and accessible UI `<form>` (`data-testid="pf-verify-amazon-form"`).
