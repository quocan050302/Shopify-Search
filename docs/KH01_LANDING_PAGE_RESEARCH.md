# KH-01 — Landing Page Inspection & Funnel Analyzer
**SWAI V11.4 — Competitor Product, Offer & Funnel Intelligence Engine**

## 1. Operating Doctrine: Bounded & Non-Invasive Research

The landing page inspection workflow in SWAI KH-01 is explicitly designed to prevent crawler abuse, bot detection loops, and client system slowdowns:

- **User-triggered only**: Inspection jobs run only upon explicit user action ("Inspect Landing Page") or intentional batch refresh. Page renders in the Explorer NEVER trigger background crawls.
- **Strict Network Budgets**:
  - Max execution timeout: **8,000ms** (8 seconds).
  - Max redirect hops: **3**. Each redirect hop is re-validated against the SSRF private IP blocklist.
  - Max response size: **2MB** (`2 * 1024 * 1024` bytes). Oversized payloads are aborted.
  - Single-threaded worker concurrency: **1** concurrent landing page job per node.
- **Access Restrictions Respected**:
  - No CAPTCHA bypasses.
  - No Cloudflare/Datadome bypass scripting.
  - No fake cookies or session spoofing.
  - HTTP 401/403/429 responses are recorded honestly as `ACCESS_RESTRICTED` or `RATE_LIMITED`.

---

## 2. Public Page Parser Architecture

The parser `parsePublicLandingPage(html: string, pageUrl: string)` extracts DOM components without executing untrusted remote JavaScript:

```
HTML Input (Raw String <= 2MB)
   │
   ├─► 1. Metadata Extraction (Title, Meta Description, Canonical URL, OpenGraph)
   │
   ├─► 2. Schema.org JSON-LD (<script type="application/ld+json">)
   │      └─► Product, Offer, AggregateRating, Review
   │
   ├─► 3. Heading Hierarchy (H1, H2, H3, H4)
   │
   ├─► 4. CTA Detection (<button>, <a class="...btn|cta|checkout...">)
   │
   ├─► 5. Price Patterns ($xx.xx, €xx.xx, compare-at strikes)
   │
   ├─► 6. Policy & Trust Statements (Shipping terms, Guarantee, Returns)
   │
   └─► 7. Conversion Architecture (Hero image, Benefit blocks, FAQ, Reviews)
```

---

## 3. CRO Signal Extraction & Message Match

The `funnelAnalysisService.ts` evaluates the competitor page against conversion rate optimization (CRO) best practices:

### 3.1 Above-the-Fold Analysis (`inspectAboveTheFold`)
- **Product Title Prominence**: Primary H1 present and clearly names the product.
- **Price Visibility**: Price is rendered within initial DOM hierarchy.
- **Hero Media**: High-resolution product hero image present.
- **Primary CTA**: Direct purchase button visible without extensive scrolling.

### 3.2 Trust Signals (`inspectTrustSignals`)
- **Payment Badges**: Visa, Mastercard, PayPal, Apple Pay, Shopify Secure.
- **Guarantee Statements**: 30-day money-back guarantee, satisfaction guarantee.
- **Social Proof**: Observable customer review count and star ratings.
- **Contact & Support**: Customer support email, phone, or live chat mentioned.

### 3.3 Ad-to-Landing Message Match (`inspectMessageMatch`)
Compares the promise in the Meta ad creative against the landing page reality:
- **Headline Match**: Does the landing page reinforce the ad's main hook?
- **Offer Match**: If the ad claims *"50% off today"*, is this discount presented on page?
- **Shipping Match**: If the ad claims *"Free Shipping"*, does the landing page reveal an unexpected order threshold (e.g. *Free shipping over $50*)?
  - Flagged as `CONDITIONAL_MISMATCH` with exact text citations.

### 3.4 CRO Readiness Heuristic (`croReadiness`)
- Composite score (0–100) indicating the structural readiness of the competitor funnel based on observed elements.
- **Explicit Labeling**: Clearly annotated in UI as an analytical research heuristic, NOT an empirical competitor conversion rate.

---

## 4. Change Detection & Versioned Snapshots

Every inspection generates a `LandingPageSnapshot` with a content fingerprint (`contentHash`).
The function `compareLandingPageSnapshots(older, newer)` identifies real business changes:
- Selling price adjustments ($29.99 → $24.99).
- Compare-at price adjustments.
- Headline / value proposition pivots.
- CTA changes (*"Buy Now"* → *"Claim 50% Off"*).
- Shipping policy adjustments (*Free Shipping* → *$4.95 Shipping*).
- Out-of-stock transitions.
