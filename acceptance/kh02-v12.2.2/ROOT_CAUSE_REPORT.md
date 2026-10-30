# SWAI KH-02 V12.2.2 — ROOT CAUSE REPORT
**Release:** KH-02 V12.2.2  
**Generated:** 2026-10-26T16:45:38.831Z

---

## 1. Code Architecture Defects
- **Premature Completion via Cache Conflation:** Diagnosers previously inspected global SQLite tables (`CompetitorAd`) and marked sources as `SOURCE_DATA_VERIFIED` or `queryExecuted: true` without verifying that the current research run dispatched a live network query.
- **Protocol Mismatch:** Google Ads Transparency was designed for stdio/HTTP MCP, but initial adapters dispatched raw HTTP POST calls without the MCP session handshake (`initialize`).
- **Missing CallToolResult Parser:** MCP tool responses encapsulate data inside `content[0].text` (JSON string) or `structuredContent`. Adapters expecting plain arrays threw parsing exceptions or returned empty results.

## 2. Environment & Credential Boundaries
- **TikTok Creative Center US Coverage:** The official TikTok Commercial Content Library API is restricted to EU/UK under DSA regulations. Programmatic US competitor ad discovery requires a valid TikTok Creative Center session cookie (`TIKTOK_CC_COOKIE`) or third-party connector (`APIFY_TOKEN`). Without these, automation must fail closed and report `MANUAL_RESEARCH_ONLY`.
- **HasData REST vs MCP:** HasData provides standard REST endpoints (`/scrape/tiktok/search`) and an usage API (`/user/me/usage`). Using MCP conventions on a REST endpoint led to confusion and credit miscalculation.

## 3. Policy & Economic Safeguards
- **Zero-Cost Policy (`AUTO_PAID_RESEARCH=false`):** System strictly halts outbound billable calls when paid research is not explicitly enabled by the workspace administrator.
