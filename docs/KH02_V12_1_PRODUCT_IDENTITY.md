# SWAI KH-02 V12.1 — Product Identity Resolution & Candidate Deduplication

## 1. Executive Summary

In KH-02 V12.0, product candidate discovery suffered from severe identity flaws:
1. **Ad Library URL Grouping**: Candidates grouped on `obs.sourceUrl` which for Meta ads is `facebook.com/ads/library/?id=...`. Since every ad has a unique Library ID, 3 ads for the exact same product were split into 3 distinct candidates.
2. **Missing ResearchProduct Mapping**: Candidates received temporary IDs like `cand_123456_1`. These discovery IDs were mistakenly used in place of database `ResearchProduct.id` records, breaking historical demand lookups and Product Intelligence routing.
3. **Non-Persistent Operator Review**: `submitProductMatchReview()` returned an updated in-memory object but did not persist operator confirmation or rejection decisions to SQLite.

In V12.1, product identity resolution has been completely overhauled and verified.

---

## 2. P0 Fix: Candidate Grouping by Destination Landing Page URL

### Priority Hierarchy
When grouping ad observations into product candidates (`discoverProductCandidatesFromAds`):

1. **Priority 1 (Destination Landing URL)**: Uses `obs.landingPageUrl` when valid. Canonicalizes tracking parameters (`utm_*`, `ref`, `fbclid`) while preserving variant IDs and product handles.
   - Example: `https://store.com/products/pet-hair-roller?utm_source=fb` and `https://store.com/products/pet-hair-roller` group into **1 candidate**.
2. **Priority 2 (Store Domain & Product Concept)**: If landing page URL is missing, groups on verified merchant domain + clean functional title.
3. **Priority 3 (Ad Library Exclusion)**: Explicitly ignores Ad Library URLs (`facebook.com/ads/library`, `tiktok.com`) as destination domains.

### Verification Example
- Ad 1: Meta Library ID 111111111, Ad URL: `facebook.com/ads/library/?id=111111111`, Landing: `store.com/products/roller`
- Ad 2: Meta Library ID 222222222, Ad URL: `facebook.com/ads/library/?id=222222222`, Landing: `store.com/products/roller`
- Ad 3: Meta Library ID 333333333, Ad URL: `facebook.com/ads/library/?id=333333333`, Landing: `store.com/products/roller`

**Result**: Exactly **1 Product Candidate**, **3 Supporting Ads**, **1 Store Domain**.

Negative Check:
- Ad 4: Landing: `store.com/products/nail-grinder`
**Result**: **2 Distinct Candidates** (never merged merely because they share a store domain).

---

## 3. P0 Fix: Candidate to Real ResearchProduct ID Mapping

### Implementation: `resolveCandidateResearchProduct()`
Maps a `DiscoveredProductCandidate` to a persisted `ResearchProduct` in the database:
```typescript
export async function resolveCandidateResearchProduct(
  candidate: DiscoveredProductCandidate,
  workspaceId: string
): Promise<KH02ResolvedCandidate>
```

**Resolution Stages**:
1. **AdProductLink Lookup**: Checks if any supporting ad ID (`candidate.supportingAdIds`) is already linked to a `ResearchProduct` via `prisma.adProductLink`.
2. **Canonical URL Match**: Uses `matchExistingResearchProduct()` from `productService.ts` to match canonical destination keys against existing catalog products.
3. **Fallback**: If no existing product exists, returns `researchProductId: null`, `identityStatus: "PROVISIONAL"`, and `requiresManualReview: true`.

**Critical Invariant**:
- Never generate synthetic `ResearchProduct.id` strings.
- Never pass `candidateId` (`cand_...`) to functions expecting a real database product ID.

---

## 4. Persistent Cross-Store Match Review

### Implementation: `persistProductMatchReview()`
Operator decisions (`CONFIRMED`, `REJECTED`, `UNCERTAIN`) are persisted to `prisma.researchEvidence` scoped to the authorized workspace:
```typescript
await prisma.researchEvidence.create({
  data: {
    workspaceId,
    subjectType: "PRODUCT_MATCH_REVIEW",
    subjectId: hypothesis.matchId,
    pillar: "PRODUCT",
    claim: decision,
    observedValue: JSON.stringify(hypothesis),
    observationMethod: "USER_INPUT",
    classification: "SOURCE_REVIEWED",
    verifierActorId: reviewerId,
    verifiedAt: new Date(),
  },
});
```
Decisions survive page reloads and cannot be accessed across workspace boundaries.
