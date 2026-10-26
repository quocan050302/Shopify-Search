# SWAI KH-02 — SECURITY, WORKSPACE ISOLATION & ZERO-COST BUDGET REPORT
**Module:** KH-02 — Evergreen Winning Products Intelligence  
**Security Boundary:** Multi-Tenant Isolation & Zero Unapproved Spend  
**Formula Version:** `12.0.0`

---

## 1. Zero-Cost Budget Protection (`AUTO_PAID_RESEARCH = false`)

### 1.1 Non-Negotiable Financial Policy
- By default, all paid external API providers (Apify, ScrapeCreators, metered third-party scrapers) are strictly disabled (`AUTO_PAID_RESEARCH = false`).
- Free unmetered endpoints (Meta Ads Library via official Python MCP, Google Ads Transparency via public web, local Google Trends imports) are prioritized.
- Any metered provider (e.g. HasData TikTok scraper) requires explicit prior workspace administrator budget approval via `budgetService.ts`.
- The system returns `BUDGET_NOT_APPROVED` rather than automatically consuming credits or falling back to paid proxies.

---

## 2. Multi-Tenant Workspace Isolation

### 2.1 Server-Side Context Resolution
- Every KH-02 HTTP endpoint enforces `resolveAuthorizedResearchContext(request)`:
  - Validates administrator bearer tokens, cookies, or authorized loopback desktop environments.
  - Rejects foreign, forged, or unassociated `workspaceId` headers with `403 UNAUTHORIZED_WORKSPACE`.
  - Ensures research runs, candidate evaluations, and scoring snapshots are strictly scoped to the tenant's workspace ID.

### 2.2 Product Ownership & Cross-Tenant Defense
- `assertProductWorkspaceAccess(productId, context)` prevents Workspace A from viewing or modifying product evidence, candidate reviews, or ranking snapshots belonging to Workspace B.
- Database queries consistently include `{ where: { workspaceId } }` filters on all newly introduced snapshot entities.

---

## 3. Media & SSRF Security

### 3.1 Strict Media Validation
- Thumbnails and video URLs are sanitized using existing SSRF protections (`validateMediaAssetUrl`).
- Loopback, local network (192.168.x.x, 10.x.x.x, 127.0.0.1), and cloud metadata service IP ranges (169.254.169.254) are rejected.
- Embedded video previews do not execute third-party tracking scripts directly; safe embed protocols (e.g. TikTok embed URLs) are utilized.

---

## 4. Credential Storage Security

- API keys and tokens are stored encrypted or securely referenced via server-side environment variables (`META_AD_LIBRARY_ACCESS_TOKEN`, `GEMINI_API_KEY`).
- Secret tokens are **never** returned in client-side JSON responses, written to `localStorage`, or logged in production console streams.
