# SWAI KH-02 V12.2.1 — BASELINE AUDIT

**Repository:** `quocan050302/Shopify-Search`  
**Working Branch:** `feature/kh02-v12.1.3-runtime-truth-closure`  
**Base Reference:** `origin/QA`  
**Starting Commit SHA:** `4e6d4ba6e3842d8ae1b03be0680c74793e424c44` (V12.2 HEAD)  
**Release Target:** `KH-02 V12.2.1 — Provider Runtime Activation & Truthful Live Acceptance`  
**Auditor:** Principal Solution Architect & Independent Runtime Acceptance Auditor  
**Audit Date:** 2026-10-26T22:50:00+07:00  

---

## 1. Executive Summary & Defect Inventory

The V12.2 implementation delivered foundational multi-source infrastructure and the 7-level product identity hierarchy. However, an independent runtime audit identified 10 critical integration and acceptance integrity defects:

1. **Incorrect Source Status Mapping:** `checkKH02ProviderReadiness()` mapped `CREDENTIALS_REQUIRED` and `MCP_NOT_CONFIGURED` to generic `NOT_CONFIGURED`, hiding root causes from users and API consumers.
2. **Superficial Test Connections Behavior:** The UI invoked `POST /api/v1/kh02/providers/test-connection` but merely refreshed source badges without rendering a detailed 10-point diagnostic panel.
3. **Meta Live Acceptance Based on Cached Count:** The V12.2 acceptance script probed local MCP stdio capabilities and then declared `PASS` based solely on transport connectivity and cached database counts, without executing a fresh live collection query during acceptance.
4. **TikTok Ads US Missing Automated Provider Path:** The adapter performed a database query against `CompetitorAd` records while claiming automated acquisition; no automated provider was actually configured.
5. **TikTok Organic Credit Misconception:** Code declared `creditsPerRequest: 1` whereas HasData's MCP vendor contract mandates 10 credits per MCP tool invocation (with a 1,000 monthly free tier allowance). Key presence was incorrectly assumed to imply transport connectivity.
6. **Google Transparency Non-Compliant Protocol Assumptions:** The HTTP client sent guessed REST endpoints (`/health`, `/tools`, `/search_advertisers`) instead of standard JSON-RPC 2.0 (`tools/list`, `tools/call`), and lacked SSRF and command injection safeguards.
7. **Demand History Conflation:** Engine readiness (`ENGINE_READY`) was not strictly segregated from product-level time-series data availability (`PRODUCT_HISTORY_VERIFIED` vs `INSUFFICIENT_HISTORY`).
8. **Hardcoded Acceptance Verdicts:** The V12.2 runner hardcoded `"reconciliationStatus": "VERIFIED"` and `"status": "PASS"` for Chromium tests without running live assertions.
9. **Zero-Cost Safeguard:** Metered paid queries must be gated fail-closed (`AUTO_PAID_RESEARCH=false`) with zero unauthorized charges.
10. **KH-01 Protection:** Absolutely zero destructive schema changes or regressions permitted in KH-01 Product Intelligence.

---

## 2. Environment Capabilities & Credential Availability

| Variable Name | Category | Status in Environment | Impact on Live Capabilities |
|---|---|---|---|
| `DATABASE_URL` | Persistence | Configured (SQLite `prisma/dev.db`) | Local persistence operational |
| `ANTHROPIC_API_KEY` | LLM Analysis | Unset in shell environment | Structured LLM fallback active |
| `OPENAI_API_KEY` | LLM Analysis | Unset in shell environment | Secondary LLM fallback active |
| `HASDATA_API_KEY` | TikTok Organic | Unset in shell environment | Truthfully reported: `CREDENTIALS_REQUIRED` |
| `TIKTOK_ORGANIC_API_KEY` | TikTok Organic | Unset in shell environment | Truthfully reported: `CREDENTIALS_REQUIRED` |
| `GOOGLE_TRANSPARENCY_MCP_URL` | Google Ads | Unset in shell environment | Truthfully reported: `MCP_NOT_CONFIGURED` |
| `GOOGLE_TRANSPARENCY_MCP_COMMAND` | Google Ads | Unset in shell environment | Truthfully reported: `MCP_NOT_CONFIGURED` |
| `AUTO_PAID_RESEARCH` | Billing Guard | Default `false` | Zero unauthorized paid queries enforced |

*Note: In accordance with Section 16 & Part A, no raw credentials or secrets are logged or stored.*

---

## 3. Baseline Source Statuses & Diagnosed Gaps

| Source | Baseline Status (V12.2) | Repaired Status (V12.2.1) | Actual Live Capability | Blocker Code |
|---|---|---|---|---|
| **Meta Ads** | `SOURCE_ACCESS_VERIFIED` | `SOURCE_ACCESS_VERIFIED` | Local MCP stdio collector operational; 141 ads in DB | None (Local MCP operational) |
| **TikTok Ads US** | `MANUAL_RESEARCH_ONLY` | `MANUAL_RESEARCH_ONLY` | DB competitor search + manual Creative Center import | `NO_AUTHORIZED_US_AD_PROVIDER` |
| **TikTok Organic** | `NOT_CONFIGURED` | `CREDENTIALS_REQUIRED` | HasData MCP contract verified (10 credits/call); unmetered | `MISSING_CREDENTIALS` |
| **Google Ads** | `NOT_CONFIGURED` | `MCP_NOT_CONFIGURED` | JSON-RPC 2.0 MCP transport implemented; unconfigured | `MCP_NOT_CONFIGURED` |
| **Demand History** | `ENGINE_READY` | `ENGINE_READY` | Trend stability policy engine active; 0 points stored | `INSUFFICIENT_HISTORY` |

---

## 4. Test Baseline & KH-01 Protection

- **KH-01 Verification Suite:** `npm run kh01:verify` passes 100% (69/69 tests passing across 5 test files).
- **Zero Schema Migrations:** No changes to `prisma/schema.prisma`.
- **Concurrency & Ownership:** Preserved CAS fencing, heartbeat leases, and worker claim recovery.
