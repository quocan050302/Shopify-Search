# SWAI V11.5 — UI / UX Problem Analysis & Principles
**Product**: Shopify Winning Ads Intelligence (SWAI)  
**Target Version**: V11.5  
**Operating Mode**: `RESEARCH_ONLY`

---

## 1. Context & User Workflow
SWAI enables ecommerce researchers to discover, inspect, and evaluate public advertisements and competitor products in the US market without requiring a connected Shopify store or paid scraping subscriptions.

The primary user journey follows:
1. **Understand System Readiness**: Is the local collector installed and the worker running?
2. **Setup if Required**: Clear, actionable terminal commands or diagnostics.
3. **Execute Research**: Clean keyword input with realistic limits and clear progress.
4. **Track Execution**: Scannable research jobs table with drawer inspection.
5. **Inspect Discovered Ads & Products**: Filterable Explorer view preserving research run context.
6. **Evaluate Evidence & Make Decisions**: Truthful assessment across 6 pillars with auditable user overrides.

---

## 2. Identified UI / UX Defects in Existing Implementation

### 2.1 Confusing First Impression & Cognitive Overload
- **Observation**: Upon landing on `/meta-discovery`, the user is greeted by:
  - 4 disconnected diagnostic status cards (Local MCP Server, Background Worker, Latest Valid Ads, Research Jobs).
  - A dense research form with small inputs and crowded buttons.
  - A giant ledger table below the form.
- **Problem**: When the collector is unconfigured (common for new local clones), the user sees 4 red/yellow warning cards, but the main action still says "Queue Meta Research Task", which will immediately fail.
- **Solution**: Replace alarmist cards with a **Setup-First Guide** that appears conditionally only when action is needed. When ready, collapse setup into a calm status indicator.

### 2.2 Lack of Three-Second Action Clarity
- **Problem**: The screen fails the "What should I do next?" test within 3 seconds. The user has to read 4 status boxes, decipher whether "Worker Offline" prevents job queuing, and guess how to start the worker.
- **Solution**: Introduce a **Smart Primary Action**:
  - `NOT_CONFIGURED` / `SETUP_REQUIRED`: Primary button is **Configure Collector**.
  - `WORKER_OFFLINE`: Button offers **Queue for Later (Worker Offline)** or directs to start worker.
  - `READY`: Primary button is **Start Research**.

### 2.3 Form Ergonomics & Result Budget Mismatch
- **Problem**:
  - Comma-separated keyword input has no chip visualization, no client-side trimming, and no clear inline error states.
  - Limit dropdown allows selecting 50 or 100 ads, whereas the backend configuration default limit is 25 (`health.limits.maxResultsPerSearch`). Selecting 100 causes unexpected server clamping without warning.
  - Advanced filters (delivery status, creative format, launch freshness, advertiser page ID) clutter the default view.
- **Solution**:
  - Parse and normalize keywords cleanly.
  - Reconcile limit options with `health.limits.maxResultsPerSearch`.
  - Place secondary filters inside a collapsible **Advanced Parameters** disclosure.

### 2.4 Research Jobs Ledger Legibility
- **Problem**:
  - Column headers like `Retr / Valid / New / Dups` are cramped, cryptic, and use tiny 10px fonts.
  - Error messages stretch and distort table rows.
  - No detailed drawer for inspecting execution checkpoints, queries, or error diagnostics.
- **Solution**:
  - Professional tabular layout with readable typography (13-14px).
  - Clear columns: Query, Status, Results (Retrieved / Valid / Unique), Created, Actions.
  - Contextual sliding details drawer (`MetaJobDetailsDrawer`) with complete metadata, timestamps, and ad links.

### 2.5 Navigation Hierarchy & State Tracking
- **Problem**:
  - Sidebar labels are unnecessarily verbose (e.g., "Facebook Winning Ads Explorer").
  - Sidebar active state breaks on `/explorer?mode=EVERGREEN` because it only checks pathname.
  - Header search is completely inert and does not perform any query.
  - External links (TikTok Top Ads) are pinned globally to the top bar on every page.
- **Solution**:
  - Streamlined workflow groups in the sidebar: WORKSPACE, RESEARCH, INTELLIGENCE, OPERATIONS, SYSTEM.
  - Query-aware route matching using `useSearchParams()`.
  - Functional page-scoped search or honest, non-misleading search palette.
  - Place external links inside contextual areas (e.g. TikTok Research tab).

---

## 3. SaaS Design Principles Applied
1. **Progressive Disclosure**: Show what is necessary for 80% of workflows; tuck technical configuration and advanced parameters behind clear disclosure panels.
2. **Deterministic Statuses**: No blinking green dots or hardcoded "READY" text without real underlying verification.
3. **Calm, High-Contrast Visuals**: Tailored slate/indigo palette (#0B1020 background, #131D30 surfaces, #6366F1 primary action) adhering to WCAG 2.2 AA contrast.
4. **Resilience & State Separation**: Distinct UI states for `INITIAL_LOADING`, `REFRESHING`, `SUCCESS`, `EMPTY`, `ERROR`, and `STALE`.
