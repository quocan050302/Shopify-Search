# Local Google Trends workflow — implementation and live verification

Source commit: `aa0f1fc3b8fdfe4c9065125f0c5732747f28ebcf`, locked branch `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`.

**Delivered:** a free official-CSV workflow in the actual local app at http://localhost:3022/products/trends. Product Finder links to it. File selection automatically validates exact query/US scope, persists immutable raw bytes and completed observations, reads the DB back, and computes the existing G15/G16 product checks. Re-evaluation works from a durable receipt without a new provider request. No schema migration, source authority change or leaderboard promotion was introduced.

**Not delivered:** unattended acquisition from Google. Direct retrieval of Google's robots.txt on 2026-11-08 shows `Disallow: /explore?` and `Disallow: /trends/explore?`. The supported export is user-assisted. The official Alpha API remains gated with no demonstrated project entitlement. No protected endpoint, pytrends, paid API, proxy, quota bypass or CAPTCHA workaround was introduced. The API and UI disclose this limitation.

## Actual app and evidence

The original checkout was found at `/Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search`, on the locked branch. The actual DB had 121 products, eight workspaces and six demand rows; the initially inspected audit checkout was a separate sparse checkout with no active application database. Original .env files and keys were preserved. The actual app DB was backed up using SQLite online backup before live import; no database backup or credentials are committed.

Live UI upload used the genuine official feeder export acquired in the earlier same-day audit, SHA-256 `6fdfd217947b224e991b86dd1cce9b9c3f30e0925c8efce55b5e2e19452d57c6`. It was bound to the existing ad-backed UAHPET product `cand_453563126` in its existing authorized workspace. The orphan canonical-looking product row was not silently reassigned to another workspace.

The running app displayed **53 inserted, 0 already stored, 1 incomplete period excluded**. Independent SQLite and HTTP readback confirm 53 new rows, 59 total demand rows, and the six pre-existing rows preserved. Completed period starts span 2025-11-02 to 2026-11-01, 364 elapsed days. The original file remains byte-identical in the app's content-addressed ingestion store. This is a real local UI→HTTP→DB→G15/G16 execution, distinct from fixture tests.

## Gate verdicts

**G15 UNVERIFIED; G16 not eligible; RELEASE_HOLD.** No approval record exists for the file. The existing product has an advertising tagline as its DB title and lacks sufficient independently verified identity/term-alias evidence. The selected refrigerated-feeder query is not silently treated as an approved alias for that title. The sparse series also fails the scored stability/qualification checks. The workflow never turns a submitted URL, CSV header, product row or local hash into Google's signature or verified sales.

G15's existing minimum remains 60 covered calendar days and three observations plus authority, attribution, cadence/coverage and other validity checks. G16 is presented as a single-product re-evaluation, not a newly published distinct Top 3. To advance qualification, an already authorized reviewer must establish the product identity and query attribution and approve the acquisition under the existing durable authority rules. No principals, keys, approvals or aliases were generated.

## Validation

- Full KH-02 unit: 109 files / 2,614 tests passed.
- Full KH-02 integration: 17 files / 91 tests passed, including 14 new workflow cases.
- TypeScript, Prisma validation, KH-01 regression, DB diagnostic, test-mode MCP smoke and production compilation passed locally.
- Backtest policy and point-in-time integrity passed; actual historical DEV/HOLDOUT business evidence remains insufficient. Local source snapshot contains 60 DEV and 377 HOLDOUT ad records. New November 8 imports are not backdated into October cutoffs.
- Initial sparse-checkout missing-file failures, the new route's cacheComponents/runtime export build failure, and a loopback origin normalization defect were recorded and resolved. Existing tracked engineering fixtures/acceptance/workflow files were restored rather than fabricating provider data. Build and regression status is separate from business evidence.
- The resource runner bounded commands, Node heap and disk use. Local tests used one top-level Vitest worker. During one wave two lightweight test processes overlapped briefly; no more than two top-level workers ran concurrently. No paid provider call or production worker/deployment was started. One loopback-only Next dev server is intentionally left running for the user.

Local dev startup required Node 22 in PATH for child compilers and regeneration of the dev cache created by a failed Node 14 child process. Source dependencies were already installed; no duplicate node_modules or global Node configuration was changed. A source build is validated separately from local dev startup.

## CI and reproducibility

GitHub Actions run for the exact source commit: https://github.com/quocan050302/Shopify-Search/actions/runs/42484515004 . Final job outcomes are recorded in CI_EXACT_SHA.json. The six published source files match TESTED_SOURCE_CONTENT.json. Reports are committed separately after CI verification, and reports-only commits do not rerun the workflow.

Local historical inputs are a copy of the actual app's DB; CI uses its own controlled setup. Matching input fingerprints or historical business parity are not claimed. Backtest fingerprint/cutoff details are preserved under backtest/. A passing CI policy job does not prove market demand or winning products.

The local app source is updated by a verified fast-forward on the same branch; the browser/API and raw DB outputs are retained. To restart on this machine, use Node 22 in PATH and the existing app's local startup command; do not enable its discovery/AI workers merely to import a CSV.

**Cost:** $0 paid data/API charges. **Remaining acquisition step:** the user downloads Google's official CSV. **Automatic after selection:** raw validation, DB storage/readback, G15/G16 evaluation. **Eligible winners from this pilot:** zero.
