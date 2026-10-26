# SWAI KH-02 — EVERGREEN WINNING PRODUCTS INTELLIGENCE MASTER SPECIFICATION
**Version:** 12.0.0  
**Module:** KH-02 — Evergreen Winning Products Intelligence  
**Target Market:** United States (US)  
**Primary Business Model:** Long-Term Branded / Niche Shopify Store  
**Formula Version:** `12.0.0`

---

## 1. System Vision & Objective
KH-02 transforms SWAI into a cross-platform, evidence-grounded Evergreen Winning Products Intelligence system. Rather than ranking transient viral trends, KH-02 identifies sustainable e-commerce opportunities characterized by:
- Persistent customer problem-solving utility.
- Durable historical demand across multiple seasons (60-365+ days).
- Multi-channel commercial validation (Meta Ads, TikTok Ads, TikTok Organic, Google Ads).
- Niche store brandability and catalog coherence.
- Unit economics viability and low fulfillment risk.

---

## 2. Multi-Source Intelligence Architecture

### 2.1 Four Independent Research Sources
1. **Meta Ads (Facebook & Instagram):**
   - Direct competitor advertising presence.
   - Distinct advertiser count, creative variants, Library IDs, observation timelines.
   - Enforces diminishing returns on high creative volume from a single advertiser.
2. **TikTok Ads US:**
   - Evaluates commercial paid ads specifically targeting the United States.
   - Strictly fails closed if automated US coverage is not verified; never mistakes the EU Commercial Content Library for US competitor advertising.
3. **TikTok Organic:**
   - Public product review videos, creator diversity, observed view counts, and engagement ratios.
   - Distinguishes observed lifetime views from multi-point view velocity; marks unconfirmed geographies as `US popularity: NOT_VERIFIED`.
4. **Google Ads Transparency:**
   - Advertiser and creative evidence resolved via verified candidate landing page domains.
   - Classifies ad relevance as `PRODUCT_SPECIFIC`, `BRAND_RELATED`, or `UNRELATED`.

### 2.2 Historical Search Demand (Google Trends)
- Analyzes longitudinal time series over 30, 90, 180, and 365 days.
- Evaluates Mean, Variance, StdDev, Coefficient of Variation (CV), and linear slope velocity.
- Strictly fails closed with `INSUFFICIENT_HISTORY` when fewer than 3 data points or fewer than 60 days of data are available.

---

## 3. Product Candidate & Identity Resolution

### 3.1 Non-Destructive Product Deduplication
- Multiple ad creatives from the same store domain and canonical product URL are consolidated into a single `DiscoveredProductCandidate`.
- Ad hooks and marketing suffixes are cleaned from product titles.

### 3.2 Cross-Store Matching & Operator Safety
- **NON-NEGOTIABLE SAFETY RULE:** Cross-store products with similar keywords are **never automatically merged** into a single SKU without human confirmation.
- Classified as `PROBABLE` hypotheses with `requiresManualReview: true`.
- Operator decisions (`CONFIRMED`, `REJECTED`, `UNCERTAIN`) are persisted with timestamps and reviewer IDs.

---

## 4. Evergreen Opportunity Scoring Framework (100 Points)

| Pillar | Focus | Max Points | Qualifying Criteria |
|---|---|:---:|---|
| **A. Demand Stability** | Multi-month search interest persistence | 25 | `EVERGREEN_STABLE` (25 pts), `SEASONAL_RECURRING` (18 pts), `EMERGING_PERSISTENT` (22 pts), `TREND_DEPENDENT` (10 pts), `DECLINING` (3-6 pts). Fails closed if $<60$ days. |
| **B. Problem-Solution Fit** | Real customer problem urgency & utility | 20 | Explicit pain point, functional utility demonstration, multi-ad observation. |
| **C. Multi-Platform Validation** | Cross-channel advertising & organic evidence | 20 | Meta Ads (+6), TikTok (+5), Google Ads (+5), Base (+4). Corroboration across independent channels. |
| **D. Brandability / Store Fit** | Long-term niche store potential & catalog expansion | 15 | Identified domain, clear niche category, upsell & accessory potential. |
| **E. Creative Depth** | Diversity of hooks, angles, and formats | 10 | Multiple creative variants, independent demonstrations, video & image depth. |
| **F. Competition Sustainability** | Competitive breadth vs saturation | 10 | Healthy competition ($2-10$ advertisers) rewards demand; single advertiser flags concentration risk; $10+$ advertisers flags saturation. |

### 4.1 Independent Evidence Confidence Score (0-100%)
- Evaluates the completeness, date freshness, and independence of collected evidence.
- Scores are categorized as `VERIFIED` ($\ge 65\%$ confidence), `PROVISIONAL` ($<65\%$), or `INSUFFICIENT_EVIDENCE`.

### 4.2 Risk Gates & Recommendations
- **`TEST_CANDIDATE`:** Score $\ge 75$, Confidence $\ge 70\%$, Status `VERIFIED`, and Demand Stability $\ge 15$ pts (`EVERGREEN_STABLE` or `SEASONAL_RECURRING`).
- **`SHORTLIST`:** Score $\ge 60$ with non-declining demand.
- **`RESEARCH_MORE`:** Default when critical history or evidence is missing.
- **`REQUIRES_MANUAL_REVIEW`:** Mandatory when compliance, trademark, or safety risks are flagged.

---

## 5. UI & Presentation Specifications

### 5.1 `/products` Leaderboard
- Top 3 Leaderboard Rows:
  - **Rank #1:** Gold Accent (`#F4C95D`).
  - **Rank #2:** Ice Blue Accent (`#66C9EB`).
  - **Rank #3:** Coral Accent (`#F48B87`).
- Secondary candidates (#4+) presented in structured ranking cards.
- Real video thumbnails with playback overlays and platform badges.
- Source status bar indicating real-time provider readiness.
- "View Catalog SKUs" toggle preserving full access to individual products.

### 5.2 Extended Product Intelligence (`/products/[id]/intelligence`)
- Preserves all 7 existing KH-01 tabs (`product`, `creative`, `offer`, `funnel`, `economics`, `fulfillment`, `decision`).
- Adds 3 dedicated KH-02 panels:
  - `evergreen`: Score breakdown, confidence meter, demand class, and "Why This Product May Be Sustainable" rationale.
  - `cross_platform`: Meta, TikTok, Google, and Trends breakdown.
  - `store_fit`: Target customer profile, catalog expansion/upsells, and fulfillment risks.
