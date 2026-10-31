# KH-01 V11.4.5 — Real Meta Source Provenance & Classification

## Overview
A core requirement of KH-01 technical truthfulness is that fixture test results are never represented as live source verification, and database-backed records are clearly distinguished from live external crawls (Tasks 126–133).

---

## 5-Level Provenance Hierarchy

| Level | Code Identifier | Description | External Fetch |
| :--- | :--- | :--- | :--- |
| 1 | `FIXTURE_SYNTHETIC` | Deterministic local fixture data with explicit synthetic identifiers | Mock / In-Memory |
| 2 | `SOURCE_BACKED` | Genuine historical Meta Ad Library records stored in SQLite | In-Memory DB Query |
| 3 | `LIVE_SOURCE_VERIFIED` | Real-time observation from public URL via Meta Collector MCP | Live HTTP (Opt-in) |
| 4 | `SOURCE_RESTRICTED` | Source accessible but blocked by 403, 429, Cloudflare, or robots | Live HTTP (Blocked) |
| 5 | `UNVERIFIED` | Ad or product record lacks authentic provenance linkage | None |

---

## Provenance Enforcement Rules

1. **No Inference from Object Existence**:
   The mere existence of a non-null ad object does not prove authentic provenance. The external Meta Library ID, advertiser identity, and platform metadata must be validated.
2. **Opt-in Live External Research**:
   Live source crawling is restricted to explicit `--live` CLI opt-in. Default acceptance suites run deterministically in `FIXTURE_INTEGRATION_E2E` or `SOURCE_BACKED_E2E` modes to prevent network flakiness in CI/CD.
3. **Honest Access Restriction Reporting**:
   When external landing pages return HTTP 403, HTTP 429, or CAPTCHA challenges, the system records `ACCESS_RESTRICTED`. It strictly forbids fabricating landing page CRO scores or inventing product offers.
4. **Separation in Acceptance Manifest**:
   The `e2e-manifest.json` reports `sourceProvenanceLevel` alongside `liveSourceStatus`, guaranteeing transparent release auditing.
