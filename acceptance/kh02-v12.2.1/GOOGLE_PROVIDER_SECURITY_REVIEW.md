# GOOGLE ADS TRANSPARENCY PROVIDER SECURITY REVIEW

## 1. Protocol Architecture
- **Standard Protocol:** Streamable HTTP / stdio JSON-RPC 2.0 (MCP Specification).
- **Corrected Defect:** Removed guessed REST paths (`/health`, `/tools`, `/search_advertisers`). The client strictly dispatches compliant `tools/list` and `tools/call` JSON-RPC envelopes.

## 2. SSRF Protection
- Target endpoints configured via `GOOGLE_TRANSPARENCY_MCP_URL` are validated against `isSafePublicUrl()`.
- Connections to `localhost`, `127.0.0.1`, private IP ranges (`10.0.0.0/8`, `192.168.0.0/16`, `172.16.0.0/12`), and cloud metadata services (`169.254.169.254`) are strictly rejected.

## 3. Command Injection Safeguards
- Commands configured via `GOOGLE_TRANSPARENCY_MCP_COMMAND` are screened against shell metacharacters (`/[;&|`$\n]/`).
- Shell execution is prohibited; execution uses direct binary spawning via `playwright-core` or `StdioClientTransport`.
