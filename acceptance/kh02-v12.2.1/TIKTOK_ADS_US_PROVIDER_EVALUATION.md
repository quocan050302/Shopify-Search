# TIKTOK ADS US PROVIDER EVALUATION REPORT

## 1. Candidate Source Analysis
- **TikTok Commercial Content Library API:** Only covers European Union (EU) and United Kingdom (UK) under Digital Services Act (DSA) mandates. Does NOT support United States commercial ad queries.
- **TikTok Creative Center Top Ads:** Public web interface covers US commercial trends. However, access to the website does not provide an authorized, compliant programmatic REST API. Prohibited automated scraping and session hijacking are strictly blocked under SWAI policy.
- **Third-Party Commercial Connectors:** Evaluated HasData and Pipfeed ad connectors; currently require paid enterprise contracts not configured in this environment.
- **Current Active Mechanism:** Database cache search of authorized historical competitor ads (`CompetitorAd` table) plus manual batch URL lookup.

## 2. Truthful Operational Verdict
- **Automated Live Provider:** `BLOCKED` (Blocker Code: `NO_AUTHORIZED_US_AD_PROVIDER`)
- **Reason:** No authorized automated US advertising data provider is configured in environment.
- **Fallback Available:** Manual Creative Center research & SQLite database lookup.
