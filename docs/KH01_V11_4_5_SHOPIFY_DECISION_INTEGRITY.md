# KH-01 V11.4.5 — Shopify Decision Integrity & Six-Pillar Scoring

## Overview
KH-01 evaluates ecommerce product opportunities across Six Core Pillars. The decision engine enforces strict factual verification rules to ensure ecommerce operators never waste capital on unviable products due to optimistic assumptions or fabricated data (Tasks 134–146).

---

## The Six Pillars of Ecommerce Viability

1. **Product Identity**: Confidence in what the item is and its competitive positioning.
2. **Creative Performance**: Visual demonstration hook, engagement signals, ad duration.
3. **Offer Structure**: Selling price, currency, bundle/discount model, perceived value.
4. **Landing Page CRO**: Speed, mobile layout, trust badges, checkout flow, friction points.
5. **Unit Economics**: Gross margin, COGS, break-even CPA, contribution margin before ads.
6. **Fulfillment Feasibility**: Shipping subsidy, package dimensions, delivery lead times, supplier reliability.

---

## Adversarial Invariant Rules & Test Results

| Invariant Rule | Tested Scenario | Result |
| :--- | :--- | :--- |
| **Missing Supplier Cost Gate** | High ad count, compelling creative, but unknown supplier quote | Algorithmic status: `RESEARCH_MORE`. `TEST_CANDIDATE` strictly blocked. (**PASSED**) |
| **Zero Shipping Assumption Guard** | Shipping subsidy omitted in user inputs | Shipping cost remains marked `UNKNOWN`. It is never assumed to be $0.00. (**PASSED**) |
| **Demonstration Hook Guard** | Video ad with high view count but no product demo evidence | Creative pillar score penalizes lack of product demonstration. (**PASSED**) |
| **Sales Fabrication Guard** | Long-running ad active for 60+ days | Ad duration is noted, but competitor sales/revenue are NOT fabricated. (**PASSED**) |
| **Blocked Source Honesty** | Landing page returns HTTP 403 / Cloudflare challenge | Marked `ACCESS_RESTRICTED`. CRO score is NOT fabricated. (**PASSED**) |
| **Opportunity vs Readiness Separation** | Product with 75 Opportunity Score but only 35% Evidence Readiness | Scores are tracked and rendered separately in the UI. (**PASSED**) |
| **User Override Distinction** | Operator manually overrides algorithmic recommendation | `status: "USER_OVERRIDE"` is preserved and distinguished from the algorithm. (**PASSED**) |

---

## Test Evidence
- Test Suite: `tests/unit/shopifyDecisionIntegrity.test.ts`
- Tests Executed: 7 passed (7 total)
- Exit Code: `0`
