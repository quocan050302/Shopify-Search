# KH-01 V11.4.4 — Shopify Economics & Six-Pillar Decision Integrity Specification

**Document Version**: V11.4.4  
**Plan**: KH-01  
**Target**: Six-Pillar Opportunity Assessment, Economic Gating, and Truthful Ecommerce Evidence  
**Status**: VERIFIED & IMPLEMENTED  

---

## 1. Executive Summary & Core Business Principles

In **KH-01 V11.4.4** (Part 12, Tasks 125–137), SWAI solidifies its position as an audit-grade, research-only ecommerce intelligence system. Unlike conventional ad spy tools that fabricate sales estimates or assume any active ad is highly profitable, SWAI enforces rigorous epistemic truthfulness:

1. **Six-Pillar Mathematical Model**:
   - **Product (20%)**: Problem clarity, differentiation, customer pain-point validation, identity confidence.
   - **Creative (15%)**: Authentic ad cataloging, observed video demonstrations, problem/before-after hooks, direct-response CTAs.
   - **Offer (20%)**: Observed competitor prices, bundles, shipping thresholds, tier discounts.
   - **Landing Page (15%)**: CRO checklist, trust badges, payment proofs, mobile layout, accessibility.
   - **Economics (20%)**: Net selling revenue, supplier COGS, shipping subsidies, fulfillment fees, payment processor cuts, return allowances, break-even CPA/ROAS.
   - **Fulfillment (10%)**: Packaging tier, weight/dimensions, hazardous materials, battery compliance, transit feasibility.

2. **Strict Separation of Evidence Readiness vs. Opportunity Score**:
   - **Evidence Readiness (0–100%)**: Factual data completeness. A product with many known inputs can have high readiness (e.g. 90%) even if the economics are unviable.
   - **Opportunity Score (0–100 or null)**: Analytical attractiveness based on confirmed factual evidence. If core evidence is missing, the score is strictly `null` (not an optimistic default).
   - **Partial Score Visibility**: When only a subset of pillars have sufficient factual inputs, `isPartialScore` is flagged `true` with `assessedCoveragePercent` explicitly quantified.

3. **Invariable Economic Gates**:
   - **Unknown Supplier Cost**: If COGS are unverified, algorithmic recommendation strictly blocks `TEST_CANDIDATE` and mandates `RESEARCH_MORE`.
   - **Missing Shipping Cost**: Never assumed to be $0.00. Marked with `missingCostState: "MISSING_SHIPPING_AND_FEES"` and `riskFlags: ["Shipping cost not confirmed; shipping subsidy omitted"]`.
   - **Unmeasured Competitor Metrics**: The system explicitly outputs in audit explanations: *"Competitor conversion rate and sales volume are NOT directly measured and remain unverified"*.
   - **Blocked Landing Pages**: An HTTP 403 / 429 response yields `ACCESS_RESTRICTED`, sets landing page pillar status to `FAIL`, assigns `score: null`, and never fabricates default CRO points.
   - **User Override Preservation**: When a founder manually overrides an algorithmic gate to run a small physical test, the decision is classified as `USER_OVERRIDE` while keeping the unmet algorithmic requirements preserved and visible.

---

## 2. Tested Business Scenarios & Verification Evidence

Verified in [`tests/unit/shopifyDecisionIntegrity.test.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/tests/unit/shopifyDecisionIntegrity.test.ts) and [`tests/unit/kh01EconomicsOpportunity.test.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/tests/unit/kh01EconomicsOpportunity.test.ts):

| Scenario | Tested Invariant | Result |
| :--- | :--- | :--- |
| **Scenario 1: Strong Ad, Unknown Supplier** | 15 ads, strong creative hook, but `supplierCostPerUnit: null`. Recommendation strictly locked to `RESEARCH_MORE`; test readiness blocked (`BLOCKED_MISSING_DATA`). | **PASS** |
| **Scenario 2: Missing Shipping Cost** | Shipping cost is `null`. Economics marked `isComplete: false`, `missingCostState: "MISSING_SHIPPING_AND_FEES"`, `isEligibleForTest: false`. | **PASS** |
| **Scenario 3: Video Without Demonstrated Utility** | Video URL exists, but no verified in-use product demo. Creative pillar does not pass and flags missing video demo evidence. | **PASS** |
| **Scenario 4: Long-Running Ad Falsification** | 8 active ads cataloged. Explanation explicitly states competitor conversion and sales volume remain unmeasured inferences. | **PASS** |
| **Scenario 5: Blocked Source Landing Page** | HTTP 403 access restriction. Landing page status set to `FAIL`, CRO score `null`, risk flagged. | **PASS** |
| **Scenario 6: Partial Coverage Transparency** | Only product, creative, and economics evaluated. `isPartialScore: true`, `assessedCoveragePercent < 100`, readiness and score decoupled. | **PASS** |
| **Scenario 7: User Override Segregation** | Founder test override with verified sample units. Status transitions to `USER_OVERRIDE`, but unmet requirements remain permanently auditable. | **PASS** |

All 25 unit tests across the two test suites passed with 100% compliance.
