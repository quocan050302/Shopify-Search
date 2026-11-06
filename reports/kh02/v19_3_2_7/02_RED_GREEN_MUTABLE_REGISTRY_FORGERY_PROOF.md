# SWAI KH-02 — V12.4.3.7.19.3.2.7
## Red-to-Green CI Origin Registry Immutability & Forgery Proof

### 1. Executive Summary

This audit demonstrates the complete resolution of the Mutable CI Registry and Signer Leak vulnerabilities identified in KH-02 V19.3.2.6. Prior to this patch, although direct public registration of unquarantined runs was restricted, two critical trust leaks remained:
1. Object Reference Leak in Registry Lookup: `lookupVerifiedRemoteCiRun` returned direct references to mutable internal memory structures.
2. Unrestricted Token Signer Leak: `_privateMintCiAttestationToken` remained exported, and `mintCiAttestationToken` permitted caller-injected signing keys via `testKey`.
3. Inexact Workflow Allowlisting: Workflow path evaluation used loose substring or prefix checks.

---

### 2. RED State: Vulnerability Demonstration

In V19.3.2.6:
1. **Mutable Registry Lookup Reference**:
   ```typescript
   // A caller or test could register a quarantined mock run:
   _testOnlyRegisterVerifiedRemoteCiRun(runId, mockEvidence);
   // Then retrieve the record and mutate it directly in place:
   const reg = lookupVerifiedRemoteCiRun(runId, mockEvidence);
   (reg.record as any).isUnitTestMock = false; // IN-MEMORY MUTATION
   // Now the registry has an unquarantined "authentic" record without GitHub execution!
   ```
2. **Exported Private Minting Function & TestKey Injection**:
   ```typescript
   // Direct invocation of exported private signer:
   import { _privateMintCiAttestationToken } from "@/services/kh02/release/githubActionsCiEvidence";
   const forgedToken = _privateMintCiAttestationToken(forgedPayload);

   // Or caller-specified key injection:
   const token = mintCiAttestationToken(runId, evidence, "custom_compromised_key");
   ```
3. **Inexact Workflow Allowlist**:
   ```typescript
   // Allowed paths matching ".github/workflows/kh02-ci.yml"
   // An attacker could run: ".github/workflows/kh02-ci.yml.malicious.sh"
   ```

---

### 3. GREEN State: Enforced Defenses in V19.3.2.7

In V19.3.2.7, multiple interlocking cryptographic and architectural barriers close these vectors:

1. **Deep Cloning & Freezing (`deepCloneAndFreeze`)**:
   - Both when records are registered in `_registerVerifiedRemoteCiRun` and when returned by `lookupVerifiedRemoteCiRun`, objects are deep-cloned and frozen via `Object.freeze`:
     ```typescript
     function deepCloneAndFreeze<T>(val: T): Readonly<T> {
       if (val === null || typeof val !== "object") return val;
       const copy = Array.isArray(val) ? val.map(deepCloneAndFreeze) : { ...val };
       for (const k of Object.keys(copy)) {
         copy[k] = deepCloneAndFreeze(copy[k]);
       }
       return Object.freeze(copy);
     }
     ```
   - Attempting to mutate `isUnitTestMock`, `conclusion`, `status`, or any property throws a `TypeError` in strict mode and has zero impact on the internal registry map.

2. **Signer Encapsulation & TestKey Removal**:
   - `_privateMintCiAttestationToken` is module-private and not exported.
   - `testKey` option is completely removed from `mintCiAttestationToken`.
   - Test fixtures requiring isolated mock tokens use the dedicated helper `testMintCiAttestationToken` located inside `tests/setupTestEnvironment.ts`, which cannot leak into production paths.

3. **Strict Workflow Allowlisting**:
   - Workflow verification enforces exact equality (`===`):
     ```typescript
     if (options?.allowedWorkflows && options.allowedWorkflows.length > 0) {
       const matched = options.allowedWorkflows.some((allowed) => allowed === evidence.workflowName || allowed === evidence.workflowPath);
       if (!matched) {
         return { valid: false, reason: "WORKFLOW_NOT_ALLOWED" };
       }
     }
     ```
   - Release evaluator strictly requires matching canonical workflows:
     `CANONICAL_RELEASE_WORKFLOWS.some(w => w === att.workflowName || w === att.workflowPath)`.

---

### 4. Adversarial Regression Verification

All 18 adversarial scenarios (A01 through A18) in `tests/unit/kh02/v12_4_3_7_19_3_2_7_MutableRegistryAndRunnerTruth.test.ts` pass deterministically (18/18):
- **A01**: Attempted in-place mutation of registry record fails (`Object.isFrozen === true`, mutation has 0 effect on registry).
- **A02**: Direct signer export / `testKey` parameter rejected.
- **A03**: Forged valid-hex digest + correct HMAC fails closed (`CI_NOT_RUN`).
- **A04**: Quarantined mock origin remains quarantined across all release evaluators.
- **A05**: Exact workflow allowlist rejects prefix/suffix variations.
- **A06**: Authentic-verified run registration failure cannot return signed `CI_PASS`.
- **A07–A14**: Typed gate validators reject missing/fake/inconsistent summaries, DB discrepancies, resource exhaustion, log truncation, and worktree drift.
- **A15–A18**: Zero-cost MCP protocol handshake, provider spend guards, DEV/HOLDOUT chronological cutoff, and raw CSV lineage enforcement.
