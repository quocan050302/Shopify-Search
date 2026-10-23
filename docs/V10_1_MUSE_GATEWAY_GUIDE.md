# SWAI V10.1 — Restricted Muse Gateway & Cloudflare Tunnel Guide

**Project**: Shopify Winning Ads Intelligence (SWAI)
**Component**: Dedicated Local Muse HTTPS/HTTP Reverse Proxy & Tunnel Architecture
**Date**: 2026-10-23
**Security Level**: High Isolation (Zero Secret Exposure, Port Whitelisting, Quarantine Isolation)

---

## 1. Architectural Invariant & Port Separation

```
[External Muse Agent]
         │
         ▼ (HTTPS via Cloudflare Quick Tunnel)
  trycloudflare.com
         │
         ▼
[127.0.0.1:8787] — Dedicated Restricted Muse Gateway (npm run muse:gateway)
  ├── 1. Path Whitelist: ONLY /api/v1/discovery/muse/agent/* (All other paths -> 404)
  ├── 2. Method Whitelist: GET, PATCH, POST as authorized (Unpermitted -> 404)
  ├── 3. Authentication: Constant-time check of MUSE_INGESTION_TOKEN (Missing -> 401, Invalid -> 403)
  ├── 4. Admin Credential Lock: ADMIN_API_KEY explicitly rejected (403)
  ├── 5. Bounded Payload: 2MB max body size (Exceeding -> 413)
  ├── 6. Rate Limiting: 60 requests/minute per client IP (Exceeding -> 429)
  ├── 7. Timeout Protection: 30s client & upstream socket timeouts (504)
  └── 8. Upstream Forwarding: Attaches x-muse-gateway-source: muse-reverse-proxy-8787
         │
         ▼ (Internal Local Traffic Only)
[127.0.0.1:3000] — SWAI Next.js Core Application (npm run dev)
  ├── Dashboard UI, Meta Discovery, Product Analyzer
  ├── Internal Admin APIs (/api/v1/settings, /api/v1/ads, etc.)
  └── Local SQLite Database via Prisma ORM
```

> [!CAUTION]
> **CRITICAL SECURITY INVARIANT**:
> The public tunnel points **EXCLUSIVELY to `http://127.0.0.1:8787`**.
> Port 3000 (Next.js server) is **NEVER exposed directly to any public tunnel**.
> This guarantees that Next.js development endpoints, user settings, admin credentials, and internal databases are completely unreachable from the outside.

---

## 2. Permitted Gateway Endpoints vs Forbidden Paths

| Endpoint | Permitted Method | Purpose | Authentication |
| :--- | :---: | :--- | :--- |
| `/api/v1/discovery/muse/agent/requests` | `GET` | External agent reads assigned research queue | `MUSE_INGESTION_TOKEN` |
| `/api/v1/discovery/muse/agent/requests/:id` | `GET` | External agent inspects assigned request detail | `MUSE_INGESTION_TOKEN` |
| `/api/v1/discovery/muse/agent/requests/:id` | `PATCH` | External agent claims request atomically (15m lease) | `MUSE_INGESTION_TOKEN` |
| `/api/v1/discovery/muse/agent/requests/:id/results` | `POST` | External agent submits verified Meta Ad Library records | `MUSE_INGESTION_TOKEN` |
| `/api/v1/discovery/muse/agent/heartbeat` | `POST` | External agent sends heartbeat to refresh lease | `MUSE_INGESTION_TOKEN` |
| **All other routes** (`/`, `/settings`, `/api/v1/settings`, `/_next/*`, user endpoints) | **ANY** | **BLOCKED** | **Returns HTTP 404** |

---

## 3. Windows PowerShell Startup Commands

To start the full SWAI platform with the secure Muse bridge on Windows, open three separate PowerShell windows:

### Terminal 1: Start SWAI Next.js Core Server
```powershell
# Navigate to repository root
cd D:\Project_github\Shopify-Search

# Start Next.js development server on 127.0.0.1:3000
npm run dev
```

### Terminal 2: Start Dedicated Restricted Muse Gateway
```powershell
# Navigate to repository root
cd D:\Project_github\Shopify-Search

# Start restricted reverse proxy on 127.0.0.1:8787
npm run muse:gateway
```
*Console output confirms whitelist status, 2MB payload boundary, and 60 req/min rate limit.*

### Terminal 3: Start Cloudflare Quick Tunnel (External HTTPS Gateway)
```powershell
# Navigate to repository root
cd D:\Project_github\Shopify-Search

# Start Cloudflare Quick Tunnel pointing ONLY to 127.0.0.1:8787
npm run muse:tunnel
```
*If `cloudflared` is not installed, install it once via PowerShell:*
```powershell
winget install --id Cloudflare.cloudflared
```
*The command will output the temporary HTTPS URL, e.g.:*
`https://random-subdomain.trycloudflare.com`

---

## 4. External Muse Agent Configuration

Provide the following configuration to the external Muse agent:

* **Base URL**: `https://<YOUR_SUBDOMAIN>.trycloudflare.com`
* **Queue Endpoint**: `GET https://<YOUR_SUBDOMAIN>.trycloudflare.com/api/v1/discovery/muse/agent/requests`
* **Claim Endpoint**: `PATCH https://<YOUR_SUBDOMAIN>.trycloudflare.com/api/v1/discovery/muse/agent/requests/<REQUEST_ID>`
* **Results Endpoint**: `POST https://<YOUR_SUBDOMAIN>.trycloudflare.com/api/v1/discovery/muse/agent/requests/<REQUEST_ID>/results`
* **Heartbeat Endpoint**: `POST https://<YOUR_SUBDOMAIN>.trycloudflare.com/api/v1/discovery/muse/agent/heartbeat`
* **Required Headers**:
  ```http
  Authorization: Bearer <MUSE_INGESTION_TOKEN>
  Content-Type: application/json
  ```

---

## 5. Live External Connection vs Test Simulation Separation

SWAI V10.1 enforces strict separation between live external connectivity and automated test runs:

1. **Live External Agent Connection**:
   - Arrives through the gateway proxy (`x-muse-gateway-source: muse-reverse-proxy-8787`).
   - Uses a non-test agent ID (e.g. `muse-external-worker-1`).
   - Sets `diagnosticState = "AGENT_VERIFIED"` and `agentConnected = true` for the 15-minute lease duration.
2. **Local Test Simulation**:
   - Uses test agent IDs (starting with `test`, `sim`, `mock`, `vitest`).
   - Test-created ads are automatically flagged with `isSyntheticQuarantine = true` (`dataConfidence = "UNVERIFIED"`).
   - Test runs are tagged `runMode = "SIMULATED"`.
   - **Crucial Invariant**: Completed test jobs or simulated heartbeats **NEVER** mark the bridge as `AGENT_VERIFIED`. The bridge reports `AGENT_NOT_CONNECTED` until an actual external agent heartbeats.
