# SWAI KH-02 V12.1.1 — CODE CHANGE REPORT

**Version:** KH-02 V12.1.1  
**Generated At:** 2026-10-26T06:21:18.978Z  

### 1. Key Changed Files & Modules

1. **`src/services/kh02/providers/googleTransparencyResearchAdapter.ts`**
   - **Pre-existing issue:** Hard-coded tool names without schema-driven validation.
   - **Resolution:** Added `discoverGoogleAdsMcpCapabilities`, `validateGoogleMcpToolArguments`, `invokeGoogleMcpTool`, and `normalizeGoogleAdsResponse` with strict delivery market checking.

2. **`src/services/kh02/providers/metaResearchAdapter.ts`**
   - **Pre-existing issue:** Implicitly defaulted delivery market to `"US"`.
   - **Resolution:** Added `resolveMetaMarketProvenance` to strictly separate query requested market from verified provider delivery market.

3. **`src/services/kh02/demand/temporalDemandEngine.ts`**
   - **Pre-existing issue:** Potential false VERIFIED state without sufficient distinct temporal observations.
   - **Resolution:** Added `evaluateDemandHistoryEvidence` enforcing multi-point verification, distinct observation dates, and exact missing evidence reporting.

4. **`src/services/kh02/providers/hasDataCreditService.ts`**
   - **Pre-existing issue:** Lacked authoritative credit inspection and quota verification.
   - **Resolution:** Created comprehensive credit authority service with `fetchHasDataCreditStatus`, `evaluateHasDataQuota`, and `reconcileHasDataUsage`.

5. **`src/services/kh02/providers/tiktokOrganicResearchAdapter.ts`**
   - **Pre-existing issue:** Conflated Organic search with Paid Ads; needed fail-safe metric and quota handling.
   - **Resolution:** Added `resolveTikTokCapabilities` and `collectTikTokOrganicEvidence` integrating with `hasDataCreditService`.

6. **`src/workers/kh02Worker.ts`**
   - **Pre-existing issue:** Research ran synchronously inside HTTP POST without durable worker execution.
   - **Resolution:** Created dedicated background worker supporting atomic claims, fencing tokens, lease renewals, retry classification, and stale job recovery.

7. **`src/services/kh02/persistence/kh02PersistenceService.ts`**
   - **Pre-existing issue:** Lacked provenance validation, product card tracing, and cross-layer reconciliation.
   - **Resolution:** Added `validateResearchProvenance`, `buildObservationIdentity`, `traceProductCardEvidence`, and `reconcileResearchAcrossLayers`.

8. **`src/app/api/v1/kh02/research/route.ts` & `src/app/products/page.tsx`**
   - **Pre-existing issue:** Synchronous blocking POST.
   - **Resolution:** Supported HTTP 202 accepted-job creation with durable polling in UI and synchronous backwards compatibility.

9. **`tests/unit/kh02V12_1_1_Runtime.test.ts` & `tests/integration/kh02BrowserAcceptance.test.ts`**
   - **New test suites:** 21 additional automated unit, integration, and Playwright Chromium tests.
