# Google Free Demand Source Feasibility Analysis

## Executive Summary
- **BigQuery Public Data**: Live calls blocked due to missing local ADC credentials (`BLOCKED_CONFIGURATION`). Structurally, `bigquery-public-data.google_trends.top_terms` indexes only top macro queries (e.g. weather, sports, major events), leaving long-tail product queries unindexed (`UNSUPPORTED_FREE_SOURCE`).
- **Google Trends Explore**: Google Trends Explore web UI provides exact longitudinal weekly interest curves (0-100), but Google does not provide an authorized, zero-cost, unauthenticated REST API for automated backend querying.
- **Official CSV Import**: Supported as an authoritative demand source (`GOOGLE_TRENDS_CSV`) with SHA-256 cryptographic lineage verification.
- **SerpApi / Third-Party Scraping**: Strictly prohibited under the zero-spend and anti-scraping policy.

## Feasibility Classification
Terminal classification: **C (BLOCKED_CONFIGURATION)** for credential acquisition, combined with **E (UNSUPPORTED_FREE_SOURCE)** for arbitrary product SKU demand from BigQuery public datasets.
