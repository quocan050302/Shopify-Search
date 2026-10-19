# SWAI V7.2 — Gemini Connection & Real Video Analysis Repair Report

**Date**: 2026-10-19  
**Branch**: `master`  
**Repository**: `https://github.com/quocan050302/Shopify-Search.git`  
**Baseline Commit**: `aa481834edf86eb67cee10d9aa999313141b5a3b`  
**Version**: SWAI V7.2  

---

## 1. Executive Summary & Problem Root Cause

In prior versions of SWAI, configuring a valid Google Gemini API key led to runtime failures (`[404 Not Found] models/gemini-1.5-flash-002 is not found for API version v1beta, or is not supported for generateContent`). The application:
1. Relied on hardcoded, deprecated model lists (`gemini-1.5-flash-002`, `gemini-1.5-pro-002`, `gemini-2.0-flash`) without dynamic discovery.
2. Lacked active execution verification—assuming a model present in `ListModels` could be invoked without running a live `generateContent` probe.
3. Allowed text-only connection verification to falsely imply verified video analysis capability.
4. Attempted to pass arbitrary third-party web page URLs (e.g. TikTok video page URLs) directly into Gemini `fileData.fileUri`, which Google Gemini rejects (Gemini requires file URIs created via the Google AI Files API).
5. Lacked administrative authentication checks and secret sanitization on credential testing and management endpoints.

SWAI V7.2 resolves all of these issues with a resilient architecture for model discovery, live generation testing, real video processing via the Gemini Files API, and strict multi-tier security.

---

## 2. Modified & Created Files and Functions

### A. Created Modules

1. **[`src/services/ai/geminiModelService.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/ai/geminiModelService.ts)**
   - `discoverAvailableGeminiModels(apiKey)`: Queries Google Gemini `models` endpoint across `v1` and `v1beta` with documented pagination (`nextPageToken`) and filters by `supportedGenerationMethods.includes("generateContent")`.
   - `verifyGeminiTextGeneration(apiKey, modelId, apiVersion)`: Performs an authenticated text generation probe (`x-goog-api-key` header) to verify that the model can genuinely execute requests.
   - `resolveAndVerifyActiveModel(apiKey, preferredModel)`: Evaluates candidate models in order (`preferredModel` -> `gemini-3.8-flash` -> `gemini-3.7-flash` -> `gemini-3.6-flash` -> `gemini-3.5-flash` -> available discovered models) and verifies live generation before selecting the active model.
   - `classifyGeminiError(error, rawMessage)`: Categorizes API errors into precise error codes: `INVALID_API_KEY`, `MODEL_NOT_AVAILABLE`, `PERMISSION_DENIED`, `QUOTA_EXCEEDED`, `RATE_LIMITED`, `API_VERSION_UNSUPPORTED`, `NETWORK_ERROR`, and `GENERATION_FAILED`.
   - `redactSecrets(text)`: Redacts API keys (`AIzaSy...`, `AQ....`, `EAA...`) from logs, error messages, and API responses.
   - `cacheVerifiedModel(model, apiVersion)` & `getActiveVerifiedModel()`: Persists the verified model identifier and API version.

2. **[`src/services/ai/geminiFilesService.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/ai/geminiFilesService.ts)**
   - `validateVideoForGeminiAnalysis(videoRef)`: Distinguishes between local uploaded files (`/uploads/...`), direct MP4/WebM video streams, and arbitrary TikTok/Meta web page URLs. Rejects web page URLs with actionable guidance.
   - `uploadVideoToGeminiFiles(videoRef, apiKey)`: Uploads supported MP4/WebM video files to the Gemini Files API using `GoogleAIFileManager`, polls until state is `ACTIVE` (or throws on `FAILED`), returns valid `fileUri`, and provides a cleanup hook to remove uploaded files.
   - `markVideoAnalysisVerified(modelId)`: Records verified video capability only when a real video upload/analysis succeeds.

3. **[`src/services/security/adminAuth.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/security/adminAuth.ts)**
   - `validateAdminRequest(request)`: Enforces administrator authorization via `x-admin-token`, `Authorization: Bearer <token>`, or session cookies.
   - `requireAdminAuth(request)`: Helper returning a 401 Unauthorized `NextResponse` if authorization fails.

4. **[`tests/unit/geminiV72.test.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/tests/unit/geminiV72.test.ts)**
   - Comprehensive test suite covering requirements 66–80 (missing key, invalid key, unavailable model, ListModels pagination, live generation, fallback chain, quota exceeded, Files API upload/poll/cleanup, admin auth).

### B. Modified Modules

1. **[`src/services/ai/geminiAdapter.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/ai/geminiAdapter.ts)**
   - Removed obsolete hardcoded model strings (`gemini-1.5-flash-002`, `gemini-1.5-pro-002`).
   - Integrated `geminiModelService` for dynamic model resolution.
   - Integrated `geminiFilesService` for video analysis in `analyzeOpeningHook()`, `analyzeVideoWithGemini()`, and `extractCreativeSellingAngles()`.
   - Returns actual model ID used, timestamp evidence, prompt versions, and source video attribution.

2. **[`src/services/credentials/credentialService.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/services/credentials/credentialService.ts)**
   - Updated `testGeminiConnection()` to use `resolveAndVerifyActiveModel()`.
   - Separates capability verification: marks text generation `VERIFIED` while keeping video analysis `REQUIRES_AUTH` until a real video file is analyzed.
   - Added `rotateCredential()` to safely replace exposed or rotated keys.
   - Redacts secrets from error messages and logs.

3. **[`src/components/settings/ApiConnectionsManager.tsx`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/components/settings/ApiConnectionsManager.tsx)**
   - Displays Connected Model and API version badges in real time.
   - Displays Evaluated Candidate Models provenance (showing tested models and fallback status).
   - Dynamic button label: "Retest Connection" for saved credentials vs "Test Connection" for unsaved keys.
   - Added Key Rotation guidance directly in the settings UI.

4. **[`src/app/api/v1/settings/credentials/route.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/app/api/v1/settings/credentials/route.ts)**
   - Protected `POST` and `DELETE` endpoints with `requireAdminAuth()`.
   - Added secret redaction to all error and response flows.

5. **[`src/app/api/v1/settings/credentials/test/route.ts`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/app/api/v1/settings/credentials/test/route.ts)**
   - Protected `POST` endpoint with `requireAdminAuth()`.
   - Redacts secrets from test failure messages.

6. **[`package.json`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/package.json)**
   - Installed `@google/genai` (2.30.0).

7. **[`vitest.config.mjs`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/vitest.config.mjs)**
   - Set `fileParallelism: false` to eliminate SQLite file locking during parallel test execution.

---

## 3. Real API Verification & Model Findings

Live API inspection with the authorized Gemini key revealed:
- **Deprecated Models**: `gemini-1.5-flash-002`, `gemini-1.5-pro-002`, `gemini-2.0-flash`, `gemini-2.5-flash` returned HTTP 404 ("models/... is not found for API version v1beta, or is not supported for generateContent. Call ModelService.ListModels..."). Specifically, `gemini-2.5-flash` returned: *"models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash"*.
- **High-Demand Spike**: `gemini-3.8-flash`, `gemini-3.7-flash`, and `gemini-3.6-flash` returned HTTP 503 ("This model is currently experiencing high demand. Please try again later.").
- **Active & Stable Model**: `gemini-3.5-flash` returned HTTP 200 OK immediately with high responsiveness (<400ms latency) on both `v1` and `v1beta`.
- **Model Fallback**: The unified model service successfully navigated the priority candidate chain, evaluated candidates safely without crashing, and locked onto `gemini-3.5-flash` as the active verified model.
- **Files API Verification**: Test MP4 uploads to `https://generativelanguage.googleapis.com/upload/v1beta/files` via `GoogleAIFileManager` succeeded with state `ACTIVE`, and file deletion cleaned up resources cleanly.

---

## 4. Test Matrix & Verification Results

### Unit & Integration Tests (Vitest)
```
Test Files  10 passed (10)
     Tests  140 passed (140)
  Duration  2.30s
```
Covered test suites:
- `tests/unit/geminiV72.test.ts` (26 tests):
  - Missing API key classification (`INVALID_API_KEY`)
  - Invalid API key HTTP 400 (`INVALID_API_KEY`)
  - Model not available HTTP 404 (`MODEL_NOT_AVAILABLE`)
  - Model list pagination with `nextPageToken`
  - Successful `generateContent` probe
  - Candidate fallback chain (`gemini-3.8-flash` -> `gemini-3.5-flash`)
  - Quota exhaustion HTTP 429 (`QUOTA_EXCEEDED`)
  - Permission denied HTTP 403 (`PERMISSION_DENIED`)
  - Unsupported API version classification
  - Files API video eligibility check
  - Rejection of TikTok web pages as direct video references
  - Local MP4 file validation
  - Video processing error handling
  - Model ID provenance in adapter outputs
  - Timestamp evidence in video analysis
  - Secret redaction from error messages
  - Admin authentication on Settings APIs
- `tests/unit/credentials.test.ts` (20 tests)
- `tests/unit/adService.test.ts` (4 tests)
- `tests/unit/db.test.ts` (1 test)
- `tests/unit/evergreen.test.ts` (31 tests)
- `tests/unit/financial.test.ts` (5 tests)
- `tests/unit/scoring.test.ts` (3 tests)
- `tests/unit/security.test.ts` (6 tests)
- `tests/unit/v71.test.ts` (39 tests)
- `tests/integration/api.test.ts` (5 tests)

### TypeScript Typecheck
```
$ npx tsc --noEmit
Passed (0 errors)
```

### Production Build
```
$ npm run build
✓ Compiled successfully in 645ms
✓ Finished TypeScript in 1795ms
✓ Generating static pages using 7 workers (28/28)
Finalizing page optimization
Route (app): 28 routes compiled and optimized cleanly.
```

### Security Verifications
1. `.env.local` and `.env` are verified in `.gitignore`.
2. No API keys appear in URL query parameters; all Gemini calls use `x-goog-api-key` header.
3. Raw error messages sanitized via `redactSecrets()`.
4. Credential endpoints protected by `requireAdminAuth()`.
5. Frontend renders only masked keys (e.g. `AQ.Ab8...ZkQ`).

---

## 5. Operating Mode Adherence

- **Mode**: `RESEARCH_ONLY` preserved.
- **Shopify Status**: `NOT_CONNECTED` preserved.
- **APP #1**: Unmodified.
