# Muse AI Integration — External Meta Ad Library Discovery Agent

SWAI's primary Facebook advertising discovery provider is **Muse AI**, an external research agent with live browser capabilities. This document defines the architectural integration contract between SWAI and Muse.

---

## 1. Executive Summary & Philosophy

- **No Official "Muse API"**: Muse is an external conversational agent equipped with authorized browser actions, not a traditional REST service.
- **Why Not the Meta Graph API (`ads_archive`)**: Meta's official Ad Library API does **not** return US commercial/ecommerce ads to third parties. It only returns social/political ads worldwide and commercial ads delivered to EU/UK. Therefore, US commercial competitor intelligence relies on public Meta Ad Library research (`facebook.com/ads/library`).
- **Asynchronous Queue Model**: Creating a research request never creates ads synchronously. A request enters state `PENDING`, is claimed by the external Muse agent, researched with source verification, and completed only upon verified result submission.
- **Zero-Cost External API Spend ($0)**: All discovery uses free browser-verified observation rather than metered third-party scraping APIs.

---

## 2. Supported Execution Modes

| Mode | Identifier | Description | Connectivity Requirement |
| :--- | :--- | :--- | :--- |
| **Mode A** | `MUSE_CONNECTED_AGENT` | Direct automated delivery: Muse connector claims requests and posts JSON results. | Reachable HTTPS gateway |
| **Mode B** | `MUSE_ASSISTED_ON_DEMAND` | User-assisted research: Requests queued in SWAI, researched on demand. | Local or cloud SWAI |
| **Mode C** | `MANUAL_IMPORT` / Artifact Bridge | Structured artifact bridge: Muse produces verified JSON in conversation; user imports via UI. | Works offline / localhost |
| **Mode D** | `MUSE_SCHEDULED_VERIFIED` | Verified scheduled tasks (activated only when cron/daemon transport is proven). | Active daemon connector |

---

## 3. Asynchronous Flow Architecture

```
User / UI                       SWAI Server                     Muse AI External Agent
---------                       -----------                     ----------------------
1. Select US + Keywords    ─►   POST /discovery/muse/requests
                                Status: PENDING
                                                               ◄─ 2. GET .../muse/requests?status=PENDING
                                                               ─► 3. PATCH .../requests/:id (CLAIM)
                                                                     Status: CLAIMED (15 min lease)
                                                                  4. Researches facebook.com/ads/library
                                                                     Verifies numeric Library IDs,
                                                                     active dates, advertiser pages.
                                5. normalizeFacebookAd()       ◄─ 6. POST .../requests/:id/results
                                   Dedupe via stable hash
                                   Commit CompetitorAd, Media,
                                   Observations, Ledgers ($0)
7. Display in Explorer     ◄─   Status: COMPLETED
```

---

## 4. Security & Scoped Authentication

All Muse queue and result submission endpoints are protected:
- **Environment Variable**: `MUSE_INGESTION_TOKEN` (or fallback `ADMIN_API_KEY`)
- **Headers Supported**:
  - `Authorization: Bearer <MUSE_INGESTION_TOKEN>`
  - `x-muse-token: <MUSE_INGESTION_TOKEN>`
- **Constant-Time Verification**: Uses `crypto.timingSafeEqual` to prevent timing attacks.
- **Development Safety**: Unlike generic admin routes, Muse agent endpoints enforce valid credentials in all environments.
