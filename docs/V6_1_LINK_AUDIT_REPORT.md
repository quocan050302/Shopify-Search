# V6.1 Link Audit Report
**Shopify Winning Ads Intelligence (SWAI)**  
**Audit Date:** 2025-10-19  
**Auditor:** SWAI Data Reliability Engine V6.1

---

## Summary

This report covers the 6 seed records present in the database at audit time.  
All records were imported via the seed script using demonstration data.

| Category | Count |
|----------|-------|
| Total ads audited | 6 |
| Records with sample video URLs | 6 |
| Records with stock image thumbnails | 6 |
| Records with invalid embed URLs | 6 |
| Records with unverified ACTIVE status | 0 |
| Original source URLs present | 6 |

---

## Per-Ad Link Status

### 1. Bleame (META)
| Link | URL | Status |
|------|-----|--------|
| Original Ad Source | `https://www.facebook.com/ads/library/?id=102938475619283` | UNVERIFIED — ad IDs in seed are fictional |
| Landing Page | `https://bleame.com/products/crystal-hair-eraser` | UNVERIFIED — not HTTP-tested |
| Video URL | Google GTV sample (`commondatastorage.googleapis.com/…ForBiggerBlazes.mp4`) | ❌ FAKE — sample demo video |
| Embed URL | `facebook.com/ads/archive/render_ad/?id=…` | ❌ INVALID — requires Meta authentication |
| Thumbnail | Unsplash (`images.unsplash.com/photo-1522337360788…`) | ❌ STOCK IMAGE |

### 2. The Ridge (TIKTOK)
| Link | URL | Status |
|------|-----|--------|
| Original Ad Source | `https://ads.tiktok.com/business/creativecenter/…?id=724918291048291` | UNVERIFIED — ad ID in seed is fictional |
| Landing Page | `https://ridge.com/products/gunmetal-wallet` | UNVERIFIED — not HTTP-tested |
| Video URL | Google GTV sample (`…ForBiggerEscapes.mp4`) | ❌ FAKE |
| Embed URL | TikTok Creative Center embed path | ❌ INVALID — not a public embed |
| Thumbnail | Unsplash | ❌ STOCK IMAGE |

### 3. BlendJet (META)
| Link | URL | Status |
|------|-----|--------|
| Original Ad Source | `https://www.facebook.com/ads/library/?id=948271038472918` | UNVERIFIED |
| Landing Page | `https://blendjet.com/products/blendjet-2` | UNVERIFIED |
| Video URL | Google GTV sample | ❌ FAKE |
| Embed URL | Meta render_ad | ❌ INVALID |
| Thumbnail | Unsplash | ❌ STOCK IMAGE |

### 4. ChomChom Roller (TIKTOK)
| Link | URL | Status |
|------|-----|--------|
| Original Ad Source | `https://ads.tiktok.com/…?id=839201948192039` | UNVERIFIED |
| Landing Page | `https://chomchomroller.com/products/chomchom-roller` | UNVERIFIED |
| Video URL | Google GTV sample (`…ForBiggerJoyBlazes.mp4`) | ❌ FAKE |
| Embed URL | TikTok Creative Center embed | ❌ INVALID |
| Thumbnail | Unsplash | ❌ STOCK IMAGE |

### 5. Lumineux Health (META)
| Link | URL | Status |
|------|-----|--------|
| Original Ad Source | `https://www.facebook.com/ads/library/?id=384910294819203` | UNVERIFIED |
| Landing Page | `https://lumineuxhealth.com/products/whitening-strips` | UNVERIFIED |
| Video URL | Google GTV sample (`…ForBiggerMeltdowns.mp4`) | ❌ FAKE |
| Embed URL | Meta render_ad | ❌ INVALID |
| Thumbnail | Unsplash | ❌ STOCK IMAGE |

### 6. Gripzilla (TIKTOK)
| Link | URL | Status |
|------|-----|--------|
| Original Ad Source | `https://ads.tiktok.com/…?id=591029481920391` | UNVERIFIED |
| Landing Page | `https://gripzilla.co/products/gripzilla-ultimatum` | UNVERIFIED |
| Video URL | Google GTV sample (`Sintel.mp4`) | ❌ FAKE |
| Embed URL | TikTok Creative Center embed | ❌ INVALID |
| Thumbnail | Unsplash | ❌ STOCK IMAGE |

---

## Root Cause

All seed records used:
1. **Fictional ad IDs** — the integer IDs after `?id=` in Meta and TikTok URLs are not real published ad IDs
2. **Google GTV demonstration videos** — these are public sample videos, not real advertisements
3. **Unsplash stock images** — these are generic photos unrelated to the actual advertised products
4. **Non-public embed endpoints** — Meta's `render_ad` and TikTok's Creative Center embed path both require authentication

---

## Remediation Status (V6.1)

| Issue | Remediation |
|-------|-------------|
| Sample video URLs stored in DB | Stripped at upsert (`null`), availability=`FALLBACK_ONLY` |
| Fake embed URLs | Stripped at upsert (`null`) |
| Stock image thumbnails | Stripped at upsert (`null`) |
| Player UI | Now shows warning + external link instead of broken video |
| UI labels | Stock images show "Not actual ad creative" badge |
| Product URLs | Now labeled "Not verified — may return 404" |
| Storefront button | Added separate store homepage fallback |

---

## Verification Method

Run the real-time audit at: `GET /api/v1/audit/integrity`

Batch link validation available at: `POST /api/v1/links/validate` (up to 10 URLs)

To add real, working ad records: use `POST /api/v1/ads` with the actual Meta Ad Library URL or TikTok Creative Center URL.
