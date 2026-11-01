# KH-02 V12.4.3.4.1 — Remaining Blockers & Next Actions

## 1. Local Environment BigQuery Sandbox Credentials
- **Status:** `BLOCKED_CONFIGURATION`
- **Details:** In local development without Google Cloud service account keys, the Google Trends BigQuery sandbox provider fails closed with `BLOCKED_FREE_SANDBOX_NOT_VERIFIED`.
- **Zero Spend Guarantee:** Verified `ZERO_SPEND_ENFORCED=true`. 0 billable bytes processed, $0.00 spent.
- **Resolution:** When deploying to production with verified free-tier sandbox credentials, set `BIGQUERY_PROJECT_ID` and `BIGQUERY_FREE_SANDBOX_VERIFIED=true`.

## 2. Google Trends Explore CSV Import for Niche Products
- **Status:** `PRODUCTION_READY`
- **Details:** The Google Trends public dataset on BigQuery only covers top search terms. For long-tail niche e-commerce products, official Google Trends Explore CSV import is supported with SHA-256 cryptographic verification at `data/google_trends_imports/<sha256>.csv`.

## 3. TikTok Organic
- **Status:** `DISABLED_AND_HIDDEN`
- **Details:** TikTok Organic has been removed from UI navigation (Sidebar and Header) and disabled in KH-02 providers as instructed.
