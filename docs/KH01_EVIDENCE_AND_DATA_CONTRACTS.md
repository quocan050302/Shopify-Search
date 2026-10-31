# KH-01 — Evidence System & Data Contracts
**SWAI V11.4 — Competitor Product, Offer & Funnel Intelligence Engine**

## 1. Principles of Evidence Provenance

A foundational doctrine of SWAI KH-01 is that an unverified claim, assumption, or forecast must never be disguised as empirical storefront observation. Every metric and fact displayed in SWAI carries an explicit provenance classification:

```typescript
export type EvidenceClassification =
  | "SOURCE_OBSERVED"   // Directly scraped and parsed from competitor landing page or ad
  | "USER_ENTERED"      // Input manually provided by operator (e.g. supplier quote)
  | "USER_ESTIMATED"    // Hypothetical assumption (e.g. estimated shipping subsidy)
  | "MODEL_INFERRED"    // Heuristic analytical assessment (e.g. CRO score, pain point clarity)
  | "SOURCE_SUBMITTED"  // Directly submitted by external webhook or API
  | "SOURCE_REVIEWED"   // Reviewed by human operator against source
  | "VERIFIED"          // Independently corroborated by 2+ non-conflicting sources
  | "UNKNOWN";          // Value is not yet verified or observed
```

---

## 2. Prisma Schema Models

KH-01 introduces 7 new models to `prisma/schema.prisma` alongside existing `CompetitorAd`, `ResearchProduct`, `CompetitorStore`, and `AdProductLink`:

### 2.1 ResearchEvidence
Stores granular evidence points supporting claims across the 6 research pillars.
- `subjectType`: `"PRODUCT"`, `"OFFER"`, `"LANDING_PAGE"`, `"CREATIVE"`, `"ECONOMICS"`, `"FULFILLMENT"`
- `subjectId`: Foreign key to the subject record
- `pillar`: `"PRODUCT" | "CREATIVE" | "OFFER" | "LANDING_PAGE" | "ECONOMICS" | "FULFILLMENT"`
- `claim`: Description of fact (e.g., `"Visible Selling Price"`)
- `observedValue`: Stringified observed value (e.g., `"29.99"`)
- `classification`: `EvidenceClassification`
- `sourceUrl`: URL where observation was recorded
- `verifiedAt`: Optional verification timestamp

### 2.2 CompetitorOfferSnapshot
Captures commercial terms offered by competitor storefronts over time.
- `productId`, `storeId`, `adId`: Associated relationships
- `sourceUrl`, `finalUrl`: Destination addresses
- `currency`: 3-letter currency code (e.g. `"USD"`)
- `sellingPrice`, `compareAtPrice`: Decimal prices
- `availability`: `"IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN"`
- `offerDataJson`: Normalized structured offer (bundle quantities, free shipping thresholds, gifts)
- `snapshotHash`: SHA-256 fingerprint of normalized offer content (deduplicates unchanged crawls)

### 2.3 LandingPageSnapshot
Captures the DOM, headings, CTA, and conversion architecture of competitor pages.
- `productId`, `adId`, `workspaceId`: Ownership context
- `httpStatus`, `accessStatus`: `"SUCCESS" | "ACCESS_RESTRICTED" | "RATE_LIMITED" | "FAILED"`
- `contentHash`: SHA-256 hash of parsed content
- `observationsJson`: Extracted headings, hero images, CTAs, testimonials, guarantees
- `croSignalsJson`: Structured CRO assessment (above-the-fold, trust badges, message match)
- `warningsJson`: Warnings or notes (e.g. blocked access, redirects)
- `analysisVersion`: Methodology revision string (e.g. `"11.4.0"`)

### 2.4 ProductEconomicsScenario
Stores modeled unit economics scenarios with assumption provenance.
- `scenarioName`: `"Base Single Unit"`, `"2-Unit Bundle"`, `"Conservative"`, etc.
- `inputsJson`: Validated inputs (`sellingPrice`, `cogs`, `shippingPaid`, `fulfillment`, `fees`)
- `outputsJson`: Modeled metrics (`contributionBeforeAds`, `breakEvenCpa`, `targetCpa`, `breakEvenRoas`)
- `assumptionProvenanceJson`: Maps each input to its source classification

### 2.5 SupplierQuote
Captures empirical quotes obtained from suppliers (AliExpress, 1688, private agents).
- `supplierName`, `productIdentifier`: Supplier details
- `quotedCurrency`, `unitCost`, `moq`: Unit economics bounds
- `shippingLeadTimeDays`, `processingLeadTimeDays`: Transit times
- `quoteSource`: `"ALIEXPRESS_LISTING" | "1688_LISTING" | "SUPPLIER_INVOICE" | "USER_ESTIMATE"`

### 2.6 FulfillmentAssessment
Tracks logistics feasibility, package dimensions, fragility, and compliance risks.
- `productWeightGrams`, `packageDimensionsCm`: Physical metrics
- `isFragile`, `hasBatteryOrLiquid`: Hazmat flags
- `overallRiskLevel`: `"LOW" | "MODERATE" | "HIGH" | "UNKNOWN"`
- `identifiedRisksJson`, `criticalGapsJson`: Actionable risk items

### 2.7 ProductOpportunityAssessment
Aggregates all 6 research pillars into an overall evaluation.
- `opportunityScore`: Weighted composite research heuristic (0–100)
- `evidenceReadinessScore`: Fact completeness score (0–100)
- `pillarScoresJson`: Individual pillar scores and statuses
- `recommendation`: `"RESEARCH_MORE" | "SHORTLIST" | "TEST_CANDIDATE" | "REJECT"`
- `recommendationRationale`: Plain-language explanation of gate failures or strengths

---

## 3. Evidence Readiness Scoring Contract

The function `evaluateEvidenceReadiness(evidence: ResearchEvidenceRecord[])` computes readiness without factoring in commercial attractiveness:

| Pillar | Required Critical Evidence | Pillar Weight |
|---|---|---|
| **Product** | Confirmed customer problem, clear category, valid title | 20% |
| **Creative** | At least 1 verified ad, observed hook/headline, clear CTA | 15% |
| **Offer** | Observed selling price, currency, availability | 15% |
| **Landing Page** | Parsed public landing page snapshot, primary CTA observed | 15% |
| **Economics** | Verified or estimated COGS + shipping subsidy assumptions | 25% |
| **Fulfillment** | Package weight and dimensions, supplier quote on file | 10% |

An Evidence Readiness Score below **70%** prevents the system from recommending `"TEST_CANDIDATE"`, enforcing that missing facts require further research before advertising funds are committed.
