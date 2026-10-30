# SWAI KH-02 V12.3 — Root Cause Analysis Report

## 1. False-Positive Product Identity Classifications
- **Root Cause:** The baseline classifier relied on negative regex matching for CTAs and raw Ad IDs. Any string that did not contain promotional keywords like "buy now" or a 15-digit ID was defaulted to `PRODUCT_CANDIDATE` with high confidence (0.92).
- **Impact:** Editorial hooks like "Hidden Dangers", ad campaign codes like "Ad50fb", and warehouse SKUs like "Wmt004 1" appeared as winning products in the user interface.
- **Closure:** Replaced default fall-through with positive noun taxonomy validation (`containsKnownProductNoun`), model extraction (`Gg002 L1`), and campaign code isolation.

## 2. TikTok Active Source Blocker False-Pass
- **Root Cause:** Proactively disabling TikTok in previous releases was implemented as a client-side filter, causing server-side health checks and acceptance gates to still probe HasData / TikTok cookies and report `BLOCKED` or `CREDENTIALS_REQUIRED`.
- **Closure:** Centralized server-side source policy in `sourcePolicy.ts`. TikTok yields `TEMPORARILY_DISABLED`, 0 outbound calls, 0 quota checks, and 0 credential requirements.

## 3. Synthetic Browser Ranks & Reload Reconciliation Bypasses
- **Root Cause:** Browser test harness synthesized `renderedCards.rank = idx + 1` instead of extracting actual DOM attributes. Furthermore, reload reconciliation only verified `score`, ignoring mutations in `confidence` and `rank`.
- **Closure:** Browser harness now directly extracts `data-rank`, `data-opportunity-score`, and `data-confidence` from DOM cards. Reload verification asserts exact match across all three attributes.
