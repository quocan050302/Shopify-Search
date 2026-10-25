# SWAI V11.5.3 — Research Run Reconciliation Rules & Arithmetic Invariants
**Specification Protocol:** KH-01  
**Target Release:** V11.5.3  
**Audited Baseline SHA:** `ec291b06c0b7841fe8d28157d02582ce2844c58c`  
**Market Context:** United States (`RESEARCH_ONLY`)

---

## 1. Defect Analysis: BUG-06 in V11.5.2

In SWAI V11.5.2, `reconcileResearchRunCounts(runId)` in `src/services/research/runReconciliationService.ts` suffered from two severe reconciliation defects:

1. **Contradictory Consistency Boolean**: When `validCount` did not match `linkedCount` or `actualRetrievedCount < validCount`, the function added a diagnostic reason to `reasons[]`, but failed to toggle `consistent = false` across all conditional branches. This allowed reports to output `consistent: true` even when arithmetic violations were present in the same JSON object.
2. **Display Definition Discrepancy**: The service counted `displayedCount` by filtering out quarantined records (`isQuarantined: false`), whereas the exact-run API route (`/api/v1/discovery/meta/requests/[id]/ads`) returned all linked records while labeling quarantined items with metadata. This caused a discrepancy where reconciliation computed a different count than what the HTTP API and Explorer UI actually displayed.

---

## 2. Rigorous Ingestion & Reconciliation Count Semantics

To eliminate ambiguity, V11.5.3 defines unambiguous semantics for every stage of research ad collection:

```
[ Raw Upstream Ads ]  ───► retrieved (raw upstream payload count)
         │
         ▼
[ Normalization & Schema Validation ]
         ├── Valid ────────► valid (successfully parsed records)
         └── Invalid ──────► rejected (malformed, missing external ID, empty title)
         │
         ▼
[ Database Persistence & Partitioning ]
         ├── New Ads ──────► newUnique (inserted into CompetitorAd)
         ├── Existing Ads ─► duplicates (already in database, updated lastSeenAt)
         └── Failures ─────► failed (database write/transaction errors)
         │
         ▼
[ Research Run Association ] ──► linked (records connected via DiscoveryRunAd)
         │
         ▼
[ Display Eligibility (Option B) ]
         ├── Active Ads ───► displayed (eligible and returned by HTTP API)
         └── Quarantined ──► quarantined (flagged with provenance warning, displayed with label)
```

---

## 3. Mandatory Arithmetic Invariants

The pure function `evaluateRunCountInvariants(counts: RunCounts, rules: RunCountRules)` enforces these mathematical rules. **Any violation strictly forces `consistent = false`:**

### Rule 1: Non-Negativity
$$\forall c \in \{\text{retrieved, valid, newUnique, duplicates, rejected, failed, linked, displayed, quarantined}\}: c \ge 0$$
*Violation Code:* `NEGATIVE_COUNT_DETECTED`

### Rule 2: Conservation of Upstream Payload
$$\text{retrieved} \ge \text{valid}$$
$$\text{retrieved} \ge \text{valid} + \text{rejected}$$
*Violation Code:* `VALID_EXCEEDS_RETRIEVED`

### Rule 3: Valid Ingestion Partitioning
$$\text{valid} = \text{newUnique} + \text{duplicates}$$
*Violation Code:* `PARTITION_ARITHMETIC_MISMATCH`

### Rule 4: Relational Linking Integrity
$$\text{valid} = \text{linked}$$
Every valid advertisement extracted in a run must have an authentic `DiscoveryRunAd` link established in SQLite.
*Violation Code:* `VALID_LINKED_MISMATCH`

### Rule 5: Display Alignment (Option B Policy)
$$\text{linked} = \text{displayed}$$
The exact-run HTTP API returns 100% of the linked ads for that run, explicitly annotating quarantined ads with `isQuarantined: true`. The UI renders all linked ads without dropping older ads or quarantined ads.
*Violation Code:* `LINKED_DISPLAYED_MISMATCH`

---

## 4. Adversarial Verification Test Suite

Tested in `tests/unit/runReconciliationInvariants.test.ts` (9 tests, 100% passing):

| Invariant Scenario | Evaluated Counts | Expected `consistent` | Observed Result |
| :--- | :--- | :---: | :---: |
| **Clean Ingestion** | `retrieved: 5, valid: 5, newUnique: 5, duplicates: 0, linked: 5, displayed: 5` | `true` | **PASSED** |
| **Deduplicated Ingestion** | `retrieved: 10, valid: 10, newUnique: 6, duplicates: 4, linked: 10, displayed: 10` | `true` | **PASSED** |
| **Valid > Retrieved** | `retrieved: 5, valid: 6, newUnique: 6, duplicates: 0, linked: 6, displayed: 6` | `false` | **PASSED** |
| **Partition Mismatch** | `retrieved: 5, valid: 5, newUnique: 3, duplicates: 1, linked: 5, displayed: 5` | `false` | **PASSED** |
| **Missing DB Link** | `retrieved: 5, valid: 5, newUnique: 5, duplicates: 0, linked: 4, displayed: 4` | `false` | **PASSED** |
| **API/Display Mismatch** | `retrieved: 5, valid: 5, newUnique: 5, duplicates: 0, linked: 5, displayed: 4` | `false` | **PASSED** |
| **Negative Count** | `retrieved: -1, valid: 0, newUnique: 0, duplicates: 0, linked: 0, displayed: 0` | `false` | **PASSED** |
| **Zero Query Results** | `retrieved: 0, valid: 0, newUnique: 0, duplicates: 0, linked: 0, displayed: 0` | `true` | **PASSED** |
| **Quarantined Records** | `retrieved: 5, valid: 5, linked: 5, displayed: 5, quarantined: 2` | `true` (with note) | **PASSED** |
