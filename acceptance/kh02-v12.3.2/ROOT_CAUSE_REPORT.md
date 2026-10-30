# SWAI KH-02 V12.3.2 — Root Cause Report

## Defect 1: Stale Frontend Bundle Running on Port 3000
- **Location:** Localhost port 3000 Next.js server
- **Root Cause:** A long-running `next start` process was serving an old production bundle built on 10/27/2026 3:42 PM, which predated commit `cbffd41` (10/28/2026 8:44 AM) that introduced `data-testid="kh02-research-shortlist-section"`.
- **Fix:** Added runtime version endpoint `/api/v1/kh02/version` returning Git SHA and build timestamp to detect stale bundles, and rebuilt the frontend bundle.

## Defect 2: 17 Raw Candidates Yielding 1 Provisional Opportunity
- **Location:** `src/services/kh02/evergreenResearchOrchestrator.ts`
- **Root Cause:** Raw observations included duplicate landing URLs, non-pet campaign ads (e.g. human facial hair remover), and early truncation `slice(0, maxCandidates)` took arbitrary database order.
- **Fix:** Prioritized candidate ordering by relevance score desc and evidence count desc before slicing, wired async merchant metadata enrichment to resolve product identities, and implemented `KH02CandidateFunnel` for auditable accounting.

## Defect 3: Meta Query Budget Refunded Allowance on Error
- **Location:** `src/services/kh02/discovery/discoveryQueryPlanner.ts` (`MetaQueryBudgetTracker`)
- **Root Cause:** `reserveRequests` calculated remaining allowance without committing; failed requests did not decrement consumed capacity.
- **Fix:** Implemented atomic request reservation and failure accounting in `MetaQueryBudgetTracker` and wired it into `metaResearchAdapter.ts`.

## Defect 4: Unsafe Merchant Landing Page Fetching
- **Location:** `src/services/kh02/identity/productMetadataExtractor.ts`
- **Root Cause:** Automatic redirect following (`redirect: "follow"`) allowed redirecting to private/internal IPs, and full response text buffering before slicing allowed large memory allocation.
- **Fix:** Switched to `redirect: "manual"`, hop-by-hop private IP/domain validation, and chunked streaming byte cap (256KB) with stream cancellation.

## Defect 5: Hardcoded P0-05 Gate in Acceptance Runner
- **Location:** `scripts/kh02/runAcceptanceV12_3_1.ts`
- **Root Cause:** `const p05Passed = true;` was hardcoded instead of dynamically evaluating whether re-observed ads received live provenance.
- **Fix:** Created `scripts/kh02/runAcceptanceV12_3_2.ts` with a dynamic executed assertion for re-observed Meta ads.
