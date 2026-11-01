# KH-02 V12.4.3.5.0 — Final Feature Acceptance Report (Amazon US Product Evidence Pilot)

## 1. Executive Verdict
- **Release Version**: `12.4.3.5.0`
- **Target Working Branch**: `feature/kh02-amazon-us-pilot-v12.4.3.5.0`
- **Base SHA (`origin/master`)**: `c1833362cf6634917f2ff94df19d97c393247d94`
- **Tested Source SHA (`CODE_SHA`)**: `93dbb717fa4a778c21baa5a0412225b7632f8688`
- **Engineering Gate Verdict**: `ENGINEERING_READY`
- **Real Provider Gate Verdict**: `BLOCKED_POLICY` (`KH02_AMAZON_US_ENABLED=false`, `KH02_AMAZON_US_LIVE_ALLOWED=false` by default; no Amazon Creators API credentials or live scraping opt-in configured)
- **Overall Pilot Status**: `ENGINEERING_COMPLETE_EXTERNAL_BLOCKED`

## 2. Scope & Guardrails Verified
- **Amazon US Only**: Walmart US via Jina Reader (`V12.4.3.5.1`) and cross-marketplace ranking (`V12.4.3.5.2`) were NOT built in this release.
- **Default Feature Flags OFF**: `KH02_AMAZON_US_ENABLED=false` and `KH02_AMAZON_US_LIVE_ALLOWED=false` by default; zero Amazon network calls occur when flags are OFF.
- **Protective Pilot Budget**: Concurrency = `1`, max `4` operations per run (`1–3` candidates), max `2` attempts per operation, max `4` navigations per rolling 5 minutes.
- **No Inflation of KH-02 Business Gates**: Amazon listing observation has zero effect on opportunity score weights, `G15` (60-day longitudinal demand), or `G16` (live ad/merchant gate).

## 3. Execution Metrics on `CODE_SHA` (`93dbb717fa4a778c21baa5a0412225b7632f8688`)
- **Playwright MCP Handshake**: `@playwright/mcp@0.0.83` stdio handshake verified (`25` tools discovered), `0` residual processes after session close.
- **Automated Tests**: `506` unique tests executed (`488` unit + `18` integration), `0` failed, `0` skipped.
- **Acceptance Matrix (`A01`–`A30`)**: `30/30` passed.
- **Next.js Production Build**: `BUILD_PASS` (exit code `0`).
- **3-Way SQLite <-> HTTP GET <-> Chromium DOM Parity**: `8/8` field comparisons reconciled with `0` mismatches and `0` console/page errors.
- **Read-Only HTTP Non-Mutation Proof**: Verified across `200`, `403`, and `404` GET responses with identical pre/post SQLite SHA-256 snapshot digest.
- **Historical DEV/HOLDOUT & Point-in-Time Audit**: `0` future leakage; post-cutoff Amazon observations rejected; historical demand remains honestly `INSUFFICIENT_HISTORICAL_EVIDENCE`.
- **Negative Control Mutation Suite (`AMZ_MUT_01..AMZ_MUT_24`)**: `24/24` adversarial mutations caught and rejected (`0` false-PASS escapes).
