# Shopify Winning Ads Intelligence (SWAI) — Architecture & System Design

## 1. System Overview
**Shopify Winning Ads Intelligence (SWAI)** is a specialized, production-oriented web application designed to discover, track, and evaluate high-potential ecommerce video advertisements and products in the United States market.

The platform operates in **RESEARCH_ONLY** mode by default. It provides immediate value to pre-Shopify entrepreneurs and ecommerce research teams without requiring:
- A Shopify store or Shopify API credentials.
- Ownership or administrative access to Meta Business Manager.
- Ownership or administrative access to TikTok Ads Manager.

All analytics are grounded in **real, observable, and authoritative advertising evidence**, strictly avoiding fabricated sales estimates, artificial conversion data, or cosmetic mockups.

---

## 2. Operating Modes Architecture

The system transitions across three distinct operational modes based on verified credentials:

```
┌────────────────────────────────────────────────────────┐
│                  RESEARCH_ONLY (Default)               │
│  - Public Meta Ad Library research                     │
│  - TikTok Creative Center public discovery             │
│  - Direct user-observed ad imports (URL/manual/CSV)    │
│  - Public ecommerce landing page detection             │
│  - AI creative hook, pacing & structural analysis      │
│  - Multi-factor winning potential research score       │
│  - Competitor tracking & watchlists                    │
└──────────────────────────┬─────────────────────────────┘
                           │ + Verified Shopify Admin API
                           ▼
┌────────────────────────────────────────────────────────┐
│               RESEARCH_AND_STORE (Future)              │
│  - Order volume, net sales, refund reconciliation      │
│  - Shopify product catalog mapping                     │
│  - Landing page conversion tracking                    │
└──────────────────────────┬─────────────────────────────┘
                           │ + Verified Meta/TikTok Ads API
                           ▼
┌────────────────────────────────────────────────────────┐
│          OWNED_AD_ACCOUNT_ANALYTICS (Future)           │
│  - Private ad spend, ROAS, CPA, CAC                    │
│  - Ad attribution vs Shopify net receipts              │
└────────────────────────────────────────────────────────┘
```

---

## 3. Data Classification Standard
To ensure 100% intellectual honesty, every metric and data point across the UI, API, and exports is stamped with one of four classifications:

1. **`VERIFIED`**: Directly obtained from an authoritative, authenticated, or platform-certified data source.
2. **`OBSERVED`**: Empirically recorded from public advertising libraries, landing pages, or user-logged real URLs.
3. **`ESTIMATED`**: Calculated or inferred using documented, transparent mathematical formulas and heuristics.
4. **`UNAVAILABLE`**: Explicitly marked when the platform or source does not provide the metric (never replaced with 0 or synthetic figures).

---

## 4. High-Level Modular Monorepo Architecture

```
d:\Project_github\Running-Ads\
├── docs/                      # Architectural, data source, and security specifications
├── prisma/                    # Relational schema (SQLite/PostgreSQL compatible)
│   ├── schema.prisma          # Domain entities: Ads, Products, Creatives, Scores, Settings
│   └── migrations/            # Version-controlled schema migrations
├── src/
│   ├── app/                   # Next.js App Router pages and API routes
│   │   ├── api/v1/            # Versioned REST APIs (providers, ads, products, ai, export)
│   │   ├── explorer/          # Winning Ads Explorer interface
│   │   ├── products/          # Winning Product Finder interface
│   │   ├── analyzer/          # AI Creative Analyzer interface
│   │   ├── tracker/           # Competitor Tracker & Timeline interface
│   │   ├── watchlist/         # Watchlist & Saved Searches interface
│   │   ├── reports/           # Reports & Export center
│   │   ├── settings/          # Connection Settings (Shopify, Meta, TikTok, System)
│   │   └── my-store/          # Future Shopify store analytics (honest locked empty state)
│   ├── components/            # UI components (shadcn/ui-inspired, Tailwind CSS, dark mode)
│   │   ├── ads/               # AdCard, AdVideoPlayer, AdDetailDrawer, AdFilters
│   │   ├── products/          # ProductCard, ProductDetailModal, PriceHistoryChart
│   │   ├── analyzer/          # HookBadge, CreativeTimeline, ScriptGenerator
│   │   ├── layout/            # Sidebar, Header, KPIStatsCard, EmptyState
│   │   └── ui/                # Buttons, Dialogs, Badges, Tabs, Inputs
│   ├── lib/                   # Shared utilities and configurations
│   │   ├── db.ts              # Prisma client singleton
│   │   ├── env.ts             # Validated environment configuration with Zod
│   │   └── utils.ts           # String, date, and currency helpers
│   ├── services/              # Domain Services (The core business logic)
│   │   ├── providers/         # Source adapters (Meta, TikTok, User-Observed, Web)
│   │   ├── ads/               # Competitor ad ingestion, search, and variants
│   │   ├── media/             # Video asset resolver, metadata extractor, player fallback
│   │   ├── products/          # Product grouping, platform detector (Shopify), pricing
│   │   ├── ai/                # AI creative analyzer, hook classifier, concept generator
│   │   ├── scoring/           # Winning potential score, evidence confidence calculation
│   │   ├── tracking/          # Watchlist manager, observation history, competitor tracking
│   │   ├── export/            # CSV, JSON, and report generation
│   │   └── shopify/           # Future commerce contracts and calculation formulas
│   └── types/                 # TypeScript interfaces and enum definitions
└── tests/                     # Unit and integration test suites
```

---

## 5. Technology Stack Decisions
- **Framework**: Next.js 16 with App Router & React 19.
- **Language**: TypeScript 5.9 with strict type checking.
- **Styling**: Tailwind CSS v4, professional dark-first analytical theme.
- **ORM / Database**: Prisma ORM with SQLite for zero-friction local execution, ready for PostgreSQL via `DATABASE_URL`.
- **Validation**: Zod for runtime schema validation on all inputs, URLs, and external records.
- **Testing**: Vitest for fast, reliable unit and integration testing.
- **Visuals & Charts**: Recharts & Lucide React.
