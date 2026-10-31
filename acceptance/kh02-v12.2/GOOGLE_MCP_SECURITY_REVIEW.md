# SWAI KH-02 V12.2 — Google Ads Transparency MCP Technical & Security Review

**Subject:** Technical Evaluation of `https://github.com/block-town/google-ads-transparency-mcp`  
**Date:** 2026-10-26  
**Reviewer:** Staff Security Engineer & MCP Protocol Specialist  

---

## 1. Product Distinction: Google Ads API vs. Google Transparency Center

| Dimension | Official Google Ads API / MCP | Google Ads Transparency Center |
|---|---|---|
| Target URL | `googleads.googleapis.com` | `adstransparency.google.com` |
| Primary Use Case | Managing authorized user's own ad accounts | Researching public competitor advertisers and creatives |
| Competitor Ad Access | None (Forbidden across accounts) | Publicly visible creative repository |
| Authentication | OAuth 2.0 with developer token | Unauthenticated public web interface |
| Protocol | Official Google gRPC / REST API | Web frontend backed by internal RPC endpoints |

**Conclusion:** Official Google Ads MCP cannot be substituted for competitor transparency research.

---

## 2. Review of Candidate MCP: `block-town/google-ads-transparency-mcp`

### 2.1 Repository Metadata & License
* **Repository:** `https://github.com/block-town/google-ads-transparency-mcp`
* **Maintainer:** Community third-party project (block-town). Not affiliated with or endorsed by Google LLC.
* **License:** MIT License.
* **Maintenance Activity:** Low/intermittent; vulnerable to upstream Google Transparency frontend DOM changes.

### 2.2 Mechanism & Dependencies
* **Collection Engine:** Uses Puppeteer / Playwright headless Chromium automation to query `adstransparency.google.com`.
* **Dependencies:** Heavy headless browser footprint (Chromium binary download required).
* **Anti-Bot Countermeasures:** Google Transparency Center actively deploys Google reCAPTCHA Enterprise and rate-limiting barriers against automated headless instances.

### 2.3 Terms of Service Compatibility
* **Google Terms:** Automating queries against Google search and transparency properties without an authorized API violates Google Terms of Service (Automated Queries Clause).
* **Anti-Bot Circumvention:** KH-02 contract Directive 09 strictly prohibits bypassing CAPTCHA or deploying evasion mechanisms.

### 2.4 Security Risks
1. **SSRF Risk:** Third-party MCP servers accepting arbitrary domain inputs must not permit requests to loopback (`127.0.0.1`) or cloud metadata endpoints (`169.254.169.254`).
2. **Supply Chain Risk:** Running unvetted community MCP tools directly introduces risks of arbitrary script execution.

---

## 3. Integration & Deployment Decision

1. **Protocol Readiness:**
   - KH-02's `googleTransparencyResearchAdapter.ts` implements compliant MCP stdio and HTTP client transports, schema validation, and tool capability discovery.
2. **Operational Status:**
   - Because no compliant enterprise Transparency API is presently authorized in the environment, `GOOGLE_TRANSPARENCY_MCP_URL` remains unset.
   - Status:
     ```text
     GOOGLE_TRANSPARENCY_LIVE: BLOCKED
     Reason: Compliant automated transparency provider not configured in environment.
     ```
3. **Safety Guarantee:**
   - System gracefully skips Google Ads enrichment without hanging, throwing unexpected runtime exceptions, or failing downstream product candidate evaluation.
