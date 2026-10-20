# SWAI V9.2 — Local Setup & Execution Runbook

**Environment:** Windows (PowerShell) / macOS (Zsh/Bash)  
**Node.js Version:** 20+  
**Package Manager:** npm  
**Database:** SQLite / LibSQL (`prisma/dev.db`)  
**Default Spent:** $0.00  

---

## 1. Environment Configuration

Copy the template environment file to `.env.local`. **Never commit `.env.local` or sensitive tokens to Git.**

### Windows PowerShell
```powershell
Copy-Item .env.example .env.local
```

### macOS / Linux
```bash
cp .env.example .env.local
```

### Environment Variable Guide (`.env.local`)

| Variable | Default Value | Description |
|---|---|---|
| `DATABASE_URL` | `"file:./dev.db"` | Path to the local SQLite database. |
| `FREE_DISCOVERY_MODE` | `"true"` | When `true`, prevents all metered external API calls. |
| `ENABLE_APIFY_DISCOVERY` | `"false"` | Must be explicitly set to `"true"` to allow Apify discovery. |
| `APIFY_API_TOKEN` | `""` | Optional. Apify API token if paid collection is authorized. |
| `GEMINI_API_KEY` | `""` | Optional. Google Gemini API key for automated ad video/copy analysis. |
| `TIKTOK_CC_COOKIE` | `""` | **Deprecated & Experimental**. Leave blank for zero-cost secure operation. |

---

## 2. Diagnostics & Health Check

Run the discovery doctor to verify environment variable loading, database connectivity, and provider readiness:

```powershell
npm run discovery:doctor
```

Expected output for zero-cost mode:
```
============================================================
 SWAI V9.2 — Discovery Environment & Health Diagnostics
============================================================
Environment Precedence : OK (using @next/env loader)
Database URL           : file:./dev.db
Free Discovery Mode    : ENABLED (zero metered outbound spend)
TikTok CC Cookie       : NOT CONFIGURED
Apify Discovery        : DISABLED (Spend protected)

[Provider Capability Check]
  - tiktok-official    : REGION_UNSUPPORTED (EU DSA only)
  - tiktok-topads      : NOT_CONFIGURED (Undocumented / No Session)
  - apify-topads       : PAID_DISABLED (Free mode active)
============================================================
Status: Engine Ready (Zero-cost safe mode active)
```

---

## 3. Starting the Application

### Terminal 1: Next.js Web Application
```powershell
npm run dev
```
Open your browser at [http://localhost:3000](http://localhost:3000).

### Terminal 2: Standalone Local Worker (Optional for Background Schedules)
The discovery worker checks for scheduled tasks and executes them asynchronously without blocking the Next.js web process:

```powershell
npm run discovery:worker
```
The worker registers a database heartbeat (`SyncJob`) every 15 seconds. The discovery dashboard will display **Worker Status: ONLINE**.

---

## 4. Running a Discovery Test (CLI)

### Dry-Run Test (Zero Requests, Zero DB Writes)
Test query validation and provider selection safely without network traffic:
```powershell
npm run discovery:dry-run
```

### Single Execution Test
```powershell
npm run discovery:once
```
In zero-cost mode with no credentials, the runner will safely exit with `BLOCKED_SOURCE` or `NOT_CONFIGURED` without crashing, without spending money, and without fabricating dummy data.

---

## 5. Zero-Cost US Ads Research Workflow

To research real US winning TikTok ads without any paid API keys:
1. Navigate to **Ads Explorer** (`/explorer`).
2. Click **"Open TikTok Creative Center US"** to browse live trending ads in the United States.
3. Copy the URL of any winning ad (e.g. `https://ads.tiktok.com/business/creativecenter/top-ads/...`).
4. Click **"Batch Import Ads"** and paste the URLs.
5. SWAI normalizes the ad metadata, saves the genuine source URL, and runs Gemini AI longevity analysis.
