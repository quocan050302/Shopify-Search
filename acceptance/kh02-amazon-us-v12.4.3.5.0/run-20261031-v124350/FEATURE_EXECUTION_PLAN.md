# KH-02 V12.4.3.5.0 — Feature Execution Plan (`FEATURE_EXECUTION_PLAN.md`)

- **Repository:** `quocan050302/Shopify-Search`
- **Target Working Branch:** `feature/kh02-amazon-us-pilot-v12.4.3.5.0`
- **Base Branch (`origin/master`):** `c1833362cf6634917f2ff94df19d97c393247d94`
- **Acceptance Output Directory:** `acceptance/kh02-amazon-us-v12.4.3.5.0/run-20261031-v124350/`

## Phases

1. **Phase 0 — Baseline, Branch & Discovery (`PASS`):**
   - Verified `origin/master` at `c1833362cf6634917f2ff94df19d97c393247d94` (PR #6 merged).
   - Created `feature/kh02-amazon-us-pilot-v12.4.3.5.0` from `origin/master`.
   - Mapped actual Product Finder UI (`src/app/products/page.tsx`), API routes (`src/app/api/v1/kh02/research/route.ts`, `src/app/api/v1/research/products/[id]/overview/route.ts`), orchestrator, worker, and persistence services.
2. **Phase 1 — Amazon US Marketplace Adapter & Guarded Contracts:**
   - Implement `marketplaceEvidenceTypes.ts`, `amazonUsIdentity.ts`, `amazonUsBudget.ts`, `amazonUsMcpTransport.ts`, `amazonUsEvidenceAdapter.ts`, `marketplaceEvidencePersistence.ts`, `amazonUsEvidenceGate.ts`.
   - Enforce default flags `KH02_AMAZON_US_ENABLED=false` and `KH02_AMAZON_US_LIVE_ALLOWED=false`, strict SSRF/domain validation, ASIN structural provenance, variation identity preservation, and HTML/JSON-LD prompt-injection sanitization.
3. **Phase 2 — KH-02 Pipeline, Worker, Persistence, API & UI Integration:**
   - Integrate optional enrichment into `runEvergreenProductResearch()`, `kh02Worker.ts`, `kh02PersistenceService.ts`, API routes, `productFinderViewModel.ts`, and `src/app/products/page.tsx`.
   - Ensure zero score weight or G15/G16 inflation from Amazon listings, and preserve legacy behavior when feature flag is OFF.
4. **Phase 3 — Function-Level Acceptance Tests (`A01`–`A30`) & Negative Controls (`>=20` Mutants):**
   - Implement unit and integration suites covering `A01`–`A30`.
   - Implement `validateAmazonUsPilotAcceptanceArtifacts()` with 24 adversarial mutation tests (`AMZ_MUT_01..AMZ_MUT_24`).
5. **Phase 4 — Freeze `CODE_SHA` & Execute Full Bounded Acceptance Wave:**
   - Commit source and tests (`CODE_SHA`).
   - Run full regression (`476+` baseline + new Amazon unit tests), integration suites (`18+` tests), fresh `next build`, isolated Next server + Chromium 3-way parity (`SQLite <-> HTTP GET <-> Chromium DOM`), read-only HTTP non-mutation check, real Playwright MCP handshake, historical DEV/HOLDOUT backtest with post-cutoff Amazon lookahead exclusion, and independent validator + negative control suite.
6. **Phase 5 — Evidence Commit & Push:**
   - Commit scrubbed acceptance artifacts (`EVIDENCE_COMMIT_SHA`) and push `feature/kh02-amazon-us-pilot-v12.4.3.5.0` to `origin`.

