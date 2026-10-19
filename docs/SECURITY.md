# Security, Data Provenance & Safety Specification

## 1. Application Isolation & Zero Collision with APP #1
- **Process & Workspace Isolation**: SWAI (APP #2) runs exclusively within its dedicated repository directory (`Running-Ads` mapped to `quocan050302/Shopify-Search`).
- **No Shared Resources**: APP #2 maintains its own database, package dependencies, environment variables, git history, and process ports.
- **Verification Routine**: `verifyApplicationIsolation()` inspects the local runtime context to ensure no mutation touches APP #1 or other sibling workspaces.

---

## 2. Server-Side Request Forgery (SSRF) Guard
Any user-supplied URL (for ad imports or landing page detection) passes through `validateExternalResourceUrl()`:
1. **Scheme Enforcement**: Only `https:` and `http:` (production requires `https:`).
2. **Private IP & Loopback Blocking**:
   - `127.0.0.0/8` (Localhost)
   - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (Private IPv4)
   - `169.254.169.254` (Cloud Instance Metadata Services — AWS/GCP/Azure)
   - `::1`, `fc00::/7` (IPv6 loopback & ULA)
3. **Redirect Protection**: Following redirects validates each hop against the same SSRF policy.

---

## 3. Secret Protection & Safe Client Boundaries
- API keys, database connection strings, and future OAuth tokens are kept exclusively in server-side runtime memory and `.env` files (ignored in `.gitignore`).
- No client component receives raw credentials or unauthorized database connections.
- Future Shopify Admin tokens will use encrypted database columns.
