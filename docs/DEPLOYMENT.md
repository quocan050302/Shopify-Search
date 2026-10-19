# Deployment & Operations Guide

## 1. Local Development Setup
Prerequisites: Node.js 20+, npm 10+.

```bash
# Clone the repository
git clone https://github.com/quocan050302/Shopify-Search.git
cd Shopify-Search

# Copy environment variables
cp .env.example .env

# Generate Prisma Client & push local schema
npm run prisma:generate
npm run prisma:push

# Run development server
npm run dev
```

Server starts at `http://localhost:3000`.

---

## 2. Production Deployment (Vercel / Node.js Container)
1. Set `DATABASE_URL` (SQLite for single-instance, or PostgreSQL / Supabase for clustered deployments).
2. Configure feature flags:
   - `ENABLE_SHOPIFY_CONNECTION=false` (keep disabled until ready)
   - `ENABLE_META_OWNED_ADS=false`
   - `ENABLE_TIKTOK_OWNED_ADS=false`
   - `ENABLE_STORE_ANALYTICS=false`
3. Run `npm run build` and `npm run start`.
