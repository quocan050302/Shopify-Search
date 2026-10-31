# SWAI V11.3.1 — Product Decision Safety & Data Integrity Hotfix Acceptance

**Date:** October 24, 2026  
**Repository:** `quocan050302/Shopify-Search`  
**Branch:** `feature/v11-meta-collector-remove-muse`  
**Status:** PASSED (All 46 acceptance requirements fulfilled)

---

## 1. Executive Summary

SWAI V11.3.1 addresses critical decision safety, data integrity, and API authorization vulnerabilities identified in the product candidate research pipeline. Under prior logic, optimistic fallback defaults could produce `READY_FOR_SMALL_TEST` recommendations even when supplier costs were unknown, margins were negative, or market demand was unverified ad copy. Furthermore, client-supplied recommendations were trusted without server validation, and candidate mutations lacked transactional isolation and cross-tenant workspace verification.

V11.3.1 establishes a **zero-false-readiness architecture**:
1. **Mathematical Safety Gates:** Missing, zero, or negative contribution margins can never produce `READY_FOR_SMALL_TEST`. Zero or negative margin produces an immediate hard `REJECTED`. Missing costs default to `RESEARCH_MORE`.
2. **Elimination of Eligibility Bypasses:** The legacy `(isHealthyMargin || competitionLevel === "LOW")` bypass has been completely eliminated. Healthy margin ($\ge \$12$) AND validated competition are strictly required.
3. **Structured Evidence & UNKNOWN States:** Demand, competition, differentiation, delivery feasibility, and return risk now feature explicit `UNKNOWN` states. Any `UNKNOWN` critical gate automatically prevents `READY_FOR_SMALL_TEST`.
4. **Ad Copy $\ne$ Market Demand:** Ad headlines, captions, and body copy are marketing claims, not market validation. `demandEvidence === "VERIFIED"` strictly mandates an external proof citation (Google Trends, Amazon BSR, verified store reviews).
5. **Separation of Concerns:** Algorithm-computed recommendations and user researcher decisions are fully segregated in both the UI and database. Client recommendation payloads are discarded in favor of server-side computation.
6. **API Security & Workspace Isolation:** `POST /api/v1/ads/[id]/product-candidate` is protected by strict Zod schema validation (rejecting negative numbers, NaN, Infinity, malicious URI protocols) and multi-tenant workspace ownership verification.
7. **Transactional Persistence & Deduplication:** Product candidates are saved via atomic `prisma.$transaction`. Multiple ads pointing to the same product URL are deduplicated, canonical product titles are preserved, and all historical scenarios are recorded append-only.
8. **Canonical Economics Engine:** `@/lib/economics` provides a single shared calculation engine for frontend and backend, computing contribution margin, Break-even CPA, Target CPA, and Break-even ROAS ($\text{Selling Price} / \text{Contribution Margin}$), while explicitly tracking unconfirmed zero-cost assumptions.

---

## 2. P0 — Decision Engine Safety Audit & Fixes

### 2.1 Audit Findings in `deriveRecommendation()`

| Prior Vulnerability / Defect | Root Cause in Legacy Code | V11.3.1 Resolution |
| :--- | :--- | :--- |
| **Missing Supplier Cost Yielding Small Test** | If `contributionMargin` was not computed, fallback defaults could bypass margin check. | Strict check: `contributionMargin === null` or `missingCostState !== "COMPLETE"` adds a hard disqualifier and caps recommendation at `RESEARCH_MORE`. |
| **Zero or Negative Margin Passing** | No negative margin hard disqualifier; low competition could mask unprofitable unit economics. | Immediate hard `REJECTED`: If `contributionMargin <= 0`, recommendation is irrevocably `REJECTED`. |
| **Eligibility Bypass** | `(isHealthyMargin \|\| competitionLevel === "LOW")` allowed thin or negative margin products to qualify if competition was labeled LOW. | **Bypass Removed:** Product must satisfy `isHealthyMargin` ($\ge \$12$) **AND** `competitionLevel` in `["LOW", "MODERATE"]`. |
| **Unconfirmed Estimates Passing** | Any positive numeric margin qualified without checking supplier quote validity. | `isConfirmedByUser !== true` or `costVerificationSource === "USER_ESTIMATE"` prevents `READY_FOR_SMALL_TEST`. |
| **Missing UNKNOWN States** | Binary boolean checks coerced unassessed risk dimensions into safe defaults. | Introduced typed `UNKNOWN` state across all checklist items (`demandEvidence`, `competitionLevel`, `creativeAppeal`, `differentiationFeasibility`, `deliveryFeasibility`, `returnRisk`). Any `UNKNOWN` gate forces `RESEARCH_MORE`. |
| **Ad Copy Treated as Demand** | Selecting "VERIFIED" without proof citation was allowed. Ad headlines were treated as proof. | `demandEvidence === "VERIFIED"` requires `demandEvidenceSource` with $\ge 8$ characters of external proof citation. Citations referencing ad copy or headlines are rejected. |
| **Client Recommendation Authoritative** | Server accepted `body.recommendation` directly from the client. | Server completely recalculates recommendation using canonical `deriveRecommendation()`. Client-sent recommendation is ignored. |

### 2.2 Canonical Hard Gate Logic (`src/lib/economics.ts`)

```typescript
// Hard Disqualifier 1: Missing critical economics
if (params.contributionMargin === null || params.contributionMargin === undefined) {
  hardDisqualifiers.push("Missing supplier cost or selling price: contribution margin cannot be computed.");
  missingEvidence.push("Missing supplier cost or selling price: contribution margin cannot be computed.");
}

// Hard Disqualifier 2: Zero or negative contribution margin -> Immediate REJECTED
if (params.contributionMargin !== null && params.contributionMargin !== undefined && params.contributionMargin <= 0) {
  return {
    recommendation: "REJECTED",
    isSmallTestEligible: false,
    hardDisqualifiers: [
      `Negative or zero contribution margin ($${params.contributionMargin.toFixed(2)}). Product loses money on every unit before ad spend.`,
    ],
    missingEvidence,
    rationale: `Unit economics are structurally unviable. Contribution margin is $${params.contributionMargin.toFixed(2)}.`,
  };
}

// Hard Disqualifier 3: Thin margin (< $12)
if (params.contributionMargin !== null && params.contributionMargin < 12) {
  hardDisqualifiers.push(`Contribution margin ($${params.contributionMargin.toFixed(2)}) is below the minimum viable ad threshold ($12.00).`);
}

// Hard Disqualifier 4: Unconfirmed cost estimates
if (!params.isConfirmedByUser || params.costVerificationSource === "USER_ESTIMATE") {
  missingEvidence.push("Cost assumptions are unconfirmed estimates. Must verify supplier quotes and shipping rates before committing ad budget.");
}

// Hard Disqualifier 5: UNKNOWN or unverified market demand
if (params.demandEvidence === "UNKNOWN" || params.demandEvidence === "UNVERIFIED") {
  missingEvidence.push("Market demand has not been validated with independent external search or retail volume evidence.");
}
```

---

## 3. P0 — API Security & Workspace Isolation

### 3.1 Endpoint Hardening (`src/app/api/v1/ads/[id]/product-candidate/route.ts`)

1. **Strict Zod Input Validation:**
   - Numerical values (`observedSellingPrice`, `estimatedSupplierCost`, `shippingCost`, `platformFees`, `targetProfitPerUnit`) reject `NaN`, `Infinity`, and negative values (`z.number().finite().nonnegative()`).
   - Percentages (`returnAllowancePercent`) bounded to `[0, 100]`.
   - String inputs (`productUrl`, `demandEvidenceSource`, `notes`, `category`, `title`) sanitized. URL validated to reject `javascript:`, `data:`, or `file:` schemes.
   - Enums strictly enforced for `costVerificationSource`, `demandEvidence`, `competitionLevel`, `creativeAppeal`, `differentiationFeasibility`, `deliveryFeasibility`, `returnRisk`, and `userDecision`.
2. **Multi-Tenant Workspace Ownership & Isolation:**
   - Workspace ID extracted from `x-workspace-id` header or body payload. Defaults to default workspace if not supplied.
   - Verified that the workspace exists. Rejects invalid workspaces with HTTP 403 `UNAUTHORIZED_WORKSPACE`.
   - Verified that the target `CompetitorAd` is associated with the requesting workspace (via `RunAd` or `WatchlistItem`). Rejects cross-tenant access attempts with HTTP 403 `FORBIDDEN_WORKSPACE_AD`.
3. **Information Disclosure Prevention:**
   - Database and internal errors logged server-side only. Client receives sanitized error contracts:
     ```json
     {
       "error": {
         "code": "CANDIDATE_SAVE_FAILED",
         "message": "Failed to save product candidate safely. All changes were rolled back."
       }
     }
     ```

---

## 4. P1 — Product Persistence & Transaction Integrity

### 4.1 Atomicity via `prisma.$transaction` (`src/services/products/productService.ts`)

All candidate creation, deduplication, price observation, and decision persistence occur inside a single atomic Prisma transaction:

```typescript
return await prisma.$transaction(async (tx) => {
  // 1. Verify ad existence
  // 2. Resolve or upsert CompetitorStore
  // 3. Find or create ResearchProduct (with deduplication)
  // 4. Create AdProductLink with conditional confidence
  // 5. Record ProductPriceObservation with explicit source tag
  // 6. Append ResearchDecision audit record
});
```

### 4.2 Duplicate Product Prevention & Title Preservation

- **URL Normalization:** URLs stripped of tracking parameters (`utm_*`, `fbclid`, `ref`, anchors).
- **Existing Product Lookup:** Looks up existing `ResearchProduct` records matching either:
  1. The normalized product URL on the same store.
  2. The exact product URL.
  3. A case-insensitive exact title match on the same store.
- **Title Preservation:** When an existing product is found, its canonical title is **never overwritten** by an ad's creative headline or hook. The existing title is preserved unless the user explicitly provided a new title.
- **Conditional Link Confidence:**
  - `CONFIRMED`: Assigned only when the ad's landing page URL exactly matches the product's destination URL.
  - `PROBABLE`: Assigned when the link is derived from advertiser store domain matching or ad headline heuristics.
- **Scenario Audit Trail:** Rather than overwriting past research, every save operation appends a new `ResearchDecision` record storing the snapshot parameters, algorithm recommendation, and user decision.

---

## 5. P1 — Canonical Economics Engine

### 5.1 Formula Specifications (`src/lib/economics.ts`)

| Metric | Formula | Behavior on Missing Inputs |
| :--- | :--- | :--- |
| **Return Cost Allowance** | $\text{Selling Price} \times (\text{Return Allowance \%} / 100)$ | $0.00$ if return rate is $0\%$ |
| **Total Unit Cost** | $\text{Supplier Cost} + \text{Shipping} + \text{Fees} + \text{Return Allowance}$ | `null` if supplier cost is missing |
| **Contribution Margin** | $\text{Selling Price} - \text{Total Unit Cost}$ | `null` if selling price or supplier cost missing |
| **Break-even CPA** | Equals Contribution Margin (max allowable ad spend to break even) | `null` if contribution margin missing |
| **Break-even ROAS** | $\frac{\text{Selling Price}}{\text{Contribution Margin}}$ | `null` if margin missing or $\le 0$ |
| **Target CPA** | $\text{Contribution Margin} - \text{Target Profit Per Unit}$ | `null` if margin missing |
| **Missing Cost State** | Categorizes: `COMPLETE`, `MISSING_SUPPLIER_COST`, `MISSING_SELLING_PRICE`, `MISSING_ECONOMICS`, `MISSING_SHIPPING_AND_FEES` | Never assumes unknown shipping or fees are zero without warning flag |

### 5.2 Floating Point Arithmetic Safety

All financial operations use `roundCurrency(val)` which rounds to 2 decimal places using `Math.round(val * 100) / 100`, eliminating floating-point precision artifacts (e.g. $0.1 + 0.2 = 0.30$).

---

## 6. P1 — Research Signals & Ad Status UNKNOWN

1. **Source Reliability Correction:**
   - MetaAdsCollector imports are classified as `USER_IMPORT`, never `OFFICIAL_PROVIDER` (even if raw payload contains `VERIFIED` confidence).
2. **Ad Status `UNKNOWN` Separation:**
   - In `calculateProductResearchTrend()`, Meta ads with status `"UNKNOWN"` are tracked in `unknownAdsCount`.
   - Missing active confirmations with `UNKNOWN` status do **not** imply `"COOLING"`. Products with `UNKNOWN` ads and no confirmed inactive ads are classified as `"NEW"` or `"STEADY"`.
   - `"COOLING"` strictly requires confirmed `"INACTIVE"` observations and zero active ads.

---

## 7. Verification & Regression Evidence

### 7.1 Automated Unit & Integration Tests

The comprehensive regression suite in `tests/unit/decisionSafety.test.ts` validates all 46 requirements:

| Test Group | Tests | Description | Result |
| :--- | :---: | :--- | :---: |
| **P0: deriveRecommendation() Rules** | 7 | Missing margin $\to$ `RESEARCH_MORE`, zero/negative margin $\to$ `REJECTED`, thin margin disqualification, removal of low-competition bypass, unconfirmed cost disqualification, ad copy demand rejection, strict passing conditions. | **PASS** |
| **P1: Canonical Economics & Currency** | 4 | Missing cost states, explicit zero-shipping/fee flags, Break-even ROAS & Target CPA calculations, floating point rounding safety. | **PASS** |
| **P1: Research Trend Velocity** | 2 | UNKNOWN Meta ad status does not imply COOLING; confirmed INACTIVE required for COOLING. | **PASS** |
| **P1: Duplicate Prevention & Client Tampering** | 4 | Authoritative algorithm recommendation over client payload, duplicate product prevention by URL, title preservation, transaction rollback on failure. | **PASS** |
| **P0: API Security & Workspace Isolation** | 4 | Rejection of negative numbers/NaN/Infinity (HTTP 400), malicious URL protocols (HTTP 400), unauthorized workspace (HTTP 403), cross-tenant ad isolation (HTTP 403). | **PASS** |
| **Total Hotfix Tests** | **21** | **All 21 safety regression tests pass.** | **PASS** |

### 7.2 Full Repository Test Suite

```
 RUN  v5.0.5 D:/Project_github/Running-Ads

 ✓ tests/integration/discoveryApi.test.ts (7 tests)
 ✓ tests/unit/credentials.test.ts (20 tests)
 ✓ tests/integration/metaDiscoveryIngestion.test.ts (2 tests)
 ✓ tests/integration/api.test.ts (5 tests)
 ✓ tests/integration/discoveryIngestion.test.ts (3 tests)
 ✓ tests/unit/tiktokCreativeCenter.test.ts (17 tests)
 ✓ tests/unit/decisionSafety.test.ts (21 tests)
 ✓ tests/unit/adService.test.ts (4 tests)
 ✓ tests/unit/db.test.ts (1 test)
 ✓ tests/unit/geminiV72.test.ts (26 tests)
 ✓ tests/unit/providerBudgets.test.ts (7 tests)
 ✓ tests/unit/discoveryTypes.test.ts (6 tests)
 ✓ tests/unit/v71.test.ts (39 tests)
 ✓ tests/unit/evergreen.test.ts (31 tests)
 ✓ tests/unit/discoveryProviders.test.ts (12 tests)
 ✓ tests/unit/discoveryBudget.test.ts (5 tests)
 ✓ tests/unit/metaCollectorNormalization.test.ts (8 tests)
 ✓ tests/unit/adDetailContract.test.ts (10 tests)
 ✓ tests/unit/v92DiscoveryRepair.test.ts (11 tests)
 ✓ tests/unit/discoveryNormalization.test.ts (6 tests)
 ✓ tests/unit/metaCollectorV11_2.test.ts (6 tests)
 ✓ tests/unit/metaCollectorProvider.test.ts (4 tests)
 ✓ tests/unit/security.test.ts (6 tests)
 ✓ tests/unit/financial.test.ts (5 tests)
 ✓ tests/unit/scoring.test.ts (3 tests)

 Test Files  25 passed (25)
      Tests  265 passed (265)
```

### 7.3 TypeScript & Production Build

- **TypeScript Typecheck:** `npx tsc --noEmit` $\to$ **0 errors**.
- **Next.js Production Build:** `npm run build` $\to$ **Compiled successfully in 1278ms, 39 static and dynamic routes generated cleanly**.

### 7.4 Live Browser Verification

Browser subagent verification conducted on `http://localhost:3000/explorer`:
1. **Ad Selection & Drawer State:** Opening an ad card populates cached card data and fetches complete details from `GET /api/v1/ads/:id`.
2. **Switching Ads Reset:** Switching between ads completely resets all editable economics inputs and checklist dropdowns, preventing state leakage across ads.
3. **Real-Time Unit Economics:**
   - Observed Selling Price: $\$49.99$
   - Est. Supplier Cost: $\$15.00$
   - Shipping: $\$4.50$
   - Platform & Fees: $\$1.50$
   - Return Allowance: $5\%$
   - Est. Contribution Margin: **$\$26.49$** (labeled "Hypothetical model")
   - Break-even CPA: **$\$26.49$** ("Zero profit threshold")
   - Break-even ROAS: **$1.89\text{x}$** ("Price / Margin")
   - Target CPA: **$\$21.49$** ("After target profit")
4. **Safety Gate Verification:**
   - With unconfirmed costs and uncertain differentiation, Algorithm Recommendation accurately held at **`RESEARCH_MORE`** with explicit rationale.
5. **Product Candidate Persistence:**
   - Candidate successfully saved to `ResearchProduct` via `POST /api/v1/ads/[id]/product-candidate`.
   - UI displayed confirmation banner: *"Saved to ResearchProduct! Candidate economics, scenario decision, and checklist recorded."*
6. **Artifact Screenshots Recorded:**
   - `winning_ads_explorer_completed_1792819284138.png` (Calculator, Checklist with UNKNOWN states, Citation input, Recommendation badge)
   - `save_product_candidate_result_1792819318707.png` (Successful persistence confirmation and segregated decision display)

### 7.5 Database Safety

- Pre-hotfix database snapshot: `backups/v11_3_1_pre_hotfix_20261024_120000.db`
- Post-verification database snapshot: `backups/v11_3_1_post_verification_20261024_123000.db` (Size: 843,776 bytes)
- Genuine research records preserved.

---

## 8. Conclusion

All 46 hotfix requirements under SWAI V11.3.1 are fulfilled and verified. Product decision safety, API validation, workspace isolation, transactional persistence, and canonical unit economics have been hardened to production standards.
