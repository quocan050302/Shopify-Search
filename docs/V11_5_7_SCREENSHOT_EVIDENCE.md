# SWAI V11.5.7 — SCREENSHOT EVIDENCE AUDIT (FINAL-04)
## Run-Specific Immutable Viewport Evidence with Cryptographic Hashes

**Defect ID:** FINAL-04  
**Severity:** P1 (Highest Integrity Defect)  
**Status:** FIXED_VERIFIED  
**Target Release:** V11.5.7 — Final Evidence Integrity Hotfix  
**Tested Commit SHA:** `cd32c5a1feac9313ce90177c9013f525d2eb41ed`  
**Acceptance Run ID:** `kh01_rel_1792914049487_4baa2295`  

---

## 1. THE PROBLEM & ROOT CAUSE

In V11.5.6, `tests/e2e/metaDiscoveryFinalAcceptance.test.ts` hardcoded its screenshot output path:
```typescript
const screenshotsDir = path.resolve(process.cwd(), "artifacts/v11.5.6/screenshots");
```
Because this directory was shared across all acceptance executions:
1. Running acceptance a second time would overwrite the PNG images from the first run.
2. Older acceptance runs retained valid manifest JSON files whose referenced screenshots had been silently replaced by subsequent runs.
3. Screenshots lacked cryptographic checksum validation.

**Fundamental Invariant:**  
*A screenshot path existing in a report is NOT proof that the image belongs to the current acceptance run. Every run must retain its own immutable screenshots verified by SHA256 hashes.*

---

## 2. THE ENGINEERING SOLUTION

### 2.1 Run-Specific Scratch Directory Injection
The acceptance orchestrator allocates a unique scratch directory per run and passes it to the browser test subprocess via environment variables:
```typescript
{
  KH01_BROWSER_EVIDENCE_PATH: browserEvidenceFilePath,
  KH01_BROWSER_SCREENSHOT_DIR: path.join(scratchDir, "screenshots"),
  KH01_ACCEPTANCE_RUN_ID: acceptanceRunId,
}
```

### 2.2 Test Adaptation: `metaDiscoveryFinalAcceptance.test.ts`
The test consumes the injected environment variables:
```typescript
const screenshotsDir =
  process.env.KH01_BROWSER_SCREENSHOT_DIR ||
  path.resolve(process.cwd(), "artifacts/v11.5.7/screenshots");
```

### 2.3 Evidence Collection: `collectScreenshotEvidence()`
Collects structured metadata for all 6 canonical viewports:
- Verifies file exists on disk.
- Asserts file size > 0.
- Computes SHA256 hash using `crypto.createHash("sha256")`.
- Guards against directory path traversal.

### 2.4 Atomic Staging & Checksum Verification: `stageScreenshotArtifacts()`
Copies each verified screenshot from the scratch directory into `stagingDir/screenshots/`, recalculates the SHA256 checksum on disk, and verifies exact equality before directory rename.

---

## 3. TEST VERIFICATION

Tested in `tests/unit/kh01ScreenshotEvidence.test.ts` (6/6 passed):
- Collects all 6 canonical screenshots with valid SHA256 hashes.
- Marks missing screenshot as FAILED.
- Marks zero-byte screenshot as FAILED.
- Stages all 6 valid screenshots and verifies checksum equality.
- Fails staging when an evidence item is missing or corrupted.
- Proves Run A and Run B do not overwrite each other's screenshots.

---

## 4. OBSERVED EVIDENCE IN RUN `kh01_rel_1792914049487_4baa2295`

Directory: `artifacts/v11.5.7/kh01_rel_1792914049487_4baa2295/screenshots/`

| Viewport | Device / Form Factor | Relative Path | File Size (Bytes) | SHA256 Checksum | Status |
|---|---|---|---|---|---|
| **1920x1080** | Desktop Large | `screenshots/viewport_1920x1080.png` | 159,346 | `42c7dc5859648b289aae71f0a4cff0f02430cc35aed2c97a89fc176cb3d845f7` | PASSED |
| **1440x900** | Desktop Standard | `screenshots/viewport_1440x900.png` | 153,008 | `ceafe70e37db081640667af26fa35f0c5bbbeafc8dddd46620cf9ed83f0233d9` | PASSED |
| **1280x800** | Laptop | `screenshots/viewport_1280x800.png` | 138,886 | `80dd71c98687ba2ca288be0cd44ff49d7c7443a66ff3a58a6ef21e9dc8c4b9cd` | PASSED |
| **1024x768** | Tablet Landscape | `screenshots/viewport_1024x768.png` | 127,739 | `035a1f952665eaec081074b675f75c8f5754da71e8c49222f8ca12b9f5e1dcd2` | PASSED |
| **768x1024** | Tablet Portrait | `screenshots/viewport_768x1024.png` | 143,008 | `a3fd2c3dbfd9031ed4648685064629800bdb5ae2be2f0be04963cc51de0ea7a5` | PASSED |
| **390x844** | Mobile iPhone | `screenshots/viewport_390x844.png` | 70,518 | `902b04ccf903d74ebc44dc21cd72176c1ef22ee93c4c244aea3b1e5113b49463` | PASSED |

Total screenshots: **6 / 6 valid, non-zero, cryptographically verified.**
