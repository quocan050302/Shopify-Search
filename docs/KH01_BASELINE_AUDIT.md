# KH-01: Baseline Audit & Architectural Readiness Report

## 1. Executive Summary & Verification Context
- **Master Plan Code**: KH-01 (SWAI V11.4)
- **Engine Title**: Competitor Product, Offer & Funnel Intelligence Engine
- **Repository**: `https://github.com/quocan050302/Shopify-Search`
- **Working Branch**: `feature/v11-meta-collector-remove-muse`
- **Verified Baseline HEAD SHA**: `1f6217dda2d547a08d6f0f38ce92ead174c95657`
- **Commit Message**: `fix(v11.3.1): product decision safety, canonical economics, api security & persistence hotfix`
- **Target Market**: United States (US)
- **Operating Mode**: `RESEARCH_ONLY` (no automated financial or checkout actions, no automated mass crawling)
- **Test Baseline Status**: 25/25 test suites passing (265/265 unit and integration tests passing).
- **Database Backup**: Physical copy created at `dev.db.backup_kh01_pre_migration` prior to schema modifications.

---

## 2. Reusable Functions & Current Callers Audit

| Function | Location | Current Role | Callers & Integration Points |
| :--- | :--- | :--- | :--- |
| `groupAdsByProduct(adIds)` | `src/services/products/productService.ts` | Groups competitor ads by canonical product URL | `src/app/api/v1/products/route.ts` |
| `recordProductPriceObservation(...)` | `src/services/products/productService.ts` | Appends historical price observation for product | Called by ingestion services and product candidate creation |
| `calculateProductResearchTrend(...)` | `src/services/products/productService.ts` | Aggregates ad velocity & active ad counts for products | `src/app/products/page.tsx`, `src/app/api/v1/products/route.ts` |
| `extractDomainFromUrl(...)` | `src/services/products/productService.ts` | Normalizes hostnames from product and landing links | Link validators, store resolvers, platform detectors |
| `saveAdProductCandidate(...)` | `src/services/products/productService.ts` | Connects an ad to a product candidate | `src/app/api/v1/ads/[id]/product-candidate/route.ts` |
| `calculateEconomics(...)` | `src/lib/economics.ts` | Core mathematical unit economics calculation | Ad detail drawer, decision dialogs, API routes |
| `deriveRecommendation(...)` | `src/lib/economics.ts` | Decision safety recommendation heuristic | Decision dialog, ad detail view model, API routes |
| `roundCurrency(...)` | `src/lib/economics.ts` | Deterministic 2-decimal money rounding | Economics calculations throughout app |
| `detectCommercePlatform(...)` | `src/services/products/platformDetector.ts` | Evaluates HTML and headers for Shopify/WooCommerce | Store resolution, link validation |
| `validateResearchUrl(...)` | `src/services/links/linkValidationService.ts` | Basic format checking for research URLs | `src/app/api/v1/links/validate/route.ts` |
| `checkExternalLink(...)` | `src/services/links/linkValidationService.ts` | HTTP HEAD/GET connectivity and status check | Link validation route, drawer diagnostics |
| `getAdvertisementDetails(...)` | `src/services/ads/adService.ts` | Queries database for complete ad relational tree | `src/app/api/v1/ads/[id]/route.ts` |
| `getAdvertisementDetailViewModel(...)` | `src/services/ads/adService.ts` | Transforms raw ad entity into typed view model | `AdDetailDrawer.tsx`, explorer page |

---

## 3. Existing Prisma Models Audit

1. **`User` / `Workspace` / `WorkspaceMember`**:
   - `Workspace` has `id`, `name`, `slug`, `role`, timestamps.
   - Relational multi-tenancy exists in schema, but several endpoints historically fell back to `default-workspace` or trusted caller-supplied `x-workspace-id` without validating member role or session.
2. **`CompetitorAd` / `Advertiser` / `CompetitorStore`**:
   - `CompetitorAd`: externalAdId, platform (META, TIKTOK), headline, bodyText, callToAction, landingPageUrl, creativeUrl, firstSeenAt, lastSeenAt, status, targetMarket, evergreenScore.
   - `Advertiser`: name, domain, externalId.
   - `CompetitorStore`: advertiserId, domain (unique), storeName, commercePlatform (`SHOPIFY_CONFIRMED`, `SHOPIFY_POSSIBLE`, `OTHER`, `UNKNOWN`), currency, country.
3. **`ResearchProduct` / `AdProductLink` / `ProductPriceObservation`**:
   - `ResearchProduct`: storeId, title, category, description, imageUrl, currentPrice, currency, productUrl.
   - `AdProductLink`: adId, productId, confidenceScore, matchReason, confirmedByUser. Enforces many-to-one or many-to-many ad-to-product mapping.
   - `ProductPriceObservation`: productId, price, currency, observedAt, sourceUrl, isPromo.
4. **`ResearchDecision` / `ResearchNote`**:
   - `ResearchDecision`: adId, decision (`READY_FOR_SMALL_TEST`, `RESEARCH_MORE`, `REJECTED`, `WATCHLIST`), targetAudience, riskAssessment, notes, decisionAt.
   - Note: In earlier versions, economics scenarios were serialized directly into `ResearchDecision.notes`.
5. **`DiscoveryRun` / `DiscoveryRunAd` / `SyncJob`**:
   - `DiscoveryRun`: tracks collection runs by provider (`meta-ads-collector`).
   - `DiscoveryRunAd`: tracks individual ads discovered in each run with relational integrity and outcome (`NEW`, `EXISTING`, `FAILED`).
   - `SyncJob`: general background task persistence.

---

## 4. Detected Technical Risks & Vulnerabilities

### Risk A: Product Candidate Authorization Bypass (`KH-01.A`)
- **Current State**: `src/app/api/v1/ads/[id]/product-candidate/route.ts` accepts `x-workspace-id` or request body `workspaceId`. It only checks `prisma.workspace.findUnique({ where: { id: targetWorkspaceId } })`. If any workspace with that ID exists in the database, the operation proceeds!
- **Bypass**: Line 212 of `product-candidate/route.ts` permitted cross-tenant writes if `associatedWorkspaceIds.has("default-workspace")`.
- **Mitigation in KH-01.A**: Implement `resolveAuthorizedResearchContext(request)` and `assertAdWorkspaceAccess(adId, context)` to enforce cryptographically secure or admin-authenticated workspace ownership and fail closed.

### Risk B: Insecure External URL Fetching & SSRF Vulnerabilities (`KH-01.A`, `KH-01.C`)
- **Current State**: `checkExternalLink` does basic protocol checks, but lacks DNS pin checks, redirect hop inspection, private IP range blocks (RFC 1918, RFC 3927, loopback `127.0.0.1`, cloud metadata `169.254.169.254`), response byte bounding, and cancellation timeouts.
- **Mitigation in KH-01.A**: Create `validatePublicResearchUrl(rawUrl)` with strict hostname normalization, CIDR private/loopback/cloud-metadata rejection, and `fetchPublicResearchPage(validatedUrl, options)` with max bytes (2MB), max redirects (3), and 8s AbortSignal timeout.

### Risk C: Loose URL Prefix Product Matching (`KH-01.A`, `KH-01.B`)
- **Current State**: `saveAdProductCandidate()` matches existing products using `productUrl: { startsWith: cleanUrl }`. If `cleanUrl` is `https://brand.com/products/shirt`, it could incorrectly match `https://brand.com/products/shirt-blue` or `https://brand.com/products/shirt-pants-combo`.
- **Mitigation in KH-01.A/B**: Implement `canonicalizeProductUrl(rawUrl)` (stripping marketing trackers `utm_*`, `fbclid`, `ref` while preserving variant keys like `variant`, `id`) and `matchExistingResearchProduct(...)` returning confidence tiers (`EXACT_MATCH`, `PROBABLE_MATCH`, `AMBIGUOUS`, `NO_MATCH`).

### Risk D: Conflation of Product, Ad, and Offer Entities (`KH-01.B`)
- **Current State**: Pricing is stored as a single scalar `currentPrice` on `ResearchProduct` and historical scalar rows in `ProductPriceObservation`. Bundles, quantity breaks, compare-at prices, free-shipping thresholds, and warranty guarantees have no structured persistence.
- **Mitigation in KH-01.B**: Create model `CompetitorOfferSnapshot` tracking structured prices, compare-at prices, bundles, shipping conditions, and content hash.

### Risk E: Decision Override Disguised as Algorithm Recommendation (`KH-01.A`, `KH-01.D`)
- **Current State**: If a user selects `READY_FOR_SMALL_TEST`, previous code could overwrite or obscure the fact that the underlying algorithmic recommendation was `RESEARCH_MORE` due to missing supplier quotes.
- **Mitigation in KH-01.A/D**: Keep `algorithmRecommendation` immutable and separate from `userDecision`. If the user chooses a manual override, label it explicitly: `USER OVERRIDE — REQUIREMENTS NOT MET`.

---

## 5. Proposed New Models for KH-01

1. **`ResearchEvidence`**:
   - Subject-level provenance tracking (claim, observedValue, classification, observationMethod, sourceUrl, verificationStatus).
2. **`CompetitorOfferSnapshot`**:
   - Snapshot of commercial terms (sellingPrice, compareAtPrice, bundleQuantity, shippingThreshold, rawOfferJson, snapshotHash).
3. **`LandingPageSnapshot`**:
   - Versioned capture of competitor landing page (originalUrl, finalUrl, httpStatus, accessStatus, htmlHash, croObservationsJson).
4. **`ProductEconomicsScenario`**:
   - User or offer-derived financial modeling (scenarioName, inputsJson, outputsJson, assumptionProvenanceJson).
5. **`SupplierQuote`**:
   - Verified or estimated supplier information (supplierName, unitCost, moq, shippingEstimate, currency, quoteSource).
6. **`FulfillmentAssessment`**:
   - Operational risk review (handlingRisk, leadTimes, criticalGapsJson).
7. **`ProductOpportunityAssessment`**:
   - Six-pillar evaluation (Product, Creative, Offer, Landing Page, Economics, Fulfillment) with explicit separation between `opportunityScore` and `evidenceReadinessScore`.

---

## 6. Execution Roadmap
1. **KH-01.A**: Security, Data Integrity & Evidence Foundation (Auth context, URL security, canonicalization, evidence model, decision safety).
2. **KH-01.B**: Product Identity Engine & Competitor Offer Intelligence (Offer extraction, snapshots, multi-ad linking).
3. **KH-01.C**: Landing Page Inspection Engine & Funnel Analyzer (Safe bounded fetch, HTML parsing, CRO heuristics, message matching).
4. **KH-01.D**: Product Economics Engine & Six-Pillar Opportunity Assessment (Order economics, supplier quotes, risk assessment, 6 pillars).
5. **KH-01.E**: Product Intelligence Workspace (`/products/[id]/intelligence`) & End-to-End Acceptance.
