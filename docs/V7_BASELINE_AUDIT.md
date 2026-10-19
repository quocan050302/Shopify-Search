# V7 Baseline Audit
**Shopify Winning Ads Intelligence (SWAI)**
**Date:** 2025-10-19
**Baseline Commit:** 9e1fc3be4e79506126102bea520edc37962ea91a

---

## 1. Stack & Versions

| Component | Version |
|-----------|---------|
| Next.js | 16.4.2 |
| React | 19.3.0 |
| Prisma | 7.10.1 |
| Database | SQLite (dev.db, via libSQL adapter) |
| TypeScript | 5.x |
| Vitest | 5.0.5 |
| Node.js | 22.x |

---

## 2. Current Modules Inventory

### Services
| Service | File | Status |
|---------|------|--------|
| Ad search/upsert | `adService.ts` | ✅ Working |
| Scoring engine | `scoringEngine.ts` | ✅ Working (formula v6.1.0) |
| Video source resolver | `videoSourceResolver.ts` | ✅ Working (V6.2) |
| Link validation | `linkValidationService.ts` | ✅ Working |
| Provider registry | `registry.ts` | ✅ Working |
| URL resolver | `urlResolver.ts` | ✅ Working |
| Product service | `productService.ts` | ⚠️ Partial — no demand analysis |
| Platform detector | `platformDetector.ts` | ⚠️ Basic shopify detection |
| Tracking service | `trackingService.ts` | ⚠️ Basic watchlist CRUD |
| Creative analyzer | `creativeAnalyzer.ts` | ⚠️ Copy-only (no video AI) |

### API Routes
| Route | Method | Status |
|-------|--------|--------|
| `/api/v1/ads` | GET, POST | ✅ |
| `/api/v1/ads/[id]` | GET | ✅ |
| `/api/v1/ads/[id]/analyze` | POST | ✅ |
| `/api/v1/products` | GET | ✅ |
| `/api/v1/products/[id]` | GET | ✅ |
| `/api/v1/watchlists` | GET, POST, DELETE | ✅ |
| `/api/v1/links/validate` | GET, POST | ✅ |
| `/api/v1/audit/integrity` | GET | ✅ |
| `/api/v1/health` | GET | ✅ |
| `/api/v1/providers` | GET | ✅ |
| `/api/v1/reports/export` | GET | ✅ |
| `/api/v1/settings/integrations` | GET, PATCH | ✅ |

---

## 3. Database State (Post-V6.2)

| Table | Records | Notes |
|-------|---------|-------|
| `competitor_ads` | 7 | 6 SYNTHETIC_QUARANTINED, 1 UNVERIFIED |
| `ad_media_assets` | 7 | All fake media stripped |
| `ad_observations` | 0 | Empty — no real observations yet |
| `ad_metric_observations` | 0 | Empty |
| `research_scores` | 7 | 6 formula=INVALIDATED, 1 formula=6.1.0 |
| `creative_analyses` | 0 | All hardcoded 88/82 removed |
| `research_products` | 0 | Empty |
| `advertisers` | 7 | All from seed |
| `workspaces` | 1 | Default workspace |
| `watchlists` | 1 | "High Priority Q4 US Ecommerce Winners" |
| `watchlist_items` | 3 | Point to synthetic ads |

---

## 4. Known Issues (Pre-V7.0)

### CRITICAL
- **`CompetitorAd.daysRunning`**: Stored as computed integer — no source attribution, no distinction between provider-reported vs. observed calendar age
- **`AdObservation.isActive`**: Boolean cannot represent UNKNOWN, CHECK_FAILED, ACCESS_RESTRICTED states
- **`CompetitorAd.status`**: Default `ACTIVE` creates misleading evidence for new imports
- **`CompetitorAd.targetMarket`**: Default `US` silently misrepresents unknown markets

### HIGH
- No longevity classification engine (NEW_TESTING, EARLY_POTENTIAL, etc.)
- No product demand model (no time-series data storage)
- No evergreen scoring (separate from V6.1 Winning Potential Score)
- No observation history (no lifecycle events)
- No creative variant tracking
- `AdObservation` evidenceType doesn't support separate lifecycle events

### MEDIUM
- `trackingService.generateDailyResearchReport()` not implemented
- `trackingService.exportResearchReport()` not CSV-injection-safe
- Provider connection verification (`validateConnection()`) not implemented
- Evergreen research mode not exposed in Explorer UI
- Product demand charts not implemented

### LOW
- `CompetitorAd.firstSeenAt`/`lastSeenAt` conflated with provider-reported dates
- No `sourceReportedStartAt`/`sourceReportedEndAt` fields
- `Advertiser.country` defaults to US without evidence

---

## 5. Security Concerns

| Concern | Severity | Status |
|---------|----------|--------|
| `fetch({ redirect: "follow" })` in `checkExternalLink()` without SSRF-validating final destination | HIGH | ✅ Fixed in V6.1 — redirect destination is validated |
| CSV export injection via `exportResearchReport()` | MEDIUM | ⚠️ Not yet fixed |
| No write-endpoint authentication (single-user research tool) | LOW | Acceptable for local-only use |
| SSRF blocklist comprehensive | ✅ | Comprehensive since V6.1 |

---

## 6. Proposed V7.0 Migration Strategy

### Phase 1: Additive Schema Extension (Safe)
Add new optional fields and models without removing existing ones.
Never drop columns. Use `prisma db push` which is safe for SQLite.

### Phase 2: Longevity Engine
New `src/services/evergreen/` directory with:
- `longevityEngine.ts` — `calculateAdLongevity()`, `classifyAdLongevity()`
- `evergreenScoring.ts` — `calculateAdLongevityScore()`, `calculateEvergreenProductScore()`
- `evergreenEvidenceConfidence.ts` — `calculateEvergreenEvidenceConfidence()`

### Phase 3: New API Routes
`/api/v1/evergreen/` — rankings, ads, products, scores, timeline

### Phase 4: UI Update
- Explorer: Evergreen/Emerging/Trending modes
- Ad Card: longevity badges, evidence source labels
- Ad Detail Drawer: lifecycle timeline, observation gaps

### Phase 5: Testing
New test suite: `tests/unit/evergreen.test.ts`

---

## 7. Baseline Test Results

```
Test Files  6 passed (6)
     Tests  24 passed (24)
TypeScript  0 errors
Build       ✅ clean
```

---

## 8. External Data Limitations

| Provider | US Ad Data | Playback | Status |
|----------|-----------|----------|--------|
| Meta Ad Library | Manual browse only | ❌ No embed | AUTH_REQUIRED |
| TikTok Creative Center | Manual browse only | ❌ No Top Ads embed | AUTH_REQUIRED |
| TikTok posts | Import post URL | ✅ oEmbed | AVAILABLE |
| Google Trends | Manual CSV export | N/A | MANUAL_ONLY |
| Minea / AdSpy | Paid license required | License-dependent | NOT_EVALUATED |

---

## 9. Recovery Plan

Database backup: `dev.db.backup_v6_2_pre_migration`
All V7 schema changes: additive only (no DROP, no column rename)
All V7 data changes: new rows in new tables only
Rollback: restore from backup file + `git reset --hard HEAD~N`
