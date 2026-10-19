# V6.1 Data Integrity Report
**Shopify Winning Ads Intelligence (SWAI)**  
**Audit Date:** 2025-10-19

---

## Database: dev.db (SQLite via Prisma 7 + LibSQL adapter)

### Ad Records (6 total)

All 6 are seed records. They represent real commercial brands (Bleame, The Ridge, etc.) with **observed business context** but **unverified source links and demonstration media**.

| Integrity Issue | Count | Impact | Status |
|----------------|-------|--------|--------|
| Sample video URLs | 6/6 | HIGH — player showed fake video | ✅ Stripped at upsert |
| Stock image thumbnails | 6/6 | MEDIUM — misleading visual | ✅ Stripped at upsert |
| Invalid embed URLs | 6/6 | HIGH — player broken in previous version | ✅ Stripped at upsert |
| Fictional Meta ad IDs | 3/6 | MEDIUM — source links point to non-existent ads | ⚠ URLs preserved but labeled UNVERIFIED |
| Fictional TikTok ad IDs | 3/6 | MEDIUM — same as above | ⚠ URLs preserved but labeled UNVERIFIED |
| Hardcoded hookQualityScore=88 | 6/6 | HIGH — false AI analysis claim | ✅ Now null with COPY_ONLY status |
| Hardcoded pacingScore=82 | 6/6 | HIGH — same | ✅ Now null |
| Status: ACTIVE without verification | 6/6 | MEDIUM | ⚠ Seed preserves ACTIVE (research context); new imports default to UNKNOWN |

### Scoring Integrity

| Issue | Before V6.1 | After V6.1 |
|-------|-------------|------------|
| AI quality default | 65 (hardcoded) | No score unless real AI analysis |
| Performance component | Points awarded for ACTIVE status | 0 unless genuine metrics exist |
| Missing data handling | Conservative defaults silently applied | Tracked in `missingSignals[]` and shown in UI |
| Formula version | 2.0.0 | 6.1.0 |
| Weight redistribution | No | Yes — missing components redistributed proportionally |

### Operating Mode Integrity

| Check | Status |
|-------|--------|
| RESEARCH_ONLY preserved | ✅ |
| Shopify NOT_CONNECTED | ✅ |
| Meta Ads Manager NOT_CONNECTED | ✅ |
| TikTok Ads Manager NOT_CONNECTED | ✅ |
| No real user data | ✅ — seed data only |
| No automatic ad search performed | ✅ |
| SSRF protection active | ✅ — expanded blocklist |
| App isolation verified | ✅ — reads .git/config |

---

## New Import Policy (V6.1+)

All new imports via `POST /api/v1/ads` follow these defaults:

| Field | V5.x Default | V6.1 Default |
|-------|-------------|--------------|
| `status` | `ACTIVE` | `UNKNOWN` |
| `targetMarket` | `US` | `UNKNOWN` |
| `advertiserName` | `"Independent Merchant"` | `UNKNOWN` |
| `dataConfidence` | `OBSERVED` | `UNVERIFIED` |
| `media.embedUrl` | Meta render_ad / TikTok embed path | `null` (stripped) |
| `media.videoUrl` | Sample video preserved | Sample videos stripped (null) |
| `media.thumbnailUrl` | Stock image preserved | Stock images stripped (null) |
| `media.availability` | `READY` | `FALLBACK_ONLY` unless real video present |
| `media.durationSeconds` | `30` | `null` (unknown until confirmed) |
| `score.aiQualityScore` | `65` | Not stored until real AI runs |

---

## Recommendations for Production Use

1. **Replace seed data** with real ad URLs observed in Meta Ad Library and TikTok Creative Center
2. **Run `/api/v1/audit/integrity`** after every bulk import to catch data quality regressions
3. **Manual link verification**: Use `/api/v1/links/validate` to check product URLs before presenting them to users
4. **AI analysis**: Hook up a real AI provider (e.g., Google Gemini Vision) to fill `hookQualityScore` and `pacingScore` from actual video frame analysis
5. **Landing page check**: Run batch validation on all landing page URLs monthly to detect 404s before users click them
