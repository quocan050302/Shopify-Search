# SWAI V11.0 — Data Migration Audit Report
**Date:** 2026-10-24  
**Feature Branch:** `feature/v11-meta-collector-remove-muse`  
**Database URL:** `file:./dev.db`  
**Physical File:** `D:/Project_github/Running-Ads/dev.db` (585,728 bytes)  
**Backup Path:** `D:/Project_github/Running-Ads/backups/v11_pre_migration_2026-10-24T02-21-45-623Z.db` (581,632 bytes)  
**Backup Integrity Check:** `ok` (PRAGMA integrity_check verified)

---

## 1. Pre-Migration Model Counts

| Model | Record Count | Notes / Provenance |
| :--- | :--- | :--- |
| `Workspace` | 1 | Default research workspace |
| `CompetitorAd` | 9 | 7 legacy reference ads, 2 TikTok discovered ads |
| `AdMediaAsset` | 9 | 1-to-1 with CompetitorAd records |
| `AdObservation` | 65 | Historical status checks |
| `AdSourceIdentity` | 0 | Will be populated by new canonical deduplication |
| `DiscoveryRun` | 32 | All historical runs are `tiktok-topads` provider |
| `SyncJob` | 18 | Background job checkpoints |
| `ProviderRequestLedger` | 0 | Request audit records |
| `DiscoverySchedule` | 11 | Scheduled research jobs |

---

## 2. Granular Ad Inventory

| Ad ID | External ID | Platform | Brand | Status | Quarantine | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `cmvf2gqrj0004p4orlbpw23wr` | `meta_bleame_crystal_hair_eraser_01` | META | Bleame | INACTIVE | `false` | Legacy reference ad |
| `cmvf2gqvh000ep4orxdzcm5ns` | `tiktok_ridge_wallet_titanium_02` | TIKTOK | The Ridge | INACTIVE | `false` | Legacy reference ad |
| `cmvf2gqyr000op4orvc2hbfyx` | `meta_blendjet_portable_blender_03` | META | BlendJet | INACTIVE | `false` | Legacy reference ad |
| `cmvf2gr26000yp4orfmngwmgk` | `tiktok_chomchom_pet_roller_04` | TIKTOK | ChomChom Roller | INACTIVE | `false` | Legacy reference ad |
| `cmvf2gr5p0018p4ork66zka1l` | `meta_lumineux_teeth_whitening_05` | META | Lumineux Health | INACTIVE | `false` | Legacy reference ad |
| `cmvf2gr91001ip4ordts67cer` | `tiktok_gripzilla_strengthener_06` | TIKTOK | Gripzilla | INACTIVE | `false` | Legacy reference ad |
| `cmvf2j9900001psor61xg8hn1` | `999888777` | META | Test Brand Labs | UNKNOWN | `false` | Test reference ad |
| `cmvg4bvm6000140ordbbvvbn6` | `7234567890111111111` | TIKTOK | UNKNOWN | UNKNOWN | `false` | TikTok discovered ad |
| `cmvg4bvo0000540or1o4xx69y` | `7234567890222222222` | TIKTOK | UNKNOWN | UNKNOWN | `false` | TikTok discovered ad |

---

## 3. Discovery Runs Inventory

- **Total Runs:** 32
- **By Provider:**
  - `tiktok-topads`: 32
  - `muse-ad-library`: 0
- **Summary:** There are no active or pending Muse discovery runs in the active database. All existing discovery runs belong to TikTok discovery.

---

## 4. Migration Safety & Data Preservation Rules

1. **Zero Data Loss:** Existing 9 ads, their media assets, and 65 observations will remain intact.
2. **Provenance Preservation:** Existing reference ads retain their platform and historical IDs.
3. **No Reseeding / Truncation:** Database will undergo additive schema evolution only (`DiscoveryRunAd` relation and indices).
4. **Quarantine Isolation:** Synthetic records remain quarantined and separated from production research explorer.
