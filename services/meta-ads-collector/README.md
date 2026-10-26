# MetaAdsCollector MCP Service for SWAI

Self-hosted Facebook Ad Library collector running as a local Model Context Protocol (MCP) server over `stdio`.

## Upstream Integration Metadata
- **Source Repository:** `https://github.com/promisingcoder/MetaAdsCollector`
- **Reviewed Reference Commit:** `a9e5b14673fa41943bb831151700cc4dba1609c5`
- **Integrated Package Version:** `meta-ads-collector==1.7.0` with `[mcp]` extension (`mcp==2.3.0`)
- **Transport:** stdio (`python -m meta_ads_collector_mcp serve`)
- **API Status:** Unofficial public Meta Ad Library GraphQL endpoint collector (zero external paid API keys, zero browser automation required by default)

## Directory Structure
- `.venv/`: Project-specific Python virtual environment (ignored in git)
- `data/`: Local SQLite cache and runtime files for MCP collections (ignored in git)
- `requirements.txt`: Pinned, reproducible dependency lockfile

## Setup Command
```bash
bash scripts/meta-collector-setup.sh
# Or on Windows PowerShell:
# powershell -ExecutionPolicy Bypass -File scripts/meta-collector-setup.ps1
```

## Health Verification
```bash
npm run meta:doctor
```
