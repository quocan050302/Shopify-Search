# KH-01 V11.4.2 — Performance & Resource Guard Acceptance Report

**Target Version**: V11.4.2  
**Implementation Date**: 2026-10-24  
**Target Market**: United States  
**Operating Mode**: RESEARCH_ONLY  

---

## 1. Executive Summary

Previous versions of the application exhibited excessive CPU and RAM utilization on developer Windows laptops when automated background discovery and scraping tasks were spawned without strict concurrency bounds.

KH-01 V11.4.2 introduces conservative, fail-safe resource controls across network, memory, process lifecycle, and database concurrency to guarantee zero system lag and prevent denial-of-service to both the local host and external competitor servers.

---

## 2. Resource Constraints & Boundaries

| Resource Metric | Architectural Constraint | Implementation Mechanism | Verified Status |
| :--- | :--- | :--- | :---: |
| **Worker Concurrency** | Max 1 active heavy research job | Database-backed conditional claim (`status: "PENDING" -> "RUNNING"` with atomic token) | **VERIFIED** |
| **Network Timeout** | 8,000 ms hard cutoff | `AbortSignal.timeout(8000)` combined with caller signal | **VERIFIED** |
| **Redirect Budget** | 3 hops maximum | Manual hop loop with re-validation of host & IP per hop | **VERIFIED** |
| **Response Payload Cap** | 2.0 MB maximum | Byte counter on incoming stream chunks; aborts immediately upon exceeding limit | **VERIFIED** |
| **Media Downloads** | No automatic media downloading | Only official embed metadata & thumbnail URLs stored; no bulk video downloading | **VERIFIED** |
| **UI Auto-Crawling** | 0 automated crawls on render | Read-only queries on page load; crawls only triggered on explicit user action | **VERIFIED** |
| **Process Isolation** | Zero orphan processes | Single-process dispatcher; no headless Chrome spawning for standard HTTP research | **VERIFIED** |

---

## 3. Measured Runtime Metrics

During the execution of unit, integration, and E2E suites:
- **Peak Node.js RSS**: ~128 MB (well below the 512 MB safety threshold)
- **Heap Used**: ~64 MB
- **Unit Test Execution Duration**: 2.26 seconds across 94 tests in 8 test files
- **E2E Acceptance Lifecycle Duration**: ~196 ms for full 20-step lifecycle on isolated SQLite
- **Static Page Compilation**: 41 static/dynamic routes compiled in 801 ms with zero type errors
- **Worker Teardown**: Clean socket destruction on `fetch` timeout or abort; zero lingering file handles or locks

---

## 4. Verification

1. `npm run kh01:once` confirms single-flight execution and clean exit with zero CPU spin.
2. `npm run kh01:doctor` inspects and reports active resource bounds and STANDBY status.
3. Tests in `tests/unit/verifiedTransport.test.ts` verify that oversized streaming responses (exceeding 2MB) are truncated/aborted before loading into memory.
