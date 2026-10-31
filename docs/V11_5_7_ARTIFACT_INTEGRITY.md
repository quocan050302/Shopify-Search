# SWAI V11.5.7 — ARTIFACT INTEGRITY AUDIT (FINAL-03)
## Authoritative Artifact Inventory & Publication Verification

**Defect ID:** FINAL-03 (Part B — Artifact Inventory & Publication Integrity)  
**Severity:** P1 (Highest Integrity Defect)  
**Status:** FIXED_VERIFIED  
**Target Release:** V11.5.7 — Final Evidence Integrity Hotfix  
**Tested Commit SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`  
**Acceptance Run ID:** `kh01_rel_1792914049487_4baa2295`  

---

## 1. THE PROBLEM & ROOT CAUSE

Prior to V11.5.7:
1. `validateAcceptanceArtifactSet()` checked only that the artifact array was non-empty and filenames were safe, but did not enforce the presence of essential artifact files.
2. A caller could submit a 3-file set missing `browser-results.json`, `database-isolation.json`, or `gate-results.json`, and publication would succeed.
3. Artifact schema validation was superficial, allowing empty viewport arrays or unverified Prisma claims to pass.

**Fundamental Invariant:**  
*An artifact set missing any mandatory evidence file or containing conflicting internal assertions cannot be published as verified acceptance.*

---

## 2. THE ENGINEERING SOLUTION

### 2.1 Authoritative Inventory: `KH01_REQUIRED_ARTIFACTS`
A single canonical registry defines all 23 required artifacts and their scope constraints:

```typescript
export interface RequiredArtifactDefinition {
  filename: string;
  requiredFor: "OFFLINE" | "FULL_LIVE" | "BOTH";
  validatorId: string;
  allowedStatuses: string[];
  requiredEvidenceOrigin?: string;
}

export const KH01_REQUIRED_ARTIFACTS: RequiredArtifactDefinition[] = [
  { filename: "acceptance-manifest.json", requiredFor: "BOTH", validatorId: "manifest", allowedStatuses: ["PASSED", "CONDITIONALLY_ACCEPTED", "ACCEPTED"] },
  { filename: "gate-results.json", requiredFor: "BOTH", validatorId: "gate-results", allowedStatuses: ["PASSED"] },
  { filename: "stage-results.json", requiredFor: "BOTH", validatorId: "stage-results", allowedStatuses: ["PASSED"] },
  { filename: "security-results.json", requiredFor: "BOTH", validatorId: "security-results", allowedStatuses: ["PASSED"] },
  { filename: "database-isolation.json", requiredFor: "BOTH", validatorId: "database-isolation", allowedStatuses: ["PASSED"] },
  { filename: "database-process-identity.json", requiredFor: "BOTH", validatorId: "database-identity", allowedStatuses: ["PASSED"] },
  { filename: "exact-run-reconciliation.json", requiredFor: "BOTH", validatorId: "exact-run", allowedStatuses: ["PASSED"] },
  { filename: "offline-reconciliation.json", requiredFor: "BOTH", validatorId: "offline-recon", allowedStatuses: ["PASSED"] },
  { filename: "browser-results.json", requiredFor: "BOTH", validatorId: "browser-results", allowedStatuses: ["PASSED"] },
  { filename: "browser-e2e-results.json", requiredFor: "BOTH", validatorId: "browser-e2e", allowedStatuses: ["PASSED"] },
  { filename: "browser-viewport-results.json", requiredFor: "BOTH", validatorId: "browser-viewport", allowedStatuses: ["PASSED"] },
  { filename: "worker-process-evidence.json", requiredFor: "BOTH", validatorId: "worker-process", allowedStatuses: ["PASSED"] },
  { filename: "defect-register.json", requiredFor: "BOTH", validatorId: "defect-register", allowedStatuses: ["PASSED"] },
  { filename: "artifact-validation.json", requiredFor: "BOTH", validatorId: "artifact-validation", allowedStatuses: ["PASSED"] },
  { filename: "validation-results.json", requiredFor: "BOTH", validatorId: "validation-results", allowedStatuses: ["PASSED"] },
  { filename: "release-verdict.json", requiredFor: "BOTH", validatorId: "release-verdict", allowedStatuses: ["PASSED", "CONDITIONALLY_ACCEPTED", "ACCEPTED"] },
  { filename: "execution-metadata.json", requiredFor: "BOTH", validatorId: "execution-metadata", allowedStatuses: ["PASSED"] },
  { filename: "suite-coverage.json", requiredFor: "BOTH", validatorId: "suite-coverage", allowedStatuses: ["PASSED"] },
  { filename: "screenshot-manifest.json", requiredFor: "BOTH", validatorId: "screenshot-manifest", allowedStatuses: ["PASSED"] },
  { filename: "live-source-results.json", requiredFor: "BOTH", validatorId: "live-source", allowedStatuses: ["PASSED", "NOT_RUN"] },
  { filename: "live-source-verification.json", requiredFor: "BOTH", validatorId: "live-source", allowedStatuses: ["PASSED", "NOT_RUN"] },
  { filename: "provider-source-provenance.json", requiredFor: "FULL_LIVE", validatorId: "provider-provenance", allowedStatuses: ["PASSED"] },
  { filename: "cross-boundary-reconciliation.json", requiredFor: "FULL_LIVE", validatorId: "cross-boundary", allowedStatuses: ["PASSED"] },
];
```

### 2.2 Deep Schema Validations in `validateAcceptanceArtifact()`
Specific invariants enforced per file:
- `browser-results.json`: Status `PASSED` requires all 6 canonical viewports tested.
- `database-isolation.json`: Status `PASSED` requires `prismaConnectionVerified === true`, `markerWriteVerified === true`, `markerReadVerified === true`, and `activeDatabaseProtected === true`.
- `suite-coverage.json`: Status `PASSED` requires zero missing and zero failed suites.
- `live-source-results.json`: Status `PASSED` strictly forbids `observedSourceType === "TEST_FIXTURE"`.
- `screenshot-manifest.json`: Every screenshot must possess a valid 64-character SHA256 checksum.

### 2.3 Atomic Two-Phase Publication
`publishAcceptanceArtifactsAtomically()` guarantees consistency:
1. In-memory validation of full inventory and cross-manifest agreement.
2. Creation of isolated `.staging-<acceptanceRunId>` directory.
3. Staging and cryptographic verification of screenshots.
4. Writing of all JSON artifacts.
5. Disk readback of every file with JSON re-parsing and SHA256 hashing.
6. Atomic filesystem directory rename: `fs.renameSync(stagingDir, targetRunDir)`.
7. Atomic update of `latest.json`.
8. On any error, staging directory is wiped and `latest.json` remains untouched.

---

## 3. TEST VERIFICATION

Tested in:
- `tests/unit/kh01RequiredArtifactInventory.test.ts` (13/13 passed)
- `tests/unit/kh01ArtifactIntegrity.test.ts` (11/11 passed)

Scenarios verified:
- Complete offline inventory succeeds.
- Missing any required file blocks publication.
- `live-source-results.json` `NOT_RUN` allowed in offline scope, blocked in full live scope.
- Incompatible internal statuses (e.g. empty viewports or unverified Prisma) rejected.
- Atomic publication rollback leaves `latest.json` intact.
- Existing run directories are immutable and reject overwrite.

---

## 4. OBSERVED EVIDENCE IN RUN `kh01_rel_1792914049487_4baa2295`

From `artifacts/v11.5.7/kh01_rel_1792914049487_4baa2295/`:
- 22 JSON artifact files written and read back successfully.
- 1 `screenshots/` directory containing 6 canonical viewport PNG images.
- `artifact-checksums.json` contains SHA256 digests for all 22 JSON files.
- `latest.json` points authoritatively to `artifacts/v11.5.7/kh01_rel_1792914049487_4baa2295/acceptance-manifest.json`.
