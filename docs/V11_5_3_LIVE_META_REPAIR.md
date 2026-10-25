# SWAI V11.5.3 — Live Meta Verification & Evidence Integrity Architecture
**Specification Protocol:** KH-01  
**Target Release:** V11.5.3  
**Audited Baseline SHA:** `ec291b06c0b7841fe8d28157d02582ce2844c58c`  
**Market Context:** United States (`RESEARCH_ONLY`)

---

## 1. Defect Analysis: BUG-01 in V11.5.2

In SWAI V11.5.2, `verifyLiveMetaSource(options)` in `scripts/kh01/runFullAcceptance.ts` contained an integrity flaw:

```typescript
// Previous flawed implementation in V11.5.2:
const searchRes = await client.searchAds(...);
if (searchRes.ads.length > 0) {
  levelsVerified.push("ADS_COLLECTED");
  levelsVerified.push("ADS_PERSISTED");
  levelsVerified.push("RUN_RECONCILED");
  retrievedCount = searchRes.ads.length;
  validCount = searchRes.ads.length;
  linkedCount = searchRes.ads.length;
  displayedCount = searchRes.ads.length;
}
```

### Why This Logic Was Unacceptable
1. **MCP Connection != Database Persistence**: An MCP search call returning JSON advertisements over stdio/HTTP does not prove that those ads were validated, transformed, or successfully written to SQLite.
2. **Persistence != Association**: A row in `CompetitorAd` does not prove that the relational association in `DiscoveryRunAd` exists or that the foreign keys match the current research run.
3. **Association != API Readback**: Data in SQLite does not prove that Next.js API routes (`/api/v1/discovery/meta/requests/[id]/ads`) can serialize, filter, paginate, and authenticate the response over TCP.
4. **API != Browser Rendering**: An API JSON payload does not prove that the React/Playwright browser explorer renders the cards without dropping older ads or crashing during client-side hydration.

---

## 2. The Multi-Stage Truthful Verification Architecture

In V11.5.3, `verifyLiveMetaSource()` is completely rebuilt around a sequential, non-preemptive verification pipeline:

```
[ LIVE META SOURCE (OPT-IN) ]
            │
            ▼
[ Stage 1: MCP Connectivity Probe ]
            │ (Fails -> MCP_UNAVAILABLE)
            ▼
[ Stage 2: Actual Ad Collection ]
            │ (Fails -> RATE_LIMITED / BLOCKED_SOURCE / NO_VALID_ADS)
            ▼
[ Stage 3: Ingestion & Normalization ]
            │ (Levels: ADS_COLLECTED)
            ▼
[ Stage 4: Isolated Test DB Persistence ]
            │ (Fails -> PERSISTENCE_FAILED)
            │ (Levels: ADS_PERSISTED)
            ▼
[ Stage 5: Database Arithmetic Reconciliation ]
            │ (Fails -> RECONCILIATION_FAILED)
            │ (Levels: RUN_RECONCILED)
            ▼
[ Stage 6: Exact-Run HTTP Readback over TCP ]
            │ (Fails -> HTTP_READBACK_MISMATCH)
            ▼
[ Stage 7: Playwright Browser Inspection ]
            │ (Fails -> BROWSER_READBACK_MISMATCH)
            ▼
[ FINAL: LIVE_RECONCILED ]
```

### Invariant Rules
- A level label is appended to `levelsVerified` **only after** its corresponding step has successfully completed and returned positive observed evidence.
- No level is ever added preemptively.
- If `--live-meta` is not passed on the CLI, the test returns `status: "NOT_RUN"`, `detailedOutcome: "NOT_RUN"`, and zero counts. It does NOT claim PASS.
- A live run cannot produce an `ACCEPTED` verdict unless all 3 core levels (`ADS_COLLECTED`, `ADS_PERSISTED`, `RUN_RECONCILED`), positive counts, and a valid `runId` are present in the manifest.

---

## 3. Database Protection & Isolation

Live Meta extraction tests must never pollute or mutate the active user workspace database (`prisma/dev.db`).

1. **Isolated SQLite Instance**: The live collector pipeline creates a temporary isolated database via `createIsolatedTestDatabase("live_meta_recon")`.
2. **Dedicated Workspace**: A dedicated test workspace `ws_live_acceptance_<timestamp>` is provisioned with an isolated API key and role.
3. **Synchronous Run Orchestration**: The query is submitted through `discoveryOrchestrator.createDiscoveryJob()` with `dryRun: false` targeted exclusively at the isolated test database.
4. **Deterministic Teardown**: Upon test completion or failure, the isolated SQLite file and WAL journals are removed cleanly.

---

## 4. Verification Evidence & Outcomes

| CLI Invocations | Expected Outcome | Gate 14 Status | Release Verdict Allowed |
| :--- | :--- | :--- | :--- |
| `npm run kh01:acceptance:full` | `NOT_RUN` (opt-in only) | `NOT_RUN` | `CONDITIONALLY_ACCEPTED` |
| `--live-meta` with collector offline | `MCP_UNAVAILABLE` | `BLOCKED` | `BLOCKED` |
| `--live-meta` with rate limit | `RATE_LIMITED` | `BLOCKED` | `BLOCKED` |
| `--live-meta` with 0 ads returned | `SOURCE_ACCESSIBLE_NO_RESULTS` | `BLOCKED` | `BLOCKED` |
| `--live-meta` with complete verified pipeline | `LIVE_RECONCILED` | `PASSED` | `ACCEPTED` |

---

## 5. Verification Test Proof

The truthful live verification behavior is verified under adversarial conditions in:
- `tests/unit/kh01AcceptanceTruthfulnessV1153.test.ts`
  - "does not award ADS_PERSISTED or RUN_RECONCILED when zero ads persisted in DB" -> **PASSED**
  - "rejects full ACCEPTED verdict if live verification is missing required levels" -> **PASSED**
  - "allows CONDITIONALLY_ACCEPTED when all mandatory gates pass and live is NOT_RUN" -> **PASSED**
