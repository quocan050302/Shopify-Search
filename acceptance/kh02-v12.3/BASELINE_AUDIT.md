# SWAI KH-02 V12.3 — Baseline Audit & Integrity Findings

**Release:** KH-02 V12.3 — Facebook & Google Product Intelligence  
**Working Branch:** `feature/kh02-v12.1.3-runtime-truth-closure`  
**Starting SHA:** `28c184c9032ff4a436cd100cf980f26a24380216`  
**Tested HEAD:** `28c184c9032ff4a436cd100cf980f26a24380216`  
**Audit Timestamp:** 2026-10-27T13:28:22.372Z  

## 1. Baseline Finding Summary & Resolutions

| # | Finding & File | Status at Baseline | Root Cause | Fix Applied | Test Verification |
|---|----------------|-------------------|------------|-------------|-------------------|
| 1 | `adHeadlineClassifier.ts` | Clickbait hooks ("Hidden Dangers") and codes ("Ad50fb", "Wmt004 1") classified as PRODUCT_CANDIDATE (conf: 0.92) | Regex checked only CTA/ID; non-matching strings fell through to product candidate | Complete taxonomy rewrite with concrete product noun validation, code extraction, and model extraction | `kh02V12_3_ProductIntelligence.test.ts` (7 identity tests PASS) |
| 2 | `productIdentityResolver.ts` | Shopify URL slug `/products/ad50fb` resolved to verified product | URL path structure was treated as verified name without slug validation | 7-level resolution hierarchy rejecting campaign slugs and prioritizing descriptive ad copy | `kh02V12_3_ProductIntelligence.test.ts` |
| 3 | `sourceRegistry.ts` | TikTok Ads/Organic marked as failed or missing keys | Proactively disabled sources were evaluated for connection/credentials | Centralized `sourcePolicy.ts` setting status to `TEMPORARILY_DISABLED` with 0 outbound calls | `kh02V12_3_ProductIntelligence.test.ts` |
| 4 | `customerPsychologyService.ts` | Missing psychological analysis | No customer psychology module existed | Created 12-pillar grounded psychology service with OBSERVED/INFERRED/HYPOTHESIS labels | `kh02V12_3_ProductIntelligence.test.ts` |
| 5 | `evergreenResearchOrchestrator.ts` | Top 3 allowed duplicate products or forced 3 items | Ranking promoted items by raw score without deduplicating canonical identities | Deduplicated canonical names in Top 3, allowing 0-3 distinct products, provisional marked with `rank: null` | `kh02V12_3_ProductIntelligence.test.ts` |
| 6 | `runAcceptanceV12_2_4.ts` Case 1-10 | 10 baseline false-pass cases | Unaudited traces, run ID mismatches, and synthetic DOM ranks bypassed validators | Enforced exact checks on audited traces, canonical run IDs, and actual DOM attributes | `kh02ReleaseGatesAndReconciliation.test.ts` (37/37 PASS) |
