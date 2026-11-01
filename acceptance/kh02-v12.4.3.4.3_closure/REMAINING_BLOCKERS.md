# KH-02 V12.4.3.4.3 — Remaining Blockers & Next Actions

## 1. Local Environment BigQuery Sandbox Credentials
- **Status:** `BLOCKED_CONFIGURATION`
- **Details:** In local development without Google Cloud service account keys, the Google Trends BigQuery sandbox provider fails closed with `BLOCKED_FREE_SANDBOX_NOT_VERIFIED`.
- **Zero Spend Guarantee:** Verified `ZERO_SPEND_ENFORCED=true`. 0 billable bytes processed, $0.00 spent.
- **Resolution:** When deploying to production with verified free-tier sandbox credentials, set `BIGQUERY_PROJECT_ID` and `BIGQUERY_FREE_SANDBOX_VERIFIED=true`.

## 2. Google Trends Explore CSV Import for Niche Products (G15)
- **Status:** `INSUFFICIENT_EVIDENCE`
- **Details:** Public Google Trends datasets on BigQuery cover top/rising terms. For long-tail niche e-commerce products, official Google Trends Explore CSV import is supported with SHA-256 cryptographic verification at `data/google_trends_imports/<sha256>.csv`.
- **Resolution:** Import official Explore CSV files for target niche products to satisfy G15.

## 3. Shortlist 2/3 Live Verified Candidate Grounding (G16)
- **Status:** `INSUFFICIENT_EVIDENCE` (2/3 Verified)
- **Details:** UAHPET and KittySpout are 100% VERIFIED with live ads and JSON-LD product schemas. UprootClean links to a CheckoutChamp landing funnel which lacks structured schema, correctly classified as PROBABLE under strict identity rules.
- **Resolution:** Add third candidate with full merchant JSON-LD product markup to achieve 3/3.
