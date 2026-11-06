# SWAI KH-02 — V12.4.3.7.19.3.2.4
## CI HMAC Trust Boundary Patch Audit (Section 04 Contract)

### 1. Function-by-Function Invariant Audit

#### 4.1 `DEFAULT_CI_VERIFIER_KEY` & `getCiVerifierSecret()`
- **File**: `src/services/kh02/release/githubActionsCiEvidence.ts`
- **Before**: `DEFAULT_CI_VERIFIER_KEY = "SWAI_KH02_INTERNAL_HMAC_VERIFIER_KEY_V19_3_2_3_SECURE"` exported; `getCiVerifierKey()` fell back to this constant if `KH02_CI_VERIFIER_SECRET` was unset.
- **After**: `DEFAULT_CI_VERIFIER_KEY` removed. Replaced with `KNOWN_INSECURE_DEFAULT_KEYS` denylist and `getCiVerifierSecret(): CiVerifierSecretResolution`.
- **Invariant**: If `KH02_CI_VERIFIER_SECRET` is missing, empty, matches any known default key, or has < 32 characters entropy, returns explicit status `NOT_CONFIGURED` or `INSECURE_OR_DEFAULT`. Zero silent fallbacks.

#### 4.2 `mintCiAttestationToken()`
- **File**: `src/services/kh02/release/githubActionsCiEvidence.ts`
- **Before**: Unconditionally minted `swai_ci_v1_${hmac}` using default key when called from any user context.
- **After**: Validates `getCiVerifierSecret()`. If secret is unconfigured or prohibited, returns untrusted signature prefixed with `swai_ci_untrusted_`.
- **Invariant**: External callers without genuine provider capability or configured secrets cannot generate signatures starting with `swai_ci_v1_`.

#### 4.3 `verifyCiAttestationToken()`
- **File**: `src/services/kh02/release/githubActionsCiEvidence.ts`
- **Before**: Verified against `DEFAULT_CI_VERIFIER_KEY` when secret was absent.
- **After**: Validates signature format; immediately rejects `swai_ci_untrusted_` tokens; queries `getCiVerifierSecret()`. If secret is not `CONFIGURED`, fails closed with `MISSING_TRUST_ANCHOR`. Uses `crypto.timingSafeEqual` against recomputed HMAC.
- **Invariant**: Tokens cannot verify successfully without a configured, high-entropy secret.

#### 4.4 `verifyAuthenticCiProof()`
- **File**: `src/services/kh02/release/githubActionsCiEvidence.ts`
- **Before**: Verified token after claim checks; allowed unverified claims to fail with misleading repository errors.
- **After**: Performs strict cryptographic attestation verification and claim matching; guarantees that mock tokens or unverified claims fail closed as `CI_NOT_RUN` with `CI_CLAIM_UNVERIFIED`.
- **Invariant**: No unverified caller-supplied proof object can ever return `verified: true` or `status: "CI_PASS"`.

#### 4.5 `validateVerifiedCiAttestation()`
- **File**: `src/services/kh02/demand/testSuiteEvidenceValidator.ts`
- **Before**: Required exact property names `proof.commitSha` and `proof.branch`.
- **After**: Robustly inspects `proof.commitSha || proof.headSha` and `proof.branch || proof.headBranch`.
- **Invariant**: Validates structural consistency and separates `structurallyValid` from `providerVerified`.

#### 4.6 `evaluateReleaseEvidence()`
- **File**: `src/services/kh02/release/releaseGateEvaluatorV19.ts`
- **Before**: Pushed no blocker when CI was unconfigured; accepted forged `verifiedProof` signed with default key.
- **After**: Adds `blockerList.push("CI_NOT_CONFIGURED")` when unconfigured; mandates `tokenCheck.valid === true` under configured secret.
- **Invariant**: `overallReleaseAllowed` strictly requires all 4 gates (`ENGINEERING_PASS`, `STAGING_SHADOW_EXECUTED_PASS`, `BUSINESS_EVIDENCE_SUFFICIENT`, `CI_PASS`).

### 2. Callsite Verification
All callsites across `githubActionsCiEvidence.ts`, `testSuiteEvidenceValidator.ts`, `releaseGateEvaluatorV19.ts`, and test suites were audited and verified.
