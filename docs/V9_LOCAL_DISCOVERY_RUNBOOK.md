# SWAI V9 — Local Auto Discovery Runbook
## Step-by-Step Operator Guide for Automated TikTok Ad Discovery

This runbook guides operators through configuring, diagnosing, running, and managing the SWAI V9 TikTok Auto Discovery Engine on a local Windows or macOS development machine.

---

### Step 1: Environment & Dependency Setup

Ensure Node.js v20+ or v22+ is installed:
```bash
node -v
npm -v
```

Install local dependencies:
```bash
npm install
```

Generate the Prisma client:
```bash
npm run prisma:generate
```

Verify local database connectivity and schema integrity:
```bash
npx prisma validate
```

---

### Step 2: Configure Environment Variables

Create or update `.env.local` with your configuration preferences:

```ini
# Operating Mode
APP_OPERATING_MODE=RESEARCH_ONLY
TARGET_RESEARCH_MARKET=US

# Database (Default: local SQLite via PrismaLibSql adapter)
DATABASE_URL="file:./dev.db"

# Free Auto Discovery Mode (Zero-cost default enabled)
FREE_DISCOVERY_MODE=true
ENABLE_TIKTOK_AUTO_DISCOVERY=true
DISCOVERY_DAILY_TARGET=20
DISCOVERY_MAX_PAGES=5
DISCOVERY_REQUEST_TIMEOUT_MS=15000

# OPTIONAL: TikTok Creative Center Session Cookie
# Extract from browser developer tools (Cookie header on ads.tiktok.com)
# When provided, enables automated direct querying without 40101 blocks
TIKTOK_CC_COOKIE=""

# OPTIONAL: Apify Metered Provider (Disabled by default)
# Only configure if you explicitly authorize paid credits
ENABLE_APIFY_DISCOVERY=false
APIFY_TOKEN=""

# AI Creative Analysis (Optional)
GEMINI_API_KEY=""
```

---

### Step 3: Run the Diagnostic Doctor

Run the built-in diagnostic doctor to verify provider status, database connection, and budget protection:

```bash
npm run discovery:doctor
```

Expected output when unconfigured:
```
[DB] Connected successfully.
[PROVIDERS] Checking registered discovery providers...
  • TikTok Creative Center Top Ads (Direct) (tiktok-topads)
    Status: REQUIRES_AUTH
  • Apify TikTok Top Ads (Metered) (apify-topads)
    Status: NOT_CONFIGURED
  • TikTok Official Platform API (tiktok-commercial-content-api)
    Status: REGION_UNSUPPORTED
[BUDGET] Checking paid API protection...
  • Captapi: Enabled=false, AllowAuto=false
```

---

### Step 4: Run a Safe Discovery Dry-Run

Verify the engine pipeline end-to-end with zero database writes and zero paid requests:

```bash
npm run discovery:dry-run
```

---

### Step 5: Start the SWAI Web Application

Start the Next.js development server:
```bash
npm run dev
```

Open your browser to:
- **Auto Discovery Dashboard:** [http://localhost:3000/discovery](http://localhost:3000/discovery)
- **Evergreen Ads Explorer:** [http://localhost:3000/explorer](http://localhost:3000/explorer)

---

### Step 6: Start the Dedicated Background Worker

In a separate terminal window, start the local scheduled worker:

```bash
npm run discovery:worker
```

The worker runs in a dedicated Node.js process with graceful shutdown handling (`Ctrl+C` or `SIGTERM`).

---

### Step 7: Configuring a Daily US Discovery Schedule

1. Navigate to [http://localhost:3000/discovery](http://localhost:3000/discovery).
2. Under **Search & Discovery Configuration**:
   - **Market:** United States (`US`).
   - **Keywords:** Add your target ecommerce niches (e.g. `skincare`, `hair care`, `gadget`).
   - **Industry:** Select specific categories (e.g. `Beauty & Personal Care`).
   - **Search Window:** Select `30 Days` (default) or `180 Days`.
   - **Daily Limit:** Set your target ad limit (e.g. `20` ads).
3. Under **Daily Schedule**:
   - Toggle **Enable Daily Schedule** to `ON`.
   - Set your preferred local execution hour.
   - Click **Save Schedule**.

---

### Step 8: Triggering an On-Demand Discovery Run

To execute an immediate run:
1. Click **Start Discovery (Live)** or **Dry Run (Test)** in the dashboard.
2. The UI will assign a durable Job ID and track progress in real-time.
3. Newly discovered ads automatically populate the **Discovery Results Preview** and link to **Ads Explorer**.

Or run directly from the CLI:
```bash
npm run discovery:once
```

---

### Step 9: Diagnosing Blocked Providers

| Observed Status | Root Cause | Solution |
| :--- | :--- | :--- |
| `REQUIRES_AUTH` | `TIKTOK_CC_COOKIE` is empty. | Add your TikTok Creative Center browser cookie to `.env.local`, or use the manual import tool at `/explorer`. |
| `BLOCKED_SOURCE` | The provided cookie has expired or was flagged by TikTok anti-bot WAF. | Refresh your session cookie from the browser, or wait for rate limit cooldown. |
| `REGION_UNSUPPORTED` | Official TikTok developer API only covers EU DSA regions. | Expected behavior. Commercial US ads are queried via Creative Center or Apify. |
| `PAID_DISABLED` | Apify is disabled by default to protect budget. | Set `ENABLE_APIFY_DISCOVERY=true` and `APIFY_TOKEN` in `.env.local` if authorized. |

---

### Step 10: Stopping the Worker

To cleanly shut down the background discovery worker:
- Press `Ctrl+C` in the worker terminal window.
- The worker will release all database locks, finalize in-flight batches, and exit cleanly without leaving stale `RUNNING` jobs.
