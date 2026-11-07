# KH-02 V12.4.3.7.19.3.2.9 — Workflow YAML, Required Jobs & Cost Audit

## 1. Canonical Workflow File Identity
- **Workflow File Path**: `.github/workflows/kh02-ci.yml`
- **Workflow File SHA-256 (at `C1 = cbc2eddfad582800f4bc26c9691216e413ab0666`)**: `8183d7366720cbbb3cf21df89da1480f12094c671bd3a1da3d701fca9131588f`
- **GitHub Actions Registered Workflow ID**: `410038523` (`state: "active"`, `name: "KH-02 Continuous Integration"`)
- **Single Canonical Policy Constant**: `CANONICAL_WORKFLOW_PATHS = Object.freeze([".github/workflows/kh02-ci.yml"])`

## 2. Security, Permissions, Triggers & Zero-Cost Controls
- **Triggers (`on`)**:
  - `push.branches`: `["feature/kh02-walmart-us-jina-reader-v12.4.3.5.1"]`
  - `push.paths-ignore`: `["reports/kh02/**"]`
  - `workflow_dispatch`: enabled for manual bounded verification
- **Least-Privilege `permissions`**:
  - `contents: read`
  - `actions: read`
  - No `write-all` or elevated token scopes.
- **Full-Length 40-Hex Commit SHA Pinning for Actions**:
  - `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683`
  - `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`
- **Zero-Cost Public Repository Guard**:
  - Every job declares `if: github.repository_visibility == 'public'` and `runs-on: ubuntu-24.04`.
  - No paid external APIs (Meta Ad Library live token, SerpAPI, HasData, BigQuery, Apify, OpenAI/Gemini live calls) are invoked in CI.
- **No `continue-on-error` Masking**:
  - `continue-on-error: true` is completely absent across all jobs and steps.

## 3. Mandatory Required Jobs & Bounded Wave Topology
`CANONICAL_REQUIRED_JOBS` enforces all 6 jobs across 3 bounded waves (`<= 2` concurrent jobs per wave):

| Wave | Job ID & Name | `needs` | Timeout | Executed Command(s) | Live Run `42338996172` Job ID & Outcome |
|---|---|---|---|---|---|
| Wave 1 | `typecheck` | `[]` | 10 min | `npx tsc --noEmit` + `npx tsx scripts/kh02/verifyWorkflowContractV19_3_2_9.ts` | `128302260860` (`completed` / `success`) |
| Wave 1 | `security-negative` | `[]` | 12 min | `npx vitest run tests/unit/kh02ProductMetadataSecurity.test.ts ... v12_4_3_7_19_3_2_9_RealGithubCiAndRequiredJobsProof.test.ts` | `128302260625` (`completed` / `success`) |
| Wave 2 | `kh02-unit` | `["typecheck", "security-negative"]` | 15 min | `npm run kh02:test:unit -- --maxWorkers=2` | `128302472270` (`completed` / `success`) |
| Wave 2 | `kh01-regression` | `["typecheck", "security-negative"]` | 10 min | `npm run kh01:verify` | `128302472249` (`completed` / `success`) |
| Wave 3 | `kh02-integration` | `["kh02-unit", "kh01-regression"]` | 15 min | `npx vitest run tests/integration/kh02 --no-file-parallelism` | `128303367230` (`completed` / `success`) |
| Wave 3 | `backtest-policy` | `["kh02-unit", "kh01-regression"]` | 12 min | `npx tsx scripts/kh02/runBacktestV12_4_3_4_2.ts` + `npx tsx scripts/kh02/runCandidateDbReadback.ts` | `128303367239` (`completed` / `success`) |
