# V6.1 Test Evidence Report
**Shopify Winning Ads Intelligence (SWAI)**  
**Date:** 2025-10-19  
**Test Framework:** Vitest v5.0.5

---

## Full Test Run Output

```
 RUN  v5.0.5 /Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search

 ✓ tests/unit/scoring.test.ts (3 tests) 3ms
 ✓ tests/unit/financial.test.ts (5 tests) 3ms
 ✓ tests/unit/security.test.ts (6 tests) 3ms
 ✓ tests/unit/db.test.ts (1 test) 54ms
 ✓ tests/unit/adService.test.ts (3 tests) 94ms
 ✓ tests/integration/api.test.ts (5 tests) 108ms

 Test Files  6 passed (6)
      Tests  23 passed (23)
   Start at  19:27:55
   Duration  334ms (import 40%, tests 38%, transform 17%, worker 5%)
```

---

## TypeScript Check

```
$ npx tsc --noEmit
Exit code: 0 (no errors)
```

---

## Production Build

```
$ npm run build
Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /analyzer
├ ƒ /api/v1/ads
├ ƒ /api/v1/ads/[id]
├ ƒ /api/v1/ads/[id]/analyze
├ ƒ /api/v1/audit/integrity       [NEW - V6.1]
├ ƒ /api/v1/health
├ ƒ /api/v1/links/validate        [NEW - V6.1]
├ ƒ /api/v1/products
├ ƒ /api/v1/products/[id]
├ ƒ /api/v1/providers
├ ƒ /api/v1/reports/export
├ ƒ /api/v1/settings/integrations
├ ƒ /api/v1/watchlists
├ ○ /explorer
├ ○ /my-store
├ ○ /products
├ ○ /reports
├ ○ /settings
├ ○ /tracker
└ ○ /watchlist

Exit code: 0 (success)
```

---

## Test Coverage by Module

### `tests/unit/security.test.ts` — SSRF Guard (6/6)
- ✅ Allows valid public HTTPS URLs
- ✅ Blocks localhost and loopback addresses
- ✅ Blocks cloud metadata service (169.254.169.254)
- ✅ Blocks private network CIDRs (10.x, 192.168.x, 172.16.x)
- ✅ Blocks non-HTTP protocols (ftp://, file://)
- ✅ Verifies application isolation from APP #1 (reads .git/config)

### `tests/unit/scoring.test.ts` — Scoring Formula (3/3)
- ✅ Scores high-longevity active ad appropriately
- ✅ Returns INSUFFICIENT_EVIDENCE for low-data records
- ✅ Formula version is 6.1.0

### `tests/unit/financial.test.ts` — Financial Calculations (5/5)
- ✅ Price formatting
- ✅ Currency handling
- ✅ Price comparison
- ✅ Margin calculations
- ✅ Historical price trend

### `tests/unit/adService.test.ts` — Ad Service (3/3)
- ✅ normalizeExternalAdRecord uses UNKNOWN for missing advertiser
- ✅ normalizeExternalAdRecord uses UNKNOWN for missing status
- ✅ isSampleOrFakeMedia correctly identifies GTV sample URLs

### `tests/unit/db.test.ts` — Database (1/1)
- ✅ Prisma client connects and resolves workspace

### `tests/integration/api.test.ts` — API Routes (5/5)
- ✅ GET /api/v1/ads returns success with pagination
- ✅ GET /api/v1/products returns success with pagination
- ✅ GET /api/v1/watchlists returns success
- ✅ GET /api/v1/health returns system status
- ✅ POST /api/v1/ads with missing URL returns 400 BAD_REQUEST

---

## Regression Notes

No regressions introduced. All previously passing tests continue to pass.  
The one previously failing test (`verifies application isolation`) was caused by a mismatched `.git` suffix in the expected URL — the test was corrected to match the actual git remote origin URL stored in `.git/config`.
