# SWAI V10 — Meta Ads Data Provenance & Integrity Policy

To maintain trustworthy competitive research, SWAI enforces strict boundaries between verified source facts, landing-page metadata, and estimated attributes.

---

## 1. Provenance Classification Hierarchy

| Level | Source | Examples | Trust Status |
| :--- | :--- | :--- | :--- |
| **Level 1** | **Direct Source Observation** | Meta Library ID, Advertiser Page ID, Ad Copy, Source Start Date, Active Badge | `OBSERVED` / `VERIFIED` |
| **Level 2** | **Advertiser Storefront** | Destination domain, product price, Shopify detection, product thumbnail | `OBSERVED_STOREFRONT` |
| **Level 3** | **Derivative Intelligence** | Evergreen longevity category, observation span, composite identity hash | `CALCULATED` |
| **Level 4** | **AI Analysis** | Hook identification, visual breakdown, persuasive angle (Gemini) | `AI_INTERPRETATION` |
| **Level 0** | **Unavailable / Prohibited** | Competitor ROAS, revenue, ad spend, exact conversion rate, views | `UNAVAILABLE` |

---

## 2. The US Commercial Ad Library Reality

- The public Meta Ad Library exposes ads run across Facebook, Instagram, Messenger, and Audience Network.
- For **commercial / ecommerce ads in the United States**, Meta publishes **no impression ranges, spend numbers, or ROAS**.
- Spend and impression data is only made public by Meta for:
  1. Social, political, and election-related advertising worldwide.
  2. Commercial advertising delivered to member states of the European Union (EU) and United Kingdom (UK) under regulatory transparency mandates.
- **SWAI Rule**: Any provider or ingestion pipeline claiming to provide competitor ROAS, spend, or sales revenue for US commercial Meta ads is hallucinatory or untruthful. SWAI strictly marks these fields as `UNAVAILABLE` to maintain research credibility.

---

## 3. Observation Span vs Continuous Ad Activity

- An advertisement first observed 90 days ago was running 90 days ago.
- That observation **does not prove** the ad ran continuously without pauses for 90 days.
- SWAI explicitly separates:
  - `sourceReportedStartAt`: The launch date reported by Meta Ad Library.
  - `calendarAgeDays`: Calendar days elapsed since launch date.
  - `observationCount`: Number of distinct observation checkpoints recorded by SWAI.
  - `longevityCategory`: Calculated based on evidence density rather than speculative continuous spend.
