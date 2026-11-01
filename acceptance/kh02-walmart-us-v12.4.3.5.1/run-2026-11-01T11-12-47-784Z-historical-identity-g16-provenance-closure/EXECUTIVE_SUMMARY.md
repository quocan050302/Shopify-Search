# KH-02 V12.4.3.5.1 — Walmart US Product Discovery + PDP Evidence (Jina Reader REST, No API Key)
## Executive Acceptance Summary (Historical Product Identity Truth, G16 Persisted Lineage & 153/153 Full Regression Closure)

- **Release Version**: `12.4.3.5.1` (Runtime compatibility version: `12.4.3.5.0.3`)
- **Target Branch**: `feature/kh02-walmart-us-jina-reader-v12.4.3.5.1`
- **Base Branch (`origin/QA`) SHA**: `fbe51a06ab8354c886d0415a9599f977c83caabc` (`origin/master` SHA: `5dd5128b4ec9ce70e957a2f250b9012a25e9118c`, identical git tree `96bdcb6f658ec7b696c156df3c2a03aa51f6031e`)
- **Tested `CODE_SHA`**: `150d011b697311304cf0580a5a1f04f0b3de71c4` (Tested Tree SHA: `e28c5396405f27c12a0e07396d34149ffc742d4b`)
- **Engineering Verdict**: `PASS`
- **Historical Product Identity Truth Verdict**: `PASS`
- **Broad Regression (153/153 Test Files)**: `PASS` (`107` unit files + `34` integration files + `12` E2E specs = `153/153` files executed, `1755/1755` tests passed, `0` failed, `0` exempted).
- **Niche-Accurate & Identity-Truthful Historical Replay (`Pet Gadgets`)**:
  - **DEV (`<= 2026-10-24`)**: `60` observations -> `5` candidates -> `0` niche-matched -> `shortlistCount: 0`, `verifiedIdentityCount: 0`, `nicheCoverageStatus: INSUFFICIENT_NICHE_COVERAGE`, `identityCoverageStatus: INSUFFICIENT_VERIFIED_IDENTITY`.
  - **HOLDOUT (`2026-10-24 .. 2026-10-30`)**: `377` observations -> `318` candidates -> `3/3` (100%) niche-matched Pet Gadgets Top-3 across `3` distinct product families (`nicheCoverageStatus: SUFFICIENT_NICHE_COVERAGE`), with `verifiedIdentityCount: 0`, `funnelProbableCount: 1` (`cc.uprootclean.com/main/phr` classified as `PROBABLE` + `FUNNEL_UNVERIFIED`), and `identityCoverageStatus: INSUFFICIENT_VERIFIED_IDENTITY` because ad-only observations at `asOf` lack independent persisted merchant JSON-LD/PDP proof.
- **G16 Persisted Lineage Reconstruction (`kh02_run_1793506961831_zvxlw`)**:
  - `previousSnapshotClaimedVerifiedCount: 2`
  - `verifiedFromPersistedEvidenceCount: 0`
  - `reconstructionStatus: HISTORICAL_SNAPSHOT_PROOF_NOT_RECONSTRUCTABLE`
  - `historicalG16Verdict: INSUFFICIENT_EVIDENCE` (zero synthetic hydration; cross-workspace `default-workspace` synthetic hash and reused `EXISTING`/`DETERMINISTIC_FALLBACK` ad rows rejected).
- **Live Walmart Provider Verdict**: `BLOCKED_PROVIDER`
- **Live Amazon Provider Verdict**: `CREDENTIALS_REQUIRED`
- **KH-02 Business Verdict**: `INSUFFICIENT_EVIDENCE` (G07 TikTok US: `BLOCKED`; G15 >=60d demand: `INSUFFICIENT_EVIDENCE`; G16 Persisted Top-3: `INSUFFICIENT_EVIDENCE`)
- **Overall Verdict**: `ENGINEERING_READY_WITH_EXTERNAL_BLOCKERS`
- **80-Case Physical-File Negative Mutation Suite**: `PASS` (`80/80` caught, `0` false passes)
