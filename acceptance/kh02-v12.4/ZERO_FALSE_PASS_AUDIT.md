# SWAI KH-02 V12.4 — Zero False-Pass Audit

## Audit Findings & Defect Closures
1. **Critical False-Positive Closure:** Eliminated the "ER Vet bill cost factors" regression. Rule-based keyword matching previously allowed it into the shortlist because it contained "pet". Hybrid AI now classifies it as `INFORMATIONAL_CONTENT` (`isLikelySellableProduct: false`), and `selectTopResearchShortlist` strictly excludes it.
2. **Dynamic Gemini Discovery & Model Routing:** Never hardcodes a single Gemini model. Discovered active models via official `ai.models.list()`. Discovered that `gemini-2.5-flash` is discontinued (HTTP 404), while `gemini-3.7-flash` and `gemini-3.6-flash` are active and high-performing.
3. **1 Initial + Max 3 Retries (4 attempts total):** Verified by fault-injection test `G04_GEMINI_RETRY_LIMIT_ENFORCED` that 503 transient errors trigger exactly 1 initial + 3 exponential backoff retries before attempting model downgrade.
4. **Automatic Model Downgrade:** Verified by fault-injection test `G05_GEMINI_MODEL_DOWNGRADE_WORKS` that when primary model retries are exhausted, the router automatically fails over to the next eligible ranked model.
5. **Product Reality Gate:** Verified that external ad text or merchant copy cannot use prompt injection to fabricate a verified product identity. Independent merchant evidence and source citations are strictly checked.
6. **Strict Scoring Integrity:** Evergreen qualification thresholds (Opportunity Score >= 65, Confidence >= 65%, Stability >= 15/25) remain unaltered.
