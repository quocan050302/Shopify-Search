# KH-01 V11.4.2 — Business Research & Scoring Integrity Review

## 1. Overview
KH-01 provides Shopify product research intelligence to evaluate whether candidate products deserve capital commitment in small-budget advertising tests.
In V11.4.1, partial scores could obscure missing pillar weights, hypothesis falsification conditions were written as universal absolutes (e.g. "CTR < 1% rejects angle"), and unverified supplier estimates risked being interpreted as validated platform quotes.

In KH-01 V11.4.2 (Checkpoint 5), the six-pillar evaluation engine has been tightened to guarantee:
- Explicit labeling of partial scores (`isPartialScore: true`, `assessedCoveragePercent`, `missingPillarWeights`).
- Strict gate checks: Missing supplier COGS or unperformed fulfillment assessments permanently block `TEST_CANDIDATE` eligibility, keeping products truthfully in `RESEARCH_MORE` status.
- Transparent hypothesis labeling: All narrative conditions are explicitly framed as user-configurable test hypotheses rather than universal deterministic laws.
- Upgraded methodology version: `11.4.2`.

## 2. Functions Audited & Modified

| File | Function / Symbol | Changes |
| :--- | :--- | :--- |
| `src/services/research/opportunityAssessmentService.ts` | `ProductOpportunityAssessment` | Added `isPartialScore`, `assessedCoveragePercent`, and `missingPillarWeights` fields to clearly communicate partial evaluation coverage. |
| `src/services/research/opportunityAssessmentService.ts` | `calculateOpportunityAssessment` | Methodology version updated to `11.4.2`. Transparent coverage calculation and gating. |
| `src/services/research/opportunityAssessmentService.ts` | `explainOpportunityRecommendation` | Replaced rigid universal claims with explicitly labeled user-configurable hypotheses. |
| `src/services/research/opportunityAssessmentService.ts` | `evaluateEconomicsPillar` | Requires `cogs != null` and `readiness >= 50` for a non-null economics score; zero/negative contribution margin immediately forces `FAIL`. |
| `src/services/research/opportunityAssessmentService.ts` | `evaluateSmallTestReadiness` | Enforces 4 critical gates: Confirmed Identity/Pain Point, Verified Offer Terms, Verified Unit Economics (`PASS`), Operational/Logistics Feasibility, and Evidence Readiness >= 70%. |

## 3. The Six KH-01 Pillars
1. **Product Pillar (Weight: 20%)**: Identity confidence (`EXACT` / `PROBABLE` / `AMBIGUOUS` / `INSUFFICIENT_EVIDENCE`), customer pain point clarity, observed differentiation, saturation risk.
2. **Creative Pillar (Weight: 15%)**: Real ad count from Meta Ad Library, hook quality, problem/demonstration hook, CTA copy. Never infers demonstration purely from video duration.
3. **Offer Pillar (Weight: 15%)**: Observed selling price, compare-at markdown, multi-unit bundle take-rates, free shipping thresholds. Real observed values only; currency is never defaulted to USD.
4. **Landing Page Pillar (Weight: 15%)**: CRO architecture, headline clarity, hero CTA, social proof, return/shipping policy presence. Restricted/blocked sources yield explicit `null` score, never a synthetic default.
5. **Economics Pillar (Weight: 25%)**: Net revenue, COGS, shipping subsidy, pick/pack fees, payment processing fees, return reserve, contribution margin, break-even CPA, target CPA, break-even ROAS.
6. **Fulfillment Pillar (Weight: 10%)**: Transit times, weight/fragility, hazardous materials (lithium batteries/liquids), supplier quote provenance (`USER_ESTIMATE` vs `SUPPLIER_QUOTE` vs `VERIFIED_EVIDENCE`).

## 4. Test Verification
Test suites executed:
- `tests/unit/kh01EconomicsOpportunity.test.ts` (18 tests passed)
- `tests/unit/decisionSafety.test.ts` (21 tests passed)
- `tests/unit/kh01ProductOffer.test.ts` (11 tests passed)
- `tests/unit/kh01LandingPage.test.ts` (8 tests passed)

Total: 58 tests passed with zero failures.
