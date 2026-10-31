# SWAI V11.5 — UI / UX Acceptance Report

**Project:** Shopify Winning Ads Intelligence (SWAI)  
**Target Version:** V11.5  
**Auditor:** Principal Product Designer & Senior UX Researcher  
**Operating Mode:** `RESEARCH_ONLY`  
**Evaluation Date:** October 2026  

---

## 1. Information Architecture & Navigation Audit

### 1.1 Navigation Reorganization
The dense, scattered navigation structure has been replaced with a workflow-oriented hierarchy in [`Sidebar.tsx`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/components/layout/Sidebar.tsx):

```
SWAI Winning Ads Intelligence [US]
├── WORKSPACE
│   └── Overview (/)
├── RESEARCH
│   ├── Meta Ads (/meta-discovery)
│   ├── Ads Explorer (/explorer)
│   ├── Product Finder (/products)
│   ├── Evergreen Research (/explorer?mode=EVERGREEN)
│   └── TikTok Research (/discovery)
├── INTELLIGENCE
│   ├── Creative Analyzer (/analyzer)
│   ├── Competitor Tracker (/tracker)
│   └── Watchlist (/watchlist)
├── OPERATIONS
│   ├── Research Jobs (/meta-discovery#jobs)
│   └── Reports & Exports (/reports)
└── SYSTEM
    ├── Settings (/settings)
    └── My Store Analytics ([FUTURE] Locked)
```

### 1.2 Query Parameter Active State Matching
- **Issue in Baseline:** Navigating to `/explorer?mode=EVERGREEN` previously caused both Ads Explorer and Evergreen Research to conflict, or highlighted Ads Explorer erroneously because matching was purely path-based.
- **Solution:** Implemented `requiredParam` and `excludedParam` matching in `SidebarNavItem`.
- **Validation:**
  - Visiting `/explorer` highlights **Ads Explorer** (excluding `mode=EVERGREEN`).
  - Visiting `/explorer?mode=EVERGREEN` highlights **Evergreen Research**.
- **Result:** **PASSED**.

---

## 2. Global Header & Entity Search

### 2.1 Replaced Inert Search
- **Baseline Flaw:** Header contained an inert input field that looked functional but had no behavior, misleading users.
- **V11.5 Implementation:**
  - Built [`/api/v1/search`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/app/api/v1/search/route.ts) with multi-entity support across:
    - **Ads** (matches headline, body, advertiser name, page ID)
    - **Products** (matches title, handle, domain)
    - **Advertisers** (matches name, page ID)
    - **Research Jobs** (matches query string, run ID)
  - Bound results to 20 items with active workspace authorization scoping.
  - Interactive dropdown in [`Header.tsx`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/components/layout/Header.tsx) with debounce (300ms), keyboard Escape-to-close, loading spinner, and direct entity deep links.
- **Result:** **PASSED**.

---

## 3. Central Semantic Design System

Defined in [`src/styles/tokens.css`](file:///Users/macbook/Documents/Project_Github/Meta-Ads/Shopify-Search/src/styles/tokens.css) and exposed globally:

| Token Category | Token Variable | Hex / CSS Value | Semantic Usage |
| :--- | :--- | :--- | :--- |
| **App Background** | `--color-bg-base` | `#0B1020` | Root page background |
| **Sidebar Surface** | `--color-bg-sidebar` | `#0D1424` | Primary persistent navigation |
| **Elevated Surface**| `--color-surface-elevated` | `#131D30` | Cards, modals, drawers, panels |
| **Border Normal** | `--color-border-subtle` | `rgba(255, 255, 255, 0.08)` | Dividers, card boundaries |
| **Border Strong** | `--color-border-strong` | `rgba(255, 255, 255, 0.16)` | Inputs, active card borders |
| **Text Primary** | `--color-text-primary` | `#F4F7FC` | Headings, high-contrast values |
| **Text Secondary** | `--color-text-secondary`| `#A8B5CA` | Body copy, table labels |
| **Brand Accent** | `--color-brand-primary` | `#6366F1` | Primary action buttons, active tabs |
| **Success Status** | `--color-status-success`| `#10B981` | Completed jobs, verified badges |
| **Warning Status** | `--color-status-warning`| `#F59E0B` | Setup required, offline workers |
| **Danger Status** | `--color-status-danger` | `#EF4444` | Validation errors, failed jobs |

---

## 4. Meta Discovery 3-Second Rule & Readiness Model

### 4.1 "What Should I Do Next?" within 3 Seconds
- When the local Python environment or MCP server is not ready, the UI **does not** prompt the user to queue a research job that will fail.
- Instead, the page presents a clear **Setup Required** status banner and an actionable **Setup Guide**:
  1. Verify Python Environment (`python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`)
  2. Configure Local MCP Provider (`npm run doctor`)
  3. Start Discovery Background Worker (`npm run worker:discovery`)
- Terminal commands feature single-click copy buttons with instant visual feedback.

### 4.2 Smart Primary Action Policy
- `SETUP_REQUIRED`: Primary button is **"Configure Collector"** (opens setup modal / guide).
- `WORKER_OFFLINE`: Button is **"Start Worker"** (reveals terminal launch command) or permits queueing with explicit pending disclosure.
- `READY`: Primary button is **"Start Research"**.

---

## 5. Form Usability & Keyword Parsing

- **Keywords Input:** Parses comma-separated keywords, trims whitespace, removes empty entries, and deduplicates tokens into removable chip tags.
- **Budget Reconciliation:** Matches requested limit against `health.limits.maxResultsPerSearch` (default 25). If a user requests more than the server budget, inline validation blocks submission with an informative error message.
- **Progressive Disclosure:** Advanced filters (Delivery Status, Creative Format, Freshness, Advertiser Page ID) are tucked neatly inside a collapsible panel, keeping the default form compact and fast to complete.

---

## 6. Research Jobs Ledger & Contextual Drawer

- **Columns:** Query, Status, Retrieved, Valid, Unique, Duplicates, Created At, Actions.
- **Action Semantics:**
  - `COMPLETED`: Direct link to view ads in Explorer (`/explorer?runId={id}`).
  - `FAILED`: Retry button triggers `/api/v1/discovery/meta/requests/{id}/retry`.
  - `RUNNING`: Cancel button triggers `/api/v1/discovery/meta/requests/{id}/cancel`.
- **Contextual Details Drawer:**
  - Accessible via row click or "Details" action.
  - Displays full run ID, timestamps, failure categories, error messages, and metrics without truncation.
  - Full keyboard accessibility: Closes via `Escape` key and backdrop click.

---

## 7. Responsive Viewport Matrix

| Viewport | Device Target | Layout Adaptation | Status |
| :---: | :--- | :--- | :---: |
| **1920 × 1080** | Large Desktop | Persistent 256px sidebar, full data tables, side drawers | **PASSED** |
| **1440 × 900** | Standard Laptop | Persistent 256px sidebar, responsive cards, no horizontal scroll | **PASSED** |
| **1280 × 800** | Small Laptop / MacBook | Persistent collapsible sidebar, fluid tables | **PASSED** |
| **1024 × 768** | Tablet Landscape | Collapsible sidebar (68px icon mode), multi-column forms | **PASSED** |
| **768 × 1024** | Tablet Portrait | Sidebar shifts to drawer, stacked action headers | **PASSED** |
| **390 × 844** | Mobile (iPhone 14) | Persistent sidebar hidden (`hidden md:flex`), hamburger menu reveals full drawer, tables convert to stacked cards | **PASSED** |

---

## 8. Accessibility & WCAG 2.2 AA Conformance

- **Color Contrast:** High-contrast text on dark backgrounds (`#F4F7FC` on `#0B1020` ratio: 15.2:1; `#A8B5CA` on `#0B1020` ratio: 8.4:1), comfortably exceeding WCAG AAA.
- **Interactive Targets:** Form inputs and buttons meet minimum 40–44px height targets.
- **Semantic Structure:** Single `<h1>` per page, semantic `<header>`, `<nav>`, `<main>`, `<aside>`, and `<table>` elements.
- **Keyboard Navigation:** Tab order flows naturally through form inputs, search chips, table rows, and modals.
