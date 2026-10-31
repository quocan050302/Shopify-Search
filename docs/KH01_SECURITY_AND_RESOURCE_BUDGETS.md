# KH-01 — Security Architecture & Resource Budgets
**SWAI V11.4 — Competitor Product, Offer & Funnel Intelligence Engine**

## 1. Security Architecture & SSRF Defense

Competitor landing page research exposes web services to Server-Side Request Forgery (SSRF) and DNS rebinding attacks if public URLs are fetched carelessly.

SWAI KH-01 establishes a multi-layer SSRF defense in `linkValidationService.ts`:

### 1.1 IP Address & Hostname Blocklist
Every URL submitted for inspection is resolved and evaluated against private, loopback, link-local, and cloud metadata ranges:
- **Private Subnets (RFC 1918)**: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- **Loopback**: `127.0.0.0/8`, `::1`, `localhost`
- **Link-Local**: `169.254.0.0/16`, `fe80::/10`
- **Carrier-Grade NAT (CGNAT)**: `100.64.0.0/10`
- **Cloud Metadata Services**:
  - AWS/GCP/Azure Metadata: `169.254.169.254`
  - GCP Internal: `metadata.google.internal`
  - Container Metadata: `169.254.170.2`, `fd00:ec2::254`
- **Special Addresses**: `0.0.0.0`, broadcast, decimal/hex encoded IPs (`0177.0.0.1`, `2130706433`).

### 1.2 Hop-by-Hop Redirect Validation
- Next.js / Node.js automatic redirect following is **disabled** (`redirect: "manual"`).
- Every redirect HTTP `Location` header is parsed and re-submitted to `validatePublicResearchUrl`.
- If an external website attempts to redirect to `http://169.254.169.254/latest/meta-data` or `http://192.168.1.1/admin`, the redirect is blocked immediately.

---

## 2. Resource Budgets & Machine Protection

To prevent system lockups and CPU fan noise on local development machines, strict resource budgets are enforced across all services:

| Resource Dimension | Strict Budget Limit | Enforcing Mechanism |
|---|---|---|
| **Worker Concurrency** | **1 job** | Single-threaded atomic claim lock on `SyncJob` |
| **HTTP Request Timeout** | **8,000ms** (8s) | `AbortSignal.timeout(8000)` on all network fetches |
| **Max Redirect Hops** | **3 hops** | Manual loop with redirect counter |
| **Max Response Size** | **2MB** (`2,097,152` bytes) | Streaming length verification / buffer slice |
| **HTML Storage Limit** | Fingerprint + JSON | Full HTML is discarded after parsing; only structured observations stored |
| **Browser Rendering** | On-demand only | No automatic headless browser spawns during page browsing |
| **Worker Heartbeat Lease** | **180,000ms** (3 min) | Jobs with expired leases are recovered cleanly |

---

## 3. Worker Health & Diagnostic CLI Commands

SWAI KH-01 provides lightweight command-line interfaces for operating and verifying the system:

```bash
# 1. Diagnostic health and integrity check
npm run kh01:doctor

# 2. Claim and execute exactly one eligible research job and exit
npm run kh01:once

# 3. Start bounded background worker with graceful shutdown (SIGINT / SIGTERM)
npm run kh01:worker

# 4. Run the complete test verification suite (unit + E2E integration)
npm run kh01:verify
```

### Process Cleanup:
- Graceful shutdown handles `SIGINT` and `SIGTERM`, aborts pending HTTP requests, and sets the worker heartbeat job state to `STOPPED`.
- Stale jobs whose worker terminated abruptly are transitioned back to `PENDING` or `FAILED` without infinite retry loops.
