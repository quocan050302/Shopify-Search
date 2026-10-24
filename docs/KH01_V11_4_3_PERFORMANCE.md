# KH-01 V11.4.3 — Performance & Operational Resource Bounds

## 1. Resource Limits & Bounding Architecture
The KH-01 engine processes external web targets and public advertising assets under strict hardware bounds to prevent OOM errors, hung worker loops, and network resource exhaustion:

| Parameter | Configuration | Verification Mechanism |
| :--- | :--- | :--- |
| **Max Global Concurrency** | `KH01_MAX_ACTIVE_HEAVY_RESEARCH_JOBS = 1` | Database-backed transaction counter in `claimPendingKh01Job` |
| **Network Timeout** | `8,000ms` | `AbortSignal.timeout(8000)` on HTTP transport |
| **Max Response Size** | `2,097,152 bytes (2MB)` | Stream chunk counter in `verifiedPublicTransport.ts` |
| **Max Redirect Hops** | `3 hops` | Per-hop manual redirect resolution with SSRF validation |
| **Media Downloads** | Disabled by default | Images/videos referenced via CDN URLs, not downloaded to disk |
| **Headless Browser** | Lazy / On-Demand | Standard requests handled via lightweight HTTP transport |
| **Lease Duration** | `60,000ms (60s)` | Monotonically fenced in database `SyncJob` |

## 2. Runtime Measurements
Measured during full end-to-end acceptance run (`FIXTURE_INTEGRATION_E2E`):
- **Execution Time**: ~1,330ms (Queue -> Claim -> Fetch -> Persist -> DB Readback -> HTTP API Readback -> Opportunity Aggregation)
- **Peak Process RSS**: 177.25 MB
- **Heap Used**: 54.64 MB
- **CPU User Time**: 970.45 ms
- **CPU System Time**: 97.03 ms
- **Process Cleanup**: 0 leaked child processes, test servers, or unreleased SQLite lockfiles.
