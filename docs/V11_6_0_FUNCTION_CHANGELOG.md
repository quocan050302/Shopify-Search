# SWAI V11.6.0 — Function-Level Changelog

## 1. Overview
Version V11.6.0 validates live Meta Ad Library collection through the local Python `MetaAdsCollector` MCP server, establishes factual upstream provenance tracking, introduces an authoritative source inspection helper, and provides a dedicated end-to-end user-journey verification script without breaking any existing V11.5.9.1 flow.

---

## 2. Modified & Added Functions

### `src/services/discovery/providers/metaAdsCollectorProvider.ts`
* **`discoverPage(query, cursor)`**:
  - Replaced static assignments `const upstreamReq = true; const upstreamResp = rawAds.length > 0;` with authoritative provenance computation.
  - Inspects `mcpResponse.job?.stats` and `continueRes.job?.stats` to verify `requests_made > 0` before setting `upstreamRequestExecuted = true`.
  - Verifies `ads_collected > 0 || rawAds.length > 0` under active upstream execution before setting `upstreamResponseObserved = true`.
  - Ensures `isFixture` strictly enforces `upstreamRequestExecuted = false` and `upstreamResponseObserved = false`.
  - Identifies stored-result reads (`cursorPayload.mode === "stored"`) as local cache reads, preventing false attribution as a live upstream network request on that step.

### `src/services/discovery/metaCollector/inspectLiveMetaSource.ts`
* **`inspectLiveMetaSourceResult(input: InspectLiveMetaSourceInput): LiveSourceInspection`**:
  - Implements the Section 09 diagnostic specification.
  - Authoritatively checks transport mode, MCP tool stats (`requests_made`, `ads_collected`), Meta Library numeric format (`/^\d{5,25}$/`), duplicate IDs, advertiser provenance, and canonical source URLs.
  - Classifies source provenance as `REAL_UPSTREAM`, `TEST_FIXTURE`, or `UNKNOWN`.
  - Evaluates error categories (`BLOCKED`, `RATE_LIMITED`, `FAILED`, `NO_RESULTS`, `PASSED`).

### `src/services/discovery/metaCollector/metaCollectorTypes.ts`
* **`MetaCollectorJobState`**:
  - Added optional known typing for `stats` (`requests_made?: number`, `ads_collected?: number`, `pages_fetched?: number`, etc.) while preserving index signature `[key: string]: unknown` for total backward compatibility.

### `tests/e2e/helpers/startSwaiTestServer.ts`
* **`startSwaiTestServer(options: SwaiTestServerOptions)`**:
  - Ensured `serverEnv.ADMIN_API_KEY` is configured when `options.adminApiKey` is provided in conjunction with `allowLocalBypass: true`.

### `scripts/meta-live-journey.ts`
* **`runMetaLiveJourney(options: JourneyOptions)`**:
  - Implements the Section 12 end-to-end verification orchestration script.
  - Verifies environment readiness, performs read-only source probe, creates isolated SQLite test database, starts loopback Next.js test server, starts real Discovery Worker subprocess, submits research request through `POST /api/v1/discovery/meta/requests`, waits for completion, verifies Prisma database persistence, validates exact-run HTTP readback, renders in Chromium with Playwright, and exports complete evidence bundle to `artifacts/v11.6.0/<runId>/`.

### `tests/unit/inspectLiveMetaSource.test.ts`
* Added unit test suite verifying `inspectLiveMetaSourceResult` across genuine live records, fixture transports, empty queries, upstream blocks/rate limits, and malformed IDs.

### `package.json`
* Added `"meta:journey": "tsx scripts/meta-live-journey.ts"` script.

---

## 3. Protected Contracts Retained Unchanged
* `getMetaCollectorConfig()` — Unchanged.
* `createMetaCollectorClient()` — Unchanged.
* `getCapabilities()` — Unchanged.
* `searchAds()` — Unchanged.
* `continueSearch()` — Unchanged.
* `getProviderConfigurationStatus()` — Unchanged.
* `checkAvailability()` — Unchanged.
* `verifyProviderConnection()` — Unchanged.
* `createDiscoveryJob()` — Unchanged.
* `claimPendingDiscoveryJob()` — Unchanged.
* `executeDiscoveryJob()` — Unchanged.
* `ingestDiscoveredAds()` — Unchanged.
* `startDiscoveryWorker()` — Unchanged.
* `processDueSchedulesOnce()` — Unchanged.
* `verifyLiveMetaSource()` — Unchanged.
* `executeLiveResearchThroughWorker()` — Unchanged.
* `verifyLivePersistence()` — Unchanged.
* `verifyExactRunHttpReadback()` — Unchanged.
* `verifyExactRunBrowserReadback()` — Unchanged.
* Prisma schema (`prisma/schema.prisma`) — Zero migrations, zero schema changes.
