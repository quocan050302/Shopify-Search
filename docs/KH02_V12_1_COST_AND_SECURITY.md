# SWAI KH-02 V12.1 — Cost Safeguards & Workspace Security Architecture

## 1. Zero-Cost Protection Policy

### Default Mode
```text
AUTO_PAID_RESEARCH = false
```
The application defaults to zero-cost, local-first research. No metered external API call (e.g. HasData TikTok Organic) can be triggered without explicit user authorization or configuration.

### Cost Pre-Check
`estimateResearchProviderCost()` calculates projected credits before network requests:
- If `AUTO_PAID_RESEARCH !== "true"`: Fails closed with `isAllowed: false`, `requiresPaidApproval: true`.
- Zero unapproved credits consumed across all test runs.

---

## 2. Multi-Tenant Workspace Boundary Enforcement

Every persistent KH-02 entity and operation enforces strict tenant isolation:
- `SyncJob` records for research runs are partitioned by `workspaceId`.
- `CompetitorAd` queries are restricted via `buildAuthorizedAdWhere(workspaceId)`.
- `ResearchEvidence` match reviews are scoped to `workspaceId`.
- Cross-workspace reads (`GET /api/v1/kh02/research/runs`, `GET /api/v1/kh02/leaderboard`) return `null` or empty arrays when accessed from an unauthorized workspace.
- Forged workspace headers without matching principal authorization are rejected with HTTP 403 `UNAUTHORIZED_WORKSPACE`.

---

## 3. SSRF & Endpoint Sanitization

- Configured provider endpoints (`GOOGLE_TRANSPARENCY_MCP_URL`, `HASDATA_API_KEY`) are validated on the server side.
- No client-controlled arbitrary URL fetching.
- API keys and tokens are never reflected in client responses, logs, or snapshots.
