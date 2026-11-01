# Google Ads MCP Bridge Root Cause & Runtime Architecture

## Summary
- **FastMCP Protocol**: Bridges via Python standard I/O (`scripts/googleTransparencyServer.py`).
- **Windows UTF-8 Encoding**: Configured with `sys.stdout.reconfigure(encoding="utf-8")`, `PYTHONUTF8=1`, and `PYTHONIOENCODING=utf-8` to prevent cp1252 stdio encoding errors on Windows.
- **Stage 6 Time Budgeting**: Per-domain lookups capped at 15s to keep Stage 6 within overall research deadlines.
- **Advertiser vs Domain Matching**: Advertisers resolved by verified store domain without guessing brand names.
- **Brand-Only vs Product-Specific Distinction**: Creatives landing on general homepage/collections are classified strictly as `BRAND_ONLY_MATCH` and never credited as SKU-level product proof.
