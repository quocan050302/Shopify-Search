# Google Cloud Configuration Requirements for KH-02 Free Demand

## 1. Status: BLOCKED_CONFIGURATION
In the local development environment, no Google Cloud Application Default Credentials (ADC) or service account keyfile was detected.

## 2. Minimal-Privilege Setup Guide (Zero-Spend Free Tier)
To enable live BigQuery verification without incurring any cloud costs:

1. **Install Google Cloud SDK** (if not already installed):
   ```bash
   winget install Google.CloudSDK
   ```

2. **Login with Application Default Credentials**:
   ```bash
   gcloud auth application-default login
   ```
   This writes credentials to `%APPDATA%\gcloud\application_default_credentials.json`.

3. **Set Project ID (Free Sandbox)**:
   Ensure your project has no billing account attached (or billing disabled). BigQuery provides a permanent free sandbox offering **1 TB of query processing per month** at zero cost.
   ```bash
   gcloud config set project YOUR_PROJECT_ID
   ```

4. **Verify in Environment**:
   Add to `.env.local`:
   ```env
   BIGQUERY_PROJECT_ID="YOUR_PROJECT_ID"
   ZERO_SPEND_ENFORCED="true"
   DEMAND_PROVIDER_MODE="GOOGLE_FREE_ONLY"
   ```

## 3. Structural Free Source Limitation
Even with authorized ADC credentials, the public dataset `bigquery-public-data.google_trends.top_terms` only indexes top macro search queries. Arbitrary product SKUs require manual official Google Trends CSV imports or authorized Google Trends Explore integration.
