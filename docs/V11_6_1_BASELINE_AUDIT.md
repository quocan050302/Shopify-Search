# SWAI V11.6.1 — Baseline Audit & Acceptance Integrity Analysis

**Date:** 2026-10-25  
**Auditor:** ANTI (Google Deepmind)  
**Target Version:** V11.6.1  
**Baseline Version:** V11.6.0  
**Repository:** `quocan050302/Shopify-Search`  
**Target Branch:** `feature/v11-meta-collector-remove-muse`  
**Starting HEAD SHA:** `f4750db52b214c1e9362c1d066e50865ae8ca286`  
**Implementation Commit from V11.6.0:** `cb39a4936368cd6da0962f7deda2d1df9499301c`

---

## 1. Executive Summary

In V11.6.0, SWAI executed a genuine live MetaAdsCollector pipeline against the Meta Ad Library using:
- Target keyword: `gadget`
- Market: `US`
- Requested limit: 25
- Provider: `meta-ads-collector` (Python MCP over stdio)
- Source mode: `REAL_LIVE_META`

The published evidence confirmed:
- DiscoveryRun: `COMPLETED`
- Actual Retrieved: 25
- Valid Ads Normalized: 25
- SQLite Linked Ads: 25 (`cmvnzh2x500012eg9d8lsodjk`)
- HTTP API Ads Readback: 25
- Chromium DOM Cards Observed: 24
- Reported Browser Reconciliation: `TRUE` (False Positive)
- Live Journey Exit: `SUCCESS`

This audit confirms that the core application pipeline (MCP, Worker, Prisma, SQLite, Next.js API, and Ads Explorer UI) functioned as designed. The defect lies in the **verification harness**:
1. Explorer paginates at 12 ads/page (`src/app/explorer/page.tsx:242`). For 25 ads, page 1 = 12 ads, page 2 = 12 ads, page 3 = 1 ad.
2. The verification script `scripts/meta-live-journey.ts` only visited page 1 and page 2, capturing 24 of 25 ads, omitting page 3.
3. The reconciliation logic only checked `unexpectedDomIds.length === 0`, ignoring missing ads, allowing 24 cards to be reconciled against 25 database ads.
4. Upstream request execution was inferred from `resultSetId` when `stats.requests_made` was absent.
5. Resource teardown was only executed on success, skipping cleanup on early errors or failures.
6. Worker provider evidence fell back to `workerProviderEvidences[0]` rather than requiring an exact `discoveryRunId` match.

---

## 2. Baseline Git State & Audit Verification

```bash
$ git status --short
(clean)

$ git branch --show-current
feature/v11-meta-collector-remove-muse

$ git rev-parse HEAD
f4750db52b214c1e9362c1d066e50865ae8ca286

$ git log -3 --oneline
f4750db docs(v11.6.0): publish live meta collection verification audit and release report
cb39a49 fix(v11.6.0): factual live meta collection provenance and validation journey
8042e3e docs(v11.5.9.1): publish runtime auth regression verification
```

---

## 3. Confirmed Defects & Affected Call Sites

### Defect 1: Truncated Chromium Pagination Verification
- **File:** `scripts/meta-live-journey.ts` (lines 528–538)
- **Code:**
  ```typescript
  const nextBtn = page.locator("button:has-text('Next'), button[aria-label='Next page'], [data-testid='pagination-next']").first();
  const hasNext = await nextBtn.isVisible().catch(() => false);
  if (hasNext && (await nextBtn.isEnabled().catch(() => false))) {
    await nextBtn.click().catch(() => {});
    await page.waitForTimeout(1500);
    const page2Ids = await page
      .locator("[data-testid='exact-run-ad-card']")
      .evaluateAll((els: any[]) => els.map((el) => el.getAttribute("data-ad-id")).filter(Boolean));
    page2Ids.forEach((id: string) => domAdIdsSet.add(id));
  }
  ```
- **Root Cause:** The code only attempts a single "Next" click (transitioning from Page 1 to Page 2). It never checks for Page 3 or subsequent pages. For 25 ads with `pageSize=12`, Page 3 holds the 25th ad (`cmvnzhl6400432ig9x5xdyg1s`, external ID `908825735077255`).
- **Remediation:** Implement `collectExactRunBrowserAdIds` to iteratively traverse until `currentPage >= totalPages` and Next is disabled, recording page-level evidence and screenshots.

---

### Defect 2: Asymmetric False-Positive Card Comparison
- **File:** `scripts/meta-live-journey.ts` (lines 543–544)
- **Code:**
  ```typescript
  const unexpectedDomIds = domAdIds.filter((id) => !persistedAdIds.includes(id));
  const domMatchesDb = domAdIds.length > 0 && unexpectedDomIds.length === 0;
  ```
- **Root Cause:** Only checks that all observed browser cards exist in the database (subset check). It does NOT check that all database cards exist in the browser (`missingFromBrowser.length === 0`) or that counts match (`domAdIds.length === persistedAdIds.length`).
- **Remediation:** Implement bidirectional exact reconciliation helper `reconcileExactAdIdSets` verifying:
  - `missingFromHttp.length === 0`
  - `unexpectedInHttp.length === 0`
  - `missingFromBrowser.length === 0`
  - `unexpectedInBrowser.length === 0`
  - `duplicateDatabaseIds.length === 0`
  - `duplicateHttpIds.length === 0`
  - `duplicateBrowserIds.length === 0`
  - `databaseIds.length === httpIds.length && databaseIds.length === browserIds.length`

---

### Defect 3: Weak Final Live Journey Success Decision & Exit Code
- **File:** `scripts/meta-live-journey.ts` (lines 639, 649–651)
- **Code:**
  ```typescript
  return {
    success: finalRun.status === "COMPLETED" && finalRun.validCount > 0,
    ...
  };
  ...
  runMetaLiveJourney(options).then((res) => {
    process.exit(res.success ? 0 : 1);
  });
  ```
- **Root Cause:** Success is evaluated purely on `finalRun.status === "COMPLETED"` and `validCount > 0`. Even if HTTP readback fails, Browser fails, or reconciliation fails, the script returns `success: true` and exits with code 0!
- **Remediation:** Implement `finalizeLiveJourneyVerdict(gates)` requiring all mandatory gates (`source`, `worker`, `persistence`, `http`, `browser`, `reconciliation`, `artifactIntegrity`) to be `PASSED`. Fail closed with exit code 1 if any gate fails or is blocked.

---

### Defect 4: Fallback Inferred Upstream Request Execution
- **Files:**
  - `src/services/discovery/metaCollector/inspectLiveMetaSource.ts` (line 54)
  - `src/services/discovery/providers/metaAdsCollectorProvider.ts` (lines 470–473)
- **Code in `inspectLiveMetaSource.ts`:**
  ```typescript
  const requestsMade = typeof stats?.requests_made === "number" ? stats.requests_made : (resultSetId && !isFixture ? 1 : 0);
  ```
- **Code in `metaAdsCollectorProvider.ts`:**
  ```typescript
  else if (mcpResponse || continueRes) {
    upstreamReq = Boolean(mcpResponse?.result_set_id || continueRes?.result_set_id);
    upstreamResp = upstreamReq && rawAds.length > 0;
  }
  ```
- **Root Cause:** A `result_set_id` proves a local result set was created; it does not authoritatively prove a fresh upstream network request was made to Meta.
- **Remediation:** Require explicit observed numeric stats `typeof stats?.requests_made === "number" && Number.isFinite(stats.requests_made) && stats.requests_made > 0`. If absent, `upstreamRequestObserved = false`, classification remains `UNKNOWN`, and live acceptance cannot claim `VERIFIED`.

---

### Defect 5: Unsafe Resource Management & Early Uncaught Process Exits
- **File:** `scripts/meta-live-journey.ts` (lines 97, 125, 617–636)
- **Code:** Early `process.exit(1)` upon configuration/handshake failure; teardown placed at the end without `try/finally`.
- **Root Cause:** Any failure between MCP launch, database allocation, Next.js server startup, and browser navigation leaves orphaned worker subprocesses, running Next servers, or ephemeral database files.
- **Remediation:** Encapsulate resources in an explicit lifecycle manager `cleanupLiveJourneyResources()`. Wrap execution in `try ... finally` to guarantee teardown and ensure failure artifacts are preserved.

---

### Defect 6: Worker Provider Evidence Non-Exact Matching
- **File:** `scripts/meta-live-journey.ts` (line 433)
- **Code:**
  ```typescript
  const matchedProvEv = workerProviderEvidences.find((p) => p.discoveryRunId === discoveryRunId) || workerProviderEvidences[0] || null;
  ```
- **Root Cause:** The `|| workerProviderEvidences[0]` fallback can match evidence from a different discovery run executed earlier by the worker.
- **Remediation:** Require strict match:
  ```typescript
  const matchedProvEv = workerProviderEvidences.find(
    (p) => p.discoveryRunId === discoveryRunId && p.providerId === "meta-ads-collector"
  ) || null;
  ```
  If missing, reject evidence and fail closed.

---

## 4. Protected Invariants & Non-Breaking Constraints

1. **Prisma Schema:** `prisma/schema.prisma` is untouched; zero migrations.
2. **User Database:** Active `dev.db` is strictly protected against mutation.
3. **Ads Explorer UI:** `pageSize=12` in `src/app/explorer/page.tsx` is preserved. Verification must adapt to the UI, not vice versa.
4. **Authentication:** Bearer token authorization and workspace isolation are preserved.
5. **Worker Leasing:** Discovery job leasing and polling architecture are preserved.
