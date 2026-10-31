# SWAI KH-02 V12.4.2 — Baseline Failure Reproduction

## Observed Localhost Run (`kh02_run_1793178825461_s4pfb`)
- **Topic:** `diy`
- **Market:** `US`
- **Lookback:** `180D`
- **Raw Candidate Groups:** `10`
- **Relevance-Eligible Groups:** `5`
- **Candidates Scored:** `6`
- **Research Shortlist:** `0/3`

## Confirmed Root Causes
1. **Unrecognized Broad Niche in Query Planner:** `discoveryQueryPlanner.ts` only defined templates for `pet`, `beauty`, `cleaning`, and `kitchen`. For `diy`, it fell back to a single generic exact-phrase query (`"diy"`), retrieving noisy B2B (`Hot Sell 80mm POS Thermal Printer`, `get latest price`), mobile app (`iControl Easy Widgets Themes`), and seasonal slogan (`Get Halloween ready`) ads.
2. **Literal Keyword Early Rejection:** `productRelevanceEvaluator.ts` required the literal token `"diy"` for unrecognized topics, prematurely rejecting `Multicolor Rose Floral Pattern Switch Sticker` (`Decorative Light Switch Covers`) before Gemini semantic evaluation.
3. **In-Place Candidate Funnel Mutation:** `evergreenResearchOrchestrator.ts` mutated `rawCandidates` in place after Gemini AI classification, causing `candidateFunnel` to report `5 relevance-eligible` alongside `6 scored`.
