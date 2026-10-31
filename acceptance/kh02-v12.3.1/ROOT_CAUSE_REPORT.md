# SWAI KH-02 V12.3.1 — Root Cause Report

## Defect 1: All Meta Subqueries Throwing Swallowed as Successful Empty
- **Location:** `src/services/kh02/providers/metaResearchAdapter.ts` (`collectLiveMetaAds`)
- **Root Cause:** Individual try/catch blocks logged warnings and returned empty arrays.
- **Fix:** Introduced `aggregateMetaQueryOutcomes` ensuring all-failed queries return `executionStatus = "FAILED"` and `liveSucceeded = false`.

## Defect 2: Cached Meta Observations Satisfying Live-Query PASS
- **Location:** `src/services/kh02/providers/metaResearchAdapter.ts` (`collectMetaProductSignals`)
- **Root Cause:** Re-observed existing ads were not separated from cached-only ads.
- **Fix:** Distinguish freshly observed external IDs from untouched historical cache records.

## Defect 3: Campaign Codes Becoming Verified Product Names
- **Location:** `src/services/kh02/identity/adHeadlineClassifier.ts`
- **Root Cause:** Compound alphanumeric tokens (e.g. Wmt008 L4v2 Mustyclothes) bypassed 2-word hook checks.
- **Fix:** Added Step 5.5 generalized detection for SKU/campaign sequences lacking concrete product nouns.

## Defect 4: Broad Psychology Claims Marked OBSERVED on Weak 1-Word Quotes
- **Location:** `src/services/kh02/psychology/customerPsychologyService.ts`
- **Root Cause:** Isolated keyword match ("dog") marked broad customer/problem claims as OBSERVED.
- **Fix:** Introduced `evaluateClaimEvidenceSupport` requiring substantive phrase grounding before OBSERVED status.
