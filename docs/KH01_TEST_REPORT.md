# KH-01 — Automated Test Report & Verification Matrix
**SWAI V11.4 — Competitor Product, Offer & Funnel Intelligence Engine**

## 1. Test Suite Summary

- **Test Framework**: Vitest v5.0.5
- **Command**: `npm run kh01:verify`
- **Total Test Files**: 5
- **Total Tests Passed**: **55 / 55** (100% Pass Rate)
- **Total Execution Time**: ~1.36 seconds

```
 RUN  v5.0.5 /Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search

 ✓ tests/integration/kh01ProductIntelligenceWorkspace.test.ts (2 tests) 182ms
 ✓ tests/unit/kh01Security.test.ts (21 tests) 140ms
 ✓ tests/unit/kh01EconomicsOpportunity.test.ts (13 tests) 17ms
 ✓ tests/unit/kh01LandingPage.test.ts (8 tests) 18ms
 ✓ tests/unit/kh01ProductOffer.test.ts (11 tests) 6ms

 Test Files  5 passed (5)
      Tests  55 passed (55)
   Start at  13:50:49
   Duration  1.36s
```

---

## 2. Test Execution Matrix by Phase

### Phase KH-01.A — Security, Workspace Authorization & URL Hardening
**File: `tests/unit/kh01Security.test.ts` (21 Tests)**
- Resolves authenticated context with valid admin token.
- Falls back to local dev context in development mode.
- Blocks cross-tenant workspace access when caller provides unowned `x-workspace-id`.
- Rejects ad access across workspaces.
- Rejects product access across workspaces.
- URL Validation:
  - Validates legitimate public https URLs.
  - Rejects `http://localhost:3000` and loopback destinations.
  - Rejects private IP addresses (`10.0.0.1`, `192.168.1.1`, `172.16.0.5`).
  - Rejects AWS / Cloud metadata endpoints (`169.254.169.254`).
  - Rejects non-HTTP schemes (`file://`, `ftp://`, `javascript:`).
  - Handles encoded loopback and hex addresses.
- URL Canonicalization:
  - Strips tracking query parameters (`utm_*`, `fbclid`, `gclid`).
  - Preserves essential product variant IDs (`variant=410291`).
  - Lowercases domain and normalizes trailing slashes.
- Product Matching:
  - Exact URL matches existing product.
  - Probable match on same store with identical path handle.
  - Ambiguous match flagged when similar titles exist across different stores.
- Evidence Provenance:
  - Creates evidence records with typed provenance (`SOURCE_OBSERVED`, `USER_ESTIMATED`).
  - Evaluates evidence completeness across the 6 pillars.

### Phase KH-01.B — Product Identity & Competitor Offer Intelligence
**File: `tests/unit/kh01ProductOffer.test.ts` (11 Tests)**
- Technical Shopify platform detection with CDN / theme proof.
- Extracts product candidate title and domain from verified Meta ad.
- Resolves competitor store domain without duplicate www aliases.
- Creates new canonical `ResearchProduct` and associates ad link.
- Links multiple distinct Meta ads to a single canonical product.
- Deduplicates Library IDs in product advertising profiles.
- Offer Extraction:
  - Extracts Schema.org JSON-LD price, currency, and availability.
  - Extracts visible regex prices and strike-through compare-at prices.
  - Normalizes promotional offers (bundle breaks, free shipping thresholds).
  - Compares competing offers side by side with unit price and discount delta.

### Phase KH-01.C — Landing Page & Funnel Analyzer
**File: `tests/unit/kh01LandingPage.test.ts` (8 Tests)**
- Parses public landing page HTML safely without script execution.
- Extracts hero images, H1 headings, primary CTA, and testimonial elements.
- Inspects above-the-fold elements and value proposition clarity.
- Inspects trust signals (guarantees, secure payment indicators, review counts).
- Evaluates ad-to-landing-page message match:
  - Detects matching promises.
  - Detects conditional shipping mismatches (Ad claims free shipping; page requires $50 threshold).
- Computes `croReadiness` heuristic.
- Identifies meaningful page changes between versioned snapshots.

### Phase KH-01.D — Unit Economics, Fulfillment & Opportunity Assessment
**File: `tests/unit/kh01EconomicsOpportunity.test.ts` (13 Tests)**
- Exact monetary parsing and minor-unit precision.
- Calculates single-unit order economics (revenue, COGS, shipping subsidy, payment fees).
- Calculates multi-pack bundles with correct unit multiplication.
- Evaluates break-even CPA, target CPA, and break-even ROAS.
- Missing COGS or shipping subsidy results in `isComplete: false` and blocks definitive approval.
- Fulfillment risk scoring evaluates parcel weight, lead time, and return complexity.
- Aggregates Six-Pillar Opportunity Assessment (weights: 20/15/15/15/25/10).
- Decision gates enforce small test readiness requirements.
- Generates transparent, human-readable rationale explaining next required verification steps.

### Phase KH-01.E — End-to-End Integration & Workspace Acceptance
**File: `tests/integration/kh01ProductIntelligenceWorkspace.test.ts` (2 Tests)**
- **Full E2E Research Workflow**:
  - Genuine Meta Ad → Product Candidate extraction → URL Canonicalization → Canonical `ResearchProduct` creation → Ad-to-product link → Product advertising profile verification → Queuing landing page research job → Atomic worker claim and execution → Landing page parsing & snapshot persistence → Supplier quote recording → Multi-scenario unit economics calculation → Fulfillment risk assessment → Six-pillar opportunity scoring → Decision gates verification → User decision audit logging.
- **User Override Test**:
  - Verifies that when an operator manually forces `TEST_CANDIDATE` on an ineligible product (e.g. negative margin), the system marks the notes with `[USER OVERRIDE — ALGORITHMIC REQUIREMENTS NOT MET]` while preserving the underlying algorithmic recommendation (`REJECT`).
