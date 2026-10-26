# SWAI V11.5.4 — Artifact Integrity & Release Gating

**Target Release:** V11.5.4 FINAL  
**Protocol Specification:** KH-01  
**Target Market:** United States (`RESEARCH_ONLY`)

---

## 1. Executive Summary

In SWAI V11.5.3, acceptance artifacts were generated post-verdict calculation. As a result, an acceptance run could derive `CONDITIONALLY_ACCEPTED` even if the exact-run reconciliation artifact failed or the browser artifact was missing. Additionally, if writing artifacts to disk encountered an I/O or permission error, the `overallStatus` of the returned report object did not reflect the failure, leading to a false zero exit code.

SWAI V11.5.4 establishes full artifact integrity, ensuring that required artifact validation directly gates the release verdict, and that post-write disk validation guarantees 100% agreement across CLI output, report status, manifest data, and process exit code.

---

## 2. Required Artifact Evaluation

Implemented `evaluateRequiredArtifacts` and updated `finalizeAcceptanceVerdict` in `src/lib/kh01/acceptanceGateRegistry.ts`:

```typescript
export interface AcceptanceArtifactStatus {
  artifactId: string;
  required: boolean;
  status: "PASSED" | "FAILED" | "BLOCKED" | "NOT_RUN";
  evidencePath: string | null;
  evidenceOrigin: string;
  error?: string;
}

export function evaluateRequiredArtifacts(artifacts: AcceptanceArtifactStatus[]): {
  eligible: boolean;
  blockingReasons: string[];
  blockingArtifactIds: string[];
}
```

### Evaluation Rules:
1. **Required Artifacts:**
   - `exact-run-reconciliation`: Required for offline acceptance. Status must be `PASSED`.
   - `browser-results`: Required for UI release acceptance. Status must be `PASSED`.
   - `acceptance-manifest`: Required. Must pass all 18 structural and relational checks in `validateKh01AcceptanceManifest`.
2. **Failure Handling:**
   - Any required artifact with status `FAILED`, `BLOCKED`, or `NOT_RUN` sets `eligible = false`.
   - `finalizeAcceptanceVerdict` immediately assigns `verdict: "BLOCKED"` and records the blocking artifact IDs.
3. **Optional Artifacts:**
   - `live-source-results`: Optional during offline acceptance. Allowed to be `NOT_RUN` without blocking offline `CONDITIONALLY_ACCEPTED`. If `--live-meta` was explicitly requested, failure blocks `ACCEPTED`.

---

## 3. Post-Write Report & Exit Code Invariant

To eliminate false zero exit codes from unpersisted or corrupted artifacts, `scripts/kh01/runFullAcceptance.ts` implements a multi-phase publication protocol:

```text
1. Execute Test & Verification Stages
                 ↓
2. Evaluate Required Artifacts
                 ↓
3. Compute Provisional Verdict
                 ↓
4. Write Artifacts & Candidate Manifest to Run Directory
                 ↓
5. Read Back & Validate On-Disk Artifacts & Manifest
                 ↓
6. Finalize Report Object with Disk-Validated Verdict
                 ↓
7. Derive Process Exit Code (0 for ACCEPTED / CONDITIONALLY_ACCEPTED; 1 for BLOCKED)
```

### Absolute Invariant:
```text
CLI Displayed Verdict == report.overallStatus == manifest.releaseVerdict == (exitCode === 0)
```
If any discrepancy occurs during file write, verification, or schema validation, `report.overallStatus` is overridden to `BLOCKED` and the process exits with code `1`.

---

## 4. Test Verification Evidence

The artifact gating rules are verified by `tests/unit/kh01ArtifactIntegrity.test.ts`:

- `evaluateRequiredArtifacts passes when all required artifacts have status PASSED`: **PASSED**
- `evaluateRequiredArtifacts blocks release when required artifact has status FAILED`: **PASSED**
- `evaluateRequiredArtifacts blocks release when required artifact has status NOT_RUN`: **PASSED**
- `evaluateRequiredArtifacts allows optional live artifact to be NOT_RUN`: **PASSED**
- `finalizeAcceptanceVerdict blocks release when required artifact fails`: **PASSED**
- `finalizeAcceptanceVerdict blocks release when live verification was requested but not reconciled`: **PASSED**

All 6/6 tests passed.
