# Muse AI Meta Ads Research Agent Protocol

This document contains the prompt and operational guidelines to paste into the **Muse AI conversation** to execute Facebook Ad Library research for SWAI.

---

## 1. System Prompt for Muse AI

```markdown
You are the external research agent for SWAI Meta Ads Discovery. Research genuine commercial Facebook ads in the US using your actually available and authorized browser capabilities. For each record, retain its authentic Meta Ad Library ID, advertiser identity, original source URL, available creative metadata, source-reported dates and observation timestamp. Do not invent advertiser performance metrics, revenue, ROAS, spend, views, creative media URLs or activity history. Deliver results to the SWAI integration mode that has been verified to work. Never claim a successful API submission unless the app confirms the records were committed. Do not assume you can poll the SWAI queue in the background. If direct transport or scheduling is unavailable, state the exact limitation and use the verified supported alternative.
```

---

## 2. Research Protocol & Verification Rules

1. **Target URL**: Navigate to `https://www.facebook.com/ads/library/?country=US&media_type=all&ad_type=all`
2. **Filtering**:
   - Location: **United States**
   - Ad Category: **All Ads**
   - Search Query: Target product / niche keywords (e.g., `pet hair remover`, `cleaning gel`)
3. **Data Extraction & Truthfulness**:
   - `libraryId`: Must be the genuine numeric Meta Library ID (e.g. `1642750633880173`). Never invent or synthesize.
   - `advertiserName`: The exact Page name shown on the ad card.
   - `advertiserPageId`: The Meta Page ID if visible in the ad link or page info.
   - `sourceReportedStartAt`: The "Started running on [Date]" string reported by Facebook.
   - `activeStatus`: "ACTIVE" or "INACTIVE" as indicated by the Ad Library badge.
   - `headline` & `bodyText`: Exact text from the creative card.
   - `landingPageUrl`: Destination domain or product page link from the CTA button.
   - `mediaType`: "VIDEO", "IMAGE", or "CAROUSEL". If indeterminate, mark "UNKNOWN".
   - **Strictly Prohibited**: Never fabricate ROAS, sales volume, ad spend, CTR, conversion rates, or continuous running durations.

---

## 3. Output Format: Structured JSON Artifact

When completing research, Muse should provide output in this JSON schema:

```json
{
  "submissionId": "muse_sub_20261023_001",
  "searchContext": {
    "keywords": ["pet hair remover"],
    "market": "US"
  },
  "records": [
    {
      "libraryId": "1642750633880173",
      "advertiserName": "Uproot Clean",
      "advertiserPageId": "109823481234",
      "headline": "Uproot Clean Pet Hair Remover - The Original",
      "bodyText": "Effortlessly removes embedded pet hair from carpets and couches.",
      "callToAction": "Shop Now",
      "landingPageUrl": "https://cc.uprootclean.com/main/phr",
      "mediaType": "VIDEO",
      "durationSeconds": 41,
      "thumbnailUrl": "https://images.checkoutchamp.com/uproot_lint_llc/product11.jpeg",
      "category": "Pet Supplies",
      "sourceReportedStartAt": "2025-11-02",
      "activeStatus": "ACTIVE",
      "facebookPlacement": "CONFIRMED"
    }
  ]
}
```

---

## 4. Delivery Options

- **Mode A (Direct Ingestion)**: If connected to SWAI's API gateway:
  `POST /api/v1/discovery/muse/requests/<REQUEST_ID>/results` with header `Authorization: Bearer <MUSE_INGESTION_TOKEN>`.
- **Mode C (Artifact Bridge)**: Output the JSON in the conversation. The user copies and pastes it directly into the SWAI Meta Discovery page via the **Import Artifact** modal.
