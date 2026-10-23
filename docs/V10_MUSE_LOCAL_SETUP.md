# SWAI V10 — Local Setup & Muse Integration Guide

This guide describes how to configure and run SWAI locally for Meta Ads Discovery with Muse AI.

---

## 1. Environment Configuration

1. Copy `.env.example` to `.env.local` if not already present:
   ```bash
   cp .env.example .env.local
   ```
2. Set a strong `MUSE_INGESTION_TOKEN` (or `ADMIN_API_KEY`):
   ```env
   MUSE_INGESTION_TOKEN="your_secure_muse_token_here_64_chars"
   ADMIN_API_KEY="your_admin_secret_here"
   DATABASE_URL="file:./dev.db"
   ```
   *Note: `MUSE_INGESTION_TOKEN` is an application-side shared secret used by the Muse connector to authenticate to SWAI. It is not an official Meta or Muse API key.*

---

## 2. Database Preparation

Run Prisma database synchronization:
```bash
npx prisma db push
npx prisma generate
```

---

## 3. Starting the Application

```bash
npm run dev
```
Open [http://localhost:3000/meta-discovery](http://localhost:3000/meta-discovery) in your browser.

---

## 4. Muse AI Connection Workflows

### Option A: Manual / Artifact Bridge (Recommended for Local Dev)
When running SWAI on `localhost:3000` without a public domain or tunnel:
1. Open the **Meta Ads Discovery** page (`/meta-discovery`).
2. Enter search keywords (e.g. `pet hair remover, lint roller`) and click **Create Muse Research Request**.
3. Copy the **Request ID** and keywords.
4. In your Muse AI conversation, paste the instructions from `docs/MUSE_RESEARCH_AGENT_PROMPT.md` and give Muse the keywords.
5. Muse researches the public Meta Ad Library and generates the structured JSON artifact.
6. Click **Import Artifact** on the `/meta-discovery` page, paste the JSON, and click **Commit Artifact to Database**.
7. View the imported ads immediately in the **Facebook Winning Ads Explorer** (`/explorer?platform=META`).

### Option B: Direct Connected Agent (With Reachable HTTPS Tunnel)
If exposing SWAI via an authorized secure reverse proxy or cloud deployment:
1. Provide Muse or its connector script with:
   - Endpoint: `https://<YOUR_DEPLOYED_URL>/api/v1/discovery/muse/requests`
   - Authorization: `Bearer <MUSE_INGESTION_TOKEN>`
2. The connector polls for `PENDING` requests, executes research, and submits results to `POST .../requests/:id/results`.
