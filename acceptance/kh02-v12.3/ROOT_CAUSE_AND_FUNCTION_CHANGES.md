# SWAI KH-02 V12.3 — Root Cause & Function Changes Audit

**Date:** 2026-10-27T14:49:16.063Z  
**Branch:** `feature/kh02-v12.1.3-runtime-truth-closure`  
**Tested HEAD:** `d0cc3c8b759b26eab803d0db67b346a23f2cfeaf`  
**Status:** Clean Closure

---

## 1. Finding 1: Off-Niche Ads in Pet Gadgets Query (DHgate Dropshipper Catalog Ads)

- **Affected Files & Functions:**
  - `src/services/discovery/metaCollector/metaCollectorMcpClient.ts` (`searchAds`)
  - `src/services/discovery/normalization/normalizeMetaCollectorAd.ts` (`normalizeMetaCollectorAd`)
  - `src/services/kh02/identity/productCandidateDiscovery.ts` (`discoverProductCandidatesFromAds`)
  - `src/services/kh02/identity/productRelevanceEvaluator.ts` (`evaluateProductRelevance`)
- **Root Cause Analysis (4 Tiers):**
  1. *Tier 1 (Upstream Search Arguments):* `searchAds()` used `search_type: "KEYWORD_UNORDERED"`. On Meta Ad Library, this matched an advertiser whose page name was literally *"Gadgets"*.
  2. *Tier 2 (Multi-Creative Normalization):* The seller ran multi-product carousel ads containing 6 items (sunglasses, speaker, shoes, christmas ball, pet seatbelt). The normalizer previously always picked `creatives[0]`, which was sunglasses or speaker, completely ignoring the pet seatbelt creative that caused the ad match.
  3. *Tier 3 (Candidate Grouping):* When storeDomain was absent, candidates were keyed by `unidentified::${source}::${sourceRecordId}`. Two distinct ads from seller "Gadgets" promoting "Sunflower Kids Sunglasses" formed two duplicate cards in the rejected list.
  4. *Tier 4 (Niche Signatures):* Negative controls lacked specific consumer electronics and accessories seen in catalog dropshipping.
- **Changes Applied:**
  - Changed default search_type to `KEYWORD_EXACT_PHRASE` in `metaCollectorMcpClient.ts`.
  - Added multi-creative keyword matching in `normalizeMetaCollectorAd.ts` so the primary creative aligns with the search keyword.
  - Added advertiser-level candidate deduplication in `productCandidateDiscovery.ts` (`advertiser::${advertiser}::${cleanTitle}`) and made candidate IDs strictly deterministic.
  - Added negative controls in `NICHE_SIGNATURES.pet.exclude`: `bluetooth speaker`, `fm radio`, `motorbike`, `dance shoes`, `sunglasses`, `christmas ball`, `pc case cooler`, `jigsaw puzzle`.
- **Test & Runtime Evidence:**
  - `tests/unit/kh02V12_3_ProductIntelligence.test.ts` (Negative controls tests PASS).
  - Runtime: "Sunflower Kids Sunglasses" consolidated to 1 card; all 7 DHgate items classified and rejected cleanly with 0 false-positive winners.

---

## 2. Finding 2: Customer Psychology Template Hallucination

- **Affected File & Functions:**
  - `src/services/kh02/psychology/customerPsychologyService.ts` (`analyzeCustomerPsychology`)
- **Root Cause Analysis:**
  - The fallback engine unconditionally injected candidate title into dog-grooming phrases ("managing high-energy behavior, heavy shedding", "clean entire couch in 30 seconds") even for "Dog bed" or non-pet products.
- **Changes Applied:**
  - Complete overhaul into 6 product archetypes (bedding, hair removal, feeding/fountain, travel safety, audio electronics, footwear/apparel).
  - Minimal inputs (like "Dog bed" without description) no longer output shedding or vacuum claims.
  - Non-pet items produce non-pet functional profiles.
- **Test & Runtime Evidence:**
  - `tests/unit/kh02V12_3_ProductIntelligence.test.ts` (Minimal dog bed & non-pet audio tests PASS).

---

## 3. Finding 3: Google Ads Transparency MCP Method Mismatch

- **Affected File & Functions:**
  - `scripts/kh02/runAcceptanceV12_3.ts`
  - `src/services/kh02/providers/googleTransparencyResearchAdapter.ts`
- **Root Cause Analysis:**
  - Acceptance runner called `googleClient.searchAdvertiser` and `googleClient.getAdvertiserAds` which did not exist on the client interface (actual methods: `searchAdvertiserByDomain`, `getAds`).
  - Parameter mapping used `advertiser.id` instead of `advertiser.advertiser_id`.
- **Changes Applied:**
  - Fixed client calls to `searchAdvertiserByDomain("chewy.com")` and `getAds(advertiser_id, "US")`.
- **Test & Runtime Evidence:**
  - Standalone query returned Chewy, Inc. (advertiser ID: AR01709643824168435713) and 5 live ads from Google Ads Transparency.

---

## 4. Finding 4: Acceptance Runner Multi-Run Patchwork & Literal PASS Shortcuts

- **Affected File & Functions:**
  - `scripts/kh02/runAcceptanceV12_3.ts`
- **Root Cause Analysis:**
  - Previous runner ran 3 separate runs (direct Meta run, direct orchestrator run, browser run) and compared `candidateContainer` with itself (`evaluateGateD07(container, container)`).
  - Contained hardcoded literal `buildPassed = true` and hardcoded test counts (69, 20, 37).
- **Changes Applied:**
  - Unified into a Single-Run Architecture: Browser submits the run on `/products`, worker executes it, and the exact same `acceptedRunId` is read from DB, HTTP API, and DOM.
  - Replaced self-comparison with real `evaluateGateD07(dbSnapshot, httpData)`.
  - Replaced literal PASS with live test executions (`tsc --noEmit`, `lint`, `kh01Security`, `kh02Ownership`).
